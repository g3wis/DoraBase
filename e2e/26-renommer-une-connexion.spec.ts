import { expect, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

// Renommer une connexion depuis sa ligne d'arbre (`26`).
//
// Ce fichier couvre l'**assemblage** : le chemin jusqu'au champ, ce qui suit le nouveau nom, et ce
// que le refus affiche. Les garanties du geste — le secret déplacé puis relu, l'original effacé en
// dernier, le rollback d'un magasin qui refuse — sont couvertes côté Rust, dans
// `tests_renommage_connexion`, où un magasin défaillant se provoque.
//
// La démo renomme dans son état et rejoue le refus de doublon de `23b` : le pont Tauri ne répond pas
// en Chromium, et un décor qui rendrait un succès sans renommer ferait passer un test que la
// commande réelle échouerait.
test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page.evaluate(() => document.fonts.ready)
})

test('le menu « … » d’une connexion renomme sur place, sans modale', async ({ page }) => {
  // Le survol est obligatoire : le « … » est en `visibility: hidden` hors survol, sa boîte restant
  // réservée pour que le méta de la ligne ne bouge pas d'un pixel (`08h`).
  await page
    .getByRole('treeitem', { name: /analytics/ })
    .first()
    .hover()
  await page.getByRole('button', { name: 'Actions de analytics' }).click()
  await page.getByRole('button', { name: 'Renommer…' }).click()

  // **Aucune fenêtre** : le nom est le seul champ concerné, et le champ prend la place du libellé,
  // focalisé, contenu présélectionné.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('Nouveau nom de analytics')).toBeFocused()
})

test('la ligne porte le nouveau nom, et l’onglet ouvert reste ouvert', async ({ page }) => {
  await page
    .getByRole('treeitem', { name: /analytics/ })
    .first()
    .dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  // `^orders` désigne aussi `orders_daily` : le nom accessible complet lève l'ambiguïté.
  await page.getByRole('treeitem', { name: /^orders 1/ }).click()
  await expect(page.getByRole('tab', { name: /orders/ })).toBeVisible()

  await page
    .getByRole('treeitem', { name: /analytics/ })
    .first()
    .hover()
  await page.getByRole('button', { name: 'Actions de analytics' }).click()
  await page.getByRole('button', { name: 'Renommer…' }).click()
  const champ = page.getByLabel('Nouveau nom de analytics')
  await champ.fill('entrepot')
  await champ.press('Enter')

  await expect(page.getByRole('treeitem', { name: /entrepot/ })).toBeVisible()
  // **L'onglet suit au lieu de se fermer** : c'est ce qui distingue un renommage d'un retrait
  // (`08j`). Le fermer ferait perdre la place de l'utilisateur pour une correction de libellé.
  await expect(page.getByRole('tab', { name: /orders/ })).toBeVisible()
  // Et le succès est **muet** : la ligne renommée est sa propre confirmation.
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('« Échap » abandonne un renommage commencé par erreur', async ({ page }) => {
  await page
    .getByRole('treeitem', { name: /analytics/ })
    .first()
    .hover()
  await page.getByRole('button', { name: 'Actions de analytics' }).click()
  await page.getByRole('button', { name: 'Renommer…' }).click()
  const champ = page.getByLabel('Nouveau nom de analytics')
  await champ.fill('Perdu')
  await champ.press('Escape')

  await expect(page.getByRole('treeitem', { name: /analytics/ }).first()).toBeVisible()
  await expect(page.getByRole('treeitem', { name: /Perdu/ })).toHaveCount(0)
})

test('un nom déjà pris dans le dossier est refusé, et la modale le dit', async ({ page }) => {
  // `evenements` est l'autre connexion de `prod` dans le décor de la démo : deux homonymes dans le
  // même environnement rendraient la clé d'identité ambiguë (`23b`).
  await page
    .getByRole('treeitem', { name: /analytics/ })
    .first()
    .hover()
  await page.getByRole('button', { name: 'Actions de analytics' }).click()
  await page.getByRole('button', { name: 'Renommer…' }).click()
  const champ = page.getByLabel('Nouveau nom de analytics')
  await champ.fill('evenements')
  await champ.press('Enter')

  const modale = page.getByRole('dialog')
  await expect(modale).toContainText('déjà déclarée')
  // Le fait qui rassure, dit aussi fort que celui qui inquiète — la règle de `08j`.
  await expect(modale).toContainText('Le nom d’avant est gardé')
  // Et rien n'a bougé dans l'arbre.
  await expect(page.getByRole('treeitem', { name: /analytics/ }).first()).toBeVisible()
})
