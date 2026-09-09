import { expect, test } from '@playwright/test'
import { deplierUnEnvironnement, ouvrirUneConsole } from './pourLesTests'

/**
 * La transaction manuelle d'une console (`API-38`), **dans la mise en page réelle**.
 *
 * Ce que ce fichier mesure et qu'aucun test unitaire ne peut mesurer : jsdom ne calcule aucune mise
 * en page (règle n° 9), donc la place du panneau à droite de la console, la largeur qu'il laisse à
 * l'éditeur et le fait que rien ne franchisse le bord droit ne se vérifient qu'ici. Le reste — ce
 * que le journal contient, ce qu'une validation emporte — appartient aux tests Rust, qui parlent à
 * une vraie base.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await ouvrirUneConsole(page, 'analytics')
  await page.waitForSelector('.cm-content')
  await page.evaluate(() => document.fonts.ready)
})

const panneau = 'aside[aria-label="Transaction en cours"]'

test('en mode automatique, la console occupe toute la largeur du centre', async ({ page }) => {
  // Le point de départ, et la propriété à ne pas perdre : rien ne change pour qui n'a rien réglé.
  await expect(page.locator(panneau)).toHaveCount(0)
})

test('la bascule ouvre le panneau, qui liste ce que la transaction retient', async ({ page }) => {
  await page.getByRole('switch', { name: 'Transaction manuelle' }).click()

  const transaction = page.locator(panneau)
  await expect(transaction).toBeVisible()
  // **Avant la première exécution, le panneau dit ce qui va se passer.** La transaction s'ouvre à
  // l'exécution, et une colonne vide entre les deux ne dirait rien du régime où l'on vient d'entrer.
  await expect(transaction).toContainText('Rien n’est encore retenu')

  await page.locator('.cm-content').click()
  await page.keyboard.insertText('update ventes set statut = 1')
  await page.getByRole('button', { name: /Exécuter/ }).click()
  // **Aucune confirmation à l'exécution** (`API-38`) : la requête n'écrit rien, elle entre dans la
  // transaction. C'est la validation qui porte la question.
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Le journal, relu après l'exécution : le SQL et **la réponse du serveur**, qui est le chiffre
  // qui décide d'une validation.
  await expect(transaction).toContainText('update ventes set statut = 1')
  await expect(transaction).toContainText('2 lignes touchées')

  // Et la bascule est figée le temps de la transaction : en sortir n'est ni une validation ni une
  // annulation, donc le réglage se refuse avec sa raison.
  const bascule = page.getByRole('switch', { name: 'Transaction manuelle' })
  await expect(bascule).toHaveAttribute('aria-disabled', 'true')

  // **Désigner une instruction remet sa réponse dans la grille**, et c'est ce qui distingue ce
  // journal d'une liste de requêtes : la grille du centre ne tient que la dernière réponse.
  await page.locator('.cm-content').click()
  // `Meta+a` comme les cinq autres specs qui pilotent un raccourci : ce projet Playwright ne tourne
  // que sur macOS, les captures de fidélité portant le suffixe de plateforme.
  await page.keyboard.press('Meta+a')
  await page.keyboard.insertText('select jour, commandes, ca_eur from ventes')
  await page.getByRole('button', { name: /Exécuter/ }).click()
  const grille = page.getByRole('grid', { name: /Résultat de la requête/ })
  await expect(grille).toBeVisible()

  // Puis une écriture : la grille ne montre plus la lecture, et l'entrée de l'écriture n'est pas
  // désignable — son compte de lignes touchées est déjà sa réponse.
  //
  // **Le clic sur l'éditeur avant chaque frappe** : « Exécuter » a pris le focus, donc un `Meta+a`
  // envoyé là sélectionnerait la page entière et la frappe suivante n'atteindrait pas le document.
  await page.locator('.cm-content').click()
  await page.keyboard.press('Meta+a')
  await page.keyboard.insertText('delete from ventes where jour < now()')
  await page.getByRole('button', { name: /Exécuter/ }).click()
  await expect(transaction).toContainText('2 lignes touchées')
  // **Une seule des trois est désignable** : l'`update` et le `delete` n'ont rendu aucune ligne, et
  // leur compte de lignes touchées est déjà leur réponse. Le compte le dit mieux qu'une assertion
  // sur la seule lecture : il prouve que les deux autres ne le sont pas.
  const designables = transaction.getByRole('button', { name: /Afficher ce résultat/ })
  await expect(designables).toHaveCount(1)

  // Le geste : la lecture retrouve la grille, sans que rien soit rejoué.
  await designables.first().click()
  await expect(grille.getByRole('columnheader', { name: 'ca_eur' })).toBeVisible()
  await expect(designables.first()).toHaveAttribute('aria-pressed', 'true')

  // **La validation, elle, se confirme** : c'est le moment où l'on s'engage, et la modale
  // récapitule les verbes de ce qui devient définitif.
  await transaction.getByRole('button', { name: 'Valider' }).click()
  const validation = page.getByRole('dialog')
  await expect(validation).toContainText('UPDATE, DELETE')
  await validation.getByRole('button', { name: /Valider 2 écritures/ }).click()

  await expect(transaction).toContainText('Rien n’est encore retenu')
  // La bascule répond de nouveau : la transaction est achevée.
  await expect(bascule).not.toHaveAttribute('aria-disabled', 'true')
})

test('le panneau tient dans la fenêtre, et laisse sa place à l’éditeur', async ({ page }) => {
  await page.getByRole('switch', { name: 'Transaction manuelle' }).click()
  await expect(page.locator(panneau)).toBeVisible()

  // Une instruction au SQL long : c'est le contenu le plus large du panneau, et celui qui
  // déborderait — il se replie (`pre-wrap`), il ne pousse pas.
  await page.locator('.cm-content').click()
  await page.keyboard.insertText(
    'select jour, commandes, ca_eur from ventes where canal_de_vente = 8 order by jour',
  )
  await page.getByRole('button', { name: /Exécuter/ }).click()
  await expect(page.locator(panneau)).toContainText('lignes rendues')

  const cotes = await page.evaluate(() => {
    const droite = document.querySelector('aside[aria-label="Transaction en cours"]')
    const editeur = document.querySelector('.cm-editor')
    const sql = droite?.querySelector('pre')
    if (!droite || !editeur || !sql) return null
    return {
      panneau: droite.getBoundingClientRect(),
      editeur: editeur.getBoundingClientRect(),
      // Le bloc de SQL de l'instruction : ce qu'il **montre**, et ce qu'il contient.
      sqlVisible: sql.clientWidth,
      sqlContenu: sql.scrollWidth,
      sqlDroite: sql.getBoundingClientRect().right,
      fenetre: document.documentElement.clientWidth,
      defilementHorizontal: document.documentElement.scrollWidth,
    }
  })
  if (cotes === null) throw new Error('panneau, éditeur ou bloc de SQL introuvable')

  // **Rien ne franchit le bord droit, et la racine ne défile pas** : les deux ensemble, comme dans
  // `geometrie-reelle` — un enfant coupé par un ancêtre en `overflow: hidden` échapperait à la
  // première mesure.
  expect(cotes.panneau.right).toBeLessThanOrEqual(cotes.fenetre + 1)
  expect(cotes.defilementHorizontal).toBeLessThanOrEqual(cotes.fenetre)
  // Le panneau est **à droite** du centre, et il fait la largeur qu'on lui a donnée, à la poignée
  // près.
  expect(cotes.panneau.left).toBeGreaterThan(cotes.editeur.right - 1)
  expect(cotes.panneau.width).toBeGreaterThan(250)
  // **C'est le panneau qui est dimensionné, pas le centre**, et c'est la seule assertion qui le
  // dise : le défaut de `10b` — `sized` posé sur le mauvais côté — donnait 330 px au centre et tout
  // le reste au panneau, ce qu'une comparaison à un seuil fixe aurait laissé passer (règle n° 18).
  expect(cotes.panneau.width).toBeLessThan(cotes.editeur.width)
  expect(cotes.editeur.width).toBeGreaterThan(300)
  // **Le SQL d'une instruction se replie, il ne déborde pas.** Une requête d'une seule ligne de
  // quatre-vingts caractères tient donc dans le panneau, sans défilement horizontal nulle part :
  // c'est ce que `pre-wrap` et `overflow-wrap: anywhere` promettent, et le seul endroit où cela se
  // vérifie.
  expect(cotes.sqlContenu).toBeLessThanOrEqual(cotes.sqlVisible + 1)
  expect(cotes.sqlDroite).toBeLessThanOrEqual(cotes.panneau.right + 1)
})

test('le panneau suit la console, non sa connexion', async ({ page }) => {
  await page.getByRole('switch', { name: 'Transaction manuelle' }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.insertText('select jour from ventes')
  await page.getByRole('button', { name: /Exécuter/ }).click()
  await expect(page.locator(panneau)).toContainText('lignes rendues')

  // **Une seconde console sur la même connexion** : elle part en automatique, et le panneau de la
  // première ne la suit pas. Le régime est réglé sur un onglet, comme son texte et son résultat.
  await ouvrirUneConsole(page, 'analytics')
  await expect(page.locator(panneau)).toHaveCount(0)
  await expect(page.getByRole('switch', { name: 'Transaction manuelle' })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  // Et elle dit que ses requêtes entreront dans la transaction ouverte à côté : une seule session
  // par connexion, et le taire serait laisser croire à une écriture validée.
  await expect(page.getByText(/Une transaction est ouverte sur cette connexion/)).toBeVisible()

  // Ce qu'elle exécute entre bel et bien dans cette transaction — c'est une seule session.
  await page.locator('.cm-content').click()
  await page.keyboard.insertText('select ca_eur from ventes')
  await page.getByRole('button', { name: /Exécuter/ }).click()
  await expect(page.getByRole('grid', { name: /Résultat de la requête/ })).toBeVisible()

  // Revenir la retrouve, avec ce qu'elle retenait — **et rien de plus**. Une console montre ce
  // qu'elle a fait : la requête d'une voisine s'y lirait comme la sienne. Ce qui se dit à sa place
  // est le compte, sans quoi ce panneau d'une instruction se lirait comme la transaction entière
  // devant un « Valider » qui en emporte deux.
  await page.getByRole('tab', { name: /console 1/ }).click()
  const retrouve = page.locator(panneau)
  await expect(retrouve).toContainText('lignes rendues')
  await expect(retrouve).toContainText('1 instruction d’une autre console')
  await expect(retrouve.getByRole('listitem')).toHaveCount(1)
  await expect(retrouve).not.toContainText('ca_eur')
})

test('les deux sortes de carte ont le même rythme', async ({ page }) => {
  await page.getByRole('switch', { name: 'Transaction manuelle' }).click()
  // Une écriture — carte non désignable — puis une lecture, qui l'est : les deux formes côte à côte.
  await page.locator('.cm-content').click()
  await page.keyboard.insertText('update ventes set statut = 1')
  await page.getByRole('button', { name: /Exécuter/ }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('Meta+a')
  await page.keyboard.insertText('select jour from ventes')
  await page.getByRole('button', { name: /Exécuter/ }).click()
  await expect(page.locator(panneau)).toContainText('lignes rendues')

  const cotes = await page.evaluate(() =>
    [...document.querySelectorAll('aside[aria-label="Transaction en cours"] li')].map((carte) => {
      const boite = carte.getBoundingClientRect()
      const rang = carte.querySelector('span')?.getBoundingClientRect()
      const sql = carte.querySelector('pre')?.getBoundingClientRect()
      if (!rang || !sql) return null
      return {
        haut: Math.round(rang.top - boite.top),
        entreLesDeux: Math.round(sql.top - rang.bottom),
        gauche: Math.round(sql.left - boite.left),
        bas: Math.round(boite.bottom - sql.bottom),
      }
    }),
  )

  // **Une carte cliquable et une carte inerte se rembourrent pareil.** Le rembourrage vit sur
  // l'enveloppe du contenu : posé sur les enfants, l'en-tête et le bloc de SQL cumulaient leurs
  // marges dans la carte inerte — quatre pixels de plus entre eux, vus à la capture. Une cote
  // mesurée, et non un ordre de grandeur : c'est la règle n° 18.
  expect(cotes).toHaveLength(2)
  expect(cotes[0]).not.toBeNull()
  expect(cotes[0]).toEqual(cotes[1])
})

test('le libellé de la bascule et les deux boutons tiennent dans leur boîte', async ({ page }) => {
  await page.getByRole('switch', { name: 'Transaction manuelle' }).click()
  await expect(page.locator(panneau)).toBeVisible()

  // La règle n° 10 appliquée à trois libellés : un texte plus long que son bouton ne se voit qu'ici.
  const debordements = await page.evaluate(() => {
    const cibles = [
      ...document.querySelectorAll(
        'aside[aria-label="Transaction en cours"] button, [role=toolbar] span',
      ),
    ]
    return cibles
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => element.textContent)
  })
  expect(debordements).toEqual([])
})
