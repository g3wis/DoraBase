import { expect, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

// Le point d'entrée et la géométrie de la modale : de la mise en page, donc hors de portée de Vitest.
// `08g` les nomme.
//
// **Les quatre tests sont reroutés, non supprimés** (`25b`). Ils passaient tous par la pastille de la
// barre de titre, qui ouvrait le menu « Projets et bases » ; la pastille est devenue un indicateur
// passif et le menu n'existe plus. L'écran qu'ils vérifient, lui, existe toujours : la modale de
// modification d'une connexion, désormais atteignable par le seul « … » de sa ligne dans l'arbre —
// entrée « Modifier… ». C'est aussi le menu qui ne devine rien, là où la pastille devait déduire de
// quelle connexion on parlait.
test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await page.waitForSelector('[role=tree]')
  await page.evaluate(() => document.fonts.ready)
})

/**
 * Ouvre la modale de modification d'une connexion depuis le « … » de sa ligne.
 *
 * Le survol est obligatoire : le « … » est en `visibility: hidden` hors survol
 * (`TreeRow.module.css`) — la boîte garde sa place pour que le méta ne bouge pas d'un pixel, mais
 * Playwright refuse de cliquer un élément invisible.
 */
async function ouvrirLaModale(page: import('@playwright/test').Page, connexion: string) {
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: new RegExp(`^${connexion}`) }).hover()
  await page.getByRole('button', { name: `Actions de ${connexion}` }).click()
  await page.getByRole('button', { name: 'Modifier…' }).click()
}

test('le « … » d’une connexion ouvre sa modale, préremplie', async ({ page }) => {
  await ouvrirLaModale(page, 'analytics')

  const modale = page.getByRole('dialog', { name: 'Modifier analytics' })
  await expect(modale).toBeVisible()
  // **`toBeVisible()` ne prouve pas qu'on le voit.** Il vérifie une boîte non vide et l'absence de
  // `visibility: hidden` — il **ignore le découpage par un ancêtre `overflow: hidden`**. C'est le
  // défaut n° 35, et la sidebar dont part maintenant ce chemin défile, donc la question se pose
  // toujours. Seul `elementFromPoint` répond à « qu'y a-t-il réellement à cet endroit de l'écran ? ».
  const auPoint = await page.evaluate(() => {
    const panneau = document.querySelector('[role=dialog][aria-label="Modifier analytics"]')
    const boite = panneau?.getBoundingClientRect()
    if (!panneau || !boite || boite.height === 0) return null
    const dessus = document.elementFromPoint(boite.left + boite.width / 2, boite.top + 4)
    return panneau.contains(dessus)
  })
  expect(auPoint).toBe(true)
  // Préremplie sur **cette** connexion : une modale vide, ou remplie d'une autre, serait pire que pas
  // de chemin du tout. Le port distingue `analytics` (PostgreSQL, 5432) d'`evenements` (MongoDB,
  // 27017) — le nom n'est plus un champ du formulaire depuis le 1er septembre 2026.
  await expect(modale.getByLabel('Port')).toHaveValue('5432')
})

test('les deux connexions de l’environnement sont sous lui, et pas ailleurs', async ({ page }) => {
  await deplierUnEnvironnement(page)

  // L'environnement déclaré est ce qui distingue deux connexions de même nom, et c'est ce qu'on
  // cherche en corrigeant un port. Le menu de la pastille le disait par un badge sur chaque ligne ;
  // l'arbre le dit par la **place** de la ligne, ce qui ne peut pas se contredire (`25a`).
  await expect(page.getByRole('treeitem', { name: /^analytics/ })).toHaveCount(1)
  await expect(page.getByRole('treeitem', { name: /^evenements/ })).toHaveCount(1)

  const paliers = await page.evaluate(() =>
    [...document.querySelectorAll('[role=treeitem]')]
      .filter((ligne) => /^(analytics|evenements|prod)/.test(ligne.textContent ?? ''))
      .map((ligne) => ligne.getAttribute('aria-level')),
  )
  // L'environnement au palier 2, ses deux connexions au palier 3 : c'est le contrat de `25a`.
  expect(paliers).toEqual(['2', '3', '3'])
})

test('un projet sans connexion le dit plutôt que de paraître vide', async ({ page }) => {
  // « Outils internes » n'a aucune connexion : un projet vide est un état normal depuis `08f`, et il
  // le dit désormais sur la ligne de chacun de ses environnements — un nœud déplié sans enfant se
  // lirait comme un chargement en cours (`23g`).
  await deplierUnEnvironnement(page, 'dev', 'Outils internes')
  await expect(page.getByText('Aucune connexion déclarée en dev')).toBeVisible()
})

test('la modale désigne la connexion dont on a ouvert le menu, pas sa voisine', async ({
  page,
}) => {
  await ouvrirLaModale(page, 'evenements')

  // Les deux connexions de `prod` sont voisines dans l'arbre, et l'une est documentaire : ouvrir la
  // mauvaise se verrait au moteur, au port, et au nom.
  const modale = page.getByRole('dialog', { name: 'Modifier evenements' })
  await expect(modale).toBeVisible()
  await expect(modale.getByLabel('Port')).toHaveValue('27017')
  await expect(page.getByRole('dialog', { name: 'Modifier analytics' })).toBeHidden()
})

test('la modale ne sort pas de la fenêtre', async ({ page }) => {
  await ouvrirLaModale(page, 'analytics')
  const boite = await page.getByRole('dialog', { name: 'Modifier analytics' }).boundingBox()
  const fenetre = await page.evaluate(() => ({
    largeur: window.innerWidth,
    hauteur: window.innerHeight,
  }))

  expect(boite?.x).toBeGreaterThanOrEqual(0)
  expect((boite?.x ?? 0) + (boite?.width ?? 0)).toBeLessThanOrEqual(fenetre.largeur)
  expect(boite?.y).toBeGreaterThanOrEqual(0)
  expect((boite?.y ?? 0) + (boite?.height ?? 0)).toBeLessThanOrEqual(fenetre.hauteur)
})
