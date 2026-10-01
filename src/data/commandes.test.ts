import { invoke } from '@tauri-apps/api/core'
import type { ConfigLoad } from '../domain/arbre'
import type { RowQuery } from '../domain/engine'
import { arbreDeTest, trioDeTest } from '../screens/NewConnection/pourLesTests'
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

// --- Les cinq issues de `load_config` ---

test('un fichier absent donne un état neuf, un arbre vide', () => {
  expect(interpreter({ kind: 'fresh' })).toEqual({
    kind: 'fresh',
    tree: { folders: [], connections: [] },
    preferences: PREFERENCES_PAR_DEFAUT,
    instances: [],
    kubeconfigs: {},
  })
})

test('un fichier lu rend son arbre', () => {
  const arbre = arbreDeTest(trioDeTest())
  expect(
    interpreter({
      kind: 'loaded',
      tree: arbre,
      preferences: PREFERENCES_PAR_DEFAUT,
      instances: [],
      kubeconfigs: {},
    }),
  ).toEqual({
    kind: 'loaded',
    tree: arbre,
    preferences: PREFERENCES_PAR_DEFAUT,
    instances: [],
    kubeconfigs: {},
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

// **La cinquième issue** (#164) : les mots de passe n'ont pas pu suivre la migration v7. Écrire
// maintenant figerait des connexions dont le secret est resté sous l'ancienne référence.
test('une migration des secrets refusée bloque, avec sa raison', () => {
  const etat = interpreter({ kind: 'secretsMigrationFailed', reason: 'Trousseau verrouillé' })
  expect(etat.kind).toBe('blocked')
  expect(etat.kind === 'blocked' && etat.reason).toBe('Trousseau verrouillé')
})

test('les issues bloquantes ne rendent aucun dossier', () => {
  // Rendre un arbre partiel laisserait croire que la lecture a marché à moitié.
  for (const issue of [
    { kind: 'unreadable', reason: 'x', quarantinedTo: 'y' },
    { kind: 'tooNew', found: 9, supported: 1 },
    { kind: 'secretsMigrationFailed', reason: 'z' },
  ] as ConfigLoad[]) {
    expect(interpreter(issue).tree).toEqual({ folders: [], connections: [] })
  }
})

// --- Les clés ---

test('la clé envoyée à Rust est l’identifiant de la connexion, et rien d’autre', () => {
  // Composer côté front dupliquerait la convention : c'est `cle_de_connexion` qui en dérive la clé
  // du registre (#166).
  expect(databaseKey('c0000000000000a1')).toEqual({ connection: 'c0000000000000a1' })
})

// --- Les états ---

// Une base absente de la table est `never`, pas `offline` : afficher en rouge une base qu'on n'a
// pas ouverte serait faux. C'est la décision du 7 août sur l'arbre lisible sans réseau.
test('une base inconnue est « jamais tentée », pas « hors ligne »', () => {
  expect(etatDe([], 'c0000000000000a1')).toEqual({ kind: 'never' })
})

test('un état connu est rendu tel quel', () => {
  const etat = {
    kind: 'connected' as const,
    serverVersion: 'PostgreSQL 17.6',
    tunnelLocalPort: null,
  }
  const entrees = [{ key: { connection: 'c0000000000000a1' }, state: etat }]
  expect(etatDe(entrees, 'c0000000000000a1')).toEqual(etat)
})

// Deux connexions homonymes sont deux connexions distinctes — c'est ce que l'identifiant exprime, et
// ce qu'une clé indexée par le nom aurait confondu.
test('deux connexions homonymes ont deux états distincts', () => {
  const entrees = [
    {
      key: { connection: 'c0000000000000d1' },
      state: { kind: 'connected' as const, serverVersion: 'PG', tunnelLocalPort: null },
    },
    {
      key: { connection: 'c0000000000000d3' },
      state: { kind: 'offline' as const, reason: 'hôte injoignable' },
    },
  ]
  expect(etatDe(entrees, 'c0000000000000d1').kind).toBe('connected')
  expect(etatDe(entrees, 'c0000000000000d3').kind).toBe('offline')
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

  await expect(readRows(databaseKey('c0000000000000a1'), REQUETE)).rejects.toThrow()
  expect(vues).toHaveLength(1)

  // Une commande qui réussit n'annonce rien : l'annonce dit un échec, pas un passage.
  await loadConfigVerte()
  expect(vues).toHaveLength(1)

  // Et le désabonnement rend vraiment le silence — sans quoi un arbre démonté continuerait de
  // relire les états, indéfiniment.
  desabonner()
  await expect(listSchemas(databaseKey('c0000000000000a1'))).rejects.toThrow()
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
