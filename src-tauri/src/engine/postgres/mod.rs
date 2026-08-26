//! Adaptateur PostgreSQL.
//!
//! Ce module ne couvre que **l'ouverture et le test** d'une connexion : l'introspection
//! vient en `06c`, la lecture de lignes en `06d`, le tunnel en `06e`. Les opérations
//! correspondantes du trait rendent donc une erreur explicite plutôt qu'un résultat vide —
//! un `Ok(vec![])` se confondrait avec « cette base n'a aucun schéma », et enverrait
//! l'écran sur une fausse piste.

mod connect;
mod error;
mod introspect;
pub(in crate::engine) mod rows;
mod types;

use std::time::Instant;

use tokio_postgres::Client;

use crate::config::ConnectionSettings;
use crate::engine::proxy::{EtatProxy, ProxyOuvert};
use crate::engine::{
    ConnectionProbe, EngineAdapter, EngineError, RowQuery, RowWindow, SchemaInfo, TableDetail,
    TableSummary,
};
use crate::secrets::Secret;

pub use connect::preparer;

/// Le `known_hosts` de l'utilisateur.
///
/// `HOME` plutôt qu'une bibliothèque de répertoires : c'est ce que lit `ssh` lui-même, donc
/// c'est le fichier que l'utilisateur a effectivement peuplé.
fn known_hosts_utilisateur() -> std::path::PathBuf {
    std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_default()
        .join(".ssh")
        .join("known_hosts")
}

pub struct PostgresAdapter {
    client: Client,
    /// Le proxy quand la variante en déclare un — SSH ou Cloud SQL.
    ///
    /// **Une seule sorte de champ pour les deux sortes de proxy**, voir `ProxyOuvert` : deux
    /// champs donneraient deux chemins à tenir cohérents ici, dans `etat_tunnel`, dans
    /// `port_local_tunnel` et dans `close`.
    ///
    /// **Détenu par l'adaptateur** pour que sa durée de vie soit celle de la connexion : un
    /// tunnel lâché aussitôt après l'ouverture fermerait son écouteur local, et la connexion
    /// PostgreSQL mourrait à la première requête — panne d'autant plus déroutante que
    /// l'ouverture, elle, aurait réussi.
    proxy: Option<ProxyOuvert>,
}

/// `Debug` **à la main**, et non dérivé.
///
/// Même raison que pour `Secret` en `05c` : le risque n'est pas d'écrire `{adaptateur:?}`
/// mais `{structure:?}` pour une structure qui en contient un. Un dérivé exposerait l'état
/// interne du client — dont sa configuration, qui porte le mot de passe. Rien d'utile n'y
/// serait de toute façon lisible.
impl std::fmt::Debug for PostgresAdapter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PostgresAdapter { … }")
    }
}

impl PostgresAdapter {
    /// Ouvre une connexion vers la base décrite par `variante`.
    pub async fn connect(
        variante: &ConnectionSettings,
        mot_de_passe: Option<&Secret>,
    ) -> Result<Self, EngineError> {
        Self::connect_via(variante, mot_de_passe, &known_hosts_utilisateur()).await
    }

    /// La même chose, avec le `known_hosts` en paramètre.
    ///
    /// Séparée pour que les tests n'aient pas à toucher le `~/.ssh/known_hosts` de la
    /// machine — ce qu'un test n'a pas le droit de faire.
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
        let config = connect::preparer(variante, mot_de_passe, redirection)?;

        match connect::ouvrir(
            &config,
            crate::engine::tls::Exigences::de(variante.ssl_mode),
            variante.ca_certificate.as_deref(),
        )
        .await
        {
            Ok(client) => Ok(Self { client, proxy }),
            // **Le point de `06e`, étendu à Cloud SQL par `06g`** : sans cette qualification,
            // un proxy tombé produit un « connection refused » sur `127.0.0.1`, qui envoie
            // chercher un problème de PostgreSQL. `A3` distingue les deux lignes ; l'erreur
            // doit les distinguer aussi.
            Err(erreur) => Err(match &proxy {
                Some(p) => p.qualifier(erreur).await,
                None => erreur,
            }),
        }
    }

    /// L'état du proxy, quand il y en a un. `None` pour une connexion directe.
    ///
    /// **Garde son nom** malgré `06g` : le renommer toucherait `engine/commands.rs`,
    /// `registry.rs`, la projection TypeScript et les tests front, pour un gain nul — le
    /// panneau de `A2` s'appelle littéralement « Proxy / tunnel ».
    pub fn etat_tunnel(&self) -> Option<EtatProxy> {
        self.proxy.as_ref().map(ProxyOuvert::etat)
    }

    /// Le port local du tunnel, que `A2` affiche sous « auto (63342) ».
    pub fn port_local_tunnel(&self) -> Option<u16> {
        self.proxy.as_ref().map(ProxyOuvert::port_local)
    }

    /// Ferme la connexion et **attend** que le port local du tunnel soit rendu.
    ///
    /// Consomme l'adaptateur : après cet appel il n'y a plus rien à interroger, et le laisser
    /// utilisable inviterait à requêter sur un client mort.
    ///
    /// **Pourquoi cette méthode plutôt que la seule destruction** : `SshTunnel::fermer` existe
    /// parce que `JoinHandle::abort` n'est pas synchrone (voir `06e`), et le `Drop` du tunnel
    /// n'est qu'un filet. Un test de connexion qui rendrait sans attendre laisserait le port
    /// lié quelques instants — invisible une fois, gênant après vingt essais.
    pub async fn close(self) {
        if let Some(proxy) = self.proxy {
            proxy.fermer().await;
        }
        // Le client est lâché ici : sa tâche d'entrées-sorties s'arrête d'elle-même quand plus
        // personne ne le détient (voir `connect::ouvrir`).
        drop(self.client);
    }

    /// La version du serveur, telle que `A2` l'affiche (« PostgreSQL 16.2 »).
    async fn version(&self) -> Result<String, EngineError> {
        let ligne = self
            .client
            .query_one("select version()", &[])
            .await
            .map_err(|erreur| error::traduire(&erreur))?;
        let complete: String = ligne
            .try_get(0)
            .map_err(|erreur| error::traduire(&erreur))?;
        Ok(abreger_version(&complete))
    }
}

/// « PostgreSQL 17.6 (Debian 17.6-1…) on aarch64… » → « PostgreSQL 17.6 ».
///
/// Fonction pure, donc testable sans base — ce qui compte, la forme exacte de la chaîne
/// variant avec la distribution et l'architecture. Le découpage se fait ici plutôt que
/// dans l'écran, pour que les sept moteurs rendent une version comparable.
fn abreger_version(complete: &str) -> String {
    complete
        .split_whitespace()
        .take(2)
        .collect::<Vec<_>>()
        .join(" ")
}

impl EngineAdapter for PostgresAdapter {
    async fn probe(&self) -> Result<ConnectionProbe, EngineError> {
        // La durée court jusqu'à une connexion **interrogeable** : l'aller-retour de version
        // est compris, parce que c'est ce que l'utilisateur perçoit. Mesurer le seul socket
        // afficherait un nombre plus flatteur et moins vrai.
        let depart = Instant::now();
        let server_version = self.version().await?;
        let latency_ms = u32::try_from(depart.elapsed().as_millis()).unwrap_or(u32::MAX);

        Ok(ConnectionProbe {
            latency_ms,
            server_version,
        })
    }

    async fn schemas(&self) -> Result<Vec<SchemaInfo>, EngineError> {
        introspect::schemas(&self.client).await
    }

    async fn objects(&self, schema: &str) -> Result<Vec<TableSummary>, EngineError> {
        introspect::objects(&self.client, schema).await
    }

    async fn table_detail(&self, schema: &str, table: &str) -> Result<TableDetail, EngineError> {
        introspect::table_detail(&self.client, schema, table).await
    }

    async fn rows(&self, query: &RowQuery) -> Result<RowWindow, EngineError> {
        // Les colonnes viennent de l'introspection : c'est ce qui permet de **refuser** un
        // nom de colonne inconnu au lieu de l'échapper, et de lire chaque valeur dans son
        // type naturel.
        let detail = introspect::table_detail(&self.client, &query.schema, &query.table).await?;
        rows::rows(&self.client, query, &detail.columns).await
    }

    async fn row_as_insert(
        &self,
        schema: &str,
        table: &str,
        values: &[crate::engine::Value],
    ) -> Result<String, EngineError> {
        // Les colonnes viennent du catalogue, comme pour `rows` : c'est ce qui garantit que
        // l'`INSERT` nomme les vraies colonnes, dans l'ordre où la fenêtre les a rendues.
        let detail = introspect::table_detail(&self.client, schema, table).await?;
        rows::insert_de(schema, table, &detail.columns, values)
    }

    async fn preview_updates(
        &self,
        plan: &crate::engine::UpdatePlan,
    ) -> Result<String, EngineError> {
        // **Aucun aller-retour vers la base.** La prévisualisation est du texte : la demander au
        // serveur serait payer une latence pour une chaîne que l'on sait composer, et la rendre
        // indisponible dès que la connexion tombe — au moment précis où l'on veut relire ce qu'on
        // s'apprêtait à écrire.
        rows::updates_de(plan)
    }

    async fn run_sql(
        &self,
        sql: &str,
        limite: crate::engine::RowLimit,
    ) -> Result<crate::engine::QueryResult, EngineError> {
        let ajoutee = rows::limite_a_ajouter(sql, limite);
        let execute = match ajoutee {
            Some(valeur) => rows::avec_limite(sql, valeur),
            None => sql.to_owned(),
        };

        // **`prepare` donne les colonnes et leurs types sans rien exécuter.** Deux raisons : une
        // requête qui rend zéro ligne doit quand même afficher ses en-têtes, et la catégorie de chaque
        // colonne décide de l'alignement et du glyphe — la déduire d'une valeur textuelle serait
        // deviner.
        let prepare = self
            .client
            .prepare(execute.as_str())
            .await
            .map_err(|e| error::traduire(&e))?;
        let colonnes: Vec<(String, crate::engine::TypeCategory)> = prepare
            .columns()
            .iter()
            .map(|colonne| {
                (
                    colonne.name().to_owned(),
                    types::categoriser_par_nom(colonne.type_().name()),
                )
            })
            .collect();

        let depart = Instant::now();
        // **Le protocole simple, et c'est structurel.** Le protocole étendu rend les valeurs au format
        // *binaire* : un `jsonb` y commence par un octet de version, un `uuid` fait seize octets
        // bruts, et `try_get::<String>` refuse de les lire — exactement le défaut de `06d`, où ces
        // types se lisaient `NULL`. La grille l'évite en transtypant dans le `select` qu'elle
        // construit ; ici le SQL est celui de l'utilisateur, et le réécrire trahirait la promesse que
        // ce qui s'affiche est ce qui s'exécute. Le protocole simple rend **tout en texte**, ce que
        // `psql` fait depuis toujours.
        let messages = self
            .client
            .simple_query(execute.as_str())
            .await
            .map_err(|e| error::traduire(&e))?;
        let duration_ms = depart.elapsed().as_millis() as u64;

        let valeurs = messages
            .iter()
            .filter_map(|message| match message {
                tokio_postgres::SimpleQueryMessage::Row(ligne) => Some(ligne),
                _ => None,
            })
            .map(|ligne| rows::valeurs_textuelles(ligne, &colonnes))
            .collect();

        Ok(crate::engine::QueryResult {
            columns: colonnes.into_iter().map(|(nom, _)| nom).collect(),
            rows: valeurs,
            sql: execute,
            duration_ms,
            applied_limit: ajoutee,
        })
    }

    async fn explain_sql(&self, sql: &str) -> Result<crate::engine::QueryPlan, EngineError> {
        // **`EXPLAIN` sans `ANALYZE`, et la limite n'a pas de sens ici** : un plan ne rend pas les
        // lignes de la requête, seulement sa forme d'exécution.
        // Le point-virgule final est **gardé** : `explain select 1;` est valide, et le retirer ne
        // changeait aucune mesure — contrairement à `avec_limite`, où `select 1; limit 500` ne serait
        // pas du SQL.
        let explique = format!("explain {}", sql.trim());

        let depart = Instant::now();
        // `simple_query` pour la même raison qu'en `12c` : le plan arrive en texte, et le protocole
        // simple évite tout transtypage.
        let messages = self
            .client
            .simple_query(explique.as_str())
            .await
            .map_err(|e| error::traduire(&e))?;
        let duration_ms = depart.elapsed().as_millis() as u64;

        let lines = messages
            .iter()
            .filter_map(|message| match message {
                tokio_postgres::SimpleQueryMessage::Row(ligne) => {
                    ligne.get(0).map(|texte| texte.to_owned())
                }
                _ => None,
            })
            .collect();

        Ok(crate::engine::QueryPlan {
            lines,
            sql: explique,
            duration_ms,
        })
    }

    async fn apply_updates(
        &self,
        plan: &crate::engine::UpdatePlan,
    ) -> Result<crate::engine::ApplyOutcome, EngineError> {
        let instructions = rows::instructions_de(plan)?;
        // Calculé **avant** d'écrire : le patch inverse part des valeurs attendues, celles que la
        // base contient encore à cet instant. Le produire après l'application demanderait de relire,
        // et une relecture peut déjà voir l'écriture d'un tiers.
        let inverse_sql = rows::texte_de(&rows::instructions_inverses(plan)?);

        // **La transaction est conduite à la main**, `Transaction` de `tokio_postgres` exigeant un
        // client mutable que l'adaptateur ne peut pas offrir derrière `&self`. Le risque de sortir
        // sans annuler est écarté par la forme : tout le travail est dans une fonction qui rend un
        // `Result`, et c'est l'appelant — ici — qui décide de valider ou d'annuler. Aucun chemin de
        // sortie ne contourne ce point.
        // **L'échappement des apostrophes est la seule protection du SQL littéral, alors il est
        // vérifié.** Sous `standard_conforming_strings = off`, un antislash échappe l'apostrophe et
        // défait le doublement : une valeur saisie pourrait alors sortir de sa chaîne. Le réglage est
        // à `on` depuis PostgreSQL 9.1, mais une écriture ne se fonde pas sur un « normalement ».
        let conforme: String = self
            .client
            .query_one("show standard_conforming_strings", &[])
            .await
            .map_err(|e| EngineError::local(format!("réglage de chaînes illisible : {e}")))?
            .get(0);
        if conforme != "on" {
            return Err(EngineError::local(
                "cette connexion a `standard_conforming_strings` à `off` : DoraBase refuse d'écrire, \
                 l'échappement des valeurs n'y est pas fiable."
                    .to_owned(),
            ));
        }

        self.client
            .batch_execute("BEGIN")
            .await
            .map_err(|e| EngineError::local(format!("la transaction n'a pas pu s'ouvrir : {e}")))?;

        let issue = self.executer(&instructions).await;

        let applied = match issue {
            Ok(applied) => applied,
            Err(erreur) => {
                if let Err(annulation) = self.client.batch_execute("ROLLBACK").await {
                    // Le dire : une transaction restée ouverte bloque des verrous côté serveur, et
                    // l'utilisateur doit savoir que la connexion est à rouvrir.
                    log::error!("ROLLBACK impossible après un échec d'écriture : {annulation}");
                    return Err(EngineError::local(format!(
                        "{erreur} — et la transaction n'a pas pu être annulée : rouvrez la connexion."
                    )));
                }
                return Err(erreur);
            }
        };

        self.client.batch_execute("COMMIT").await.map_err(|e| {
            EngineError::local(format!("la transaction n'a pas pu être validée : {e}"))
        })?;

        Ok(crate::engine::ApplyOutcome {
            applied,
            inverse_sql,
        })
    }
}

impl PostgresAdapter {
    /// Exécute les instructions d'une application, dans une transaction déjà ouverte.
    ///
    /// **Séparée de `apply_updates` exprès** : elle n'a le droit ni de valider ni d'annuler, ce qui
    /// laisse un seul endroit où cette décision se prend. Un `return` ajouté ici plus tard ne pourra
    /// pas sauter par-dessus l'annulation.
    async fn executer(&self, instructions: &[rows::Instruction]) -> Result<u64, EngineError> {
        let mut applied = 0u64;
        for instruction in instructions {
            // **Le texte est exécuté tel qu'il a été montré.** Voir `Instruction` pour pourquoi le
            // chemin paramétré a été abandonné : le pilote type les paramètres depuis la colonne, et
            // un paramètre non typé n'est pas transmissible au format binaire.
            //
            // `query` et non `execute` : le `RETURNING 1` de l'instruction rend une ligne par ligne
            // touchée, ce qui donne le compte sans second aller-retour.
            let touchees = self
                .client
                .query(instruction.sql.as_str(), &[])
                .await
                .map_err(|e| {
                    // `{e}` seul donne « db error » : le détail est dans la source, et sans lui on
                    // débogue à l'aveugle. Vu en écrivant ces tests.
                    let detail = e
                        .as_db_error()
                        .map(|db| db.message().to_owned())
                        .unwrap_or_else(|| e.to_string());
                    EngineError::local(format!("l'écriture a été refusée : {detail}"))
                })?
                .len() as u64;

            if touchees == 0 {
                return Err(EngineError::local(format!(
                    "la ligne a changé depuis la lecture : « {} » n'a plus la valeur attendue. \
                     Rien n'a été écrit.",
                    instruction_colonne(&instruction.sql)
                )));
            }
            applied += touchees;
        }
        Ok(applied)
    }
}

/// Le nom de colonne lu dans une instruction, pour nommer la ligne en conflit.
///
/// **Extrait du SQL plutôt que passé à côté** : l'instruction est la seule chose que la boucle
/// possède, et lui adjoindre le nom demanderait de le porter dans `Instruction` pour un message
/// d'erreur. Le format est produit juste au-dessus, il n'y a rien à deviner.
fn instruction_colonne(sql: &str) -> String {
    sql.split_once(" SET ")
        .and_then(|(_, reste)| reste.split_once(" = "))
        .map(|(colonne, _)| colonne.trim().trim_matches('"').to_owned())
        .unwrap_or_else(|| "cette colonne".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{ConnectionSettings, Proxy, ProxyCloudSql, ProxySsh, SslMode, Tunnel};
    use crate::secrets::Secret;

    #[test]
    fn la_version_est_abregee_au_moteur_et_au_numero() {
        assert_eq!(
            abreger_version(
                "PostgreSQL 17.6 (Debian 17.6-1.pgdg13+1) on aarch64-unknown-linux-gnu, compiled by gcc"
            ),
            "PostgreSQL 17.6"
        );
        assert_eq!(
            abreger_version("PostgreSQL 16.2 on x86_64-pc-linux-gnu"),
            "PostgreSQL 16.2"
        );
    }

    #[test]
    fn une_version_deja_courte_traverse_sans_dommage() {
        assert_eq!(abreger_version("PostgreSQL 17.6"), "PostgreSQL 17.6");
    }

    /// Que lister un schéma ne fasse **pas** une requête par objet.
    ///
    /// **Vérification structurelle, et non mesurée à l'exécution.** Une première version
    /// comptait les requêtes via `pg_stat_database` : elle passait, puis s'est mise à
    /// échouer dès que d'autres tests de base ont été ajoutés. Cause : ces compteurs sont à
    /// l'échelle de la **base**, donc pollués par les tests concurrents. Le test mesurait
    /// le bruit autant que le sujet.
    ///
    /// Ce qui est vérifié à la place : la requête fait le travail par objet **côté
    /// serveur**, en sous-requêtes, et `objects` n'appelle `query` qu'une fois — visible
    /// dans la fonction, qui ne contient aucune boucle d'appel.
    #[test]
    fn lister_un_schema_fait_le_travail_par_objet_cote_serveur() {
        let requete = super::introspect::requete_objets_pour_test();

        // Le compte de colonnes et la clé primaire sont des sous-requêtes corrélées, donc
        // résolues en un seul aller-retour. S'ils passaient par des appels séparés, ces
        // fragments disparaîtraient de la requête.
        assert!(
            requete.contains("from pg_attribute a"),
            "le compte de colonnes doit être une sous-requête"
        );
        assert!(
            requete.contains("from pg_constraint pk"),
            "la clé primaire doit être une sous-requête"
        );
        assert!(
            requete.contains("pg_total_relation_size"),
            "la taille doit être calculée côté serveur"
        );
    }

    /// Une variante minimale, sans tunnel — l'appelant lui en assigne un au besoin. Ne
    /// requiert ni bastion ni base réelle : les tests qui l'emploient n'atteignent jamais
    /// le réseau, la connexion étant refusée avant.
    fn variante_sans_tunnel() -> ConnectionSettings {
        ConnectionSettings {
            host: "db.internal".into(),
            port: 5432,
            default_database: "analytics".into(),
            username: "dora_ro".into(),
            password: None,
            ssl_mode: SslMode::Require,
            ca_certificate: None,
            auth_database: None,
            read_only: true,
            reconnect_on_startup: false,
            tunnel: None,
        }
    }

    /// La variante d'une vraie instance Cloud SQL, si l'environnement en décrit une.
    ///
    /// **Conditionné par variables d'environnement, comme les tests SSH de `06e`** le sont au
    /// serveur Docker : une instance Cloud SQL ne peut pas être une condition de la CI, et un
    /// test qui échouerait faute de compte GCP apprendrait seulement qu'on n'en a pas.
    ///
    /// **Hors de `mod tests_db`, délibérément.** Ce module exige `DORABASE_TEST_PG`, donc une
    /// base PostgreSQL locale, dont ce chemin n'a aucun besoin — la cible est l'instance
    /// Cloud SQL elle-même. L'y mettre l'aurait rendu inatteignable sans un service qui n'a
    /// rien à voir.
    fn variante_cloud_sql() -> Option<(ConnectionSettings, Option<Secret>)> {
        let instance = std::env::var("DORABASE_TEST_CLOUDSQL_INSTANCE").ok()?;
        let base = std::env::var("DORABASE_TEST_CLOUDSQL_DATABASE").ok()?;
        let utilisateur = std::env::var("DORABASE_TEST_CLOUDSQL_USER").ok()?;
        let mot_de_passe = std::env::var("DORABASE_TEST_CLOUDSQL_PASSWORD").ok();

        let mut variante = variante_sans_tunnel();
        variante.default_database = base;
        variante.username = utilisateur;
        // L'hôte et le port de la variante ne servent pas : le proxy tient la cible de
        // l'instance. Les laisser à leur valeur de fixture rend visible qu'ils sont ignorés —
        // les vider suggérerait qu'ils comptent et qu'on a oublié de les remplir.
        variante.tunnel = Some(Tunnel {
            local_port: None,
            proxy: Proxy::CloudSql(ProxyCloudSql {
                instance_connection_name: instance,
            }),
        });

        Some((variante, mot_de_passe.map(Secret::new)))
    }

    /// Le chemin heureux de `06g`, de bout en bout, contre une vraie instance.
    ///
    /// S'ignore de lui-même sans les variables d'environnement — et le **dit**, plutôt que de
    /// passer en silence : un critère de spec non observé doit se voir.
    #[tokio::test]
    async fn une_instance_cloud_sql_est_joignable_par_le_proxy() {
        let Some((variante, secret)) = variante_cloud_sql() else {
            eprintln!(
                "ignoré : poser DORABASE_TEST_CLOUDSQL_INSTANCE, _DATABASE, _USER \
                 (et _PASSWORD / _CREDENTIALS) pour exercer ce chemin"
            );
            return;
        };

        let adaptateur = PostgresAdapter::connect_via(
            &variante,
            secret.as_ref(),
            std::path::Path::new("/dev/null"),
        )
        .await
        .expect("la connexion doit passer par le proxy Cloud SQL");

        assert!(adaptateur.port_local_tunnel().is_some());
        assert_eq!(adaptateur.etat_tunnel(), Some(EtatProxy::Vivant));
        // **Une requête réelle, et non seulement l'ouverture** : un proxy peut accepter la
        // connexion TCP et ne rien relayer, ce qui ne se voit qu'en interrogeant la base.
        let sonde = adaptateur.probe().await.expect("sonde");
        assert!(!sonde.server_version.is_empty());

        adaptateur.close().await;
    }

    /// Le moteur **n'oppose plus un refus de principe** à un proxy Cloud SQL.
    ///
    /// **Ce que ce test peut prouver sans compte GCP, et ce qu'il ne peut pas.** Sans binaire
    /// `cloud-sql-proxy` ni identifiants, l'ouverture échoue de toute façon — mais elle échoue
    /// *sur le proxy*, pas sur un refus de principe. C'est précisément la différence que `06g`
    /// apporte, et elle est vérifiable ici. Le chemin heureux, lui, exige une vraie instance
    /// et vit dans `une_instance_cloud_sql_est_joignable_par_le_proxy`.
    ///
    /// L'assertion porte sur l'**absence** du message de refus de `05d` plutôt que sur la
    /// présence d'un message précis : ce qui remonte dépend de la machine — binaire absent ici,
    /// identifiants refusés ailleurs — et exiger l'un des deux rendrait le test dépendant de
    /// l'environnement au lieu du comportement.
    #[tokio::test]
    async fn un_proxy_cloud_sql_n_est_plus_refuse_par_le_moteur() {
        let mut variante = variante_sans_tunnel();
        variante.tunnel = Some(Tunnel {
            local_port: None,
            proxy: Proxy::CloudSql(ProxyCloudSql {
                instance_connection_name: "p:r:i".into(),
            }),
        });

        let erreur =
            PostgresAdapter::connect_via(&variante, None, std::path::Path::new("/dev/null"))
                .await
                .expect_err("sans binaire ni identifiants, l'ouverture échoue");
        assert!(
            !erreur.message.contains("ne sait pas encore"),
            "le refus de principe de 05d doit avoir disparu : {erreur}"
        );
    }

    /// Une variante à tunnel SSH **n'est pas** refusée par l'aiguillage, et échoue plus loin.
    ///
    /// **Le contrôle symétrique du test précédent.** Sans lui, un aiguillage qui refuserait
    /// désormais SSH — l'inverse exact de l'erreur de `05d` — passerait inaperçu : aucun test
    /// non gaté ne prend ce chemin, ceux de `06e` exigeant un vrai bastion.
    #[tokio::test]
    async fn une_variante_a_tunnel_ssh_passe_l_aiguillage() {
        let mut variante = variante_sans_tunnel();
        variante.tunnel = Some(Tunnel {
            local_port: None,
            proxy: Proxy::Ssh(ProxySsh {
                bastion_host: "bastion.invalide".into(),
                bastion_port: 22,
                username: "dora".into(),
                private_key_path: "/nulle-part/id_ed25519".into(),
            }),
        });

        let erreur =
            PostgresAdapter::connect_via(&variante, None, std::path::Path::new("/dev/null"))
                .await
                .expect_err("une clé absente doit faire échouer l'ouverture");
        // L'échec vient du **tunnel** — la clé privée est introuvable —, donc l'aiguillage a
        // bien tenté de l'ouvrir au lieu de le refuser.
        assert!(
            !erreur.message.contains("ne sait pas encore"),
            "SSH ne doit pas être refusé par l'aiguillage : {erreur}"
        );
        assert!(
            erreur.message.contains("id_ed25519"),
            "l'échec doit nommer la clé, donc venir du tunnel : {erreur}"
        );
    }
}

/// Tests exigeant une vraie base. Lancés par le job Linux de la CI, et en local contre le
/// conteneur dédié :
///
/// ```text
/// docker run -d --name dorabase-test-pg -e POSTGRES_PASSWORD=dorabase-test \
///   -e POSTGRES_USER=dorabase -e POSTGRES_DB=dorabase_test -p 55432:5432 postgres:17
///
/// DORABASE_TEST_PG=postgres://dorabase:dorabase-test@localhost:55432/dorabase_test \
///   cargo test --features db-tests
/// ```
#[cfg(all(test, feature = "db-tests"))]
mod tests_db {
    use super::*;
    use crate::config::SslMode;

    /// L'adresse de la base de test, **jamais codée en dur** : le port diffère entre le
    /// conteneur local (55432, choisi pour ne croiser aucun autre projet de la machine) et
    /// le service de la CI (5432).
    fn variante_de_test() -> (ConnectionSettings, Option<Secret>) {
        let url = std::env::var("DORABASE_TEST_PG")
            .expect("DORABASE_TEST_PG doit être défini pour les tests de base");
        let analysee: tokio_postgres::Config = url
            .parse()
            .expect("DORABASE_TEST_PG doit être une URL PostgreSQL valide");

        let hote = analysee
            .get_hosts()
            .iter()
            .find_map(|h| match h {
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

    async fn adaptateur() -> PostgresAdapter {
        let (variante, secret) = variante_de_test();
        PostgresAdapter::connect(&variante, secret.as_ref())
            .await
            .expect("la base de test doit répondre")
    }

    #[tokio::test]
    async fn une_connexion_s_ouvre_et_rend_la_version() {
        let sonde = adaptateur().await.probe().await.expect("la base répond");

        assert!(
            sonde.server_version.starts_with("PostgreSQL"),
            "version inattendue : {}",
            sonde.server_version
        );
        assert!(
            sonde.latency_ms < 10_000,
            "latence invraisemblable : {} ms",
            sonde.latency_ms
        );
    }

    /// **Le test qui compte** : le précédent passerait sur une chaîne codée en dur.
    #[tokio::test]
    async fn la_version_annoncee_est_celle_du_serveur() {
        let adaptateur = adaptateur().await;

        // Contrôle croisé, par une requête que l'adaptateur n'a pas façonnée.
        let brute: String = adaptateur
            .client
            .query_one("select version()", &[])
            .await
            .unwrap()
            .get(0);

        let sonde = adaptateur.probe().await.unwrap();
        assert!(
            brute.starts_with(&sonde.server_version),
            "l'abrégé « {} » doit être le début de « {brute} »",
            sonde.server_version
        );
    }

    #[tokio::test]
    async fn un_mot_de_passe_refuse_porte_le_sqlstate_28p01() {
        let (variante, _) = variante_de_test();
        let erreur =
            PostgresAdapter::connect(&variante, Some(&Secret::new("mauvais-mot-de-passe")))
                .await
                .expect_err("un mot de passe faux doit être refusé");

        assert_eq!(erreur.code.as_deref(), Some("28P01"), "{erreur}");
    }

    #[tokio::test]
    async fn une_base_inconnue_porte_le_sqlstate_3d000() {
        let (mut variante, secret) = variante_de_test();
        variante.default_database = "base_qui_n_existe_pas".into();

        let erreur = PostgresAdapter::connect(&variante, secret.as_ref())
            .await
            .expect_err("une base inconnue doit être refusée");

        assert_eq!(erreur.code.as_deref(), Some("3D000"), "{erreur}");
    }

    #[tokio::test]
    async fn un_hote_injoignable_est_une_erreur_locale_sans_sqlstate() {
        let (mut variante, secret) = variante_de_test();
        // Port 9, « discard » réservé par l'IANA : jamais un PostgreSQL.
        variante.port = 9;

        let erreur = PostgresAdapter::connect(&variante, secret.as_ref())
            .await
            .expect_err("un port fermé doit échouer");

        assert!(
            erreur.code.is_none(),
            "un échec réseau n'a pas de SQLSTATE, or : {:?}",
            erreur.code
        );
    }

    /// **La vérification qui vaut** sur les secrets : l'échec est réel, et une chaîne de
    /// connexion porte le mot de passe. Le test équivalent de `06a` était noté faible
    /// parce qu'il construisait lui-même son message.
    #[tokio::test]
    async fn aucun_message_d_erreur_ne_contient_le_mot_de_passe() {
        const SENTINELLE: &str = "SENTINELLE-MOTDEPASSE-A-NE-JAMAIS-DIVULGUER";

        let (variante, _) = variante_de_test();
        let erreur = PostgresAdapter::connect(&variante, Some(&Secret::new(SENTINELLE)))
            .await
            .expect_err("la sentinelle est un mauvais mot de passe");

        // Contrôle positif : sans lui, l'absence de sentinelle ne prouverait rien — l'échec
        // pourrait venir d'autre chose que de l'authentification.
        assert_eq!(
            erreur.code.as_deref(),
            Some("28P01"),
            "ce test suppose un refus d'authentification, or : {erreur}"
        );

        assert!(
            !format!("{erreur}").contains(SENTINELLE),
            "fuite du mot de passe par Display"
        );
        assert!(
            !format!("{erreur:?}").contains(SENTINELLE),
            "fuite du mot de passe par Debug"
        );
    }

    /// Ce test était un **fil-piège** : il tombait dès qu'une opération était implémentée,
    /// forçant sa mise à jour au lieu de laisser traîner un message d'attente périmé. Il a
    /// joué son rôle trois fois — `schemas`, `table_detail`, puis `rows`. Les quatre
    /// opérations du contrat étant désormais en place, il vérifie l'inverse : qu'aucune ne
    /// renvoie plus à une spec à venir.
    #[tokio::test]
    async fn toutes_les_operations_du_contrat_repondent() {
        let adaptateur = adaptateur().await;

        assert!(adaptateur.probe().await.is_ok(), "probe");
        assert!(adaptateur.schemas().await.is_ok(), "schemas");
        assert!(adaptateur.objects("introspection").await.is_ok(), "objects");
        assert!(
            adaptateur
                .table_detail("introspection", "orders")
                .await
                .is_ok(),
            "table_detail"
        );
        assert!(
            adaptateur
                .rows(&RowQuery::new(
                    "introspection",
                    "petite",
                    crate::engine::RowLimit::OneHundred
                ))
                .await
                .is_ok(),
            "rows"
        );
    }

    // --- Tunnel SSH (06e) ---

    /// Le décor SSH n'est monté que par `scripts/bastion-test.sh`. Ces tests sont **sautés**
    /// quand il manque, plutôt qu'en échec : le job de CI qui n'a pas de bastion n'a pas à
    /// rougir. Le saut est annoncé, pour qu'un décor oublié se remarque.
    fn variante_a_tunnel() -> Option<(ConnectionSettings, Option<Secret>, std::path::PathBuf)> {
        let hote = std::env::var("DORABASE_TEST_SSH_HOST").ok()?;
        let (mut variante, secret) = variante_de_test();

        // L'hôte et le port de la **base**, vus depuis le bastion : le nom du conteneur sur le
        // réseau partagé, pas le port publié sur la machine. C'est justement ce qu'un tunnel
        // rend joignable et qui ne l'est pas en direct.
        variante.host = std::env::var("DORABASE_TEST_SSH_TARGET_HOST").ok()?;
        variante.port = std::env::var("DORABASE_TEST_SSH_TARGET_PORT")
            .ok()?
            .parse()
            .ok()?;
        variante.tunnel = Some(crate::config::Tunnel {
            local_port: None,
            proxy: crate::config::Proxy::Ssh(crate::config::ProxySsh {
                bastion_host: hote,
                bastion_port: std::env::var("DORABASE_TEST_SSH_PORT").ok()?.parse().ok()?,
                username: std::env::var("DORABASE_TEST_SSH_USER").ok()?,
                private_key_path: std::env::var("DORABASE_TEST_SSH_KEY").ok()?,
            }),
        });

        let known_hosts =
            std::path::PathBuf::from(std::env::var("DORABASE_TEST_SSH_KNOWN_HOSTS").ok()?);
        Some((variante, secret, known_hosts))
    }

    /// **Le test qui valide `06e`.** Une vraie connexion PostgreSQL à travers un vrai bastion,
    /// vers une base **injoignable en direct**.
    ///
    /// Ce dernier point est ce qui donne sa valeur au test : la cible est le nom du conteneur
    /// PostgreSQL sur le réseau Docker, que la machine hôte ne résout pas. Si le tunnel
    /// n'acheminait rien, aucun repli ne pourrait sauver la connexion.
    #[tokio::test]
    async fn une_base_injoignable_en_direct_devient_accessible_par_le_tunnel() {
        let Some((variante, secret, known_hosts)) = variante_a_tunnel() else {
            eprintln!("décor SSH absent : test sauté (voir scripts/bastion-test.sh)");
            return;
        };

        // Contrôle **positif** de la prémisse : sans tunnel, cette base est inaccessible. Sans
        // cette vérification, le test passerait aussi si la cible était joignable en direct —
        // et ne prouverait alors rien du tunnel.
        let sans_tunnel = {
            let mut directe = variante.clone();
            directe.tunnel = None;
            PostgresAdapter::connect(&directe, secret.as_ref()).await
        };
        assert!(
            sans_tunnel.is_err(),
            "la prémisse est cassée : la base est joignable sans tunnel, ce test ne prouve rien"
        );

        let adaptateur = PostgresAdapter::connect_via(&variante, secret.as_ref(), &known_hosts)
            .await
            .expect("la connexion doit passer par le tunnel");

        // Et la connexion doit **servir** : une sonde, puis une vraie introspection.
        let sonde = adaptateur.probe().await.expect("sonde");
        assert!(sonde.server_version.starts_with("PostgreSQL"), "{sonde:?}");

        let objets = adaptateur
            .objects("introspection")
            .await
            .expect("introspection à travers le tunnel");
        assert_eq!(objets.len(), 7, "6 tables et 1 vue");

        // Le port local doit être **connu** : `A2` l'affiche sous « auto (63342) ».
        assert!(adaptateur.port_local_tunnel().is_some());
        assert_eq!(
            adaptateur.etat_tunnel(),
            Some(crate::engine::proxy::EtatProxy::Vivant)
        );
    }

    /// Qu'une lecture paginée passe aussi le tunnel — un canal par connexion, donc plusieurs
    /// requêtes successives sur la même session SSH.
    #[tokio::test]
    async fn une_lecture_paginee_traverse_le_tunnel() {
        let Some((variante, secret, known_hosts)) = variante_a_tunnel() else {
            eprintln!("décor SSH absent : test sauté");
            return;
        };

        let adaptateur = PostgresAdapter::connect_via(&variante, secret.as_ref(), &known_hosts)
            .await
            .expect("connexion");

        let fenetre = adaptateur
            .rows(&RowQuery::new(
                "introspection",
                "grande",
                crate::engine::RowLimit::FiveHundred,
            ))
            .await
            .expect("lecture à travers le tunnel");
        assert_eq!(fenetre.rows.len(), 500);
    }

    /// Une connexion directe ne doit **pas** rapporter d'état de tunnel : `A2` afficherait
    /// alors un panneau « Proxy / tunnel » actif pour une base qui n'en a pas.
    #[tokio::test]
    async fn une_connexion_directe_ne_rapporte_aucun_tunnel() {
        let adaptateur = adaptateur().await;
        assert_eq!(adaptateur.etat_tunnel(), None);
        assert_eq!(adaptateur.port_local_tunnel(), None);
    }

    // --- Lecture paginée (06d) ---

    async fn fenetre(table: &str, limite: crate::engine::RowLimit) -> crate::engine::RowWindow {
        adaptateur()
            .await
            .rows(&RowQuery::new("introspection", table, limite))
            .await
            .unwrap_or_else(|e| panic!("lecture de {table} : {e}"))
    }

    #[tokio::test]
    async fn une_fenetre_rend_exactement_la_limite_demandee() {
        let f = fenetre("grande", crate::engine::RowLimit::FiveHundred).await;
        assert_eq!(f.rows.len(), 500, "la table porte cent mille lignes");
    }

    #[tokio::test]
    async fn le_sql_rendu_est_celui_reellement_execute() {
        let f = fenetre("petite", crate::engine::RowLimit::OneHundred).await;
        // `A5` le montre derrière « Voir le SQL » : montrer une requête différente de celle
        // qui tourne serait un piège pour qui débogue.
        assert!(f.sql.contains("limit 100"), "{}", f.sql);
        assert!(f.sql.contains("offset 0"), "{}", f.sql);
        assert!(f.sql.contains("introspection"), "{}", f.sql);
    }

    /// **Le critère central de `06d`.**
    ///
    /// La contrainte transverse exige que la récupération soit paginée, *pas seulement le
    /// rendu* : ramener cent mille lignes puis n'en garder que cinq cents respecterait la
    /// lettre et manquerait tout. Lire la même fenêtre dans une table cent fois plus grande
    /// doit donc coûter le même ordre de grandeur.
    #[tokio::test]
    async fn lire_une_fenetre_ne_coute_pas_la_taille_de_la_table() {
        let adaptateur = adaptateur().await;

        async fn lire(adaptateur: &PostgresAdapter, table: &str) -> crate::engine::RowWindow {
            let requete =
                RowQuery::new("introspection", table, crate::engine::RowLimit::FiveHundred);
            adaptateur.rows(&requete).await.unwrap()
        }

        // Deux lectures à blanc d'abord : le premier accès paie le plan et le cache.
        let _ = lire(&adaptateur, "petite").await;
        let _ = lire(&adaptateur, "grande").await;

        let petite = lire(&adaptateur, "petite").await;
        let grande = lire(&adaptateur, "grande").await;

        // Les deux fenêtres font la même taille : c'est déjà la preuve qu'aucune des deux ne
        // ramène toute sa table.
        assert_eq!(petite.rows.len(), 500);
        assert_eq!(grande.rows.len(), 500);

        // Et le coût ne suit pas la taille. Borne large — la mesure est bruitée sur une
        // machine partagée — mais un facteur cent en taille produirait bien davantage si la
        // récupération n'était pas paginée.
        let plancher = petite.duration_ms.max(1);
        assert!(
            grande.duration_ms <= plancher * 20 + 50,
            "cent fois plus de lignes a coûté {} ms contre {} ms : la récupération est-elle paginée ?",
            grande.duration_ms,
            petite.duration_ms
        );
    }

    /// **Un `numeric` se lit, et ne devient pas `NULL`.**
    ///
    /// Défaut trouvé le 10 août 2026 : `tokio-postgres` ne lit un `numeric` ni en `i64` ni en
    /// `f64`, donc la lecture retombait sur le repli texte — que le `select` ne transtypait pas
    /// pour une colonne de catégorie `Number`. Une colonne de montants s'affichait **vide**.
    #[tokio::test]
    async fn un_numeric_est_lu_exactement_et_non_comme_null() {
        let adaptateur = adaptateur().await;
        let mut requete = RowQuery::new(
            "introspection",
            "montants",
            crate::engine::RowLimit::OneHundred,
        );
        requete.sort = vec![];
        let f = adaptateur.rows(&requete).await.expect("lecture");
        let ligne = f.rows.first().expect("la table est peuplée");

        // La valeur **exacte**, en texte : un `f64` perdrait de la précision, et c'est
        // inacceptable pour de l'argent — le premier usage de `numeric`.
        assert_eq!(
            ligne[1],
            crate::engine::Value::Decimal {
                value: "12345678.91".into()
            },
            "montant lu comme {:?}",
            ligne[1]
        );
    }

    /// **Régression `06d`, trouvée le 9 août 2026.**
    ///
    /// Tout type non lu nativement — horodatage, JSON, UUID, énumération — arrivait en `Null`,
    /// parce que le repli « lire en texte » supposait un transtypage que le `select` ne faisait
    /// pas. `A5` aurait affiché `NULL` dans chaque colonne de date de chaque table.
    ///
    /// Les tests de `06d` ne l'ont pas vu : leurs tables de mesure ne portent que des entiers et
    /// du texte, deux catégories qui se lisent nativement.
    #[tokio::test]
    async fn les_horodatages_et_le_json_ne_sont_pas_lus_comme_null() {
        let adaptateur = adaptateur().await;
        // **La ligne est désignée par son contenu, pas par son rang.** Elle l'était par « la
        // dernière insérée » : les tests d'écriture de `11d`, qui insèrent leurs propres lignes et
        // tournent en parallèle, en créaient de plus récentes — et ce test échouait par
        // intermittence, le pire mode d'échec. Un filtre sur `metadata` désigne exactement ce que le
        // test cherche. L'`uuid` du décor est littéral dans `schema-test-pg.sql` : c'est une identité,
        // là où « la dernière » n'en est pas une.
        let mut requete = RowQuery::new(
            "introspection",
            "orders",
            crate::engine::RowLimit::OneHundred,
        );
        requete.filters = vec![crate::engine::Filter {
            column: "ref".into(),
            operator: crate::engine::FilterOperator::Eq,
            value: Some("11111111-2222-3333-4444-555555555555".into()),
        }];
        let f = adaptateur.rows(&requete).await.expect("lecture");
        let ligne = f.rows.first().expect("orders est peuplée");

        // `orders` : id, user_id, status, total_cents, metadata, ref, paid, blob, created_at.
        // `created_at` est `not null default now()` — la voir à `Null` est donc impossible.
        assert!(
            matches!(ligne[8], crate::engine::Value::Timestamp { .. }),
            "created_at lu comme {:?}",
            ligne[8]
        );
        // `jsonb`, `uuid` : les deux types que `typcategory = 'U'` confond, et que le repli en
        // texte doit rendre lisibles.
        assert!(
            matches!(ligne[4], crate::engine::Value::Text { .. }),
            "metadata (jsonb) lu comme {:?}",
            ligne[4]
        );
        assert!(
            matches!(ligne[5], crate::engine::Value::Text { .. }),
            "ref (uuid) lu comme {:?}",
            ligne[5]
        );
    }

    // --- INSERT copiable (10f) ---

    /// **Le seul critère qui compte** : le SQL produit doit s'exécuter.
    ///
    /// Vérifier qu'il « ressemble » à un `INSERT` laisserait passer une apostrophe non doublée,
    /// un `'NULL'` en chaîne ou un identifiant non cité — trois erreurs qui ne se voient qu'à
    /// l'exécution.
    ///
    /// La ligne est réinsérée **telle quelle**, clé primaire comprise : c'est ce que copie
    /// l'utilisateur, et c'est donc ce qu'il faut exercer. D'où la transaction annulée, précédée
    /// d'un `delete` de la ligne d'origine — sans quoi la clé dupliquerait. Rien n'est laissé
    /// derrière : le `rollback` défait les deux.
    #[tokio::test]
    async fn l_insert_produit_s_execute_reellement() {
        let adaptateur = adaptateur().await;
        let fenetre = fenetre("orders", crate::engine::RowLimit::OneHundred).await;
        let ligne = fenetre
            .rows
            .first()
            .expect("le schéma de test peuple orders");

        let crate::engine::Value::Int { value: id } = ligne[0] else {
            panic!("la première colonne d'orders est son id")
        };

        let sql = adaptateur
            .row_as_insert("introspection", "orders", ligne)
            .await
            .expect("génération");

        let script =
            format!("begin;\ndelete from introspection.orders where id = {id};\n{sql}\nrollback;");

        adaptateur
            .client
            .batch_execute(&script)
            .await
            .unwrap_or_else(|e| panic!("l'INSERT produit ne s'exécute pas : {e:?}\n{sql}"));

        // Contrôle : la ligne d'origine est toujours là, le `rollback` ayant tout défait.
        let restee = adaptateur
            .client
            .query_one(
                "select count(*) from introspection.orders where id = $1",
                &[&id],
            )
            .await
            .expect("relecture");
        assert_eq!(
            restee.get::<_, i64>(0),
            1,
            "le rollback n'a pas défait le delete"
        );
    }

    /// Le SQL prévisualisé de `11c` **s'exécute tel quel**, et modifie la bonne ligne.
    ///
    /// **La leçon de `10f`** : un SQL qui *paraît* correct peut être refusé par la base. L'`INSERT`
    /// reconstruit passait tous les tests d'inspection et échouait sur une contrainte `not null`.
    /// Ici, le panneau annonce « SQL qui sera exécuté » — si cette chaîne ne tourne pas, la promesse
    /// est fausse au moment le plus coûteux.
    ///
    /// **C'est le texte montré qui est exécuté, sans retouche** : depuis `11d`, la même chaîne sert
    /// à l'affichage et à l'écriture, `BEGIN`/`COMMIT` compris. La transaction est jouée puis
    /// annulée, sur une ligne créée pour ce test.
    #[tokio::test]
    async fn le_sql_previsualise_s_execute_et_touche_la_bonne_ligne() {
        let adaptateur = adaptateur().await;
        let id = ligne_a_moi(&adaptateur, "prévu").await;

        let plan = crate::engine::UpdatePlan {
            schema: "introspection".into(),
            table: "orders".into(),
            key_column: "id".into(),
            changes: vec![crate::engine::PendingUpdate {
                key: id.to_string(),
                column: "status".into(),
                // Une apostrophe dans la valeur : le cas qui casse un SQL mal échappé.
                value: Some("l'attente".into()),
                expected: Some("prévu".into()),
            }],
        };

        let sql = adaptateur
            .preview_updates(&plan)
            .await
            .expect("prévisualisation");

        // Le texte est joué **tel qu'il est montré**, y compris ses délimiteurs de transaction.
        adaptateur
            .client
            .batch_execute(&sql)
            .await
            .unwrap_or_else(|e| panic!("le SQL prévisualisé ne s'exécute pas : {e:?}\n{sql}"));

        // **Et il touche la bonne ligne.** Un `UPDATE` qui s'exécute sans erreur peut n'avoir modifié
        // aucune ligne — ou toutes.
        assert_eq!(
            lire(&adaptateur, id, "status").await.as_deref(),
            Some("l'attente")
        );
        let autres: i64 = adaptateur
            .client
            .query_one(
                "select count(*) from introspection.orders where status = 'l''attente' and id <> $1",
                &[&id],
            )
            .await
            .expect("comptage")
            .get(0);
        assert_eq!(autres, 0, "aucune autre ligne ne doit avoir été touchée");

        retirer_ligne(&adaptateur, id).await;
    }

    /// Un plan d'application sur `orders`, prêt à être joué contre la base de test.
    fn plan_de(
        id: i64,
        colonne: &str,
        valeur: Option<&str>,
        attendu: Option<&str>,
    ) -> crate::engine::UpdatePlan {
        crate::engine::UpdatePlan {
            schema: "introspection".into(),
            table: "orders".into(),
            key_column: "id".into(),
            changes: vec![crate::engine::PendingUpdate {
                key: id.to_string(),
                column: colonne.into(),
                value: valeur.map(str::to_owned),
                expected: attendu.map(str::to_owned),
            }],
        }
    }

    /// Lit une colonne texte d'`orders`.
    async fn lire(adaptateur: &PostgresAdapter, id: i64, colonne: &str) -> Option<String> {
        adaptateur
            .client
            .query_one(
                &format!("select {colonne}::text from introspection.orders where id = $1"),
                &[&id],
            )
            .await
            .expect("relecture")
            .get(0)
    }

    /// Insère une ligne **à soi** dans `orders`, et rend son `id`.
    ///
    /// **Chaque test d'écriture travaille sur sa propre ligne.** Une première version prenait la
    /// première ligne de la table : `cargo test` exécute les tests en parallèle, et trois tests qui
    /// écrivent la même ligne échouaient les uns à cause des autres — de façon intermittente, le
    /// pire mode d'échec. La ligne est retirée à la fin, `orders` étant lue par d'autres tests qui
    /// comptent ses lignes.
    async fn ligne_a_moi(adaptateur: &PostgresAdapter, statut: &str) -> i64 {
        adaptateur
            .client
            .query_one(
                "insert into introspection.orders (user_id, status, total_cents)
                 select id, $1, 100 from introspection.users order by id limit 1
                 returning id",
                &[&statut],
            )
            .await
            .expect("insertion de la ligne de test")
            .get(0)
    }

    async fn retirer_ligne(adaptateur: &PostgresAdapter, id: i64) {
        adaptateur
            .client
            .execute("delete from introspection.orders where id = $1", &[&id])
            .await
            .expect("nettoyage");
    }

    /// **La première écriture réelle du projet, vérifiée contre PostgreSQL.**
    #[tokio::test]
    async fn appliquer_ecrit_la_valeur_et_rend_le_patch_inverse() {
        let adaptateur = adaptateur().await;
        let id = ligne_a_moi(&adaptateur, "avant").await;

        let issue = adaptateur
            .apply_updates(&plan_de(id, "status", Some("appliqué"), Some("avant")))
            .await
            .expect("l'application doit réussir");

        assert_eq!(issue.applied, 1);
        assert_eq!(
            lire(&adaptateur, id, "status").await.as_deref(),
            Some("appliqué")
        );
        // **Le patch inverse défait exactement ce qui a été fait** : il remet l'ancienne valeur, et
        // son `WHERE` porte la nouvelle.
        assert!(issue.inverse_sql.contains("'avant'"));
        assert!(issue.inverse_sql.contains("'appliqué'"));

        // Le patch inverse **s'exécute**, ce qui est la seule preuve qu'il vaut quelque chose.
        adaptateur
            .client
            .batch_execute(&issue.inverse_sql)
            .await
            .unwrap_or_else(|e| panic!("le patch inverse ne s'exécute pas : {e:?}"));
        assert_eq!(
            lire(&adaptateur, id, "status").await.as_deref(),
            Some("avant")
        );

        retirer_ligne(&adaptateur, id).await;
    }

    #[tokio::test]
    async fn trois_modifications_partent_ensemble_ou_pas_du_tout() {
        let adaptateur = adaptateur().await;
        let mut ids = Vec::new();
        for _ in 0..3 {
            ids.push(ligne_a_moi(&adaptateur, "groupe").await);
        }

        let mut plan = plan_de(ids[0], "status", None, None);
        plan.changes = ids
            .iter()
            .map(|id| crate::engine::PendingUpdate {
                key: id.to_string(),
                column: "status".into(),
                value: Some("groupé".into()),
                expected: Some("groupe".into()),
            })
            .collect();
        // **La deuxième modification est vouée à l'échec** : sa valeur attendue est fausse, donc son
        // `UPDATE` ne touchera aucune ligne. La première, elle, aura déjà réussi.
        plan.changes[1].expected = Some("valeur qui n'existe pas".into());

        let erreur = adaptateur
            .apply_updates(&plan)
            .await
            .expect_err("un conflit doit faire échouer l'application");
        assert!(
            erreur.to_string().contains("changé depuis la lecture"),
            "le message doit dire que la ligne a changé : {erreur}"
        );

        // **Et la base est inchangée**, y compris la ligne dont l'`UPDATE` avait réussi. C'est tout
        // l'intérêt de la transaction : un rapport partiel laisserait des données incohérentes que
        // rien ne signalerait.
        for id in &ids {
            assert_eq!(
                lire(&adaptateur, *id, "status").await.as_deref(),
                Some("groupe"),
                "la ligne {id} doit être intacte"
            );
            retirer_ligne(&adaptateur, *id).await;
        }
    }

    #[tokio::test]
    async fn une_valeur_changee_par_un_tiers_fait_echouer_l_application() {
        let adaptateur = adaptateur().await;
        let id = ligne_a_moi(&adaptateur, "lue").await;

        // Un tiers écrit entre la lecture et l'application — le scénario que le `WHERE` sur
        // l'ancienne valeur existe pour attraper.
        adaptateur
            .client
            .execute(
                "update introspection.orders set status = 'par un tiers' where id = $1",
                &[&id],
            )
            .await
            .expect("écriture du tiers");

        let erreur = adaptateur
            .apply_updates(&plan_de(id, "status", Some("le mien"), Some("lue")))
            .await
            .expect_err("l'application doit être refusée");
        assert!(erreur.to_string().contains("changé depuis la lecture"));
        // **Le travail du tiers n'est pas écrasé.** L'écraser en silence est précisément ce que ce
        // garde-fou empêche.
        assert_eq!(
            lire(&adaptateur, id, "status").await.as_deref(),
            Some("par un tiers")
        );

        retirer_ligne(&adaptateur, id).await;
    }

    #[tokio::test]
    async fn une_cellule_nulle_est_modifiable() {
        let adaptateur = adaptateur().await;
        let id = ligne_a_moi(&adaptateur, "nulle").await;

        // **`NULL = NULL` vaut `NULL` en SQL** : un `WHERE colonne = …` sur une ancienne valeur nulle
        // ne trouverait jamais sa ligne, et modifier une cellule vide — cas courant — échouerait
        // toujours. D'où `is not distinct from`. `metadata` est nullable et vide sur cette ligne.
        let issue = adaptateur
            .apply_updates(&plan_de(id, "metadata", Some(r#"{"a": 1}"#), None))
            .await
            .expect("modifier une cellule vide doit marcher");
        assert_eq!(issue.applied, 1);
        assert!(lire(&adaptateur, id, "metadata").await.is_some());

        // Et le patch inverse la remet à `NULL`, ce qu'un `= NULL` ne saurait pas faire non plus.
        adaptateur
            .client
            .batch_execute(&issue.inverse_sql)
            .await
            .unwrap_or_else(|e| panic!("le patch inverse ne s'exécute pas : {e:?}"));
        assert!(lire(&adaptateur, id, "metadata").await.is_none());

        retirer_ligne(&adaptateur, id).await;
    }

    /// **La console exécute le SQL de l'utilisateur** (`12c`), et la limite est réellement appliquée.
    #[tokio::test]
    async fn une_lecture_libre_est_limitee_et_le_dit() {
        let adaptateur = adaptateur().await;
        let issue = adaptateur
            .run_sql(
                "select id from introspection.orders",
                crate::engine::RowLimit::OneHundred,
            )
            .await
            .expect("la requête doit tourner");

        // **La contrainte transverse du projet** : aucun résultat complet ne traverse l'IPC. Sans
        // limite, cette requête rendrait toute la table.
        assert_eq!(issue.applied_limit, Some(100));
        assert!(issue.rows.len() <= 100);
        // Et la limite se **lit** dans le SQL rendu : une requête affichée différente de celle qui a
        // tourné serait un piège pour qui débogue.
        assert!(issue.sql.contains("limit 100"), "{}", issue.sql);
        assert_eq!(issue.columns, vec!["id"]);
    }

    #[tokio::test]
    async fn une_limite_ecrite_par_l_utilisateur_est_respectee() {
        let adaptateur = adaptateur().await;
        let issue = adaptateur
            .run_sql(
                "select id from introspection.orders limit 3",
                crate::engine::RowLimit::OneThousand,
            )
            .await
            .expect("la requête doit tourner");

        assert_eq!(issue.applied_limit, None);
        assert_eq!(issue.rows.len(), 3);
        // Le SQL est celui qu'on a écrit, sans ajout.
        assert!(!issue.sql.contains("limit 1000"));
    }

    #[tokio::test]
    async fn les_colonnes_calculees_portent_leur_nom_et_leur_type() {
        let adaptateur = adaptateur().await;
        let issue = adaptateur
            .run_sql(
                "select count(*) as total, now() as maintenant, 'x' as lettre",
                crate::engine::RowLimit::OneHundred,
            )
            .await
            .expect("la requête doit tourner");

        // Les colonnes viennent du **résultat** : ces trois-là n'existent dans aucune table.
        assert_eq!(issue.columns, vec!["total", "maintenant", "lettre"]);
        let ligne = issue.rows.first().expect("une ligne");
        // **La catégorie est déduite du nom du type**, faute de catalogue pour une requête libre. Un
        // type mal catégorisé doit s'afficher quand même — c'était le défaut de `06d`, où les types
        // exotiques se lisaient `NULL`.
        assert!(
            matches!(ligne[0], crate::engine::Value::Int { .. }),
            "{:?}",
            ligne[0]
        );
        assert!(
            matches!(ligne[1], crate::engine::Value::Timestamp { .. }),
            "{:?}",
            ligne[1]
        );
        assert!(
            matches!(ligne[2], crate::engine::Value::Text { .. }),
            "{:?}",
            ligne[2]
        );
    }

    #[tokio::test]
    async fn une_erreur_de_syntaxe_est_rendue_avec_le_message_du_serveur() {
        let adaptateur = adaptateur().await;
        let erreur = adaptateur
            .run_sql("select from where", crate::engine::RowLimit::OneHundred)
            .await
            .expect_err("une requête invalide doit échouer");
        // Le message du serveur, pas une paraphrase : c'est lui qui dit *où* est la faute.
        assert!(!erreur.to_string().is_empty());
        assert!(erreur.code.is_some(), "le code SQLSTATE doit remonter");
    }

    #[tokio::test]
    async fn un_type_exotique_ne_se_lit_pas_null() {
        let adaptateur = adaptateur().await;
        let issue = adaptateur
            .run_sql(
                "select '{\"a\":1}'::jsonb as j,
                        '11111111-2222-3333-4444-555555555555'::uuid as u,
                        12345678.91::numeric as n,
                        now()::date as d",
                crate::engine::RowLimit::OneHundred,
            )
            .await
            .expect("la requête doit tourner");

        // **La leçon de `06d`** : jsonb, uuid, numeric et date se lisaient tous `Null` faute de
        // transtypage. Le repli universel en texte les rattrape, et une requête libre passe par le
        // même lecteur que la grille — deux chemins de conversion divergeraient précisément ici.
        let ligne = issue.rows.first().expect("une ligne");
        for (index, nom) in ["j", "u", "n", "d"].iter().enumerate() {
            assert!(
                !matches!(ligne[index], crate::engine::Value::Null),
                "{nom} lu comme NULL"
            );
        }
    }

    #[tokio::test]
    async fn une_requete_sans_ligne_garde_ses_en_tetes() {
        let adaptateur = adaptateur().await;
        let issue = adaptateur
            .run_sql(
                "select id, status from introspection.orders where false",
                crate::engine::RowLimit::OneHundred,
            )
            .await
            .expect("la requête doit tourner");

        // **Les colonnes viennent de `prepare`, pas de la première ligne.** Une grille sans en-tête
        // sur un résultat vide laisserait croire à une erreur, alors que la requête est correcte.
        assert!(issue.rows.is_empty());
        assert_eq!(issue.columns, vec!["id", "status"]);
    }

    #[tokio::test]
    async fn un_decimal_garde_sa_precision_exacte() {
        let adaptateur = adaptateur().await;
        let issue = adaptateur
            .run_sql(
                "select 12345678.91::numeric as montant",
                crate::engine::RowLimit::OneHundred,
            )
            .await
            .expect("la requête doit tourner");

        // `12345678.91` en `f64` vaut 12345678.909999999… : sur une colonne de montants, l'écart se
        // voit. Décision de `06d`, qui s'applique aussi aux requêtes libres.
        match issue.rows.first().and_then(|l| l.first()) {
            Some(crate::engine::Value::Decimal { value }) => assert_eq!(value, "12345678.91"),
            autre => panic!("attendu un décimal exact, reçu {autre:?}"),
        }
    }

    #[tokio::test]
    async fn un_booleen_arrive_en_booleen_et_non_en_t_ou_f() {
        let adaptateur = adaptateur().await;
        let issue = adaptateur
            .run_sql("select true as vrai", crate::engine::RowLimit::OneHundred)
            .await
            .expect("la requête doit tourner");
        // Le protocole simple rend `t` et `f` : les afficher tels quels dans une colonne booléenne
        // serait un détail de protocole exposé à l'utilisateur.
        assert!(matches!(
            issue.rows.first().and_then(|l| l.first()),
            Some(crate::engine::Value::Bool { value: true })
        ));
    }

    /// **Le plan est estimé, jamais mesuré** (`12e`).
    #[tokio::test]
    async fn expliquer_rend_un_plan_sans_executer_la_requete() {
        let adaptateur = adaptateur().await;
        let id = ligne_a_moi(&adaptateur, "à-expliquer").await;

        // On explique un `delete` : s'il était **exécuté** pour produire le plan, la ligne
        // disparaîtrait. C'est tout l'enjeu du choix `EXPLAIN` contre `EXPLAIN ANALYZE` — sur une
        // console où l'on écrit aussi, « Expliquer » deviendrait un bouton qui écrit.
        let plan = adaptateur
            .explain_sql(&format!("delete from introspection.orders where id = {id}"))
            .await
            .expect("le plan doit être rendu");

        assert!(!plan.lines.is_empty(), "le plan doit avoir des lignes");
        // Le SQL d'explication est **montré** : « explain … », sans `analyze`.
        assert!(plan.sql.starts_with("explain "), "{}", plan.sql);
        assert!(
            !plan.sql.to_lowercase().contains("analyze"),
            "`EXPLAIN ANALYZE` exécuterait la requête : {}",
            plan.sql
        );

        // **La ligne est toujours là.** C'est la preuve que le plan n'a rien exécuté.
        assert_eq!(
            lire(&adaptateur, id, "status").await.as_deref(),
            Some("à-expliquer")
        );
        retirer_ligne(&adaptateur, id).await;
    }

    #[tokio::test]
    async fn un_plan_de_lecture_nomme_le_parcours_et_son_cout() {
        let adaptateur = adaptateur().await;
        let plan = adaptateur
            .explain_sql("select * from introspection.orders where status = 'paid'")
            .await
            .expect("le plan doit être rendu");

        let texte = plan.lines.join("\n");
        // Un plan sans coût ne sert à rien : c'est le chiffre qu'on vient lire.
        assert!(texte.contains("cost="), "{texte}");
        assert!(
            texte.to_lowercase().contains("scan"),
            "un parcours doit être nommé : {texte}"
        );
    }

    #[tokio::test]
    async fn un_point_virgule_final_ne_casse_pas_l_explication() {
        let adaptateur = adaptateur().await;
        // `explain select 1;` est valide, mais un point-virgule au milieu — `explain select 1; ` suivi
        // d'autre chose — ne l'est pas. Le copier-coller en amène souvent.
        let plan = adaptateur
            .explain_sql("select 1;")
            .await
            .expect("le plan doit être rendu");
        assert!(!plan.lines.is_empty());
    }

    /// Une apostrophe dans une valeur ne doit pas casser le SQL — le cas classique.
    ///
    /// **Exécuté, pas seulement inspecté.** Une première version prouvait l'analyse par l'échec
    /// attendu d'une contrainte `not null` : indirect, et vert pour la mauvaise raison dès que le
    /// message d'erreur changeait de forme. Ici le SQL tourne pour de bon, dans une transaction
    /// annulée.
    #[tokio::test]
    async fn une_apostrophe_est_doublee_et_le_sql_reste_executable() {
        let adaptateur = adaptateur().await;
        let colonnes = adaptateur
            .table_detail("introspection", "petite")
            .await
            .expect("détail")
            .columns;

        let sql = crate::engine::postgres::rows::insert_de(
            "introspection",
            "petite",
            &colonnes,
            &[
                crate::engine::Value::Int { value: 999_999 },
                crate::engine::Value::Text {
                    value: "l'apostrophe".into(),
                },
                crate::engine::Value::Int { value: 3 },
            ],
        )
        .expect("génération");

        assert!(sql.contains("'l''apostrophe'"), "{sql}");

        adaptateur
            .client
            .batch_execute(&format!("begin;\n{sql}\nrollback;"))
            .await
            .unwrap_or_else(|e| panic!("l'INSERT produit ne s'exécute pas : {e:?}\n{sql}"));

        // Le `rollback` a tout défait : rien n'est laissé dans la table.
        let restant = adaptateur
            .client
            .query_one(
                "select count(*) from introspection.petite where id = 999999",
                &[],
            )
            .await
            .expect("relecture");
        assert_eq!(
            restant.get::<_, i64>(0),
            0,
            "la transaction n'a pas été annulée"
        );
    }

    /// **`NULL` sans guillemets.** `'NULL'` est la chaîne « NULL », pas l'absence de valeur, et
    /// les confondre insérerait un texte là où la colonne devait rester vide — un défaut qui ne
    /// se voit qu'à la relecture des données, longtemps après.
    #[tokio::test]
    async fn un_null_n_est_pas_la_chaine_null() {
        let adaptateur = adaptateur().await;
        let colonnes = adaptateur
            .table_detail("introspection", "orders")
            .await
            .expect("détail")
            .columns;

        let sql = crate::engine::postgres::rows::insert_de(
            "introspection",
            "orders",
            &colonnes,
            &vec![crate::engine::Value::Null; colonnes.len()],
        )
        .expect("génération");

        assert!(sql.contains("NULL"), "{sql}");
        assert!(!sql.contains("'NULL'"), "{sql}");
    }

    #[tokio::test]
    async fn un_filtre_restreint_reellement_le_resultat() {
        let adaptateur = adaptateur().await;
        let mut requete = RowQuery::new(
            "introspection",
            "grande",
            crate::engine::RowLimit::FiveHundred,
        );
        requete.filters = vec![crate::engine::Filter {
            column: "rang".into(),
            operator: crate::engine::FilterOperator::Eq,
            value: Some("3".into()),
        }];

        let f = adaptateur.rows(&requete).await.unwrap();
        assert!(!f.rows.is_empty(), "le filtre doit trouver des lignes");
        // `rang` vaut `g % 7`, donc un septième des lignes environ — la fenêtre reste pleine.
        assert_eq!(f.rows.len(), 500);
    }

    #[tokio::test]
    async fn une_tentative_d_injection_ne_trouve_rien_et_ne_casse_rien() {
        let adaptateur = adaptateur().await;
        let mut requete = RowQuery::new(
            "introspection",
            "petite",
            crate::engine::RowLimit::OneHundred,
        );
        requete.filters = vec![crate::engine::Filter {
            column: "valeur".into(),
            operator: crate::engine::FilterOperator::Eq,
            value: Some("' or 1=1 --".into()),
        }];

        // Traitée comme une **donnée** : elle ne trouve rien, et surtout ne fait pas
        // apparaître toute la table.
        let f = adaptateur.rows(&requete).await.expect("ne doit pas casser");
        assert!(
            f.rows.is_empty(),
            "l'injection a ramené {} lignes",
            f.rows.len()
        );
    }

    #[tokio::test]
    async fn une_colonne_inconnue_est_refusee() {
        let adaptateur = adaptateur().await;
        let mut requete = RowQuery::new(
            "introspection",
            "petite",
            crate::engine::RowLimit::OneHundred,
        );
        requete.filters = vec![crate::engine::Filter {
            column: "colonne_inventee".into(),
            operator: crate::engine::FilterOperator::Eq,
            value: Some("x".into()),
        }];

        let erreur = adaptateur
            .rows(&requete)
            .await
            .expect_err("doit être refusée");
        assert!(erreur.message.contains("colonne_inventee"), "{erreur}");
        // Refusée **ici**, sans aller-retour : `code` est nul pour une erreur locale, et
        // porterait `42703` si la requête avait été envoyée et que PostgreSQL l'avait
        // rejetée. Sans cette assertion, laisser passer le nom simplement échappé serait
        // indétectable — le message de PostgreSQL contient lui aussi le nom de la colonne.
        assert_eq!(
            erreur.code, None,
            "refus attendu avant l'envoi : {erreur:?}"
        );
    }

    /// Que paginer sur un tri **non total** ne produise ni doublon ni oubli.
    ///
    /// `rang` ne prend que sept valeurs sur cent mille lignes : sans critère stable ajouté,
    /// l'ordre entre deux lignes de même rang est indéfini d'une page à l'autre.
    #[tokio::test]
    async fn paginer_sur_un_tri_non_total_ne_perd_ni_ne_duplique_aucune_ligne() {
        let adaptateur = adaptateur().await;
        let mut vues: std::collections::HashSet<i64> = std::collections::HashSet::new();

        for page in 0..4u64 {
            let mut requete = RowQuery::new(
                "introspection",
                "grande",
                crate::engine::RowLimit::OneHundred,
            );
            requete.sort = vec![crate::engine::SortKey {
                column: "rang".into(),
                direction: crate::engine::SortDirection::Ascending,
            }];
            requete.offset = page * 100;

            let f = adaptateur.rows(&requete).await.unwrap();
            for ligne in &f.rows {
                match &ligne[0] {
                    crate::engine::Value::Int { value } => {
                        assert!(vues.insert(*value), "ligne {value} vue deux fois");
                    }
                    autre => panic!("la première colonne devrait être un entier : {autre:?}"),
                }
            }
        }

        assert_eq!(vues.len(), 400, "quatre pages de cent lignes distinctes");
    }

    #[tokio::test]
    async fn les_valeurs_sont_typees_et_null_est_distingue() {
        let adaptateur = adaptateur().await;
        let f = adaptateur
            .rows(&RowQuery::new(
                "introspection",
                "orders",
                crate::engine::RowLimit::OneHundred,
            ))
            .await
            .unwrap();

        let premiere = &f.rows[0];
        // `orders` : id bigint, user_id bigint, status text, total_cents int, metadata jsonb
        // (toujours nul dans le jeu de test), …
        assert!(
            matches!(premiere[0], crate::engine::Value::Int { .. }),
            "{:?}",
            premiere[0]
        );
        assert!(
            matches!(premiere[2], crate::engine::Value::Text { .. }),
            "{:?}",
            premiere[2]
        );
        assert!(
            matches!(premiere[4], crate::engine::Value::Null),
            "metadata est nul dans le jeu de test : {:?}",
            premiere[4]
        );
    }

    // --- Introspection (06c) ---
    //
    // Ces tests supposent le schéma `introspection` créé par `scripts/schema-test-pg.sql` :
    // deux tables (dont une avec clé étrangère, contrainte CHECK et neuf colonnes couvrant
    // les huit catégories de type), une vue, deux fonctions, un trigger, un index
    // secondaire, et des commentaires de table, de colonne et de schéma.

    async fn schema_de_test() -> crate::engine::SchemaInfo {
        adaptateur()
            .await
            .schemas()
            .await
            .unwrap()
            .into_iter()
            .find(|s| s.name == "introspection")
            .expect("le schéma de test doit exister — voir scripts/schema-test-pg.sql")
    }

    async fn objet_de_test(nom: &str) -> crate::engine::TableSummary {
        adaptateur()
            .await
            .objects("introspection")
            .await
            .unwrap()
            .into_iter()
            .find(|o| o.name == nom)
            .unwrap_or_else(|| panic!("objet {nom} absent du schéma de test"))
    }

    #[tokio::test]
    async fn les_schemas_systeme_sont_exclus() {
        let schemas = adaptateur().await.schemas().await.unwrap();
        let noms: Vec<&str> = schemas.iter().map(|s| s.name.as_str()).collect();

        for systeme in ["pg_catalog", "information_schema", "pg_toast"] {
            assert!(
                !noms.contains(&systeme),
                "{systeme} ne doit pas apparaître : {noms:?}"
            );
        }
        // Contrôle positif : sans lui, une requête qui ne rend rien passerait le test.
        assert!(
            noms.contains(&"public"),
            "public doit apparaître : {noms:?}"
        );
    }

    #[tokio::test]
    async fn les_compteurs_d_objets_sont_justes() {
        let schema = schema_de_test().await;
        // `users`, `orders`, `petite`, `grande`, `montants` — cette dernière ajoutée le 10 août
        // 2026 pour le cas `numeric`, qui se lisait `NULL` — et `identites`, ajoutée le 12 août
        // 2026 pour les deux formes de `GENERATED … AS IDENTITY` que le DDL de `14c` perdait.
        assert_eq!(schema.counts.tables, 6, "{:?}", schema.counts);
        assert_eq!(schema.counts.views, 1, "{:?}", schema.counts);
        assert_eq!(schema.counts.functions, 2, "{:?}", schema.counts);
        // Huit index pour six tables : chaque clé primaire en crée un, plus l'unicité sur
        // `email` et l'index secondaire sur `status`.
        assert_eq!(schema.counts.indexes, 8, "{:?}", schema.counts);
    }

    #[tokio::test]
    async fn un_objet_porte_les_colonnes_du_tableau_de_a4() {
        let orders = objet_de_test("orders").await;

        assert_eq!(orders.kind, crate::engine::ObjectKind::Table);
        assert_eq!(
            orders.column_count, 9,
            "neuf colonnes dans la table de test"
        );
        assert_eq!(orders.primary_key.as_deref(), Some("id"));
        assert!(
            orders.size_bytes.is_some_and(|t| t > 0),
            "taille physique attendue"
        );
        assert!(
            orders.last_analyze.is_some(),
            "la table de test a été analysée"
        );
        assert_eq!(
            orders.rows.value().map(|v| v > 0),
            Some(true),
            "500 lignes insérées et la table est analysée : {:?}",
            orders.rows
        );
    }

    #[tokio::test]
    async fn un_commentaire_de_table_est_rendu() {
        assert_eq!(
            objet_de_test("users").await.comment.as_deref(),
            Some("les comptes")
        );
    }

    /// **Ce test était vert pour la mauvaise raison.**
    ///
    /// Il vérifiait `value() >= 0`, ce que `0` satisfaisait : `estimation_de` traduisait
    /// `reltuples = -1` en zéro, et l'écran affichait donc « 0 ligne » sur toute relation jamais
    /// analysée. Sur une base réelle dont aucune table ne l'avait été, `A4` les montrait **toutes
    /// vides** — constaté à l'usage le 10 août 2026.
    ///
    /// La version qui mord exige `Unknown` : « pas d'estimation » n'est ni négatif, ni zéro.
    #[tokio::test]
    async fn un_comptage_inconnu_est_rendu_inconnu_et_non_zero() {
        // `paid_orders` est volontairement laissée non analysée par le décor de test.
        let vue = objet_de_test("paid_orders").await;
        assert_eq!(
            vue.rows,
            crate::engine::RowCount::Unknown,
            "une relation jamais analysée doit rendre Unknown"
        );
        assert_eq!(vue.rows.value(), None);
    }

    #[tokio::test]
    async fn le_comptage_de_l_arbre_est_une_estimation_pas_un_compte_exact() {
        // `A4` ouvre un arbre : compter exactement coûterait un parcours complet par table.
        assert!(!objet_de_test("orders").await.rows.is_exact());
    }

    // --- Détail d'une table et DDL (06c, tâches 3-4) ---

    async fn detail_de_test(table: &str) -> crate::engine::TableDetail {
        adaptateur()
            .await
            .table_detail("introspection", table)
            .await
            .unwrap_or_else(|e| panic!("détail de {table} : {e}"))
    }

    #[tokio::test]
    async fn les_colonnes_portent_type_nullabilite_defaut_et_cle() {
        let detail = detail_de_test("orders").await;
        assert_eq!(detail.columns.len(), 9);

        let id = &detail.columns[0];
        assert_eq!(id.name, "id");
        assert_eq!(id.position, 1);
        assert!(!id.nullable);
        assert_eq!(id.key, Some(crate::engine::KeyKind::Primary));
        assert!(id.default.is_some(), "bigserial a un défaut nextval");

        let user_id = detail.columns.iter().find(|c| c.name == "user_id").unwrap();
        assert_eq!(user_id.key, Some(crate::engine::KeyKind::Foreign));

        let total = detail
            .columns
            .iter()
            .find(|c| c.name == "total_cents")
            .unwrap();
        assert!(total.nullable);
        assert!(total.default.is_none());
    }

    #[tokio::test]
    async fn les_huit_categories_de_type_sont_reconnues() {
        use crate::engine::TypeCategory::*;
        let detail = detail_de_test("orders").await;
        let categorie = |nom: &str| {
            detail
                .columns
                .iter()
                .find(|c| c.name == nom)
                .unwrap()
                .category
        };

        assert_eq!(categorie("id"), Number);
        assert_eq!(categorie("status"), Text);
        assert_eq!(categorie("created_at"), Timestamp);
        assert_eq!(categorie("paid"), Boolean);
        // Les trois que `typcategory = 'U'` confondrait sans le nom de type.
        assert_eq!(categorie("metadata"), Json);
        assert_eq!(categorie("ref"), Uuid);
        assert_eq!(categorie("blob"), Binary);
    }

    #[tokio::test]
    async fn un_commentaire_de_colonne_est_rendu() {
        let detail = detail_de_test("users").await;
        let email = detail.columns.iter().find(|c| c.name == "email").unwrap();
        assert_eq!(email.comment.as_deref(), Some("unique, sert d'identifiant"));
    }

    #[tokio::test]
    async fn les_triggers_internes_sont_exclus() {
        // `pg_trigger` contient ceux que les clés étrangères créent : sans
        // `not tgisinternal`, `A9` afficherait des triggers que l'utilisateur n'a pas écrits.
        let detail = detail_de_test("orders").await;
        assert_eq!(detail.triggers.len(), 1, "{:?}", detail.triggers);
        assert_eq!(detail.triggers[0].name, "orders_touch");
    }

    #[tokio::test]
    async fn index_et_contraintes_sont_rendus_avec_leur_definition() {
        let detail = detail_de_test("orders").await;

        assert!(detail.indexes.iter().any(|i| i.name == "orders_status_idx"));
        assert!(
            detail
                .indexes
                .iter()
                .all(|i| i.definition.contains("CREATE")),
            "les définitions viennent de pg_get_indexdef"
        );
        assert!(detail.constraints.iter().any(|c| c.name == "total_positif"));
        assert!(
            detail
                .constraints
                .iter()
                .any(|c| c.definition.starts_with("CHECK")),
            "{:?}",
            detail.constraints
        );
    }

    /// **Ce test ne vérifiait que la direction et la table cible, et c'est ce qui a laissé passer
    /// le défaut du 10 août 2026** : les colonnes d'une relation entrante étaient cherchées dans
    /// la mauvaise table. Il rendait `users.email` là où il fallait `orders.user_id`, et le test
    /// restait vert — les noms n'étaient pas regardés.
    ///
    /// Sur une base réelle, la même erreur produisait un `array_agg` à `NULL` dès que le numéro
    /// d'attribut n'existait pas dans l'autre table, et **empêchait d'ouvrir la table**.
    ///
    /// La version qui mord nomme les colonnes des deux côtés, dans les deux sens.
    #[tokio::test]
    async fn les_relations_nomment_les_bonnes_colonnes_dans_les_deux_sens() {
        let sortantes = detail_de_test("orders").await;
        let sortante = sortantes
            .relations
            .iter()
            .find(|r| r.direction == crate::engine::RelationDirection::Outgoing)
            .unwrap_or_else(|| panic!("orders référence users : {:?}", sortantes.relations));
        assert_eq!(sortante.target_table, "users");
        // Vue depuis `orders`, la relation part de **sa** colonne `user_id` vers `users.id`.
        assert_eq!(sortante.columns, vec!["user_id".to_owned()]);
        assert_eq!(sortante.target_columns, vec!["id".to_owned()]);

        let entrantes = detail_de_test("users").await;
        let entrante = entrantes
            .relations
            .iter()
            .find(|r| r.direction == crate::engine::RelationDirection::Incoming)
            .unwrap_or_else(|| panic!("orders référence users : {:?}", entrantes.relations));
        assert_eq!(entrante.target_table, "orders");
        // **Le sens s'inverse, pas les tables** : vue depuis `users`, la relation part de sa
        // colonne `id` et pointe `orders.user_id`. L'ancienne requête rendait `users.email` ici,
        // parce qu'elle cherchait l'attribut n°2 dans `users` au lieu d'`orders`.
        assert_eq!(entrante.columns, vec!["id".to_owned()]);
        assert_eq!(entrante.target_columns, vec!["user_id".to_owned()]);
    }

    // --- Le TLS de `06f` -------------------------------------------------------------------------
    //
    // **PostgreSQL est le seul des trois moteurs où les cinq modes s'expriment exactement**, parce
    // que `tokio-postgres-rustls` accepte une `ClientConfig`. MySQL et MongoDB refusent `verify-ca`
    // avec leur raison : leurs pilotes ne prennent que des drapeaux, et celui de MySQL est même
    // silencieusement sans effet (voir `mysql/connect.rs`).
    //
    // Le décor est monté par `scripts/pg-test.sh`, qui engendre une autorité à nous et un certificat
    // serveur dont le nom commun est `pg-interne.exemple.test` — **pas** `localhost`. Les tests se
    // connectent par `localhost`, donc :
    //
    //   - la chaîne est **valide** dès que l'autorité est déclarée ;
    //   - le nom ne correspond **jamais**.
    //
    // C'est ce qui permet de distinguer `verify-ca` de `verify-full` sur le **même** serveur, avec la
    // **même** autorité. Sans cette distinction, `06f` n'aurait rien prouvé de plus que `06b`.

    /// Le chemin de l'autorité engendrée par `scripts/pg-test.sh`.
    ///
    /// Les tests TLS se **sautent** si le fichier manque, plutôt que d'échouer : le décor peut avoir
    /// été monté par une ancienne version du script, ou par le service container de la CI. L'absence
    /// est dite, jamais silencieuse.
    fn autorite() -> Option<String> {
        let dossier = std::env::var("DORABASE_TEST_PG_CERTS")
            .unwrap_or_else(|_| "/tmp/dorabase-test-pg-certs".to_owned());
        let chemin = format!("{dossier}/ca.pem");
        if std::path::Path::new(&chemin).exists() {
            Some(chemin)
        } else {
            eprintln!("test TLS sauté : {chemin} absent — relancer ./scripts/pg-test.sh demarrer");
            None
        }
    }

    async fn connexion_en(
        mode: SslMode,
        ca: Option<String>,
    ) -> Result<PostgresAdapter, EngineError> {
        let (mut variante, secret) = variante_de_test();
        variante.ssl_mode = mode;
        variante.ca_certificate = ca;
        PostgresAdapter::connect_via(
            &variante,
            secret.as_ref(),
            std::path::Path::new("/dev/null"),
        )
        .await
    }

    #[tokio::test]
    async fn require_chiffre_sans_authentifier_donc_accepte_une_autorite_inconnue() {
        if autorite().is_none() {
            return;
        }
        // **`require` chiffre sans authentifier** : il n'empêche donc pas un intermédiaire. Ce n'est
        // pas un défaut mais un mode que `05a` propose — et `A2` le dit, en gardant la mention
        // « TLS non vérifié » (voir `tls_non_verifie`).
        let adaptateur = connexion_en(SslMode::Require, None)
            .await
            .expect("require doit accepter un certificat inconnu");
        assert!(
            session_chiffree(&adaptateur).await,
            "la session doit être chiffrée"
        );
    }

    #[tokio::test]
    async fn verify_ca_refuse_une_autorite_inconnue() {
        if autorite().is_none() {
            return;
        }
        // **Le test qui compte le plus de `06f`.** Avant cette spec, `require`, `verify-ca` et
        // `verify-full` se comportaient à l'identique : le sélecteur de `A2` proposait trois choix
        // pour un seul effet, et le produit affichait un cadenas sans rien vérifier.
        let erreur = connexion_en(SslMode::VerifyCa, None)
            .await
            .expect_err("verify-ca doit refuser une autorité inconnue");
        let message = erreur.message.to_lowercase();
        assert!(
            message.contains("certificate") || message.contains("certificat"),
            "le refus doit parler du certificat : {}",
            erreur.message
        );
    }

    #[tokio::test]
    async fn verify_ca_accepte_le_meme_serveur_quand_son_autorite_est_fournie() {
        let Some(ca) = autorite() else { return };
        // Le **même serveur**, la **même autorité** : seule la déclaration change. C'est ce qui montre
        // que le refus précédent portait bien sur la chaîne, et non sur autre chose.
        let adaptateur = connexion_en(SslMode::VerifyCa, Some(ca))
            .await
            .expect("verify-ca doit accepter quand l'autorité est déclarée");
        assert!(
            session_chiffree(&adaptateur).await,
            "la session doit être chiffrée"
        );
    }

    #[tokio::test]
    async fn verify_full_refuse_un_nom_d_hote_qui_ne_correspond_pas() {
        let Some(ca) = autorite() else { return };
        // **Le cas qu'on oublie**, et le plus instructif : l'autorité est fournie, la chaîne est donc
        // valide — mais le certificat porte `pg-interne.exemple.test` et l'on joint `localhost`.
        // `verify-full` doit refuser là où `verify-ca` vient d'accepter : deux comportements distincts
        // sur le **même** serveur, avec la **même** autorité.
        let erreur = connexion_en(SslMode::VerifyFull, Some(ca))
            .await
            .expect_err("verify-full doit refuser un nom d'hôte qui ne correspond pas");
        let message = erreur.message.to_lowercase();
        assert!(
            message.contains("name") || message.contains("nom"),
            "le refus doit parler du nom d'hôte : {}",
            erreur.message
        );
    }

    #[tokio::test]
    async fn disable_ne_chiffre_pas_et_c_est_verifie_cote_serveur() {
        // Le pendant des tests ci-dessus : `disable` doit **vraiment** ne pas chiffrer. Les deux
        // ensemble prouvent que le réglage décide, et non que tout est chiffré par hasard.
        let adaptateur = connexion_en(SslMode::Disable, None)
            .await
            .expect("connexion");
        assert!(
            !session_chiffree(&adaptateur).await,
            "la session ne devait pas être chiffrée"
        );
    }

    #[tokio::test]
    async fn un_certificat_d_autorite_introuvable_le_dit_avant_de_se_connecter() {
        let erreur = connexion_en(SslMode::VerifyCa, Some("/nulle/part/ca.pem".to_owned()))
            .await
            .expect_err("un fichier absent doit être refusé");
        // Le chemin apparaît : c'est ce qui permet de voir qu'on l'a mal tapé, plutôt que de croire le
        // serveur en cause.
        assert!(
            erreur.message.contains("/nulle/part/ca.pem"),
            "{}",
            erreur.message
        );
    }

    #[tokio::test]
    async fn un_fichier_qui_n_est_pas_un_certificat_le_dit() {
        let dossier = tempfile::tempdir().unwrap();
        let chemin = dossier.path().join("pas-un-certificat.pem");
        std::fs::write(
            &chemin,
            b"ceci est du texte
",
        )
        .unwrap();
        // **Le piège** : sans ce refus, le magasin resterait aux racines publiques et la connexion
        // échouerait sur « autorité inconnue » — on chercherait du côté du serveur.
        let erreur = connexion_en(
            SslMode::VerifyCa,
            Some(chemin.to_string_lossy().into_owned()),
        )
        .await
        .expect_err("un fichier sans certificat doit être refusé");
        assert!(
            erreur.message.contains("aucun certificat"),
            "{}",
            erreur.message
        );
    }

    /// Vrai quand la session est **réellement** chiffrée, d'après le serveur.
    ///
    /// **Demander le TLS et l'obtenir sont deux choses.** Sans cette lecture côté serveur, une
    /// configuration qui retomberait silencieusement en clair passerait tous les tests ci-dessus — et
    /// le produit afficherait un cadenas sur une connexion en clair.
    async fn session_chiffree(adaptateur: &PostgresAdapter) -> bool {
        adaptateur
            .client
            .query_one(
                "select ssl from pg_stat_ssl where pid = pg_backend_pid()",
                &[],
            )
            .await
            .map(|ligne| ligne.get::<_, bool>(0))
            .unwrap_or(false)
    }

    /// **Le critère le plus fort de la spec** : un DDL qui ne se réexécute pas est faux, et
    /// c'est testable. Rejoué dans un schéma vierge, il doit produire une table dont les
    /// colonnes se décrivent identiquement.
    #[tokio::test]
    async fn le_ddl_produit_se_rejoue_et_donne_la_meme_table() {
        // **Deux tables, et la seconde n'est pas décorative** : `orders` couvre les `bigserial`
        // et les contraintes, `identites` les deux formes de `GENERATED … AS IDENTITY` — que
        // PostgreSQL ne range pas dans `pg_attrdef`, donc que le DDL peut perdre sans que le
        // rejeu échoue.
        for table in ["orders", "identites"] {
            rejouer_le_ddl_de(table).await;
        }
    }

    async fn rejouer_le_ddl_de(table: &str) {
        let adaptateur = adaptateur().await;
        let original = detail_de_test(table).await;

        // Schéma jetable, propre à ce test pour ne pas gêner les autres. Le nom porte la table
        // pour que les deux passages ne se marchent pas dessus.
        let schema = &format!("ddl_rejeu_{table}");
        adaptateur
            .client
            .batch_execute(&format!(
                "drop schema if exists {schema} cascade; create schema {schema};"
            ))
            .await
            .unwrap();

        // Le DDL référence `introspection.orders` et sa clé étrangère vers
        // `introspection.users` : on ne réécrit que le schéma de la table créée, la cible de
        // la clé étrangère restant valable.
        let rejoue = original.ddl.replace(
            &format!("introspection.{}", original.name),
            &format!("{schema}.{}", original.name),
        );

        adaptateur
            .client
            .batch_execute(&rejoue)
            .await
            .unwrap_or_else(|e| panic!("le DDL ne se rejoue pas : {e}\n---\n{rejoue}"));

        let copie = adaptateur
            .table_detail(schema, &original.name)
            .await
            .unwrap();

        // **Le défaut et l'identité font partie de la description.** Sans eux, un DDL qui perd
        // l'auto-incrément d'une clé primaire se rejoue et se compare à l'identique : c'est ce
        // qui a laissé passer la clause `GENERATED … AS IDENTITY` manquante jusqu'à ce que `A9`
        // (`14c`) affiche ce DDL à l'écran.
        let decrire = |c: &crate::engine::ColumnInfo| {
            (
                c.position,
                c.name.clone(),
                c.type_name.clone(),
                c.nullable,
                c.identity,
                c.default.clone(),
            )
        };
        // Le défaut d'une colonne `serial` **nomme sa séquence**, donc son schéma : la copie dit
        // `ddl_rejeu_orders.orders_id_seq` là où l'originale dit `introspection.orders_id_seq`.
        // C'est le seul écart légitime, et il se normalise plutôt que de s'ignorer — retirer le
        // défaut de la comparaison rendrait le test aveugle à l'identité perdue, qui est
        // exactement ce qu'il vient d'attraper.
        let sans_le_schema = |defaut: Option<String>| {
            defaut.map(|texte| texte.replace(schema.as_str(), "introspection"))
        };
        let decrire_copie = |c: &crate::engine::ColumnInfo| {
            let (position, nom, type_name, nullable, identite, defaut) = decrire(c);
            (
                position,
                nom,
                type_name,
                nullable,
                identite,
                sans_le_schema(defaut),
            )
        };
        assert_eq!(
            copie.columns.iter().map(decrire_copie).collect::<Vec<_>>(),
            original.columns.iter().map(decrire).collect::<Vec<_>>(),
            "les colonnes de la copie de {table} doivent décrire la même table"
        );

        // **Les index aussi.** Un DDL qui recrée les colonnes mais pas les index se rejoue et donne
        // une table qui se lit pareil et se **requête** cent fois plus lentement. Comparer les noms
        // suffit : leur définition est celle du catalogue, déjà vérifiée par les colonnes.
        let noms = |detail: &crate::engine::TableDetail| {
            let mut noms: Vec<String> = detail.indexes.iter().map(|i| i.name.clone()).collect();
            noms.sort();
            noms
        };
        assert_eq!(
            noms(&copie),
            noms(&original),
            "les index de la copie de {table} doivent être ceux de l'originale"
        );

        adaptateur
            .client
            .batch_execute(&format!("drop schema {schema} cascade"))
            .await
            .unwrap();
    }
}
