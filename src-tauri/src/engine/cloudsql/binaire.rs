//! Trouver le binaire `cloud-sql-proxy` — le sidecar embarqué d'abord, le `PATH` en repli.
//!
//! **Ce qui est parti dans `engine/programme.rs` le 31 août 2026** : le droit d'exécution, les
//! emplacements de Homebrew, et la boucle qui essaie un répertoire après l'autre. Ce qui reste ici
//! est la seule règle propre à `06h` — **l'embarqué gagne** —, et elle tient en une ligne : le
//! répertoire de l'exécutable est mis en tête de la liste.

use std::path::{Path, PathBuf};

use crate::engine::programme;
use crate::engine::EngineError;

/// Le nom du binaire officiel, tel que Google le distribue. C'est aussi le nom sous lequel
/// Tauri copie le binaire externe dans le bundle, en retirant le triplet du nom du fichier.
///
/// **C'est le nom de l'outil, pas celui du fichier.** L'extension de la plateforme est ajoutée
/// par `programme::localiser_dans`, pour tous ses appelants à la fois ; ici `NOM` sert aussi aux
/// messages, où « cloud-sql-proxy.exe » nommerait un fichier là où l'utilisateur cherche l'outil
/// que documente Google.
const NOM: &str = "cloud-sql-proxy";

/// Le verrou, inclus à la compilation.
///
/// **Le même fichier que celui que lit le script de téléchargement.** Deux sources — une
/// constante Rust et une ligne de script — divergeraient au premier relèvement de version,
/// et le journal annoncerait alors une version que l'app ne lance pas.
const VERROU: &str = include_str!("../../../cloud-sql-proxy.lock");

/// La version du proxy embarquée dans le bundle.
///
/// Utile pour les journaux et l'attribution : un bogue du proxy se diagnostique par sa
/// version, et un binaire embarqué ne se laisse pas interroger depuis un terminal.
pub fn version_embarquee() -> &'static str {
    valeur_du_verrou("version").unwrap_or("inconnue")
}

/// Lit une valeur du verrou. Format volontairement pauvre — `clef = valeur`, `#` en
/// commentaire — pour être lu ici sans dépendance et en trois lignes de script.
fn valeur_du_verrou(clef: &str) -> Option<&'static str> {
    VERROU.lines().find_map(|ligne| {
        let (gauche, droite) = ligne.split_once('=')?;
        (gauche.trim() == clef).then(|| droite.trim())
    })
}

/// Le répertoire où Tauri place le binaire embarqué : celui de l'exécutable de l'app.
///
/// Dans un bundle macOS, c'est `Contents/MacOS`, à côté de l'exécutable principal. En
/// développement, c'est `target/debug`, où `tauri dev` copie le sidecar — donc le même
/// chemin de code sert dans les deux cas.
fn emplacement_embarque() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()?
        .parent()
        .map(Path::to_path_buf)
}

/// Le binaire donné est-il celui que le bundle embarque ?
///
/// Sert au journal : savoir **lequel** des deux a été lancé est la première question qu'on
/// se pose devant un message du proxy qu'on ne reconnaît pas.
pub fn est_embarque(chemin: &Path) -> bool {
    emplacement_embarque().is_some_and(|repertoire| chemin.parent() == Some(&*repertoire))
}

/// Les répertoires fouillés, dans l'ordre : **l'embarqué d'abord**, puis le `PATH`, puis les
/// emplacements usuels.
///
/// **Pourquoi l'embarqué gagne** (`06h`). Si le `PATH` passait devant, le comportement de
/// l'app dépendrait de ce que l'utilisateur a installé, et un proxy d'une autre version
/// pourrait écrire des journaux que `sortie::est_pret` ne reconnaît pas — une attente qui
/// expire alors que le proxy marche. La version embarquée est celle contre laquelle
/// `sortie` a été relue.
///
/// **Pourquoi le `PATH` reste** (`06g`). Sans bundle — `cargo run`, `cargo test`, la machine
/// de développement — il n'y a pas de sidecar à côté de l'exécutable. Le repli est aussi ce
/// qui garde valables, sans retouche, les tests écrits avant `06h`.
///
/// **Pourquoi ne pas se contenter du `PATH`.** Une application lancée depuis le Finder
/// n'hérite pas du `PATH` du shell de l'utilisateur : macOS lui en donne un minimal, qui ne
/// contient ni `/opt/homebrew/bin` ni `/usr/local/bin`. Un binaire parfaitement installé
/// serait donc introuvable dans l'app packagée alors qu'il se trouve depuis un terminal —
/// panne d'autant plus déroutante que `which cloud-sql-proxy` répond.
pub fn emplacements_par_defaut() -> Vec<PathBuf> {
    let mut emplacements: Vec<PathBuf> = emplacement_embarque().into_iter().collect();
    emplacements.extend(programme::emplacements_usuels());
    emplacements
}

/// Trouve le binaire, ou rend une erreur qui **dit quoi faire**.
pub fn localiser() -> Result<PathBuf, EngineError> {
    localiser_dans(&emplacements_par_defaut())
}

/// La même chose, avec les répertoires en paramètre.
///
/// Séparée pour la même raison que `connect_via` l'est de `connect` en `06b` : un test n'a
/// pas le droit de dépendre de ce qui est installé sur la machine qui l'exécute.
pub fn localiser_dans(emplacements: &[PathBuf]) -> Result<PathBuf, EngineError> {
    // **La manœuvre dépend du système, et un conseil faux est pire que pas de conseil.**
    // `brew install` sous Windows ou sous Linux nomme un outil que l'utilisateur n'a pas et n'a
    // le plus souvent pas : le message enverrait chercher une solution qui n'existe pas là où il
    // est. Les deux gardent en commun l'URL de Google, qui est la vraie réponse dans tous les cas.
    //
    // **Le test porte sur macOS, pas sur Windows** (4 septembre 2026) : c'est la seule plateforme
    // où une formule Homebrew existe, donc la seule à nommer un installateur. Linux a rejoint
    // Windows sans une ligne de plus — Homebrew pour Linux existe, mais conseiller de l'installer
    // pour un binaire unique serait un détour, et Google publie le binaire directement.
    let manoeuvre = if cfg!(target_os = "macos") {
        format!(
            "installez-le avec « brew install {NOM} », ou depuis \
             https://cloud.google.com/sql/docs/mysql/sql-proxy"
        )
    } else {
        "téléchargez-le depuis https://cloud.google.com/sql/docs/mysql/sql-proxy \
         et placez-le dans un dossier du PATH"
            .to_owned()
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

    /// Un répertoire contenant un exécutable factice du nom donné.
    #[cfg(unix)]
    fn repertoire_avec_executable(nom: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let base =
            std::env::temp_dir().join(format!("dorabase-binaire-{nom}-{}", std::process::id()));
        std::fs::create_dir_all(&base).expect("répertoire");
        let chemin = base.join(nom);
        std::fs::write(&chemin, "#!/bin/sh\nexit 0\n").expect("écriture");
        std::fs::set_permissions(&chemin, std::fs::Permissions::from_mode(0o755)).expect("droits");
        base
    }

    #[test]
    #[cfg(unix)]
    fn le_binaire_est_trouve_dans_les_repertoires_donnes() {
        let repertoire = repertoire_avec_executable("cloud-sql-proxy");
        let trouve =
            localiser_dans(std::slice::from_ref(&repertoire)).expect("le binaire doit être trouvé");
        assert_eq!(trouve, repertoire.join("cloud-sql-proxy"));
    }

    #[test]
    fn un_binaire_absent_dit_comment_l_installer() {
        let erreur = localiser_dans(&[std::path::PathBuf::from("/nulle-part-du-tout")])
            .expect_err("un binaire absent doit être une erreur");
        // `06g` § Terminé quand : l'erreur **nomme ce qu'il faut faire**, plutôt que de
        // rendre le « No such file or directory » du système. C'est la même exigence que
        // `06e` applique à un hôte inconnu de `known_hosts`.
        assert!(erreur.message.contains("cloud-sql-proxy"), "{erreur}");
        // **La manœuvre nommée est celle du système, et un conseil faux serait pire que rien** :
        // « brew install » hors macOS enverrait chercher un outil qui n'existe pas là. Les deux
        // messages gardent en commun l'URL de Google, qui est la vraie réponse dans tous les cas.
        let manoeuvre = if cfg!(target_os = "macos") {
            "install"
        } else {
            "téléchargez"
        };
        assert!(erreur.message.contains(manoeuvre), "{erreur}");
        assert!(
            erreur.message.contains("cloud.google.com"),
            "l'URL vaut sur les trois systèmes : {erreur}"
        );
    }

    #[test]
    #[cfg(unix)]
    fn un_fichier_non_executable_n_est_pas_le_binaire() {
        // Un fichier du bon nom mais sans droit d'exécution donnerait un « Permission
        // denied » au lancement — moins clair que « pas trouvé, voilà comment l'installer ».
        let base = std::env::temp_dir().join(format!("dorabase-non-exec-{}", std::process::id()));
        std::fs::create_dir_all(&base).expect("répertoire");
        std::fs::write(base.join("cloud-sql-proxy"), "pas un programme").expect("écriture");

        assert!(localiser_dans(&[base]).is_err());
    }

    #[test]
    #[cfg(unix)]
    fn l_embarque_gagne_contre_un_binaire_du_path() {
        // **Le critère d'`06h`.** Deux répertoires contenant chacun un `cloud-sql-proxy` :
        // celui de l'app packagée doit gagner, sinon le comportement dépendrait de ce que
        // l'utilisateur a installé — et une autre version pourrait écrire des journaux que
        // `sortie::est_pret` ne reconnaît pas.
        let embarque = repertoire_avec_executable("cloud-sql-proxy");
        let installe = repertoire_avec_executable("cloud-sql-proxy-du-path");
        // Le second répertoire porte le binaire sous son vrai nom, lui aussi : c'est bien
        // d'un choix entre deux candidats valables qu'il s'agit.
        {
            use std::os::unix::fs::PermissionsExt;
            let chemin = installe.join("cloud-sql-proxy");
            std::fs::write(&chemin, "#!/bin/sh\nexit 0\n").expect("écriture");
            std::fs::set_permissions(&chemin, std::fs::Permissions::from_mode(0o755))
                .expect("droits");
        }

        let trouve = localiser_dans(&[embarque.clone(), installe]).expect("un des deux");
        assert_eq!(trouve, embarque.join("cloud-sql-proxy"));
    }

    #[test]
    fn le_verrou_donne_une_version_et_une_empreinte_par_triplet() {
        // Le verrou est la source unique de vérité partagée avec le script de
        // téléchargement. Une clef renommée d'un côté et pas de l'autre casserait le
        // script sans casser la compilation : ce test est le seul garde-fou côté Rust.
        let version = version_embarquee();
        assert_ne!(version, "inconnue", "le verrou doit porter une version");
        assert!(
            version.starts_with('2') && version.contains('.'),
            "{version}"
        );

        // **Les quatre, dont les deux Linux.** Ceux-ci ne servent pas à livrer — le bundle ne
        // cible que macOS — mais un `externalBin` déclaré est exigé par **toute** compilation,
        // donc par `cargo test` sur le runner Linux de la CI (défaut n° 111). Un verrou qui les
        // perdrait rendrait le projet incompilable là-bas, et rien ici ne le dirait.
        for triplet in [
            "aarch64-apple-darwin",
            "x86_64-apple-darwin",
            "x86_64-unknown-linux-gnu",
            "aarch64-unknown-linux-gnu",
        ] {
            let empreinte = valeur_du_verrou(&format!("sha256-{triplet}"))
                .unwrap_or_else(|| panic!("empreinte manquante pour {triplet}"));
            assert_eq!(empreinte.len(), 64, "{triplet} : {empreinte}");
            assert!(
                empreinte.chars().all(|c| c.is_ascii_hexdigit()),
                "{triplet} : {empreinte}"
            );
        }
    }

    #[test]
    fn un_commentaire_du_verrou_n_est_pas_lu_comme_une_clef() {
        // Les commentaires du verrou contiennent des `=` en prose ; les lire comme des
        // clefs donnerait une version fantaisiste sans jamais échouer.
        assert_eq!(valeur_du_verrou("# version"), None);
        assert_eq!(valeur_du_verrou("clef-qui-n-existe-pas"), None);
    }

    #[test]
    fn les_emplacements_par_defaut_incluent_le_path_et_les_usuels() {
        let emplacements = emplacements_par_defaut();
        let en_texte: Vec<String> = emplacements
            .iter()
            .map(|c| c.display().to_string())
            .collect();

        // **L'invariant des deux plateformes** : l'embarqué d'abord, le `PATH` ensuite. C'est la
        // préséance de `06h` — si le `PATH` passait devant, le comportement dépendrait de ce que
        // l'utilisateur a installé, et un proxy d'une autre version écrirait des journaux que
        // `sortie::est_pret` ne reconnaît pas.
        for du_path in programme::dossiers_du_path() {
            assert!(
                emplacements.contains(&du_path),
                "{en_texte:?} sans {du_path:?}"
            );
        }

        // Les emplacements usuels de la plateforme sont là.
        //
        // **Gardé ici après l'extraction du 31 août 2026**, alors que `programme` a le même :
        // celui-ci mesure la liste *que ce scope compose*, et une délégation oubliée la laisserait
        // sans eux sans que le test de `programme` s'en aperçoive.
        //
        // **La liste est demandée, pas recopiée** (4 septembre 2026). Ce test épinglait
        // `/opt/homebrew/bin` sous `cfg(not(windows))`, ce qui voulait dire « macOS » sans le
        // dire : l'arrivée de Linux, dont les emplacements usuels ne sont pas ceux de Homebrew,
        // l'a fait tomber. C'est le défaut d'`estWindows` — un garde nommé pour la plateforme
        // qu'on venait d'ajouter plutôt que pour la question qu'il posait — reparu dans un `cfg`.
        // Demander la constante rend le test juste sur les trois plateformes **et** le laisse
        // suivre une liste qui changera encore.
        //
        // Le `cfg` restant nomme les deux plateformes dont la liste n'est pas vide : ailleurs
        // cette boucle ne mesurerait rien, et un test qui passe sans exécuter d'assertion est un
        // mensonge poli.
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
    }

    #[test]
    fn l_emplacement_de_l_executable_est_cherche_en_premier() {
        // C'est là que Tauri copie le binaire embarqué : dans le bundle, à côté de
        // l'exécutable de l'app. L'ordre de cette liste **est** la règle d'`06h` ; un
        // `push` au lieu d'un `insert` la renverserait sans rien casser d'autre.
        let attendu = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(std::path::Path::to_path_buf));
        let Some(attendu) = attendu else {
            return;
        };
        assert_eq!(emplacements_par_defaut().first(), Some(&attendu));
    }
}
