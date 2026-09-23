import { useEffect, useLayoutEffect, useRef } from 'react'

/**
 * Ce qu'un cran de molette pèse, en pixels de `deltaY`.
 *
 * **C'est la valeur qu'une souris envoie pour un crantage** — Chromium comme WebKit rendent 100 en
 * `DOM_DELTA_PIXEL` —, donc un cran de molette vaut exactement un palier, ce qui est la seule
 * correspondance qu'un utilisateur puisse prévoir. Le pincement d'un trackpad, lui, arrive par
 * dizaines d'événements de quelques pixels : c'est l'accumulation qui les rassemble, et il en faut
 * une poignée pour franchir un palier — un zoom qui traverserait les sept sur un seul geste ne se
 * viserait pas.
 */
export const SEUIL_DE_CRAN = 100

/**
 * Le rapport d'échelle qu'un pincement doit franchir pour valoir un cran, sur les navigateurs qui
 * rendent les `gesture*` de WebKit plutôt qu'un `wheel`.
 *
 * Les sept paliers sont espacés de 1,18 à 1,38 ; 1,2 est dans cette famille, donc un pincement
 * avance à peu près au même rythme que ce qu'il produit à l'écran.
 */
export const FACTEUR_DE_PINCEMENT = 1.2

/** Les deux unités de `deltaMode` qui ne sont pas des pixels, ramenées à des pixels. */
const PIXELS_PAR_LIGNE = 16
const PIXELS_PAR_PAGE = 400

/**
 * `deltaY` en pixels, quelle que soit l'unité que le navigateur a choisie.
 *
 * `WheelEvent.deltaMode` vaut 0 (pixels), 1 (lignes) ou 2 (pages) : Firefox rend des **lignes**, où
 * un crantage vaut 3. Sans cette conversion, le seuil ne serait jamais franchi là-bas — un zoom
 * qui ne répond pas, sans que rien échoue.
 */
export function deltaEnPixels(delta: number, mode: number): number {
  if (mode === 1) return delta * PIXELS_PAR_LIGNE
  if (mode === 2) return delta * PIXELS_PAR_PAGE
  return delta
}

/**
 * Les crans qu'un `deltaY` fait franchir, et ce qu'il reste dans l'accumulateur.
 *
 * **Le signe s'inverse** : défiler vers le bas (`deltaY > 0`) **réduit**, comme le pincement qui se
 * referme, et c'est la convention de tous les logiciels qui zooment à la molette.
 *
 * **Un changement de sens repart de zéro.** Sinon, inverser le geste devrait d'abord « rembourser »
 * ce que le sens précédent avait accumulé, et le premier cran du retour arriverait avec un
 * crantage de retard — sur un geste de visée, c'est le moment où l'on corrige, donc le pire endroit
 * où introduire une latence.
 */
export function cransDeMolette(
  cumulAvant: number,
  delta: number,
): { cumul: number; crans: number } {
  const depart = Math.sign(delta) === -Math.sign(cumulAvant) ? 0 : cumulAvant
  const cumul = depart + delta
  const franchis = Math.trunc(cumul / SEUIL_DE_CRAN)
  return { cumul: cumul - franchis * SEUIL_DE_CRAN, crans: -franchis }
}

/**
 * Les crans qu'un pincement fait franchir, et la référence d'échelle qu'il laisse derrière lui.
 *
 * `GestureEvent.scale` est **cumulatif depuis le début du geste**, non incrémental : ce qui compte
 * est donc son rapport à l'échelle du dernier cran rendu, et c'est cette échelle-là qu'on garde.
 * Le logarithme couvre le cas d'un pincement franc, qui franchit deux paliers entre deux
 * événements.
 */
export function cransDePincement(
  reference: number,
  echelleDuGeste: number,
): { reference: number; crans: number } {
  if (!(reference > 0) || !(echelleDuGeste > 0)) return { reference, crans: 0 }
  const crans = Math.trunc(Math.log(echelleDuGeste / reference) / Math.log(FACTEUR_DE_PINCEMENT))
  if (crans === 0) return { reference, crans }
  return { reference: reference * FACTEUR_DE_PINCEMENT ** crans, crans }
}

/** Ce qu'il faut retenir d'un geste pour que le dessin ne glisse pas sous le pointeur. */
export type Ancrage = {
  /** Le défilement de la zone **avant** le changement d'échelle. */
  defilement: number
  /** La position du pointeur dans la zone visible, sur le même axe. */
  pointeur: number
  /** L'échelle à laquelle ce défilement et ce pointeur ont été relevés. */
  echelle: number
}

/**
 * Le défilement qui garde sous le pointeur le point du dessin qui y était.
 *
 * Le point visé, en coordonnées du plan, est `(defilement + pointeur) / echelle` — `disposition`
 * calcule à l'échelle 1 et c'est `transform: scale` qui agrandit, depuis `transform-origin: 0 0`.
 * Le remettre sous le pointeur à la nouvelle échelle donne `point × echelle − pointeur`.
 *
 * **Sans ancrage, le zoom s'accroche au coin haut-gauche** : la table qu'on regardait file hors de
 * l'écran au deuxième cran, et sur une toile de plusieurs milliers de pixels on ne la retrouve pas.
 *
 * La valeur rendue peut être **négative** — près de l'origine, à la réduction — et c'est voulu :
 * le DOM la ramène à zéro lui-même, et la borner ici ferait croire à une règle qui n'existe pas.
 */
export function defilementAncre(ancre: Ancrage, echelle: number): number {
  return ((ancre.defilement + ancre.pointeur) / ancre.echelle) * echelle - ancre.pointeur
}

/** L'ancrage relevé au geste : les deux axes, plus l'échelle à laquelle ils ont été lus. */
type AncrageDuGeste = { x: number; y: number; gauche: number; haut: number; echelle: number }

/** Ce que WebKit émet pour un pincement de trackpad, et que `lib.dom` ne décrit pas. */
type EvenementDePincement = Event & { scale?: number; clientX?: number; clientY?: number }

const PINCEMENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const

/**
 * Zoomer une toile à la souris — `⌘` / `Ctrl` + molette, et le pincement du trackpad (`API-82`).
 *
 * # Pourquoi ce n'est pas le zoom global qu'`API-57` a retiré
 *
 * `API-57` a retiré le zoom de la **webview**, et il le refuse activement depuis (`useRefusDuZoom`).
 * Ce qui est offert ici est le zoom d'une **vue** : il grossit un dessin, pas l'écran qui l'entoure,
 * et cette distinction est celle qu'`API-57` écrivait déjà en gardant les paliers du diagramme.
 * Les deux cohabitent parce qu'ils ne font pas la même chose au même objet.
 *
 * # L'ordre des deux écouteurs est décidé, non subi
 *
 * `API-57` prévenait qu'« un second zoom sur les mêmes gestes ferait dépendre l'échelle de qui
 * écoute l'événement le premier ». Le refus global écoute sur `document` en **capture**, donc il
 * passe toujours avant celui-ci et tue le zoom natif ; il ne coupe pas la propagation, donc
 * l'événement arrive quand même ici. Et ce crochet refuse **aussi** de son côté : une vitrine peut
 * monter la toile sans monter `App`, et un geste qui zoomerait la webview parce qu'un crochet
 * distant manque serait exactement le défaut qu'`API-57` a corrigé.
 *
 * # Le défilement est ajusté après le rendu, et depuis des valeurs relevées avant
 *
 * Deux pièges, et le même remède. Poser le défilement dans le gestionnaire le ferait **borner par
 * l'ancien cadre** — la zone défilante ne connaît le nouveau que lorsque React a rendu. Et le
 * relire après le rendu ne servirait à rien : à la réduction, le navigateur l'a déjà ramené dans
 * les bornes du cadre rétréci, donc la position d'origine est perdue. L'ancrage est donc **relevé
 * au geste** et **appliqué en `useLayoutEffect`**, avant que quoi que ce soit ne soit peint.
 *
 * C'est aussi ce qui permet à plusieurs événements de se succéder avant un rendu — ce que fait un
 * pincement : chacun réécrit l'ancrage avec le même défilement et la même échelle de départ, que
 * rien n'a encore changés, et seul le dernier pointeur compte.
 *
 * # Ce que cet outillage ne peut pas voir
 *
 * Chromium n'émet pas les `gesture*` de WebKit : la branche du pincement n'est exercée par aucun
 * test de ce dépôt, et à ne pas présenter comme vérifiée — c'est déjà la réserve que porte
 * `useRefusDuZoom`, sur les mêmes trois événements.
 */
export function useZoomALaSouris({
  zone,
  echelle,
  parCrans,
}: {
  zone: HTMLElement | null
  /** L'échelle **rendue**, celle que le DOM porte au moment où un geste arrive. */
  echelle: number
  /** Applique `crans` paliers, et rend `true` si l'échelle en a changé — voir `reglerLePalier`. */
  parCrans: (crans: number) => boolean
}) {
  const ancrage = useRef<AncrageDuGeste | undefined>(undefined)
  const cumul = useRef(0)
  const pincement = useRef(1)
  const echelleRendue = useRef(echelle)
  /*
   * `parCrans` est recréée à chaque rendu de l'hôte, et la garder dans une ref est ce qui permet aux
   * écouteurs de ne s'attacher qu'une fois — les réattacher à chaque frappe du champ de recherche
   * serait du travail pour rien.
   *
   * **Sa mise à jour n'est exercée par aucun test, et le dire vaut mieux que de le laisser croire**
   * (règle n° 1) : le `parCrans` d'aujourd'hui ne touche que des refs et `setPalier`, tous stables,
   * donc la fermeture du premier rendu resterait juste — retirer le rafraîchissement laisse la suite
   * verte, vérifié. C'est une précondition écrite, comme l'`arrivee` d'`API-55` : le jour où
   * `parCrans` lira une valeur de rendu, son absence ne se dénoncerait pas autrement que par un
   * zoom qui répond à côté.
   */
  const rappel = useRef(parCrans)

  useLayoutEffect(() => {
    rappel.current = parCrans
  })

  useLayoutEffect(() => {
    echelleRendue.current = echelle
    const ancre = ancrage.current
    ancrage.current = undefined
    if (!zone || !ancre || ancre.echelle === echelle) return
    zone.scrollLeft = defilementAncre(
      { defilement: ancre.gauche, pointeur: ancre.x, echelle: ancre.echelle },
      echelle,
    )
    zone.scrollTop = defilementAncre(
      { defilement: ancre.haut, pointeur: ancre.y, echelle: ancre.echelle },
      echelle,
    )
  }, [echelle, zone])

  useEffect(() => {
    if (!zone) return

    function appliquer(crans: number, clientX: number, clientY: number) {
      if (!zone || crans === 0) return
      // `.toile` n'a ni bordure ni rembourrage, donc la boîte de l'élément est celle du défilement.
      const cadre = zone.getBoundingClientRect()
      const ancre = {
        x: clientX - cadre.left,
        y: clientY - cadre.top,
        gauche: zone.scrollLeft,
        haut: zone.scrollTop,
        echelle: echelleRendue.current,
      }
      // **L'ancrage n'est retenu que si l'échelle bouge.** Au plancher comme au plafond, le geste
      // ne change rien : garder un ancrage que rien ne viendrait consommer le ferait appliquer au
      // prochain clic sur un bouton de zoom, depuis un défilement devenu faux entre-temps.
      if (rappel.current(crans)) ancrage.current = ancre
    }

    function auGeste(evenement: WheelEvent) {
      // **La molette nue défile**, et c'est l'arbitrage d'`API-82` : la reprendre retirerait le seul
      // défilement vertical confortable d'un schéma haut.
      if (!evenement.ctrlKey && !evenement.metaKey) return
      evenement.preventDefault()
      const { cumul: reste, crans } = cransDeMolette(
        cumul.current,
        deltaEnPixels(evenement.deltaY, evenement.deltaMode),
      )
      cumul.current = reste
      appliquer(crans, evenement.clientX, evenement.clientY)
    }

    function auPincement(evenement: Event) {
      evenement.preventDefault()
      const geste = evenement as EvenementDePincement
      if (evenement.type === 'gesturestart') {
        pincement.current = 1
        return
      }
      if (evenement.type === 'gestureend' || typeof geste.scale !== 'number') return
      const { reference, crans } = cransDePincement(pincement.current, geste.scale)
      pincement.current = reference
      appliquer(crans, geste.clientX ?? 0, geste.clientY ?? 0)
    }

    zone.addEventListener('wheel', auGeste, { passive: false })
    for (const nom of PINCEMENTS) zone.addEventListener(nom, auPincement, { passive: false })
    return () => {
      zone.removeEventListener('wheel', auGeste)
      for (const nom of PINCEMENTS) zone.removeEventListener(nom, auPincement)
    }
  }, [zone])
}
