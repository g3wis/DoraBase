import { type ReactNode, useEffect, useRef, useState } from 'react'
import styles from './ApercuTronque.module.css'

/** Le délai du survol prolongé — celui que le panneau de ligne emploie depuis `10f`. */
const SURVOL_MS = 500

/** Ce que le survol prolongé montre : un texte, et où le poser. */
type Apercu = { texte: string; haut: number; gauche: number }

export type ApercuTronque = {
  /** À poser sur `onMouseEnter` de l'élément qui coupe son texte à l'ellipse. */
  armer: (partie: HTMLElement, texte: string) => void
  /** À poser sur `onMouseLeave`, et sur tout geste qui doit refermer l'aperçu. */
  desarmer: () => void
  /** L'aperçu à rendre, ou `null` : **en fin de composant**, jamais dans ce qui défile. */
  apercu: ReactNode
}

/**
 * Le texte entier d'un libellé coupé à l'ellipse, au survol prolongé.
 *
 * **Sorti du panneau de ligne (`RowPanel`)** quand les onglets de résultat d'une console en ont eu
 * besoin (#156) : la même promesse — « ce que l'ellipse coupe se lit en s'y attardant » — ne doit
 * avoir qu'une mécanique, sinon les deux divergent au premier réglage de délai ou de cote.
 *
 * Trois décisions, reprises telles qu'elles étaient :
 *
 * - **seulement si c'est coupé.** Un aperçu qui répète un texte entièrement lisible n'apprend rien
 *   et masque ses voisins. La coupure se mesure sur le rendu — `scrollWidth` contre `clientWidth` —
 *   et non sur la longueur du texte : la police, la largeur et le zoom décident, aucun seuil de
 *   caractères ne les connaît ;
 * - **la boîte est mesurée à l'armement, pas à l'échéance** : dans une demi-seconde, la souris peut
 *   avoir fait défiler ce qui la porte ;
 * - **en `position: fixed`, rendu hors de ce qui défile** : le poser dans une liste le ferait rogner
 *   par elle — défaut n° 35.
 */
export function useApercuTronque(): ApercuTronque {
  const [revelation, setRevelation] = useState<Apercu | null>(null)
  const minuteur = useRef<number | undefined>(undefined)

  // Le minuteur ne survit pas au démontage : l'aperçu d'un texte qui n'est plus affiché paraîtrait.
  useEffect(() => () => window.clearTimeout(minuteur.current), [])

  function desarmer() {
    window.clearTimeout(minuteur.current)
    setRevelation(null)
  }

  function armer(partie: HTMLElement, texte: string) {
    window.clearTimeout(minuteur.current)
    if (partie.scrollWidth <= partie.clientWidth + 1) {
      setRevelation(null)
      return
    }
    const boite = partie.getBoundingClientRect()
    minuteur.current = window.setTimeout(() => {
      setRevelation({ texte, haut: boite.bottom + 4, gauche: boite.left })
    }, SURVOL_MS)
  }

  return {
    armer,
    desarmer,
    apercu: revelation && (
      <div className={styles.apercu} style={{ top: revelation.haut, left: revelation.gauche }}>
        {revelation.texte}
      </div>
    ),
  }
}
