//! Les commandes IPC de l'export et de l'import d'un dump.
//!
//! **Aucune ne rend le contenu du dump.** Le `stdout` du fils va dans le fichier ; la
//! webview ne reçoit que des octets comptés et un verdict. C'est la contrainte transverse
//! du projet sur l'IPC, et ici elle est respectée par construction.
//!
//! Comme celles de `05b` et `09b`, ces commandes sont **définies par l'app** et donc hors
//! du système d'ACL de Tauri : aucune entrée à ajouter dans `capabilities/default.json`.
//! Ce que `22b` y ajoute, c'est `dialog:allow-save` — la permission du **sélecteur de
//! fichier**, appelé depuis le front, pas celle de ces commandes.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::Serialize;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use ts_rs::TS;

use super::discover::{analyser_version, decouvrir};
use super::postgres::PostgresDumpTool;
use super::run::{exporter, importer, Annulation, DumpError};
use super::{Cible, DumpAvailability, Version};
use crate::config::ConnectionSettings;
use crate::engine::commands::DatabaseKey;
use crate::engine::registry::{ConnectionRegistry, ConnectionState};
use crate::secrets::Secret;

/// L'événement de progression, en **octets écrits**. Sans total ni pourcentage : la taille
/// finale d'un `pg_dump --format=plain` est inconnaissable avant la fin.
pub const EVENEMENT_PROGRESSION: &str = "dump://progression";

/// Ce qu'un échec de dump dit au front.
///
/// **`kind` en plus du message** : la modale doit pouvoir traiter « tronqué » et « annulé »
/// autrement qu'un échec quelconque, et reconnaître un cas en cherchant un mot dans une
/// phrase française serait un couplage au libellé.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "dump.ts")]
pub struct DumpFailure {
    pub kind: String,
    pub message: String,
}

impl DumpFailure {
    fn locale(message: impl Into<String>) -> Self {
        Self {
            kind: "locale".into(),
            message: message.into(),
        }
    }
}

impl From<DumpError> for DumpFailure {
    fn from(erreur: DumpError) -> Self {
        let kind = match &erreur {
            DumpError::Annule => "annule",
            DumpError::Lancement { .. } => "lancement",
            DumpError::Fichier { .. } => "fichier",
            DumpError::Echec { .. } => "echec",
            DumpError::Tronque => "tronque",
        };
        Self {
            kind: kind.into(),
            message: erreur.to_string(),
        }
    }
}

/// Les annulations en cours, une par base.
///
/// Rangée dans l'état Tauri, comme le registre de `09b` : `cancel_export` et `start_export`
/// sont deux commandes distinctes, donc le jeton doit survivre entre les deux.
#[derive(Default)]
pub struct DumpState {
    en_cours: Mutex<HashMap<String, Annulation>>,
}

impl DumpState {
    pub fn new() -> Self {
        Self::default()
    }

    async fn armer(&self, identite: &str) -> Annulation {
        let annulation = Annulation::nouvelle();
        self.en_cours
            .lock()
            .await
            .insert(identite.to_owned(), annulation.clone());
        annulation
    }

    async fn desarmer(&self, identite: &str) {
        self.en_cours.lock().await.remove(identite);
    }

    async fn annuler(&self, identite: &str) -> bool {
        match self.en_cours.lock().await.get(identite) {
            Some(annulation) => {
                annulation.annuler();
                true
            }
            None => false,
        }
    }
}

/// La requête d'export ou d'import : celle du contrat (`config::requetes`), désignée par
/// l'identifiant de la connexion (#165).
pub use crate::config::requetes::DumpRequest;

/// Où se connecter, et quelle version de serveur juger.
///
/// **Le cas tunnelé est le seul qui exige que la base soit ouverte.** Le tunnel de `06e` ne
/// vit que tant que la connexion est dans le registre de `09b`, et son port local vient de
/// `connection_states` : sans base ouverte, il n'y a aucun port où envoyer `pg_dump`. Le
/// dire est tout l'objet de cette fonction — une erreur réseau brute (« connection
/// refused ») ferait chercher une panne là où il suffit d'ouvrir la base.
pub async fn cible_et_version(
    registre: &ConnectionRegistry,
    key: &DatabaseKey,
    variante: &ConnectionSettings,
    secret: Option<&Secret>,
) -> Result<(Cible, Version), DumpFailure> {
    let identite = key.cle();
    let etat = registre.etat(&identite).await;

    // Tout ce qui ne dépend pas du chemin — direct ou tunnelé — est pris une fois ici. Le
    // transport en fait partie (#82) : le mode SSL et l'autorité sont ceux de la variante dans
    // les deux cas, comme pour le pilote Rust, qui les applique aussi au bout local d'un tunnel.
    let cible = |hote: String, port: u16| Cible {
        hote,
        port,
        base: variante.default_database.clone(),
        utilisateur: variante.username.clone(),
        ssl_mode: variante.ssl_mode,
        ca_certificate: variante.ca_certificate.clone(),
    };

    match (&etat, variante.tunnel.is_some()) {
        // Ouverte, tunnelée : l'hôte et le port sont ceux du **tunnel**, jamais ceux de la
        // variante — celle-ci porte l'adresse de la base vue depuis le bastion.
        (
            ConnectionState::Connected {
                server_version,
                tunnel_local_port,
            },
            true,
        ) => {
            let port = tunnel_local_port.ok_or_else(|| {
                DumpFailure::locale(
                    "la connexion est ouverte mais sans port de tunnel : refermer puis \
                     ouvrir la base",
                )
            })?;
            Ok((cible("127.0.0.1".into(), port), version_de(server_version)?))
        }
        // Ouverte, directe : les réglages de la variante suffisent, et la version est déjà
        // connue — inutile de sonder une deuxième fois.
        (ConnectionState::Connected { server_version, .. }, false) => Ok((
            cible(variante.host.clone(), variante.port),
            version_de(server_version)?,
        )),
        // Fermée, tunnelée : refus explicite, **avant** de lancer quoi que ce soit.
        (_, true) => Err(DumpFailure::locale(format!(
            "la base de données « {} » passe par un tunnel SSH : il faut l'ouvrir dans l'arbre avant \
             d'exporter ou d'importer, le tunnel ne vit que tant qu'elle est ouverte",
            key.connection
        ))),
        // Fermée, directe : la version du serveur manque, donc on la demande. C'est le seul
        // aller-retour réseau de cette fonction, et il évite d'exiger une base ouverte là
        // où les réglages suffisent.
        (_, false) => {
            let adaptateur = crate::engine::postgres::PostgresAdapter::connect(variante, secret)
                .await
                .map_err(|erreur| DumpFailure::locale(erreur.message))?;
            let sonde = {
                use crate::engine::EngineAdapter;
                let sonde = adaptateur.probe().await;
                adaptateur.close().await;
                sonde.map_err(|erreur| DumpFailure::locale(erreur.message))?
            };
            Ok((
                cible(variante.host.clone(), variante.port),
                version_de(&sonde.server_version)?,
            ))
        }
    }
}

fn version_de(annonce: &str) -> Result<Version, DumpFailure> {
    analyser_version(annonce).ok_or_else(|| {
        DumpFailure::locale(format!(
            "version de serveur illisible dans « {annonce} » : impossible de juger la \
             version de l'outil"
        ))
    })
}

/// Ce que la modale reçoit à l'ouverture : le verdict, et le transport **réellement employé**.
///
/// **Le transport est dit dans la modale** (#82) : l'audit avait trouvé des dumps partis en
/// clair sans que rien ne le signale, et une connexion testée dans `A2` porte déjà sa mention
/// « TLS non vérifié ». `None` quand le moteur n'a pas d'outil local — il n'y a rien à lancer,
/// donc aucun transport à décrire.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "dump.ts")]
pub struct DumpVerdict {
    pub availability: DumpAvailability,
    pub transport: Option<super::postgres::DumpTransport>,
}

/// Le verdict de disponibilité, pour l'export ou pour l'import.
///
/// **L'entrée de menu reste active dans les cinq cas.** Un item de menu natif désactivé ne
/// peut pas être cliqué : le motif serait inatteignable. C'est cette commande, et la modale
/// qui l'affiche, qui délivrent le verdict.
#[tauri::command]
pub async fn dump_availability(
    request: DumpRequest,
    import: bool,
    app: tauri::AppHandle,
    registry: tauri::State<'_, ConnectionRegistry>,
) -> Result<DumpVerdict, DumpFailure> {
    log::info!(
        "dump_availability ← {} ({}) {}",
        request.key.connection,
        if import { "import" } else { "export" },
        request.variant.host
    );

    // Le verdict de moteur passe **avant** tout accès réseau : un BigQuery n'a pas d'outil
    // local, et le sonder pour l'apprendre serait absurde.
    if let Some(verdict) = DumpAvailability::pour_moteur(request.engine) {
        log::info!("dump_availability → {verdict:?}");
        return Ok(DumpVerdict {
            availability: verdict,
            transport: None,
        });
    }

    let secret = relire_le_secret(&app, &request.variant)?;
    let (cible, version) =
        cible_et_version(&registry, &request.key, &request.variant, secret.as_ref()).await?;

    let outil = PostgresDumpTool;
    let binaire = if import {
        <PostgresDumpTool as super::DumpTool>::binaire_import(&outil)
    } else {
        <PostgresDumpTool as super::DumpTool>::binaire_export(&outil)
    };
    let verdict = decouvrir(binaire, version);
    log::info!("dump_availability → {verdict:?}");
    Ok(DumpVerdict {
        availability: verdict,
        // La cible qu'`start_export` et `start_import` recalculeront est la même : la variante
        // et l'état du registre, que rien ne change entre l'ouverture de la modale et le clic.
        transport: Some(super::postgres::transport_de(
            cible.ssl_mode,
            cible.ca_certificate.as_deref(),
        )),
    })
}

/// Lance l'export et **attend** sa fin. La progression part par événement.
#[tauri::command]
pub async fn start_export(
    request: DumpRequest,
    app: tauri::AppHandle,
    registry: tauri::State<'_, ConnectionRegistry>,
    dumps: tauri::State<'_, DumpState>,
) -> Result<u64, DumpFailure> {
    let identite = request.key.cle();
    let fichier = PathBuf::from(&request.file);
    log::info!("start_export ← {identite} vers {}", fichier.display());

    let secret = relire_le_secret(&app, &request.variant)?;
    let (cible, version) =
        cible_et_version(&registry, &request.key, &request.variant, secret.as_ref()).await?;

    let outil = PostgresDumpTool;
    let binaire = match decouvrir("pg_dump", version) {
        DumpAvailability::Ready { tool, .. } => tool,
        // Le verdict est déjà affiché par la modale ; y arriver ici veut dire que l'outil a
        // disparu entre le verdict et le clic.
        autre => {
            return Err(DumpFailure::locale(format!(
                "pg_dump n'est plus disponible : {autre:?}"
            )))
        }
    };

    let annulation = dumps.armer(&identite).await;
    let vers_la_webview = app.clone();
    let issue = exporter(
        &outil,
        &binaire,
        &cible,
        secret.as_ref(),
        &fichier,
        move |octets| {
            // L'échec d'un événement de progression n'a pas à emporter le dump.
            let _ = vers_la_webview.emit(EVENEMENT_PROGRESSION, octets);
        },
        &annulation,
    )
    .await;
    dumps.desarmer(&identite).await;

    match issue {
        Ok(octets) => {
            log::info!("start_export → {octets} octets écrits");
            Ok(octets)
        }
        Err(erreur) => {
            log::info!("start_export → échec : {erreur}");
            Err(erreur.into())
        }
    }
}

/// Demande l'annulation de l'export en cours sur cette base.
///
/// Rend `false` quand il n'y avait rien à annuler — un état normal, pas une erreur : la
/// modale a pu se fermer entre la fin du dump et le clic.
#[tauri::command]
pub async fn cancel_export(
    key: DatabaseKey,
    dumps: tauri::State<'_, DumpState>,
) -> Result<bool, DumpFailure> {
    let identite = key.cle();
    let annule = dumps.annuler(&identite).await;
    log::info!("cancel_export ← {identite} : {annule}");
    Ok(annule)
}

/// Rejoue un dump vers la base cible. Voir `22c` pour le garde-fou qui précède.
#[tauri::command]
pub async fn start_import(
    request: DumpRequest,
    app: tauri::AppHandle,
    config: tauri::State<'_, crate::config::ConfigState>,
    registry: tauri::State<'_, ConnectionRegistry>,
    dumps: tauri::State<'_, DumpState>,
) -> Result<(), DumpFailure> {
    let identite = request.key.cle();
    let fichier = PathBuf::from(&request.file);
    log::info!("start_import ← {identite} depuis {}", fichier.display());

    // **La lecture seule refuse avant toute autre étape** : avant la découverte du binaire, avant
    // l'inspection du fichier, avant la modale : une connexion en lecture seule ne doit même pas
    // voir la question posée. **Lue dans la configuration** (#168), par `key.connection` — la
    // variante envoyée par l'écran n'est pas crue sur parole.
    refuser_si_lecture_seule(&config, &request.key)?;

    let secret = relire_le_secret(&app, &request.variant)?;
    let (cible, version) =
        cible_et_version(&registry, &request.key, &request.variant, secret.as_ref()).await?;

    // L'inspection du fichier vient avant `psql`, et c'est tout l'objet de `22c` : un dump
    // tronqué s'importe sinon partiellement, en silence, avec `exit=0`.
    super::inspect::exiger_importable(&fichier, version)?;

    let binaire = match decouvrir("psql", version) {
        DumpAvailability::Ready { tool, .. } => tool,
        autre => {
            return Err(DumpFailure::locale(format!(
                "psql n'est plus disponible : {autre:?}"
            )))
        }
    };

    let annulation = dumps.armer(&identite).await;
    let issue = importer(
        &PostgresDumpTool,
        &binaire,
        &cible,
        secret.as_ref(),
        &fichier,
        &annulation,
    )
    .await;
    dumps.desarmer(&identite).await;

    match issue {
        Ok(()) => {
            log::info!("start_import → import terminé");
            Ok(())
        }
        Err(erreur) => {
            log::info!("start_import → échec : {erreur}");
            Err(erreur.into())
        }
    }
}

/// Ce que l'inspection d'un fichier dit au front, avant toute confirmation.
#[tauri::command]
pub async fn inspect_dump(
    file: String,
    request: DumpRequest,
    app: tauri::AppHandle,
    config: tauri::State<'_, crate::config::ConfigState>,
    registry: tauri::State<'_, ConnectionRegistry>,
) -> Result<super::inspect::Inspection, DumpFailure> {
    refuser_si_lecture_seule(&config, &request.key)?;
    let secret = relire_le_secret(&app, &request.variant)?;
    let (_cible, version) =
        cible_et_version(&registry, &request.key, &request.variant, secret.as_ref()).await?;
    let inspection = super::inspect::inspecter(std::path::Path::new(&file), version);
    log::info!("inspect_dump → {inspection:?}");
    Ok(inspection)
}

/// Le refus de la lecture seule **effective**, avec **où** elle se lève (#168).
///
/// **La configuration, jamais `request.variant`** : c'était le défaut d'avant #168, et il est celui
/// que le cadrage désignait — le drapeau venait de la webview, donc le cœur croyait l'écran sur
/// parole. Une connexion sous un dossier en lecture seule a le plus souvent un réglage local
/// inscriptible ; lu sur la variante, l'import serait passé.
fn refuser_si_lecture_seule(
    config: &crate::config::ConfigState,
    key: &DatabaseKey,
) -> Result<(), DumpFailure> {
    crate::config::commands::refuser_si_lecture_seule(
        config,
        &key.connection,
        "importer un dump, qui écrirait dans la base",
    )
    .map_err(|message| DumpFailure {
        kind: "lectureSeule".into(),
        message,
    })
}

/// Relit le mot de passe depuis le magasin, comme `open_database`.
///
/// **Le mot de passe se relit, il ne se redemande pas** : la variante ne porte qu'une
/// `SecretRef` (`08e`). `Ok(None)` est un état normal — une base sans mot de passe.
fn relire_le_secret(
    app: &tauri::AppHandle,
    variante: &ConnectionSettings,
) -> Result<Option<Secret>, DumpFailure> {
    let Some(reference) = &variante.password else {
        return Ok(None);
    };

    let repertoire = app.path().app_config_dir().map_err(|e| {
        DumpFailure::locale(format!("répertoire de configuration introuvable : {e}"))
    })?;
    let magasin = crate::secrets::selectionner(&repertoire)
        .map_err(|e| DumpFailure::locale(format!("magasin de secrets indisponible : {e}")))?;
    magasin
        .store
        .retrieve(reference)
        .map_err(|e| DumpFailure::locale(format!("le mot de passe n'a pas pu être relu : {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Proxy, ProxySsh, SslMode, Tunnel};

    fn variante_tunnelee_fermee() -> ConnectionSettings {
        ConnectionSettings {
            // L'adresse de la base **vue depuis le bastion** : injoignable d'ici, ce qui est
            // le propre d'une variante tunnelée.
            host: "db.interne".into(),
            port: 5432,
            default_database: "commandes".into(),
            username: "dorabase".into(),
            password: None,
            ssl_mode: SslMode::Disable,
            ca_certificate: None,
            auth_database: None,
            read_only: false,
            reconnect_on_startup: false,
            tunnel: Some(Tunnel {
                local_port: None,
                // Depuis `05d`, ce qui varie entre les sortes de proxy est une énumération
                // à données : un bastion SSH ne peut plus porter un nom d'instance Cloud SQL.
                proxy: Proxy::Ssh(ProxySsh {
                    bastion_host: "bastion.interne".into(),
                    bastion_port: 22,
                    username: "jump".into(),
                    private_key_path: "/dev/null".into(),
                }),
            }),
        }
    }

    fn cle_de_test() -> DatabaseKey {
        DatabaseKey {
            connection: crate::config::ConnectionId::brut("commandes"),
        }
    }

    #[tokio::test]
    async fn un_export_sur_connexion_tunnelee_fermee_dit_d_ouvrir_la_base() {
        // Le tunnel ne vit que tant que la connexion est ouverte dans le registre de `09b` :
        // sans base ouverte, il n'y a aucun port local où envoyer `pg_dump`.
        let registre = ConnectionRegistry::new();
        let erreur = cible_et_version(&registre, &cle_de_test(), &variante_tunnelee_fermee(), None)
            .await
            .expect_err("une variante tunnelée fermée ne peut pas être exportée");

        assert!(
            erreur.message.contains("ouvrir"),
            "message inutilisable : {}",
            erreur.message
        );
        // Ce qui distingue ce refus d'une panne : aucune erreur réseau brute, parce que rien
        // n'a été tenté.
        assert!(
            !erreur.message.contains("connection refused"),
            "erreur réseau brute : {}",
            erreur.message
        );
        assert!(erreur.message.contains("tunnel"), "{}", erreur.message);
    }

    /// Une configuration lue, qui range `commandes` sous un dossier en lecture seule — avec un
    /// réglage **local inscriptible**, comme toute connexion migrée d'un environnement de production.
    fn configuration_sous_un_dossier_en_lecture_seule(
        repertoire: &std::path::Path,
        dossier_en_lecture_seule: bool,
    ) -> crate::config::ConfigState {
        use crate::config::{ConfigStore, FolderTree};
        let mut base = crate::config::arbre_de_test::base("commandes", false);
        base.connection = variante_tunnelee_fermee();
        let mut dossier =
            crate::config::arbre_de_test::dossier("prod", "prod", dossier_en_lecture_seule);
        dossier.connections.push(base);
        let arbre = FolderTree {
            folders: vec![dossier],
            connections: Vec::new(),
        };
        let (store, _) = ConfigStore::open(repertoire.join("config.json"));
        crate::config::commands::ecrire_le_reste_intact(&store, &arbre).expect("écrit");
        crate::config::ConfigState::ouvert(store)
    }

    #[tokio::test]
    async fn l_import_refuse_la_lecture_seule_de_la_configuration_meme_si_la_variante_dit_non() {
        // **Le défaut d'avant #168, et le sabotage qui le garde** : la variante envoyée dit
        // `readOnly: false` — c'est le cas de toute connexion migrée d'un environnement de
        // production —, et c'est le dossier qui impose. Relire `variant.read_only` fait tomber ce
        // test.
        let repertoire = tempfile::tempdir().expect("répertoire");
        let config = configuration_sous_un_dossier_en_lecture_seule(repertoire.path(), true);
        let erreur = refuser_si_lecture_seule(&config, &cle_de_test()).expect_err("refus attendu");
        assert_eq!(erreur.kind, "lectureSeule");
        assert!(
            erreur.message.contains("imposée par le dossier « prod »"),
            "le message ne dit pas où lever la lecture seule : {}",
            erreur.message
        );

        // Contrôle positif : le même décor, dossier levé, laisse passer.
        let repertoire = tempfile::tempdir().expect("répertoire");
        let config = configuration_sous_un_dossier_en_lecture_seule(repertoire.path(), false);
        assert!(refuser_si_lecture_seule(&config, &cle_de_test()).is_ok());
    }

    #[test]
    fn un_echec_de_dump_garde_son_espece() {
        // La modale traite « tronqué » et « annulé » autrement qu'un échec quelconque, et
        // reconnaître un cas en cherchant un mot dans une phrase serait un couplage au
        // libellé.
        assert_eq!(DumpFailure::from(DumpError::Tronque).kind, "tronque");
        assert_eq!(DumpFailure::from(DumpError::Annule).kind, "annule");
        assert_eq!(
            DumpFailure::from(DumpError::Echec {
                binaire: "pg_dump".into(),
                code: Some(1),
                stderr: "erreur".into()
            })
            .kind,
            "echec"
        );
    }
}
