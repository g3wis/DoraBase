import { expect, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

// La sélection de texte du navigateur : jsdom n'en a pas, donc c'est ici que ça se mesure.
// Signalé à l'usage le 11 août 2026 — glisser la poignée surlignait les lignes de la grille.
test('glisser la poignée ne sélectionne aucun texte', async ({ page }) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await page.getByRole('treeitem', { name: /^orders 1\.9/ }).click()
  await page.waitForSelector('[role=grid]')

  // La poignée de la sidebar : celle qui traverse la grille en s'élargissant, donc celle qui
  // surlignait le plus de texte.
  const poignee = page.getByRole('separator', { includeHidden: false }).first()
  const boite = await poignee.boundingBox()
  if (!boite) throw new Error('la poignée doit être visible')

  await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2)
  await page.mouse.down()
  // Plusieurs pas, en traversant la grille : une sélection démarrée se propage au mouvement.
  for (const dx of [40, 80, 120, 160]) {
    await page.mouse.move(boite.x + dx, boite.y + boite.height / 2)
  }
  // **On mesure `user-select`, pas `getSelection()`.** Une première version comparait la sélection
  // rendue par le navigateur : elle restait vide même sans le correctif, Chromium ne produisant pas
  // de sélection dans ce scénario piloté. Le test était donc vert pour la mauvaise raison. Ce qui
  // empêche réellement le surlignage est la propriété calculée sur le texte traversé.
  const pendant = await page.evaluate(() => {
    const cellule = document.querySelector('[role=grid] [role=gridcell]')
    return {
      selection: window.getSelection()?.toString() ?? '',
      userSelect: cellule ? getComputedStyle(cellule).userSelect : null,
    }
  })
  await page.mouse.up()

  expect(pendant.userSelect).toBe('none')
  expect(pendant.selection).toBe('')
})

test('la sélection redevient possible après le glissement', async ({ page }) => {
  await page.goto('/?demo')
  await page.waitForSelector('[role=tree]')
  const poignee = page.getByRole('separator', { includeHidden: false }).first()
  const boite = await poignee.boundingBox()
  if (!boite) throw new Error('la poignée doit être visible')

  await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2)
  await page.mouse.down()
  await page.mouse.move(boite.x + 60, boite.y + boite.height / 2)
  await page.mouse.up()

  // **Suspendre la sélection sans la rendre serait pire que le défaut d'origine** : les blocs de
  // données deviendraient inélectables jusqu'au rechargement.
  //
  // **La sonde a changé de cible, et c'est une conséquence assumée.** Elle interrogeait une ligne de
  // l'arbre ; depuis que le chrome est délibérément inélectable (`reset.css`), une ligne d'arbre rend
  // `none` en permanence et cette assertion serait devenue une tautologie inversée — elle échouerait
  // toujours. Ce qui doit redevenir sélectionnable, c'est ce qui l'est par décision : une saisie, un
  // bloc de code.
  const mesures = await page.evaluate(() => {
    const saisie = document.querySelector('input')
    return {
      saisie: saisie ? getComputedStyle(saisie).userSelect : null,
      // La classe posée sur `<body>` le temps du geste doit être retirée : c'est elle qui neutralise
      // aussi les descendants, et l'oublier laisserait tout figé.
      classeRetiree: !/pendantLeGlissement/.test(document.body.className),
    }
  })
  expect(mesures.saisie).not.toBe('none')
  expect(mesures.classeRetiree).toBe(true)
})
