//! Les commandes IPC de la couche moteur.
//!
//! Comme celles de `05b`, elles sont **définies par l'app** et donc hors du système d'ACL de
//! Tauri : aucune entrée à ajouter dans `capabilities/default.json`.
//!
//! **Ce module porte le premier passage réel du pont JavaScript → Rust du projet.** Rien ne
//! l'avait exercé depuis `01` : l'enregistrement des commandes était garanti par la
//! compilation, l'aller-retour non. D'où les journaux d'entrée et de sortie ci-dessous, qui
//! rendent le passage **observable** : c'est le seul point du projet qu'aucun test
//! automatisé ne couvre, Playwright ne pilotant pas WKWebView.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::config::{ConnectionSettings, SslMode};
use crate::engine::{AnyEngine, EngineError};
use crate::secrets::Secret;

/// Ce que `A2` affiche après un test réussi.
///
/// Distinct de `ConnectionProbe` : il porte en plus l'avertissement TLS, qui n'est pas une
/// propriété du serveur mais de **notre implémentation**. Le mêler à la sonde ferait croire
/// que PostgreSQL le rapporte.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct ConnectionTest {
    pub latency_ms: u32,
    pub server_version: String,
    /// Le port local du tunnel, quand la variante en déclare un. `A2` l'affiche sous
    /// « auto (63342) ».
    pub tunnel_local_port: Option<u16>,
    /// Vrai quand le mode SSL demandé exigeait une vérification que **rien n'a faite**.
    ///
    /// `06b` emploie encore `NoTls` : un test en `verify-ca` ou `verify-full` réussit sans que
    /// l'identité du serveur ait été contrôlée. Afficher « Connecté » serait alors exact et
    /// trompeur. Ce drapeau existe pour que `A2` le dise, et **disparaîtra** avec le
    /// branchement du TLS — pas avant.
    pub tls_unverified: bool,
}

/// La variante à tester, telle que `A2` la fournit.
///
/// Le mot de passe est **en clair** et séparé de la variante, à l'inverse de
/// `ConnectionSettings` qui n'en porte qu'une `SecretRef`. C'est délibéré : tester une
/// connexion n'exige pas que l'entité existe, donc aucun secret n'est encore rangé. `08e`
/// fera l'inverse — ranger d'abord, référencer ensuite.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct ConnectionRequest {
    /// **Le moteur à interroger, et non celui qu'on suppose.**
    ///
    /// Il manquait. `tester` appelait `PostgresAdapter` en dur, donc « Tester la connexion »
    /// parlait PostgreSQL à un `mongod` : le pilote envoie sa demande de démarrage, le serveur
    /// documentaire n'y répond rien qu'il sache lire, et **l'appel reste pendu** — le bouton
    /// affichait « Test en cours… » indéfiniment, ce qui se lit exactement comme un clic sans
    /// effet. C'est le pire des symptômes possibles : ni verdict, ni échec, ni message.
    ///
    /// Le moteur est une propriété du brouillon depuis `05a` — l'écran le fait choisir en
    /// premier. Il n'y a donc rien à deviner ici, seulement à transmettre.
    pub engine: crate::config::Engine,
    pub variant: ConnectionSettings,
    pub password: Option<String>,
}

/// `verify-ca` et `verify-full` sont les deux seuls modes qui authentifient le serveur.
///
/// Fonction nommée plutôt qu'un `matches!` en ligne : c'est la distinction que `06b` désigne
/// comme « l'erreur classique », et elle mérite d'être testable seule.
pub fn exige_une_verification(mode: SslMode) -> bool {
    crate::engine::tls::Exigences::de(mode).authentifie()
}

/// Vrai quand `A2` doit afficher « TLS non vérifié ».
///
/// **La mention dit un fait, pas une échéance** — et c'est ce que `06f` a changé. Elle valait
/// auparavant « le mode demande une vérification », donc elle s'affichait *même quand la
/// vérification aurait eu lieu* : elle annonçait une réserve du produit. Elle vaut maintenant « le
/// chiffrement est demandé **et** le serveur n'est pas authentifié », ce qui est vrai de `require`,
/// `prefer` et `allow` — trois modes que `05a` propose et que des serveurs internes imposent.
///
/// Elle disparaît donc d'elle-même en `verify-ca` et `verify-full`, sans qu'on l'efface.
pub fn tls_non_verifie(mode: SslMode) -> bool {
    let exigences = crate::engine::tls::Exigences::de(mode);
    exigences.chiffre() && !exigences.authentifie()
}

/// Teste une connexion et rend ce que `A2` affiche.
///
/// Le tunnel, s'il y en a un, est ouvert **puis refermé** : le garder ouvert « au cas où
/// l'utilisateur enregistre » laisserait un port lié et une session SSH vivante sur un
/// formulaire abandonné.
#[tauri::command]
pub async fn test_connection(request: ConnectionRequest) -> Result<ConnectionTest, EngineError> {
    // Entrée du pont, côté Rust. `host` et `port` seulement : le nom d'utilisateur suffirait
    // à identifier une personne, et un mot de passe n'a jamais sa place dans un journal.
    log::info!(
        "test_connection ← {} {}:{} (ssl {:?}, tunnel {})",
        // **Le moteur d'abord.** Le journal disait l'hôte et le port, jamais le moteur — donc la
        // trace d'un test pendu contre `localhost:27017` ressemblait trait pour trait à celle
        // d'un test réussi contre `localhost:5432`, et rien n'y montrait que le mauvais pilote
        // avait été employé.
        crate::engine::nom_du_moteur(request.engine),
        request.variant.host,
        request.variant.port,
        request.variant.ssl_mode,
        if request.variant.tunnel.is_some() {
            "oui"
        } else {
            "non"
        }
    );

    let secret = request.password.as_deref().map(Secret::new);
    let resultat = tester(request.engine, &request.variant, secret.as_ref()).await;

    match &resultat {
        Ok(test) => log::info!(
            "test_connection → {} en {} ms{}",
            test.server_version,
            test.latency_ms,
            if test.tls_unverified {
                " (TLS non vérifié)"
            } else {
                ""
            }
        ),
        // Le message d'erreur vient de `06b`–`06e`, qui garantissent déjà qu'aucun secret n'y
        // figure — vérifié par sentinelle avec contrôle positif dans ces modules.
        Err(erreur) => log::info!("test_connection → échec : {erreur}"),
    }

    resultat
}

/// Ouvre, sonde, referme — **avec l'adaptateur du moteur déclaré**.
///
/// `AnyEngine::connect_via` et non `PostgresAdapter::connect` : c'est le même répartiteur que
/// celui du registre (`09`), donc le test et l'ouverture réelle passent désormais par le même
/// `match`. Deux voies de connexion — une pour tester, une pour ouvrir — c'est exactement ce
/// qui a permis à celle-ci de rester en arrière d'un moteur, puis de trois.
async fn tester(
    moteur: crate::config::Engine,
    variante: &ConnectionSettings,
    secret: Option<&Secret>,
) -> Result<ConnectionTest, EngineError> {
    let adaptateur =
        AnyEngine::connect_via(moteur, variante, secret, &known_hosts_utilisateur()).await?;
    let sonde = adaptateur.probe().await?;
    let tunnel_local_port = adaptateur.port_local_tunnel();

    // Refermé avant de rendre : un formulaire abandonné ne doit pas laisser un port lié.
    adaptateur.close().await;

    Ok(ConnectionTest {
        latency_ms: sonde.latency_ms,
        server_version: sonde.server_version,
        tunnel_local_port,
        tls_unverified: tls_non_verifie(variante.ssl_mode),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::SslMode;

    fn variante() -> ConnectionSettings {
        ConnectionSettings {
            host: "localhost".into(),
            port: 5432,
            default_database: "dorabase_test".into(),
            username: "dorabase".into(),
            password: None,
            ssl_mode: SslMode::Prefer,
            ca_certificate: None,
            auth_database: None,
            read_only: false,
            reconnect_on_startup: false,
            tunnel: None,
        }
    }

    /// La distinction que `06b` appelle « l'erreur classique » : chiffrer n'est pas
    /// authentifier. `require` chiffre sans vérifier l'identité du serveur.
    #[test]
    fn seuls_verify_ca_et_verify_full_exigent_une_verification() {
        assert!(!exige_une_verification(SslMode::Disable));
        assert!(!exige_une_verification(SslMode::Allow));
        assert!(!exige_une_verification(SslMode::Prefer));
        assert!(!exige_une_verification(SslMode::Require));
        assert!(exige_une_verification(SslMode::VerifyCa));
        assert!(exige_une_verification(SslMode::VerifyFull));
    }

    #[test]
    fn la_requete_se_deserialise_depuis_le_camel_case_du_front() {
        // Le front envoie du camelCase ; un désaccord de convention ferait échouer l'appel
        // avec une erreur de désérialisation illisible plutôt qu'un champ manquant.
        let json = serde_json::json!({
            "engine": "postgresql",
            "variant": {
                "environment": "dev",
                "host": "db.internal",
                "port": 5432,
                "defaultDatabase": "analytics",
                "username": "dora_ro",
                "password": null,
                "sslMode": "verify-full",
                "readOnly": true,
                "reconnectOnStartup": false,
                "tunnel": null
            },
            "password": "s3cr3t"
        });

        let requete: ConnectionRequest = serde_json::from_value(json).expect("désérialisation");
        // **Le moteur en premier** : c'est le champ dont l'absence rendait le test de connexion
        // muet, et un désaccord de nom ou de casse entre les deux côtés du pont le ramènerait
        // — sous la forme d'une erreur de désérialisation, cette fois, donc visible.
        assert_eq!(requete.engine, crate::config::Engine::PostgreSql);
        assert_eq!(requete.variant.host, "db.internal");
        assert_eq!(requete.variant.ssl_mode, SslMode::VerifyFull);
        assert_eq!(requete.password.as_deref(), Some("s3cr3t"));
    }

    #[test]
    fn le_resultat_se_serialise_en_camel_case() {
        let test = ConnectionTest {
            latency_ms: 240,
            server_version: "PostgreSQL 17.6".into(),
            tunnel_local_port: Some(63342),
            tls_unverified: true,
        };
        let json = serde_json::to_value(&test).expect("sérialisation");

        // Les quatre champs sous leur nom camelCase : c'est le contrat que la projection
        // TypeScript décrit, et une divergence ici ne se verrait qu'à l'exécution.
        assert!(json.get("latencyMs").is_some(), "{json}");
        assert!(json.get("serverVersion").is_some(), "{json}");
        assert!(json.get("tunnelLocalPort").is_some(), "{json}");
        assert!(json.get("tlsUnverified").is_some(), "{json}");
    }

    /// Qu'aucun mot de passe ne se retrouve dans le résultat sérialisé.
    ///
    /// Contrôle **positif** compris : la sentinelle traverse bien la requête, donc un test qui
    /// la cherche dans la sortie a de quoi la trouver si le code la recopiait.
    #[tokio::test]
    async fn aucun_mot_de_passe_ne_sort_de_la_commande() {
        let sentinelle = "SENTINELLE-mot-de-passe-42";
        let mut v = variante();
        // Un port sur lequel rien n'écoute : l'échec est immédiat et le message est ce qui
        // remonte au front.
        v.port = 1;

        let erreur = tester(
            crate::config::Engine::PostgreSql,
            &v,
            Some(&Secret::new(sentinelle)),
        )
        .await
        .expect_err("un port fermé doit échouer");

        // Contrôle positif : la sentinelle est bien celle qu'on a passée.
        assert_eq!(Secret::new(sentinelle).expose(), sentinelle);
        assert!(
            !erreur.message.contains(sentinelle),
            "le message recopie le mot de passe : {erreur}"
        );
        assert!(
            !format!("{erreur:?}").contains(sentinelle),
            "le Debug recopie le mot de passe : {erreur:?}"
        );
    }
}

// --- Le câblage de `09b` : ouverture et introspection ------------------------------------

use crate::engine::registry::{cle, ConnectionRegistry, ConnectionState};
use crate::engine::{RowQuery, RowWindow, SchemaInfo, TableDetail, TableSummary, Value};

/// Désigne une base dans un projet, pour un environnement.
///
/// **Trois chaînes plutôt qu'une clé préformée.** Envoyer `"Halle/analytics/dev"` depuis le
/// front demanderait au JavaScript de connaître la convention de composition, donc de la
/// dupliquer — le même piège que la référence de secret de `08e`, tranché de la même façon.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct DatabaseKey {
    pub project: String,
    pub database: String,
    pub environment: String,
}

impl DatabaseKey {
    fn cle(&self) -> String {
        cle(&self.project, &self.database, &self.environment)
    }
}

/// Ouvre une connexion, en relisant le mot de passe depuis le magasin.
///
/// **Le mot de passe se relit, il ne se redemande pas.** La variante porte une `SecretRef`
/// (`08e`) ; `retrieve` rend `Ok(None)` pour « aucun secret sous cette référence », qui est un
/// état normal — une base sans mot de passe. Une panne de magasin, elle, est une erreur : les
/// confondre ferait tenter une connexion sans mot de passe et afficher « authentification
/// refusée » là où le vrai problème est le Trousseau.
#[tauri::command]
pub async fn open_database(
    app: tauri::AppHandle,
    key: DatabaseKey,
    // `engine` : le moteur déclaré (`05a`), qui décide de l'adaptateur à ouvrir.
    //
    // **Passé par l'écran, pas deviné ici** : il appartient à la `Database`, pas à la variante
    // d'environnement, et le front l'a sous la main — c'est lui qui dessine l'arbre. Le relire
    // depuis la configuration coûterait une lecture de fichier par ouverture.
    engine: crate::config::Engine,
    variant: ConnectionSettings,
    registry: tauri::State<'_, ConnectionRegistry>,
) -> Result<ConnectionState, EngineError> {
    let identite = key.cle();
    log::info!("open_database ← {identite}");

    let secret = match &variant.password {
        Some(reference) => {
            let repertoire = repertoire_de_configuration(&app)?;
            let magasin = crate::secrets::selectionner(&repertoire).map_err(|e| {
                EngineError::local(format!("magasin de secrets indisponible : {e}"))
            })?;
            magasin.store.retrieve(reference).map_err(|e| {
                // Distinct d'un secret absent : le dire évite de chercher une erreur
                // d'authentification là où le magasin est en cause.
                EngineError::local(format!("le mot de passe n'a pas pu être relu : {e}"))
            })?
        }
        None => None,
    };

    registry
        .ouvrir(
            &identite,
            engine,
            &variant,
            secret.as_ref(),
            &known_hosts_utilisateur(),
        )
        .await?;

    let etat = registry.etat(&identite).await;
    log::info!("open_database → {identite} : {etat:?}");
    Ok(etat)
}

/// Ferme une connexion et rend son port de tunnel.
#[tauri::command]
pub async fn close_database(
    key: DatabaseKey,
    registry: tauri::State<'_, ConnectionRegistry>,
) -> Result<(), EngineError> {
    registry.fermer(&key.cle()).await;
    Ok(())
}

/// Un état de connexion, avec la base qu'il concerne.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct ConnectionStateEntry {
    pub key: DatabaseKey,
    pub state: ConnectionState,
}

/// Les états de toutes les connexions connues, pour peupler l'arbre en une fois.
///
/// **Une liste de triplets, et non une table indexée par la clé composée.** Le registre
/// s'indexe bien par `projet/base/environnement`, mais rendre cette chaîne au front l'obligerait
/// à savoir la recomposer pour s'y retrouver — donc à dupliquer la convention, et une convention
/// dupliquée diverge. Une première version le faisait ; le test qui devait vérifier l'accord des
/// deux implémentations a montré qu'il valait mieux n'en avoir qu'une.
///
/// Une base absente de la liste est `Never` — l'état de départ, que `09d` doit distinguer de
/// `Offline`.
#[tauri::command]
pub async fn connection_states(
    registry: tauri::State<'_, ConnectionRegistry>,
) -> Result<Vec<ConnectionStateEntry>, EngineError> {
    Ok(registry
        .etats()
        .await
        .into_iter()
        .filter_map(|(identite, state)| {
            // La clé est décomposée ici : le registre la garde composée pour son propre index,
            // et c'est la seule frontière où elle se défait.
            let mut morceaux = identite.splitn(3, '/');
            let key = DatabaseKey {
                project: morceaux.next()?.to_owned(),
                database: morceaux.next()?.to_owned(),
                environment: morceaux.next()?.to_owned(),
            };
            Some(ConnectionStateEntry { key, state })
        })
        .collect())
}

/// Les schémas d'une base ouverte.
#[tauri::command]
pub async fn list_schemas(
    key: DatabaseKey,
    registry: tauri::State<'_, ConnectionRegistry>,
) -> Result<Vec<SchemaInfo>, EngineError> {
    registry
        .avec(&key.cle(), |adaptateur| Box::pin(adaptateur.schemas()))
        .await
}

/// Les objets d'**un** schéma.
///
/// Un schéma à la fois, jamais tout le catalogue : c'est le découpage de `06c`, et il
/// correspond au dépliage de l'arbre. Une commande « tout l'arbre » serait plus simple à
/// appeler et ramènerait des milliers d'objets pour en afficher douze.
#[tauri::command]
pub async fn list_objects(
    key: DatabaseKey,
    schema: String,
    registry: tauri::State<'_, ConnectionRegistry>,
) -> Result<Vec<TableSummary>, EngineError> {
    registry
        .avec(&key.cle(), move |adaptateur| {
            Box::pin(async move { adaptateur.objects(&schema).await })
        })
        .await
}

/// Le détail d'**une** table : colonnes, index, contraintes, DDL.
#[tauri::command]
pub async fn describe_table(
    key: DatabaseKey,
    schema: String,
    table: String,
    registry: tauri::State<'_, ConnectionRegistry>,
) -> Result<TableDetail, EngineError> {
    registry
        .avec(&key.cle(), move |adaptateur| {
            Box::pin(async move { adaptateur.table_detail(&schema, &table).await })
        })
        .await
}

/// Une **fenêtre** de lignes d'une table. Jamais un jeu complet.
///
/// **La commande manquait, et son absence était invisible.** `06d` a livré `rows` sur
/// l'adaptateur et sur le registre, testés contre une vraie base — dont un test qui mesure le
/// *coût* du chemin, parce qu'une fenêtre rendue ne prouve pas que la base n'a pas tout
/// renvoyé. Mais rien n'était exposé au front : la couche était complète et personne ne la
/// franchissait. Troisième occurrence du motif après `load_config` (`09b`) et l'assemblage de
/// `A4` (`10b`).
///
/// `RowQuery` porte sa `limit` dans une énumération fermée (`RowLimit`) : « demander tout »
/// n'est pas exprimable, et la contrainte IPC transverse tient par le type plutôt que par la
/// discipline de l'appelant.
#[tauri::command]
pub async fn read_rows(
    key: DatabaseKey,
    query: RowQuery,
    registry: tauri::State<'_, ConnectionRegistry>,
) -> Result<RowWindow, EngineError> {
    // **Les journaux d'entrée et de sortie rendent le pont observable**, comme ceux de
    // `test_connection` (`08d`). Ils manquaient ici, et leur absence a coûté une enquête : « la
    // table ne contient aucune ligne » sur une table pleine ne disait pas si la commande était
    // appelée, ce qu'elle demandait, ni ce qu'elle rendait.
    log::info!(
        "read_rows ← {}/{} · {}.{} (limit {:?}, {} filtre(s), {} tri(s))",
        key.project,
        key.database,
        query.schema,
        query.table,
        query.limit,
        query.filters.len(),
        query.sort.len()
    );

    let resultat = registry
        .avec(&key.cle(), move |adaptateur| {
            Box::pin(async move { adaptateur.rows(&query).await })
        })
        .await;

    match &resultat {
        Ok(fenetre) => log::info!(
            "read_rows → {} ligne(s) en {} ms · {}",
            fenetre.rows.len(),
            fenetre.duration_ms,
            fenetre.sql
        ),
        Err(erreur) => log::info!("read_rows → échec : {erreur}"),
    }

    resultat
}

/// Une ligne rendue en `INSERT` exécutable, que `A5` copie dans le presse-papiers (`10f`).
///
/// Le presse-papiers, lui, reste côté front : c'est une API de la webview.
#[tauri::command]
pub async fn row_as_insert(
    key: DatabaseKey,
    schema: String,
    table: String,
    values: Vec<Value>,
    registry: tauri::State<'_, ConnectionRegistry>,
) -> Result<String, EngineError> {
    registry
        .avec(&key.cle(), move |adaptateur| {
            Box::pin(async move { adaptateur.row_as_insert(&schema, &table, &values).await })
        })
        .await
}

/// Le SQL que `Appliquer` exécutera, pour le panneau de `11c`.
///
/// **Rendu par le moteur, jamais composé par l'écran.** Le bloc annonce « SQL qui sera exécuté » :
/// s'il n'est pas exactement celui qui partira, il est pire qu'absent. `11d` exécutera cette suite.
#[tauri::command]
pub async fn preview_updates(
    key: DatabaseKey,
    plan: crate::engine::UpdatePlan,
    registry: tauri::State<'_, ConnectionRegistry>,
) -> Result<String, EngineError> {
    registry
        .avec(&key.cle(), move |adaptateur| {
            Box::pin(async move { adaptateur.preview_updates(&plan).await })
        })
        .await
}

/// **La première écriture du projet** (`11d`). Tout le reste, depuis `01`, est en lecture.
///
/// Le SQL exécuté est celui que `11c` a montré — la même fonction le produit, et il n'y a qu'un
/// texte. Une transaction : dix corrections partent ensemble ou pas du tout.
#[tauri::command]
pub async fn apply_changes(
    key: DatabaseKey,
    plan: crate::engine::UpdatePlan,
    registry: tauri::State<'_, ConnectionRegistry>,
) -> Result<crate::engine::ApplyOutcome, EngineError> {
    let resultat = registry
        .avec(&key.cle(), move |adaptateur| {
            Box::pin(async move { adaptateur.apply_updates(&plan).await })
        })
        .await;

    // Journalisé dans les deux cas : c'est la seule commande qui **modifie** des données de
    // l'utilisateur, et savoir après coup ce qui est parti — ou n'est pas parti — vaut la ligne de
    // log. Aucune valeur n'y figure : un journal ne doit pas devenir une copie des données.
    match &resultat {
        Ok(issue) => log::info!("apply_changes → {} ligne(s) écrite(s)", issue.applied),
        Err(erreur) => log::warn!("apply_changes → refusé : {erreur}"),
    }

    resultat
}

/// Exécute le SQL **écrit par l'utilisateur** (`12c`).
///
/// **Première commande où le SQL ne vient pas de DoraBase.** Elle ne juge pas ce qu'on lui donne : la
/// confirmation des requêtes destructives vit à l'écran, avant l'appel — un garde-fou ici serait
/// contourné par la prochaine console, et celui-ci protège de la faute de frappe, pas d'une
/// intention.
///
/// La limite ajoutée est **rendue**, jamais tue : une limite silencieuse ferait croire à une table de
/// mille lignes.
#[tauri::command]
pub async fn run_sql(
    key: DatabaseKey,
    sql: String,
    limit: crate::engine::RowLimit,
    registry: tauri::State<'_, ConnectionRegistry>,
) -> Result<crate::engine::QueryResult, EngineError> {
    let resultat = registry
        .avec(&key.cle(), move |adaptateur| {
            Box::pin(async move { adaptateur.run_sql(&sql, limit).await })
        })
        .await;

    match &resultat {
        Ok(issue) => log::info!(
            "run_sql → {} ligne(s), {} ms{}",
            issue.rows.len(),
            issue.duration_ms,
            issue
                .applied_limit
                .map(|n| format!(", limite {n} ajoutée"))
                .unwrap_or_default()
        ),
        // Le SQL n'est **pas** journalisé : il peut contenir des valeurs de l'utilisateur, et un
        // journal ne doit pas devenir une copie des données. Même règle qu'en `11d`.
        Err(erreur) => log::warn!("run_sql → refusé : {erreur}"),
    }

    resultat
}

/// Le plan d'exécution d'une requête (`12e`), **sans l'exécuter**.
///
/// `EXPLAIN` et non `EXPLAIN ANALYZE` : voir `explain_sql`. Sur une console où l'on écrit aussi des
/// `UPDATE`, « Expliquer » deviendrait un bouton qui écrit.
#[tauri::command]
pub async fn explain_sql(
    key: DatabaseKey,
    sql: String,
    registry: tauri::State<'_, ConnectionRegistry>,
) -> Result<crate::engine::QueryPlan, EngineError> {
    registry
        .avec(&key.cle(), move |adaptateur| {
            Box::pin(async move { adaptateur.explain_sql(&sql).await })
        })
        .await
}

fn repertoire_de_configuration(app: &tauri::AppHandle) -> Result<std::path::PathBuf, EngineError> {
    use tauri::Manager;
    app.path()
        .app_config_dir()
        .map_err(|e| EngineError::local(format!("répertoire de configuration introuvable : {e}")))
}

/// Le `known_hosts` de l'utilisateur — celui que `ssh` lit lui-même.
fn known_hosts_utilisateur() -> std::path::PathBuf {
    std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_default()
        .join(".ssh")
        .join("known_hosts")
}



