import { expect, type Locator, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

/*
 * `API-45` : la poubelle qui retire une ligne se découvre au survol de la **ligne**, elle est rouge,
 * et elle tient dans sa case.
 *
 * Les trois points sont de la mise en page et de la couleur calculée — hors de portée de Vitest, qui
 * ne calcule aucune disposition et à qui les modules CSS ne sont pas appliqués. Et le survol est
 * porté par une propriété personnalisée que la **ligne** déclare (`VirtualGrid`, `--row-actions`) :
 * ce que le composant seul ne peut pas prouver, c'est justement qu'il la reçoive de son hôte.
 */
/** Les poubelles de la grille, désignées par leur nom accessible — voir le `beforeEach`. */
const POUBELLE = 'button[aria-label^="Supprimer la ligne"]'

/** La visibilité **calculée** du numéro de la ligne visée : la première boîte de sa gouttière. */
function visibiliteDuNumero(ligne: Locator) {
  return ligne
    .locator('[role=gridcell]')
    .first()
    .locator('span > span')
    .first()
    .evaluate((numero) => getComputedStyle(numero).visibility)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await page.getByRole('treeitem', { name: /^orders 1\.9/ }).click()
  await page.waitForSelector('[role=grid]')
  await page.evaluate(() => document.fonts.ready)
  await page.keyboard.press('Meta+e')
  // Le décor : la bascule a bien ouvert l'édition, donc les poubelles existent. Sans cette
  // assertion, tout ce qui suit pourrait mesurer un écran sans mode édition.
  //
  // **Désignées par leur attribut, non par leur rôle** : `visibility: hidden` retire un élément de
  // l'arbre d'accessibilité, donc `getByRole` ne trouve **rien** tant que la ligne n'est pas
  // survolée — ce qui est justement l'état qu'on vient mesurer. Un premier jet cherchait le rôle et
  // concluait que l'édition ne s'était pas ouverte.
  // Une ligne nommée, non un compte : la grille est virtualisée, donc le nombre de poubelles
  // montées est celui de la fenêtre rendue.
  await expect(
    page.locator('[role=grid] [role=row][aria-selected]').nth(2).locator(POUBELLE),
  ).toHaveCount(1)
})

test('la poubelle paraît au survol de la ligne, pas seulement de son numéro', async ({ page }) => {
  const ligne = page.locator('[role=grid] [role=row][aria-selected]').nth(2)
  const poubelle = ligne.locator(POUBELLE)

  // Rien au repos : c'est ce qui distingue une action révélée d'une action toujours là.
  await expect(poubelle).toBeHidden()

  // **La cellule la plus à droite de la ligne**, c'est-à-dire le point le plus éloigné de la
  // gouttière : une version qui n'écouterait que le survol de la gouttière échoue ici.
  const cellules = ligne.locator('[role=gridcell]')
  await cellules.nth((await cellules.count()) - 1).hover()
  await expect(poubelle).toBeVisible()

  // Et le numéro s'efface, puisque les deux occupent la même place : les actions n'ont plus de fond
  // à elles (il se composait avec celui de la ligne survolée), donc un numéro resté visible
  // passerait sous la poubelle.
  expect(await visibiliteDuNumero(ligne)).toBe('hidden')

  // Et le survol appartient à *cette* ligne : la voisine ne montre rien, et garde son numéro.
  const voisine = page.locator('[role=grid] [role=row][aria-selected]').nth(3)
  await expect(voisine.locator(POUBELLE)).toBeHidden()
  expect(await visibiliteDuNumero(voisine)).toBe('visible')
})

test("hors édition, survoler une ligne n'efface pas son numéro", async ({ page }) => {
  // La bascule est un interrupteur : on la referme, plutôt que d'écrire un second `beforeEach` —
  // et cela vérifie au passage que le retour à la lecture rend la gouttière à son numéro.
  await page.keyboard.press('Meta+e')
  const ligne = page.locator('[role=grid] [role=row][aria-selected]').nth(2)
  await expect(ligne.locator(POUBELLE)).toHaveCount(0)

  await ligne.locator('[role=gridcell]').nth(3).hover()
  // **Rien à mettre à sa place, donc rien à effacer.** Le masquage a d'abord été posé sur la ligne :
  // hors édition, le numéro disparaissait sous le pointeur en laissant un vide.
  expect(await visibiliteDuNumero(ligne)).toBe('visible')

  // Et sur la gouttière elle-même, qui était le seul survol de la version d'avant : le défaut y
  // existait déjà, en plus étroit.
  await ligne.locator('[role=gridcell]').first().hover()
  expect(await visibiliteDuNumero(ligne)).toBe('visible')
})

test("elle est rouge tant qu'elle supprime, neutre quand elle annule", async ({ page }) => {
  const ligne = page.locator('[role=grid] [role=row][aria-selected]').nth(2)
  await ligne.locator('[role=gridcell]').nth(3).hover()

  // Les deux encres attendues sont **résolues depuis leur jeton**, jamais recopiées : une valeur
  // littérale dans un test se périmerait au premier réglage de la palette, et « Nuit » les change.
  const resolus = await page.evaluate(() => {
    const temoin = document.createElement('div')
    document.body.append(temoin)
    const resolu = (jeton: string) => {
      temoin.style.color = `var(${jeton})`
      return getComputedStyle(temoin).color
    }
    const valeurs = { danger: resolu('--danger-ink'), neutre: resolu('--ink-2') }
    temoin.remove()
    return valeurs
  })

  const encre = (selecteur: string) =>
    ligne.locator(selecteur).evaluate((bouton) => getComputedStyle(bouton).color)

  expect(await encre(POUBELLE)).toBe(resolus.danger)

  // Marquée, le même bouton annule la suppression : un geste de repli, donc l'encre neutre.
  await ligne.locator(POUBELLE).click()
  const annulation = 'button[aria-label^="Annuler la suppression"]'
  await expect(ligne.locator(annulation)).toBeVisible()
  // **Sortir le pointeur du bouton avant de lire son encre** : un clic de Playwright y amène la
  // souris, donc la mesure prise juste après rendait le `:hover` (`--ink`) et non l'arrêt. Mesuré.
  await ligne.locator('[role=gridcell]').nth(3).hover()
  expect(await encre(annulation)).toBe(resolus.neutre)
})

test('le bouton tient dans la gouttière, centré, sans déborder de sa case', async ({ page }) => {
  const ligne = page.locator('[role=grid] [role=row][aria-selected]').nth(2)
  await ligne.locator('[role=gridcell]').nth(3).hover()
  await expect(ligne.locator(POUBELLE)).toBeVisible()

  const mesures = await ligne.evaluate((l) => {
    const case_ = l.querySelector('[role=gridcell]')
    const bouton = l.querySelector('button[aria-label*="Supprimer la ligne"]')
    if (!case_ || !bouton) return null
    const c = case_.getBoundingClientRect()
    const b = bouton.getBoundingClientRect()
    return {
      // **Une égalité, pas un ordre de grandeur** (règle n° 18) : les deux marges se comparent
      // entre elles, et c'est leur somme qui dit que le bouton tient. Une cellule porte 8 px de
      // rembourrage de chaque côté et la gouttière ne fait que 30 px : sans les marges négatives
      // du conteneur, le bouton dépassait sa case des deux bords à la fois.
      gauche: +(b.left - c.left).toFixed(1),
      droite: +(c.right - b.right).toFixed(1),
      haut: +(b.top - c.top).toFixed(1),
      bas: +(c.bottom - b.bottom).toFixed(1),
      largeurCase: Math.round(c.width),
      hauteurCase: Math.round(c.height),
      // **La largeur du bouton, et c'est elle qui mord.** Un premier jet ne comparait que les
      // marges : elles restaient égales sans le remède, un conteneur en flex répartissant l'excès
      // des deux côtés — le test était vert sous sabotage (règle n° 1). Ce que la place manquante
      // produit est un bouton **rétréci**, pas décalé.
      largeurBouton: Math.round(b.width),
      hauteurBouton: Math.round(b.height),
    }
  })

  expect(mesures).not.toBeNull()
  // La case occupe toute la piste de la gouttière, rembourrage compris.
  expect(mesures?.largeurCase).toBe(30)
  // Et toute la hauteur de la ligne, moins son filet : c'est ce qui donne au calque des actions la
  // case entière plutôt que la seule boîte du texte du numéro.
  expect(mesures?.hauteurCase).toBe(25)
  // Le bouton a la place de sa cote : carré, non rétréci par la boîte de rembourrage de la case.
  expect(mesures?.largeurBouton).toBe(18)
  expect(mesures?.hauteurBouton).toBe(18)
  // Centré, et dedans : les quatre marges sont positives et s'appairent.
  expect(mesures?.gauche).toBeGreaterThan(0)
  expect(mesures?.haut).toBeGreaterThan(0)
  expect(mesures?.gauche).toBe(mesures?.droite)
  expect(mesures?.haut).toBe(mesures?.bas)
})
