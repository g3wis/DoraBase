//! L'adaptateur MongoDB — specs `18a` à `18g`.
//!
//! # Ce que ce moteur ne partage pas avec PostgreSQL
//!
//! **`18a` est la spec à lire avant ce module.** Elle tranche les six endroits où le contrat de
//! `06a` suppose quelque chose qu'un moteur documentaire n'a pas :
//!
//! 1. **Le niveau « schéma » porte les bases MongoDB.** La déclaration de connexion est le serveur,
//!    le schéma est la base, l'objet est la collection. L'arbre de `A4` garde ses quatre niveaux, et
//!    le mot « schéma » n'apparaît nulle part dans l'interface.
//! 2. **Les colonnes sont déduites** par échantillonnage (`18d`), avec la fréquence de chaque champ.
//! 3. **Le DDL est la suite de commandes qui recrée la collection** — du DDL au sens de `14c` :
//!    équivalent, pas identique à ce qui a été tapé.
//! 4. **Les types BSON entrent dans `Value` sans variante nouvelle** (`bson.rs`), au prix d'une
//!    perte nommée sur `ObjectId`.
//! 5. **Une transaction exige un jeu de réplicas** : sur un `mongod` isolé, l'écriture est refusée
//!    avec sa raison plutôt que tentée sans filet.
//! 6. **`run_sql` et `explain_sql` gardent leur nom**, et reçoivent une opération de collection.
//!    Dette assumée, inscrite dans `18a`.

pub mod bson;
mod commande;
mod connect;
mod ddl;
mod documents;
mod error;
mod introspect;

use std::time::Instant;

use futures_util::StreamExt;
use mongodb::bson::{Bson, Document};
use mongodb::Client;

use crate::config::ConnectionSettings;
use crate::engine::proxy::{EtatProxy, ProxyOuvert};
use crate::engine::{
    ApplyOutcome, ColumnInfo, ConnectionProbe, EngineAdapter, EngineError, PendingUpdate,
    QueryPlan, QueryResult, RowCount, RowLimit, RowQuery, RowWindow, SchemaInfo, TableDetail,
    TableSummary, UpdatePlan, Value,
};
use crate::secrets::Secret;

use connect::Deploiement;
use error as mongo_error;

/// L'adaptateur MongoDB.
pub struct MongoAdapter {
    client: Client,
    deploiement: Deploiement,
    /// La base que la déclaration nomme — celle que la console vise sans `use`.
    base_declaree: String,
    /// Même raison qu'en `06b` : le tunnel vit aussi longtemps que la connexion, sans quoi son
    /// écouteur local se ferme et la connexion meurt à la première commande.
    proxy: Option<ProxyOuvert>,
}

/// `Debug` à la main, pour la raison de `05c` : un dérivé exposerait la configuration du client,
/// qui porte le mot de passe.
impl std::fmt::Debug for MongoAdapter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("MongoAdapter { … }")
    }
}

impl MongoAdapter {
    pub async fn connect_via(
        variante: &ConnectionSettings,
        mot_de_passe: Option<&Secret>,
        known_hosts: &std::path::Path,
    ) -> Result<Self, EngineError> {
        let proxy = match &variante.tunnel {
            Some(tunnel) => {
                Some(ProxyOuvert::ouvrir(tunnel, &variante.host, variante.port, known_hosts).await?)
            }
            None => None,
        };
        let redirection = proxy.as_ref().map(|p| ("127.0.0.1", p.port_local()));
        let options = connect::preparer(variante, mot_de_passe, redirection)?;

        match connect::ouvrir(options).await {
            Ok((client, deploiement)) => Ok(Self {
                client,
                deploiement,
                base_declaree: variante.default_database.clone(),
                proxy,
            }),
            // La qualification de `06e` : sans elle, un bastion tombé produit un « connection
            // refused » sur `127.0.0.1`, qui envoie chercher un problème de MongoDB.
            Err(erreur) => Err(match &proxy {
                Some(p) => p.qualifier(erreur).await,
                None => erreur,
            }),
        }
    }

    pub fn etat_tunnel(&self) -> Option<EtatProxy> {
        self.proxy.as_ref().map(ProxyOuvert::etat)
    }

    pub fn port_local_tunnel(&self) -> Option<u16> {
        self.proxy.as_ref().map(ProxyOuvert::port_local)
    }

    pub async fn close(self) {
        if let Some(proxy) = self.proxy {
            proxy.fermer().await;
        }
        drop(self.client);
    }

    /// Les colonnes déduites d'une collection, dont `rows` a besoin pour aplatir les documents.
    async fn colonnes(&self, base: &str, collection: &str) -> Result<Vec<ColumnInfo>, EngineError> {
        Ok(introspect::detail(&self.client, base, collection)
            .await?
            .columns)
    }
}

impl EngineAdapter for MongoAdapter {
    async fn probe(&self) -> Result<ConnectionProbe, EngineError> {
        let debut = Instant::now();
        let version = connect::version_du_serveur(&self.client).await?;
        Ok(ConnectionProbe {
            latency_ms: u32::try_from(debut.elapsed().as_millis()).unwrap_or(u32::MAX),
            server_version: version,
        })
    }

    async fn schemas(&self) -> Result<Vec<SchemaInfo>, EngineError> {
        introspect::bases(&self.client).await
    }

    async fn objects(&self, schema: &str) -> Result<Vec<TableSummary>, EngineError> {
        introspect::collections(&self.client, schema).await
    }

    async fn table_detail(&self, schema: &str, table: &str) -> Result<TableDetail, EngineError> {
        introspect::detail(&self.client, schema, table).await
    }

    async fn rows(&self, query: &RowQuery) -> Result<RowWindow, EngineError> {
        let debut = Instant::now();
        let colonnes = self.colonnes(&query.schema, &query.table).await?;
        let critere = documents::critere(&query.filters);
        let tri = documents::tri(&query.sort);
        let limite = i64::from(query.limit.value());

        let mut curseur = self
            .client
            .database(&query.schema)
            .collection::<Document>(&query.table)
            .find(critere.clone())
            .sort(tri.clone())
            // **`skip` parcourt et jette**, comme l'`OFFSET` de `06d`. La même décision tient, avec
            // la même réserve : au-delà de quelques milliers de documents, la page suivante ralentit.
            .skip(query.offset)
            .limit(limite)
            .await
            .map_err(|e| mongo_error::traduire(&e))?;

        let mut lignes = Vec::new();
        while let Some(document) = curseur.next().await {
            let document = document.map_err(|e| mongo_error::traduire(&e))?;
            lignes.push(documents::ligne(&document, &colonnes));
        }

        // Le total **estimé**, comme `06d` prend `reltuples` : `countDocuments` parcourrait.
        let total = self
            .client
            .database(&query.schema)
            .collection::<Document>(&query.table)
            .estimated_document_count()
            .await
            .ok()
            .and_then(|n| i64::try_from(n).ok())
            .map(|value| RowCount::Estimated { value });

        Ok(RowWindow {
            offset: query.offset,
            rows: lignes,
            total,
            // Le champ s'appelle `sql` (`06a`) ; ce qu'il porte est **la commande réellement
            // exécutée**, dans le langage du moteur. La dette de nom est celle de `18a`.
            sql: format!(
                "db.{}.find({}).sort({}).skip({}).limit({})",
                query.table,
                Bson::Document(critere).into_relaxed_extjson(),
                Bson::Document(tri).into_relaxed_extjson(),
                query.offset,
                limite
            ),
            duration_ms: u32::try_from(debut.elapsed().as_millis()).unwrap_or(u32::MAX),
        })
    }

    async fn row_as_insert(
        &self,
        schema: &str,
        table: &str,
        values: &[Value],
    ) -> Result<String, EngineError> {
        let colonnes = self.colonnes(schema, table).await?;
        let mut document = Document::new();
        for (colonne, valeur) in colonnes.iter().zip(values) {
            // **Un champ nul est omis, pas posé à `null`.** Un `insertOne` qui recréerait des
            // champs nuls produirait un document différent de l'original — et `10f` promet « la
            // ligne », pas « une ligne équivalente ».
            if let Some(bson) = bson_de(valeur) {
                document.insert(colonne.name.clone(), bson);
            }
        }
        // `_id` est retiré : coller un `insertOne` dans la même collection échouerait sur un
        // doublon, et l'usage de `10f` est justement de recopier ailleurs.
        document.remove("_id");
        Ok(format!(
            "db.{table}.insertOne({});",
            Bson::Document(document).into_relaxed_extjson()
        ))
    }

    async fn preview_updates(&self, plan: &UpdatePlan) -> Result<String, EngineError> {
        Ok(commandes_de(plan)
            .iter()
            .map(|(filtre, mise_a_jour)| {
                documents::commande_lisible(&plan.table, filtre, mise_a_jour)
            })
            .collect::<Vec<_>>()
            .join("\n"))
    }

    async fn apply_updates(&self, plan: &UpdatePlan) -> Result<ApplyOutcome, EngineError> {
        // **Le refus arrive avant le premier `updateOne`, jamais après le second** (`18f`).
        if !self.deploiement.transactions_possibles() {
            return Err(EngineError::local(
                "ce serveur MongoDB est isolé : il ne sait pas ouvrir de transaction, donc \
                 plusieurs modifications pourraient s'appliquer à moitié. DoraBase n'écrit pas \
                 sans ce filet — un jeu de réplicas est nécessaire",
            ));
        }

        let mut session = self
            .client
            .start_session()
            .await
            .map_err(|e| mongo_error::traduire(&e))?;
        session
            .start_transaction()
            .await
            .map_err(|e| mongo_error::traduire(&e))?;

        let collection = self
            .client
            .database(&plan.schema)
            .collection::<Document>(&plan.table);

        let mut appliquees = 0u64;
        for (filtre, mise_a_jour) in commandes_de(plan) {
            let issue = collection
                .update_one(filtre.clone(), mise_a_jour.clone())
                .session(&mut session)
                .await;
            match issue {
                Ok(resultat) if resultat.matched_count == 1 => appliquees += 1,
                Ok(_) => {
                    // Zéro document trouvé : le document a changé depuis la lecture. **Toute** la
                    // transaction est annulée — pas un rapport partiel (`06a`).
                    let _ = session.abort_transaction().await;
                    return Err(EngineError::local(format!(
                        "le document {} a changé depuis la lecture : aucune modification n'a été \
                         écrite",
                        filtre
                            .get(&plan.key_column)
                            .map(|v| v.to_string())
                            .unwrap_or_default()
                    )));
                }
                Err(erreur) => {
                    let _ = session.abort_transaction().await;
                    return Err(mongo_error::traduire(&erreur));
                }
            }
        }

        session
            .commit_transaction()
            .await
            .map_err(|e| mongo_error::traduire(&e))?;

        Ok(ApplyOutcome {
            applied: appliquees,
            inverse_sql: commandes_inverses_de(plan)
                .iter()
                .map(|(filtre, mise_a_jour)| {
                    documents::commande_lisible(&plan.table, filtre, mise_a_jour)
                })
                .collect::<Vec<_>>()
                .join("\n"),
        })
    }

    async fn run_sql(&self, sql: &str, limite: RowLimit) -> Result<QueryResult, EngineError> {
        let debut = Instant::now();
        let operation = commande::analyser(sql)?;
        let base = self.base_courante();
        executer(&self.client, &base, &operation, limite, debut).await
    }

    async fn explain_sql(&self, sql: &str) -> Result<QueryPlan, EngineError> {
        let debut = Instant::now();
        let operation = commande::analyser(sql)?;
        let base = self.base_courante();
        expliquer(&self.client, &base, &operation, debut).await
    }
}

impl MongoAdapter {
    /// La base visée par la console quand aucun `use` ne la nomme.
    ///
    /// C'est celle que la déclaration porte (`05a`). Une connexion MongoDB en voit plusieurs
    /// (`18a`), mais un onglet de console appartient à une **base déclarée**, pas à un schéma —
    /// `12a` ouvre les consoles par `DatabaseKey`. Le `use <base>;` de `18g` est ce qui permet
    /// d'en viser une autre.
    fn base_courante(&self) -> String {
        self.base_declaree.clone()
    }
}

/// Les couples (filtre, mise à jour) d'un plan — **la source unique** de ce qui est prévisualisé et
/// de ce qui est exécuté.
///
/// `11d` : un texte affiché qui n'est pas exactement celui qui part est *pire qu'absent*. Les deux
/// chemins passent donc ici.
fn commandes_de(plan: &UpdatePlan) -> Vec<(Document, Document)> {
    plan.changes
        .iter()
        .map(|modification| {
            (
                documents::filtre_de_modification(modification, &plan.key_column),
                documents::mise_a_jour(modification),
            )
        })
        .collect()
}

/// Le patch inverse : valeur et attendue échangées, comme `11d` le fait en SQL.
fn commandes_inverses_de(plan: &UpdatePlan) -> Vec<(Document, Document)> {
    plan.changes
        .iter()
        .map(|modification| {
            let inverse = PendingUpdate {
                key: modification.key.clone(),
                column: modification.column.clone(),
                value: modification.expected.clone(),
                expected: modification.value.clone(),
            };
            (
                documents::filtre_de_modification(&inverse, &plan.key_column),
                documents::mise_a_jour(&inverse),
            )
        })
        .collect()
}

/// Une valeur du modèle en BSON, pour `row_as_insert`.
///
/// **`None` pour un nul** : le champ est alors omis du document, ce qui est ce que « vider »
/// signifie en MongoDB (`18f`).
fn bson_de(valeur: &Value) -> Option<Bson> {
    match valeur {
        Value::Null => None,
        Value::Bool { value } => Some(Bson::Boolean(*value)),
        Value::Int { value } => Some(Bson::Int64(*value)),
        Value::Float { value } => Some(Bson::Double(*value)),
        // Un décimal reste **exact** : le repasser en flottant perdrait la précision que
        // `Value::Decimal` existe pour préserver.
        Value::Decimal { value } => value
            .parse::<mongodb::bson::Decimal128>()
            .ok()
            .map(Bson::Decimal128)
            .or_else(|| Some(Bson::String(value.clone()))),
        Value::Text { value } => Some(Bson::String(value.clone())),
        Value::Timestamp { value } => Some(Bson::String(value.clone())),
        // Le JSON d'un document imbriqué redevient un document, pas une chaîne : sans cela,
        // l'`insertOne` copié produirait un document dont un champ serait du texte.
        Value::Json { value } => serde_json::from_str::<serde_json::Value>(value)
            .ok()
            .and_then(|j| Bson::try_from(j).ok())
            .or_else(|| Some(Bson::String(value.clone()))),
        Value::Binary { base64 } => Some(Bson::String(base64.clone())),
    }
}

/// Exécute une opération reconnue (`18g`).
async fn executer(
    client: &Client,
    base_par_defaut: &str,
    operation: &commande::Operation,
    limite: RowLimit,
    debut: Instant,
) -> Result<QueryResult, EngineError> {
    let base = operation.base.as_deref().unwrap_or(base_par_defaut);
    let collection = client
        .database(base)
        .collection::<Document>(&operation.collection);
    let plafond = limite.value();

    let (documents_lus, limite_ajoutee, commande_executee) = match operation.genre {
        commande::Genre::Find => {
            let filtre = argument_document(operation, 0).unwrap_or_default();
            let projection = argument_document(operation, 1);
            let mut requete = collection.find(filtre.clone()).limit(i64::from(plafond));
            if let Some(projection) = &projection {
                requete = requete.projection(projection.clone());
            }
            let mut curseur = requete.await.map_err(|e| mongo_error::traduire(&e))?;
            let mut lus = Vec::new();
            while let Some(document) = curseur.next().await {
                lus.push(document.map_err(|e| mongo_error::traduire(&e))?);
            }
            (
                lus,
                Some(plafond),
                format!(
                    "db.{}.find({}).limit({plafond})",
                    operation.collection,
                    Bson::Document(filtre).into_relaxed_extjson()
                ),
            )
        }
        commande::Genre::Aggregate => {
            let etapes = operation
                .arguments
                .first()
                .and_then(|a| a.as_array().cloned())
                .unwrap_or_default();
            let (pipeline, ajoutee) = commande::pipeline_borne(&etapes, plafond);
            let mut curseur = collection
                .aggregate(pipeline.clone())
                .await
                .map_err(|e| mongo_error::traduire(&e))?;
            let mut lus = Vec::new();
            while let Some(document) = curseur.next().await {
                lus.push(document.map_err(|e| mongo_error::traduire(&e))?);
            }
            (
                lus,
                ajoutee,
                format!(
                    "db.{}.aggregate({})",
                    operation.collection,
                    Bson::Array(pipeline.into_iter().map(Bson::Document).collect())
                        .into_relaxed_extjson()
                ),
            )
        }
        commande::Genre::CountDocuments => {
            let filtre = argument_document(operation, 0).unwrap_or_default();
            let compte = collection
                .count_documents(filtre.clone())
                .await
                .map_err(|e| mongo_error::traduire(&e))?;
            (
                vec![mongodb::bson::doc! { "count": i64::try_from(compte).unwrap_or(i64::MAX) }],
                None,
                format!(
                    "db.{}.countDocuments({})",
                    operation.collection,
                    Bson::Document(filtre).into_relaxed_extjson()
                ),
            )
        }
        commande::Genre::Distinct => {
            let champ = operation
                .arguments
                .first()
                .and_then(|a| a.as_str())
                .ok_or_else(|| {
                    EngineError::local("distinct attend un nom de champ entre guillemets")
                })?
                .to_owned();
            let filtre = argument_document(operation, 1).unwrap_or_default();
            let valeurs = collection
                .distinct(&champ, filtre.clone())
                .await
                .map_err(|e| mongo_error::traduire(&e))?;
            (
                valeurs
                    .into_iter()
                    .take(plafond as usize)
                    .map(|v| mongodb::bson::doc! { champ.clone(): v })
                    .collect(),
                Some(plafond),
                format!(
                    "db.{}.distinct(\"{champ}\", {})",
                    operation.collection,
                    Bson::Document(filtre).into_relaxed_extjson()
                ),
            )
        }
    };

    // **Les colonnes viennent du résultat, pas du catalogue** — c'est la différence entre
    // `QueryResult` et `RowWindow` que `12c` a posée. L'union des champs, dans l'ordre où ils
    // apparaissent : un document plus riche que le premier ne doit pas perdre ses champs.
    let mut colonnes: Vec<String> = Vec::new();
    for document in &documents_lus {
        for (champ, _) in document {
            if !colonnes.iter().any(|c| c == champ) {
                colonnes.push(champ.clone());
            }
        }
    }

    let rows = documents_lus
        .iter()
        .map(|document| {
            colonnes
                .iter()
                .map(|champ| match document.get(champ) {
                    // **`valeur_pour_console` et non `valeur_de`** : l'arbre de `13b` doit
                    // distinguer un `ObjectId` d'une chaîne, et une date d'un texte. Voir `bson.rs`
                    // sur les deux conversions.
                    Some(valeur) => bson::valeur_pour_console(valeur),
                    None => Value::Null,
                })
                .collect()
        })
        .collect();

    Ok(QueryResult {
        columns: colonnes,
        rows,
        sql: commande_executee,
        duration_ms: u64::try_from(debut.elapsed().as_millis()).unwrap_or(u64::MAX),
        applied_limit: limite_ajoutee,
    })
}

/// Le plan d'exécution (`18g`), **sans exécuter**.
///
/// `queryPlanner` rend le plan choisi sans exécuter la requête, là où `executionStats` et
/// `allPlansExecution` l'exécutent pour la mesurer. C'est exactement la raison qui a fait refuser
/// `EXPLAIN ANALYZE` en `12e` : sur une console où l'on écrit aussi, « Expliquer » deviendrait un
/// bouton qui écrit.
async fn expliquer(
    client: &Client,
    base_par_defaut: &str,
    operation: &commande::Operation,
    debut: Instant,
) -> Result<QueryPlan, EngineError> {
    let base = operation.base.as_deref().unwrap_or(base_par_defaut);
    let interne = match operation.genre {
        commande::Genre::Find => mongodb::bson::doc! {
            "find": operation.collection.clone(),
            "filter": argument_document(operation, 0).unwrap_or_default(),
        },
        commande::Genre::Aggregate => {
            let etapes = operation
                .arguments
                .first()
                .and_then(|a| a.as_array().cloned())
                .unwrap_or_default();
            mongodb::bson::doc! {
                "aggregate": operation.collection.clone(),
                "pipeline": etapes,
                "cursor": {},
            }
        }
        commande::Genre::CountDocuments => mongodb::bson::doc! {
            "count": operation.collection.clone(),
            "query": argument_document(operation, 0).unwrap_or_default(),
        },
        commande::Genre::Distinct => mongodb::bson::doc! {
            "distinct": operation.collection.clone(),
            "key": operation.arguments.first().and_then(|a| a.as_str()).unwrap_or("_id"),
        },
    };

    let commande = mongodb::bson::doc! {
        "explain": interne,
        "verbosity": "queryPlanner",
    };
    let reponse = client
        .database(base)
        .run_command(commande.clone())
        .await
        .map_err(|e| mongo_error::traduire(&e))?;

    let texte = serde_json::to_string_pretty(&Bson::Document(reponse).into_relaxed_extjson())
        .unwrap_or_else(|_| "plan illisible".to_owned());

    Ok(QueryPlan {
        lines: texte.lines().map(str::to_owned).collect(),
        sql: format!(
            "db.runCommand({})",
            Bson::Document(commande).into_relaxed_extjson()
        ),
        duration_ms: u64::try_from(debut.elapsed().as_millis()).unwrap_or(u64::MAX),
    })
}

/// Le n-ième argument d'une opération, s'il est un document.
fn argument_document(operation: &commande::Operation, rang: usize) -> Option<Document> {
    operation.arguments.get(rang)?.as_document().cloned()
}

/// Les tests contre un MongoDB **réel**, en jeu de réplicas à un nœud.
///
/// Pourquoi un jeu de réplicas et non un `mongod` seul : `18f` refuse d'écrire sans transaction, et
/// un décor isolé ne permettrait pas de tester le chemin qui écrit — seulement le refus. Le refus a
/// son propre test, qui n'a besoin d'aucune base.
///
/// ```bash
/// docker run -d --name dorabase-test-mongo -p 57017:27017 mongo:8 --replSet rs0 --bind_ip_all
/// docker exec dorabase-test-mongo mongosh --quiet --eval \
///   'rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]})'
/// docker exec -i dorabase-test-mongo mongosh --quiet < scripts/schema-test-mongo.js
/// DORABASE_TEST_MONGO=mongodb://localhost:57017 cargo test --features db-tests mongo
/// ```
#[cfg(all(test, feature = "db-tests"))]
mod tests_db {
    use super::*;
    use crate::config::SslMode;

    /// La base du décor (`scripts/schema-test-mongo.js`). **Noms inventés** — voir `AGENTS.md`.
    const BASE: &str = "atelier_ventes";

    fn variante() -> ConnectionSettings {
        let url = std::env::var("DORABASE_TEST_MONGO")
            .expect("DORABASE_TEST_MONGO doit être défini pour les tests de base");
        let hote_port = url.trim_start_matches("mongodb://");
        let (hote, port) = hote_port.split_once(':').expect("hôte:port attendu");
        ConnectionSettings {
            host: hote.to_owned(),
            port: port.trim_end_matches('/').parse().expect("port"),
            default_database: BASE.to_owned(),
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

    async fn adaptateur() -> MongoAdapter {
        MongoAdapter::connect_via(&variante(), None, std::path::Path::new("/dev/null"))
            .await
            .expect("connexion au MongoDB de test")
    }

    #[tokio::test]
    async fn la_sonde_rend_une_latence_et_une_version() {
        let sonde = adaptateur().await.probe().await.expect("sonde");
        assert!(
            sonde.server_version.starts_with("MongoDB "),
            "{}",
            sonde.server_version
        );
    }

    #[tokio::test]
    async fn le_deploiement_est_reconnu_comme_transactionnel() {
        // **Le décor est un jeu de réplicas**, et `18f` en dépend : c'est ce qui distingue « je
        // refuse d'écrire » de « j'écris dans une transaction ».
        assert_eq!(adaptateur().await.deploiement, Deploiement::Transactionnel);
    }

    #[tokio::test]
    async fn les_bases_portent_le_niveau_schema_et_ecartent_celles_de_service() {
        let bases = adaptateur().await.schemas().await.expect("bases");
        let noms: Vec<&str> = bases.iter().map(|b| b.name.as_str()).collect();
        // **La décision de `18a` en acte** : le niveau « schéma » porte les bases MongoDB, et il
        // en faut plus d'une pour que ce test morde.
        assert!(noms.contains(&"atelier_ventes"), "{noms:?}");
        assert!(noms.contains(&"atelier_journal"), "{noms:?}");
        // `admin`, `config` et `local` sont la plomberie de MongoDB : les afficher mettrait trois
        // entrées de bruit en tête de l'arbre.
        assert!(!noms.contains(&"admin"), "{noms:?}");
        assert!(!noms.contains(&"local"), "{noms:?}");
    }

    #[tokio::test]
    async fn les_collections_apparaissent_y_compris_la_vide_et_sans_les_internes() {
        let objets = adaptateur().await.objects(BASE).await.expect("collections");
        let noms: Vec<&str> = objets.iter().map(|o| o.name.as_str()).collect();
        assert!(noms.contains(&"commandes"), "{noms:?}");
        // **Une collection vide se voit** : une absence se lirait comme une donnée non chargée —
        // le doute exact que le défaut de `06d` a produit.
        assert!(noms.contains(&"paniers_abandonnes"), "{noms:?}");
        // `system.views` apparaît dès qu'une vue existe. Constaté en chargeant le décor.
        assert!(!noms.iter().any(|n| n.starts_with("system.")), "{noms:?}");
    }

    #[tokio::test]
    async fn une_vue_se_distingue_d_une_collection() {
        let objets = adaptateur().await.objects(BASE).await.expect("collections");
        let vue = objets
            .iter()
            .find(|o| o.name == "commandes_payees")
            .expect("la vue du décor");
        assert_eq!(vue.kind, crate::engine::ObjectKind::View);
        // Une vue n'a ni compte ni taille propres : les inventer serait exécuter son pipeline.
        assert_eq!(vue.rows, RowCount::Unknown);
        assert_eq!(vue.primary_key, None);
    }

    #[tokio::test]
    async fn le_compte_de_documents_est_marque_estime() {
        let objets = adaptateur().await.objects(BASE).await.expect("collections");
        let commandes = objets.iter().find(|o| o.name == "commandes").unwrap();
        // `collStats` lit les métadonnées : instantané et approximatif. Le type le dit, et `A4`
        // affiche le `≈` en conséquence.
        assert!(
            matches!(commandes.rows, RowCount::Estimated { value } if value == 5),
            "{:?}",
            commandes.rows
        );
    }

    #[tokio::test]
    async fn le_schema_deduit_rend_une_frequence_inferieure_a_un_pour_un_champ_absent() {
        let detail = adaptateur()
            .await
            .table_detail(BASE, "commandes")
            .await
            .expect("détail");

        let remise = detail
            .columns
            .iter()
            .find(|c| c.name == "remise")
            .expect("le champ absent du décor");
        // `remise` est dans quatre documents sur cinq — trois valeurs, un `null`, un absent.
        let frequence = remise
            .frequency
            .expect("une fréquence pour un schéma déduit");
        assert!(
            (0.7..1.0).contains(&frequence),
            "fréquence attendue sous 1, obtenue {frequence}"
        );

        // `_id` est **toujours** là : MongoDB l'impose.
        let id = detail.columns.iter().find(|c| c.name == "_id").unwrap();
        assert_eq!(id.frequency, Some(1.0));
        assert_eq!(id.key, Some(crate::engine::KeyKind::Primary));
        assert!(!id.nullable, "_id n'est jamais nul");
    }

    #[tokio::test]
    async fn un_champ_heterogene_dit_ses_deux_types() {
        let detail = adaptateur()
            .await
            .table_detail(BASE, "commandes")
            .await
            .expect("détail");
        let montant = detail
            .columns
            .iter()
            .find(|c| c.name == "montant")
            .expect("le champ hétérogène du décor");
        // **Deux entiers, trois décimaux** : le majoritaire est le décimal, et le nom natif doit
        // dire les deux. Annoncer « decimal » seul ferait croire à une collection homogène.
        assert!(
            montant.type_name.contains("decimal"),
            "{}",
            montant.type_name
        );
        assert!(montant.type_name.contains("int"), "{}", montant.type_name);
        assert_eq!(montant.category, crate::engine::TypeCategory::Number);
    }

    #[tokio::test]
    async fn le_ddl_d_une_collection_recree_ses_index() {
        let detail = adaptateur()
            .await
            .table_detail(BASE, "commandes")
            .await
            .expect("détail");
        assert!(
            detail.ddl.contains("db.createCollection(\"commandes\")"),
            "{}",
            detail.ddl
        );
        assert!(
            detail.ddl.contains("commandes_reference_uniq"),
            "{}",
            detail.ddl
        );
        assert!(detail.ddl.contains("unique: true"), "{}", detail.ddl);
        // `_id_` est omis : MongoDB le crée d'office et refuse qu'on le recrée.
        assert!(!detail.ddl.contains("\"_id\": 1"), "{}", detail.ddl);
    }

    #[tokio::test]
    async fn le_validateur_apparait_comme_une_contrainte_et_les_relations_restent_vides() {
        let detail = adaptateur()
            .await
            .table_detail(BASE, "commandes")
            .await
            .expect("détail");
        // Aucune clé étrangère en MongoDB. Une convention de nommage serait une devinette, et `12d`
        // a établi qu'une suggestion fausse est pire qu'une absence.
        assert!(detail.relations.is_empty());
        assert!(detail.triggers.is_empty());
    }

    #[tokio::test]
    async fn une_fenetre_de_documents_se_lit_avec_ses_types() {
        let adaptateur = adaptateur().await;
        let mut requete = RowQuery::new(BASE, "commandes", RowLimit::OneHundred);
        requete.sort = vec![crate::engine::SortKey {
            column: "reference".into(),
            direction: crate::engine::SortDirection::Ascending,
        }];
        let fenetre = adaptateur.rows(&requete).await.expect("fenêtre");
        assert_eq!(fenetre.rows.len(), 5);

        let detail = adaptateur.table_detail(BASE, "commandes").await.unwrap();
        let index_de = |nom: &str| detail.columns.iter().position(|c| c.name == nom).unwrap();

        // **Les types du décor, lus jusqu'au bout.** C'est le test qui aurait attrapé le défaut de
        // `06d` : une valeur mal lue s'y voit comme un `Null`.
        let premiere = &fenetre.rows[0];
        assert!(matches!(
            &premiere[index_de("livraison")],
            Value::Json { .. }
        ));
        assert!(matches!(
            &premiere[index_de("cree_le")],
            Value::Timestamp { .. }
        ));
        assert!(matches!(
            &premiere[index_de("empreinte")],
            Value::Binary { .. }
        ));
        assert!(matches!(&premiere[index_de("montant")], Value::Int { .. }));

        // Le décimal exact du décor, sur un document plus récent.
        let decimaux: Vec<&Value> = fenetre
            .rows
            .iter()
            .map(|ligne| &ligne[index_de("montant")])
            .collect();
        assert!(
            decimaux
                .iter()
                .any(|v| matches!(v, Value::Decimal { value } if value == "88.40")),
            "le décimal doit garder ses chiffres : {decimaux:?}"
        );
    }

    #[tokio::test]
    async fn un_champ_absent_et_un_champ_nul_donnent_tous_deux_une_cellule_vide() {
        let adaptateur = adaptateur().await;
        let requete = RowQuery::new(BASE, "commandes", RowLimit::OneHundred);
        let fenetre = adaptateur.rows(&requete).await.expect("fenêtre");
        let detail = adaptateur.table_detail(BASE, "commandes").await.unwrap();
        let remise = detail
            .columns
            .iter()
            .position(|c| c.name == "remise")
            .unwrap();

        // **La limite nommée dans `18e`** : le modèle ne distingue pas l'absent du nul. Deux
        // documents du décor portent chacun un cas, et les deux rendent `Null`.
        let vides = fenetre
            .rows
            .iter()
            .filter(|ligne| ligne[remise] == Value::Null)
            .count();
        assert_eq!(vides, 2, "un champ absent et un champ nul");
    }

    #[tokio::test]
    async fn un_filtre_is_null_trouve_l_absent_comme_le_nul() {
        let adaptateur = adaptateur().await;
        let mut requete = RowQuery::new(BASE, "commandes", RowLimit::OneHundred);
        requete.filters = vec![crate::engine::Filter {
            column: "remise".into(),
            operator: crate::engine::FilterOperator::IsNull,
            value: None,
        }];
        let fenetre = adaptateur.rows(&requete).await.expect("fenêtre");
        // **Deux, pas un.** Sans `$in: [null]`, ce filtre ne trouverait que le document dont le
        // champ est explicitement nul, et l'autre se lirait comme une absence de données.
        assert_eq!(fenetre.rows.len(), 2, "le nul et l'absent");
    }

    #[tokio::test]
    async fn un_filtre_matches_cherche_une_sous_chaine_sans_interpreter_le_motif() {
        let adaptateur = adaptateur().await;
        let mut requete = RowQuery::new(BASE, "commandes", RowLimit::OneHundred);
        requete.filters = vec![crate::engine::Filter {
            column: "reference".into(),
            operator: crate::engine::FilterOperator::Matches,
            value: Some("CMD-000".into()),
        }];
        assert_eq!(adaptateur.rows(&requete).await.unwrap().rows.len(), 5);

        // Le même filtre avec un motif : échappé, il ne trouve rien plutôt que tout.
        requete.filters[0].value = Some(".*".into());
        assert_eq!(
            adaptateur.rows(&requete).await.unwrap().rows.len(),
            0,
            "« .* » doit être cherché littéralement, pas interprété"
        );
    }

    #[tokio::test]
    async fn la_console_execute_une_operation_et_annonce_sa_limite() {
        let resultat = adaptateur()
            .await
            .run_sql(
                "db.commandes.find({ statut: 'payee' })",
                RowLimit::OneHundred,
            )
            .await
            .expect("exécution");
        assert_eq!(resultat.rows.len(), 2);
        // **La limite ajoutée est dite** : une limite tue ferait croire à une collection de deux
        // documents — un mensonge sur les données.
        assert_eq!(resultat.applied_limit, Some(100));
        assert!(resultat.columns.contains(&"reference".to_owned()));
    }

    #[tokio::test]
    async fn les_colonnes_du_resultat_sont_l_union_des_champs_pas_ceux_du_premier() {
        // `CMD-0003` n'a pas de `remise`. Si les colonnes venaient du premier document rencontré,
        // l'ordre du tri déciderait des champs affichés — et un document plus riche perdrait les
        // siens.
        let resultat = adaptateur()
            .await
            .run_sql(
                "db.commandes.find({ reference: { \"$in\": [\"CMD-0003\", \"CMD-0001\"] } })",
                RowLimit::OneHundred,
            )
            .await
            .expect("exécution");
        assert!(
            resultat.columns.contains(&"remise".to_owned()),
            "{:?}",
            resultat.columns
        );
    }

    #[tokio::test]
    async fn une_agregation_recoit_sa_limite_en_fin_de_pipeline() {
        let resultat = adaptateur()
            .await
            .run_sql(
                "db.mouvements.aggregate([{ \"$match\": { canal: 'ligne' } }])",
                RowLimit::OneHundred,
            )
            .await
            .expect("exécution");
        // 15 000 documents correspondent ; la limite doit les borner à cent.
        assert_eq!(resultat.rows.len(), 100);
        assert_eq!(resultat.applied_limit, Some(100));
    }

    #[tokio::test]
    async fn un_use_de_tete_change_de_base() {
        let resultat = adaptateur()
            .await
            .run_sql(
                "use atelier_journal;\ndb.evenements.find({})",
                RowLimit::OneHundred,
            )
            .await
            .expect("exécution");
        // La base déclarée est `atelier_ventes`, qui n'a pas de collection `evenements`.
        assert_eq!(resultat.rows.len(), 2);
    }

    #[tokio::test]
    async fn expliquer_n_execute_pas_la_requete() {
        let adaptateur = adaptateur().await;
        let avant = documents_lus(&adaptateur).await;
        let plan = adaptateur
            .explain_sql("db.mouvements.find({ canal: 'ligne' })")
            .await
            .expect("plan");
        let apres = documents_lus(&adaptateur).await;

        let texte = plan.lines.join("\n");
        assert!(texte.contains("queryPlanner"), "{texte}");

        // **La preuve est structurelle, pas statistique.** MongoDB ne rend `executionStats` que
        // s'il a *exécuté* la requête : son absence est le signal, et il est déterministe.
        //
        // Une première version comparait le compteur `document.returned` du serveur avant et après.
        // Il est **global au serveur** : les vingt-trois autres tests de ce module lisaient en même
        // temps, et le test échouait sur « explain a lu 37 documents » — trente-sept documents que
        // ses voisins avaient lus. Une mesure d'état partagé ne prouve rien dans une suite
        // parallèle.
        assert!(
            !texte.contains("executionStats"),
            "explain a exécuté la requête : {texte}"
        );

        // Le compteur reste, en garde-fou **large** : cette requête rendrait quinze mille
        // documents, donc un écart de cet ordre serait une exécution, quoi que fassent les voisins.
        assert!(
            apres - avant < 5_000,
            "explain a lu {} documents",
            apres - avant
        );
    }

    /// Le compteur `document.returned` du serveur.
    ///
    /// **Global au serveur**, donc bruité par les tests voisins : il ne sert que de borne large.
    async fn documents_lus(adaptateur: &MongoAdapter) -> i64 {
        let stats = adaptateur
            .client
            .database("admin")
            .run_command(mongodb::bson::doc! { "serverStatus": 1 })
            .await
            .expect("serverStatus");
        stats
            .get_document("metrics")
            .and_then(|m| m.get_document("document"))
            .and_then(|d| d.get_i64("returned"))
            .unwrap_or(0)
    }

    #[tokio::test]
    async fn du_javascript_est_refuse_par_la_console_reelle() {
        let erreur = adaptateur()
            .await
            .run_sql(
                "for (const c of db.commandes.find()) { print(c) }",
                RowLimit::OneHundred,
            )
            .await
            .expect_err("refusée");
        assert!(
            erreur.message.contains("pas du JavaScript"),
            "{}",
            erreur.message
        );
    }

    #[tokio::test]
    async fn une_collection_inconnue_le_dit_plutot_que_de_rendre_zero_ligne() {
        let erreur = adaptateur()
            .await
            .table_detail(BASE, "collection_qui_n_existe_pas")
            .await
            .expect_err("doit échouer");
        assert!(
            erreur.message.contains("n'existe pas"),
            "{}",
            erreur.message
        );
    }

    #[tokio::test]
    async fn une_modification_previsualisee_est_celle_qui_part() {
        let adaptateur = adaptateur().await;
        // Un document à soi, pour que deux tests concurrents ne se disputent pas la même ligne —
        // la leçon des tests d'écriture de `11d`.
        let reference = "CMD-ECRITURE-1";
        preparer_un_document(&adaptateur, reference).await;

        let plan = UpdatePlan {
            schema: BASE.to_owned(),
            table: "commandes_essai".to_owned(),
            key_column: "reference".to_owned(),
            changes: vec![PendingUpdate {
                key: reference.to_owned(),
                column: "statut".to_owned(),
                value: Some("payee".to_owned()),
                expected: Some("en_attente".to_owned()),
            }],
        };

        let apercu = adaptateur.preview_updates(&plan).await.expect("aperçu");
        assert!(apercu.contains("db.commandes_essai.updateOne"), "{apercu}");
        assert!(apercu.contains("en_attente"), "{apercu}");
        assert!(apercu.contains("payee"), "{apercu}");

        let issue = adaptateur.apply_updates(&plan).await.expect("écriture");
        assert_eq!(issue.applied, 1);
        // Le patch inverse défait exactement ce qui a été fait.
        assert!(
            issue.inverse_sql.contains("en_attente"),
            "{}",
            issue.inverse_sql
        );

        // Relu : l'écriture a bien eu lieu.
        let mut requete = RowQuery::new(BASE, "commandes_essai", RowLimit::OneHundred);
        requete.filters = vec![crate::engine::Filter {
            column: "reference".into(),
            operator: crate::engine::FilterOperator::Eq,
            value: Some(reference.to_owned()),
        }];
        let fenetre = adaptateur.rows(&requete).await.expect("relecture");
        let detail = adaptateur
            .table_detail(BASE, "commandes_essai")
            .await
            .unwrap();
        let statut = detail
            .columns
            .iter()
            .position(|c| c.name == "statut")
            .unwrap();
        assert_eq!(
            fenetre.rows[0][statut],
            Value::Text {
                value: "payee".into()
            }
        );
    }

    #[tokio::test]
    async fn une_modification_partant_d_une_cellule_vide_atteint_le_champ_absent() {
        let adaptateur = adaptateur().await;
        let reference = "CMD-ECRITURE-2";
        preparer_un_document(&adaptateur, reference).await;

        // **Le défaut annoncé par `18f`** : le document n'a **pas** de champ `note`. Un filtre
        // `{note: null}` ne le trouverait pas, la transaction serait annulée, et l'utilisateur
        // verrait « le document a changé » sur un document que personne n'a touché.
        let plan = UpdatePlan {
            schema: BASE.to_owned(),
            table: "commandes_essai".to_owned(),
            key_column: "reference".to_owned(),
            changes: vec![PendingUpdate {
                key: reference.to_owned(),
                column: "note".to_owned(),
                value: Some("vu".to_owned()),
                expected: None,
            }],
        };
        let issue = adaptateur.apply_updates(&plan).await.expect("écriture");
        assert_eq!(issue.applied, 1, "un champ absent doit être atteignable");
    }

    #[tokio::test]
    async fn une_modification_concurrente_annule_toute_la_transaction() {
        let adaptateur = adaptateur().await;
        let reference = "CMD-ECRITURE-3";
        preparer_un_document(&adaptateur, reference).await;

        let plan = UpdatePlan {
            schema: BASE.to_owned(),
            table: "commandes_essai".to_owned(),
            key_column: "reference".to_owned(),
            changes: vec![
                PendingUpdate {
                    key: reference.to_owned(),
                    column: "statut".to_owned(),
                    value: Some("payee".to_owned()),
                    expected: Some("en_attente".to_owned()),
                },
                // La seconde attend une valeur qui n'est pas là : elle doit faire annuler la
                // **première** aussi. Trois modifications qui s'appliqueraient à moitié
                // laisseraient des données incohérentes que rien ne signalerait (`06a`).
                PendingUpdate {
                    key: reference.to_owned(),
                    column: "devise".to_owned(),
                    value: Some("USD".to_owned()),
                    expected: Some("JPY".to_owned()),
                },
            ],
        };
        let erreur = adaptateur
            .apply_updates(&plan)
            .await
            .expect_err("doit refuser");
        assert!(erreur.message.contains("a changé"), "{}", erreur.message);

        // Et le statut est resté : rien n'a été écrit.
        let mut requete = RowQuery::new(BASE, "commandes_essai", RowLimit::OneHundred);
        requete.filters = vec![crate::engine::Filter {
            column: "reference".into(),
            operator: crate::engine::FilterOperator::Eq,
            value: Some(reference.to_owned()),
        }];
        let fenetre = adaptateur.rows(&requete).await.expect("relecture");
        let detail = adaptateur
            .table_detail(BASE, "commandes_essai")
            .await
            .unwrap();
        let statut = detail
            .columns
            .iter()
            .position(|c| c.name == "statut")
            .unwrap();
        assert_eq!(
            fenetre.rows[0][statut],
            Value::Text {
                value: "en_attente".into()
            },
            "la première modification doit avoir été annulée avec la seconde"
        );
    }

    /// Insère un document à soi dans une collection d'essai.
    ///
    /// **Chaque test d'écriture le sien**, avec sa propre référence : la leçon de `11d`, où des
    /// tests concurrents prenaient « la première ligne » et se la disputaient.
    async fn preparer_un_document(adaptateur: &MongoAdapter, reference: &str) {
        let collection = adaptateur
            .client
            .database(BASE)
            .collection::<Document>("commandes_essai");
        let _ = collection
            .delete_many(mongodb::bson::doc! { "reference": reference })
            .await;
        collection
            .insert_one(mongodb::bson::doc! {
                "reference": reference,
                "statut": "en_attente",
                "devise": "EUR",
            })
            .await
            .expect("insertion du document d'essai");
    }
}
