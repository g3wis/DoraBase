//! Le lancement du sous-processus, l'écriture, la progression et l'annulation.
//!
//! **Commun à tous les moteurs** : seul l'argv et l'environnement viennent du `DumpTool`.
//!
//! **Aucun shell.** `std::process::Command` avec un argv direct : aucune surface de
//! citation ni d'injection, et un chemin de fichier avec des espaces ou des guillemets
//! passe sans traitement.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use super::{Cible, DumpTool};
use crate::engine::programme;
use crate::secrets::Secret;

/// Le rythme de sondage : progression, fin du fils, demande d'annulation.
///
/// 120 ms est assez court pour qu'une annulation paraisse immédiate, assez long pour que
/// le `stat` du fichier ne pèse rien face à un dump de 100 000 lignes.
const PERIODE_DE_SONDAGE: std::time::Duration = std::time::Duration::from_millis(120);

/// Ce qui peut mal tourner, et que la modale doit pouvoir dire.
///
/// **Aucune variante ne porte de secret** : `stderr` vient de l'outil, qui n'imprime jamais
/// `PGPASSWORD`, et un test à sentinelle le garde (`aucune_trace_du_mot_de_passe_dans_une_erreur`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DumpError {
    /// L'utilisateur a annulé. Le fichier partiel a été supprimé.
    Annule,
    /// Le binaire n'a pas pu être lancé du tout — droits, chemin devenu faux.
    Lancement { binaire: String, cause: String },
    /// Le fichier de destination n'a pas pu être écrit ou supprimé.
    Fichier { chemin: PathBuf, cause: String },
    /// L'outil a rendu un code non nul. `stderr` est **capturé, jamais jeté** : c'est tout
    /// le rapport d'erreur dont l'utilisateur dispose.
    Echec {
        binaire: String,
        code: Option<i32>,
        stderr: String,
    },
    /// Le fichier proposé à l'import est tronqué : le pied de complétude manque. Sans ce
    /// refus, `psql` l'importe **partiellement et en silence**, avec `exit=0`.
    Tronque,
}

impl std::fmt::Display for DumpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Annule => write!(f, "export annulé ; le fichier partiel a été supprimé"),
            Self::Lancement { binaire, cause } => {
                write!(f, "{binaire} n'a pas pu être lancé : {cause}")
            }
            Self::Fichier { chemin, cause } => {
                write!(f, "le fichier « {} » : {cause}", chemin.display())
            }
            Self::Echec {
                binaire,
                code,
                stderr,
            } => {
                let code = code
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "interrompu".to_string());
                write!(f, "{binaire} a échoué (code {code}) : {}", stderr.trim())
            }
            Self::Tronque => write!(
                f,
                "le fichier est incomplet : le pied « PostgreSQL database dump complete » manque, \
                 donc l'import a été refusé avant de lancer psql"
            ),
        }
    }
}

impl std::error::Error for DumpError {}

/// La demande d'annulation, partagée entre la commande et la tâche.
///
/// Un `AtomicBool` clonable plutôt que le couple `(annulation, jeton)` prévu par le plan :
/// il n'y a rien à transmettre qu'un booléen, et deux types pour un booléen se seraient
/// contentés de se recopier l'un l'autre.
#[derive(Debug, Clone, Default)]
pub struct Annulation(Arc<AtomicBool>);

impl Annulation {
    pub fn nouvelle() -> Self {
        Self::default()
    }

    pub fn annuler(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn demandee(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Exporte vers `fichier`, et rend le nombre d'octets écrits.
///
/// **La progression est un nombre d'octets, sans total ni pourcentage.**
/// `pg_dump --format=plain` n'émet aucune progression exploitable et la taille finale est
/// inconnaissable avant la fin : afficher un pourcentage présenterait une estimation comme
/// un fait exact.
///
/// **À l'échec comme à l'annulation, le fichier partiel est supprimé.** Un dump tronqué qui
/// ressemble à une sauvegarde est l'artefact dangereux de cette feature — et c'est aussi ce
/// qui donne son sens au contrôle de pied de `22c`.
pub async fn exporter(
    outil: &(dyn DumpTool + Send + Sync),
    binaire: &Path,
    cible: &Cible,
    mot_de_passe: Option<&Secret>,
    fichier: &Path,
    progression: impl Fn(u64) + Send + Sync,
    annulation: &Annulation,
) -> Result<u64, DumpError> {
    let argv = outil.export_argv(cible, fichier);
    let issue = executer(
        outil,
        binaire,
        cible,
        &argv,
        mot_de_passe,
        Some((fichier, &progression as &(dyn Fn(u64) + Send + Sync))),
        annulation,
    )
    .await;

    match issue {
        Ok(()) => {
            let octets = std::fs::metadata(fichier)
                .map(|meta| meta.len())
                .unwrap_or(0);
            progression(octets);
            Ok(octets)
        }
        Err(erreur) => {
            // Le fichier partiel ne survit ni à l'échec ni à l'annulation.
            supprimer(fichier);
            Err(erreur)
        }
    }
}

/// Rejoue `fichier` vers la cible. Symétrique d'`exporter`, à trois différences près :
/// aucun fichier n'est créé donc rien n'est à supprimer, la progression n'a pas de support
/// (le fichier ne grossit pas, il est lu), et le `stderr` de `psql` porte la ligne fautive.
pub async fn importer(
    outil: &(dyn DumpTool + Send + Sync),
    binaire: &Path,
    cible: &Cible,
    mot_de_passe: Option<&Secret>,
    fichier: &Path,
    annulation: &Annulation,
) -> Result<(), DumpError> {
    let argv = outil.import_argv(cible, fichier);
    executer(outil, binaire, cible, &argv, mot_de_passe, None, annulation).await
}

/// Le lancement commun. `surveille` est le fichier dont la taille sert de progression.
async fn executer(
    outil: &(dyn DumpTool + Send + Sync),
    binaire: &Path,
    cible: &Cible,
    argv: &[std::ffi::OsString],
    mot_de_passe: Option<&Secret>,
    surveille: Option<(&Path, &(dyn Fn(u64) + Send + Sync))>,
    annulation: &Annulation,
) -> Result<(), DumpError> {
    let mut commande = programme::commande(binaire);
    commande.args(argv);
    commande.envs(outil.child_env(cible, mot_de_passe.map(Secret::expose)));
    // `stdin` fermé : aucun outil ne doit pouvoir attendre une saisie sur un terminal qui
    // n'existe pas. `--no-password` le dit déjà à `pg_dump`, ceci le rend structurel.
    commande.stdin(Stdio::null());
    // Le `stdout` de l'export est vide (`--file` écrit le fichier) et celui de l'import ne
    // porte que les accusés de `psql` : les deux sont jetés, `stderr` seul est le rapport.
    commande.stdout(Stdio::null());
    commande.stderr(Stdio::piped());

    let mut enfant = commande.spawn().map_err(|cause| DumpError::Lancement {
        binaire: binaire.display().to_string(),
        cause: cause.to_string(),
    })?;

    // Le `stderr` est drainé par un fil dédié : un tube plein bloquerait le fils, et un
    // `psql` bavard sur une grosse erreur en produit assez pour le remplir.
    let journal = Arc::new(Mutex::new(String::new()));
    let flux = enfant.stderr.take();
    let recopie = {
        let journal = Arc::clone(&journal);
        std::thread::spawn(move || {
            if let Some(mut flux) = flux {
                let mut tampon = String::new();
                use std::io::Read;
                let _ = flux.read_to_string(&mut tampon);
                if let Ok(mut journal) = journal.lock() {
                    journal.push_str(&tampon);
                }
            }
        })
    };

    let nom = nom_du_binaire(binaire);
    let statut = loop {
        if annulation.demandee() {
            // Tuer **puis** attendre : sans le `wait`, le fils resterait zombie et le
            // fichier pourrait encore grossir d'un tampon après la suppression.
            let _ = enfant.kill();
            let _ = enfant.wait();
            let _ = recopie.join();
            return Err(DumpError::Annule);
        }

        match enfant.try_wait() {
            Ok(Some(statut)) => break statut,
            Ok(None) => {}
            Err(cause) => {
                return Err(DumpError::Lancement {
                    binaire: nom,
                    cause: cause.to_string(),
                })
            }
        }

        if let Some((fichier, rapporter)) = surveille {
            if let Ok(meta) = std::fs::metadata(fichier) {
                rapporter(meta.len());
            }
        }

        tokio::time::sleep(PERIODE_DE_SONDAGE).await;
    };

    let _ = recopie.join();
    let stderr = journal
        .lock()
        .map(|texte| texte.clone())
        .unwrap_or_default();

    if statut.success() {
        Ok(())
    } else {
        Err(DumpError::Echec {
            binaire: nom,
            code: statut.code(),
            stderr,
        })
    }
}

/// Le nom du binaire, sans son chemin : un message d'erreur dit « pg_dump a échoué », pas
/// `/opt/homebrew/opt/postgresql@17/bin/pg_dump a échoué`.
fn nom_du_binaire(binaire: &Path) -> String {
    binaire
        .file_name()
        .map(|nom| nom.to_string_lossy().to_string())
        .unwrap_or_else(|| binaire.display().to_string())
}

fn supprimer(fichier: &Path) {
    // L'échec de la suppression n'a personne à qui se plaindre : l'erreur d'origine est
    // plus intéressante, et la taire serait pire que de ne pas la remonter.
    if let Err(cause) = std::fs::remove_file(fichier) {
        if cause.kind() != std::io::ErrorKind::NotFound {
            log::warn!(
                "le fichier partiel « {} » n'a pas pu être supprimé : {cause}",
                fichier.display()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dump::postgres::PostgresDumpTool;
    use std::ffi::OsStr;

    /// La sentinelle : une valeur qu'aucun outil ne peut produire par hasard, donc sa
    /// présence dans un argv ou un message est forcément une fuite.
    const SENTINELLE_MOT_DE_PASSE: &str = "sentinelle-22b-ne-doit-jamais-fuiter";

    fn cible_de_test() -> Cible {
        Cible {
            hote: "localhost".into(),
            port: 55432,
            base: "dorabase_test".into(),
            utilisateur: "dorabase".into(),
            ssl_mode: crate::config::SslMode::Disable,
            ca_certificate: None,
        }
    }

    fn rendu(argv: &[std::ffi::OsString]) -> String {
        argv.join(OsStr::new(" ")).to_string_lossy().to_string()
    }

    #[test]
    fn le_mot_de_passe_n_est_jamais_dans_l_argv() {
        let outil = PostgresDumpTool;
        let argv = outil.export_argv(&cible_de_test(), Path::new("/tmp/x.sql"));
        let rendu = rendu(&argv);
        assert!(
            !rendu.contains(SENTINELLE_MOT_DE_PASSE),
            "le mot de passe est dans l'argv, visible par `ps` : {rendu}"
        );
        // Contrôle positif : l'argv porte bien de quoi se connecter, sinon l'assertion
        // ci-dessus passerait sur un argv vide.
        assert!(rendu.contains("--username"), "{rendu}");
        assert!(rendu.contains("--format=plain"), "{rendu}");
    }

    #[test]
    fn le_mot_de_passe_est_bien_dans_l_environnement_du_fils() {
        // Contrôle positif : sans lui, le test précédent passerait aussi si le mot de
        // passe n'était transmis nulle part et que le dump ne marchait pas du tout.
        let env = PostgresDumpTool.child_env(&cible_de_test(), Some(SENTINELLE_MOT_DE_PASSE));
        assert_eq!(
            env.iter()
                .find(|(cle, _)| cle == "PGPASSWORD")
                .map(|(_, valeur)| valeur.as_str()),
            Some(SENTINELLE_MOT_DE_PASSE)
        );
    }

    #[test]
    fn la_base_passe_par_l_environnement_et_jamais_par_l_argv() {
        // #84 : `--dbname` est relu comme une conninfo par libpq. Une base qui en est une ne
        // doit donc apparaître nulle part dans l'argv, sous aucune forme.
        let cible = Cible {
            base: "host=127.0.0.1 port=15432 dbname=piege".into(),
            ..cible_de_test()
        };
        for argv in [
            PostgresDumpTool.export_argv(&cible, Path::new("/tmp/x.sql")),
            PostgresDumpTool.import_argv(&cible, Path::new("/tmp/x.sql")),
        ] {
            let rendu = rendu(&argv);
            assert!(!rendu.contains("--dbname"), "{rendu}");
            assert!(!rendu.contains("port=15432"), "{rendu}");
        }
        // Et elle part **même sans mot de passe** : sans cela, une connexion par `.pgpass`
        // ou `trust` joindrait la base par défaut de libpq — le nom de l'utilisateur.
        let env = PostgresDumpTool.child_env(&cible, None);
        assert_eq!(
            env.iter()
                .find(|(cle, _)| cle == "PGDATABASE")
                .map(|(_, valeur)| valeur.as_str()),
            Some(cible.base.as_str()),
            "l'environnement du fils doit porter la base, même sans secret"
        );
        assert!(
            env.iter().all(|(cle, _)| cle != "PGPASSWORD"),
            "aucun `PGPASSWORD` sans secret : {env:?}"
        );
    }

    #[tokio::test]
    async fn une_base_qui_ressemble_a_une_conninfo_ne_detourne_pas_le_dump() {
        // Le chemin, pas seulement l'argv (règle n° 2) : un vrai `pg_dump`, un hôte déclaré
        // sans rien derrière, et une base dont la conninfo vise un piège qui compte ce qui
        // l'atteint. Avant #84, le piège recevait la connexion — et `PGPASSWORD` avec elle.
        let binaire = match crate::dump::discover::decouvrir("pg_dump", Version::new(0, 0)) {
            crate::dump::DumpAvailability::Ready { tool, .. } => tool,
            autre => panic!("pg_dump introuvable sur cette machine : {autre:?}"),
        };
        let piege = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port_du_piege = piege.local_addr().unwrap().port();
        let atteint = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let compteur = atteint.clone();
        // Chaque connexion est comptée puis fermée aussitôt : un `pg_dump` détourné échoue
        // alors vite, au lieu d'attendre une réponse à son `SSLRequest`.
        let ecoute = tokio::spawn(async move {
            while let Ok((flux, _)) = piege.accept().await {
                compteur.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                drop(flux);
            }
        });

        let dossier = tempfile::tempdir().unwrap();
        let cible = Cible {
            hote: "127.0.0.1".into(),
            // Le serveur déclaré : un port fermé, refus immédiat et sans réseau.
            port: 1,
            base: format!("host=127.0.0.1 port={port_du_piege} dbname=piege"),
            ..cible_de_test()
        };
        let erreur = exporter(
            &PostgresDumpTool,
            &binaire,
            &cible,
            Some(&Secret::new(SENTINELLE_MOT_DE_PASSE)),
            &dossier.path().join("x.sql"),
            |_| {},
            &Annulation::nouvelle(),
        )
        .await
        .expect_err("le serveur déclaré est fermé : l'export doit échouer");
        ecoute.abort();

        assert_eq!(
            atteint.load(std::sync::atomic::Ordering::SeqCst),
            0,
            "pg_dump a joint le serveur désigné par le nom de base : {erreur}"
        );
        // Contrôle positif : l'échec est bien celui du serveur **déclaré**, sans quoi un
        // `pg_dump` qui ne se lancerait pas du tout laisserait le piège vide aussi.
        assert!(format!("{erreur}").contains("port 1 "), "{erreur}");
    }

    #[tokio::test]
    async fn aucune_trace_du_mot_de_passe_dans_une_erreur() {
        // Un hôte qui ne répond pas : `pg_dump` existe, se lance, et échoue. C'est le
        // chemin d'erreur que la modale affichera le plus souvent.
        let outil = PostgresDumpTool;
        // Version de serveur nulle : ce test mesure le **chemin d'erreur** du lancement, pas
        // la règle de version — et le `pg_dump` du runner de CI est plus ancien que le décor.
        let binaire = match crate::dump::discover::decouvrir("pg_dump", Version::new(0, 0)) {
            crate::dump::DumpAvailability::Ready { tool, .. } => tool,
            autre => panic!("pg_dump introuvable sur cette machine : {autre:?}"),
        };
        let dossier = tempfile::tempdir().unwrap();
        let fichier = dossier.path().join("echec.sql");
        let cible = Cible {
            hote: "127.0.0.1".into(),
            // Un port sans rien derrière : le refus est immédiat et sans réseau.
            port: 1,
            base: "dorabase_test".into(),
            utilisateur: "dorabase".into(),
            ssl_mode: crate::config::SslMode::Disable,
            ca_certificate: None,
        };

        let erreur = exporter(
            &outil,
            &binaire,
            &cible,
            Some(&Secret::new(SENTINELLE_MOT_DE_PASSE)),
            &fichier,
            |_| {},
            &Annulation::nouvelle(),
        )
        .await
        .expect_err("un port fermé doit faire échouer l'export");

        assert!(
            !format!("{erreur:?}").contains(SENTINELLE_MOT_DE_PASSE),
            "le mot de passe a fui dans l'erreur : {erreur:?}"
        );
        // Contrôle positif : l'erreur porte bien quelque chose d'utile.
        assert!(format!("{erreur}").contains("pg_dump"), "{erreur}");
        // Et le fichier partiel n'a pas survécu.
        assert!(!fichier.exists(), "un fichier est resté après l'échec");
    }

    /// Ce qu'un intermédiaire voit : un faux serveur qui **refuse TLS** puis note si le client
    /// poursuit en clair. Rend `true` si un `StartupMessage` — nom d'utilisateur et base en clair,
    /// et juste après, le mot de passe si le serveur le demande — lui est parvenu.
    fn intermediaire_qui_refuse_tls() -> (u16, std::thread::JoinHandle<bool>) {
        use std::io::{Read, Write};
        let ecoute = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = ecoute.local_addr().unwrap().port();
        let fil = std::thread::spawn(move || {
            let Ok((mut flux, _)) = ecoute.accept() else {
                return false;
            };
            flux.set_read_timeout(Some(std::time::Duration::from_secs(10)))
                .unwrap();
            loop {
                let mut entete = [0u8; 8];
                if flux.read_exact(&mut entete).is_err() {
                    // Le client a raccroché sans rien envoyer de plus.
                    return false;
                }
                let code = u32::from_be_bytes([entete[4], entete[5], entete[6], entete[7]]);
                match code {
                    // `SSLRequest` et `GSSENCRequest` : refusés, comme le ferait un intermédiaire.
                    80_877_103 | 80_877_104 => {
                        if flux.write_all(b"N").is_err() {
                            return false;
                        }
                    }
                    // Tout le reste est un `StartupMessage` : le client a poursuivi en clair.
                    _ => return true,
                }
            }
        });
        (port, fil)
    }

    fn pg_dump_de_la_machine() -> PathBuf {
        match crate::dump::discover::decouvrir("pg_dump", Version::new(0, 0)) {
            crate::dump::DumpAvailability::Ready { tool, .. } => tool,
            autre => panic!("pg_dump introuvable sur cette machine : {autre:?}"),
        }
    }

    async fn exporter_vers(port: u16, ssl_mode: crate::config::SslMode, secret: Option<&Secret>) {
        let dossier = tempfile::tempdir().unwrap();
        let cible = Cible {
            hote: "127.0.0.1".into(),
            port,
            ssl_mode,
            ..cible_de_test()
        };
        let _ = exporter(
            &PostgresDumpTool,
            &pg_dump_de_la_machine(),
            &cible,
            secret,
            &dossier.path().join("x.sql"),
            |_| {},
            &Annulation::nouvelle(),
        )
        .await;
    }

    /// #82, rejoué contre le vrai `pg_dump` : dans un mode qui exige TLS, il doit raccrocher
    /// quand l'intermédiaire le refuse, **avant** d'avoir rien dit de la connexion en clair.
    ///
    /// **`require` autant que `verify-full`**, et ce n'est pas une redondance : en `verify-full`
    /// sans autorité, c'est `PGSSLROOTCERT=system` qui part, et libpq ≥ 16 en déduit **seul**
    /// `verify-full` — retirer `PGSSLMODE` y laissait le test vert (vérifié par sabotage).
    /// `require` ne pose aucune racine : c'est `PGSSLMODE` seul qui l'y fait refuser.
    ///
    /// **Avec et sans mot de passe** : l'environnement du fils n'était posé que s'il y en avait
    /// un, et c'est ce chemin-là que seul ce test exerce de bout en bout.
    #[tokio::test]
    async fn un_intermediaire_qui_refuse_tls_ne_recoit_rien_quand_tls_est_exige() {
        let secret = Secret::new(SENTINELLE_MOT_DE_PASSE);
        for mode in [
            crate::config::SslMode::Require,
            crate::config::SslMode::VerifyFull,
        ] {
            for mot_de_passe in [Some(&secret), None] {
                let (port, fil) = intermediaire_qui_refuse_tls();
                exporter_vers(port, mode, mot_de_passe).await;
                assert!(
                    !fil.join().unwrap(),
                    "pg_dump a poursuivi en clair devant un serveur qui refusait TLS \
                     ({mode:?}, mot de passe : {})",
                    mot_de_passe.is_some()
                );
            }
        }
    }

    /// Le contrôle positif : sans lui, le test précédent passerait aussi sur un faux serveur
    /// incapable de voir un `StartupMessage`. En `prefer`, le repli en clair est le comportement
    /// voulu — et c'était celui de **tous** les dumps avant #82.
    #[tokio::test]
    async fn l_intermediaire_voit_bien_le_repli_en_clair_de_prefer() {
        let (port, fil) = intermediaire_qui_refuse_tls();
        let secret = Secret::new(SENTINELLE_MOT_DE_PASSE);
        exporter_vers(port, crate::config::SslMode::Prefer, Some(&secret)).await;
        assert!(fil.join().unwrap(), "le faux serveur n'a rien vu arriver");
    }

    use crate::dump::Version;

    /// Un outil **lent**, qui écrit une ligne toutes les 50 ms jusqu'à ce qu'on le tue.
    ///
    /// **Pourquoi pas `pg_dump` ici.** Le plan `22b` prévoyait d'annuler un dump réel de la
    /// table `grande` « qui dure assez pour être annulé ». Mesuré le 20 août 2026, ce dump
    /// prend **0,136 s** — moins que deux tours de sondage. Le test aurait été à pile ou
    /// face, et une annulation testée par un test qui passe une fois sur deux ne teste
    /// rien. Le chemin exercé est exactement le même : `run::exporter`, son sondage, son
    /// `kill` et sa suppression. Le fichier réel, lui, est couvert par
    /// `tests_reels::annuler_un_export_reel_ne_laisse_aucun_fichier`.
    /// `#[cfg(unix)]` avec le script qu'il pilote : voir `script_lent`.
    #[cfg(unix)]
    struct OutilLent;

    #[cfg(unix)]
    impl DumpTool for OutilLent {
        fn binaire_export(&self) -> &'static str {
            "lent"
        }
        fn binaire_import(&self) -> &'static str {
            "lent"
        }
        fn export_argv(&self, _cible: &Cible, fichier: &Path) -> Vec<std::ffi::OsString> {
            vec![fichier.into()]
        }
        fn import_argv(&self, _cible: &Cible, fichier: &Path) -> Vec<std::ffi::OsString> {
            vec![fichier.into()]
        }
        fn child_env(&self, cible: &Cible, mot_de_passe: Option<&str>) -> Vec<(String, String)> {
            PostgresDumpTool.child_env(cible, mot_de_passe)
        }
    }

    /// Le script du faux outil lent, écrit dans un dossier temporaire.
    ///
    /// **`#[cfg(unix)]`, comme les deux tests qu'il sert.** La règle 3 d'AGENTS.md dit pourquoi
    /// ce double existe : un vrai `pg_dump` de 100 000 lignes prend 0,136 s, donc l'annulation
    /// ne peut être exercée que contre un outil délibérément lent. Ce qu'elle mesure — que
    /// l'annulation coupe le sous-processus et ne laisse aucun fichier partiel — ne dépend
    /// d'aucune plateforme ; c'est le **double** qui est un script `sh`.
    ///
    /// Un jumeau `.cmd` serait un second double à tenir honnête, et la règle 14 avertit que ce
    /// qu'un double émet doit venir d'une observation de l'original. On préfère donc ne pas
    /// exercer ce chemin sous Windows que l'exercer contre un double dont personne n'a vérifié
    /// qu'il ressemble à `pg_dump`. À reprendre si l'annulation devient suspecte là-bas.
    #[cfg(unix)]
    fn script_lent(dossier: &Path) -> PathBuf {
        let chemin = dossier.join("lent");
        crate::engine::programme::poser_un_executable(
            &chemin,
            "#!/bin/sh\n: > \"$1\"\ni=0\nwhile [ $i -lt 400 ]; do\n  echo \"-- ligne $i\" >> \"$1\"\n  sleep 0.05\n  i=$((i+1))\ndone\n",
        );
        chemin
    }

    #[cfg(unix)]
    async fn attendre_que_le_fichier_grossisse(fichier: &Path) {
        for _ in 0..200 {
            if std::fs::metadata(fichier)
                .map(|meta| meta.len() > 0)
                .unwrap_or(false)
            {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!("le fichier n'a jamais grossi : rien à annuler");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn annuler_en_cours_ne_laisse_aucun_fichier() {
        let dossier = tempfile::tempdir().unwrap();
        let script = script_lent(dossier.path());
        let fichier = dossier.path().join("annule.sql");
        let annulation = Annulation::nouvelle();
        let cible = cible_de_test();

        // `join!` plutôt qu'un `spawn` : les emprunts restent locaux, donc rien n'a besoin
        // d'être `'static` pour être annulé.
        let (issue, ()) = tokio::join!(
            exporter(
                &OutilLent,
                &script,
                &cible,
                None,
                &fichier,
                |_| {},
                &annulation,
            ),
            async {
                attendre_que_le_fichier_grossisse(&fichier).await;
                annulation.annuler();
            }
        );

        assert!(matches!(issue, Err(DumpError::Annule)), "{issue:?}");
        assert!(
            !fichier.exists(),
            "un dump partiel a survécu à l'annulation : {fichier:?}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn la_progression_est_un_nombre_d_octets_croissant() {
        // Contrôle positif du test précédent : sans lui, `annuler_en_cours…` passerait
        // aussi si la progression n'était jamais rapportée et le fichier jamais écrit.
        let dossier = tempfile::tempdir().unwrap();
        let script = script_lent(dossier.path());
        let fichier = dossier.path().join("progresse.sql");
        let annulation = Annulation::nouvelle();
        let cible = cible_de_test();
        let vues = Arc::new(Mutex::new(Vec::<u64>::new()));

        let observees = Arc::clone(&vues);
        let (_issue, ()) = tokio::join!(
            exporter(
                &OutilLent,
                &script,
                &cible,
                None,
                &fichier,
                move |octets| observees.lock().unwrap().push(octets),
                &annulation,
            ),
            async {
                attendre_que_le_fichier_grossisse(&fichier).await;
                // Trois tours de sondage, le temps que d'autres mesures tombent.
                tokio::time::sleep(PERIODE_DE_SONDAGE * 3).await;
                annulation.annuler();
            }
        );

        let vues = vues.lock().unwrap().clone();
        assert!(vues.iter().any(|&octets| octets > 0), "{vues:?}");
        assert!(
            vues.windows(2).all(|paire| paire[0] <= paire[1]),
            "la progression a reculé : {vues:?}"
        );
    }
}
