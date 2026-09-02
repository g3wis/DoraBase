import { expect, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

// Les teintes de colonne, la hauteur du champ de filtre et le popover ancré sont des propriétés
// de mise en page : hors de portée de Vitest. `10d` les nomme.
test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await page.getByRole('treeitem', { name: /^orders 1\.9/ }).click()
  await page.waitForSelector('[role=grid]')
  await page.evaluate(() => document.fonts.ready)
})

test('le champ de filtre fait 20 px, comme le mockup', async ({ page }) => {
  const hauteur = await page.evaluate(() => {
    const champ = document.querySelector('[role=row][aria-rowindex="2"] input')?.parentElement
    return champ ? Math.round(champ.getBoundingClientRect().height) : null
  })
  expect(hauteur).toBe(20)
})

test('une colonne filtrée est teintée, une colonne triée l’est moins', async ({ page }) => {
  const neutre = await fondDeColonne(page, 'currency')

  await page.getByLabel('Filtrer status').fill('paid')
  await page.getByLabel('Filtrer status').press('Enter')
  await page.getByRole('button', { name: 'Trier par created_at' }).click()

  const filtree = await fondDeColonne(page, 'status')
  const triee = await fondDeColonne(page, 'created_at')

  expect(filtree).not.toBe(neutre)
  expect(triee).not.toBe(neutre)
  // 10 % contre 6 % : les deux teintes se distinguent, sans quoi « filtré » et « trié » se
  // liraient pareil.
  expect(filtree).not.toBe(triee)
})

test('le popover d’opérateur s’ouvre sous son champ et se ferme sur Échap', async ({ page }) => {
  await page.getByRole('button', { name: 'Opérateur de status' }).click()
  const panneau = page.getByRole('dialog', { name: 'Opérateur · status' })
  await expect(panneau).toBeVisible()

  const boite = await panneau.boundingBox()
  const declencheur = await page.getByRole('button', { name: 'Opérateur de status' }).boundingBox()
  expect(boite?.y).toBeGreaterThan(declencheur?.y ?? 0)

  await page.keyboard.press('Escape')
  await expect(panneau).toBeHidden()
})

test('la sidebar annote la colonne filtrée', async ({ page }) => {
  await page.getByLabel('Filtrer status').fill('paid')
  await page.getByLabel('Filtrer status').press('Enter')

  await expect(page.locator('section').getByText('filtré')).toBeVisible()
})

/** La couleur de fond de l'en-tête d'une colonne, telle que le navigateur la calcule. */
async function fondDeColonne(page: import('@playwright/test').Page, colonne: string) {
  return page
    .getByRole('button', { name: `Trier par ${colonne}` })
    .evaluate((element) => getComputedStyle(element.parentElement as Element).backgroundColor)
}

test('l’en-tête d’une colonne triée reste opaque : rien ne se lit au travers', async ({ page }) => {
  // **La flèche de tri, pas l'en-tête entier** (`23h`) : le nom de la colonne est désormais la
  // poignée de réordonnancement, et un clic dessus ne trie plus.
  await page.getByRole('button', { name: 'Trier par total_cents' }).click()
  // La flèche de tri est une icône du sprite, pas un caractère : c'est la classe de teinte qui dit
  // que le tri a pris.
  await expect(page.getByRole('columnheader', { name: /total_cents/ }).first()).toHaveClass(
    /sorted/,
  )

  const fond = await page.evaluate(() => {
    const entete = [...document.querySelectorAll('[role=columnheader]')].find((cellule) =>
      /total_cents/.test(cellule.textContent ?? ''),
    )
    return entete ? getComputedStyle(entete).backgroundColor : null
  })
  // **La teinte de colonne triée est composée sur `--bar`, pas sur du vide.** Posée sur `transparent`,
  // elle remplaçait le fond de l'en-tête : celui-ci devenait une vitre, et les lignes qui défilent
  // dessous se lisaient par-dessus le nom de la colonne. Le symptôme ressemblait à une erreur d'index
  // de virtualisation ; aucune ligne n'était mal placée.
  //
  // **La canal alpha se cherche sur `/ 0,xx`, non sur `rgba(…)`.** Un `color-mix` calcule en oklab :
  // le style calculé rend `oklab(0.67 0.14 0.11 / 0.06)`, qu'une expression écrite pour `rgba` ne
  // reconnaît pas — la première version de cette assertion passait donc sur le défaut lui-même.
  expect(fond).not.toMatch(/\/\s*0(\.\d+)?\s*\)/)

  // **Et la preuve par les pixels** : l'en-tête doit être identique avant et après un défilement. Une
  // assertion sur l'alpha dit que la couleur est opaque ; celle-ci dit que rien ne traverse, ce qui
  // est la propriété qu'on veut — elle attraperait aussi un fond opaque sur le mauvais élément.
  const zone = '[role=grid] > [role=presentation]'
  // **La cellule triée, et non la première de la rangée.** La première est la gouttière `#`, qui n'a
  // jamais été teintée : la capturer laissait le sabotage passer inaperçu. Une mesure de pixels ne
  // vaut que par ce qu'elle cadre.
  const celluleTriee = page.getByRole('columnheader', { name: /total_cents/ }).first()
  const avant = await celluleTriee.screenshot()
  await page.evaluate((selecteur) => {
    ;(document.querySelector(selecteur) as HTMLElement).scrollTop = 600
  }, zone)
  await expect
    .poll(async () => (await celluleTriee.screenshot()).equals(avant), { timeout: 3000 })
    .toBe(true)
})
