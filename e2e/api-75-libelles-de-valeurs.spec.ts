import { expect, type Locator, type Page, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

/*
 * `API-75` : ce que les entiers d'une colonne veulent dire.
 *
 * Ce que ce niveau seul peut juger, et qui est tout le sujet :
 *
 * - **le parcours entier passe par le produit** — le menu de l'en-tête, l'éditeur, l'écriture de la
 *   configuration, et la grille qui suit. C'est le seul chemin qu'un utilisateur a, et
 *   `?demo` l'emprunte tel quel : aucune porte dérobée, aucun paramètre de décor. La leçon
 *   d'`API-30` est qu'un test qui ne peut entrer que par une porte dérobée mesure souvent ce qu'un
 *   utilisateur ne peut pas atteindre du tout ;
 * - **l'alignement d'une colonne libellée**, qui est une valeur *calculée* : jsdom n'en rend aucune
 *   (règle n° 9) ;
 * - **et que le libellé ne soit pas coupé** — l'ajustement de largeur mesure `12 900 (colis
 *   express)` et non `12 900`, ce qui ne se voit que rendu.
 *
 * **Ce que ce niveau ne peut pas juger, et qu'il ne faut pas y rajouter** : le refus d'une valeur
 * non entière et celui d'un doublon. Ce sont des fonctions pures, gardées dans `libelles.test.ts`
 * valeur par valeur ; les rejouer ici ne mesurerait que l'éditeur qui les affiche.
 */

/** La colonne numérique du décor qu'on libelle. La première ligne y vaut 12 900. */
const COLONNE = 'total_cents'

/** Un libellé **plus long que le nom de la colonne**, et c'est ce qui fait mordre la mesure. */
const LIBELLE = 'colis express'

function ligneDeDonnees(page: Page, rang: number): Locator {
  return page.locator('[role=grid] [role=row][aria-selected]').nth(rang)
}

/** La cellule de `total_cents` : gouttière, `id`, `user_id`, `status`, puis elle. */
function celluleTotal(ligne: Locator): Locator {
  return ligne.locator('[role=gridcell]').nth(4)
}

/** Déclare un libellé sur `total_cents`, par le seul chemin que le produit offre. */
async function declarer(page: Page, valeur: string, libelle: string) {
  await page.getByRole('columnheader', { name: COLONNE, exact: true }).click({ button: 'right' })
  await page
    .getByRole('menu', { name: `Actions sur la colonne ${COLONNE}` })
    .getByRole('menuitem', { name: /Libellés des valeurs/ })
    .click()

  const editeur = page.getByRole('dialog', { name: `Libellés des valeurs de ${COLONNE}` })
  await expect(editeur).toBeVisible()
  await editeur.getByLabel('Valeur de la ligne 1').fill(valeur)
  await editeur.getByLabel('Libellé de la ligne 1').fill(libelle)
  await editeur.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(editeur).toBeHidden()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await page.getByRole('treeitem', { name: /^orders 1\.9/ }).click()
  await page.waitForSelector('[role=grid]')
  await page.evaluate(() => document.fonts.ready)
})

test('déclarer un libellé le fait paraître dans la grille, derrière l’entier', async ({ page }) => {
  const cellule = celluleTotal(ligneDeDonnees(page, 0))

  // **Le contrôle positif** : la cellule montre l'entier seul, et le décor ne porte aucun libellé
  // au départ. Sans lui, l'assertion finale passerait sur un décor qui l'aurait porté d'avance.
  await expect(cellule).toHaveText('12 900')

  await declarer(page, '12900', LIBELLE)

  // L'entier **reste devant** : c'est la demande d'`API-75` au mot, et ce qui distingue cette
  // lecture d'une réécriture.
  await expect(cellule).toHaveText(`12 900 (${LIBELLE})`)

  // **Et la valeur voisine reste nue.** La seconde ligne vaut 12 897, qu'aucun libellé ne nomme :
  // sans cette assertion, un libellé posé sur toute la colonne passerait le test.
  await expect(celluleTotal(ligneDeDonnees(page, 1))).toHaveText('12 897')
})

test('le libellé survit à la réouverture de l’éditeur, qui le rend pour correction', async ({
  page,
}) => {
  await declarer(page, '12900', LIBELLE)

  await page.getByRole('columnheader', { name: COLONNE, exact: true }).click({ button: 'right' })
  // **Le compte paraît dans l'entrée** : c'est ce qui distingue « déclarer » de « corriger » avant
  // d'ouvrir la modale, et c'est aussi la preuve que la déclaration a bien été relue.
  await page
    .getByRole('menu', { name: `Actions sur la colonne ${COLONNE}` })
    .getByRole('menuitem', { name: 'Libellés des valeurs (1)…' })
    .click()

  const editeur = page.getByRole('dialog', { name: `Libellés des valeurs de ${COLONNE}` })
  await expect(editeur.getByLabel('Valeur de la ligne 1')).toHaveValue('12900')
  await expect(editeur.getByLabel('Libellé de la ligne 1')).toHaveValue(LIBELLE)
})

test('vider l’éditeur rend la colonne à ses chiffres', async ({ page }) => {
  const cellule = celluleTotal(ligneDeDonnees(page, 0))
  await declarer(page, '12900', LIBELLE)
  await expect(cellule).toHaveText(`12 900 (${LIBELLE})`)

  // **Le chemin de retour**, et il n'y en a pas d'autre : une liste sans entrée retire la
  // déclaration. Un geste sans retour serait une impasse.
  await declarer(page, '', '')

  await expect(cellule).toHaveText('12 900')
})

test('une colonne libellée s’aligne à gauche, en-tête comprise', async ({ page }) => {
  const entete = page.getByRole('columnheader', { name: COLONNE, exact: true })
  const cellule = celluleTotal(ligneDeDonnees(page, 0))
  const alignement = (cible: Locator) =>
    cible.evaluate((element) => getComputedStyle(element).textAlign)

  // **Le contrôle positif** : une colonne de nombres est calée à droite, et c'est ce que le mockup
  // montre. Sans lui, un alignement à gauche partout rendrait l'assertion suivante vraie pour rien.
  expect(await alignement(entete)).toBe('right')
  expect(await alignement(cellule)).toBe('right')

  await declarer(page, '12900', LIBELLE)

  // Ce ne sont plus des quantités mais des codes : `12 900 (colis express)` calé à droite donnerait
  // un bord gauche en dents de scie sur des libellés de longueurs différentes. On n'additionne pas
  // des états.
  expect(await alignement(entete)).not.toBe('right')
  expect(await alignement(cellule)).not.toBe('right')
})

test('le libellé n’est pas coupé : la colonne s’ajuste sur ce qu’elle affiche', async ({
  page,
}) => {
  await declarer(page, '12900', LIBELLE)

  /*
   * **La mesure porte sur la *cellule*, et c'est elle qui découpe** : `text-overflow: ellipsis` et
   * l'`overflow: hidden` vivent sur le `[role=gridcell]` de `VirtualGrid`, pas sur le `<span>`
   * qu'elle contient. Un premier jet mesurait le span — qui n'a aucune contrainte de largeur, donc
   * dont `scrollWidth` vaut toujours `clientWidth` : **il est resté vert sous le sabotage**, la
   * leçon d'`API-55` rejouée sur l'élément au lieu du décor.
   *
   * Ce qui est mesuré ici est l'ajustement de largeur : `largeurAjustee` reçoit la valeur
   * *libellée*, donc vingt-deux caractères là où l'entier en fait six. Le libellé est délibérément
   * plus long que le nom de la colonne — sans cela la colonne buterait sur le plancher que son
   * en-tête lui impose, rien n'approcherait son bord, et le test mesurerait la brièveté du décor.
   * Vérifié par sabotage : en retirant le libellé du calcul, ce test tombe.
   */
  const cellule = celluleTotal(ligneDeDonnees(page, 0))
  const coupee = await cellule.evaluate((element) => element.scrollWidth > element.clientWidth + 1)
  expect(coupee).toBe(false)
})

test('l’éditeur tient dans la fenêtre, et ses champs avec lui', async ({ page }) => {
  await page.getByRole('columnheader', { name: COLONNE, exact: true }).click({ button: 'right' })
  await page
    .getByRole('menu', { name: `Actions sur la colonne ${COLONNE}` })
    .getByRole('menuitem', { name: /Libellés des valeurs/ })
    .click()

  const editeur = page.getByRole('dialog', { name: `Libellés des valeurs de ${COLONNE}` })
  // Quelques lignes de plus : c'est un éditeur qui grandit, et la coquille de `Modal` est ce qui
  // l'empêche de sortir par le bas (1er septembre 2026).
  for (let rang = 0; rang < 6; rang += 1) {
    await editeur.getByRole('button', { name: 'Ajouter une valeur' }).click()
  }

  const boite = await editeur.boundingBox()
  const fenetre = page.viewportSize()
  if (!boite || !fenetre) throw new Error('éditeur ou fenêtre introuvable')
  expect(boite.x).toBeGreaterThanOrEqual(0)
  expect(boite.y).toBeGreaterThanOrEqual(0)
  expect(boite.x + boite.width).toBeLessThanOrEqual(fenetre.width)
  expect(boite.y + boite.height).toBeLessThanOrEqual(fenetre.height)

  // **Et les deux champs d'une ligne tiennent côte à côte dans le corps**, ce qu'aucune assertion
  // de présence ne dirait : la piste de la valeur est étroite et celle du libellé prend le reste.
  const valeur = await editeur.getByLabel('Valeur de la ligne 1').boundingBox()
  const libelle = await editeur.getByLabel('Libellé de la ligne 1').boundingBox()
  if (!valeur || !libelle) throw new Error('champs introuvables')
  expect(valeur.y).toBeCloseTo(libelle.y, 0)
  expect(valeur.x + valeur.width).toBeLessThanOrEqual(libelle.x)
  expect(libelle.x + libelle.width).toBeLessThanOrEqual(boite.x + boite.width)
})
