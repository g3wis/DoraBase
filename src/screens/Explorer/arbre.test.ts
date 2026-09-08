import type { EnvironmentDeclaration, Project } from '../../domain/config'
import type { ConnectionState, SchemaInfo, TableSummary } from '../../domain/engine'
import { REGLAGES, TRIO_DE_TEST } from '../NewConnection/pourLesTests'
import {
  aplatir,
  type Charge,
  idBase,
  idEnvironnement,
  idProjet,
  idSchema,
  schemasAffiches,
} from './arbre'

const RIEN: Charge = { schemas: {}, objets: {}, enCours: new Set(), echecs: {} }
const JAMAIS = (): ConnectionState => ({ kind: 'never' })

const P = 'Atelier Nord'
const idP = idProjet(P)
const idProd = idEnvironnement(P, 'prod')

function projet(overrides: Partial<Project> = {}): Project {
  return {
    name: P,
    environments: TRIO_DE_TEST,
    queries: [],
    databases: [
      {
        name: 'analytics',
        engine: 'postgresql',
        environment: 'prod',
        connection: REGLAGES,
        consoles: [],
      },
      { name: 'shop', engine: 'mysql', environment: 'prod', connection: REGLAGES, consoles: [] },
    ],
    ...overrides,
  }
}

const schema = (name: string, over: Partial<SchemaInfo> = {}): SchemaInfo => ({
  name,
  owner: 'atelier',
  system: false,
  counts: { tables: 4, views: 1, functions: 2, indexes: 6 },
  ...over,
})

const table = (name: string, kind: TableSummary['kind'] = 'table'): TableSummary => ({
  name,
  kind,
  rows: { kind: 'estimated', value: 1_900_000 },
  sizeBytes: 2048,
  columnCount: 18,
  primaryKey: 'id',
  lastAnalyze: null,
  comment: null,
})

/** Le projet, l'environnement `prod` et sa connexion `analytics` dépliés. */
const CHEMIN_ANALYTICS = new Set([idP, idProd, idBase(P, 'prod', 'analytics')])

// --- Le dépliage paresseux ---

// **La contrainte transverse appliquée à l'arbre.** Un schéma replié ne produit aucun nœud
// enfant, donc l'écran n'a rien à demander : demander tous les objets de tous les schémas de
// toutes les bases au chargement serait ce que `06c` a découpé pour éviter.
test('un projet replié ne produit que sa propre ligne', () => {
  const noeuds = aplatir([projet()], new Set(), RIEN, JAMAIS)
  expect(noeuds).toHaveLength(1)
  expect(noeuds[0]?.kind).toBe('project')
})

// **Un palier de plus qu'avant** (`25a`) : le projet déplié montre ses environnements *déclarés*,
// tous, et non plus les connexions du seul environnement actif.
test('un projet déplié produit ses environnements, pas ses connexions', () => {
  const noeuds = aplatir([projet()], new Set([idP]), RIEN, JAMAIS)
  expect(noeuds.map((n) => n.kind)).toEqual([
    'project',
    'environment',
    'environment',
    'environment',
  ])
  expect(noeuds.slice(1).map((n) => n.label)).toEqual(['dev', 'staging', 'prod'])
})

test('un environnement déplié produit ses connexions, pas leurs schémas', () => {
  const noeuds = aplatir([projet()], new Set([idP, idProd]), RIEN, JAMAIS)
  const sousProd = noeuds.filter((n) => n.kind === 'database')
  expect(sousProd.map((n) => n.label)).toEqual(['analytics', 'shop'])
})

test('une base dépliée sans schémas chargés annonce un chargement', () => {
  const charge: Charge = { ...RIEN, enCours: new Set([idBase(P, 'prod', 'analytics')]) }
  const noeuds = aplatir([projet()], CHEMIN_ANALYTICS, charge, JAMAIS)
  expect(noeuds.find((n) => n.message)?.label).toBe('Chargement…')
})

test('un schéma replié ne produit aucun objet', () => {
  const charge: Charge = {
    ...RIEN,
    schemas: { [idBase(P, 'prod', 'analytics')]: [schema('public')] },
    objets: { [idSchema(P, 'prod', 'analytics', 'public')]: [table('orders')] },
  }
  const noeuds = aplatir([projet()], CHEMIN_ANALYTICS, charge, JAMAIS)
  // Les objets sont **chargés** mais le schéma est replié : rien ne doit apparaître.
  expect(noeuds.some((n) => n.kind === 'object')).toBe(false)
})

test('un schéma déplié produit ses objets', () => {
  const idS = idSchema(P, 'prod', 'analytics', 'public')
  const deplies = new Set([...CHEMIN_ANALYTICS, idS])
  const charge: Charge = {
    ...RIEN,
    schemas: { [idBase(P, 'prod', 'analytics')]: [schema('public')] },
    objets: { [idS]: [table('orders'), table('orders_by_day', 'view')] },
  }
  const noeuds = aplatir([projet()], deplies, charge, JAMAIS)
  const objets = noeuds.filter((n) => n.kind === 'object')
  expect(objets.map((o) => o.label)).toEqual(['orders', 'orders_by_day'])
  // Les vues portent l'icône et la teinte violette du handoff, les tables la verte.
  expect(objets[0]?.iconColor).toContain('success')
  expect(objets[1]?.iconColor).toContain('violet')
})

// --- Les échecs ---

// Un dépliage qui échoue le dit **sur sa ligne** et ne vide pas l'arbre : une erreur de réseau
// sur un schéma ne doit pas faire disparaître les autres.
test('un dépliage qui échoue le dit sans vider l’arbre', () => {
  const idB = idBase(P, 'prod', 'analytics')
  const charge: Charge = { ...RIEN, echecs: { [idB]: 'hôte injoignable' } }

  const noeuds = aplatir([projet()], CHEMIN_ANALYTICS, charge, JAMAIS)
  expect(noeuds.find((n) => n.message)?.label).toBe('hôte injoignable')
  // L'autre base est toujours là.
  expect(noeuds.some((n) => n.label === 'shop')).toBe(true)
})

// Vide **chargé** n'est pas vide **non chargé** : un schéma sans table est un état normal, et ne
// rien afficher laisserait croire que le dépliage n'a pas abouti.
test('un schéma chargé mais vide le dit', () => {
  const idS = idSchema(P, 'prod', 'analytics', 'public')
  const deplies = new Set([...CHEMIN_ANALYTICS, idS])
  const charge: Charge = {
    ...RIEN,
    schemas: { [idBase(P, 'prod', 'analytics')]: [schema('public')] },
    objets: { [idS]: [] },
  }
  const noeuds = aplatir([projet()], deplies, charge, JAMAIS)
  expect(noeuds.find((n) => n.message)?.label).toBe('Aucun objet')
})

test('une ligne de message n’est pas sélectionnable', () => {
  const idB = idBase(P, 'prod', 'analytics')
  const charge: Charge = { ...RIEN, echecs: { [idB]: 'échec' } }
  const noeuds = aplatir([projet()], CHEMIN_ANALYTICS, charge, JAMAIS)
  expect(noeuds.find((n) => n.message)?.message).toBe(true)
})

// --- Les états de connexion ---

// `never` n'a **aucun badge** : une base qu'on n'a pas ouverte n'est pas dans un état
// remarquable, et lui coller une marque la ferait paraître en défaut.
test('une base jamais ouverte ne porte aucun badge d’état', () => {
  const noeuds = aplatir([projet()], new Set([idP, idProd]), RIEN, JAMAIS)
  expect(noeuds.find((n) => n.kind === 'database')?.badge).toBeUndefined()
})

test('les quatre états produisent des annonces distinctes', () => {
  const etats: ConnectionState[] = [
    { kind: 'never' },
    { kind: 'connecting' },
    { kind: 'connected', serverVersion: 'PG', tunnelLocalPort: null },
    { kind: 'offline', reason: 'hôte injoignable' },
  ]
  const annonces = etats.map(
    (etat) =>
      aplatir([projet()], new Set([idP, idProd]), RIEN, () => etat).find(
        (n) => n.kind === 'database',
      )?.announce,
  )
  expect(new Set(annonces).size).toBe(4)
})

// L'état est dans le **nom accessible**, pas seulement dans une couleur : un point vert et un
// point rouge sont indiscernables pour une part des utilisateurs.
test('l’état d’une base est dans son nom accessible', () => {
  const hors: ConnectionState = { kind: 'offline', reason: 'hôte injoignable' }
  const noeuds = aplatir([projet()], new Set([idP, idProd]), RIEN, () => hors)
  expect(noeuds.find((n) => n.kind === 'database')?.announce).toContain('hôte injoignable')
})

// L'état est demandé **avec l'environnement de la connexion** : deux connexions homonymes de deux
// environnements n'ont aucune raison d'être dans le même état.
test('l’état est demandé pour l’environnement de la connexion', () => {
  const p = projet({
    databases: [
      {
        name: 'analytics',
        engine: 'postgresql',
        environment: 'dev',
        connection: REGLAGES,
        consoles: [],
      },
      {
        name: 'analytics',
        engine: 'postgresql',
        environment: 'prod',
        connection: REGLAGES,
        consoles: [],
      },
    ],
  })
  const demandes: string[] = []
  aplatir(
    [p],
    new Set([idP, idEnvironnement(P, 'dev'), idProd]),
    RIEN,
    (project, database, environment) => {
      demandes.push(`${project}/${environment}/${database}`)
      return { kind: 'never' }
    },
  )
  expect(demandes).toEqual([`${P}/dev/analytics`, `${P}/prod/analytics`])
})

// --- Les identités ---

// Dérivées du **chemin** : deux nœuds homonymes de branches différentes ne se confondent pas.
test('deux schémas homonymes de bases différentes ont deux identités', () => {
  expect(idSchema('P', 'prod', 'a', 'public')).not.toBe(idSchema('P', 'prod', 'b', 'public'))
})

/*
 * **La collision d'identité que le palier d'environnement rend possible** (`25a`).
 *
 * `idBase` ne portait pas l'environnement, et c'était justifié : l'arbre ne montrait que les
 * connexions de l'environnement actif, donc deux connexions homonymes n'étaient jamais listées
 * ensemble. La prémisse est tombée. Sans l'identifiant dans la clé, les deux `analytics`
 * partageraient leur dépliage, leur sélection, leur clé de rendu React — et surtout leur entrée dans
 * `charge.schemas`, ce qui afficherait la structure d'un serveur sous la ligne d'un autre.
 */
const DEUX_ANALYTICS = projet({
  databases: [
    {
      name: 'analytics',
      engine: 'postgresql',
      environment: 'dev',
      connection: REGLAGES,
      consoles: [],
    },
    {
      name: 'analytics',
      engine: 'postgresql',
      environment: 'prod',
      connection: REGLAGES,
      consoles: [],
    },
  ],
})

test('deux connexions homonymes de deux environnements ont deux identités', () => {
  expect(idBase(P, 'dev', 'analytics')).not.toBe(idBase(P, 'prod', 'analytics'))

  const noeuds = aplatir(
    [DEUX_ANALYTICS],
    new Set([idP, idEnvironnement(P, 'dev'), idProd]),
    RIEN,
    JAMAIS,
  )
  const bases = noeuds.filter((n) => n.kind === 'database')
  expect(bases).toHaveLength(2)
  expect(new Set(bases.map((b) => b.id)).size).toBe(2)
  expect(bases.map((b) => b.environment)).toEqual(['dev', 'prod'])
})

test('deux connexions homonymes se déplient indépendamment', () => {
  const noeuds = aplatir(
    [DEUX_ANALYTICS],
    // Seule celle de dev est dépliée.
    new Set([idP, idEnvironnement(P, 'dev'), idProd, idBase(P, 'dev', 'analytics')]),
    RIEN,
    JAMAIS,
  )
  const bases = noeuds.filter((n) => n.kind === 'database')
  expect(bases.map((b) => b.chevron)).toEqual(['open', 'closed'])
})

// Le plus grave des symptômes de la collision : l'entrée de `charge.schemas` d'une connexion
// peuplant la ligne de l'autre.
test('les schémas chargés d’une connexion ne peuplent pas son homonyme', () => {
  const deplies = new Set([
    idP,
    idEnvironnement(P, 'dev'),
    idProd,
    idBase(P, 'dev', 'analytics'),
    idBase(P, 'prod', 'analytics'),
  ])
  const charge: Charge = {
    ...RIEN,
    schemas: { [idBase(P, 'dev', 'analytics')]: [schema('atelier')] },
  }
  const noeuds = aplatir([DEUX_ANALYTICS], deplies, charge, JAMAIS)

  expect(noeuds.filter((n) => n.kind === 'schema').map((n) => n.label)).toEqual(['atelier'])
  // Celle de production n'a rien de chargé : elle dit son vide, elle n'emprunte pas le schéma
  // du voisin.
  const idBProd = idBase(P, 'prod', 'analytics')
  const rang = noeuds.findIndex((n) => n.id === idBProd)
  expect(noeuds[rang + 1]?.message).toBe(true)
  expect(noeuds[rang + 1]?.label).toBe('Aucun objet')
})

test('deux consoles homonymes de deux environnements ont deux identités', () => {
  const p = projet({
    databases: [
      {
        name: 'analytics',
        engine: 'postgresql',
        environment: 'dev',
        connection: REGLAGES,
        consoles: [{ name: 'Exploration', sql: '' }],
      },
      {
        name: 'analytics',
        engine: 'postgresql',
        environment: 'prod',
        connection: REGLAGES,
        consoles: [{ name: 'Exploration', sql: '' }],
      },
    ],
  })
  const deplies = new Set([
    idP,
    idEnvironnement(P, 'dev'),
    idProd,
    idBase(P, 'dev', 'analytics'),
    idBase(P, 'prod', 'analytics'),
  ])
  const consoles = aplatir([p], deplies, RIEN, JAMAIS).filter((n) => n.kind === 'console')
  expect(consoles).toHaveLength(2)
  expect(new Set(consoles.map((c) => c.id)).size).toBe(2)
})

test('les cinq profondeurs sont celles de la table d’indentation de TreeRow', () => {
  const idS = idSchema(P, 'prod', 'analytics', 'public')
  const deplies = new Set([...CHEMIN_ANALYTICS, idS])
  const charge: Charge = {
    ...RIEN,
    schemas: { [idBase(P, 'prod', 'analytics')]: [schema('public')] },
    objets: { [idS]: [table('orders')] },
  }
  const noeuds = aplatir([projet()], deplies, charge, JAMAIS)
  const parKind = new Map(noeuds.map((n) => [n.kind, n.depth]))
  // Cinq niveaux exactement, depuis `25a` : `INDENT` en compte cinq, et le palier
  // d'environnement s'insère entre le projet et la connexion.
  expect(parKind.get('project')).toBe(0)
  expect(parKind.get('environment')).toBe(1)
  expect(parKind.get('database')).toBe(2)
  expect(parKind.get('schema')).toBe(3)
  expect(parKind.get('object')).toBe(4)
})

test('une console est au palier du schéma, son frère', () => {
  const p = projet({
    databases: [
      {
        name: 'analytics',
        engine: 'postgresql',
        environment: 'prod',
        connection: REGLAGES,
        consoles: [{ name: 'Exploration', sql: 'select 1' }],
      },
    ],
  })
  const noeuds = aplatir([p], CHEMIN_ANALYTICS, RIEN, JAMAIS)
  expect(noeuds.find((n) => n.kind === 'console')?.depth).toBe(3)
})

// --- Le palier d'environnement ---

/** Un environnement de production **qui ne s'appelle pas « prod »** : le drapeau seul décide. */
const ATELIER: EnvironmentDeclaration[] = [
  { id: 'atelier', label: 'Atelier', color: 'green', production: true },
  { id: 'bac', label: 'bac à sable', color: 'slate', production: false },
]

test('le badge PROD suit le drapeau, pas le libellé', () => {
  const p = projet({
    environments: ATELIER,
    databases: [
      {
        name: 'catalogue',
        engine: 'postgresql',
        environment: 'atelier',
        connection: REGLAGES,
        consoles: [],
      },
    ],
  })
  const noeuds = aplatir([p], new Set([idP]), RIEN, JAMAIS)
  const environnements = noeuds.filter((n) => n.kind === 'environment')

  // « Atelier » n'a rien de « prod » dans son nom, et porte pourtant le badge.
  expect(environnements[0]?.label).toBe('Atelier')
  expect(environnements[0]?.badge).toEqual({ text: 'PROD', tone: 'danger' })
  expect(environnements[1]?.badge).toBeUndefined()
})

// Deux canaux pour deux informations : la couleur déclarée voyage par `iconColor`, le drapeau par
// le badge. Un environnement marqué production et coloré en vert porterait sinon un badge vert, et
// le badge d'alerte cesserait d'alerter.
test('la couleur déclarée teinte l’icône, et ne décide pas du badge', () => {
  const p = projet({ environments: ATELIER, databases: [] })
  const environnements = aplatir([p], new Set([idP]), RIEN, JAMAIS).filter(
    (n) => n.kind === 'environment',
  )
  // **`pin` et non `srv`** : à 13 px, `srv` ne se distinguait pas du `db` de la connexion juste en
  // dessous — deux paliers voisins au même glyphe à bandes.
  expect(environnements[0]?.icon).toBe('pin')
  // Et surtout : ce n'est pas un disque plein. L'icône garde la colonne que l'indentation aligne.
  expect(environnements[0]?.icon).not.toBe('dot')
  expect(environnements[0]?.iconColor).toBe('var(--success)')
  // Vert **et** production : le badge reste `danger`.
  expect(environnements[0]?.badge?.tone).toBe('danger')
  expect(environnements[1]?.iconColor).toBe('var(--ink-4)')
})

test('un environnement replié annonce son nombre de connexions', () => {
  const noeuds = aplatir([projet()], new Set([idP]), RIEN, JAMAIS)
  const parLibelle = new Map(noeuds.map((n) => [n.label, n.meta]))
  expect(parLibelle.get('prod')).toBe('2 connexions')
  // Zéro prend le singulier en français, comme un.
  expect(parLibelle.get('dev')).toBe('0 connexion')
})

test('un environnement à une seule connexion l’annonce au singulier', () => {
  const p = projet({
    databases: [
      {
        name: 'catalogue',
        engine: 'postgresql',
        environment: 'dev',
        connection: REGLAGES,
        consoles: [],
      },
    ],
  })
  const noeuds = aplatir([p], new Set([idP]), RIEN, JAMAIS)
  expect(noeuds.find((n) => n.label === 'dev')?.meta).toBe('1 connexion')
})

test('un environnement déplié n’annonce plus son compte', () => {
  const noeuds = aplatir([projet()], new Set([idP, idProd]), RIEN, JAMAIS)
  expect(noeuds.find((n) => n.kind === 'environment' && n.label === 'prod')?.meta).toBeUndefined()
})

// **Un environnement vide le dit** (`23g`) : un nœud déplié sans enfant se lit comme un chargement
// en cours. Ici rien ne charge — la liste vient de la configuration — donc le vide est un fait.
test('un environnement déplié sans connexion le dit, au palier 2', () => {
  const noeuds = aplatir([projet()], new Set([idP, idEnvironnement(P, 'staging')]), RIEN, JAMAIS)
  const vide = noeuds.find((n) => n.message)
  expect(vide?.label).toBe('Aucune connexion déclarée en staging')
  expect(vide?.depth).toBe(2)
})

// Le libellé du message est celui de la **déclaration**, pas l'identifiant : c'est ce que
// l'utilisateur a écrit qu'il faut lui relire.
test('la ligne de vide reprend le libellé déclaré, non l’identifiant', () => {
  const p = projet({ environments: ATELIER, databases: [] })
  const noeuds = aplatir([p], new Set([idP, idEnvironnement(P, 'bac')]), RIEN, JAMAIS)
  expect(noeuds.some((n) => n.label === 'Aucune connexion déclarée en bac à sable')).toBe(true)
})

test('un environnement porte ses coordonnées, pour que l’écran sache quoi demander', () => {
  const noeuds = aplatir([projet()], new Set([idP]), RIEN, JAMAIS)
  const prod = noeuds.find((n) => n.kind === 'environment' && n.label === 'prod')
  expect(prod?.project).toBe(P)
  expect(prod?.environment).toBe('prod')
  expect(prod?.connexions).toBe(2)
})

// --- La ligne projet ---

// Depuis `23b` la connexion est l'unité : une base ne porte plus de variantes.
test('un projet replié annonce son nombre de connexions', () => {
  const noeuds = aplatir([projet()], new Set(), RIEN, JAMAIS)
  expect(noeuds[0]?.meta).toBe('2 connexions')
})

test('un projet à une seule connexion l’annonce au singulier', () => {
  const p = projet({
    databases: [
      {
        name: 'analytics',
        engine: 'postgresql',
        environment: 'dev',
        connection: REGLAGES,
        consoles: [],
      },
    ],
  })
  expect(aplatir([p], new Set(), RIEN, JAMAIS)[0]?.meta).toBe('1 connexion')
})

test('un projet déplié n’annonce plus son compte', () => {
  // Le compte sert à savoir ce qu'on ne voit pas ; déplié, on le voit.
  const noeuds = aplatir([projet()], new Set([idP]), RIEN, JAMAIS)
  expect(noeuds[0]?.meta).toBeUndefined()
})

/*
 * **La ligne projet n'a plus de badge d'environnement** (`25a`).
 *
 * Il nommait l'environnement *actif*, qui n'existe plus, et appelait un trio en dur que `23g`
 * s'était engagée à effacer. L'agréger en « ce projet contient une production » serait inventer un
 * état composite, ce que `09c` a déjà refusé pour le point de la pastille.
 */
test('la ligne projet ne porte aucun badge', () => {
  const noeuds = aplatir([projet()], new Set(), RIEN, JAMAIS)
  expect(noeuds[0]?.badge).toBeUndefined()

  const avecProduction = aplatir([projet({ environments: ATELIER })], new Set(), RIEN, JAMAIS)
  expect(avecProduction[0]?.badge).toBeUndefined()
})

// --- Les schémas affichés (`API-33`) ---

const CATALOGUE = [
  schema('public'),
  schema('reporting'),
  schema('pg_catalog', { system: true }),
  schema('information_schema', { system: true }),
]

/** Les noms rendus, dans l'ordre — c'est l'ordre qui compte autant que l'ensemble. */
const noms = (schemas: readonly SchemaInfo[]) => schemas.map((s) => s.name)

test('rien de réglé montre les non-système, et non « public » seul', () => {
  // **Le défaut ne change rien à l'existant** : c'est ce que l'arbre montrait avant `API-33`, et le
  // seul choix qui ne vide pas l'arbre des bases où `public` est justement le schéma vide.
  expect(noms(schemasAffiches(CATALOGUE, null))).toEqual(['public', 'reporting'])
  expect(noms(schemasAffiches(CATALOGUE, undefined))).toEqual(['public', 'reporting'])
})

test('la liste vide est un réglage : aucun schéma n’est montré', () => {
  // C'est la distinction qui tient tout le reste — `null` n'est pas `[]`, comme « jamais tentée »
  // n'est pas « hors ligne ». La confondre rendrait impossible de tout décocher.
  expect(schemasAffiches(CATALOGUE, [])).toEqual([])
})

test('un schéma de catalogue coché est montré', () => {
  // C'est ce qui rend son interrupteur honnête : la lecture les rend, et cette fonction ne les
  // traite pas à part. Un contrôle sans effet aurait été pire que son absence.
  expect(noms(schemasAffiches(CATALOGUE, ['pg_catalog']))).toEqual(['pg_catalog'])
})

test('un nom réglé qui ne correspond à rien est simplement absent', () => {
  // Le gestionnaire n'exige pas que la connexion soit ouverte pour enregistrer, et un schéma peut
  // avoir été retiré côté serveur depuis : une intersection, jamais une promesse.
  expect(noms(schemasAffiches(CATALOGUE, ['reporting', 'parti']))).toEqual(['reporting'])
})

test('l’ordre rendu est celui du catalogue, non celui des cases cochées', () => {
  // Sinon l'ordre des lignes de l'arbre dépendrait de la suite des clics — un ordre que personne
  // n'a choisi.
  expect(noms(schemasAffiches(CATALOGUE, ['reporting', 'public']))).toEqual(['public', 'reporting'])
})
