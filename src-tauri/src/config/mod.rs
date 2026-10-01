//! Modèle de configuration : ce que l'utilisateur déclare — un arbre de dossiers et ses
//! connexions (#164, #165), les instances managées, les kubeconfigs, les préférences.

// `pub` : la macro `generate_handler!` a besoin des éléments cachés que
// `#[tauri::command]` génère à côté de chaque fonction, et qu'un `pub use` ne réexporte
// pas. Les commandes se réfèrent donc par `config::commands::…` dans `lib.rs`.
/// L'arbre de dossiers de #164 : le modèle que la v7 décrit.
mod arbre;
pub mod commands;
/// Les doubles de magasin de secrets des tests (#165).
#[cfg(test)]
mod doubles;
mod enregistrer;
/// Les instances managées (`API-32`) : leur déclaration, leur secret, leur retrait.
mod instances;
/// La chaîne de migration du format, sortie de `store.rs` par #164.
mod migration;
mod model;
/// Le contrat IPC de l'arbre de dossiers, déclaré par #164 et branché par #165 à #169.
pub mod requetes;
mod store;
// **`transfert` est retiré du build par #165**, et c'est temporaire : il est écrit pour les projets,
// et le porter sur l'arbre est tout le chantier de #169, qui le rebranchera avec ses trois commandes
// (`export_projects`, `inspect_projects_file`, `import_projects`). Le fichier reste, non compilé.
// mod transfert;

/// Les décors d'arbre des tests de `config::arbre`, prêtés aux tests des commandes qui écrivent (#168).
#[cfg(test)]
pub(crate) use arbre::tests as arbre_de_test;
pub use arbre::{
    cle_de_connexion, reference_de_connexion, tirage_du_systeme, ArbreError, ConnectionId,
    Descendance, Folder, FolderColor, FolderId, FolderTree, LectureSeule, ValueLabels,
};
pub use commands::ConfigState;
pub use enregistrer::{enregistrer, NouvelleBase, SaveError};
pub use instances::{
    cle_de_registre, declarer, moteur_manage, reference_de_instance, retirer, DeclarationInstance,
    InstanceError, SuppressionInstance,
};
pub use model::{
    Accent, ConnectionSettings, Console, Database, Engine, Guards, InstanceId,
    KubeconfigDeclaration, KubeconfigId, Kubeconfigs, ManagedInstance, ModelError, Preferences,
    Proxy, ProxyCloudSql, ProxyKubernetes, ProxySsh, SavedQuery, SecretRef, SslMode, Theme, Tunnel,
};
pub use store::{load, save, ConfigStore, LoadOutcome, StoreError, VERSION_COURANTE};
