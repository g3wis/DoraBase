import type { FolderColor } from '../../domain/config'
import { useT } from '../../i18n/LanguageContext'
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
  /**
   * L'anneau de « aucune » : la teinte que l'arbre donne à la ligne sans couleur — `--accent-deep`
   * pour un dossier, le jeton du moteur pour une connexion (#179). L'anneau dit ce que l'arbre
   * montrera ; il ne peut le dire que s'il le suit.
   */
  teinteAucune?: string
}

/**
 * La rangée de pastilles d'une couleur de dossier (#166).
 *
 * **Extraite de l'éditeur de projet**, qui la posait sur chaque environnement, et non redessinée :
 * aucune maquette ne décrit le choix d'une couleur de dossier, et la rangée existante est ce que le
 * produit dessine déjà pour ce geste.
 *
 * **Une sixième pastille, « aucune », creuse** (#171, arbitré par le propriétaire après revue) : un
 * anneau fin à la teinte que l'arbre donne alors à la ligne, `--accent-deep`, sur un fond
 * transparent. Pleine, elle se lisait comme une sixième couleur — l'accent du produit — et non comme
 * l'absence de choix ; creuse, elle dit « rien », et l'anneau dit quand même ce que l'arbre montrera.
 *
 * **Chaque pastille est nommée en toutes lettres** (`explorer.folderColors.*`), en nom accessible
 * **et** en `title`, comme les cases de `GrilleDIcones` : « amber » n'est un nom pour personne.
 *
 * **Une case de 22 px autour d'un dessin de 9** : la pastille est posée dans un `<label>` de la taille
 * d'une case de la grille d'icônes, dont elle partage les colonnes — la cible se vise comme une case,
 * le dessin garde sa taille. C'est la forme de `GrilleDIcones`, à ceci près que la case radio **est**
 * le dessin (`appearance: none`) au lieu d'être masquée.
 *
 * **De vraies cases radio, non des `<button role="radio">`** : le groupe natif apporte la navigation
 * aux flèches sans une ligne de code, là où le rôle ARIA l'aurait seulement *promise*.
 */
export function Nuancier({
  valeur,
  onChange,
  label,
  labelAucune,
  name,
  teinteAucune,
}: NuancierProps) {
  const t = useT()
  const options: { couleur: FolderColor | null; fond: string | null; nom: string }[] = [
    { couleur: null, fond: null, nom: labelAucune },
    ...ORDRE_DES_COULEURS.map((couleur) => ({
      couleur,
      fond: COULEURS_DE_DOSSIER[couleur],
      nom: t(`explorer.folderColors.${couleur}`),
    })),
  ]
  return (
    <div className={styles.nuancier} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option.couleur ?? 'aucune'} className={styles.case} title={option.nom}>
          <input
            type="radio"
            name={name}
            aria-label={option.nom}
            checked={valeur === option.couleur}
            className={cx(
              styles.pastille,
              option.fond === null && styles.aucune,
              valeur === option.couleur && styles.choisie,
            )}
            style={
              option.fond !== null
                ? { background: option.fond }
                : teinteAucune === undefined
                  ? undefined
                  : { borderColor: teinteAucune }
            }
            onChange={() => onChange(option.couleur)}
          />
        </label>
      ))}
    </div>
  )
}
