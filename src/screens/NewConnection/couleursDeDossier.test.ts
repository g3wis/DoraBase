import arbre from '../../design/tokens.json'
import type { FolderColor } from '../../domain/config'
import { COULEURS_DE_DOSSIER, ORDRE_DES_COULEURS } from './environments'

// Le contraste des cinq teintes de dossier (#172), **calculé depuis `tokens.json`** et non recopié :
// une valeur écrite ici se périmerait au premier réglage de jeton, et le test resterait vert sur
// une teinte qui ne passe plus. Seuil : 3:1, celui d'un objet graphique porteur d'information
// (WCAG 1.4.11) — une pastille et une icône de dossier disent quel dossier on regarde.

type Rgba = { r: number; g: number; b: number; a: number }

/** L'aplatissement de `scripts/tokens.mjs` : clés jointes par `-`, `base` disparaît. */
function aplatir(noeud: object, prefixe: string[] = []): Record<string, string> {
  const sortie: Record<string, string> = {}
  for (const [cle, valeur] of Object.entries(noeud)) {
    const chemin = cle === 'base' ? prefixe : [...prefixe, cle]
    if (valeur !== null && typeof valeur === 'object')
      Object.assign(sortie, aplatir(valeur, chemin))
    else sortie[chemin.join('-')] = String(valeur)
  }
  return sortie
}

const { nuit, ...clair } = arbre
const THEMES = {
  clair: aplatir(clair),
  nuit: { ...aplatir(clair), ...aplatir(nuit) },
} as const

function lire(texte: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(texte)
  if (hex?.[1]) {
    const n = Number.parseInt(hex[1], 16)
    return { r: (n >> 16) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 }
  }
  const rgba = /^rgba\((\d+),(\d+),(\d+),([.\d]+)\)$/.exec(texte.replace(/\s/g, ''))
  if (rgba) {
    const [, r, g, b, a] = rgba.map(Number)
    return { r: (r ?? 0) / 255, g: (g ?? 0) / 255, b: (b ?? 0) / 255, a: a ?? 1 }
  }
  throw new Error(`couleur illisible par ce test : ${texte}`)
}

/** Résout `var(--x)` dans un thème, jusqu'à une valeur littérale. */
function resoudre(valeur: string, theme: Record<string, string>): Rgba {
  const ref = /^var\(--([\w-]+)\)$/.exec(valeur)
  if (ref?.[1]) {
    const cible = theme[ref[1]]
    if (cible === undefined) throw new Error(`jeton inexistant : --${ref[1]}`)
    return resoudre(cible, theme)
  }
  return lire(valeur)
}

/** Pose `dessus` sur un fond opaque, en sRGB — ce que fait le navigateur. */
function poser(dessus: Rgba, fond: Rgba, alpha = dessus.a): Rgba {
  const m = (x: number, y: number) => x * alpha + y * (1 - alpha)
  return { r: m(dessus.r, fond.r), g: m(dessus.g, fond.g), b: m(dessus.b, fond.b), a: 1 }
}

function luminance({ r, g, b }: Rgba): number {
  const l = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b)
}

function contraste(teinte: Rgba, fond: Rgba): number {
  const a = luminance(poser(teinte, fond))
  const b = luminance(fond)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/**
 * **Les fonds au repos où une teinte de dossier est posée**, inventoriés le 1er octobre 2026 :
 * - `--paper` : le panneau de couleur et d'icône (`PanneauDApparence`, `Nuancier`) ;
 * - `--paper-alt` : la sidebar (`ui/Sidebar`) et la liste de « Déplacer vers… » ;
 * - `--field` : la bande d'en-tête des modales — `A2` y nomme le dossier, en `--accent-deep`
 *   aujourd'hui, et c'est le fond blanc sur lequel #172 a été mesuré ;
 * - `--paper-bright` et le milieu du dégradé de la barre de titre (`--paper-bright` → `--bar`), où
 *   l'indicateur de sélection pose la pastille, centrée verticalement.
 */
function fondsAuRepos(theme: Record<string, string>): Record<string, Rgba> {
  const haut = resoudre('var(--paper-bright)', theme)
  const bas = resoudre('var(--bar)', theme)
  return {
    paper: resoudre('var(--paper)', theme),
    'paper-alt': resoudre('var(--paper-alt)', theme),
    field: resoudre('var(--field)', theme),
    'paper-bright': haut,
    'barre de titre (milieu)': poser(bas, haut, 0.5),
  }
}

/**
 * **Les états d'une ligne d'arbre** : survol (`--hover-row`) et sélection — `TreeRow` pose
 * `color-mix(in oklab, var(--accent) 22%, transparent)`, que le navigateur rend comme l'accent à
 * 22 % d'opacité. L'accent est réglable dans les préférences : ce fond est mesuré avec sa valeur
 * par défaut, et c'est la limite de cette garantie.
 */
function fondsDeLigne(theme: Record<string, string>): Record<string, Rgba> {
  const sidebar = resoudre('var(--paper-alt)', theme)
  return {
    survol: poser(resoudre('var(--hover-row)', theme), sidebar),
    sélection: poser(resoudre('var(--accent)', theme), sidebar, 0.22),
  }
}

const SEUIL = 3

describe.each(Object.entries(THEMES))('en thème %s', (_, theme) => {
  test.each(ORDRE_DES_COULEURS)('« %s » atteint 3:1 sur chaque fond au repos', (couleur) => {
    const teinte = resoudre(COULEURS_DE_DOSSIER[couleur], theme)
    for (const [nom, fond] of Object.entries(fondsAuRepos(theme))) {
      expect({ nom, contraste: contraste(teinte, fond) >= SEUIL }).toEqual({
        nom,
        contraste: true,
      })
    }
  })

  // **L'ambre et l'ardoise seulement** : ce sont les deux jetons que #172 a créés, et leur valeur a
  // été choisie pour tenir aussi sur une ligne survolée ou sélectionnée. Le vert ne tient pas sur ces
  // deux fonds en clair (2,75:1 et 2,41:1) — il garde `--success`, que la décision de #172 laisse en
  // place ; voir « Ce qui attend une décision humaine » dans `CLAUDE.md`.
  test.each<FolderColor>(['amber', 'slate'])(
    '« %s » tient aussi sur une ligne survolée ou sélectionnée',
    (couleur) => {
      const teinte = resoudre(COULEURS_DE_DOSSIER[couleur], theme)
      for (const [nom, fond] of Object.entries(fondsDeLigne(theme))) {
        expect({ nom, contraste: contraste(teinte, fond) >= SEUIL }).toEqual({
          nom,
          contraste: true,
        })
      }
    },
  )
})

test('l’ambre et l’ardoise de dossier sont des jetons à eux, inchangés en « Nuit »', () => {
  // **Inchangés en « Nuit »** : la décision de #172 les y laisse à la valeur qu'ils avaient déjà
  // par `--warn` et `--ink-4`, qui passaient.
  expect(COULEURS_DE_DOSSIER.amber).toBe('var(--folder-amber)')
  expect(COULEURS_DE_DOSSIER.slate).toBe('var(--folder-slate)')
  expect(THEMES.nuit['folder-amber']).toBe(THEMES.nuit.warn)
  expect(THEMES.nuit['folder-slate']).toBe(THEMES.nuit['ink-4'])
})

test('les cinq teintes restent distinctes deux à deux', () => {
  // Une teinte foncée pour le contraste ne doit pas rejoindre une voisine. Seuil large et
  // délibérément grossier : une distance euclidienne en sRGB, qui dit « deux couleurs différentes »
  // et rien de plus fin.
  for (const theme of Object.values(THEMES)) {
    const teintes = ORDRE_DES_COULEURS.map((c) =>
      poser(resoudre(COULEURS_DE_DOSSIER[c], theme), resoudre('var(--paper)', theme)),
    )
    for (let i = 0; i < teintes.length; i++)
      for (let j = i + 1; j < teintes.length; j++) {
        const a = teintes[i] as Rgba
        const b = teintes[j] as Rgba
        const d = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
        expect(d).toBeGreaterThan(0.15)
      }
  }
})
