import type { Filter, FilterOperator, SortKey } from '../../domain/engine'

/**
 * Les règles de tri et de filtre de `A5`, en fonctions **pures**.
 *
 * Isolées du rendu comme `arbre.ts` (`09d`) et `onglets.ts` (`10b`) : ce sont des règles, elles
 * se testent sans DOM, et c'est là que se logent les erreurs de cas limites.
 */

/**
 * Un clic sur un en-tête de colonne.
 *
 * **Trois états, pas deux** : croissant → décroissant → plus de tri. Sans le troisième, on ne
 * peut plus revenir à l'ordre naturel de la table sans recharger l'écran.
 *
 * **`ajouter` — le `⌘`-clic — empile au lieu de remplacer.** Le handoff ne le dit pas ; c'est la
 * convention de tous les tableurs et de tous les clients SQL, et en inventer une autre serait
 * gratuit. La pastille numérotée du mockup est l'affichage de cette pile : `SortKey` porte la
 * remarque depuis `06a` — « leur ordre dans le vecteur **est** leur rang ».
 */
export function basculerTri(sort: readonly SortKey[], column: string, ajouter: boolean): SortKey[] {
  const existant = sort.find((cle) => cle.column === column)
  const autres = ajouter ? sort.filter((cle) => cle.column !== column) : []

  if (!existant) return [...autres, { column, direction: 'ascending' }]
  if (existant.direction === 'ascending') {
    return [...autres, { column, direction: 'descending' }]
  }
  // Troisième clic : la colonne sort du tri. Les autres critères, eux, restent.
  return [...autres]
}

/** Le rang d'une colonne dans le tri, à partir de 1. `null` si elle n'y est pas. */
export function rangDeTri(sort: readonly SortKey[], column: string): number | null {
  const index = sort.findIndex((cle) => cle.column === column)
  return index === -1 ? null : index + 1
}

/**
 * Un filtre saisi, prêt à partir au serveur — ou `null` quand il n'y a rien à envoyer.
 *
 * **`is null` n'a pas de valeur**, et c'est la seule exception : `Filter.value` est `None` pour
 * lui (`06a`). Pour les autres, une valeur vide signifie « pas de filtre » plutôt que
 * « égal à la chaîne vide » — cette dernière se demande explicitement par `= ''`, et confondre
 * les deux rendrait impossible de vider un filtre.
 */
export function filtreDe(column: string, operator: FilterOperator, saisie: string): Filter | null {
  if (operator === 'isNull') return { column, operator, value: null }
  const valeur = saisie.trim()
  if (valeur === '') return null
  return { column, operator, value: valeur }
}

/** Remplace ou retire le filtre d'une colonne, en gardant l'ordre des autres. */
export function poserFiltre(
  filters: readonly Filter[],
  column: string,
  filtre: Filter | null,
): Filter[] {
  const autres = filters.filter((f) => f.column !== column)
  return filtre ? [...autres, filtre] : autres
}

/** Le libellé d'un filtre dans les chips de la toolbar : `status = paid`, `total_cents > 5000`. */
export function libelleDeFiltre(filtre: Filter): string {
  if (filtre.operator === 'isNull') return `${filtre.column} is null`
  return `${filtre.column} ${SIGNES[filtre.operator]} ${filtre.value ?? ''}`
}

/** Les cinq opérateurs du popover de `A5`, valables pour toute colonne. */
export const OPERATEURS: { valeur: FilterOperator; signe: string; libelle: string }[] = [
  { valeur: 'eq', signe: '=', libelle: 'égal' },
  { valeur: 'ne', signe: '≠', libelle: 'différent' },
  { valeur: 'in', signe: 'in', libelle: 'dans la liste…' },
  { valeur: 'matches', signe: '~', libelle: 'contient' },
  { valeur: 'isNull', signe: '∅', libelle: 'is null' },
]

/**
 * Les quatre comparaisons, réservées aux colonnes numériques.
 *
 * `>` sur du texte trierait lexicographiquement (`"9" > "10"`), ce que le signe affiché
 * contredirait — c'est pourquoi elles ne rejoignent `OPERATEURS` que pour une colonne dont la
 * `category` vaut `number` (voir `operateursPour`), jamais pour les autres.
 */
export const COMPARAISONS: { valeur: FilterOperator; signe: string; libelle: string }[] = [
  { valeur: 'gt', signe: '>', libelle: 'supérieur à' },
  { valeur: 'gte', signe: '≥', libelle: 'supérieur ou égal à' },
  { valeur: 'lte', signe: '≤', libelle: 'inférieur ou égal à' },
  { valeur: 'lt', signe: '<', libelle: 'inférieur à' },
]

/** Les opérateurs proposés par le popover — les cinq de base, et les quatre comparaisons en plus
 * pour une colonne numérique. */
export function operateursPour(
  numeric: boolean,
): { valeur: FilterOperator; signe: string; libelle: string }[] {
  return numeric ? [...OPERATEURS, ...COMPARAISONS] : OPERATEURS
}

const SIGNES: Record<FilterOperator, string> = {
  eq: '=',
  ne: '≠',
  in: 'in',
  matches: '~',
  isNull: '∅',
  gt: '>',
  gte: '≥',
  lte: '≤',
  lt: '<',
}

export function signeDe(operator: FilterOperator): string {
  return SIGNES[operator]
}
