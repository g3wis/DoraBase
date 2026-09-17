import { expect, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

/**
 * Le transfert de projets (`API-30`).
 *
 * # Ce que ce niveau garde, et qu'aucun autre ne peut garder
 *
 * `ExportProjects.test.tsx` et `ImportProjects.test.tsx` mesurent les gestes, `Workbench.test.tsx`
 * le câblage de l'entrée de menu. Trois faits leur échappent aux trois, parce que jsdom ne calcule
 * aucune mise en page (règle n° 9) :
 *
 * 1. **que le chemin complet existe** — le menu d'une ligne de projet ouvre bien la modale, dans
 *    l'écran assemblé et non dans une vitrine (règle n° 8) ;
 * 2. **que les deux modales tiennent dans la fenêtre** : c'est le défaut du 1er septembre 2026, où
 *    le pied d'`A2` sortait par le bas et « Enregistrer » devenait inatteignable. Celle d'import
 *    porte une liste dont la longueur vient du fichier, donc elle est du même gabarit ;
 * 3. **que la liste des projets défile dans son propre conteneur** plutôt que de pousser les deux
 *    boutons hors de vue.
 *
 * # Les deux sens passent par un vrai chemin
 *
 * L'import n'en avait qu'un — le menu natif, que Playwright ne touche pas —, et ce fichier l'ouvrait
 * par un paramètre de décor. Le paramètre est parti avec le signalement qui l'a rendu inutile
 * (17 septembre 2026, « je n'ai pas trouvé comment importer ») : l'import a gagné son bouton dans la
 * bande de l'arbre, donc le test emprunte ce que l'utilisateur emprunte. **C'est le bon sens de la
 * correction** — ce qu'un test ne peut atteindre que par une porte dérobée est souvent ce qu'un
 * utilisateur ne peut pas atteindre du tout, et les modales de dump, qui n'ont toujours aucun test
 * de bout en bout, sont le même cas resté ouvert.
 */

test.describe("l'export d'un projet", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?demo')
    await deplierUnEnvironnement(page)
    // Le survol est obligatoire : le « … » d'une ligne est en `visibility: hidden` hors survol.
    await page.getByRole('treeitem', { name: /Atelier Nord/ }).hover()
    await page.getByRole('button', { name: 'Actions de Atelier Nord' }).click()
    await page.getByRole('button', { name: 'Exporter le projet…' }).click()
    await page.getByRole('dialog', { name: 'Exporter les projets' }).waitFor()
    await page.evaluate(() => document.fonts.ready)
  })

  test('le menu de la ligne ouvre la modale, sur ce projet', async ({ page }) => {
    const modale = page.getByRole('dialog', { name: 'Exporter les projets' })

    // **La portée est nommée** : c'est la seule chose qui distingue l'export d'un projet de celui de
    // toute la configuration, et elle vient du nœud d'où part le geste.
    await expect(modale).toContainText('Atelier Nord')
    await expect(modale.getByRole('switch', { name: 'Inclure les mots de passe' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  test("l'avertissement des mots de passe paraît avant le choix du fichier", async ({ page }) => {
    const modale = page.getByRole('dialog', { name: 'Exporter les projets' })
    await expect(modale).toContainText('sans mot de passe')

    await modale.getByRole('switch', { name: 'Inclure les mots de passe' }).click()

    // **Avant le geste, pas après** : une confirmation arriverait une fois le fichier choisi.
    await expect(modale).toContainText('ne se reprend pas')
    // Et le bloc reste dans la modale, malgré deux lignes de texte de plus.
    await attendreQueRienNeDeborde(page, 'Exporter les projets')
  })

  test('la modale tient dans la fenêtre, et rien ne franchit ses bords', async ({ page }) => {
    await mesurerLaCoquille(page, 'Exporter les projets')
  })
})

test.describe("l'import de projets", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?demo')
    // **Par le bouton de la bande**, comme un utilisateur : c'est ce chemin-là qui manquait.
    await page
      .getByRole('toolbar', { name: 'Actions du panneau' })
      .getByRole('button', { name: 'Importer des projets…' })
      .click()
    await page.getByRole('dialog', { name: 'Importer des projets' }).waitFor()
    await page.getByRole('button', { name: 'Choisir un fichier…' }).click()
    // La mesure **après** l'attente qui prouve l'effet (règle n° 15) : l'aperçu arrive d'une
    // promesse, et une lecture sèche daterait du rendu d'avant.
    await page.getByRole('checkbox', { name: 'Quai Sud' }).waitFor()
    await page.evaluate(() => document.fonts.ready)
  })

  test('les trois sortes de verdict se lisent, et le refusé n’a pas de case', async ({ page }) => {
    const modale = page.getByRole('dialog', { name: 'Importer des projets' })

    await expect(modale).toContainText('Nouveau projet')
    await expect(modale).toContainText('Projet existant, complété')
    await expect(modale).toContainText('Refusé')
    /* **Aucune case sur un projet refusé** : un contrôle grisé dirait « pas maintenant », or
       celui-ci ne pourra jamais retenir ce projet-là. Sa raison est écrite sur la ligne.

       **Le compte, et non l'absence d'une case nommée « Bancal »** : c'est le sabotage qui l'a
       dit. Une case rendue sur la ligne refusée n'aurait *pas* de nom accessible — le libellé
       n'est un `<label>` que sur une ligne retenue —, donc une recherche par nom rendait zéro
       pour la mauvaise raison et restait verte. Trois projets, deux cases. */
    await expect(modale.getByRole('checkbox')).toHaveCount(2)
    await expect(modale.getByRole('checkbox', { name: 'Quai Sud' })).toBeVisible()
    await expect(modale.getByRole('checkbox', { name: 'Atelier Nord' })).toBeVisible()
    await expect(modale).toContainText('au moins un environnement')
    // Deux projets retenus sur les trois du fichier : le refusé ne compte pas.
    await expect(modale.getByRole('button', { name: 'Importer 2 projets' })).toBeVisible()
  })

  test('ce qui ne sera pas versé est dit, avec sa liste en infobulle', async ({ page }) => {
    const modale = page.getByRole('dialog', { name: 'Importer des projets' })

    await expect(modale).toContainText('déjà déclarées ici')
    await expect(modale).toContainText('le texte local est gardé')
    await expect(modale).toContainText('attendent leur mot de passe')
    await expect(modale.getByText(/déjà déclarées ici/)).toHaveAttribute(
      'title',
      'analytics (prod)',
    )
  })

  test('décocher un projet change le compte du bouton', async ({ page }) => {
    const modale = page.getByRole('dialog', { name: 'Importer des projets' })
    await modale.getByRole('checkbox', { name: 'Quai Sud' }).click()

    await expect(modale.getByRole('button', { name: 'Importer 1 projet' })).toBeVisible()
  })

  test('la modale tient dans la fenêtre, et la liste défile sans pousser le pied', async ({
    page,
  }) => {
    const { fenetre } = await mesurerLaCoquille(page, 'Importer des projets')

    // Le **pied** est ce que le défaut du 1er septembre rendait inatteignable : ce n'est pas la
    // modale qui grandit sans fin, c'est son corps qui défile.
    const pied = page.getByTestId('modal-footer')
    const boite = await pied.boundingBox()
    if (!boite) throw new Error('le pied doit être mesurable')
    expect(boite.y + boite.height).toBeLessThanOrEqual(fenetre.height)
    /* **Cherché dans la modale, non dans la page** : depuis que la bande de l'arbre porte
       « Importer des projets… », un `/^Importer/` non ancré désigne deux boutons — celui qui ouvre
       et celui qui applique — et Playwright refuse alors de conclure. C'est la règle du nom
       accessible ancré (`/orders/` compte aussi `orders_by_day`), par le bout où c'est le *décor*
       qui a changé sous un motif resté juste. */
    await expect(
      page.getByRole('dialog', { name: 'Importer des projets' }).getByRole('button', {
        name: /^Importer \d/,
      }),
    ).toBeVisible()

    /* **La liste a son propre conteneur de défilement**, et c'est la garde qui compte : un fichier
       de trente projets ferait sinon un corps de plusieurs milliers de pixels. La mesure porte sur
       la valeur *calculée* et non sur le rectangle, qui ne dirait rien de la capacité à défiler. */
    const liste = page.getByRole('checkbox', { name: 'Quai Sud' }).locator('xpath=../..')
    const defilement = await liste.evaluate((el) => ({
      overflow: getComputedStyle(el).overflowY,
      plafond: getComputedStyle(el).maxHeight,
    }))
    expect(defilement.overflow).toBe('auto')
    expect(defilement.plafond).not.toBe('none')
  })
})

/** La coquille tient dans la fenêtre, et rien de son sous-arbre ne franchit ses bords. */
async function mesurerLaCoquille(
  page: import('@playwright/test').Page,
  titre: string,
): Promise<{ fenetre: { width: number; height: number } }> {
  const coquille = page.getByRole('dialog', { name: titre })
  const boite = await coquille.boundingBox()
  const fenetre = page.viewportSize()
  if (!boite || !fenetre) throw new Error('la modale doit être mesurable')

  expect(boite.y).toBeGreaterThanOrEqual(0)
  expect(boite.x + boite.width).toBeLessThanOrEqual(fenetre.width)
  expect(boite.y + boite.height).toBeLessThanOrEqual(fenetre.height)

  await attendreQueRienNeDeborde(page, titre)
  return { fenetre }
}

/**
 * Aucun descendant de la modale ne franchit ses bords horizontaux.
 *
 * Un chemin de fichier est long — c'est ce que `overflow-wrap: anywhere` traite —, et une liste de
 * connexions dans une infobulle ne doit pas élargir la carte qui la porte.
 */
async function attendreQueRienNeDeborde(
  page: import('@playwright/test').Page,
  titre: string,
): Promise<void> {
  const debordements = await page
    .getByRole('dialog', { name: titre })
    .evaluate((racine: HTMLElement) => {
      const cadre = racine.getBoundingClientRect()
      return [...racine.querySelectorAll<HTMLElement>('*')]
        .filter((element) => {
          const boite = element.getBoundingClientRect()
          // 1 px de tolérance : bordures et arrondis de sous-pixel ne sont pas un débordement.
          return boite.width > 0 && (boite.right > cadre.right + 1 || boite.left < cadre.left - 1)
        })
        .map((element) => element.className)
    })
  expect(debordements).toEqual([])
}
