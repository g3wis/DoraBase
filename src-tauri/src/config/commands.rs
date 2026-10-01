//! Les commandes IPC de la configuration.
//!
//! Ces commandes sont **définies par l'app**, donc hors du système d'ACL de Tauri : aucune
//! entrée à ajouter dans `capabilities/default.json` — les capacités ne gouvernent que les
//! appels venant de la webview. Seule la résolution du chemin passe par `core:path:default`,
//! déjà accordé.
//!
//! **Le contrat est celui de `requetes.rs`** (#164), branché ici par #165 : chaque commande prend
//! un seul argument nommé `request` (sauf `save_config`, qui prend `tree`), lit le disque et rend
//! l'arbre **entier**. Le front le repose, ce qui fait relire les états du registre et purger le
//! cache de l'arbre (« Le cache de l'arbre suit le registre »).

use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};

use super::arbre::{cle_de_connexion, tirage_du_systeme, ConnectionId, FolderId, FolderTree};
use super::model::{Kubeconfigs, ManagedInstance, Preferences};
use super::requetes::{
    ConfigLoad, ConsoleRequest, CreateFolderRequest, CreateFolderResult, DeleteDatabaseRequest,
    DeleteFolderRequest, DeleteResult, RecolorFolderRequest, RenameDatabaseRequest,
    RenameFolderRequest, SaveDatabaseRequest, SaveDatabaseResult, SetFolderReadOnlyRequest,
    UpdateVariantRequest, ValueLabelsRequest, VisibleSchemasRequest,
};
use super::store::{ConfigStore, LoadOutcome};
use crate::engine::registry::ConnectionRegistry;

/// Nom du fichier dans le répertoire de configuration de l'app.
const NOM_FICHIER: &str = "config.json";

/// L'issue de lecture telle qu'elle traverse l'IPC.
///
/// Le front n'a pas besoin du chemin de quarantaine en `PathBuf` pour décider quoi afficher : il a
/// besoin de savoir **s'il peut écrire**.
impl From<LoadOutcome> for ConfigLoad {
    fn from(issue: LoadOutcome) -> Self {
        match issue {
            LoadOutcome::Fresh => Self::Fresh,
            // Une migration encore en attente ne sort jamais d'ici : `ConfigStore::ouvrir` l'a
            // achevée, ou l'issue est `SecretsMigrationFailed`.
            LoadOutcome::Loaded {
                tree,
                preferences,
                instances,
                kubeconfigs,
                ..
            } => Self::Loaded {
                tree,
                preferences,
                instances,
                kubeconfigs,
            },
            LoadOutcome::SecretsMigrationFailed { reason } => {
                Self::SecretsMigrationFailed { reason }
            }
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

fn chemin_configuration(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    // `app_config_dir()` résout en `config_dir()/<identifiant du bundle>` — sur macOS,
    // `~/Library/Application Support/…`. Jamais un chemin littéral : c'est ce qui garde
    // Windows et Linux ouverts.
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(NOM_FICHIER))
        .map_err(|erreur| format!("répertoire de configuration introuvable : {erreur}"))
}

/// Le magasin de secrets de ce poste, choisi par la signature du bundle, rangé à côté du fichier.
fn magasin_de(store: &ConfigStore) -> Result<crate::secrets::ActiveSecretStore, String> {
    let repertoire = store
        .path()
        .parent()
        .ok_or_else(|| "le fichier de configuration n'a pas de répertoire parent".to_owned())?;
    crate::secrets::selectionner(repertoire).map_err(|e| e.to_string())
}

/// Lit la configuration, **et achève une migration en attente** (#165).
///
/// Un fichier v6 est migré en arbre ; ses mots de passe sont déplacés vers `connexion/<id>`, puis
/// la v7 est écrite aussitôt — voir `ConfigStore::ouvrir`. Le magasin de secrets n'est choisi que
/// s'il y a un mot de passe à déplacer : un lancement ordinaire ne touche pas au Trousseau.
#[tauri::command]
pub fn load_config(app: AppHandle, state: State<'_, ConfigState>) -> Result<ConfigLoad, String> {
    let chemin = chemin_configuration(&app)?;
    let repertoire = chemin
        .parent()
        .ok_or_else(|| "le fichier de configuration n'a pas de répertoire parent".to_owned())?
        .to_path_buf();
    let (store, issue) = ConfigStore::ouvrir(chemin, || {
        crate::secrets::selectionner(&repertoire)
            .map(|magasin| magasin.store)
            .map_err(|e| e.to_string())
    });

    let mut garde = state
        .0
        .lock()
        .map_err(|_| "état de configuration corrompu".to_owned())?;
    *garde = Some(store);

    Ok(issue.into())
}

/// Exécute une opération avec le magasin ouvert, ou refuse si la configuration n'a pas été lue.
///
/// **Exposée au module des instances** (`API-32`), qui écrit dans le même fichier par le même
/// magasin. Recopier le déverrouillage et son refus là-bas aurait fait vivre deux fois la propriété
/// « ne pas écraser ce qu'on n'a pas su lire ».
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

/// Écrit l'arbre **sans toucher au reste du fichier**.
///
/// # Pourquoi une fonction, et non trois lignes recopiées
///
/// Le fichier de configuration est réécrit **entier** à chaque enregistrement. Une commande qui
/// n'écrit que l'arbre doit donc relire tout ce qu'elle n'écrit pas — préférences, instances
/// managées (`API-32`), kubeconfigs déclarés (`API-70`) — sous peine de l'effacer. La question
/// « que faut-il préserver en écrivant ? » n'a qu'une réponse, elle doit n'avoir qu'un lieu.
///
/// **Cinq sites réécrivent tout le fichier** : `save_config`, `save_preferences`, cette fonction,
/// `ecrire_les_kubeconfigs` et `instances::commands::ecrire_les_instances`. Tous passent par
/// `ConfigStore::save`, dont la signature n'a pas de variante plus courte.
///
/// **`unwrap_or_default` sur les relectures**, comme avant : une relecture qui échoue échouera de
/// nouveau au `save` — avec un message qui nomme le vrai problème.
pub(crate) fn ecrire_le_reste_intact(
    store: &ConfigStore,
    arbre: &FolderTree,
) -> Result<(), String> {
    let preferences = store.load_preferences().unwrap_or_default();
    let instances = store.load_instances().unwrap_or_default();
    // **La neuvième chose à préserver** (`API-70`) : sans cette ligne, renommer un dossier
    // effacerait les kubeconfigs déclarés, et toute connexion Kubernetes du fichier cesserait
    // d'ouvrir.
    let kubeconfigs = store.load_kubeconfigs().unwrap_or_default();
    store
        .save(arbre, &preferences, &instances, &kubeconfigs)
        .map_err(|erreur| erreur.to_string())
}

/// Le tronc commun des écritures pures de l'arbre : lire, appliquer, écrire, rendre.
///
/// **L'arbre vient du disque**, jamais de l'écran : une copie envoyée par la webview pourrait être
/// périmée et écraser une écriture faite ailleurs (`08e`).
fn ecrire_l_arbre(
    state: &State<'_, ConfigState>,
    operation: impl FnOnce(&FolderTree) -> Result<FolderTree, String>,
) -> Result<FolderTree, String> {
    avec_le_magasin(state, |store| ecrire_l_arbre_sur(store, operation))
}

fn ecrire_l_arbre_sur(
    store: &ConfigStore,
    operation: impl FnOnce(&FolderTree) -> Result<FolderTree, String>,
) -> Result<FolderTree, String> {
    let arbre = store.load_tree()?;
    let suivant = operation(&arbre)?;
    ecrire_le_reste_intact(store, &suivant)?;
    Ok(suivant)
}

#[tauri::command]
pub fn save_config(tree: FolderTree, state: State<'_, ConfigState>) -> Result<(), String> {
    // **Validé avant d'écrire** : l'arbre vient de l'écran, et un arbre invalide écrit sur disque
    // coûterait la quarantaine de tout au démarrage suivant.
    tree.valider().map_err(|erreur| erreur.to_string())?;
    avec_le_magasin(&state, |store| ecrire_le_reste_intact(store, &tree))
}

/// Écrit les préférences (`15a`). **Chaque réglage écrit immédiatement** ; l'arbre est **relu**,
/// symétriquement à `save_config`.
#[tauri::command]
pub fn save_preferences(
    preferences: Preferences,
    state: State<'_, ConfigState>,
) -> Result<Preferences, String> {
    avec_le_magasin(&state, |store| {
        let arbre = store.load_tree()?;
        // **Bornées, et les valeurs bornées sont rendues** : sans le retour, l'écran garderait une
        // valeur que le disque ne porte pas.
        let bornees = preferences.borner();
        let instances = store.load_instances()?;
        let kubeconfigs = store.load_kubeconfigs()?;
        store
            .save(&arbre, &bornees, &instances, &kubeconfigs)
            .map_err(|erreur| erreur.to_string())?;
        Ok(bornees)
    })
}

// ---------------------------------------------------------------------------------------------
// Dossiers (#165)
// ---------------------------------------------------------------------------------------------

/// Crée un dossier « dossier N » sous `parent`, ou à la racine, et rend son identifiant.
#[tauri::command]
pub fn create_folder(
    request: CreateFolderRequest,
    state: State<'_, ConfigState>,
) -> Result<CreateFolderResult, String> {
    avec_le_magasin(&state, |store| {
        let arbre = store.load_tree()?;
        let id = FolderId::aleatoire(tirage_du_systeme, |candidat| arbre.dossier_pris(candidat));
        let suivant =
            super::enregistrer::creer_dossier(&arbre, request.parent.as_ref(), id.clone())
                .map_err(|erreur| erreur.to_string())?;
        ecrire_le_reste_intact(store, &suivant)?;
        log::info!("create_folder → {id}");
        Ok(CreateFolderResult {
            tree: suivant,
            folder: id,
        })
    })
}

/// Renomme un dossier. **Synchrone** : ne ferme rien et ne touche à aucun secret — le nom d'un
/// dossier n'entre ni dans la clé du registre ni dans la référence d'un mot de passe.
#[tauri::command]
pub fn rename_folder(
    request: RenameFolderRequest,
    state: State<'_, ConfigState>,
) -> Result<FolderTree, String> {
    avec_le_magasin(&state, |store| renommer_le_dossier(store, &request))
}

/// Le corps de `rename_folder`, **sans Tauri** : c'est ce que le test du registre exerce. Ni
/// registre ni magasin de secrets dans la signature — la garantie est là.
fn renommer_le_dossier(
    store: &ConfigStore,
    request: &RenameFolderRequest,
) -> Result<FolderTree, String> {
    ecrire_l_arbre_sur(store, |arbre| {
        super::enregistrer::renommer_dossier(arbre, &request.folder, &request.name)
            .map_err(|erreur| erreur.to_string())
    })
}

/// Change la pastille d'un dossier ; `None` la retire.
#[tauri::command]
pub fn recolor_folder(
    request: RecolorFolderRequest,
    state: State<'_, ConfigState>,
) -> Result<FolderTree, String> {
    ecrire_l_arbre(&state, |arbre| {
        super::enregistrer::recolorier_dossier(arbre, &request.folder, request.color)
            .map_err(|erreur| erreur.to_string())
    })
}

/// Pose ou lève la lecture seule d'un dossier — **l'écriture du drapeau seule**. Ce qu'elle impose
/// aux écrans et au moteur, et le refus pendant une transaction manuelle, sont l'affaire de #168.
#[tauri::command]
pub fn set_folder_read_only(
    request: SetFolderReadOnlyRequest,
    state: State<'_, ConfigState>,
) -> Result<FolderTree, String> {
    ecrire_l_arbre(&state, |arbre| {
        super::enregistrer::regler_la_lecture_seule(arbre, &request.folder, request.read_only)
            .map_err(|erreur| erreur.to_string())
    })
}

/// Le retrait d'un dossier ou d'une connexion, jusqu'à l'écriture : la commande ferme ensuite.
fn retirer(
    state: &State<'_, ConfigState>,
    geste: impl FnOnce(
        &FolderTree,
        &dyn crate::secrets::SecretStore,
        &mut dyn FnMut(&FolderTree) -> Result<(), String>,
    ) -> Result<super::enregistrer::Suppression, super::enregistrer::DeleteError>,
) -> Result<super::enregistrer::Suppression, String> {
    avec_le_magasin(state, |store| {
        let arbre = store.load_tree()?;
        let magasin = magasin_de(store)?;
        geste(&arbre, magasin.store.as_ref(), &mut |suivant| {
            ecrire_le_reste_intact(store, suivant)
        })
        .map_err(|erreur| erreur.to_string())
    })
}

/// Ferme les connexions retirées, **hors du verrou** de configuration : `fermer` attend la
/// libération du port d'un éventuel tunnel.
async fn fermer_les_retirees(
    registry: &ConnectionRegistry,
    suppression: super::enregistrer::Suppression,
) -> DeleteResult {
    for id in &suppression.connexions {
        registry.fermer(&cle_de_connexion(id)).await;
    }
    DeleteResult {
        tree: suppression.arbre,
        deleted_connections: suppression.connexions,
        leftover_secrets: suppression.secrets_residuels,
    }
}

/// Retire un dossier et **tout son sous-arbre** : ferme ses connexions et efface leurs secrets.
///
/// **Aucune base distante n'est touchée** : aucun moteur dans la signature, aucun SQL émis.
#[tauri::command]
pub async fn delete_folder(
    request: DeleteFolderRequest,
    state: State<'_, ConfigState>,
    registry: State<'_, ConnectionRegistry>,
) -> Result<DeleteResult, String> {
    let suppression = retirer(&state, |arbre, magasin, ecrire| {
        super::enregistrer::supprimer_dossier(arbre, &request.folder, magasin, ecrire)
    })?;
    log::info!(
        "delete_folder ← {} : {} connexion(s) fermée(s), {} secret(s) résiduel(s)",
        request.folder,
        suppression.connexions.len(),
        suppression.secrets_residuels.len()
    );
    Ok(fermer_les_retirees(&registry, suppression).await)
}

// ---------------------------------------------------------------------------------------------
// Connexions (#165)
// ---------------------------------------------------------------------------------------------

/// Déclare une connexion **dans un dossier**, range son mot de passe, et rend son identifiant.
///
/// L'identifiant est tiré ici, puis passé à `enregistrer` : c'est ce qui laisse les tests poser
/// des identifiants fixes.
#[tauri::command]
pub fn save_database(
    request: SaveDatabaseRequest,
    state: State<'_, ConfigState>,
) -> Result<SaveDatabaseResult, String> {
    avec_le_magasin(&state, |store| {
        let mut arbre = store.load_tree()?;
        let magasin = magasin_de(store)?;
        let id = ConnectionId::aleatoire(tirage_du_systeme, |candidat| {
            arbre.connexion_prise(candidat)
        });
        let secret = request.password.as_deref().map(crate::secrets::Secret::new);

        super::enregistrer::enregistrer(
            &mut arbre,
            super::enregistrer::NouvelleBase {
                id: id.clone(),
                dossier: request.folder.as_ref(),
                name: &request.name,
                engine: request.engine,
                variant: request.variant,
                password: secret.as_ref(),
                label: request.label.as_deref(),
            },
            magasin.store.as_ref(),
            &mut |suivant| ecrire_le_reste_intact(store, suivant),
        )
        .map_err(|erreur| erreur.to_string())?;

        log::info!("save_database → {id}");
        Ok(SaveDatabaseResult {
            tree: arbre,
            connection: id,
        })
    })
}

/// Met à jour les réglages d'une connexion existante. **Ferme toujours la connexion** : elle
/// pointe peut-être encore l'ancien hôte. Elle n'est pas rouverte : le nouveau réglage peut être
/// faux, et une erreur juste après un enregistrement réussi se lirait comme son échec.
#[tauri::command]
pub async fn update_variant(
    request: UpdateVariantRequest,
    state: State<'_, ConfigState>,
    registry: State<'_, ConnectionRegistry>,
) -> Result<FolderTree, String> {
    let arbre = avec_le_magasin(&state, |store| {
        let mut arbre = store.load_tree()?;
        let magasin = magasin_de(store)?;
        let secret = request.password.as_deref().map(crate::secrets::Secret::new);
        super::enregistrer::mettre_a_jour(
            &mut arbre,
            super::enregistrer::Modification {
                connection: &request.connection,
                reglages: &request.variant,
                password: secret.as_ref(),
                label: request.label.as_deref(),
            },
            magasin.store.as_ref(),
            &mut |suivant| ecrire_le_reste_intact(store, suivant),
        )
        .map_err(|erreur| erreur.to_string())?;
        Ok(arbre)
    })?;

    registry
        .fermer(&cle_de_connexion(&request.connection))
        .await;
    log::info!("update_variant ← {} → connexion fermée", request.connection);
    Ok(arbre)
}

/// Renomme une connexion — `Database::name`, jamais `label`. **Synchrone depuis #165** : ne ferme
/// rien, ne déplace rien, ne touche à aucun secret. `name` n'entre dans aucune chaîne de connexion,
/// ni dans la clé du registre, ni dans la référence du mot de passe.
#[tauri::command]
pub fn rename_database(
    request: RenameDatabaseRequest,
    state: State<'_, ConfigState>,
) -> Result<FolderTree, String> {
    avec_le_magasin(&state, |store| renommer_la_connexion(store, &request))
}

/// Le corps de `rename_database`, sans Tauri — voir `renommer_le_dossier`.
fn renommer_la_connexion(
    store: &ConfigStore,
    request: &RenameDatabaseRequest,
) -> Result<FolderTree, String> {
    ecrire_l_arbre_sur(store, |arbre| {
        super::enregistrer::renommer_connexion(arbre, &request.connection, &request.name)
            .map_err(|erreur| erreur.to_string())
    })
}

/// Retire la **déclaration** d'une connexion, et son mot de passe. Ferme la connexion ouverte.
#[tauri::command]
pub async fn delete_database(
    request: DeleteDatabaseRequest,
    state: State<'_, ConfigState>,
    registry: State<'_, ConnectionRegistry>,
) -> Result<DeleteResult, String> {
    let suppression = retirer(&state, |arbre, magasin, ecrire| {
        super::enregistrer::supprimer_base(arbre, &request.connection, magasin, ecrire)
    })?;
    log::info!(
        "delete_database ← {} : {} secret(s) résiduel(s)",
        request.connection,
        suppression.secrets_residuels.len()
    );
    Ok(fermer_les_retirees(&registry, suppression).await)
}

/// Crée une console vide sur une connexion.
#[tauri::command]
pub fn create_console(
    request: ConsoleRequest,
    state: State<'_, ConfigState>,
) -> Result<FolderTree, String> {
    ecrire_l_arbre(&state, |arbre| {
        super::enregistrer::ajouter_console(arbre, &request.connection, &request.name)
            .map_err(|erreur| erreur.to_string())
    })
}

/// Écrit le texte d'une console.
#[tauri::command]
pub fn save_console(
    request: ConsoleRequest,
    state: State<'_, ConfigState>,
) -> Result<FolderTree, String> {
    ecrire_l_arbre(&state, |arbre| {
        super::enregistrer::enregistrer_sql_de_console(
            arbre,
            &request.connection,
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
) -> Result<FolderTree, String> {
    ecrire_l_arbre(&state, |arbre| {
        super::enregistrer::retirer_console(arbre, &request.connection, &request.name)
            .map_err(|erreur| erreur.to_string())
    })
}

/// Renomme une console.
#[tauri::command]
pub fn rename_console(
    request: ConsoleRequest,
    state: State<'_, ConfigState>,
) -> Result<FolderTree, String> {
    let nouveau = request
        .rename_to
        .clone()
        .ok_or_else(|| "un renommage exige un nouveau nom".to_owned())?;
    ecrire_l_arbre(&state, |arbre| {
        super::enregistrer::renommer_console(arbre, &request.connection, &request.name, &nouveau)
            .map_err(|erreur| erreur.to_string())
    })
}

/// Règle les schémas que l'arbre montre sous une connexion (`API-33`). **Ne ferme pas la
/// connexion** : c'est un réglage d'affichage, rien de ce qui décrit le serveur n'a changé.
#[tauri::command]
pub fn save_visible_schemas(
    request: VisibleSchemasRequest,
    state: State<'_, ConfigState>,
) -> Result<FolderTree, String> {
    ecrire_l_arbre(&state, |arbre| {
        super::enregistrer::regler_les_schemas_affiches(
            arbre,
            &request.connection,
            request.schemas.clone(),
        )
        .map_err(|erreur| erreur.to_string())
    })
}

/// Règle ce que les entiers d'une colonne veulent dire (`API-75`). **Le dossier est résolu par le
/// cœur** — voir `enregistrer::regler_les_libelles_de_valeurs`. Ne ferme pas la connexion.
#[tauri::command]
pub fn save_value_labels(
    request: ValueLabelsRequest,
    state: State<'_, ConfigState>,
) -> Result<FolderTree, String> {
    ecrire_l_arbre(&state, |arbre| {
        super::enregistrer::regler_les_libelles_de_valeurs(
            arbre,
            &request.connection,
            &request.table,
            &request.column,
            request.labels.clone(),
        )
        .map_err(|erreur| erreur.to_string())
    })
}

// ---------------------------------------------------------------------------------------------
// Kubeconfigs déclarés (`API-70`)
// ---------------------------------------------------------------------------------------------

/// Les kubeconfigs déclarés, relus du disque.
#[tauri::command]
pub fn list_kubeconfigs(state: State<'_, ConfigState>) -> Result<Kubeconfigs, String> {
    avec_le_magasin(&state, ConfigStore::load_kubeconfigs)
}

/// Déclare un kubeconfig, ou **rend celui qui porte déjà ce chemin**. Elle rend la liste entière,
/// que l'appelant repose.
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

/// Écrit la liste des kubeconfigs déclarés : renommage, déplacement, retrait, défaut.
///
/// **Le retrait est refusé quand une connexion s'en sert**, en nommant ce qui gêne — connexions et
/// instances managées. L'écran désactive déjà le bouton avec sa raison ; ce refus tient la garantie
/// quand la demande ne vient pas de l'écran.
#[tauri::command]
pub fn save_kubeconfigs(
    kubeconfigs: Kubeconfigs,
    state: State<'_, ConfigState>,
) -> Result<Kubeconfigs, String> {
    kubeconfigs.valider().map_err(|erreur| erreur.to_string())?;
    avec_le_magasin(&state, |store| {
        let arbre = store.load_tree()?;
        let instances = store.load_instances()?;
        let retirees = retirees_encore_employees(&kubeconfigs, &arbre, &instances);
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
/// Rend les **étiquettes** de ce qui s'en sert — le chemin d'une connexion (« Atelier Nord › prod ›
/// analytics », `FolderTree::chemin_de`), le libellé d'une instance —, jamais un compte : un nombre
/// dit qu'il y a un obstacle, une liste dit lequel.
fn retirees_encore_employees(
    proposees: &Kubeconfigs,
    arbre: &FolderTree,
    instances: &[ManagedInstance],
) -> Vec<String> {
    let mut employees = Vec::new();
    let mut noter = |reference: &crate::config::KubeconfigId, etiquette: String| {
        if proposees.get(reference).is_none() && !employees.contains(&etiquette) {
            employees.push(etiquette);
        }
    };

    for (base, _) in arbre.connexions() {
        if let Some(reference) = reference_de_kubeconfig(&base.connection) {
            let chemin = arbre
                .chemin_de(&base.id)
                .map(|morceaux| morceaux.join(" › "))
                .unwrap_or_else(|| base.name.clone());
            noter(reference, chemin);
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
    let arbre = store.load_tree()?;
    let preferences = store.load_preferences().unwrap_or_default();
    let instances = store.load_instances().unwrap_or_default();
    store
        .save(&arbre, &preferences, &instances, kubeconfigs)
        .map_err(|erreur| erreur.to_string())
}

/// Les instances déclarées, relues du disque (`API-32`).
pub(crate) fn instances_declarees(
    state: &State<'_, ConfigState>,
) -> Result<Vec<ManagedInstance>, String> {
    avec_le_magasin(state, ConfigStore::load_instances)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::arbre::tests::{base, dossier};
    use crate::config::model::{KubeconfigId, Proxy, ProxyKubernetes, SslMode, Tunnel};
    use crate::engine::registry::ConnectionState;

    fn kube(reference: Option<&str>) -> crate::config::Database {
        let mut connexion = base("catalogue", false);
        connexion.name = "catalogue".into();
        connexion.connection.tunnel = Some(Tunnel {
            local_port: None,
            proxy: Proxy::Kubernetes(ProxyKubernetes {
                kubeconfig: reference.map(KubeconfigId::brut),
                namespace: None,
                resource: "svc/postgres".into(),
            }),
        });
        connexion
    }

    /// `Halle` › `prod` › `catalogue`.
    fn arbre_de(connexion: crate::config::Database) -> FolderTree {
        let mut prod = dossier("prod", "prod", true);
        prod.connections.push(connexion);
        let mut halle = dossier("halle", "Halle", false);
        halle.folders.push(prod);
        FolderTree {
            folders: vec![halle],
            connections: Vec::new(),
        }
    }

    /// **Le test que le sabotage a réclamé** (`API-70`) : retirer la relecture des kubeconfigs dans
    /// `ecrire_le_reste_intact` effacerait toutes les déclarations au premier renommage.
    #[test]
    fn ecrire_l_arbre_n_efface_pas_les_kubeconfigs() {
        let dir = tempfile::tempdir().unwrap();
        let chemin = dir.path().join("config.json");
        let mut kubeconfigs = Kubeconfigs::default();
        let prod = kubeconfigs.declarer("~/.kube/prod/config");
        crate::config::store::save(
            &chemin,
            &FolderTree::default(),
            &Preferences::default(),
            &[],
            &kubeconfigs,
        )
        .expect("écriture initiale");

        let (store, _) = ConfigStore::open(&chemin);
        ecrire_le_reste_intact(&store, &arbre_de(kube(None))).expect("écriture de l'arbre");

        assert_eq!(
            store.load_kubeconfigs().expect("relecture").resoudre(&prod),
            Some("~/.kube/prod/config"),
            "écrire l'arbre a effacé les kubeconfigs déclarés"
        );
    }

    #[test]
    fn retirer_une_declaration_qu_une_connexion_emploie_nomme_son_chemin() {
        let employees =
            retirees_encore_employees(&Kubeconfigs::default(), &arbre_de(kube(Some("prod"))), &[]);
        assert_eq!(employees, vec!["Halle › prod › catalogue".to_owned()]);
        // Le contrôle positif : une connexion sans kubeconfig ne gêne personne.
        assert!(
            retirees_encore_employees(&Kubeconfigs::default(), &arbre_de(kube(None)), &[])
                .is_empty()
        );
    }

    /// **Renommer un dossier ou une connexion ne ferme rien et ne touche à aucun secret** (#165).
    ///
    /// La garantie est d'abord dans la signature — ni registre ni magasin n'y entrent. Ce que le test
    /// ajoute est la moitié qu'une signature ne dit pas : l'identité de la connexion survit au
    /// renommage, donc la clé sous laquelle le registre la tient reste la sienne. Sabotage vérifié :
    /// tirer un nouvel identifiant au renommage laisse la connexion rouverte sous une clé que plus
    /// rien ne désigne, et le test tombe.
    #[tokio::test]
    async fn renommer_ne_ferme_rien_et_ne_touche_pas_au_magasin() {
        let dir = tempfile::tempdir().unwrap();
        let fichier = dir.path().join("atelier.db");
        rusqlite::Connection::open(&fichier).expect("fichier");
        let mut connexion = base("jetons", false);
        connexion.engine = crate::config::Engine::Sqlite;
        connexion.connection.default_database = fichier.to_string_lossy().into_owned();
        connexion.connection.ssl_mode = SslMode::Disable;
        let chemin = dir.path().join("config.json");
        crate::config::store::save(
            &chemin,
            &arbre_de(connexion.clone()),
            &Preferences::default(),
            &[],
            &Kubeconfigs::default(),
        )
        .unwrap();
        let (store, _) = ConfigStore::open(&chemin);

        let registre = ConnectionRegistry::new();
        registre
            .ouvrir(
                &cle_de_connexion(&connexion.id),
                crate::config::Engine::Sqlite,
                &connexion.connection,
                None,
                &crate::engine::proxy::ContexteDeProxy::pour_les_tests(),
            )
            .await
            .expect("ouverture");

        renommer_le_dossier(
            &store,
            &RenameFolderRequest {
                folder: FolderId::brut("halle"),
                name: "Atelier".into(),
            },
        )
        .expect("renommage du dossier");
        let arbre = renommer_la_connexion(
            &store,
            &RenameDatabaseRequest {
                connection: connexion.id.clone(),
                name: "entrepôt".into(),
            },
        )
        .expect("renommage de la connexion");

        let (renommee, _) = arbre
            .connexions()
            .find(|(base, _)| base.name == "entrepôt")
            .expect("la connexion renommée");
        assert!(matches!(
            registre.etat(&cle_de_connexion(&renommee.id)).await,
            ConnectionState::Connected { .. }
        ));
        assert_eq!(arbre.folders[0].name, "Atelier");
        assert_eq!(store.load_tree().expect("relecture"), arbre);
    }
}
