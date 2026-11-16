import { listPublications } from '../../data/commandes'

/**
 * La lecture des publications (#195), **injectable**.
 *
 * Même arbitrage que les autres passerelles de l'écran de travail : le pont ne répond pas hors de la
 * webview de Tauri, donc ce qui se vérifie hors d'elle est le **câblage**, et la démo comme les tests
 * la remplacent.
 */
export type PasserellePublications = {
  listPublications: typeof listPublications
}

export const PASSERELLE_PUBLICATIONS: PasserellePublications = { listPublications }
