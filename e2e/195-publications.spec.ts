import { expect, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

/**
 * Les publications d'une base PostgreSQL (#195).
 *
 * # Ce que ce niveau garde, et qu'aucun autre ne peut garder
 *
 * `PublicationsView.test.tsx` mesure la vue seule, `Workbench.test.tsx` l'assemblage. Trois faits
 * leur échappent :
 *
 * 1. **que le chemin parte de l'application** (règle n° 8) : le menu d'une ligne de `?demo`, et non
 *    une vitrine ;
 * 2. **que l'onglet occupe toute la largeur** — le panneau droit n'y a rien à montrer — et que rien
 *    n'y déborde : jsdom ne calcule aucune mise en page (règle n° 9) ;
 * 3. **que la barre de titre nomme la base de l'onglet**, et non la dernière ligne cliquée dans
 *    l'arbre : `TitleBar` n'est monté que par `App`.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  // **Sans déplier la ligne de la base** : le menu d'une connexion est atteignable dès que son
  // dossier est déplié, et c'est le chemin qui arrive sur une connexion fermée.
  const ligne = page
    .getByRole('treeitem', { name: /analytics/ })
    .and(page.locator('[aria-level="3"]'))
  await ligne.hover()
  await ligne.locator('xpath=..').getByRole('button', { name: 'Actions de analytics' }).click()
  await page.getByRole('button', { name: 'Publications' }).click()
  await page.getByRole('rowheader', { name: 'atelier_cdc' }).waitFor()
  await page.evaluate(() => document.fonts.ready)
})

test('l’onglet liste les publications de la base, dans un onglet à lui', async ({ page }) => {
  await expect(page.getByRole('tab', { name: /publications/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  const tableau = page.getByRole('table', { name: 'Publications de la base de données' })
  await expect(tableau.getByRole('rowheader')).toHaveText([
    'atelier_cdc',
    'commandes_vers_entrepot',
    'en_pause',
  ])
  await expect(tableau.getByRole('row', { name: /atelier_cdc/ })).toContainText(
    'insert update delete truncate',
  )
  await expect(page.getByText('3 publications')).toBeVisible()
})

test('l’onglet occupe toute la largeur du centre, et rien n’y déborde', async ({ page }) => {
  const barre = page.getByRole('button', { name: 'Rafraîchir' }).locator('xpath=..')
  const fenetre = page.viewportSize()
  const boite = await barre.boundingBox()
  if (!boite || !fenetre) throw new Error('la barre doit être mesurable')

  // **Une égalité, pas une comparaison** (règle n° 18) : avec le panneau droit, la barre s'arrêterait
  // à quelque 296 px du bord, et « elle tient dans la fenêtre » resterait vrai.
  expect(boite.x + boite.width).toBe(fenetre.width)
  await expect(barre).toHaveCSS('height', '36px')

  // La racine ne défile pas horizontalement, et le tableau tient dans sa zone.
  const debords = await page.evaluate(() => ({
    racine: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  expect(debords.racine).toBe(0)
  const tableau = await page
    .getByRole('table', { name: 'Publications de la base de données' })
    .boundingBox()
  expect(tableau && tableau.x + tableau.width).toBeLessThanOrEqual(fenetre.width)
})

test('la barre de titre nomme la base de l’onglet, pas la ligne cliquée ensuite', async ({
  page,
}) => {
  // **Le décor distingue** (règle n° 5) : « Outils internes » est un autre dossier racine, donc une
  // barre qui suivrait la sélection de l'arbre changerait de texte.
  await page.getByRole('treeitem', { name: /^Outils internes/ }).click()
  const indicateur = page.locator('[data-tauri-drag-region] [class*="center"] > :not(svg)')
  await expect(indicateur).toContainText('Atelier Nord')
  await expect(indicateur).not.toContainText('Outils internes')
})
