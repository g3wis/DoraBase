import type { ButtonHTMLAttributes } from 'react'
import { Icon } from '../../design/icons/Icon'
import type { IconName } from '../../design/icons/names'
import { cx } from '../cx'
import styles from './IconSwitch.module.css'

type IconSwitchProps = {
  /** La position tenue : `false` à gauche, `true` à droite. */
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /**
   * Nom accessible du contrôle, **stable dans les deux positions**.
   *
   * C'est `aria-checked` qui dit laquelle est tenue : un nom qui changerait sous le doigt ferait
   * rechercher le contrôle à chaque bascule. Obligatoire — les deux positions n'ont que des
   * icônes, donc rien d'autre ne nomme ce qu'on règle.
   */
  label: string
  /** L'icône de la position gauche, celle de `checked === false`. */
  iconOff: IconName
  /** L'icône de la position droite, celle de `checked === true`. */
  iconOn: IconName
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'children' | 'aria-label'>

/**
 * Une bascule à deux icônes : une piste, une pastille qui glisse, et les **deux** états visibles.
 *
 * **Ce n'est pas `Toggle`**, et l'écart est celui du sens. `Toggle` est un interrupteur : une
 * piste qui s'allume, dont la position éteinte n'a rien à montrer — « chiffré » ou non, « lecture
 * seule » ou non. Ici les deux positions **sont** deux états nommés, chacune avec son dessin, et
 * c'est ce qui les rend lisibles : un cadenas fermé lu seul dit l'état sans annoncer qu'on peut
 * l'ouvrir, lu contre un cadenas ouvert il dit les deux.
 *
 * Ce n'est pas non plus `SegmentedControl`, qui est un choix **exclusif à n positions** avec des
 * libellés : deux icônes sans texte n'y entreraient pas sans en faire un troisième composant.
 *
 * `role="switch"` et non deux radios : il n'y a qu'un contrôle, donc une seule tabulation, et
 * `Espace` comme `Entrée` basculent nativement — rien de clavier à écrire.
 */
export function IconSwitch({
  checked,
  onCheckedChange,
  label,
  iconOff,
  iconOn,
  className,
  disabled,
  ...rest
}: IconSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cx(styles.root, className)}
      onClick={() => onCheckedChange(!checked)}
      {...rest}
    >
      {/* La pastille est **sous** les deux cellules, jamais entre elles : elle est peinte en
          premier et les icônes se posent dessus, de sorte que celle qu'elle éclaire garde son
          trait. Décorative, donc hors de l'arbre d'accessibilité — l'état est dans
          `aria-checked`. */}
      <span className={styles.pastille} aria-hidden="true" />
      <span className={cx(styles.cellule, styles.gauche)}>
        <Icon name={iconOff} size={14} strokeWidth={2} />
      </span>
      <span className={cx(styles.cellule, styles.droite)}>
        <Icon name={iconOn} size={14} strokeWidth={2} />
      </span>
    </button>
  )
}
