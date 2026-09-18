//! Ce qu'un cluster contient, lu par `kubectl` pour que `A2` le propose (`API-73`).
//!
//! # Pourquoi lire, plutôt que faire saisir
//!
//! Le visage Kubernetes d'`A2` demandait trois chaînes à la main : le fichier (une liste depuis
//! `API-70`), l'espace de noms, et la ressource sous la forme `svc/postgres`. Les deux dernières
//! sont des **noms qui existent déjà quelque part**, et qu'on ne peut pas deviner : un espace de
//! noms mal orthographié fait échouer `kubectl` sur « not found » — bruyamment, donc pas
//! dangereusement, mais après un aller-retour et vingt secondes d'attente ; et un nom de pod porte
//! le suffixe aléatoire que son `Deployment` lui a donné, qu'on relève forcément *ailleurs*, dans
//! un terminal. Ce module va le chercher là où il est.
//!
//! # Deux propriétés à ne pas défaire
//!
//! - **il ne lit jamais tout seul.** Chaque fonction d'ici est appelée par une commande IPC, que
//!   l'écran déclenche quand le visage Kubernetes est à l'écran ou quand l'utilisateur demande une
//!   relecture. Aucun minuteur, aucune lecture périodique — c'est la règle du gestionnaire
//!   d'instances (`API-32`), et elle vaut davantage ici : chaque appel est une requête
//!   **authentifiée** au serveur d'API, qui peut lancer un *exec credential plugin* au passage.
//! - **un échec n'est pas une panne, c'est un état.** Un poste sans `kubectl`, un cluster
//!   injoignable, un rôle sans droit de lister : les trois sont ordinaires pendant qu'on remplit un
//!   formulaire, et aucun ne doit empêcher de déclarer la connexion. L'erreur remonte telle quelle
//!   à l'écran, qui rend alors le champ **saisissable** en disant pourquoi — la décision d'`API-73`.
//!   C'est pour cela que ce module ne se rabat sur rien et n'avale rien.

use std::path::Path;
use std::time::Duration;

use crate::config::Kubeconfigs;
use crate::engine::EngineError;

/// Le temps laissé à une lecture.
///
/// **La même valeur que `DELAI_DEMARRAGE`, et pour la même raison** : avant de répondre, `kubectl`
/// peut avoir à lancer un *exec credential plugin* — `gke-gcloud-auth-plugin` appelle `gcloud`, qui
/// rafraîchit un jeton par le réseau. Trop court, et la liste dirait « délai dépassé » là où elle
/// allait arriver, ce qui ferait saisir à la main sur un cluster parfaitement joignable.
///
/// Ce n'est **pas** `DELAI_CONTEXTE`, qui borne une lecture de fichier local : celle-ci traverse le
/// réseau.
const DELAI_LISTE: Duration = Duration::from_secs(20);

/// Combien de caractères de la sortie d'erreur de `kubectl` entrent dans le message.
///
/// `kubectl` écrit parfois une page entière — la trace d'un plugin d'authentification, un dump de
/// requête. Ce qui aide tient dans la première phrase ; le reste remplirait la modale. Le seuil est
/// large plutôt que serré : couper trop tôt retirerait le nom du cluster ou du rôle, qui est
/// justement ce qu'on vient lire.
const LONGUEUR_DU_REFUS: usize = 400;

/// Les espaces de noms du cluster que ce kubeconfig désigne.
///
/// Rendus **triés**, comme les ressources : `kubectl` les rend déjà dans l'ordre du serveur, qui
/// est alphabétique en pratique mais n'est promis nulle part. Une liste dont l'ordre dépend du
/// serveur se lirait différemment d'un cluster à l'autre, et aucun test ne pourrait l'écrire.
pub async fn espaces_de_noms(
    binaire: &Path,
    kubeconfig: Option<&str>,
    kubeconfigs: &Kubeconfigs,
) -> Result<Vec<String>, EngineError> {
    let declare = super::resoudre_la_reference(kubeconfig, kubeconfigs)?;
    lire(
        binaire,
        declare,
        &["get".to_owned(), "namespaces".to_owned()],
    )
    .await
}

/// Les objets d'une sorte donnée, dans un espace de noms.
///
/// `sorte` est ce que `kubectl` appelle un *resource type* : `service`, `pod`, `deployment`… **Il
/// est transmis tel quel**, comme la ressource l'est à l'ouverture, et pour la même raison : la
/// liste des types est celle de `kubectl` et grandit sans nous. L'écran en propose quatre, ce qui
/// ne fait pas de ce module le gardien de cette liste — il refuse seulement ce qui ne *peut pas*
/// être un type, voir [`controler_la_sorte`].
///
/// **Un espace de noms vide vaut « celui de `kubectl` »**, la règle de `valeur_utile` : aucun
/// `--namespace` n'est posé, et `kubectl` emploie celui du contexte, `default` à défaut. C'est ce
/// que le champ d'`A2` annonce, donc la liste doit décrire le même endroit que la connexion joindra.
pub async fn ressources(
    binaire: &Path,
    kubeconfig: Option<&str>,
    namespace: Option<&str>,
    sorte: &str,
    kubeconfigs: &Kubeconfigs,
) -> Result<Vec<String>, EngineError> {
    let sorte = controler_la_sorte(sorte)?;
    let declare = super::resoudre_la_reference(kubeconfig, kubeconfigs)?;

    let mut arguments = vec!["get".to_owned(), sorte.to_owned()];
    if let Some(espace) = namespace.map(str::trim).filter(|texte| !texte.is_empty()) {
        arguments.push("--namespace".to_owned());
        arguments.push(espace.to_owned());
    }
    lire(binaire, declare, &arguments).await
}

/// Refuse ce qui ne peut pas être un type de ressource, **avant** de le passer en argv.
///
/// Ce n'est pas une liste blanche de types — ce serait la seconde liste que ce module refuse de
/// tenir — mais une garde de **forme**, et elle existe pour une raison précise : un argument qui
/// commence par `-` est lu par `kubectl` comme un **drapeau**, donc une « sorte » nommée
/// `--all-namespaces` transformerait la question posée. Nous passons un argv direct, jamais un
/// shell, donc il n'y a rien à échapper ; ce qu'il reste à empêcher est qu'une valeur change la
/// commande plutôt que son sujet.
///
/// Le motif est celui des noms de type de Kubernetes : une lettre minuscule, puis des minuscules,
/// des chiffres, des points et des tirets — ce qui laisse passer `svc`, `statefulset` et
/// `customresourcedefinition.apiextensions.k8s.io`.
fn controler_la_sorte(sorte: &str) -> Result<&str, EngineError> {
    let sorte = sorte.trim();
    let bien_forme = sorte
        .chars()
        .next()
        .is_some_and(|premier| premier.is_ascii_lowercase())
        && sorte
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '-');

    if bien_forme {
        Ok(sorte)
    } else {
        Err(EngineError::local(format!(
            "« {sorte} » n'est pas une sorte de ressource Kubernetes — attendu un type comme \
             « service », « pod », « deployment » ou « statefulset »"
        )))
    }
}

/// Lance `kubectl get … -o name` et rend les noms.
///
/// **`-o name` plutôt que `-o json` ou `jsonpath`**, pour trois raisons qui tiennent chacune :
/// c'est la sortie la plus courte, donc la moins chère à transporter sur un cluster à mille pods ;
/// elle est stable depuis toujours, là où un `jsonpath` se périme avec le schéma ; et elle est
/// **lisible** — une ligne par objet —, ce qu'un test peut écrire à la main sans embarquer un
/// document d'API.
async fn lire(
    binaire: &Path,
    kubeconfig_declare: Option<&str>,
    arguments: &[String],
) -> Result<Vec<String>, EngineError> {
    let mut commande = super::commande_de_lecture(binaire, kubeconfig_declare);
    commande.args(arguments).arg("--output").arg("name");

    let sortie = tokio::time::timeout(DELAI_LISTE, commande.output())
        .await
        .map_err(|_| {
            EngineError::local(format!(
                "kubectl n'a pas répondu dans le délai de {} s — le cluster est peut-être \
                 injoignable, ou l'authentification attend quelque chose",
                DELAI_LISTE.as_secs()
            ))
        })?
        .map_err(|erreur| {
            EngineError::local(format!(
                "kubectl ({}) n'a pas pu être lancé ({erreur})",
                binaire.display()
            ))
        })?;

    if !sortie.status.success() {
        // **Le mot de `kubectl`, et non le nôtre.** Il nomme le cluster, le rôle et le verbe
        // refusé — « Error from server (Forbidden): namespaces is forbidden: User "…" cannot list
        // resource "namespaces" » —, ce qu'aucune phrase écrite ici ne pourrait deviner. C'est la
        // règle des états hors ligne : on ne réécrit pas le message d'un moteur.
        return Err(EngineError::local(refus(&sortie.stderr)));
    }

    Ok(noms(&String::from_utf8_lossy(&sortie.stdout)))
}

/// Ce que `kubectl` a dit de son refus, borné et rendu lisible.
fn refus(stderr: &[u8]) -> String {
    let dit = String::from_utf8_lossy(stderr);
    let dit = dit.trim();
    if dit.is_empty() {
        // Un échec muet arrive — un binaire qui n'est pas `kubectl`, un plugin tué. Dire qu'on ne
        // sait pas vaut mieux que rendre une chaîne vide, que l'écran afficherait telle quelle.
        return "kubectl a refusé la lecture sans rien écrire".to_owned();
    }
    if dit.chars().count() <= LONGUEUR_DU_REFUS {
        return dit.to_owned();
    }
    let debut: String = dit.chars().take(LONGUEUR_DU_REFUS).collect();
    format!("{debut}…")
}

/// Les noms d'une sortie `-o name`.
///
/// Chaque ligne vaut `type/nom` — `namespace/kube-system`, `service/postgres`. **C'est le nom qui
/// est rendu, pas la ligne entière**, et c'est la décision qui tient la composition du formulaire :
/// la sorte vient de la liste que l'utilisateur a choisie, le nom de celle-ci, et `A2` recompose
/// `sorte/nom`. Rendre la ligne ferait entrer dans le champ le type **canonique** du serveur —
/// `service` là où l'écran propose `service`, mais aussi une forme longue pour une ressource
/// personnalisée — donc deux sources pour une même moitié de la valeur.
///
/// Une ligne sans `/` est rendue telle quelle : `kubectl` n'en écrit pas, mais un `-o name` d'une
/// version future pourrait, et la jeter serait perdre en silence l'objet qu'on vient lire.
fn noms(sortie: &str) -> Vec<String> {
    let mut noms: Vec<String> = sortie
        .lines()
        .map(str::trim)
        .filter(|ligne| !ligne.is_empty())
        .map(|ligne| {
            ligne
                .split_once('/')
                .map_or(ligne, |(_, nom)| nom)
                .to_owned()
        })
        .filter(|nom| !nom.is_empty())
        .collect();
    noms.sort();
    noms
}

#[cfg(test)]
mod tests_purs {
    use super::*;

    #[test]
    fn un_nom_se_lit_apres_la_barre_et_la_liste_est_triee() {
        let sortie = "namespace/prod\nnamespace/default\nnamespace/kube-system\n";
        assert_eq!(noms(sortie), ["default", "kube-system", "prod"]);
    }

    #[test]
    fn une_sortie_vide_rend_une_liste_vide() {
        // Le cas d'un espace de noms sans pod : `kubectl` écrit « No resources found » sur la
        // **sortie d'erreur** et sort en 0. Rien sur la sortie standard, donc aucun nom — et ce
        // n'est pas un échec, c'est une réponse.
        assert!(noms("").is_empty());
        assert!(noms("\n  \n").is_empty());
    }

    #[test]
    fn une_ligne_sans_barre_est_gardee_telle_quelle() {
        assert_eq!(noms("postgres\n"), ["postgres"]);
    }

    #[test]
    fn une_sorte_qui_commence_par_un_tiret_est_refusee() {
        // **La garde qui compte** : `--all-namespaces` passé en sorte ferait poser un drapeau à la
        // place du sujet de la question. Sans elle, la liste rendue décrirait autre chose que ce
        // qu'on a demandé, et rien ne le dirait.
        let erreur = controler_la_sorte("--all-namespaces").expect_err("refus attendu");
        assert!(
            erreur.to_string().contains("sorte de ressource"),
            "le refus doit nommer ce qui était attendu : {erreur}"
        );
    }

    #[test]
    fn les_sortes_usuelles_passent() {
        for sorte in [
            "service",
            "pod",
            "deployment",
            "statefulset",
            "svc",
            "customresourcedefinition.apiextensions.k8s.io",
        ] {
            assert_eq!(controler_la_sorte(sorte).expect("acceptée"), sorte);
        }
    }

    #[test]
    fn une_sorte_vide_est_refusee() {
        assert!(controler_la_sorte("   ").is_err());
    }

    #[test]
    fn un_refus_muet_se_dit_quand_meme() {
        assert!(refus(b"").contains("sans rien écrire"));
    }

    #[test]
    fn un_refus_trop_long_est_borne() {
        let long = "x".repeat(LONGUEUR_DU_REFUS * 2);
        let rendu = refus(long.as_bytes());
        assert_eq!(rendu.chars().count(), LONGUEUR_DU_REFUS + 1);
        assert!(rendu.ends_with('…'));
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::config::{KubeconfigDeclaration, KubeconfigId};
    use crate::engine::programme;

    /// Un faux `kubectl` qui **répète ses arguments** sur la sortie d'erreur et rend ce qu'on lui
    /// dit sur la sortie standard.
    ///
    /// Même patron que celui de `mod.rs` : le décor relit ce que la production lui a passé plutôt
    /// que de porter un attendu en dur, ce qui le rendrait insensible à un drapeau perdu.
    fn faux_kubectl(nom: &str, corps: &str) -> std::path::PathBuf {
        let base =
            std::env::temp_dir().join(format!("dorabase-catalogue-{nom}-{}", std::process::id()));
        std::fs::create_dir_all(&base).expect("répertoire");
        let chemin = base.join("kubectl");
        programme::poser_un_executable(&chemin, corps);
        chemin
    }

    fn declares() -> Kubeconfigs {
        Kubeconfigs {
            declarations: vec![KubeconfigDeclaration {
                id: KubeconfigId::brut("prod"),
                label: "prod".into(),
                path: "/tmp/kube-prod.yaml".into(),
            }],
            default: None,
        }
    }

    #[tokio::test]
    async fn les_espaces_de_noms_sont_lus_et_tries() {
        let binaire = faux_kubectl(
            "espaces",
            "#!/bin/sh\nprintf 'namespace/prod\\nnamespace/default\\n'\n",
        );
        let lus = espaces_de_noms(&binaire, None, &Kubeconfigs::default())
            .await
            .expect("lecture");
        assert_eq!(lus, ["default", "prod"]);
    }

    #[tokio::test]
    async fn la_sorte_l_espace_de_noms_et_le_kubeconfig_arrivent_a_kubectl() {
        // **Le décor relit l'argv entier**, donc chacun des trois peut tomber seul : un test qui
        // n'aurait regardé que la sorte serait resté vert en perdant le `--namespace`, c'est-à-dire
        // en listant les pods d'un autre espace de noms que celui que la connexion joindra.
        let binaire = faux_kubectl("argv", "#!/bin/sh\necho \"$*\" >&2\nexit 3\n");
        let erreur = ressources(
            &binaire,
            Some("prod"),
            Some("comptoir"),
            "statefulset",
            &declares(),
        )
        .await
        .expect_err("le faux sort en 3");
        let dit = erreur.to_string();

        assert!(dit.contains("--kubeconfig /tmp/kube-prod.yaml"), "{dit}");
        assert!(dit.contains("get statefulset"), "{dit}");
        assert!(dit.contains("--namespace comptoir"), "{dit}");
        assert!(dit.contains("--output name"), "{dit}");
    }

    #[tokio::test]
    async fn un_espace_de_noms_vide_ne_pose_aucun_drapeau() {
        // En **négatif**, et c'est ce que le champ d'`A2` promet : vide, la liste décrit l'espace
        // de noms que `kubectl` emploierait. Un `--namespace ''` chercherait dans un espace qui
        // n'existe pas, et la liste serait vide sans raison visible.
        let binaire = faux_kubectl("sans-espace", "#!/bin/sh\necho \"$*\" >&2\nexit 3\n");
        let dit = ressources(&binaire, None, Some("   "), "pod", &Kubeconfigs::default())
            .await
            .expect_err("le faux sort en 3")
            .to_string();
        assert!(!dit.contains("--namespace"), "{dit}");
    }

    #[tokio::test]
    async fn un_refus_de_kubectl_est_rendu_avec_son_mot() {
        let binaire = faux_kubectl(
            "refus",
            "#!/bin/sh\necho 'Error from server (Forbidden): namespaces is forbidden' >&2\nexit 1\n",
        );
        let dit = espaces_de_noms(&binaire, None, &Kubeconfigs::default())
            .await
            .expect_err("refus attendu")
            .to_string();
        assert!(dit.contains("Forbidden"), "{dit}");
    }

    #[tokio::test]
    async fn une_reference_qui_ne_designe_rien_est_refusee_avant_tout_lancement() {
        // La même règle qu'à l'ouverture (`API-70`) : se rabattre sur le kubeconfig par défaut
        // ferait **lister un autre cluster, avec succès** — donc proposer des espaces de noms qui
        // n'ont rien à voir avec ceux que la connexion joindra.
        let binaire = faux_kubectl("jamais", "#!/bin/sh\nexit 0\n");
        let dit = espaces_de_noms(&binaire, Some("disparu"), &Kubeconfigs::default())
            .await
            .expect_err("refus attendu")
            .to_string();
        assert!(dit.contains("disparu"), "{dit}");
        assert!(dit.contains("préférences"), "{dit}");
    }

    #[tokio::test]
    async fn le_path_de_l_enfant_porte_le_repertoire_de_kubectl() {
        // La leçon du 31 août 2026 : `kubectl` cherche ses *exec credential plugins* dans le `PATH`
        // qu'il hérite de nous, et une lecture de catalogue en a besoin autant qu'une ouverture.
        // L'assertion vise le répertoire du **faux** binaire, dans le répertoire temporaire, qui ne
        // peut pas venir du `PATH` de la machine — sans quoi le test mesurerait ce poste.
        //
        // **Le `PATH` passe par un fichier et non par le message d'erreur** : celui-ci est borné à
        // `LONGUEUR_DU_REFUS`, et un `PATH` réel le dépasse — le premier jet a donc échoué en
        // mesurant la troncature plutôt que l'héritage.
        let binaire = faux_kubectl(
            "path",
            "#!/bin/sh\nprintf '%s' \"$PATH\" > \"$0.path\"\nexit 3\n",
        );
        let _ = espaces_de_noms(&binaire, None, &Kubeconfigs::default()).await;

        let hérité = std::fs::read_to_string(binaire.with_extension("path"))
            .expect("le faux kubectl a écrit son PATH");
        let repertoire = binaire.parent().expect("répertoire").display().to_string();
        assert!(hérité.contains(&repertoire), "{hérité}");
    }
}
