import { expect, test } from '@playwright/test'
import { deplierUnEnvironnement, ouvrirUneConsole } from './pourLesTests'

// Le partage vertical et sa mémorisation : de la mise en page, donc hors de portée de Vitest.
test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await ouvrirUneConsole(page, 'analytics')
  await page.waitForSelector('[aria-label="Requête SQL"]')
  await page.evaluate(() => document.fonts.ready)
})

test('l’éditeur est au-dessus du résultat, pas à côté', async ({ page }) => {
  const boites = await page.evaluate(() => {
    // **`.cm-editor`, la zone entière — pas `.cm-content`.** Depuis `12b`, le texte est précédé
    // d'une gouttière de numéros : comparer le bord gauche du *texte* à celui de la zone de résultat
    // mesurerait la largeur de la gouttière, pas le partage.
    const editeur = document.querySelector('.cm-editor')?.getBoundingClientRect()
    // **La zone, pas le texte** : le paragraphe est centré, donc son `left` ne dit rien de la
    // colonne qu'il occupe. Une première version comparait sa position et échouait pour cette
    // raison — elle mesurait le centrage, pas le partage.
    const resultat = [...document.querySelectorAll('p')]
      .find((p) => /Aucun résultat/.test(p.textContent ?? ''))
      ?.parentElement?.getBoundingClientRect()
    if (!editeur || !resultat) return null
    return { editeur, resultat }
  })
  const m = boites as NonNullable<typeof boites>
  // **Empilés, et c'est tout le travail du `SplitPane` de `12a`** : `03` ne savait diviser qu'en
  // colonnes, ce qui suffisait à une sidebar.
  expect(m.resultat.top).toBeGreaterThan(m.editeur.bottom - 1)
  // Et ils partagent la largeur, ce qu'un partage en colonnes n'aurait pas donné.
  expect(Math.round(m.resultat.left)).toBe(Math.round(m.editeur.left))
})

test('la poignée du partage s’annonce comme un séparateur horizontal', async ({ page }) => {
  const separateurs = await page.evaluate(() =>
    [...document.querySelectorAll('[role=separator]')].map((s) =>
      s.getAttribute('aria-orientation'),
    ),
  )
  // **L'orientation ARIA est celle du séparateur, pas celle du partage** : un partage empilé est
  // séparé par une barre *horizontale*. Confondre les deux mots annoncerait l'inverse de ce qu'on
  // voit — et la sidebar, elle, garde son séparateur vertical.
  expect(separateurs).toContain('horizontal')
  expect(separateurs).toContain('vertical')
})

test('glisser la poignée du bas redimensionne en hauteur, et la taille survit', async ({
  page,
}) => {
  // **`.last()` et non `.first()`** : depuis `API-32`, la sidebar porte elle-même un partage
  // empilé — la zone d'instances —, dont la poignée est un séparateur horizontal et vient d'abord
  // dans le document. Celle de la console est la dernière.
  const poignee = page.locator('[role=separator][aria-orientation=horizontal]').last()
  const boite = await poignee.boundingBox()
  if (!boite) throw new Error('la poignée doit être visible')

  const hauteurAvant = await page.evaluate(
    () => document.querySelector('.cm-editor')?.clientHeight ?? 0,
  )
  await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2)
  await page.mouse.down()
  await page.mouse.move(boite.x + boite.width / 2, boite.y - 60)
  await page.mouse.up()

  const hauteurApres = await page.evaluate(
    () => document.querySelector('.cm-editor')?.clientHeight ?? 0,
  )
  // Le geste suit la poignée : monter la poignée agrandit le résultat, donc rétrécit l'éditeur.
  expect(hauteurApres).toBeLessThan(hauteurAvant)

  // **Et la hauteur est mémorisée** : rouvrir une console sur une taille par défaut ferait perdre le
  // réglage à chaque fois.
  await page.reload()
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await ouvrirUneConsole(page, 'analytics')
  await page.waitForSelector('[aria-label="Requête SQL"]')
  const hauteurRelue = await page.evaluate(
    () => document.querySelector('.cm-editor')?.clientHeight ?? 0,
  )
  expect(Math.abs(hauteurRelue - hauteurApres)).toBeLessThanOrEqual(2)
})

test('la console occupe toute la largeur laissée par la sidebar', async ({ page }) => {
  const mesures = await page.evaluate(() => {
    const editeur = document.querySelector('.cm-editor')
    const tree = document.querySelector('[role=tree]')
    if (!editeur || !tree) return null
    return {
      droiteEditeur: Math.round(editeur.getBoundingClientRect().right),
      largeurFenetre: window.innerWidth,
    }
  })
  const m = mesures as NonNullable<typeof mesures>
  // **Sans panneau droit, le centre prend tout.** Il n'en prenait que la moitié : le `SplitPane`
  // n'avait pas de `width: 100%`, ce qui ne se voyait pas tant que son contenu était large — une
  // grille et un panneau de 296 px. La console, qui ne réclame aucune largeur, a révélé le manque.
  expect(m.largeurFenetre - m.droiteEditeur).toBeLessThan(12)
})

test('une console n’est pas entourée d’éléments de table', async ({ page }) => {
  const vus = await page.evaluate(() => ({
    // Le panneau droit de `A5` proposerait de sélectionner une ligne d'un résultat qui n'existe pas.
    detail: document.body.textContent?.includes('Sélectionnez une ligne') ?? false,
    // La barre d'état annoncerait « 500 lignes · limit 500 » pour une requête qui n'a pas tourné.
    statut: document.querySelector('[aria-label="État de la table"]') !== null,
    // « Données / Structure » décrit deux vues d'un objet de base, pas d'une requête.
    vues: document.body.textContent?.includes('Structure') ?? false,
  }))
  // Trois éléments de table qui restaient visibles sous une console — vus à l'écran en assemblant
  // `12a`, et invisibles aux tests unitaires qui ne regardaient qu'un composant à la fois.
  expect(vus).toEqual({ detail: false, statut: false, vues: false })
})

test('la toolbar de la console a la même hauteur que celle de la table', async ({ page }) => {
  // On ouvre aussi une table, pour **comparer les deux barres** plutôt que la console à un nombre.
  // Une valeur en dur passerait à côté du sujet : ce qui se voit au basculement d'onglet est l'écart
  // entre les deux, pas leur valeur absolue.
  // **Les deux barres portent `role="toolbar"`**, ce qui les rend mesurables sans dépendre de la
  // structure du DOM. Une première version remontait au parent d'un bouton et mesurait un groupe
  // interne de 27 px : elle comparait deux choses différentes.
  const hauteur = async () => {
    const boite = await page.getByRole('toolbar').first().boundingBox()
    return boite ? Math.round(boite.height) : null
  }
  const hauteurConsole = await hauteur()

  await page.getByRole('treeitem', { name: /^orders 1\.9/ }).click()
  await page.waitForSelector('[role=grid]')
  const hauteurTable = await hauteur()

  expect(hauteurConsole).toBe(hauteurTable)
})
