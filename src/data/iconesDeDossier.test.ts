import { expect, test } from 'vitest'
import spriteBrut from '../design/icons/sprite.svg?raw'
import { DICTIONNAIRES } from '../i18n/dictionaries'
import { ICONE_PAR_DEFAUT, ICONES_DE_DOSSIER, iconeDeDossier } from './iconesDeDossier'

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
