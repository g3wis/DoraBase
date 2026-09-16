import { expect, type Locator, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

/*
 * `API-55` : une colonne de clé étrangère se marque, et sa valeur se suit.
 *
 * Ce que ce niveau seul peut juger, et qui est tout le sujet :
 *
 * - **le bouton ne paraît qu'au survol de sa cellule**, par une propriété personnalisée que la
 *   cellule déclare (`VirtualGrid`, `--cell-actions`). Un composant monté seul ne peut pas prouver
 *   qu'il la reçoit de son hôte, et jsdom ne résout aucune variable de CSS ;
 * - **il ne recouvre pas la valeur**, ce qui est de la mise en page — hors de portée de Vitest
 *   (règle n° 9), et la raison d'être de la réserve de 17 px ;
 * - **et il tient dans sa cellule**, qui fait 130 px et porte déjà une valeur et une ellipse.
 *
 * **Ce que ce niveau ne peut pas juger, et qu'il ne faut pas y rajouter** : la réserve de largeur
 * que l'ajustement automatique accorde à une colonne suivie. Un test « rien n'est tronqué » y est
 * resté **vert sous le sabotage des deux réserves** — `user_id` porte cinq chiffres dans `/?demo`
 * et son nom en fait sept, donc la colonne bute sur son plancher de 60 px et rien n'approche jamais
 * son bord. Il mesurait la brièveté du décor, pas la réserve. L'allonger pour le faire mordre
 * serait écrire un décor pour un test, et un identifiant à douze chiffres vers une table de 92 800
 * lignes serait moins vrai que celui d'aujourd'hui : l'arithmétique est donc gardée où elle se
 * mesure, dans `ajustement.test.ts`, en boîtes posées plutôt que rendues.
 */

/** Le bouton de saut, **par son attribut** : `visibility: hidden` le retire des rôles. */
const SAUT = 'button[aria-label^="Suivre user_id"]'

/** La cellule `user_id` d'une ligne de données : gouttière, `id`, puis `user_id`. */
function celluleUserId(ligne: Locator): Locator {
  return ligne.locator('[role=gridcell]').nth(2)
}

function ligneDeDonnees(page: import('@playwright/test').Page, rang: number): Locator {
  return page.locator('[role=grid] [role=row][aria-selected]').nth(rang)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await page.getByRole('treeitem', { name: /^orders 1\.9/ }).click()
  await page.waitForSelector('[role=grid]')
  await page.evaluate(() => document.fonts.ready)
  // Le décor : `orders.user_id` porte bien une clé étrangère dans `/?demo`. Sans cette assertion,
  // tout ce qui suit pourrait mesurer une grille sans aucune colonne suivie.
  await expect(page.getByRole('columnheader', { name: 'user_id — clé étrangère' })).toBeVisible()
})

test('le bouton se découvre au survol de sa cellule, et d’elle seule', async ({ page }) => {
  const ligne = ligneDeDonnees(page, 2)
  const bouton = ligne.locator(SAUT)

  // Rien au repos : c'est ce qui distingue une action révélée d'une action toujours là.
  await expect(bouton).toBeHidden()

  // **Le survol d'une *autre* cellule de la même ligne ne le révèle pas.** C'est l'écart avec la
  // poubelle d'`API-45`, qui agit sur la ligne : celui-ci agit sur la valeur d'une cellule, et deux
  // clés étrangères de la même ligne mènent à deux tables. Les allumer ensemble ferait désigner
  // deux endroits à la fois.
  await ligne.locator('[role=gridcell]').nth(3).hover()
  await expect(bouton).toBeHidden()

  await celluleUserId(ligne).hover()
  await expect(bouton).toBeVisible()

  // Et le survol appartient à *cette* cellule : la voisine du dessous ne montre rien.
  await expect(ligneDeDonnees(page, 3).locator(SAUT)).toBeHidden()
})

test('le bouton tient dans sa cellule et ne recouvre pas la valeur', async ({ page }) => {
  const ligne = ligneDeDonnees(page, 2)
  const cellule = celluleUserId(ligne)
  await cellule.hover()
  const bouton = ligne.locator(SAUT)
  await expect(bouton).toBeVisible()

  const boite = await cellule.boundingBox()
  const boiteDuBouton = await bouton.boundingBox()
  if (!boite || !boiteDuBouton) throw new Error('boîte introuvable')
  /*
   * **Le bord du contenu, et non celui de la boîte.** La réserve est un `padding-right` : la boîte
   * de la valeur va donc jusqu'au bord de la cellule, bouton compris, et comparer les boîtes ne
   * mesurerait rien. Ce qui doit rester à gauche du bouton est l'endroit le plus loin qu'un texte
   * puisse atteindre — mesuré ici, et non déduit de la valeur du décor, qui est courte.
   */
  const borduDuTexte = await cellule
    .locator('> span')
    .first()
    .evaluate((element) => {
      const boite = element.getBoundingClientRect()
      return boite.right - Number.parseFloat(getComputedStyle(element).paddingRight)
    })

  // **Dans la cellule, aux deux bords.** Une cellule est en `overflow: hidden` : un bouton qui en
  // sortirait serait rogné sans que rien n'échoue — le défaut n° 35 par un bout qu'aucune
  // assertion de présence ne voit.
  expect(boiteDuBouton.x).toBeGreaterThanOrEqual(boite.x)
  expect(boiteDuBouton.x + boiteDuBouton.width).toBeLessThanOrEqual(boite.x + boite.width + 0.5)
  expect(boiteDuBouton.y).toBeGreaterThanOrEqual(boite.y - 0.5)
  expect(boiteDuBouton.y + boiteDuBouton.height).toBeLessThanOrEqual(boite.y + boite.height + 0.5)

  // **Et il ne se peint pas sur la valeur.** C'est une **égalité de bord**, pas un ordre de
  // grandeur (règle n° 18) : la réserve de 17 px est exactement ce qui sépare la fin du texte du
  // début du bouton, et sans elle les deux boîtes se chevaucheraient de quinze pixels au lieu de
  // se toucher.
  expect(borduDuTexte).toBeLessThanOrEqual(boiteDuBouton.x + 0.5)
})

test('suivre la clé ouvre la table visée, filtrée sur la ligne désignée', async ({ page }) => {
  const ligne = ligneDeDonnees(page, 2)
  const cellule = celluleUserId(ligne)
  const valeur = (await cellule.innerText()).trim()
  await cellule.hover()
  await ligne.locator(SAUT).click()

  // L'onglet visé est ouvert **et** au premier plan.
  await expect(page.getByRole('tab', { name: /users/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('grid', { name: 'Lignes de public.users' })).toBeVisible()

  // Le filtre est **posé et lisible** : le chip de la barre d'outils est ce par quoi on le retire.
  await expect(page.getByRole('button', { name: 'Retirer le filtre sur id' })).toBeVisible()
  // Et c'est bien la valeur de la cellule qu'on a quittée qui filtre — un saut qui poserait une
  // autre valeur rendrait une ligne plausible et fausse.
  await expect(page.getByRole('textbox', { name: 'Filtrer id' })).toHaveValue(
    valeur.replace(/\s/g, ''),
  )
})

test('le même saut se fait au clavier, depuis la section « Liens » du panneau', async ({
  page,
}) => {
  // **Le chemin clavier du geste** : le bouton de la grille ne paraît qu'au survol, donc il n'est
  // atteignable qu'à la souris. Les deux appellent la même fonction (règle n° 17).
  await ligneDeDonnees(page, 2).click()
  const lien = page.getByRole('button', { name: /user_id.*users\.id/ })
  await expect(lien).toBeVisible()

  // Atteint au clavier, et non cliqué : c'est la propriété qu'on mesure.
  await lien.focus()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('grid', { name: 'Lignes de public.users' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retirer le filtre sur id' })).toBeVisible()
})

test('un lien sortant garde la police d’un lien, bien qu’il soit un bouton', async ({ page }) => {
  /*
   * **Rapporté à l'usage** : « la police et la taille des liens du panneau droit ne
   * correspondent pas au reste de l'interface ». `.lienSuivable` posait `font: inherit` pour
   * neutraliser la police de formulaire d'un `<button>` — une **abréviation**, qui repose famille,
   * taille, graisse, style et hauteur de ligne d'un coup, et qui, déclarée après `.lien`, écrasait
   * ses trois valeurs par celles de l'ancêtre. Mesuré : Nunito 16 px/400 au lieu de JetBrains Mono
   * 11 px/500, donc un lien sortant qui ne ressemblait à rien de son voisinage.
   *
   * **Aucun des 1 935 tests d'alors ne l'a vu** : le DOM était juste, les rôles aussi, et le nom
   * accessible inchangé. Une police n'est ni une position ni une présence — c'est un style
   * *calculé*, et rien n'en mesurait aucun dans ce panneau.
   *
   * Les deux sortes de liens vivent sur deux tables du décor — `orders` porte la seule sortante,
   * `shipment_batches` la seule entrante —, donc la comparaison traverse deux onglets. C'est ce
   * qui la rend juste : ce qu'on garde est qu'un lien se lit **pareil** qu'il soit cliquable ou
   * non, et non qu'il vaille telle valeur, qu'un changement de design périmerait.
   */
  const police = (cible: Locator) =>
    cible.evaluate((element) => {
      const style = getComputedStyle(element)
      return `${style.fontFamily} / ${style.fontSize} / ${style.fontWeight}`
    })

  await ligneDeDonnees(page, 2).click()
  const sortant = await police(page.getByRole('button', { name: /user_id.*users\.id/ }))

  await page.getByRole('treeitem', { name: /^shipment_batches/ }).click()
  await page.waitForSelector('[role=grid][aria-label*="shipment_batches"]')
  await ligneDeDonnees(page, 2).click()
  const entrant = await police(
    page.locator('[class*="liens"]').getByText('inventory_movements.batch_id'),
  )

  expect(sortant).toBe(entrant)
  // Et le contrôle positif : sans lui, deux polices fausses mais égales passeraient.
  expect(sortant).toContain('JetBrains Mono')
})
