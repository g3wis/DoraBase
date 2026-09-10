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

test('le sélecteur de date d’une borne tient dans la boîte de 20 px', async ({ page }) => {
  // **Le seul contrôle natif de l'écran**, et une mise en page que Vitest ne peut pas voir : un
  // champ `type="date"` a une largeur et une hauteur intrinsèques, là où les autres champs de
  // filtre n'en ont aucune.
  //
  // **Sur la colonne la plus étroite que l'écran permette**, et c'est tout le test : à la largeur
  // ajustée d'une colonne d'horodatages, le champ tient de toute façon. C'est resserré qu'un
  // contrôle à largeur intrinsèque sort de sa boîte — mesuré.
  const poignee = page.getByRole('slider', { name: 'Redimensionner shipped_at' })
  await poignee.focus()
  for (let cran = 0; cran < 20; cran++) await poignee.press('ArrowLeft')
  await expect(poignee).toHaveAttribute('aria-valuenow', '60')

  await page.getByRole('button', { name: 'Opérateur de shipped_at' }).click()
  await page.getByRole('button', { name: /^< avant le$/ }).click()

  const champ = page.getByLabel('Filtrer shipped_at')
  // Règle n° 15 : la mesure ne vaut qu'après que le champ a changé de type, et une lecture sèche
  // daterait du clic.
  await expect(champ).toHaveAttribute('type', 'date')

  const cotes = await champ.evaluate((element) => {
    const boite = (element.parentElement as HTMLElement).getBoundingClientRect()
    const dedans = element.getBoundingClientRect()
    return {
      hauteurDeLaBoite: Math.round(boite.height),
      largeurDuChamp: Math.round(dedans.width),
      aDroite: Math.round(dedans.right - boite.right),
      enBas: Math.round(dedans.bottom - boite.bottom),
      enHaut: Math.round(boite.top - dedans.top),
    }
  })

  // La boîte n'a pas grandi : la ligne de filtre reste alignée sur les colonnes voisines.
  expect(cotes.hauteurDeLaBoite).toBe(20)
  // Et le champ ne sort par aucun bord. C'est le `min-width: 0` de `.saisie` qui le tient : mesuré,
  // sans lui le champ dépasse de 60 px à droite, en passant sous les colonnes voisines.
  expect(cotes.aDroite).toBeLessThanOrEqual(0)
  expect(cotes.enBas).toBeLessThanOrEqual(0)
  expect(cotes.enHaut).toBeLessThanOrEqual(0)
  // Contrôle positif : un champ écrasé à zéro satisferait les trois bornes ci-dessus.
  expect(cotes.largeurDuChamp).toBeGreaterThan(20)
})

test('choisir « avant le » ouvre le calendrier, et le navigateur l’accepte', async ({ page }) => {
  // **Ce que Vitest ne peut pas dire : que le navigateur ne *refuse* pas l'ouverture.**
  // `showPicker()` lève `NotAllowedError` hors activation utilisateur, et c'est tout le risque du
  // `flushSync` — un état posé au milieu d'un gestionnaire de clic pourrait faire sortir l'appel de
  // la fenêtre d'activation. jsdom n'a pas la notion, donc seul un vrai moteur juge.
  await page.evaluate(() => {
    const prototype = HTMLInputElement.prototype as HTMLInputElement & {
      showPicker: () => void
    }
    const original = prototype.showPicker
    const journal: { type: string; accepte: boolean }[] = []
    ;(window as unknown as { journalDuCalendrier: typeof journal }).journalDuCalendrier = journal
    prototype.showPicker = function espion(this: HTMLInputElement) {
      try {
        original.call(this)
        journal.push({ type: this.type, accepte: true })
      } catch {
        journal.push({ type: this.type, accepte: false })
      }
    }
  })

  await page.getByRole('button', { name: 'Opérateur de shipped_at' }).click()
  await page.getByRole('button', { name: /^< avant le$/ }).click()

  const journal = await page.evaluate(
    () =>
      (window as unknown as { journalDuCalendrier: { type: string; accepte: boolean }[] })
        .journalDuCalendrier,
  )
  expect(journal).toEqual([{ type: 'date', accepte: true }])
})

test('une borne de date choisie part au serveur sans qu’on valide', async ({ page }) => {
  // Le calendrier natif se referme sans perte de focus et sans `Entrée` : attendre l'un des deux
  // laisserait la date choisie dans le champ sans qu'elle parte.
  await page.getByRole('button', { name: 'Opérateur de shipped_at' }).click()
  await page.getByRole('button', { name: /^> après le$/ }).click()
  await page.getByLabel('Filtrer shipped_at').fill('2026-03-01')

  await expect(page.getByText('shipped_at > 2026-03-01')).toBeVisible()
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
