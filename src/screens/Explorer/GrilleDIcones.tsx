import { ICONES_DE_DOSSIER } from '../../data/iconesDeDossier'
import { Icon } from '../../design/icons/Icon'
import type { IconName } from '../../design/icons/names'
import { useT } from '../../i18n/LanguageContext'
import { cx } from '../../ui/cx'
import styles from './GrilleDIcones.module.css'

type GrilleDIconesProps = {
  /** L'icône dessinée — déjà résolue : un nom inconnu y arrive en `pin`. */
  valeur: IconName
  onChange: (icone: IconName) => void
  /** Le nom du groupe, lu par la voix. */
  label: string
  /** Le nom du groupe de cases radio, pour la raison du `Nuancier`. */
  name: string
}

/**
 * La grille des icônes d'un dossier (#171), sur le patron du `Nuancier` qu'elle accompagne.
 *
 * **De vraies cases radio, dans un `<label>`** — la forme de `SegmentedControl` : le groupe natif
 * apporte la navigation aux flèches sans une ligne de code, et une case ne peut pas contenir un SVG,
 * d'où le `<label>` qui porte le dessin et la case masquée qui porte l'état.
 *
 * **Le nom accessible est celui de l'icône, en toutes lettres** (`explorer.folderIcons.*`) : un
 * glyphe n'a pas de nom, et « building-2 » n'en est pas un. Il vit sur la case, pas sur le `<label>`,
 * pour qu'une voix annonce « Fusée, bouton radio, 29 sur 56 » et non le nom deux fois.
 */
export function GrilleDIcones({ valeur, onChange, label, name }: GrilleDIconesProps) {
  const t = useT()
  return (
    <fieldset className={styles.grille}>
      <legend className={styles.legende}>{label}</legend>
      {ICONES_DE_DOSSIER.map((icone) => {
        const choisie = icone === valeur
        const nom = t(`explorer.folderIcons.${icone}`)
        return (
          <label key={icone} className={cx(styles.cellule, choisie && styles.choisie)} title={nom}>
            <input
              type="radio"
              name={name}
              value={icone}
              aria-label={nom}
              checked={choisie}
              className={styles.input}
              onChange={() => onChange(icone)}
            />
            <Icon name={icone} size={14} strokeWidth={2} />
          </label>
        )
      })}
    </fieldset>
  )
}
