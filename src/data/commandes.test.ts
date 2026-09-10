import { invoke } from '@tauri-apps/api/core'
import type { ConfigLoad } from '../domain/config'
import type { RowQuery } from '../domain/engine'
import { TRIO_DE_TEST } from '../screens/NewConnection/pourLesTests'
import { PREFERENCES_PAR_DEFAUT } from '../screens/Preferences/preferences'
import {
  connectionStates,
  databaseKey,
  etatDe,
  interpreter,
  listSchemas,
  readRows,
  surEchecDeCommande,
} from './commandes'

const REQUETE: RowQuery = {
  schema: 'public',
  table: 'orders',
  limit: 'oneHundred',
  offset: 0,
  filters: [],
  sort: [],
}

/** Le seul appel que le double laisse passer, pour distinguer « échec » de « passage ». */
const loadConfigVerte = () => invoke('toujours_vert')

// --- Les quatre issues de `load_config` ---

test('un fichier absent donne un état neuf sans projet', () => {
  expect(interpreter({ kind: 'fresh' })).toEqual({
    kind: 'fresh',
    projects: [],
    preferences: PREFERENCES_PAR_DEFAUT,
    instances: [],
  })
})

test('un fichier lu rend ses projets', () => {
  const projets = [
    {
      name: 'Halle',
      environments: TRIO_DE_TEST,
      databases: [],
      queries: [],
    },
  ]
  expect(
    interpreter({
      kind: 'loaded',
      projects: projets,
      preferences: PREFERENCES_PAR_DEFAUT,
      instances: [],
    }),
  ).toEqual({
    kind: 'loaded',
    projects: projets,
    preferences: PREFERENCES_PAR_DEFAUT,
    instances: [],
  })
})

// **Le piège que `05b` a posé et que `09b` doit respecter.** Un fichier illisible n'a pas zéro
// projet : il a des projets qu'on ne sait pas lire, et l'écriture est bloquée. Le présenter
// comme « aucun projet » inviterait à en créer un, ce qui écraserait le fichier qu'on vient de
// refuser d'ouvrir.
test('un fichier illisible est bloqué, pas vide', () => {
  const issue: ConfigLoad = {
    kind: 'unreadable',
    reason: 'JSON invalide ligne 3',
    quarantinedTo: '/tmp/config.json.corrompu',
  }
  const etat = interpreter(issue)
  expect(etat.kind).toBe('blocked')
  expect(etat.kind === 'blocked' && etat.reason).toContain('JSON invalide')
  // Le chemin de quarantaine est montré : c'est ce qui rend le fichier récupérable.
  expect(etat.kind === 'blocked' && etat.quarantinedTo).toBe('/tmp/config.json.corrompu')
})

test('un fichier trop récent est bloqué, avec les deux versions', () => {
  const etat = interpreter({ kind: 'tooNew', found: 9, supported: 1 })
  expect(etat.kind).toBe('blocked')
  expect(etat.kind === 'blocked' && etat.reason).toContain('version 9')
  expect(etat.kind === 'blocked' && etat.reason).toContain('version 1')
})

test('les deux issues bloquantes ne rendent aucun projet', () => {
  // Rendre des projets partiels laisserait croire que la lecture a marché à moitié.
  for (const issue of [
    { kind: 'unreadable', reason: 'x', quarantinedTo: 'y' },
    { kind: 'tooNew', found: 9, supported: 1 },
  ] as ConfigLoad[]) {
    expect(interpreter(issue).projects).toEqual([])
  }
})

// --- Les clés ---

test('la clé envoyée à Rust reste en trois chaînes', () => {
  // Composer côté front dupliquerait la convention. Le front envoie les trois morceaux ;
  // `registry::cle` les assemble.
  expect(databaseKey('Halle', 'analytics', 'dev')).toEqual({
    project: 'Halle',
    database: 'analytics',
    environment: 'dev',
  })
})

// --- Les états ---

// Une base absente de la table est `never`, pas `offline` : afficher en rouge une base qu'on n'a
// pas ouverte serait faux. C'est la décision du 7 août sur l'arbre lisible sans réseau.
test('une base inconnue est « jamais tentée », pas « hors ligne »', () => {
  expect(etatDe([], 'Halle', 'analytics', 'dev')).toEqual({ kind: 'never' })
})

test('un état connu est rendu tel quel', () => {
  const etat = {
    kind: 'connected' as const,
    serverVersion: 'PostgreSQL 17.6',
    tunnelLocalPort: null,
  }
  const entrees = [
    { key: { project: 'Halle', database: 'analytics', environment: 'dev' }, state: etat },
  ]
  expect(etatDe(entrees, 'Halle', 'analytics', 'dev')).toEqual(etat)
})

// Deux environnements de la même base sont deux connexions distinctes — c'est ce que le triplet
// exprime, et ce qu'une clé indexée par le seul nom de base aurait confondu.
test('deux environnements de la même base ont deux états distincts', () => {
  const entrees = [
    {
      key: { project: 'Halle', database: 'analytics', environment: 'dev' },
      state: { kind: 'connected' as const, serverVersion: 'PG', tunnelLocalPort: null },
    },
    {
      key: { project: 'Halle', database: 'analytics', environment: 'prod' },
      state: { kind: 'offline' as const, reason: 'hôte injoignable' },
    },
  ]
  expect(etatDe(entrees, 'Halle', 'analytics', 'dev').kind).toBe('connected')
  expect(etatDe(entrees, 'Halle', 'analytics', 'prod').kind).toBe('offline')
})

// --- L'annonce d'un échec de commande (8 septembre 2026) ---

// **Le déclencheur de la moitié écran du correctif « connexion perdue ».** Le registre retire
// désormais une connexion dont le socket est mort ; encore faut-il que l'arbre relise ce qu'il en
// dit, et rien ne le lui apprenait quand la configuration ne changeait pas — le cas d'une lecture
// de table ou d'une exécution de console.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (commande: string) => {
    if (commande === 'toujours_vert') return null
    throw new Error(`la commande ${commande} a échoué`)
  }),
}))

test('une commande qui échoue est annoncée aux abonnés', async () => {
  const vues: number[] = []
  const desabonner = surEchecDeCommande(() => vues.push(1))

  await expect(readRows(databaseKey('Halle', 'analytics', 'dev'), REQUETE)).rejects.toThrow()
  expect(vues).toHaveLength(1)

  // Une commande qui réussit n'annonce rien : l'annonce dit un échec, pas un passage.
  await loadConfigVerte()
  expect(vues).toHaveLength(1)

  // Et le désabonnement rend vraiment le silence — sans quoi un arbre démonté continuerait de
  // relire les états, indéfiniment.
  desabonner()
  await expect(listSchemas(databaseKey('Halle', 'analytics', 'dev'))).rejects.toThrow()
  expect(vues).toHaveLength(1)
})

// **La boucle que ce contrôle empêche.** L'unique abonné est l'arbre, et il répond à l'annonce en
// appelant `connection_states`. Si cette commande s'annonçait elle-même, un pont muet — le cas
// ordinaire hors de la webview, donc toute la galerie et tout `pnpm dev` — ferait tourner la
// boucle sans fin.
test('l’échec de « connection_states » ne s’annonce pas lui-même', async () => {
  const vues: number[] = []
  const desabonner = surEchecDeCommande(() => vues.push(1))

  await expect(connectionStates()).rejects.toThrow()
  expect(vues).toHaveLength(0)

  desabonner()
})
