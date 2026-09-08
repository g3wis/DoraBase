import { expect, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

/**
 * Le gestionnaire de schémas (`API-33`).
 *
 * # Ce que ce niveau garde, et qu'aucun autre ne peut garder
 *
 * `SchemaManager.test.tsx` mesure les gestes, `Workbench.test.tsx` l'assemblage. Trois faits leur
 * échappent aux deux, parce que jsdom ne calcule aucune mise en page (règle n° 9) :
 *
 * 1. **que la modale tienne dans la fenêtre** — c'est le défaut du 1er septembre 2026, où le pied
 *    d'`A2` sortait par le bas et « Enregistrer » devenait inatteignable ; celle-ci porte deux
 *    tableaux et une bande de création, donc elle est du même gabarit ;
 * 2. **que rien ne franchisse le bord droit** : les quatre colonnes du tableau ont des largeurs
 *    déclarées, et une somme trop grande déborderait de 820 px sans que le DOM le dise ;
 * 3. **que la section système défile avec le corps** plutôt que de pousser le pied hors de vue.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  // **Sans déplier la ligne de la base** : le menu d'une connexion est atteignable dès que son
  // environnement est déplié, et c'est le chemin qui arrive sur une connexion fermée.
  await page.getByRole('treeitem', { name: /analytics/ }).hover()
  await page.getByRole('button', { name: 'Actions de analytics' }).click()
  await page.getByRole('button', { name: 'Gérer les schémas…' }).click()
  await page.getByRole('switch', { name: /Afficher public/ }).waitFor()
  await page.evaluate(() => document.fonts.ready)
})

test('la modale liste les schémas et annonce son cadre', async ({ page }) => {
  const modale = page.getByRole('dialog', { name: 'Gérer les schémas' })
  await expect(modale).toBeVisible()

  // Le triplet est dans la bande d'en-tête, pas dans le corps : c'est le cadre de cet écran.
  await expect(modale).toContainText('analytics')

  // Le pied dit l'état, et il est **visible** : c'est là que le défaut du 1er septembre mordait.
  const pied = page.getByTestId('modal-footer')
  await expect(pied).toBeVisible()
  await expect(pied).toContainText('affiché')
})

test('la modale tient dans la fenêtre, et rien ne franchit ses bords', async ({ page }) => {
  const coquille = page.getByRole('dialog', { name: 'Gérer les schémas' })
  const boite = await coquille.boundingBox()
  const fenetre = page.viewportSize()
  if (!boite || !fenetre) throw new Error('la modale doit être mesurable')

  /* **La valeur calculée pour la largeur, le rectangle pour la place occupée** (règle n° 9) : le
     rectangle inclut les deux bordures de 1 px, donc mesure 822 — un test écrit sur 820 y échoue
     pour une raison qui n'est pas celle qu'il croit mesurer. */
  const largeur = await coquille.evaluate((el) => getComputedStyle(el).width)
  expect(largeur).toBe('820px')
  expect(boite.y).toBeGreaterThanOrEqual(0)
  expect(boite.x + boite.width).toBeLessThanOrEqual(fenetre.width)
  expect(boite.y + boite.height).toBeLessThanOrEqual(fenetre.height)

  // Aucun descendant ne dépasse la coquille — la somme des largeurs de colonnes comprise.
  const debordements = await coquille.evaluate((racine) => {
    const cadre = racine.getBoundingClientRect()
    return [...racine.querySelectorAll<HTMLElement>('*')]
      .filter((element) => {
        const boite = element.getBoundingClientRect()
        // 1 px de tolérance : les bordures et les arrondis de sous-pixel ne sont pas un débordement.
        return boite.width > 0 && (boite.right > cadre.right + 1 || boite.left < cadre.left - 1)
      })
      .map((element) => element.className)
  })
  expect(debordements).toEqual([])
})

test('déplier les schémas système ne pousse pas le pied hors de vue', async ({ page }) => {
  const pied = page.getByTestId('modal-footer')
  const avant = await pied.boundingBox()

  await page.getByRole('button', { name: /Schémas système/ }).click()
  // La mesure **après** l'attente qui prouve l'effet (règle n° 15) : une lecture sèche daterait du
  // rendu précédent.
  await page.getByRole('table', { name: 'Schémas système' }).waitFor()

  const apres = await pied.boundingBox()
  const fenetre = page.viewportSize()
  if (!avant || !apres || !fenetre) throw new Error('le pied doit être mesurable')

  // C'est le **corps** qui défile, pas la modale qui grandit sans fin : le pied reste dans la
  // fenêtre. Sans le plafond de hauteur de `Modal`, « Enregistrer » sortait par le bas.
  expect(apres.y + apres.height).toBeLessThanOrEqual(fenetre.height)
  await expect(page.getByRole('button', { name: /Enregistrer/ })).toBeVisible()
})
