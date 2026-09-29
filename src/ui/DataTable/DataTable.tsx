import type { MouseEvent, ReactNode } from 'react'
import { cx } from '../cx'
import styles from './DataTable.module.css'

export type Column<Row> = {
  /** Clé stable, employée pour le rendu et l'association en-tête ↔ cellule. */
  key: string
  header: string
  /** Le contenu de la cellule. Rendre un nœud plutôt qu'une chaîne permet les icônes de `A4`. */
  cell: (row: Row) => ReactNode
  /** Aligne à droite — les nombres, dans `A4`. */
  numeric?: boolean
  /**
   * Rend la cellule en Nunito au lieu du mono.
   *
   * **L'inverse de ce qu'on attendrait**, et c'est le mockup qui tranche : sa feuille de style
   * pose `td { font: 500 11.5px JetBrains Mono }` pour **toutes** les cellules, et seule la
   * colonne du nom y échappe (`font: 600 12px Nunito`). Le tableau liste des identifiants de
   * catalogue — noms de colonnes, comptes, tailles, dates — donc le mono est la règle et
   * Nunito l'exception. Une première version avait posé `mono?: boolean`, ce qui aurait fait de
   * six colonnes sur sept une exception.
   */
  ui?: boolean
  /**
   * Largeur fixe. Le mockup emploie `table-layout: fixed` avec un `<colgroup>` :
   * 210 · 88 · 78 · 66 · 150 · 120 · auto. Sans largeurs, le navigateur les calcule d'après le
   * contenu et elles changeraient d'un schéma à l'autre.
   */
  width?: string
}

type DataTableProps<Row> = {
  /** Nom accessible du tableau. Un tableau anonyme est illisible à la voix. */
  label: string
  columns: readonly Column<Row>[]
  rows: readonly Row[]
  /** Identifiant stable d'une ligne — pour la clé React et la sélection. */
  rowId: (row: Row) => string
  selectedId?: string | null
  onSelect?: (row: Row) => void
  /**
   * Ouvre la ligne — double-clic, et `Entrée` quand elle a le focus.
   *
   * Distinct de `onSelect` : sélectionner remplit le panneau de détail, ouvrir change d'écran.
   * Les confondre ouvrirait un onglet à chaque parcours de la liste au clavier.
   */
  onOpen?: (row: Row) => void
  /** Rendu quand `rows` est vide. Absent, aucune ligne n'est rendue. */
  empty?: ReactNode
  /**
   * Le clic droit sur une ligne (#162).
   *
   * **L'événement voyage avec la ligne** : un menu contextuel s'ouvre au pointeur, donc l'appelant a
   * besoin des coordonnées, et les relire ailleurs qu'ici demanderait de les capter deux fois.
   *
   * `DataTable` **n'ouvre rien lui-même** : il ne connaît ni les actions d'une ligne ni leurs
   * libellés. C'est la même répartition que `TreeRow`, qui reçoit ses `actions` toutes faites — un
   * menu câblé ici obligerait chaque appelant à passer par la forme d'entrées qu'on aurait choisie
   * pour le premier.
   */
  onContextMenu?: (row: Row, evenement: MouseEvent<HTMLTableRowElement>) => void
}

/**
 * Le tableau dense d'objets de `A4` : Nom, Lignes, Taille, Col., Clé primaire, Dernier
 * ANALYZE, Commentaire.
 *
 * **Un vrai `<table>`**, et c'est un choix. Avec `<th scope="col">`, un lecteur d'écran annonce
 * l'en-tête de chaque cellule pendant la navigation, et le fait gratuitement — une grille de
 * `<div>` doit réimplémenter tout cela en `role="grid"` et `aria-colindex`.
 *
 * La grille de `A5` (`10`) aura besoin de l'inverse : virtualisation, donc des `<div>`
 * positionnés, colonnes redimensionnables, cellules éditables. C'est précisément pourquoi les
 * deux composants sont séparés — les fondre donnerait une abstraction qui ne sert bien ni l'une
 * ni l'autre.
 */
export function DataTable<Row>({
  label,
  columns,
  rows,
  rowId,
  selectedId = null,
  onSelect,
  onOpen,
  empty,
  onContextMenu,
}: DataTableProps<Row>) {
  if (rows.length === 0 && empty) {
    return <div className={styles.empty}>{empty}</div>
  }

  // **La somme des largeurs déclarées**, qui devient la largeur minimale du tableau.
  //
  // Sans elle, `width: 100%` et `table-layout: fixed` **écrasaient** les colonnes au lieu de déborder :
  // sur une fenêtre étroite, la dernière colonne tombait à quarante pixels et son en-tête s'affichait
  // « Co… », inatteignable — il n'y avait rien à faire défiler, le contenu était simplement rogné.
  // Signalé à l'écran le 18 août 2026.
  //
  // Les colonnes gardent donc leur largeur, le tableau déborde, et son enveloppe défile — ce qui rend
  // du même coup la molette horizontale et `⇧`+molette opérantes, puisque le navigateur les traite
  // nativement sur un conteneur qui peut défiler.
  const largeurMinimale = columns.reduce((total, colonne) => {
    const declaree = Number.parseFloat(colonne.width ?? '')
    // Une colonne sans largeur est celle qui prend le reste : elle compte pour un minimum lisible,
    // sans quoi le tableau pourrait encore l'écraser.
    return total + (Number.isFinite(declaree) ? declaree : 120)
  }, 0)

  return (
    <div className={styles.defilement}>
      <table className={styles.root} style={{ minWidth: `${largeurMinimale}px` }}>
        <caption className={styles.caption}>{label}</caption>
        {/* `<colgroup>` plutôt que des largeurs sur les `<th>` : avec `table-layout: fixed`, c'est
          le groupe de colonnes qui fait autorité, et la largeur ne dépend plus du contenu. */}
        <colgroup>
          {columns.map((colonne) => (
            <col key={colonne.key} style={colonne.width ? { width: colonne.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((colonne) => (
              <th
                key={colonne.key}
                scope="col"
                className={cx(styles.th, colonne.numeric && styles.numeric)}
              >
                {colonne.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = rowId(row)
            const selectionnee = id === selectedId
            return (
              <tr
                key={id}
                // `aria-selected` sur une ligne de `<table>` n'est valable que si la ligne est
                // sélectionnable — ce qui est le cas ici, et que `onSelect` matérialise.
                aria-selected={onSelect ? selectionnee : undefined}
                className={cx(styles.tr, selectionnee && styles.selected)}
                onClick={onSelect ? () => onSelect(row) : undefined}
                onDoubleClick={onOpen ? () => onOpen(row) : undefined}
                // Le clavier ouvre par `Entrée` sur la ligne sélectionnée. Sans cela, l'ouverture
                // n'existerait qu'à la souris — et le double-clic n'a aucun équivalent clavier.
                onKeyDown={
                  onOpen
                    ? (evenement) => {
                        if (evenement.key === 'Enter') onOpen(row)
                      }
                    : undefined
                }
                tabIndex={onOpen ? 0 : undefined}
                // **`preventDefault` ici plutôt que de compter sur `useClicDroitDesactive`** : ce
                // gestionnaire-là est la raison pour laquelle le menu du système ne doit pas
                // s'ouvrir, et l'écrire au même endroit que l'ouverture garde les deux ensemble.
                // C'est ce que fait déjà la ligne d'arbre, pour la même raison.
                onContextMenu={
                  onContextMenu
                    ? (evenement) => {
                        evenement.preventDefault()
                        onContextMenu(row, evenement)
                      }
                    : undefined
                }
              >
                {columns.map((colonne, rang) => {
                  const contenu = colonne.cell(row)
                  const classes = cx(
                    styles.td,
                    colonne.numeric && styles.numeric,
                    colonne.ui && styles.ui,
                  )
                  // La première colonne est l'en-tête **de sa ligne** : c'est le nom de l'objet,
                  // et c'est lui qui identifie la ligne à la voix. Sans `scope="row"`, un lecteur
                  // d'écran annonce « Nom, orders » puis « Lignes, 1.9 M » sans jamais relier la
                  // seconde cellule à l'objet dont elle parle.
                  return rang === 0 ? (
                    <th key={colonne.key} scope="row" className={cx(classes, styles.rowHeader)}>
                      {contenu}
                    </th>
                  ) : (
                    <td key={colonne.key} className={classes}>
                      {contenu}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
