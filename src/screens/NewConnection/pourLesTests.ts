import type { ConnectionSettings, EnvironmentDeclaration } from '../../domain/config'

/**
 * Le décor d'environnements des tests de front.
 *
 * **Un seul endroit, et c'est le point.** Chaque test de `A2`, de l'arbre et de l'écran de travail
 * déclarait son propre trio ; depuis `23a` un projet porte ses environnements, et les recopier dans
 * dix fichiers ferait dix décors à corriger au prochain changement de forme.
 */
export const TRIO_DE_TEST: EnvironmentDeclaration[] = [
  { id: 'dev', label: 'dev', color: 'green', production: false },
  { id: 'staging', label: 'staging', color: 'amber', production: false },
  { id: 'prod', label: 'prod', color: 'red', production: true },
]

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
