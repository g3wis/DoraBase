import type { ColumnInfo, Filter, Relation, Value } from '../../domain/engine'
import { valeurDeCle } from './ligneLiee'

/**
 * Suivre une clé étrangère : d'une cellule de `A5` vers la ligne qu'elle désigne (`API-55`).
 *
 * # Une cible, pas un geste
 *
 * Ce module ne sait pas ouvrir un onglet — c'est l'écran de travail qui tient les onglets, et lui
 * seul. Il rend **où aller** : un schéma, une table, et les filtres qui y désignent la ligne. Deux
 * appelants s'en servent, et c'est la raison pour laquelle il est ici plutôt que dans l'un des
 * deux : le bouton de la cellule (souris) et l'entrée « Liens » du panneau de ligne (clavier)
 * doivent mener **exactement au même endroit**. Deux voies pour un même acte en laissent une en
 * arrière (règle n° 17) — et le dépôt l'a déjà payé une fois, avec le `⌘E` qui n'avait pas de
 * bouton.
 */

/** Où mène une clé étrangère : la table visée, et le filtre qui y désigne la ligne. */
export type CibleDuSaut = {
  schema: string
  table: string
  /** Un `eq` par paire (colonne référencée, valeur), donc plusieurs pour une clé composite. */
  filters: Filter[]
}

/**
 * La cible d'une relation **sortante**, pour la ligne donnée — ou `null` s'il n'y a rien à suivre.
 *
 * Trois refus, et chacun est un résultat plutôt qu'un échec :
 *
 * - **une relation entrante ne désigne aucune ligne.** Elle dit qui référence cette table, ce qui
 *   est une question à N réponses et un autre écran (hors périmètre d'`API-55`) ;
 * - **une clé nulle ne désigne personne.** `user_id = NULL` n'a pas de ligne au bout, et un saut
 *   qui rendrait « aucune ligne » aurait fait croire à une base incohérente plutôt qu'à une
 *   valeur absente ;
 * - **une valeur que `valeurDeCle` ne sait pas écrire** — un binaire, un booléen — ne peut pas
 *   devenir la valeur d'un filtre, qui est une **chaîne** que l'adaptateur lie selon le type de la
 *   colonne (`06a`).
 *
 * **Toutes les paires, pour une clé composite.** Une seule moitié de la clé rendrait les lignes
 * qui partagent cette moitié : c'est-à-dire, précisément, davantage que la ligne qu'on désignait.
 */
export function cibleDuSaut(
  relation: Relation,
  columns: readonly ColumnInfo[],
  ligne: readonly Value[] | null,
): CibleDuSaut | null {
  if (relation.direction !== 'outgoing') return null
  if (!ligne) return null
  // Un catalogue et une contrainte peuvent se désaccorder — une colonne retirée sous nos pieds,
  // une lecture partie avant un rafraîchissement. Mieux vaut ne rien offrir que composer un
  // filtre sur une colonne que la cible n'a pas.
  if (relation.columns.length !== relation.targetColumns.length) return null

  const filters: Filter[] = []
  for (const [rang, nom] of relation.columns.entries()) {
    const colonneCible = relation.targetColumns[rang]
    if (colonneCible === undefined) return null
    const index = columns.findIndex((colonne) => colonne.name === nom)
    if (index === -1) return null
    const valeur = valeurDeCle(ligne[index])
    if (valeur === null) return null
    filters.push({ column: colonneCible, operator: 'eq', value: valeur })
  }
  return filters.length === 0
    ? null
    : { schema: relation.targetSchema, table: relation.targetTable, filters }
}
