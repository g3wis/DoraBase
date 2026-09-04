import { describe, expect, it } from 'vitest'
import {
  aUneVoieDeMiseAJour,
  dessineSesBoutonsDeFenetre,
  estMacos,
  modificateurActif,
  PLATEFORMES,
  plateforme,
  raccourci,
  seulLeModificateur,
  toucheMajuscule,
} from './plateforme'

/*
 * Les trois plateformes sont exercées **dans tous les sens**, sur la machine qui exécute les
 * tests, parce qu'elles sont passées en paramètre. Sans ce paramètre, `__APP_PLATFORM__` étant
 * figé à la compilation, une seule des branches aurait jamais été mesurée — et ce serait celle
 * qui marchait déjà.
 *
 * **Windows et Linux ne sont pas mesurés « par symétrie ».** Les deux rendent la même chose
 * partout, et c'est justement ce qui rend un oubli invisible : une fonction qui aurait gardé
 * `sur === 'windows'` au lieu de `!estMacos(sur)` laisserait Linux sur les valeurs de macOS,
 * donc `⌘` dans les libellés et aucun bouton de fenêtre, **sans qu'aucun test Windows ne
 * bouge**. Chaque assertion porte donc explicitement les deux.
 */

/** Les deux plateformes qui ne sont pas macOS, pour les propriétés qu'elles partagent. */
const HORS_MACOS = PLATEFORMES.filter((sur) => sur !== 'macos')

describe('toucheMajuscule', () => {
  it('écrit le pictogramme sur macOS et le mot ailleurs', () => {
    // La règle de `TOUCHES_HORS_MACOS`, appliquée à une touche que `raccourci` ne sait pas écrire
    // seule : `⇧`-clic est un geste de souris, où le modificateur de l'application n'entre pas.
    expect(toucheMajuscule('macos')).toBe('⇧')
    // Les deux plateformes nommées, comme partout dans ce fichier : un prédicat resté sur
    // Windows laisserait Linux au pictogramme, sans qu'une assertion Windows ne bouge.
    for (const sur of HORS_MACOS) {
      expect(toucheMajuscule(sur)).toBe('Shift')
    }
  })
})

describe('raccourci', () => {
  it('écrit la convention macOS : symboles collés, ⌘ juste avant la touche', () => {
    expect(raccourci('N', {}, 'macos')).toBe('⌘N')
    expect(raccourci('E', { maj: true }, 'macos')).toBe('⇧⌘E')
    expect(raccourci('H', { alt: true }, 'macos')).toBe('⌥⌘H')
    expect(raccourci('↩', {}, 'macos')).toBe('⌘↩')
  })

  it.each(HORS_MACOS)('écrit la convention de %s : Ctrl en tête, jointure par +', (sur) => {
    expect(raccourci('N', {}, sur)).toBe('Ctrl+N')
    expect(raccourci('E', { maj: true }, sur)).toBe('Ctrl+Shift+E')
    expect(raccourci('H', { alt: true }, sur)).toBe('Ctrl+Alt+H')
  })

  /**
   * **Le test qui justifie la fonction.** Un simple remplacement de `⌘` par `Ctrl+` aurait rendu
   * « Shift+Ctrl+E » : l'ordre des modificateurs s'inverse entre les deux conventions, et aucune
   * substitution de caractère ne peut l'exprimer.
   */
  it("inverse l'ordre des modificateurs, il ne substitue pas un symbole", () => {
    expect(raccourci('E', { maj: true }, 'macos')).toBe('⇧⌘E')
    expect(raccourci('E', { maj: true }, 'windows')).toBe('Ctrl+Shift+E')
    expect(raccourci('E', { maj: true }, 'windows')).not.toContain('Shift+Ctrl')
    expect(raccourci('E', { maj: true }, 'linux')).not.toContain('Shift+Ctrl')
  })

  it.each(HORS_MACOS)('traduit sur %s le nom des touches écrites en mots', (sur) => {
    expect(raccourci('↩', {}, sur)).toBe('Ctrl+Enter')
    // Une touche ordinaire traverse inchangée.
    expect(raccourci('0', {}, sur)).toBe('Ctrl+0')
  })

  /**
   * **Aucun `⌘` ne doit sortir d'ici hors macOS**, quelle que soit la combinaison — c'est
   * l'assertion que le test e2e mesure à l'écran, prise à la source.
   */
  it.each(HORS_MACOS)('ne laisse aucun pictogramme macOS passer sur %s', (sur) => {
    for (const modificateurs of [{}, { maj: true }, { alt: true }, { maj: true, alt: true }]) {
      const ecrit = raccourci('E', modificateurs, sur)
      expect(ecrit).not.toMatch(/[⌘⇧⌥]/)
    }
  })
})

describe('modificateurActif', () => {
  it('macOS : ⌘ ouvre, ctrl non', () => {
    expect(modificateurActif({ metaKey: true, ctrlKey: false }, 'macos')).toBe(true)
    expect(modificateurActif({ metaKey: false, ctrlKey: true }, 'macos')).toBe(false)
  })

  /**
   * **Le défaut que ceci garde** : `metaKey` hors macOS est la touche Windows ou « super ». Un
   * gestionnaire resté sur `metaKey` n'aurait pas levé d'erreur — le raccourci n'aurait jamais
   * répondu, pendant que son libellé continuait de l'annoncer.
   */
  it.each(HORS_MACOS)('%s : Ctrl ouvre, la touche système non', (sur) => {
    expect(modificateurActif({ metaKey: false, ctrlKey: true }, sur)).toBe(true)
    expect(modificateurActif({ metaKey: true, ctrlKey: false }, sur)).toBe(false)
  })
})

describe('seulLeModificateur', () => {
  const nu = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }

  it('macOS : ⌘ seul oui, ⇧⌘ non, ⌃⌘ non', () => {
    expect(seulLeModificateur({ ...nu, metaKey: true }, 'macos')).toBe(true)
    expect(seulLeModificateur({ ...nu, metaKey: true, shiftKey: true }, 'macos')).toBe(false)
    expect(seulLeModificateur({ ...nu, metaKey: true, ctrlKey: true }, 'macos')).toBe(false)
  })

  /**
   * **Le défaut qu'un portage naïf aurait laissé.** L'ancienne condition excluait `ctrlKey`
   * comme « un modificateur qui n'est pas le nôtre » ; hors macOS c'est le nôtre. Si la touche
   * exclue restait `ctrl`, la première assertion ci-dessous rendrait `false` et `Ctrl+N`
   * n'ouvrirait jamais rien — sans erreur, sans trace.
   */
  it.each(HORS_MACOS)('%s : Ctrl seul oui, Ctrl+Shift non, Ctrl+touche système non', (sur) => {
    expect(seulLeModificateur({ ...nu, ctrlKey: true }, sur)).toBe(true)
    expect(seulLeModificateur({ ...nu, ctrlKey: true, shiftKey: true }, sur)).toBe(false)
    expect(seulLeModificateur({ ...nu, ctrlKey: true, metaKey: true }, sur)).toBe(false)
  })

  it.each(PLATEFORMES)("sans le modificateur, c'est non sur %s", (sur) => {
    expect(seulLeModificateur(nu, sur)).toBe(false)
  })
})

describe('plateforme', () => {
  it('rend une des trois valeurs connues, quelle que soit la machine', () => {
    expect(PLATEFORMES).toContain(plateforme())
  })

  it('estMacos suit son paramètre', () => {
    expect(estMacos('macos')).toBe(true)
    expect(estMacos('windows')).toBe(false)
    expect(estMacos('linux')).toBe(false)
  })
})

/**
 * Les deux prédicats dérivés, **et leur contrôle négatif**.
 *
 * Sans l'assertion sur macOS, un prédicat qui rendrait `true` partout passerait la moitié
 * Windows / Linux de chacun de ces tests.
 */
describe('ce que la plateforme décide de la coquille', () => {
  it.each(HORS_MACOS)('%s dessine ses propres boutons de fenêtre', (sur) => {
    expect(dessineSesBoutonsDeFenetre(sur)).toBe(true)
  })

  it('macOS ne les dessine pas — le système les pose par-dessus la fenêtre', () => {
    expect(dessineSesBoutonsDeFenetre('macos')).toBe(false)
  })

  it('seul macOS a une voie de mise à jour en place', () => {
    expect(aUneVoieDeMiseAJour('macos')).toBe(true)
    // Windows faute de certificat Authenticode, Linux parce que le plugin ne sait remplacer
    // qu'un AppImage — deux raisons différentes, un seul comportement. Voir `plateforme.ts`.
    expect(aUneVoieDeMiseAJour('windows')).toBe(false)
    expect(aUneVoieDeMiseAJour('linux')).toBe(false)
  })
})
