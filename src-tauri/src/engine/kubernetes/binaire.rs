//! Trouver `kubectl` sur la machine, ou dire comment l'installer.
//!
//! **Découvert, jamais embarqué — et c'est l'inverse du choix d'`06h`.** Le proxy Cloud SQL voyage
//! dans le bundle parce que sa version décide du format de ses journaux, que nous lisons. `kubectl`
//! ne peut pas suivre le même chemin, pour trois raisons qui tiennent chacune seule :
//!
//! - **il est apparié au cluster**, pas à nous : la règle de Kubernetes est un écart d'au plus une
//!   version mineure avec le serveur d'API. Un `kubectl` figé dans le bundle vieillirait contre les
//!   clusters de l'utilisateur, et c'est *lui* qui se mettrait à échouer ;
//! - **il ne s'authentifie pas seul** : GKE, EKS et l'OIDC passent par des *exec credential
//!   plugins* installés sur la machine, que nous n'embarquerions pas. Un `kubectl` embarqué sans
//!   eux serait inutile là où il sert le plus ;
//! - **il pèse une cinquantaine de mégaoctets**, et le projet trouve déjà lourds les 6,3 Mo
//!   d'`export-types` qui voyagent par accident.
//!
//! C'est donc le même arbitrage que `pg_dump` en `22b` : la fidélité est acquise auprès de l'outil
//! natif, la contrepartie est une dépendance externe, et cette contrepartie est **dite** plutôt que
//! subie — le message d'absence porte la commande d'installation.

use std::path::PathBuf;

use crate::engine::programme;
use crate::engine::EngineError;

/// Le nom de l'outil. En constante parce qu'il apparaît dans le message d'absence autant que dans
/// la recherche, et que les deux doivent nommer la même chose.
pub const NOM: &str = "kubectl";

/// Les emplacements où `kubectl` se trouve **hors du `PATH` et hors de Homebrew**.
///
/// Chacun est un installeur réel sur macOS, et aucun ne pose de lien dans `/usr/local/bin` de façon
/// fiable : Rancher Desktop pose son propre répertoire, Docker Desktop garde ses binaires dans le
/// bundle de l'app, et le SDK Google en installe un exemplaire à côté de `gcloud`. Un `~` de tête
/// est développé depuis `HOME` ; une app graphique en hérite toujours, contrairement au `PATH`.
#[cfg(target_os = "macos")]
const EMPLACEMENTS_CONNUS: &[&str] = &[
    "~/.rd/bin",
    "/Applications/Docker.app/Contents/Resources/bin",
    "~/google-cloud-sdk/bin",
];

/// Les mêmes hors macOS (31 août 2026 pour Windows, Linux le 4 septembre 2026), et la liste y est
/// **plus courte pour une raison**.
///
/// Les deux chemins en `~` valent là-bas aussi : Rancher Desktop pose bien `%USERPROFILE%\.rd\bin`
/// et `~/.rd/bin`, et le SDK Google s'installe couramment dans le répertoire personnel. Ils ne
/// coûtent rien et `programme::chemin_utilisateur` sait les développer depuis le 31 août 2026 —
/// c'est même le défaut que le job Windows a trouvé.
///
/// **Docker Desktop n'y figure pas, et c'est délibéré.** Ni son chemin Windows
/// (`C:\Program Files\Docker\Docker\resources\bin`) ni son chemin Linux n'ont **été mesurés**,
/// contrairement à celui de macOS ; et le motif qui rend cette liste nécessaire est bien plus
/// faible ici — un processus Windows hérite du `PATH` de la machine, et une session de bureau
/// Linux transmet un `PATH` utilisable, où l'installateur met son `bin`. L'ajouter serait inventer
/// un fait pour couvrir un cas que le `PATH` couvre déjà. À reprendre si l'usage dit le contraire.
///
/// **Une seule liste pour les deux, et non deux identiques** : rien de ce qui la compose ne
/// distingue Windows de Linux, et deux constantes jumelles seraient deux constantes à tenir en
/// phase.
#[cfg(not(target_os = "macos"))]
const EMPLACEMENTS_CONNUS: &[&str] = &["~/.rd/bin", "~/google-cloud-sdk/bin"];

/// Les répertoires fouillés, dans l'ordre : le `PATH`, les emplacements usuels, puis ceux des
/// installeurs de Kubernetes.
///
/// **Aucune préséance à défendre ici**, contrairement à `cloudsql` où l'embarqué doit gagner :
/// tous ces `kubectl` sont des `kubectl`, et celui du `PATH` est celui que l'utilisateur emploie
/// depuis son terminal — donc celui dont le kubeconfig et les contextes lui sont familiers. C'est
/// la seule raison pour laquelle le `PATH` passe en tête, et elle suffit.
pub fn emplacements_par_defaut() -> Vec<PathBuf> {
    let mut emplacements = programme::emplacements_usuels();

    for connu in EMPLACEMENTS_CONNUS {
        // `chemin_utilisateur` développe le `~/` de tête. Sans `HOME` il rend la saisie telle
        // quelle, donc un littéral « ~/… » : inoffensif ici, ce répertoire n'existant pas.
        let chemin = programme::chemin_utilisateur(connu);
        if !emplacements.contains(&chemin) {
            emplacements.push(chemin);
        }
    }

    emplacements
}

/// Trouve `kubectl`, ou rend une erreur qui **dit quoi faire**.
pub fn localiser() -> Result<PathBuf, EngineError> {
    localiser_dans(&emplacements_par_defaut())
}

/// La même chose, avec les répertoires en paramètre.
///
/// Séparée pour la même raison que `connect_via` l'est de `connect` en `06b` : un test n'a pas le
/// droit de dépendre de ce qui est installé sur la machine qui l'exécute — ni de réussir *parce
/// que* la machine de développement a `kubectl`.
pub fn localiser_dans(emplacements: &[PathBuf]) -> Result<PathBuf, EngineError> {
    // **La manœuvre est celle du système, et un conseil faux est pire que pas de conseil**
    // (4 septembre 2026) — c'est l'arbitrage déjà écrit pour le proxy Cloud SQL, appliqué ici.
    // « brew install kubernetes-cli » nommait, hors macOS, un outil que l'utilisateur n'a pas :
    // le message envoyait chercher une solution qui n'existe pas là où il est. C'était déjà faux
    // sous Windows depuis le 31 août ; l'ajout de Linux l'a rendu visible.
    //
    // L'URL de la documentation vaut sur les trois systèmes — c'est elle qui porte les
    // instructions de chacun — et c'est ce qui reste commun aux deux messages.
    let manoeuvre = if cfg!(target_os = "macos") {
        "installez-le avec « brew install kubernetes-cli », ou depuis \
         https://kubernetes.io/docs/tasks/tools/"
    } else {
        "installez-le depuis https://kubernetes.io/docs/tasks/tools/, ou par le gestionnaire de \
         paquets du système, et placez-le dans un dossier du PATH"
    };

    programme::localiser_dans(emplacements, NOM).ok_or_else(|| {
        EngineError::local(format!(
            "le binaire « {NOM} » est introuvable — {manoeuvre}, puis réessayez"
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_kubectl_absent_dit_comment_l_installer() {
        let erreur = localiser_dans(&[PathBuf::from("/nulle-part-du-tout")])
            .expect_err("un binaire absent doit être une erreur");
        // Même exigence qu'`06g` : l'erreur **nomme ce qu'il faut faire**, plutôt que de rendre
        // le « No such file or directory » du système.
        assert!(erreur.message.contains("kubectl"), "{erreur}");
        // **La manœuvre est celle du système** : « brew install » n'a de sens que sur macOS, et
        // l'y exiger partout était l'assertion qui laissait passer un conseil faux sous Windows.
        // L'URL, elle, vaut sur les trois — c'est ce qui reste commun aux deux messages.
        let manoeuvre = if cfg!(target_os = "macos") {
            "brew install"
        } else {
            "gestionnaire de paquets"
        };
        assert!(erreur.message.contains(manoeuvre), "{erreur}");
        assert!(
            erreur.message.contains("kubernetes.io/docs/tasks/tools/"),
            "l'URL vaut sur les trois systèmes : {erreur}"
        );
    }

    #[test]
    #[cfg(unix)]
    fn kubectl_est_trouve_dans_les_repertoires_donnes() {
        use std::os::unix::fs::PermissionsExt;

        let base = std::env::temp_dir().join(format!("dorabase-kubectl-{}", std::process::id()));
        std::fs::create_dir_all(&base).expect("répertoire");
        let chemin = base.join(NOM);
        std::fs::write(&chemin, "#!/bin/sh\nexit 0\n").expect("écriture");
        std::fs::set_permissions(&chemin, std::fs::Permissions::from_mode(0o755)).expect("droits");

        assert_eq!(
            localiser_dans(std::slice::from_ref(&base)).expect("trouvé"),
            chemin
        );
    }

    #[test]
    fn les_emplacements_par_defaut_portent_le_path_puis_les_installeurs() {
        let emplacements = emplacements_par_defaut();
        let en_texte: Vec<String> = emplacements
            .iter()
            .map(|c| c.display().to_string())
            .collect();

        // **Ce que les deux plateformes partagent, et c'est l'invariant qui compte** : le `PATH`
        // passe en tête (celui du terminal de l'utilisateur, dont les contextes lui sont
        // familiers), puis viennent les emplacements devinés. Un `EMPLACEMENTS_CONNUS` qui
        // cesserait d'être ajouté ferait tomber ceci sur les deux systèmes.
        let du_path = programme::dossiers_du_path();
        assert!(
            emplacements.len() > du_path.len(),
            "la liste doit ajouter au `PATH`, pas s'y réduire : {en_texte:?}"
        );
        assert!(
            emplacements.starts_with(&du_path),
            "le `PATH` doit venir en tête : {en_texte:?}"
        );

        // Et les deux emplacements en `~` sont **développés**, sur les deux systèmes : un `~`
        // littéral désignerait un répertoire nommé « ~ ». C'est le défaut que le job Windows a
        // trouvé, ici en contrôle positif.
        if programme::repertoire_personnel().is_some() {
            assert!(
                !en_texte.iter().any(|c| c.starts_with('~')),
                "aucun `~` ne doit subsister : {en_texte:?}"
            );
            let rd = emplacements
                .iter()
                .find(|c| c.ends_with(".rd/bin") || c.ends_with(r".rd\bin"));
            assert!(rd.is_some(), "Rancher Desktop attendu : {en_texte:?}");
        }

        // Les emplacements usuels de la plateforme sont là, **demandés et non recopiés**
        // (4 septembre 2026).
        //
        // Ce test épinglait `/opt/homebrew/bin` sous `cfg(not(windows))`, ce qui voulait dire
        // « macOS » sans le dire : l'arrivée de Linux, dont les emplacements usuels ne sont pas
        // ceux de Homebrew, l'a fait tomber. C'est le défaut d'`estWindows` reparu dans un `cfg`.
        // Le `cfg` nomme donc les deux plateformes dont la liste n'est pas vide — ailleurs la
        // boucle ne mesurerait rien.
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            for usuel in programme::EMPLACEMENTS_USUELS {
                let attendu = programme::chemin_utilisateur(usuel);
                assert!(
                    emplacements.contains(&attendu),
                    "« {} » manque dans {en_texte:?}",
                    attendu.display()
                );
            }
        }

        // Docker Desktop, lui, **est** un chemin de macOS et le reste : il garde son `kubectl`
        // dans le bundle de l'app et ne le lie nulle part de façon fiable. Ni Windows ni Linux ne
        // le portent, faute d'avoir été mesurés — voir la déclaration d'`EMPLACEMENTS_CONNUS`.
        // Le `cfg` dit donc ici ce qu'il veut dire, et c'est pourquoi il ne bouge pas.
        #[cfg(target_os = "macos")]
        assert!(
            en_texte
                .iter()
                .any(|c| c == "/Applications/Docker.app/Contents/Resources/bin"),
            "{en_texte:?}"
        );
    }

    #[test]
    fn un_emplacement_en_tilde_est_developpe_et_non_pris_au_mot() {
        // Un `~` littéral ne désigne aucun répertoire : le passer tel quel à `join` chercherait
        // dans un dossier nommé « ~ », donc nulle part, et l'installeur concerné serait ignoré
        // sans que rien le dise.
        let Some(maison) = std::env::var_os("HOME").map(PathBuf::from) else {
            return;
        };
        let emplacements = emplacements_par_defaut();
        assert!(
            emplacements.contains(&maison.join(".rd/bin")),
            "{emplacements:?}"
        );
        assert!(
            !emplacements.iter().any(|c| c.starts_with("~")),
            "{emplacements:?}"
        );
    }
}
