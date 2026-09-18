//! Les tests de dump **sur base réelle**, derrière la feature `db-tests`.
//!
//! ```bash
//! DORABASE_TEST_PG=postgres://dorabase:dorabase-test@localhost:55432/dorabase_test \
//!   cargo test --features db-tests
//! ```
//!
//! **Une liste de tables écrite dans un fichier de test se périme, et ce fichier l'a prouvé
//! deux fois.** D'abord contre ce que le chantier annonçait — « 6 tables dans `public` » là où
//! le décor pose le schéma `introspection` ; puis contre le décor lui-même, qui a grandi
//! entre-temps : `identites`, `montants`, la vue `paid_orders`, et `orders` passée de 500 à
//! 501 lignes. La leçon est dans le code : les tables et leurs comptes sont **lus au
//! serveur**, et le seul chiffre codé en dur est celui de la grande table, qui sert de
//! contrôle positif — sans lui, « le dump dit la même chose que la base » passerait aussi sur
//! une base vide.

use std::path::{Path, PathBuf};

use super::discover::{analyser_version, decouvrir};
use super::postgres::PostgresDumpTool;
use super::run::{exporter, Annulation, DumpError};
use super::{Cible, DumpAvailability, Version};
use crate::config::{ConnectionSettings, SslMode};
use crate::engine::postgres::PostgresAdapter;
use crate::engine::EngineAdapter;
use crate::secrets::Secret;

/// La grande table du décor, et son compte. **Le seul chiffre codé en dur**, et il sert de
/// contrôle positif : sans lui, une comparaison « le dump dit la même chose que la base »
/// passerait aussi sur une base vide.
///
/// Le reste des tables et leurs comptes sont **lus au serveur** : `scripts/schema-test-pg.sql`
/// a gagné des tables depuis que ce test a été écrit (`identites`, `montants`, la vue
/// `paid_orders`) et `orders` est passée de 500 à 501 lignes. Une liste close dans ce fichier
/// se serait périmée en silence — elle l'a fait, et le rebase l'a rattrapée.
pub const GRANDE_TABLE: (&str, i64) = ("grande", 100_000);

/// Le schéma du décor de test. `public` est vide — c'est `introspection` qui porte tout.
pub const SCHEMA_DE_TEST: &str = "introspection";

/// L'adresse de la base de test, **jamais codée en dur** : le port diffère entre le
/// conteneur local (55432) et le service de la CI (5432).
pub fn variante_de_test() -> (ConnectionSettings, Option<Secret>) {
    let url = std::env::var("DORABASE_TEST_PG")
        .expect("DORABASE_TEST_PG doit être défini pour les tests de base");
    let analysee: tokio_postgres::Config = url
        .parse()
        .expect("DORABASE_TEST_PG doit être une URL PostgreSQL valide");

    let hote = analysee
        .get_hosts()
        .iter()
        .find_map(|hote| match hote {
            tokio_postgres::config::Host::Tcp(nom) => Some(nom.clone()),
            _ => None,
        })
        .expect("un hôte TCP");

    let variante = ConnectionSettings {
        host: hote,
        port: *analysee.get_ports().first().expect("un port"),
        default_database: analysee.get_dbname().expect("une base").to_owned(),
        username: analysee.get_user().expect("un utilisateur").to_owned(),
        password: None,
        ssl_mode: SslMode::Disable,
        ca_certificate: None,
        auth_database: None,
        read_only: false,
        reconnect_on_startup: false,
        tunnel: None,
    };

    let secret = analysee
        .get_password()
        .map(|octets| Secret::new(String::from_utf8_lossy(octets).into_owned()));

    (variante, secret)
}

/// La cible de dump, dérivée de la variante de test.
pub fn cible_de(variante: &ConnectionSettings) -> Cible {
    Cible {
        hote: variante.host.clone(),
        port: variante.port,
        base: variante.default_database.clone(),
        utilisateur: variante.username.clone(),
    }
}

/// La version **du serveur**, lue au serveur et non supposée : la CI n'a pas forcément la
/// même mineure que cette machine, et la règle de version de `22b` en dépend.
pub async fn version_du_serveur() -> Version {
    let (variante, secret) = variante_de_test();
    let adaptateur = PostgresAdapter::connect(&variante, secret.as_ref())
        .await
        .expect("la base de test doit répondre");
    let sonde = adaptateur.probe().await.expect("la base répond");
    adaptateur.close().await;
    analyser_version(&sonde.server_version).expect("une version lisible dans « PostgreSQL 17.6 »")
}

/// Le `pg_dump` de la machine, ou un échec explicite : sans binaire, ces tests n'ont rien
/// à mesurer et le taire les rendrait verts pour rien.
pub async fn binaire_export() -> PathBuf {
    match decouvrir("pg_dump", version_du_serveur().await) {
        DumpAvailability::Ready { tool, .. } => tool,
        autre => panic!("pg_dump indisponible : {autre:?}"),
    }
}

/// Exporte la base de test, et rend le dossier temporaire **avec** le chemin : le dossier
/// doit rester vivant, sinon il est supprimé et le fichier avec lui.
pub async fn exporter_dorabase_test() -> (tempfile::TempDir, PathBuf) {
    let (variante, secret) = variante_de_test();
    let dossier = tempfile::tempdir().expect("dossier temporaire");
    let fichier = dossier.path().join("dorabase_test.sql");

    exporter(
        &PostgresDumpTool,
        &binaire_export().await,
        &cible_de(&variante),
        secret.as_ref(),
        &fichier,
        |_| {},
        &Annulation::nouvelle(),
    )
    .await
    .expect("l'export de la base de test doit aboutir");

    (dossier, fichier)
}

/// Exporte, et rend le fichier **avec** les comptes de la source, mesurés de part et d'autre.
///
/// **Les autres tests de la suite écrivent dans le même décor**, et `cargo test` les exécute
/// en parallèle : `orders` est passée de 501 à 502 lignes entre un export et sa comparaison,
/// et le test a échoué pour une raison qui n'avait rien à voir avec le dump. Comparer un
/// artefact figé à une base qui bouge n'a pas de sens ; l'export est donc encadré de deux
/// lectures, et refait si elles diffèrent. Trois essais, puis l'échec est réel — un décor qui
/// bouge trois fois de suite est une information, pas un aléa.
async fn exporter_source_stable() -> (tempfile::TempDir, PathBuf, BTreeMap<String, i64>) {
    let (source, _) = variante_de_test();
    for _ in 0..3 {
        let avant = comptes_par_table(&source).await;
        let (dossier, fichier) = exporter_dorabase_test().await;
        if comptes_par_table(&source).await == avant {
            return (dossier, fichier, avant);
        }
    }
    panic!("le décor de test a bougé pendant chacun des trois exports : rien à comparer");
}

/// Le nombre de lignes d'un bloc `COPY … FROM stdin;`, compté jusqu'au `\.` terminal.
///
/// **Compté et non estimé** : c'est ce qui distingue « le fichier parle de la table » de
/// « le fichier porte ses données ».
pub fn compter_lignes_de_copy(contenu: &str, table: &str) -> usize {
    let entete = format!("COPY {SCHEMA_DE_TEST}.{table} ");
    let mut dedans = false;
    let mut lignes = 0;
    for ligne in contenu.lines() {
        if dedans {
            if ligne == "\\." {
                return lignes;
            }
            lignes += 1;
        } else if ligne.starts_with(&entete) {
            dedans = true;
        }
    }
    // Pas de `\.` rencontré : le bloc est tronqué, et c'est une information, pas un compte.
    lignes
}

/// Le pied que `pg_dump --format=plain` écrit en fin de fichier, et que l'import exige.
pub const PIED_DE_COMPLETUDE: &str = "-- PostgreSQL database dump complete";

/// Combien de lignes de queue le pied a le droit d'occuper.
///
/// **Le pied n'est plus forcément la dernière ligne**, et c'est la CI qui l'a montré :
/// `pg_dump` 17.6 termine par `\unrestrict <jeton>`, une méta-commande `psql` ajoutée par les
/// versions correctives d'août 2025 pour empêcher un dump de changer l'état de la session.
/// La machine de développement porte 17.4 et ne l'écrit pas ; le runner porte 17.6 et
/// l'écrit. Un test qui exigeait que le fichier **se termine** par le pied a donc rougi sur
/// une différence de version mineure du client.
///
/// Le contrôle réel — celui de `inspect.rs` — a toujours cherché la **présence** du pied dans
/// les huit derniers kio, jamais la fin du fichier : c'est le test qui était plus strict que
/// le contrat, pas le contrat qui a bougé.
const QUEUE_DU_PIED: usize = 10;

#[tokio::test]
async fn le_dump_porte_le_pied_de_completude() {
    // Le contrat avec l'import : sans ce pied, son contrôle de complétude n'a rien à lire.
    let (_dossier, fichier) = exporter_dorabase_test().await;
    let contenu = std::fs::read_to_string(&fichier).unwrap();
    let queue: Vec<&str> = contenu
        .lines()
        .rev()
        .take(QUEUE_DU_PIED)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();

    assert!(
        queue.contains(&PIED_DE_COMPLETUDE),
        "le pied de complétude manque : {queue:?}"
    );
    // Contrôle positif de la fenêtre : le pied doit être en **queue** de fichier, pas
    // n'importe où. Sans cette borne, un `contains` sur tout le fichier passerait sur un dump
    // tronqué dont le corps citerait la phrase — un `COPY` de commentaires, par exemple.
    assert!(
        !contenu
            .lines()
            .take(contenu.lines().count().saturating_sub(QUEUE_DU_PIED))
            .any(|ligne| ligne == PIED_DE_COMPLETUDE),
        "le pied apparaît ailleurs que dans la queue : la fenêtre ne mesure plus rien"
    );
}

#[tokio::test]
async fn le_dump_dit_les_memes_comptes_que_la_base() {
    let (_dossier, fichier, comptes) = exporter_source_stable().await;
    let contenu = std::fs::read_to_string(&fichier).unwrap();

    // Contrôle positif : sans lui, la boucle qui suit passerait sur une base vide, où le
    // dump comme le serveur diraient « rien » et seraient d'accord.
    assert_eq!(
        comptes.get(GRANDE_TABLE.0),
        Some(&GRANDE_TABLE.1),
        "le décor n'est pas celui qu'on croit : {comptes:?}"
    );
    assert!(
        comptes.len() >= 4,
        "trop peu de tables dans le décor : {comptes:?}"
    );

    for (table, attendu) in &comptes {
        assert!(
            contenu.contains(&format!("COPY {SCHEMA_DE_TEST}.{table} ")),
            "{table} absente du dump"
        );
        assert_eq!(
            compter_lignes_de_copy(&contenu, table) as i64,
            *attendu,
            "compte de lignes inattendu pour {table}"
        );
    }
}

#[tokio::test]
async fn annuler_un_export_reel_ne_laisse_aucun_fichier() {
    // Le pendant sur binaire réel du test à faux outil de `run.rs`. L'annulation est
    // **déjà demandée** avant le lancement : mesuré, un dump de ce décor prend 0,136 s,
    // donc l'annuler « en cours » serait à pile ou face. Ce qui est vérifié ici est que
    // le chemin d'annulation d'un `pg_dump` réel ne laisse pas de fichier derrière lui.
    let (variante, secret) = variante_de_test();
    let dossier = tempfile::tempdir().unwrap();
    let fichier = dossier.path().join("annule.sql");
    let annulation = Annulation::nouvelle();
    annulation.annuler();

    let issue = exporter(
        &PostgresDumpTool,
        &binaire_export().await,
        &cible_de(&variante),
        secret.as_ref(),
        &fichier,
        |_| {},
        &annulation,
    )
    .await;

    assert!(matches!(issue, Err(DumpError::Annule)), "{issue:?}");
    assert!(
        !fichier.exists(),
        "un dump partiel a survécu à l'annulation : {fichier:?}"
    );
}

#[tokio::test]
async fn compter_les_lignes_d_un_copy_tronque_ne_rend_pas_le_compte_complet() {
    // Contrôle négatif de l'outil de mesure lui-même : si `compter_lignes_de_copy`
    // rendait le même nombre sur un fichier coupé, le test de fidélité passerait sur un
    // dump tronqué — exactement le défaut que `22c` documente.
    let (_dossier, fichier) = exporter_dorabase_test().await;
    let contenu = std::fs::read_to_string(&fichier).unwrap();
    let tronque: String = contenu.lines().take(60_000).collect::<Vec<_>>().join("\n");

    assert_eq!(compter_lignes_de_copy(&contenu, "grande"), 100_000);
    assert!(
        compter_lignes_de_copy(&tronque, "grande") < 100_000,
        "un fichier coupé rend le compte complet : la mesure ne mesure rien"
    );
    assert!(!tronque.contains(PIED_DE_COMPLETUDE));
}

// --- Le dump à travers le tunnel SSH de `06e` (22b tâche 6) ------------------------------

/// La variante tunnelée du décor, ou `None` quand le bastion n'est pas monté.
///
/// Sauté et non en échec : un job de CI sans bastion n'a pas à rougir. Le saut est
/// **annoncé**, pour qu'un décor oublié se remarque — c'est l'idiome de `06e`.
fn variante_a_tunnel() -> Option<(ConnectionSettings, Option<Secret>, PathBuf)> {
    let hote = std::env::var("DORABASE_TEST_SSH_HOST").ok()?;
    let (mut variante, secret) = variante_de_test();

    // L'hôte et le port de la **base vus depuis le bastion** : le nom du conteneur sur le
    // réseau Docker, injoignable depuis cette machine. C'est ce qui donne sa valeur au test.
    variante.host = std::env::var("DORABASE_TEST_SSH_TARGET_HOST").ok()?;
    variante.port = std::env::var("DORABASE_TEST_SSH_TARGET_PORT")
        .ok()?
        .parse()
        .ok()?;
    variante.tunnel = Some(crate::config::Tunnel {
        local_port: None,
        // Depuis `05d`, ce qui varie entre les sortes de proxy est une énumération à
        // données : un bastion SSH ne peut plus porter un nom d'instance Cloud SQL.
        proxy: crate::config::Proxy::Ssh(crate::config::ProxySsh {
            bastion_host: hote,
            bastion_port: std::env::var("DORABASE_TEST_SSH_PORT").ok()?.parse().ok()?,
            username: std::env::var("DORABASE_TEST_SSH_USER").ok()?,
            private_key_path: std::env::var("DORABASE_TEST_SSH_KEY").ok()?,
        }),
    });

    let known_hosts = PathBuf::from(std::env::var("DORABASE_TEST_SSH_KNOWN_HOSTS").ok()?);
    Some((variante, secret, known_hosts))
}

#[tokio::test]
async fn un_dump_passe_par_le_bastion() {
    let Some((variante, secret, known_hosts)) = variante_a_tunnel() else {
        eprintln!("décor SSH absent : test sauté (voir scripts/bastion-test.sh)");
        return;
    };

    // **Mesurer le chemin**, pas seulement le résultat visible : c'est la leçon de
    // `AllowTcpForwarding no` : un tunnel qui n'achemine rien laisse la connexion réussir
    // par un autre chemin. Le port local du tunnel vient du registre, et
    // il n'est pas celui de la base.
    let registre = crate::engine::registry::ConnectionRegistry::new();
    let key = crate::engine::commands::DatabaseKey {
        project: "Bastion".into(),
        database: "dorabase_test".into(),
        environment: "dev".into(),
    };
    let identite = crate::engine::registry::cle(&key.project, &key.database, &key.environment);
    registre
        .ouvrir(
            &identite,
            crate::config::Engine::PostgreSql,
            &variante,
            secret.as_ref(),
            &crate::engine::proxy::ContexteDeProxy::nouveau(known_hosts, Default::default()),
        )
        .await
        .expect("la base doit s'ouvrir à travers le bastion");

    let (cible, version) =
        crate::dump::commands::cible_et_version(&registre, &key, &variante, secret.as_ref())
            .await
            .expect("la cible doit être résolue depuis le registre");

    assert_eq!(
        cible.hote, "127.0.0.1",
        "le dump ne passerait pas par le tunnel"
    );
    assert_ne!(
        cible.port, variante.port,
        "le port du dump est celui de la base, donc hors tunnel"
    );

    let dossier = tempfile::tempdir().unwrap();
    let fichier = dossier.path().join("bastion.sql");
    let binaire = match decouvrir("pg_dump", version) {
        DumpAvailability::Ready { tool, .. } => tool,
        autre => panic!("pg_dump indisponible : {autre:?}"),
    };
    exporter(
        &PostgresDumpTool,
        &binaire,
        &cible,
        secret.as_ref(),
        &fichier,
        |_| {},
        &Annulation::nouvelle(),
    )
    .await
    .expect("l'export à travers le tunnel doit aboutir");

    let contenu = std::fs::read_to_string(&fichier).unwrap();
    assert!(
        contenu.contains(&format!("COPY {SCHEMA_DE_TEST}.users ")),
        "dump sans données"
    );
    assert!(contenu.contains(PIED_DE_COMPLETUDE), "dump incomplet");

    registre.fermer(&identite).await;
}

// --- L'aller-retour complet (22c tâche 4) ------------------------------------------------

use std::collections::BTreeMap;

/// Ouvre une connexion d'administration sur la base `postgres`, pour créer et supprimer des
/// bases : `CREATE DATABASE` ne peut pas s'exécuter dans une transaction, ni depuis la base
/// qu'on s'apprête à supprimer.
async fn client_admin() -> tokio_postgres::Client {
    client_sur("postgres").await
}

/// Un client `tokio_postgres` sur la base nommée.
///
/// **Une connexion à part, et non celle de `PostgresAdapter`** : son client est privé, et
/// l'ouvrir ici servirait `count(*)` en contournant la frontière de `06a`. Les comptes
/// exacts sont un contrôle croisé du test, pas une fonction du produit.
async fn client_sur(base: &str) -> tokio_postgres::Client {
    let (variante, secret) = variante_de_test();
    let mut config = tokio_postgres::Config::new();
    config
        .host(&variante.host)
        .port(variante.port)
        .user(&variante.username)
        .dbname(base);
    if let Some(secret) = &secret {
        config.password(secret.expose());
    }

    let (client, connexion) = config
        .connect(tokio_postgres::NoTls)
        .await
        .expect("la base d'administration doit répondre");
    // La connexion doit être pilotée par une tâche, sinon aucune requête ne progresse.
    tokio::spawn(async move {
        let _ = connexion.await;
    });
    client
}

/// Crée une base neuve, en supprimant d'abord celle qui traînerait d'une exécution
/// précédente. Rend la variante qui la désigne.
async fn creer_base_neuve(nom: &str) -> ConnectionSettings {
    let client = client_admin().await;
    // Les noms sont des littéraux de ce fichier, jamais une entrée : l'interpolation est
    // sans danger ici, et `CREATE DATABASE` n'accepte pas de paramètre lié.
    let _ = client
        .batch_execute(&format!("drop database if exists \"{nom}\""))
        .await;
    client
        .batch_execute(&format!("create database \"{nom}\""))
        .await
        .expect("la base neuve doit se créer");

    let (mut variante, _) = variante_de_test();
    variante.default_database = nom.to_owned();
    variante
}

async fn supprimer_base(nom: &str) {
    let client = client_admin().await;
    let _ = client
        .batch_execute(&format!("drop database if exists \"{nom}\""))
        .await;
}

/// Le compte **exact** de lignes par table du schéma de test. `count(*)`, pas `reltuples` :
/// une estimation ne prouve pas une restauration.
///
/// Les tables sont **énumérées au serveur** et non listées ici : le décor de test gagne des
/// tables au fil des specs, et une liste close se périmerait sans bruit. Une base où le
/// schéma n'existe pas rend une table vide — et c'est ce qui distingue « rien importé » de
/// « importé à zéro ligne ».
async fn comptes_par_table(variante: &ConnectionSettings) -> BTreeMap<String, i64> {
    let client = client_sur(&variante.default_database).await;
    let tables = client
        .query(
            "select table_name from information_schema.tables \
             where table_schema = $1 and table_type = 'BASE TABLE' order by table_name",
            &[&SCHEMA_DE_TEST],
        )
        .await
        .expect("l'énumération des tables doit répondre");

    let mut comptes = BTreeMap::new();
    for ligne in tables {
        let table: String = ligne.get(0);
        let compte = client
            .query_one(
                &format!("select count(*) from {SCHEMA_DE_TEST}.\"{table}\""),
                &[],
            )
            .await
            .expect("le compte doit répondre")
            .get::<_, i64>(0);
        comptes.insert(table, compte);
    }
    comptes
}

/// La structure du schéma de test, réduite à ce qui doit être **identique** de part et
/// d'autre : colonnes, index, contraintes, DDL. Ni `rows` ni `size_bytes` — l'un est une
/// estimation, l'autre dépend du remplissage physique, et les comparer rendrait le test
/// instable sans rien prouver de plus.
async fn structure(
    variante: &ConnectionSettings,
) -> BTreeMap<String, (Vec<crate::engine::ColumnInfo>, Vec<String>, String)> {
    let (_, secret) = variante_de_test();
    let adaptateur = PostgresAdapter::connect(variante, secret.as_ref())
        .await
        .expect("la base doit répondre");

    let mut structure = BTreeMap::new();
    let objets = adaptateur
        .objects(SCHEMA_DE_TEST)
        .await
        .expect("le schéma de test doit être introspectable");
    for objet in objets {
        let detail = adaptateur
            .table_detail(SCHEMA_DE_TEST, &objet.name)
            .await
            .expect("le détail doit se lire");
        let index: Vec<String> = detail
            .indexes
            .iter()
            .map(|i| i.definition.clone())
            .collect();
        structure.insert(objet.name.clone(), (detail.columns, index, detail.ddl));
    }
    adaptateur.close().await;
    structure
}

/// Rejoue un fichier dans une base, en passant par le **même chemin que la commande** :
/// inspection d'abord, `psql` ensuite.
async fn importer_dans(
    variante: &ConnectionSettings,
    fichier: &Path,
) -> Result<(), crate::dump::commands::DumpFailure> {
    let (_, secret) = variante_de_test();
    let version = version_du_serveur().await;
    crate::dump::inspect::exiger_importable(fichier, version)?;

    let binaire = match decouvrir("psql", version) {
        DumpAvailability::Ready { tool, .. } => tool,
        autre => panic!("psql indisponible : {autre:?}"),
    };
    crate::dump::run::importer(
        &PostgresDumpTool,
        &binaire,
        &cible_de(variante),
        secret.as_ref(),
        fichier,
        &Annulation::nouvelle(),
    )
    .await
    .map_err(Into::into)
}

#[tokio::test]
async fn l_aller_retour_est_fidele() {
    let (source, _) = variante_de_test();
    let (_dossier, fichier, comptes_source) = exporter_source_stable().await;
    let cible = creer_base_neuve("dorabase_restore_test").await;

    let issue = importer_dans(&cible, &fichier).await;
    // Les faits sont relevés **avant** la suppression de la base : une assertion qui
    // échouerait après laisserait sinon la base derrière elle, et le test suivant
    // échouerait pour la mauvaise raison.
    let structure_cible = structure(&cible).await;
    let structure_source = structure(&source).await;
    let comptes_cible = comptes_par_table(&cible).await;
    supprimer_base("dorabase_restore_test").await;

    issue.expect("l'import doit aboutir");
    // Le vrai critère : comparer, pas constater qu'`exit` vaut 0.
    assert_eq!(structure_cible, structure_source, "la structure diffère");
    assert_eq!(
        comptes_cible, comptes_source,
        "les comptes de lignes diffèrent"
    );
    assert_eq!(comptes_source.get(GRANDE_TABLE.0), Some(&GRANDE_TABLE.1));
}

#[tokio::test]
async fn un_fichier_tronque_laisse_la_base_cible_inchangee() {
    let (_dossier, complet) = exporter_dorabase_test().await;
    let contenu = std::fs::read_to_string(&complet).unwrap();
    let tronque = complet.with_file_name("tronque.sql");
    std::fs::write(
        &tronque,
        contenu.lines().take(60_000).collect::<Vec<_>>().join("\n"),
    )
    .unwrap();

    let cible = creer_base_neuve("dorabase_tronque_test").await;
    let avant = comptes_par_table(&cible).await;
    let issue = importer_dans(&cible, &tronque).await;
    let apres = comptes_par_table(&cible).await;
    supprimer_base("dorabase_tronque_test").await;

    let erreur = issue.expect_err("un fichier tronqué doit être refusé");
    assert_eq!(erreur.kind, "tronque", "{}", erreur.message);
    assert_eq!(apres, avant, "la base cible a bougé");
    // Contrôle positif de la comparaison : sur une base neuve, le schéma du décor n'existe
    // pas du tout — donc aucune table, et non des tables à zéro ligne.
    assert!(
        avant.is_empty(),
        "la base neuve portait déjà des tables : {avant:?}"
    );
}
