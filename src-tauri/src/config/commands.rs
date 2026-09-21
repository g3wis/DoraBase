//! Les commandes IPC de la configuration.
//!
//! Ces commandes sont **définies par l'app**, donc hors du système d'ACL de Tauri : aucune
//! entrée à ajouter dans `capabilities/default.json` — les capacités ne gouvernent que les
//! appels venant de la webview. Seule la résolution du chemin passe par `core:path:default`,
//! déjà accordé.

use std::collections::BTreeMap;

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use ts_rs::TS;

use super::model::{Kubeconfigs, ManagedInstance, Preferences, Project};
use super::store::{ConfigStore, LoadOutcome};

/// Nom du fichier dans le répertoire de configuration de l'app.
const NOM_FICHIER: &str = "config.json";

/// L'issue de lecture telle qu'elle traverse l'IPC.
///
/// Distincte de `LoadOutcome` : le front n'a pas besoin du chemin de quarantaine pour
/// décider quoi afficher, et lui envoyer un chemin absolu du disque de l'utilisateur
/// n'apporterait rien. Il a besoin de savoir **s'il peut écrire**.
// `rename_all` renomme les **variantes**, `rename_all_fields` les champs de leurs
// structures : sans le second, `quarantined_to` restait en snake_case au milieu d'un
// fichier entièrement camelCase, et le front aurait mélangé deux conventions. Constaté en
// relisant la projection générée, pas en lisant ce code.
#[derive(Debug, Serialize, TS)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
#[ts(export_to = "config.ts")]
pub enum ConfigLoad {
    /// Aucun fichier : premier lancement, l'écran `A1` s'applique.
    Fresh,
    Loaded {
        projects: Vec<Project>,
        /// Les préférences (`15a`), **toujours présentes** : leur défaut est une valeur, pas une
        /// absence. Une configuration écrite avant `15a` en rend les valeurs du handoff.
        preferences: Preferences,
        /// Les instances managées (`API-32`), lues avec les projets.
        ///
        /// **Dans la même issue de lecture, et non par une commande à part.** Elles vivent dans le
        /// même fichier ; deux commandes en feraient deux lectures, donc deux instants, et l'écran
        /// aurait à composer deux réponses dont l'une peut échouer sans l'autre.
        instances: Vec<ManagedInstance>,
        /// Les kubeconfigs déclarés (`API-70`), lus avec les projets, **et pour la raison
        /// ci-dessus, qui vaut ici plus fort encore** : une connexion Kubernetes porte une
        /// référence, donc l'écran ne peut pas nommer le fichier d'une connexion sans eux. Les
        /// demander à part ferait rendre `A2` avant de savoir ce que sa liste contient.
        kubeconfigs: Kubeconfigs,
    },
    /// La configuration existe mais n'a pas pu être lue. **L'écriture est bloquée** — le
    /// front doit le dire à l'utilisateur au lieu de proposer de créer un projet, ce qui
    /// écraserait le fichier qu'on vient de refuser d'ouvrir.
    Unreadable {
        reason: String,
        /// Où l'original a été mis de côté, à montrer pour qu'il soit récupérable.
        quarantined_to: String,
    },
    /// Fichier écrit par une version postérieure de l'app. Écriture bloquée également.
    TooNew { found: u32, supported: u32 },
}

impl From<LoadOutcome> for ConfigLoad {
    fn from(issue: LoadOutcome) -> Self {
        match issue {
            LoadOutcome::Fresh => Self::Fresh,
            LoadOutcome::Loaded {
                projects,
                preferences,
                instances,
                kubeconfigs,
            } => Self::Loaded {
                projects,
                preferences,
                instances,
                kubeconfigs,
            },
            LoadOutcome::Unreadable {
                reason,
                quarantined_to,
            } => Self::Unreadable {
                reason,
                quarantined_to: quarantined_to.to_string_lossy().into_owned(),
            },
            LoadOutcome::TooNew { found, supported } => Self::TooNew { found, supported },
        }
    }
}

/// Le magasin vit dans l'état géré par Tauri : c'est ce qui fait survivre la propriété
/// « écriture refusée après lecture douteuse » d'un appel IPC au suivant. Rouvrir le
/// magasin à chaque commande la perdrait.
pub struct ConfigState(Mutex<Option<ConfigStore>>);

impl ConfigState {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

impl Default for ConfigState {
    fn default() -> Self {
        Self::new()
    }
}

/// Ce que `A2` envoie en mode édition (`08g`).
#[derive(Debug, Clone, serde::Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct UpdateVariantRequest {
    pub project: String,
    pub database: String,
    /// L'environnement **désigne** la variante ; il ne se modifie pas. Voir `08g`.
    pub environment: super::model::EnvironmentId,
    pub variant: super::model::ConnectionSettings,
    /// `None` laisse le mot de passe en place — un champ vide veut dire « inchangé ».
    pub password: Option<String>,
    /// Le libellé d'affichage (27 août 2026), **la valeur définitive** — contrairement au mot de
    /// passe, il n'est pas secret : le formulaire le renvoie toujours, vide y compris pour l'effacer.
    pub label: Option<String>,
}

fn chemin_configuration(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    // `app_config_dir()` résout en `config_dir()/<identifiant du bundle>` — sur macOS,
    // `~/Library/Application Support/…`. Jamais un chemin littéral : c'est ce qui garde
    // Windows et Linux ouverts.
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(NOM_FICHIER))
        .map_err(|erreur| format!("répertoire de configuration introuvable : {erreur}"))
}

#[tauri::command]
pub fn load_config(app: AppHandle, state: State<'_, ConfigState>) -> Result<ConfigLoad, String> {
    let chemin = chemin_configuration(&app)?;
    let (store, issue) = ConfigStore::open(chemin);

    let mut garde = state
        .0
        .lock()
        .map_err(|_| "état de configuration corrompu".to_owned())?;
    *garde = Some(store);

    Ok(issue.into())
}

#[tauri::command]
pub fn save_config(projects: Vec<Project>, state: State<'_, ConfigState>) -> Result<(), String> {
    let garde = state
        .0
        .lock()
        .map_err(|_| "état de configuration corrompu".to_owned())?;

    // Écrire sans avoir lu serait écrire à l'aveugle : on ne saurait pas si le fichier
    // existant est compréhensible.
    let store = garde
        .as_ref()
        .ok_or_else(|| "la configuration doit être lue avant d'être écrite".to_owned())?;

    // **Les préférences sont relues, pas reçues.** Le front n'envoie que les projets ; les écraser
    // par un état qu'il n'a pas modifié perdrait un réglage changé entre-temps. Même raison que
    // `load_projects` en `08e`.
    let preferences = store.load_preferences()?;
    // **Les instances aussi sont relues.** Le fichier est réécrit entier : ne pas les repasser
    // reviendrait à les effacer en enregistrant des projets.
    let instances = store.load_instances()?;
    // **Et les kubeconfigs** (`API-70`), pour la même raison : ne pas les repasser les effacerait,
    // et chaque connexion Kubernetes du fichier deviendrait une référence morte.
    let kubeconfigs = store.load_kubeconfigs()?;
    store
        .save(&projects, &preferences, &instances, &kubeconfigs)
        .map_err(|erreur| erreur.to_string())
}

/// Écrit les préférences (`15a`).
///
/// **Chaque réglage écrit immédiatement**, ce que « les préférences s'appliquent immédiatement »
/// engage : il n'y a pas de bouton « Appliquer », donc pas de formulaire tampon.
///
/// Les projets sont **relus**, symétriquement à `save_config` : enregistrer un thème ne doit pas
/// écraser une base créée dans un autre écran.
#[tauri::command]
pub fn save_preferences(
    preferences: Preferences,
    state: State<'_, ConfigState>,
) -> Result<Preferences, String> {
    let garde = state
        .0
        .lock()
        .map_err(|_| "état de configuration corrompu".to_owned())?;
    let store = garde
        .as_ref()
        .ok_or_else(|| "la configuration doit être lue avant d'être écrite".to_owned())?;

    let projects = store.load_projects()?;
    // **Bornées, et les valeurs bornées sont rendues.** Sans le retour, l'écran garderait 14 px
    // dans son curseur là où le disque porte 20 — deux vérités, dont la visible serait fausse.
    let bornees = preferences.borner();
    let instances = store.load_instances()?;
    let kubeconfigs = store.load_kubeconfigs()?;
    store
        .save(&projects, &bornees, &instances, &kubeconfigs)
        .map_err(|erreur| erreur.to_string())?;
    Ok(bornees)
}

/// Ce que `A2` envoie en cliquant « Enregistrer & ouvrir ».
///
/// Le mot de passe est **en clair et séparé**, comme dans `ConnectionRequest` de `08d` : aucune
/// `SecretRef` n'existe avant que le secret soit rangé, et c'est justement le travail de cette
/// commande. La variante reçue porte donc `password: null`, que `enregistrer` remplace.
#[derive(Debug, serde::Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct SaveDatabaseRequest {
    pub project: String,
    pub database: String,
    pub engine: super::model::Engine,
    /// L'environnement choisi dans `A2`, parmi ceux du projet (`23d`).
    pub environment: super::model::EnvironmentId,
    pub variant: super::model::ConnectionSettings,
    pub password: Option<String>,
    /// Le libellé d'affichage, saisi en fin de formulaire (27 août 2026). Vide ou absent : `database`
    /// fait foi partout où l'application l'affiche.
    pub label: Option<String>,
}

/// Ce que `08i` envoie pour renommer un projet.
#[derive(Debug, Clone, serde::Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct RenameProjectRequest {
    pub project: String,
    pub name: String,
}

/// Ce qu'un renommage réussi rend à l'écran — celui d'un projet (`08i`) comme celui d'une connexion
/// (`26`).
///
/// **Un seul type pour les deux**, et c'est pourquoi il ne s'appelle plus `RenameProjectResult` : les
/// deux commandes déplacent des secrets et ont exactement les mêmes trois choses à rapporter. Deux
/// types identiques auraient divergé au premier champ ajouté à l'un.
///
/// **Pas seulement les projets.** Deux faits méritent d'être dits plutôt que tus : des mots de passe
/// déclarés mais introuvables — les bases les redemanderont — et des originaux que le magasin n'a
/// pas su effacer. Les taire laisserait l'utilisateur découvrir l'un ou l'autre bien plus tard.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct RenameResult {
    pub projects: Vec<Project>,
    pub missing_secrets: Vec<String>,
    pub leftover_secrets: Vec<String>,
}

/// Ce que `26` envoie pour renommer une connexion.
///
/// **L'environnement est là parce qu'il fait partie de l'identité** (`23b`) : sans lui, renommer
/// « analytics » dans un projet qui la déclare en dev et en prod viserait la première venue.
#[derive(Debug, Clone, serde::Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct RenameDatabaseRequest {
    pub project: String,
    pub database: String,
    pub environment: super::model::EnvironmentId,
    pub name: String,
}

/// Ce que `08j` envoie pour retirer une déclaration de connexion.
#[derive(Debug, Clone, serde::Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct DeleteDatabaseRequest {
    pub project: String,
    pub database: String,
    /// **L'environnement fait partie de l'identité d'une connexion** (`23b`) : sans lui, retirer
    /// « analytics » d'un projet qui la déclare en dev et en prod supprimerait la première venue.
    pub environment: super::model::EnvironmentId,
}

/// Ce que `08j` envoie pour retirer un projet entier.
#[derive(Debug, Clone, serde::Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct DeleteProjectRequest {
    pub project: String,
}

/// Ce qu'une suppression rend à l'écran (`08j`).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct DeleteResult {
    pub projects: Vec<Project>,
    /// Les mots de passe que le magasin n'a pas su effacer : ils restent dans le Trousseau, et
    /// l'utilisateur a le droit de le savoir.
    pub leftover_secrets: Vec<String>,
}

/// Ce que l'écran envoie pour créer, écrire, renommer ou retirer une console.
///
/// **Elle porte l'identité complète de la connexion** — projet, base, environnement — là où
/// `SavedQueryRequest` de `12f` ne portait que le projet. C'est la conséquence directe du
/// déplacement des consoles sous la connexion : sans l'environnement, `analytics` en dev et
/// `analytics` en prod seraient confondues.
#[derive(Debug, Clone, serde::Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct ConsoleRequest {
    pub project: String,
    pub database: String,
    pub environment: super::model::EnvironmentId,
    pub name: String,
    /// Le texte, pour l'écriture. Ignoré par la création, le renommage et le retrait.
    pub sql: Option<String>,
    /// Le nouveau nom, pour le renommage.
    pub rename_to: Option<String>,
}

/// Ce que `A2` envoie pour créer un projet.
#[derive(Debug, Clone, serde::Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct CreateProjectRequest {
    pub name: String,
    /// Les environnements que le projet déclare (`24a`).
    ///
    /// **C'était l'environnement actif, seul.** La création se faisait depuis `A2`, qui ne connaissait
    /// que celui de la connexion en cours de déclaration ; le projet recevait le trio de `23a`, figé.
    /// Depuis `24a`, la création est un écran à part et les libellés y sont modifiables — parce que
    /// `23a` fige l'identifiant au libellé donné **à la création**, et que c'est donc le seul moment où
    /// renommer est sans dette.
    ///
    /// Vide, le cœur reprend le trio par défaut : c'est ce qui garde `08f` vrai pour un appelant qui
    /// n'a rien à en dire.
    #[serde(default)]
    pub environments: Vec<super::model::EnvironmentDeclaration>,
}

/// Crée un projet vide, et rend les projets à jour.
///
/// **Une commande distincte, et non un `save_database` plus permissif.** `enregistrer` refuse un
/// projet inconnu, et c'est une bonne chose : une commande qui créerait l'entité manquante par
/// effet de bord ferait d'une faute de frappe dans un nom de projet un second projet silencieux.
///
/// Sans elle, l'application neuve était une **impasse** : `08e` refuse l'enregistrement tant
/// qu'aucun projet n'existe, et rien ne permettait d'en faire un. Constaté à l'usage le 10 août
/// 2026, en essayant de déclarer une première connexion.
#[tauri::command]
pub fn create_project(
    request: CreateProjectRequest,
    state: State<'_, ConfigState>,
) -> Result<Vec<Project>, String> {
    let garde = state
        .0
        .lock()
        .map_err(|_| "état de configuration corrompu".to_owned())?;
    let store = garde
        .as_ref()
        .ok_or_else(|| "la configuration doit être lue avant d'être écrite".to_owned())?;

    // Les projets viennent du disque, pas du front : le même arbitrage qu'en `08e`, pour la même
    // raison — une liste envoyée par l'écran pourrait être périmée et écraser une écriture.
    let projects: Vec<Project> = store.load_projects()?;
    let suivants = super::enregistrer::creer_projet(&projects, &request.name, request.environments)
        .map_err(|erreur| erreur.to_string())?;

    ecrire_le_reste_intact(store, &suivants)?;
    log::info!(
        "create_project ← {} → {} projet(s)",
        request.name,
        suivants.len()
    );
    Ok(suivants)
}

/// Renomme un projet, en déplaçant ses mots de passe (`08i`).
///
/// **`async`, comme `update_variant` et pour la même raison** : les connexions ouvertes du projet
/// doivent être fermées, leur clé de registre portant l'ancien nom, et `fermer` attend la libération
/// du port d'un éventuel tunnel. L'attente a lieu **hors du verrou** de configuration, qui resterait
/// sinon indisponible aux autres commandes pendant une attente réseau.
#[tauri::command]
pub async fn rename_project(
    request: RenameProjectRequest,
    state: State<'_, ConfigState>,
    registry: State<'_, crate::engine::registry::ConnectionRegistry>,
) -> Result<RenameResult, String> {
    let (projects, renommage) = {
        let garde = state
            .0
            .lock()
            .map_err(|_| "état de configuration corrompu".to_owned())?;
        let store = garde
            .as_ref()
            .ok_or_else(|| "la configuration doit être lue avant d'être écrite".to_owned())?;

        // Les projets viennent du disque, pas du front : une liste envoyée par l'écran pourrait être
        // périmée et écraser une écriture. Même arbitrage qu'en `08e` et `08f`.
        let mut projects: Vec<Project> = store.load_projects()?;

        let repertoire = store
            .path()
            .parent()
            .ok_or_else(|| "le fichier de configuration n'a pas de répertoire parent".to_owned())?
            .to_path_buf();
        let magasin = crate::secrets::selectionner(&repertoire).map_err(|e| e.to_string())?;

        let renommage = super::enregistrer::renommer_projet(
            &mut projects,
            &request.project,
            &request.name,
            magasin.store.as_ref(),
            &mut |projets| ecrire_le_reste_intact(store, projets),
        )
        .map_err(|erreur| erreur.to_string())?;

        (projects, renommage)
    };

    for cle in &renommage.cles_a_fermer {
        registry.fermer(cle).await;
    }

    log::info!(
        "rename_project ← {} → {} : {} connexion(s) fermée(s), {} secret(s) absent(s), {} résidu(s)",
        request.project,
        request.name,
        renommage.cles_a_fermer.len(),
        renommage.secrets_absents.len(),
        renommage.residus.len()
    );

    Ok(RenameResult {
        projects,
        missing_secrets: renommage.secrets_absents,
        leftover_secrets: renommage.residus,
    })
}

/// Renomme une connexion, en déplaçant son mot de passe (`26`).
///
/// **`async`, comme `rename_project` et pour la même raison** : la connexion ouverte sous l'ancienne
/// clé doit être fermée, et `fermer` attend la libération du port d'un éventuel tunnel. L'attente a
/// lieu **hors du verrou** de configuration, qui resterait sinon indisponible aux autres commandes.
///
/// **Aucune donnée n'est touchée sur le serveur.** `name` n'entre dans aucune chaîne de connexion —
/// seul `default_database` y va. Cette commande ne reçoit aucun moteur et n'émet aucun SQL.
#[tauri::command]
pub async fn rename_database(
    request: RenameDatabaseRequest,
    state: State<'_, ConfigState>,
    registry: State<'_, crate::engine::registry::ConnectionRegistry>,
) -> Result<RenameResult, String> {
    let (projects, renommage) = {
        let garde = state
            .0
            .lock()
            .map_err(|_| "état de configuration corrompu".to_owned())?;
        let store = garde
            .as_ref()
            .ok_or_else(|| "la configuration doit être lue avant d'être écrite".to_owned())?;

        // Les projets viennent du disque, pas du front : une liste envoyée par l'écran pourrait être
        // périmée et écraser une écriture. Même arbitrage qu'en `08e`, `08f` et `08i`.
        let mut projects: Vec<Project> = store.load_projects()?;

        let repertoire = store
            .path()
            .parent()
            .ok_or_else(|| "le fichier de configuration n'a pas de répertoire parent".to_owned())?
            .to_path_buf();
        let magasin = crate::secrets::selectionner(&repertoire).map_err(|e| e.to_string())?;

        let renommage = super::enregistrer::renommer_connexion(
            &mut projects,
            &request.project,
            &request.environment,
            &request.database,
            &request.name,
            magasin.store.as_ref(),
            &mut |projets| ecrire_le_reste_intact(store, projets),
        )
        .map_err(|erreur| erreur.to_string())?;

        (projects, renommage)
    };

    for cle in &renommage.cles_a_fermer {
        registry.fermer(cle).await;
    }

    log::info!(
        "rename_database ← {}/{}/{} → {} : {} connexion(s) fermée(s), {} secret(s) absent(s), {} résidu(s)",
        request.project,
        request.database,
        request.environment.as_str(),
        request.name,
        renommage.cles_a_fermer.len(),
        renommage.secrets_absents.len(),
        renommage.residus.len()
    );

    Ok(RenameResult {
        projects,
        missing_secrets: renommage.secrets_absents,
        leftover_secrets: renommage.residus,
    })
}

/// Retire la **déclaration de connexion** d'une base, et son mot de passe (`08j`).
///
/// **Aucune donnée n'est touchée sur le serveur, et cette commande ne peut pas en toucher** : elle
/// ne reçoit aucun moteur, n'ouvre aucune connexion et n'émet aucun SQL. Elle en *ferme*, au
/// contraire — les connexions de la base retirée, dont la clé de registre n'a plus de déclaration.
#[tauri::command]
pub async fn delete_database(
    request: DeleteDatabaseRequest,
    state: State<'_, ConfigState>,
    registry: State<'_, crate::engine::registry::ConnectionRegistry>,
) -> Result<DeleteResult, String> {
    let suppression = {
        let garde = state
            .0
            .lock()
            .map_err(|_| "état de configuration corrompu".to_owned())?;
        let store = garde
            .as_ref()
            .ok_or_else(|| "la configuration doit être lue avant d'être écrite".to_owned())?;
        let projects: Vec<Project> = store.load_projects()?;
        let repertoire = store
            .path()
            .parent()
            .ok_or_else(|| "le fichier de configuration n'a pas de répertoire parent".to_owned())?
            .to_path_buf();
        let magasin = crate::secrets::selectionner(&repertoire).map_err(|e| e.to_string())?;

        super::enregistrer::supprimer_base(
            &projects,
            &request.project,
            &request.database,
            &request.environment,
            magasin.store.as_ref(),
            &mut |projets| ecrire_le_reste_intact(store, projets),
        )
        .map_err(|erreur| erreur.to_string())?
    };

    // Hors du verrou : `fermer` attend la libération du port d'un éventuel tunnel.
    for cle in &suppression.cles_a_fermer {
        registry.fermer(cle).await;
    }

    log::info!(
        "delete_database ← {} / {} : {} connexion(s) fermée(s), {} secret(s) résiduel(s)",
        request.project,
        request.database,
        suppression.cles_a_fermer.len(),
        suppression.secrets_residuels.len()
    );

    Ok(DeleteResult {
        projects: suppression.projects,
        leftover_secrets: suppression.secrets_residuels,
    })
}

/// Retire un projet et toutes ses déclarations de connexion (`08j`).
///
/// Même garantie que `delete_database`, et pour la même raison : aucun moteur dans la signature,
/// donc aucune donnée distante atteignable.
#[tauri::command]
pub async fn delete_project(
    request: DeleteProjectRequest,
    state: State<'_, ConfigState>,
    registry: State<'_, crate::engine::registry::ConnectionRegistry>,
) -> Result<DeleteResult, String> {
    let suppression = {
        let garde = state
            .0
            .lock()
            .map_err(|_| "état de configuration corrompu".to_owned())?;
        let store = garde
            .as_ref()
            .ok_or_else(|| "la configuration doit être lue avant d'être écrite".to_owned())?;
        let projects: Vec<Project> = store.load_projects()?;
        let repertoire = store
            .path()
            .parent()
            .ok_or_else(|| "le fichier de configuration n'a pas de répertoire parent".to_owned())?
            .to_path_buf();
        let magasin = crate::secrets::selectionner(&repertoire).map_err(|e| e.to_string())?;

        super::enregistrer::supprimer_projet(
            &projects,
            &request.project,
            magasin.store.as_ref(),
            &mut |projets| ecrire_le_reste_intact(store, projets),
        )
        .map_err(|erreur| erreur.to_string())?
    };

    for cle in &suppression.cles_a_fermer {
        registry.fermer(cle).await;
    }

    log::info!(
        "delete_project ← {} : {} connexion(s) fermée(s), {} secret(s) résiduel(s)",
        request.project,
        suppression.cles_a_fermer.len(),
        suppression.secrets_residuels.len()
    );

    Ok(DeleteResult {
        projects: suppression.projects,
        leftover_secrets: suppression.secrets_residuels,
    })
}

/// Crée une console vide sur une connexion.
#[tauri::command]
pub fn create_console(
    request: ConsoleRequest,
    state: State<'_, ConfigState>,
) -> Result<Vec<Project>, String> {
    ecrire_les_projets(&state, |projects| {
        super::enregistrer::ajouter_console(
            projects,
            &request.project,
            &request.database,
            &request.environment,
            &request.name,
        )
        .map_err(|erreur| erreur.to_string())
    })
}

/// Écrit le texte d'une console.
#[tauri::command]
pub fn save_console(
    request: ConsoleRequest,
    state: State<'_, ConfigState>,
) -> Result<Vec<Project>, String> {
    ecrire_les_projets(&state, |projects| {
        super::enregistrer::enregistrer_sql_de_console(
            projects,
            &request.project,
            &request.database,
            &request.environment,
            &request.name,
            request.sql.as_deref().unwrap_or_default(),
        )
        .map_err(|erreur| erreur.to_string())
    })
}

/// Retire une console.
#[tauri::command]
pub fn delete_console(
    request: ConsoleRequest,
    state: State<'_, ConfigState>,
) -> Result<Vec<Project>, String> {
    ecrire_les_projets(&state, |projects| {
        super::enregistrer::retirer_console(
            projects,
            &request.project,
            &request.database,
            &request.environment,
            &request.name,
        )
        .map_err(|erreur| erreur.to_string())
    })
}

/// Renomme une console.
#[tauri::command]
pub fn rename_console(
    request: ConsoleRequest,
    state: State<'_, ConfigState>,
) -> Result<Vec<Project>, String> {
    let nouveau = request
        .rename_to
        .clone()
        .ok_or_else(|| "un renommage exige un nouveau nom".to_owned())?;
    ecrire_les_projets(&state, |projects| {
        super::enregistrer::renommer_console(
            projects,
            &request.project,
            &request.database,
            &request.environment,
            &request.name,
            &nouveau,
        )
        .map_err(|erreur| erreur.to_string())
    })
}

/// Le tronc commun des écritures qui ne touchent qu'aux projets : les quatre opérations sur les
/// consoles, et le réglage des schémas affichés (`API-33`).
///
/// **Renommée** le 8 septembre 2026, quand elle s'appelait encore d'après les consoles : elle n'a
/// jamais rien su d'elles — elle lit, applique une opération, écrit — et un nom qui annonce un
/// domaine fait hésiter à s'en servir depuis un autre, donc fait écrire une seconde fois la même
/// chose.
///
/// Écrit les projets **sans toucher au reste du fichier**.
///
/// # Pourquoi une fonction, et non trois lignes recopiées
///
/// Le fichier de configuration est réécrit **entier** à chaque enregistrement. Une commande qui
/// n'écrit que les projets doit donc relire tout ce qu'elle n'écrit pas — les préférences, et
/// depuis `API-32` les instances managées — sous peine de l'effacer. Ces trois lignes vivaient à
/// **huit** endroits, chacun n'ayant pensé qu'aux préférences ; ajouter les instances y aurait fait
/// huit corrections dont la neuvième, écrite demain, aurait manqué.
///
/// C'est la leçon de `programme::repertoire_personnel` transposée : la question « que faut-il
/// préserver en écrivant ? » n'a qu'une réponse, elle doit n'avoir qu'un lieu.
///
/// **`unwrap_or_default` sur les deux relectures**, comme avant : l'écriture qu'on est en train de
/// faire est celle qui compte, et une relecture qui échoue échouera de nouveau au `save` — avec un
/// message qui nomme le vrai problème.
fn ecrire_le_reste_intact(store: &ConfigStore, projets: &[Project]) -> Result<(), String> {
    let preferences = store.load_preferences().unwrap_or_default();
    let instances = store.load_instances().unwrap_or_default();
    // **La neuvième chose à préserver, et c'est le cas que cette fonction existait pour attraper**
    // (`API-70`). Sans cette ligne, renommer un projet effacerait les kubeconfigs déclarés — et
    // toute connexion Kubernetes du fichier cesserait d'ouvrir, sur une référence qui ne désigne
    // plus rien.
    let kubeconfigs = store.load_kubeconfigs().unwrap_or_default();
    store
        .save(projets, &preferences, &instances, &kubeconfigs)
        .map_err(|erreur| erreur.to_string())
}

/// Exécute une opération avec le magasin ouvert, ou refuse si la configuration n'a pas été lue.
///
/// **Exposée au module des instances** (`API-32`), qui écrit dans le même fichier par le même
/// magasin. Recopier le déverrouillage et son refus là-bas aurait fait vivre deux fois la propriété
/// « ne pas écraser ce qu'on n'a pas su lire » — celle que `ConfigStore` porte précisément pour
/// qu'elle ne dépende pas de la vigilance de l'appelant.
pub(crate) fn avec_le_magasin<T>(
    state: &State<'_, ConfigState>,
    operation: impl FnOnce(&ConfigStore) -> Result<T, String>,
) -> Result<T, String> {
    let garde = state
        .0
        .lock()
        .map_err(|_| "état de configuration corrompu".to_owned())?;
    let store = garde
        .as_ref()
        .ok_or_else(|| "la configuration doit être lue avant d'être écrite".to_owned())?;
    operation(store)
}

/// Les kubeconfigs déclarés, relus du disque (`API-70`).
#[tauri::command]
pub fn list_kubeconfigs(state: State<'_, ConfigState>) -> Result<Kubeconfigs, String> {
    avec_le_magasin(&state, ConfigStore::load_kubeconfigs)
}

/// Déclare un kubeconfig, ou **rend celui qui porte déjà ce chemin** (`API-70`).
///
/// **Une commande à part, et non un `save_kubeconfigs` que l'écran composerait.** Deux appelants la
/// partagent — le bouton « Ajouter… » des préférences, et l'entrée « Autre fichier… » d'`A2` —, et
/// ce qu'ils ont en commun est ce qu'il ne faut pas écrire deux fois : la dérivation du libellé, la
/// règle de collision, et le fait que choisir un fichier **déjà déclaré** ne pose pas une seconde
/// entrée. Composer la liste côté écran aurait mis ces trois règles dans le front, où le fichier de
/// configuration écrit à la main ne les rencontrerait jamais.
///
/// **Elle rend la liste entière**, non la seule déclaration : l'appelant repose son état avec, comme
/// `save_preferences` rend les préférences bornées. Rendre l'entrée seule obligerait l'écran à
/// l'insérer lui-même, donc à tenir une seconde idée de ce que la liste contient.
#[tauri::command]
pub fn declare_kubeconfig(
    path: String,
    state: State<'_, ConfigState>,
) -> Result<Kubeconfigs, String> {
    let chemin = path.trim().to_owned();
    if chemin.is_empty() {
        return Err("un kubeconfig se déclare par le chemin d'un fichier".to_owned());
    }
    avec_le_magasin(&state, |store| {
        let mut kubeconfigs = store.load_kubeconfigs()?;
        kubeconfigs.declarer(&chemin);
        ecrire_les_kubeconfigs(store, &kubeconfigs)?;
        Ok(kubeconfigs)
    })
}

/// Écrit la liste des kubeconfigs déclarés (`API-70`) : renommage, déplacement, retrait, défaut.
///
/// # Le retrait est refusé quand une connexion s'en sert
///
/// C'est le seul refus de cette commande, et il est **structurel** : une connexion garde une
/// référence, donc retirer la déclaration qu'elle désigne la laisserait pointer dans le vide. Le
/// refus nomme les connexions — et les instances managées, qui peuvent viser un cluster elles
/// aussi —, parce qu'un « impossible » sans la liste de ce qui gêne demande de la chercher soi-même.
///
/// **L'écran désactive déjà le bouton avec sa raison, et ce n'est pas une redondance** : les deux
/// gardent deux chemins différents. L'écran empêche le geste ; celui-ci tient la garantie quand la
/// demande ne vient pas de l'écran — un front en retard sur son cœur, ou une commande appelée
/// autrement.
#[tauri::command]
pub fn save_kubeconfigs(
    kubeconfigs: Kubeconfigs,
    state: State<'_, ConfigState>,
) -> Result<Kubeconfigs, String> {
    kubeconfigs.valider().map_err(|erreur| erreur.to_string())?;
    avec_le_magasin(&state, |store| {
        let projects = store.load_projects()?;
        let instances = store.load_instances()?;
        let retirees = retirees_encore_employees(&kubeconfigs, &projects, &instances);
        if !retirees.is_empty() {
            return Err(format!(
                "ce kubeconfig est encore employé par : {}. Changez-les d'abord, ou gardez la \
                 déclaration.",
                retirees.join(", ")
            ));
        }
        ecrire_les_kubeconfigs(store, &kubeconfigs)?;
        Ok(kubeconfigs)
    })
}

/// Ce qui référence une déclaration que la liste proposée ne porte plus.
///
/// Rend les **étiquettes** de ce qui s'en sert — `base (env)` pour une connexion, le libellé pour
/// une instance —, jamais un compte : un nombre dit qu'il y a un obstacle, une liste dit lequel.
fn retirees_encore_employees(
    proposees: &Kubeconfigs,
    projects: &[Project],
    instances: &[ManagedInstance],
) -> Vec<String> {
    let mut employees = Vec::new();
    let mut noter = |reference: &crate::config::KubeconfigId, etiquette: String| {
        if proposees.get(reference).is_none() && !employees.contains(&etiquette) {
            employees.push(etiquette);
        }
    };

    for projet in projects {
        for base in &projet.databases {
            if let Some(reference) = reference_de_kubeconfig(&base.connection) {
                noter(
                    reference,
                    format!("{} › {} ({})", projet.name, base.name, base.environment),
                );
            }
        }
    }
    for instance in instances {
        if let Some(reference) = reference_de_kubeconfig(&instance.connection) {
            noter(reference, instance.nom_affiche().to_owned());
        }
    }
    employees
}

/// La référence de kubeconfig d'une connexion, s'il y en a une.
fn reference_de_kubeconfig(
    reglages: &crate::config::ConnectionSettings,
) -> Option<&crate::config::KubeconfigId> {
    let tunnel = reglages.tunnel.as_ref()?;
    match &tunnel.proxy {
        crate::config::Proxy::Kubernetes(kube) => kube.kubeconfig.as_ref(),
        crate::config::Proxy::Ssh(_) | crate::config::Proxy::CloudSql(_) => None,
    }
}

/// Écrit les kubeconfigs **sans toucher au reste du fichier** — le pendant d'`ecrire_le_reste_intact`
/// pour la seule chose que celle-ci ne peut pas écrire.
fn ecrire_les_kubeconfigs(store: &ConfigStore, kubeconfigs: &Kubeconfigs) -> Result<(), String> {
    let projects = store.load_projects()?;
    let preferences = store.load_preferences().unwrap_or_default();
    let instances = store.load_instances().unwrap_or_default();
    store
        .save(&projects, &preferences, &instances, kubeconfigs)
        .map_err(|erreur| erreur.to_string())
}

/// Les instances déclarées, relues du disque (`API-32`).
pub(crate) fn instances_declarees(
    state: &State<'_, ConfigState>,
) -> Result<Vec<ManagedInstance>, String> {
    avec_le_magasin(state, ConfigStore::load_instances)
}

/// **Les projets viennent du disque**, comme partout ailleurs : une liste envoyée par l'écran pourrait
/// être périmée et écraser une écriture. Même arbitrage qu'en `08e`, `08f` et `08i`.
fn ecrire_les_projets(
    state: &State<'_, ConfigState>,
    operation: impl FnOnce(&[Project]) -> Result<Vec<Project>, String>,
) -> Result<Vec<Project>, String> {
    let garde = state
        .0
        .lock()
        .map_err(|_| "état de configuration corrompu".to_owned())?;
    let store = garde
        .as_ref()
        .ok_or_else(|| "la configuration doit être lue avant d'être écrite".to_owned())?;

    let projects: Vec<Project> = store.load_projects()?;
    let suivants = operation(&projects)?;
    ecrire_le_reste_intact(store, &suivants)?;
    Ok(suivants)
}

/// Ce que le gestionnaire de schémas envoie en enregistrant (`API-33`).
#[derive(Debug, Clone, serde::Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct VisibleSchemasRequest {
    pub project: String,
    pub database: String,
    /// **L'environnement fait partie de l'identité d'une connexion** (`23b`) : sans lui, régler
    /// « analytics » d'un projet qui la déclare en dev et en prod viserait la première venue.
    pub environment: super::model::EnvironmentId,
    /// Les schémas à montrer, **tels quels**. La liste vide est un réglage — « aucun » —, distincte
    /// de la connexion jamais réglée, que cette commande ne peut pas produire.
    pub schemas: Vec<String>,
}

/// Règle les schémas que l'arbre montre sous une connexion, et rend les projets à jour (`API-33`).
///
/// **Distincte d'`update_variant`, et surtout : elle ne ferme pas la connexion.** Celle-là ferme,
/// parce que ses réglages décrivent *comment joindre le serveur* et que l'ancien hôte reste dans le
/// registre. Ici rien de tel n'a changé — c'est un réglage d'affichage —, et fermer aurait fait
/// perdre une connexion ouverte à chaque case cochée.
#[tauri::command]
pub fn save_visible_schemas(
    request: VisibleSchemasRequest,
    state: State<'_, ConfigState>,
) -> Result<Vec<Project>, String> {
    ecrire_les_projets(&state, |projects| {
        super::enregistrer::regler_les_schemas_affiches(
            projects,
            &request.project,
            &request.database,
            &request.environment,
            request.schemas.clone(),
        )
        .map_err(|erreur| erreur.to_string())
    })
}

/// Ce que l'éditeur de libellés envoie en enregistrant (`API-75`).
#[derive(Debug, Clone, serde::Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct ValueLabelsRequest {
    /// **Le projet, et rien de plus.** Les libellés d'une colonne vivent sur le projet : ni la
    /// connexion ni l'environnement n'entrent dans leur identité, puisque la même table porte les
    /// mêmes codes en dev et en prod (voir `Project::value_labels`).
    pub project: String,
    pub table: String,
    pub column: String,
    /// La valeur entière, **en texte**, vers son libellé. La table vide est un réglage — « aucun
    /// libellé » —, et c'est ainsi que l'éditeur retire une déclaration.
    pub labels: BTreeMap<String, String>,
}

/// Règle ce que les entiers d'une colonne veulent dire, et rend les projets à jour (`API-75`).
///
/// **Elle ne ferme pas la connexion**, comme `save_visible_schemas` et pour la même raison : rien de
/// ce qui décrit le serveur n'a changé. C'est l'affichage d'une colonne, pas une recette de
/// connexion.
#[tauri::command]
pub fn save_value_labels(
    request: ValueLabelsRequest,
    state: State<'_, ConfigState>,
) -> Result<Vec<Project>, String> {
    ecrire_les_projets(&state, |projects| {
        super::enregistrer::regler_les_libelles_de_valeurs(
            projects,
            &request.project,
            &request.table,
            &request.column,
            request.labels.clone(),
        )
        .map_err(|erreur| erreur.to_string())
    })
}

/// Ajoute une base et sa variante à un projet, et range son mot de passe.
///
/// **Rend les projets à jour**, et pas seulement `Ok(())` : sans cela l'écran devrait relire la
/// configuration pour afficher le nouveau compte, ce qui ferait deux allers-retours et laisserait
/// une fenêtre où l'écran et le disque divergent. C'est aussi ce qui rend le compteur de `A1`
/// enfin vrai — il était figé à zéro depuis `07`.
#[tauri::command]
pub fn save_database(
    app: AppHandle,
    request: SaveDatabaseRequest,
    state: State<'_, ConfigState>,
) -> Result<Vec<Project>, String> {
    let garde = state
        .0
        .lock()
        .map_err(|_| "état de configuration corrompu".to_owned())?;
    let store = garde
        .as_ref()
        .ok_or_else(|| "la configuration doit être lue avant d'être écrite".to_owned())?;

    // Les projets viennent du disque, pas du front : envoyer la liste entière depuis l'écran
    // ouvrirait la porte à un écrasement par un état périmé, et `05b` a déjà tranché que
    // l'écriture se fait sur ce qui a été lu.
    let mut projects: Vec<Project> = store.load_projects()?;

    let repertoire = store
        .path()
        .parent()
        .ok_or_else(|| "le fichier de configuration n'a pas de répertoire parent".to_owned())?
        .to_path_buf();
    let magasin = crate::secrets::selectionner(&repertoire).map_err(|e| e.to_string())?;

    let secret = request.password.as_deref().map(crate::secrets::Secret::new);

    super::enregistrer::enregistrer(
        &mut projects,
        super::enregistrer::NouvelleBase {
            project: &request.project,
            database: &request.database,
            engine: request.engine,
            environment: request.environment.clone(),
            variant: request.variant,
            password: secret.as_ref(),
            label: request.label.as_deref(),
        },
        magasin.store.as_ref(),
        &mut |projets| ecrire_le_reste_intact(store, projets),
    )
    .map_err(|erreur| erreur.to_string())?;

    log::info!(
        "save_database ← {} / {} ({}) → {} projet(s)",
        request.project,
        request.database,
        app.package_info().name,
        projects.len()
    );

    Ok(projects)
}

/// Met à jour les réglages d'une variante existante, et rend les projets à jour.
///
/// **Distincte de `save_database`**, qui ajoute et refuse une base déjà là — c'est cette garde qui
/// protège d'un écrasement par mégarde, et la fondre dans une commande « enregistrer ou mettre à
/// jour » l'effacerait. Même arbitrage qu'en `08f` pour `create_project`.
///
/// **La connexion ouverte de cette base est fermée** : elle pointe encore l'ancien hôte, et l'arbre
/// continuerait d'afficher les schémas de la base précédente sans qu'un « Rafraîchir » y change
/// quoi que ce soit. Elle n'est pas réouverte : le nouveau réglage peut être faux, et une erreur de
/// connexion juste après un enregistrement réussi se lirait comme un échec de l'enregistrement.
#[tauri::command]
pub async fn update_variant(
    app: AppHandle,
    request: UpdateVariantRequest,
    state: State<'_, ConfigState>,
    registry: State<'_, crate::engine::registry::ConnectionRegistry>,
) -> Result<Vec<Project>, String> {
    let projects = {
        let garde = state
            .0
            .lock()
            .map_err(|_| "état de configuration corrompu".to_owned())?;
        let store = garde
            .as_ref()
            .ok_or_else(|| "la configuration doit être lue avant d'être écrite".to_owned())?;

        let mut projects: Vec<Project> = store.load_projects()?;

        let repertoire = store
            .path()
            .parent()
            .ok_or_else(|| "le fichier de configuration n'a pas de répertoire parent".to_owned())?
            .to_path_buf();
        let magasin = crate::secrets::selectionner(&repertoire).map_err(|e| e.to_string())?;
        let secret = request.password.as_deref().map(crate::secrets::Secret::new);

        super::enregistrer::mettre_a_jour(
            &mut projects,
            super::enregistrer::Modification {
                project: &request.project,
                database: &request.database,
                environment: request.environment.clone(),
                reglages: &request.variant,
                password: secret.as_ref(),
                label: request.label.as_deref(),
            },
            magasin.store.as_ref(),
            &mut |projets| ecrire_le_reste_intact(store, projets),
        )
        .map_err(|erreur| erreur.to_string())?;

        projects
    };

    // Hors du verrou : `fermer` attend la libération du port du tunnel, et tenir le verrou de
    // configuration pendant une attente réseau le rendrait indisponible aux autres commandes.
    let cle = crate::engine::registry::cle(
        &request.project,
        &request.database,
        request.environment.as_str(),
    );
    registry.fermer(&cle).await;

    log::info!(
        "update_variant ← {} / {} ({}) → connexion fermée, {} projet(s)",
        request.project,
        request.database,
        app.package_info().name,
        projects.len()
    );
    Ok(projects)
}

// ---------------------------------------------------------------------------------------------
// Les environnements d'un projet (`23c`)
// ---------------------------------------------------------------------------------------------

/// Ce que `23e` envoie pour déclarer un environnement de plus.
#[derive(Debug, Clone, serde::Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct CreateEnvironmentRequest {
    pub project: String,
    pub label: String,
    pub color: super::model::EnvironmentColor,
    pub production: bool,
}

/// Ce que `23e` envoie pour changer le libellé d'un environnement.
#[derive(Debug, Clone, serde::Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct RenameEnvironmentRequest {
    pub project: String,
    /// **L'identifiant, non l'ancien libellé** : c'est lui qui désigne, et lui qui ne change jamais
    /// (`23a`). Désigner par le libellé rendrait le geste impossible sur deux environnements dont les
    /// libellés ont divergé de leurs identifiants.
    pub environment: super::model::EnvironmentId,
    pub label: String,
}

/// Ce que `23e` envoie pour changer la couleur et le drapeau de production.
#[derive(Debug, Clone, serde::Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct RecolorEnvironmentRequest {
    pub project: String,
    pub environment: super::model::EnvironmentId,
    pub color: super::model::EnvironmentColor,
    pub production: bool,
}

/// Ce que `23e` envoie après un glissement.
#[derive(Debug, Clone, serde::Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct ReorderEnvironmentsRequest {
    pub project: String,
    /// L'ordre complet, dans l'ordre voulu. Une permutation partielle est refusée (`23c`).
    pub order: Vec<super::model::EnvironmentId>,
}

/// Ce que `23f` envoie pour retirer un environnement.
#[derive(Debug, Clone, serde::Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct DeleteEnvironmentRequest {
    pub project: String,
    pub environment: super::model::EnvironmentId,
}

/// Ce qu'une suppression d'environnement rend à l'écran (`23f`).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct DeleteEnvironmentResult {
    pub projects: Vec<Project>,
    /// Les connexions supprimées, nommées — ce que l'écran redit après coup.
    pub deleted_connections: Vec<String>,
    /// Les mots de passe restés dans le trousseau. **Dits, jamais tus.**
    pub leftover_secrets: Vec<String>,
}

/// Le chemin commun des quatre gestes non destructeurs (`23c`).
///
/// **Écrit une fois pour quatre commandes.** Chacune n'a plus à retrouver le verrou, le magasin et
/// les préférences : quatre copies de ce préambule auraient été quatre occasions d'oublier que les
/// préférences sont *relues* et non remplacées — l'oubli qui effacerait les réglages de l'utilisateur
/// à chaque environnement recolorié.
fn ecrire_les_environnements(
    state: &State<'_, ConfigState>,
    geste: impl FnOnce(
        &[Project],
        &mut dyn FnMut(&[Project]) -> Result<(), String>,
    ) -> Result<Vec<Project>, super::environnements::EnvError>,
) -> Result<Vec<Project>, String> {
    let garde = state
        .0
        .lock()
        .map_err(|_| "état de configuration corrompu".to_owned())?;
    let store = garde
        .as_ref()
        .ok_or_else(|| "la configuration doit être lue avant d'être écrite".to_owned())?;

    // Du disque, jamais du front : une liste envoyée par l'écran pourrait être périmée et écraser une
    // écriture. Même arbitrage qu'en `08e`, `08f` et `08i`.
    let projects: Vec<Project> = store.load_projects()?;
    geste(&projects, &mut |projets| {
        ecrire_le_reste_intact(store, projets)
    })
    .map_err(|erreur| erreur.to_string())
}

/// Déclare un environnement de plus dans un projet (`23c`).
#[tauri::command]
pub fn create_environment(
    request: CreateEnvironmentRequest,
    state: State<'_, ConfigState>,
) -> Result<Vec<Project>, String> {
    let suivants = ecrire_les_environnements(&state, |projects, ecrire| {
        super::environnements::creer(
            projects,
            &request.project,
            &request.label,
            request.color,
            request.production,
            ecrire,
        )
    })?;
    log::info!(
        "create_environment ← {} / {}",
        request.project,
        request.label
    );
    Ok(suivants)
}

/// Change le libellé d'un environnement, **jamais son identifiant** (`23a`, `23c`).
#[tauri::command]
pub fn rename_environment(
    request: RenameEnvironmentRequest,
    state: State<'_, ConfigState>,
) -> Result<Vec<Project>, String> {
    let suivants = ecrire_les_environnements(&state, |projects, ecrire| {
        super::environnements::renommer(
            projects,
            &request.project,
            &request.environment,
            &request.label,
            ecrire,
        )
    })?;
    log::info!(
        "rename_environment ← {} / {} → {}",
        request.project,
        request.environment,
        request.label
    );
    Ok(suivants)
}

/// Change la couleur et le drapeau de production d'un environnement (`23c`).
#[tauri::command]
pub fn recolor_environment(
    request: RecolorEnvironmentRequest,
    state: State<'_, ConfigState>,
) -> Result<Vec<Project>, String> {
    let suivants = ecrire_les_environnements(&state, |projects, ecrire| {
        super::environnements::recolorier(
            projects,
            &request.project,
            &request.environment,
            request.color,
            request.production,
            ecrire,
        )
    })?;
    log::info!(
        "recolor_environment ← {} / {}",
        request.project,
        request.environment
    );
    Ok(suivants)
}

/// Réordonne les environnements d'un projet — l'ordre du sélecteur (`23c`).
#[tauri::command]
pub fn reorder_environments(
    request: ReorderEnvironmentsRequest,
    state: State<'_, ConfigState>,
) -> Result<Vec<Project>, String> {
    let suivants = ecrire_les_environnements(&state, |projects, ecrire| {
        super::environnements::reordonner(projects, &request.project, &request.order, ecrire)
    })?;
    log::info!(
        "reorder_environments ← {} : {} environnement(s)",
        request.project,
        request.order.len()
    );
    Ok(suivants)
}

/// Retire un environnement, **et les connexions qui lui appartiennent** (`23f`).
///
/// **`async`, comme `delete_database` et pour la même raison** : les connexions ouvertes des bases
/// retirées doivent être fermées, et `fermer` attend la libération du port d'un éventuel tunnel.
/// L'attente a lieu **hors du verrou** de configuration, qui resterait sinon indisponible aux autres
/// commandes pendant une attente réseau.
///
/// **Aucune base distante n'est touchée, et cette commande ne peut pas en toucher** : elle ne reçoit
/// aucun moteur, n'ouvre aucune connexion et n'émet aucun SQL. Elle en *ferme*, au contraire.
#[tauri::command]
pub async fn delete_environment(
    request: DeleteEnvironmentRequest,
    state: State<'_, ConfigState>,
    registry: State<'_, crate::engine::registry::ConnectionRegistry>,
) -> Result<DeleteEnvironmentResult, String> {
    let suppression = {
        let garde = state
            .0
            .lock()
            .map_err(|_| "état de configuration corrompu".to_owned())?;
        let store = garde
            .as_ref()
            .ok_or_else(|| "la configuration doit être lue avant d'être écrite".to_owned())?;
        let projects: Vec<Project> = store.load_projects()?;
        let repertoire = store
            .path()
            .parent()
            .ok_or_else(|| "le fichier de configuration n'a pas de répertoire parent".to_owned())?
            .to_path_buf();
        let magasin = crate::secrets::selectionner(&repertoire).map_err(|e| e.to_string())?;

        super::environnements::supprimer(
            &projects,
            &request.project,
            &request.environment,
            magasin.store.as_ref(),
            &mut |projets| ecrire_le_reste_intact(store, projets),
        )
        .map_err(|erreur| erreur.to_string())?
    };

    for cle in &suppression.cles_a_fermer {
        registry.fermer(cle).await;
    }

    log::info!(
        "delete_environment ← {} / {} : {} connexion(s) supprimée(s), {} secret(s) résiduel(s)",
        request.project,
        request.environment,
        suppression.connexions_supprimees.len(),
        suppression.secrets_residuels.len()
    );

    Ok(DeleteEnvironmentResult {
        projects: suppression.projects,
        deleted_connections: suppression.connexions_supprimees,
        leftover_secrets: suppression.secrets_residuels,
    })
}

/// Ce que la modale d'export envoie (`API-30`).
#[derive(Debug, Clone, serde::Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct ExportProjectsRequest {
    /// La destination, choisie dans le sélecteur natif.
    pub file: String,
    /// Le projet à exporter seul, ou `None` pour tous — les deux portées de la demande.
    ///
    /// **Un nom et non un index** : la liste de l'écran peut avoir été réordonnée ou vidée depuis, et
    /// les projets sont relus au disque comme partout ailleurs.
    pub project: Option<String>,
    /// Écrire les mots de passe **en clair** dans le fichier.
    ///
    /// **Reçu de l'écran, jamais déduit** : c'est une case à cocher, avec son avertissement à côté.
    /// Un défaut qui les inclurait ferait d'un export ordinaire un fichier de secrets.
    pub include_passwords: bool,
}

/// Ce que la modale d'import envoie pour écrire (`API-30`).
#[derive(Debug, Clone, serde::Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct ImportProjectsRequest {
    pub file: String,
    /// Les projets retenus, par nom. `None` retient tout ce que le fichier porte.
    pub projects: Option<Vec<String>>,
}

/// Ce qu'un import rend à l'écran.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct ImportProjectsResult {
    /// La configuration d'après, que `App` repose — c'est ce changement qui fait relire l'arbre et
    /// purger son cache, comme pour les six autres commandes de configuration.
    pub projects: Vec<Project>,
    pub report: super::transfert::ImportReport,
}

/// Écrit un fichier de transfert : tous les projets, ou un seul (`API-30`).
///
/// **Les projets viennent du disque, pas de l'écran** — comme partout ailleurs dans ce module : une
/// liste envoyée par la webview pourrait être périmée, et on exporterait alors une configuration qui
/// n'est plus celle de la machine.
#[tauri::command]
pub fn export_projects(
    request: ExportProjectsRequest,
    state: State<'_, ConfigState>,
) -> Result<super::transfert::ExportReport, String> {
    let garde = state
        .0
        .lock()
        .map_err(|_| "état de configuration corrompu".to_owned())?;
    let store = garde
        .as_ref()
        .ok_or_else(|| "la configuration doit être lue avant d'être exportée".to_owned())?;

    let projects = store.load_projects()?;
    let retenus = super::transfert::composer(&projects, request.project.as_deref())
        .map_err(|erreur| erreur.to_string())?;

    let repertoire = store
        .path()
        .parent()
        .ok_or_else(|| "le fichier de configuration n'a pas de répertoire parent".to_owned())?
        .to_path_buf();
    let magasin = crate::secrets::selectionner(&repertoire).map_err(|e| e.to_string())?;

    // Les déclarations de kubeconfig sont relues ici plutôt que reçues : l'export doit porter le
    // chemin de celles que les projets retenus référencent, faute de quoi l'autre machine recevrait
    // des connexions désignant une déclaration qu'elle n'a jamais eue (`API-70`).
    let kubeconfigs = store.load_kubeconfigs()?;
    let (fichier, report) = super::transfert::preparer(
        retenus,
        request.include_passwords,
        magasin.store.as_ref(),
        &kubeconfigs,
    )
    .map_err(|erreur| erreur.to_string())?;

    super::transfert::ecrire(std::path::Path::new(&request.file), &fichier)
        .map_err(|erreur| erreur.to_string())?;

    // Le **chemin n'est pas journalisé**, contrairement aux autres commandes : il vient d'un
    // sélecteur natif, donc il nomme un répertoire de l'utilisateur, et le journal du plugin est
    // écrit sur disque en développement. Le compte suffit à savoir que le geste a abouti.
    log::info!(
        "export_projects → {} projet(s), {} connexion(s), {} console(s), {} mot(s) de passe",
        report.projects,
        report.connections,
        report.consoles,
        report.passwords_carried
    );

    Ok(report)
}

/// Lit un fichier de transfert et dit **ce qu'un import ferait**, sans rien écrire (`API-30`).
///
/// Le rapport vient de la même fonction que l'import lui-même, avec tous les projets retenus : c'est
/// ce qui garantit que l'aperçu et l'écriture ne peuvent pas se contredire. Voir
/// `transfert::fusionner`.
#[tauri::command]
pub fn inspect_projects_file(
    file: String,
    state: State<'_, ConfigState>,
) -> Result<super::transfert::ImportReport, String> {
    let garde = state
        .0
        .lock()
        .map_err(|_| "état de configuration corrompu".to_owned())?;
    let store = garde
        .as_ref()
        .ok_or_else(|| "la configuration doit être lue avant d'être comparée".to_owned())?;

    let projects = store.load_projects()?;
    let kubeconfigs = store.load_kubeconfigs()?;
    let fichier =
        super::transfert::lire(std::path::Path::new(&file)).map_err(|erreur| erreur.to_string())?;

    Ok(super::transfert::fusionner(&projects, &kubeconfigs, &fichier, None).report)
}

/// Verse les projets d'un fichier de transfert dans la configuration (`API-30`).
///
/// **Le versement est recalculé ici**, sur la configuration telle qu'elle est *maintenant* : rejouer
/// l'aperçu écraserait une connexion créée entre-temps dans un autre écran. C'est `tourDesEtats` par
/// un autre bout — une lecture dépassée ne doit pas décider d'une écriture.
///
/// **Aucune connexion n'est fermée, et aucune n'a à l'être.** Les six commandes qui ferment le font
/// parce qu'elles *périment* la recette d'une connexion ouverte — un hôte qui change, un secret qui
/// se déplace. Celle-ci n'en modifie aucune : elle ajoute ce qui manquait et garde le reste tel quel,
/// donc toute connexion ouverte reste décrite par ce qui l'a ouverte.
#[tauri::command]
pub fn import_projects(
    request: ImportProjectsRequest,
    state: State<'_, ConfigState>,
) -> Result<ImportProjectsResult, String> {
    let garde = state
        .0
        .lock()
        .map_err(|_| "état de configuration corrompu".to_owned())?;
    let store = garde
        .as_ref()
        .ok_or_else(|| "la configuration doit être lue avant d'être écrite".to_owned())?;

    let locaux = store.load_projects()?;
    let fichier = super::transfert::lire(std::path::Path::new(&request.file))
        .map_err(|erreur| erreur.to_string())?;

    let repertoire = store
        .path()
        .parent()
        .ok_or_else(|| "le fichier de configuration n'a pas de répertoire parent".to_owned())?
        .to_path_buf();
    let magasin = crate::secrets::selectionner(&repertoire).map_err(|e| e.to_string())?;

    let kubeconfigs = store.load_kubeconfigs()?;
    let fusion =
        super::transfert::fusionner(&locaux, &kubeconfigs, &fichier, request.projects.as_deref());
    let (projects, report) = super::transfert::appliquer(
        fusion,
        magasin.store.as_ref(),
        &mut |projets, kubeconfigs| {
            // **Par `ecrire_le_reste_intact`, et surtout pas par trois lignes à soi** : un import de
            // projets n'a rien à dire d'un thème ni d'une instance managée, et c'est exactement le
            // motif qui a fait extraire cette fonction — huit appelants avaient chacun pensé aux
            // préférences, aucun n'aurait pensé aux instances. En passant par elle, cette commande
            // n'est pas le neuvième oubli.
            // **Sauf les kubeconfigs**, que ce versement vient justement de faire grandir : les
            // relire écraserait les déclarations que l'import pose, et chaque connexion importée
            // deviendrait une référence morte. C'est le seul appelant qui en écrit.
            let preferences = store.load_preferences().unwrap_or_default();
            let instances = store.load_instances().unwrap_or_default();
            store
                .save(projets, &preferences, &instances, kubeconfigs)
                .map_err(|erreur| erreur.to_string())
        },
    )
    .map_err(|erreur| erreur.to_string())?;

    for sort in &report.projects {
        log::info!(
            "import_projects → {} : {:?}, +{} env, +{} connexion(s), +{} console(s)",
            sort.name,
            sort.verdict,
            sort.environments_added.len(),
            sort.connections_added.len(),
            sort.consoles_added.len()
        );
    }

    Ok(ImportProjectsResult { projects, report })
}

#[cfg(test)]
mod tests_kubeconfigs {

    use super::*;
    use crate::config::model::{
        ConnectionSettings, Database, Engine, EnvironmentDeclaration, EnvironmentId, KubeconfigId,
        Proxy, ProxyKubernetes, SslMode, Tunnel,
    };

    fn reglages(kubeconfig: Option<&str>) -> ConnectionSettings {
        ConnectionSettings {
            host: "127.0.0.1".into(),
            port: 5432,
            default_database: "catalogue".into(),
            username: "dora".into(),
            password: None,
            ssl_mode: SslMode::Prefer,
            ca_certificate: None,
            auth_database: None,
            read_only: false,
            reconnect_on_startup: false,
            tunnel: Some(Tunnel {
                local_port: None,
                proxy: Proxy::Kubernetes(ProxyKubernetes {
                    kubeconfig: kubeconfig.map(KubeconfigId::brut),
                    namespace: None,
                    resource: "svc/postgres".into(),
                }),
            }),
        }
    }

    fn projet(kubeconfig: Option<&str>) -> Project {
        Project {
            name: "Halle".into(),
            environments: EnvironmentDeclaration::trio_par_defaut(),
            queries: Vec::new(),
            value_labels: BTreeMap::new(),
            databases: vec![Database {
                name: "catalogue".into(),
                label: None,
                engine: Engine::PostgreSql,
                environment: EnvironmentId::brut("prod"),
                connection: reglages(kubeconfig),
                consoles: Vec::new(),
                visible_schemas: None,
            }],
        }
    }

    /// La liste **proposée** : celle d'après le geste, donc sans la déclaration retirée.
    fn sans_rien() -> Kubeconfigs {
        Kubeconfigs::default()
    }

    /// **Le test que le sabotage a réclamé** (règle n° 1). Retirer la relecture des kubeconfigs dans
    /// `ecrire_le_reste_intact` laissait les 837 tests verts — et aurait effacé toutes les
    /// déclarations au premier renommage de projet, donc coupé **toutes** les connexions Kubernetes
    /// du fichier sur une référence qui ne désigne plus rien.
    ///
    /// C'est le pendant exact du test des instances managées d'`API-32`, qui provoque délibérément
    /// la perte pour que la conséquence soit écrite noir sur blanc.
    #[test]
    fn ecrire_des_projets_n_efface_pas_les_kubeconfigs_declares() {
        let dir = tempfile::tempdir().unwrap();
        let chemin = dir.path().join("config.json");

        let mut kubeconfigs = Kubeconfigs::default();
        let prod = kubeconfigs.declarer("~/.kube/prod/config");
        crate::config::store::save(&chemin, &[], &Preferences::default(), &[], &kubeconfigs)
            .expect("écriture initiale");

        let (store, _) = ConfigStore::open(&chemin);
        ecrire_le_reste_intact(&store, &[projet(None)]).expect("écriture des projets");

        let relus = store.load_kubeconfigs().expect("relecture");
        assert_eq!(
            relus.resoudre(&prod),
            Some("~/.kube/prod/config"),
            "écrire des projets a effacé les kubeconfigs déclarés"
        );
    }

    #[test]
    fn retirer_une_declaration_qu_une_connexion_emploie_est_nomme() {
        // **Le refus nomme ce qui gêne**, et c'est tout l'intérêt : « impossible » sans la liste
        // demanderait de chercher soi-même laquelle des trente connexions s'en sert.
        let employees = retirees_encore_employees(&sans_rien(), &[projet(Some("prod"))], &[]);

        assert_eq!(employees, vec!["Halle › catalogue (prod)".to_owned()]);
    }

    #[test]
    fn une_declaration_que_personne_n_emploie_se_retire() {
        // **Le contrôle positif** : sans lui, un refus qui refuserait tout passerait le test
        // ci-dessus, et plus aucune déclaration ne serait jamais retirable.
        let employees = retirees_encore_employees(&sans_rien(), &[projet(None)], &[]);

        assert!(employees.is_empty(), "{employees:?}");
    }

    #[test]
    fn une_declaration_gardee_ne_gene_personne() {
        // L'autre moitié : ce qui décide n'est pas « cette connexion a un kubeconfig », c'est
        // « la liste proposée ne le porte plus ». Une liste qui garde tout ne refuse rien.
        let mut gardee = Kubeconfigs::default();
        gardee
            .declarations
            .push(crate::config::KubeconfigDeclaration {
                id: KubeconfigId::brut("prod"),
                label: "prod".into(),
                path: "~/.kube/prod/config".into(),
            });

        let employees = retirees_encore_employees(&gardee, &[projet(Some("prod"))], &[]);
        assert!(employees.is_empty(), "{employees:?}");
    }

    #[test]
    fn une_connexion_qui_vise_une_autre_declaration_ne_gene_pas() {
        let employees = retirees_encore_employees(&sans_rien(), &[projet(Some("bac"))], &[]);

        // Elle est nommée parce que « bac » n'est pas dans la liste proposée non plus — la garde
        // porte sur *toute* référence que la liste ne déclare plus, ce qui est le bon critère :
        // une connexion sur une référence déjà morte n'a pas à empêcher de ranger le reste.
        assert_eq!(employees, vec!["Halle › catalogue (prod)".to_owned()]);
    }
}
