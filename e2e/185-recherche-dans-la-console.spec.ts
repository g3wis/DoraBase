import { expect, type Page, test } from '@playwright/test'
import { deplierUnEnvironnement, ouvrirUneConsole } from './pourLesTests'

/**
 * `⌘F` cherche dans la requête (#185).
 *
 * # Ce que ce niveau garde
 *
 * Le comportement — compter, emmener, remplacer, fermer — est gardé par Vitest. Ce qui reste est ce
 * que jsdom ne calcule pas (règle n° 9) : la bande est un panneau de CodeMirror, posé **dans** la
 * moitié haute du partage de la console. Elle doit y prendre sa place sans recouvrir le texte, sans
 * pousser le résultat, et passer sur deux lignes quand la console est étroite — la croix restant sur
 * la première.
 *
 * Et c'est le seul niveau où `⌘F` parcourt le vrai chemin : la frappe tombe dans CodeMirror, qui ne
 * la lie pas, puis remonte jusqu'à l'écouteur de la console.
 */

async function ouvrir(page: Page) {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await ouvrirUneConsole(page, 'analytics')
  await page.locator('.cm-content').click()
  // Une console neuve est vide : rien à trouver. Deux `id`, pour un compte qui ne soit pas « 1 ».
  await page.keyboard.type('select id from orders where id = 1')
}

const bande = (page: Page) =>
  page.getByRole('search', { name: 'Rechercher et remplacer dans la requête' })

test('⌘F depuis le texte ouvre la bande, focus dans le champ', async ({ page }) => {
  await ouvrir(page)
  await page.keyboard.press('Meta+f')

  await expect(bande(page)).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Rechercher dans la requête' })).toBeFocused()

  await page.keyboard.type('id')
  await expect(bande(page).getByText('2 occurrences')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(bande(page).getByText('1 / 2')).toBeVisible()
  // Le cerclage des occurrences est peint par le thème : sans lui, CodeMirror poserait son jaune
  // littéral — et son contour, ici, est ce qui les distingue de la ligne active.
  const contour = await page
    .locator('.cm-searchMatch')
    .first()
    .evaluate((marque) => getComputedStyle(marque).outlineStyle)
  expect(contour).toBe('solid')
})

test('la bande tient sur une ligne de barre, sans recouvrir le texte ni pousser le résultat', async ({
  page,
}) => {
  await ouvrir(page)
  // La poignée du partage de la console, désignée par ce qu'elle sépare : la sidebar porte elle
  // aussi un séparateur horizontal (la leçon d'`API-74`).
  const poignee = page
    .locator(':has(> [role=separator][aria-orientation=horizontal]):has(.cm-editor)')
    .locator('> [role=separator]')
  const avant = await poignee.boundingBox()

  await page.keyboard.press('Meta+f')
  await expect(bande(page)).toBeVisible()

  const mesure = await page.evaluate(() => {
    const element = document.querySelector('[role=search]')
    const ligne = document.querySelector('.cm-content > .cm-line')
    if (element === null || ligne === null) throw new Error('la bande et le texte doivent être là')
    const barre = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--h-bar'),
    )
    return {
      hauteur: element.getBoundingClientRect().height,
      bas: element.getBoundingClientRect().bottom,
      hautDuTexte: ligne.getBoundingClientRect().top,
      barre,
    }
  })

  // Une égalité, pas un ordre (règle n° 18) : la bande a la hauteur de la bande du diagramme.
  expect(mesure.hauteur).toBe(mesure.barre)
  // La première ligne commence sous la bande, filet compris : le panneau prend sa place dans
  // l'éditeur au lieu de flotter par-dessus le texte.
  expect(mesure.hautDuTexte).toBeGreaterThanOrEqual(mesure.bas)
  // Et le partage n'a pas bougé : la bande se prend sur la hauteur de l'éditeur, pas sur celle du
  // résultat.
  expect(await poignee.boundingBox()).toEqual(avant)
})

test('sur une console étroite, le remplacement passe dessous et la croix reste en haut', async ({
  page,
}) => {
  // 760 px de fenêtre laissent 531 px à l'éditeur, sidebar déduite. Mesuré : à 900 px la bande
  // tient encore sur une ligne, à 760 non.
  await page.setViewportSize({ width: 760, height: 600 })
  await ouvrir(page)
  await page.keyboard.press('Meta+f')
  await expect(bande(page)).toBeVisible()

  const mesure = await bande(page).evaluate((element) => {
    const boite = (selecteur: string) => {
      const cible = element.querySelector(selecteur)
      if (cible === null) throw new Error(`${selecteur} doit être dans la bande`)
      return cible.getBoundingClientRect()
    }
    const enfants = [...element.querySelectorAll('*')].map((e) => e.getBoundingClientRect().right)
    return {
      bande: element.getBoundingClientRect(),
      champ: boite('input[aria-label="Rechercher dans la requête"]'),
      remplacement: boite('input[aria-label="Remplacer par"]'),
      fermer: boite('button[aria-label="Fermer la recherche"]'),
      plusADroite: Math.max(...enfants),
    }
  })

  // La bande passe sur deux lignes. C'est l'exigence, et non un contrôle du décor : une bande qui
  // ne passerait pas à la ligne — sans `flex-wrap` — doit tomber ici, pas plus loin.
  expect(mesure.remplacement.top).toBeGreaterThan(mesure.champ.bottom)
  // Rien ne déborde de la bande par la droite.
  expect(mesure.plusADroite).toBeLessThanOrEqual(mesure.bande.right)
  // La croix est sur la première ligne, centrée comme le champ.
  const centre = (r: { top: number; height: number }) => r.top + r.height / 2
  expect(Math.abs(centre(mesure.fermer) - centre(mesure.champ))).toBeLessThanOrEqual(0.5)
})
