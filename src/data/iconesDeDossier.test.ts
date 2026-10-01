import { expect, test } from 'vitest'
import spriteBrut from '../design/icons/sprite.svg?raw'
import { DICTIONNAIRES } from '../i18n/dictionaries'
import ddlPanelBrut from '../screens/Structure/DdlPanel.tsx?raw'
import toolbarBrut from '../screens/TableView/Toolbar.tsx?raw'
import {
  dessinDeDossier,
  dessinDIcone,
  ICONE_PAR_DEFAUT,
  ICONES_DE_DOSSIER,
  iconeDeDossier,
} from './iconesDeDossier'

test('une icône offerte est dessinée telle quelle', () => {
  expect(iconeDeDossier({ icon: 'rocket' })).toBe('rocket')
  expect(iconeDeDossier({ icon: 'srv' })).toBe('srv')
})

test('sans icône, ou avec un nom inconnu, le dossier retombe sur pin', () => {
  expect(ICONE_PAR_DEFAUT).toBe('pin')
  for (const icon of [undefined, null, '', 'une-icone-de-demain', 'Pas Un Nom !']) {
    expect(iconeDeDossier({ icon }), String(icon)).toBe('pin')
  }
  // **Un glyphe du sprite qui n'est pas offert retombe aussi** : `table` existe, mais un dossier
  // dessiné en table se lirait comme une table. Le repli porte sur la liste, pas sur le sprite.
  expect(iconeDeDossier({ icon: 'table' })).toBe('pin')
})

test('la sélection : 56 icônes distinctes, pin en tête, toutes dans le sprite', () => {
  expect(ICONES_DE_DOSSIER).toHaveLength(56)
  expect(ICONES_DE_DOSSIER[0]).toBe('pin')
  expect(new Set(ICONES_DE_DOSSIER).size).toBe(ICONES_DE_DOSSIER.length)
  const symboles = new Set(
    [...spriteBrut.matchAll(/<symbol id="i-([a-z0-9-]+)"/g)].map((m) => m[1]),
  )
  expect(ICONES_DE_DOSSIER.filter((icone) => !symboles.has(icone))).toEqual([])
})

test('aucune icône offerte ne nomme déjà un palier de l’arbre', () => {
  for (const reservee of ['schema', 'table', 'view', 'term', 'db', 'bag', 'lock', 'unlock']) {
    expect(ICONES_DE_DOSSIER, reservee).not.toContain(reservee)
  }
})

test('chaque icône offerte a son nom accessible, dans les deux langues', () => {
  for (const langue of ['fr', 'en'] as const) {
    const noms = (
      DICTIONNAIRES[langue] as unknown as { explorer: { folderIcons: Record<string, unknown> } }
    ).explorer.folderIcons
    expect(ICONES_DE_DOSSIER.filter((icone) => typeof noms[icone] !== 'string')).toEqual([])
    // Et rien de plus : un nom sans icône est une entrée morte.
    expect(Object.keys(noms).filter((cle) => !ICONES_DE_DOSSIER.includes(cle as never))).toEqual([])
    // Deux icônes du même nom se confondraient à la voix.
    const valeurs = Object.values(noms)
    expect(new Set(valeurs).size, langue).toBe(valeurs.length)
  }
})

// --- Le dessin d'une icône de dossier (#175) ---

const SYMBOLES = new Set([...spriteBrut.matchAll(/<symbol id="i-([a-z0-9-]+)"/g)].map((m) => m[1]))
const REMPLACEES = ['cloud', 'code', 'star', 'compass'] as const

test('un dossier réglé sur l’une des quatre garde son nom et prend le dessin de Lucide', () => {
  for (const nom of REMPLACEES) {
    // **Le nom persisté ne bouge pas** : c'est lui que la grille coche et que le cœur écrit.
    expect(iconeDeDossier({ icon: nom })).toBe(nom)
    expect(ICONES_DE_DOSSIER).toContain(nom)
    expect(dessinDeDossier({ icon: nom })).toBe(`lucide-${nom}`)
    expect(SYMBOLES.has(`lucide-${nom}`), nom).toBe(true)
  }
})

test('les équivalents de Lucide ne sont pas offerts sous leur propre nom', () => {
  // Les offrir doublerait l'icône dans la grille, et un dossier réglé sur `lucide-cloud` serait
  // relu comme inconnu par une version plus ancienne.
  expect(ICONES_DE_DOSSIER.filter((icone) => icone.startsWith('lucide-'))).toEqual([])
  expect(iconeDeDossier({ icon: 'lucide-cloud' })).toBe(ICONE_PAR_DEFAUT)
})

test('les autres icônes sont dessinées telles qu’elles s’appellent', () => {
  expect(dessinDIcone('rocket')).toBe('rocket')
  expect(dessinDIcone('pin')).toBe('pin')
  expect(dessinDeDossier({ icon: null })).toBe('pin')
})

test('les quatre symboles d’origine restent au sprite, et `code` sert encore ailleurs', () => {
  // **Les autres écrans ne bougent pas** (#175, tranché par le demandeur) : la barre d'outils de la
  // grille et le panneau DDL dessinent toujours `i-code`. `cloud`, `star` et `compass` n'ont pas
  // d'autre appelant dans `src/` que la galerie, qui lit le sprite entier — ils restent quand même :
  // la décision ne les retire pas.
  for (const nom of REMPLACEES) expect(SYMBOLES.has(nom), nom).toBe(true)
  expect(toolbarBrut).toContain('<Icon name="code"')
  expect(ddlPanelBrut).toContain('<Icon name="code"')
})
