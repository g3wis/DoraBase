import { Icon } from '../../../design/icons/Icon'
import type { IconName } from '../../../design/icons/names'
import styles from './ActionsCell.module.css'

/**
 * La largeur de la colonne d'actions (9 septembre 2026, rapporté à l'usage : « ne pas ellipser le
 * nom de colonne actions »).
 *
 * **C'est l'en-tête qui la décide, non les boutons.** « réduite au minimum » disait la maquette, et
 * le minimum avait été pris pour celui des deux carrés de 18 px : 52 px, où « actions » devenait
 * `actio…` — et 34 px sur les sections à un seul bouton, où il devenait `a…`. Un en-tête tronqué à
 * une lettre ne nomme plus rien, et c'est la seule colonne dont le contenu ne dit pas de quoi elle
 * parle : les autres se lisent sur leurs cellules.
 *
 * 72 px : le libellé en Nunito 11.5 px, plus les deux remplissages de cellule de `DataTable`. La
 * même valeur pour une ou deux actions — une colonne qui changerait de largeur d'une section à
 * l'autre ferait sauter la première colonne de données en changeant d'onglet.
 */
export const LARGEUR_ACTIONS = '72px'

export type ActionDeLigne = {
  icon: IconName
  /** Le nom accessible **et** l'infobulle. Obligatoire : l'icône est nue. */
  label: string
  /** Absent, le bouton est désactivé et `reason` dit pourquoi. */
  onClick?: () => void
  /**
   * Pourquoi ce geste est refusé sur cette ligne.
   *
   * **`aria-disabled` et non `disabled`**, quand elle est là : un `<button disabled>` ne reçoit ni
   * focus ni survol, donc son infobulle serait inatteignable — exactement là où elle est le plus
   * utile. C'est le piège n° 3 de la liste d'accessibilité, et c'est la convention d'`EntreeDeMenu`.
   */
  reason?: string
}

/**
 * La colonne d'actions d'une ligne de tableau (`API-32`).
 *
 * # Pourquoi elle est la **première** colonne
 *
 * La maquette la place à gauche, réduite au minimum, et c'est la bonne place : la lire ne demande
 * pas de traverser la ligne. Une colonne d'actions à droite se cherche à une distance qui dépend de
 * la largeur des données — donc du contenu, donc de l'instance qu'on regarde.
 *
 * Deux carrés de 18 px, jamais un menu « … » : il n'y a que deux gestes par ligne, et un menu
 * demanderait un clic de plus pour les montrer.
 */
export function ActionsCell({ actions }: { actions: readonly ActionDeLigne[] }) {
  return (
    <span className={styles.root}>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className={styles.bouton}
          aria-label={action.label}
          title={action.reason ?? action.label}
          aria-disabled={action.onClick === undefined || undefined}
          onClick={(evenement) => {
            // La ligne du tableau est cliquable : sans cela, agir la sélectionnerait aussi.
            evenement.stopPropagation()
            action.onClick?.()
          }}
        >
          <Icon name={action.icon} size={12} strokeWidth={1.8} />
        </button>
      ))}
    </span>
  )
}
