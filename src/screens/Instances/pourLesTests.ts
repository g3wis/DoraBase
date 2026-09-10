import type { ConnectionSettings, ManagedInstance } from '../../domain/config'
import type {
  Capability,
  InstanceDatabase,
  InstanceExtension,
  InstanceGesture,
  InstanceOverview,
  InstancePrivilege,
  InstanceRole,
  InstanceSession,
  InstanceSetting,
} from '../../domain/instances'
import type { PasserelleInstances } from './instanceCommands'

/**
 * Le décor du gestionnaire d'instances (`API-32`).
 *
 * **Aucun nom réel** — ni du commanditaire, ni d'un de ses projets : la règle du dépôt, et elle vaut
 * ici plus qu'ailleurs, un décor d'instance portant des noms de rôles et des hôtes.
 *
 * **Et un décor qui distingue.** La question de la règle n° 5 — « qu'est-ce que ce décor rend
 * indiscernable ? » — a trois réponses ici, et les trois sont traitées : un rôle qui se connecte et
 * un qui ne peut pas ; une base ordinaire et un modèle ; notre session et celle d'un autre. Sans
 * ces paires, une icône figée, un bouton toujours actif et un `isSelf` ignoré passeraient tous les
 * trois.
 */
export function reglagesDeTest(): ConnectionSettings {
  return {
    host: 'localhost',
    port: 5432,
    defaultDatabase: 'postgres',
    username: 'postgres',
    password: null,
    sslMode: 'prefer',
    caCertificate: null,
    authDatabase: null,
    readOnly: false,
    reconnectOnStartup: false,
    tunnel: null,
  }
}

export function instanceDeTest(over: Partial<ManagedInstance> = {}): ManagedInstance {
  return {
    id: 'pg-atelier',
    label: 'PG atelier',
    engine: 'postgresql',
    connection: reglagesDeTest(),
    production: false,
    confirmWrites: true,
    ...over,
  }
}

/** Les onze gestes, tous permis. Le point de départ d'un compte d'administration complet. */
export function toutesLesCapacites(): Capability[] {
  const gestes: InstanceGesture[] = [
    'createDatabase',
    'alterDatabase',
    'dropDatabase',
    'createRole',
    'alterRole',
    'dropRole',
    'grantPrivilege',
    'terminateSession',
    'createExtension',
    'dropExtension',
    'setParameter',
  ]
  return gestes.map((gesture) => ({ gesture, allowed: true, reason: null }))
}

export function vueDeTest(over: Partial<InstanceOverview> = {}): InstanceOverview {
  return {
    serverVersion: 'PostgreSQL 17.6',
    uptimeSeconds: 7200,
    connections: 4,
    maxConnections: 100,
    databases: 3,
    roles: 5,
    totalSizeBytes: 41_943_040,
    identity: {
      host: 'localhost',
      port: 5432,
      role: 'postgres',
      database: 'postgres',
      tls: true,
      tlsCipher: 'TLSv1.3 / TLS_AES_256_GCM_SHA384',
      secretLocation: 'Trousseau',
    },
    capabilities: toutesLesCapacites(),
    ...over,
  }
}

export const BASES_DE_TEST: InstanceDatabase[] = [
  {
    name: 'atelier',
    owner: 'postgres',
    encoding: 'UTF8',
    collation: 'C',
    sizeBytes: 8_388_608,
    connections: 2,
    isTemplate: false,
    allowConnections: true,
  },
  // Le modèle : sa présence est ce qui rend mesurable le refus de suppression.
  {
    name: 'template1',
    owner: 'postgres',
    encoding: 'UTF8',
    collation: 'C',
    sizeBytes: 7_340_032,
    connections: 0,
    isTemplate: true,
    allowConnections: true,
  },
]

export const ROLES_DE_TEST: InstanceRole[] = [
  {
    name: 'postgres',
    canLogin: true,
    superuser: true,
    createDb: true,
    createRole: true,
    replication: false,
    bypassRls: false,
    validUntil: null,
    memberOf: [],
    ownedDatabases: 2,
    system: false,
  },
  // Un rôle **sans** LOGIN : sans lui, l'icône `key`/`lock` serait indiscernable d'une icône figée.
  {
    name: 'lecture',
    canLogin: false,
    superuser: false,
    createDb: false,
    createRole: false,
    replication: false,
    bypassRls: false,
    validUntil: null,
    memberOf: ['postgres'],
    ownedDatabases: 0,
    system: false,
  },
  { ...roleNu('pg_monitor'), system: true },
]

function roleNu(name: string): InstanceRole {
  return {
    name,
    canLogin: false,
    superuser: false,
    createDb: false,
    createRole: false,
    replication: false,
    bypassRls: false,
    validUntil: null,
    memberOf: [],
    ownedDatabases: 0,
    system: false,
  }
}

export const PRIVILEGES_DE_TEST: InstancePrivilege[] = [
  { role: 'postgres', database: 'atelier', create: true, temporary: true, connect: true },
  { role: 'lecture', database: 'atelier', create: false, temporary: false, connect: true },
]

export const SESSIONS_DE_TEST: InstanceSession[] = [
  {
    pid: 101,
    user: 'postgres',
    database: 'postgres',
    client: 'local',
    process: 'DoraBase',
    state: 'active',
    durationSeconds: 3,
    isSelf: true,
  },
  // Une session **qui n'est pas la nôtre** : sans elle, « terminer » serait toujours refusé, et le
  // test de la garde passerait pour la mauvaise raison.
  {
    pid: 202,
    user: 'lecture',
    database: 'atelier',
    client: '10.0.0.4',
    process: 'psql',
    state: 'idle',
    durationSeconds: 420,
    isSelf: false,
  },
]

export const EXTENSIONS_DE_TEST: InstanceExtension[] = [
  {
    name: 'plpgsql',
    installedVersion: '1.0',
    defaultVersion: '1.0',
    database: 'postgres',
    schema: 'pg_catalog',
  },
  // Une disponible non installée : sans elle, l'action « installer » n'aurait rien à viser.
  {
    name: 'pgcrypto',
    installedVersion: null,
    defaultVersion: '1.3',
    database: 'postgres',
    schema: null,
  },
]

export const PARAMETRES_DE_TEST: InstanceSetting[] = [
  {
    name: 'max_connections',
    value: '100',
    unit: null,
    context: 'postmaster',
    source: 'configuration file',
    pendingRestart: false,
    settable: true,
  },
  // Un `internal` : sans lui, le refus de régler serait indiscernable d'un bouton actif.
  {
    name: 'block_size',
    value: '8192',
    unit: null,
    context: 'internal',
    source: 'default',
    pendingRestart: false,
    settable: false,
  },
]

/**
 * Une passerelle de test, qui répond **après un tour de boucle**.
 *
 * `await Promise.resolve()` avant chaque réponse, et ce n'est pas décoratif : un double qui répond
 * dans le tour synchrone de son appel rend indiscernable « la lecture a attendu l'ouverture » de
 * « la lecture est partie tout de suite » — c'est le sabotage resté vert d'`API-33`, et la leçon
 * qu'un décor trop rapide ne mesure rien.
 */
export function passerelleDeTest(over: Partial<PasserelleInstances> = {}): PasserelleInstances {
  const apres = async <T>(valeur: T): Promise<T> => {
    await Promise.resolve()
    return valeur
  }
  return {
    openInstance: async () =>
      apres({ kind: 'connected', serverVersion: 'PostgreSQL 17.6', tunnelLocalPort: null }),
    closeInstance: async () => apres(undefined),
    instanceOverview: async () => apres(vueDeTest()),
    instanceDatabases: async () => apres(BASES_DE_TEST),
    instanceRoles: async () => apres(ROLES_DE_TEST),
    instancePrivileges: async () => apres(PRIVILEGES_DE_TEST),
    instanceSessions: async () => apres(SESSIONS_DE_TEST),
    instanceExtensions: async () => apres(EXTENSIONS_DE_TEST),
    instanceSettings: async () => apres(PARAMETRES_DE_TEST),
    planInstanceAction: async () =>
      apres({ statements: ['SELECT 1;'], note: '', destructive: false }),
    runInstanceAction: async () => apres({ statements: ['SELECT 1;'], message: 'fait' }),
    // Le décor ne hache rien : le vérificateur est une chaîne de la **forme** que le cœur rend, ce
    // qui suffit à mesurer le câblage — le hachage lui-même est vérifié en Rust, contre un vecteur
    // de la RFC et contre un vrai serveur.
    scramVerifier: async () =>
      apres('SCRAM-SHA-256$4096:c2VsZGV0ZXN0MTIzNA==$c3RvcmVl:c2VydmV1cg=='),
    ...over,
  }
}
