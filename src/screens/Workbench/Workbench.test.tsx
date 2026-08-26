import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { Project } from '../../domain/config'
import type { SchemaInfo, TableDetail, TableSummary, UpdatePlan } from '../../domain/engine'
import { REGLAGES, TRIO_DE_TEST } from '../NewConnection/pourLesTests'
import type { PasserelleLignes } from '../TableView/useLignes'
import type { PasserelleArbre } from './useArbre'
import type { PasserelleDetail } from './useDetailTable'
import type { PasserelleStructures } from './useStructures'
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
  { name: 'public', counts: { tables: 2, views: 0, functions: 0, indexes: 0 } },
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
  const passerelle: PasserelleArbre = {
    openDatabase: vi.fn(async () => ({
      kind: 'connected' as const,
      serverVersion: 'PostgreSQL 17.6',
      tunnelLocalPort: null,
    })),
    closeDatabase: vi.fn(async () => {}),
    connectionStates: vi.fn(async () => []),
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
  explainSql: async () => PLAN,
}

/** Un plan d'exécution minimal (`12e`). */
const PLAN = {
  lines: ['Seq Scan on orders  (cost=0.00..35.50 rows=2550 width=4)'],
  sql: 'explain select 1',
  durationMs: 2,
}

/** Un résultat de requête minimal, pour les tests qui ne portent pas sur son contenu. */
const RESULTAT = {
  columns: ['n'],
  rows: [[{ kind: 'int' as const, value: 1 }]],
  sql: 'select 1',
  durationMs: 3,
  appliedLimit: null,
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
      <Pilote />
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
        <Workbench
          projects={PROJETS}
          passerelle={passerelle}
          passerelleDetail={{ describeTable: vi.fn(async () => DETAIL) }}
        />
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
  /**
   * Ouvre l'arbre jusqu'à une base, puis une console **depuis le menu de la connexion**.
   *
   * Le pied de la sidebar ne porte plus de bouton « Nouvelle console » depuis le 20 août 2026 : ce
   * chemin est le seul, et c'est celui que les tests doivent emprunter.
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
   * Le texte de l'éditeur.
   *
   * **Pas `toHaveValue`, et pas le `textContent` de l'hôte** : depuis `12b`, l'éditeur est CodeMirror
   * — son document vit dans `.cm-content`, et lire l'hôte entier ramènerait aussi les **numéros de
   * ligne** de la gouttière. Une première version rendait « 91 » pour deux lignes vides.
   */
  const texteDeLEditeur = () => document.querySelector('.cm-content')?.textContent

  /** Saisit dans l'éditeur. Le clic va sur `.cm-content`, seul élément éditable. */
  async function saisir(utilisateur: ReturnType<typeof userEvent.setup>, texte: string) {
    await utilisateur.click(document.querySelector('.cm-content') as HTMLElement)
    await utilisateur.keyboard(texte)
  }

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
    // Les cinq autres répondent depuis `12c` à `12f`. **Il ne reste que « Formater »**, seule action
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
    monter({ passerelleExecution: { runSql: executer, explainSql: async () => PLAN } })
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
        explainSql: async () => PLAN,
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
    monter({ passerelleExecution: { runSql: executer, explainSql: async () => PLAN } })
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
    monter({ passerelleExecution: { runSql: executer, explainSql: async () => PLAN } })
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
    monter({ passerelleExecution: { runSql: executer, explainSql: async () => PLAN } })
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
        explainSql: async () => PLAN,
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
        explainSql: async () => PLAN,
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

  it('« Expliquer » demande le plan et bascule sur sa vue (`12e`)', async () => {
    const utilisateur = userEvent.setup()
    const expliquer = vi.fn(async () => PLAN)
    const executer = vi.fn(async () => RESULTAT)
    monter({ passerelleExecution: { runSql: executer, explainSql: expliquer } })
    await ouvrirUneConsole(utilisateur)
    await saisir(utilisateur, 'select 1')
    await utilisateur.click(screen.getByRole('button', { name: /Exécuter/ }))
    await screen.findByRole('grid', { name: /Résultat de la requête/ })

    await utilisateur.click(screen.getByRole('button', { name: /Expliquer/ }))

    await waitFor(() => expect(expliquer).toHaveBeenCalledOnce())
    // **Basculer fait partie de l'action** : « Expliquer » sans changer de vue laisserait croire que
    // rien ne s'est passé, et il faudrait deviner qu'un onglet s'est rempli.
    expect(await screen.findByText(/Coûts/)).toBeInTheDocument()
    // Et le plan dit qu'il est **estimé** : un plan dont on croirait les temps réels ferait prendre
    // des décisions sur des chiffres qui n'en sont pas.
    expect(screen.getByText(/n’a pas été exécutée/)).toBeInTheDocument()
    // La requête n'a **pas** été exécutée par « Expliquer ».
    expect(executer).toHaveBeenCalledOnce()
  })

  it('la vue JSON suit la ligne sélectionnée', async () => {
    const utilisateur = userEvent.setup()
    monter({
      passerelleExecution: {
        runSql: async () => RESULTAT,
        explainSql: async () => PLAN,
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
        explainSql: async () => PLAN,
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
})

describe('mode édition', () => {
  /** Ouvre l'arbre, une table, et bascule en édition. */
  async function ouvrirEtEditer(utilisateur: ReturnType<typeof userEvent.setup>) {
    await ouvrirLArbreJusquAuSchema(utilisateur)
    await utilisateur.click(await screen.findByRole('treeitem', { name: /^orders/ }))
    await screen.findByRole('grid')
    await utilisateur.keyboard('{Meta>}e{/Meta}')
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
    expect(screen.getByRole('status', { name: 'Modifications en attente' })).toBeInTheDocument()

    await utilisateur.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await utilisateur.click(screen.getByRole('button', { name: 'Retirer de DoraBase…' }))
    await utilisateur.click(screen.getByRole('button', { name: 'Retirer la connexion' }))

    expect(
      screen.queryByRole('status', { name: 'Modifications en attente' }),
    ).not.toBeInTheDocument()

    // **Et elles ne reviennent pas si l'on rouvre le même chemin.** C'est la vraie raison de purger
    // l'état : la disparition du bandeau ne prouve rien, l'onglet actif ayant changé. Des
    // modifications fantômes sur une base redéclarée s'appliqueraient à des lignes qu'on n'a jamais
    // vues.
    await utilisateur.click(await screen.findByRole('treeitem', { name: /^orders/ }))
    await screen.findByRole('grid')
    expect(
      screen.queryByRole('status', { name: 'Modifications en attente' }),
    ).not.toBeInTheDocument()
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
    const { lignes } = monter({
      projects: PROJETS_DEV,

      passerellePreview: PREVIEW,
      passerelleApply: { applyChanges: ecrire },
    })
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)
    const readRows = lignes.readRows as unknown as ReturnType<typeof vi.fn>
    const lecturesAvant = readRows.mock.calls.length

    const panneau = await screen.findByLabelText('Modifications en attente de la table')
    await utilisateur.click(within(panneau).getByRole('button', { name: /Appliquer/ }))

    // **La valeur affichée doit venir de la base, pas de la saisie** : un `trigger`, une valeur par
    // défaut ou une troncature rendraient l'écran faux.
    await waitFor(() => expect(readRows.mock.calls.length).toBeGreaterThan(lecturesAvant))
    // Et le modèle vidé fait disparaître toutes les marques de `11b` d'un coup.
    await waitFor(() =>
      expect(
        screen.queryByRole('status', { name: 'Modifications en attente' }),
      ).not.toBeInTheDocument(),
    )
    // À la place, de quoi défaire — et non un panneau vide.
    expect(screen.getByText(/SQL qui annule cette écriture/)).toBeInTheDocument()
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
    expect(screen.getByRole('status', { name: 'Modifications en attente' })).toBeInTheDocument()
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
    expect(screen.getByRole('status', { name: 'Modifications en attente' })).toBeInTheDocument()

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
      '⌘E pour éditer',
    )
    expect(screen.queryByRole('button', { name: /Modifier/ })).not.toBeInTheDocument()

    await utilisateur.keyboard('{Meta>}e{/Meta}')
    expect(screen.getByRole('status', { name: 'État de la table' })).toHaveTextContent('édition')
    expect(screen.getAllByRole('button', { name: /Modifier/ }).length).toBeGreaterThan(0)
  })

  it('sans modification, aucun bandeau', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirEtEditer(utilisateur)
    // Un bandeau à « 0 modification » occuperait 34 px pour ne rien dire.
    expect(screen.queryByText(/modification.* en attente sur/)).not.toBeInTheDocument()
  })

  it('les quatre affichages du compte suivent le même modèle', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)

    // 1. le bandeau
    expect(await screen.findByText(/1 modification en attente sur/)).toBeInTheDocument()
    // 2. la barre d'état
    expect(screen.getByRole('status', { name: 'État de la table' })).toHaveTextContent(
      '1 modification en attente',
    )
    // 3. le badge de l'indicateur de la barre de titre — **du texte, plus un bouton** : la pastille
    //    projet était un `<button>`, l'indicateur de `25b` n'a rien de focalisable.
    expect(screen.getByText('Édition')).toBeInTheDocument()
    // 4. la pastille de l'arbre, à la place du compte de lignes
    const ligne = screen.getByRole('treeitem', { name: /^orders/ })
    expect(ligne).toHaveTextContent('1')
  })

  it('⌘Z retire la modification, et les quatre affichages suivent', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)
    await screen.findByText(/1 modification en attente sur/)

    await utilisateur.keyboard('{Meta>}z{/Meta}')

    // Un compteur tenu à part divergerait ici.
    await waitFor(() =>
      expect(screen.queryByText(/modification.* en attente sur/)).not.toBeInTheDocument(),
    )
    expect(screen.queryByText('Édition')).not.toBeInTheDocument()
  })

  it('« Tout annuler » vide le modèle', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)
    await screen.findByText(/1 modification en attente sur/)

    // **Deux boutons portent ce nom depuis `11c`** — celui du bandeau et celui du pied du panneau —
    // et le mockup montre bien les deux. On cible celui du bandeau ; l'autre est couvert par les
    // tests de `PendingPanel`.
    const bandeau = screen.getByRole('status', { name: 'Modifications en attente' })
    await utilisateur.click(within(bandeau).getByRole('button', { name: 'Tout annuler' }))

    await waitFor(() =>
      expect(screen.queryByText(/modification.* en attente sur/)).not.toBeInTheDocument(),
    )
  })

  it('quitter le mode édition **garde** les modifications en attente', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await ouvrirEtEditer(utilisateur)
    await modifier(utilisateur)
    await screen.findByText(/1 modification en attente sur/)

    await utilisateur.keyboard('{Meta>}e{/Meta}')

    // Les perdre sur une frappe serait le défaut qu'`esc` fermant une modale pleine a produit.
    expect(screen.getByText(/1 modification en attente sur/)).toBeInTheDocument()
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
