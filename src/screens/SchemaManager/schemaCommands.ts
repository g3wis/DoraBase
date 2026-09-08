import { createSchema, saveVisibleSchemas } from '../../data/commandes'

/**
 * Les deux commandes qu'écrit le gestionnaire de schémas (`API-33`), **injectables**.
 *
 * Même arbitrage qu'en `08d`, `09b` et `22c` : le pont ne répond pas hors de la webview de Tauri,
 * donc ce qui est vérifiable est le **câblage**, et un test qui appellerait `invoke` ne testerait
 * que son échec.
 *
 * **La lecture n'en fait pas partie**, et c'est délibéré : la modale lit par `passerelle.listSchemas`
 * de l'arbre — la même commande, donc la même liste. Une seconde voie vers la même lecture en aurait
 * laissé une en arrière (règle n° 17), et c'est exactement ce qui est arrivé au « Tester la
 * connexion » de `A2`.
 */
export type PasserelleSchemas = {
  createSchema: typeof createSchema
  saveVisibleSchemas: typeof saveVisibleSchemas
}

export const PASSERELLE_SCHEMAS: PasserelleSchemas = {
  createSchema,
  saveVisibleSchemas,
}
