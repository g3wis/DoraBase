import { expect, type Locator, type Page, test } from '@playwright/test'
import { deplierUnEnvironnement, ouvrirUneConsole } from './pourLesTests'

/**
 * Déplacer une connexion ou un dossier (#167), **à la souris et au clavier**.
 *
 * Le décor de `?demo` rejoue le cœur (`deplacementSimule`) : mêmes refus, même question sur la lecture
 * seule. Ce que ces tests prouvent, et que Vitest ne peut pas — jsdom n'a ni `elementFromPoint` ni
 * mise en page (règle n° 9) : qu'un **vrai glissement souris** trouve sa cible sous le pointeur, que
 * la bande de tête reçoit un dépôt à la racine, et que la modale se parcourt au clavier seul.
 */

/** La ligne d'arbre d'un dossier ou d'une connexion, par son nom — motif ancré. */
const ligne = (page: Page, nom: string, niveau?: number): Locator => {
  const trouvee = page.getByRole('treeitem', { name: new RegExp(`^${nom}\\b`) })
  return niveau === undefined
    ? trouvee.first()
    : trouvee.and(page.locator(`[aria-level="${niveau}"]`))
}

/**
 * Un glissement souris **réel** : `down`, plusieurs `move`, `up` — le seuil d'armement est de quatre
 * pixels, et un seul `move` sauterait directement à l'arrivée sans que l'indicateur ait suivi.
 */
async function glisser(page: Page, source: Locator, arrivee: { x: number; y: number }) {
  const depart = await source.boundingBox()
  if (depart === null) throw new Error('ligne source invisible')
  await page.mouse.move(depart.x + 40, depart.y + depart.height / 2)
  await page.mouse.down()
  await page.mouse.move(depart.x + 46, depart.y + depart.height / 2 + 6, { steps: 3 })
  await page.mouse.move(arrivee.x, arrivee.y, { steps: 12 })
  await page.mouse.up()
}

/** Le centre d'une ligne — le tiers central d'un dossier veut dire « dedans ». */
async function centreDe(locator: Locator) {
  const boite = await locator.boundingBox()
  if (boite === null) throw new Error('ligne cible invisible')
  return { x: boite.x + 60, y: boite.y + boite.height / 2 }
}

test('une connexion ouverte glissée dans un autre dossier garde sa console et son état', async ({
  page,
}) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  // Déplier `analytics` l'ouvre : c'est ce qui pose le badge « OK ».
  await ligne(page, 'analytics').dblclick()
  await expect(ligne(page, 'analytics')).toContainText('OK')
  await ouvrirUneConsole(page, 'analytics')
  await page.waitForSelector('.cm-content')
  await page.locator('.cm-content').click()
  await page.keyboard.insertText('select 42 as reponse')
  const onglets = page.getByRole('tab')
  const avant = await onglets.count()

  await glisser(page, ligne(page, 'analytics'), await centreDe(ligne(page, 'staging', 2)))

  // Rangée sous « staging », qui s'est dépliée pour la montrer : la ligne qui suit « staging » dans
  // l'arbre est désormais `analytics`, au palier des connexions.
  const staging = ligne(page, 'staging', 2)
  await expect(staging).toHaveAttribute('aria-expanded', 'true')
  const noms = await page
    .locator('[role=tree] [role=treeitem]')
    .evaluateAll((lignes) => lignes.map((l) => l.getAttribute('aria-label') ?? l.textContent))
  const rang = noms.findIndex((n) => /^staging\b/.test(n ?? ''))
  expect(noms[rang + 1]).toMatch(/^analytics\b/)
  // **Rien n'a été fermé** : l'onglet de console est là, avec son texte, et le badge reste « OK ».
  await expect(onglets).toHaveCount(avant)
  await expect(page.locator('.cm-content')).toContainText('select 42 as reponse')
  await expect(ligne(page, 'analytics')).toContainText('OK')
  // **Le dépliage et la sélection survivent** : les identifiants de nœud ne dépendent pas du dossier.
  await expect(ligne(page, 'analytics')).toHaveAttribute('aria-expanded', 'true')
  await expect(ligne(page, 'analytics')).toHaveAttribute('aria-selected', 'true')
})

test('un dépôt qui fait passer en lecture seule ouvre « Déplacer vers… » en confirmation', async ({
  page,
}) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await ligne(page, 'Outils internes', 1).dblclick()
  // « Outils internes › prod » est en lecture seule dans le décor.
  const prodDOutils = page
    .getByRole('treeitem', { name: /^prod\b/ })
    .and(page.locator('[aria-level="2"]'))
    .last()
  await glisser(page, ligne(page, 'evenements', 3), await centreDe(prodDOutils))

  const modale = page.getByRole('dialog', { name: /Déplacer evenements vers/ })
  await expect(modale).toBeVisible()
  await expect(modale.getByRole('status')).toHaveText(
    '« evenements » passera en lecture seule, imposée par « prod ».',
  )
  // Rien n'a bougé tant qu'on n'a pas confirmé.
  await expect(ligne(page, 'evenements', 3)).toBeVisible()
  await modale.getByRole('button', { name: 'Déplacer' }).click()
  await expect(modale).toHaveCount(0)
  await expect(prodDOutils).toHaveAttribute('aria-expanded', 'true')
})

test('la bande de tête reçoit un dépôt à la racine', async ({ page }) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  const source = ligne(page, 'analytics')
  const depart = await source.boundingBox()
  if (depart === null) throw new Error('ligne invisible')
  await page.mouse.move(depart.x + 40, depart.y + depart.height / 2)
  await page.mouse.down()
  await page.mouse.move(depart.x + 46, depart.y + depart.height / 2 + 6, { steps: 3 })
  // Pendant le glissement, la bande de tête a changé de rôle.
  const bande = page.getByText('Déposer à la racine')
  await expect(bande).toBeVisible()
  const boite = await bande.boundingBox()
  if (boite === null) throw new Error('bande invisible')
  await page.mouse.move(boite.x + 20, boite.y + boite.height / 2, { steps: 10 })
  await page.mouse.up()

  await expect(bande).toHaveCount(0)
  // À la racine, une connexion est au premier palier.
  await expect(ligne(page, 'analytics', 1)).toBeVisible()
})

test('« Déplacer vers… » au clavier seul, les destinations impossibles comptées', async ({
  page,
}) => {
  await page.goto('/?demo')
  const atelier = ligne(page, 'Atelier Nord', 1)
  // Le seul geste non clavier : poser le focus sur la ligne, ce que la tabulation ferait depuis la
  // bande de tête en plus de coups.
  await atelier.focus()
  await page.keyboard.press('Tab')
  await expect(page.locator(':focus')).toHaveAccessibleName('Actions de Atelier Nord')
  await page.keyboard.press('Enter')
  await tabulerJusqua(page, 'Déplacer vers…')
  await page.keyboard.press('Enter')

  const modale = page.getByRole('dialog', { name: /Déplacer Atelier Nord vers/ })
  await expect(modale).toBeVisible()
  const liste = modale.getByRole('group', { name: 'Dossier d’arrivée' })
  const lignes = liste.getByRole('button')
  // Racine, Atelier Nord et ses quatre sous-dossiers, Outils internes et ses quatre : onze lignes.
  await expect(lignes).toHaveCount(11)
  // **Comptées, pas cherchées par nom** : une ligne désactivée garde son nom, donc « trouver
  // Outils internes » ne dirait rien de celles qu'on ne peut pas prendre. Actives : Outils internes
  // et ses quatre sous-dossiers.
  await expect(liste.locator('button:not([aria-disabled="true"])')).toHaveCount(5)
  await expect(liste.locator('button[aria-disabled="true"]')).toHaveCount(6)
  // Chacune avec sa raison, dans un `title` atteignable.
  await expect(lignes.nth(0)).toHaveAttribute('title', 'Déjà ici.')
  await expect(lignes.nth(2)).toHaveAttribute('title', 'Un dossier ne se range pas dans lui-même.')

  await tabulerJusqua(page, 'Outils internes')
  await page.keyboard.press('Enter')
  await tabulerJusqua(page, 'Déplacer')
  await page.keyboard.press('Enter')

  await expect(modale).toHaveCount(0)
  // « Atelier Nord » est rangé sous « Outils internes » : au second palier.
  await expect(ligne(page, 'Atelier Nord', 2)).toBeVisible()
  await expect(ligne(page, 'Atelier Nord', 1)).toHaveCount(0)
})

/** Tabule jusqu'à ce que le focus porte ce nom — un parcours clavier, sans viser à la souris. */
async function tabulerJusqua(page: Page, nom: string): Promise<void> {
  for (let coup = 0; coup < 30; coup += 1) {
    await page.keyboard.press('Tab')
    const courant = await page.evaluate(() => {
      const actif = document.activeElement as HTMLElement | null
      return actif?.getAttribute('aria-label') ?? actif?.textContent?.trim() ?? ''
    })
    if (courant === nom || courant.startsWith(`${nom} `)) return
  }
  throw new Error(`le focus n'a jamais atteint « ${nom} »`)
}
