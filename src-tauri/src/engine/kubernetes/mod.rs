//! Le transfert de port Kubernetes : `kubectl port-forward`, lancé en sous-processus.
//!
//! # Pourquoi `kubectl` et pas un client Kubernetes
//!
//! Le transfert de port de Kubernetes n'est pas une redirection TCP : c'est un flux multiplexé
//! (SPDY, ou WebSocket depuis la 1.30) au-dessus d'un appel authentifié au serveur d'API. L'écrire
//! nous-mêmes demanderait un client Kubernetes complet — lecture du kubeconfig, contextes,
//! certificats client, jetons, et surtout les *exec credential plugins* par lesquels GKE, EKS et
//! l'OIDC délivrent leurs identifiants. Ce dernier point est décisif : ces plugins **sont** des
//! programmes installés sur la machine, donc même un client natif finirait par lancer un
//! sous-processus, avec en plus toute la surface d'un client à tenir à jour.
//!
//! C'est le même arbitrage que `22b` pour le dump : **déléguer à l'outil natif**. Il donne la
//! fidélité plutôt que de la promettre, et sa contrepartie — une dépendance à un binaire externe —
//! est celle que `binaire.rs` assume et **dit**.
//!
//! # Ce que cette sorte de proxy a de différent des deux autres
//!
//! - **il n'y a pas d'hôte.** Le tunnel SSH redirige vers `variante.host` *tel que le bastion le
//!   voit* ; le proxy Cloud SQL tient sa cible du nom d'instance. Ici, la cible est une
//!   **ressource** dans un espace de noms, et l'hôte de la connexion ne veut rien dire — `A2` le
//!   grise en le disant.
//! - **le port de la connexion, lui, sert vraiment** : c'est celui sur lequel la base écoute *dans
//!   le pod*, donc le membre droit du `local:distant` de `kubectl`. Le champ « Port » de `A2` garde
//!   exactement son sens, contrairement au visage Cloud SQL qui le grise.
//! - **le mot de passe sert aussi.** Un PostgreSQL dans un pod s'authentifie comme n'importe quel
//!   autre ; il n'y a pas d'équivalent de l'IAM d'`06k`, et `authentification_iam` reste donc faux
//!   pour cette sorte.
//!
//! Découpage :
//! - `binaire` — trouver `kubectl`, ou dire comment l'installer ;
//! - `sortie` — les trois lignes de journal dont on dépend ;
//! - `diagnostic` — reconnaître un échec de `kubectl` pour y joindre la manœuvre.

pub mod binaire;
pub mod diagnostic;
pub mod sortie;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use tokio::process::Command;

use crate::config::ProxyKubernetes;
use crate::engine::journal::Journal;
use crate::engine::port;
use crate::engine::programme;
use crate::engine::proxy::EtatProxy;
use crate::engine::sous_processus::{EchecDeLancement, Reperes, SousProcessus};
use crate::engine::EngineError;

/// Le sujet passé à `qualifier_avec`. En constante pour la même raison que `tunnel::SUJET` et
/// `cloudsql::SUJET` : le test de `proxy.rs` vérifie **la valeur que la production emploie**, et
/// non un littéral retapé dans le test — sans quoi vider ce sujet ne casserait rien, et un
/// transfert mort dirait « est tombé » sans dire quoi.
pub(crate) const SUJET: &str = "le transfert de port Kubernetes";

/// Ce qu'il faut savoir lire dans la sortie de `kubectl`. Les trois fonctions vivent dans `sortie`,
/// seul fichier à connaître le format de ses messages.
const REPERES: Reperes = Reperes {
    port_annonce: sortie::port_annonce,
    est_pret: sortie::est_pret,
    est_un_echec: sortie::est_un_echec,
};

/// Le temps laissé à `kubectl` pour annoncer qu'il écoute.
///
/// Généreux **délibérément**, et pour une raison de plus que le proxy Cloud SQL : avant d'ouvrir le
/// flux, `kubectl` peut avoir à lancer un *exec credential plugin* — `gke-gcloud-auth-plugin`
/// appelle `gcloud`, qui rafraîchit un jeton par le réseau. Sur une liaison lente, cela prend
/// plusieurs secondes. Trop court, et l'app rendrait « délai dépassé » là où le transfert allait
/// s'établir : le pire des deux échecs, parce qu'il accuse le mauvais coupable.
const DELAI_DEMARRAGE: Duration = Duration::from_secs(20);

/// Ce qu'on retire de notre délai pour obtenir celui qu'on donne à `kubectl`.
///
/// **L'ordre des deux délais est ce qui décide du message que l'utilisateur lit**, et c'est le
/// point de ce réglage. `kubectl --pod-running-timeout` attend qu'un pod soit en cours d'exécution,
/// puis échoue en le disant : « unable to forward port because pod is not running. Current
/// status=Pending ». Si notre délai expirait le premier, on le tuerait avant qu'il ait écrit cette
/// phrase, et l'utilisateur lirait « n'a pas annoncé être prêt » — qui n'apprend rien alors que
/// `kubectl` savait. La marge est donc là pour lui **laisser le dernier mot**.
const MARGE_DU_POD: Duration = Duration::from_secs(5);

/// La fenêtre laissée à `kubectl` pour expliquer un échec de connexion déjà survenu.
///
/// Même valeur et même raison qu'en Cloud SQL : courte, parce qu'elle s'ajoute à une erreur que
/// l'utilisateur attend déjà, et que `kubectl` écrit sa ligne dans la foulée du refus.
const DELAI_EXPLICATION: Duration = Duration::from_millis(300);

/// Le temps laissé à `kubectl config current-context`.
///
/// L'appel ne touche pas le réseau — il lit le kubeconfig — donc il est immédiat en pratique. La
/// borne existe pour que l'ouverture ne puisse **jamais** être suspendue par ce qui n'est qu'un
/// en-tête de journal : le diagnostic ne doit pas coûter la connexion.
const DELAI_CONTEXTE: Duration = Duration::from_secs(3);

/// Le délai que reçoit `kubectl`, dérivé du nôtre.
///
/// Un plancher d'une seconde parce que la soustraction peut tout emporter : les tests raccourcissent
/// notre délai à 300 ms pour ne pas durer vingt secondes, et un `--pod-running-timeout=0s` serait
/// refusé par `kubectl`. Dans ce cas l'ordre s'inverse et c'est **voulu** — ces tests exercent
/// précisément notre propre expiration.
fn delai_du_pod(delai: Duration) -> Duration {
    delai
        .saturating_sub(MARGE_DU_POD)
        .max(Duration::from_secs(1))
}

/// Un transfert de port ouvert, et le port local sur lequel il écoute.
pub struct KubernetesProxy {
    sous: SousProcessus,
}

/// `Debug` à la main : même raison que pour `CloudSqlProxy` et `SshTunnel`. Le dérivé exposerait
/// l'état interne du `Child`, dont sa ligne de commande.
impl std::fmt::Debug for KubernetesProxy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "KubernetesProxy {{ port_local: {} }}",
            self.sous.port_local()
        )
    }
}

impl KubernetesProxy {
    /// Ouvre un transfert vers la ressource décrite par `proxy`.
    ///
    /// `port_cible` est le port sur lequel la base écoute **dans le pod** : il vient du champ
    /// « Port » de la connexion, comme pour le tunnel SSH.
    pub async fn ouvrir(
        proxy: &ProxyKubernetes,
        port_local_demande: Option<u16>,
        port_cible: u16,
    ) -> Result<Self, EngineError> {
        // **`localiser` d'abord, `controler` ensuite** — dans cet ordre, comme `CloudSqlProxy`
        // met `localiser` avant `identifiants::controler`. Sur un poste sans `kubectl` *et* sans
        // ressource saisie, les deux échecs sont vrais ; l'absence de l'outil est celle qui
        // bloquerait quand même après correction de l'autre, donc c'est elle qu'il faut lire en
        // premier. L'inverse coûterait deux allers-retours.
        //
        // `controler` vit dans `ouvrir_avec_delai`, où passent tous les chemins : le placer aussi
        // ici en ferait un contrôle écrit deux fois, dont l'un pourrait cesser d'être appelé sans
        // que rien le dise.
        let binaire = binaire::localiser()?;
        Self::ouvrir_avec(&binaire, proxy, port_local_demande, port_cible).await
    }

    /// La même chose, avec le binaire en paramètre.
    ///
    /// Séparée pour la même raison que `connect_via` l'est de `connect` en `06b` : les tests
    /// pilotent un faux `kubectl`, et n'ont pas le droit de dépendre de ce qui est installé sur la
    /// machine — ni de réussir *parce que* la machine de développement a un cluster.
    pub async fn ouvrir_avec(
        binaire: &Path,
        proxy: &ProxyKubernetes,
        port_local_demande: Option<u16>,
        port_cible: u16,
    ) -> Result<Self, EngineError> {
        Self::ouvrir_avec_delai(
            binaire,
            proxy,
            port_local_demande,
            port_cible,
            DELAI_DEMARRAGE,
        )
        .await
    }

    /// La même chose, avec le délai en paramètre — pour que le test du délai dure 300 ms et non
    /// vingt secondes.
    pub async fn ouvrir_avec_delai(
        binaire: &Path,
        proxy: &ProxyKubernetes,
        port_local_demande: Option<u16>,
        port_cible: u16,
        delai: Duration,
    ) -> Result<Self, EngineError> {
        controler(proxy, port_cible)?;
        let port_demande = port::choisir_port_libre(port_local_demande).await?;

        let mut commande = Command::new(binaire);
        commande.args(arguments(
            proxy,
            port_demande,
            port_cible,
            delai_du_pod(delai),
        ));
        // **Le `PATH` de l'enfant, et c'est la leçon du 31 août 2026.** `kubectl` cherche ses
        // *exec credential plugins* dans le `PATH` qu'il hérite de nous. Une app lancée depuis le
        // Finder lui transmettrait un `PATH` minimal, et l'échec serait « executable
        // gke-gcloud-auth-plugin not found » : un message qui accuse une installation correcte.
        // Le répertoire de `kubectl` est joint parce que ses compagnons y vivent le plus souvent.
        commande.env("PATH", programme::path_enrichi(&repertoire(binaire)));

        // L'en-tête du journal dit **quel contexte** a été employé, et s'il a été déclaré ou
        // deviné. C'est le compromis de `ProxyKubernetes::context` : un contexte optionnel laisse
        // la connexion suivre `kubectl config current-context`, donc ce qui est deviné doit être
        // dit — dans tout message d'échec, sans avoir à le redemander.
        let journal = Arc::new(Journal::avec_entete(entete(binaire, proxy).await));

        SousProcessus::ouvrir(commande, REPERES, port_demande, delai, journal, SUJET)
            .await
            .map(|sous| Self { sous })
            .map_err(|echec| traduire_l_echec(binaire, echec))
    }

    pub fn port_local(&self) -> u16 {
        self.sous.port_local()
    }

    /// L'identifiant du processus, pour les journaux et pour les tests de fermeture.
    pub fn identifiant(&self) -> Option<u32> {
        self.sous.identifiant()
    }

    /// Les dernières lignes écrites par `kubectl`.
    pub fn journal(&self) -> String {
        self.sous.journal()
    }

    /// L'état du transfert.
    pub fn etat(&self) -> EtatProxy {
        self.sous.etat()
    }

    /// Qualifie une erreur de connexion à la base selon l'état du transfert, **et selon ce que
    /// `kubectl` a dit de cet échec**.
    pub async fn qualifier(&self, erreur: EngineError) -> EngineError {
        self.qualifier_avec_delai(erreur, DELAI_EXPLICATION).await
    }

    /// La même chose, avec la fenêtre en paramètre — que les tests **allongent**, une fenêtre de
    /// production courte étant un compromis qu'un test garderait en mesurant la machine.
    pub async fn qualifier_avec_delai(&self, erreur: EngineError, delai: Duration) -> EngineError {
        self.sous
            .qualifier_avec_delai(erreur, delai, diagnostic::enrichir)
            .await
    }

    /// Tue `kubectl` et **attend** sa sortie, ce qui garantit que le port est rendu.
    pub async fn fermer(self) {
        self.sous.fermer().await;
    }
}

/// Une valeur de configuration utilisable, ou rien.
///
/// **Une chaîne vide ou blanche vaut absente**, côté Rust comme côté écran. L'écran envoie `null`,
/// mais un fichier écrit à la main peut porter `""` — et `--namespace ''` ferait chercher dans un
/// espace de noms qui n'existe pas, avec le message le moins utile possible. C'est la règle déjà
/// appliquée à `auth_database` en `18b`.
fn valeur_utile(valeur: &Option<String>) -> Option<&str> {
    valeur
        .as_deref()
        .map(str::trim)
        .filter(|texte| !texte.is_empty())
}

/// Refuse ce qui ne peut pas marcher, **avant** de lancer quoi que ce soit.
///
/// Même patron qu'`identifiants::controler` en `06i` : ce qui se voit sans rien lancer se dit sans
/// rien lancer, et attendre le délai de démarrage pour l'apprendre coûterait vingt secondes pour un
/// diagnostic qu'on avait déjà.
fn controler(proxy: &ProxyKubernetes, port_cible: u16) -> Result<(), EngineError> {
    if proxy.resource.trim().is_empty() {
        return Err(EngineError::local(
            "aucune ressource Kubernetes n'est déclarée pour cette connexion — nommez-la dans le \
             panneau « Proxy / tunnel », par exemple « svc/postgres » pour un service ou \
             « postgres-0 » pour un pod",
        ));
    }
    if port_cible == 0 {
        return Err(EngineError::local(
            "le port de la base est manquant — c'est celui sur lequel elle écoute *dans le pod*, \
             5432 pour PostgreSQL, et il se saisit dans le champ « Port »",
        ));
    }
    Ok(())
}

/// Les arguments passés à `kubectl`.
///
/// **En fonction libre, et c'est ce qui la rend vérifiable sans rien lancer.** Le test de la ligne
/// de commande de Cloud SQL passe par un faux binaire qui réécrit ses arguments — ce qui exerce le
/// chemin réel, mais ne peut constater que ce que le faux binaire a bien voulu répéter. Ici les
/// deux existent : celui-ci constate la liste que la production compose, et le faux binaire
/// constate qu'elle lui arrive.
///
/// L'ordre — les drapeaux, puis la ressource, puis les ports — est celui de la documentation de
/// `kubectl` ; il accepte l'inverse, mais un journal se lit mieux dans l'ordre attendu.
fn arguments(
    proxy: &ProxyKubernetes,
    port_local: u16,
    port_cible: u16,
    delai_du_pod: Duration,
) -> Vec<String> {
    let mut arguments = vec!["port-forward".to_owned()];

    // **Explicite plutôt que par défaut.** Le défaut de `kubectl` est `localhost`, qui résout vers
    // 127.0.0.1 *et* ::1 ; ce n'est pas un problème de sécurité, mais deux lignes « Forwarding
    // from » au lieu d'une, et une adresse qu'on n'a pas choisie. La règle du projet est la même
    // pour les trois proxys : une seule interface, la boucle locale, jamais toutes.
    arguments.push("--address".to_owned());
    arguments.push("127.0.0.1".to_owned());

    // Voir `MARGE_DU_POD` : ce délai est ce qui laisse `kubectl` nommer lui-même un pod qui n'est
    // pas prêt, au lieu d'être tué par le nôtre avant d'avoir pu le dire.
    arguments.push(format!("--pod-running-timeout={}s", delai_du_pod.as_secs()));

    // Le fichier d'abord : c'est lui qui *définit* le contexte courant, donc un lecteur du journal
    // lit les coordonnées dans l'ordre où elles se déterminent.
    if let Some(chemin) = kubeconfig(proxy) {
        arguments.push("--kubeconfig".to_owned());
        arguments.push(chemin.display().to_string());
    }
    if let Some(espace) = valeur_utile(&proxy.namespace) {
        arguments.push("--namespace".to_owned());
        arguments.push(espace.to_owned());
    }

    // La ressource **telle qu'elle a été saisie** : `kubectl` connaît ses types, nous non, et le
    // projet ne corrige aucune saisie. Un `svc/` ajouté d'office viserait un service là où
    // l'utilisateur nommait un pod.
    arguments.push(proxy.resource.trim().to_owned());
    arguments.push(format!("{port_local}:{port_cible}"));

    arguments
}

/// Le kubeconfig déclaré, développé, ou rien.
///
/// **Une valeur vide ou blanche vaut absente**, comme pour le contexte et l'espace de noms : un
/// `--kubeconfig ''` ferait échouer `kubectl` sur un fichier qui n'existe pas, avec le message le
/// moins utile possible. Et le `~/` de tête est développé, parce que nous passons un argv direct et
/// que rien ne le ferait à notre place — voir `programme::chemin_utilisateur`.
fn kubeconfig(proxy: &ProxyKubernetes) -> Option<PathBuf> {
    valeur_utile(&proxy.kubeconfig).map(programme::chemin_utilisateur)
}

/// Le répertoire de `kubectl`, en liste d'un élément pour `path_enrichi`.
fn repertoire(binaire: &Path) -> Vec<PathBuf> {
    binaire
        .parent()
        .map(Path::to_path_buf)
        .into_iter()
        .collect()
}

/// L'en-tête du journal : ce que **nous** savons du lancement et que `kubectl` n'écrit pas.
///
/// Les trois coordonnées y sont, et le contexte porte **comment il a été obtenu**. C'est ce qui
/// distingue « vous avez visé ce cluster » de « vous avez visé le cluster que votre kubeconfig
/// désignait à cet instant » — deux phrases très différentes devant une base de production.
async fn entete(binaire: &Path, proxy: &ProxyKubernetes) -> String {
    // Le contexte est **toujours** deviné depuis le kubeconfig — aucun champ ne le déclare —, donc
    // il est toujours lu et toujours dit. C'est ce qui reste de l'arbitrage de la première version.
    let contexte = match contexte_courant(binaire, proxy).await {
        Some(courant) => format!("« {courant} »"),
        // Ne pas savoir est un fait, et il se dit : un en-tête qui affirmerait un contexte qu'on
        // n'a pas lu serait pire que celui qui avoue.
        None => "illisible".to_owned(),
    };
    let espace =
        valeur_utile(&proxy.namespace).unwrap_or("celui de kubectl (« default » à défaut)");
    // **Le fichier n'est nommé que s'il est déclaré**, et son absence se dit par ce que `kubectl`
    // ferait : un en-tête qui affirmerait `~/.kube/config` supposerait que `$KUBECONFIG` est vide,
    // ce que nous ne lisons pas — et une app lancée depuis le Finder ne le verrait pas de toute
    // façon. Ne pas savoir est un fait, et il se dit.
    let fichier = match kubeconfig(proxy) {
        Some(chemin) => format!("kubeconfig « {} » (déclaré)", chemin.display()),
        None => "kubeconfig par défaut de kubectl".to_owned(),
    };
    format!(
        "kubectl ({}) — {fichier}, contexte courant {contexte}, espace de noms {espace}, \
         ressource « {} »",
        binaire.display(),
        proxy.resource.trim()
    )
}

/// Le contexte que `kubectl config current-context` désigne, s'il en désigne un.
///
/// **Un sous-processus de plus par ouverture, et c'est assumé** : l'appel lit le kubeconfig sans
/// toucher au réseau, donc il coûte quelques millisecondes, et il est borné par `DELAI_CONTEXTE`.
/// Ce qu'il achète est le seul remède au compromis de `ProxyKubernetes::context` — sans lui, un
/// échec sur le mauvais cluster ne dirait pas lequel.
async fn contexte_courant(binaire: &Path, proxy: &ProxyKubernetes) -> Option<String> {
    let mut commande = Command::new(binaire);
    // **Le même `--kubeconfig` que le transfert, et c'est indispensable** (31 août 2026). Sans lui,
    // cet appel lirait le fichier *par défaut* pendant que le transfert emploie celui qui est
    // déclaré : l'en-tête nommerait un contexte venu d'un autre fichier — donc affirmerait, avec
    // aplomb, un cluster qui n'est pas celui qu'on vise. Un en-tête faux est pire que pas d'en-tête,
    // puisque c'est lui qu'on croit en cherchant pourquoi une connexion a échoué.
    if let Some(chemin) = kubeconfig(proxy) {
        commande.arg("--kubeconfig").arg(chemin);
    }
    commande
        .arg("config")
        .arg("current-context")
        .env("PATH", programme::path_enrichi(&repertoire(binaire)))
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);

    let sortie = tokio::time::timeout(DELAI_CONTEXTE, commande.output())
        .await
        .ok()?
        .ok()?;
    if !sortie.status.success() {
        return None;
    }
    let texte = String::from_utf8_lossy(&sortie.stdout).trim().to_owned();
    (!texte.is_empty()).then_some(texte)
}

/// Met des mots Kubernetes sur un échec d'ouverture.
///
/// **Fonction libre, hors de l'`impl`** : elle est appelée dans un `map_err` où `Self` n'existe pas
/// encore. Et c'est la moitié du contrat avec `sous_processus` — celui-ci dit *ce qui* s'est passé,
/// celle-ci dit *avec quoi* et *ce que l'utilisateur doit regarder*.
///
/// Les deux échecs de lecture passent par `diagnostic::enrichir` : ils sont les deux moments où
/// `kubectl` a pu écrire une raison reconnaissable. Enrichi quand c'est le cas, **intact** sinon.
fn traduire_l_echec(binaire: &Path, echec: EchecDeLancement) -> EngineError {
    match echec {
        // **Le chemin est nommé, et ce n'est pas du détail.** L'outil peut venir du `PATH`, de
        // Homebrew, de Rancher Desktop ou du SDK Google : savoir *lequel* n'a pas pu être lancé est
        // la première question devant un « Exec format error » ou un droit manquant. Même raison
        // qu'en `06h` pour l'en-tête du journal de Cloud SQL.
        EchecDeLancement::Lancement(erreur) => EngineError::local(format!(
            "kubectl ({}) n'a pas pu être lancé ({erreur})",
            binaire.display()
        )),
        EchecDeLancement::SortieIllisible { flux } => {
            EngineError::local(format!("{flux} de kubectl est illisible"))
        }
        EchecDeLancement::MortAvantPret { dit } => EngineError::local(diagnostic::enrichir(
            format!("kubectl s'est arrêté avant d'ouvrir le transfert de port : {dit}"),
            &dit,
        )),
        EchecDeLancement::Delai { delai, dit } => EngineError::local(diagnostic::enrichir(
            format!(
                "kubectl n'a pas annoncé écouter dans le délai de {} s — ce qu'il a écrit : {dit}",
                delai.as_secs().max(1)
            ),
            &dit,
        )),
    }
}

#[cfg(test)]
mod tests_arguments {
    use super::*;

    fn configuration() -> ProxyKubernetes {
        ProxyKubernetes {
            kubeconfig: None,
            namespace: None,
            resource: "svc/postgres".into(),
        }
    }

    /// Les arguments, en une chaîne, pour des assertions lisibles.
    fn ligne(proxy: &ProxyKubernetes) -> String {
        arguments(proxy, 63342, 5432, Duration::from_secs(15)).join(" ")
    }

    #[test]
    fn la_ligne_minimale_porte_la_ressource_et_le_couple_de_ports() {
        let ligne = ligne(&configuration());
        assert!(ligne.starts_with("port-forward "), "{ligne}");
        assert!(ligne.contains("svc/postgres"), "{ligne}");
        // **Le couple, dans cet ordre.** L'inverser ferait écouter localement sur le port du pod
        // et transférer vers un port choisi au hasard : la connexion échouerait sans que rien ne
        // dise pourquoi, et le décor doit distinguer les deux — deux nombres différents.
        assert!(ligne.contains("63342:5432"), "{ligne}");
        assert!(!ligne.contains("5432:63342"), "{ligne}");
    }

    #[test]
    fn l_ecoute_est_limitee_a_la_boucle_locale() {
        // La règle des trois proxys : jamais toutes les interfaces. Sans ce drapeau, `kubectl`
        // écoute sur `localhost`, donc aussi en IPv6 — une adresse qu'on n'a pas choisie.
        assert!(ligne(&configuration()).contains("--address 127.0.0.1"));
    }

    #[test]
    fn le_delai_du_pod_est_passe_et_reste_sous_le_notre() {
        // **La garantie de `MARGE_DU_POD`, mesurée sur les valeurs de production.** Si l'ordre
        // s'inversait, `kubectl` serait tué avant d'avoir écrit « pod is not running », et
        // l'utilisateur lirait un « délai dépassé » qui n'apprend rien.
        assert!(
            delai_du_pod(DELAI_DEMARRAGE) < DELAI_DEMARRAGE,
            "{:?} doit rester sous {:?}",
            delai_du_pod(DELAI_DEMARRAGE),
            DELAI_DEMARRAGE
        );
        assert!(ligne(&configuration()).contains("--pod-running-timeout=15s"));
        // Et jamais zéro, que `kubectl` refuse : c'est le cas des tests, qui raccourcissent le
        // délai à quelques centaines de millisecondes.
        assert_eq!(
            delai_du_pod(Duration::from_millis(300)),
            Duration::from_secs(1)
        );
    }

    #[test]
    fn un_espace_de_noms_declare_est_passe() {
        let proxy = ProxyKubernetes {
            kubeconfig: None,
            namespace: Some("bases".into()),
            resource: "svc/postgres".into(),
        };
        assert!(
            ligne(&proxy).contains("--namespace bases"),
            "{}",
            ligne(&proxy)
        );
    }

    #[test]
    fn un_kubeconfig_declare_est_passe_et_aucun_contexte_ne_l_est() {
        let proxy = ProxyKubernetes {
            kubeconfig: Some("/etc/kubeconfig-prod".into()),
            namespace: None,
            resource: "svc/postgres".into(),
        };
        let ligne = ligne(&proxy);
        assert!(
            ligne.contains("--kubeconfig /etc/kubeconfig-prod"),
            "{ligne}"
        );
        // **Aucun `--context`, jamais** : le contexte vient du kubeconfig, il ne se déclare pas.
        // Vérifié en négatif parce qu'un champ retiré revient plus facilement qu'il n'est parti.
        assert!(!ligne.contains("--context"), "{ligne}");
    }

    #[test]
    fn un_kubeconfig_en_tilde_est_developpe() {
        // **Nous passons un argv direct, jamais un shell** : un `~/` littéral ferait chercher un
        // répertoire nommé « ~ », et l'échec — « no such file or directory » — accuserait un chemin
        // correct. C'est le seul développement que le projet s'autorise sur une saisie.
        let Some(maison) = std::env::var_os("HOME").map(std::path::PathBuf::from) else {
            return;
        };
        let proxy = ProxyKubernetes {
            kubeconfig: Some("~/.kube/prod".into()),
            namespace: None,
            resource: "svc/postgres".into(),
        };
        let ligne = ligne(&proxy);
        assert!(
            ligne.contains(&maison.join(".kube/prod").display().to_string()),
            "{ligne}"
        );
        assert!(!ligne.contains("~/"), "{ligne}");
    }

    #[test]
    fn une_valeur_blanche_vaut_absente_et_ne_passe_aucun_drapeau() {
        // **Le cas du fichier écrit à la main.** L'écran envoie `null`, mais `""` est représentable
        // — et `--namespace ''` ferait chercher dans un espace de noms qui n'existe pas, avec le
        // message le moins utile possible. Même règle qu'`auth_database` en `18b`.
        let proxy = ProxyKubernetes {
            kubeconfig: Some("  ".into()),
            namespace: Some(String::new()),
            resource: "  svc/postgres  ".into(),
        };
        let ligne = ligne(&proxy);
        assert!(!ligne.contains("--kubeconfig"), "{ligne}");
        assert!(!ligne.contains("--context"), "{ligne}");
        assert!(!ligne.contains("--namespace"), "{ligne}");
        // Et la ressource est **rognée**, sans l'être « corrigée » : un espace de tête vient d'un
        // copier-coller, pas d'une intention.
        assert!(ligne.contains(" svc/postgres 63342:5432"), "{ligne}");
    }

    #[test]
    fn la_ressource_n_est_jamais_reecrite() {
        // `kubectl` connaît ses types, nous non. Ajouter `svc/` d'office viserait un service là
        // où l'utilisateur nommait un pod — et la liste des types accepté grandit sans nous.
        for saisie in [
            "postgres-0",
            "pod/postgres-0",
            "statefulset/postgres",
            "svc/pg",
        ] {
            let proxy = ProxyKubernetes {
                kubeconfig: None,
                namespace: None,
                resource: saisie.into(),
            };
            let arguments = arguments(&proxy, 63342, 5432, Duration::from_secs(15));
            assert!(
                arguments.contains(&saisie.to_owned()),
                "{saisie} : {arguments:?}"
            );
        }
    }

    #[test]
    fn une_ressource_vide_est_refusee_avant_tout_lancement() {
        let proxy = ProxyKubernetes {
            kubeconfig: None,
            namespace: None,
            resource: "   ".into(),
        };
        let erreur = controler(&proxy, 5432).expect_err("une ressource vide doit être refusée");
        // Le message doit nommer **ce qu'il faut taper**, pas la syntaxe de `kubectl` : celui-ci
        // répondrait « TYPE/NAME and list of ports are required for port-forward ».
        assert!(erreur.message.contains("svc/postgres"), "{erreur}");
    }

    #[test]
    fn un_port_nul_est_refuse_et_nomme_le_champ() {
        // `A2` envoie 0 quand la saisie n'est pas un nombre (voir `draftToRequest`). `kubectl`
        // dirait « invalid port », qui ne dit pas où le corriger.
        let erreur = controler(&configuration(), 0).expect_err("un port nul doit être refusé");
        assert!(erreur.message.contains("Port"), "{erreur}");
        assert!(erreur.message.contains("pod"), "{erreur}");
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    /// Le préambule de tout faux `kubectl` : répondre à `config current-context`.
    ///
    /// **Il est dans *tous* les faux binaires, et ce n'est pas de la commodité.** `ouvrir` appelle
    /// `kubectl config current-context` pour l'en-tête du journal ; un faux qui l'ignorerait
    /// prendrait sa propre ligne « Forwarding from… » pour un nom de contexte, et l'en-tête serait
    /// du bruit. Le décor doit répondre aux **deux** appels que la production fait, sinon il ne
    /// mesure que celui auquel on a pensé.
    /// **Et il répond *différemment* selon qu'un `--kubeconfig` lui est passé.** C'est ce qui rend
    /// mesurable la seule chose qui compte ici : que la lecture du contexte courant emploie le
    /// **même** fichier que le transfert. Un faux binaire qui rendrait toujours le même nom
    /// laisserait passer un en-tête lu dans le fichier par défaut — donc un en-tête qui nomme un
    /// cluster avec aplomb sans être celui qu'on vise.
    const PREAMBULE: &str = r#"#!/bin/sh
if [ "$1" = "config" ] || [ "$3" = "config" ]; then
  case "$*" in
    *--kubeconfig*) echo "contexte-du-fichier-declare" ;;
    *) echo "contexte-devine" ;;
  esac
  exit 0
fi
for argument in "$@"; do dernier="$argument"; done
"#;

    /// Écrit un faux `kubectl` exécutable, et le rend.
    ///
    /// **Le fichier est écrit par un sous-processus, et ce détour corrige une panne de CI** —
    /// exactement celle du 26 août 2026 sur `cloudsql`, dont le commentaire porte le détail.
    /// `std::fs::write` ouvre le fichier en écriture dans **notre** processus ; les tests tournant
    /// en parallèle, le `fork` qu'un autre fil fait avant son `exec` duplique ce descripteur dans
    /// l'enfant, et Linux refuse d'exécuter un fichier qu'un processus tient ouvert en écriture
    /// (`ETXTBSY`). Écrit par `cp`, le descripteur n'existe jamais chez nous.
    fn faux_kubectl(nom: &str, corps: &str) -> std::path::PathBuf {
        let base =
            std::env::temp_dir().join(format!("dorabase-kubectl-{nom}-{}", std::process::id()));
        std::fs::create_dir_all(&base).expect("répertoire");
        let source = base.join("source");
        let chemin = base.join("kubectl");
        std::fs::write(&source, format!("{PREAMBULE}{corps}")).expect("écriture de la source");

        let statut = std::process::Command::new("sh")
            .arg("-c")
            .arg(r#"cp "$1" "$2" && chmod 755 "$2""#)
            .arg("sh")
            .arg(&source)
            .arg(&chemin)
            .status()
            .expect("installation du faux binaire");
        assert!(statut.success(), "installation du faux binaire : {statut}");
        chemin
    }

    /// Un `kubectl` qui annonce le port local reçu et vit jusqu'à ce qu'on le tue.
    ///
    /// Le dernier argument est `local:distant`, d'où la découpe : le décor **relit** ce que la
    /// production lui a passé plutôt que de porter un numéro en dur, ce qui rendrait le test
    /// insensible à une inversion du couple.
    const HEUREUX: &str = r#"echo "Forwarding from 127.0.0.1:${dernier%%:*} -> ${dernier##*:}"
while true; do sleep 1; done
"#;

    fn configuration() -> ProxyKubernetes {
        ProxyKubernetes {
            kubeconfig: None,
            namespace: None,
            resource: "svc/postgres".into(),
        }
    }

    /// Attend qu'une ligne apparaisse dans le journal, ou échoue en le disant.
    ///
    /// **Une condition et une borne large**, jamais un `sleep` calibré : un test qui dort le temps
    /// qu'il croit nécessaire mesure la charge de la machine, et il passe chez celui qui l'écrit
    /// avant de tomber ailleurs (défaut n° 112).
    async fn attendre_dans_le_journal(proxy: &KubernetesProxy, motif: &str) {
        let echeance = tokio::time::Instant::now() + Duration::from_secs(10);
        while tokio::time::Instant::now() < echeance {
            if proxy.journal().contains(motif) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!(
            "« {motif} » n'est pas arrivé dans le journal : {}",
            proxy.journal()
        );
    }

    #[tokio::test]
    async fn un_transfert_qui_annonce_son_port_est_pret_et_rend_ce_port() {
        let binaire = faux_kubectl("heureux", HEUREUX);
        let proxy = KubernetesProxy::ouvrir_avec(&binaire, &configuration(), None, 5432)
            .await
            .expect("le transfert doit s'ouvrir");

        assert_ne!(proxy.port_local(), 0);
        assert_eq!(proxy.etat(), EtatProxy::Vivant);
        proxy.fermer().await;
    }

    #[tokio::test]
    async fn le_port_rendu_est_celui_annonce_et_non_celui_demande() {
        // **Même critère qu'`06g`.** C'est `kubectl` qui se lie ; ce qu'il annonce fait foi. Croire
        // au port demandé produirait une connexion vers le vide le jour où il en choisit un autre.
        let menteur = faux_kubectl(
            "menteur",
            r#"echo "Forwarding from 127.0.0.1:65010 -> 5432"
while true; do sleep 1; done
"#,
        );
        let proxy = KubernetesProxy::ouvrir_avec(&menteur, &configuration(), None, 5432)
            .await
            .expect("ouverture");
        assert_eq!(proxy.port_local(), 65010);
        proxy.fermer().await;
    }

    #[tokio::test]
    async fn un_kubectl_qui_meurt_avant_d_ouvrir_remonte_son_message_et_la_manoeuvre() {
        let mourant = faux_kubectl(
            "mourant",
            r#"echo 'Error from server (NotFound): pods "postgres" not found' >&2
exit 1
"#,
        );
        let erreur = KubernetesProxy::ouvrir_avec(&mourant, &configuration(), None, 5432)
            .await
            .expect_err("un kubectl mort ne doit pas passer pour ouvert");

        // Ce que `kubectl` a dit, **pas** « délai dépassé » : chaque échec a son message précis, et
        // l'écraser rendrait le diagnostic impossible.
        assert!(erreur.message.contains("not found"), "{erreur}");
        assert!(!erreur.message.contains("délai"), "{erreur}");
        // Et la manœuvre s'y joint : qu'un nom nu soit lu comme un pod n'est pas devinable.
        assert!(erreur.message.contains("svc/"), "{erreur}");
    }

    #[tokio::test]
    async fn une_ressource_vide_est_refusee_par_le_chemin_reel_avant_tout_lancement() {
        // **Ce test manquait, et son absence était exactement le défaut n° 16** : `controler` avait
        // ses propres tests — qui l'appellent directement — donc le retirer d'`ouvrir_avec_delai`,
        // c'est-à-dire du seul chemin que la production emprunte, laissait la suite **verte**
        // (mesuré par sabotage le 31 août 2026). Une garantie vérifiée sur la fonction et non sur
        // son site d'appel ne garantit rien du produit.
        //
        // Le binaire est un chemin qui n'existe pas, et c'est ce qui rend le test discriminant :
        // sans le contrôle, l'échec serait « n'a pas pu être lancé » et non le refus qu'on exige.
        let nulle_part = std::path::PathBuf::from("/nulle-part-du-tout/kubectl");
        let proxy = ProxyKubernetes {
            kubeconfig: None,
            namespace: None,
            resource: "   ".into(),
        };

        let erreur = KubernetesProxy::ouvrir_avec(&nulle_part, &proxy, None, 5432)
            .await
            .expect_err("une ressource vide doit être refusée");
        assert!(erreur.message.contains("svc/postgres"), "{erreur}");
        assert!(!erreur.message.contains("lancé"), "{erreur}");

        // Et le port nul par le même chemin : `A2` envoie 0 quand la saisie n'est pas un nombre.
        let erreur = KubernetesProxy::ouvrir_avec(&nulle_part, &configuration(), None, 0)
            .await
            .expect_err("un port nul doit être refusé");
        assert!(erreur.message.contains("Port"), "{erreur}");
        assert!(!erreur.message.contains("lancé"), "{erreur}");
    }

    #[tokio::test]
    async fn un_kubectl_muet_echoue_sur_le_delai_sans_pendre() {
        let muet = faux_kubectl("muet", "while true; do sleep 1; done\n");
        let erreur = KubernetesProxy::ouvrir_avec_delai(
            &muet,
            &configuration(),
            None,
            5432,
            Duration::from_millis(300),
        )
        .await
        .expect_err("un kubectl qui n'annonce rien doit échouer");

        assert!(erreur.message.contains("délai"), "{erreur}");
        assert!(erreur.message.contains("kubectl"), "{erreur}");
    }

    #[tokio::test]
    async fn fermer_tue_le_processus_et_libere_le_port() {
        let binaire = faux_kubectl("fermeture", HEUREUX);
        let proxy = KubernetesProxy::ouvrir_avec(&binaire, &configuration(), None, 5432)
            .await
            .expect("ouverture");
        let pid = proxy.identifiant().expect("le pid doit être connu");

        proxy.fermer().await;

        // **Vérifié par le pid, pas par le port.** Un `kubectl` orphelin est le pire défaut
        // possible ici : il garde le port, et la connexion suivante croirait parler à son propre
        // transfert en parlant à celui d'avant.
        let vivant = std::process::Command::new("ps")
            .args(["-p", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .status()
            .expect("ps");
        assert!(!vivant.success(), "le processus {pid} est encore vivant");
    }

    #[tokio::test]
    async fn un_transfert_mort_apres_l_ouverture_est_signale_comme_tel() {
        let bref = faux_kubectl(
            "bref",
            r#"echo "Forwarding from 127.0.0.1:65011 -> 5432"
sleep 0.1
echo "error: lost connection to pod" >&2
exit 1
"#,
        );
        let proxy = KubernetesProxy::ouvrir_avec(&bref, &configuration(), None, 5432)
            .await
            .expect("ouverture");

        attendre_dans_le_journal(&proxy, "lost connection").await;
        // L'état est interrogé **après** que la ligne est arrivée : une lecture sèche daterait la
        // mesure du mauvais instant (défaut n° 112).
        let echeance = tokio::time::Instant::now() + Duration::from_secs(10);
        while proxy.etat() == EtatProxy::Vivant && tokio::time::Instant::now() < echeance {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(
            matches!(proxy.etat(), EtatProxy::Tombe { .. }),
            "{:?}",
            proxy.etat()
        );

        let qualifiee = proxy
            .qualifier_avec_delai(
                EngineError::local("connection refused"),
                Duration::from_secs(10),
            )
            .await;
        // Le sujet vient de la constante que la production emploie ; que son contenu nomme bien
        // Kubernetes est vérifié dans `engine/proxy.rs`, comme pour les deux autres sortes.
        assert!(qualifiee.message.contains(SUJET), "{qualifiee}");
        proxy.fermer().await;
    }

    #[tokio::test]
    async fn un_transfert_vivant_qui_a_perdu_le_pod_joint_ce_qu_il_a_dit() {
        // **Le défaut propre à `kubectl`** : il **reste vivant** quand le transfert casse. `etat()`
        // ne voit donc qu'un processus en bonne santé, et l'erreur du pilote — « connection reset »
        // — n'apprend rien. C'est le jumeau du défaut Cloud SQL du 24 août 2026.
        let survivant = faux_kubectl(
            "survivant",
            r#"echo "Forwarding from 127.0.0.1:${dernier%%:*} -> ${dernier##*:}"
sleep 0.2
echo "E0831 10:00:00.000000 1 portforward.go:409] an error occurred forwarding: lost connection to pod" >&2
while true; do sleep 1; done
"#,
        );
        let proxy = KubernetesProxy::ouvrir_avec(&survivant, &configuration(), None, 5432)
            .await
            .expect("ouverture");

        // **Une borne large, pas la fenêtre de production** (défaut n° 112) : la boucle rend la
        // main dès que `kubectl` a parlé, donc la borne ne coûte rien quand tout va bien.
        let qualifiee = proxy
            .qualifier_avec_delai(
                EngineError::local("connection reset by peer"),
                Duration::from_secs(10),
            )
            .await;

        // Le processus est **vivant** : ce n'est pas la qualification « est tombé » d'`06e`.
        assert_eq!(proxy.etat(), EtatProxy::Vivant);
        // L'erreur observée reste lisible — ajouter, jamais substituer.
        assert!(
            qualifiee.message.contains("connection reset"),
            "{qualifiee}"
        );
        // Ce que `kubectl` a dit s'y joint…
        assert!(qualifiee.message.contains("lost connection"), "{qualifiee}");
        // …et la manœuvre avec, qui dit ce qu'un nom de pod a de fragile.
        assert!(qualifiee.message.contains("svc/"), "{qualifiee}");
        proxy.fermer().await;
    }

    #[tokio::test]
    async fn un_transfert_qui_n_a_rien_a_dire_laisse_l_erreur_intacte() {
        // La fenêtre d'explication ne doit pas transformer un échec ordinaire — base inexistante,
        // mot de passe faux — en un message qui accuse le transfert.
        let binaire = faux_kubectl("muet-mais-vivant", HEUREUX);
        let proxy = KubernetesProxy::ouvrir_avec(&binaire, &configuration(), None, 5432)
            .await
            .expect("ouverture");

        let erreur = EngineError::from_engine("28P01", "password authentication failed");
        let qualifiee = proxy
            .qualifier_avec_delai(erreur.clone(), Duration::from_millis(50))
            .await;

        assert_eq!(qualifiee.message, erreur.message);
        // Le code SQLSTATE survit aussi : le reconstruire en `local` le perdrait, et `A3` s'en
        // sert pour distinguer « mot de passe refusé » de « base inconnue ».
        assert_eq!(qualifiee.code, erreur.code);
        proxy.fermer().await;
    }

    #[tokio::test]
    async fn les_arguments_composes_arrivent_bien_au_binaire() {
        // **Le complément du test de `tests_arguments`.** Celui-là constate la liste que la
        // production compose ; celui-ci constate qu'elle arrive au programme — un `args()`
        // construit puis jamais passé satisferait le premier seul.
        let mouchard = faux_kubectl(
            "mouchard",
            r#"echo "args: $*"
echo "Forwarding from 127.0.0.1:${dernier%%:*} -> ${dernier##*:}"
while true; do sleep 1; done
"#,
        );
        let proxy = ProxyKubernetes {
            kubeconfig: None,
            namespace: Some("bases".into()),
            resource: "svc/postgres".into(),
        };
        let ouvert = KubernetesProxy::ouvrir_avec(&mouchard, &proxy, None, 5432)
            .await
            .expect("ouverture");
        let journal = ouvert.journal();
        let port_local = ouvert.port_local();
        ouvert.fermer().await;

        let arguments = journal
            .split("args: ")
            .nth(1)
            .and_then(|reste| reste.split(" / ").next())
            .expect("la ligne des arguments")
            .to_owned();

        assert!(arguments.starts_with("port-forward "), "{arguments}");
        assert!(arguments.contains("--namespace bases"), "{arguments}");
        // Et aucun contexte : il vient du kubeconfig, jamais de la connexion.
        assert!(!arguments.contains("--context"), "{arguments}");
        assert!(arguments.contains("--address 127.0.0.1"), "{arguments}");
        // Le couple de ports, **avec le port local réellement retenu** : un test qui n'en
        // vérifierait que la forme passerait aussi sur `0:5432`.
        assert!(
            arguments.contains(&format!("svc/postgres {port_local}:5432")),
            "{arguments}"
        );
    }

    #[tokio::test]
    async fn le_path_donne_a_kubectl_porte_les_emplacements_usuels() {
        // **La leçon du 31 août 2026, mesurée sur le chemin réel.** `kubectl` cherche ses *exec
        // credential plugins* dans le `PATH` qu'il hérite de nous ; une app lancée depuis le Finder
        // lui en transmettrait un minimal, et l'échec serait « executable gke-gcloud-auth-plugin
        // not found » — un message qui accuse une installation correcte. Le test de `programme`
        // vérifie la fonction ; celui-ci vérifie qu'elle est **branchée**.
        let bavard = faux_kubectl(
            "bavard-path",
            r#"echo "path: $PATH"
echo "Forwarding from 127.0.0.1:${dernier%%:*} -> ${dernier##*:}"
while true; do sleep 1; done
"#,
        );
        let proxy = KubernetesProxy::ouvrir_avec(&bavard, &configuration(), None, 5432)
            .await
            .expect("ouverture");
        let journal = proxy.journal();
        proxy.fermer().await;

        // **Isolé du reste du journal, et c'est ce qui a corrigé ce test.** Écrit d'abord sur le
        // journal entier, il restait **vert sous sabotage** — retirer le `commande.env("PATH", …)`
        // ne le faisait pas tomber (mesuré le 31 août 2026). Deux raisons se cumulaient : l'en-tête
        // du journal porte le chemin du binaire, donc `contains(répertoire)` était satisfait par
        // l'en-tête et non par le `PATH` ; et le `PATH` de cette machine contient déjà Homebrew,
        // donc l'enfant l'aurait hérité de toute façon. Le test mesurait la machine, pas le code.
        let ligne_de_path = journal
            .split("path: ")
            .nth(1)
            .and_then(|reste| reste.split(" / ").next())
            .expect("la ligne du PATH")
            .to_owned();
        let dossiers: Vec<std::path::PathBuf> = std::env::split_paths(&ligne_de_path).collect();

        // **L'assertion qui mord** : le répertoire du faux binaire est dans `/tmp`, donc il ne peut
        // *pas* venir du `PATH` hérité. C'est la seule qui distingue « nous l'avons enrichi » de
        // « la machine l'avait déjà ». Le répertoire du binaire est joint parce que les compagnons
        // d'un outil — ses plugins d'authentification — y vivent le plus souvent.
        let repertoire = bavard.parent().expect("parent").to_path_buf();
        assert!(
            dossiers.contains(&repertoire),
            "{repertoire:?} absent de {dossiers:?}"
        );
        // Et les emplacements usuels y sont — assertion qui, elle, ne peut mordre que sur un poste
        // dont le `PATH` en est dépourvu : celui d'une app lancée depuis le Finder, précisément le
        // cas que cet enrichissement vise.
        // Le chemin **développé**, et pas le littéral de la constante (4 septembre 2026) : la
        // liste Linux porte `~/.local/bin`, que `path_enrichi` développe. Un `PATH` qui
        // transmettrait ce littéral à l'enfant ne lui désignerait rien — c'est le défaut à quatre
        // exemplaires du 31 août, ici sur son cinquième.
        for usuel in programme::EMPLACEMENTS_USUELS {
            let attendu = programme::chemin_utilisateur(usuel);
            assert!(
                dossiers.contains(&attendu),
                "{} absent de {dossiers:?}",
                attendu.display()
            );
        }
    }

    #[tokio::test]
    async fn l_entete_dit_quel_contexte_a_ete_devine() {
        // **Le remède au compromis de `ProxyKubernetes::context`.** Laissé vide, le contexte suit
        // `kubectl config current-context` — donc ce qui est deviné doit être **dit**, dans tout
        // message d'échec, sans avoir à le redemander.
        let binaire = faux_kubectl("entete-devinee", HEUREUX);
        let proxy = KubernetesProxy::ouvrir_avec(&binaire, &configuration(), None, 5432)
            .await
            .expect("ouverture");
        let journal = proxy.journal();
        proxy.fermer().await;

        assert!(journal.contains("contexte-devine"), "{journal}");
        // Et il est annoncé **courant** : aucun champ ne le déclare, donc l'en-tête doit dire d'où
        // il vient — sinon on croirait que la connexion le porte, alors qu'elle suivra le kubeconfig
        // au prochain changement.
        assert!(journal.contains("contexte courant"), "{journal}");
        // Les deux autres coordonnées y sont aussi : un échec doit pouvoir se rejouer à la main.
        assert!(journal.contains("svc/postgres"), "{journal}");
        // L'espace de noms non déclaré s'annonce par ce que `kubectl` ferait, « default » compris :
        // c'est ce que l'écran promet dans son placeholder, et les deux doivent dire la même chose.
        assert!(journal.contains("default"), "{journal}");
    }

    #[tokio::test]
    async fn le_contexte_courant_est_lu_dans_le_kubeconfig_declare() {
        // **Le défaut que ce test empêche, et il est vicieux.** Avec un kubeconfig déclaré et aucun
        // contexte, l'en-tête doit nommer le contexte courant *de ce fichier-là*. Si l'appel
        // `kubectl config current-context` oubliait le `--kubeconfig`, il lirait le fichier par
        // défaut : l'en-tête annoncerait un cluster — avec aplomb, et faux — pendant que le
        // transfert en viserait un autre. Un en-tête faux est pire que pas d'en-tête, puisque c'est
        // lui qu'on croit en cherchant pourquoi une connexion a échoué.
        //
        // Le faux binaire répond « contexte-du-fichier-declare » **si et seulement si** on lui
        // passe `--kubeconfig` : c'est ce qui rend l'assertion discriminante.
        let binaire = faux_kubectl("kubeconfig-declare", HEUREUX);
        let proxy = ProxyKubernetes {
            kubeconfig: Some("/etc/kubeconfig-prod".into()),
            namespace: None,
            resource: "svc/postgres".into(),
        };
        let ouvert = KubernetesProxy::ouvrir_avec(&binaire, &proxy, None, 5432)
            .await
            .expect("ouverture");
        let journal = ouvert.journal();
        ouvert.fermer().await;

        assert!(journal.contains("contexte-du-fichier-declare"), "{journal}");
        assert!(!journal.contains("contexte-devine"), "{journal}");
        // Et le fichier est nommé dans l'en-tête : un échec doit pouvoir se rejouer à la main.
        assert!(
            journal.contains("kubeconfig « /etc/kubeconfig-prod » (déclaré)"),
            "{journal}"
        );
    }

    #[tokio::test]
    async fn sans_kubeconfig_declare_l_entete_dit_le_defaut_de_kubectl() {
        // Le contrôle négatif du test précédent. **L'en-tête ne doit pas affirmer
        // `~/.kube/config`** : ce serait supposer `$KUBECONFIG` vide, ce que nous ne lisons pas — et
        // une app lancée depuis le Finder ne le verrait pas de toute façon. Ne pas savoir est un
        // fait, et il se dit.
        let binaire = faux_kubectl("kubeconfig-defaut", HEUREUX);
        let proxy = KubernetesProxy::ouvrir_avec(&binaire, &configuration(), None, 5432)
            .await
            .expect("ouverture");
        let journal = proxy.journal();
        proxy.fermer().await;

        assert!(
            journal.contains("kubeconfig par défaut de kubectl"),
            "{journal}"
        );
        assert!(!journal.contains(".kube/config"), "{journal}");
        assert!(journal.contains("contexte-devine"), "{journal}");
    }

    #[tokio::test]
    async fn l_espace_de_noms_declare_paraît_dans_l_entete_a_la_place_du_defaut() {
        // Le pendant du test précédent : quand l'espace de noms est saisi, l'en-tête doit le nommer
        // lui et **non** le repli. Sans cette moitié, « l'en-tête dit le défaut » passerait aussi si
        // l'en-tête disait *toujours* le défaut.
        let binaire = faux_kubectl("entete-espace", HEUREUX);
        let proxy = ProxyKubernetes {
            kubeconfig: None,
            namespace: Some("bases".into()),
            resource: "pod/postgres-0".into(),
        };
        let ouvert = KubernetesProxy::ouvrir_avec(&binaire, &proxy, None, 5432)
            .await
            .expect("ouverture");
        let journal = ouvert.journal();
        ouvert.fermer().await;

        assert!(journal.contains("espace de noms bases"), "{journal}");
        assert!(!journal.contains("default"), "{journal}");
        // Le contexte, lui, est toujours deviné : aucun champ ne le déclare.
        assert!(
            journal.contains("contexte courant « contexte-devine »"),
            "{journal}"
        );
    }
}
