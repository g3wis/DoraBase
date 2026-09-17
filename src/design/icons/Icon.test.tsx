import { render } from '@testing-library/react'
import { StrictMode } from 'react'
import { Icon } from './Icon'
import nomsBrut from './names.ts?raw'
import { Sprite } from './Sprite'
import spriteBrut from './sprite.svg?raw'

test('rend un use vers le symbole préfixé', () => {
  const { container } = render(<Icon name="plus" size={14} />)
  expect(container.querySelector('use')?.getAttribute('href')).toBe('#i-plus')
})

test('applique les attributs de trait du handoff', () => {
  const { container } = render(<Icon name="plus" strokeWidth={2.2} />)
  const svg = container.querySelector('svg')
  expect(svg).toHaveAttribute('fill', 'none')
  expect(svg).toHaveAttribute('stroke', 'currentColor')
  expect(svg).toHaveAttribute('stroke-width', '2.2')
  expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
})

test('est décorative par défaut : masquée aux lecteurs d’écran', () => {
  const { container } = render(<Icon name="plus" />)
  expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
})

test('sous StrictMode, le sprite est présent dans le DOM', () => {
  const { container } = render(
    <StrictMode>
      <Sprite />
    </StrictMode>,
  )
  expect(container.querySelector('symbol#i-plus')).not.toBeNull()
})

/**
 * `names.ts` et `sprite.svg` déclarent exactement les mêmes icônes.
 *
 * **Les deux sont des sources éditées à la main** depuis le retrait du mockup de handoff, et
 * `AGENTS.md` le dit : « Une icône ajoutée doit l'être dans les deux. » Rien ne le vérifiait — et
 * l'oubli est **muet des deux côtés** : un nom sans symbole rend un `<use>` qui ne pointe sur rien,
 * donc un bouton d'icône nue **vide**, sans que TypeScript, Biome ni Vitest s'en aperçoivent. C'est
 * la famille du `var()` vers un jeton inexistant, appliquée au sprite.
 *
 * Écrit en ajoutant `ul` pour l'import (17 septembre 2026) : il a fallu toucher les deux fichiers à
 * la main, et rien n'aurait dit que j'en avais oublié un.
 */
test('chaque nom d’icône a son symbole, et chaque symbole son nom', () => {
  // **Les deux fichiers sont lus en brut** (`?raw`), non importés : `names.ts` n'exporte qu'un
  // *type*, effacé à la compilation, donc il n'y a rien à interroger à l'exécution. Et `import.meta
  // .url` ne désigne pas un fichier sous Vite — c'est une URL http — ce qui écarte `node:fs`.

  // Les symboles du sprite, hors `#logo` : celui-là est le dessin de marque, employé par un `<use>`
  // écrit à la main dans `WelcomeHero`, et il n'est pas une icône de l'échelle 24×24.
  const symboles = [...spriteBrut.matchAll(/<symbol id="i-([a-z0-9-]+)"/g)].map((m) => m[1]).sort()
  const noms = [...nomsBrut.matchAll(/^\s*\|\s*'([a-z0-9-]+)'/gm)].map((m) => m[1]).sort()

  // Contrôle positif : sans lui, deux listes vides seraient « égales » — le balayage ne regarderait
  // plus ce qu'on croit (règle n° 1).
  expect(noms.length).toBeGreaterThan(40)
  expect(symboles.length).toBeGreaterThan(40)

  expect(noms.filter((nom) => !symboles.includes(nom))).toEqual([])
  expect(symboles.filter((symbole) => !noms.includes(symbole))).toEqual([])
})
