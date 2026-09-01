import { expect, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

// La gouttière réservée, la révélation au survol et la visibilité réelle du panneau : de la mise en
// page, donc hors de portée de Vitest. `08h` les nomme.
test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await page.waitForSelector('[role=tree]')
  await page.evaluate(() => document.fonts.ready)
})

/** Les bords qui ne doivent pas se croiser : la fin du méta et le début du « … ». */
async function bords(page: import('@playwright/test').Page, nom: string) {
  return page.evaluate((cible) => {
    const item = [...document.querySelectorAll('[role=treeitem]')].find((element) =>
      element.textContent?.includes(cible),
    )
    const bouton = document.querySelector(`[aria-label="Actions de ${cible}"]`)
    if (!item || !bouton) return null
    // **Le contenu le plus à droite, quel qu'il soit.** Une première version cherchait le méta par
    // sélecteur de classe et attrapait le compte « 2 bases » (à 145 px) au lieu du badge d'état (à
    // 188 px, pile contre le bouton) : elle mesurait le mauvais élément, donc restait verte quand la
    // gouttière disparaissait. La question est « rien ne passe-t-il sous le bouton ? », et elle ne
    // se pose pas d'un élément nommé d'avance.
    const meta = [...item.querySelectorAll('*')].reduce((leplusADroite, candidat) =>
      candidat.getBoundingClientRect().right > leplusADroite.getBoundingClientRect().right
        ? candidat
        : leplusADroite,
    )
    const boiteMeta = meta.getBoundingClientRect()
    return {
      finDuMeta: boiteMeta.right,
      debutDuBouton: bouton.getBoundingClientRect().left,
      // Ce qui se trouve réellement au centre du méta : la seule question qui compte.
      auCentreDuMeta: meta.contains(
        document.elementFromPoint(
          (boiteMeta.left + boiteMeta.right) / 2,
          (boiteMeta.top + boiteMeta.bottom) / 2,
        ),
      ),
    }
  }, nom)
}

test('la gouttière empêche le « … » de recouvrir le méta', async ({ page }) => {
  await page.getByRole('treeitem', { name: /Atelier Nord/ }).hover()
  await expect(page.getByRole('button', { name: 'Actions de Atelier Nord' })).toBeVisible()

  const mesures = await bords(page, 'Atelier Nord')
  // **La première version de ce test était vraie par construction.** Elle vérifiait que le méta ne
  // se *déplaçait* pas au survol — mais le bouton est en position absolue, donc il ne pousse jamais
  // rien : le test restait vert avec la gouttière supprimée. Ce que la gouttière garantit vraiment,
  // c'est que le bouton ne **recouvre** pas le méta.
  expect(mesures?.debutDuBouton).toBeGreaterThanOrEqual(mesures?.finDuMeta ?? 0)
  expect(mesures?.auCentreDuMeta).toBe(true)
})

test('le « … » est invisible au repos, et le méta occupe la même place', async ({ page }) => {
  // Sans cette vérification, la gouttière pourrait être « réservée » par un bouton simplement
  // toujours visible — le test précédent passerait, et le mockup ne serait pas respecté.
  const visibilite = await page.evaluate(() => {
    const bouton = document.querySelector('[aria-label="Actions de Atelier Nord"]')
    return bouton?.parentElement ? getComputedStyle(bouton.parentElement).visibility : null
  })
  expect(visibilite).toBe('hidden')
})

test('le « … » paraît aussi au focus clavier, sans souris', async ({ page }) => {
  // **Une action qui n'existe qu'au survol n'existe pas au clavier.** On atteint le bouton par
  // `Tab` depuis la ligne, sans jamais bouger la souris.
  await page.getByRole('treeitem', { name: /Atelier Nord/ }).focus()
  await page.keyboard.press('Tab')

  const etat = await page.evaluate(() => {
    const bouton = document.querySelector('[aria-label="Actions de Atelier Nord"]')
    return {
      focalise: document.activeElement === bouton,
      visibilite: bouton?.parentElement ? getComputedStyle(bouton.parentElement).visibility : null,
    }
  })
  expect(etat.focalise).toBe(true)
  expect(etat.visibilite).toBe('visible')
})

test('le panneau ouvert est réellement visible, et non simplement présent', async ({ page }) => {
  await page.getByRole('treeitem', { name: /Atelier Nord/ }).hover()
  await page.getByRole('button', { name: 'Actions de Atelier Nord' }).click()

  const auPoint = await page.evaluate(() => {
    const panneau = document.querySelector('[role=dialog][aria-label=Actions]')
    const boite = panneau?.getBoundingClientRect()
    if (!panneau || !boite || boite.height === 0) return null
    // **`elementFromPoint`, jamais `toBeVisible()` seul.** La sidebar défile et le panneau s'ouvre
    // en absolu : c'est la situation exacte du défaut n° 35, où un `overflow: hidden` d'ancêtre
    // découpait un panneau que l'assertion de visibilité de Playwright déclarait visible.
    const dessus = document.elementFromPoint(boite.left + boite.width / 2, boite.top + 6)
    return { contenu: panneau.contains(dessus) }
  })
  expect(auPoint?.contenu).toBe(true)
})

test('le « … » reste visible quand la souris passe du bouton à son panneau', async ({ page }) => {
  await page.getByRole('treeitem', { name: /Atelier Nord/ }).hover()
  await page.getByRole('button', { name: 'Actions de Atelier Nord' }).click()
  // La souris quitte la ligne pour aller vers le panneau : si le « … » disparaissait, le menu
  // paraîtrait flotter sans origine. **C'est acquis sans règle dédiée** — le panneau est un
  // descendant de l'enveloppe, donc le survoler survole encore la ligne, et le focus y est de toute
  // façon. Une règle `:has([aria-expanded='true'])' avait été ajoutée « en ceinture » ; la retirer
  // ne changeait rien à cette mesure, donc elle n'est pas là.
  await page.getByRole('button', { name: 'Retirer de DoraBase…' }).hover()

  const visibilite = await page.evaluate(() => {
    const bouton = document.querySelector('[aria-label="Actions de Atelier Nord"]')
    return bouton?.parentElement ? getComputedStyle(bouton.parentElement).visibility : null
  })
  expect(visibilite).toBe('visible')
})

test('« Modifier… » sur une base ouvre la modale de modification, préremplie', async ({ page }) => {
  // La base n'existe dans le DOM qu'une fois son projet déplié.
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).hover()
  await page.getByRole('button', { name: 'Actions de analytics' }).click()
  await page.getByRole('button', { name: 'Modifier…' }).click()

  const modale = page.getByRole('dialog', { name: /Modifier/ })
  await expect(modale).toBeVisible()
  // Préremplie sur **cette** base : une modale vide, ou remplie d'une autre base, serait pire que
  // pas de chemin du tout. Le nom n'est plus un champ du formulaire (1er septembre 2026) : c'est
  // le titre de la modale elle-même — « Modifier analytics » — qui porte cette garantie.
  await expect(page.getByRole('dialog', { name: 'Modifier analytics' })).toBeVisible()
})
