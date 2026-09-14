import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useRefusDuZoom } from './useRefusDuZoom'

/**
 * Le refus est mesuré sur `defaultPrevented`, et il n'y a rien d'autre à mesurer : le crochet
 * n'applique plus aucun facteur — c'est tout le changement d'`API-57`. Un test qui vérifierait
 * qu'« aucun zoom n'est appliqué » mesurerait une fonction qui n'existe plus.
 *
 * Les événements sont émis sur `document.body` plutôt que sur `document` : l'écouteur est en
 * capture, donc un test qui viserait directement la cible de l'écouteur ne dirait pas si la capture
 * fonctionne. Un pincement arrive sur l'élément sous le pointeur.
 */
function emettre(evenement: Event): boolean {
  document.body.dispatchEvent(evenement)
  return evenement.defaultPrevented
}

describe('le refus du zoom global (`useRefusDuZoom`)', () => {
  it('le pincement du trackpad est refusé, et le refus est actif', () => {
    renderHook(() => useRefusDuZoom())
    // Le pincement, c'est `ctrlKey` — la convention de WebKit comme de Chromium. Ne rien faire ne
    // suffirait pas : sans `preventDefault`, la webview appliquerait son propre pas, de dix à
    // vingt-cinq pour cent par cran.
    const pincement = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    })
    expect(emettre(pincement)).toBe(true)
  })

  it('`⌘` + molette est refusé aussi : c’était le dernier zoom global', () => {
    renderHook(() => useRefusDuZoom())
    const geste = new WheelEvent('wheel', {
      deltaY: -100,
      metaKey: true,
      cancelable: true,
      bubbles: true,
    })
    expect(emettre(geste)).toBe(true)
  })

  it('un défilement ordinaire passe : le refus ne paralyse pas les grilles', () => {
    renderHook(() => useRefusDuZoom())
    const defilement = new WheelEvent('wheel', { deltaY: 100, cancelable: true, bubbles: true })
    expect(emettre(defilement)).toBe(false)
  })

  it('les trois gestes de pincement de WebKit sont refusés', () => {
    renderHook(() => useRefusDuZoom())
    // Chromium ne les émet pas ; un `Event` du bon nom suffit à vérifier que l'écouteur est posé et
    // qu'il refuse — ce que jsdom peut dire, contrairement au geste lui-même.
    for (const nom of ['gesturestart', 'gesturechange', 'gestureend'])
      expect(emettre(new Event(nom, { cancelable: true, bubbles: true }))).toBe(true)
  })

  it('le démontage retire les écouteurs, capture comprise', () => {
    // `removeEventListener` sans le drapeau de capture ne retirerait rien : le crochet fuirait un
    // écouteur par montage, et le refus survivrait à l'écran qui l'a demandé.
    const { unmount } = renderHook(() => useRefusDuZoom())
    unmount()
    const pincement = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    })
    expect(emettre(pincement)).toBe(false)
  })
})
