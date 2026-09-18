import { type ReactNode, useId } from 'react'
import { Icon } from '../../design/icons/Icon'
import { cx } from '../cx'
import { ListeDeroulante } from './ListeDeroulante'
import styles from './Select.module.css'

type SelectSize = 'sm' | 'md'

export type SelectOption<T extends string> = {
  value: T
  label: string
  /**
   * Rendu à gauche du libellé — voir `OptionDeListe`.
   *
   * Il traverse `Select` sans qu'il en fasse rien : c'est l'appelant qui sait ce que l'entrée
   * *dit*, et `ListeDeroulante` qui sait comment aligner les libellés quand une liste en porte.
   */
  ornement?: ReactNode
}

type SelectProps<T extends string> = {
  /** Étiquette visible, et nom accessible — comme `Field`, jamais décorative. */
  label: string
  options: readonly SelectOption<T>[]
  value: T
  onValueChange: (value: T) => void
  size?: SelectSize
  /** Icône à gauche de la valeur — le sac à dos du sélecteur de projet de `A2`. */
  icon?: { name: Parameters<typeof Icon>[0]['name']; color?: string }
  /** Classe du champ, pour l'appelant qui en porte la géométrie. */
  className?: string
  id?: string
  /** Grisé et inerte, avec sa raison en infobulle — la règle de `09f`. */
  disabled?: boolean
  title?: string
}

/**
 * Le champ à chevron de `A2` — mode SSL, projet, type de tunnel.
 *
 * **Il enveloppe désormais `ListeDeroulante` et non un `<select>` natif.** L'argument d'origine tenait
 * pour l'état fermé : le natif apportait gratuitement le clavier et la recherche à la frappe, et le
 * mockup ne montre pas la liste ouverte. Ouvert, il rendait le menu **du système**, au milieu d'une
 * interface qui a ses propres rayons et ses propres encres. Décidé le 19 août 2026 : aucun composant
 * natif visible dans ce produit.
 *
 * **L'interface publique n'a pas changé** — mêmes propriétés, mêmes tailles, même étiquette. C'est le
 * seul point où le remplacement se voit chez les trois appelants : nulle part.
 */
export function Select<T extends string>({
  label,
  options,
  value,
  onValueChange,
  size = 'md',
  icon,
  className,
  id,
  disabled = false,
  title,
}: SelectProps<T>) {
  const autoId = useId()
  const idChamp = id ?? autoId
  const idEtiquette = `${idChamp}-etiquette`

  return (
    <div className={styles.root}>
      {/* Un `<label>` sans `htmlFor` : le champ n'est plus un contrôle de formulaire natif, donc
          l'association passe par `aria-labelledby`. Cliquer l'étiquette n'ouvre plus la liste — ce que
          le natif faisait gratuitement, et qu'aucun mockup ne demande. */}
      <span className={styles.label} id={idEtiquette}>
        {label}
      </span>
      <div className={cx(styles.wrap, styles[size], className)} title={title}>
        {icon && (
          <span className={styles.icon} style={icon.color ? { color: icon.color } : undefined}>
            <Icon name={icon.name} size={13} strokeWidth={1.8} />
          </span>
        )}
        <ListeDeroulante
          id={idChamp}
          label={label}
          labelledBy={idEtiquette}
          options={options}
          value={value}
          onValueChange={onValueChange}
          className={styles.champ}
          disabled={disabled}
        />
      </div>
    </div>
  )
}
