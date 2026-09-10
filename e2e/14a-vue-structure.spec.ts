import { expect, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

// La mise en page de `A9` : trois zones empilées à gauche, la colonne du DDL à droite. Des
// géométries, donc hors de portée de jsdom — qui ne calcule aucune mise en page.
test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await page.getByRole('treeitem', { name: /^orders 1\.9/ }).click()
  // Le couple est dans l'en-tête de la colonne de droite depuis `22`, plus dans la bande d'onglets.
  await page.getByRole('button', { name: 'Structure' }).click()
  // `DataTable` (`09a`) nomme son tableau par une `<caption>` masquée, pas par un `aria-label` :
  // c'est ce qui donne l'en-tête à la voix. Le sélecteur suit donc la légende.
  await page.getByRole('table', { name: /Colonnes de public\.orders/ }).waitFor()
  await page.evaluate(() => document.fonts.ready)
})

test('le DDL est dans la colonne de droite, sous l’en-tête du cadre', async ({ page }) => {
  const boites = await page.evaluate(() => {
    const tableauDesColonnes = () =>
      [...document.querySelectorAll('table')].find((t) =>
        /Colonnes de public\.orders/.test(t.querySelector('caption')?.textContent ?? ''),
      )
    const tableau = tableauDesColonnes()?.getBoundingClientRect()
    const ddl = document
      .querySelector('aside[aria-label^="DDL de public.orders"]')
      ?.getBoundingClientRect()
    const separateurs = [
      ...document.querySelectorAll('[role=separator][aria-orientation=vertical]'),
    ]
    const entete = document
      .querySelector('[role=separator][aria-orientation=vertical] ~ * header')
      ?.getBoundingClientRect()
    const colonne = separateurs[1]?.nextElementSibling?.getBoundingClientRect()
    return tableau && ddl && entete && colonne ? { tableau, ddl, entete, colonne } : null
  })
  const m = boites as NonNullable<typeof boites>

  // **Le DDL a changé de place, et ce test avec lui.** Il occupait une colonne de 392 px propre à
  // cette vue, qui prenait donc toute la largeur du centre. Depuis `22`, il occupe la colonne de
  // droite commune — la même que le détail de ligne en vue Données — et hérite donc de ses 296 px et
  // de sa poignée. Écart au handoff assumé, consigné dans `22`.
  expect(Math.round(m.ddl.width)).toBe(296)
  expect(m.ddl.left).toBeGreaterThanOrEqual(m.tableau.right - 1)

  // **Sous l'en-tête du cadre, pas à sa place** : c'est cet en-tête qui porte le couple de vues, donc
  // ce qui permet de revenir aux données. Un DDL qui le recouvrirait enfermerait l'utilisateur dans
  // la vue Structure.
  expect(m.ddl.top).toBeGreaterThanOrEqual(m.entete.bottom - 1)
  expect(Math.round(m.ddl.bottom)).toBe(Math.round(m.colonne.bottom))
})

test('le centre de la structure occupe toute la largeur laissée par la colonne', async ({
  page,
}) => {
  const mesures = await page.evaluate(() => {
    const separateurs = [
      ...document.querySelectorAll('[role=separator][aria-orientation=vertical]'),
    ]
    const centre = separateurs[1]?.previousElementSibling?.getBoundingClientRect()
    const tableau = [...document.querySelectorAll('table')]
      .find((t) => /Colonnes de public\.orders/.test(t.querySelector('caption')?.textContent ?? ''))
      ?.getBoundingClientRect()
    return centre && tableau ? { centre: Math.round(centre.width), tableau } : null
  })
  // La structure était rendue **hors** du partage, comme une console, parce qu'elle portait son DDL.
  // Elle y entre depuis `22` : son centre est donc borné par la même poignée que la grille, et large.
  expect(mesures?.centre).toBeGreaterThan(700)
})

test('la colonne du DDL n’est pas recouverte : le point de son bouton lui appartient', async ({
  page,
}) => {
  // **`elementFromPoint`, pas `getBoundingClientRect`** : une boîte peut avoir les bonnes
  // coordonnées et être entièrement masquée par un voisin. C'est la leçon du défaut de la
  // gouttière (`11b`), où une mesure de position validait un élément invisible.
  const dessus = await page.evaluate(() => {
    const bouton = document.querySelector('aside[aria-label^="DDL de public.orders"] button')
    if (!bouton) return null
    const boite = bouton.getBoundingClientRect()
    const dessus = document.elementFromPoint(boite.x + boite.width / 2, boite.y + boite.height / 2)
    return bouton.contains(dessus) || dessus === bouton
  })
  expect(dessus).toBe(true)
})

test('les deux panneaux du bas partagent la largeur du centre', async ({ page }) => {
  const boites = await page.evaluate(() => {
    const titres = ['Index', 'Contraintes & triggers'].map(
      (texte) =>
        [...document.querySelectorAll('h3')]
          .find((h) => h.textContent?.trim() === texte)
          ?.parentElement?.getBoundingClientRect() ?? null,
    )
    return titres[0] && titres[1] ? { index: titres[0], contraintes: titres[1] } : null
  })
  const m = boites as NonNullable<typeof boites>

  // Côte à côte, pas empilés : le mockup les met en deux colonnes séparées d'un filet.
  expect(m.contraintes.left).toBeGreaterThanOrEqual(m.index.right - 1)
  // Et de largeurs comparables — un panneau écrasé à 40 px ne montrerait aucune définition.
  expect(Math.abs(m.index.width - m.contraintes.width)).toBeLessThan(m.index.width * 0.15)
})

test('le tableau des colonnes défile plutôt que de pousser les panneaux hors de l’écran', async ({
  page,
}) => {
  const mesures = await page.evaluate(() => {
    const tableauDesColonnes = () =>
      [...document.querySelectorAll('table')].find((t) =>
        /Colonnes de public\.orders/.test(t.querySelector('caption')?.textContent ?? ''),
      )
    const zone = tableauDesColonnes()?.parentElement
    const fenetre = document.documentElement.getBoundingClientRect()
    const panneaux = [...document.querySelectorAll('h3')]
      .find((h) => h.textContent?.trim() === 'Index')
      ?.parentElement?.parentElement?.getBoundingClientRect()
    if (!zone || !panneaux) return null
    return {
      defilable: getComputedStyle(zone).overflowY,
      panneauxDansLaFenetre: panneaux.bottom <= fenetre.bottom + 1,
    }
  })
  const m = mesures as NonNullable<typeof mesures>

  // Dix-huit colonnes dépassent la hauteur donnée au tableau. Sans défilement, les panneaux
  // d'index et de contraintes sortiraient du bas de la fenêtre — le mockup, figé, ne le montre
  // pas parce qu'il n'a que quatorze lignes.
  expect(m.defilable).toBe('auto')
  expect(m.panneauxDansLaFenetre).toBe(true)
})

test('« Données » ramène la grille, et l’état actif se voit', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Structure' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  // La pastille sombre du mockup : sans elle, les deux libellés seraient du même gris et rien ne
  // dirait laquelle des deux vues est à l'écran.
  const fond = await page.evaluate(() => {
    const bouton = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Structure',
    )
    return bouton ? getComputedStyle(bouton).backgroundColor : null
  })
  expect(fond).not.toBe('rgba(0, 0, 0, 0)')

  await page.getByRole('button', { name: 'Données' }).click()
  await expect(page.getByRole('grid', { name: /Lignes de public\.orders/ })).toBeVisible()
})

test('l’en-tête de la colonne survit aux trois basculements', async ({ page }) => {
  // **La garantie que le cadre existe pour tenir** (`22`). Le couple était dans `RowPanel` avant
  // d'être ici : il aurait disparu en vue Structure — où il est justement ce qui permet de revenir —
  // et disparu dès qu'aucune ligne n'est sélectionnée.
  const couple = page.getByRole('button', { name: 'Données' })
  await expect(couple).toBeVisible()

  // 1. Retour aux données, sans sélection : le corps est vide, l'en-tête reste.
  await page.getByRole('button', { name: 'Données' }).click()
  await expect(page.getByRole('grid')).toBeVisible()
  await expect(couple).toBeVisible()
  await expect(page.locator('[aria-label^="Détail de la ligne"]')).toHaveCount(0)

  // 2. Une ligne sélectionnée : le détail entre **sous** l'en-tête.
  await page.getByRole('grid').getByRole('row').nth(2).click()
  await expect(page.locator('[aria-label="Détail de la ligne 1"]')).toBeVisible()
  await expect(couple).toBeVisible()

  // 3. Et de nouveau la structure : le DDL prend la place du détail, l'en-tête ne bouge pas.
  await page.getByRole('button', { name: 'Structure' }).click()
  await expect(page.locator('aside[aria-label^="DDL de public.orders"]')).toBeVisible()
  await expect(page.locator('[aria-label="Détail de la ligne 1"]')).toHaveCount(0)
  await expect(couple).toBeVisible()
})
