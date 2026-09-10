//! La couche moteur : ce que tout adaptateur doit savoir faire.
//!
//! # Pourquoi une énumération et pas `dyn`
//!
//! Vérifié par sonde de compilation le 6 août 2026 : un `async fn` en trait **n'est pas
//! compatible `dyn`** (`error[E0038]`). La lecture naïve de « le trait est asynchrone »
//! mènerait donc à `async-trait` et au boxing des futurs.
//!
//! Les sept moteurs du handoff sont un ensemble **fermé**, connu à la compilation. Une
//! énumération donne la répartition statique, aucun boxing, aucune dépendance
//! supplémentaire, et surtout l'**exhaustivité** : ajouter un moteur force à le traiter
//! partout, là où un `dyn` laisserait un oubli silencieux.
//!
//! Le trait reste utile — chaque adaptateur est écrit contre lui et testable isolément —
//! mais il n'est jamais employé en objet.

pub mod bigquery;
pub mod cloudsql;
pub mod commands;
mod error;
/// L'export d'un résultat de console dans un fichier (`API-29`).
///
/// **Le sérialiseur vit du côté qui écrit**, et non à l'écran : l'export de la vue table ne pourra
/// être qu'un flux écrit ici, et deux sérialiseurs CSV divergeraient (règle n° 17).
pub mod export;
mod introspection;
/// Les dernières lignes écrites par un proxy en sous-processus.
///
/// **Remonté de `cloudsql/` le 31 août 2026**, quand `kubernetes/` a eu le même besoin — même
/// mouvement, et pour la même raison, que `port` en `06g`.
pub mod journal;
/// Le transfert de port `kubectl` (31 août 2026) : joindre une base qui vit dans un cluster.
pub mod kubernetes;
pub mod mongo;
pub mod mysql;
/// Le choix du port local, commun au tunnel SSH (`06e`) et au proxy Cloud SQL (`06g`).
///
/// **Remonté d'un cran depuis `tunnel/`** en `06g` : les deux sortes de proxy en ont besoin,
/// et laisser le module sous `tunnel/` aurait fait dépendre `cloudsql` de `tunnel` — une
/// dépendance qui ne dit rien de vrai sur le domaine.
pub mod port;
pub mod postgres;
/// Trouver un programme tiers, et lui donner un `PATH` utilisable depuis une app du Finder.
pub mod programme;
pub mod proxy;
pub mod registry;
mod rows;
/// Le pilotage d'un proxy qui est un sous-processus, commun à `cloudsql` et `kubernetes`.
pub mod sous_processus;
pub mod sqlite;
pub mod tls;
/// Le mode de transaction d'une console et le journal de sa transaction (`API-38`).
pub mod transaction;
pub mod tunnel;

use std::future::Future;

pub use error::{ConnectionProbe, EngineError};
pub use export::ExportFormat;
pub use introspection::{
    ColumnInfo, ConstraintInfo, Identity, IndexInfo, KeyKind, ObjectCounts, ObjectKind, Relation,
    RelationCardinality, RelationDirection, RowCount, SchemaInfo, TableDetail, TableSummary,
    TriggerInfo, TypeCategory,
};
pub use rows::{
    ApplyOutcome, Filter, FilterOperator, PendingDelete, PendingInsert, PendingInsertValue,
    PendingUpdate, QueryResult, RowLimit, RowQuery, RowWindow, SortDirection, SortKey, UpdatePlan,
    Value,
};
pub use transaction::{
    OrdreDeTransaction, TransactionMode, TransactionState, TransactionStatement,
};

/// Ce que chaque moteur doit savoir faire.
///
/// Les retours sont écrits `impl Future<Output = …> + Send` et non `async fn` : le `Send`
/// explicite est ce qui rend ces appels utilisables depuis une commande Tauri. Avec un
/// `async fn`, le futur rendu n'est pas garanti `Send`, et le problème ne se découvrirait
/// qu'en écrivant la première commande.
pub trait EngineAdapter {
    /// Le test de connexion de `A2` : latence et version du serveur.
    fn probe(&self) -> impl Future<Output = Result<ConnectionProbe, EngineError>> + Send;

    /// Les schémas de la base, avec leurs compteurs d'objets.
    fn schemas(&self) -> impl Future<Output = Result<Vec<SchemaInfo>, EngineError>> + Send;

    /// Les objets d'un schéma — le tableau de `A4`.
    fn objects(
        &self,
        schema: &str,
    ) -> impl Future<Output = Result<Vec<TableSummary>, EngineError>> + Send;

    /// Le détail d'une table — ce que `A9` affiche, DDL compris.
    fn table_detail(
        &self,
        schema: &str,
        table: &str,
    ) -> impl Future<Output = Result<TableDetail, EngineError>> + Send;

    /// Une **fenêtre** de lignes. Aucune signature ne permet de demander un jeu complet :
    /// `RowQuery` exige un `RowLimit`, pris dans un ensemble fermé.
    fn rows(&self, query: &RowQuery)
        -> impl Future<Output = Result<RowWindow, EngineError>> + Send;

    /// Une ligne rendue en `INSERT` exécutable — ce que `A5` copie (`10f`).
    ///
    /// **Sur l'adaptateur, et non dans l'écran** : citer les identifiants et littéraliser les
    /// valeurs demande de connaître les règles du moteur, et le front en connaîtrait alors sept.
    /// Le projet a déjà refusé ce couplage pour la clé de base (`09b`) et la référence de secret
    /// (`08e`).
    fn row_as_insert(
        &self,
        schema: &str,
        table: &str,
        values: &[Value],
    ) -> impl Future<Output = Result<String, EngineError>> + Send;

    /// Le SQL qu'`Appliquer` exécutera, **rendu par le moteur** (`11c`).
    ///
    /// Sur l'adaptateur pour la même raison que `row_as_insert`, et une de plus : le bloc annonce
    /// « SQL qui sera exécuté ». S'il n'est pas exactement celui qui partira, il est **pire
    /// qu'absent** — c'est le dernier endroit où l'on vérifie avant d'écrire en production. `11d`
    /// exécutera cette suite, pas une reconstruction.
    ///
    /// N'ouvre aucune transaction et n'exécute rien : elle rend du texte.
    fn preview_updates(
        &self,
        plan: &UpdatePlan,
    ) -> impl Future<Output = Result<String, EngineError>> + Send;

    /// **La première écriture du projet** (`11d`). Tout le reste, depuis `01`, est en lecture.
    ///
    /// Une transaction : `BEGIN`, un `UPDATE` par modification, `COMMIT`. Trois modifications qui
    /// s'appliqueraient à moitié laisseraient des données incohérentes que rien ne signalerait.
    ///
    /// Le `WHERE` porte l'ancienne valeur : zéro ligne affectée signifie que la ligne a changé depuis
    /// la lecture, et **toute** la transaction est annulée — pas un rapport partiel.
    fn apply_updates(
        &self,
        plan: &UpdatePlan,
    ) -> impl Future<Output = Result<ApplyOutcome, EngineError>> + Send;

    /// Exécute le SQL **écrit par l'utilisateur** (`12c`).
    ///
    /// C'est la première fois que le SQL ne vient pas de DoraBase. Deux conséquences portées ici :
    /// une limite est ajoutée aux requêtes qui rendent des lignes et n'en portent pas — sinon
    /// `select * from orders` ferait traverser l'IPC à 1,9 million de lignes, ce que la contrainte
    /// transverse du projet interdit — et elle est **rendue** dans `applied_limit` pour que l'écran
    /// puisse le dire.
    fn run_sql(
        &self,
        sql: &str,
        limite: RowLimit,
    ) -> impl Future<Output = Result<QueryResult, EngineError>> + Send;

    /// Ouvre, valide ou annule la transaction de cette connexion (`API-38`).
    ///
    /// **Une seule méthode pour les trois ordres** : les deux moteurs qui n'ont pas de transaction à
    /// tenir depuis une console refusent alors en un seul endroit, et un sixième moteur n'aura qu'une
    /// méthode à écrire — celle où son auteur devra répondre à la question.
    ///
    /// Rien n'est rendu : la transaction ne se raconte pas, elle est ou n'est pas. C'est le registre
    /// qui tient le journal de ce qu'elle contient, parce que ce journal survit à chaque appel et
    /// qu'un adaptateur ne sait pas ce qu'un autre onglet a exécuté.
    fn transaction(
        &self,
        ordre: OrdreDeTransaction,
    ) -> impl Future<Output = Result<(), EngineError>> + Send;
}

/// Le moteur actif, réparti statiquement.
///
/// Deux variantes manquent encore — Redis (`19`), Snowflake (`20`). L'exhaustivité du `match` est
/// ce qui garantit qu'aucune ne sera oubliée en cours de route : chaque ajout fait échouer la
/// compilation ici.
///
/// **`18a` est la spec à lire avant d'en ajouter une** : elle recense les six endroits où ce
/// contrat suppose quelque chose qu'un moteur documentaire n'a pas — niveau schéma, colonnes
/// déclarées, DDL, types BSON, transactions, et le mot « sql » dans deux noms de méthodes.
pub enum AnyEngine {
    Postgres(postgres::PostgresAdapter),
    MongoDb(mongo::MongoAdapter),
    Sqlite(sqlite::SqliteAdapter),
    MySql(mysql::MysqlAdapter),
    // **Boxé, contrairement aux quatre autres.** `BigQueryAdapter` porte le `Client` de
    // `gcp_bigquery_client`, sensiblement plus gros que les autres pilotes — `clippy` le signale
    // (`large_enum_variant`) parce que la taille de l'énumération entière suit sa variante la plus
    // grande. `Box` reporte ce poids sur le tas, sans changer un seul appelant : `AnyEngine` reste
    // aussi léger que si BigQuery n'existait pas.
    BigQuery(Box<bigquery::BigQueryAdapter>),
}

impl AnyEngine {
    /// Ouvre l'adaptateur que le moteur déclaré désigne.
    ///
    /// **Le `match` ne rend pas l'oubli impossible, contrairement à ce qui était écrit ici.** La
    /// phrase valait « déclarer un septième moteur fait échouer la compilation tant qu'aucun
    /// adaptateur ne lui répond » — vrai d'un `match` exhaustif par énumération de ses bras, faux
    /// dès qu'un bras attrape le reste. Le refus par défaut, ajouté pour donner un message utile
    /// aux moteurs non livrés, a **absorbé** SQLite et MySQL : leurs adaptateurs existaient, les
    /// six autres `match` de ce fichier les répartissaient, et ici ils recevaient « DoraBase ne
    /// sait pas encore parler à MySQL ». Rien n'a échoué — ni la compilation, ni les tests, qui
    /// appellent les adaptateurs en direct.
    ///
    /// Ce qui garde ce `match` honnête est donc un test, pas le compilateur :
    /// `chacun_des_moteurs_livres_joint_son_pilote`.
    pub async fn connect_via(
        moteur: crate::config::Engine,
        variante: &crate::config::ConnectionSettings,
        mot_de_passe: Option<&crate::secrets::Secret>,
        known_hosts: &std::path::Path,
    ) -> Result<Self, EngineError> {
        use crate::config::Engine;
        match moteur {
            Engine::PostgreSql => Ok(Self::Postgres(
                postgres::PostgresAdapter::connect_via(variante, mot_de_passe, known_hosts).await?,
            )),
            Engine::MongoDb => Ok(Self::MongoDb(
                mongo::MongoAdapter::connect_via(variante, mot_de_passe, known_hosts).await?,
            )),
            // **Ces deux-là étaient tombés dans le refus par omission.** Leurs adaptateurs
            // existent, leurs variantes d'`AnyEngine` existent, et les six autres `match` de ce
            // fichier les répartissent — mais celui-ci, le seul qui *construit*, ne les nommait
            // pas : SQLite et MySQL étaient donc injoignables depuis l'application, avec le
            // message « DoraBase ne sait pas encore parler à MySQL » d'un moteur non livré.
            //
            // Ce que la garantie annoncée plus haut n'attrape pas : le bras `autre` **rend le
            // `match` exhaustif**, donc ajouter une variante ne fait plus rien échouer ici. C'est
            // le prix du message de refus, et la raison pour laquelle l'oubli n'a fait aucun
            // bruit — ni à la compilation, ni aux tests, qui appellent les adaptateurs en direct.
            Engine::Sqlite => Ok(Self::Sqlite(
                sqlite::SqliteAdapter::connect_via(variante, mot_de_passe, known_hosts).await?,
            )),
            Engine::MySql => Ok(Self::MySql(
                mysql::MysqlAdapter::connect_via(variante, mot_de_passe, known_hosts).await?,
            )),
            // **`21` a comblé l'obstacle que `raison_du_refus` décrivait** : le décor de test
            // manquait, pas le contrat. Il manque encore — voir le commentaire de tête de
            // `bigquery/mod.rs` — mais le pilote, lui, est joint comme les quatre autres.
            Engine::BigQuery => Ok(Self::BigQuery(Box::new(
                bigquery::BigQueryAdapter::connect_via(variante, mot_de_passe, known_hosts).await?,
            ))),
            // **Refusé, avec ce qui manque — pas seulement un numéro de spec.** La règle de `09f`
            // appliquée à un moteur : un message qui nomme l'échéance vaut mieux qu'un échec de
            // connexion qui laisse chercher un problème de réseau. Et nommer *la difficulté* vaut
            // mieux qu'un numéro, parce que les deux moteurs restants sont bloqués pour deux
            // raisons différentes.
            autre => Err(EngineError::local(raison_du_refus(autre))),
        }
    }

    /// L'état du tunnel, quand il y en a un.
    pub fn etat_tunnel(&self) -> Option<proxy::EtatProxy> {
        match self {
            Self::Postgres(adaptateur) => adaptateur.etat_tunnel(),
            Self::MongoDb(adaptateur) => adaptateur.etat_tunnel(),
            Self::Sqlite(adaptateur) => adaptateur.etat_tunnel(),
            Self::MySql(adaptateur) => adaptateur.etat_tunnel(),
            Self::BigQuery(adaptateur) => adaptateur.etat_tunnel(),
        }
    }

    /// Le port local du tunnel, que `A2` affiche sous « auto (63342) ».
    pub fn port_local_tunnel(&self) -> Option<u16> {
        match self {
            Self::Postgres(adaptateur) => adaptateur.port_local_tunnel(),
            Self::MongoDb(adaptateur) => adaptateur.port_local_tunnel(),
            Self::Sqlite(adaptateur) => adaptateur.port_local_tunnel(),
            Self::MySql(adaptateur) => adaptateur.port_local_tunnel(),
            Self::BigQuery(adaptateur) => adaptateur.port_local_tunnel(),
        }
    }

    /// La connexion est-elle définitivement perdue ? — la question que le registre pose après un
    /// échec, et dont chaque moteur a sa propre réponse (voir chaque adaptateur).
    ///
    /// **Inhérente et répartie par un `match` sans bras attrape-tout**, comme `close` et
    /// `port_local_tunnel` : un sixième moteur ne compilera pas tant qu'il n'aura pas répondu. Une
    /// méthode de trait à corps par défaut rendrait `false` pour lui sans que personne l'ait
    /// choisi — c'est exactement le bras attrape-tout qui a absorbé SQLite et MySQL dans
    /// `connect_via` (règle n° 16), et le prix serait le même : une connexion morte annoncée
    /// vivante, sans que rien n'échoue.
    pub fn connexion_perdue(&self) -> bool {
        match self {
            Self::Postgres(adaptateur) => adaptateur.connexion_perdue(),
            Self::MongoDb(adaptateur) => adaptateur.connexion_perdue(),
            Self::Sqlite(adaptateur) => adaptateur.connexion_perdue(),
            Self::MySql(adaptateur) => adaptateur.connexion_perdue(),
            Self::BigQuery(adaptateur) => adaptateur.connexion_perdue(),
        }
    }

    /// Une instruction refusée **abandonne-t-elle** la transaction en cours ? (`API-38`)
    ///
    /// # Pourquoi la question est posée au moteur
    ///
    /// Les réponses diffèrent, et l'écart décide de ce qu'un panneau offre. **PostgreSQL abandonne**
    /// : après une erreur dans un bloc de transaction, toute instruction suivante est refusée par
    /// « current transaction is aborted », et un `commit` s'y comporte comme un `rollback` — le
    /// bouton « Valider » y promettrait donc l'inverse de ce qu'il ferait. **SQLite et MySQL, non** :
    /// l'instruction échoue, la transaction continue, et les précédentes restent validables. Le
    /// deviner à l'écran aurait retiré à ces deux-là une capacité qu'ils ont.
    ///
    /// **Inhérente et répartie par un `match` sans bras attrape-tout**, comme `connexion_perdue` et
    /// `close` : un sixième moteur ne compilera pas tant qu'il n'aura pas répondu. Une méthode de
    /// trait à corps par défaut lui donnerait « n'abandonne pas » sans que personne l'ait choisi.
    pub fn transaction_abandonnee_par_une_erreur(&self) -> bool {
        match self {
            // Le seul des cinq qui abandonne. Voir la documentation du serveur : dans un bloc de
            // transaction, une erreur fait refuser tout ce qui suit jusqu'à sa fin.
            Self::Postgres(_) => true,
            // Une instruction refusée n'annule pas la transaction : elle échoue seule, et ce qui
            // précède reste bon. Les deux le documentent, et un test de base le garde.
            Self::Sqlite(_) | Self::MySql(_) => false,
            // La question ne se pose pas : leurs consoles n'ont pas de transaction manuelle — la
            // mongo ne fait que lire, BigQuery n'a pas de session à tenir. La valeur n'est jamais
            // lue, et « n'abandonne pas » est la réponse la moins présomptueuse.
            Self::MongoDb(_) | Self::BigQuery(_) => false,
        }
    }

    /// Ferme la connexion et **attend** que le port local du tunnel soit rendu.
    pub async fn close(self) {
        match self {
            Self::Postgres(adaptateur) => adaptateur.close().await,
            Self::MongoDb(adaptateur) => adaptateur.close().await,
            Self::Sqlite(adaptateur) => adaptateur.close().await,
            Self::MySql(adaptateur) => adaptateur.close().await,
            Self::BigQuery(adaptateur) => adaptateur.close().await,
        }
    }
}

/// Le refus des quatre moteurs qui n'ont pas de schéma à créer — voir `AnyEngine::create_schema`.
///
/// Une constante plutôt qu'un message par moteur : ce que l'écran en fait est une seule phrase, et
/// l'entrée de menu qui y mène est déjà désactivée avec sa raison hors PostgreSQL. Ce message ne se
/// lit donc que par un chemin qui contourne l'écran — une configuration écrite à la main.
const REFUS_CREATION_DE_SCHEMA: &str =
    "seul PostgreSQL sait créer un schéma depuis DoraBase : ailleurs, le niveau « schéma » est une \
     base du serveur (MySQL, MongoDB), le fichier lui-même (SQLite) ou un jeu de données facturé à \
     part (BigQuery).";

fn nom_du_moteur(moteur: crate::config::Engine) -> &'static str {
    // **Le nom vit sur le type** depuis `API-32`, où `config` a eu besoin de le dire aussi. Cette
    // fonction reste : elle est appelée six fois ici, et la remplacer partout n'apprendrait rien.
    moteur.nom()
}

/// Pourquoi ce moteur n'est pas livré, **dans ses termes**.
///
/// Les deux moteurs restants le sont pour deux raisons distinctes, et les confondre sous un
/// « voir la spec N » ferait chercher du code là où il manque un compte, ou un écran.
fn raison_du_refus(moteur: crate::config::Engine) -> String {
    use crate::config::Engine;
    let nom = nom_du_moteur(moteur);
    let spec = spec_du_moteur(moteur);
    match moteur {
        // **La seule conclusion négative du projet** (`19a`) : un espace de clés Redis n'est pas un
        // tableau. Le forcer dans le contrat de `06a` donnerait des écrans qui affichent des
        // colonnes inventées — un préfixe de clé est une convention d'équipe, pas une structure.
        Engine::Redis => format!(
            "{nom} ne se parcourt pas comme une base relationnelle : un espace de clés n'a ni              tables ni colonnes, et les inventer donnerait des écrans qui affichent des données qui              n'existent pas. Il lui faut son propre écran — voir la spec {spec}"
        ),
        // `20` : ni difficulté de conception, ni décor de test. **`21`, lui, est livré** — voir
        // `bigquery/mod.rs` sur ce que « livré sans décor » veut dire pour ce moteur précisément.
        Engine::Snowflake => format!(
            "DoraBase ne sait pas encore parler à {nom} : le contrat lui irait, mais le projet n'a              aucun décor de test pour lui — et un adaptateur de base de données que rien ne vérifie              est exactement ce qui perd des données sans le dire. Voir la spec {spec}"
        ),
        autre => format!(
            "DoraBase ne sait pas encore parler à {} — voir la spec {} du projet",
            nom_du_moteur(autre),
            spec_du_moteur(autre)
        ),
    }
}

fn spec_du_moteur(moteur: crate::config::Engine) -> &'static str {
    use crate::config::Engine;
    match moteur {
        Engine::PostgreSql => "06",
        Engine::MySql => "16a",
        Engine::Sqlite => "17a",
        Engine::MongoDb => "18",
        Engine::Redis => "19a",
        Engine::Snowflake => "20",
        Engine::BigQuery => "21",
    }
}

impl AnyEngine {
    pub async fn probe(&self) -> Result<ConnectionProbe, EngineError> {
        match self {
            Self::Postgres(adaptateur) => adaptateur.probe().await,
            Self::MongoDb(adaptateur) => adaptateur.probe().await,
            Self::Sqlite(adaptateur) => adaptateur.probe().await,
            Self::MySql(adaptateur) => adaptateur.probe().await,
            Self::BigQuery(adaptateur) => adaptateur.probe().await,
        }
    }

    pub async fn schemas(&self) -> Result<Vec<SchemaInfo>, EngineError> {
        match self {
            Self::Postgres(adaptateur) => adaptateur.schemas().await,
            Self::MongoDb(adaptateur) => adaptateur.schemas().await,
            Self::Sqlite(adaptateur) => adaptateur.schemas().await,
            Self::MySql(adaptateur) => adaptateur.schemas().await,
            Self::BigQuery(adaptateur) => adaptateur.schemas().await,
        }
    }

    pub async fn objects(&self, schema: &str) -> Result<Vec<TableSummary>, EngineError> {
        match self {
            Self::Postgres(adaptateur) => adaptateur.objects(schema).await,
            Self::MongoDb(adaptateur) => adaptateur.objects(schema).await,
            Self::Sqlite(adaptateur) => adaptateur.objects(schema).await,
            Self::MySql(adaptateur) => adaptateur.objects(schema).await,
            Self::BigQuery(adaptateur) => adaptateur.objects(schema).await,
        }
    }

    pub async fn table_detail(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<TableDetail, EngineError> {
        match self {
            Self::Postgres(adaptateur) => adaptateur.table_detail(schema, table).await,
            Self::MongoDb(adaptateur) => adaptateur.table_detail(schema, table).await,
            Self::Sqlite(adaptateur) => adaptateur.table_detail(schema, table).await,
            Self::MySql(adaptateur) => adaptateur.table_detail(schema, table).await,
            Self::BigQuery(adaptateur) => adaptateur.table_detail(schema, table).await,
        }
    }

    /// Le détail de plusieurs tables d'un schéma, en une seule prise du verrou du registre.
    ///
    /// # Pourquoi ce n'est pas une entrée du contrat de moteur
    ///
    /// La lecture ensembliste de PostgreSQL — cinq requêtes filtrées sur un ensemble d'oid — n'a
    /// d'équivalent chez aucun des quatre autres : MongoDB échantillonne collection par collection,
    /// SQLite interroge un `pragma` par table, BigQuery un appel REST par table. L'inscrire au
    /// contrat aurait obligé chacun à déclarer une optimisation qu'il n'a pas, pour la même boucle.
    ///
    /// # Le `match` reste exhaustif, et c'est délibéré
    ///
    /// **Pas de bras attrape-tout.** C'est la leçon du défaut n° 16 : un `autre =>` avait absorbé
    /// SQLite et MySQL, dont les adaptateurs existaient, et l'application les refusait. Les quatre
    /// moteurs qui bouclent sont donc **nommés** — un sixième moteur fera échouer la compilation
    /// ici, et son auteur choisira lui-même sa stratégie.
    ///
    /// # Ce que la boucle gagne quand même
    ///
    /// Même sans lecture ensembliste, passer par ici fait prendre le verrou du registre **une
    /// fois** au lieu d'une par table, et supprime autant d'allers-retours d'IPC. C'est ce que
    /// l'écran faisait à la main, en moins de trajets.
    pub async fn table_details(
        &self,
        schema: &str,
        tables: &[String],
    ) -> Result<Vec<TableDetail>, EngineError> {
        match self {
            Self::Postgres(adaptateur) => adaptateur.table_details(schema, tables).await,
            Self::MongoDb(_) | Self::Sqlite(_) | Self::MySql(_) | Self::BigQuery(_) => {
                let mut details = Vec::with_capacity(tables.len());
                for table in tables {
                    /* **Ce qui n'existe pas se tait, il n'échoue pas** — la même règle que la
                    version ensembliste de PostgreSQL. Une lecture de schéma part d'une liste
                    établie un instant plus tôt : une table retirée entre-temps ne doit pas
                    emporter les cinquante-neuf autres. */
                    if let Ok(detail) = self.table_detail(schema, table).await {
                        details.push(detail);
                    }
                }
                Ok(details)
            }
        }
    }

    /// L'adaptateur d'administration d'une instance managée (`API-32`).
    ///
    /// # Un accès, et non onze méthodes de répartition
    ///
    /// Les sept lectures et l'exécution d'un geste vivent sur `PostgresAdapter` : les répartir une
    /// par une ici ferait huit `match` identiques, dont chacun devrait nommer les quatre moteurs qui
    /// refusent — trente-deux bras pour dire une seule chose. Cette méthode la dit une fois : « ce
    /// moteur se gère, celui-là non ».
    ///
    /// **Le `match` reste exhaustif, les quatre autres moteurs nommés un par un.** C'est la leçon du
    /// défaut n° 16, où un bras attrape-tout avait absorbé SQLite et MySQL alors que leurs
    /// adaptateurs existaient : un huitième moteur fera échouer la compilation ici, là où son auteur
    /// doit choisir.
    ///
    /// Les raisons sont **distinctes**, et les confondre dirait « pas encore » d'un cas qui ne
    /// viendra jamais — le partage des cinq verdicts du dump.
    pub fn administration(&self) -> Result<&postgres::PostgresAdapter, EngineError> {
        match self {
            Self::Postgres(adaptateur) => Ok(adaptateur),
            // « Pas encore » : ces deux-là ont des rôles et des bases de serveur, donc un
            // gestionnaire leur irait. Il n'est simplement pas écrit.
            Self::MySql(_) => Err(EngineError::local(
                "DoraBase ne sait pas encore gérer une instance MySQL : le gestionnaire \
                 d'instances ne parle que PostgreSQL pour l'instant."
                    .to_owned(),
            )),
            Self::MongoDb(_) => Err(EngineError::local(
                "DoraBase ne sait pas encore gérer une instance MongoDB : le gestionnaire \
                 d'instances ne parle que PostgreSQL pour l'instant."
                    .to_owned(),
            )),
            // « Jamais », et pour deux raisons différentes. Un fichier SQLite n'a ni rôles, ni
            // serveur, ni sessions : il n'y a pas d'instance à gérer. Les autorisations d'un projet
            // BigQuery sont celles d'IAM, qui vit hors de la base — les gérer d'ici demanderait de
            // parler à une autre API que celle des données, et ce serait un autre écran.
            Self::Sqlite(_) => Err(EngineError::local(
                "SQLite est un fichier : il n'a ni serveur, ni rôles, ni sessions à gérer."
                    .to_owned(),
            )),
            Self::BigQuery(_) => Err(EngineError::local(
                "les autorisations d'un projet BigQuery sont celles d'IAM, hors de la base : elles \
                 se gèrent dans la console Google Cloud, pas ici."
                    .to_owned(),
            )),
        }
    }

    pub async fn rows(&self, query: &RowQuery) -> Result<RowWindow, EngineError> {
        match self {
            Self::Postgres(adaptateur) => adaptateur.rows(query).await,
            Self::MongoDb(adaptateur) => adaptateur.rows(query).await,
            Self::Sqlite(adaptateur) => adaptateur.rows(query).await,
            Self::MySql(adaptateur) => adaptateur.rows(query).await,
            Self::BigQuery(adaptateur) => adaptateur.rows(query).await,
        }
    }

    pub async fn preview_updates(&self, plan: &UpdatePlan) -> Result<String, EngineError> {
        match self {
            Self::Postgres(adaptateur) => adaptateur.preview_updates(plan).await,
            Self::MongoDb(adaptateur) => adaptateur.preview_updates(plan).await,
            Self::Sqlite(adaptateur) => adaptateur.preview_updates(plan).await,
            Self::MySql(adaptateur) => adaptateur.preview_updates(plan).await,
            Self::BigQuery(adaptateur) => adaptateur.preview_updates(plan).await,
        }
    }

    pub async fn apply_updates(&self, plan: &UpdatePlan) -> Result<ApplyOutcome, EngineError> {
        match self {
            Self::Postgres(adaptateur) => adaptateur.apply_updates(plan).await,
            Self::MongoDb(adaptateur) => adaptateur.apply_updates(plan).await,
            Self::Sqlite(adaptateur) => adaptateur.apply_updates(plan).await,
            Self::MySql(adaptateur) => adaptateur.apply_updates(plan).await,
            Self::BigQuery(adaptateur) => adaptateur.apply_updates(plan).await,
        }
    }

    /// Crée un schéma. **PostgreSQL seulement**, et les quatre autres sont nommés (`API-33`).
    ///
    /// # Pourquoi les autres refusent, plutôt que de tenter
    ///
    /// Ce n'est pas une lacune d'écriture : le niveau « schéma » ne veut pas dire la même chose
    /// d'un moteur à l'autre, et le tableau d'`AGENTS.md` le dit. Chez MongoDB et MySQL, c'est une
    /// **base du serveur** — la créer est un geste d'administration de serveur, pas de connexion, et
    /// elle apparaîtrait dans une modale qui annonce « les schémas de cette base ». Chez SQLite,
    /// `main` est le fichier lui-même : il n'y a rien à créer. Chez BigQuery, c'est un jeu de
    /// données, créé par un appel REST et facturé à part.
    ///
    /// **Le `match` reste exhaustif**, sans bras attrape-tout : c'est la leçon du défaut n° 16, où
    /// un `autre =>` avait absorbé deux moteurs livrés. Un sixième moteur fera échouer la
    /// compilation ici, et son auteur choisira.
    pub async fn create_schema(&self, name: &str) -> Result<(), EngineError> {
        match self {
            Self::Postgres(adaptateur) => adaptateur.create_schema(name).await,
            Self::MongoDb(_) | Self::Sqlite(_) | Self::MySql(_) | Self::BigQuery(_) => {
                Err(EngineError::local(REFUS_CREATION_DE_SCHEMA.to_owned()))
            }
        }
    }

    pub async fn run_sql(&self, sql: &str, limite: RowLimit) -> Result<QueryResult, EngineError> {
        match self {
            Self::Postgres(adaptateur) => adaptateur.run_sql(sql, limite).await,
            Self::MongoDb(adaptateur) => adaptateur.run_sql(sql, limite).await,
            Self::Sqlite(adaptateur) => adaptateur.run_sql(sql, limite).await,
            Self::MySql(adaptateur) => adaptateur.run_sql(sql, limite).await,
            Self::BigQuery(adaptateur) => adaptateur.run_sql(sql, limite).await,
        }
    }

    pub async fn transaction(&self, ordre: OrdreDeTransaction) -> Result<(), EngineError> {
        match self {
            Self::Postgres(adaptateur) => adaptateur.transaction(ordre).await,
            Self::MongoDb(adaptateur) => adaptateur.transaction(ordre).await,
            Self::Sqlite(adaptateur) => adaptateur.transaction(ordre).await,
            Self::MySql(adaptateur) => adaptateur.transaction(ordre).await,
            Self::BigQuery(adaptateur) => adaptateur.transaction(ordre).await,
        }
    }

    pub async fn row_as_insert(
        &self,
        schema: &str,
        table: &str,
        values: &[Value],
    ) -> Result<String, EngineError> {
        match self {
            Self::Postgres(adaptateur) => adaptateur.row_as_insert(schema, table, values).await,
            Self::MongoDb(adaptateur) => adaptateur.row_as_insert(schema, table, values).await,
            Self::Sqlite(adaptateur) => adaptateur.row_as_insert(schema, table, values).await,
            Self::MySql(adaptateur) => adaptateur.row_as_insert(schema, table, values).await,
            Self::BigQuery(adaptateur) => adaptateur.row_as_insert(schema, table, values).await,
        }
    }
}

#[cfg(test)]
mod tests_refus {
    use super::*;
    use crate::config::Engine;

    #[test]
    fn redis_est_refuse_pour_sa_forme_pas_pour_un_retard() {
        // **La seule conclusion négative du projet** (`19a`) : Redis n'entre pas dans le contrat.
        // Un message qui dirait « pas encore » ferait attendre une spec qui n'arrivera pas sous
        // cette forme.
        let raison = raison_du_refus(Engine::Redis);
        assert!(raison.contains("espace de clés"), "{raison}");
        assert!(raison.contains("son propre écran"), "{raison}");
        assert!(
            !raison.contains("pas encore"),
            "Redis n'est pas en retard, il ne rentre pas : {raison}"
        );
    }

    #[test]
    fn snowflake_est_refuse_pour_l_absence_de_decor() {
        // Aucune difficulté de conception : c'est le décor qui manque, et le dire évite de
        // chercher du code là où il faut un compte. BigQuery avait la même raison — voir
        // `bigquery/mod.rs` sur ce que « livré sans décor » veut dire pour lui désormais (`21`).
        let raison = raison_du_refus(Engine::Snowflake);
        assert!(raison.contains("décor de test"), "{raison}");
        assert!(raison.contains("perd des données"), "{raison}");
    }

    #[test]
    fn chaque_refus_nomme_le_moteur_et_sa_spec() {
        // Sans le numéro, le message dit « non » sans dire où lire pourquoi.
        for (moteur, spec) in [
            (Engine::MySql, "16a"),
            (Engine::Sqlite, "17a"),
            (Engine::Redis, "19a"),
            (Engine::Snowflake, "20"),
        ] {
            let raison = raison_du_refus(moteur);
            assert!(raison.contains(nom_du_moteur(moteur)), "{raison}");
            assert!(raison.contains(spec), "{raison} devait citer {spec}");
        }
    }

    /// **Chacun des quatre moteurs livrés joint son propre pilote.**
    ///
    /// Ce test remplace un contrôle qui comparait des numéros de spec : il affirmait que
    /// PostgreSQL et MongoDB « ne passent pas par un refus » en vérifiant `spec_du_moteur`, une
    /// fonction que `connect_via` n'appelle pas. Il est resté vert pendant que SQLite et MySQL
    /// étaient refusés faute de branche, et pendant que le test de connexion parlait PostgreSQL à
    /// tous les moteurs. Un test qui ne touche pas le sujet ne peut pas tomber avec lui.
    ///
    /// Aucun serveur n'est requis : on vise ce qui ne peut pas répondre — un port fermé, un
    /// chemin de fichier inexistant. Ce qu'on mesure est **la nature de l'échec** : un refus de
    /// moteur non livré est rendu *sans rien tenter*, alors qu'un pilote joint échoue sur le
    /// réseau ou sur le fichier. La distinction est exactement celle qui manquait.
    #[tokio::test]
    async fn chacun_des_moteurs_livres_joint_son_pilote() {
        let known_hosts = std::path::Path::new("/inexistant/known_hosts");

        for moteur in [
            Engine::PostgreSql,
            Engine::MongoDb,
            Engine::Sqlite,
            Engine::MySql,
        ] {
            let mut variante = variante_injoignable();
            if moteur == Engine::Sqlite {
                // Un moteur de fichier ne se joint pas par un port : sa base *est* le chemin.
                variante.default_database = "/inexistant/aucune-base.sqlite".into();
            }

            // `expect_err` demanderait `Debug` sur `AnyEngine`, que les adaptateurs refusent
            // délibérément (`05c` : un dérivé exposerait la configuration, donc le mot de passe).
            let erreur = match AnyEngine::connect_via(moteur, &variante, None, known_hosts).await {
                Ok(adaptateur) => {
                    adaptateur.close().await;
                    panic!(
                        "{} s'est connecté à un port fermé — le décor du test ne mesure rien",
                        nom_du_moteur(moteur)
                    );
                }
                Err(erreur) => erreur,
            };

            // Le contrôle : le message de `raison_du_refus` ne doit **pas** apparaître. C'est le
            // seul message qu'un moteur sans branche puisse produire, et il est reconnaissable.
            assert!(
                !erreur.message.contains("ne sait pas encore parler"),
                "{} a été refusé au lieu d'être joint : {}",
                nom_du_moteur(moteur),
                erreur.message
            );
        }
    }

    /// Les deux moteurs sans adaptateur, eux, doivent **toujours** être refusés.
    ///
    /// Contrôle négatif du test précédent : sans lui, on pourrait le satisfaire en retirant le
    /// bras `autre`, ce qui ferait joindre un pilote qui n'existe pas.
    #[tokio::test]
    async fn les_moteurs_sans_adaptateur_sont_refuses_sans_rien_tenter() {
        for moteur in [Engine::Redis, Engine::Snowflake] {
            let erreur = match AnyEngine::connect_via(
                moteur,
                &variante_injoignable(),
                None,
                std::path::Path::new("/inexistant/known_hosts"),
            )
            .await
            {
                Ok(adaptateur) => {
                    adaptateur.close().await;
                    panic!(
                        "{} n'a pas d'adaptateur et s'est pourtant connecté",
                        nom_du_moteur(moteur)
                    );
                }
                Err(erreur) => erreur,
            };

            assert!(
                erreur.message.contains(nom_du_moteur(moteur)),
                "le refus doit nommer le moteur : {}",
                erreur.message
            );
        }
    }

    /// **BigQuery est joint, mais pas par `variante_injoignable()`** : ce moteur n'a ni hôte ni
    /// port, donc « port 1 fermé » ne prouve rien pour lui. La preuve déterministe et sans réseau
    /// que le pilote est bien atteint — pas refusé comme un moteur non livré — est un projet GCP
    /// **vide** : `connect::projet_de` le refuse avant tout appel à l'authentification, donc ce
    /// test ne dépend ni du réseau ni des identifiants Google présents (ou non) sur la machine qui
    /// l'exécute.
    #[tokio::test]
    async fn bigquery_est_joint_et_pas_refuse_comme_un_moteur_non_livre() {
        let mut variante = variante_injoignable();
        variante.default_database = String::new();
        // `expect_err` demanderait `Debug` sur `AnyEngine`, que les adaptateurs refusent
        // délibérément (`05c`) — même raison que `chacun_des_moteurs_livres_joint_son_pilote`.
        let erreur = match AnyEngine::connect_via(
            Engine::BigQuery,
            &variante,
            None,
            std::path::Path::new("/inexistant/known_hosts"),
        )
        .await
        {
            Ok(_) => panic!("un projet vide doit être refusé"),
            Err(erreur) => erreur,
        };

        assert!(
            !erreur.message.contains("ne sait pas encore parler"),
            "BigQuery a été refusé comme un moteur non livré : {}",
            erreur.message
        );
        assert!(erreur.message.contains("projet GCP"), "{}", erreur.message);
    }

    /// Une variante que rien ne peut joindre : le port 1 est réservé et personne n'y écoute.
    fn variante_injoignable() -> crate::config::ConnectionSettings {
        crate::config::ConnectionSettings {
            host: "127.0.0.1".into(),
            port: 1,
            default_database: "atelier_ventes".into(),
            username: String::new(),
            password: None,
            // `disable` : un `prefer` ferait négocier du TLS à des pilotes qui n'ont rien en
            // face, ce qui allongerait le test sans rien mesurer de plus.
            ssl_mode: crate::config::SslMode::Disable,
            ca_certificate: None,
            auth_database: None,
            read_only: false,
            reconnect_on_startup: false,
            tunnel: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sonde de compatibilité `Send`, **vérifiée par le compilateur** et non supposée.
    ///
    /// Sans elle, on découvrirait le problème en écrivant la première commande Tauri, qui
    /// exige que le futur traverse un fil.
    fn exige_send<F: Future + Send>(_futur: F) {}

    struct AdaptateurFactice;

    // Les **implémentations** peuvent écrire `async fn`, là où la **déclaration** du trait
    // a besoin de `impl Future + Send` pour garantir le `Send`. Rust vérifie que le futur
    // rendu satisfait bien la borne déclarée — c'est donc plus court sans rien perdre, et
    // c'est clippy (`manual_async_fn`) qui l'a signalé.
    impl EngineAdapter for AdaptateurFactice {
        async fn probe(&self) -> Result<ConnectionProbe, EngineError> {
            Ok(ConnectionProbe {
                latency_ms: 1,
                server_version: "Factice 1.0".into(),
            })
        }

        async fn schemas(&self) -> Result<Vec<SchemaInfo>, EngineError> {
            Ok(vec![])
        }

        async fn objects(&self, _schema: &str) -> Result<Vec<TableSummary>, EngineError> {
            Ok(vec![])
        }

        async fn table_detail(
            &self,
            _schema: &str,
            _table: &str,
        ) -> Result<TableDetail, EngineError> {
            Err(EngineError::local("adaptateur factice"))
        }

        async fn row_as_insert(
            &self,
            _schema: &str,
            _table: &str,
            _values: &[Value],
        ) -> Result<String, EngineError> {
            Ok(String::new())
        }

        async fn preview_updates(&self, _plan: &UpdatePlan) -> Result<String, EngineError> {
            Ok(String::new())
        }

        async fn run_sql(&self, _sql: &str, _limite: RowLimit) -> Result<QueryResult, EngineError> {
            Ok(QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                sql: String::new(),
                duration_ms: 0,
                applied_limit: None,
                affected: None,
            })
        }

        async fn transaction(&self, _ordre: OrdreDeTransaction) -> Result<(), EngineError> {
            Ok(())
        }

        async fn apply_updates(&self, _plan: &UpdatePlan) -> Result<ApplyOutcome, EngineError> {
            Ok(ApplyOutcome {
                applied: 0,
                inverse_sql: String::new(),
            })
        }

        async fn rows(&self, _query: &RowQuery) -> Result<RowWindow, EngineError> {
            Err(EngineError::local("adaptateur factice"))
        }
    }

    #[test]
    fn les_futurs_du_trait_sont_send() {
        let adaptateur = AdaptateurFactice;
        // Si l'un de ces appels n'était pas `Send`, la compilation échouerait ici — ce
        // qui est précisément le but.
        exige_send(adaptateur.probe());
        exige_send(adaptateur.schemas());
        exige_send(adaptateur.objects("public"));
        exige_send(adaptateur.table_detail("public", "orders"));
        exige_send(adaptateur.rows(&RowQuery::new("public", "orders", RowLimit::FiveHundred)));
        exige_send(adaptateur.transaction(OrdreDeTransaction::Ouvrir));
    }

    #[test]
    fn les_futurs_de_l_enumeration_sont_send_aussi() {
        // Vérifié sur le *type* : construire un `AnyEngine::Postgres` exigerait une vraie
        // connexion, ce qui n'a pas sa place dans un test sans base.
        fn _verifie(moteur: &AnyEngine) {
            exige_send(moteur.probe());
            exige_send(moteur.schemas());
            exige_send(moteur.objects("public"));
            exige_send(moteur.table_detail("public", "orders"));
            exige_send(moteur.rows(&RowQuery::new("public", "t", RowLimit::OneHundred)));
            exige_send(moteur.transaction(OrdreDeTransaction::Valider));
        }
    }

    #[test]
    fn un_adaptateur_factice_repond_au_contrat() {
        // Contrôle positif : sans lui, `les_futurs_du_trait_sont_send` pourrait passer sur
        // un trait que personne n'implémente réellement.
        let futur = AdaptateurFactice.probe();
        let sonde = futures_executor_minimal(futur).expect("l'adaptateur factice répond");
        assert_eq!(sonde.server_version, "Factice 1.0");
    }

    /// Exécuteur minimal, pour ne pas ajouter `tokio` en dépendance de test alors qu'un
    /// seul futur trivial doit être résolu. Il suffit ici parce que ce futur ne se met
    /// jamais en attente.
    fn futures_executor_minimal<F: Future>(futur: F) -> F::Output {
        use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};

        fn vtable() -> &'static RawWakerVTable {
            unsafe fn nop(_: *const ()) {}
            unsafe fn clone(_: *const ()) -> RawWaker {
                RawWaker::new(std::ptr::null(), vtable())
            }
            &RawWakerVTable::new(clone, nop, nop, nop)
        }

        let waker = unsafe { Waker::from_raw(RawWaker::new(std::ptr::null(), vtable())) };
        let mut contexte = Context::from_waker(&waker);
        let mut futur = Box::pin(futur);

        match futur.as_mut().poll(&mut contexte) {
            Poll::Ready(valeur) => valeur,
            Poll::Pending => panic!("ce futur ne devrait jamais attendre"),
        }
    }
}
