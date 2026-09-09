import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { Project } from '../../domain/config'
import type {
  ConnectionState,
  ConnectionStateEntry,
  DatabaseKey,
  QueryResult,
  SchemaInfo,
  TableDetail,
  TableSummary,
  TransactionMode,
  TransactionStatement,
  UpdatePlan,
} from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { raccourci } from '../../shell/plateforme'
import { auModificateur } from '../../test/raccourcis'
import { REGLAGES, TRIO_DE_TEST } from '../NewConnection/pourLesTests'
import type { PasserelleLignes } from '../TableView/useLignes'
import type { PasserelleArbre } from './useArbre'
import type { PasserelleDetail } from './useDetailTable'
import { grouperParBoucle, type PasserelleStructures } from './useStructures'
import { Workbench } from './Workbench'

const variante = {
  environment: 'prod' as const,
  host: 'localhost',
  port: 5432,
  defaultDatabase: 'analytics',
  username: 'dorabase',
  password: null,
  sslMode: 'prefer' as const,
  caCertificate: null,
  authDatabase: null,
  readOnly: true,
  reconnectOnStartup: false,
  tunnel: null,
}

const PROJETS: Project[] = [
  {
    name: 'Atelier Nord',
    environments: TRIO_DE_TEST,
    queries: [],
    databases: [
      // **Les deux connexions sont dans `prod`** : le décor mesure les onglets, la grille et les
      // consoles, pas le palier d'environnement — `arbre.test.ts` s'en charge.
      {
        name: 'analytics',
        engine: 'postgresql',
        environment: 'prod',
        connection: REGLAGES,
        consoles: [],
      },
      {
        name: 'shop',
        engine: 'postgresql',
        environment: 'prod',
        connection: REGLAGES,
        consoles: [],
      },
    ],
  },
]

const SCHEMAS: SchemaInfo[] = [
  {
    name: 'public',
    owner: 'atelier',
    system: false,
    counts: { tables: 2, views: 0, functions: 0, indexes: 0 },
  },
]

const objet = (name: string, kind: TableSummary['kind'] = 'table'): TableSummary => ({
  name,
  kind,
  rows: { kind: 'estimated', value: 1_900_000 },
  sizeBytes: 1024,
  columnCount: 3,
  primaryKey: 'id',
  lastAnalyze: null,
  comment: null,
})

const DETAIL: TableDetail = {
  schema: 'public',
  name: 'orders',
  rows: { kind: 'estimated', value: 1_900_000 },
  sizeBytes: 1024,
  comment: null,
  columns: [
    {
      position: 1,
      name: 'id',
      typeName: 'int8',
      category: 'number',
      nullable: false,
      default: null,
      identity: null,
      key: 'primary',
      comment: null,
      frequency: null,
    },
    {
      position: 2,
      name: 'created_at',
      typeName: 'timestamptz',
      category: 'timestamp',
      nullable: false,
      default: null,
      identity: null,
      key: null,
      comment: null,
      frequency: null,
    },
    // **Une colonne dont la valeur n'est pas nulle**, et c'est délibéré : avec `created_at` nulle
    // partout, un test sur la valeur attendue d'une modification était satisfait par `null` — donc
    // vert même quand le code cessait de l'envoyer. Le décor décidait du résultat (règle 7).
    {
      position: 3,
      name: 'status',
      typeName: 'text',
      category: 'text',
      nullable: false,
      default: null,
      identity: null,
      key: null,
      comment: null,
      frequency: null,
    },
  ],
  indexes: [],
  constraints: [],
  triggers: [],
  relations: [],
  ddl: '',
}

function passerelles() {
  /**
   * Ce que le registre tient pour ouvert, **alimenté par les ouvertures du décor**.
   *
   * `connectionStates` rendait `[]` sans condition : un double qui ne répond pas à tous les appels
   * que la production fait (règle n° 19). Et celui-là n'est pas décoratif — depuis le 31 août 2026,
   * l'arbre purge son cache et replie ce que le registre ne tient plus **à chaque changement de
   * `projects`**, donc à chaque console créée et à chaque frappe enregistrée. Un registre qui ne dit
   * jamais rien décrète que tout est fermé : le décor annulait en boucle ce qu'une ouverture venait
   * de mettre en cache, et un test posé dessus aurait mesuré ce reflux plutôt que l'écran.
   *
   * **Aucun test ne dépend de la version muette** — vérifié par sabotage, la suite reste verte avec
   * elle. C'est le décor qui devient dicible, pas une assertion qui devient possible.
   */
  const ouvertes = new Map<string, ConnectionStateEntry>()
  const identite = (cle: DatabaseKey) => `${cle.project}/${cle.environment}/${cle.database}`
  const passerelle: PasserelleArbre = {
    openDatabase: vi.fn(async (cle) => {
      const state = {
        kind: 'connected' as const,
        serverVersion: 'PostgreSQL 17.6',
        tunnelLocalPort: null,
      }
      ouvertes.set(identite(cle), { key: cle, state })
      return state
    }),
    closeDatabase: vi.fn(async (cle) => {
      ouvertes.delete(identite(cle))
    }),
    surEchecDeCommande: () => () => {},
    connectionStates: vi.fn(async () => [...ouvertes.values()]),
    listSchemas: vi.fn(async () => SCHEMAS),
    listObjects: vi.fn(async () => [objet('orders'), objet('order_items')]),
  }
  const detail: PasserelleDetail = { describeTable: vi.fn(async () => DETAIL) }
  const lignes: PasserelleLignes = {
    readRows: vi.fn(async () => ({
      offset: 0,
      rows: [
        [
          { kind: 'int' as const, value: 184_220 },
          { kind: 'null' as const },
          { kind: 'text' as const, value: 'pending' },
        ],
      ],
      total: null,
      sql: 'select * from public.orders limit 500 offset 0',
      durationMs: 41,
    })),
  }
  return { passerelle, detail, lignes }
}

/**
 * Déplie le projet, puis **tous ses environnements** (`25a`).
 *
 * Tous, et non celui du décor : l'environnement est désormais un palier, et deux décors de ce fichier
 * placent leurs connexions dans deux environnements différents — `PROJETS` en `prod`, `PROJETS_DEV`
 * en `dev`. Les déplier tous rend le harnais indifférent à ce choix, et un environnement sans
 * connexion ne produit qu'une ligne de message.
 */
async function ouvrirLesEnvironnements(utilisateur: ReturnType<typeof userEvent.setup>) {
  await utilisateur.dblClick(screen.getByRole('treeitem', { name: /Atelier Nord/ }))
  const environnements = screen
    .getAllByRole('treeitem')
    .filter((ligne) => ligne.getAttribute('aria-level') === '2')
  for (const ligne of environnements) await utilisateur.dblClick(ligne)
}

/**
 * **Le double-clic déplie ; le clic simple ne le fait plus.** Un clic sélectionne, et c'est tout —
 * sans quoi regarder une connexion refermait le sous-arbre qu'on venait d'ouvrir. Toute chaîne de
 * dépliage passe donc par `dblClick`, qui **sélectionne aussi** : ses deux clics font leur travail
 * avant que le second geste ne déplie. Les tests qui attendaient un schéma sélectionné le sont
 * toujours.
 */
async function ouvrirLArbreJusquAuSchema(utilisateur: ReturnType<typeof userEvent.setup>) {
  await ouvrirLesEnvironnements(utilisateur)
  await utilisateur.dblClick(await screen.findByRole('treeitem', { name: /analytics/ }))
  await utilisateur.dblClick(await screen.findByRole('treeitem', { name: 'public' }))
}

/**
 * Ouvre l'arbre jusqu'à une base, puis une console **depuis le menu de la connexion**.
 *
 * Le pied de la sidebar ne porte plus de bouton « Nouvelle console » depuis le 20 août 2026 : ce
 * chemin est le seul, et c'est celui que les tests doivent emprunter.
 *
 * **Au module, et non dans un `describe`** : deux blocs s'en servent depuis `API-38`, et une copie
 * dans le second aurait divergé de la première — un bloc dupliqué se répare une fois sur deux.
 */
async function ouvrirUneConsole(utilisateur: ReturnType<typeof userEvent.setup>) {
  // **Idempotent sur le dépliage** : appelé deux fois de suite — ce que font les tests à deux
  // consoles — un second dépliage replierait l'arbre et emporterait le menu avec lui.
  if (screen.queryByRole('button', { name: 'Actions de analytics' }) === null) {
    await ouvrirLArbreJusquAuSchema(utilisateur)
  }
  await utilisateur.click(screen.getByRole('button', { name: 'Actions de analytics' }))
  await utilisateur.click(screen.getByRole('button', { name: /Nouvelle console/ }))
}

/** Saisit dans l'éditeur. Le clic va sur `.cm-content`, seul élément éditable. */
async function saisir(utilisateur: ReturnType<typeof userEvent.setup>, texte: string) {
  await utilisateur.click(document.querySelector('.cm-content') as HTMLElement)
  await utilisateur.keyboard(texte)
}

/** Une prévisualisation qui répond, pour les tests qui ne portent pas sur elle. */
const PREVIEW = { previewUpdates: async () => 'BEGIN;\nCOMMIT;' }

/**
 * Le même décor, mais en `dev`.
 *
 * **Le décor par défaut est en `prod`**, ce qui est utile ailleurs et trompeur ici : les tests
 * d'écriture qui ne portent pas sur la confirmation passeraient par elle sans le dire.
 */
/** Une passerelle d'exécution complète, pour les tests qui ne portent pas sur elle. */
const PASSERELLE_SQL = {
  runSql: async () => RESULTAT,
}

/** Un résultat de requête minimal, pour les tests qui ne portent pas sur son contenu. */
const RESULTAT = {
  columns: ['n'],
  rows: [[{ kind: 'int' as const, value: 1 }]],
  sql: 'select 1',
  durationMs: 3,
  appliedLimit: null,
  affected: null,
}

/**
 * Le décor de `PROJETS`, avec une console persistée sur la connexion `analytics` de `prod`.
 *
 * Elle est posée sur **la connexion**, non sur le projet : c'est là qu'elle vit depuis le 20 août
 * 2026, et un décor qui la placerait ailleurs ne dirait rien de ce que l'écran doit trouver.
 */
function avecConsole(nom: string, sql: string): Project[] {
  return PROJETS.map((projet) => ({
    ...projet,
    databases: projet.databases.map((base) =>
      base.name === 'analytics' ? { ...base, consoles: [{ name: nom, sql }] } : base,
    ),
  }))
}

const PROJETS_DEV: Project[] = PROJETS.map((projet) => ({
  ...projet,
  queries: [],
  // Les connexions **déménagent en `dev`** : l'arbre les liste sous ce palier, et le drapeau
  // `production` de `dev` étant baissé, l'écriture n'ouvre pas de confirmation.
  databases: projet.databases.map((base) => ({
    ...base,
    environment: 'dev',
    connection: { ...variante, environment: 'dev' as const },
  })),
}))

/**
 * Le même décor que `PROJETS_DEV`, mais `analytics` y est déclarée MongoDB.
 *
 * **Seul le moteur change** — la navigation (`ouvrirEtEditer`), les colonnes (`DETAIL`) et les
 * lignes restent celles du décor générique : ce test ne porte pas sur ce que MongoDB introspecte
 * vraiment (`18d`), seulement sur le fait que `describeTable` est bien rappelée après une écriture.
 */
const PROJETS_MONGO: Project[] = PROJETS_DEV.map((projet) => ({
  ...projet,
  databases: projet.databases.map((base) =>
    base.name === 'analytics' ? { ...base, engine: 'mongodb' as const } : base,
  ),
}))

/**
 * Applique un geste de console au décor, comme le cœur le ferait.
 *
 * **Le décor doit suivre**, sans quoi deux créations de suite porteraient le même nom : le nom par
 * défaut est le premier numéro libre *dans la liste des consoles*, et une liste figée reste
 * éternellement vide. Le harnais tient donc les projets en état — la démo fait de même.
 */
function surConsoles(
  projets: readonly Project[],
  project: string,
  database: string,
  environment: string,
  transforme: (
    consoles: Project['databases'][number]['consoles'],
  ) => Project['databases'][number]['consoles'],
): Project[] {
  return projets.map((projet) =>
    projet.name === project
      ? {
          ...projet,
          databases: projet.databases.map((base) =>
            base.name === database && base.environment === environment
              ? { ...base, consoles: transforme(base.consoles) }
              : base,
          ),
        }
      : projet,
  )
}

function monter(over: Partial<Parameters<typeof Workbench>[0]> = {}) {
  const { passerelle, detail, lignes } = passerelles()
  /**
   * Le pont du préchauffage des structures, **dérivé de celui du panneau**.
   *
   * Dans l'application il n'y a qu'une commande, `describe_table` : deux décors qui rendraient des
   * structures différentes créeraient une divergence que la réalité n'a pas — et c'est ce qui est
   * arrivé, le préchauffage remplissant le cache avec la table générique alors qu'un test avait
   * surchargé le détail pour renommer sa clé primaire. Le compteur reste distinct, lui, pour qu'un
   * test puisse dire ce que la file a demandé.
   */
  const structures: PasserelleStructures = over.passerelleStructures ?? {
    listObjects: vi.fn(async () => [objet('orders'), objet('order_items')]),
    describeTable: vi.fn((over.passerelleDetail ?? detail).describeTable),
    // Le décor n'a pas de serveur à qui grouper quoi que ce soit — voir `grouperParBoucle`.
    describeTables: vi.fn(grouperParBoucle((over.passerelleDetail ?? detail).describeTable)),
  }

  function Pilote() {
    const [projets, setProjets] = useState<readonly Project[]>(over.projects ?? PROJETS)
    return (
      <Workbench
        projects={projets}
        passerelle={passerelle}
        passerelleDetail={detail}
        passerelleLignes={lignes}
        passerelleStructures={structures}
        // Les quatre gestes de console appliqués à l'état, sauf si le test fournit les siens —
        // un espion qui veut seulement constater l'appel n'a pas besoin que le décor bouge.
        onCreateConsole={async (project, database, environment, nom) => {
          setProjets((precedents) =>
            surConsoles(precedents, project, database, environment, (consoles) => [
              ...consoles,
              { name: nom, sql: '' },
            ]),
          )
        }}
        onSaveConsole={async (project, database, environment, nom, sql) => {
          setProjets((precedents) =>
            surConsoles(precedents, project, database, environment, (consoles) =>
              consoles.map((console) => (console.name === nom ? { ...console, sql } : console)),
            ),
          )
        }}
        onRenameConsole={async (project, database, environment, nom, nouveau) => {
          setProjets((precedents) =>
            surConsoles(precedents, project, database, environment, (consoles) =>
              consoles.map((console) =>
                console.name === nom ? { ...console, name: nouveau } : console,
              ),
            ),
          )
        }}
        {...over}
      />
    )
  }

  render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <Pilote />
      </LanguageProvider>
    </>,
  )
  return { passerelle, detail, lignes, structures }
}

describe('Workbench', () => {
  // **Rien à montrer au montage** : le centre et la colonne de droite laissent la place au logo
  // décoloré et à sa phrase. L'arbre, lui, est ce qui reste — c'est là qu'on sélectionne.
  it('au montage, rien n’est sélectionné : ni bande d’onglets ni panneau de détail', () => {
    monter()
    expect(
      screen.getByRole('tree', { name: 'Projets, environnements et connexions' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Sélectionner une entité pour commencer')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Détail de l’objet')).not.toBeInTheDocument()
  })

  // **Les trois paliers au-dessus du schéma n'ont pas d'écran.** Ils n'ont ni liste d'objets ni
  // structure, seulement des enfants dans l'arbre : les sélectionner ne remplit donc pas le centre.
  // Le test descend palier par palier, parce que le défaut serait justement de traiter l'un des trois
  // autrement que les deux autres.
  it('un projet, un environnement, une connexion : le centre reste vide', async () => {
    const utilisateur = userEvent.setup()
    monter()
    // Le double-clic déplie **et** sélectionne : il faut le dépliage pour atteindre le palier
    // suivant, et la sélection est ce que ce test regarde. Le dernier geste est un clic simple —
    // une connexion sélectionnée sans être dépliée est exactement le cas à couvrir.
    await utilisateur.dblClick(screen.getByRole('treeitem', { name: /Atelier Nord/ }))
    expect(screen.getByText('Sélectionner une entité pour commencer')).toBeInTheDocument()

    const environnements = screen
      .getAllByRole('treeitem')
      .filter((ligne) => ligne.getAttribute('aria-level') === '2')
    for (const ligne of environnements) await utilisateur.dblClick(ligne)
    expect(screen.getByText('Sélectionner une entité pour commencer')).toBeInTheDocument()

    await utilisateur.click(await screen.findByRole('treeitem', { name: /analytics/ }))
    expect(screen.getByText('Sélectionner une entité pour commencer')).toBeInTheDocument()
  })

  // **Le schéma est le premier palier qui a quelque chose à dire** : c'est `A4`, et il reste.
  it('assemble la coquille dès qu’un schéma est sélectionné : arbre, centre, panneau droit', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirLArbreJusquAuSchema(utilisateur)
    expect(screen.queryByText('Sélectionner une entité pour commencer')).not.toBeInTheDocument()
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByLabelText('Détail de l’objet')).toBeInTheDocument()
  })

  it('l’arbre se lit sans réseau : rien n’est ouvert au montage', () => {
    const { passerelle } = monter()
    expect(passerelle.openDatabase).not.toHaveBeenCalled()
    expect(passerelle.listSchemas).not.toHaveBeenCalled()
  })

  it('déplier une base l’ouvre et charge ses schémas ; déplier un schéma charge ses objets', async () => {
    const utilisateur = userEvent.setup()
    const { passerelle } = monter()

    await ouvrirLArbreJusquAuSchema(utilisateur)

    expect(passerelle.openDatabase).toHaveBeenCalledTimes(1)
    expect(passerelle.listObjects).toHaveBeenCalledWith(
      { project: 'Atelier Nord', database: 'analytics', environment: 'prod' },
      'public',
    )
    expect(await screen.findByRole('treeitem', { name: /orders/ })).toBeInTheDocument()
  })

  it('double-cliquer une table de la liste ouvre un onglet', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirLArbreJusquAuSchema(utilisateur)

    const table = await screen.findByRole('table')
    await utilisateur.dblClick(within(table).getByText('orders'))

    expect(screen.getByRole('tab', { name: /orders/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('grid', { name: 'Lignes de public.orders' })).toBeInTheDocument()
  })

  it('rouvrir la même table active l’onglet existant sans le dupliquer', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirLArbreJusquAuSchema(utilisateur)

    // Depuis l'arbre, où les deux tables restent atteignables une fois un onglet ouvert.
    // C'est le second **ouvrir** qui doit dédoublonner : cliquer l'onglet ne le prouverait pas,
    // puisqu'il n'appelle pas `ouvrir` du tout — une première version de ce test passait sans
    // que le dédoublonnage existe.
    await utilisateur.click(await screen.findByRole('treeitem', { name: /^orders/ }))
    await utilisateur.click(screen.getByRole('treeitem', { name: /order_items/ }))
    await utilisateur.click(screen.getByRole('treeitem', { name: /^orders/ }))

    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.getByRole('tab', { name: /^orders/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('fermer le dernier onglet laisse l’écran debout, sur la liste des objets', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirLArbreJusquAuSchema(utilisateur)

    const table = await screen.findByRole('table')
    await utilisateur.dblClick(within(table).getByText('orders'))
    await utilisateur.click(screen.getByRole('button', { name: 'Fermer orders' }))

    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    // La liste des objets revient, et l'écran de travail est toujours là.
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(
      screen.getByRole('tree', { name: 'Projets, environnements et connexions' }),
    ).toBeInTheDocument()
  })

  it('la sidebar liste les colonnes de la table ouverte, pas avant', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirLArbreJusquAuSchema(utilisateur)
    expect(screen.queryByText(/^Colonnes de/)).not.toBeInTheDocument()

    const table = await screen.findByRole('table')
    await utilisateur.dblClick(within(table).getByText('orders'))

    expect(await screen.findByText('Colonnes de orders')).toBeInTheDocument()
    // `created_at` apparaît deux fois une fois la table ouverte — dans la sidebar et dans
    // l'en-tête de la grille. C'est celle de la sidebar qui est en cause ici.
    const section = screen.getByText('Colonnes de orders').parentElement as HTMLElement
    await waitFor(() => expect(within(section).getByText('created_at')).toBeInTheDocument())
  })

  it('« Ouvrir les données » du panneau droit ouvre l’onglet, et n’annonce plus A5', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirLArbreJusquAuSchema(utilisateur)

    const table = await screen.findByRole('table')
    await utilisateur.click(within(table).getByText('orders'))

    const action = await screen.findByRole('button', { name: 'Ouvrir les données' })
    expect(action).not.toHaveAttribute('aria-disabled')
    await utilisateur.click(action)

    expect(screen.getByRole('tab', { name: /orders/ })).toBeInTheDocument()
  })

  it('la sidebar annote la colonne triée, d’après l’état de la vue de table', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /^orders/ }))

    const section = (await screen.findByText('Colonnes de orders')).parentElement as HTMLElement
    await waitFor(() => expect(within(section).getByText('created_at')).toBeInTheDocument())
    expect(within(section).queryByText(/tri/)).not.toBeInTheDocument()

    await utilisateur.click(screen.getByRole('button', { name: 'Trier par created_at' }))

    // L'annotation reflète l'état de la grille — un seul état, deux lecteurs.
    await waitFor(() => expect(within(section).getByText('tri ↑')).toBeInTheDocument())
  })

  it('« Structure » bascule vers la structure, et « Données » ramène la grille', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /^orders/ }))

    // Le tableau de la grille (`10a`) est là, celui des colonnes non.
    expect(screen.queryByRole('table', { name: /Colonnes de public\.orders/ })).toBeNull()

    await utilisateur.click(screen.getByRole('button', { name: 'Structure' }))

    // **Le tableau des colonnes, avec ce que l'introspection en sait.** Aucune commande nouvelle
    // n'a été envoyée : `detail` était déjà lu pour la sidebar.
    const structure = await screen.findByRole('table', { name: /Colonnes de public\.orders/ })
    expect(within(structure).getByText('created_at')).toBeInTheDocument()
    // Le pressé dit laquelle des deux vues est à l'écran — sans quoi les deux libellés seraient
    // indiscernables.
    expect(screen.getByRole('button', { name: 'Structure' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await utilisateur.click(screen.getByRole('button', { name: 'Données' }))
    await waitFor(() =>
      expect(screen.queryByRole('table', { name: /Colonnes de public\.orders/ })).toBeNull(),
    )
  })

  it('la vue est un état d’onglet : chaque onglet garde la sienne', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /^orders/ }))
    await utilisateur.click(screen.getByRole('button', { name: 'Structure' }))
    await screen.findByRole('table', { name: /Colonnes de public\.orders/ })

    // Un second onglet s'ouvre sur les données, pas sur la structure du premier.
    await utilisateur.click(await screen.findByRole('treeitem', { name: /^order_items/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Données' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )

    // Et revenir sur `orders` le retrouve en structure.
    await utilisateur.click(screen.getByRole('tab', { name: /^orders/ }))
    await screen.findByRole('table', { name: /Colonnes de public\.orders/ })
  })

  it('un dépliage qui échoue le dit sur sa ligne sans vider l’arbre', async () => {
    const utilisateur = userEvent.setup()
    const { passerelle } = passerelles()
    passerelle.openDatabase = vi.fn(async () => {
      throw new Error('hôte injoignable')
    })
    render(
      <>
        <Sprite />
        <LanguageProvider preferences={{ language: 'fr' }}>
          <Workbench
            projects={PROJETS}
            passerelle={passerelle}
            passerelleDetail={{ describeTable: vi.fn(async () => DETAIL) }}
          />
        </LanguageProvider>
      </>,
    )

    await ouvrirLesEnvironnements(utilisateur)
    // **Déplié, non seulement sélectionné** : le message d'échec est une *ligne enfant* de la
    // connexion, donc il n'a de place que sous un nœud ouvert.
    await utilisateur.dblClick(await screen.findByRole('treeitem', { name: /analytics/ }))

    expect(await screen.findByText(/hôte injoignable/)).toBeInTheDocument()
    // L'autre base reste visible : un échec ne vide pas l'arbre.
    expect(screen.getByRole('treeitem', { name: /shop/ })).toBeInTheDocument()
  })
})

// --- Le mode édition (11b) ---

describe('la console SQL (`12a`)', () => {
  it('« Nouvelle console… » ouvre un onglet de console', async () => {
    const utilisateur = userEvent.setup()
    monter({ onCreateConsole: async () => {} })
    await ouvrirUneConsole(utilisateur)

    expect(screen.getByRole('tab', { name: /console 1/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Requête SQL')).toBeInTheDocument()
  })

  it('sans base ouverte, il n’y a pas de console à ouvrir', () => {
    monter()
    // Une console sans base n'aurait rien à interroger : le bouton disparaît plutôt que d'ouvrir un
    // onglet inerte.
    expect(screen.queryByRole('button', { name: /Nouvelle console/ })).not.toBeInTheDocument()
  })

  /**
   * Ouvre une console **sans avoir déplié sa base**.
   *
   * Le menu « … » d'une connexion est atteignable dès que son environnement est déplié : la base
   * elle-même n'a pas à l'être, et c'est précisément le chemin qui n'ouvrait aucune connexion.
   */
  async function ouvrirUneConsoleSansDeplierLaBase(
    utilisateur: ReturnType<typeof userEvent.setup>,
  ) {
    await ouvrirLesEnvironnements(utilisateur)
    await utilisateur.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await utilisateur.click(screen.getByRole('button', { name: /Nouvelle console/ }))
  }

  it('« Nouvelle console… » ouvre la connexion de la base, jamais dépliée', async () => {
    const utilisateur = userEvent.setup()
    const { passerelle } = monter({ passerelleExecution: PASSERELLE_SQL })
    await ouvrirLesEnvironnements(utilisateur)
    // Le point de départ : l'arbre se lit sans réseau, donc rien n'est ouvert.
    expect(passerelle.openDatabase).not.toHaveBeenCalled()

    await utilisateur.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await utilisateur.click(screen.getByRole('button', { name: /Nouvelle console/ }))

    // **La console est ouverte « sur » une connexion : elle ne peut rien interroger tant que celle-ci
    // n'est pas ouverte.** Sans cet appel, la première exécution répondait « aucune connexion
    // ouverte » sur un onglet que le geste venait de mettre au premier plan.
    await waitFor(() => expect(passerelle.openDatabase).toHaveBeenCalledTimes(1))
    expect(passerelle.openDatabase).toHaveBeenCalledWith(
      { project: 'Atelier Nord', database: 'analytics', environment: 'prod' },
      'postgresql',
      REGLAGES,
    )
  })

  it('la console ainsi ouverte propose les tables de sa connexion', async () => {
    const utilisateur = userEvent.setup()
    const { structures } = monter({ passerelleExecution: PASSERELLE_SQL })
    await ouvrirUneConsoleSansDeplierLaBase(utilisateur)
    // La cascade de préchauffage part de l'ouverture : attendre qu'elle ait décrit les deux tables du
    // décor date la mesure de l'instant où l'autocomplétion peut répondre (règle n° 15).
    await waitFor(() => expect(structures.describeTable).toHaveBeenCalledTimes(2))

    // **Le corollaire visible de l'ouverture** : l'autocomplétion lit les schémas de la connexion
    // *de la console* dans `charge.schemas`, que seule une ouverture remplit — et les tables de
    // chacun dans le préchauffage, que seule une ouverture lance. Sans elle, `public.` ne proposait
    // rien, silencieusement.
    await saisir(utilisateur, 'select * from public.ord')
    await waitFor(() =>
      expect(document.querySelector('.cm-tooltip-autocomplete')?.textContent).toContain('orders'),
    )
  })

  it('deux consoles créées de suite n’ouvrent la connexion qu’une fois', async () => {
    const utilisateur = userEvent.setup()
    const { passerelle } = passerelles()
    // **Une ouverture qui ne rend jamais la main** : c'est la seule façon de tenir la connexion « en
    // cours » pendant deux gestes. Un décor qui répond tout de suite fait passer le second geste par
    // le cache des schémas, donc ne mesure pas le garde-fou visé (règle n° 5).
    passerelle.openDatabase = vi.fn(
      () =>
        new Promise<ConnectionState>(() => {
          /* jamais résolue */
        }),
    )
    render(
      <>
        <Sprite />
        <LanguageProvider preferences={{ language: 'fr' }}>
          <Workbench
            projects={PROJETS}
            passerelle={passerelle}
            passerelleDetail={{ describeTable: vi.fn(async () => DETAIL) }}
            onCreateConsole={async () => {}}
          />
        </LanguageProvider>
      </>,
    )

    await ouvrirLesEnvironnements(utilisateur)
    for (let fois = 0; fois < 2; fois++) {
      await utilisateur.click(screen.getByRole('button', { name: 'Actions de analytics' }))
      await utilisateur.click(screen.getByRole('button', { name: /Nouvelle console/ }))
    }

    // Une ouverture en vol n'est pas relancée : deux connexions au même serveur pour un seul clic de
    // plus, c'est ce que le garde-fou sur `enCours` empêche.
    expect(passerelle.openDatabase).toHaveBeenCalledTimes(1)
  })

  it('cliquer une console de l’arbre retente une ouverture qui avait échoué', async () => {
    const utilisateur = userEvent.setup()
    const { passerelle } = passerelles()
    passerelle.openDatabase = vi.fn(async () => {
      throw new Error('hôte injoignable')
    })
    render(
      <>
        <Sprite />
        <LanguageProvider preferences={{ language: 'fr' }}>
          <Workbench
            projects={avecConsole('CA par jour', 'select 42')}
            passerelle={passerelle}
            passerelleDetail={{ describeTable: vi.fn(async () => DETAIL) }}
          />
        </LanguageProvider>
      </>,
    )

    await ouvrirLesEnvironnements(utilisateur)
    await utilisateur.dblClick(await screen.findByRole('treeitem', { name: /analytics/ }))
    expect(await screen.findByText(/hôte injoignable/)).toBeInTheDocument()
    // **Le compte avant le geste, jamais un nombre écrit** : le dépliage lui-même en fait plus d'un
    // (le clic sélectionne, le second déplie), et une constante en dur mesurerait ce détail plutôt
    // que la reprise.
    const avant = (passerelle.openDatabase as ReturnType<typeof vi.fn>).mock.calls.length

    // **Les consoles s'affichent malgré l'échec**, délibérément : une console est un texte qu'on a
    // écrit, et le rendre dépendant d'une connexion qui répond en ferait perdre l'accès au pire
    // moment. Le clic doit donc **retenter** l'ouverture, plutôt que d'ouvrir un onglet inerte.
    await utilisateur.click(await screen.findByRole('treeitem', { name: /CA par jour/ }))
    await waitFor(() =>
      expect((passerelle.openDatabase as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
        avant + 1,
      ),
    )
  })

  /**
   * Le texte de l'éditeur.
   *
   * **Pas `toHaveValue`, et pas le `textContent` de l'hôte** : depuis `12b`, l'éditeur est CodeMirror
   * — son document vit dans `.cm-content`, et lire l'hôte entier ramènerait aussi les **numéros de
   * ligne** de la gouttière. Une première version rendait « 91 » pour deux lignes vides.
   */
  const texteDeLEditeur = () => document.querySelector('.cm-content')?.textContent

  it('deux consoles gardent chacune son texte', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirUneConsole(utilisateur)
    await saisir(utilisateur, 'select 1')

    await ouvrirUneConsole(utilisateur)
    // **Le nerf de ce test depuis `12b`** : CodeMirror tient son propre document, donc sans instance
    // par onglet la seconde console afficherait le texte de la première. `12a` avait retiré la `key`
    // faute de garantie mesurable ; elle en a une maintenant.
    expect(texteDeLEditeur()).toBe('')
    await saisir(utilisateur, 'select 2')

    // **Deux brouillons, pas un.** C'est la différence avec deux onglets sur la même table, qui n'en
    // font qu'un : on ouvre une seconde console parce qu'on veut garder la première.
    await utilisateur.click(screen.getByRole('tab', { name: /console 1/ }))
    expect(texteDeLEditeur()).toBe('select 1')
    await utilisateur.click(screen.getByRole('tab', { name: /console 2/ }))
    expect(texteDeLEditeur()).toBe('select 2')
  })

  it('deux consoles gardent chacune son résultat', async () => {
    const utilisateur = userEvent.setup()
    // **Le décor distingue les deux résultats par la requête qui les a produits** : un pont qui
    // rendrait toujours `RESULTAT` laisserait le partage passer, les deux grilles étant identiques
    // (règle n° 5 — un décor trop régulier ne mesure que le décor).
    monter({
      passerelleExecution: {
        runSql: async (_cle, sql) => ({ ...RESULTAT, columns: [sql], sql }),
      },
    })

    await ouvrirUneConsole(utilisateur)
    await saisir(utilisateur, 'select 1')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))
    expect(await screen.findByRole('columnheader', { name: /^select 1$/ })).toBeInTheDocument()

    // **Le nerf du test** : une console neuve n'a rien exécuté, donc elle ne montre rien. Un état
    // d'exécution unique lui faisait afficher le résultat de la voisine — sous un texte qui ne
    // l'avait pas produit, donc sans rien pour dire laquelle on regardait.
    await ouvrirUneConsole(utilisateur)
    expect(screen.getByText(/Aucun résultat/)).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /^select 1$/ })).not.toBeInTheDocument()

    await saisir(utilisateur, 'select 2')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))
    expect(await screen.findByRole('columnheader', { name: /^select 2$/ })).toBeInTheDocument()

    // Et revenir retrouve le premier résultat : basculer d'onglet ne relance rien, il rend ce que
    // cette console avait déjà.
    await utilisateur.click(screen.getByRole('tab', { name: /console 1/ }))
    expect(screen.getByRole('columnheader', { name: /^select 1$/ })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /^select 2$/ })).not.toBeInTheDocument()
  })

  it('une requête lente rend son résultat à la console qui l’a demandée', async () => {
    const utilisateur = userEvent.setup()
    let repondre: ((resultat: typeof RESULTAT) => void) | null = null
    monter({
      passerelleExecution: {
        runSql: async (_cle, sql) =>
          sql === 'select lent'
            ? new Promise((resolve) => {
                repondre = (resultat) => resolve(resultat)
              })
            : { ...RESULTAT, columns: [sql], sql },
      },
    })

    await ouvrirUneConsole(utilisateur)
    await saisir(utilisateur, 'select lent')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))

    // **L'attente appartient à la console qui attend.** Une console neuve ouverte pendant ce
    // temps-là ne doit pas hériter d'un « Exécution… » qui n'est pas le sien, ni voir sa toolbar
    // désactivée par la requête d'une autre.
    await ouvrirUneConsole(utilisateur)
    expect(screen.getByText(/Aucun résultat/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Exécuter/ })).toBeEnabled()

    // Le résultat arrive alors que l'onglet demandeur n'est plus actif : il se dépose chez lui.
    // L'identité est capturée au départ, pas relue à la réponse — sinon la grille atterrirait sur
    // la console qu'on regarde, ou serait perdue.
    await act(async () => {
      ;(repondre as unknown as (resultat: typeof RESULTAT) => void)({
        ...RESULTAT,
        columns: ['select lent'],
        sql: 'select lent',
      })
    })
    expect(screen.queryByRole('columnheader', { name: /^select lent$/ })).not.toBeInTheDocument()
    await utilisateur.click(screen.getByRole('tab', { name: /console 1/ }))
    expect(screen.getByRole('columnheader', { name: /^select lent$/ })).toBeInTheDocument()
  })

  it('une console et une table cohabitent dans la même bande', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /^orders/ }))
    await ouvrirUneConsole(utilisateur)

    // Un second système d'onglets à côté du premier doublerait la navigation pour un seul écran.
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    // Et revenir à la table remet la grille, pas l'éditeur.
    await utilisateur.click(screen.getByRole('tab', { name: /orders/ }))
    expect(screen.getByRole('grid')).toBeInTheDocument()
    expect(screen.queryByLabelText('Requête SQL')).not.toBeInTheDocument()
  })

  it('l’onglet de console porte son icône, distincte de celle d’une table', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /^orders/ }))
    await ouvrirUneConsole(utilisateur)

    const icone = (nom: RegExp) =>
      screen.getByRole('tab', { name: nom }).querySelector('use')?.getAttribute('href')
    // Une console qui porterait l'icône d'une table serait indiscernable de ses voisines dans la
    // bande — c'est le seul repère à côté du libellé.
    expect(icone(/console 1/)).not.toBe(icone(/orders/))
    expect(icone(/console 1/)).toBe('#i-term')
  })

  it('les actions non livrées sont désactivées et disent pourquoi', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirUneConsole(utilisateur)

    // **Présentes et désactivées, pas absentes** : les cacher ferait croire qu'elles n'existeront
    // pas, les laisser cliquables et inertes ferait croire à une panne (défaut n° 36).
    // Les trois autres répondent depuis `12c` à `12f`. **Il ne reste que « Formater »**, seule action
    // du mockup sans spec : elle demande un formateur SQL, donc une décision de dépendance.
    for (const libelle of ['Formater']) {
      const action = screen.getByRole('button', { name: new RegExp(libelle) })
      expect(action).toBeDisabled()
      expect(action).toHaveAttribute('title', expect.stringMatching(/formateur/))
    }
  })

  it('« Exécuter » envoie le texte de la console au moteur (`12c`)', async () => {
    const utilisateur = userEvent.setup()
    const executer = vi.fn(async () => RESULTAT)
    monter({ passerelleExecution: { runSql: executer } })
    await ouvrirUneConsole(utilisateur)
    await saisir(utilisateur, 'select 1')

    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))

    await waitFor(() => expect(executer).toHaveBeenCalledOnce())
    const [, sql, limite] = executer.mock.calls[0] as unknown as [unknown, string, string]
    expect(sql).toBe('select 1')
    // La limite par défaut de la console, celle du mockup. Le moteur décide s'il l'applique.
    expect(limite).toBe('oneThousand')
    // Le résultat s'affiche dans la grille de `10a`, pas dans une seconde grille.
    expect(await screen.findByRole('grid', { name: /Résultat de la requête/ })).toBeInTheDocument()
  })

  it('la limite ajoutée par DoraBase est annoncée', async () => {
    const utilisateur = userEvent.setup()
    monter({
      passerelleExecution: {
        runSql: async () => ({ ...RESULTAT, appliedLimit: 1000 }),
      },
    })
    await ouvrirUneConsole(utilisateur)
    await saisir(utilisateur, 'select 1')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))

    // **Une limite silencieuse ferait croire à une table de mille lignes** — un mensonge sur les
    // données, la pire catégorie de défaut pour cet outil.
    expect(await screen.findByRole('status', { name: 'État du résultat' })).toHaveTextContent(
      'limité à 1000 par DoraBase',
    )
  })

  it('une lecture ne demande aucune confirmation', async () => {
    const utilisateur = userEvent.setup()
    const executer = vi.fn(async () => RESULTAT)
    monter({ passerelleExecution: { runSql: executer } })
    await ouvrirUneConsole(utilisateur)
    await saisir(utilisateur, 'select 1')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))

    // Une confirmation sur chaque `select` deviendrait un clic réflexe, et c'est ainsi qu'une
    // confirmation cesse de protéger quoi que ce soit.
    await waitFor(() => expect(executer).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog', { name: /Écrire dans la base/ })).not.toBeInTheDocument()
  })

  it('un `delete` sans `where` demande confirmation, et la nomme', async () => {
    const utilisateur = userEvent.setup()
    const executer = vi.fn(async () => RESULTAT)
    monter({ passerelleExecution: { runSql: executer } })
    await ouvrirUneConsole(utilisateur)
    await saisir(utilisateur, 'delete from orders')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))

    // **Rien n'est parti.** C'est le garde-fou de `12c` : il protège de la faute de frappe, pas
    // d'une intention.
    expect(executer).not.toHaveBeenCalled()
    const confirmation = screen.getByRole('dialog', { name: 'Écrire dans la base' })
    // **Dans le récapitulatif, pas seulement dans le bouton** : une première version cherchait
    // « DELETE » dans la modale entière, et le trouvait dans « Exécuter ce DELETE » — le test restait
    // vert quand le récapitulatif cessait de nommer l'instruction.
    const recap = confirmation.querySelector('dl')
    expect(recap).toHaveTextContent('DELETE')
    // Le fait le plus coûteux, dit en premier : sans `where`, toute la table est touchée.
    expect(confirmation).toHaveTextContent('toutes les lignes')

    await utilisateur.click(screen.getByRole('button', { name: /Exécuter ce DELETE/ }))
    await waitFor(() => expect(executer).toHaveBeenCalledOnce())
  })

  it('annuler la confirmation n’exécute rien et garde la requête', async () => {
    const utilisateur = userEvent.setup()
    const executer = vi.fn(async () => RESULTAT)
    monter({ passerelleExecution: { runSql: executer } })
    await ouvrirUneConsole(utilisateur)
    await saisir(utilisateur, 'drop table orders')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))
    // Une modification de structure porte son propre titre : elle ne se défait pas par une requête.
    expect(screen.getByRole('dialog', { name: 'Modifier la structure' })).toBeInTheDocument()

    await utilisateur.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(executer).not.toHaveBeenCalled()
    // La requête survit au renoncement : rien n'a été exécuté, rien n'a été perdu.
    expect(texteDeLEditeur()).toBe('drop table orders')
  })

  it('un échec efface le résultat précédent', async () => {
    const utilisateur = userEvent.setup()
    let echoue = false
    monter({
      passerelleExecution: {
        runSql: async () => {
          if (echoue) throw new Error('ERROR: relation "absente" does not exist')
          return RESULTAT
        },
      },
    })
    await ouvrirUneConsole(utilisateur)
    await saisir(utilisateur, 'select 1')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))
    expect(await screen.findByRole('grid', { name: /Résultat de la requête/ })).toBeInTheDocument()

    echoue = true
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))

    // **Garder l'ancien résultat à côté d'une erreur laisserait croire qu'il vient de la requête qui
    // vient d'échouer** — la lecture la plus naturelle, et la plus fausse.
    expect(await screen.findByRole('alert')).toHaveTextContent('does not exist')
    expect(screen.queryByRole('grid', { name: /Résultat de la requête/ })).not.toBeInTheDocument()
  })

  it('une erreur SQL s’affiche en entier et ne vide pas l’éditeur', async () => {
    const utilisateur = userEvent.setup()
    monter({
      passerelleExecution: {
        runSql: async () => {
          throw new Error('ERROR: syntax error at or near "from"\nLINE 1: select from')
        },
      },
    })
    await ouvrirUneConsole(utilisateur)
    await saisir(utilisateur, 'select from')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))

    // **Le message du serveur, entier** : c'est lui qui dit *où* est la faute, et l'abréger enlèverait
    // la ligne, qui est le plus utile.
    const alerte = await screen.findByRole('alert')
    expect(alerte).toHaveTextContent('syntax error')
    expect(alerte).toHaveTextContent('LINE 1')
    // Et la requête reste : la perdre sur une faute de frappe obligerait à tout retaper.
    expect(texteDeLEditeur()).toBe('select from')
  })

  it('la vue JSON suit la ligne sélectionnée', async () => {
    const utilisateur = userEvent.setup()
    monter({
      passerelleExecution: {
        runSql: async () => RESULTAT,
      },
    })
    await ouvrirUneConsole(utilisateur)
    await saisir(utilisateur, 'select 1')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))
    await screen.findByRole('grid', { name: /Résultat de la requête/ })

    await utilisateur.click(screen.getByRole('radio', { name: /JSON/ }))
    // **Sans sélection, rien à montrer** : sérialiser mille lignes contredirait la contrainte
    // transverse du projet, donc la vue suit la sélection comme le panneau de `10f`.
    expect(screen.getByText(/Sélectionnez une ligne/)).toBeInTheDocument()

    await utilisateur.click(screen.getByRole('radio', { name: /Résultat/ }))
    await utilisateur.click(screen.getAllByRole('row')[1] as HTMLElement)
    await utilisateur.click(screen.getByRole('radio', { name: /JSON/ }))
    expect(screen.getByText(/"n"/)).toBeInTheDocument()
  })

  it('« Messages » dit ce que DoraBase a fait de son propre chef', async () => {
    const utilisateur = userEvent.setup()
    monter({
      passerelleExecution: {
        runSql: async () => ({ ...RESULTAT, appliedLimit: 1000 }),
      },
    })
    await ouvrirUneConsole(utilisateur)
    await saisir(utilisateur, 'select 1')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))
    await screen.findByRole('grid', { name: /Résultat de la requête/ })

    await utilisateur.click(screen.getByRole('radio', { name: /Messages/ }))
    // La barre disparaît du regard ; un journal se relit. Et c'est là qu'on cherche pourquoi un
    // résultat s'arrête à mille lignes.
    expect(screen.getByText(/a ajouté/)).toBeInTheDocument()
    // Ce qui n'est pas capté est **dit**, plutôt que laissé croire à un serveur silencieux.
    expect(screen.getByText(/ne sont pas encore captés/)).toBeInTheDocument()
  })

  it('« Enregistrer » fait exister le brouillon sous un nom par défaut, sans rien demander', async () => {
    const utilisateur = userEvent.setup()
    const creer = vi.fn(async () => {})
    monter({ passerelleExecution: PASSERELLE_SQL, onCreateConsole: creer })
    await ouvrirUneConsole(utilisateur)
    await saisir(utilisateur, 'select 1')

    const toolbar = screen.getByRole('toolbar', { name: 'Actions de la console' })
    await utilisateur.click(within(toolbar).getByRole('button', { name: /Enregistrer/ }))

    // **Aucune modale** : nommer avant d'avoir écrit revient à demander un titre pour une page
    // blanche. Le nom par défaut suffit, et le double-clic sur la ligne renomme plus tard.
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() =>
      expect(creer).toHaveBeenCalledWith('Atelier Nord', 'analytics', 'prod', 'console 1'),
    )
    // L'onglet cesse d'être un brouillon : il porte le nom de la console.
    expect(await screen.findByRole('tab', { name: /console 1/ })).toBeInTheDocument()
  })

  it('le résultat du brouillon survit à « Enregistrer »', async () => {
    const utilisateur = userEvent.setup()
    monter({ passerelleExecution: PASSERELLE_SQL })
    // **Le seul chemin vers un onglet *volatile*** : « Nouvelle console » du menu d'une connexion
    // crée une console persistée, dont l'onglet n'a rien à enregistrer. Un brouillon ne s'ouvre plus
    // que par « Ouvrir dans la console » du DDL — et c'est là que « Enregistrer » a un objet.
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /^orders/ }))
    await utilisateur.click(screen.getByRole('button', { name: 'Structure' }))
    await screen.findByRole('table', { name: /Colonnes de public\.orders/ })
    await utilisateur.click(screen.getByRole('button', { name: /Ouvrir dans la console/ }))

    await saisir(utilisateur, 'select 1')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))
    expect(await screen.findByRole('columnheader', { name: 'n' })).toBeInTheDocument()

    await utilisateur.click(
      within(screen.getByRole('toolbar', { name: 'Actions de la console' })).getByRole('button', {
        name: /Enregistrer/,
      }),
    )

    // **Le baptême change l'identité de l'onglet** — du numéro au nom (voir `idOnglet`) : le
    // résultat doit la suivre, sans quoi « Enregistrer » viderait la grille.
    await waitFor(() =>
      expect(
        within(screen.getByRole('toolbar', { name: 'Actions de la console' })).getByRole('button', {
          name: /Enregistrer/,
        }),
      ).toBeDisabled(),
    )
    expect(screen.getByRole('columnheader', { name: 'n' })).toBeInTheDocument()
  })

  it('le nom par défaut prend le premier numéro libre de la connexion', async () => {
    const utilisateur = userEvent.setup()
    const creer = vi.fn(async () => {})
    monter({
      projects: avecConsole('console 1', ''),
      passerelleExecution: PASSERELLE_SQL,
      onCreateConsole: creer,
    })
    await ouvrirUneConsole(utilisateur)
    await saisir(utilisateur, 'select 1')
    await utilisateur.click(
      within(screen.getByRole('toolbar', { name: 'Actions de la console' })).getByRole('button', {
        name: /Enregistrer/,
      }),
    )

    // « console 1 » est pris : la suivante est « console 2 », et non un homonyme que le cœur
    // refuserait.
    await waitFor(() =>
      expect(creer).toHaveBeenCalledWith('Atelier Nord', 'analytics', 'prod', 'console 2'),
    )
  })

  it('une console de l’arbre s’ouvre sur son texte persisté', async () => {
    const utilisateur = userEvent.setup()
    monter({
      projects: avecConsole('CA par jour', 'select 42'),
      passerelleExecution: PASSERELLE_SQL,
    })
    await ouvrirLArbreJusquAuSchema(utilisateur)

    await utilisateur.click(await screen.findByRole('treeitem', { name: /CA par jour/ }))
    // L'onglet porte le texte écrit sur le disque, et non un éditeur vide.
    expect(texteDeLEditeur()).toBe('select 42')
  })

  it('chaque frappe d’une console de l’arbre est écrite', async () => {
    const utilisateur = userEvent.setup()
    const ecrire = vi.fn(async () => {})
    monter({
      projects: avecConsole('CA par jour', ''),
      passerelleExecution: PASSERELLE_SQL,
      onSaveConsole: ecrire,
    })
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /CA par jour/ }))
    await saisir(utilisateur, 'select 1')

    // **C'est ce qui distingue une console persistée d'un brouillon** : personne n'a cliqué
    // « Enregistrer », et le texte est pourtant parti vers le disque.
    //
    // `waitFor` parce que l'écriture est **amortie** : une réécriture du fichier de configuration
    // par touche serait du travail disque pur pour un état que personne ne lira. Ce que ce test
    // mesure est qu'elle finit par partir, non le délai — l'affirmer figerait une constante de
    // réglage dans une assertion.
    await waitFor(() =>
      expect(ecrire).toHaveBeenCalledWith(
        'Atelier Nord',
        'analytics',
        'prod',
        'CA par jour',
        'select 1',
      ),
    )
  })

  it('un double-clic sur l’onglet renomme la console, comme dans l’arbre', async () => {
    const utilisateur = userEvent.setup()
    const renommer = vi.fn(async () => {})
    monter({
      projects: avecConsole('CA par jour', 'select 42'),
      passerelleExecution: PASSERELLE_SQL,
      onRenameConsole: renommer,
    })
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /CA par jour/ }))

    await utilisateur.dblClick(await screen.findByRole('tab', { name: /CA par jour/ }))
    const champ = screen.getByLabelText('Nouveau nom de CA par jour')
    await utilisateur.clear(champ)
    await utilisateur.type(champ, 'Audit{Enter}')

    // **Une console se rencontre aux deux endroits** — la ligne d'arbre et l'onglet — et n'être
    // renommable qu'à l'un des deux obligerait à se souvenir lequel.
    expect(renommer).toHaveBeenCalledWith(
      'Atelier Nord',
      'analytics',
      'prod',
      'CA par jour',
      'Audit',
    )
  })

  it('le résultat de la console survit à son renommage', async () => {
    const utilisateur = userEvent.setup()
    monter({
      projects: avecConsole('CA par jour', 'select 42'),
      passerelleExecution: PASSERELLE_SQL,
      onRenameConsole: async () => {},
    })
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /CA par jour/ }))
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))
    expect(await screen.findByRole('columnheader', { name: 'n' })).toBeInTheDocument()

    await utilisateur.dblClick(await screen.findByRole('tab', { name: /CA par jour/ }))
    const champ = screen.getByLabelText('Nouveau nom de CA par jour')
    await utilisateur.clear(champ)
    await utilisateur.type(champ, 'Audit{Enter}')

    // **Le résultat est la quatrième table indexée par identité d'onglet**, et l'identité d'une
    // console dérive de son nom : sans réindexation, renommer viderait la grille sous les yeux.
    await waitFor(() => expect(screen.getByRole('tab', { name: /Audit/ })).toBeInTheDocument())
    expect(screen.getByRole('columnheader', { name: 'n' })).toBeInTheDocument()
  })

  it('rouvrir une console déjà ouverte réactive son onglet au lieu d’en empiler un second', async () => {
    const utilisateur = userEvent.setup()
    monter({
      projects: avecConsole('CA par jour', 'select 42'),
      passerelleExecution: PASSERELLE_SQL,
    })
    await ouvrirLArbreJusquAuSchema(utilisateur)

    await utilisateur.click(await screen.findByRole('treeitem', { name: /CA par jour/ }))
    await utilisateur.click(await screen.findByRole('treeitem', { name: /CA par jour/ }))
    // Une console désigne un objet unique : deux onglets sur le même texte divergeraient à la
    // première frappe. Un brouillon, lui, s'empile — c'est tout l'intérêt d'en ouvrir un second.
    const onglets = screen.getAllByRole('tab', { name: /CA par jour/ })
    expect(onglets).toHaveLength(1)
  })

  it('fermer une console la retire, et le voisin reprend la main', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /^orders/ }))
    await ouvrirUneConsole(utilisateur)
    await utilisateur.click(screen.getByRole('button', { name: 'Fermer console 1' }))

    expect(screen.queryByLabelText('Requête SQL')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /orders/ })).toHaveAttribute('aria-selected', 'true')
  })

  /**
   * L'autocomplétion propose les colonnes d'une table que le **préchauffage** a lue, sans que
   * personne ne l'ait ouverte à l'écran — la lacune que `colonnesPrechauffees` comble.
   *
   * `order_items` n'apparaît jamais dans un clic de ce test : seule `ouvrirUneConsole` déplie le
   * schéma, ce qui suffit à lancer la cascade de fond. `waitFor` sur le compte d'appels est le
   * signal de complétude — pas un délai, qui daterait la frappe du mauvais instant (règle n° 15).
   *
   * **`connectionStates` doit dire que la base est ouverte.** Le décor par défaut de ce fichier le
   * rend `[]` : juste après « Nouvelle console », qui change `projects`, la synchronisation avec le
   * registre (`useArbre`) purge alors *tout* ce que `charge.objets` tient, faute d'y trouver `analytics`
   * — pas un défaut de `colonnesPrechauffees`, mais du décor de ce test, exposé par lui.
   */
  it('l’autocomplétion propose les colonnes d’une table préchauffée mais jamais ouverte', async () => {
    const utilisateur = userEvent.setup()
    const { structures } = monter({
      passerelle: {
        openDatabase: async () => ({
          kind: 'connected' as const,
          serverVersion: 'PostgreSQL 17.6',
          tunnelLocalPort: null,
        }),
        closeDatabase: async () => {},
        surEchecDeCommande: () => () => {},
        connectionStates: async () => [
          {
            key: { project: 'Atelier Nord', database: 'analytics', environment: 'prod' as const },
            state: {
              kind: 'connected' as const,
              serverVersion: 'PostgreSQL 17.6',
              tunnelLocalPort: null,
            },
          },
        ],
        listSchemas: async () => SCHEMAS,
        listObjects: async () => [objet('orders'), objet('order_items')],
      },
    })
    await ouvrirUneConsole(utilisateur)
    // Les deux tables du décor (`orders`, `order_items`) sont en mémoire ; aucune n'a été cliquée.
    await waitFor(() => expect(structures.describeTable).toHaveBeenCalledTimes(2))

    await saisir(utilisateur, 'select oi. from order_items oi')
    for (let i = 0; i < ' from order_items oi'.length; i++) {
      await utilisateur.keyboard('{ArrowLeft}')
    }
    await utilisateur.keyboard('i')

    await waitFor(() => {
      expect(document.querySelector('.cm-tooltip-autocomplete')?.textContent).toContain('id')
    })
  })

  /**
   * L'autocomplétion propose les tables d'un **autre** schéma que celui affiché à l'écran, dès que
   * ce schéma a été déplié une fois — même compromis que les colonnes d'une table préchauffée : ce
   * que l'écran a déjà lu, pas une devinette.
   */
  it('un schéma déplié, même si ce n’est pas le schéma courant, propose ses tables', async () => {
    const utilisateur = userEvent.setup()
    monter({
      passerelle: {
        openDatabase: async () => ({
          kind: 'connected' as const,
          serverVersion: 'PostgreSQL 17.6',
          tunnelLocalPort: null,
        }),
        closeDatabase: async () => {},
        surEchecDeCommande: () => () => {},
        connectionStates: async () => [
          {
            key: { project: 'Atelier Nord', database: 'analytics', environment: 'prod' as const },
            state: {
              kind: 'connected' as const,
              serverVersion: 'PostgreSQL 17.6',
              tunnelLocalPort: null,
            },
          },
        ],
        listSchemas: async () => [
          ...SCHEMAS,
          {
            name: 'archives',
            owner: 'atelier',
            system: false,
            counts: { tables: 1, views: 0, functions: 0, indexes: 0 },
          },
        ],
        listObjects: async (_cle, schema) =>
          schema === 'archives' ? [objet('orders_2024')] : [objet('orders'), objet('order_items')],
      },
    })
    // `public`, le schéma courant, est déplié par `ouvrirLArbreJusquAuSchema` ; `archives` l'est en
    // plus, explicitement — c'est ce dépliage qui rend ses tables connues.
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.dblClick(await screen.findByRole('treeitem', { name: 'archives' }))
    await waitFor(() => expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(0))
    await ouvrirUneConsole(utilisateur)

    await saisir(utilisateur, 'select * from archives.ord')

    await waitFor(() => {
      const liste = document.querySelector('.cm-tooltip-autocomplete')?.textContent
      expect(liste).toContain('orders_2024')
      // Et pas les tables de `public` : `archives.` ne qualifie que les siennes.
      expect(liste).not.toContain('order_items')
    })
  })

  /**
   * Même chose, mais sans que personne n'ait déplié `archives` dans l'arbre : seul le préchauffage de
   * fond (`useStructures.prechauffer`, lancé à l'ouverture de la connexion) l'a lu. C'est le cas réel
   * qui manquait — un schéma qu'on connaît par son nom sans jamais être allé le regarder.
   */
  it('un schéma jamais déplié propose ses tables dès que le préchauffage de fond l’a lu', async () => {
    const utilisateur = userEvent.setup()
    const listObjects = vi.fn(async (_cle: unknown, schema: string) =>
      schema === 'archives' ? [objet('orders_2024')] : [objet('orders'), objet('order_items')],
    )
    const describeTable = vi.fn(async () => DETAIL)
    monter({
      passerelle: {
        openDatabase: async () => ({
          kind: 'connected' as const,
          serverVersion: 'PostgreSQL 17.6',
          tunnelLocalPort: null,
        }),
        closeDatabase: async () => {},
        surEchecDeCommande: () => () => {},
        connectionStates: async () => [
          {
            key: { project: 'Atelier Nord', database: 'analytics', environment: 'prod' as const },
            state: {
              kind: 'connected' as const,
              serverVersion: 'PostgreSQL 17.6',
              tunnelLocalPort: null,
            },
          },
        ],
        listSchemas: async () => [
          ...SCHEMAS,
          {
            name: 'archives',
            owner: 'atelier',
            system: false,
            counts: { tables: 1, views: 0, functions: 0, indexes: 0 },
          },
        ],
        listObjects,
      },
      // La même liste, côté préchauffage : dans l'application ce sont la même commande — un décor qui
      // les dédoublerait rendrait des tables différentes selon le chemin, une divergence que la
      // réalité n'a pas.
      passerelleStructures: {
        listObjects,
        describeTable,
        describeTables: grouperParBoucle(describeTable),
      },
    })
    // Ni dblclick ni clic sur `archives` : seule `ouvrirUneConsole` déplie `public`, le schéma
    // courant. `archives` n'est connu que du préchauffage de fond.
    await ouvrirUneConsole(utilisateur)
    // `describeTable` suit `listObjects` dans la même cascade (`useStructures`) : attendre `archives`
    // ici, plutôt qu'un délai, date la frappe qui suit du bon instant (règle n° 15).
    await waitFor(() =>
      expect(describeTable).toHaveBeenCalledWith(expect.anything(), 'archives', 'orders_2024'),
    )

    await saisir(utilisateur, 'select * from archives.ord')

    await waitFor(() => {
      expect(document.querySelector('.cm-tooltip-autocomplete')?.textContent).toContain(
        'orders_2024',
      )
    })
  })

  /**
   * Le pendant pour les **colonnes** : une table d'un schéma jamais déplié, une fois préchauffée,
   * propose ses colonnes — pas seulement son nom. `colonnesPrechauffees` ne parcourait que les tables
   * du schéma courant (`objets`) ; une table d'un *autre* schéma restait sans colonnes proposées même
   * une fois sa structure lue par la cascade de fond.
   */
  it('une colonne d’une table jamais ouverte, dans un schéma jamais déplié, est proposée une fois préchauffée', async () => {
    const utilisateur = userEvent.setup()
    const listObjects = vi.fn(async (_cle: unknown, schema: string) =>
      schema === 'archives' ? [objet('orders_2024')] : [objet('orders'), objet('order_items')],
    )
    const describeTable = vi.fn(async () => DETAIL)
    monter({
      passerelle: {
        openDatabase: async () => ({
          kind: 'connected' as const,
          serverVersion: 'PostgreSQL 17.6',
          tunnelLocalPort: null,
        }),
        closeDatabase: async () => {},
        surEchecDeCommande: () => () => {},
        connectionStates: async () => [
          {
            key: { project: 'Atelier Nord', database: 'analytics', environment: 'prod' as const },
            state: {
              kind: 'connected' as const,
              serverVersion: 'PostgreSQL 17.6',
              tunnelLocalPort: null,
            },
          },
        ],
        listSchemas: async () => [
          ...SCHEMAS,
          {
            name: 'archives',
            owner: 'atelier',
            system: false,
            counts: { tables: 1, views: 0, functions: 0, indexes: 0 },
          },
        ],
        listObjects,
      },
      passerelleStructures: {
        listObjects,
        describeTable,
        describeTables: grouperParBoucle(describeTable),
      },
    })
    // Ni la table ni le schéma ne sont jamais cliqués : seule la cascade de fond les lit.
    await ouvrirUneConsole(utilisateur)
    await waitFor(() =>
      expect(describeTable).toHaveBeenCalledWith(expect.anything(), 'archives', 'orders_2024'),
    )

    await saisir(utilisateur, 'select * from archives.orders_2024 o where o.stat')

    await waitFor(() => {
      // `status` vient de `DETAIL`, la structure que la cascade a lue pour `orders_2024`.
      expect(document.querySelector('.cm-tooltip-autocomplete')?.textContent).toContain('status')
    })
  })

  /**
   * Le défaut réel qui manquait : une console ouverte **sans être jamais passée par un schéma** —
   * un simple clic sur la connexion, puis « Nouvelle console » depuis son menu, sans dépliage.
   *
   * `contexte` (dérivé de la sélection de l'arbre) reste alors `null`, et `cle` avec lui : le
   * catalogue entier — schémas, tables, mots-clés — se retrouvait vide, silencieusement. `cleConsole`
   * porte l'identité de la console indépendamment de la sélection de l'arbre, et c'est ce qui répare
   * ce chemin.
   */
  it('une console ouverte sans jamais avoir sélectionné de schéma propose quand même son catalogue', async () => {
    const utilisateur = userEvent.setup()
    // `connectionStates` doit dire que la base est ouverte — sinon « Nouvelle console » (qui change
    // `projects`) déclenche la synchronisation avec le registre et purge `charge.schemas`, comme dans
    // le test du préchauffage ci-dessus.
    monter({
      passerelle: {
        openDatabase: async () => ({
          kind: 'connected' as const,
          serverVersion: 'PostgreSQL 17.6',
          tunnelLocalPort: null,
        }),
        closeDatabase: async () => {},
        surEchecDeCommande: () => () => {},
        connectionStates: async () => [
          {
            key: { project: 'Atelier Nord', database: 'analytics', environment: 'prod' as const },
            state: {
              kind: 'connected' as const,
              serverVersion: 'PostgreSQL 17.6',
              tunnelLocalPort: null,
            },
          },
        ],
        listSchemas: async () => SCHEMAS,
        listObjects: async () => [objet('orders'), objet('order_items')],
      },
    })
    await ouvrirLesEnvironnements(utilisateur)
    // Un clic simple sélectionne et ouvre la connexion, sans déplier aucun schéma.
    await utilisateur.click(await screen.findByRole('treeitem', { name: /analytics/ }))
    await utilisateur.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await utilisateur.click(screen.getByRole('button', { name: /Nouvelle console/ }))

    await saisir(utilisateur, 'select * from publ')

    await waitFor(() => {
      expect(document.querySelector('.cm-tooltip-autocomplete')?.textContent).toContain('public')
    })
  })
})

describe('mode édition', () => {
  /** Ouvre l'arbre, une table, et bascule en édition. */
  async function ouvrirEtEditer(utilisateur: ReturnType<typeof userEvent.setup>) {
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /^orders/ }))
    await screen.findByRole('grid')
    await utilisateur.keyboard(auModificateur('e'))
  }

  /** Modifie la colonne `status` de la première ligne — non nulle, donc l'attendu est renseigné. */
  async function modifier(utilisateur: ReturnType<typeof userEvent.setup>, valeur = 'shipped') {
    const cellules = await screen.findAllByRole('button', { name: 'Modifier status' })
    await utilisateur.click(cellules[0] as HTMLElement)
    const champ = screen.getByLabelText('Nouvelle valeur')
    await utilisateur.clear(champ)
    await utilisateur.type(champ, `${valeur}{Enter}`)
  }

  it('le panneau des modifications prend la place du détail de la ligne', async () => {
    const utilisateur = userEvent.setup()
    monter({ passerellePreview: PREVIEW })
    await ouvrirEtEditer(utilisateur)

    await modifier(utilisateur)

    // **Un seul panneau droit, dont le contenu suit l'écran** (`10f`). Les empiler donnerait deux
    // panneaux là où le mockup n'en montre qu'un ; en éditant, ce qu'on veut voir est ce qu'on a
    // changé.
    expect(await screen.findByLabelText('Modifications en attente de la table')).toBeInTheDocument()

    // **Et le couple de vues survit à la substitution** (`22`). C'est ce que la première version de
    // ce test ne pouvait pas voir : elle mesurait la disparition du panneau de ligne, ce qui reste
    // vrai, sans rien dire de l'en-tête. Poser le couple dans `RowPanel` l'aurait fait disparaître
    // ici même, en pleine édition — le cadre existe pour ça.
    expect(screen.getByRole('button', { name: 'Données' })).toBeInTheDocument()
  })

  it('le SQL du panneau vient du moteur, avec la clé primaire de l’introspection', async () => {
    const utilisateur = userEvent.setup()
    const previsualise = vi.fn(async () => 'BEGIN;\nUPDATE ...;\nCOMMIT;')
    monter({ passerellePreview: { previewUpdates: previsualise } })
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)

    await waitFor(() => expect(previsualise).toHaveBeenCalled())
    const [, plan] = previsualise.mock.calls[0] as unknown as [unknown, UpdatePlan]
    expect(plan.schema).toBe('public')
    expect(plan.table).toBe('orders')
    // **La clé vient de l'introspection**, pas d'une convention sur le nom : une table dont la clé
    // s'appelle `uuid` produirait sinon un `WHERE` sur une colonne qui n'identifie rien.
    expect(plan.keyColumn).toBe('id')
    expect(plan.changes).toHaveLength(1)
    expect(plan.changes[0]?.column).toBe('status')
  })

  it('la clé du plan est celle de l’introspection, même quand elle ne s’appelle pas « id »', async () => {
    const utilisateur = userEvent.setup()
    const previsualise = vi.fn(async () => 'BEGIN;\nCOMMIT;')
    // **Le décor courant nomme sa clé `id`**, ce qui rend « deviner » et « lire l'introspection »
    // indistinguables — un décor trop régulier ne mesure que lui-même. Ici la clé s'appelle `uuid` : une table dont la
    // clé porte un autre nom n'est pas plus rare qu'une autre, et un `WHERE "id" = …` frapperait une
    // colonne qui n'existe pas.
    const premiere = DETAIL.columns[0]
    if (!premiere) throw new Error('le décor doit avoir une première colonne')
    const detailAvecUuid: TableDetail = {
      ...DETAIL,
      columns: [{ ...premiere, name: 'uuid' }, ...DETAIL.columns.slice(1)],
    }
    monter({
      passerelleDetail: { describeTable: vi.fn(async () => detailAvecUuid) },
      passerellePreview: { previewUpdates: previsualise },
    })
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)

    await waitFor(() => expect(previsualise).toHaveBeenCalled())
    const [, plan] = previsualise.mock.calls[0] as unknown as [unknown, UpdatePlan]
    expect(plan.keyColumn).toBe('uuid')
  })

  it('sans SQL revenu, le panneau le dit au lieu d’en fabriquer un', async () => {
    const utilisateur = userEvent.setup()
    // La commande ne répond jamais : c'est l'état d'attente réel, pas une simulation d'échec.
    monter({ passerellePreview: { previewUpdates: () => new Promise(() => {}) } })
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)

    const panneau = await screen.findByLabelText('Modifications en attente de la table')
    expect(panneau).toHaveTextContent('prépare la requête')
    expect(panneau).not.toHaveTextContent('UPDATE')
  })

  it('la confirmation de retrait compte les modifications réellement en attente', async () => {
    const utilisateur = userEvent.setup()
    monter({ onDelete: async () => ({ leftoverSecrets: [] }) })
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)

    await utilisateur.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await utilisateur.click(screen.getByRole('button', { name: 'Retirer de DoraBase…' }))

    // **Le compte vient de l'état réel des onglets**, pas d'une valeur injectée : c'est ce calcul
    // qui décide si l'utilisateur est averti d'une perte, et une prop de test ne l'exerce pas.
    expect(screen.getByRole('dialog', { name: /Retirer analytics/ })).toHaveTextContent(
      '1 modification en attente sera perdue',
    )
  })

  it('retirer la base efface aussi ses modifications en attente', async () => {
    const utilisateur = userEvent.setup()
    monter({ onDelete: async () => ({ leftoverSecrets: [] }) })
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)
    expect(screen.getByLabelText('Modifications en attente de la table')).toBeInTheDocument()

    await utilisateur.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await utilisateur.click(screen.getByRole('button', { name: 'Retirer de DoraBase…' }))
    await utilisateur.click(screen.getByRole('button', { name: 'Retirer la connexion' }))

    expect(screen.queryByLabelText('Modifications en attente de la table')).not.toBeInTheDocument()

    // **Et elles ne reviennent pas si l'on rouvre le même chemin.** C'est la vraie raison de purger
    // l'état : la disparition du panneau ne prouve rien, l'onglet actif ayant changé. Des
    // modifications fantômes sur une base redéclarée s'appliqueraient à des lignes qu'on n'a jamais
    // vues.
    await utilisateur.click(await screen.findByRole('treeitem', { name: /^orders/ }))
    await screen.findByRole('grid')
    expect(screen.queryByLabelText('Modifications en attente de la table')).not.toBeInTheDocument()
  })

  it('hors production, « Appliquer » écrit sans confirmation intermédiaire', async () => {
    const utilisateur = userEvent.setup()
    const ecrire = vi.fn(async () => ({ applied: 1, inverseSql: 'BEGIN;\nUPDATE …;\nCOMMIT;' }))
    monter({
      projects: PROJETS_DEV,
      passerellePreview: PREVIEW,
      passerelleApply: { applyChanges: ecrire },
    })
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)

    const panneau = await screen.findByLabelText('Modifications en attente de la table')
    await utilisateur.click(within(panneau).getByRole('button', { name: /Appliquer/ }))

    await waitFor(() => expect(ecrire).toHaveBeenCalledOnce())
    // Une confirmation sur chaque écriture de développement se transformerait en clic réflexe, et
    // c'est ainsi qu'une confirmation cesse de protéger quoi que ce soit.
    expect(screen.queryByRole('dialog', { name: /production/i })).not.toBeInTheDocument()
  })

  it('une ligne ajoutée depuis la barre d’outils part en `inserts`, pas en `changes`', async () => {
    const utilisateur = userEvent.setup()
    const ecrire = vi.fn(async () => ({ applied: 1, inverseSql: '' }))
    monter({
      projects: PROJETS_DEV,
      passerellePreview: PREVIEW,
      passerelleApply: { applyChanges: ecrire },
    })
    await ouvrirEtEditer(utilisateur)

    // **Le geste entier, depuis l'écran assemblé** : le bouton de la barre, la saisie dans la
    // grille, puis l'écriture. Un composant vérifié dans sa vitrine peut n'être atteignable
    // nulle part.
    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une ligne' }))
    await utilisateur.click(await screen.findByRole('button', { name: 'Renseigner status' }))
    const champ = screen.getByLabelText('Nouvelle valeur')
    await utilisateur.type(champ, 'pending{Enter}')

    // Le panneau nomme ce qui attend : une ligne ajoutée ne se confond pas avec une modification.
    expect(await screen.findByText('nouvelle ligne 1')).toBeInTheDocument()

    const panneau = await screen.findByLabelText('Modifications en attente de la table')
    await utilisateur.click(within(panneau).getByRole('button', { name: /Appliquer/ }))

    await waitFor(() => expect(ecrire).toHaveBeenCalledOnce())
    const [, plan] = ecrire.mock.calls[0] as unknown as [unknown, UpdatePlan]
    // **Un `INSERT`, aucun `UPDATE`** : une ligne neuve envoyée en `changes` chercherait une ligne
    // à mettre à jour qui n'existe pas, et son `WHERE` ne trouverait rien.
    expect(plan.changes).toHaveLength(0)
    expect(plan.inserts).toHaveLength(1)
    // Et seule la colonne saisie part : les autres restent au défaut de la base.
    expect(plan.inserts[0]?.values).toEqual([{ column: 'status', value: 'pending' }])
  })

  it('le plan envoyé porte la valeur attendue, qui détecte le conflit', async () => {
    const utilisateur = userEvent.setup()
    const ecrire = vi.fn(async () => ({ applied: 1, inverseSql: '' }))
    monter({
      projects: PROJETS_DEV,
      passerellePreview: PREVIEW,
      passerelleApply: { applyChanges: ecrire },
    })
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)
    const panneau = await screen.findByLabelText('Modifications en attente de la table')
    await utilisateur.click(within(panneau).getByRole('button', { name: /Appliquer/ }))

    await waitFor(() => expect(ecrire).toHaveBeenCalled())
    const [, plan] = ecrire.mock.calls[0] as unknown as [unknown, UpdatePlan]
    // **Sans la clé `expected`, le `WHERE` ne détecte aucun conflit** et l'écriture écraserait le
    // travail d'un tiers en silence. C'est la garantie centrale de `11d`, et elle se joue ici.
    //
    // La valeur est `null` dans ce décor, et ce n'est pas un défaut : `created_at` y est nulle, et
    // `null` est une valeur attendue légitime — c'est même le cas que `is not distinct from` existe
    // pour traiter. On vérifie donc que la **clé est présente**, pas qu'elle est renseignée : un
    // `toBeTruthy` aurait exigé le contraire de ce que le décor contient.
    // La colonne modifiée porte `pending` : la valeur attendue est donc **renseignée**, et un code
    // qui cesserait de l'envoyer ferait tomber ce test.
    expect(plan.changes[0]?.expected).toBe('pending')
    expect(plan.keyColumn).toBe('id')
  })

  it('après succès, la grille est relue et les marques disparaissent', async () => {
    const utilisateur = userEvent.setup()
    const ecrire = vi.fn(async () => ({
      applied: 1,
      inverseSql: 'BEGIN;\nUPDATE inverse;\nCOMMIT;',
    }))
    const { lignes, structures } = monter({
      projects: PROJETS_DEV,

      passerellePreview: PREVIEW,
      passerelleApply: { applyChanges: ecrire },
    })
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)
    const readRows = lignes.readRows as unknown as ReturnType<typeof vi.fn>
    const lecturesAvant = readRows.mock.calls.length
    const decrire = structures.describeTable as unknown as ReturnType<typeof vi.fn>
    const structureAvant = decrire.mock.calls.length

    const panneau = await screen.findByLabelText('Modifications en attente de la table')
    await utilisateur.click(within(panneau).getByRole('button', { name: /Appliquer/ }))

    // **La valeur affichée doit venir de la base, pas de la saisie** : un `trigger`, une valeur par
    // défaut ou une troncature rendraient l'écran faux.
    await waitFor(() => expect(readRows.mock.calls.length).toBeGreaterThan(lecturesAvant))
    // Et le modèle vidé fait disparaître toutes les marques de `11b` d'un coup.
    await waitFor(() =>
      expect(within(panneau).queryByText('Modifications en attente')).not.toBeInTheDocument(),
    )
    // À la place, de quoi défaire — et non un panneau vide.
    expect(within(panneau).getByText('Écriture appliquée')).toBeInTheDocument()
    expect(screen.getByText(/SQL qui annule cette écriture/)).toBeInTheDocument()
    // **La structure SQL n'a pas bougé** (`18g`) : seule MongoDB, dont les colonnes sont déduites,
    // la fait relire après une écriture. La relire ici serait l'aller-retour par enregistrement que
    // le commentaire de `relectureStructure` refuse.
    expect(decrire.mock.calls.length).toBe(structureAvant)
  })

  it('sur MongoDB, une écriture réussie relit aussi la structure déduite (`18g`)', async () => {
    const utilisateur = userEvent.setup()
    const ecrire = vi.fn(async () => ({ applied: 1, inverseSql: '' }))
    const { structures } = monter({
      projects: PROJETS_MONGO,
      passerellePreview: PREVIEW,
      passerelleApply: { applyChanges: ecrire },
    })
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)
    const decrire = structures.describeTable as unknown as ReturnType<typeof vi.fn>
    const structureAvant = decrire.mock.calls.length

    const panneau = await screen.findByLabelText('Modifications en attente de la table')
    await utilisateur.click(within(panneau).getByRole('button', { name: /Appliquer/ }))
    await waitFor(() => expect(ecrire).toHaveBeenCalled())

    // **Un champ neuf, introduit par l'écriture, redeviendrait invisible sans cette relecture** :
    // `colonnesEffectives` de `TableView` ne le montrait que tant que la modification était en
    // attente, et l'attente est vidée par `surSucces` juste avant.
    await waitFor(() => expect(decrire.mock.calls.length).toBeGreaterThan(structureAvant))
  })

  it('un refus s’affiche dans le panneau et ne vide pas le modèle', async () => {
    const utilisateur = userEvent.setup()
    monter({
      projects: PROJETS_DEV,

      passerellePreview: PREVIEW,
      passerelleApply: {
        applyChanges: async () => {
          throw new Error('la ligne a changé depuis la lecture')
        },
      },
    })
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)
    const panneau = await screen.findByLabelText('Modifications en attente de la table')
    await utilisateur.click(within(panneau).getByRole('button', { name: /Appliquer/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('changé depuis la lecture')
    // **Les modifications restent** : les perdre sur un conflit obligerait à tout retaper, alors que
    // rien n'a été écrit.
    expect(screen.getByLabelText('Modifications en attente de la table')).toBeInTheDocument()
  })

  it('en production, « Appliquer » demande une confirmation et n’écrit pas encore', async () => {
    const utilisateur = userEvent.setup()
    const ecrire = vi.fn(async () => ({ applied: 1, inverseSql: '' }))
    // Le décor par défaut est en `prod` : c'est le cas qui compte ici.
    monter({ passerellePreview: PREVIEW, passerelleApply: { applyChanges: ecrire } })
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)

    const panneau = await screen.findByLabelText('Modifications en attente de la table')
    await utilisateur.click(within(panneau).getByRole('button', { name: /Appliquer/ }))

    // **Rien n'est parti.** C'est le garde-fou central de `11d`, et aucun test ne le couvrait : le
    // désactiver laissait la suite entièrement verte.
    expect(ecrire).not.toHaveBeenCalled()
    const confirmation = screen.getByRole('dialog', { name: 'Écrire en production' })
    // Elle **récapitule** au lieu de demander « êtes-vous sûr ? » : c'est ce qui permet de
    // s'apercevoir qu'on s'est trompé de table, ou qu'on touche vingt lignes au lieu d'une.
    expect(confirmation).toHaveTextContent('public.orders')
    expect(confirmation).toHaveTextContent('status')
    expect(confirmation).toHaveTextContent('1 UPDATE')
  })

  it('la confirmation de production écrit, et l’annuler n’écrit rien', async () => {
    const utilisateur = userEvent.setup()
    const ecrire = vi.fn(async () => ({ applied: 1, inverseSql: '' }))
    monter({ passerellePreview: PREVIEW, passerelleApply: { applyChanges: ecrire } })
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)
    const panneau = await screen.findByLabelText('Modifications en attente de la table')

    await utilisateur.click(within(panneau).getByRole('button', { name: /Appliquer/ }))
    await utilisateur.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(ecrire).not.toHaveBeenCalled()
    // Les modifications survivent au renoncement : rien n'a été écrit, rien n'a été perdu.
    expect(screen.getByLabelText('Modifications en attente de la table')).toBeInTheDocument()

    await utilisateur.click(within(panneau).getByRole('button', { name: /Appliquer/ }))
    await utilisateur.click(screen.getByRole('button', { name: 'Écrire en production' }))
    await waitFor(() => expect(ecrire).toHaveBeenCalledOnce())
  })

  it('⌘E bascule, et le rappel de la barre d’état suit', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /^orders/ }))
    await screen.findByRole('grid')

    // `10c` avait retiré ce rappel faute d'écran qui y réponde ; il répond maintenant.
    expect(screen.getByRole('status', { name: 'État de la table' })).toHaveTextContent(
      `${raccourci('E')} pour éditer`,
    )
    expect(screen.queryByRole('button', { name: /Modifier/ })).not.toBeInTheDocument()

    await utilisateur.keyboard(auModificateur('e'))
    expect(screen.getByRole('status', { name: 'État de la table' })).toHaveTextContent('édition')
    expect(screen.getAllByRole('button', { name: /Modifier/ }).length).toBeGreaterThan(0)
  })

  it('sans modification, aucun panneau des modifications en attente', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirEtEditer(utilisateur)
    // Un panneau à « 0 modification » n'aurait rien à montrer.
    expect(screen.queryByLabelText('Modifications en attente de la table')).not.toBeInTheDocument()
  })

  it('les trois affichages du compte suivent le même modèle', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)

    // 1. la barre d'état
    expect(await screen.findByRole('status', { name: 'État de la table' })).toHaveTextContent(
      '1 modification en attente',
    )
    // 2. le badge de l'indicateur de la barre de titre — **du texte, plus un bouton** : la pastille
    //    projet était un `<button>`, l'indicateur de `25b` n'a rien de focalisable.
    expect(screen.getByText('Édition')).toBeInTheDocument()
    // 3. la pastille de l'arbre, à la place du compte de lignes
    const ligne = screen.getByRole('treeitem', { name: /^orders/ })
    expect(ligne).toHaveTextContent('1')
  })

  it('⌘Z retire la modification, et les trois affichages suivent', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)
    await screen.findByLabelText('Modifications en attente de la table')

    await utilisateur.keyboard(auModificateur('z'))

    // Un compteur tenu à part divergerait ici.
    await waitFor(() =>
      expect(
        screen.queryByLabelText('Modifications en attente de la table'),
      ).not.toBeInTheDocument(),
    )
    expect(screen.queryByText('Édition')).not.toBeInTheDocument()
  })

  it('« Tout annuler » vide le modèle', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)
    const panneau = await screen.findByLabelText('Modifications en attente de la table')

    await utilisateur.click(within(panneau).getByRole('button', { name: 'Tout annuler' }))

    await waitFor(() =>
      expect(
        screen.queryByLabelText('Modifications en attente de la table'),
      ).not.toBeInTheDocument(),
    )
  })

  it('quitter le mode édition **garde** les modifications en attente', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)
    await screen.findByLabelText('Modifications en attente de la table')

    await utilisateur.keyboard(auModificateur('e'))

    // Les perdre sur une frappe serait le défaut qu'`esc` fermant une modale pleine a produit.
    expect(screen.getByLabelText('Modifications en attente de la table')).toBeInTheDocument()
    // Mais plus aucune cellule ne s'ouvre.
    expect(screen.queryByRole('button', { name: /Modifier/ })).not.toBeInTheDocument()
  })

  it('la colonne modifiée est annotée dans la sidebar', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)

    const section = (await screen.findByText('Colonnes de orders')).parentElement as HTMLElement
    // « modifié » prime sur le type et sur « tri ↓ » : c'est l'état qui attend une action.
    await waitFor(() => expect(within(section).getByText('modifié')).toBeInTheDocument())
  })

  it('le mode est par onglet : basculer l’un ne bascule pas l’autre', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirEtEditer(utilisateur)
    expect(screen.getAllByRole('button', { name: /Modifier/ }).length).toBeGreaterThan(0)

    // Ouvrir un second onglet : il n'a aucune raison d'être en édition.
    await utilisateur.click(screen.getByRole('treeitem', { name: /order_items/ }))
    await screen.findByRole('grid')
    expect(screen.queryByRole('button', { name: /Modifier/ })).not.toBeInTheDocument()
  })

  it('retirer une base ferme ses onglets, et seulement les siens', async () => {
    const utilisateur = userEvent.setup()
    monter({ onDelete: async () => ({ leftoverSecrets: [] }) })
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /^orders/ }))
    await utilisateur.click(await screen.findByRole('treeitem', { name: /order_items/ }))
    expect(screen.getAllByRole('tab')).toHaveLength(2)

    await utilisateur.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await utilisateur.click(screen.getByRole('button', { name: 'Retirer de DoraBase…' }))
    await utilisateur.click(screen.getByRole('button', { name: 'Retirer la connexion' }))

    // **Un onglet survivant lirait une base dont la déclaration est partie** : au mieux une erreur,
    // au pire une lecture sur une connexion que le registre ne sait plus nommer.
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })

  it('annuler la confirmation ne ferme aucun onglet', async () => {
    const utilisateur = userEvent.setup()
    monter({ onDelete: async () => ({ leftoverSecrets: [] }) })
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /^orders/ }))

    await utilisateur.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await utilisateur.click(screen.getByRole('button', { name: 'Retirer de DoraBase…' }))
    await utilisateur.click(screen.getByRole('button', { name: 'Annuler' }))

    // Annuler ne ferme rien : la confirmation est la dernière chance de renoncer.
    expect(screen.getAllByRole('tab')).toHaveLength(1)
  })
})

/**
 * Le renommage d'une connexion, vu de l'écran de travail (`26`).
 *
 * Ce que le cœur garantit — la migration du secret, le refus d'un doublon — est testé dans
 * `enregistrer.rs`. Ce qui se mesure **ici** est ce que seul cet écran peut faire : les onglets
 * ouverts, et les tables indexées par leur identité, qui portent le nom de la connexion.
 */
describe('renommer une connexion (`26`)', () => {
  /** Applique le renommage à l'état, comme la commande réelle rend les projets à jour. */
  function pilote(projets?: Project[]) {
    const renommer = vi.fn(async () => ({ missingSecrets: [], leftoverSecrets: [] }))
    // `projects` n'est **pas** passé à vide : `monter` répand ses arguments après son propre
    // `projects`, donc un `undefined` explicite écraserait le décor par défaut.
    monter({
      ...(projets === undefined ? {} : { projects: projets }),
      passerelleExecution: PASSERELLE_SQL,
      onRenameDatabase: renommer,
    })
    return renommer
  }

  async function renommerAnalytics(
    utilisateur: ReturnType<typeof userEvent.setup>,
    nouveau: string,
  ) {
    await utilisateur.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await utilisateur.click(screen.getByRole('button', { name: 'Renommer…' }))
    const champ = screen.getByLabelText('Nouveau nom de analytics')
    await utilisateur.clear(champ)
    await utilisateur.type(champ, `${nouveau}{Enter}`)
  }

  it('l’onglet de table reste ouvert et actif', async () => {
    const utilisateur = userEvent.setup()
    const renommer = pilote()
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /^orders/ }))

    await renommerAnalytics(utilisateur, 'entrepot')

    expect(renommer).toHaveBeenCalledWith('Atelier Nord', 'analytics', 'prod', 'entrepot')
    // **Ils suivent, ils ne se ferment pas** — c'est ce qui distingue un renommage d'un retrait
    // (`08j`). Les fermer ferait perdre la place de l'utilisateur pour une correction de libellé.
    const onglet = await screen.findByRole('tab', { name: /orders/ })
    expect(onglet).toHaveAttribute('aria-selected', 'true')
  })

  it('le texte de la console ouverte survit au renommage', async () => {
    const utilisateur = userEvent.setup()
    pilote(avecConsole('CA par jour', 'select 42'))
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /CA par jour/ }))
    expect(document.querySelector('.cm-content')?.textContent).toContain('select 42')

    await renommerAnalytics(utilisateur, 'entrepot')

    // **La table des textes est indexée par identité d'onglet**, laquelle contient le nom de la
    // connexion : sans réindexation, l'éditeur se retrouve devant une clé qui n'existe plus et
    // s'affiche vide — un renommage qui a l'air d'avoir effacé le travail en cours.
    await waitFor(() =>
      expect(document.querySelector('.cm-content')?.textContent).toContain('select 42'),
    )
  })

  it('le résultat de la console ouverte survit au renommage', async () => {
    const utilisateur = userEvent.setup()
    pilote(avecConsole('CA par jour', 'select 42'))
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /CA par jour/ }))
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))
    expect(await screen.findByRole('columnheader', { name: 'n' })).toBeInTheDocument()

    await renommerAnalytics(utilisateur, 'entrepot')

    // Même raison que pour le texte : l'identité d'onglet porte le nom de la connexion, et le
    // résultat laissé sous l'ancienne clé donnerait une grille disparue sur un renommage.
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'n' })).toBeInTheDocument())
  })
})

/**
 * Le cache des structures, vu de l'écran.
 *
 * L'ordonnancement de la file est testé dans `useStructures.test.tsx`, où une passerelle lente se
 * fabrique. Ce qui se mesure **ici** est ce que le cache change pour l'utilisateur : ouvrir une table
 * préchauffée ne redemande rien.
 */
describe('les structures en mémoire', () => {
  it('le préchauffage part quand la connexion s’ouvre, sur les schémas listés', async () => {
    const utilisateur = userEvent.setup()
    const { structures, passerelle } = monter()
    await ouvrirLesEnvironnements(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /analytics/ }))

    await waitFor(() => expect(passerelle.listSchemas).toHaveBeenCalled())
    // La cascade prend la suite de `list_schemas`, sans qu'aucun schéma soit déplié.
    await waitFor(() => expect(structures.listObjects).toHaveBeenCalled())
    await waitFor(() => expect(structures.describeTable).toHaveBeenCalled())
  })

  it('ouvrir une table préchauffée ne redemande pas sa structure', async () => {
    const utilisateur = userEvent.setup()
    const { detail, structures } = monter()
    await ouvrirLesEnvironnements(utilisateur)
    await utilisateur.dblClick(await screen.findByRole('treeitem', { name: /analytics/ }))
    // Le préchauffage a fini : les deux tables du décor sont en mémoire.
    await waitFor(() => expect(structures.describeTable).toHaveBeenCalledTimes(2))
    const avant = vi.mocked(detail.describeTable).mock.calls.length

    await utilisateur.dblClick(await screen.findByRole('treeitem', { name: 'public' }))
    await utilisateur.click(await screen.findByRole('treeitem', { name: /^orders/ }))
    expect(await screen.findByRole('tab', { name: /orders/ })).toBeInTheDocument()

    // **Aucun aller-retour de plus**, et c'est toute la promesse du cache : le panneau lit la
    // mémoire. Le compte est celui du préchauffage, qui passe par la même commande.
    expect(vi.mocked(detail.describeTable).mock.calls.length).toBe(avant)
  })

  it('déplier un schéma préchauffe ses tables, sans relister ce que l’arbre a déjà lu', async () => {
    const utilisateur = userEvent.setup()
    const { structures, passerelle } = monter()
    await ouvrirLesEnvironnements(utilisateur)
    await utilisateur.dblClick(await screen.findByRole('treeitem', { name: /analytics/ }))
    await waitFor(() => expect(structures.describeTable).toHaveBeenCalled())
    const listesAvant = vi.mocked(structures.listObjects).mock.calls.length

    await utilisateur.dblClick(await screen.findByRole('treeitem', { name: 'public' }))

    // L'arbre a listé les objets pour les afficher (`passerelle.listObjects`) ; le préchauffage les
    // reçoit et n'en redemande pas (`structures.listObjects` ne bouge pas). Sans ce passage de
    // relais, le dépliage paierait deux fois la même requête.
    await waitFor(() => expect(passerelle.listObjects).toHaveBeenCalled())
    expect(vi.mocked(structures.listObjects).mock.calls.length).toBe(listesAvant)
  })

  it('« Rafraîchir l’arborescence » vide les structures : la suivante est redemandée', async () => {
    const utilisateur = userEvent.setup()
    const { structures } = monter()
    await ouvrirLesEnvironnements(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /analytics/ }))
    await waitFor(() => expect(structures.describeTable).toHaveBeenCalledTimes(2))

    await utilisateur.click(screen.getByRole('button', { name: 'Actions de Atelier Nord' }))
    await utilisateur.click(screen.getByRole('button', { name: /Rafraîchir l’arborescence/ }))

    // **Le geste replie tout** : `rafraichir` vide le cache d'arbre *et* les dépliages, donc il faut
    // refaire le chemin. Sans le vidage des structures, la cascade suivante n'aurait rien redemandé —
    // « rafraîchir » aurait laissé les structures d'hier en mémoire, la moitié de l'écran à jour et
    // l'autre non.
    await ouvrirLesEnvironnements(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /analytics/ }))
    await waitFor(() => expect(structures.describeTable).toHaveBeenCalledTimes(4))
  })
})

/**
 * Le diagramme de schéma (3 septembre 2026), **depuis l'écran assemblé**.
 *
 * `DiagramView.test.tsx` mesure la vue montée à la main, `disposition.test.ts` la géométrie en pur.
 * Ni l'un ni l'autre ne dit que l'écran de travail sait ouvrir cet onglet, lui donner les
 * structures, et monter sa barre d'état : c'est le trou de la règle n° 8 — « un composant vérifié
 * pièce par pièce n'est pas un écran livré ».
 */
describe('le diagramme de schéma', () => {
  /**
   * Un décor où **les deux tables sont décrites sous leur propre nom**, et reliées.
   *
   * Le décor par défaut de ce fichier rend `DETAIL` — nommée `orders` — pour n'importe quelle table
   * demandée. C'est indifférent au panneau de détail, qui n'en regarde qu'une à la fois, et mortel
   * ici : le diagramme identifie ses boîtes par le nom que le **moteur** rend, parce que c'est ce
   * nom que les relations emploient pour désigner leur cible. Les deux tables se confondaient donc
   * en une seule boîte (règle n° 5).
   *
   * **Les noms sont ceux que la passerelle de l'arbre liste** — `orders` et `order_items` — et non
   * une paire choisie ici. C'est ce qui a fait échouer la première version de ce décor : il
   * décrivait `users`, que `listObjects` ne rend jamais, donc le diagramme n'en demandait jamais la
   * structure et la seconde boîte n'existait pas. Un double doit répondre aux appels que la
   * production fait, pas à ceux qu'on avait en tête (règle n° 19).
   */
  const ORDER_ITEMS: TableDetail = {
    ...DETAIL,
    name: 'order_items',
    columns: [
      { ...(DETAIL.columns[0] as (typeof DETAIL.columns)[number]) },
      {
        position: 2,
        name: 'order_id',
        typeName: 'int8',
        category: 'number',
        nullable: false,
        default: null,
        identity: null,
        key: 'foreign',
        comment: null,
        frequency: null,
      },
    ],
    relations: [
      {
        constraintName: 'order_items_order_id_fkey',
        direction: 'outgoing',
        cardinality: 'many',
        columns: ['order_id'],
        targetSchema: 'public',
        targetTable: 'orders',
        targetColumns: ['id'],
      },
    ],
  }
  const decor = (): PasserelleStructures => {
    const describeTable = vi.fn(async (_cle: DatabaseKey, _schema: string, table: string) =>
      table === 'order_items' ? ORDER_ITEMS : DETAIL,
    )
    return {
      listObjects: vi.fn(async () => [objet('orders'), objet('order_items')]),
      describeTable,
      // **C'est ce pont que le diagramme emploie**, et non `describeTable` : le décor le fournit
      // donc en propre, pour qu'un test puisse constater le chemin plutôt que le supposer.
      describeTables: vi.fn(grouperParBoucle(describeTable)),
    }
  }

  /** Déplie l'arbre jusqu'au schéma, puis ouvre son diagramme depuis le menu de sa ligne. */
  async function ouvrirLeDiagramme(utilisateur: ReturnType<typeof userEvent.setup>) {
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.click(screen.getByRole('button', { name: 'Actions de public' }))
    await utilisateur.click(screen.getByRole('button', { name: 'Diagramme du schéma' }))
  }

  it('s’ouvre depuis le menu d’un schéma, dans un onglet nommé par ce schéma', async () => {
    const utilisateur = userEvent.setup()
    monter({ passerelleStructures: decor() })
    await ouvrirLeDiagramme(utilisateur)

    // L'onglet porte le nom du **schéma** : c'est de lui que le diagramme parle, et l'icône le
    // distingue d'un onglet de table comme elle distingue une console.
    expect(screen.getByRole('tab', { name: /public/ })).toHaveAttribute('aria-selected', 'true')
    // Les deux tables du schéma, chacune dans sa boîte — donc décrites sous leur propre nom.
    //
    // **Deux attentes, et non une lecture sèche après la première** (règle n° 15) : les structures
    // arrivent **une par une**, `orders` avant `users` par l'ordre alphabétique. Un `getByRole` sur
    // la seconde juste après avoir attendu la première mesurerait l'instant d'avant sa réponse — et
    // passerait sur cette machine pour échouer sur un runner chargé.
    expect(await screen.findByRole('button', { name: /^orders · 3 colonnes/ })).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: /^order_items · 2 colonnes/ }),
    ).toBeInTheDocument()
  })

  it('monte sa barre d’état au niveau de l’écran, et y compte ses liens', async () => {
    const utilisateur = userEvent.setup()
    monter({ passerelleStructures: decor() })
    await ouvrirLeDiagramme(utilisateur)

    // **Sous les trois colonnes**, comme celle de la structure : la barre d'état vit au niveau de
    // l'écran, pas du centre.
    const pied = await screen.findByRole('status', { name: 'Résumé du diagramme' })
    // **« 2 tables » n'arrive qu'une fois les deux structures lues** : avant, la barre dit
    // honnêtement « 1 / 2 tables lues ». C'est l'attente qui date la mesure du bon instant.
    await waitFor(() => expect(pied).toHaveTextContent('2 tables'))
    await waitFor(() => expect(pied).toHaveTextContent('1 lien'))
  })

  it('survit à l’ouverture d’une table, parce qu’il parle du schéma et non d’elle', async () => {
    const utilisateur = userEvent.setup()
    monter({ passerelleStructures: decor() })
    await ouvrirLeDiagramme(utilisateur)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^orders ·/ })).toBeInTheDocument(),
    )

    // **C'est toute la raison d'un onglet plutôt qu'une troisième valeur de `VueObjet`** : le
    // couple « Données / Structure » est un état de la table ouverte et disparaît avec elle, là où
    // un diagramme reste ouvert pendant qu'on parcourt les tables qu'il montre.
    await utilisateur.dblClick(screen.getByRole('button', { name: /^orders ·/ }))
    expect(screen.getByRole('tab', { name: /^orders/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /public/ })).toBeInTheDocument()

    await utilisateur.click(screen.getByRole('tab', { name: /public/ }))
    expect(await screen.findByRole('button', { name: /^order_items ·/ })).toBeInTheDocument()
  })

  it('n’ouvre qu’un diagramme par schéma', async () => {
    const utilisateur = userEvent.setup()
    monter({ passerelleStructures: decor() })
    await ouvrirLeDiagramme(utilisateur)
    await utilisateur.click(screen.getByRole('button', { name: 'Actions de public' }))
    await utilisateur.click(screen.getByRole('button', { name: 'Diagramme du schéma' }))

    // Deux diagrammes du même schéma montreraient le même dessin, avec deux échelles et deux
    // sélections qui divergeraient. C'est la règle d'`ouvrir`, pas celle d'`ouvrirConsole`.
    expect(screen.getAllByRole('tab', { name: /public/ })).toHaveLength(1)
  })

  it('occupe toute la largeur : aucun panneau droit à côté du dessin', async () => {
    const utilisateur = userEvent.setup()
    monter({ passerelleStructures: decor() })
    await ouvrirLeDiagramme(utilisateur)
    expect(await screen.findByRole('button', { name: /^orders ·/ })).toBeInTheDocument()

    /*
     * **La sonde est la colonne elle-même**, et c'est un correctif : la première version cherchait
     * l'absence du couple « Données / Structure », qui est absent de toute façon dès qu'aucune table
     * n'est ouverte (`vue={table ? vue : undefined}`). Elle restait donc verte avec le diagramme
     * *dans* le partage — vert sous sabotage, donc à réécrire (règle n° 1).
     *
     * Le panneau droit proposerait ici la ligne sélectionnée d'une grille qui n'existe pas, et un
     * dessin est ce qui profite le plus de la largeur qu'on lui laisse.
     */
    expect(screen.queryByTestId('colonne-droite')).not.toBeInTheDocument()

    // Le contrôle positif : la colonne existe bel et bien sur l'onglet d'une table, sinon ce test
    // passerait aussi sur un écran qui ne la monterait jamais.
    await utilisateur.dblClick(screen.getByRole('button', { name: /^orders ·/ }))
    expect(screen.getByTestId('colonne-droite')).toBeInTheDocument()
  })
})

/**
 * Le gestionnaire de schémas, **depuis l'écran de travail** (`API-33`).
 *
 * `SchemaManager.test.tsx` mesure la modale montée seule ; ce qu'elle ne peut pas prouver est
 * qu'elle est **branchée** — que l'entrée du menu de l'arbre l'ouvre, et que ce qu'elle enregistre
 * redessine l'arbre. C'est la règle n° 8 : un composant juste dans sa vitrine ne prouve rien de
 * l'assemblage, et c'est ainsi que l'engrenage d'`A1` n'ouvrait rien pendant des semaines.
 */
describe('le gestionnaire de schémas', () => {
  /** Une passerelle d'écriture qui enregistre ce qu'on lui a demandé. */
  function passerelleSchemas() {
    const vus: { crees: string[]; enregistres: readonly string[][] } = {
      crees: [],
      enregistres: [],
    }
    return {
      vus,
      passerelle: {
        createSchema: vi.fn(async (_cle: unknown, nom: string) => {
          vus.crees.push(nom)
        }),
        saveVisibleSchemas: vi.fn(async (requete: { schemas: string[] }) => {
          vus.enregistres = [...vus.enregistres, requete.schemas]
          return PROJETS
        }),
      } as unknown as Parameters<typeof Workbench>[0]['passerelleSchemas'],
    }
  }

  /**
   * Une passerelle d'arbre qui **refuse de lire une connexion fermée**, comme le fait le registre.
   *
   * Sans ce refus, le test qui suit resterait vert même si la modale lisait sans attendre
   * l'ouverture : le double répond tout de suite, donc la course n'existe pas dans le décor
   * (règle n° 1). C'est le décor qui rend la propriété observable, pas l'assertion.
   */
  function passerelleQuiExigeLOuverture() {
    const ouvertes = new Set<string>()
    const identite = (cle: DatabaseKey) => `${cle.project}/${cle.environment}/${cle.database}`
    const state = {
      kind: 'connected' as const,
      serverVersion: 'PostgreSQL 17.6',
      tunnelLocalPort: null,
    }
    return {
      openDatabase: vi.fn(async (cle: DatabaseKey) => {
        /* **L'ouverture ne s'achève pas dans le tour synchrone de son appel**, et sans cela le test
           reste vert sous sabotage : le corps d'une fonction `async` court jusqu'à son premier
           `await`, donc un double qui inscrirait la connexion avant celui-ci la rendrait ouverte
           *pendant* l'appel — et lire sans l'attendre marcherait. C'est la leçon du double qui tient
           ses réponses à la main : un double qui répond tout de suite ne mesure rien. */
        await Promise.resolve()
        ouvertes.add(identite(cle))
        return state
      }),
      closeDatabase: vi.fn(async (cle: DatabaseKey) => void ouvertes.delete(identite(cle))),
      connectionStates: vi.fn(async () =>
        [...ouvertes].map((id) => {
          const [project, environment, database] = id.split('/')
          return {
            key: { project, database, environment } as DatabaseKey,
            state,
          } as ConnectionStateEntry
        }),
      ),
      listSchemas: vi.fn(async (cle: DatabaseKey) => {
        if (!ouvertes.has(identite(cle))) {
          throw `aucune connexion ouverte pour ${identite(cle)}`
        }
        return SCHEMAS
      }),
      listObjects: vi.fn(async () => [objet('orders'), objet('order_items')]),
      // **Nécessaire malgré le transtypage**, et c'est lui qui l'a rendu nécessaire : `as unknown
      // as` désarme le contrôle du compilateur, donc l'absence d'un membre de la passerelle ne se
      // voit qu'à l'exécution. Ici l'arbre s'abonne au montage, et le manque faisait tomber le test
      // sur « surEchecDeCommande is not a function ».
      surEchecDeCommande: () => () => {},
    } as unknown as PasserelleArbre
  }

  it('« Gérer les schémas… » ouvre la modale sur la connexion cliquée, et l’ouvre', async () => {
    const utilisateur = userEvent.setup()
    const { passerelle } = passerelleSchemas()
    monter({ passerelleSchemas: passerelle, passerelle: passerelleQuiExigeLOuverture() })
    await ouvrirLesEnvironnements(utilisateur)

    await utilisateur.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await utilisateur.click(screen.getByRole('button', { name: 'Gérer les schémas…' }))

    const modale = await screen.findByRole('dialog', { name: 'Gérer les schémas' })
    // Le cadre nomme la connexion cliquée, pas la première du décor — `shop` est sa voisine.
    expect(modale).toHaveTextContent('analytics')
    /* Et la lecture a répondu : c'est ce qui prouve que la connexion a été **ouverte et attendue**
       avant d'être lue, la ligne de la base n'ayant jamais été dépliée. Le menu d'une connexion est
       atteignable dès que son environnement est déplié, donc ce chemin-là arrive sur une connexion
       fermée — et la passerelle du décor refuse alors la lecture, comme le registre. */
    expect(
      await screen.findByRole('switch', { name: 'Afficher public dans l’arbre' }),
    ).toBeInTheDocument()
  })

  it('ce qu’il enregistre redessine l’arbre', async () => {
    const utilisateur = userEvent.setup()
    const { passerelle, vus } = passerelleSchemas()
    monter({ passerelleSchemas: passerelle })
    await ouvrirLesEnvironnements(utilisateur)
    // La ligne de la base est dépliée : c'est ce qui met ses schémas en cache, donc ce qui rend le
    // redessin observable.
    await utilisateur.dblClick(await screen.findByRole('treeitem', { name: /analytics/ }))
    expect(await screen.findByRole('treeitem', { name: 'public' })).toBeInTheDocument()

    await utilisateur.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await utilisateur.click(screen.getByRole('button', { name: 'Gérer les schémas…' }))
    await utilisateur.click(
      await screen.findByRole('switch', { name: 'Afficher public dans l’arbre' }),
    )
    await utilisateur.click(screen.getByRole('button', { name: /Enregistrer/ }))

    // La préférence part avec l'identité complète de la connexion, environnement compris (`23b`).
    expect(vus.enregistres).toEqual([[]])
    // **Et l'arbre suit sans « Rafraîchir »** : le cache tient la liste filtrée, donc il fallait le
    // relire. Sans cela, décocher un schéma n'aurait eu aucun effet visible jusqu'au prochain
    // rafraîchissement de l'arborescence, qui replie tout.
    await waitFor(() => expect(screen.queryByRole('treeitem', { name: 'public' })).toBeNull())
  })

  it('la création part sur la base, sans passer par « Enregistrer »', async () => {
    const utilisateur = userEvent.setup()
    const { passerelle, vus } = passerelleSchemas()
    monter({ passerelleSchemas: passerelle })
    await ouvrirLesEnvironnements(utilisateur)

    await utilisateur.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await utilisateur.click(screen.getByRole('button', { name: 'Gérer les schémas…' }))
    await screen.findByRole('switch', { name: 'Afficher public dans l’arbre' })
    await utilisateur.type(screen.getByLabelText('Créer un schéma'), 'reporting')
    await utilisateur.click(screen.getByRole('button', { name: 'Créer' }))

    // Les deux temps : la création est partie, la préférence n'a rien reçu.
    await waitFor(() => expect(vus.crees).toEqual(['reporting']))
    expect(vus.enregistres).toEqual([])
  })
})

/**
 * La transaction manuelle d'une console, **depuis l'écran de travail** (`API-38`).
 *
 * `TransactionPanel.test.tsx` mesure le panneau monté seul, et `ConsoleView.test.tsx` la bascule de
 * la barre d'outils. Ce qu'aucun des deux ne peut prouver est qu'ils sont **branchés** : que la
 * bascule fait paraître le panneau, que l'exécution part avec le mode, que ce que le journal rend
 * s'affiche, et qu'une validation appelle la commande avec la bonne connexion. C'est la règle n° 8,
 * celle qui a laissé l'engrenage d'`A1` n'ouvrir rien pendant des semaines.
 */
describe('la transaction manuelle de la console', () => {
  /**
   * Un journal de transaction qui se comporte comme celui du registre.
   *
   * **Mémoïsé par construction** — c'est un objet créé une fois par test : une passerelle
   * reconstruite à chaque rendu relancerait la lecture du journal, le piège de `10d`.
   */
  function passerelleTransactionFactice() {
    const vus = {
      lectures: [] as DatabaseKey[],
      valides: [] as DatabaseKey[],
      annules: [] as DatabaseKey[],
    }
    /**
     * **Un journal par console**, comme le cœur tient une session par console (`API-38`).
     *
     * Un décor qui les mettrait en commun ferait passer le test là où l'application isole, et
     * l'écart ne se verrait nulle part (règle n° 5 — ce que le décor rend indiscernable, aucune
     * assertion ne le rattrape).
     */
    let journaux: Record<string, { rendue: TransactionStatement; reponse: QueryResult | null }[]> =
      {}
    return {
      vus,
      /** Ce que le Rust fait en mode manuel : inscrire l'instruction dans la transaction. */
      inscrire(console: string, rendue: TransactionStatement, reponse: QueryResult | null = null) {
        journaux = { ...journaux, [console]: [...(journaux[console] ?? []), { rendue, reponse }] }
      },
      /** Vrai quand **cette console** tient une transaction — la règle du registre, dans `runSql`. */
      ouverte: (console: string) => (journaux[console]?.length ?? 0) > 0,
      passerelle: {
        transactionState: async (cle: DatabaseKey, console: string) => {
          vus.lectures.push(cle)
          // Comme le registre : les réponses restent ici, seuls les comptes voyagent.
          const journal = journaux[console] ?? []
          return {
            open: journal.length > 0,
            statements: journal.map((e) => e.rendue),
            // Le décor n'échoue pas : `aborted` a son test au niveau du panneau, où l'écart entre
            // les moteurs se lit sans base réelle.
            aborted: false,
          }
        },
        transactionResult: async (_cle: DatabaseKey, console: string, rang: number) => {
          const reponse = journaux[console]?.[rang]?.reponse
          if (!reponse) throw new Error('cette instruction n’a rendu aucune ligne.')
          return reponse
        },
        commitTransaction: async (cle: DatabaseKey, console: string) => {
          vus.valides.push(cle)
          journaux = { ...journaux, [console]: [] }
        },
        rollbackTransaction: async (cle: DatabaseKey, console: string) => {
          vus.annules.push(cle)
          journaux = { ...journaux, [console]: [] }
        },
      },
    }
  }

  /** Le décor complet : une console ouverte, un journal, et le mode que l'exécution reçoit. */
  async function ouvrirUneConsoleAvecTransaction(
    utilisateur: ReturnType<typeof userEvent.setup>,
    options: { projects?: Project[] } = {},
  ) {
    const factice = passerelleTransactionFactice()
    const modes: TransactionMode[] = []
    monter({
      ...options,
      /**
       * **Une écriture de console qui ne touche pas au décor**, et c'est ce qui rend ces tests
       * concluants. Le harnais réécrit `projets` à chaque frappe enregistrée ; or `projects` est le
       * témoin de configuration de `useTransaction`, donc le journal serait relu pour une raison
       * qui n'a rien à voir avec l'exécution — et le test resterait vert en retirant la relecture
       * qui la suit (constaté par sabotage, règle n° 1).
       */
      onSaveConsole: async () => {},
      passerelleTransaction: factice.passerelle,
      passerelleExecution: {
        runSql: async (_cle, sql, _limite, mode, console) => {
          modes.push(mode)
          // **Le décor distingue une écriture d'une lecture, et jusque dans sa réponse** : sans
          // cela la grille garderait des colonnes après un `delete`, et le test qui désigne une
          // lecture ne mesurerait rien (règle n° 5 — un décor trop régulier ne mesure que le décor).
          const ecrit = !/^\s*select\b/i.test(sql)
          const reponse: QueryResult = ecrit
            ? { ...RESULTAT, sql, columns: [], rows: [], affected: 3 }
            : { ...RESULTAT, sql, columns: ['n'], rows: [[{ kind: 'int', value: 41 }]] }
          // Le pendant du registre : le mode choisit la **session**, et une console qui tient déjà
          // la sienne y reste — même repassée en `auto`. Une console voisine, elle, n'y entre
          // jamais : c'est ce que la session par console garantit.
          if (mode === 'manual' || factice.ouverte(console)) {
            factice.inscrire(
              console,
              {
                sql,
                durationMs: 7,
                returned: reponse.rows.length,
                affected: reponse.affected,
                displayable: reponse.rows.length > 0,
                error: null,
              },
              reponse.rows.length > 0 ? reponse : null,
            )
          }
          return reponse
        },
      },
    })
    await ouvrirUneConsole(utilisateur)
    return { ...factice, modes }
  }

  it('en mode automatique, aucun panneau et aucune lecture de journal', async () => {
    const utilisateur = userEvent.setup()
    const { vus, modes } = await ouvrirUneConsoleAvecTransaction(utilisateur)
    await saisir(utilisateur, 'select 1')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))

    await waitFor(() => expect(modes).toEqual(['auto']))
    // **Rien ne part avant qu'on le demande** : en `auto`, la console occupe toute la largeur du
    // centre comme avant, et aucune commande de transaction n'est appelée.
    expect(screen.queryByRole('complementary', { name: 'Transaction en cours' })).toBeNull()
    expect(vus.lectures).toEqual([])
  })

  it('la bascule fait paraître le panneau, et l’exécution part en mode manuel', async () => {
    const utilisateur = userEvent.setup()
    const { modes } = await ouvrirUneConsoleAvecTransaction(utilisateur)

    await utilisateur.click(screen.getByRole('switch', { name: 'Transaction manuelle' }))
    // **Le nerf du test** : le panneau est branché à l'écran, pas seulement juste dans sa vitrine.
    const panneau = await screen.findByRole('complementary', { name: 'Transaction en cours' })
    expect(panneau).toHaveTextContent(/Rien n’est encore retenu/)

    await saisir(utilisateur, 'update commandes set statut = 1')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))

    // **Aucune confirmation ici** (`API-38`) : la requête n'écrit rien, elle entre dans la
    // transaction — c'est la validation qui porte la question. Confirmer les deux ferait cliquer
    // deux fois pour un seul engagement.
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(modes).toEqual(['manual']))
    await waitFor(() => expect(panneau).toHaveTextContent('3 lignes touchées'))
  })

  it('une modification de structure garde sa confirmation, et le rappel dit pourquoi', async () => {
    const utilisateur = userEvent.setup()
    const { modes } = await ouvrirUneConsoleAvecTransaction(utilisateur)
    await utilisateur.click(screen.getByRole('switch', { name: 'Transaction manuelle' }))
    await saisir(utilisateur, 'drop table commandes')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))

    // **La seule nature qui n'est pas dispensée** : une transaction ne retient pas toujours un
    // `drop`, MySQL validant d'office ce qui attend avant de l'exécuter. Le rappel dit cela, là où
    // « rien ne sera écrit » serait une promesse que le moteur peut ne pas tenir.
    const modale = screen.getByRole('dialog')
    expect(
      within(modale).getByText(/valide d’office ce qui attend avant de s’exécuter/),
    ).toBeInTheDocument()
    expect(modes).toEqual([])

    await utilisateur.click(within(modale).getByRole('button', { name: /Exécuter ce DROP/ }))
    await waitFor(() => expect(modes).toEqual(['manual']))
  })

  it('le journal du registre s’affiche dans le panneau', async () => {
    const utilisateur = userEvent.setup()
    await ouvrirUneConsoleAvecTransaction(utilisateur)
    await utilisateur.click(screen.getByRole('switch', { name: 'Transaction manuelle' }))
    await saisir(utilisateur, 'delete from commandes')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))

    const panneau = await screen.findByRole('complementary', { name: 'Transaction en cours' })
    // **Ce que le serveur a répondu**, relu dans le journal après l'exécution : c'est le chiffre
    // qui décide d'une validation, et sans `affected` il aurait dit « 0 ligne ».
    await waitFor(() => expect(panneau).toHaveTextContent('3 lignes touchées'))
    expect(panneau).toHaveTextContent('delete from commandes')
  })

  it('désigner une instruction remet sa réponse dans la grille', async () => {
    const utilisateur = userEvent.setup()
    const { modes } = await ouvrirUneConsoleAvecTransaction(utilisateur)
    await utilisateur.click(screen.getByRole('switch', { name: 'Transaction manuelle' }))
    // Une lecture, puis une écriture : la grille montre donc la réponse de l'**écriture** — aucune
    // ligne. Sans ce second geste, désigner la lecture ne prouverait rien, sa réponse étant déjà à
    // l'écran (règle n° 5).
    await saisir(utilisateur, 'select n from ventes')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))
    await utilisateur.keyboard(`${auModificateur('a')}`)
    await saisir(utilisateur, 'delete from ventes')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))

    const panneau = await screen.findByRole('complementary', { name: 'Transaction en cours' })
    await waitFor(() => expect(panneau).toHaveTextContent('3 lignes touchées'))
    // L'écriture n'est pas désignable — rien à remettre dans une grille —, la lecture l'est.
    const cartes = within(panneau).getAllByRole('button', { name: /Afficher ce résultat/ })
    expect(cartes).toHaveLength(1)
    expect(screen.queryByRole('columnheader', { name: 'n' })).toBeNull()

    expect(modes).toHaveLength(2)
    await utilisateur.click(cartes[0] as HTMLElement)

    // **Le nerf de ce test** : la grille du centre ne tient qu'une réponse, celle de la dernière
    // exécution. Dans une transaction de cinq requêtes, les quatre autres n'existent plus qu'au
    // cœur — et c'est le panneau qui va les y chercher.
    expect(await screen.findByRole('columnheader', { name: 'n' })).toBeInTheDocument()
    expect(cartes[0]).toHaveAttribute('aria-pressed', 'true')
    // **Rien n'a été rejoué** : une requête de console n'est pas forcément idempotente, et c'est la
    // raison qui interdit déjà de la relancer sur un geste de colonne. Les lignes viennent du cœur,
    // qui les avait gardées.
    expect(modes).toHaveLength(2)
  })

  it('valider appelle la commande avec la connexion de la console, et vide le panneau', async () => {
    const utilisateur = userEvent.setup()
    const { vus } = await ouvrirUneConsoleAvecTransaction(utilisateur)
    await utilisateur.click(screen.getByRole('switch', { name: 'Transaction manuelle' }))
    await saisir(utilisateur, 'delete from commandes')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))
    const panneau = await screen.findByRole('complementary', { name: 'Transaction en cours' })
    await waitFor(() => expect(panneau).toHaveTextContent('3 lignes touchées'))

    await utilisateur.click(screen.getByRole('button', { name: 'Valider' }))

    // **C'est ici que la confirmation a lieu** (`API-38`), et elle récapitule ce qui devient
    // définitif : le verbe de l'écriture, et non « 1 modification ».
    const modale = await screen.findByRole('dialog')
    expect(within(modale).getByText('DELETE')).toBeInTheDocument()
    expect(vus.valides).toEqual([])
    await utilisateur.click(within(modale).getByRole('button', { name: /Valider 1 écriture/ }))

    // **La connexion de la console**, non celle que l'arbre montre : une console sait sur quoi elle
    // porte, et c'est déjà ce qui décide de la clé d'exécution.
    await waitFor(() =>
      expect(vus.valides).toEqual([
        { project: 'Atelier Nord', database: 'analytics', environment: 'prod' },
      ]),
    )
    // Et le journal est relu : le panneau retombe sur son invite plutôt que de garder une liste que
    // la validation a emportée.
    await waitFor(() => expect(panneau).toHaveTextContent(/Rien n’est encore retenu/))
  })

  it('le régime est celui de la console, non de sa connexion', async () => {
    const utilisateur = userEvent.setup()
    await ouvrirUneConsoleAvecTransaction(utilisateur)
    await utilisateur.click(screen.getByRole('switch', { name: 'Transaction manuelle' }))
    await saisir(utilisateur, 'delete from ventes')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))
    const panneau = await screen.findByRole('complementary', { name: 'Transaction en cours' })
    await waitFor(() => expect(panneau).toHaveTextContent('3 lignes touchées'))

    // **Une seconde console sur la même connexion**, et c'est le nerf du test : elle part en
    // automatique, et le panneau de la première ne la suit pas. Le régime est réglé *sur un onglet*
    // — comme son texte et son résultat —, non sur la base.
    await ouvrirUneConsole(utilisateur)
    expect(screen.queryByRole('complementary', { name: 'Transaction en cours' })).toBeNull()
    expect(screen.getByRole('switch', { name: 'Transaction manuelle' })).toHaveAttribute(
      'aria-checked',
      'false',
    )

    // Et revenir la retrouve, avec ce qu'elle retenait : l'état suit l'onglet, il ne se perd pas.
    await utilisateur.click(screen.getByRole('tab', { name: /console 1/ }))
    const retrouve = await screen.findByRole('complementary', { name: 'Transaction en cours' })
    expect(retrouve).toHaveTextContent('3 lignes touchées')
    expect(screen.getByRole('switch', { name: 'Transaction manuelle' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('une console voisine n’entre pas dans la transaction, et n’en sait rien', async () => {
    const utilisateur = userEvent.setup()
    const { modes } = await ouvrirUneConsoleAvecTransaction(utilisateur)
    await utilisateur.click(screen.getByRole('switch', { name: 'Transaction manuelle' }))
    await saisir(utilisateur, 'delete from ventes')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))
    await waitFor(() =>
      expect(screen.getByRole('complementary', { name: 'Transaction en cours' })).toHaveTextContent(
        '3 lignes touchées',
      ),
    )

    // **Une seconde console sur la même base**, en automatique : elle n'a pas de panneau, et rien
    // ne lui annonce la transaction d'à côté — parce qu'elle n'y entre pas. C'est ce qu'une session
    // par console a supprimé : tant que les deux partageaient celle de la connexion, ses requêtes
    // entraient dans la transaction de sa voisine, et le pied devait le dire.
    await ouvrirUneConsole(utilisateur)
    expect(screen.queryByRole('complementary', { name: 'Transaction en cours' })).toBeNull()
    expect(screen.queryByText(/transaction est ouverte sur cette connexion/)).toBeNull()

    await saisir(utilisateur, 'update ventes set statut = 2')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))
    // **Elle confirme son écriture**, elle : rien ne la retient, donc c'est bien à découvert
    // qu'elle écrit — et la confirmation de `12c` est le seul garde-fou qui reste.
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter ce UPDATE/ }))
    await waitFor(() => expect(modes).toEqual(['manual', 'auto']))

    // Et le panneau de la première ne l'a pas vue passer.
    await utilisateur.click(screen.getByRole('tab', { name: /console 1/ }))
    const panneau = await screen.findByRole('complementary', { name: 'Transaction en cours' })
    expect(within(panneau).getAllByRole('listitem')).toHaveLength(1)
    // Le mot qui distingue les deux requêtes : `statut` n'est que dans celle de la seconde console.
    expect(panneau).not.toHaveTextContent('statut')
  })

  it('deux consoles tiennent chacune sa transaction, et une validation n’emporte que la sienne', async () => {
    const utilisateur = userEvent.setup()
    const { vus } = await ouvrirUneConsoleAvecTransaction(utilisateur)
    await utilisateur.click(screen.getByRole('switch', { name: 'Transaction manuelle' }))
    await saisir(utilisateur, 'delete from ventes')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))
    await waitFor(() =>
      expect(screen.getByRole('complementary', { name: 'Transaction en cours' })).toHaveTextContent(
        '3 lignes touchées',
      ),
    )

    // La seconde console **aussi** en manuel : elle ouvre la sienne, là où une session partagée
    // l'aurait fait entrer dans celle de sa voisine.
    await ouvrirUneConsole(utilisateur)
    await utilisateur.click(screen.getByRole('switch', { name: 'Transaction manuelle' }))
    await saisir(utilisateur, 'select n from ventes')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))
    const sienne = await screen.findByRole('complementary', { name: 'Transaction en cours' })
    await waitFor(() => expect(sienne).toHaveTextContent('1 ligne rendue'))
    // Son panneau ne porte que sa lecture : le `delete` de la voisine n'est pas dans sa transaction.
    expect(within(sienne).getAllByRole('listitem')).toHaveLength(1)
    expect(sienne).not.toHaveTextContent('delete')

    // **Elle n'a fait que lire, donc elle valide sans question** — et c'est juste, puisqu'aucune
    // écriture invisible ne l'accompagne : la transaction est la sienne, entière.
    await utilisateur.click(within(sienne).getByRole('button', { name: 'Valider' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(vus.valides).toHaveLength(1))

    // Et la transaction de la première n'a pas bougé : elle attend toujours son issue.
    await utilisateur.click(screen.getByRole('tab', { name: /console 1/ }))
    const premiere = await screen.findByRole('complementary', { name: 'Transaction en cours' })
    await waitFor(() => expect(premiere).toHaveTextContent('3 lignes touchées'))
    expect(screen.getByRole('switch', { name: 'Transaction manuelle' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('renommer la console lui laisse sa transaction, et ses instructions', async () => {
    const utilisateur = userEvent.setup()
    await ouvrirUneConsoleAvecTransaction(utilisateur)
    await utilisateur.click(screen.getByRole('switch', { name: 'Transaction manuelle' }))
    await saisir(utilisateur, 'delete from ventes')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))
    await waitFor(() =>
      expect(screen.getByRole('complementary', { name: 'Transaction en cours' })).toHaveTextContent(
        '3 lignes touchées',
      ),
    )

    await utilisateur.dblClick(screen.getByRole('tab', { name: /console 1/ }))
    const champ = screen.getByLabelText('Nouveau nom de console 1')
    await utilisateur.clear(champ)
    await utilisateur.type(champ, 'Audit{Enter}')
    await waitFor(() => expect(screen.getByRole('tab', { name: /Audit/ })).toBeInTheDocument())

    // **Cinq tables indexées par identité d'onglet, et l'identité dérive du nom.** Le régime en est
    // une : sans réindexation, la console retomberait en automatique et son panneau disparaîtrait,
    // en laissant une transaction ouverte que plus rien ne validerait.
    const panneau = await screen.findByRole('complementary', { name: 'Transaction en cours' })
    // Et le **jeton d'origine** en est une autre, celle dont l'oubli coûte le plus cher : le cœur
    // garde l'origine des instructions déjà jouées, donc un jeton resté sous l'ancien nom rendrait
    // à cette console ses propres instructions comme étrangères — un panneau vide devant un
    // « Valider » qui en emporte une.
    expect(panneau).toHaveTextContent('3 lignes touchées')
    expect(within(panneau).getAllByRole('listitem')).toHaveLength(1)
    expect(panneau).not.toHaveTextContent('autre console')
  })

  it('une transaction qui n’a fait que lire se valide sans confirmation', async () => {
    const utilisateur = userEvent.setup()
    const { vus } = await ouvrirUneConsoleAvecTransaction(utilisateur)
    await utilisateur.click(screen.getByRole('switch', { name: 'Transaction manuelle' }))
    await saisir(utilisateur, 'select n from ventes')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))
    const panneau = await screen.findByRole('complementary', { name: 'Transaction en cours' })
    await waitFor(() => expect(panneau).toHaveTextContent('1 ligne rendue'))

    await utilisateur.click(screen.getByRole('button', { name: 'Valider' }))

    // **Rien à confirmer quand rien n'a été écrit** : c'est la règle de la confirmation d'une
    // requête isolée — un `select` n'en demande pas —, appliquée à un lot. Un clic de plus ne
    // protégerait de rien.
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(vus.valides).toHaveLength(1))
  })

  it('une transaction en cours interdit de revenir au mode automatique, et le dit', async () => {
    const utilisateur = userEvent.setup()
    const { modes } = await ouvrirUneConsoleAvecTransaction(utilisateur)
    await utilisateur.click(screen.getByRole('switch', { name: 'Transaction manuelle' }))
    await saisir(utilisateur, 'delete from commandes')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))

    const bascule = screen.getByRole('switch', { name: 'Transaction manuelle' })
    await waitFor(() => expect(bascule).toHaveAttribute('aria-disabled', 'true'))
    // **Sortir du mode n'est ni une validation ni une annulation** : valider d'office écrirait ce
    // que personne n'a relu, annuler jetterait un travail en cours. Le réglage se refuse avec sa
    // raison, et les deux boutons du panneau restent les deux seules issues.
    expect(bascule).toHaveAttribute('title', expect.stringContaining('validez-la ou annulez-la'))
    await utilisateur.click(bascule)
    expect(screen.getByRole('complementary', { name: 'Transaction en cours' })).toBeInTheDocument()
    // Et rien n'a été exécuté de plus : la bascule figée ne relance aucune requête.
    expect(modes).toEqual(['manual'])
  })

  it('sur une console mongo, le mode manuel est refusé avec la raison du moteur', async () => {
    const utilisateur = userEvent.setup()
    await ouvrirUneConsoleAvecTransaction(utilisateur, { projects: PROJETS_MONGO })

    const bascule = screen.getByRole('switch', { name: 'Transaction manuelle' })
    // **L'entrée reste et se désactive avec sa raison** : la cacher ferait croire qu'elle n'existe
    // pas, là où c'est le contenu d'une transaction qui manque — la console mongo ne fait que lire.
    expect(bascule).toHaveAttribute('aria-disabled', 'true')
    expect(bascule).toHaveAttribute('title', expect.stringContaining('ne fait que lire'))
    await utilisateur.click(bascule)
    expect(screen.queryByRole('complementary', { name: 'Transaction en cours' })).toBeNull()
  })
})
