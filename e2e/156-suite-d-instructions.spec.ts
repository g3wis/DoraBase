import { expect, type Page, test } from '@playwright/test'
import { deplierUnEnvironnement, ouvrirUneConsole } from './pourLesTests'

/**
 * La bande des instructions d'une suite (#156), dans une vraie mise en page.
 *
 * Les tests unitaires disent qu'il y a un onglet par instruction et que chacun montre sa réponse ;
 * ils ne disent rien de la **place** que la bande prend, jsdom ne calculant aucune mise en page
 * (règle n° 9). Deux choses sont gardées ici :
 *
 * - **la bande prend sa hauteur au résultat, elle ne le pousse pas dehors.** Elle s'insère au-dessus
 *   de `ConsoleResult` dans la même colonne ; un enfant souple sans `min-height: 0` refuserait de
 *   rétrécir (la leçon d'`API-62`), et la grille déborderait sous la barre de chiffres. L'égalité
 *   d'`API-74` — la zone défilante vaut l'emplacement qu'on lui donne — doit donc survivre à la
 *   bande, au pixel ;
 * - **vingt instructions ne débordent pas la page.** La bande d'onglets ne cède jamais ; c'est son
 *   enveloppe qui défile ;
 * - **une requête longue est coupée à l'ellipse, et se lit entière au survol prolongé.** La coupure
 *   est une mesure de rendu, donc hors de portée de jsdom.
 */

async function executerLaSuite(page: Page, texte: string) {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await ouvrirUneConsole(page, 'analytics')
  await page.waitForSelector('.cm-content')
  await page.locator('.cm-content').click()
  await page.keyboard.insertText(texte)
  await page
    .getByRole('button', { name: /Exécuter|Run/ })
    .first()
    .click()
  await page.getByRole('grid').waitFor()
  await page.evaluate(() => document.fonts.ready)
}

async function mesurer(page: Page) {
  return await page.evaluate(() => {
    const groupe = document.querySelector('section[aria-label="Instructions exécutées"]')
    const grille = document.querySelector('[role=grid]')
    const barre = document.querySelector('[role=status]')
    const zone = grille?.querySelector('[role=presentation]')
    const emplacement = grille?.parentElement
    if (!groupe || !grille || !barre || !zone || !emplacement) {
      throw new Error('la bande, la grille, sa zone et sa barre doivent être là')
    }
    const rond = (valeur: number) => Math.round(valeur)
    const racine = document.scrollingElement ?? document.documentElement
    return {
      basDeLaBande: rond(groupe.getBoundingClientRect().bottom),
      hautDeLaGrille: rond(grille.getBoundingClientRect().top),
      zone: rond(zone.getBoundingClientRect().height),
      emplacement: rond(emplacement.getBoundingClientRect().height),
      basDeLaGrille: rond(grille.getBoundingClientRect().bottom),
      hautDeLaBarre: rond(barre.getBoundingClientRect().top),
      bandeDeborde: groupe.scrollWidth > groupe.clientWidth,
      droiteDeLaBande: rond(groupe.getBoundingClientRect().right),
      largeur: window.innerWidth,
      pageDeborde: racine.scrollWidth > racine.clientWidth,
    }
  })
}

test('la bande s’insère au-dessus du résultat sans le pousser dehors', async ({ page }) => {
  await executerLaSuite(page, 'select 1; select 2; select 3')
  // Le décor, d'abord : la bande est là, avec ses trois onglets.
  const bande = page.getByRole('region', { name: 'Instructions exécutées' })
  await expect(bande.getByRole('tab')).toHaveCount(3)

  const m = await mesurer(page)
  // La bande est au-dessus de la grille, jamais par-dessus.
  expect(m.basDeLaBande).toBeLessThanOrEqual(m.hautDeLaGrille)
  // **L'égalité d'`API-74`, qui doit survivre à la bande** : la zone défilante vaut l'emplacement.
  expect(m.zone).toBe(m.emplacement)
  expect(m.basDeLaGrille).toBeLessThanOrEqual(m.hautDeLaBarre)
})

test.describe('sur une fenêtre étroite', () => {
  test.use({ viewport: { width: 900, height: 700 } })

  test('vingt instructions font défiler la bande, pas la page', async ({ page }) => {
    await executerLaSuite(page, Array.from({ length: 20 }, (_, i) => `select ${i + 1}`).join('; '))
    await expect(
      page.getByRole('region', { name: 'Instructions exécutées' }).getByRole('tab'),
    ).toHaveCount(20)

    const m = await mesurer(page)
    // Le contrôle positif : il y a bien de quoi déborder. Sans lui, une bande assez large pour tout
    // tenir rendrait l'assertion suivante vraie sans rien garder.
    expect(m.bandeDeborde).toBe(true)
    expect(m.pageDeborde).toBe(false)
    expect(m.droiteDeLaBande).toBeLessThanOrEqual(m.largeur)
  })
})

test('une requête longue est coupée, et se lit entière au survol prolongé', async ({ page }) => {
  const longue =
    'select identifiant, montant_total, date_de_creation, statut_de_livraison from commandes_archivees'
  await executerLaSuite(page, `select 1; ${longue}`)
  const bande = page.getByRole('region', { name: 'Instructions exécutées' })
  const libelle = bande.getByRole('tab', { name: longue }).locator('span').first()

  const mesure = await libelle.evaluate((element) => ({
    coupe: element.scrollWidth > element.clientWidth,
    ellipse: getComputedStyle(element).textOverflow,
    // L'enveloppe de l'onglet, qui porte la largeur maximale.
    onglet: Math.round(element.closest('[role=presentation]')?.getBoundingClientRect().width ?? 0),
  }))
  // Le contrôle positif : la requête dépasse bel et bien. Sans lui, un onglet assez large rendrait
  // tout ce qui suit vrai sans rien garder.
  expect(mesure.coupe).toBe(true)
  expect(mesure.ellipse).toBe('ellipsis')
  // **Une égalité** (règle n° 18) : l'onglet s'arrête à sa largeur maximale, au pixel.
  expect(mesure.onglet).toBe(240)

  // **Un compte, et non une présence** : le libellé coupé porte déjà ce texte en entier dans le DOM,
  // donc « le texte est visible » serait vrai sans aucun aperçu. Une occurrence avant le survol, deux
  // après — la seconde hors de l'onglet.
  const occurrences = page.getByText(longue, { exact: true })
  await expect(occurrences).toHaveCount(1)
  await libelle.hover()
  await expect(occurrences).toHaveCount(2)
  const apercu = occurrences.nth(1)
  await expect(apercu).toBeVisible()
  expect(await apercu.evaluate((element) => element.closest('[role=tab]'))).toBeNull()
  // Il tient dans la fenêtre, lui qui part du bord gauche de l'onglet.
  const boite = await apercu.boundingBox()
  expect((boite?.x ?? -1) + (boite?.width ?? 0)).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 0,
  )
})
