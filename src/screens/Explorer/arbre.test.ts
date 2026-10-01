import type { Folder, FolderTree } from '../../domain/config'
import type { ConnectionState, SchemaInfo, TableSummary } from '../../domain/engine'
import { arbreDeTest, connexionDeTest, ID_DE_TEST, trioDeTest } from '../NewConnection/pourLesTests'
import {
  aplatir,
  type Charge,
  idBase,
  idConsole,
  idDossier,
  idSchema,
  type Noeud,
  schemasAffiches,
} from './arbre'

const RIEN: Charge = { schemas: {}, objets: {}, enCours: new Set(), echecs: {} }
const JAMAIS = (): ConnectionState => ({ kind: 'never' })

const ANALYTICS = 'c00000000000a001'
const SHOP = 'c00000000000a002'

/** Le décor migré : `Atelier Nord` › `prod` porte `analytics` et `shop`. */
function arbre(): FolderTree {
  return arbreDeTest(
    trioDeTest({
      prod: [
        connexionDeTest(ANALYTICS, 'analytics'),
        connexionDeTest(SHOP, 'shop', { engine: 'mysql' }),
      ],
    }),
  )
}

const idRacine = idDossier(ID_DE_TEST.racine)
const idProd = idDossier(ID_DE_TEST.prod)

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

/** Le dossier racine, le sous-dossier `prod` et sa connexion `analytics` dépliés. */
const CHEMIN_ANALYTICS = new Set([idRacine, idProd, idBase(ANALYTICS)])

// --- Le dépliage paresseux ---

test('un dossier replié ne produit que sa propre ligne', () => {
  const noeuds = aplatir(arbre(), new Set(), RIEN, JAMAIS)
  expect(noeuds).toHaveLength(1)
  expect(noeuds[0]?.kind).toBe('folder')
})

test('un dossier déplié produit ses sous-dossiers dans l’ordre déclaré, pas leurs connexions', () => {
  const noeuds = aplatir(arbre(), new Set([idRacine]), RIEN, JAMAIS)
  expect(noeuds.map((n) => n.kind)).toEqual(['folder', 'folder', 'folder', 'folder'])
  expect(noeuds.slice(1).map((n) => n.label)).toEqual(['dev', 'staging', 'prod'])
})

test('un sous-dossier déplié produit ses connexions, pas leurs schémas', () => {
  const noeuds = aplatir(arbre(), new Set([idRacine, idProd]), RIEN, JAMAIS)
  expect(noeuds.filter((n) => n.kind === 'database').map((n) => n.label)).toEqual([
    'analytics',
    'shop',
  ])
})

test('les sous-dossiers viennent avant les connexions du même dossier', () => {
  const racine: Folder = {
    ...trioDeTest(),
    connections: [connexionDeTest('c0000000000000r1', 'racine-db')],
  }
  const noeuds = aplatir(arbreDeTest(racine), new Set([idRacine]), RIEN, JAMAIS)
  expect(noeuds.map((n) => n.kind)).toEqual(['folder', 'folder', 'folder', 'folder', 'database'])
})

test('une connexion rangée à la racine est au niveau 0', () => {
  const a: FolderTree = { folders: [], connections: [connexionDeTest('c0000000000000r2', 'seule')] }
  const [noeud] = aplatir(a, new Set(), RIEN, JAMAIS)
  expect(noeud?.kind).toBe('database')
  expect(noeud?.depth).toBe(0)
  expect(noeud?.indent).toBe('8px')
})

test('une base dépliée sans schémas chargés annonce un chargement', () => {
  const charge: Charge = { ...RIEN, enCours: new Set([idBase(ANALYTICS)]) }
  const noeuds = aplatir(arbre(), CHEMIN_ANALYTICS, charge, JAMAIS)
  expect(noeuds.find((n) => n.message)?.label).toBe('Chargement…')
})

test('un schéma replié ne produit aucun objet', () => {
  const charge: Charge = {
    ...RIEN,
    schemas: { [idBase(ANALYTICS)]: [schema('public')] },
    objets: { [idSchema(ANALYTICS, 'public')]: [table('orders')] },
  }
  const noeuds = aplatir(arbre(), CHEMIN_ANALYTICS, charge, JAMAIS)
  expect(noeuds.some((n) => n.kind === 'object')).toBe(false)
})

test('un schéma déplié produit ses objets', () => {
  const idS = idSchema(ANALYTICS, 'public')
  const charge: Charge = {
    ...RIEN,
    schemas: { [idBase(ANALYTICS)]: [schema('public')] },
    objets: { [idS]: [table('orders'), table('orders_by_day', 'view')] },
  }
  const noeuds = aplatir(arbre(), new Set([...CHEMIN_ANALYTICS, idS]), charge, JAMAIS)
  const objets = noeuds.filter((n) => n.kind === 'object')
  expect(objets.map((o) => o.label)).toEqual(['orders', 'orders_by_day'])
  // **Le nom que le serveur connaît, à côté du libellé** (#162) : c'est lui que « Copier le nom »
  // rend, et il vient de `objet.name`.
  expect(objets.map((o) => o.object)).toEqual(['orders', 'orders_by_day'])
  expect(objets[0]?.iconColor).toContain('success')
  expect(objets[1]?.iconColor).toContain('violet')
})

// --- Les échecs et les vides ---

test('un dépliage qui échoue le dit sans vider l’arbre', () => {
  const charge: Charge = { ...RIEN, echecs: { [idBase(ANALYTICS)]: 'hôte injoignable' } }
  const noeuds = aplatir(arbre(), CHEMIN_ANALYTICS, charge, JAMAIS)
  expect(noeuds.find((n) => n.message)?.label).toBe('hôte injoignable')
  expect(noeuds.some((n) => n.label === 'shop')).toBe(true)
})

test('un schéma chargé mais vide le dit', () => {
  const idS = idSchema(ANALYTICS, 'public')
  const charge: Charge = {
    ...RIEN,
    schemas: { [idBase(ANALYTICS)]: [schema('public')] },
    objets: { [idS]: [] },
  }
  const noeuds = aplatir(arbre(), new Set([...CHEMIN_ANALYTICS, idS]), charge, JAMAIS)
  expect(noeuds.find((n) => n.message)?.label).toBe('Aucun objet')
})

test('une ligne de message n’est pas sélectionnable', () => {
  const charge: Charge = { ...RIEN, enCours: new Set([idBase(ANALYTICS)]) }
  const noeuds = aplatir(arbre(), CHEMIN_ANALYTICS, charge, JAMAIS)
  expect(noeuds.find((n) => n.message)?.message).toBe(true)
})

test('un dossier déplié et vide le dit, au niveau de ses enfants', () => {
  const noeuds = aplatir(arbre(), new Set([idRacine, idDossier(ID_DE_TEST.dev)]), RIEN, JAMAIS)
  const vide = noeuds.find((n) => n.message)
  expect(vide?.label).toBe('Dossier vide')
  // `dev` est au niveau 1 : son message est au niveau 2, à l'indentation d'un enfant.
  expect(vide?.depth).toBe(2)
  expect(vide?.indent).toBe('36px')
})

// --- Les états de connexion ---

test('une base jamais ouverte ne porte aucun badge d’état', () => {
  const noeuds = aplatir(arbre(), new Set([idRacine, idProd]), RIEN, JAMAIS)
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
      aplatir(arbre(), new Set([idRacine, idProd]), RIEN, () => etat).find(
        (n) => n.kind === 'database',
      )?.announce,
  )
  expect(new Set(annonces).size).toBe(4)
})

test('l’état d’une base est dans son nom accessible', () => {
  const hors: ConnectionState = { kind: 'offline', reason: 'hôte injoignable' }
  const noeuds = aplatir(arbre(), new Set([idRacine, idProd]), RIEN, () => hors)
  expect(noeuds.find((n) => n.kind === 'database')?.announce).toContain('hôte injoignable')
})

test('l’état est demandé par l’identifiant de la connexion', () => {
  const demandes: string[] = []
  aplatir(arbre(), new Set([idRacine, idProd]), RIEN, (connection) => {
    demandes.push(connection)
    return { kind: 'never' }
  })
  expect(demandes).toEqual([ANALYTICS, SHOP])
})

// --- Les identités ---

test('deux connexions homonymes de deux dossiers ont deux identités', () => {
  const a = arbreDeTest(
    trioDeTest({
      dev: [connexionDeTest('c0000000000000e1', 'analytics')],
      prod: [connexionDeTest('c0000000000000e2', 'analytics')],
    }),
  )
  const noeuds = aplatir(a, new Set([idRacine, idDossier(ID_DE_TEST.dev), idProd]), RIEN, JAMAIS)
  const ids = noeuds.filter((n) => n.kind === 'database').map((n) => n.id)
  expect(ids).toHaveLength(2)
  expect(new Set(ids).size).toBe(2)
})

test('les schémas chargés d’une connexion ne peuplent pas son homonyme', () => {
  const a = arbreDeTest(
    trioDeTest({
      dev: [connexionDeTest('c0000000000000e1', 'analytics')],
      prod: [connexionDeTest('c0000000000000e2', 'analytics')],
    }),
  )
  const charge: Charge = { ...RIEN, schemas: { [idBase('c0000000000000e2')]: [schema('public')] } }
  const deplies = new Set([
    idRacine,
    idDossier(ID_DE_TEST.dev),
    idProd,
    idBase('c0000000000000e1'),
    idBase('c0000000000000e2'),
  ])
  const noeuds = aplatir(a, deplies, charge, JAMAIS)
  const schemas = noeuds.filter((n) => n.kind === 'schema')
  expect(schemas).toHaveLength(1)
  expect(schemas[0]?.connection).toBe('c0000000000000e2')
})

/**
 * **L'identité d'un nœud ne dépend d'aucun nom** (#166) : renommer un dossier ou une connexion ne
 * change aucune identité — donc ni le dépliage, ni la sélection, ni le cache ne sont à réindexer.
 * Sabotage : composer `idBase` ou `idDossier` avec le nom fait tomber ce test.
 */
test('renommer un dossier ou une connexion ne change aucune identité', () => {
  const idS = idSchema(ANALYTICS, 'public')
  const charge: Charge = {
    ...RIEN,
    schemas: { [idBase(ANALYTICS)]: [schema('public')] },
    objets: { [idS]: [table('orders')] },
  }
  const deplies = new Set([...CHEMIN_ANALYTICS, idS])
  const avant = aplatir(arbre(), deplies, charge, JAMAIS)

  const renomme = arbreDeTest(
    trioDeTest(
      {
        prod: [
          connexionDeTest(ANALYTICS, 'analytique'),
          connexionDeTest(SHOP, 'shop', { engine: 'mysql' }),
        ],
      },
      { name: 'Atelier Sud' },
    ),
  )
  const apres = aplatir(renomme, deplies, charge, JAMAIS)

  expect(apres.map((n) => n.id)).toEqual(avant.map((n) => n.id))
  // Et le cache suit sans rien réindexer : l'objet est toujours sous son schéma, déplié.
  expect(apres.some((n) => n.kind === 'object' && n.label === 'orders')).toBe(true)
  expect(apres.find((n) => n.kind === 'database')?.label).toBe('analytique')
})

test('les identités portent les identifiants, jamais les noms', () => {
  expect(idDossier(ID_DE_TEST.prod)).toBe(`f:${ID_DE_TEST.prod}`)
  expect(idBase(ANALYTICS)).toBe(`d:${ANALYTICS}`)
  expect(idConsole(ANALYTICS, 'console 1')).toBe(`c:${ANALYTICS}/console 1`)
  expect(idSchema(ANALYTICS, 'public')).toBe(`s:${ANALYTICS}/public`)
})

// --- Les profondeurs et l'indentation ---

test('la forme migrée reproduit les cinq indentations du mockup', () => {
  const charge: Charge = {
    ...RIEN,
    schemas: { [idBase(ANALYTICS)]: [schema('public')] },
    objets: { [idSchema(ANALYTICS, 'public')]: [table('orders')] },
  }
  const a = arbreDeTest(
    trioDeTest({
      prod: [connexionDeTest(ANALYTICS, 'analytics', { consoles: [{ name: 'c', sql: '' }] })],
    }),
  )
  const noeuds = aplatir(
    a,
    new Set([...CHEMIN_ANALYTICS, idSchema(ANALYTICS, 'public')]),
    charge,
    JAMAIS,
  )
  const par = (kind: Noeud['kind'], label?: string) =>
    noeuds.find((n) => n.kind === kind && (label === undefined || n.label === label))
  expect(par('folder', 'Atelier Nord')?.indent).toBe('8px')
  expect(par('folder', 'prod')?.indent).toBe('22px')
  expect(par('database')?.indent).toBe('36px')
  expect(par('console')?.indent).toBe('52px')
  expect(par('schema')?.indent).toBe('52px')
  expect(par('object')?.indent).toBe('68px')
  // Et les niveaux logiques : console et schéma sont frères, un cran sous la connexion.
  expect([par('database')?.depth, par('console')?.depth, par('schema')?.depth]).toEqual([2, 3, 3])
  expect(par('object')?.depth).toBe(4)
})

/**
 * **Six niveaux de dossiers**, et rien ne plafonne : le niveau logique, l'indentation et le message
 * « Dossier vide » suivent au bon niveau.
 */
test('un dossier imbriqué à six niveaux porte la bonne profondeur et son message au bon niveau', () => {
  let feuille: Folder = { id: 'f6', name: 'n6', readOnly: false }
  for (let rang = 5; rang >= 1; rang -= 1) {
    feuille = { id: `f${rang}`, name: `n${rang}`, readOnly: false, folders: [feuille] }
  }
  const deplies = new Set(['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map(idDossier))
  const noeuds = aplatir(arbreDeTest(feuille), deplies, RIEN, JAMAIS)
  expect(noeuds.filter((n) => n.kind === 'folder').map((n) => n.depth)).toEqual([0, 1, 2, 3, 4, 5])
  expect(noeuds.find((n) => n.label === 'n6')?.indent).toBe('78px')
  const vide = noeuds.at(-1)
  expect(vide?.message).toBe(true)
  expect(vide?.label).toBe('Dossier vide')
  expect(vide?.depth).toBe(6)
  expect(vide?.indent).toBe('92px')
})

test('trois dossiers : la connexion est à 50, ce qui est dessous à 66 et 82', () => {
  const connexion = connexionDeTest('c0000000000000t1', 'profonde')
  const a = arbreDeTest({
    id: 'f1',
    name: 'un',
    readOnly: false,
    folders: [
      {
        id: 'f2',
        name: 'deux',
        readOnly: false,
        folders: [{ id: 'f3', name: 'trois', readOnly: false, connections: [connexion] }],
      },
    ],
  })
  const idB = idBase('c0000000000000t1')
  const idS = idSchema('c0000000000000t1', 'public')
  const charge: Charge = {
    ...RIEN,
    schemas: { [idB]: [schema('public')] },
    objets: { [idS]: [table('orders')] },
  }
  const noeuds = aplatir(
    a,
    new Set([idDossier('f1'), idDossier('f2'), idDossier('f3'), idB, idS]),
    charge,
    JAMAIS,
  )
  expect(noeuds.map((n) => n.indent)).toEqual(['8px', '22px', '36px', '50px', '66px', '82px'])
})

// --- Les dossiers ---

test('un dossier replié annonce le compte de ses connexions, à toute profondeur', () => {
  const [racine] = aplatir(arbre(), new Set(), RIEN, JAMAIS)
  expect(racine?.meta).toBe('2 connexions')
  expect(racine?.connexions).toBe(2)
})

test('un dossier déplié n’annonce plus son compte', () => {
  const [racine] = aplatir(arbre(), new Set([idRacine]), RIEN, JAMAIS)
  expect(racine?.meta).toBeUndefined()
})

test('la couleur déclarée teinte l’icône, et l’absence de couleur prend la teinte des projets', () => {
  const noeuds = aplatir(arbre(), new Set([idRacine]), RIEN, JAMAIS)
  expect(noeuds[0]?.iconColor).toBe('var(--accent-deep)')
  expect(noeuds.find((n) => n.label === 'prod')?.iconColor).toBe('var(--danger)')
  expect(noeuds.every((n) => n.kind !== 'folder' || n.icon === 'pin')).toBe(true)
})

test('le verrou et l’annonce suivent le dossier qui déclare la lecture seule, lui seul', () => {
  const noeuds = aplatir(arbre(), new Set([idRacine]), RIEN, JAMAIS)
  const prod = noeuds.find((n) => n.label === 'prod')
  expect(prod?.readOnly).toBe(true)
  expect(prod?.announce).toBe('prod · lecture seule')
  expect(noeuds.find((n) => n.label === 'dev')?.readOnly).toBeUndefined()
})

test('un sous-dossier d’un dossier en lecture seule sait qui la lui impose', () => {
  const racine: Folder = {
    id: 'f1',
    name: 'Coffre',
    readOnly: true,
    folders: [{ id: 'f2', name: 'dedans', readOnly: false }],
  }
  const noeuds = aplatir(arbreDeTest(racine), new Set([idDossier('f1')]), RIEN, JAMAIS)
  expect(noeuds[0]?.imposeePar).toBeUndefined()
  expect(noeuds[1]?.imposeePar).toBe('Coffre')
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
