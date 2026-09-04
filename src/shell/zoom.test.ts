import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PASSERELLE_ZOOM, useZoom } from './useZoom'
import { facteurSuivant, ZOOM_MAX, ZOOM_MIN, ZOOM_NEUTRE } from './zoom'

describe('le pas du zoom (`facteurSuivant`)', () => {
  it('un cran de molette vaut environ 4 %, non les 10 à 25 % du zoom natif', () => {
    // C'est toute la demande : le pas natif de WKWebView rend la grille méconnaissable en deux crans.
    const apresUnCran = facteurSuivant(ZOOM_NEUTRE, 100)
    expect(1 - apresUnCran).toBeGreaterThan(0.03)
    expect(1 - apresUnCran).toBeLessThan(0.05)
  })

  it('le geste est réversible au pixel près', () => {
    // **La raison du pas multiplicatif.** Avec un pas additif, `−0,04` puis `+0,04` revient bien au
    // départ, mais le même geste agit deux fois plus fort en bas de course qu'en haut : l'effet perçu
    // dépend d'où l'on est. Ici, zoomer puis dézoomer d'autant revient exactement au point de départ,
    // à n'importe quelle échelle.
    const avant = 1.3
    expect(facteurSuivant(facteurSuivant(avant, -60), 60)).toBeCloseTo(avant, 10)
  })

  it('le même geste a le même effet relatif partout dans la course', () => {
    const enBas = facteurSuivant(0.8, 100) / 0.8
    const enHaut = facteurSuivant(1.5, 100) / 1.5
    expect(enBas).toBeCloseTo(enHaut, 10)
  })

  it('les bornes tiennent, dans les deux sens', () => {
    // Un geste long ne doit pas rendre les 11 px du handoff illisibles, ni réduire une grille de
    // dix-huit colonnes à trois.
    expect(facteurSuivant(ZOOM_MIN, 5000)).toBe(ZOOM_MIN)
    expect(facteurSuivant(ZOOM_MAX, -5000)).toBe(ZOOM_MAX)
  })
})

describe('le crochet (`useZoom`)', () => {
  it('hors de Tauri, le zoom fin laisse le geste du navigateur tranquille', () => {
    const appliquer = vi.fn(async () => {})
    // Le zoom est une capacité de la coquille : dans un navigateur, il n'y a pas de webview à
    // piloter, et reprendre le geste pour ne rien en faire retirerait le zoom natif sans rien offrir.
    // Ce test tourne sous jsdom, donc précisément hors de Tauri.
    renderHook(() => useZoom({ appliquer }, 'macos'))
    const geste = new WheelEvent('wheel', { deltaY: 100, metaKey: true, cancelable: true })
    window.dispatchEvent(geste)
    expect(appliquer).not.toHaveBeenCalled()
    expect(geste.defaultPrevented).toBe(false)
  })

  it('le pincement du trackpad est refusé, et ne zoome pas', () => {
    const appliquer = vi.fn(async () => {})
    renderHook(() => useZoom({ appliquer }, 'macos'))
    // Le pincement, c'est `ctrlKey` sans `metaKey` — la convention de WebKit comme de Chromium.
    const pincement = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true })
    window.dispatchEvent(pincement)
    // **Les deux moitiés de l'exigence.** Ne pas appliquer notre facteur ne suffit pas : sans
    // `preventDefault`, la webview appliquerait le sien, de dix à vingt-cinq pour cent par cran. Le
    // refus est actif.
    expect(appliquer).not.toHaveBeenCalled()
    expect(pincement.defaultPrevented).toBe(true)
  })

  it('le refus du pincement ne vaut pas refus de la molette', () => {
    const appliquer = vi.fn(async () => {})
    renderHook(() => useZoom({ appliquer }, 'macos'))
    // Un défilement ordinaire ne porte aucun modificateur : le reprendre paralyserait toutes les
    // grilles du produit.
    const defilement = new WheelEvent('wheel', { deltaY: 100, cancelable: true })
    window.dispatchEvent(defilement)
    expect(defilement.defaultPrevented).toBe(false)
  })

  /**
   * **Le refus du pincement est macOS seulement, et voici les deux moitiés du fait.**
   *
   * Les tests ci-dessus tournent sur la plateforme de cette machine ; celui-ci nomme la sienne,
   * sans quoi la branche hors macOS ne serait exercée par aucun test. C'est la raison du
   * paramètre `sur`.
   *
   * Hors macOS, `Ctrl` + molette est le geste de zoom volontaire de tous les logiciels — sous
   * Windows comme sous GTK —, et le pincement du pavé de précision arrive par le même
   * événement : le refuser retirerait le zoom au lieu de l'adoucir. L'événement n'est donc
   * **pas** refusé sèchement — il tombe dans le chemin du zoom fin, qui hors de Tauri (donc
   * sous jsdom) laisse le navigateur faire.
   *
   * **Les deux plateformes sont nommées** parce qu'elles rendent la même chose : un prédicat
   * resté sur `sur === 'windows'` laisserait Linux au refus de macOS, donc sans zoom au geste,
   * sans qu'aucune assertion Windows ne bouge.
   */
  it.each(['windows', 'linux'] as const)(
    'sous %s, Ctrl + molette n’est pas refusé : c’est le geste de zoom',
    (sur) => {
      const appliquer = vi.fn(async () => {})
      renderHook(() => useZoom({ appliquer }, sur))
      const geste = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true })
      window.dispatchEvent(geste)
      // Le refus actif de macOS n'a pas eu lieu.
      expect(geste.defaultPrevented).toBe(false)
    },
  )

  it('sur macOS, le même événement est refusé — les deux branches diffèrent bien', () => {
    const appliquer = vi.fn(async () => {})
    renderHook(() => useZoom({ appliquer }, 'macos'))
    const geste = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true })
    window.dispatchEvent(geste)
    expect(geste.defaultPrevented).toBe(true)
  })

  it('la passerelle de production parle bien à la webview', () => {
    // Un `appliquer` qui n'appellerait pas `setZoom` laisserait le zoom sans effet et les tests verts
    // — c'est le genre de câblage qu'un test de contrat attrape (défaut n° 36).
    expect(PASSERELLE_ZOOM.appliquer).toBeTypeOf('function')
  })
})
