//! Ce qui est commun aux deux sortes de proxy : un aiguillage unique.
//!
//! **Extrait de `tunnel/mod.rs`.** Le tunnel SSH avait déjà nommé `Surveillance` pour la
//! rendre testable ; le proxy Cloud SQL a le même besoin, avec une mécanique de
//! détection différente — la sortie d'un processus au lieu de la chute d'une session SSH.
//! Le patron est partagé, l'implémentation non.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::engine::EngineError;

/// L'état d'un proxy ouvert.
///
/// **Pourquoi ce type existe** : `06e` insiste, et le handoff avec lui (`A3` affiche
/// « tunnel aborted · pg connect skipped » sur deux lignes distinctes). Si le bastion tombe
/// — ou si le proxy Cloud SQL meurt —, la connexion PostgreSQL échoue avec une erreur
/// réseau qui ne dit rien du proxy, et l'utilisateur cherche un problème de base là où le
/// proxy est en cause.
///
/// Nommé `EtatProxy` et non `EtatTunnel` depuis `06g` : il décrit désormais les deux sortes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EtatProxy {
    Vivant,
    /// Le proxy est tombé. La raison est destinée à l'affichage.
    Tombe {
        raison: String,
    },
}

/// La santé d'un proxy, partagée entre lui et la tâche qui le surveille.
///
/// **Type nommé pour être testable.** La première version de `06e` gardait le drapeau et la
/// raison en champs de `SshTunnel`, et le test reconstituait la lecture d'`etat()` dans une
/// fonction d'appoint — il testait donc une copie de la logique, pas la logique.
#[derive(Debug, Default)]
pub struct Surveillance {
    tombe: AtomicBool,
    raison: Mutex<Option<String>>,
}

impl Surveillance {
    pub fn noter_chute(&self, cause: String) {
        if let Ok(mut g) = self.raison.lock() {
            *g = Some(cause);
        }
        // Posé **après** la raison : `etat` lit le drapeau d'abord, donc l'inverse laisserait
        // une fenêtre où le proxy est signalé tombé sans raison disponible.
        self.tombe.store(true, Ordering::Relaxed);
    }

    pub fn etat(&self, defaut: &str) -> EtatProxy {
        if self.tombe.load(Ordering::Relaxed) {
            EtatProxy::Tombe {
                raison: self
                    .raison
                    .lock()
                    .ok()
                    .and_then(|g| g.clone())
                    .unwrap_or_else(|| defaut.to_owned()),
            }
        } else {
            EtatProxy::Vivant
        }
    }
}

/// Qualifie une erreur de connexion à la base selon l'état du proxy.
///
/// C'est **le** point de `06e` § « Une chute de tunnel n'est pas une erreur de base » :
/// sans ça, le bastion tombé produit un « connection refused » sur `127.0.0.1`, qui envoie
/// chercher un problème de PostgreSQL.
///
/// `sujet` nomme le proxy — « le tunnel SSH », « le proxy Cloud SQL », « le transfert de port
/// Kubernetes ». Un message générique obligerait l'utilisateur à deviner lequel des trois est en
/// cause, ce qui est exactement le défaut que cette fonction corrige.
///
/// En fonction libre pour être testable sans proxy réel : construire l'un ou l'autre exige
/// un bastion ou un compte GCP, et garder cette logique en méthode obligerait à la recopier
/// dans le test.
pub fn qualifier_avec(etat: EtatProxy, sujet: &str, erreur: EngineError) -> EngineError {
    match etat {
        EtatProxy::Vivant => erreur,
        EtatProxy::Tombe { raison } => EngineError::local(format!(
            "{sujet} est tombé ({raison}) — la connexion à la base n'a pas pu être tentée. \
             L'erreur observée était : {}",
            erreur.message
        )),
    }
}

/// Un proxy ouvert, de l'une ou l'autre sorte.
///
/// **Pourquoi ce type plutôt que deux champs dans `PostgresAdapter`.** Deux champs
/// donneraient deux chemins à tenir cohérents dans `connect_via`, `etat_tunnel`,
/// `port_local_tunnel` et `close` — quatre endroits où oublier l'un des deux. Ici,
/// l'aiguillage est fait **une fois**, et l'ajout d'une troisième sorte fera échouer la
/// compilation aux seuls endroits à traiter.
///
/// **La troisième sorte est arrivée le 31 août 2026**, et ce type est ce qui a rendu son ajout
/// mécanique. Deux faits mesurés par sabotage, à ne pas confondre :
///
/// - `config::Proxy::Kubernetes` seule fait échouer la compilation à **un** endroit du dépôt,
///   `ouvrir` ci-dessous — le seul `match` sur ce type-là. C'est peu, et c'est assez : on ne peut
///   pas satisfaire `ouvrir` sans donner une variante à `ProxyOuvert`, qui fait alors échouer les
///   trois autres `match` de ce fichier. La garantie est en deux temps, pas en un.
/// - **rien d'autre dans le dépôt n'a eu une ligne à changer** : ni `registry`, ni `commands`, ni
///   les trois adaptateurs, ni un seul écran. Tous parlent de « proxy » ou de « tunnel », jamais de
///   sa sorte — et c'est cette discipline, plus que l'énumération, qui a fait le prix du chantier.
///
/// **Les deux sortes à sous-processus sont en `Box`, et ce n'est pas un caprice de lint**
/// (31 août 2026). Sous Windows, les types de processus et de handle du système sont bien plus
/// gros qu'ailleurs : `KubernetesProxy` pèse **368 octets** et `CloudSqlProxy` **328**, contre
/// **32** pour `SshTunnel`. Sans `Box`, l'enum entier faisait donc 368 octets et **chaque**
/// connexion en portait la taille — y compris celles tunnelées par SSH, qui est le cas courant.
/// Les trois adaptateurs gardent un `Option<ProxyOuvert>` par connexion ouverte, dans un registre
/// qui vit tant que l'application vit.
///
/// Sur macOS l'écart restait sous le seuil de `clippy::large_enum_variant`, ce qui est la seule
/// raison pour laquelle il a fallu compiler pour Windows pour le voir. Le coût est une allocation
/// par proxy ouvert — donc une par connexion, en regard d'un sous-processus qu'on vient de lancer.
///
/// **Les chiffres viennent de clippy, pas d'une supposition**, et c'est ce qui a évité l'erreur :
/// `CloudSql` mis en `Box` le premier, c'est `Kubernetes` qui est devenu la plus grosse variante.
/// Boxer l'une sans mesurer l'autre n'aurait rien réglé.
pub enum ProxyOuvert {
    Ssh(crate::engine::tunnel::SshTunnel),
    CloudSql(Box<crate::engine::cloudsql::CloudSqlProxy>),
    Kubernetes(Box<crate::engine::kubernetes::KubernetesProxy>),
}

/// `Debug` à la main, comme pour les deux types qu'il porte : le dérivé exposerait l'état
/// interne de `russh` ou la ligne de commande du sous-processus, qui porte le chemin du
/// fichier de compte de service.
impl std::fmt::Debug for ProxyOuvert {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Ssh(t) => write!(f, "ProxyOuvert::Ssh({t:?})"),
            Self::CloudSql(p) => write!(f, "ProxyOuvert::CloudSql({p:?})"),
            Self::Kubernetes(p) => write!(f, "ProxyOuvert::Kubernetes({p:?})"),
        }
    }
}

/// Ce que la couche proxy a besoin de savoir de son environnement, et que la configuration d'une
/// connexion ne porte pas.
///
/// **Pourquoi un type plutôt qu'un paramètre de plus** (`API-70`). `known_hosts` voyageait déjà seul
/// jusqu'ici, à travers les cinq adaptateurs — dont les deux qui n'ouvrent aucun proxy et le
/// reçoivent sous `_known_hosts`. `API-70` a dû y joindre les kubeconfigs déclarés, la connexion ne
/// gardant plus qu'une **référence** vers l'un d'eux : les passer côte à côte aurait donné deux
/// paramètres ambiants à toute signature d'ouverture, et le troisième aurait fait trois.
///
/// **Et il ne pouvait pas être évité.** La résolution ne peut pas se faire avant, dans un champ que
/// l'appelant remplirait : un oubli y serait silencieux et ferait ouvrir **le cluster par défaut de
/// `kubectl`**, avec succès — c'est la leçon de `Reprise`, paramètre obligatoire d'`avec` plutôt que
/// seconde méthode, appliquée à une valeur dont l'absence ne se voit pas.
#[derive(Debug, Clone, Default)]
pub struct ContexteDeProxy {
    /// Le fichier des clés d'hôte SSH connues. N'intéresse que le tunnel SSH.
    pub known_hosts: std::path::PathBuf,
    /// Les kubeconfigs déclarés (`API-70`). N'intéressent que le transfert Kubernetes.
    pub kubeconfigs: crate::config::Kubeconfigs,
}

impl ContexteDeProxy {
    /// Le contexte d'un poste : les clés d'hôte de l'utilisateur, et ce que la configuration déclare.
    pub fn nouveau(
        known_hosts: std::path::PathBuf,
        kubeconfigs: crate::config::Kubeconfigs,
    ) -> Self {
        Self {
            known_hosts,
            kubeconfigs,
        }
    }

    /// Un contexte qui ne peut rien ouvrir : aucune clé d'hôte, aucun kubeconfig déclaré.
    ///
    /// Pour les décors qui n'ouvrent pas de proxy — c'est le `/dev/null` que les tests passaient
    /// déjà, nommé.
    #[cfg(test)]
    pub fn pour_les_tests() -> Self {
        Self::nouveau(
            std::path::PathBuf::from("/dev/null"),
            crate::config::Kubeconfigs::default(),
        )
    }
}

impl ProxyOuvert {
    /// Ouvre le proxy décrit par la configuration, quelle que soit sa sorte.
    ///
    /// `hote_cible` ne sert qu'au tunnel SSH : c'est lui qui doit savoir vers quel hôte rediriger,
    /// *tel que le bastion le voit*. Le proxy Cloud SQL tient sa cible du nom d'instance, et le
    /// transfert Kubernetes de la ressource — l'hôte de la variante ne les concerne pas, et le leur
    /// passer suggérerait le contraire.
    ///
    /// `port_cible` sert à **deux** des trois (31 août 2026) : le tunnel SSH et le transfert
    /// Kubernetes en ont besoin, parce que c'est le port sur lequel la base écoute de l'autre côté
    /// — derrière le bastion pour l'un, dans le pod pour l'autre. Seul Cloud SQL l'ignore, la
    /// cible d'une instance ne se désignant pas par un port.
    pub async fn ouvrir(
        tunnel: &crate::config::Tunnel,
        hote_cible: &str,
        port_cible: u16,
        contexte: &ContexteDeProxy,
    ) -> Result<Self, EngineError> {
        match &tunnel.proxy {
            crate::config::Proxy::Ssh(ssh) => crate::engine::tunnel::SshTunnel::ouvrir(
                ssh,
                hote_cible,
                port_cible,
                tunnel.local_port,
                &contexte.known_hosts,
            )
            .await
            .map(Self::Ssh),
            crate::config::Proxy::CloudSql(cloud) => {
                crate::engine::cloudsql::CloudSqlProxy::ouvrir(cloud, tunnel.local_port)
                    .await
                    .map(|proxy| Self::CloudSql(Box::new(proxy)))
            }
            crate::config::Proxy::Kubernetes(kube) => {
                crate::engine::kubernetes::KubernetesProxy::ouvrir(
                    kube,
                    tunnel.local_port,
                    port_cible,
                    &contexte.kubeconfigs,
                )
                .await
                .map(|proxy| Self::Kubernetes(Box::new(proxy)))
            }
        }
    }

    pub fn port_local(&self) -> u16 {
        match self {
            Self::Ssh(t) => t.port_local(),
            Self::CloudSql(p) => p.port_local(),
            Self::Kubernetes(p) => p.port_local(),
        }
    }

    pub fn etat(&self) -> EtatProxy {
        match self {
            Self::Ssh(t) => t.etat(),
            Self::CloudSql(p) => p.etat(),
            Self::Kubernetes(p) => p.etat(),
        }
    }

    /// Le transport est-il tombé ? La forme booléenne d'`etat`, pour qui n'a pas de raison à
    /// afficher.
    ///
    /// **Le seul verdict qui vaille pour un pilote à pool.** `mysql_async` et le pilote MongoDB
    /// écartent d'eux-mêmes une connexion morte et en rouvrent une : un socket coupé n'y est pas
    /// définitif. Un proxy tombé, si — le pool rouvrirait indéfiniment vers un port local que plus
    /// personne n'écoute.
    pub fn est_tombe(&self) -> bool {
        matches!(self.etat(), EtatProxy::Tombe { .. })
    }

    /// **Asynchrone à cause des deux proxys en sous-processus** : chacun laisse une fenêtre courte
    /// au programme pour expliquer l'échec, qu'il écrit au moment du refus et non avant. Le tunnel
    /// SSH, lui, sait déjà tout ce qu'il sait.
    pub async fn qualifier(&self, erreur: EngineError) -> EngineError {
        match self {
            Self::Ssh(t) => t.qualifier(erreur),
            Self::CloudSql(p) => p.qualifier(erreur).await,
            Self::Kubernetes(p) => p.qualifier(erreur).await,
        }
    }

    /// Ferme le proxy et **attend** que son port local soit rendu.
    pub async fn fermer(self) {
        match self {
            Self::Ssh(t) => t.fermer().await,
            Self::CloudSql(p) => p.fermer().await,
            Self::Kubernetes(p) => p.fermer().await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Une erreur de base traverse un proxy vivant **sans être réécrite**, code compris.
    ///
    /// **L'erreur porte un code SQLSTATE délibérément.** Le test que `06g` a remplacé, en
    /// déplaçant cette mécanique depuis `tunnel/mod.rs`, employait `from_engine("28P01", …)` ;
    /// son remplaçant employait `local(…)`, dont le `code` vaut déjà `None`. L'écart n'est pas
    /// cosmétique : réécrire cette branche en `EngineError::local(erreur.message)` perdrait le
    /// code, et l'égalité tiendrait quand même entre deux erreurs sans code — le test aurait
    /// continué de passer. Or ce code est ce qui permet à un écran de distinguer « mot de passe
    /// refusé » (`28P01`) de « base inconnue » (`3D000`) sans analyser une chaîne traduite
    /// (`06a`).
    ///
    /// C'est aussi le défaut symétrique de celui que `06e` combat : maquiller en « proxy tombé »
    /// une erreur de base survenue alors que le proxy tient enverrait chercher un problème de
    /// bastion inexistant.
    #[test]
    fn un_proxy_vivant_laisse_l_erreur_intacte() {
        let erreur = EngineError::from_engine("28P01", "authentification refusée");
        let qualifiee = qualifier_avec(
            EtatProxy::Vivant,
            crate::engine::tunnel::SUJET,
            erreur.clone(),
        );
        assert_eq!(
            qualifiee, erreur,
            "une erreur de base ne doit pas être réécrite"
        );
        assert_eq!(
            qualifiee.code.as_deref(),
            Some("28P01"),
            "le code doit survivre"
        );
        assert!(!qualifiee.message.contains("tunnel"), "{qualifiee}");
    }

    /// **Vérifie le site d'appel réel, pas un littéral retapé.** `SshTunnel::qualifier` passe
    /// `tunnel::SUJET` — sans cette constante partagée, un test pourrait continuer de passer
    /// même si le site d'appel se mettait à passer un sujet vide, et un bastion tombé dirait
    /// « est tombé » sans dire quoi. Un test qui réécrit la valeur qu'il devrait
    /// constater teste sa propre copie.
    #[test]
    fn le_sujet_du_tunnel_ssh_nomme_bien_ssh() {
        let qualifiee = qualifier_avec(
            EtatProxy::Tombe {
                raison: "bastion injoignable".into(),
            },
            crate::engine::tunnel::SUJET,
            EngineError::local("connection refused"),
        );
        assert!(qualifiee.message.contains("SSH"), "{qualifiee}");
    }

    /// Même exigence pour la raison par défaut : `SshTunnel::etat` passe `tunnel::RAISON_PAR_DEFAUT`
    /// à `Surveillance::etat`, et non un littéral local au test.
    ///
    /// **Vérifiée directement sur la constante**, et non recréée via `Surveillance` : ce
    /// défaut n'est exposé que si la raison n'a jamais été notée alors que le drapeau est
    /// posé — une fenêtre théorique (voir `une_chute_sans_raison_retombe_sur_le_defaut`) que
    /// `noter_chute("")` ne reproduit pas, puisqu'elle *note* une raison, fût-elle vide.
    #[test]
    fn la_raison_par_defaut_du_tunnel_ssh_nomme_bien_ssh() {
        assert!(
            crate::engine::tunnel::RAISON_PAR_DEFAUT.contains("SSH"),
            "{}",
            crate::engine::tunnel::RAISON_PAR_DEFAUT
        );
    }

    /// Même exigence que pour le tunnel : `CloudSqlProxy::qualifier` passe
    /// `cloudsql::SUJET`, donc c'est le contenu de **cette** constante qu'il faut constater.
    /// Un littéral retapé ici laisserait vider le sujet sans qu'un test échoue.
    #[test]
    fn le_sujet_du_proxy_cloud_sql_nomme_bien_cloud_sql() {
        assert!(
            crate::engine::cloudsql::SUJET.contains("Cloud SQL"),
            "{}",
            crate::engine::cloudsql::SUJET
        );
    }

    /// Même exigence pour la troisième sorte : c'est le contenu de **la constante que la
    /// production emploie** qu'on constate. Un littéral retapé ici laisserait vider le sujet sans
    /// qu'un test échoue, et un transfert mort dirait « est tombé » sans dire quoi.
    #[test]
    fn le_sujet_du_transfert_kubernetes_nomme_bien_kubernetes() {
        assert!(
            crate::engine::kubernetes::SUJET.contains("Kubernetes"),
            "{}",
            crate::engine::kubernetes::SUJET
        );
    }

    /// Les trois sujets doivent être **distincts**, et c'est plus fort que « chacun nomme sa
    /// sorte » : le point de `qualifier_avec` est que l'utilisateur sache lequel des trois est en
    /// cause, ce qu'un sujet recopié rendrait impossible sans qu'aucun des trois tests ci-dessus
    /// n'échoue.
    #[test]
    fn les_trois_sujets_sont_distincts() {
        let sujets = [
            crate::engine::tunnel::SUJET,
            crate::engine::cloudsql::SUJET,
            crate::engine::kubernetes::SUJET,
        ];
        let mut uniques = sujets.to_vec();
        uniques.sort_unstable();
        uniques.dedup();
        assert_eq!(uniques.len(), sujets.len(), "{sujets:?}");
    }

    #[test]
    fn un_proxy_tombe_nomme_le_proxy_et_garde_l_erreur_observee() {
        let qualifiee = qualifier_avec(
            EtatProxy::Tombe {
                raison: "le processus s'est arrêté".into(),
            },
            crate::engine::cloudsql::SUJET,
            EngineError::local("connection refused"),
        );
        // Les deux moitiés comptent : nommer le proxy, **et** garder ce qui a été observé.
        // Perdre la seconde priverait d'un diagnostic quand la raison est vague.
        assert!(
            qualifiee.message.contains(crate::engine::cloudsql::SUJET),
            "{qualifiee}"
        );
        assert!(
            qualifiee.message.contains("connection refused"),
            "{qualifiee}"
        );
    }

    #[test]
    fn la_raison_est_lisible_des_qu_une_chute_est_notee() {
        let sante = Surveillance::default();
        assert_eq!(sante.etat("défaut"), EtatProxy::Vivant);
        sante.noter_chute("bastion injoignable".into());
        assert_eq!(
            sante.etat("défaut"),
            EtatProxy::Tombe {
                raison: "bastion injoignable".into()
            }
        );
    }

    #[test]
    fn une_chute_sans_raison_retombe_sur_le_defaut() {
        // Le drapeau est posé après la raison, donc ce cas ne devrait pas survenir. Le
        // couvrir quand même : un `unwrap` ici rendrait une fenêtre théorique fatale.
        let sante = Surveillance::default();
        sante.noter_chute(String::new());
        assert!(matches!(sante.etat("défaut"), EtatProxy::Tombe { .. }));
    }
}
