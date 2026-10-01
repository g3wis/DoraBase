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

use super::arbre::{
    cle_de_connexion, tirage_du_systeme, ConnectionId, DeplacementError, FolderId, FolderTree,
};
use super::model::{Kubeconfigs, ManagedInstance, Preferences};
use super::requetes::{
    ConfigLoad, ConsoleRequest, CreateFolderRequest, CreateFolderResult, DeleteDatabaseRequest,
    DeleteFolderRequest, DeleteResult, ExportProjectsRequest, ExportReport, ImportProjectsRequest,
    ImportProjectsResult, ImportReport, MoveDatabaseRequest, MoveFolderRequest, MoveResult,
    RecolorFolderRequest, RenameDatabaseRequest, RenameFolderRequest, SaveDatabaseRequest,
    SaveDatabaseResult, SetFolderIconRequest, SetFolderReadOnlyRequest, UpdateVariantRequest,
    ValueLabelsRequest, VisibleSchemasRequest,
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

    /// Un état **déjà lu**, pour les tests des commandes qui consultent la configuration sans passer
    /// par `load_config` (#168).
    #[cfg(test)]
    pub(crate) fn ouvert(store: ConfigStore) -> Self {
        Self(Mutex::new(Some(store)))
    }
}

/// Refuse une écriture sur une connexion en lecture seule **effective**, lue sur le disque (#168).
///
/// **La configuration est relue à chaque appel**, et c'est délibéré : c'est négligeable devant une
/// écriture réseau, et un drapeau figé dans le registre devrait être tenu à jour par chaque commande
/// de configuration qui peut le changer — une règle, pas N branchements. Voir
/// `FolderTree::refus_d_ecrire` pour la règle elle-même et ses messages.
///
/// **Aucune `variant` dans la signature** : c'est la garantie. Une commande qui écrit ne peut pas
/// croire l'écran sur parole, puisqu'elle n'a rien à lui demander.
pub(crate) fn refuser_si_lecture_seule(
    state: &ConfigState,
    connexion: &ConnectionId,
    geste: &str,
) -> Result<(), String> {
    avec_le_magasin(state, |store| {
        match store.load_tree()?.refus_d_ecrire(connexion, geste) {
            Some(refus) => Err(refus),
            None => Ok(()),
        }
    })
}

/// La lecture seule **effective** d'une connexion, que `open_database` pose sur la session du
/// moteur (#168). `Err` pour une connexion que la configuration ne déclare plus.
pub(crate) fn lecture_seule_effective(
    state: &ConfigState,
    connexion: &ConnectionId,
) -> Result<bool, String> {
    avec_le_magasin(state, |store| {
        store
            .load_tree()?
            .lecture_seule_effective(connexion)
            .map(|lecture| lecture.est_active())
            .ok_or_else(|| {
                "cette connexion n'est plus déclarée dans la configuration : rafraîchissez \
                 l'arborescence."
                    .to_owned()
            })
    })
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
    state: &ConfigState,
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
    state: &ConfigState,
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

/// Change l'icône d'un dossier (#171) ; `None` la rend à `pin`. Aucune connexion n'est touchée : c'est
/// un réglage d'affichage, comme la couleur.
#[tauri::command]
pub fn set_folder_icon(
    request: SetFolderIconRequest,
    state: State<'_, ConfigState>,
) -> Result<FolderTree, String> {
    ecrire_l_arbre(&state, |arbre| {
        super::enregistrer::regler_l_icone(arbre, &request.folder, request.icon.as_deref())
            .map_err(|erreur| erreur.to_string())
    })
}

/// Pose ou lève la lecture seule d'un dossier, et **ferme les connexions dont la lecture seule
/// effective change** (#168).
///
/// **Fermer, et non reposer le réglage sur la session vivante.** La lecture seule est posée côté
/// moteur à l'ouverture (`SET SESSION CHARACTERISTICS …`, `SET SESSION TRANSACTION READ ONLY`,
/// `PRAGMA query_only`) : une connexion ouverte garderait l'ancien réglage, et ses sessions de
/// console aussi. MySQL en tient un **pool**, où reposer un `SET` n'atteindrait qu'une connexion sur
/// dix. Fermer est la seule forme qui vaille pour les cinq moteurs, et c'est le patron des commandes
/// de configuration qui périment ce qu'une connexion ouverte décrit ; la connexion se rouvre au geste
/// suivant, avec le bon réglage, par `open_database`.
///
/// **Refusée tant qu'une transaction manuelle est ouverte** sur l'une des connexions concernées :
/// fermer la connexion emporterait sa transaction — ce que la bascule de mode refuse déjà de faire en
/// silence (`API-38`). Le refus vaut **dans les deux sens** : lever la lecture seule ferme aussi, et
/// une transaction en lecture seule tient un journal que l'on perdrait sans l'avoir demandé.
#[tauri::command]
pub async fn set_folder_read_only(
    request: SetFolderReadOnlyRequest,
    state: State<'_, ConfigState>,
    registry: State<'_, ConnectionRegistry>,
) -> Result<FolderTree, String> {
    regler_la_lecture_seule_du_dossier(&state, &registry, &request).await
}

/// Le corps de `set_folder_read_only`, sans Tauri.
pub(crate) async fn regler_la_lecture_seule_du_dossier(
    state: &ConfigState,
    registry: &ConnectionRegistry,
    request: &SetFolderReadOnlyRequest,
) -> Result<FolderTree, String> {
    let regler = |arbre: &FolderTree| {
        super::enregistrer::regler_la_lecture_seule(arbre, &request.folder, request.read_only)
            .map_err(|erreur| erreur.to_string())
    };

    // D'abord **sans écrire** : ce qu'il faudrait fermer, pour savoir si c'est permis.
    let (avant, projete) = avec_le_magasin(state, |store| {
        let arbre = store.load_tree()?;
        let suivant = regler(&arbre)?;
        Ok((arbre, suivant))
    })?;
    for id in avant.lecture_seule_changee(&projete) {
        if registry.transaction_ouverte(&cle_de_connexion(&id)).await {
            let nom = avant
                .connexion(&id)
                .map(|(base, _)| base.label.clone().unwrap_or_else(|| base.name.clone()))
                .unwrap_or_else(|| id.to_string());
            return Err(format!(
                "une transaction manuelle est ouverte dans une console de « {nom} » : validez-la ou \
                 annulez-la avant de changer la lecture seule de ce dossier. La connexion doit être \
                 rouverte pour suivre le réglage, et la fermer emporterait cette transaction."
            ));
        }
    }

    // L'écriture relit le disque : ce qui est fermé est ce qui a réellement changé.
    let mut changees = Vec::new();
    let ecrit = ecrire_l_arbre(state, |arbre| {
        let suivant = regler(arbre)?;
        changees = arbre.lecture_seule_changee(&suivant);
        Ok(suivant)
    })?;
    for id in &changees {
        registry.fermer(&cle_de_connexion(id)).await;
    }
    log::info!(
        "set_folder_read_only ← {} = {} : {} connexion(s) fermée(s)",
        request.folder,
        request.read_only,
        changees.len()
    );
    Ok(ecrit)
}

// ---------------------------------------------------------------------------------------------
// Déplacer (#167)
// ---------------------------------------------------------------------------------------------

/// Range un dossier ailleurs, ou le réordonne parmi ses frères — voir [`deplacer`].
#[tauri::command]
pub async fn move_folder(
    request: MoveFolderRequest,
    state: State<'_, ConfigState>,
    registry: State<'_, ConnectionRegistry>,
) -> Result<MoveResult, String> {
    deplacer(
        &state,
        &registry,
        &format!("dossier {}", request.folder),
        |arbre| {
            super::arbre::deplacer_dossier(
                arbre,
                &request.folder,
                request.parent.as_ref(),
                request.index,
                request.confirmed,
            )
        },
    )
    .await
}

/// Range une connexion ailleurs, ou la réordonne — voir [`deplacer`].
#[tauri::command]
pub async fn move_database(
    request: MoveDatabaseRequest,
    state: State<'_, ConfigState>,
    registry: State<'_, ConnectionRegistry>,
) -> Result<MoveResult, String> {
    deplacer(
        &state,
        &registry,
        &format!("connexion {}", request.connection),
        |arbre| {
            super::arbre::deplacer_connexion(
                arbre,
                &request.connection,
                request.folder.as_ref(),
                request.index,
                request.confirmed,
            )
        },
    )
    .await
}

/// Le corps des deux déplacements, sans Tauri — **le patron de `set_folder_read_only`**.
///
/// **Ni le registre ni le magasin de secrets ne sont touchés**, sauf pour une seule raison : une
/// connexion dont la lecture seule effective change est **fermée**, parce que sa session a été
/// ouverte avec l'ancien réglage côté moteur (#168). Les autres restent ouvertes — la clé du registre
/// dérive de l'identifiant, que le déplacement ne change pas, et c'est ce que #165 a acheté.
///
/// **Une question n'est pas une erreur** : un déplacement qui changerait la lecture seule sans
/// `confirmed` rend `MoveResult::ConfirmationRequired`, et rien n'est écrit. L'écran la pose dans la
/// modale « Déplacer vers… », que le déplacement vienne de là ou d'un glisser-déposer.
///
/// **Refusé tant qu'une transaction manuelle est ouverte** sur une connexion qu'il faudrait fermer :
/// la fermer emporterait sa transaction (`API-38`).
pub(crate) async fn deplacer(
    state: &ConfigState,
    registry: &ConnectionRegistry,
    sujet: &str,
    geste: impl Fn(&FolderTree) -> Result<FolderTree, DeplacementError>,
) -> Result<MoveResult, String> {
    // Une question se rend en réponse, jamais en refus.
    fn issue(erreur: DeplacementError) -> Result<MoveResult, String> {
        match erreur {
            DeplacementError::ConfirmationRequise {
                devient_lecture_seule,
                quitte_lecture_seule,
                dossiers,
            } => Ok(MoveResult::ConfirmationRequired {
                becomes_read_only: devient_lecture_seule,
                leaves_read_only: quitte_lecture_seule,
                folders: dossiers,
            }),
            autre => Err(autre.to_string()),
        }
    }

    // D'abord **sans écrire** : la question, ou ce qu'il faudrait fermer.
    let calcul = avec_le_magasin(state, |store| {
        let arbre = store.load_tree()?;
        Ok((geste(&arbre), arbre))
    })?;
    let (avant, projete) = match calcul {
        (Ok(projete), avant) => (avant, projete),
        (Err(erreur), _) => return issue(erreur),
    };
    for id in avant.lecture_seule_changee(&projete) {
        if registry.transaction_ouverte(&cle_de_connexion(&id)).await {
            let nom = avant
                .chemin_de(&id)
                .map(|morceaux| morceaux.join(" › "))
                .unwrap_or_else(|| id.to_string());
            return Err(format!(
                "une transaction manuelle est ouverte dans une console de « {nom} », dont ce \
                 déplacement change la lecture seule : validez-la ou annulez-la avant de déplacer. \
                 La connexion doit être rouverte pour suivre le réglage, et la fermer emporterait \
                 cette transaction."
            ));
        }
    }

    // L'écriture relit le disque et **recalcule** : ce qui est fermé est ce qui a réellement changé,
    // et une question qui n'existait pas au calcul — l'arbre a bougé entre-temps — est encore posée.
    let mut changees = Vec::new();
    let mut question = None;
    let ecrit = avec_le_magasin(state, |store| {
        ecrire_l_arbre_sur(store, |arbre| match geste(arbre) {
            Ok(suivant) => {
                changees = arbre.lecture_seule_changee(&suivant);
                Ok(suivant)
            }
            Err(erreur @ DeplacementError::ConfirmationRequise { .. }) => {
                question = Some(erreur);
                Err(String::new())
            }
            Err(autre) => Err(autre.to_string()),
        })
    });
    if let Some(question) = question {
        return issue(question);
    }
    let arbre = ecrit?;
    for id in &changees {
        registry.fermer(&cle_de_connexion(id)).await;
    }
    log::info!(
        "déplacer ← {sujet} : {} connexion(s) fermée(s)",
        changees.len()
    );
    Ok(MoveResult::Moved { tree: arbre })
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

// ---------------------------------------------------------------------------------------------
// Transfert (#169)
// ---------------------------------------------------------------------------------------------

/// Écrit un fichier de transfert : un dossier et son sous-arbre, ou tout l'arbre (`API-30`, #169).
///
/// **L'arbre vient du disque, pas de l'écran** — comme partout ailleurs dans ce module : un arbre
/// envoyé par la webview pourrait être périmé.
#[tauri::command]
pub fn export_projects(
    request: ExportProjectsRequest,
    state: State<'_, ConfigState>,
) -> Result<ExportReport, String> {
    let report = avec_le_magasin(&state, |store| {
        let magasin = magasin_de(store)?;
        exporter_les_dossiers(store, magasin.store.as_ref(), &request)
    })?;
    // Le **chemin n'est pas journalisé** : il vient d'un sélecteur natif, donc il nomme un répertoire
    // de l'utilisateur, et le journal du plugin est écrit sur disque en développement.
    log::info!(
        "export_projects → {} dossier(s), {} connexion(s), {} console(s), {} mot(s) de passe",
        report.folders,
        report.connections,
        report.consoles,
        report.passwords_carried
    );
    Ok(report)
}

/// Le corps d'`export_projects`, sans Tauri : le magasin est passé, pour que les tests le posent.
pub(crate) fn exporter_les_dossiers(
    store: &ConfigStore,
    magasin: &dyn crate::secrets::SecretStore,
    request: &ExportProjectsRequest,
) -> Result<ExportReport, String> {
    let arbre = store.load_tree()?;
    let retenu = super::transfert::composer(&arbre, request.folder.as_ref())
        .map_err(|erreur| erreur.to_string())?;
    // Relues ici plutôt que reçues : l'export porte le chemin de celles que l'arbre retenu
    // référence (`API-70`).
    let kubeconfigs = store.load_kubeconfigs()?;
    let (fichier, report) =
        super::transfert::preparer(retenu, request.include_passwords, magasin, &kubeconfigs)
            .map_err(|erreur| erreur.to_string())?;
    super::transfert::ecrire(std::path::Path::new(&request.file), &fichier)
        .map_err(|erreur| erreur.to_string())?;
    Ok(report)
}

/// Lit un fichier de transfert et dit **ce qu'un import ferait**, sans rien écrire.
///
/// Le rapport vient de la même fonction que l'import lui-même, tout retenu : l'aperçu et l'écriture
/// ne peuvent pas se contredire. Voir `transfert::fusionner`.
#[tauri::command]
pub fn inspect_projects_file(
    file: String,
    state: State<'_, ConfigState>,
) -> Result<ImportReport, String> {
    avec_le_magasin(&state, |store| inspecter_le_fichier(store, &file))
}

pub(crate) fn inspecter_le_fichier(
    store: &ConfigStore,
    file: &str,
) -> Result<ImportReport, String> {
    let arbre = store.load_tree()?;
    let kubeconfigs = store.load_kubeconfigs()?;
    let fichier =
        super::transfert::lire(std::path::Path::new(file)).map_err(|erreur| erreur.to_string())?;
    Ok(super::transfert::fusionner(&arbre, &kubeconfigs, &fichier, None).report)
}

/// Verse les dossiers d'un fichier de transfert dans l'arbre (`API-30`, #169).
///
/// **Le versement est recalculé ici**, sur la configuration telle qu'elle est *maintenant* : rejouer
/// l'aperçu écraserait une connexion créée entre-temps dans un autre écran.
///
/// **Et il peut fermer des connexions**, ce que l'import de projets ne faisait jamais : la lecture
/// seule fusionne en « locale OU fichier », donc un dossier local peut **passer en lecture seule**
/// parce que le fichier la déclare. Ses connexions ouvertes l'ont été inscriptibles côté moteur, et
/// ne le perdraient pas d'elles-mêmes — c'est le patron de `set_folder_read_only`, jusqu'au refus
/// quand une transaction manuelle est ouverte sur l'une d'elles.
#[tauri::command]
pub async fn import_projects(
    request: ImportProjectsRequest,
    state: State<'_, ConfigState>,
    registry: State<'_, ConnectionRegistry>,
) -> Result<ImportProjectsResult, String> {
    let magasin = avec_le_magasin(&state, magasin_de)?;
    let resultat =
        importer_les_dossiers(&state, &registry, magasin.store.as_ref(), &request).await?;
    for sort in &resultat.report.folders {
        log::info!(
            "import_projects → {} : {:?}, +{} dossier(s), +{} connexion(s), +{} console(s)",
            sort.folder.as_deref().unwrap_or("(racine)"),
            sort.verdict,
            sort.folders_added.len(),
            sort.connections_added.len(),
            sort.consoles_added.len()
        );
    }
    Ok(resultat)
}

/// Le corps d'`import_projects`, sans Tauri.
pub(crate) async fn importer_les_dossiers(
    state: &ConfigState,
    registry: &ConnectionRegistry,
    magasin: &dyn crate::secrets::SecretStore,
    request: &ImportProjectsRequest,
) -> Result<ImportProjectsResult, String> {
    let chemin = std::path::Path::new(&request.file);
    let fichier = super::transfert::lire(chemin).map_err(|erreur| erreur.to_string())?;

    // D'abord **sans écrire** : ce qu'il faudrait fermer, pour savoir si c'est permis.
    let (avant, projete) = avec_le_magasin(state, |store| {
        let arbre = store.load_tree()?;
        let kubeconfigs = store.load_kubeconfigs()?;
        let fusion =
            super::transfert::fusionner(&arbre, &kubeconfigs, &fichier, request.selection.as_ref());
        Ok((arbre, fusion.arbre))
    })?;
    for id in avant.lecture_seule_changee(&projete) {
        if registry.transaction_ouverte(&cle_de_connexion(&id)).await {
            let nom = avant
                .chemin_de(&id)
                .map(|morceaux| morceaux.join(" › "))
                .unwrap_or_else(|| id.to_string());
            return Err(format!(
                "une transaction manuelle est ouverte dans une console de « {nom} », que cet import \
                 ferait passer en lecture seule : validez-la ou annulez-la avant d'importer. La \
                 connexion doit être rouverte pour suivre le réglage, et la fermer emporterait \
                 cette transaction."
            ));
        }
    }

    let mut changees = Vec::new();
    let (arbre, report) = avec_le_magasin(state, |store| {
        let locaux = store.load_tree()?;
        let kubeconfigs = store.load_kubeconfigs()?;
        let fusion = super::transfert::fusionner(
            &locaux,
            &kubeconfigs,
            &fichier,
            request.selection.as_ref(),
        );
        changees = locaux.lecture_seule_changee(&fusion.arbre);
        super::transfert::appliquer(fusion, magasin, &mut |arbre, kubeconfigs| {
            // **Pas par `ecrire_le_reste_intact`**, et c'est le seul appelant dans ce cas : le
            // versement vient de faire grandir les kubeconfigs, et les relire écraserait les
            // déclarations que l'import pose. Le reste — préférences, instances — est relu.
            let preferences = store.load_preferences().unwrap_or_default();
            let instances = store.load_instances().unwrap_or_default();
            store
                .save(arbre, &preferences, &instances, kubeconfigs)
                .map_err(|erreur| erreur.to_string())
        })
        .map_err(|erreur| erreur.to_string())
    })?;

    for id in &changees {
        registry.fermer(&cle_de_connexion(id)).await;
    }
    Ok(ImportProjectsResult {
        tree: arbre,
        report,
    })
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

/// L'import peut faire passer un dossier local en lecture seule, donc **fermer** ses connexions
/// ouvertes (#169) — le patron de `set_folder_read_only`, sur un vrai fichier SQLite.
#[cfg(test)]
mod tests_import {
    use super::*;
    use crate::config::arbre::tests::{base, dossier};
    use crate::config::doubles::MagasinSync;
    use crate::config::model::{Engine, SslMode};
    use crate::config::requetes::ImportProjectsRequest;
    use crate::engine::registry::ConnectionState;
    use crate::engine::{RowLimit, TransactionMode};

    struct Decor {
        _repertoire: tempfile::TempDir,
        config: ConfigState,
        registre: ConnectionRegistry,
        fichier: std::path::PathBuf,
        chemin_config: std::path::PathBuf,
    }

    fn cle() -> String {
        cle_de_connexion(&ConnectionId::brut("jetons"))
    }

    /// Un dossier « prod » **inscriptible** portant une connexion SQLite ouverte, et un fichier de
    /// transfert qui déclare un « prod » homonyme, en lecture seule ou non.
    async fn monter(fichier_en_lecture_seule: bool) -> Decor {
        let repertoire = tempfile::tempdir().expect("répertoire temporaire");
        let base_sqlite = repertoire.path().join("atelier.db");
        rusqlite::Connection::open(&base_sqlite)
            .expect("fichier")
            .execute_batch("create table jetons (valeur integer)")
            .expect("décor");
        let mut connexion = base("jetons", false);
        connexion.engine = Engine::Sqlite;
        connexion.connection.default_database = base_sqlite.to_string_lossy().into_owned();
        connexion.connection.ssl_mode = SslMode::Disable;
        let mut prod = dossier("prod", "prod", false);
        prod.connections.push(connexion.clone());
        let chemin_config = repertoire.path().join("config.json");
        let (store, _) = ConfigStore::open(&chemin_config);
        ecrire_le_reste_intact(
            &store,
            &FolderTree {
                folders: vec![prod],
                connections: Vec::new(),
            },
        )
        .expect("écrit");

        let fichier = repertoire.path().join("export.json");
        std::fs::write(
            &fichier,
            serde_json::json!({
                "kind": "dorabase.projects",
                "version": 7,
                "folders": [{ "id": "ailleurs", "name": "prod", "readOnly": fichier_en_lecture_seule }],
            })
            .to_string(),
        )
        .expect("export");

        let registre = ConnectionRegistry::new();
        registre
            .ouvrir(
                &cle(),
                Engine::Sqlite,
                &connexion.connection,
                None,
                &crate::engine::proxy::ContexteDeProxy::pour_les_tests(),
            )
            .await
            .expect("un fichier SQLite doit s'ouvrir");
        Decor {
            _repertoire: repertoire,
            config: ConfigState::ouvert(store),
            registre,
            fichier,
            chemin_config,
        }
    }

    fn requete(decor: &Decor) -> ImportProjectsRequest {
        ImportProjectsRequest {
            file: decor.fichier.to_string_lossy().into_owned(),
            selection: None,
        }
    }

    #[tokio::test]
    async fn un_import_qui_pose_la_lecture_seule_ferme_la_connexion_et_attend_la_transaction() {
        let decor = monter(true).await;
        let magasin = MagasinSync::default();
        decor
            .registre
            .executer_une_requete(
                &cle(),
                "insert into jetons values (1)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                "console",
            )
            .await
            .expect("retenue");

        let refus =
            importer_les_dossiers(&decor.config, &decor.registre, &magasin, &requete(&decor))
                .await
                .expect_err("refus attendu");
        assert!(refus.contains("transaction manuelle"), "{refus}");
        let (store, _) = ConfigStore::open(&decor.chemin_config);
        assert!(
            !store.load_tree().expect("relu").folders[0].read_only,
            "rien n'est écrit"
        );

        decor
            .registre
            .annuler_la_transaction(&cle(), "console")
            .await
            .expect("annulée");
        let resultat =
            importer_les_dossiers(&decor.config, &decor.registre, &magasin, &requete(&decor))
                .await
                .expect("importé");

        assert!(resultat.tree.folders[0].read_only);
        assert_eq!(
            resultat.report.folders[0].read_only_from_file,
            vec!["prod".to_owned()]
        );
        // **La connexion est fermée**, pour se rouvrir avec la session en lecture seule.
        assert!(matches!(
            decor.registre.etat(&cle()).await,
            ConnectionState::Never
        ));
    }

    #[tokio::test]
    async fn un_import_qui_ne_change_aucune_lecture_seule_ne_ferme_rien() {
        let decor = monter(false).await;
        let magasin = MagasinSync::default();

        importer_les_dossiers(&decor.config, &decor.registre, &magasin, &requete(&decor))
            .await
            .expect("importé");

        assert_eq!(decor.registre.ouvertes().await, 1);
    }

    #[test]
    fn exporter_puis_inspecter_rend_le_rapport_de_l_arbre_local() {
        let repertoire = tempfile::tempdir().expect("répertoire temporaire");
        let (store, _) = ConfigStore::open(repertoire.path().join("config.json"));
        let mut prod = dossier("prod", "prod", true);
        prod.connections.push(base("jetons", false));
        let mut halle = dossier("halle", "Halle", false);
        halle.folders.push(prod);
        ecrire_le_reste_intact(
            &store,
            &FolderTree {
                folders: vec![halle],
                connections: Vec::new(),
            },
        )
        .expect("écrit");
        let fichier = repertoire.path().join("prod.json");

        let report = exporter_les_dossiers(
            &store,
            &MagasinSync::default(),
            &ExportProjectsRequest {
                file: fichier.to_string_lossy().into_owned(),
                folder: Some(FolderId::brut("prod")),
                include_passwords: false,
            },
        )
        .expect("exporté");
        assert_eq!((report.folders, report.connections), (1, 1));

        // Réinspecté sur le même poste : la connexion est reconnue par son identifiant, donc le
        // dossier « prod » n'a **rien à apporter** et n'est pas créé à la racine (#108) — il y
        // aurait été un dossier vide à côté de « Halle ».
        let apercu = inspecter_le_fichier(&store, &fichier.to_string_lossy()).expect("inspecté");
        assert_eq!(
            apercu.folders[0].verdict,
            crate::config::requetes::FolderVerdict::Omitted
        );
        assert_eq!(apercu.folders[0].folders_omitted, vec!["prod".to_owned()]);
        assert_eq!(
            apercu.folders[0].connections_kept,
            vec!["Halle › prod › base-jetons".to_owned()]
        );
    }
}

/// Déplacer ne ferme que ce dont la lecture seule change (#167), sur un vrai fichier SQLite.
#[cfg(test)]
mod tests_deplacer {
    use super::*;
    use crate::config::arbre::tests::{base, dossier};
    use crate::config::model::{Engine, SslMode};
    use crate::engine::registry::ConnectionState;
    use crate::engine::{RowLimit, TransactionMode};

    struct Decor {
        _repertoire: tempfile::TempDir,
        config: ConfigState,
        registre: ConnectionRegistry,
        chemin_config: std::path::PathBuf,
    }

    fn cle() -> String {
        cle_de_connexion(&ConnectionId::brut("jetons"))
    }

    /// `dev` (inscriptible) porte une connexion SQLite **ouverte** ; `prod` est en lecture seule,
    /// `outils` inscriptible, tous deux vides.
    async fn monter() -> Decor {
        let repertoire = tempfile::tempdir().expect("répertoire temporaire");
        let base_sqlite = repertoire.path().join("atelier.db");
        rusqlite::Connection::open(&base_sqlite)
            .expect("fichier")
            .execute_batch("create table jetons (valeur integer)")
            .expect("décor");
        let mut connexion = base("jetons", false);
        connexion.engine = Engine::Sqlite;
        connexion.connection.default_database = base_sqlite.to_string_lossy().into_owned();
        connexion.connection.ssl_mode = SslMode::Disable;
        let mut dev = dossier("dev", "dev", false);
        dev.connections.push(connexion.clone());
        let chemin_config = repertoire.path().join("config.json");
        let (store, _) = ConfigStore::open(&chemin_config);
        ecrire_le_reste_intact(
            &store,
            &FolderTree {
                folders: vec![
                    dev,
                    dossier("prod", "prod", true),
                    dossier("outils", "outils", false),
                ],
                connections: Vec::new(),
            },
        )
        .expect("écrit");

        let registre = ConnectionRegistry::new();
        registre
            .ouvrir(
                &cle(),
                Engine::Sqlite,
                &connexion.connection,
                None,
                &crate::engine::proxy::ContexteDeProxy::pour_les_tests(),
            )
            .await
            .expect("un fichier SQLite doit s'ouvrir");
        Decor {
            _repertoire: repertoire,
            config: ConfigState::ouvert(store),
            registre,
            chemin_config,
        }
    }

    async fn deplacer_vers(
        decor: &Decor,
        dossier: &str,
        confirme: bool,
    ) -> Result<MoveResult, String> {
        let destination = FolderId::brut(dossier);
        deplacer(&decor.config, &decor.registre, "jetons", |arbre| {
            crate::config::arbre::deplacer_connexion(
                arbre,
                &ConnectionId::brut("jetons"),
                Some(&destination),
                None,
                confirme,
            )
        })
        .await
    }

    fn dossier_sur_le_disque(decor: &Decor) -> String {
        let (store, _) = ConfigStore::open(&decor.chemin_config);
        let arbre = store.load_tree().expect("relu");
        let (_, ancetres) = arbre
            .connexion(&ConnectionId::brut("jetons"))
            .expect("toujours déclarée");
        ancetres.last().expect("rangée").id.to_string()
    }

    /// **La connexion ouverte reste `Connected`** : ni le registre ni le magasin ne sont touchés, la
    /// clé dérivant d'un identifiant que le déplacement ne change pas. Sabotage vérifié : fermer
    /// toutes les connexions du sujet fait tomber ce test.
    #[tokio::test]
    async fn une_connexion_ouverte_deplacee_sans_changer_de_lecture_seule_reste_connectee() {
        let decor = monter().await;

        let issue = deplacer_vers(&decor, "outils", false)
            .await
            .expect("déplacée");

        assert!(matches!(issue, MoveResult::Moved { .. }));
        assert_eq!(dossier_sur_le_disque(&decor), "outils");
        assert!(matches!(
            decor.registre.etat(&cle()).await,
            ConnectionState::Connected { .. }
        ));
    }

    #[tokio::test]
    async fn sans_confirmation_une_entree_en_lecture_seule_est_une_question_et_rien_ne_bouge() {
        let decor = monter().await;

        let issue = deplacer_vers(&decor, "prod", false)
            .await
            .expect("une question n'est pas un refus");

        match issue {
            MoveResult::ConfirmationRequired {
                becomes_read_only,
                leaves_read_only,
                folders,
            } => {
                assert_eq!(becomes_read_only, vec![ConnectionId::brut("jetons")]);
                assert!(leaves_read_only.is_empty());
                assert_eq!(folders, vec![FolderId::brut("prod")]);
            }
            autre => panic!("question attendue, reçu {autre:?}"),
        }
        assert_eq!(dossier_sur_le_disque(&decor), "dev", "rien n'est écrit");
        assert_eq!(decor.registre.ouvertes().await, 1, "rien n'est fermé");
    }

    #[tokio::test]
    async fn confirmee_elle_attend_la_transaction_puis_ferme_la_connexion() {
        let decor = monter().await;
        decor
            .registre
            .executer_une_requete(
                &cle(),
                "insert into jetons values (1)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                "console",
            )
            .await
            .expect("retenue");

        let refus = deplacer_vers(&decor, "prod", true)
            .await
            .expect_err("refus attendu");
        assert!(refus.contains("transaction manuelle"), "{refus}");
        assert!(
            refus.contains("dev › base-jetons"),
            "le refus nomme la connexion : {refus}"
        );
        assert_eq!(dossier_sur_le_disque(&decor), "dev", "rien n'est écrit");

        decor
            .registre
            .annuler_la_transaction(&cle(), "console")
            .await
            .expect("annulée");
        let issue = deplacer_vers(&decor, "prod", true).await.expect("déplacée");

        assert!(matches!(issue, MoveResult::Moved { .. }));
        assert_eq!(dossier_sur_le_disque(&decor), "prod");
        // **Fermée**, pour se rouvrir avec la session en lecture seule côté moteur (#168).
        assert!(matches!(
            decor.registre.etat(&cle()).await,
            ConnectionState::Never
        ));
    }

    #[tokio::test]
    async fn un_refus_est_une_erreur_et_non_une_question() {
        let decor = monter().await;
        let refus = deplacer(&decor.config, &decor.registre, "dev", |arbre| {
            crate::config::arbre::deplacer_dossier(
                arbre,
                &FolderId::brut("dev"),
                Some(&FolderId::brut("dev")),
                None,
                true,
            )
        })
        .await
        .expect_err("refus attendu");
        assert!(refus.contains("lui-même"), "{refus}");
    }
}
