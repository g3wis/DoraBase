import type { ColumnInfo } from '../domain/engine'

/**
 * La marque de type d'une colonne, en un ou deux caractères.
 *
 * **Un glyphe et non une icône du sprite** : celui-ci n'en porte aucune pour les catégories de
 * `06c` — `clock` et `json` mis à part —, et en dessiner cinq serait inventer des pixels que le
 * handoff ne décrit pas. La catégorie porte déjà l'information, c'est elle qui décide dans la
 * grille comme dans l'arbre : on la réemploie plutôt que d'analyser le nom du type.
 *
 * **Un seul endroit**, parce qu'il y en a eu deux — la section « Colonnes de » de la sidebar et le
 * panneau de ligne l'auraient chacune écrite, et deux tables de glyphes divergent au premier type
 * ajouté : c'est déjà ce qui sépare celle-ci de la `marqueDe` de `DetailPanel`, qui mêle la clé au
 * type et rend `◷` là où celle-ci rend `⏱`. Les fondre changerait le rendu de deux écrans dont les
 * captures de fidélité font foi — à reprendre par un passage de design, pas au passage.
 */
export function glypheDeType(category: ColumnInfo['category']): string {
  switch (category) {
    case 'number':
      return '#'
    case 'timestamp':
      return '⏱'
    case 'json':
      return '{}'
    case 'uuid':
      return 'ID'
    default:
      return 'T'
  }
}
