//! Modèle de configuration : ce que l'utilisateur déclare — projets, bases, et leurs
//! déclinaisons par environnement.
//!
//! Ce module est **pur** : ni lecture, ni écriture, ni connexion. La persistance vient
//! avec `05b`, les secrets avec `05c`, l'introspection des bases avec `06`.

// `pub` : la macro `generate_handler!` a besoin des éléments cachés que
// `#[tauri::command]` génère à côté de chaque fonction, et qu'un `pub use` ne réexporte
// pas. Les commandes se réfèrent donc par `config::commands::…` dans `lib.rs`.
pub mod commands;
mod enregistrer;
mod environnements;
/// Les instances managées (`API-32`) : leur déclaration, leur secret, leur retrait.
mod instances;
mod model;
mod query;
mod store;

pub use commands::{
    create_environment, create_project, delete_environment, load_config, recolor_environment,
    rename_database, rename_environment, reorder_environments, save_config, save_database,
    save_preferences, update_variant, ConfigLoad, ConfigState, ConsoleRequest,
    CreateEnvironmentRequest, CreateProjectRequest, DeleteDatabaseRequest,
    DeleteEnvironmentRequest, DeleteEnvironmentResult, DeleteProjectRequest, DeleteResult,
    RecolorEnvironmentRequest, RenameDatabaseRequest, RenameEnvironmentRequest,
    RenameProjectRequest, RenameResult, ReorderEnvironmentsRequest, SaveDatabaseRequest,
    UpdateVariantRequest, VisibleSchemasRequest,
};
pub use enregistrer::{enregistrer, reference_de, NouvelleBase, SaveError};
pub use instances::{
    cle_de_registre, declarer, moteur_manage, reference_de_instance, retirer, DeclarationInstance,
    InstanceError, SuppressionInstance,
};
pub use model::{
    Accent, ConnectionSettings, Console, Database, Engine, EnvironmentColor,
    EnvironmentDeclaration, EnvironmentId, Guards, InstanceId, ManagedInstance, ModelError,
    Preferences, Project, Proxy, ProxyCloudSql, ProxyKubernetes, ProxySsh, SavedQuery, SecretRef,
    SslMode, Theme, Tunnel,
};
pub use query::{databases_available, validate};
pub use store::{load, save, ConfigStore, LoadOutcome, StoreError, VERSION_COURANTE};
