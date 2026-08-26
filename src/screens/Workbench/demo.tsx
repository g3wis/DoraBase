import { useEffect, useState } from 'react'
import type {
  Database,
  EnvironmentColor,
  EnvironmentDeclaration,
  EnvironmentId,
  Preferences,
  Project,
} from '../../domain/config'
import type { SchemaInfo, TableDetail, TableSummary } from '../../domain/engine'
import { NewConnection } from '../NewConnection/NewConnection'
import { ParcoursDeCreation } from '../NewProject/ParcoursDeCreation'
import { PreferencesDialog } from '../Preferences/PreferencesDialog'
import { jetonsDe, PREFERENCES_PAR_DEFAUT, themeApplique } from '../Preferences/preferences'
import type { PasserelleLignes } from '../TableView/useLignes'
import type { PasserelleArbre } from './useArbre'
import type { PasserelleDetail } from './useDetailTable'
import type { PasserelleStructures } from './useStructures'
import { Workbench } from './Workbench'

/**
 * Les environnements déclarés par les projets de la démo (`23g`).
 *
 * **Quatre, dont un que personne ne codait en dur.** Le trio `dev` / `staging` / `prod` était une
 * énumération : un décor qui s'y limite laisserait passer un écran qui relit une table de constantes au
 * lieu des déclarations du projet. `preprod` est la sonde — s'il s'affiche partout, plus aucun trio ne
 * survit.
 */
const ENVIRONNEMENTS_DE_DEMO: EnvironmentDeclaration[] = [
  { id: 'dev', label: 'dev', color: 'green', production: false },
  { id: 'preprod', label: 'preprod', color: 'violet', production: false },
  { id: 'staging', label: 'staging', color: 'amber', production: false },
  { id: 'prod', label: 'prod', color: 'red', production: true },
]

/**
 * L'écran de travail sur des données figées, **en développement seulement**.
 *
 * Il existe pour une raison précise : Playwright pilote Chromium, où le pont Tauri ne répond
 * pas. Sans ce montage, l'écran de travail ne serait vérifiable qu'en galerie — exactement le
 * trou que `10b` corrige pour `A4`. Un test qui part de `/` doit donc pouvoir atteindre l'écran
 * sans base réelle.
 *
 * Monté derrière **deux** conditions, comme la galerie : `import.meta.env.DEV` ET `?demo` dans
 * l'URL. `import.meta.env.DEV` devient `false` à la construction de production, et le bloc
 * entier est élagué.
 */

const PROJETS: Project[] = [
  {
    name: 'Atelier Nord',
    // **Quatre environnements, et non trois** (`23g`) : un décor qui n'en porte que
    // trois laisserait passer un écran qui relit le trio en dur. `preprod` est
    // justement celui qu'aucune table de constantes ne connaît.
    environments: ENVIRONNEMENTS_DE_DEMO,
    queries: [],
    databases: [
      {
        name: 'analytics',
        engine: 'postgresql',
        environment: 'prod',
        // Trois consoles persistées : elles vivent sous la connexion depuis le 20 août 2026, et une
        // démo sans elles ne montrerait pas ce niveau de l'arbre.
        consoles: [
          {
            name: 'CA par jour',
            sql: "select date_trunc('day', created_at), sum(total_cents)\nfrom orders\ngroup by 1",
          },
          {
            name: 'Top coupons',
            sql: 'select coupon_code, count(*)\nfrom orders\ngroup by 1 order by 2 desc',
          },
          { name: 'Paniers abandonnés', sql: "select * from orders where status = 'pending'" },
        ],
        connection: {
          host: 'localhost',
          port: 5432,
          defaultDatabase: 'analytics',
          username: 'dorabase',
          password: null,
          sslMode: 'prefer',
          caCertificate: null,
          authDatabase: null,
          readOnly: true,
          reconnectOnStartup: false,
          tunnel: null,
        },
      },
      // **Une base mongo, pour qu'`A8` soit atteignable en démo** (`13a`). Le dialecte de la
      // console se dérive du moteur : sans base documentaire dans le décor, aucun chemin de
      // l'application n'ouvrirait une console mongo, et rien de `13a` à `13c` ne se verrait.
      {
        name: 'evenements',
        engine: 'mongodb',
        environment: 'prod',
        connection: {
          host: 'localhost',
          port: 27017,
          defaultDatabase: 'atelier_journal',
          username: '',
          password: null,
          sslMode: 'disable',
          caCertificate: null,
          authDatabase: null,
          readOnly: true,
          reconnectOnStartup: false,
          tunnel: null,
        },
        consoles: [],
      },
    ],
  },
  {
    name: 'Outils internes',
    environments: ENVIRONNEMENTS_DE_DEMO,
    databases: [],
    queries: [],
  },
]

const SCHEMAS: SchemaInfo[] = [
  { name: 'public', counts: { tables: 3, views: 1, functions: 0, indexes: 4 } },
]

const objet = (name: string, over: Partial<TableSummary> = {}): TableSummary => ({
  name,
  kind: 'table',
  rows: { kind: 'estimated', value: 1_904_220 },
  sizeBytes: 2.1 * 1024 ** 3,
  columnCount: 18,
  primaryKey: 'id',
  lastAnalyze: '2026-08-06 04:12',
  comment: null,
  ...over,
})

const OBJETS: TableSummary[] = [
  objet('orders'),
  // Assez de tables pour que la bande d'onglets déborde : c'est ce qui a révélé, le 10 août 2026,
  // qu'elle passait **sous** « Données / Structure » au lieu de défiler.
  //
  // **Des noms inventés, et c'est une règle.** Le décor de démo a un temps porté les noms de
  // tables d'une base réelle du commanditaire — commode, et indiscret : un dépôt, une capture
  // d'écran ou un rapport de test publierait le schéma de quelqu'un. Les noms viennent donc du
  // handoff (`orders`, `users`, `order_items`) ou sont inventés ; les longueurs sont conservées,
  // puisque c'est d'elles que dépend le débordement mesuré.
  objet('shipment_batches'),
  objet('inventory_movements'),
  objet('pricing_rules'),
  objet('audit_events'),
  objet('order_items', { rows: { kind: 'estimated', value: 6_400_000 } }),
  objet('users', { rows: { kind: 'estimated', value: 92_800 } }),
  objet('orders_daily', { kind: 'view', rows: { kind: 'estimated', value: 0 }, primaryKey: null }),
]

const DETAIL: TableDetail = {
  schema: 'public',
  name: 'orders',
  rows: { kind: 'estimated', value: 1_904_220 },
  sizeBytes: 2.1 * 1024 ** 3,
  comment: null,
  columns: [
    {
      position: 1,
      name: 'id',
      typeName: 'int8',
      category: 'number',
      nullable: false,
      default: null,
      // Une identité, pas un `serial` : c'est le cas où `default` est nul et où `A9` doit dire
      // « identity » plutôt que « — ».
      identity: 'byDefault',
      key: 'primary',
      comment: null,
      frequency: null,
    },
    {
      position: 2,
      name: 'user_id',
      typeName: 'int8',
      category: 'number',
      nullable: false,
      default: null,
      identity: null,
      key: 'foreign',
      comment: null,
      frequency: null,
    },
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
    {
      position: 4,
      name: 'total_cents',
      typeName: 'int4',
      category: 'number',
      nullable: false,
      default: null,
      identity: null,
      key: null,
      comment: null,
      frequency: null,
    },
    {
      position: 5,
      name: 'currency',
      typeName: 'bpchar',
      category: 'text',
      nullable: false,
      default: null,
      identity: null,
      key: null,
      comment: null,
      frequency: null,
    },
    {
      position: 6,
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
    {
      position: 7,
      name: 'shipped_at',
      typeName: 'timestamptz',
      category: 'timestamp',
      nullable: true,
      default: null,
      identity: null,
      key: null,
      comment: null,
      frequency: null,
    },
    {
      position: 8,
      name: 'coupon_code',
      typeName: 'text',
      category: 'text',
      nullable: true,
      default: null,
      identity: null,
      key: null,
      comment: null,
      frequency: null,
    },
    {
      // **Une valeur qui ne tient pas dans la colonne, délibérément.** Sans elle, deux mesures de
      // `10f` ne mordraient pas : l'ellipse d'une valeur trop longue, et l'aperçu du survol prolongé
      // qui ne paraît **que** pour ce qui est coupé. Un décor qui n'a que des valeurs courtes ne
      // mesure que le décor — la leçon des défauts n° 51 et 57.
      position: 9,
      name: 'external_ref',
      typeName: 'text',
      category: 'text',
      nullable: true,
      default: null,
      identity: null,
      key: null,
      comment: null,
      frequency: null,
    },
  ],
  // **Renseignés depuis `14a`** : tant qu'`A9` n'existait pas, personne ne lisait ces trois
  // listes, et les laisser vides ne coûtait rien. La démo servant aussi de décor aux mesures de
  // mise en page, elle doit maintenant porter de quoi remplir les deux panneaux et le DDL.
  indexes: [
    {
      name: 'orders_pkey',
      definition: 'CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)',
    },
    {
      name: 'orders_created_idx',
      definition: 'CREATE INDEX orders_created_idx ON public.orders USING btree (created_at DESC)',
    },
    {
      name: 'orders_user_status_idx',
      definition:
        'CREATE INDEX orders_user_status_idx ON public.orders USING btree (user_id, status)',
    },
  ],
  constraints: [
    {
      name: 'orders_status_chk',
      definition:
        "CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'shipped'::text, 'refunded'::text, 'cancelled'::text])))",
    },
    { name: 'orders_total_chk', definition: 'CHECK ((total_cents >= 0))' },
  ],
  triggers: [
    {
      name: 'trg_touch_updated',
      definition:
        'CREATE TRIGGER trg_touch_updated BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION touch()',
    },
  ],
  relations: [
    {
      constraintName: 'orders_user_id_fkey',
      direction: 'outgoing',
      columns: ['user_id'],
      targetSchema: 'public',
      targetTable: 'users',
      targetColumns: ['id'],
    },
  ],
  ddl: `CREATE TABLE public.orders (
    id int8 GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    user_id int8 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    total_cents int4 NOT NULL,
    currency bpchar DEFAULT 'EUR'::bpchar NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    shipped_at timestamptz,
    coupon_code text,
    external_ref text,
    CONSTRAINT orders_pkey PRIMARY KEY (id),
    CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);`,
}

/**
 * Le décor MongoDB de la démo (`13a`–`13c`).
 *
 * **Le niveau « schéma » porte les bases** (`18a`) : `atelier_journal` en est une, pas un schéma.
 * Les noms sont inventés, comme le veut `AGENTS.md`.
 */
const SCHEMAS_MONGO: SchemaInfo[] = [
  { name: 'atelier_journal', counts: { tables: 2, views: 0, functions: 0, indexes: 3 } },
  { name: 'atelier_archives', counts: { tables: 1, views: 0, functions: 0, indexes: 1 } },
]

const COLLECTIONS: TableSummary[] = [
  {
    name: 'evenements',
    kind: 'table',
    rows: { kind: 'estimated', value: 482_100 },
    sizeBytes: 96 * 1024 ** 2,
    columnCount: 0,
    primaryKey: '_id',
    lastAnalyze: null,
    comment: null,
  },
  {
    name: 'sessions',
    kind: 'table',
    rows: { kind: 'estimated', value: 12_400 },
    sizeBytes: 4 * 1024 ** 2,
    columnCount: 0,
    primaryKey: '_id',
    lastAnalyze: null,
    comment: null,
  },
]

/**
 * Le détail d'une collection : **des champs déduits, avec leur fréquence** (`18d`).
 *
 * Deux champs sous 100 % — c'est ce qui fait apparaître la fréquence dans la sidebar de `13c`. Un
 * décor à 100 % partout ne montrerait rien de cette spec.
 */
const DETAIL_MONGO: TableDetail = {
  schema: 'atelier_journal',
  name: 'evenements',
  rows: { kind: 'estimated', value: 482_100 },
  sizeBytes: 96 * 1024 ** 2,
  comment: null,
  columns: [
    {
      position: 1,
      name: '_id',
      typeName: 'objectId',
      category: 'uuid',
      nullable: false,
      default: null,
      identity: null,
      key: 'primary',
      comment: null,
      frequency: 1,
    },
    {
      position: 2,
      name: 'sorte',
      typeName: 'string',
      category: 'text',
      nullable: true,
      default: null,
      identity: null,
      key: null,
      comment: null,
      frequency: 1,
    },
    {
      position: 3,
      name: 'horodatage',
      typeName: 'date',
      category: 'timestamp',
      nullable: true,
      default: null,
      identity: null,
      key: null,
      comment: null,
      frequency: 1,
    },
    {
      position: 4,
      name: 'canal',
      typeName: 'string',
      category: 'text',
      nullable: true,
      default: null,
      identity: null,
      key: null,
      comment: null,
      frequency: 0.98,
    },
    {
      position: 5,
      name: 'duree_ms',
      typeName: 'int | double',
      category: 'number',
      nullable: true,
      default: null,
      identity: null,
      key: null,
      comment: null,
      frequency: 0.61,
    },
  ],
  indexes: [
    {
      name: '_id_',
      definition: 'CREATE INDEX _id_ ON atelier_journal.evenements USING btree (_id)',
    },
    {
      name: 'evenements_sorte_date_idx',
      definition:
        'CREATE INDEX evenements_sorte_date_idx ON atelier_journal.evenements USING btree (sorte, horodatage DESC)',
    },
  ],
  constraints: [],
  triggers: [],
  relations: [],
  ddl: `use atelier_journal;

db.createCollection("evenements");

db.evenements.createIndex({ "sorte": 1, "horodatage": -1 }, { name: "evenements_sorte_date_idx" });`,
}

/** Vrai pour la base documentaire du décor — voir `PROJETS`. */
const estMongo = (base: string) => base === 'evenements'

const PASSERELLE: PasserelleArbre = {
  openDatabase: async () => ({
    kind: 'connected',
    serverVersion: 'PostgreSQL 17.6',
    tunnelLocalPort: null,
  }),
  closeDatabase: async () => {},
  connectionStates: async () => [
    {
      key: { project: 'Atelier Nord', database: 'analytics', environment: 'prod' },
      state: { kind: 'connected', serverVersion: 'PostgreSQL 17.6', tunnelLocalPort: null },
    },
  ],
  listSchemas: async (cle) => (estMongo(cle.database) ? SCHEMAS_MONGO : SCHEMAS),
  listObjects: async (cle) => (estMongo(cle.database) ? COLLECTIONS : OBJETS),
}

const DETAIL_USERS: TableDetail = {
  ...DETAIL,
  name: 'users',
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
      name: 'email',
      typeName: 'text',
      category: 'text',
      nullable: false,
      default: null,
      identity: null,
      key: null,
      comment: null,
      frequency: null,
    },
    {
      position: 3,
      name: 'name',
      typeName: 'text',
      category: 'text',
      nullable: true,
      default: null,
      identity: null,
      key: null,
      comment: null,
      frequency: null,
    },
  ],
  relations: [],
}

const PASSERELLE_DETAIL: PasserelleDetail = {
  describeTable: async (cle, _schema, table) => {
    if (estMongo(cle.database)) return DETAIL_MONGO
    return table === 'users' ? DETAIL_USERS : DETAIL
  },
}

/**
 * Le pont du préchauffage des structures, **construit sur les deux autres**.
 *
 * Dans l'application, `describe_table` et `list_objects` sont les mêmes commandes que celles du
 * panneau et de l'arbre : un décor qui les dédoublerait pourrait rendre des structures différentes
 * selon le chemin, une divergence que la réalité n'a pas.
 */
const PASSERELLE_STRUCTURES: PasserelleStructures = {
  listObjects: PASSERELLE.listObjects,
  describeTable: PASSERELLE_DETAIL.describeTable,
}

/**
 * Cinq cents lignes — le palier par défaut de `RowLimit`, et ce que la barre d'état de `A5`
 * affiche dans le mockup. La table prétendue en compte 1,9 million : la fenêtre est justement
 * ce qui les sépare.
 */
const LIGNES = Array.from({ length: 500 }, (_, i) => [
  { kind: 'int' as const, value: 184_220 - i },
  { kind: 'int' as const, value: 44_019 + i * 7 },
  { kind: 'text' as const, value: ['paid', 'pending', 'refunded', 'cancelled'][i % 4] ?? 'paid' },
  { kind: 'int' as const, value: 12_900 - i * 3 },
  { kind: 'text' as const, value: 'EUR' },
  { kind: 'timestamp' as const, value: '2026-07-31 09:41:02' },
  i % 3 === 0
    ? { kind: 'null' as const }
    : { kind: 'timestamp' as const, value: '2026-07-31 11:02:10' },
  i % 2 === 0 ? { kind: 'null' as const } : { kind: 'text' as const, value: 'SUMMER26' },
  // Soixante-huit caractères : la colonne de valeurs en offre une vingtaine.
  {
    kind: 'text' as const,
    value: `ref-8f2c1a-${i}-lot-hiver-atelier-nord-suite-qui-deborde-largement`,
  },
])

const PASSERELLE_LIGNES: PasserelleLignes = {
  readRows: async (_cle, requete) => ({
    offset: 0,
    // Une requête filtrée sur une seule clé est celle de l'aperçu de ligne liée : elle rend la
    // ligne de `users`, dont `email` et `name` sont détectables.
    rows:
      requete.table === 'users'
        ? [
            [
              { kind: 'int', value: 90_233 },
              { kind: 'text', value: 'marie.l@example.com' },
              { kind: 'text', value: 'Marie Lefèvre' },
            ],
          ]
        : LIGNES,
    total: { kind: 'estimated', value: 1_904_220 },
    sql: `select * from ${requete.schema}.${requete.table} limit 500 offset 0`,
    durationMs: 41,
  }),
}

/**
 * L'`INSERT` de démonstration.
 *
 * En production, ce SQL vient de Rust : citer les identifiants et littéraliser les valeurs
 * demande de connaître les règles du moteur. Ici, une chaîne figée suffit — la démo vérifie le
 * câblage, pas la génération, que les tests Rust exercent contre la vraie base.
 */
const rowAsInsert = async () =>
  'INSERT INTO "public"."orders" ("id", "user_id", "status")\nVALUES (184220, 44019, \'paid\');'

export function WorkbenchDemo() {
  // **La démo monte `A2` en mode édition**, et ce n'est pas de la décoration. Elle se contentait
  // d'inscrire la cible dans le titre du document, ce qui vérifiait un *proxy* du chemin : un test
  // vert sur `document.title` n'aurait rien dit de la modale — le piège d'`A4`, qui n'existait que
  // dans la galerie. Les commandes du formulaire ne répondent pas en Chromium ; ce qui se vérifie
  // ici est qu'il s'ouvre, et sur la bonne base.
  const [edition, setEdition] = useState<{ project: string; database: Database } | null>(null)
  /** Le parcours de création, quand il est ouvert (`24d`) — étape 1 ou étape 2 selon le geste. */
  const [creationOuverte, setCreationOuverte] = useState<
    | { etape: 'projet' }
    | { etape: 'connexion'; projet: string; environnement?: EnvironmentId }
    | null
  >(null)
  // **Les requêtes de la démo vivent en mémoire.** Rien n'est persisté : le pont ne répond pas en
  // Chromium, et une démo qui écrirait sur le disque de l'utilisateur serait une mauvaise surprise.
  // Ce qui se vérifie ici est le parcours d'écran, pas la persistance — que les tests Rust couvrent.
  const [projets, setProjets] = useState<Project[]>(PROJETS)
  /**
   * Les préférences de la démo (`15a`), **en mémoire et appliquées pour de vrai**.
   *
   * Rien n'est persisté — le pont ne répond pas en Chromium — mais les jetons sont bien posés sur la
   * racine du document, ce qui est précisément ce qu'il faut mesurer : `--rowh` doit atteindre la
   * grille, `--accent` la pastille de projet. Une démo qui n'appliquerait rien laisserait `15b` et
   * `15c` invérifiables autrement qu'à l'œil.
   */
  const [preferences, setPreferences] = useState<Preferences>(PREFERENCES_PAR_DEFAUT)
  const [preferencesOuvertes, setPreferencesOuvertes] = useState(false)

  useEffect(() => {
    const racine = document.documentElement
    const jetons = jetonsDe(preferences)
    for (const [nom, valeur] of Object.entries(jetons)) racine.style.setProperty(nom, valeur)
    const theme = themeApplique(preferences)
    if (theme === null) racine.removeAttribute('data-theme')
    else racine.setAttribute('data-theme', theme)
    return () => {
      for (const nom of Object.keys(jetons)) racine.style.removeProperty(nom)
      racine.removeAttribute('data-theme')
    }
  }, [preferences])

  /**
   * Applique une transformation aux consoles d'**une** connexion, désignée par son identité complète.
   *
   * La démo tient son état en mémoire : ce qui se vérifie ici est le chemin — le menu s'ouvre, le
   * geste part, l'arbre suit — et non les règles, qui appartiennent au cœur.
   */
  const surConsoles = (
    project: string,
    database: string,
    environment: string,
    transforme: (consoles: Database['consoles']) => Database['consoles'],
  ) =>
    setProjets((precedents) =>
      precedents.map((projet) =>
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
      ),
    )

  /**
   * Applique un geste d'environnement à l'état local, et rend la liste — comme le cœur le fait.
   *
   * **La démo ne réimplémente pas les règles**, elle applique le geste : refuser un doublon ou un
   * dernier environnement est le travail du cœur, et l'écran de la démo n'a pas à en juger. Ce qui se
   * mesure ici est le chemin — la modale s'ouvre, le geste part, la liste suit.
   */
  const surEnvironnements = (
    nom: string,
    transforme: (
      environnements: Project['environments'],
      projet: Project,
    ) => Project['environments'],
    surBases?: (bases: Project['databases']) => Project['databases'],
  ): Project[] => {
    const suivants = projets.map((projet) =>
      projet.name === nom
        ? {
            ...projet,
            environments: transforme(projet.environments, projet),
            databases: surBases ? surBases(projet.databases) : projet.databases,
          }
        : projet,
    )
    setProjets(suivants)
    return suivants
  }

  const gestesEnvironnement = {
    onCreer: async (request: { project: string; label: string; color: EnvironmentColor }) =>
      surEnvironnements(request.project, (environnements) => [
        ...environnements,
        {
          id: request.label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          label: request.label,
          color: request.color,
          production: false,
        },
      ]),
    onRenommer: async (request: { project: string; environment: string; label: string }) =>
      surEnvironnements(request.project, (environnements) =>
        environnements.map((declaration) =>
          declaration.id === request.environment
            ? { ...declaration, label: request.label }
            : declaration,
        ),
      ),
    onRecolorier: async (request: {
      project: string
      environment: string
      color: EnvironmentColor
      production: boolean
    }) =>
      surEnvironnements(request.project, (environnements) =>
        environnements.map((declaration) =>
          declaration.id === request.environment
            ? { ...declaration, color: request.color, production: request.production }
            : declaration,
        ),
      ),
    onReordonner: async (request: { project: string; order: string[] }) =>
      surEnvironnements(request.project, (environnements) =>
        request.order.flatMap(
          (id) => environnements.find((declaration) => declaration.id === id) ?? [],
        ),
      ),
    onRetirer: async (request: { project: string; environment: string }) => {
      const emportees = projets
        .find((projet) => projet.name === request.project)
        ?.databases.filter((base) => base.environment === request.environment)
        .map((base) => base.name)
      const suivants = surEnvironnements(
        request.project,
        (environnements) =>
          environnements.filter((declaration) => declaration.id !== request.environment),
        (bases) => bases.filter((base) => base.environment !== request.environment),
      )
      return {
        projects: suivants,
        deletedConnections: emportees ?? [],
        // Un résidu annoncé : le cas que la commande réelle produit sur un Trousseau verrouillé, et
        // le seul moyen de voir cet état de la modale sans pont Tauri.
        leftoverSecrets: emportees && emportees.length > 0 ? ['dorabase/…/…'] : [],
      }
    },
  }

  return (
    <>
      {edition && (
        <NewConnection
          edition={edition}
          // **Les projets, pour que le groupe d'environnements ne soit pas vide.** Le formulaire y lit
          // les environnements déclarés du projet de la base modifiée ; sans la liste, il n'en trouve
          // aucun et la modale s'ouvre sur trois radios absentes.
          projects={projets.map((projet) => ({
            id: projet.name,
            name: projet.name,
            environments: projet.environments,
          }))}
          onClose={() => setEdition(null)}
        />
      )}
      {/* **Le parcours de création, dans la démo** (`24d`). `create_project` ne répond pas hors de la
          webview : la démo fournit donc sa propre création, qui ajoute le projet à son état local. Sans
          elle, l'étape 1 refuserait, et l'étape 2 — c'est-à-dire `A2` — serait inatteignable pour les
          mesures de `08b`. */}
      {creationOuverte && (
        <ParcoursDeCreation
          depart={creationOuverte}
          projets={projets.map((projet) => ({
            id: projet.name,
            name: projet.name,
            environments: projet.environments,
          }))}
          onClose={() => setCreationOuverte(null)}
          onProjets={setProjets}
          onCreate={async (request) => {
            const suivants: Project[] = [
              ...projets,
              {
                name: request.name,
                environments: request.environments.map((declaration) => ({
                  ...declaration,
                  // L'identifiant est dérivé en Rust ; la démo reprend la même règle, en plus simple.
                  id: declaration.label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                })),
                databases: [],
                queries: [],
              },
            ]
            setProjets(suivants)
            return suivants
          }}
        />
      )}
      {preferencesOuvertes && (
        <PreferencesDialog
          preferences={preferences}
          onChange={setPreferences}
          onClose={() => setPreferencesOuvertes(false)}
          version="DoraBase 0.4.2 (arm64)"
        />
      )}
      <Workbench
        projects={projets}
        onOpenPreferences={() => setPreferencesOuvertes(true)}
        rowHeight={preferences.rowHeight}
        passerelle={PASSERELLE}
        passerelleDetail={PASSERELLE_DETAIL}
        passerelleLignes={PASSERELLE_LIGNES}
        passerelleStructures={PASSERELLE_STRUCTURES}
        rowAsInsert={rowAsInsert}
        // La démo rend un SQL **de la forme exacte** que le moteur produit (`11c`) : le pont ne
        // répond pas en Chromium, et un texte d'une autre forme ne prouverait rien de la coloration
        // ni du repli dans un panneau de 330 px.
        // La démo **n'écrit rien** : elle rend un patch inverse plausible pour que `11d` soit visible
        // sans base réelle. Une écriture simulée qui « réussit » toujours ne prouve rien du moteur —
        // c'est ce que les tests Rust sur PostgreSQL vérifient.
        // La démo **n'exécute rien** : elle rend un résultat plausible pour que `12c` soit visible sans
        // base réelle. Une exécution simulée ne prouve rien du moteur — c'est ce que les tests Rust sur
        // PostgreSQL vérifient. La limite ajoutée est annoncée, comme le fait la commande réelle.
        passerelleExecution={{
          explainSql: async (_cle, sql) => ({
            lines: [
              'Sort  (cost=1834.21..1836.71 rows=1000 width=44)',
              "  Sort Key: (date_trunc('day'::text, created_at)) DESC",
              '  ->  HashAggregate  (cost=1784.00..1809.00 rows=1000 width=44)',
              '        ->  Seq Scan on orders o  (cost=0.00..1584.00 rows=40000 width=20)',
              "              Filter: (status = 'paid'::text)",
            ],
            sql: `explain ${sql}`,
            durationMs: 2,
          }),
          runSql: async (cle, sql) => {
            // **Le décor mongo rend des documents**, pas des lignes : sans cela l'arbre de `13b`
            // n'aurait rien à déplier, et `A8` ne se verrait pas en démo.
            if (estMongo(cle.database)) {
              return {
                columns: ['_id', 'sorte', 'horodatage', 'canal', 'contexte'],
                rows: [
                  [
                    // **Le JSON étendu, comme le moteur le rend pour la console** (`13b`) : c'est
                    // ce qui permet à l'arbre de distinguer un identifiant d'une chaîne de 24
                    // caractères hexadécimaux. Un décor qui les enverrait en texte ferait passer
                    // le test là où l'application échouerait.
                    { kind: 'json', value: '{"$oid":"64b7f9a2c3d4e5f60718293a"}' },
                    { kind: 'text', value: 'connexion' },
                    { kind: 'json', value: '{"$date":"2026-08-11T09:12:00Z"}' },
                    { kind: 'text', value: 'ligne' },
                    {
                      kind: 'json',
                      value: '{"agent":"DoraBase 0.4.2","reseau":{"pays":"FR","fai":"local"}}',
                    },
                  ],
                  [
                    { kind: 'json', value: '{"$oid":"64b7f9a2c3d4e5f60718293b"}' },
                    { kind: 'text', value: 'export' },
                    { kind: 'json', value: '{"$date":"2026-08-11T16:30:00Z"}' },
                    // Un champ absent : c'est le cas que la fréquence de `13c` annonce.
                    { kind: 'null' },
                    { kind: 'json', value: '{"lignes":4821,"format":"csv"}' },
                  ],
                ],
                sql: `${sql}\n// $limit 1000 ajouté par DoraBase`,
                durationMs: 61,
                appliedLimit: 1000,
              }
            }
            return {
              columns: ['jour', 'commandes', 'ca_eur'],
              rows: [
                [
                  { kind: 'timestamp', value: '2026-07-31' },
                  { kind: 'int', value: 1204 },
                  { kind: 'decimal', value: '184902.40' },
                ],
                [
                  { kind: 'timestamp', value: '2026-07-30' },
                  { kind: 'int', value: 1188 },
                  { kind: 'decimal', value: '176320.00' },
                ],
              ],
              sql: `${sql}\nlimit 1000`,
              durationMs: 128,
              appliedLimit: 1000,
            }
          },
        }}
        passerelleApply={{
          applyChanges: async (_cle, plan) => ({
            applied: plan.changes.length,
            inverseSql: [
              'BEGIN;',
              ...plan.changes.map(
                (changement) =>
                  `UPDATE "${plan.schema}"."${plan.table}" SET "${changement.column}" = ${
                    changement.expected === null
                      ? 'NULL'
                      : `'${changement.expected.replace(/'/g, "''")}'`
                  } WHERE "${plan.keyColumn}" = '${changement.key}';`,
              ),
              'COMMIT;',
            ].join('\n'),
          }),
        }}
        passerellePreview={{
          previewUpdates: async (_cle, plan) =>
            [
              'BEGIN;',
              ...plan.changes.map(
                (changement) =>
                  `UPDATE "${plan.schema}"."${plan.table}" SET "${changement.column}" = ${
                    changement.value === null ? 'NULL' : `'${changement.value.replace(/'/g, "''")}'`
                  } WHERE "${plan.keyColumn}" = '${changement.key}';`,
              ),
              'COMMIT;',
            ].join('\n'),
        }}
        // `?demo` ouvre l'écran en **mode édition** : c'est le seul moyen de voir `A6` sans base
        // réelle, Playwright ne pilotant pas le pont Tauri.
        onEditDatabase={(projet, base) => setEdition({ project: projet, database: base })}
        onNewProject={() => setCreationOuverte({ etape: 'projet' })}
        // La cible traverse, et il n'y a plus de cas sans elle (26 août 2026) : le geste ne part que
        // d'un palier d'environnement, qui la connaît.
        onNewDatabase={(cible) =>
          setCreationOuverte({
            etape: 'connexion',
            projet: cible.project,
            environnement: cible.environment,
          })
        }
        onCreateConsole={async (projet, base, environnement, nom) =>
          surConsoles(projet, base, environnement, (consoles) => [
            ...consoles,
            { name: nom, sql: '' },
          ])
        }
        onSaveConsole={async (projet, base, environnement, nom, sql) =>
          surConsoles(projet, base, environnement, (consoles) =>
            consoles.map((console) => (console.name === nom ? { ...console, sql } : console)),
          )
        }
        onDeleteConsole={async (projet, base, environnement, nom) =>
          surConsoles(projet, base, environnement, (consoles) =>
            consoles.filter((console) => console.name !== nom),
          )
        }
        onRenameConsole={async (projet, base, environnement, ancien, nouveau) =>
          surConsoles(projet, base, environnement, (consoles) =>
            consoles.map((console) =>
              console.name === ancien ? { ...console, name: nouveau } : console,
            ),
          )
        }
        // La démo renomme **pour de faux** : le pont ne répond pas en Chromium. Ce qui se vérifie ici
        // est le chemin jusqu'à la modale, et le rapport qu'elle sait afficher — d'où un secret
        // introuvable annoncé, cas que la commande réelle produit sur un Trousseau nettoyé à la main.
        // La démo retire **pour de faux** — le pont ne répond pas en Chromium. Un mot de passe
        // résiduel est annoncé : le cas que la commande réelle produit sur un Trousseau verrouillé.
        onDelete={async () => ({ leftoverSecrets: ['Atelier Nord/analytics/prod'] })}
        // La démo renomme **dans son état**, et pas seulement en apparence : `23e` fait suivre la
        // modale au nouveau nom, donc une démo qui rendrait un succès sans renommer ferait disparaître
        // l'écran — ce qui n'arrive pas avec la commande réelle. Le secret introuvable, lui, reste
        // annoncé : c'est le cas que la commande produit sur un Trousseau nettoyé à la main.
        onRenameProject={async (projet, nom) => {
          setProjets((precedents) =>
            precedents.map((p) => (p.name === projet ? { ...p, name: nom } : p)),
          )
          return { missingSecrets: [`${nom}/analytics/prod`], leftoverSecrets: [] }
        }}
        /* La démo renomme **dans son état**, comme `onRenameProject` et pour la même raison : l'arbre
           doit montrer le nouveau nom, sans quoi le geste ne serait pas observable en Chromium.

           Elle **refuse** aussi un nom déjà pris dans le même environnement — la règle de `23b`, que
           le cœur porte et que la démo rejoue faute de pont. C'est ce qui rend le rapport de refus
           atteignable par un test, et le succès reste **muet** : aucune réserve annoncée, donc aucune
           modale, ce que `26` exige du cas normal. */
        onRenameDatabase={async (projet, base, environnement, nouveau) => {
          const homonyme = projets
            .find((p) => p.name === projet)
            ?.databases.some((d) => d.name === nouveau && d.environment === environnement)
          if (homonyme) {
            throw new Error(
              `une connexion « ${nouveau} » est déjà déclarée en « ${environnement} »`,
            )
          }
          setProjets((precedents) =>
            precedents.map((p) =>
              p.name === projet
                ? {
                    ...p,
                    databases: p.databases.map((d) =>
                      d.name === base && d.environment === environnement
                        ? { ...d, name: nouveau }
                        : d,
                    ),
                  }
                : p,
            ),
          )
          return { missingSecrets: [], leftoverSecrets: [] }
        }}
        onProjets={setProjets}
        gestesEnvironnement={gestesEnvironnement}
      />
    </>
  )
}
