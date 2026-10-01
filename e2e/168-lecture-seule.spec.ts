import { expect, type Page, test } from '@playwright/test'
import { deplierUnEnvironnement, ouvrirUneConsole } from './pourLesTests'

/**
 * La lecture seule héritée d'un dossier, **posée par le geste** (#168).
 *
 * Le décor de `?demo` laisse « Atelier Nord › prod » inscriptible — la démo existe pour montrer
 * l'édition —, donc ces tests posent la lecture seule depuis le menu du dossier : c'est ce qui
 * exerce `set_folder_read_only` au lieu de le supposer, et c'est le chemin que l'utilisateur prend.
 */
async function passerProdEnLectureSeule(page: Page): Promise<void> {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  const ligne = page.getByRole('treeitem', { name: /^prod\b/ }).first()
  await ligne.hover()
  await ligne.locator('xpath=..').getByRole('button', { name: 'Actions de prod' }).click()
  await page.getByRole('button', { name: 'Passer en lecture seule' }).click()
}

test('sous « prod » en lecture seule, ⌘E n’ouvre pas l’édition, et la raison se lit', async ({
  page,
}) => {
  await passerProdEnLectureSeule(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await page.getByRole('treeitem', { name: /^orders 1\.9/ }).click()
  await page.waitForSelector('[role=grid]')

  await page.keyboard.press('ControlOrMeta+e')
  // Aucune cellule ne s'est ouverte à l'édition…
  await expect(page.getByRole('button', { name: 'Modifier status' })).toHaveCount(0)
  // … et la barre d'état dit **pourquoi**, au lieu d'inviter à un ⌘E qui ne répond pas.
  const statut = page.getByRole('status', { name: 'État de la table' })
  await expect(statut).toContainText('lecture seule — imposée par le dossier « prod »')
  // La bascule est figée, et son infobulle nomme où lever la lecture seule — atteignable au survol,
  // parce qu'elle est en `aria-disabled` et non `disabled` (piège n° 3).
  const bascule = page.getByRole('switch', { name: 'Verrouiller la table' })
  await expect(bascule).toHaveAttribute('aria-disabled', 'true')
  await bascule.hover()
  await expect(page.getByRole('tooltip')).toContainText('levez-la sur ce dossier')
})

test('sous « prod » en lecture seule, un `delete` est refusé sans ouvrir la modale', async ({
  page,
}) => {
  await passerProdEnLectureSeule(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await ouvrirUneConsole(page, 'analytics')
  await page.waitForSelector('.cm-content')
  await page.locator('.cm-content').click()
  await page.keyboard.insertText('delete from orders')
  await page.getByRole('button', { name: /Exécuter/ }).click()

  await expect(page.getByText(/DELETE refusé avant l’envoi/)).toBeVisible()
  // **Aucune modale** : demander confirmation d'un geste qui ne peut pas aboutir n'aurait pas de sens.
  await expect(page.getByRole('dialog', { name: 'Écrire dans la base' })).toHaveCount(0)
})

test('lever la lecture seule du dossier rend l’édition', async ({ page }) => {
  // Le contrôle positif des deux précédents : sans lui, un écran qui refuserait toujours passerait.
  await passerProdEnLectureSeule(page)
  const ligne = page.getByRole('treeitem', { name: /^prod\b/ }).first()
  await ligne.hover()
  await ligne.locator('xpath=..').getByRole('button', { name: 'Actions de prod' }).click()
  await page.getByRole('button', { name: 'Lever la lecture seule' }).click()

  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await page.getByRole('treeitem', { name: /^orders 1\.9/ }).click()
  await page.waitForSelector('[role=grid]')
  await page.keyboard.press('ControlOrMeta+e')
  await expect(page.getByRole('button', { name: 'Modifier status' }).first()).toBeVisible()
})
