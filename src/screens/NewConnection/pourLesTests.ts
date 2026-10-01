import type { ConnectionSettings, Database, Folder, FolderTree } from '../../domain/config'

/** Des réglages de connexion neutres, pour un décor qui n'en mesure aucun. */
export const REGLAGES: ConnectionSettings = {
  host: 'db.internal',
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
}

/**
 * Le décor d'arbre des tests de front (#166) : **la forme migrée d'un projet v6** — un dossier
 * racine, trois sous-dossiers `dev`, `staging`, `prod`, et `prod` en lecture seule.
 *
 * **Un seul endroit, et c'est le point.** Chaque test de `A2`, de l'arbre et de l'écran de travail
 * déclarait son propre trio d'environnements ; les recopier dans dix fichiers ferait dix décors à
 * corriger au prochain changement de forme.
 *
 * **Les identifiants ne sont pas les noms**, délibérément : un décor où `id === name` ne distingue
 * pas une identité d'un affichage, et le renommage — qui ne doit changer aucune identité — y
 * passerait pour la mauvaise raison.
 */
export const ID_DE_TEST = {
  racine: 'f0000000000000a1',
  dev: 'f0000000000000d1',
  staging: 'f0000000000000d2',
  prod: 'f0000000000000d3',
} as const

/** Une connexion du décor ; son identifiant n'est pas son nom. */
export function connexionDeTest(
  id: string,
  name: string,
  over: Partial<Omit<Database, 'environment'>> = {},
): Database {
  return {
    id,
    name,
    engine: 'postgresql',
    connection: REGLAGES,
    consoles: [],
    ...over,
  } as Database
}

/** Le trio migré, avec les connexions qu'on range dans chacun de ses sous-dossiers. */
export function trioDeTest(
  connexions: { dev?: Database[]; staging?: Database[]; prod?: Database[] } = {},
  over: Partial<Folder> = {},
): Folder {
  return {
    id: ID_DE_TEST.racine,
    name: 'Atelier Nord',
    readOnly: false,
    folders: [
      {
        id: ID_DE_TEST.dev,
        name: 'dev',
        color: 'green',
        readOnly: false,
        connections: connexions.dev ?? [],
      },
      {
        id: ID_DE_TEST.staging,
        name: 'staging',
        color: 'amber',
        readOnly: false,
        connections: connexions.staging ?? [],
      },
      {
        id: ID_DE_TEST.prod,
        name: 'prod',
        color: 'red',
        readOnly: true,
        connections: connexions.prod ?? [],
      },
    ],
    ...over,
  }
}

/** Un arbre fait de ces dossiers racine, sans connexion à la racine. */
export function arbreDeTest(...racines: Folder[]): FolderTree {
  return { folders: racines, connections: [] }
}
