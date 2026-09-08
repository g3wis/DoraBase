//! Exporte les types Rust vers leur projection TypeScript.
//!
//! # Pourquoi un binaire et non `cargo test`
//!
//! `ts-rs` propose un export automatique par `#[ts(export)]`, déclenché pendant
//! `cargo test`. Cette voie a un défaut découvert à l'usage : **un `cargo test <filtre>`
//! corrompt les fichiers générés**. Les tests d'export ne tournent que s'ils matchent le
//! filtre, or `ts-rs` tronque le fichier cible avant d'y écrire — donc un
//! `cargo test engine` a réduit `config.ts` de 84 lignes à une seule, en silence.
//!
//! Ce binaire supprime le couplage : `cargo test` ne touche plus aux fichiers générés, et
//! ce programme est leur **unique producteur**. C'est la leçon du plan `05c` appliquée
//! correctement — un fichier généré n'a qu'un seul producteur, sinon la chaîne devient
//! sensible à l'ordre et aux options d'invocation.
//!
//! Lancé par `pnpm domain:build`, vérifié par `pnpm domain:check`.

use dorabase_lib::config::{
    ConfigLoad, Console, ConsoleRequest, CreateEnvironmentRequest, CreateProjectRequest,
    DeleteDatabaseRequest, DeleteEnvironmentRequest, DeleteEnvironmentResult, DeleteProjectRequest,
    DeleteResult, Project, RecolorEnvironmentRequest, RenameDatabaseRequest,
    RenameEnvironmentRequest, RenameProjectRequest, RenameResult, ReorderEnvironmentsRequest,
    SaveDatabaseRequest, SavedQuery, UpdateVariantRequest, VisibleSchemasRequest,
};
use dorabase_lib::dump::commands::{DumpFailure, DumpRequest};
use dorabase_lib::dump::inspect::Inspection;
use dorabase_lib::dump::DumpAvailability;
use dorabase_lib::engine::commands::{
    ConnectionRequest, ConnectionStateEntry, ConnectionTest, DatabaseKey,
};
use dorabase_lib::engine::registry::ConnectionState;
use dorabase_lib::engine::{
    ApplyOutcome, ConnectionProbe, EngineError, PendingUpdate, QueryResult, RowQuery, RowWindow,
    SchemaInfo, TableDetail, TableSummary, UpdatePlan,
};
use dorabase_lib::maj::AvailableUpdate;
use dorabase_lib::secrets::SecretMechanism;
use ts_rs::TS;

/// Le répertoire de destination, en **absolu**, dérivé à la compilation.
///
/// Défaut de `ts-rs` : `./bindings`, relatif au **répertoire courant**. Combiné à un
/// `export_to = "../../src/domain/…"`, cela écrivait les projections *hors du dépôt* quand
/// le binaire était lancé depuis la racine plutôt que depuis `src-tauri` — silencieusement,
/// et `git diff` ne voyait donc aucun changement. Le garde-fou passait à vide.
///
/// Deux corrections ici : le chemin est absolu, donc indépendant du répertoire courant, et
/// les `export_to` ne portent plus que des noms de fichiers nus — plus aucun `../..` à
/// interpréter.
const REPERTOIRE_DOMAINE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/domain");

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = ts_rs::Config::default().with_out_dir(REPERTOIRE_DOMAINE);

    // `export_all` entraîne les dépendances de chaque type : il suffit donc de nommer les
    // **racines** — celles que l'IPC transporte — et non les cinquante types intermédiaires.
    // Un type atteignable depuis aucune racine n'est pas projeté, ce qui est voulu : il ne
    // traverse pas l'IPC.
    Project::export_all(&config)?;
    ConfigLoad::export_all(&config)?;
    SaveDatabaseRequest::export_all(&config)?;
    CreateProjectRequest::export_all(&config)?;
    RenameProjectRequest::export_all(&config)?;
    RenameDatabaseRequest::export_all(&config)?;
    SavedQuery::export_all(&config)?;
    Console::export_all(&config)?;
    ConsoleRequest::export_all(&config)?;
    DeleteDatabaseRequest::export_all(&config)?;
    DeleteProjectRequest::export_all(&config)?;
    DeleteResult::export_all(&config)?;
    RenameResult::export_all(&config)?;
    UpdateVariantRequest::export_all(&config)?;
    VisibleSchemasRequest::export_all(&config)?;
    // Les cinq gestes de `23c`. **Nommés un par un** : `export_all` entraîne les dépendances d'un
    // type, jamais ses voisins — un type de requête oublié ici ne manque pas à la compilation, il
    // manque au front, qui découvre son absence à l'écriture de l'appel.
    CreateEnvironmentRequest::export_all(&config)?;
    RenameEnvironmentRequest::export_all(&config)?;
    RecolorEnvironmentRequest::export_all(&config)?;
    ReorderEnvironmentsRequest::export_all(&config)?;
    DeleteEnvironmentRequest::export_all(&config)?;
    DeleteEnvironmentResult::export_all(&config)?;
    SecretMechanism::export_all(&config)?;
    // La mise à jour en place. Un seul type traverse l'IPC dans ce sens : `install_update`
    // ne prend rien et ne rend rien.
    AvailableUpdate::export_all(&config)?;

    ConnectionProbe::export_all(&config)?;
    EngineError::export_all(&config)?;
    SchemaInfo::export_all(&config)?;
    TableSummary::export_all(&config)?;
    TableDetail::export_all(&config)?;
    RowQuery::export_all(&config)?;
    UpdatePlan::export_all(&config)?;
    PendingUpdate::export_all(&config)?;
    ApplyOutcome::export_all(&config)?;
    QueryResult::export_all(&config)?;
    RowWindow::export_all(&config)?;

    // Les deux types du pont IPC de `08d`. `ConnectionRequest` entraîne `ConnectionSettings`
    // et `Tunnel` avec lui, donc les nommer ici suffit.
    ConnectionRequest::export_all(&config)?;
    ConnectionTest::export_all(&config)?;

    // Le câblage de `09b`.
    DatabaseKey::export_all(&config)?;
    ConnectionStateEntry::export_all(&config)?;
    ConnectionState::export_all(&config)?;

    // L'export et l'import de dump (`22b`, `22c`). `DumpRequest` entraîne `DatabaseKey` et
    // `EnvironmentVariant` avec lui ; `DumpAvailability` et `Inspection` sont les deux
    // verdicts que les modales rendent.
    DumpAvailability::export_all(&config)?;
    Inspection::export_all(&config)?;
    DumpRequest::export_all(&config)?;
    DumpFailure::export_all(&config)?;

    println!("projections TypeScript écrites dans {REPERTOIRE_DOMAINE}");
    Ok(())
}
