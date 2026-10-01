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

use dorabase_lib::config::requetes as arbre;
use dorabase_lib::config::{Console, FolderTree, LectureSeule, SavedQuery};
use dorabase_lib::dump::commands::{DumpFailure, DumpVerdict};
use dorabase_lib::dump::inspect::Inspection;
use dorabase_lib::dump::DumpAvailability;
use dorabase_lib::engine::commands::{ConnectionRequest, ConnectionTest};
use dorabase_lib::engine::registry::ConnectionState;
use dorabase_lib::engine::{
    ApplyOutcome, ConnectionProbe, EngineError, ExportFormat, PendingUpdate, QueryResult, RowQuery,
    RowWindow, SchemaInfo, TableDetail, TableSummary, TransactionMode, TransactionState,
    UpdatePlan,
};
use dorabase_lib::instances::commands::{DeleteInstanceResult, SaveInstanceRequest};
use dorabase_lib::instances::{
    InstanceAction, InstanceDatabase, InstanceExtension, InstanceOutcome, InstanceOverview,
    InstancePlan, InstancePrivilege, InstanceRole, InstanceSession, InstanceSetting,
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
    SavedQuery::export_all(&config)?;
    Console::export_all(&config)?;
    SecretMechanism::export_all(&config)?;
    // L'arbre de dossiers de #164 : le modèle, vers `config.ts` — `FolderTree` entraîne `Folder`,
    // `FolderId`, `ConnectionId` et `FolderColor` —, et la lecture seule effective, que le miroir
    // TypeScript de #168 doit rendre à l'identique.
    FolderTree::export_all(&config)?;
    LectureSeule::export_all(&config)?;
    // Le contrat IPC de #165 à #169, vers `arbre.ts` : la plupart de ces types portent le nom de
    // celui qu'ils ont remplacé à la bascule de #165. Nommés un par un : `export_all` entraîne les
    // dépendances d'un type, jamais ses voisins. Ceux du transfert (#169) et du déplacement (#167)
    // sont projetés bien que leurs commandes ne soient pas encore branchées : l'écran code contre eux.
    arbre::ConfigLoad::export_all(&config)?;
    arbre::DatabaseKey::export_all(&config)?;
    arbre::ConnectionStateEntry::export_all(&config)?;
    arbre::DumpRequest::export_all(&config)?;
    arbre::CreateFolderRequest::export_all(&config)?;
    arbre::CreateFolderResult::export_all(&config)?;
    arbre::RenameFolderRequest::export_all(&config)?;
    arbre::RecolorFolderRequest::export_all(&config)?;
    arbre::SetFolderReadOnlyRequest::export_all(&config)?;
    arbre::DeleteFolderRequest::export_all(&config)?;
    arbre::DeleteResult::export_all(&config)?;
    arbre::MoveFolderRequest::export_all(&config)?;
    arbre::MoveDatabaseRequest::export_all(&config)?;
    arbre::MoveResult::export_all(&config)?;
    arbre::SaveDatabaseRequest::export_all(&config)?;
    arbre::SaveDatabaseResult::export_all(&config)?;
    arbre::UpdateVariantRequest::export_all(&config)?;
    arbre::RenameDatabaseRequest::export_all(&config)?;
    arbre::DeleteDatabaseRequest::export_all(&config)?;
    arbre::ConsoleRequest::export_all(&config)?;
    arbre::VisibleSchemasRequest::export_all(&config)?;
    arbre::ValueLabelsRequest::export_all(&config)?;
    arbre::ExportProjectsRequest::export_all(&config)?;
    arbre::ExportReport::export_all(&config)?;
    arbre::ImportProjectsRequest::export_all(&config)?;
    arbre::ImportProjectsResult::export_all(&config)?;
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
    // La transaction manuelle d'une console (`API-38`). **Les deux, un par sens** : `TransactionMode`
    // part de l'écran à chaque exécution, `TransactionState` revient à chaque lecture du panneau — et
    // il entraîne `TransactionStatement` avec lui.
    TransactionMode::export_all(&config)?;
    TransactionState::export_all(&config)?;
    // L'export d'un résultat de console (`API-29`). Un seul type traverse dans ce sens : les
    // colonnes et les lignes sont déjà projetées par `QueryResult`, et `export_result` ne rend
    // qu'un nombre d'octets.
    ExportFormat::export_all(&config)?;

    // Les deux types du pont IPC de `08d`. `ConnectionRequest` entraîne `ConnectionSettings`
    // et `Tunnel` avec lui, donc les nommer ici suffit.
    ConnectionRequest::export_all(&config)?;
    ConnectionTest::export_all(&config)?;

    // Le câblage de `09b` : `DatabaseKey` et `ConnectionStateEntry` viennent du contrat.
    ConnectionState::export_all(&config)?;

    // L'export et l'import de dump (`22b`, `22c`). `DumpRequest` vient du contrat ; `DumpAvailability` et `Inspection` sont les deux
    // verdicts que les modales rendent.
    DumpAvailability::export_all(&config)?;
    // Le verdict entraîne `DumpTransport` et `RootCert` avec lui (#82).
    DumpVerdict::export_all(&config)?;
    Inspection::export_all(&config)?;
    DumpFailure::export_all(&config)?;

    // Le gestionnaire d'instances (`API-32`). `SaveInstanceRequest` entraîne `ConnectionSettings`
    // et `Engine` ; les sept lectures et les deux gestes sont nommés parce qu'aucune racine ne les
    // atteint — une commande qui rend `Vec<InstanceRole>` n'a pas de type d'enveloppe.
    SaveInstanceRequest::export_all(&config)?;
    DeleteInstanceResult::export_all(&config)?;
    InstanceOverview::export_all(&config)?;
    InstanceDatabase::export_all(&config)?;
    InstanceRole::export_all(&config)?;
    InstancePrivilege::export_all(&config)?;
    InstanceSession::export_all(&config)?;
    InstanceExtension::export_all(&config)?;
    InstanceSetting::export_all(&config)?;
    InstanceAction::export_all(&config)?;
    InstancePlan::export_all(&config)?;
    InstanceOutcome::export_all(&config)?;

    println!("projections TypeScript écrites dans {REPERTOIRE_DOMAINE}");
    Ok(())
}
