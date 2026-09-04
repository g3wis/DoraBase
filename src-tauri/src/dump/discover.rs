//! La découverte du binaire de dump, et le contrôle de sa version.
//!
//! **Découvert, pas empaqueté.** Embarquer `pg_dump` et `psql` coûterait des dizaines de
//! mégaoctets par plateforme et compliquerait la notarisation.
//!
//! **Aucun shell, aucun réseau** : `std::process::Command` avec un argv direct, et rien
//! d'autre. Le seul appel lancé ici est `<binaire> --version`.

use std::path::{Path, PathBuf};
use std::process::Command;

use super::{regle_de_version, DumpAvailability, Version, VersionVerdict};
use crate::engine::programme;

/// Les emplacements où un binaire PostgreSQL se trouve **hors du `PATH`**.
///
/// Mesuré le 19 août 2026 : sur cette machine, `pg_dump` est dans
/// `/opt/homebrew/opt/postgresql@17/bin` — pas dans `libpq/bin`, et Postgres.app n'est
/// pas installé. L'ordre reflète la fréquence réelle sur macOS.
///
/// Le `*` d'un segment est développé en listant le répertoire parent : `postgresql@17`,
/// `postgresql@16`… Une app lancée depuis le Finder n'hérite pas du `PATH` du shell, donc
/// cette liste n'est pas un luxe — c'est le cas courant.
#[cfg(target_os = "macos")]
pub const EMPLACEMENTS_CONNUS: &[&str] = &[
    "/opt/homebrew/opt/postgresql@*/bin",
    "/opt/homebrew/opt/libpq/bin",
    "/usr/local/opt/postgresql@*/bin",
    "/usr/local/opt/libpq/bin",
    "/Applications/Postgres.app/Contents/Versions/*/bin",
    "/usr/bin",
];

/// Les mêmes emplacements sous Linux (4 septembre 2026).
///
/// **Le motif est le même que sous Windows, pas celui de macOS** : ce n'est pas le `PATH` qui
/// manque — une session de bureau en transmet un utilisable —, c'est que les paquets qui
/// installent plusieurs versions majeures côte à côte ne mettent **aucune** d'elles dans le
/// `PATH`. Le résultat est identique : l'outil est installé et introuvable.
///
/// - **`/usr/lib/postgresql/*/bin`** est la disposition de Debian et d'Ubuntu, PGDG compris.
///   Elle est **mesurée**, et pas lue dans une documentation : c'est exactement le chemin que le
///   job Linux de `ci.yml` ajoute au `PATH` pour que les tests de dump voient le client 17
///   (`echo "/usr/lib/postgresql/17/bin" >> "$GITHUB_PATH"`) ;
/// - **`/usr/pgsql-*/bin`** est celle du dépôt PGDG pour RHEL et Fedora. Elle vient de la
///   documentation de ce dépôt, **non mesurée** — comme les deux chemins Windows, et à confirmer
///   de la même façon ;
/// - **`/usr/bin`** ferme la liste, comme sur macOS : c'est là que vit le paquet
///   `postgresql-client` d'une distribution qui n'en garde qu'une version.
///
/// Le tri décroissant de `developper` fait préférer la majeure la plus récente, comme pour les
/// `postgresql@N` de Homebrew.
#[cfg(target_os = "linux")]
pub const EMPLACEMENTS_CONNUS: &[&str] =
    &["/usr/lib/postgresql/*/bin", "/usr/pgsql-*/bin", "/usr/bin"];

/// Les mêmes emplacements sous Windows (31 août 2026).
///
/// **La raison d'être de cette liste n'est pas la même que sur macOS, et c'est pourquoi elle
/// existe quand même.** Là-bas, le motif est qu'une app lancée depuis le Finder reçoit un
/// `PATH` minimal. Ici, l'installateur EDB — la voie de très loin la plus courante — ne met
/// simplement **pas** `bin` dans le `PATH` : la case existe et n'est pas cochée par défaut. Le
/// résultat est le même, l'outil est installé et introuvable, donc le repli est tout aussi
/// nécessaire.
///
/// Les deux premiers couvrent l'installateur EDB en 64 et 32 bits ; le `*` développe le numéro
/// de version, et le tri décroissant de `developper` fait préférer la plus récente, comme pour
/// les `postgresql@N` de Homebrew.
///
/// **Non vérifié sur une machine Windows réelle** — ces chemins viennent de la documentation de
/// l'installateur, pas d'une mesure, contrairement à ceux de macOS qui ont été relevés. À
/// confirmer à l'œil : c'est dans la liste de ce qu'aucun test ne peut dire.
#[cfg(windows)]
pub const EMPLACEMENTS_CONNUS: &[&str] = &[
    r"C:\Program Files\PostgreSQL\*\bin",
    r"C:\Program Files (x86)\PostgreSQL\*\bin",
];

/// Les autres unix : aucun chemin mesuré, donc aucun deviné.
///
/// Le `PATH` reste fouillé — c'est `decouvrir` qui l'apporte —, et un repli emprunté à une autre
/// distribution serait l'invention de fait que la liste Linux ci-dessus refuse.
#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
pub const EMPLACEMENTS_CONNUS: &[&str] = &[];

/// Découvre un binaire : `PATH` d'abord, puis les emplacements connus.
pub fn decouvrir(binaire: &'static str, serveur: Version) -> DumpAvailability {
    decouvrir_dans(&dossiers_du_path(), EMPLACEMENTS_CONNUS, binaire, serveur)
}

/// Les répertoires du `PATH`, dans l'ordre. Réexporté pour les appelants de ce module.
pub fn dossiers_du_path() -> Vec<PathBuf> {
    programme::dossiers_du_path()
}

/// Le cœur de la découverte, avec ses deux sources **explicites**.
///
/// Les deux listes sont des paramètres et non des constantes lues ici : c'est ce qui rend
/// les quatre cas testables séparément — un `PATH` fabriqué sans le binaire donne
/// `ToolMissing` même si la machine en porte un ailleurs, et le contrôle négatif du plan
/// (vider `globs`) fait bien tomber le test qui exige les emplacements connus.
pub fn decouvrir_dans(
    dossiers: &[PathBuf],
    globs: &[&str],
    binaire: &'static str,
    serveur: Version,
) -> DumpAvailability {
    // **La recherche est déléguée à `programme`**, qui porte les deux faits communs aux trois
    // scopes qui cherchent un exécutable : le droit d'exécution sous unix, l'extension `.exe`
    // sous Windows. C'est ce qui a retiré d'ici le dernier `std::os::unix` non gardé du dépôt —
    // par suppression, pas par une garde de plus.
    //
    // Matérialiser la liste plutôt que l'enchaîner paresseusement : `developper` liste des
    // répertoires, donc le coût est celui de quelques `read_dir` déjà payés, et `localiser_dans`
    // s'arrête au premier trouvé de toute façon.
    let candidats: Vec<PathBuf> = dossiers
        .iter()
        .cloned()
        .chain(globs.iter().flat_map(|motif| developper(motif)))
        .collect();

    let Some(chemin) = programme::localiser_dans(&candidats, binaire) else {
        return DumpAvailability::ToolMissing { binary: binaire };
    };

    // Le premier binaire trouvé décide, même s'il est trop vieux : chercher plus loin en cas de
    // version insuffisante contredirait le `PATH`, où l'ordre est la préférence de
    // l'utilisateur, et rendrait le verdict imprévisible.
    match lire_version(&chemin) {
        Some(version) => match regle_de_version(version, serveur) {
            VersionVerdict::Compatible => DumpAvailability::Ready {
                tool: chemin,
                version,
            },
            VersionVerdict::TropVieux { outil, serveur } => DumpAvailability::ToolTooOld {
                tool: outil,
                server: serveur,
            },
        },
        // Un fichier exécutable dont `--version` est illisible n'est pas l'outil attendu : le
        // traiter comme absent est la seule lecture honnête.
        None => DumpAvailability::ToolMissing { binary: binaire },
    }
}

/// Développe un motif à **au plus un `*`** par segment, en listant le répertoire parent.
///
/// Une dépendance `glob` pour ces six motifs serait payer une caisse pour un clou. Les
/// résultats sont triés à l'envers : `postgresql@18` passe avant `postgresql@17`, donc la
/// version la plus récente installée est essayée en premier.
fn developper(motif: &str) -> Vec<PathBuf> {
    let Some(position) = motif.find('*') else {
        return vec![PathBuf::from(motif)];
    };

    // **Le découpage se fait sur le segment qui porte l'étoile, et non par `Path::parent`.**
    // Deux défauts corrigés d'un coup le 31 août 2026, tous deux invisibles jusque-là :
    //
    //   - `Path::new("…/Versions/").parent()` rend `…/Contents` et `file_name()` rend
    //     `Versions`, parce que `Path` ignore la barre finale. Un motif dont l'étoile est un
    //     **segment entier** — `…/Versions/*/bin` — voyait donc `Versions` pris pour un préfixe
    //     de nom, et rendait `…/Versions/bin` : le repli Postgres.app n'a jamais fonctionné.
    //     Personne ne l'a vu parce que la mesure du 19 août notait « Postgres.app n'est pas
    //     installé » — le seul motif faux était le seul qui ne pouvait rien trouver.
    //   - `apres.split_once('/')` était écrit sur la barre oblique seule. Sous Windows, les
    //     motifs sont en `\`, donc rien ne se découpait.
    //
    // `std::path::is_separator` répond selon la plateforme : `/` seul sur Unix, `/` **et** `\`
    // sous Windows. C'est ce qui laisse les deux familles de motifs s'écrire naturellement.
    let debut = motif[..position]
        .rfind(std::path::is_separator)
        .map_or(0, |index| index + 1);
    let fin = motif[position..]
        .find(std::path::is_separator)
        .map_or(motif.len(), |index| index + position);

    let parent = PathBuf::from(&motif[..debut]);
    let prefixe = motif[debut..position].to_owned();
    let suffixe = &motif[position + 1..fin];
    // La suite du chemin, sa barre de tête retirée : `join` la remettrait, et un chemin
    // absolu en argument de `join` **remplacerait** la base au lieu de s'y ajouter.
    let suite = motif[fin..].trim_start_matches(std::path::is_separator);

    let Ok(entrees) = std::fs::read_dir(&parent) else {
        return vec![];
    };

    let mut trouves: Vec<PathBuf> = entrees
        .filter_map(Result::ok)
        .filter_map(|entree| {
            let nom = entree.file_name().to_string_lossy().to_string();
            // **La longueur est vérifiée contre les deux bouts, pas seulement le préfixe.**
            // Sans quoi un nom plus court que `prefixe + suffixe` satisfait `starts_with` et
            // `ends_with` en les faisant se chevaucher — l'étoile aurait alors remplacé
            // *moins* que rien. Le cas du segment entier (les deux vides) reste vrai pour tout
            // nom, ce qui est bien ce qu'une étoile seule veut dire.
            (nom.starts_with(&prefixe)
                && nom.ends_with(suffixe)
                && nom.len() >= prefixe.len() + suffixe.len())
            .then(|| parent.join(nom))
        })
        .collect();
    trouves.sort();
    trouves.reverse();

    if suite.is_empty() {
        trouves
    } else {
        trouves.into_iter().map(|base| base.join(suite)).collect()
    }
}

/// Lit la version en lançant `<binaire> --version`.
///
/// La sortie mesurée est `pg_dump (PostgreSQL) 17.4 (Homebrew)` — donc le premier jeton de
/// la forme `17.4` ou `17`, et **pas** le dernier : « (Homebrew) » n'en est pas un, mais un
/// paquet Debian écrit `17.6-1.pgdg13+1` en queue de ligne.
pub fn lire_version(binaire: &Path) -> Option<Version> {
    let sortie = Command::new(binaire).arg("--version").output().ok()?;
    if !sortie.status.success() {
        return None;
    }
    analyser_version(&String::from_utf8_lossy(&sortie.stdout))
}

/// Extrait la version d'une ligne de `--version`.
///
/// Séparée de son lancement pour être testable sans binaire.
pub fn analyser_version(ligne: &str) -> Option<Version> {
    ligne.split_whitespace().find_map(|jeton| {
        let jeton = jeton.trim_start_matches('v');
        let mut morceaux = jeton.split('.');
        let majeure: u32 = morceaux.next()?.parse().ok()?;
        // La mineure peut porter une queue de paquet (`6-1.pgdg13+1`) : seuls les chiffres
        // de tête comptent. Absente (`psql (PostgreSQL) 18`), elle vaut 0.
        let mineure = morceaux
            .next()
            .map(|brut| {
                brut.chars()
                    .take_while(char::is_ascii_digit)
                    .collect::<String>()
            })
            .and_then(|chiffres| chiffres.parse().ok())
            .unwrap_or(0);
        Some(Version::new(majeure, mineure))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    // Seul `faux_binaire` s'en sert, et il est `#[cfg(unix)]`.
    #[cfg(unix)]
    use std::io::Write;

    /// Un faux binaire qui annonce la version qu'on lui donne. Le seul moyen d'exercer
    /// `ToolTooOld` sans installer un PostgreSQL 13 sur la machine.
    ///
    /// **`#[cfg(unix)]` : le double est un script `sh`, pas le sujet.** Son équivalent Windows
    /// serait un `.cmd`, donc un second double à tenir honnête — et ce que ce test mesure, la
    /// règle de version, ne dépend d'aucune plateforme. Le porter coûterait une divergence
    /// possible entre les deux doubles pour ne rien mesurer de plus (règle 14 d'AGENTS.md : ce
    /// qu'un double émet doit venir d'une observation de l'original).
    #[cfg(unix)]
    fn faux_binaire(nom: &str, annonce: &str) -> tempfile::TempDir {
        let dossier = tempfile::tempdir().expect("dossier temporaire");
        let chemin = dossier.path().join(nom);
        let mut fichier = std::fs::File::create(&chemin).expect("création du faux binaire");
        writeln!(fichier, "#!/bin/sh\necho \"{annonce}\"").expect("écriture");
        drop(fichier);
        std::fs::set_permissions(&chemin, std::fs::Permissions::from_mode(0o755))
            .expect("droits d'exécution");
        dossier
    }
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    /// L'étoile comme **segment entier** — la forme du repli Postgres.app, et celle des deux
    /// motifs Windows.
    ///
    /// **C'est le test qui manquait, et son absence cachait un défaut livré.** Le code d'avant
    /// le 31 août 2026 rendait `<base>/bin` au lieu de `<base>/17/bin` : `Path::parent` ignore
    /// la barre finale, donc `Versions` était pris pour le préfixe d'un nom au lieu du dernier
    /// répertoire. Le repli Postgres.app n'a donc jamais rien trouvé. Sabotage vérifié : remis
    /// dans sa forme d'avant, ce test tombe et les quatre autres restent verts.
    #[test]
    fn une_etoile_de_segment_entier_developpe_chaque_sous_dossier() {
        let base = tempfile::tempdir().unwrap();
        for version in ["16", "17"] {
            std::fs::create_dir_all(base.path().join(version).join("bin")).unwrap();
        }

        let motif = format!("{}/*/bin", base.path().display());

        assert_eq!(
            developper(&motif),
            vec![
                base.path().join("17").join("bin"),
                base.path().join("16").join("bin"),
            ],
            "chaque sous-dossier, le plus récent d'abord"
        );
    }

    /// L'étoile **dans** un nom — la forme des `postgresql@N` de Homebrew.
    ///
    /// Le voisin `libpq` est là pour que le test distingue « développe » de « rend tout » :
    /// sans lui, une étoile qui ignorerait le préfixe passerait aussi.
    #[test]
    fn une_etoile_dans_un_nom_ne_retient_que_le_prefixe() {
        let base = tempfile::tempdir().unwrap();
        for nom in ["postgresql@16", "postgresql@17", "libpq"] {
            std::fs::create_dir_all(base.path().join(nom).join("bin")).unwrap();
        }

        let motif = format!("{}/postgresql@*/bin", base.path().display());

        assert_eq!(
            developper(&motif),
            vec![
                base.path().join("postgresql@17").join("bin"),
                base.path().join("postgresql@16").join("bin"),
            ],
            "`libpq` ne porte pas le préfixe et ne doit pas paraître"
        );
    }

    #[test]
    fn un_path_sans_pg_dump_donne_tool_missing() {
        let vide = tempfile::tempdir().unwrap();
        let verdict = decouvrir_dans(
            &[vide.path().to_path_buf()],
            &[],
            "pg_dump",
            Version::new(17, 6),
        );
        assert!(matches!(
            verdict,
            DumpAvailability::ToolMissing { binary: "pg_dump" }
        ));
    }

    #[cfg(unix)]
    #[test]
    fn un_faux_pg_dump_trop_vieux_donne_tool_too_old() {
        // Un script qui annonce la version 13 face à un serveur 17.
        let faux = faux_binaire("pg_dump", "pg_dump (PostgreSQL) 13.14");
        let verdict = decouvrir_dans(
            &[faux.path().to_path_buf()],
            &[],
            "pg_dump",
            Version::new(17, 6),
        );
        assert!(
            matches!(
                verdict,
                DumpAvailability::ToolTooOld { tool, server }
                    if tool.majeure == 13 && server.majeure == 17
            ),
            "{verdict:?}"
        );
    }

    /// Une version de serveur qu'aucun outil ne peut précéder.
    ///
    /// **Les deux tests de découverte ne doivent pas dépendre de la version installée**, et
    /// c'est la CI qui l'a montré : son runner porte `pg_dump` 16.15 face au décor 17.x, donc
    /// `ToolTooOld` — un verdict juste, mais qui ne dit rien de la *découverte*. La règle de
    /// version a son propre test, avec un faux binaire ; ici on ne mesure que « le binaire
    /// est trouvé ».
    const N_IMPORTE_QUEL_SERVEUR: Version = Version {
        majeure: 0,
        mineure: 0,
    };

    #[test]
    fn le_pg_dump_de_cette_machine_est_trouve() {
        let verdict = decouvrir("pg_dump", N_IMPORTE_QUEL_SERVEUR);
        assert!(
            matches!(verdict, DumpAvailability::Ready { .. }),
            "{verdict:?}"
        );
    }

    #[test]
    fn les_emplacements_connus_sont_cherches_meme_absents_du_path() {
        // Un `PATH` vide, mais les emplacements connus restent explorés — c'est le cas
        // d'une app lancée depuis le Finder, qui n'hérite pas du `PATH` du shell.
        let verdict = decouvrir_dans(&[], EMPLACEMENTS_CONNUS, "pg_dump", N_IMPORTE_QUEL_SERVEUR);
        assert!(
            matches!(verdict, DumpAvailability::Ready { .. }),
            "{verdict:?}"
        );
    }

    #[test]
    fn la_version_se_lit_dans_les_trois_formes_rencontrees() {
        // Les deux formes mesurées, plus celle d'un paquet Debian dont la queue
        // (`-1.pgdg13+1`) ferait échouer un `parse()` naïf.
        assert_eq!(
            analyser_version("pg_dump (PostgreSQL) 17.4 (Homebrew)"),
            Some(Version::new(17, 4))
        );
        assert_eq!(
            analyser_version("psql (PostgreSQL) 17.6 (Debian 17.6-1.pgdg13+1)"),
            Some(Version::new(17, 6))
        );
        assert_eq!(
            analyser_version("pg_dump (PostgreSQL) 18"),
            Some(Version::new(18, 0))
        );
        assert_eq!(analyser_version("une ligne sans version"), None);
    }
}
