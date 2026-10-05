//! Le contrat IPC de l'arbre de dossiers (#164), **déclaré avant d'être branché**.
//!
//! # Pourquoi maintenant, et pourquoi à part
//!
//! #165 (le cœur) et #166 (l'écran) s'écrivent en parallèle : le premier branche ces commandes, le
//! second les appelle contre `?demo`. Ils ne peuvent le faire que contre une forme **figée**, et c'est
//! ici qu'elle l'est — chaque requête, chaque réponse, chaque champ.
//!
//! **Un module et un fichier de projection à part** (`src/domain/arbre.ts`), et c'est forcé : la
//! plupart de ces types gardent le nom de celui qu'ils remplacent — `SaveDatabaseRequest`,
//! `ConsoleRequest`, `ConfigLoad`, `DatabaseKey`… — et les anciens vivent encore dans `config.ts`,
//! `engine.ts` et `dump.ts`, où l'écran d'aujourd'hui les lit. Deux types de même nom ne tiennent pas
//! dans un même fichier TypeScript. **L'emplacement est définitif** : à la bascule, #165 retire les
//! anciens et fait employer ceux-ci à ses commandes sans les déplacer, pour que les imports que #166
//! aura écrits vers `domain/arbre` restent vrais. Rien ici n'est encore appelé.
//!
//! # Les commandes, et ce qu'elles prennent
//!
//! Toutes prennent un seul argument nommé `request` (sauf mention), lisent le disque et rendent
//! l'arbre **entier** — le front le repose, ce qui déclenche la relecture des états et la purge du
//! cache de l'arbre (« Le cache de l'arbre suit le registre »).
//!
//! | Commande | Requête | Réponse |
//! |---|---|---|
//! | `load_config` | — | [`ConfigLoad`] |
//! | `save_config` | `tree: FolderTree` | `()` |
//! | `create_folder` | [`CreateFolderRequest`] | [`CreateFolderResult`] |
//! | `rename_folder` | [`RenameFolderRequest`] | `FolderTree` |
//! | `recolor_folder` | [`RecolorFolderRequest`] | `FolderTree` |
//! | `set_folder_icon` | [`SetFolderIconRequest`] | `FolderTree` |
//! | `set_folder_read_only` | [`SetFolderReadOnlyRequest`] | `FolderTree` |
//! | `delete_folder` (async) | [`DeleteFolderRequest`] | [`DeleteResult`] |
//! | `move_folder` | [`MoveFolderRequest`] | [`MoveResult`] |
//! | `move_database` | [`MoveDatabaseRequest`] | [`MoveResult`] |
//! | `save_database` | [`SaveDatabaseRequest`] | [`SaveDatabaseResult`] |
//! | `update_variant` (async) | [`UpdateVariantRequest`] | `FolderTree` |
//! | `rename_database` | [`RenameDatabaseRequest`] | `FolderTree` |
//! | `recolor_database` | [`RecolorDatabaseRequest`] | `FolderTree` |
//! | `set_database_icon` | [`SetDatabaseIconRequest`] | `FolderTree` |
//! | `delete_database` (async) | [`DeleteDatabaseRequest`] | [`DeleteResult`] |
//! | `create_console`, `save_console`, `rename_console`, `delete_console` | [`ConsoleRequest`] | `FolderTree` |
//! | `save_visible_schemas` | [`VisibleSchemasRequest`] | `FolderTree` |
//! | `save_value_labels` | [`ValueLabelsRequest`] | `FolderTree` |
//! | `export_projects` | [`ExportProjectsRequest`] | [`ExportReport`] |
//! | `inspect_projects_file` | `file: String` | [`ImportReport`] |
//! | `import_projects` | [`ImportProjectsRequest`] | [`ImportProjectsResult`] |
//! | commandes du moteur, `connection_states`, dump | [`DatabaseKey`], [`ConnectionStateEntry`], [`DumpRequest`] | inchangées |
//!
//! **Supprimées à la bascule** : `create_project`, `rename_project`, `delete_project`,
//! `create_environment`, `rename_environment`, `recolor_environment`, `reorder_environments`,
//! `delete_environment` — et avec elles `RenameResult`, dont les secrets manquants ou résiduels
//! n'ont plus de raison d'être : un renommage ne déplace plus aucun secret.
//!
//! # Les refus
//!
//! Toutes les commandes rendent `Result<_, String>` : un refus est une phrase, comme aujourd'hui.
//! **Une seule exception, et elle est structurelle** : un déplacement qui changerait la lecture seule
//! effective d'une connexion sans avoir été confirmé n'est pas une erreur, c'est une **question** —
//! [`MoveResult::ConfirmationRequired`] porte de quoi la poser, et l'écran la pose dans la même
//! modale que « Déplacer vers… » (#167).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::arbre::{ConnectionId, FolderColor, FolderId, FolderTree};
use super::model::{ConnectionSettings, Engine, Kubeconfigs, ManagedInstance, Preferences};
use crate::engine::registry::ConnectionState;

// ---------------------------------------------------------------------------------------------------
// Chargement (#165)
// ---------------------------------------------------------------------------------------------------

/// L'issue de `load_config` en v7 — celle d'aujourd'hui, l'arbre à la place des projets, **plus un
/// cinquième cas**.
#[derive(Debug, Serialize, TS)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
#[ts(export_to = "arbre.ts")]
pub enum ConfigLoad {
    /// Aucun fichier : premier lancement, l'écran `A1` s'applique.
    Fresh,
    Loaded {
        tree: FolderTree,
        preferences: Preferences,
        instances: Vec<ManagedInstance>,
        kubeconfigs: Kubeconfigs,
    },
    /// **Le cas nouveau** : le fichier est lisible, mais le déplacement des mots de passe vers leur
    /// nouvelle référence n'a pas abouti. Rien n'est perdu — les originaux n'ont pas bougé et le
    /// fichier est resté en v6 —, et rien n'est mis en quarantaine, puisque rien n'est illisible.
    /// **L'écriture est bloquée**, comme pour les deux cas suivants ; `reason` dit quoi faire
    /// (« relancez DoraBase »).
    SecretsMigrationFailed {
        reason: String,
    },
    Unreadable {
        reason: String,
        quarantined_to: String,
    },
    TooNew {
        found: u32,
        supported: u32,
    },
}

// ---------------------------------------------------------------------------------------------------
// Désigner une connexion (#165)
// ---------------------------------------------------------------------------------------------------

/// Ce qui désigne une connexion ouverte, pour les vingt commandes du moteur et le dump : son
/// identifiant, **et rien d'autre**. Le triplet `projet/base/environnement` disparaît.
///
/// Le cœur en dérive la clé du registre par `cle_de_connexion` ; le front n'a aucune convention à
/// connaître.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct DatabaseKey {
    pub connection: ConnectionId,
}

impl DatabaseKey {
    /// La clé du registre de cette connexion — `connexion/<id>`, par la seule convention.
    pub fn cle(&self) -> String {
        super::arbre::cle_de_connexion(&self.connection)
    }
}

/// Un état de connexion, avec la connexion qu'il concerne — ce que `connection_states` rend.
///
/// Les entrées d'instance (`instance/<id>`) n'y figurent pas, comme aujourd'hui.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct ConnectionStateEntry {
    pub key: DatabaseKey,
    pub state: ConnectionState,
}

/// La requête d'export ou d'import de dump — celle d'aujourd'hui, désignée par l'identifiant.
///
/// **`variant.readOnly` n'est plus cru** (#168) : le refus d'importer lit la lecture seule effective
/// dans la configuration, par `key.connection`.
#[derive(Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct DumpRequest {
    pub key: DatabaseKey,
    pub variant: ConnectionSettings,
    pub engine: Engine,
    pub file: String,
}

// ---------------------------------------------------------------------------------------------------
// Dossiers (#165, #166)
// ---------------------------------------------------------------------------------------------------

/// `create_folder` : un dossier neuf, nommé « dossier N » — le plus petit N libre parmi ses frères.
///
/// **Aucune modale ne nomme un objet à sa création** : on le crée, puis on le renomme sur place.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct CreateFolderRequest {
    /// `None` : à la racine.
    pub parent: Option<FolderId>,
}

/// Ce que `create_folder` rend : l'arbre, **et l'identifiant du dossier créé**.
///
/// L'identifiant est tiré par le cœur ; sans lui, l'écran ne saurait pas quelle ligne passer en
/// renommage sur place — deviner « le dernier enfant » cesserait d'être vrai au premier tri.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct CreateFolderResult {
    pub tree: FolderTree,
    pub folder: FolderId,
}

/// `rename_folder` : **synchrone**, ne ferme rien et ne touche à aucun secret.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct RenameFolderRequest {
    pub folder: FolderId,
    pub name: String,
}

/// `recolor_folder`.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct RecolorFolderRequest {
    pub folder: FolderId,
    /// `None` retire la pastille.
    pub color: Option<FolderColor>,
}

/// `set_folder_icon` (#171).
///
/// **Une commande à part plutôt qu'un `recolor_folder` élargi** : la modale applique chaque choix au
/// clic, et une commande qui réglerait les deux ferait renvoyer la couleur *affichée* à chaque clic
/// d'icône — donc écraser une couleur encore en vol, si les deux gestes se suivent de près.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct SetFolderIconRequest {
    pub folder: FolderId,
    /// `None` rend l'icône par défaut (`pin`).
    pub icon: Option<String>,
}

/// `set_folder_read_only` — l'effet sur les écrans est celui de #168.
///
/// Refusé tant qu'une console d'une connexion dont la lecture seule changerait tient une transaction
/// manuelle (#168) : le refus nomme la connexion.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct SetFolderReadOnlyRequest {
    pub folder: FolderId,
    pub read_only: bool,
}

/// `delete_folder` : ferme toutes les connexions du sous-arbre et efface leurs secrets.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct DeleteFolderRequest {
    pub folder: FolderId,
}

/// Ce que rend un retrait — d'un dossier comme d'une connexion.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct DeleteResult {
    pub tree: FolderTree,
    /// Les connexions retirées : une seule pour `delete_database`, tout le sous-arbre pour
    /// `delete_folder`. **C'est ce que l'écran ferme** — onglets, états, cache —, et le lui dire
    /// évite qu'il le recalcule sur un arbre qui ne les contient déjà plus.
    pub deleted_connections: Vec<ConnectionId>,
    /// Les mots de passe que le magasin n'a pas su effacer.
    pub leftover_secrets: Vec<String>,
}

// ---------------------------------------------------------------------------------------------------
// Déplacer (#167)
// ---------------------------------------------------------------------------------------------------

/// `move_folder` : ranger un dossier ailleurs, ou le réordonner parmi ses frères.
///
/// Refusé : le dossier lui-même ou l'un de ses descendants comme destination, un identifiant
/// inconnu, un frère homonyme à l'arrivée (pas de renommage automatique), et une transaction
/// manuelle ouverte sur une connexion dont la lecture seule changerait.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct MoveFolderRequest {
    pub folder: FolderId,
    /// `None` : à la racine.
    pub parent: Option<FolderId>,
    /// La place parmi les frères d'arrivée, **le dossier déplacé exclu du compte** ; `None`, ou un
    /// rang trop grand : en dernier.
    pub index: Option<usize>,
    /// **Exigé côté cœur** quand le déplacement change la lecture seule effective d'au moins une
    /// connexion, dans un sens ou dans l'autre. Faux, la commande rend
    /// [`MoveResult::ConfirmationRequired`] et ne déplace rien.
    pub confirmed: bool,
}

/// `move_database` : ranger une connexion ailleurs, ou la réordonner. Mêmes règles que
/// [`MoveFolderRequest`] ; ni le registre ni le magasin de secrets ne sont touchés.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct MoveDatabaseRequest {
    pub connection: ConnectionId,
    /// `None` : à la racine.
    pub folder: Option<FolderId>,
    pub index: Option<usize>,
    pub confirmed: bool,
}

/// L'issue d'un déplacement.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
#[ts(export_to = "arbre.ts")]
pub enum MoveResult {
    Moved {
        tree: FolderTree,
    },
    /// Rien n'a bougé : le déplacement changerait la lecture seule effective, et `confirmed` était
    /// faux. **Sortir d'un dossier en lecture seule est permis, mais confirmé et nommé** (#108).
    ConfirmationRequired {
        /// Les connexions qui passeraient en lecture seule.
        becomes_read_only: Vec<ConnectionId>,
        /// Les connexions qui quitteraient une lecture seule imposée.
        leaves_read_only: Vec<ConnectionId>,
        /// Les dossiers qui imposent ou imposaient la lecture seule — pour que la modale les nomme.
        folders: Vec<FolderId>,
    },
}

// ---------------------------------------------------------------------------------------------------
// Connexions (#165)
// ---------------------------------------------------------------------------------------------------

/// `save_database` : déclarer une connexion **dans un dossier** — le dossier est le cadre d'`A2`.
///
/// L'identifiant est tiré par le cœur. Le mot de passe voyage en clair et séparé, comme aujourd'hui.
#[derive(Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct SaveDatabaseRequest {
    /// `None` : à la racine.
    pub folder: Option<FolderId>,
    /// Le nom technique (`Database::name`). Vide, le cœur y met l'abréviation du moteur.
    pub name: String,
    pub engine: Engine,
    pub variant: ConnectionSettings,
    pub password: Option<String>,
    pub label: Option<String>,
}

/// Ce que `save_database` rend : l'arbre, **et l'identifiant de la connexion créée**, pour que
/// l'écran la sélectionne ou la déplie.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct SaveDatabaseResult {
    pub tree: FolderTree,
    pub connection: ConnectionId,
}

/// `update_variant` : **ferme toujours** la connexion — l'hôte peut avoir changé —, et **refuse**
/// tant qu'une console y tient une transaction manuelle, que la fermeture emporterait (#174).
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct UpdateVariantRequest {
    pub connection: ConnectionId,
    pub variant: ConnectionSettings,
    /// `None` laisse le mot de passe en place.
    pub password: Option<String>,
    /// La valeur définitive du libellé ; vide ou `None` l'efface.
    pub label: Option<String>,
}

/// `rename_database` : **synchrone** ; ne ferme rien, ne déplace rien, ne touche à aucun secret.
/// Il change `Database::name`, jamais `label`.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct RenameDatabaseRequest {
    pub connection: ConnectionId,
    pub name: String,
}

/// `recolor_database` (#179) : la pastille d'une connexion, dans la palette des dossiers. **Ne ferme
/// rien** — un réglage d'affichage.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct RecolorDatabaseRequest {
    pub connection: ConnectionId,
    /// `None` rend les couleurs du moteur.
    pub color: Option<FolderColor>,
}

/// `set_database_icon` (#179).
///
/// **Une commande à part, pour la raison de [`SetFolderIconRequest`]** : le panneau applique chaque
/// choix au clic, et une commande qui réglerait les deux renverrait la couleur *affichée* à chaque
/// clic d'icône.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct SetDatabaseIconRequest {
    pub connection: ConnectionId,
    /// `None` rend le logo du moteur.
    pub icon: Option<String>,
}

/// `delete_database`.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct DeleteDatabaseRequest {
    pub connection: ConnectionId,
}

/// `create_console`, `save_console`, `rename_console`, `delete_console`.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct ConsoleRequest {
    pub connection: ConnectionId,
    pub name: String,
    /// Le texte, pour l'écriture. Ignoré par les trois autres.
    pub sql: Option<String>,
    /// Le nouveau nom, pour le renommage.
    pub rename_to: Option<String>,
}

/// `save_visible_schemas` — ne ferme pas la connexion.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct VisibleSchemasRequest {
    pub connection: ConnectionId,
    /// La liste vide est un réglage — « aucun ».
    pub schemas: Vec<String>,
}

/// `save_value_labels` — **le dossier est résolu par le cœur** : celui qui fournit actuellement la
/// table à cette connexion, sinon son dossier racine. Une connexion rangée à la racine est refusée
/// (« rangez la connexion dans un dossier »).
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct ValueLabelsRequest {
    pub connection: ConnectionId,
    pub table: String,
    pub column: String,
    /// La table vide retire la déclaration de cette colonne.
    pub labels: BTreeMap<String, String>,
}

// ---------------------------------------------------------------------------------------------------
// Transfert (#169)
// ---------------------------------------------------------------------------------------------------

/// Ce que le fichier porte des mots de passe, tel que son en-tête l'annonce.
///
/// **Sorti de `transfert.rs` par #165**, qui retire ce module du build jusqu'à #169 : le contrat de
/// l'import en a besoin, et sa projection reste dans `transfert.ts`, à la même place, pour que rien
/// ne bouge côté écran. #169 le fera employer par `transfert.rs` d'ici plutôt que de le redéclarer.
///
/// **Recalculé à la lecture, jamais cru sur parole** : un en-tête faux est pire qu'un en-tête
/// absent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export_to = "transfert.ts")]
pub enum CarriedSecrets {
    /// Aucun mot de passe dans le fichier. Le défaut, y compris pour un en-tête muet.
    #[default]
    #[serde(rename = "none")]
    NotCarried,
    /// Des mots de passe **en clair**.
    #[serde(rename = "embedded")]
    Embedded,
}

/// `export_projects` : un dossier et son sous-arbre, ou tout l'arbre. Les noms de commande restent
/// ceux d'`API-30`.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct ExportProjectsRequest {
    pub file: String,
    /// Le dossier à exporter, qui devient un dossier racine du fichier — sa lecture seule et ses
    /// libellés hérités **matérialisés**. `None` : tout l'arbre, connexions à la racine comprises.
    pub folder: Option<FolderId>,
    pub include_passwords: bool,
}

/// Ce qu'un export a écrit.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct ExportReport {
    /// Les dossiers écrits, à toute profondeur.
    pub folders: usize,
    pub connections: usize,
    pub consoles: usize,
    pub passwords_carried: usize,
    /// Les connexions dont le magasin n'a rien à rendre, par leur chemin (« Atelier Nord › prod ›
    /// analytics »).
    pub passwords_missing: Vec<String>,
}

/// Ce que la modale d'import retient. `None` dans [`ImportProjectsRequest`] retient tout.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct ImportSelection {
    /// Les dossiers de premier niveau du fichier retenus, **par nom** — c'est ainsi qu'ils
    /// s'apparient.
    pub folders: Vec<String>,
    /// Retenir aussi les connexions que le fichier range à la racine.
    pub root_connections: bool,
}

/// `import_projects`.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct ImportProjectsRequest {
    pub file: String,
    pub selection: Option<ImportSelection>,
}

/// Ce qu'un import rend : l'arbre d'après, et le rapport.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct ImportProjectsResult {
    pub tree: FolderTree,
    pub report: ImportReport,
}

/// Ce qu'un import ferait, ou a fait — le même calcul dans les deux cas.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct ImportReport {
    /// La version que le fichier déclare ; une antérieure a été migrée à la lecture.
    pub version: u32,
    pub secrets: CarriedSecrets,
    /// Un sort par dossier de premier niveau du fichier, dans l'ordre du fichier, **puis** une ligne
    /// pour les connexions rangées à la racine du fichier s'il en porte (`folder: null`).
    pub folders: Vec<FolderOutcome>,
}

/// Le sort d'une entrée du fichier.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
#[ts(export_to = "arbre.ts")]
pub enum FolderVerdict {
    /// Aucun frère homonyme à la racine : le dossier arrive entier.
    Created,
    /// Un dossier racine de ce nom existe : fusion récursive, rien n'est écrasé.
    Merged,
    /// Aucun homonyme, mais **rien à créer** : tout ce que le dossier porte est déjà ici — ses
    /// connexions, reconnues par identifiant, restent où elles sont. Le cas d'un sous-dossier
    /// réimporté sur son poste d'origine (#108) : le créer ferait un dossier racine vide.
    Omitted,
    /// Décoché par l'utilisateur.
    Skipped,
    /// Refusé : versé, l'arbre ne tiendrait pas ses invariants.
    Rejected { reason: String },
}

/// Le détail de ce qu'une entrée du fichier apporte, et de ce qu'elle n'apporte pas.
///
/// Les listes d'`ProjectOutcome` gardent leur sens ; les connexions s'y écrivent par leur **chemin**
/// (« Atelier Nord › prod › analytics »), les dossiers aussi.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "arbre.ts")]
pub struct FolderOutcome {
    /// Le nom du dossier de premier niveau ; `None` pour la ligne « connexions à la racine ».
    pub folder: Option<String>,
    pub verdict: FolderVerdict,
    /// Les dossiers que la fusion crée, à toute profondeur.
    pub folders_added: Vec<String>,
    /// Les dossiers déjà présents ici (même nom, même place) : **nom et couleur locaux gardés**.
    pub folders_kept: Vec<String>,
    /// Les dossiers que la fusion **aurait créés** et qu'elle omet, parce que leur sous-arbre
    /// n'apporte rien — ni connexion, ni sous-dossier retenu, ni libellé (#108). Leurs connexions
    /// sont déjà déclarées ici, ailleurs : le dossier serait un contenant vide.
    pub folders_omitted: Vec<String>,
    /// Les dossiers locaux qui **passent en lecture seule** parce que le fichier la déclare : la
    /// lecture seule fusionne en « local OU fichier », jamais affaiblie.
    pub read_only_from_file: Vec<String>,
    pub connections_added: Vec<String>,
    /// Les connexions dont l'identifiant existe déjà ici, où que ce soit : réglages et emplacement
    /// locaux gardés, consoles versées. Écrites par leur chemin **local**.
    pub connections_kept: Vec<String>,
    pub connections_rejected: Vec<String>,
    pub consoles_added: Vec<String>,
    pub consoles_kept: Vec<String>,
    pub passwords_stored: Vec<String>,
    pub passwords_missing: Vec<String>,
    pub local_paths: Vec<String>,
    pub value_labels_added: Vec<String>,
    pub value_labels_kept: Vec<String>,
    pub kubeconfigs_missing: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Le contrat est ce que #165 et #166 écrivent chacun de leur côté : sa forme JSON est gardée ici,
    /// sur les trois points où une étiquette ou un renommage de champ passerait inaperçu.
    #[test]
    fn la_forme_json_du_contrat_est_figee() {
        let cle: DatabaseKey =
            serde_json::from_value(serde_json::json!({ "connection": "8c1e4f0a9b27d315" }))
                .expect("clé lisible");
        assert_eq!(cle.connection, ConnectionId::brut("8c1e4f0a9b27d315"));

        let question = MoveResult::ConfirmationRequired {
            becomes_read_only: vec![ConnectionId::brut("a")],
            leaves_read_only: Vec::new(),
            folders: vec![FolderId::brut("prod")],
        };
        assert_eq!(
            serde_json::to_value(&question).expect("sérialisable"),
            serde_json::json!({
                "kind": "confirmationRequired",
                "becomesReadOnly": ["a"],
                "leavesReadOnly": [],
                "folders": ["prod"],
            })
        );

        let bloque = ConfigLoad::SecretsMigrationFailed {
            reason: "relancez DoraBase".to_owned(),
        };
        assert_eq!(
            serde_json::to_value(&bloque).expect("sérialisable"),
            serde_json::json!({ "kind": "secretsMigrationFailed", "reason": "relancez DoraBase" })
        );

        let deplacement: MoveDatabaseRequest = serde_json::from_value(serde_json::json!({
            "connection": "a", "folder": null, "index": 0, "confirmed": true,
        }))
        .expect("requête lisible");
        assert!(deplacement.confirmed);
        assert_eq!(deplacement.folder, None);
    }
}
