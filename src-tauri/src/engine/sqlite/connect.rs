//! L'ouverture d'un fichier SQLite (`17a`).
//!
//! # Le seul moteur du projet sans serveur
//!
//! Ni hôte, ni port, ni utilisateur, ni mot de passe, ni TLS : cinq champs d'`ConnectionSettings` ne
//! veulent rien dire ici. **Le chemin du fichier vit dans `default_database`** — le champ est déjà
//! « la base à ouvrir », et pour SQLite la base *est* un fichier. Trois options avaient été pesées
//! en `17a` ; celle-ci n'ajoute aucun champ vide pour six moteurs sur sept, et aucune migration.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use crate::config::ConnectionSettings;
use crate::engine::EngineError;

/// Le chemin du fichier que cette variante désigne, **après vérification**.
///
/// Refuse une variante incohérente plutôt que de l'interpréter : un tunnel SSH devant un fichier
/// local n'a rien à traverser, et l'accepter laisserait croire qu'il protège quelque chose.
pub fn chemin_de(variante: &ConnectionSettings) -> Result<PathBuf, EngineError> {
    if variante.tunnel.is_some() {
        return Err(EngineError::local(
            "une base SQLite est un fichier local : un tunnel SSH n'a rien à traverser, et le \
             déclarer laisserait croire qu'il protège l'accès",
        ));
    }
    let brut = variante.default_database.trim();
    if brut.is_empty() {
        return Err(EngineError::local(
            "aucun chemin de fichier : pour SQLite, le champ « base par défaut » porte le chemin du \
             fichier .db",
        ));
    }
    // **`:memory:` est refusé.** Une base en mémoire n'a pas d'existence entre deux connexions :
    // l'ouvrir donnerait un arbre vide et l'utilisateur chercherait ses tables. C'est le même
    // arbitrage que le refus de créer un fichier absent, ci-dessous.
    if brut == ":memory:" {
        return Err(EngineError::local(
            "« :memory: » désigne une base qui n'existe qu'en mémoire : elle serait vide à chaque \
             ouverture. Indiquez le chemin d'un fichier",
        ));
    }
    Ok(PathBuf::from(expanser_le_tilde(brut)))
}

/// Remplace un `~` de tête par le répertoire personnel.
///
/// Le champ est tapé à la main dans `A2`, et `~/bases/atelier.db` est ce qu'on écrit. Sans cette
/// expansion, le fichier serait cherché dans un répertoire nommé `~`.
fn expanser_le_tilde(brut: &str) -> String {
    let Some(reste) = brut.strip_prefix('~') else {
        return brut.to_owned();
    };
    match std::env::var_os("HOME") {
        Some(maison) => format!("{}{}", maison.to_string_lossy(), reste),
        None => brut.to_owned(),
    }
}

/// Ouvre le fichier, **sans le créer**.
///
/// # Pourquoi ce drapeau compte plus qu'il n'y paraît
///
/// `sqlite3_open` crée le fichier absent, silencieusement. C'est ce que veut un programme qui possède
/// sa base ; c'est l'inverse de ce que veut un explorateur. Un chemin mal tapé donnerait une base
/// vide, l'arbre l'afficherait sans erreur, et l'utilisateur chercherait ses tables dans un fichier
/// que DoraBase vient de fabriquer.
///
/// `OpenFlags::SQLITE_OPEN_READ_WRITE` **sans** `SQLITE_OPEN_CREATE` : un fichier absent est une
/// erreur qui le dit. Même famille de décision que le refus de `05b` d'écraser un fichier illisible.
pub fn ouvrir(chemin: &Path) -> Result<Connection, EngineError> {
    // Vérifié **avant** l'appel, pour que le message dise « absent » et non « impossible d'ouvrir ».
    // SQLite ne distingue pas les deux dans son code d'erreur.
    if !chemin.exists() {
        return Err(EngineError::local(format!(
            "le fichier « {} » n'existe pas. DoraBase ne le crée pas : un chemin mal tapé donnerait \
             une base vide",
            chemin.display()
        )));
    }
    if chemin.is_dir() {
        return Err(EngineError::local(format!(
            "« {} » est un répertoire, pas un fichier de base",
            chemin.display()
        )));
    }

    let connexion = Connection::open_with_flags(
        chemin,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|erreur| super::error::traduire_a_l_ouverture(&erreur, chemin))?;

    // **Une lecture d'essai, tout de suite.** `Connection::open` réussit sur un fichier qui n'est pas
    // une base : SQLite ne lit l'en-tête qu'à la première requête. Sans cette sonde, l'échec
    // surviendrait au premier dépliage de l'arbre, où il se lirait comme un problème
    // d'introspection.
    connexion
        .prepare("select count(*) from sqlite_master")
        .and_then(|mut requete| requete.query_row([], |ligne| ligne.get::<_, i64>(0)))
        .map_err(|erreur| super::error::traduire_a_l_ouverture(&erreur, chemin))?;

    // **WAL plutôt que le journal par défaut**, quand le fichier le permet : il laisse un lecteur
    // travailler pendant qu'un autre programme écrit, ce qui est exactement le cas d'un explorateur
    // ouvert à côté d'une application. Un échec n'est pas grave — un fichier en lecture seule ou sur
    // un montage réseau le refuse — donc il est ignoré.
    let _ = connexion.pragma_update(None, "journal_mode", "WAL");

    // Les clés étrangères ne sont pas vérifiées par défaut en SQLite, et `11d` promet qu'une écriture
    // refusée l'est **avant** de casser quelque chose. Les activer fait échouer une modification qui
    // violerait une référence, au lieu de la laisser passer.
    let _ = connexion.pragma_update(None, "foreign_keys", true);

    Ok(connexion)
}

/// La version de SQLite et la taille du fichier, pour le test de connexion de `A2`.
///
/// « SQLite 3.46.0 · 4,2 Mo » : la taille remplace ce qu'un serveur dirait de lui-même, et c'est la
/// seule chose qu'un fichier ait à annoncer.
pub fn version_et_taille(chemin: &Path) -> String {
    let octets = std::fs::metadata(chemin).map(|m| m.len()).unwrap_or(0);
    format!(
        "SQLite {} · {}",
        rusqlite::version(),
        crate::engine::sqlite::error::taille_lisible(octets)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Proxy, ProxySsh, SslMode, Tunnel};

    fn variante(chemin: &str) -> ConnectionSettings {
        ConnectionSettings {
            host: String::new(),
            port: 0,
            default_database: chemin.to_owned(),
            username: String::new(),
            password: None,
            ssl_mode: SslMode::Disable,
            ca_certificate: None,
            auth_database: None,
            read_only: false,
            reconnect_on_startup: false,
            tunnel: None,
        }
    }

    #[test]
    fn le_chemin_vient_du_champ_base_par_defaut() {
        assert_eq!(
            chemin_de(&variante("/tmp/atelier.db")).unwrap(),
            PathBuf::from("/tmp/atelier.db")
        );
    }

    #[test]
    fn un_tilde_de_tete_est_expanse() {
        // `~/bases/atelier.db` est ce qu'on tape. Sans expansion, le fichier serait cherché dans un
        // répertoire littéralement nommé « ~ ».
        let chemin = chemin_de(&variante("~/atelier.db")).unwrap();
        assert!(chemin.is_absolute(), "{chemin:?}");
        assert!(!chemin.to_string_lossy().starts_with('~'), "{chemin:?}");
    }

    #[test]
    fn un_tunnel_declare_devant_un_fichier_est_refuse() {
        let mut avec_tunnel = variante("/tmp/atelier.db");
        avec_tunnel.tunnel = Some(Tunnel {
            local_port: None,
            proxy: Proxy::Ssh(ProxySsh {
                bastion_host: "bastion.exemple.test".into(),
                bastion_port: 22,
                username: "clement".into(),
                private_key_path: "~/.ssh/id_ed25519".into(),
            }),
        });
        // L'accepter laisserait croire que le tunnel protège l'accès à un fichier local.
        let erreur = chemin_de(&avec_tunnel).expect_err("doit refuser");
        assert!(
            erreur.message.contains("fichier local"),
            "{}",
            erreur.message
        );
    }

    #[test]
    fn une_base_en_memoire_est_refusee() {
        let erreur = chemin_de(&variante(":memory:")).expect_err("doit refuser");
        // Elle serait vide à chaque ouverture, et l'arbre le montrerait sans rien expliquer.
        assert!(erreur.message.contains("mémoire"), "{}", erreur.message);
    }

    #[test]
    fn un_chemin_vide_dit_ou_le_mettre() {
        let erreur = chemin_de(&variante("   ")).expect_err("doit refuser");
        assert!(
            erreur.message.contains("base par défaut"),
            "{}",
            erreur.message
        );
    }

    #[test]
    fn un_fichier_absent_est_refuse_et_n_est_pas_cree() {
        let dossier = tempfile::tempdir().unwrap();
        let chemin = dossier.path().join("nulle-part.db");

        let erreur = ouvrir(&chemin).expect_err("doit refuser");
        assert!(
            erreur.message.contains("n'existe pas"),
            "{}",
            erreur.message
        );
        // **Le point de `17a`** : `sqlite3_open` crée le fichier absent. Un chemin mal tapé donnerait
        // une base vide que DoraBase vient de fabriquer.
        assert!(
            !chemin.exists(),
            "aucun fichier ne doit avoir été créé : {chemin:?}"
        );
    }

    #[test]
    fn un_repertoire_le_dit_plutot_que_d_echouer_sur_l_en_tete() {
        let dossier = tempfile::tempdir().unwrap();
        let erreur = ouvrir(dossier.path()).expect_err("doit refuser");
        assert!(erreur.message.contains("répertoire"), "{}", erreur.message);
    }

    #[test]
    fn un_fichier_qui_n_est_pas_une_base_le_dit() {
        let dossier = tempfile::tempdir().unwrap();
        let chemin = dossier.path().join("pas-une-base.db");
        std::fs::write(&chemin, b"ceci est du texte, pas une base\n").unwrap();

        // **Distinct d'un problème de permission** : les confondre enverrait chercher un droit
        // d'accès là où le chemin désigne autre chose.
        let erreur = ouvrir(&chemin).expect_err("doit refuser");
        assert!(
            erreur.message.contains("n'est pas une base SQLite"),
            "{}",
            erreur.message
        );
    }

    #[test]
    fn un_fichier_valide_s_ouvre_et_annonce_sa_version() {
        let dossier = tempfile::tempdir().unwrap();
        let chemin = dossier.path().join("atelier.db");
        Connection::open(&chemin)
            .unwrap()
            .execute_batch("create table t (a integer)")
            .unwrap();

        assert!(ouvrir(&chemin).is_ok());
        let annonce = version_et_taille(&chemin);
        assert!(annonce.starts_with("SQLite 3."), "{annonce}");
        // La taille remplace ce qu'un serveur dirait de lui-même.
        assert!(annonce.contains('·'), "{annonce}");
    }
}
