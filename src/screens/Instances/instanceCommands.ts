import {
  closeInstance,
  instanceDatabases,
  instanceExtensions,
  instanceOverview,
  instancePrivileges,
  instanceRoles,
  instanceSessions,
  instanceSettings,
  openInstance,
  planInstanceAction,
  runInstanceAction,
  scramVerifier,
} from '../../data/commandes'

/**
 * Les commandes du gestionnaire d'instances, **injectables** (`API-32`).
 *
 * Même arbitrage qu'en `08d`, `09b`, `22c` et `API-33` : le pont ne répond pas hors de la webview de
 * Tauri, donc ce qui est vérifiable est le **câblage** — qu'un bouton appelle la bonne commande avec
 * les bons arguments, et que l'écran fasse ce qu'il faut de la réponse. Un test qui appellerait
 * `invoke` ne testerait que son échec.
 */
export type PasserelleInstances = {
  openInstance: typeof openInstance
  closeInstance: typeof closeInstance
  instanceOverview: typeof instanceOverview
  instanceDatabases: typeof instanceDatabases
  instanceRoles: typeof instanceRoles
  instancePrivileges: typeof instancePrivileges
  instanceSessions: typeof instanceSessions
  instanceExtensions: typeof instanceExtensions
  instanceSettings: typeof instanceSettings
  planInstanceAction: typeof planInstanceAction
  runInstanceAction: typeof runInstanceAction
  /** Le vérificateur SCRAM d'un mot de passe — demandé avant de composer `setRolePassword`. */
  scramVerifier: typeof scramVerifier
}

export const PASSERELLE_INSTANCES: PasserelleInstances = {
  openInstance,
  closeInstance,
  instanceOverview,
  instanceDatabases,
  instanceRoles,
  instancePrivileges,
  instanceSessions,
  instanceExtensions,
  instanceSettings,
  planInstanceAction,
  runInstanceAction,
  scramVerifier,
}
