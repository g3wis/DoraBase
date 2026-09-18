import { useCallback, useRef, useState } from 'react'

/**
 * Ce que rend un conteneur qu'on n'a pas pu mesurer — jsdom notamment, qui ne calcule aucune mise
 * en page (règle n° 9).
 *
 * **Une valeur, et non zéro** : une hauteur nulle ne monterait aucune ligne, et les tests qui
 * comptent les lignes visibles passeraient pour la mauvaise raison.
 */
const HAUTEUR_NON_MESUREE = 400

/**
 * La hauteur d'un conteneur, mesurée, pour la `viewportHeight` de `VirtualGrid`.
 *
 * **Pourquoi l'hôte mesure et non la grille** : `VirtualGrid` prend une hauteur en *valeur* parce
 * qu'elle calcule quelles lignes monter en divisant le défilement par le pas — une virtualisation
 * qui lirait `clientHeight` elle-même rendrait zéro ligne sous Vitest. La mesure vit donc chez
 * l'appelant, où un test n'en dépend pas, et c'est Playwright qui vérifie qu'elle suit le panneau.
 *
 * **Et pourquoi elle vit ici plutôt que dans chaque écran** (18 septembre 2026, `API-74`). Elle
 * était privée à `A5`, et la console mountait sa grille avec un `viewportHeight={320}` **écrit en
 * dur** : 320 px moins les 26 px de l'en-tête collé font onze lignes, quelles que soient la fenêtre
 * et la position de la poignée — rapporté à l'usage, « always 11 rows, does not scale with
 * available space ». La question « quelle hauteur la grille a-t-elle ? » n'a qu'une réponse, elle
 * doit n'avoir qu'un lieu : c'est la leçon du `HOME` lu à quatre endroits, appliquée aux hôtes de
 * `VirtualGrid`. Un troisième écran qui montera une grille trouvera la mesure au lieu de la
 * recopier — ou, ce qui est arrivé ici, de la remplacer par une constante.
 *
 * **Une ref de rappel, et non une `useRef` + `useEffect`.** Les branches de `ConsoleResult` rendent
 * des racines différentes selon l'état — attente, erreur, vide, grille —, donc l'élément à mesurer
 * **n'existe pas au montage** : un effet à dépendances vides serait parti une fois, sur un
 * `ref.current` nul, et n'aurait plus jamais rien observé. Le défaut serait muet, la grille gardant
 * sa hauteur de repli. Une ref de rappel est appelée à chaque fois que l'élément entre ou sort, ce
 * qui est exactement la question posée.
 *
 * @param retrait Ce que le conteneur porte **en plus** de la grille, en pixels — la toolbar d'`A5`.
 *   Zéro quand la ref est posée sur l'emplacement de la grille elle-même, ce qui est le cas simple
 *   et celui qu'il vaut mieux viser.
 */
export function useHauteurDisponible(retrait = 0) {
  const [valeur, setValeur] = useState(HAUTEUR_NON_MESUREE)
  const observateur = useRef<ResizeObserver | null>(null)

  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      observateur.current?.disconnect()
      observateur.current = null
      if (!element) return

      // **Lue tout de suite, et pas seulement au premier tour de l'observateur.** La ref de rappel
      // est appelée pendant le commit, donc avant la peinture ; l'observateur, lui, ne rend sa
      // première mesure qu'après. Mesuré plutôt que supposé, en relevant les hauteurs successives
      // de la zone défilante : sans cette lecture, elle vaut `400px` puis `450px` — la grille est
      // rendue une fois à sa hauteur de repli, à chaque ouverture de résultat. Avec elle, `450px`
      // et rien d'autre. Un test de bout en bout garde les deux valeurs.
      const mesurer = () => {
        const disponible = element.clientHeight - retrait
        if (disponible > 0) setValeur(disponible)
      }
      mesurer()

      if (typeof ResizeObserver === 'undefined') return
      const nouveau = new ResizeObserver(mesurer)
      nouveau.observe(element)
      observateur.current = nouveau
    },
    [retrait],
  )

  return { ref, valeur }
}
