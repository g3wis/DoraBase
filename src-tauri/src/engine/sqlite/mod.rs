//! L'adaptateur SQLite — specs `17a` et `17b`.
//!
//! # Ce que ce moteur ne partage avec aucun autre
//!
//! 1. **Il n'a pas de serveur.** Ni hôte, ni port, ni utilisateur, ni mot de passe, ni TLS, ni
//!    tunnel : le chemin du fichier vit dans `default_database` (`17a`).
//! 2. **Il n'a qu'un schéma**, nommé `main` — le nom que SQLite emploie lui-même.
//! 3. **Ses types sont des affinités, pas des types** : une colonne `INTEGER` peut contenir du
//!    texte, et `Value` porte la nature réelle de chaque valeur (`17b`).
//! 4. **Son DDL est celui qui a été tapé**, gardé dans `sqlite_master` — pas une reconstruction.
//!    C'est le seul des trois moteurs livrés dans ce cas, et `A9` doit pouvoir le dire.
//! 5. **Son compte de lignes est exact.** `RowCount::Exact` existe depuis `06a` et aucun moteur ne
//!    le rendait.
//!
//! # Pourquoi `spawn_blocking`
//!
//! `rusqlite` est **synchrone**, et le trait de `06a` est asynchrone — parce qu'une requête peut
//! durer, y compris sur un fichier local d'un gigaoctet. Chaque opération part donc dans
//! `spawn_blocking`, avec la connexion derrière un `std::sync::Mutex` partagé : c'est le seul montage
//! qui laisse l'exécuteur libre. Faire le travail en ligne sous un `tokio::sync::Mutex` aurait été
//! plus court et aurait gelé l'interface le temps d'un `count(*)` sur un million de lignes.

mod connect;
mod error;
mod introspect;
mod rows;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use rusqlite::Connection;

use crate::config::ConnectionSettings;
use crate::engine::proxy::EtatProxy;
use crate::engine::{
    ApplyOutcome, ConnectionProbe, EngineAdapter, EngineError, QueryPlan, QueryResult, RowCount,
    RowLimit, RowQuery, RowWindow, SchemaInfo, TableDetail, TableSummary, UpdatePlan, Value,
};
use crate::secrets::Secret;

/// L'adaptateur SQLite.
pub struct SqliteAdapter {
    /// **`std::sync::Mutex` et non celui de `tokio`** : la garde ne traverse jamais un point
    /// d'attente — elle vit entièrement dans la closure de `spawn_blocking`. Le verrou de `tokio`
    /// serait ici plus lourd et moins juste.
    connexion: Arc<Mutex<Connection>>,
    chemin: PathBuf,
}

/// `Debug` à la main : même raison qu'en `06b` et `18b`, un dérivé exposerait l'état interne.
impl std::fmt::Debug for SqliteAdapter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SqliteAdapter {{ {} }}", self.chemin.display())
    }
}

impl SqliteAdapter {
    pub async fn connect_via(
        variante: &ConnectionSettings,
        _mot_de_passe: Option<&Secret>,
        _known_hosts: &std::path::Path,
    ) -> Result<Self, EngineError> {
        // **Le mot de passe est ignoré, et le `known_hosts` aussi.** Un fichier local n'a ni l'un ni
        // l'autre ; les paramètres restent dans la signature parce que `AnyEngine` appelle les sept
        // moteurs de la même façon. Le préfixe `_` le dit sans commentaire.
        let chemin = connect::chemin_de(variante)?;
        let a_ouvrir = chemin.clone();
        // L'ouverture lit l'en-tête et pose deux pragmas : c'est du travail bloquant, court mais
        // réel, et il n'a rien à faire sur le fil de l'exécuteur.
        let connexion = tokio::task::spawn_blocking(move || connect::ouvrir(&a_ouvrir))
            .await
            .map_err(|e| EngineError::local(format!("ouverture interrompue : {e}")))??;
        Ok(Self {
            connexion: Arc::new(Mutex::new(connexion)),
            chemin,
        })
    }

    /// Un fichier local n'a pas de tunnel. Les deux méthodes existent pour `AnyEngine`.
    pub fn etat_tunnel(&self) -> Option<EtatProxy> {
        None
    }

    pub fn port_local_tunnel(&self) -> Option<u16> {
        None
    }

    pub async fn close(self) {
        // Rien à attendre : pas de port à rendre, pas de socket à fermer. La connexion se libère
        // avec l'`Arc`.
        drop(self.connexion);
    }

    /// Exécute un travail bloquant sur la connexion.
    ///
    /// **Le montage qui compte** : la connexion part dans le fil bloquant derrière un `Arc`, la garde
    /// ne franchit aucun `await`, et l'exécuteur reste libre pendant un `count(*)` d'un million de
    /// lignes. Faire le travail en ligne aurait été plus court et aurait gelé l'interface.
    async fn avec<T, F>(&self, travail: F) -> Result<T, EngineError>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> Result<T, EngineError> + Send + 'static,
    {
        let connexion = Arc::clone(&self.connexion);
        tokio::task::spawn_blocking(move || {
            let garde = connexion
                .lock()
                .map_err(|_| EngineError::local("connexion SQLite empoisonnée"))?;
            travail(&garde)
        })
        .await
        .map_err(|e| EngineError::local(format!("opération interrompue : {e}")))?
    }
}

impl EngineAdapter for SqliteAdapter {
    async fn probe(&self) -> Result<ConnectionProbe, EngineError> {
        let debut = Instant::now();
        let chemin = self.chemin.clone();
        // Une lecture d'essai : sans elle, `probe()` dirait « connecté » sur un fichier devenu
        // illisible depuis l'ouverture.
        self.avec(|connexion| {
            connexion
                .query_row("select 1", [], |ligne| ligne.get::<_, i64>(0))
                .map_err(|e| error::traduire(&e))
        })
        .await?;
        Ok(ConnectionProbe {
            latency_ms: u32::try_from(debut.elapsed().as_millis()).unwrap_or(u32::MAX),
            server_version: connect::version_et_taille(&chemin),
        })
    }

    async fn schemas(&self) -> Result<Vec<SchemaInfo>, EngineError> {
        self.avec(introspect::schemas).await
    }

    async fn objects(&self, _schema: &str) -> Result<Vec<TableSummary>, EngineError> {
        // Le schéma est ignoré : il n'y en a qu'un, et l'arbre ne peut en demander un autre.
        self.avec(introspect::objects).await
    }

    async fn table_detail(&self, _schema: &str, table: &str) -> Result<TableDetail, EngineError> {
        let table = table.to_owned();
        self.avec(move |connexion| introspect::detail(connexion, &table))
            .await
    }

    async fn rows(&self, query: &RowQuery) -> Result<RowWindow, EngineError> {
        let debut = Instant::now();
        let (sql, parametres) = rows::requete_de(query);
        let table = query.table.clone();
        let offset = query.offset;
        let a_executer = sql.clone();

        let (lignes, total) = self
            .avec(move |connexion| {
                let liens: Vec<&dyn rusqlite::ToSql> = parametres
                    .iter()
                    .map(|p| p as &dyn rusqlite::ToSql)
                    .collect();
                let (_, lignes) = rows::lire(connexion, &a_executer, &liens)?;
                // **Le total est exact** : SQLite n'a aucune estimation à laquelle se rabattre, et
                // `RowCount::Exact` existe depuis `06a` sans qu'aucun moteur ne le rende.
                let total = connexion
                    .query_row(
                        &format!("select count(*) from {}", introspect::citer(&table)),
                        [],
                        |ligne| ligne.get::<_, i64>(0),
                    )
                    .ok()
                    .map(|value| RowCount::Exact { value });
                Ok((lignes, total))
            })
            .await?;

        Ok(RowWindow {
            offset,
            rows: lignes,
            total,
            sql,
            duration_ms: u32::try_from(debut.elapsed().as_millis()).unwrap_or(u32::MAX),
        })
    }

    async fn row_as_insert(
        &self,
        _schema: &str,
        table: &str,
        values: &[Value],
    ) -> Result<String, EngineError> {
        let nom = table.to_owned();
        let valeurs = values.to_vec();
        self.avec(move |connexion| {
            let colonnes: Vec<String> = introspect::colonnes_de(connexion, &nom)?
                .into_iter()
                .map(|colonne| colonne.name)
                .collect();
            Ok(rows::insert_de(&nom, &colonnes, &valeurs))
        })
        .await
    }

    async fn preview_updates(&self, plan: &UpdatePlan) -> Result<String, EngineError> {
        Ok(rows::texte_de(&rows::instructions_de(plan)))
    }

    async fn apply_updates(&self, plan: &UpdatePlan) -> Result<ApplyOutcome, EngineError> {
        let instructions = rows::instructions_de(plan);
        let inverse = rows::texte_de(&rows::instructions_inverses(plan));

        let appliquees = self
            .avec(move |connexion| {
                // **Une transaction, comme `06a` l'exige.** SQLite en a toujours — contrairement à
                // MyISAM (`16c`) ou à un `mongod` isolé (`18f`), il n'y a pas de refus à opposer.
                connexion
                    .execute_batch("BEGIN IMMEDIATE")
                    .map_err(|e| error::traduire(&e))?;

                let mut compte = 0u64;
                for (sql, parametres) in &instructions {
                    let liens: Vec<&dyn rusqlite::ToSql> = parametres
                        .iter()
                        .map(|p| p as &dyn rusqlite::ToSql)
                        .collect();
                    match connexion.execute(sql, liens.as_slice()) {
                        Ok(1) => compte += 1,
                        Ok(autre) => {
                            let _ = connexion.execute_batch("ROLLBACK");
                            // Zéro ligne : la ligne a changé depuis la lecture. **Toute** la
                            // transaction est annulée — pas un rapport partiel (`06a`).
                            return Err(EngineError::local(format!(
                                "une ligne a changé depuis la lecture ({autre} ligne(s) touchée(s)) \
                                 : aucune modification n'a été écrite"
                            )));
                        }
                        Err(erreur) => {
                            let _ = connexion.execute_batch("ROLLBACK");
                            return Err(error::traduire(&erreur));
                        }
                    }
                }

                connexion
                    .execute_batch("COMMIT")
                    .map_err(|e| error::traduire(&e))?;
                Ok(compte)
            })
            .await?;

        Ok(ApplyOutcome {
            applied: appliquees,
            inverse_sql: inverse,
        })
    }

    async fn run_sql(&self, sql: &str, limite: RowLimit) -> Result<QueryResult, EngineError> {
        let debut = Instant::now();
        let (borne, ajoutee) = rows::avec_limite(sql, limite);
        let a_executer = borne.clone();

        let (colonnes, lignes) = self
            .avec(move |connexion| {
                // **Le SQL de l'utilisateur, tel quel.** Une requête qui ne rend pas de lignes —
                // `update`, `create` — n'a pas de colonnes : `prepare` réussit, et le curseur est
                // vide. Les deux cas passent par le même chemin.
                rows::lire(connexion, &a_executer, &[])
            })
            .await?;

        Ok(QueryResult {
            columns: colonnes,
            rows: lignes,
            sql: borne,
            duration_ms: u64::try_from(debut.elapsed().as_millis()).unwrap_or(u64::MAX),
            applied_limit: ajoutee,
        })
    }

    async fn explain_sql(&self, sql: &str) -> Result<QueryPlan, EngineError> {
        let debut = Instant::now();
        // **`EXPLAIN QUERY PLAN` et non `EXPLAIN`.** Le second rend le bytecode de la machine
        // virtuelle de SQLite, illisible pour qui débogue une requête. Ni l'un ni l'autre n'exécute,
        // ce qui respecte la règle de `12e` : sur une console où l'on écrit aussi, « Expliquer » ne
        // doit pas devenir un bouton qui écrit.
        let commande = format!("EXPLAIN QUERY PLAN {}", sql.trim().trim_end_matches(';'));
        let a_executer = commande.clone();

        let (_, lignes) = self
            .avec(move |connexion| rows::lire(connexion, &a_executer, &[]))
            .await?;

        // La dernière colonne de chaque ligne porte la description ; les trois premières sont des
        // identifiants de nœud, sans intérêt à l'écran.
        let texte = lignes
            .iter()
            .map(|ligne| match ligne.last() {
                Some(Value::Text { value }) => value.clone(),
                autre => format!("{autre:?}"),
            })
            .collect();

        Ok(QueryPlan {
            lines: texte,
            sql: commande,
            duration_ms: u64::try_from(debut.elapsed().as_millis()).unwrap_or(u64::MAX),
        })
    }
}

/// Les tests contre un **vrai fichier SQLite**.
///
/// **Sans `db-tests`, et c'est le seul moteur dans ce cas** : le décor est un fichier temporaire que
/// le test crée lui-même, donc il n'y a ni conteneur à monter ni variable d'environnement à poser.
/// Ces tests tournent partout, y compris sur la machine de quelqu'un qui n'a pas Docker.
#[cfg(test)]
mod tests_fichier {
    use super::*;
    use crate::config::SslMode;
    use crate::engine::{Filter, FilterOperator, KeyKind, ObjectKind, PendingUpdate, TypeCategory};

    /// Le décor de `scripts/schema-test-sqlite.sql`, appliqué à un fichier neuf.
    ///
    /// Le script est **lu depuis le dépôt** plutôt que recopié ici : deux définitions du même décor
    /// divergeraient, et c'est exactement ce que `schema-test-pg.sql` et `schema-test-mongo.js`
    /// évitent pour les deux autres moteurs.
    fn decor() -> (tempfile::TempDir, PathBuf) {
        let dossier = tempfile::tempdir().unwrap();
        let chemin = dossier.path().join("atelier.db");
        let script = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../scripts/schema-test-sqlite.sql"),
        )
        .expect("le décor SQLite doit être lisible");
        Connection::open(&chemin)
            .unwrap()
            .execute_batch(&script)
            .expect("le décor doit s'appliquer");
        (dossier, chemin)
    }

    fn variante(chemin: &std::path::Path) -> ConnectionSettings {
        ConnectionSettings {
            host: String::new(),
            port: 0,
            default_database: chemin.to_string_lossy().into_owned(),
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

    async fn adaptateur(chemin: &std::path::Path) -> SqliteAdapter {
        SqliteAdapter::connect_via(&variante(chemin), None, std::path::Path::new("/dev/null"))
            .await
            .expect("ouverture du fichier de test")
    }

    #[tokio::test]
    async fn la_sonde_annonce_la_version_et_la_taille() {
        let (_dossier, chemin) = decor();
        let sonde = adaptateur(&chemin).await.probe().await.unwrap();
        assert!(sonde.server_version.starts_with("SQLite 3."), "{sonde:?}");
        // La taille remplace ce qu'un serveur dirait de lui-même : c'est la seule chose qu'un
        // fichier ait à annoncer.
        assert!(sonde.server_version.contains("ko") || sonde.server_version.contains("o"));
    }

    #[tokio::test]
    async fn le_fichier_n_a_qu_un_schema_nomme_main() {
        let (_dossier, chemin) = decor();
        let schemas = adaptateur(&chemin).await.schemas().await.unwrap();
        assert_eq!(schemas.len(), 1);
        // **`main`, le mot que SQLite emploie lui-même.** Inventer « base » créerait un mot qui
        // n'existe nulle part ailleurs.
        assert_eq!(schemas[0].name, "main");
        assert_eq!(schemas[0].counts.tables, 3);
        assert_eq!(schemas[0].counts.views, 1);
        // Zéro fonction, et c'est une valeur juste : les fonctions de SQLite viennent du programme
        // hôte, pas du fichier.
        assert_eq!(schemas[0].counts.functions, 0);
    }

    #[tokio::test]
    async fn les_tables_apparaissent_y_compris_la_vide_et_sans_les_internes() {
        let (_dossier, chemin) = decor();
        let objets = adaptateur(&chemin).await.objects("main").await.unwrap();
        let noms: Vec<&str> = objets.iter().map(|o| o.name.as_str()).collect();
        assert!(noms.contains(&"ateliers"), "{noms:?}");
        // **Une table vide se voit** : une absence se lirait comme une donnée non chargée.
        assert!(noms.contains(&"listes_attente"), "{noms:?}");
        // `sqlite_sequence` existe (la table a un `AUTOINCREMENT`) et ne doit pas s'afficher.
        assert!(!noms.iter().any(|n| n.starts_with("sqlite_")), "{noms:?}");
    }

    #[tokio::test]
    async fn le_compte_de_lignes_est_exact_pas_estime() {
        let (_dossier, chemin) = decor();
        let objets = adaptateur(&chemin).await.objects("main").await.unwrap();
        let seances = objets.iter().find(|o| o.name == "seances").unwrap();
        // **`RowCount::Exact` sert enfin** : il existe depuis `06a` et aucun moteur ne le rendait.
        // SQLite n'a aucune estimation à laquelle se rabattre.
        assert_eq!(seances.rows, RowCount::Exact { value: 5 });
        let vide = objets.iter().find(|o| o.name == "listes_attente").unwrap();
        assert_eq!(vide.rows, RowCount::Exact { value: 0 });
    }

    #[tokio::test]
    async fn une_vue_se_distingue_d_une_table() {
        let (_dossier, chemin) = decor();
        let objets = adaptateur(&chemin).await.objects("main").await.unwrap();
        let vue = objets
            .iter()
            .find(|o| o.name == "seances_ouvertes")
            .unwrap();
        assert_eq!(vue.kind, ObjectKind::View);
        // Une vue n'a ni compte propre ni clé primaire : les inventer demanderait d'exécuter son
        // `select`.
        assert_eq!(vue.rows, RowCount::Unknown);
        assert_eq!(vue.primary_key, None);
    }

    #[tokio::test]
    async fn les_affinites_de_type_suivent_les_declarations() {
        let (_dossier, chemin) = decor();
        let detail = adaptateur(&chemin)
            .await
            .table_detail("main", "ateliers")
            .await
            .unwrap();
        let par_nom = |nom: &str| {
            detail
                .columns
                .iter()
                .find(|c| c.name == nom)
                .unwrap_or_else(|| panic!("colonne {nom}"))
                .clone()
        };
        assert_eq!(par_nom("id").category, TypeCategory::Number);
        assert_eq!(par_nom("id").key, Some(KeyKind::Primary));
        assert_eq!(par_nom("ville").category, TypeCategory::Text);
        assert_eq!(par_nom("ouvert_le").category, TypeCategory::Timestamp);
        assert_eq!(par_nom("actif").category, TypeCategory::Boolean);
        // **Une colonne sans type déclaré est légale** : écrire « BLOB » à sa place serait inventer.
        assert_eq!(par_nom("divers").type_name, "(sans type)");
        // Les colonnes sont **déclarées** : la fréquence de `18d` n'a pas de sens ici.
        assert!(detail.columns.iter().all(|c| c.frequency.is_none()));
    }

    #[tokio::test]
    async fn le_ddl_est_celui_qui_a_ete_tape() {
        let (_dossier, chemin) = decor();
        let detail = adaptateur(&chemin)
            .await
            .table_detail("main", "seances")
            .await
            .unwrap();
        // **Seul moteur des trois à garder le texte d'origine.** PostgreSQL le reconstruit (`14c`),
        // MongoDB n'en a pas ; SQLite stocke le corps du `CREATE` tel qu'il a été tapé.
        //
        // **Une nuance, trouvée par ce test** : SQLite normalise le **préfixe** `CREATE TABLE` en
        // majuscules et laisse tout le reste intact. Le décor écrit `create table seances (` en
        // minuscules, et `sqlite_master` rend `CREATE TABLE seances (`. Dire « tel qu'il a été
        // tapé » sans cette réserve serait faux — et c'est le genre d'écart qu'on remarque en
        // comparant à son fichier de migration.
        assert!(
            detail.ddl.starts_with("CREATE TABLE seances"),
            "{}",
            detail.ddl
        );
        // Le corps, lui, est verbatim : minuscules, indentation et retours à la ligne du décor s'y
        // retrouvent. Une reconstruction aurait tout normalisé.
        assert!(
            detail.ddl.contains(
                "  atelier_id integer not null references ateliers(id) on delete cascade,"
            ),
            "{}",
            detail.ddl
        );
    }

    #[tokio::test]
    async fn les_index_les_declencheurs_et_les_relations_sont_lus() {
        let (_dossier, chemin) = decor();
        let detail = adaptateur(&chemin)
            .await
            .table_detail("main", "seances")
            .await
            .unwrap();
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
        let (_dossier, chemin) = decor();
        let detail = adaptateur(&chemin)
            .await
            .table_detail("main", "ateliers")
            .await
            .unwrap();
        let entrante = detail
            .relations
            .iter()
            .find(|r| r.direction == crate::engine::RelationDirection::Incoming)
            .expect("seances référence ateliers");
        // **Le sens s'inverse, pas les tables** — la leçon du défaut du 10 août 2026 en `06c`.
        assert_eq!(entrante.target_table, "seances");
        assert_eq!(entrante.columns, vec!["id".to_owned()]);
        assert_eq!(entrante.target_columns, vec!["atelier_id".to_owned()]);
    }

    #[tokio::test]
    async fn une_fenetre_de_lignes_se_lit_avec_ses_types() {
        let (_dossier, chemin) = decor();
        let adaptateur = adaptateur(&chemin).await;
        let mut requete = RowQuery::new("main", "seances", RowLimit::OneHundred);
        requete.sort = vec![crate::engine::SortKey {
            column: "id".into(),
            direction: crate::engine::SortDirection::Ascending,
        }];
        let fenetre = adaptateur.rows(&requete).await.unwrap();
        assert_eq!(fenetre.rows.len(), 5);
        assert_eq!(fenetre.total, Some(RowCount::Exact { value: 5 }));

        let detail = adaptateur.table_detail("main", "seances").await.unwrap();
        let index = |nom: &str| detail.columns.iter().position(|c| c.name == nom).unwrap();

        // Le binaire arrive en base64 (`06a`), le nul reste nul.
        assert!(matches!(
            &fenetre.rows[0][index("empreinte")],
            Value::Binary { .. }
        ));
        assert_eq!(fenetre.rows[1][index("empreinte")], Value::Null);
    }

    #[tokio::test]
    async fn du_texte_dans_une_colonne_entiere_se_lit_sans_erreur() {
        let (_dossier, chemin) = decor();
        let adaptateur = adaptateur(&chemin).await;
        let requete = RowQuery::new("main", "seances", RowLimit::OneHundred);
        let fenetre = adaptateur.rows(&requete).await.unwrap();
        let detail = adaptateur.table_detail("main", "seances").await.unwrap();
        let places = detail
            .columns
            .iter()
            .position(|c| c.name == "places")
            .unwrap();

        // **La vérité de ce moteur** : `places` est déclarée `integer`, et une ligne y porte du
        // texte. `Value` dit la nature réelle, `ColumnInfo.type_name` la déclaration, et les deux se
        // contredisent — c'est ce que `17b` annonce.
        let valeurs: Vec<&Value> = fenetre.rows.iter().map(|l| &l[places]).collect();
        assert!(
            valeurs.iter().any(|v| matches!(v, Value::Text { .. })),
            "{valeurs:?}"
        );
        assert!(valeurs.iter().any(|v| matches!(v, Value::Int { .. })));
        assert_eq!(detail.columns[places].category, TypeCategory::Number);
    }

    #[tokio::test]
    async fn un_filtre_matches_cherche_une_sous_chaine_sans_interpreter_les_jokers() {
        let (_dossier, chemin) = decor();
        let adaptateur = adaptateur(&chemin).await;
        let mut requete = RowQuery::new("main", "ateliers", RowLimit::OneHundred);
        requete.filters = vec![Filter {
            column: "nom".into(),
            operator: FilterOperator::Matches,
            value: Some("grav".into()),
        }];
        // Insensible à la casse, comme `ILIKE` en `06d` : « grav » doit trouver « Gravure ».
        //
        // **« gra » n'aurait pas fait l'affaire** : « Sérigraphie » le contient aussi, et le test
        // aurait échoué en accusant le filtre alors qu'il avait raison. Un décor dont deux valeurs
        // partagent une sous-chaîne est plus honnête qu'un décor où chaque mot est unique.
        assert_eq!(adaptateur.rows(&requete).await.unwrap().rows.len(), 1);

        // Un joker de `like` doit être cherché **littéralement**.
        requete.filters[0].value = Some("%".into());
        assert_eq!(
            adaptateur.rows(&requete).await.unwrap().rows.len(),
            0,
            "« % » doit être cherché littéralement, pas interprété"
        );
    }

    #[tokio::test]
    async fn une_modification_previsualisee_est_celle_qui_part() {
        let (_dossier, chemin) = decor();
        let adaptateur = adaptateur(&chemin).await;
        let plan = UpdatePlan {
            schema: "main".into(),
            table: "ateliers".into(),
            key_column: "id".into(),
            changes: vec![PendingUpdate {
                key: "1".into(),
                column: "ville".into(),
                value: Some("Albi".into()),
                expected: Some("Toulouse".into()),
            }],
        };

        let apercu = adaptateur.preview_updates(&plan).await.unwrap();
        assert!(apercu.contains("'Albi'"), "{apercu}");
        assert!(apercu.contains("'Toulouse'"), "{apercu}");

        let issue = adaptateur.apply_updates(&plan).await.unwrap();
        assert_eq!(issue.applied, 1);
        assert!(
            issue.inverse_sql.contains("'Toulouse'"),
            "{}",
            issue.inverse_sql
        );

        let mut relecture = RowQuery::new("main", "ateliers", RowLimit::OneHundred);
        relecture.filters = vec![Filter {
            column: "id".into(),
            operator: FilterOperator::Eq,
            value: Some("1".into()),
        }];
        let detail = adaptateur.table_detail("main", "ateliers").await.unwrap();
        let ville = detail
            .columns
            .iter()
            .position(|c| c.name == "ville")
            .unwrap();
        let fenetre = adaptateur.rows(&relecture).await.unwrap();
        assert_eq!(
            fenetre.rows[0][ville],
            Value::Text {
                value: "Albi".into()
            }
        );
    }

    #[tokio::test]
    async fn une_modification_partant_d_une_cellule_vide_atteint_la_ligne() {
        let (_dossier, chemin) = decor();
        let adaptateur = adaptateur(&chemin).await;
        // `Sérigraphie` a `divers` à `null`. Avec `=` au lieu de `is`, ce `where` ne trouverait
        // aucune ligne et la transaction s'annulerait sans raison lisible — le piège de `11d` et de
        // `18f`, ici pour la troisième fois.
        let plan = UpdatePlan {
            schema: "main".into(),
            table: "ateliers".into(),
            key_column: "id".into(),
            changes: vec![PendingUpdate {
                key: "2".into(),
                column: "divers".into(),
                value: Some("salle 4".into()),
                expected: None,
            }],
        };
        assert_eq!(adaptateur.apply_updates(&plan).await.unwrap().applied, 1);
    }

    #[tokio::test]
    async fn une_modification_concurrente_annule_toute_la_transaction() {
        let (_dossier, chemin) = decor();
        let adaptateur = adaptateur(&chemin).await;
        let plan = UpdatePlan {
            schema: "main".into(),
            table: "ateliers".into(),
            key_column: "id".into(),
            changes: vec![
                PendingUpdate {
                    key: "1".into(),
                    column: "ville".into(),
                    value: Some("Albi".into()),
                    expected: Some("Toulouse".into()),
                },
                // La seconde attend une valeur qui n'est pas là : elle doit faire annuler la
                // **première** aussi (`06a`).
                PendingUpdate {
                    key: "1".into(),
                    column: "nom".into(),
                    value: Some("Autre".into()),
                    expected: Some("Inexistant".into()),
                },
            ],
        };
        let erreur = adaptateur
            .apply_updates(&plan)
            .await
            .expect_err("doit refuser");
        assert!(erreur.message.contains("a changé"), "{}", erreur.message);

        let mut relecture = RowQuery::new("main", "ateliers", RowLimit::OneHundred);
        relecture.filters = vec![Filter {
            column: "id".into(),
            operator: FilterOperator::Eq,
            value: Some("1".into()),
        }];
        let detail = adaptateur.table_detail("main", "ateliers").await.unwrap();
        let ville = detail
            .columns
            .iter()
            .position(|c| c.name == "ville")
            .unwrap();
        assert_eq!(
            adaptateur.rows(&relecture).await.unwrap().rows[0][ville],
            Value::Text {
                value: "Toulouse".into()
            },
            "la première modification doit avoir été annulée avec la seconde"
        );
    }

    #[tokio::test]
    async fn la_console_execute_et_annonce_sa_limite() {
        let (_dossier, chemin) = decor();
        let resultat = adaptateur(&chemin)
            .await
            .run_sql("select nom, ville from ateliers", RowLimit::OneHundred)
            .await
            .unwrap();
        assert_eq!(resultat.columns, vec!["nom".to_owned(), "ville".to_owned()]);
        assert_eq!(resultat.rows.len(), 3);
        // **La limite ajoutée est dite** : une limite tue ferait croire à une table de trois lignes.
        assert_eq!(resultat.applied_limit, Some(100));
        assert!(resultat.sql.ends_with("limit 100"), "{}", resultat.sql);
    }

    #[tokio::test]
    async fn expliquer_rend_un_plan_lisible_et_n_execute_pas() {
        let (_dossier, chemin) = decor();
        let plan = adaptateur(&chemin)
            .await
            .explain_sql("select * from seances where atelier_id = 1")
            .await
            .unwrap();
        // `EXPLAIN QUERY PLAN` rend des phrases ; `EXPLAIN` seul rendrait le bytecode de la machine
        // virtuelle, illisible pour qui débogue.
        let texte = plan.lines.join("\n");
        assert!(texte.contains("seances"), "{texte}");
        assert!(
            texte.to_uppercase().contains("SCAN") || texte.to_uppercase().contains("SEARCH"),
            "{texte}"
        );
        assert!(plan.sql.starts_with("EXPLAIN QUERY PLAN"), "{}", plan.sql);
    }

    #[tokio::test]
    async fn un_insert_copie_recree_la_ligne() {
        let (_dossier, chemin) = decor();
        let adaptateur = adaptateur(&chemin).await;
        let requete = RowQuery::new("main", "ateliers", RowLimit::OneHundred);
        let fenetre = adaptateur.rows(&requete).await.unwrap();

        let sql = adaptateur
            .row_as_insert("main", "ateliers", &fenetre.rows[0])
            .await
            .unwrap();

        // **Le critère de `10f`** : l'`INSERT` copié doit s'exécuter. Le rejouer dans une table de
        // même forme est ce qui le prouve.
        let connexion = Connection::open(&chemin).unwrap();
        connexion
            .execute_batch(
                "create table copie (id integer primary key, nom text not null, ville varchar(80), \
                 ouvert_le date, divers, actif boolean)",
            )
            .unwrap();
        connexion
            .execute_batch(&sql.replace("\"ateliers\"", "\"copie\""))
            .unwrap_or_else(|e| panic!("l'INSERT copié doit s'exécuter : {e}\n---\n{sql}"));
    }

    #[tokio::test]
    async fn une_table_inconnue_le_dit_plutot_que_de_rendre_zero_ligne() {
        let (_dossier, chemin) = decor();
        let erreur = adaptateur(&chemin)
            .await
            .table_detail("main", "table_qui_n_existe_pas")
            .await
            .expect_err("doit échouer");
        assert!(
            erreur.message.contains("n'existe pas"),
            "{}",
            erreur.message
        );
    }
}
