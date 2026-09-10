import { expect, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

// Le menu d'une ligne d'arbre (`27`) : son ouverture au clic droit, et sa fermeture quand le pointeur
// s'en va. Deux comportements que seul un vrai navigateur mesure — jsdom n'a ni `visibility` calculée
// ni pointeur, et les trois défauts corrigés ici sont venus de l'usage, pas d'un test.
test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page.evaluate(() => document.fonts.ready)
})

test('sortir de la ligne ferme le menu, et le survol ne le rouvre pas', async ({ page }) => {
  const ligne = page.getByRole('treeitem', { name: /analytics/ }).first()
  await ligne.hover()
  await page.getByRole('button', { name: 'Actions de analytics' }).click()
  await expect(page.getByRole('dialog', { name: 'Actions' })).toBeVisible()

  // On s'en va — vers le filtre, qui est loin de la ligne et du panneau.
  await page.getByPlaceholder(/Filtrer l'arborescence/).hover()

  // **Fermé, pas seulement invisible.** Le panneau vit dans la gouttière que `TreeRow` masque hors
  // survol : sans fermeture réelle, il ne disparaissait qu'en apparence.
  await expect(page.getByRole('dialog', { name: 'Actions' })).toHaveCount(0)

  // Et revenir sur la ligne ne le ramène pas : il faut recliquer.
  await ligne.hover()
  await expect(page.getByRole('dialog', { name: 'Actions' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Actions de analytics' }).click()
  await expect(page.getByRole('dialog', { name: 'Actions' })).toBeVisible()
})

test('descendre du « … » vers le menu ne le ferme pas', async ({ page }) => {
  await page
    .getByRole('treeitem', { name: /analytics/ })
    .first()
    .hover()
  const declencheur = page.getByRole('button', { name: 'Actions de analytics' })
  const depart = await declencheur.boundingBox()
  await declencheur.click()
  const arrivee = await page.getByRole('button', { name: 'Renommer…' }).boundingBox()
  if (!depart || !arrivee) throw new Error('le déclencheur et l’entrée doivent être mesurables')

  /* **Le trajet est joué pas à pas, et c'est tout l'objet du test.** `hover()` téléporte le pointeur
     d'un élément à l'autre : il ne traverse jamais l'interstice de 2px que `Popover` laisse entre le
     déclencheur et son panneau, donc il ne peut pas voir la fermeture prématurée. Un sabotage
     ramenant le délai de grâce à 0 passait ce test tant qu'il utilisait `hover()`.

     Les pas font ~2px : assez fins pour que Chromium hit-teste l'interstice, comme une vraie main. */
  const x = depart.x + depart.width / 2
  for (let y = depart.y + depart.height / 2; y < arrivee.y + arrivee.height / 2; y += 2) {
    await page.mouse.move(x, y)
  }

  await expect(page.getByRole('dialog', { name: 'Actions' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Renommer…' })).toBeVisible()
})

/* **Le trajet qui a motivé `API-35`, et le seul que le précédent ne prenait pas.** Celui du dessus
   descend tout droit, à l'abscisse du « … » : il n'a que trois pixels à franchir, et n'importe quel
   délai les couvre. Le geste réel ne descend pas tout droit — le panneau pend **à gauche** d'un
   déclencheur de 18 px, donc on longe la ligne avant de descendre, et on longe *sur la ligne*, qui
   n'appartient ni au déclencheur ni au panneau. Le sursis y courait pendant tout le trajet.

   Le pas de 10 ms n'est pas une durée à absorber mais une main à imiter : quatre-vingt-dix pixels en
   dix-huit pas, soit un demi-millier de pixels par seconde — un geste ordinaire, et deux cent
   quarante millisecondes. Ce que le test garde n'est donc **pas** que le délai vaut plus que cela,
   mais que le trajet ne compte pas comme un départ (règle n° 3 : un test calé sur une durée réelle
   est un tirage au sort). */
test('longer la ligne vers le menu ne compte pas comme un départ', async ({ page }) => {
  await page
    .getByRole('treeitem', { name: /analytics/ })
    .first()
    .hover()
  const declencheur = page.getByRole('button', { name: 'Actions de analytics' })
  const depart = await declencheur.boundingBox()
  await declencheur.click()
  await expect(page.getByRole('dialog', { name: 'Actions' })).toBeVisible()
  const arrivee = await page.getByRole('button', { name: 'Renommer…' }).boundingBox()
  if (!depart || !arrivee) throw new Error('le déclencheur et l’entrée doivent être mesurables')

  const y = depart.y + depart.height / 2
  for (let x = depart.x + depart.width / 2; x > arrivee.x + 20; x -= 5) {
    await page.mouse.move(x, y)
    await page.waitForTimeout(10)
  }

  // **Mesuré avant de descendre**, et c'est là toute la question : le menu doit encore être là quand
  // la main arrive au-dessus de lui. Le vérifier après la descente laisserait croire que le trajet
  // est sans danger alors qu'il ne le serait que parce qu'on l'a fini.
  await expect(page.getByRole('dialog', { name: 'Actions' })).toBeVisible()
  await page.mouse.move(arrivee.x + arrivee.width / 2, arrivee.y + arrivee.height / 2)
  await expect(page.getByRole('button', { name: 'Renommer…' })).toBeVisible()
})

/* **Le menu s'efface au lieu de se fermer, et c'est la moitié qu'aucune assertion de fermeture ne
   voit.** Le panneau vit dans la gouttière `.actions`, que `TreeRow` masque hors survol : au coin
   arrondi du panneau, ou à quelques pixels de son bord, le pointeur n'est ni sur la ligne ni sur le
   panneau. `useSortieDuPointeur` l'y garde **ouvert** — c'est tout l'objet d'`API-35` — et sans la
   ceinture de `TreeRow` il devient *invisible* pendant qu'on traverse, ce qui se rapporte comme une
   disparition sans en être une. Pire : `visibility: hidden` le retire du test de survol, donc plus
   rien ne peut le ramener.

   **Le `blur` n'est pas une commodité de test, c'est le décor** (règle n° 5). Chromium focalise un
   bouton au clic, donc `:focus-within` tient la gouttière visible et rend les deux causes
   indiscernables ; **WebKit ne le fait pas** — la convention macOS —, si bien que sous WKWebView, où
   le défaut a été signalé, il ne reste que le survol. Sans cette ligne, ce test est vert sous
   Chromium pour une raison qui n'existe pas là où le défaut vit, et c'est exactement ce qui a laissé
   retirer la ceinture deux fois. */
test('sans focus sur le déclencheur, le menu ne s’efface pas quand on l’approche', async ({
  page,
}) => {
  await page
    .getByRole('treeitem', { name: /analytics/ })
    .first()
    .hover()
  await page.getByRole('button', { name: 'Actions de analytics' }).click()
  const panneau = page.getByRole('dialog', { name: 'Actions' })
  await expect(panneau).toBeVisible()
  const boite = await panneau.boundingBox()
  if (!boite) throw new Error('le panneau doit être mesurable')

  // L'état dans lequel WebKit laisse la page après un clic sur un bouton.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

  // Trois points de l'entourage immédiat : le coin arrondi, puis un pixel de chaque côté du panneau.
  // Aucun n'est sur la ligne, aucun n'est sur le panneau, et l'on va pourtant vers celui-ci.
  const approches: readonly [number, number][] = [
    [boite.x + 1, boite.y + 1],
    [boite.x - 3, boite.y + 40],
    [boite.x + boite.width + 3, boite.y + 40],
  ]
  for (const [x, y] of approches) {
    await page.mouse.move(x, y)
    expect(await panneau.evaluate((element) => getComputedStyle(element).visibility)).toBe(
      'visible',
    )
  }

  // Et l'on arrive : le menu est toujours là, et cliquable.
  await page.getByRole('button', { name: 'Renommer…' }).click()
  await expect(page.getByLabel('Nouveau nom de analytics')).toBeFocused()
})

test('le clic droit sur une connexion ouvre les mêmes actions, au pointeur', async ({ page }) => {
  const ligne = page.getByRole('treeitem', { name: /analytics/ }).first()
  await ligne.click({ button: 'right' })

  const menu = page.getByRole('menu', { name: 'Actions de analytics' })
  await expect(menu).toContainText('Renommer…')
  await expect(menu).toContainText('Retirer de DoraBase…')

  // **Réellement visible, pas seulement présent** — la sidebar défile, et un `overflow` d'ancêtre
  // découperait le panneau sans qu'aucune assertion de visibilité s'en aperçoive (défaut n° 35).
  const auPoint = await page.evaluate(() => {
    const panneau = document.querySelector('[role=menu]')
    const boite = panneau?.getBoundingClientRect()
    if (!panneau || !boite) return null
    return panneau.contains(document.elementFromPoint(boite.left + boite.width / 2, boite.top + 6))
  })
  expect(auPoint).toBe(true)

  // Le menu du système ne s'ouvre pas par-dessus : c'est tout l'objet du `preventDefault`.
  await page.getByRole('menuitem', { name: 'Renommer…' }).click()
  await expect(page.getByLabel('Nouveau nom de analytics')).toBeFocused()
})

/* **Le parcours complet par le clic droit**, et non seulement l'ouverture du menu : c'est ce qui
   prouve que la seconde voie mène vraiment à l'action, et pas à un menu décoratif. Le renommage
   lui-même est couvert par `26` ; ici il sert de témoin. */
test('le clic droit mène à l’action jusqu’au bout, comme le « … »', async ({ page }) => {
  await page
    .getByRole('treeitem', { name: /analytics/ })
    .first()
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Renommer…' }).click()
  const champ = page.getByLabel('Nouveau nom de analytics')
  await champ.fill('entrepot')
  await champ.press('Enter')

  await expect(page.getByRole('treeitem', { name: /entrepot/ })).toBeVisible()
})

test('le clic droit sur un environnement mène à la déclaration d’une connexion', async ({
  page,
}) => {
  // **Le parcours entier, depuis `/?demo`** : le geste part d'une ligne d'arbre et doit aboutir à la
  // modale, préréglée sur l'environnement d'où l'on a cliqué. Un test de la sidebar seule aurait
  // vérifié l'appel de la prop — c'est-à-dire un proxy du chemin, le piège d'`A4`.
  await page.getByRole('treeitem', { name: /^prod\b/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Ajouter une connexion/ }).click()
  await expect(page.getByRole('dialog', { name: 'Nouvelle connexion' })).toBeVisible()
  // `prod` et non `dev` : c'est de `prod` que part le clic, et le redemander serait poser une
  // question dont on connaissait la réponse.
  // `exact`, et ce n'est pas une précaution : le décor déclare `preprod` à côté de `prod`, et un nom
  // non ancré désigne les deux — Playwright refuse alors, la résolution étant stricte. C'est la même
  // morsure que le motif des lignes d'arbre.
  await expect(page.getByRole('radio', { name: 'prod', exact: true })).toBeChecked()
})
