import { invoke } from '@tauri-apps/api/core'
import type {
  ConfigLoad,
  ConnectionSettings,
  ConsoleRequest,
  Engine,
  Preferences,
  Project,
  VisibleSchemasRequest,
} from '../domain/config'
import type {
  ApplyOutcome,
  ConnectionState,
  ConnectionStateEntry,
  DatabaseKey,
  QueryResult,
  RowLimit,
  RowQuery,
  RowWindow,
  SchemaInfo,
  TableDetail,
  TableSummary,
  UpdatePlan,
  Value,
} from '../domain/engine'
import type { AvailableUpdate } from '../domain/maj'
import { PREFERENCES_PAR_DEFAUT } from '../screens/Preferences/preferences'

/**
 * Les commandes du câblage de `09b`, en un seul point de contact avec l'IPC.
 *
 * **Regroupées ici** plutôt que dispersées : chaque écran qui appellerait `invoke` directement
 * dupliquerait le nom de la commande et la forme de ses arguments, que rien ne vérifie. Ici, le
 * nom apparaît une fois, et le typage vient des projections de `ts-rs`.
 *
 * Chacune est **injectable** dans les composants qui l'emploient, pour la même raison qu'en
 * `08d` : le pont ne répond pas hors de la webview, et ce qui est testable est le câblage.
 */

/** Lit la configuration. Ses quatre issues sont distinctes, et `09b` les traite toutes. */
export async function loadConfig(): Promise<ConfigLoad> {
  return invoke<ConfigLoad>('load_config')
}

/**
 * Ouvre une connexion.
 *
 * **`engine` est passé, pas deviné côté Rust** : le moteur appartient à la `Database`, pas à la
 * variante d'environnement, et le front l'a sous la main — c'est lui qui dessine l'arbre. Depuis
 * `18`, c'est ce paramètre qui décide de l'adaptateur ouvert.
 */
export async function openDatabase(
  key: DatabaseKey,
  engine: Engine,
  variant: ConnectionSettings,
): Promise<ConnectionState> {
  return invoke<ConnectionState>('open_database', { key, engine, variant })
}

/**
 * Écrit les préférences (`15a`), et rend celles que le disque a retenues.
 *
 * **Le retour n'est pas décoratif** : le modèle borne les valeurs (une hauteur de ligne éditée à la
 * main, un corps de police qui relève le plancher de densité), et sans le rendre, l'écran garderait
 * une valeur que le disque a refusée — deux vérités, dont la visible serait fausse.
 */
export async function savePreferences(preferences: Preferences): Promise<Preferences> {
  return invoke<Preferences>('save_preferences', { preferences })
}

export async function closeDatabase(key: DatabaseKey): Promise<void> {
  return invoke<void>('close_database', { key })
}

/**
 * Les états de toutes les connexions connues, en **triplets** et non en table indexée.
 *
 * Le registre s'indexe bien par `projet/base/environnement`, mais rendre cette chaîne au front
 * l'obligerait à savoir la recomposer — donc à dupliquer la convention. Une première version le
 * faisait ; le test qui devait vérifier l'accord des deux implémentations a montré qu'il valait
 * mieux n'en avoir qu'une.
 */
export async function connectionStates(): Promise<ConnectionStateEntry[]> {
  return invoke<ConnectionStateEntry[]>('connection_states')
}

export async function listSchemas(key: DatabaseKey): Promise<SchemaInfo[]> {
  return invoke<SchemaInfo[]>('list_schemas', { key })
}

export async function listObjects(key: DatabaseKey, schema: string): Promise<TableSummary[]> {
  return invoke<TableSummary[]>('list_objects', { key, schema })
}

export async function describeTable(
  key: DatabaseKey,
  schema: string,
  table: string,
): Promise<TableDetail> {
  return invoke<TableDetail>('describe_table', { key, schema, table })
}

/**
 * Le détail de **plusieurs** tables, en une seule traversée de l'IPC (3 septembre 2026).
 *
 * Le diagramme de schéma décrit toutes les tables d'un schéma : en passant par `describeTable`,
 * soixante tables coûtaient soixante traversées, soixante prises du verrou du registre et — côté
 * PostgreSQL — trois cent soixante allers-retours SQL, tous sérialisés. Quelques minutes à travers
 * un tunnel, rapporté à l'usage.
 *
 * **Ce qui n'existe pas est omis, pas refusé** : le résultat peut être plus court que la liste
 * demandée. C'est voulu — une lecture de schéma part d'une liste établie un instant plus tôt, et
 * une table retirée entre-temps ne doit pas emporter les autres. L'appelant compare ce qu'il a
 * demandé à ce qu'il reçoit.
 */
export async function describeTables(
  key: DatabaseKey,
  schema: string,
  tables: readonly string[],
): Promise<TableDetail[]> {
  return invoke<TableDetail[]>('describe_tables', { key, schema, tables })
}

/**
 * Une **fenêtre** de lignes — jamais un jeu complet.
 *
 * `RowQuery.limit` est une énumération fermée (`RowLimit`) : « demander tout » n'est pas
 * exprimable, et la contrainte IPC transverse tient donc par le type. `06d` avait livré la
 * lecture ; `10c` a ajouté la commande, qui manquait.
 */
export async function readRows(key: DatabaseKey, query: RowQuery): Promise<RowWindow> {
  return invoke<RowWindow>('read_rows', { key, query })
}

/**
 * Une ligne rendue en `INSERT` exécutable, que `A5` copie (`10f`).
 *
 * **Composé côté Rust**, où vit la connaissance du moteur : citer les identifiants et
 * littéraliser les valeurs demanderait au JavaScript de connaître les règles de sept moteurs — le
 * couplage que le projet a déjà refusé pour la clé de base (`09b`) et la référence de secret
 * (`08e`). Le presse-papiers, lui, reste côté front : c'est une API de la webview.
 */
export async function rowAsInsert(
  key: DatabaseKey,
  schema: string,
  table: string,
  values: readonly Value[],
): Promise<string> {
  return invoke<string>('row_as_insert', { key, schema, table, values })
}

/**
 * Le SQL qu'`Appliquer` exécutera, rendu par le moteur (`11c`).
 *
 * **Même arbitrage que `rowAsInsert`, et une raison de plus** : le panneau annonce « SQL qui sera
 * exécuté ». S'il n'est pas exactement celui qui partira, il est pire qu'absent — c'est le dernier
 * endroit où l'on vérifie avant d'écrire en production. `11d` exécutera cette suite.
 */
export async function previewUpdates(key: DatabaseKey, plan: UpdatePlan): Promise<string> {
  return invoke<string>('preview_updates', { key, plan })
}

/**
 * **La première écriture du projet** (`11d`). Tout le reste, depuis `01`, est en lecture.
 *
 * Le SQL exécuté est celui que `11c` a montré — la même fonction le produit côté moteur, et il n'y a
 * qu'un texte. Rend le nombre de lignes écrites et le SQL qui les défait.
 */
export async function applyChanges(key: DatabaseKey, plan: UpdatePlan): Promise<ApplyOutcome> {
  return invoke<ApplyOutcome>('apply_changes', { key, plan })
}

/**
 * Exécute le SQL **écrit par l'utilisateur** (`12c`).
 *
 * La limite est ajoutée par le moteur aux requêtes qui rendent des lignes et n'en portent pas, et
 * **rendue** dans `appliedLimit` : une limite silencieuse ferait croire à une table de mille lignes.
 */
/**
 * Crée une console vide sur une connexion.
 *
 * Rend les projets à jour, comme les autres écritures de configuration : sans cela l'écran devrait
 * relire pour afficher l'arbre, ce qui ferait deux allers-retours et laisserait une fenêtre où
 * l'écran et le disque divergent.
 */
export async function createConsole(request: ConsoleRequest): Promise<Project[]> {
  return invoke<Project[]>('create_console', { request })
}

/** Écrit le texte d'une console. */
export async function saveConsole(request: ConsoleRequest): Promise<Project[]> {
  return invoke<Project[]>('save_console', { request })
}

/** Retire une console. */
export async function deleteConsole(request: ConsoleRequest): Promise<Project[]> {
  return invoke<Project[]>('delete_console', { request })
}

/** Renomme une console. */
export async function renameConsole(request: ConsoleRequest): Promise<Project[]> {
  return invoke<Project[]>('rename_console', { request })
}

/**
 * Crée un schéma sur la base ouverte (`API-33`). **PostgreSQL seulement.**
 *
 * **Elle ne rend rien, et c'est le fait à retenir** : `create schema` part sur la base et DoraBase
 * ne peut pas le défaire. C'est ce qui lui vaut son bouton propre dans le gestionnaire, à côté des
 * schémas affichés qui sont une préférence et attendent « Enregistrer ».
 */
export async function createSchema(key: DatabaseKey, name: string): Promise<void> {
  return invoke<void>('create_schema', { key, name })
}

/**
 * Règle les schémas que l'arbre montre sous une connexion (`API-33`).
 *
 * Rend les projets à jour, comme les autres écritures de configuration — c'est ce changement que
 * l'arbre suit pour se redessiner. **Elle ne ferme pas la connexion**, contrairement à
 * `update_variant` : rien de ce qui décrit le serveur n'a changé.
 */
export async function saveVisibleSchemas(request: VisibleSchemasRequest): Promise<Project[]> {
  return invoke<Project[]>('save_visible_schemas', { request })
}

/**
 * Cherche une version plus récente. `null` quand il n'y en a pas.
 *
 * **Le rejet est normal et il ne se remonte pas** : hors ligne, derrière un pare-feu, ou dans
 * `pnpm dev` où le pont ne répond pas, cette commande échoue — et l'utilisateur n'a rien
 * demandé. C'est à l'appelant de retomber sur `null`, ce que fait `MiseAJour`.
 */
export async function checkUpdate(): Promise<AvailableUpdate | null> {
  return invoke<AvailableUpdate | null>('check_update')
}

/**
 * Télécharge, installe, redémarre.
 *
 * **Ne se résout jamais** au succès : le processus est remplacé pendant l'attente. Un `await`
 * qui rend la main veut donc dire que quelque chose a échoué — c'est le seul cas que l'écran
 * ait à traiter.
 */
export async function installUpdate(): Promise<void> {
  return invoke<void>('install_update')
}

export async function runSql(key: DatabaseKey, sql: string, limit: RowLimit): Promise<QueryResult> {
  return invoke<QueryResult>('run_sql', { key, sql, limit })
}

/**
 * La clé d'une base, composée **côté Rust**.
 *
 * Le front envoie les trois chaînes ; c'est `registry::cle` qui les assemble. Composer ici
 * dupliquerait la convention, et une convention dupliquée diverge — le même arbitrage qu'en
 * `08e` pour la référence de secret.
 */
export function databaseKey(project: string, database: string, environment: string): DatabaseKey {
  return { project, database, environment }
}

/**
 * L'état d'une base parmi les triplets rendus, `never` par défaut.
 *
 * `never` et non `offline` : afficher en rouge une base qu'on n'a pas ouverte serait faux, et
 * c'est ce que la décision « l'arbre se lit sans réseau » impose de distinguer.
 */
export function etatDe(
  entrees: readonly ConnectionStateEntry[],
  project: string,
  database: string,
  environment: string,
): ConnectionState {
  const trouve = entrees.find(
    (e) =>
      e.key.project === project && e.key.database === database && e.key.environment === environment,
  )
  return trouve?.state ?? { kind: 'never' }
}

/**
 * Les projets d'une issue de lecture, et ce qu'il faut en dire.
 *
 * **Les quatre issues ne se réduisent pas à « des projets ou rien ».** Un fichier illisible ou
 * d'une version trop récente n'a pas zéro projet : il a des projets qu'on ne sait pas lire, et
 * l'écriture est bloquée (`05b`). Les présenter comme « aucun projet » inviterait à en créer un,
 * ce qui écraserait le fichier qu'on vient de refuser d'ouvrir.
 */
export type EtatDeConfiguration =
  | { kind: 'fresh'; projects: Project[]; preferences: Preferences }
  | { kind: 'loaded'; projects: Project[]; preferences: Preferences }
  | {
      kind: 'blocked'
      projects: Project[]
      preferences: Preferences
      reason: string
      quarantinedTo?: string
    }

export function interpreter(issue: ConfigLoad): EtatDeConfiguration {
  switch (issue.kind) {
    case 'fresh':
      return { kind: 'fresh', projects: [], preferences: PREFERENCES_PAR_DEFAUT }
    case 'loaded':
      return { kind: 'loaded', projects: issue.projects, preferences: issue.preferences }
    case 'unreadable':
      return {
        kind: 'blocked',
        projects: [],
        // **Les défauts, même sur un fichier illisible.** Le produit doit rester regardable pour
        // afficher le message qui explique le blocage : sans jetons, l'écran d'erreur serait
        // lui-même illisible.
        preferences: PREFERENCES_PAR_DEFAUT,
        reason: issue.reason,
        quarantinedTo: issue.quarantinedTo,
      }
    case 'tooNew':
      return {
        kind: 'blocked',
        projects: [],
        preferences: PREFERENCES_PAR_DEFAUT,
        reason: `le fichier de configuration est en version ${issue.found}, cette version de DoraBase comprend la version ${issue.supported}`,
      }
  }
}
