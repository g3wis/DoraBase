import { expect, test } from '@playwright/test'
import { deplierUnEnvironnement, ouvrirUneConsole } from './pourLesTests'

// L'intégration réelle : la liste s'ouvre, `↑↓` navigue, `⇥` insère. Les règles sont couvertes par
// les tests unitaires ; ici on vérifie qu'elles sont branchées à CodeMirror.
test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  // La table est ouverte pour que ses colonnes soient connues : l'autocomplétion ne les invente pas.
  await page.getByRole('treeitem', { name: /^orders 1\.9/ }).click()
  await page.waitForSelector('[role=grid]')
  await ouvrirUneConsole(page, 'analytics')
  await page.waitForSelector('.cm-content')
  await page.locator('.cm-content').click()
  await page.evaluate(() => document.fonts.ready)
})

test('après un alias résolu, la liste propose les colonnes avec leur type', async ({ page }) => {
  await page.keyboard.insertText('select o.stat from orders o')
  // Le curseur est en fin de texte : on le ramène après `o.stat`.
  for (let i = 0; i < ' from orders o'.length; i++) await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('u')

  const liste = page.locator('.cm-tooltip-autocomplete')
  await expect(liste).toBeVisible()
  await expect(liste).toContainText('status')
  // Le type est affiché, comme dans le mockup : c'est ce qui permet de choisir sans aller voir la
  // structure.
  await expect(liste).toContainText('text')
})

test('⇥ insère la suggestion, et garde le qualifiant', async ({ page }) => {
  await page.keyboard.insertText('select o.stat from orders o')
  for (let i = 0; i < ' from orders o'.length; i++) await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('u')
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('status')
  // **`⇥` dans les 75 ms qui suivent l'ouverture de la liste n'accepte rien**, et c'est voulu :
  // `acceptCompletion` de CodeMirror compare l'horodatage de l'ouverture à son `interactionDelay`
  // (75 ms par défaut) pour qu'une liste apparue sous les doigts ne soit pas acceptée par la frappe
  // en cours. Refusé, `⇥` retombe sur son effet par défaut — le focus quittait l'éditeur pour la
  // poignée du `SplitPane`, et le texte restait `o.statu`.
  //
  // Cette attente n'est donc pas un délai de confort : elle **franchit un garde-fou du produit** que
  // seule la charge de la suite complète rendait visible (une fois sur huit ; jamais seul). Attendre
  // l'infobulle, puis l'option sélectionnée, ne suffisait pas — les deux sont là avant le délai.
  await page.waitForTimeout(150)

  await page.keyboard.press('Tab')
  // **`o.status`, pas `status`** : l'insertion remplace le mot après le point, jamais le qualifiant.
  await expect(page.locator('.cm-content')).toContainText('select o.status from orders o')
})

test('↑↓ navigue dans la liste', async ({ page }) => {
  await page.keyboard.insertText('select o. from orders o')
  for (let i = 0; i < ' from orders o'.length; i++) await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('c')

  const liste = page.locator('.cm-tooltip-autocomplete')
  await expect(liste).toBeVisible()
  // Le même garde-fou de 75 ms que pour `⇥` ci-dessus : `moveCompletionSelection` le consulte aussi.
  // Ce test n'a pas encore échoué, et c'est exactement pourquoi l'attente est posée maintenant — la
  // course est la même, seule la charge décide du jour où elle se voit.
  await page.waitForTimeout(150)
  const premier = await page.evaluate(
    () => document.querySelector('.cm-tooltip-autocomplete [aria-selected=true]')?.textContent,
  )
  await page.keyboard.press('ArrowDown')
  const second = await page.evaluate(
    () => document.querySelector('.cm-tooltip-autocomplete [aria-selected=true]')?.textContent,
  )
  // Le mockup annonce « ↑↓ naviguer » : la sélection doit bouger, sinon l'annonce est fausse.
  expect(second).not.toBe(premier)
})

test('sans alias, l’unique table citée propose aussi ses colonnes', async ({ page }) => {
  // Le cas du mockup : `where sta` doit suggérer `status` sans écrire `orders.` ou `o.` — écrire le
  // qualifiant à chaque fois serait pénible sur une requête à une seule table, le cas le plus courant.
  await page.keyboard.insertText('select * from orders where sta')

  const liste = page.locator('.cm-tooltip-autocomplete')
  await expect(liste).toBeVisible()
  await expect(liste).toContainText('status')
})

test('un alias inconnu n’ouvre aucune liste de colonnes', async ({ page }) => {
  await page.keyboard.insertText('select x.sta')
  await page.keyboard.type('t')
  // **Une suggestion fausse produit une requête en erreur que l'utilisateur croira correcte.** En cas
  // de doute, la liste ne devine pas — elle ne s'ouvre pas.
  await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0)
})

test('aucune requête n’est envoyée pendant la frappe', async ({ page }) => {
  const appels: string[] = []
  page.on('console', (message) => {
    if (message.text().includes('run_sql')) appels.push(message.text())
  })
  await page.keyboard.insertText('select o.')
  await page.keyboard.type('sta')
  await page.waitForTimeout(200)
  // Les suggestions viennent de ce que l'écran a **déjà chargé** : interroger le serveur à chaque
  // caractère ajouterait une latence à l'endroit le plus sensible de l'écran.
  expect(appels).toEqual([])
})
