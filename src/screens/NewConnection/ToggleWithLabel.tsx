import { cx } from '../../ui/cx'
import { Toggle } from '../../ui/Toggle/Toggle'
import styles from './NewConnection.module.css'

/**
 * Un interrupteur suivi de son libellé **visible**.
 *
 * `Toggle` ne rend que la piste et le bouton glissant, son `label` servant de nom accessible :
 * les dix écrans du handoff l'emploient tantôt seul (barre d'état), tantôt accompagné d'un
 * texte. `A2` l'accompagne, donc le texte est posé ici.
 *
 * Le libellé de la bascule **éteinte** est en encre secondaire dans le mockup, celui de la
 * bascule allumée en encre pleine. Relevé sur les deux instances de `A2`, et non déduit.
 *
 * Le `<span>` n'est pas un `<label>` : le nom accessible vient déjà d'`aria-label`, et un
 * `<label for>` sur un `<button role="switch">` le doublerait dans l'annonce.
 */
export function ToggleWithLabel({
  checked,
  onCheckedChange,
  label,
  raison,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  /**
   * Quand le réglage est **figé** : la raison, en `title`, et l'interrupteur désactivé (#168). Le
   * patron du port grisé derrière Cloud SQL — grisé plutôt que masqué, avec ce qui l'explique.
   */
  raison?: string
}) {
  return (
    <span className={styles.toggleRow} title={raison}>
      <Toggle
        checked={checked}
        onCheckedChange={onCheckedChange}
        label={label}
        disabled={raison !== undefined}
        title={raison}
      />
      <span className={cx(styles.toggleLabel, !checked && styles.toggleLabelOff)}>{label}</span>
    </span>
  )
}
