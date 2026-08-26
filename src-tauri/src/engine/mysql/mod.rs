//! L'adaptateur MySQL / MariaDB — specs `16a` à `16c`.
//!
//! # Les quatre écarts avec PostgreSQL
//!
//! 1. **« Base » et « schéma » sont le même mot.** MySQL n'a qu'un niveau là où PostgreSQL en a
//!    deux : le niveau « schéma » de l'arbre porte donc les **bases du serveur**, et la déclaration
//!    de connexion porte le serveur. Même réponse qu'en `18a` pour MongoDB.
//! 2. **MariaDB n'est pas MySQL.** Les deux répondent au même protocole et divergent sur le
//!    catalogue ; la version rendue les distingue (`16a`).
//! 3. **Les identifiants se citent au backtick**, et `ANSI_QUOTES` peut inverser la règle en cours de
//!    session. Le mode SQL est donc **fixé à l'ouverture** plutôt que subi (`16c`).
//! 4. **InnoDB transige, MyISAM non.** Le moteur de stockage est lisible dans le catalogue, donc le
//!    refus d'écrire arrive **avant** la première écriture — la décision de `18f`, rejouée.
//!
//! Et un piège qui n'existe nulle part ailleurs : **le fuseau des horodatages**. MySQL convertit un
//! `TIMESTAMP` dans le fuseau de la session, donc deux clients réglés différemment liraient des
//! valeurs différentes de la même ligne. La session est forcée à UTC (`16a`).

mod connect;
mod error;
mod introspect;
mod rows;

use std::time::Instant;

use mysql_async::prelude::Queryable;
use mysql_async::{Conn, Pool, Row, TxOpts};

use crate::config::ConnectionSettings;
use crate::engine::proxy::{EtatProxy, ProxyOuvert};
use crate::engine::{
    ApplyOutcome, ConnectionProbe, EngineAdapter, EngineError, QueryPlan, QueryResult, RowCount,
    RowLimit, RowQuery, RowWindow, SchemaInfo, TableDetail, TableSummary, TypeCategory, UpdatePlan,
    Value,
};
use crate::secrets::Secret;

/// L'adaptateur MySQL / MariaDB.
pub struct MysqlAdapter {
    pool: Pool,
    /// La chaîne de version, lue une fois à l'ouverture.
    ///
    /// **Gardée plutôt que redemandée** : `probe()` est appelé à chaque ouverture par le registre
    /// (`09b`), et la version d'un serveur ne change pas pendant une connexion.
    version: String,
    /// Même raison qu'en `06b` et `18b` : le tunnel vit aussi longtemps que la connexion.
    proxy: Option<ProxyOuvert>,
}

/// `Debug` à la main, pour la raison de `05c` : un dérivé exposerait la configuration du pool, qui
/// porte le mot de passe.
impl std::fmt::Debug for MysqlAdapter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("MysqlAdapter { … }")
    }
}

impl MysqlAdapter {
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
            Ok((pool, version)) => Ok(Self {
                pool,
                version,
                proxy,
            }),
            // La qualification de `06e` : sans elle, un bastion tombé produit un « connection
            // refused » sur `127.0.0.1`, qui envoie chercher un problème de MySQL.
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
        // **Le pool se ferme avant le tunnel.** L'inverse fermerait l'écouteur local pendant que des
        // connexions l'utilisent encore, et le pilote signalerait des erreurs de réseau à la
        // fermeture — bruit inutile dans le journal.
        let _ = self.pool.disconnect().await;
        if let Some(proxy) = self.proxy {
            proxy.fermer().await;
        }
    }

    async fn connexion(&self) -> Result<Conn, EngineError> {
        self.pool.get_conn().await.map_err(|e| error::traduire(&e))
    }

    /// Le moteur de stockage d'une table, ou `None` pour une vue.
    ///
    /// **Lu avant d'écrire** (`16c`) : MyISAM n'a pas de transaction, donc `apply_updates` doit
    /// refuser plutôt que d'appliquer trois modifications sur quatre.
    async fn moteur_de_stockage(
        &self,
        base: &str,
        table: &str,
    ) -> Result<Option<String>, EngineError> {
        let mut connexion = self.connexion().await?;
        let ligne: Option<Row> = connexion
            .exec_first(
                "select engine from information_schema.tables
                  where table_schema = ? and table_name = ?",
                (base, table),
            )
            .await
            .map_err(|e| error::traduire(&e))?;
        Ok(ligne.and_then(|ligne| ligne.get::<Option<String>, _>(0).flatten()))
    }

    /// Les catégories de type d'une table, dans l'ordre des colonnes.
    ///
    /// **Nécessaires pour lire les valeurs** : le protocole textuel de MySQL rend presque tout en
    /// octets, et c'est la catégorie qui dit comment l'interpréter (voir `rows::valeur_de`).
    async fn categories(&self, base: &str, table: &str) -> Result<Vec<TypeCategory>, EngineError> {
        let mut connexion = self.connexion().await?;
        Ok(introspect::detail(&mut connexion, base, table)
            .await?
            .columns
            .into_iter()
            .map(|colonne| colonne.category)
            .collect())
    }
}

impl EngineAdapter for MysqlAdapter {
    async fn probe(&self) -> Result<ConnectionProbe, EngineError> {
        let debut = Instant::now();
        // Une lecture d'essai plutôt que la version gardée : `probe()` doit dire que le serveur
        // **répond maintenant**, pas qu'il répondait à l'ouverture.
        let mut connexion = self.connexion().await?;
        let _: Option<i64> = connexion
            .query_first("select 1")
            .await
            .map_err(|e| error::traduire(&e))?;
        Ok(ConnectionProbe {
            latency_ms: u32::try_from(debut.elapsed().as_millis()).unwrap_or(u32::MAX),
            server_version: error::nom_du_serveur(&self.version),
        })
    }

    async fn schemas(&self) -> Result<Vec<SchemaInfo>, EngineError> {
        let mut connexion = self.connexion().await?;
        introspect::bases(&mut connexion).await
    }

    async fn objects(&self, schema: &str) -> Result<Vec<TableSummary>, EngineError> {
        let mut connexion = self.connexion().await?;
        introspect::objets(&mut connexion, schema).await
    }

    async fn table_detail(&self, schema: &str, table: &str) -> Result<TableDetail, EngineError> {
        let mut connexion = self.connexion().await?;
        introspect::detail(&mut connexion, schema, table).await
    }

    async fn rows(&self, query: &RowQuery) -> Result<RowWindow, EngineError> {
        let debut = Instant::now();
        let categories = self.categories(&query.schema, &query.table).await?;
        let (sql, parametres) = rows::requete_de(query);

        let mut connexion = self.connexion().await?;
        let lignes: Vec<Row> = connexion
            .exec(&sql, parametres.clone())
            .await
            .map_err(|e| error::traduire(&e))?;

        // Le total **estimé**, comme `06d` prend `reltuples` : un `count(*)` sur une grande table
        // InnoDB parcourt l'index entier.
        let estimation: Option<Row> = connexion
            .exec_first(
                "select table_rows, engine from information_schema.tables
                  where table_schema = ? and table_name = ?",
                (&query.schema, &query.table),
            )
            .await
            .map_err(|e| error::traduire(&e))?;
        let total = estimation.and_then(|ligne| {
            let value: i64 = ligne.get::<Option<i64>, _>(0).flatten()?;
            let moteur: Option<String> = ligne.get(1).flatten();
            Some(if moteur.as_deref() == Some("MyISAM") {
                RowCount::Exact { value }
            } else {
                RowCount::Estimated { value }
            })
        });

        Ok(RowWindow {
            offset: query.offset,
            rows: lignes
                .iter()
                .map(|ligne| rows::ligne_de(ligne, &categories))
                .collect(),
            total,
            sql,
            duration_ms: u32::try_from(debut.elapsed().as_millis()).unwrap_or(u32::MAX),
        })
    }

    async fn row_as_insert(
        &self,
        schema: &str,
        table: &str,
        values: &[Value],
    ) -> Result<String, EngineError> {
        let mut connexion = self.connexion().await?;
        let colonnes: Vec<String> = introspect::detail(&mut connexion, schema, table)
            .await?
            .columns
            .into_iter()
            .map(|colonne| colonne.name)
            .collect();
        Ok(rows::insert_de(schema, table, &colonnes, values))
    }

    async fn preview_updates(&self, plan: &UpdatePlan) -> Result<String, EngineError> {
        Ok(rows::texte_de(&rows::instructions_de(plan)))
    }

    async fn apply_updates(&self, plan: &UpdatePlan) -> Result<ApplyOutcome, EngineError> {
        // **Le refus arrive avant la première écriture** (`16c`), comme en `18f` pour un `mongod`
        // isolé. MyISAM n'a pas de transaction : trois modifications s'y appliqueraient à moitié, et
        // `06a` promet « tout ou rien ».
        if let Some(moteur) = self.moteur_de_stockage(&plan.schema, &plan.table).await? {
            if moteur.eq_ignore_ascii_case("MyISAM") {
                return Err(EngineError::local(format!(
                    "la table « {} » est en MyISAM, un moteur de stockage sans transaction : \
                     plusieurs modifications pourraient s'appliquer à moitié. DoraBase n'écrit pas \
                     sans ce filet — InnoDB est nécessaire",
                    plan.table
                )));
            }
        }

        let mut connexion = self.connexion().await?;
        let mut transaction = connexion
            .start_transaction(TxOpts::default())
            .await
            .map_err(|e| error::traduire(&e))?;

        let mut appliquees = 0u64;
        for (sql, parametres) in rows::instructions_de(plan) {
            match transaction.exec_drop(&sql, parametres).await {
                Ok(()) => {
                    let touchees = transaction.affected_rows();
                    if touchees == 1 {
                        appliquees += 1;
                    } else {
                        // Zéro ligne : la ligne a changé depuis la lecture. **Toute** la transaction
                        // est annulée — pas un rapport partiel (`06a`).
                        let _ = transaction.rollback().await;
                        return Err(EngineError::local(format!(
                            "une ligne a changé depuis la lecture ({touchees} ligne(s) touchée(s)) : \
                             aucune modification n'a été écrite"
                        )));
                    }
                }
                Err(erreur) => {
                    let _ = transaction.rollback().await;
                    return Err(error::traduire(&erreur));
                }
            }
        }

        transaction
            .commit()
            .await
            .map_err(|e| error::traduire(&e))?;

        Ok(ApplyOutcome {
            applied: appliquees,
            inverse_sql: rows::texte_de(&rows::instructions_inverses(plan)),
        })
    }

    async fn run_sql(&self, sql: &str, limite: RowLimit) -> Result<QueryResult, EngineError> {
        let debut = Instant::now();
        let (borne, ajoutee) = rows::avec_limite(sql, limite);

        let mut connexion = self.connexion().await?;
        let lignes: Vec<Row> = connexion
            .query(&borne)
            .await
            .map_err(|e| error::traduire(&e))?;

        // **Les colonnes viennent du résultat, pas du catalogue** — la différence entre
        // `QueryResult` et `RowWindow` que `12c` a posée. Et les catégories viennent du **type
        // annoncé par le protocole**, seul renseignement disponible pour une colonne calculée :
        // `count(*)` n'existe dans aucun catalogue.
        let (colonnes, categories) = match lignes.first() {
            Some(premiere) => {
                let refs = premiere.columns_ref();
                (
                    refs.iter().map(|c| c.name_str().into_owned()).collect(),
                    refs.iter()
                        .map(|c| categorie_du_protocole(c.column_type()))
                        .collect::<Vec<_>>(),
                )
            }
            None => (Vec::new(), Vec::new()),
        };

        Ok(QueryResult {
            columns: colonnes,
            rows: lignes
                .iter()
                .map(|ligne| rows::ligne_de(ligne, &categories))
                .collect(),
            sql: borne,
            duration_ms: u64::try_from(debut.elapsed().as_millis()).unwrap_or(u64::MAX),
            applied_limit: ajoutee,
        })
    }

    async fn explain_sql(&self, sql: &str) -> Result<QueryPlan, EngineError> {
        let debut = Instant::now();
        // **`EXPLAIN FORMAT=TREE` quand le serveur le connaît, `EXPLAIN` sinon.** Jamais
        // `EXPLAIN ANALYZE`, qui **exécute** la requête pour la mesurer : sur une console où l'on
        // écrit aussi, « Expliquer » deviendrait un bouton qui écrit — la règle de `12e`.
        let nu = sql.trim().trim_end_matches(';');
        let arbre = format!("explain format=tree {nu}");
        let simple = format!("explain {nu}");

        let mut connexion = self.connexion().await?;
        let (commande, lignes) = match connexion.query::<Row, _>(&arbre).await {
            Ok(lignes) => (arbre, lignes),
            // `FORMAT=TREE` demande MySQL 8.0.16 ; MariaDB ne le connaît pas du tout. Le repli est
            // silencieux parce que la question « quelle forme le serveur accepte » n'intéresse pas
            // l'utilisateur — seul le plan compte.
            Err(_) => {
                let lignes = connexion
                    .query::<Row, _>(&simple)
                    .await
                    .map_err(|e| error::traduire(&e))?;
                (simple, lignes)
            }
        };

        Ok(QueryPlan {
            lines: lignes.iter().map(ligne_de_plan).collect(),
            sql: commande,
            duration_ms: u64::try_from(debut.elapsed().as_millis()).unwrap_or(u64::MAX),
        })
    }
}

/// Une ligne de plan rendue lisible.
///
/// `FORMAT=TREE` rend une seule colonne, déjà mise en forme. `EXPLAIN` simple en rend douze, dont on
/// assemble les utiles — les afficher toutes ferait une ligne de trois cents caractères.
fn ligne_de_plan(ligne: &Row) -> String {
    if ligne.columns_ref().len() == 1 {
        return ligne
            .get::<Option<String>, _>(0)
            .flatten()
            .unwrap_or_default();
    }
    let colonne = |nom: &str| -> String {
        ligne
            .get_opt::<Option<String>, _>(nom)
            .and_then(Result::ok)
            .flatten()
            .unwrap_or_else(|| "—".to_owned())
    };
    format!(
        "{} · type {} · clé {} · lignes {} · {}",
        colonne("table"),
        colonne("type"),
        colonne("key"),
        ligne
            .get_opt::<Option<i64>, _>("rows")
            .and_then(Result::ok)
            .flatten()
            .map(|n| n.to_string())
            .unwrap_or_else(|| "—".to_owned()),
        colonne("Extra")
    )
}

/// La catégorie d'une colonne de résultat, depuis le type que le protocole annonce.
///
/// **Le seul renseignement disponible pour une requête libre** : une colonne calculée n'est dans
/// aucun catalogue. `12e` fait le même choix côté écran en dérivant l'alignement de la première
/// valeur ; ici le protocole le dit mieux.
fn categorie_du_protocole(type_colonne: mysql_async::consts::ColumnType) -> TypeCategory {
    use mysql_async::consts::ColumnType as T;
    match type_colonne {
        T::MYSQL_TYPE_TINY
        | T::MYSQL_TYPE_SHORT
        | T::MYSQL_TYPE_LONG
        | T::MYSQL_TYPE_LONGLONG
        | T::MYSQL_TYPE_INT24
        | T::MYSQL_TYPE_FLOAT
        | T::MYSQL_TYPE_DOUBLE
        | T::MYSQL_TYPE_DECIMAL
        | T::MYSQL_TYPE_NEWDECIMAL => TypeCategory::Number,
        T::MYSQL_TYPE_DATE
        | T::MYSQL_TYPE_DATETIME
        | T::MYSQL_TYPE_TIMESTAMP
        | T::MYSQL_TYPE_NEWDATE
        | T::MYSQL_TYPE_DATETIME2
        | T::MYSQL_TYPE_TIMESTAMP2
        | T::MYSQL_TYPE_YEAR => TypeCategory::Timestamp,
        T::MYSQL_TYPE_JSON => TypeCategory::Json,
        // **`BLOB` et `TEXT` partagent le même code de protocole** : MySQL les distingue par la
        // collation, que le pilote n'expose pas ici. Le texte est le repli le moins mauvais — un
        // `TEXT` rendu en base64 serait illisible, alors qu'un `BLOB` rendu en texte reste lisible
        // pour ce qui est imprimable. La grille de `A5` lit les vraies catégories du catalogue ; ce
        // repli ne concerne que la console.
        T::MYSQL_TYPE_BLOB
        | T::MYSQL_TYPE_TINY_BLOB
        | T::MYSQL_TYPE_MEDIUM_BLOB
        | T::MYSQL_TYPE_LONG_BLOB => TypeCategory::Text,
        T::MYSQL_TYPE_VAR_STRING | T::MYSQL_TYPE_STRING | T::MYSQL_TYPE_VARCHAR => {
            TypeCategory::Text
        }
        _ => TypeCategory::Other,
    }
}

/// Les tests contre un MySQL **réel**.
///
/// ```bash
/// export DORABASE_TEST_MYSQL=$(./scripts/mysql-test.sh demarrer)
/// cargo test --features db-tests mysql
/// ```
#[cfg(all(test, feature = "db-tests"))]
mod tests_db {
    use super::*;
    use crate::config::SslMode;
    use crate::engine::{Filter, FilterOperator, Identity, KeyKind, ObjectKind, PendingUpdate};

    /// La base du décor (`scripts/schema-test-mysql.sql`). **Noms inventés** — voir `AGENTS.md`.
    const BASE: &str = "dorabase_test";

    fn variante() -> ConnectionSettings {
        // `mysql://dorabase:mot@localhost:53306/dorabase_test`
        let url = std::env::var("DORABASE_TEST_MYSQL")
            .expect("DORABASE_TEST_MYSQL doit être défini pour les tests de base");
        let sans_schema = url.trim_start_matches("mysql://");
        let (identifiants, hote_base) = sans_schema.split_once('@').expect("@ attendu");
        let (utilisateur, _) = identifiants.split_once(':').expect(": attendu");
        let (hote_port, base) = hote_base.split_once('/').expect("/ attendu");
        let (hote, port) = hote_port.split_once(':').expect("hôte:port attendu");
        ConnectionSettings {
            host: hote.to_owned(),
            port: port.parse().expect("port"),
            default_database: base.to_owned(),
            username: utilisateur.to_owned(),
            password: None,
            ssl_mode: SslMode::Disable,
            ca_certificate: None,
            auth_database: None,
            read_only: false,
            reconnect_on_startup: false,
            tunnel: None,
        }
    }

    fn mot_de_passe() -> Secret {
        let url = std::env::var("DORABASE_TEST_MYSQL").unwrap();
        let sans_schema = url.trim_start_matches("mysql://");
        let (identifiants, _) = sans_schema.split_once('@').unwrap();
        let (_, mdp) = identifiants.split_once(':').unwrap();
        Secret::new(mdp)
    }

    async fn adaptateur() -> MysqlAdapter {
        MysqlAdapter::connect_via(
            &variante(),
            Some(&mot_de_passe()),
            std::path::Path::new("/dev/null"),
        )
        .await
        .expect("connexion au MySQL de test")
    }

    #[tokio::test]
    async fn la_sonde_rend_une_latence_et_distingue_le_serveur() {
        let sonde = adaptateur().await.probe().await.expect("sonde");
        // **MariaDB n'est pas MySQL** (`16a`) : le nom rendu doit dire lequel répond.
        assert!(
            sonde.server_version.starts_with("MySQL ")
                || sonde.server_version.starts_with("MariaDB "),
            "{}",
            sonde.server_version
        );
    }

    #[tokio::test]
    async fn les_bases_portent_le_niveau_schema_et_ecartent_celles_de_service() {
        let bases = adaptateur().await.schemas().await.expect("bases");
        let noms: Vec<&str> = bases.iter().map(|b| b.name.as_str()).collect();
        // **La décision de `16a` en acte** : « base » et « schéma » sont le même mot chez MySQL, et
        // c'est le niveau « schéma » de l'arbre qui les porte.
        assert!(noms.contains(&BASE), "{noms:?}");
        // Les quatre schémas de plomberie mettraient du bruit en tête de l'arbre.
        for de_service in ["information_schema", "performance_schema", "mysql", "sys"] {
            assert!(!noms.contains(&de_service), "{noms:?}");
        }
    }

    #[tokio::test]
    async fn les_tables_apparaissent_y_compris_la_vide() {
        let objets = adaptateur().await.objects(BASE).await.expect("objets");
        let noms: Vec<&str> = objets.iter().map(|o| o.name.as_str()).collect();
        assert!(noms.contains(&"ateliers"), "{noms:?}");
        assert!(noms.contains(&"seances"), "{noms:?}");
        // **Une table vide se voit** : une absence se lirait comme une donnée non chargée — le doute
        // que le défaut de `06d` a produit.
        assert!(noms.contains(&"listes_attente"), "{noms:?}");
    }

    #[tokio::test]
    async fn une_vue_se_distingue_d_une_table() {
        let objets = adaptateur().await.objects(BASE).await.expect("objets");
        let vue = objets
            .iter()
            .find(|o| o.name == "seances_ouvertes")
            .expect("la vue du décor");
        assert_eq!(vue.kind, ObjectKind::View);
        assert_eq!(vue.rows, RowCount::Unknown);
    }

    #[tokio::test]
    async fn innodb_estime_et_myisam_compte_exactement() {
        let objets = adaptateur().await.objects(BASE).await.expect("objets");

        // **L'estimation d'InnoDB peut être très fausse** : `RowCount::Estimated` le dit, et `A4`
        // affiche le `≈`. Ce qu'il faut éviter est de la croire assez bonne pour s'y fier.
        let seances = objets.iter().find(|o| o.name == "seances").unwrap();
        assert!(
            matches!(seances.rows, RowCount::Estimated { .. }),
            "{:?}",
            seances.rows
        );

        // **MyISAM tient le compte exact.** Le distinguer n'est pas de la coquetterie : c'est la
        // différence entre une valeur sur laquelle on décide et une valeur qu'on regarde.
        //
        // **Sur `compteur_myisam`, et non `journal_myisam`.** Ce test affirmait deux lignes dans le
        // journal ; or le test du refus d'écriture y pose sa propre ligne — ce que le défaut n° 62 lui
        // avait appris. Les deux tournant en parallèle, ce comptage voyait trois lignes une fois sur
        // deux, et l'échec n'est apparu qu'en CI. Nettoyer après l'écriture ne suffirait pas : la
        // course resterait ouverte entre l'insertion et la suppression. Une assertion de comptage
        // exact ne peut porter que sur une table qu'aucun autre test ne touche.
        let compteur = objets.iter().find(|o| o.name == "compteur_myisam").unwrap();
        assert_eq!(compteur.rows, RowCount::Exact { value: 2 });
    }

    #[tokio::test]
    async fn l_auto_increment_est_reconnu_comme_une_identite() {
        let detail = adaptateur()
            .await
            .table_detail(BASE, "ateliers")
            .await
            .expect("détail");
        let id = detail.columns.iter().find(|c| c.name == "id").unwrap();
        // **`auto_increment` vit dans `extra`, pas dans `column_default`** — exactement le piège de
        // `GENERATED … AS IDENTITY` en PostgreSQL, qui a fait perdre l'auto-incrément au DDL de `14c`
        // (défaut n° 49). Le manquer afficherait « — » dans la colonne « défaut » d'une clé primaire
        // auto-incrémentée, qui se lirait comme une colonne à remplir soi-même.
        assert_eq!(id.identity, Some(Identity::ByDefault));
        assert_eq!(id.key, Some(KeyKind::Primary));
    }

    #[tokio::test]
    async fn une_cle_etrangere_ne_se_confond_pas_avec_un_index_ordinaire() {
        let detail = adaptateur()
            .await
            .table_detail(BASE, "seances")
            .await
            .expect("détail");
        let atelier = detail
            .columns
            .iter()
            .find(|c| c.name == "atelier_id")
            .unwrap();
        assert_eq!(atelier.key, Some(KeyKind::Foreign));

        // **`MUL` ne suffit pas** : MySQL l'emploie pour la première colonne de tout index non
        // unique. `intitule` est la seconde colonne d'un index composé, donc sans clé — la confondre
        // avec une clé étrangère afficherait une relation inventée.
        let intitule = detail
            .columns
            .iter()
            .find(|c| c.name == "intitule")
            .unwrap();
        assert_eq!(intitule.key, None);
    }

    #[tokio::test]
    async fn le_ddl_vient_du_serveur_et_porte_l_auto_increment() {
        let detail = adaptateur()
            .await
            .table_detail(BASE, "ateliers")
            .await
            .expect("détail");
        // **Rendu par le serveur, pas reconstruit** : c'est l'avantage que `06c` n'avait pas.
        assert!(detail.ddl.contains("CREATE TABLE"), "{}", detail.ddl);
        assert!(detail.ddl.contains("AUTO_INCREMENT"), "{}", detail.ddl);
        // Et le mot réservé y est cité au backtick, comme MySQL l'écrit.
        assert!(detail.ddl.contains("`order`"), "{}", detail.ddl);
    }

    #[tokio::test]
    async fn les_index_les_declencheurs_et_les_relations_sont_lus() {
        let detail = adaptateur()
            .await
            .table_detail(BASE, "seances")
            .await
            .expect("détail");
        assert!(detail
            .indexes
            .iter()
            .any(|i| i.name == "seances_atelier_idx"));
        assert!(detail.triggers.iter().any(|t| t.name == "seances_touch"));

        let sortante = detail
            .relations
            .iter()
            .find(|r| r.direction == crate::engine::RelationDirection::Outgoing)
            .expect("seances référence ateliers");
        assert_eq!(sortante.target_table, "ateliers");
        assert_eq!(sortante.columns, vec!["atelier_id".to_owned()]);
        assert_eq!(sortante.target_columns, vec!["id".to_owned()]);
    }

    #[tokio::test]
    async fn une_relation_entrante_ne_confond_pas_les_colonnes() {
        let detail = adaptateur()
            .await
            .table_detail(BASE, "ateliers")
            .await
            .expect("détail");
        let entrante = detail
            .relations
            .iter()
            .find(|r| r.direction == crate::engine::RelationDirection::Incoming)
            .expect("seances référence ateliers");
        // **Le sens s'inverse, pas les tables** — la leçon du défaut du 10 août 2026 en `06c`, ici
        // pour la troisième fois.
        assert_eq!(entrante.target_table, "seances");
        assert_eq!(entrante.columns, vec!["id".to_owned()]);
        assert_eq!(entrante.target_columns, vec!["atelier_id".to_owned()]);
    }

    #[tokio::test]
    async fn une_fenetre_de_lignes_se_lit_avec_ses_types() {
        let adaptateur = adaptateur().await;
        let mut requete = RowQuery::new(BASE, "seances", RowLimit::OneHundred);
        requete.sort = vec![crate::engine::SortKey {
            column: "id".into(),
            direction: crate::engine::SortDirection::Ascending,
        }];
        let fenetre = adaptateur.rows(&requete).await.expect("fenêtre");
        assert_eq!(fenetre.rows.len(), 4);

        let detail = adaptateur.table_detail(BASE, "seances").await.unwrap();
        let index = |nom: &str| detail.columns.iter().position(|c| c.name == nom).unwrap();

        // **Le décimal reste exact.** Le convertir en flottant perdrait la précision, et c'est
        // inacceptable pour de l'argent — la leçon du défaut du 10 août 2026.
        assert_eq!(
            fenetre.rows[0][index("tarif")],
            Value::Decimal {
                value: "45.00".to_owned()
            }
        );
        assert!(matches!(
            &fenetre.rows[0][index("metadonnees")],
            Value::Json { .. }
        ));
        assert!(matches!(
            &fenetre.rows[0][index("empreinte")],
            Value::Binary { .. }
        ));
        assert!(matches!(
            &fenetre.rows[0][index("cree_le")],
            Value::Timestamp { .. }
        ));
        // Un `BLOB` nul reste nul, et ne devient pas un binaire vide.
        assert_eq!(fenetre.rows[1][index("empreinte")], Value::Null);
    }

    #[tokio::test]
    async fn un_tinyint_1_arrive_en_booleen() {
        let adaptateur = adaptateur().await;
        let requete = RowQuery::new(BASE, "ateliers", RowLimit::OneHundred);
        let fenetre = adaptateur.rows(&requete).await.expect("fenêtre");
        let detail = adaptateur.table_detail(BASE, "ateliers").await.unwrap();
        let actif = detail
            .columns
            .iter()
            .position(|c| c.name == "actif")
            .unwrap();

        // **MySQL n'a pas de type booléen** : `tinyint(1)` en tient lieu. Le laisser en nombre
        // afficherait `0`/`1` aligné à droite là où l'on attend une valeur logique.
        assert!(
            fenetre
                .rows
                .iter()
                .all(|ligne| matches!(ligne[actif], Value::Bool { .. })),
            "{:?}",
            fenetre.rows[0][actif]
        );
    }

    #[tokio::test]
    async fn un_horodatage_ne_depend_pas_du_fuseau_de_la_machine() {
        // **Le piège de `16a`** : MySQL convertit un `TIMESTAMP` dans le fuseau de la session. Sans
        // `SET time_zone = '+00:00'`, deux clients réglés différemment liraient des valeurs
        // différentes de la même ligne — et un explorateur ne peut pas afficher une valeur qui dépend
        // de qui regarde.
        let adaptateur = adaptateur().await;
        let mut connexion = adaptateur.connexion().await.unwrap();
        let fuseau: Option<String> = connexion
            .query_first("select @@session.time_zone")
            .await
            .unwrap();
        assert_eq!(fuseau.as_deref(), Some("+00:00"));
    }

    #[tokio::test]
    async fn un_mot_reserve_comme_colonne_se_trie_et_se_filtre() {
        let adaptateur = adaptateur().await;
        let mut requete = RowQuery::new(BASE, "ateliers", RowLimit::OneHundred);
        // `order` est un mot réservé : sans citation au backtick, ces deux requêtes échouent.
        requete.sort = vec![crate::engine::SortKey {
            column: "order".into(),
            direction: crate::engine::SortDirection::Descending,
        }];
        // **Pas de compte exact sur `ateliers`** : les tests d'écriture y insèrent leurs propres
        // lignes, et ils tournent en parallèle. Un compte global échouerait selon l'ordre
        // d'exécution — la leçon de `11d`, et ce test l'a rejouée. Ce qui est vérifié ici est que la
        // requête **passe**, ce qu'un mot réservé non cité empêcherait.
        assert!(!adaptateur.rows(&requete).await.unwrap().rows.is_empty());

        // Le filtre, lui, vise une valeur qu'aucun test d'écriture ne produit : les ateliers d'essai
        // sont insérés avec `order = 0`.
        requete.filters = vec![Filter {
            column: "order".into(),
            operator: FilterOperator::Eq,
            value: Some("2".into()),
        }];
        assert_eq!(adaptateur.rows(&requete).await.unwrap().rows.len(), 1);
    }

    #[tokio::test]
    async fn un_filtre_matches_cherche_une_sous_chaine_sans_interpreter_les_jokers() {
        let adaptateur = adaptateur().await;
        let mut requete = RowQuery::new(BASE, "ateliers", RowLimit::OneHundred);
        requete.filters = vec![Filter {
            column: "nom".into(),
            operator: FilterOperator::Matches,
            value: Some("grav".into()),
        }];
        // Insensible à la casse, comme `ILIKE` en `06d`. **« gra » n'aurait pas fait l'affaire** :
        // « Sérigraphie » le contient aussi — la leçon du défaut n° 57.
        assert_eq!(adaptateur.rows(&requete).await.unwrap().rows.len(), 1);

        requete.filters[0].value = Some("%".into());
        assert_eq!(
            adaptateur.rows(&requete).await.unwrap().rows.len(),
            0,
            "« % » doit être cherché littéralement, pas interprété"
        );
    }

    #[tokio::test]
    async fn une_modification_previsualisee_est_celle_qui_part() {
        let adaptateur = adaptateur().await;
        // Une ligne à soi : la leçon de `11d`, où des tests concurrents prenaient « la première
        // ligne » et se la disputaient.
        let reference = inserer_un_atelier(&adaptateur, "Essai-previsualise").await;

        let plan = UpdatePlan {
            schema: BASE.to_owned(),
            table: "ateliers".to_owned(),
            key_column: "nom".to_owned(),
            changes: vec![PendingUpdate {
                key: reference.clone(),
                column: "ville".to_owned(),
                value: Some("Albi".to_owned()),
                expected: Some("Toulouse".to_owned()),
            }],
        };

        let apercu = adaptateur.preview_updates(&plan).await.unwrap();
        assert!(apercu.contains("'Albi'"), "{apercu}");
        assert!(apercu.contains("'Toulouse'"), "{apercu}");
        assert!(apercu.contains("`ateliers`"), "{apercu}");

        let issue = adaptateur.apply_updates(&plan).await.expect("écriture");
        assert_eq!(issue.applied, 1);
        assert!(
            issue.inverse_sql.contains("'Toulouse'"),
            "{}",
            issue.inverse_sql
        );

        assert_eq!(
            ville_de(&adaptateur, &reference).await,
            Some("Albi".to_owned())
        );
    }

    #[tokio::test]
    async fn une_modification_partant_d_une_cellule_vide_atteint_la_ligne() {
        let adaptateur = adaptateur().await;
        let reference = inserer_un_atelier(&adaptateur, "Essai-vide").await;
        let mut connexion = adaptateur.connexion().await.unwrap();
        connexion
            .exec_drop(
                "update dorabase_test.ateliers set ville = null where nom = ?",
                (&reference,),
            )
            .await
            .unwrap();

        // **Le piège pour la quatrième fois** : avec `=` au lieu de `<=>`, ce `where` ne trouverait
        // aucune ligne et la transaction s'annulerait sans raison lisible.
        let plan = UpdatePlan {
            schema: BASE.to_owned(),
            table: "ateliers".to_owned(),
            key_column: "nom".to_owned(),
            changes: vec![PendingUpdate {
                key: reference.clone(),
                column: "ville".to_owned(),
                value: Some("Pau".to_owned()),
                expected: None,
            }],
        };
        assert_eq!(adaptateur.apply_updates(&plan).await.unwrap().applied, 1);
    }

    #[tokio::test]
    async fn une_modification_concurrente_annule_toute_la_transaction() {
        let adaptateur = adaptateur().await;
        let reference = inserer_un_atelier(&adaptateur, "Essai-concurrent").await;

        let plan = UpdatePlan {
            schema: BASE.to_owned(),
            table: "ateliers".to_owned(),
            key_column: "nom".to_owned(),
            changes: vec![
                PendingUpdate {
                    key: reference.clone(),
                    column: "ville".to_owned(),
                    value: Some("Albi".to_owned()),
                    expected: Some("Toulouse".to_owned()),
                },
                // La seconde attend une valeur qui n'est pas là : elle doit faire annuler la
                // **première** aussi (`06a`).
                PendingUpdate {
                    key: reference.clone(),
                    column: "order".to_owned(),
                    value: Some("9".to_owned()),
                    expected: Some("42".to_owned()),
                },
            ],
        };
        let erreur = adaptateur
            .apply_updates(&plan)
            .await
            .expect_err("doit refuser");
        assert!(erreur.message.contains("a changé"), "{}", erreur.message);

        assert_eq!(
            ville_de(&adaptateur, &reference).await,
            Some("Toulouse".to_owned()),
            "la première modification doit avoir été annulée avec la seconde"
        );
    }

    #[tokio::test]
    async fn ecrire_dans_une_table_myisam_est_refuse_avant_la_premiere_ecriture() {
        let adaptateur = adaptateur().await;

        // **Le test pose sa propre ligne**, au lieu de s'appuyer sur la valeur du décor. La leçon de
        // `11d`, que ce test avait oubliée : un sabotage qui a écrit une fois laissait le décor sali,
        // et restaurer le code ne suffisait pas à faire repasser le test. Un test qui dépend d'un
        // état qu'il n'a pas posé n'est pas rejouable.
        let mut connexion = adaptateur.connexion().await.unwrap();
        connexion
            .query_drop("delete from dorabase_test.journal_myisam where id = 99")
            .await
            .unwrap();
        connexion
            .query_drop(
                "insert into dorabase_test.journal_myisam (id, message) values (99, 'intact')",
            )
            .await
            .unwrap();

        let plan = UpdatePlan {
            schema: BASE.to_owned(),
            table: "journal_myisam".to_owned(),
            key_column: "id".to_owned(),
            changes: vec![PendingUpdate {
                key: "99".to_owned(),
                column: "message".to_owned(),
                value: Some("modifié".to_owned()),
                expected: Some("intact".to_owned()),
            }],
        };

        // **Le refus, et rien d'écrit** (`16c`) : MyISAM n'a pas de transaction, donc trois
        // modifications s'y appliqueraient à moitié. Même décision qu'en `18f` pour un `mongod`
        // isolé, et le refus arrive **avant** la première écriture.
        let erreur = adaptateur
            .apply_updates(&plan)
            .await
            .expect_err("doit refuser");
        assert!(erreur.message.contains("MyISAM"), "{}", erreur.message);
        assert!(
            erreur.message.contains("sans transaction"),
            "{}",
            erreur.message
        );

        let message: Option<String> = connexion
            .query_first("select message from dorabase_test.journal_myisam where id = 99")
            .await
            .unwrap();
        assert_eq!(
            message.as_deref(),
            Some("intact"),
            "rien ne doit avoir été écrit"
        );
    }

    #[tokio::test]
    async fn la_console_execute_et_annonce_sa_limite() {
        let resultat = adaptateur()
            .await
            .run_sql("select nom, ville from ateliers", RowLimit::OneHundred)
            .await
            .expect("exécution");
        assert_eq!(resultat.columns, vec!["nom".to_owned(), "ville".to_owned()]);
        assert!(resultat.rows.len() >= 3);
        assert_eq!(resultat.applied_limit, Some(100));
    }

    #[tokio::test]
    async fn show_tables_n_est_pas_borne_car_ce_serait_une_erreur_de_syntaxe() {
        // **Le cas que PostgreSQL n'a pas** : `show` n'accepte pas de `limit`. La borner serait une
        // erreur de syntaxe, pas une protection.
        let resultat = adaptateur()
            .await
            .run_sql("show tables", RowLimit::OneHundred)
            .await
            .expect("exécution");
        assert_eq!(resultat.applied_limit, None);
        assert!(resultat.rows.len() >= 4);
    }

    #[tokio::test]
    async fn un_decimal_calcule_reste_exact_dans_la_console() {
        // Une colonne calculée n'est dans aucun catalogue : c'est le **type du protocole** qui dit
        // comment lire ses octets (`16c`).
        let resultat = adaptateur()
            .await
            .run_sql(
                "select sum(tarif) as total from seances",
                RowLimit::OneHundred,
            )
            .await
            .expect("exécution");
        assert!(
            matches!(&resultat.rows[0][0], Value::Decimal { .. }),
            "{:?}",
            resultat.rows[0][0]
        );
    }

    #[tokio::test]
    async fn expliquer_rend_un_plan_et_n_execute_pas() {
        let plan = adaptateur()
            .await
            .explain_sql("select * from seances where atelier_id = 1")
            .await
            .expect("plan");
        let texte = plan.lines.join("\n");
        assert!(!texte.is_empty(), "le plan doit dire quelque chose");
        // **Jamais `ANALYZE`** : il exécuterait la requête pour la mesurer, et « Expliquer »
        // deviendrait un bouton qui écrit sur une console où l'on écrit aussi (`12e`).
        assert!(!plan.sql.to_lowercase().contains("analyze"), "{}", plan.sql);
    }

    #[tokio::test]
    async fn un_insert_copie_se_rejoue() {
        let adaptateur = adaptateur().await;
        let requete = RowQuery::new(BASE, "seances", RowLimit::OneHundred);
        let fenetre = adaptateur.rows(&requete).await.unwrap();

        let sql = adaptateur
            .row_as_insert(BASE, "seances", &fenetre.rows[0])
            .await
            .unwrap();

        // **Le critère de `10f`** : l'`INSERT` copié doit s'exécuter. Le rejouer dans une copie de la
        // table est ce qui le prouve.
        let mut connexion = adaptateur.connexion().await.unwrap();
        connexion
            .query_drop("drop table if exists dorabase_test.copie_seances")
            .await
            .unwrap();
        connexion
            .query_drop("create table dorabase_test.copie_seances like dorabase_test.seances")
            .await
            .unwrap();
        // La clé étrangère de la copie viserait `ateliers` : elle est retirée, sinon l'`INSERT`
        // échouerait sur une contrainte qui n'a rien à voir avec ce qu'on teste.
        let _ = connexion
            .query_drop(
                "alter table dorabase_test.copie_seances drop foreign key seances_atelier_fk",
            )
            .await;
        connexion
            .query_drop(sql.replace("`seances`", "`copie_seances`"))
            .await
            .unwrap_or_else(|e| panic!("l'INSERT copié doit s'exécuter : {e}\n---\n{sql}"));
    }

    #[tokio::test]
    async fn une_table_inconnue_le_dit_plutot_que_de_rendre_zero_ligne() {
        let erreur = adaptateur()
            .await
            .table_detail(BASE, "table_qui_n_existe_pas")
            .await
            .expect_err("doit échouer");
        assert!(
            erreur.message.contains("n'existe pas"),
            "{}",
            erreur.message
        );
    }

    #[tokio::test]
    async fn aucun_message_d_erreur_ne_contient_le_mot_de_passe() {
        // La propriété de `05c`, retestée ici plutôt que supposée héritée : le pilote cite volontiers
        // l'URL, et une URL porte les identifiants.
        let sentinelle = "s3ntinelle-mysql";
        let mut mauvaise = variante();
        mauvaise.username = "utilisateur_inexistant".into();
        let issue = MysqlAdapter::connect_via(
            &mauvaise,
            Some(&Secret::new(sentinelle)),
            std::path::Path::new("/dev/null"),
        )
        .await;
        let erreur = issue.expect_err("l'authentification doit échouer");
        assert!(
            !erreur.message.contains(sentinelle),
            "le mot de passe a fui : {}",
            erreur.message
        );
    }

    // --- Le TLS de `06f` ---------------------------------------------------------------------
    //
    // **Les quatre comportements, sur le même serveur.** Le conteneur MySQL engendre au premier
    // démarrage sa propre autorité et un certificat dont le nom commun est
    // `MySQL_Server_…_Auto_Generated_Server_Certificate` : ni connu des racines publiques, ni
    // correspondant à `localhost`. Un décor qu'on aurait fabriqué à la main n'aurait donné que le
    // premier cas.
    //
    // **Sans ces quatre tests, le TLS n'est pas prouvé** : un TLS qui accepte tout est pire qu'un TLS
    // absent, parce qu'il affiche un cadenas (`06f`).

    /// Le chemin de l'autorité sortie du conteneur par `scripts/mysql-test.sh`.
    ///
    /// Les tests TLS se **sautent** si le fichier manque, plutôt que d'échouer : le décor peut avoir
    /// été monté par une ancienne version du script. L'absence est dite, jamais silencieuse.
    fn autorite() -> Option<String> {
        let chemin = std::env::var("DORABASE_TEST_MYSQL_CA")
            .unwrap_or_else(|_| "/tmp/dorabase-test-mysql-ca.pem".to_owned());
        if std::path::Path::new(&chemin).exists() {
            Some(chemin)
        } else {
            eprintln!(
                "test TLS sauté : {chemin} absent — relancer ./scripts/mysql-test.sh demarrer"
            );
            None
        }
    }

    async fn connexion_en(mode: SslMode, ca: Option<String>) -> Result<MysqlAdapter, EngineError> {
        let mut variante = variante();
        variante.ssl_mode = mode;
        variante.ca_certificate = ca;
        MysqlAdapter::connect_via(
            &variante,
            Some(&mot_de_passe()),
            std::path::Path::new("/dev/null"),
        )
        .await
    }

    #[tokio::test]
    async fn require_chiffre_sans_authentifier_donc_accepte_une_autorite_inconnue() {
        // **`require` chiffre sans authentifier**, donc il n'empêche pas un intermédiaire. Ce n'est
        // pas un défaut mais un mode que `05a` propose — et `A2` le dit, en gardant la mention
        // « TLS non vérifié » (voir `tls_non_verifie`).
        let adaptateur = connexion_en(SslMode::Require, None)
            .await
            .expect("require doit accepter un certificat auto-signé");
        adaptateur
            .probe()
            .await
            .expect("la connexion doit répondre");
    }

    #[tokio::test]
    async fn verify_ca_est_refuse_avec_sa_raison_et_ses_deux_voies() {
        // **Ce n'est pas une limite du protocole, c'est un défaut du pilote.**
        //
        // `SslOpts::with_danger_skip_domain_validation` existe et ne fait rien avec `rustls` 0.23 : le
        // vérificateur du pilote compare l'**affichage** de l'erreur au mot `NotValidForName`, qui est
        // sa forme `Debug`. Le bras ne se déclenche jamais, et le drapeau est sans effet.
        //
        // Trois réponses étaient possibles. Traiter `verify-ca` comme `verify-full` aurait été
        // silencieusement **plus strict** — or l'utilisateur qui choisit `verify-ca` le fait précisément
        // parce que le nom ne correspond pas, et lirait un échec de nom sans comprendre que son réglage
        // est ignoré. Le traiter comme `require` aurait été un cadenas qui ne protège rien. Reste le
        // refus, qui **nomme les deux voies**.
        //
        // Pour PostgreSQL, `verify-ca` **fonctionne** : son pilote accepte une `ClientConfig`, et le
        // vérificateur de `tls.rs` filtre sur la **variante** de l'erreur, pas sur son affichage.
        let erreur = connexion_en(SslMode::VerifyCa, autorite())
            .await
            .expect_err("verify-ca doit être refusé pour MySQL");
        assert!(erreur.message.contains("verify-full"), "{}", erreur.message);
        assert!(erreur.message.contains("require"), "{}", erreur.message);
    }

    #[tokio::test]
    async fn verify_full_refuse_un_nom_d_hote_qui_ne_correspond_pas() {
        let Some(ca) = autorite() else { return };
        // **Le cas qu'on oublie**, et le plus instructif : l'autorité est fournie, la chaîne est donc
        // valide — mais le nom commun du certificat est
        // `MySQL_Server_…_Auto_Generated_Server_Certificate`, pas `localhost`. `verify-full` doit
        // refuser là où `verify-ca` vient d'accepter : deux comportements distincts sur le **même**
        // serveur, avec la **même** autorité. C'est exactement ce que `06f` demande de prouver.
        let erreur = connexion_en(SslMode::VerifyFull, Some(ca))
            .await
            .expect_err("verify-full doit refuser un nom d'hôte qui ne correspond pas");
        assert!(
            !erreur.message.is_empty(),
            "le refus doit dire quelque chose"
        );
    }

    #[tokio::test]
    async fn un_certificat_d_autorite_introuvable_le_dit_avant_de_se_connecter() {
        let erreur = connexion_en(SslMode::VerifyCa, Some("/nulle/part/ca.pem".to_owned()))
            .await
            .expect_err("un fichier absent doit être refusé");
        // Le chemin apparaît : c'est ce qui permet de voir qu'on l'a mal tapé, plutôt que de croire
        // le serveur en cause.
        assert!(
            erreur.message.contains("/nulle/part/ca.pem"),
            "{}",
            erreur.message
        );
    }

    #[tokio::test]
    async fn la_negociation_aboutit_en_tls_1_2_ou_1_3() {
        if autorite().is_none() {
            return;
        }
        // **Le piège de feature de `06f`** : `rustls-tls` seul ne propose que TLS 1.3, et beaucoup de
        // serveurs MySQL d'entreprise sont en 1.2 — l'échec ressemblerait à un problème de certificat.
        // Ce test échouerait si `tls12` disparaissait des features.
        //
        // `require` et non `verify-ca` : ce dernier est refusé pour MySQL (voir ci-dessus), et ce qui
        // se mesure ici est la **version négociée**, pas la vérification.
        let adaptateur = connexion_en(SslMode::Require, None)
            .await
            .expect("connexion");
        let mut connexion = adaptateur.connexion().await.unwrap();
        let version: Option<String> = connexion
            .query_first(
                "select variable_value from performance_schema.session_status \
                          where variable_name = 'Ssl_version'",
            )
            .await
            .unwrap();
        let version = version.unwrap_or_default();
        assert!(
            version.starts_with("TLSv1.2") || version.starts_with("TLSv1.3"),
            "version négociée inattendue : « {version} »"
        );
    }

    #[tokio::test]
    async fn le_chiffrement_a_bien_lieu_et_ne_se_contente_pas_d_etre_demande() {
        // **Demander le TLS et l'obtenir sont deux choses.** Sans cette vérification, une
        // configuration qui retomberait silencieusement en clair passerait tous les tests ci-dessus —
        // et afficherait un cadenas sur une connexion en clair.
        let adaptateur = connexion_en(SslMode::Require, None)
            .await
            .expect("connexion");
        let mut connexion = adaptateur.connexion().await.unwrap();
        let chiffrement: Option<String> = connexion
            .query_first(
                "select variable_value from performance_schema.session_status \
                          where variable_name = 'Ssl_cipher'",
            )
            .await
            .unwrap();
        assert!(
            chiffrement.as_deref().is_some_and(|c| !c.is_empty()),
            "la session doit être chiffrée, chiffrement rendu : {chiffrement:?}"
        );
    }

    #[tokio::test]
    async fn sans_chiffrement_la_session_est_bien_en_clair() {
        // Le pendant du test précédent : `disable` doit **vraiment** ne pas chiffrer. Les deux
        // ensemble prouvent que le réglage décide, et non que tout est chiffré par hasard.
        let adaptateur = connexion_en(SslMode::Disable, None)
            .await
            .expect("connexion");
        let mut connexion = adaptateur.connexion().await.unwrap();
        let chiffrement: Option<String> = connexion
            .query_first(
                "select variable_value from performance_schema.session_status \
                          where variable_name = 'Ssl_cipher'",
            )
            .await
            .unwrap();
        assert!(
            chiffrement.as_deref().is_none_or(str::is_empty),
            "la session ne devait pas être chiffrée : {chiffrement:?}"
        );
    }

    /// Insère un atelier à soi, et rend son nom — qui sert de clé.
    ///
    /// **Chaque test d'écriture le sien** : la leçon de `11d`.
    async fn inserer_un_atelier(adaptateur: &MysqlAdapter, nom: &str) -> String {
        let mut connexion = adaptateur.connexion().await.unwrap();
        connexion
            .exec_drop("delete from dorabase_test.ateliers where nom = ?", (nom,))
            .await
            .unwrap();
        connexion
            .exec_drop(
                "insert into dorabase_test.ateliers (nom, ville, `order`, actif) \
                 values (?, 'Toulouse', 0, 1)",
                (nom,),
            )
            .await
            .unwrap();
        nom.to_owned()
    }

    async fn ville_de(adaptateur: &MysqlAdapter, nom: &str) -> Option<String> {
        let mut connexion = adaptateur.connexion().await.unwrap();
        connexion
            .exec_first(
                "select ville from dorabase_test.ateliers where nom = ?",
                (nom,),
            )
            .await
            .unwrap()
    }
}
