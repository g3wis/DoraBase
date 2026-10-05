import type { CSSProperties } from 'react'
import { dessinDIcone, ICONES_DE_DOSSIER } from '../../data/iconesDeDossier'
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
  /**
   * Les icônes offertes, dans l'ordre de la grille — celles d'un dossier à défaut. Une connexion
   * passe les siennes, le logo de son moteur en tête (#179).
   */
  icones?: readonly IconName[]
  /**
   * Les noms qui ne viennent pas d'`explorer.folderIcons.*` — le logo d'un moteur, nommé par le
   * moteur (#179) : « PostgreSQL » est le nom que lui donne déjà le sélecteur de moteur d'`A2`.
   */
  noms?: Partial<Record<IconName, string>>
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
export function GrilleDIcones({
  valeur,
  onChange,
  label,
  name,
  icones = ICONES_DE_DOSSIER,
  noms,
}: GrilleDIconesProps) {
  const t = useT()
  return (
    // **Le logo d'un moteur se dessine à l'encre de la grille** (#179) : `--logo-tint` le fait suivre
    // `currentColor`, comme les icônes en trait. En teinte de marque, il serait la seule case colorée
    // de la grille — et le navy de SQLite disparaîtrait sur la pastille sombre de la case choisie. La
    // grille choisit une forme ; la couleur se choisit dans la rangée du dessus.
    <fieldset className={styles.grille} style={{ '--logo-tint': 'currentColor' } as CSSProperties}>
      <legend className={styles.legende}>{label}</legend>
      {icones.map((icone) => {
        const choisie = icone === valeur
        const nom = noms?.[icone] ?? t(`explorer.folderIcons.${icone}`)
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
            <Icon name={dessinDIcone(icone)} size={14} strokeWidth={2} />
          </label>
        )
      })}
    </fieldset>
  )
}
