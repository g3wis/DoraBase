import type { SearchQuery } from '@codemirror/search'
import type { EditorState } from '@codemirror/state'

/**
 * Au-delà, la bande de recherche écrit « 1000+ » au lieu de compter (#185).
 *
 * Le compte est refait à chaque mise à jour de l'éditeur tant que la bande est ouverte — chaque
 * frappe, chaque déplacement du curseur —, donc il parcourt le document chaque fois. Une requête
 * de console tient en quelques lignes, mais rien n'empêche d'y coller un dump : chercher `e` dans
 * un mégaoctet de texte ne doit pas coûter une frappe sur deux. Mille suffit à dire « beaucoup ».
 */
export const PLAFOND_DES_OCCURRENCES = 1000

export type Occurrences = {
  /** Le nombre d'occurrences, borné par le plafond. */
  total: number
  /**
   * Le rang (à partir de 1) de l'occurrence **sélectionnée**, ou `null` si la sélection n'en est
   * pas une. C'est ce qui fait écrire « 2 / 7 » plutôt que « 7 » : la frappe ne fait que marquer,
   * et c'est `Entrée` qui emmène — comme la recherche du diagramme.
   */
  rang: number | null
  /** Le plafond a mordu : `total` est un minimum, pas un compte. */
  auDela: boolean
}

/**
 * Compte les occurrences de la requête dans le document, et situe la sélection parmi elles.
 *
 * Le curseur est celui de `SearchQuery` — celui-là même que le surlignage et `findNext` emploient,
 * casse et normalisation comprises. Un second comptage écrit à la main finirait par trouver une
 * occurrence que l'éditeur ne surligne pas.
 */
export function compterLesOccurrences(
  etat: EditorState,
  requete: SearchQuery,
  plafond: number = PLAFOND_DES_OCCURRENCES,
): Occurrences {
  // Aucune garde sur `requete.valid` : une recherche vide ne rend rien au curseur, et la seule autre
  // requête invalide — une expression régulière fautive — n'est jamais posée, la bande ne proposant
  // pas ce mode.
  const { from, to } = etat.selection.main
  const curseur = requete.getCursor(etat)
  let total = 0
  let rang: number | null = null
  for (let suivante = curseur.next(); !suivante.done; suivante = curseur.next()) {
    // Une occurrence de plus que le plafond : c'est elle qui dit « au-delà ». S'arrêter à la
    // millième annoncerait « 1000+ » pour un document qui en compte exactement mille.
    if (total === plafond) return { total, rang, auDela: true }
    total += 1
    if (suivante.value.from === from && suivante.value.to === to) rang = total
  }
  return { total, rang, auDela: false }
}
