//! Le registre des connexions ouvertes.
//!
//! **Pourquoi un registre.** `PostgresAdapter` détient un client et, éventuellement, un tunnel
//! SSH : il ne peut pas traverser l'IPC, et le recréer à chaque commande rouvrirait un tunnel
//! par requête — donc une session SSH et un port lié pour lire une liste de tables.

use std::collections::HashMap;

use tokio::sync::Mutex;

use crate::config::ConnectionSettings;
use crate::engine::AnyEngine;
use crate::engine::EngineError;
use crate::secrets::Secret;

/// L'identité d'une connexion : projet / base / environnement.
///
/// **La même clé que la référence de secret de `08e`**, et ce n'est pas un hasard : c'est
/// l'identité d'une connexion. La réemployer évite deux conventions à garder cohérentes, et
/// permet de retrouver le mot de passe d'une connexion depuis sa seule clé.
pub fn cle(project: &str, database: &str, environment: &str) -> String {
    format!("{project}/{database}/{environment}")
}

/// L'état d'une base, tel que l'arbre de `09d` l'affiche.
///
/// **Quatre états, pas deux.** « Jamais tentée » n'est pas « hors ligne » : les confondre
/// afficherait en rouge une base qu'on n'a simplement pas ouverte. Et l'arbre se lit sans
/// réseau — décision du 7 août 2026 — donc l'état par défaut d'une base est `Jamais`, pas un
/// échec.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, ts_rs::TS)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
#[ts(export_to = "engine.ts")]
pub enum ConnectionState {
    /// Aucune tentative. L'état de départ de toute base au lancement.
    Never,
    Connecting,
    Connected {
        server_version: String,
        /// Le port local du tunnel, quand la variante en déclare un.
        tunnel_local_port: Option<u16>,
    },
    /// La dernière tentative a échoué. Le message vient du moteur (`06b`–`06e`), qui dit déjà
    /// la manœuvre — le réécrire créerait deux vérités.
    Offline {
        reason: String,
    },
}

/// Le registre, rangé dans l'état Tauri.
///
/// `tokio::sync::Mutex` et non `std::sync::Mutex` : les commandes sont `async` et gardent le
/// verrou à travers un `await` — ouvrir une connexion prend du temps. Un verrou de la
/// bibliothèque standard tenu à travers un point d'attente bloque le fil de l'exécuteur.
#[derive(Default)]
pub struct ConnectionRegistry {
    ouvertes: Mutex<HashMap<String, AnyEngine>>,
    etats: Mutex<HashMap<String, ConnectionState>>,
}

impl ConnectionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// L'état d'une base. `Never` quand elle n'est pas au registre — l'état de départ, pas une
    /// absence d'information.
    pub async fn etat(&self, cle: &str) -> ConnectionState {
        self.etats
            .lock()
            .await
            .get(cle)
            .cloned()
            .unwrap_or(ConnectionState::Never)
    }

    /// Tous les états connus, pour peupler l'arbre en une fois.
    pub async fn etats(&self) -> HashMap<String, ConnectionState> {
        self.etats.lock().await.clone()
    }

    /// Ouvre une connexion, ou rend celle qui existe déjà.
    ///
    /// **Réemployer plutôt que rouvrir** est le point du registre : `09d` déplie un schéma puis
    /// une table, ce qui fait plusieurs commandes sur la même base. Chacune rouvrant un tunnel
    /// épuiserait les ports et ajouterait une poignée de main SSH par clic.
    pub async fn ouvrir(
        &self,
        cle: &str,
        moteur: crate::config::Engine,
        variante: &ConnectionSettings,
        mot_de_passe: Option<&Secret>,
        known_hosts: &std::path::Path,
    ) -> Result<(), EngineError> {
        if self.ouvertes.lock().await.contains_key(cle) {
            return Ok(());
        }

        self.etats
            .lock()
            .await
            .insert(cle.to_owned(), ConnectionState::Connecting);

        match AnyEngine::connect_via(moteur, variante, mot_de_passe, known_hosts).await {
            Ok(adaptateur) => {
                let sonde = adaptateur.probe().await;
                let (version, port) = match sonde {
                    Ok(sonde) => (sonde.server_version, adaptateur.port_local_tunnel()),
                    Err(erreur) => {
                        // Connectée mais muette : c'est un échec, et le garder ouvert
                        // laisserait un tunnel vivant pour rien.
                        adaptateur.close().await;
                        self.marquer_hors_ligne(cle, erreur.message.clone()).await;
                        return Err(erreur);
                    }
                };

                self.ouvertes
                    .lock()
                    .await
                    .insert(cle.to_owned(), adaptateur);
                self.etats.lock().await.insert(
                    cle.to_owned(),
                    ConnectionState::Connected {
                        server_version: version,
                        tunnel_local_port: port,
                    },
                );
                Ok(())
            }
            Err(erreur) => {
                self.marquer_hors_ligne(cle, erreur.message.clone()).await;
                Err(erreur)
            }
        }
    }

    async fn marquer_hors_ligne(&self, cle: &str, raison: String) {
        self.etats
            .lock()
            .await
            .insert(cle.to_owned(), ConnectionState::Offline { reason: raison });
    }

    /// Exécute une opération sur une connexion ouverte.
    ///
    /// Le verrou est tenu pendant l'opération : deux requêtes concurrentes sur la même base se
    /// sérialisent. C'est voulu — `tokio_postgres::Client` ne pipeline pas les requêtes d'une
    /// même connexion, et laisser croire le contraire produirait des résultats entrelacés.
    ///
    /// **Le `Future` boxé doit être `Send`**, sans quoi les commandes Tauri le refusent : elles
    /// s'exécutent sur un exécuteur multi-fils. C'est la même contrainte que `06a` a rencontrée
    /// sur `EngineAdapter`, et pour la même raison.
    pub async fn avec<T, F>(&self, cle: &str, operation: F) -> Result<T, EngineError>
    where
        F: for<'a> FnOnce(
            &'a AnyEngine,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<T, EngineError>> + Send + 'a>,
        >,
    {
        let garde = self.ouvertes.lock().await;
        let adaptateur = garde.get(cle).ok_or_else(|| {
            EngineError::local(format!(
                "aucune connexion ouverte pour « {cle} » — la base doit être ouverte avant d'être \
                 interrogée"
            ))
        })?;
        operation(adaptateur).await
    }

    /// Ferme une connexion et **attend** que le port de son tunnel soit rendu.
    ///
    /// Sans l'attente, `JoinHandle::abort` n'étant pas synchrone (`06e`), le port resterait pris
    /// quelques instants — invisible une fois, épuisant après cinquante ouvertures.
    pub async fn fermer(&self, cle: &str) {
        let adaptateur = self.ouvertes.lock().await.remove(cle);
        if let Some(adaptateur) = adaptateur {
            adaptateur.close().await;
        }
        self.etats.lock().await.remove(cle);
    }

    /// Le nombre de connexions ouvertes. Employé par les tests, et par rien d'autre.
    pub async fn ouvertes(&self) -> usize {
        self.ouvertes.lock().await.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_cle_est_celle_de_la_reference_de_secret() {
        // `08e` dérive la référence d'un secret du même triplet. Deux conventions divergentes
        // obligeraient à traduire de l'une à l'autre, et une traduction se désynchronise.
        assert_eq!(
            cle("Halle", "analytics", "prod"),
            crate::config::reference_de("Halle", "analytics", "prod").as_str()
        );
    }

    #[tokio::test]
    async fn une_base_inconnue_du_registre_est_jamais_tentee() {
        let registre = ConnectionRegistry::new();
        // Et non `Offline` : afficher en rouge une base qu'on n'a pas ouverte serait faux.
        assert_eq!(
            registre.etat("Halle/analytics/dev").await,
            ConnectionState::Never
        );
    }

    #[tokio::test]
    async fn interroger_une_base_non_ouverte_est_refuse_clairement() {
        let registre = ConnectionRegistry::new();
        let erreur = registre
            .avec::<(), _>("Halle/analytics/dev", |_| Box::pin(async { Ok(()) }))
            .await
            .expect_err("une base non ouverte doit être refusée");

        assert!(
            erreur.message.contains("aucune connexion ouverte"),
            "{erreur}"
        );
        assert!(erreur.code.is_none(), "échec local, donc sans SQLSTATE");
    }

    #[tokio::test]
    async fn fermer_une_base_inconnue_ne_panique_pas() {
        // Fermer deux fois, ou fermer ce qui n'a jamais été ouvert, arrive quand l'écran et le
        // registre se désynchronisent. Ce doit être sans effet, pas une panique.
        ConnectionRegistry::new()
            .fermer("Halle/analytics/dev")
            .await;
    }

    #[test]
    fn les_quatre_etats_se_serialisent_avec_leur_nature() {
        let cas = [
            (ConnectionState::Never, "never"),
            (ConnectionState::Connecting, "connecting"),
            (
                ConnectionState::Connected {
                    server_version: "PostgreSQL 17.6".into(),
                    tunnel_local_port: None,
                },
                "connected",
            ),
            (
                ConnectionState::Offline {
                    reason: "hôte injoignable".into(),
                },
                "offline",
            ),
        ];

        for (etat, attendu) in cas {
            let json = serde_json::to_value(&etat).expect("sérialisation");
            assert_eq!(json["kind"], attendu, "{json}");
        }
    }
}

/// Tests exigeant une vraie base. Lancés par le job Linux de la CI, et en local contre le
/// conteneur dédié — voir `postgres/mod.rs` pour la commande.
#[cfg(all(test, feature = "db-tests"))]
mod tests_db {
    use super::*;
    use crate::config::SslMode;

    fn variante() -> ConnectionSettings {
        let url = std::env::var("DORABASE_TEST_PG")
            .expect("DORABASE_TEST_PG doit être défini pour les tests de base");
        let analysee: tokio_postgres::Config = url.parse().expect("URL de test analysable");
        let hote = analysee
            .get_hosts()
            .first()
            .map(|h| match h {
                tokio_postgres::config::Host::Tcp(nom) => nom.clone(),
                _ => panic!("l'adresse de test doit être TCP"),
            })
            .expect("un hôte");

        ConnectionSettings {
            host: hote,
            port: *analysee.get_ports().first().expect("un port"),
            default_database: analysee.get_dbname().expect("une base").to_owned(),
            username: analysee.get_user().expect("un utilisateur").to_owned(),
            password: None,
            ssl_mode: SslMode::Prefer,
            ca_certificate: None,
            auth_database: None,
            read_only: false,
            reconnect_on_startup: false,
            tunnel: None,
        }
    }

    fn secret() -> Option<Secret> {
        let url = std::env::var("DORABASE_TEST_PG").expect("DORABASE_TEST_PG");
        let analysee: tokio_postgres::Config = url.parse().expect("URL");
        analysee
            .get_password()
            .map(|octets| Secret::new(String::from_utf8_lossy(octets).into_owned()))
    }

    fn known_hosts() -> std::path::PathBuf {
        // Aucun tunnel dans ces tests : le chemin n'est jamais lu, mais le passer explicitement
        // évite de toucher le `~/.ssh/known_hosts` de la machine.
        std::path::PathBuf::from("/aucun/known_hosts")
    }

    /// **Le point du registre.** `09d` déplie un schéma puis une table : chaque commande
    /// rouvrant une connexion épuiserait les ports et ajouterait une poignée de main par clic.
    ///
    /// **Ce test a d'abord été écrit trop faible.** Il comptait les entrées du registre après
    /// deux ouvertures et attendait 1 — mais sans la garde de réemploi, la seconde ouverture
    /// *remplace* l'entrée, et le compte reste 1 de toute façon. Retirer la garde laissait donc
    /// le test vert, alors que la première connexion était lâchée sans `close` et fuyait son
    /// tunnel.
    ///
    /// La version qui mord : la seconde ouverture emploie une variante **cassée**. Avec la
    /// garde, elle rend sans rien tenter et la connexion reste vivante ; sans elle, la tentative
    /// échoue et l'état bascule en `Offline`.
    /// **Le chemin exact que prend `read_rows` (`10c`)** : ouvrir, puis lire une fenêtre par
    /// `avec`. `06d` a testé l'adaptateur ; ce test-ci vérifie que la commande a bien un chemin
    /// jusqu'à lui, ce qu'aucun test ne faisait — la couche était complète et personne ne la
    /// franchissait.
    #[tokio::test]
    async fn lire_une_fenetre_par_le_registre_rend_la_limite_demandee() {
        let registre = ConnectionRegistry::new();
        let cle = "Halle/analytics/dev";
        registre
            .ouvrir(
                cle,
                crate::config::Engine::PostgreSql,
                &variante(),
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect("ouverture");

        let requete = crate::engine::RowQuery::new(
            "introspection",
            "grande",
            crate::engine::RowLimit::FiveHundred,
        );
        let fenetre = registre
            .avec(cle, move |adaptateur| {
                Box::pin(async move { adaptateur.rows(&requete).await })
            })
            .await
            .expect("lecture");

        assert_eq!(fenetre.rows.len(), 500, "la table porte cent mille lignes");
        assert!(fenetre.sql.contains("limit 500"), "{}", fenetre.sql);

        registre.fermer(cle).await;
    }

    /// Lire une base **non ouverte** doit dire pourquoi, et non rendre une fenêtre vide.
    ///
    /// Une fenêtre vide se confondrait avec une table sans ligne, et `A5` afficherait « aucune
    /// ligne » sur une base parfaitement peuplée mais fermée.
    #[tokio::test]
    async fn lire_une_base_non_ouverte_echoue_avec_un_message_qui_le_dit() {
        let registre = ConnectionRegistry::new();
        let requete = crate::engine::RowQuery::new(
            "introspection",
            "petite",
            crate::engine::RowLimit::OneHundred,
        );
        let erreur = registre
            .avec("Halle/jamais/dev", move |adaptateur| {
                Box::pin(async move { adaptateur.rows(&requete).await })
            })
            .await
            .expect_err("une base fermée ne peut pas être lue");

        assert!(erreur.message.contains("ouverte"), "{}", erreur.message);
    }

    #[tokio::test]
    async fn ouvrir_deux_fois_la_meme_base_ne_retente_rien() {
        let registre = ConnectionRegistry::new();
        let cle = "Halle/analytics/dev";

        registre
            .ouvrir(
                cle,
                crate::config::Engine::PostgreSql,
                &variante(),
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect("première ouverture");

        let mut cassee = variante();
        cassee.port = 1; // rien n'écoute
        registre
            .ouvrir(
                cle,
                crate::config::Engine::PostgreSql,
                &cassee,
                None,
                &known_hosts(),
            )
            .await
            .expect("la seconde ouverture doit rendre sans rien tenter");

        assert_eq!(registre.ouvertes().await, 1);
        assert!(
            matches!(registre.etat(cle).await, ConnectionState::Connected { .. }),
            "la connexion vivante a été remplacée : {:?}",
            registre.etat(cle).await
        );

        registre.fermer(cle).await;
    }

    #[tokio::test]
    async fn une_base_ouverte_passe_a_connectee_avec_sa_version() {
        let registre = ConnectionRegistry::new();
        let cle = "Halle/analytics/dev";

        assert_eq!(registre.etat(cle).await, ConnectionState::Never);
        registre
            .ouvrir(
                cle,
                crate::config::Engine::PostgreSql,
                &variante(),
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect("ouverture");

        match registre.etat(cle).await {
            ConnectionState::Connected { server_version, .. } => {
                assert!(server_version.starts_with("PostgreSQL"), "{server_version}");
            }
            autre => panic!("attendu Connected, obtenu {autre:?}"),
        }

        registre.fermer(cle).await;
    }

    /// **Une base injoignable n'empêche pas les autres de s'ouvrir.** C'est ce qui rend l'arbre
    /// lisible sans réseau : un hôte muet marque sa propre ligne, il ne bloque pas l'écran.
    #[tokio::test]
    async fn une_base_injoignable_n_empeche_pas_les_autres() {
        let registre = ConnectionRegistry::new();

        let mut muette = variante();
        muette.port = 1; // rien n'écoute
        registre
            .ouvrir(
                "Halle/muette/dev",
                crate::config::Engine::PostgreSql,
                &muette,
                None,
                &known_hosts(),
            )
            .await
            .expect_err("un port fermé doit échouer");

        registre
            .ouvrir(
                "Halle/analytics/dev",
                crate::config::Engine::PostgreSql,
                &variante(),
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect("la base joignable doit s'ouvrir malgré l'échec de l'autre");

        assert!(matches!(
            registre.etat("Halle/muette/dev").await,
            ConnectionState::Offline { .. }
        ));
        assert!(matches!(
            registre.etat("Halle/analytics/dev").await,
            ConnectionState::Connected { .. }
        ));

        registre.fermer("Halle/analytics/dev").await;
    }

    #[tokio::test]
    async fn fermer_retire_la_connexion_et_son_etat() {
        let registre = ConnectionRegistry::new();
        let cle = "Halle/analytics/dev";

        registre
            .ouvrir(
                cle,
                crate::config::Engine::PostgreSql,
                &variante(),
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect("ouverture");
        registre.fermer(cle).await;

        assert_eq!(registre.ouvertes().await, 0);
        // Et non `Offline` : refermer volontairement n'est pas un échec.
        assert_eq!(registre.etat(cle).await, ConnectionState::Never);
    }

    #[tokio::test]
    async fn une_base_ouverte_repond_a_l_introspection() {
        let registre = ConnectionRegistry::new();
        let cle = "Halle/analytics/dev";
        registre
            .ouvrir(
                cle,
                crate::config::Engine::PostgreSql,
                &variante(),
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect("ouverture");

        let objets = registre
            .avec(cle, |adaptateur| {
                Box::pin(async move { adaptateur.objects("introspection").await })
            })
            .await
            .expect("introspection");

        // 4 tables et 1 vue dans le schéma de test, dont la composition est connue.
        // Cinq tables et une vue depuis le 10 août 2026 : `montants` couvre le cas `numeric`.
        // Six tables depuis le 12 août 2026 : `identites` couvre les deux formes d'identité.
        assert_eq!(objets.len(), 7);

        registre.fermer(cle).await;
    }

    /// L'échec d'ouverture porte le message du moteur, qui dit déjà la manœuvre.
    #[tokio::test]
    async fn un_echec_d_ouverture_garde_le_message_du_moteur() {
        let registre = ConnectionRegistry::new();
        let mut inconnue = variante();
        inconnue.default_database = "base_qui_n_existe_pas".into();

        registre
            .ouvrir(
                "Halle/inconnue/dev",
                crate::config::Engine::PostgreSql,
                &inconnue,
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect_err("une base inconnue doit échouer");

        match registre.etat("Halle/inconnue/dev").await {
            ConnectionState::Offline { reason } => {
                assert!(reason.contains("base_qui_n_existe_pas"), "{reason}");
            }
            autre => panic!("attendu Offline, obtenu {autre:?}"),
        }
    }

    /// Qu'aucun mot de passe ne se retrouve dans un état exposé au front.
    ///
    /// Contrôle **positif** compris : la sentinelle traverse bien l'ouverture.
    #[tokio::test]
    async fn aucun_mot_de_passe_dans_les_etats() {
        let sentinelle = "SENTINELLE-registre-42";
        let registre = ConnectionRegistry::new();
        let mut mauvaise = variante();
        mauvaise.username = "utilisateur_inexistant".into();

        registre
            .ouvrir(
                "Halle/mauvaise/dev",
                crate::config::Engine::PostgreSql,
                &mauvaise,
                Some(&Secret::new(sentinelle)),
                &known_hosts(),
            )
            .await
            .expect_err("un utilisateur inexistant doit échouer");

        // Contrôle positif : la sentinelle est bien celle qu'on a passée.
        assert_eq!(Secret::new(sentinelle).expose(), sentinelle);

        let etats = registre.etats().await;
        let rendu = serde_json::to_string(&etats).expect("sérialisation");
        assert!(
            !rendu.contains(sentinelle),
            "un état exposé au front contient le mot de passe : {rendu}"
        );
    }
}
