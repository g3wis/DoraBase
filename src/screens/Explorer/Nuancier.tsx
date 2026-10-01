import type { FolderColor } from '../../domain/config'
import { cx } from '../../ui/cx'
import { COULEURS_DE_DOSSIER, ORDRE_DES_COULEURS } from '../NewConnection/environments'
import styles from './Nuancier.module.css'

type NuancierProps = {
  /** La couleur choisie ; `null` : aucune pastille. */
  valeur: FolderColor | null
  onChange: (couleur: FolderColor | null) => void
  /** Le nom du groupe, lu par la voix. */
  label: string
  /** Le nom accessible de la pastille « aucune ». */
  labelAucune: string
  /** Le nom du groupe de cases radio : deux nuanciers dans la même page ne doivent pas se mêler. */
  name: string
}

/**
 * La rangée de pastilles d'une couleur de dossier (#166).
 *
 * **Extraite de l'éditeur de projet**, qui la posait sur chaque environnement, et non redessinée :
 * aucune maquette ne décrit le choix d'une couleur de dossier, et la rangée existante est ce que le
 * produit dessine déjà pour ce geste.
 *
 * **Une sixième pastille, « aucune »**, parce qu'un dossier peut n'avoir pas de couleur — ce que
 * l'environnement ne pouvait pas. Elle porte la teinte que l'arbre donne alors à la ligne,
 * `--accent-deep` : choisir « aucune », c'est choisir exactement ce que l'arbre montrera, et un jeton
 * existant plutôt qu'un pixel inventé.
 *
 * **De vraies cases radio, non des `<button role="radio">`** : le groupe natif apporte la navigation
 * aux flèches sans une ligne de code, là où le rôle ARIA l'aurait seulement *promise*.
 */
export function Nuancier({ valeur, onChange, label, labelAucune, name }: NuancierProps) {
  const options: { couleur: FolderColor | null; fond: string; nom: string }[] = [
    { couleur: null, fond: 'var(--accent-deep)', nom: labelAucune },
    ...ORDRE_DES_COULEURS.map((couleur) => ({
      couleur,
      fond: COULEURS_DE_DOSSIER[couleur],
      nom: couleur,
    })),
  ]
  return (
    <div className={styles.nuancier} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <input
          key={option.nom}
          type="radio"
          name={name}
          aria-label={option.nom}
          checked={valeur === option.couleur}
          className={cx(styles.pastille, valeur === option.couleur && styles.choisie)}
          style={{ background: option.fond }}
          onChange={() => onChange(option.couleur)}
        />
      ))}
    </div>
  )
}
