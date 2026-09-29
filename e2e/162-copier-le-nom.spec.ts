import { expect, type Page, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

/**
 * « Copier le nom » dans les deux listes qui nomment un objet (#162).
 *
 * Ce que Vitest garde déjà : le menu s'ouvre, l'entrée est là, et c'est le nom nu qui part au
 * presse-papiers. Ce qui n'est **pas** de son ressort, et qui est tout l'objet de ce fichier : le
 * panneau est-il réellement sous le pointeur ? C'est le défaut n° 35 — un panneau flottant ancré
 * dans le flux est rogné par le premier ancêtre en `overflow: hidden`, et la sidebar en est un.
 * `toBeVisible()` reste vert dans ce cas : le DOM est juste, seuls les pixels manquent.
 */

/**
 * Ce qui se trouve **réellement** au centre d'une entrée de menu.
 *
 * `elementFromPoint` est la seule mesure qui distingue « présent dans la mise en page » de
 * « vraiment sous le pointeur ». Rendre le libellé plutôt qu'un booléen : un test qui échoue doit
 * dire ce qu'il a trouvé à la place, sinon l'enquête repart de zéro.
 */
async function auCentreDeLEntree(page: Page, libelle: string) {
  return page.evaluate((cible) => {
    const entree = [...document.querySelectorAll('[role=menuitem], button')].find(
      (element) => element.textContent?.trim() === cible,
    )
    if (!entree) return { trouvee: false, contenu: null }
    const boite = entree.getBoundingClientRect()
    const dessus = document.elementFromPoint(
      (boite.left + boite.right) / 2,
      (boite.top + boite.bottom) / 2,
    )
    return { trouvee: true, contenu: dessus === null ? null : entree.contains(dessus) }
  }, libelle)
}

// --- L'arbre ---

test.describe('la ligne d’objet de l’arbre', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?demo')
    await deplierUnEnvironnement(page)
    // Jusqu'aux objets : la connexion, puis le schéma. Les lignes d'objet sont au palier 5.
    await page
      .getByRole('treeitem', { name: /analytics/ })
      .first()
      .dblclick()
    await page
      .getByRole('treeitem', { name: /^public/ })
      .first()
      .dblclick()
    await expect(page.getByRole('treeitem', { name: /^orders\b/ }).first()).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
  })

  test('le « … » d’une table ouvre un menu réellement sous le pointeur', async ({ page }) => {
    const ligne = page.getByRole('treeitem', { name: /^orders\b/ }).first()
    // **Le survol est obligatoire** : le « … » est en `visibility: hidden` hors survol, et
    // Playwright refuse de cliquer un élément invisible — l'attente expirerait à trente secondes
    // sans rien dire d'utile.
    await ligne.hover()
    await page.getByRole('button', { name: 'Actions de orders' }).click()

    const entree = page.getByRole('button', { name: 'Copier le nom' })
    await expect(entree).toBeVisible()
    // Et la mesure qui compte, celle que `toBeVisible()` ne fait pas.
    expect(await auCentreDeLEntree(page, 'Copier le nom')).toEqual({ trouvee: true, contenu: true })
  })

  test('le clic droit ouvre le même menu, lui aussi atteignable', async ({ page }) => {
    await page
      .getByRole('treeitem', { name: /^orders\b/ })
      .first()
      .click({ button: 'right' })
    await expect(page.getByRole('menu', { name: 'Actions de orders' })).toBeVisible()
    expect(await auCentreDeLEntree(page, 'Copier le nom')).toEqual({ trouvee: true, contenu: true })
  })

  /*
   * **Ce que ce fichier ne remesure pas : le repli du menu contre un bord.**
   *
   * `MenuContextuel` se repositionne après mesure, et `10f-panneau-de-ligne.spec.ts` le garde déjà
   * (`boite.bottom <= window.innerHeight`). Un test écrit ici a été essayé puis retiré : à 960 × 420,
   * la ligne d'arbre la plus basse **réellement** sous le pointeur tombe à 285 px, son menu de deux
   * entrées en fait 56, et il n'y a donc rien à replier — la liste de la sidebar est rognée bien
   * au-dessus du bas de la fenêtre. Il aurait été vert sans exercer ce qu'il nommait, et un sabotage
   * du repli le confirmait : vert lui aussi.
   */
})

// --- La liste du centre ---

/**
 * **Depuis l'écran, pas depuis la galerie.**
 *
 * La galerie monte le même `ObjectTable` et donnerait la même image — c'est précisément le piège de
 * la règle n° 8 : un composant juste dans sa vitrine ne prouve rien de l'assemblage. Et elle ajoute
 * un artefact qui n'est pas celui du produit : c'est une page longue, donc Playwright fait défiler la
 * fenêtre pour cliquer, et `MenuContextuel` se ferme au défilement — délibérément, un menu posé en
 * coordonnées de fenêtre ne suit pas ce qui défile sous lui. Le test aurait mesuré la galerie.
 */
test('le clic droit sur une ligne du centre ouvre un menu atteignable', async ({ page }) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page
    .getByRole('treeitem', { name: /analytics/ })
    .first()
    .dblclick()
  // Un clic simple sur le schéma : c'est ce qui remplit la liste du centre.
  await page
    .getByRole('treeitem', { name: /^public/ })
    .first()
    .click()

  const ligne = page.locator('tbody tr').first()
  await expect(ligne).toBeVisible()
  const nom = (await ligne.locator('th').first().textContent())?.trim() ?? ''
  // Le contrôle positif : sans lui, un centre vide rendrait ce test vert sans rien mesurer.
  expect(nom, 'le décor doit porter au moins une ligne nommée').not.toBe('')

  await ligne.click({ button: 'right' })
  await expect(page.getByRole('menu', { name: `Actions de ${nom}` })).toBeVisible()
  expect(await auCentreDeLEntree(page, 'Copier le nom')).toEqual({ trouvee: true, contenu: true })
})
