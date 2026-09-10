import { type RefObject, useCallback, useEffect, useRef } from 'react'

/**
 * Le délai de grâce avant de fermer, en millisecondes.
 *
 * **Il n'est pas cosmétique.** Il absorbe le va-et-vient d'une main — un dépassement du bord du
 * panneau, puis le retour —, là où fermer sèchement au premier pixel franchi rendrait une entrée du
 * bas inatteignable selon la vitesse du geste.
 *
 * 150 ms : assez pour revenir sur ses pas, trop court pour qu'un menu abandonné traîne à l'écran.
 * **Ce n'est plus lui qui porte la traversée du déclencheur vers le panneau** — c'est la zone,
 * ci-dessous. Un délai calé sur la durée d'un geste serait un tirage au sort (règle n° 3) : une main
 * lente met plus de temps qu'une main rapide, et aucune valeur ne les couvre toutes les deux.
 */
const GRACE_MS = 150

/**
 * Le débord toléré autour de la zone, en pixels.
 *
 * `MenuContextuel` s'ouvre **avec son coin sous le pointeur** : sans débord, la moitié des
 * directions le quittent au premier pixel, un menu qu'on vient d'ouvrir. C'est la tolérance que le
 * produit accorde déjà à une cible étroite — les 5 px d'`inset: -5px` de la zone attrapable du
 * chevron d'arbre.
 */
const DEBORD = 5

/**
 * La boîte qui contient toutes les zones mesurables, débord compris. `null` quand aucune ne l'est —
 * jsdom rend des zéros partout, et une zone démontée n'a plus de boîte.
 */
function boiteDesZones(
  zones: readonly RefObject<HTMLElement | null>[],
): { gauche: number; droite: number; haut: number; bas: number } | null {
  let gauche = Number.POSITIVE_INFINITY
  let droite = Number.NEGATIVE_INFINITY
  let haut = Number.POSITIVE_INFINITY
  let bas = Number.NEGATIVE_INFINITY
  for (const zone of zones) {
    const mesure = zone.current?.getBoundingClientRect()
    if (!mesure || (mesure.width === 0 && mesure.height === 0)) continue
    gauche = Math.min(gauche, mesure.left)
    droite = Math.max(droite, mesure.right)
    haut = Math.min(haut, mesure.top)
    bas = Math.max(bas, mesure.bottom)
  }
  if (gauche === Number.POSITIVE_INFINITY) return null
  return {
    gauche: gauche - DEBORD,
    droite: droite + DEBORD,
    haut: haut - DEBORD,
    bas: bas + DEBORD,
  }
}

/**
 * Ferme un panneau quand le pointeur s'en éloigne, et **seulement s'il ne revient pas**.
 *
 * # Pourquoi ce comportement
 *
 * Un menu qu'on a quitté à la souris n'est plus celui qu'on visait : le laisser ouvert oblige à
 * cliquer dans le vide pour s'en débarrasser. Pour le menu d'une ligne d'arbre, c'était pire qu'un
 * désagrément — le panneau vit dans la gouttière `.actions`, que `TreeRow` repasse en
 * `visibility: hidden` hors survol. Le menu ne se fermait donc pas, il **disparaissait**, et
 * resurgissait au survol suivant de la ligne sans qu'on ait cliqué. Un menu qui réapparaît tout seul
 * ne s'explique pas.
 *
 * # La zone est géométrique, et non le sous-arbre du DOM (`API-35`)
 *
 * La première version posait `onPointerLeave` sur l'élément qui **contient** le déclencheur et le
 * panneau, et comptait sur un délai de grâce pour absorber l'interstice de 3 px entre les deux. Elle
 * mesurait la mauvaise chose. Un « … » de 18 px ouvre un panneau de 200 px **en dessous et à
 * gauche** : entre les deux, il y a la ligne d'arbre elle-même, qui n'appartient ni à l'un ni à
 * l'autre. Aller du déclencheur au menu, c'est donc *sortir* — et le geste naturel, longer la ligne
 * vers la gauche puis descendre, franchissait les 150 ms avant d'arriver. Mesuré : une pause de
 * 200 ms à vingt pixels du « … », sur la ligne dont c'est le menu, suffisait à le perdre. C'est le
 * signalement, mot pour mot — « disparaît pendant que le curseur traverse l'espace entre les trois
 * points et le popup ».
 *
 * **Le pointeur n'a pas quitté le panneau tant qu'il est dans la boîte qui contient le déclencheur
 * *et* le panneau.** Cette boîte couvre exactement le passage entre les deux, quelle que soit la
 * façon de le prendre — droit, en diagonale, ou en longeant. Aucun délai ne pouvait l'exprimer : la
 * question n'est pas *combien de temps* on met à traverser, mais *si l'on traverse*.
 *
 * D'où un écouteur de `pointermove` sur le document plutôt que les gestionnaires d'entrée et de
 * sortie d'un élément : ceux-ci ne parlent que de descendance dans le DOM, et le passage n'est pas
 * un descendant.
 *
 * # Ce que ça ne change pas
 *
 * **Le clavier n'est pas concerné** : sans pointeur, il n'y a pas de mouvement de pointeur, et les
 * fermetures existantes — `Échap`, le clic ailleurs, la perte de focus — restent seules aux commandes.
 *
 * **Sortir de la fenêtre ne ferme plus**, faute de mouvement à observer. C'est voulu, et c'est
 * l'arbitrage que `Popover` prend déjà sur la perte de focus : revenir à l'application ne doit pas
 * refermer le panneau qu'on y avait laissé.
 *
 * # Usage
 *
 * Les zones sont les éléments dont la boîte englobante définit le passage — pour un popover, son
 * déclencheur et son panneau.
 *
 * ```tsx
 * useSortieDuPointeur(ouvert, () => setOuvert(false), [racine, panneau])
 * ```
 */
export function useSortieDuPointeur(
  actif: boolean,
  fermer: () => void,
  zones: readonly RefObject<HTMLElement | null>[],
): void {
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null)
  // `fermer` et `zones` sont lus par un écouteur qui survit au rendu : passer par une ref évite de
  // le réinstaller à chaque rendu du parent — ce qui, pour `zones`, arriverait à *tous* les rendus,
  // le tableau étant reconstruit à chaque fois.
  const fermeture = useRef(fermer)
  fermeture.current = fermer
  const surveillees = useRef(zones)
  surveillees.current = zones

  const annuler = useCallback(() => {
    if (minuterie.current !== null) {
      clearTimeout(minuterie.current)
      minuterie.current = null
    }
  }, [])

  // **Le démontage annule.** Sans cela, un panneau retiré par un autre chemin — une ligne qui
  // disparaît de l'arbre, un `Échap` — laisserait une minuterie appeler `fermer` sur un composant
  // parti. React 19 le tolère, les tests non : la fuite ferait échouer le test *suivant*.
  useEffect(() => annuler, [annuler])

  useEffect(() => {
    // Inactif, la minuterie en cours est jetée : un panneau rouvert dans l'intervalle ne doit pas
    // être refermé par le départ précédent.
    if (!actif) {
      annuler()
      return
    }
    function auMouvement(evenement: PointerEvent) {
      const boite = boiteDesZones(surveillees.current)
      // Rien de mesurable — jsdom, ou un panneau pas encore posé : on ne conclut pas à un départ.
      if (boite === null) {
        annuler()
        return
      }
      const dedans =
        evenement.clientX >= boite.gauche &&
        evenement.clientX <= boite.droite &&
        evenement.clientY >= boite.haut &&
        evenement.clientY <= boite.bas
      if (dedans) {
        annuler()
        return
      }
      // **L'échéance part du premier départ**, et les mouvements suivants ne la repoussent pas :
      // sans quoi promener la souris hors de la zone rallongerait le sursis indéfiniment.
      if (minuterie.current !== null) return
      minuterie.current = setTimeout(() => {
        minuterie.current = null
        fermeture.current()
      }, GRACE_MS)
    }
    document.addEventListener('pointermove', auMouvement)
    return () => {
      document.removeEventListener('pointermove', auMouvement)
      annuler()
    }
  }, [actif, annuler])
}
