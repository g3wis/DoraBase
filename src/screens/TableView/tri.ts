import type { Filter, FilterOperator, SortKey, TypeCategory } from '../../domain/engine'

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
 * **Les quatre prédicats n'ont pas de valeur** — `is null`, `is not null`, `is true`, `is false` —
 * et `Filter.value` est `None` pour eux (`06a`). Pour les autres, une valeur vide signifie « pas de filtre » plutôt
 * que « égal à la chaîne vide » — cette dernière se demande explicitement par `= ''`, et confondre
 * les deux rendrait impossible de vider un filtre.
 */
export function filtreDe(column: string, operator: FilterOperator, saisie: string): Filter | null {
  if (!prendUneValeur(operator)) return { column, operator, value: null }
  const valeur = saisie.trim()
  if (valeur === '') return null
  return { column, operator, value: valeur }
}

/**
 * Faux pour les quatre prédicats, qui s'appliquent sans saisie.
 *
 * **Le pendant de `FilterOperator::prend_une_valeur` côté Rust**, et la même raison de l'écrire une
 * fois : le champ à désactiver, la valeur à ne pas envoyer et le filtre appliqué sans frappe sont
 * trois conséquences du même fait.
 */
export function prendUneValeur(operator: FilterOperator): boolean {
  return (
    operator !== 'isNull' &&
    operator !== 'isNotNull' &&
    operator !== 'isTrue' &&
    operator !== 'isFalse'
  )
}

/**
 * Remplace ou retire le filtre d'une colonne, en gardant l'ordre des autres.
 *
 * **Sans changement, le tableau reçu est rendu tel quel — et ce n'est pas une optimisation.**
 * `RowQuery` est mémoïsée sur `filters`, donc un tableau neuf est une requête neuve : rendre une
 * copie relançait une lecture de cinq cents lignes chaque fois qu'on choisissait un opérateur sur un
 * champ vide, ou qu'un champ de date émettait un segment incomplet. L'identité est ici une
 * information, pas un détail de représentation.
 */
export function poserFiltre(
  filters: readonly Filter[],
  column: string,
  filtre: Filter | null,
): readonly Filter[] {
  const existant = filters.find((f) => f.column === column)
  if (filtre === null) {
    return existant === undefined ? filters : filters.filter((f) => f.column !== column)
  }
  if (existant?.operator === filtre.operator && existant?.value === filtre.value) {
    return filters
  }
  return [...filters.filter((f) => f.column !== column), filtre]
}

/**
 * Le libellé d'un filtre dans les chips de la toolbar : `status = paid`, `total_cents > 5000`.
 *
 * Les quatre prédicats s'écrivent en mots — `shipped_at is null`, `actif is true` — et non par leur
 * signe : un chip est la **phrase** du filtre, et « actif T » ne se lit pas.
 */
export function libelleDeFiltre(filtre: Filter): string {
  if (filtre.operator === 'isNull') return `${filtre.column} is null`
  if (filtre.operator === 'isNotNull') return `${filtre.column} is not null`
  if (filtre.operator === 'isTrue') return `${filtre.column} is true`
  if (filtre.operator === 'isFalse') return `${filtre.column} is false`
  return `${filtre.column} ${SIGNES[filtre.operator]} ${filtre.value ?? ''}`
}

/**
 * Une entrée du popover d'opérateur.
 *
 * `cle` est le nom du libellé dans le dictionnaire, **et il n'est pas toujours celui de
 * l'opérateur** : `gt` s'annonce « supérieur à » sur un nombre et « après » sur une date. Le même
 * SQL, deux phrases — c'est la catégorie de la colonne qui décide laquelle.
 */
export type Operateur = { valeur: FilterOperator; signe: string; cle: string }

/** Les quatre opérateurs valables pour toute colonne, quelle que soit sa catégorie. */
export const OPERATEURS: Operateur[] = [
  { valeur: 'eq', signe: '=', cle: 'eq' },
  { valeur: 'ne', signe: '≠', cle: 'ne' },
  { valeur: 'in', signe: 'in', cle: 'in' },
  { valeur: 'matches', signe: '~', cle: 'matches' },
]

/**
 * `is null`, **réservé à une colonne `nullable`**.
 *
 * Une colonne `NOT NULL` n'a aucune ligne à trouver : l'offrir promettait un filtre qui rend
 * toujours zéro ligne, ce qui se lit comme une table vide plutôt que comme un filtre vide.
 */
export const NUL: Operateur = { valeur: 'isNull', signe: '∅', cle: 'isNull' }

/**
 * `is not null`, **sous la même condition, et pour la raison symétrique**.
 *
 * Sur une colonne `NOT NULL` il ne rend pas zéro ligne mais **toutes** — un filtre qui ne filtre
 * rien, ce qui se lit comme un filtre inopérant. Les deux faces du même fait, donc la même porte :
 * `nullable`.
 *
 * **Le signe est `≠∅`**, le signe du vide nié par celui que `ne` porte déjà. Aucun caractère
 * Unicode ne dit « ensemble non vide », et un `∃` dirait « il existe », ce qui est vrai d'une
 * colonne nulle aussi.
 */
export const NON_NUL: Operateur = { valeur: 'isNotNull', signe: '≠∅', cle: 'isNotNull' }

/** Les deux prédicats de nullité, qui ne valent que pour une colonne `nullable`. */
export const NULLITE: Operateur[] = [NUL, NON_NUL]

/**
 * Les quatre comparaisons, réservées aux colonnes numériques.
 *
 * `>` sur du texte trierait lexicographiquement (`"9" > "10"`), ce que le signe affiché
 * contredirait — c'est pourquoi elles ne rejoignent `OPERATEURS` que pour une colonne dont la
 * `category` vaut `number` (voir `operateursPour`), jamais pour les autres.
 */
export const COMPARAISONS: Operateur[] = [
  { valeur: 'gt', signe: '>', cle: 'gt' },
  { valeur: 'gte', signe: '≥', cle: 'gte' },
  { valeur: 'lte', signe: '≤', cle: 'lte' },
  { valeur: 'lt', signe: '<', cle: 'lt' },
]

/**
 * « Avant » et « après » d'une colonne temporelle — le même `lt`/`gt` que les nombres, dit
 * autrement.
 *
 * **Deux, et non quatre.** Un `≥` sur une date n'ajoute qu'une nuance d'un jour à un `>` que
 * personne ne saisit à la seconde, et deux entrées de plus dans le popover pour cette nuance-là ne
 * valaient pas la longueur de la liste.
 */
export const DATES: Operateur[] = [
  { valeur: 'lt', signe: '<', cle: 'before' },
  { valeur: 'gt', signe: '>', cle: 'after' },
]

/**
 * `is true` et `is false`, **les seuls opérateurs d'une colonne booléenne**.
 *
 * Une colonne à deux valeurs n'a rien à recevoir d'un champ de saisie : `= t`, `= true`, `= 1`
 * dépendent du moteur, et `~` ou `in` sur deux valeurs sont des chemins plus longs vers le même
 * résultat. Trois entrées disent tout ce qu'on peut demander d'un booléen.
 */
export const BOOLEENS: Operateur[] = [
  { valeur: 'isTrue', signe: 'T', cle: 'isTrue' },
  { valeur: 'isFalse', signe: 'F', cle: 'isFalse' },
]

/**
 * Les opérateurs que le popover propose pour une colonne — sa **catégorie** décide des
 * suppléments, sa **nullité** de la présence des deux prédicats de nullité.
 *
 * L'ordre est celui du mockup : les quatre de base, `is null` et `is not null`, puis ce que la
 * catégorie ajoute. Un booléen sort de ce moule et n'a que ses propres entrées.
 */
export function operateursPour(category: TypeCategory, nullable: boolean): Operateur[] {
  if (category === 'boolean') return nullable ? [...BOOLEENS, ...NULLITE] : BOOLEENS
  const supplements = category === 'number' ? COMPARAISONS : category === 'timestamp' ? DATES : []
  return [...OPERATEURS, ...(nullable ? NULLITE : []), ...supplements]
}

/**
 * Vrai pour les deux bornes d'une colonne temporelle — les seules à ouvrir un sélecteur de date.
 *
 * Écrit ici parce que la question se pose **deux fois** dans `FilterCell`, à deux instants qui ne
 * regardent pas le même opérateur : celui qui est en place, pour le type du champ, et celui qu'on
 * vient de choisir, pour savoir s'il faut ouvrir le calendrier.
 */
export function estUneBorneDeDate(category: TypeCategory, operator: FilterOperator): boolean {
  return category === 'timestamp' && (operator === 'lt' || operator === 'gt')
}

/**
 * L'opérateur d'un champ de filtre qu'on n'a pas encore touché : le premier de sa liste.
 *
 * Pour un booléen c'est `is true`, faute d'`=` : le champ n'a rien à recevoir, donc la liste
 * commence par un prédicat. Il **n'est pas appliqué pour autant** — c'est `applique` qui dit si un
 * filtre est en force, jamais l'opérateur affiché.
 */
export function operateurParDefaut(category: TypeCategory): FilterOperator {
  return category === 'boolean' ? 'isTrue' : 'eq'
}

const SIGNES: Record<FilterOperator, string> = {
  eq: '=',
  ne: '≠',
  in: 'in',
  matches: '~',
  isNull: '∅',
  isNotNull: '≠∅',
  isTrue: 'T',
  isFalse: 'F',
  gt: '>',
  gte: '≥',
  lte: '≤',
  lt: '<',
}

export function signeDe(operator: FilterOperator): string {
  return SIGNES[operator]
}
