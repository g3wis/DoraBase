import { render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSortieDuPointeur } from './sortieDuPointeur'

/**
 * L'arithmétique de la zone de sortie, et elle seule.
 *
 * **Ce n'est pas une mesure de mise en page** (règle n° 9) : les boîtes sont *posées*, non calculées
 * — jsdom n'en calcule aucune, et c'est justement ce qui laisse en éprouver le raisonnement à la
 * milliseconde et au pixel près, là où un test de bout en bout ne peut qu'imiter une main. Les deux
 * niveaux se répondent : `e2e/27-menu-de-ligne.spec.ts` garde le geste sur la vraie géométrie, ici
 * on garde les deux constantes — le délai et le débord —, qu'aucune main ne peut viser.
 */

/** Un déclencheur de 18 px, et un panneau de 200 px qui pend en dessous et à gauche : `RowMenu`. */
const DECLENCHEUR = { left: 204, right: 222, top: 221, bottom: 239 }
const PANNEAU = { left: 22, right: 222, top: 242, bottom: 411 }

function poserLaBoite(element: HTMLElement, boite: typeof DECLENCHEUR) {
  element.getBoundingClientRect = () =>
    ({
      ...boite,
      x: boite.left,
      y: boite.top,
      width: boite.right - boite.left,
      height: boite.bottom - boite.top,
      toJSON: () => '',
    }) as DOMRect
}

function Sujet({ fermer }: { fermer: () => void }) {
  const declencheur = useRef<HTMLDivElement>(null)
  const panneau = useRef<HTMLDivElement>(null)
  useSortieDuPointeur(true, fermer, [declencheur, panneau])
  return (
    <>
      <div data-testid="declencheur" ref={declencheur} />
      <div data-testid="panneau" ref={panneau} />
    </>
  )
}

function bouger(x: number, y: number) {
  document.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }))
}

describe('useSortieDuPointeur', () => {
  let fermer = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    fermer = vi.fn()
    render(<Sujet fermer={fermer} />)
    poserLaBoite(screen.getByTestId('declencheur'), DECLENCHEUR)
    poserLaBoite(screen.getByTestId('panneau'), PANNEAU)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /* Le point qui a motivé `API-35` : sur la ligne d'arbre, à gauche du « … » et au-dessus du
     panneau. Il n'est **dans aucun des deux**, et c'est pourtant par là qu'on va de l'un à l'autre. */
  it('ne ferme pas quand le pointeur passe entre le déclencheur et le panneau', () => {
    bouger(120, 230)
    vi.advanceTimersByTime(5_000)
    expect(fermer).not.toHaveBeenCalled()
  })

  it('ferme quand le pointeur quitte la boîte des deux', () => {
    bouger(120, 100)
    expect(fermer).not.toHaveBeenCalled()
    vi.advanceTimersByTime(150)
    expect(fermer).toHaveBeenCalledTimes(1)
  })

  /* Le délai de grâce, seul : un aller-retour hors de la zone ne doit rien fermer. C'est la moitié
     du comportement que la zone ne porte pas, et la seule façon de la mesurer est de tenir l'horloge
     — ce qu'un test de bout en bout ne peut pas faire. */
  it('ne ferme pas si le pointeur revient avant la fin du délai', () => {
    bouger(120, 100)
    vi.advanceTimersByTime(100)
    bouger(120, 300)
    vi.advanceTimersByTime(5_000)
    expect(fermer).not.toHaveBeenCalled()
  })

  /* **L'échéance part du premier départ.** Sans cela, promener la souris hors de la zone la
     repousserait à chaque mouvement, et un menu abandonné ne se fermerait jamais tant que la main
     bouge. */
  it('ne repousse pas l’échéance à chaque mouvement hors de la zone', () => {
    bouger(120, 100)
    vi.advanceTimersByTime(100)
    bouger(121, 100)
    vi.advanceTimersByTime(50)
    expect(fermer).toHaveBeenCalledTimes(1)
  })

  /* Le débord. Il existe pour `MenuContextuel`, qui s'ouvre avec son coin sous le pointeur : sans
     lui, la moitié des directions quitteraient le menu au premier pixel. */
  it('tolère un débord de quelques pixels, et pas davantage', () => {
    bouger(PANNEAU.left - 4, 300)
    vi.advanceTimersByTime(5_000)
    expect(fermer).not.toHaveBeenCalled()

    bouger(PANNEAU.left - 6, 300)
    vi.advanceTimersByTime(150)
    expect(fermer).toHaveBeenCalledTimes(1)
  })

  /* Sans boîte mesurable — jsdom sans les boîtes posées ci-dessus, un panneau pas encore rendu — on
     ne conclut pas à un départ. Une zone de zéro pixel ferait fermer au premier mouvement. */
  it('ne conclut rien quand aucune boîte n’est mesurable', () => {
    for (const identifiant of ['declencheur', 'panneau']) {
      screen.getByTestId(identifiant).getBoundingClientRect = () =>
        ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, toJSON: () => '' }) as DOMRect
    }
    bouger(600, 600)
    vi.advanceTimersByTime(5_000)
    expect(fermer).not.toHaveBeenCalled()
  })
})
