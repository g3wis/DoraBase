import { expect, type Page, test } from '@playwright/test'

/**
 * **L'icône d'un dossier, depuis `/`** (#171), et le panneau qui s'ouvre sous elle.
 *
 * Ce que les tests unitaires ne peuvent pas dire : que l'assemblage `App` → `set_folder_icon` est
 * branché, que la ligne de l'arbre redessine l'icône que le cœur a renvoyée, et qu'elle est **encore
 * là après une relance**. Le cœur est simulé au plus près de son contrat, et il **range son arbre dans
 * `localStorage`** : recharger la page rejoue `load_config` sur ce qu'il a écrit, ce qui est à l'écran
 * ce qu'une relance est à l'application. Ce que le disque garde, lui, est gardé par le test Rust
 * `une_icone_inconnue_ou_mal_formee_se_relit_et_se_garde`.
 */
async function simulerLeCoeur(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Dossier = {
      id: string
      name: string
      readOnly: boolean
      color?: string | null
      icon?: string | null
    }
    const CLE = 'coeur-simule-171'
    const lu = window.localStorage.getItem(CLE)
    const arbre: { folders: Dossier[]; connections: unknown[] } = lu
      ? JSON.parse(lu)
      : {
          folders: [
            { id: 'f000000000000001', name: 'Atelier', readOnly: false },
            // Un nom qu'aucune version ne connaît : il doit se dessiner en `pin`, sans erreur.
            { id: 'f000000000000002', name: 'Futur', readOnly: false, icon: 'une-icone-de-demain' },
          ],
          connections: [],
        }
    const ecrire = () => window.localStorage.setItem(CLE, JSON.stringify(arbre))
    const trouver = (id: unknown) => {
      const dossier = arbre.folders.find((d) => d.id === id)
      if (!dossier) throw new Error('dossier introuvable')
      return dossier
    }
    const copie = () => JSON.parse(JSON.stringify(arbre))
    const repondre: Record<string, (args: { request?: Record<string, unknown> }) => unknown> = {
      load_config: () => ({
        kind: 'loaded',
        tree: copie(),
        preferences: {
          theme: 'cahier',
          language: 'fr',
          accent: 'terracotta',
          rowHeight: 26,
          codeFontTenths: 125,
          guards: {
            pendingBeforeWrite: true,
            refuseUnrestrictedWrites: true,
            keepInversePatch: true,
          },
        },
        instances: [],
        kubeconfigs: { declarations: [], default: null },
      }),
      connection_states: () => [],
      recolor_folder: ({ request }) => {
        trouver(request?.folder).color = (request?.color as string | null) ?? null
        ecrire()
        return copie()
      },
      // Comme le cœur : `null` retire la clé, il n'écrit pas « pin ».
      set_folder_icon: ({ request }) => {
        const dossier = trouver(request?.folder)
        if (request?.icon == null) delete dossier.icon
        else dossier.icon = request.icon as string
        ecrire()
        return copie()
      },
    }
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: (commande: string, args: { request?: Record<string, unknown> }) => {
          const reponse = repondre[commande]
          if (!reponse) return Promise.reject(new Error(`hors webview : ${commande}`))
          try {
            return Promise.resolve(reponse(args ?? {}))
          } catch (cause) {
            return Promise.reject(cause)
          }
        },
        transformCallback: (f: unknown) => f,
      },
      configurable: true,
    })
  })
}

const ligne = (page: Page, nom: string) =>
  page.getByRole('treeitem', { name: new RegExp(`^${nom}\\b`) })

/** L'icône d'une ligne de dossier, devenue contrôle. */
const iconeDe = (page: Page, nom: string) =>
  page.getByRole('button', { name: `Changer la couleur et l’icône de « ${nom} »` })

/** Le glyphe du dossier — dessiné par le contrôle posé sur sa ligne. */
const glypheDe = (page: Page, nom: string) =>
  iconeDe(page, nom).evaluate((el) =>
    [...el.querySelectorAll('use')].map((use) => use.getAttribute('href')),
  )

const panneauDe = (page: Page, nom: string) =>
  page.getByRole('dialog', { name: `Couleur et icône de ${nom}` })

async function boite(locator: ReturnType<Page['locator']>) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('boîte introuvable')
  return b
}

test('une icône choisie sous l’icône du dossier se voit sur sa ligne, et survit à la relance', async ({
  page,
}) => {
  await simulerLeCoeur(page)
  await page.goto('/')
  await expect(ligne(page, 'Atelier')).toBeVisible()

  // Contrôle positif du décor, et le repli : sans icône, et avec un nom inconnu, c'est `pin`.
  expect(await glypheDe(page, 'Atelier')).toEqual(['#i-pin'])
  expect(await glypheDe(page, 'Futur')).toEqual(['#i-pin'])

  await iconeDe(page, 'Atelier').click()
  const panneau = panneauDe(page, 'Atelier')
  // Un clic sur le `<label>` coche sa case masquée : c'est le geste de la souris.
  await panneau.getByRole('group', { name: 'Icône de Atelier' }).getByTitle('Fusée').click()
  await expect(panneau.getByRole('radio', { name: 'Fusée' })).toBeChecked()
  await expect.poll(() => glypheDe(page, 'Atelier')).toEqual(['#i-rocket'])
  // Le panneau reste ouvert après un choix, et `Échap` le referme.
  await expect(panneau).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panneau).toBeHidden()

  await page.reload()
  await expect(ligne(page, 'Atelier')).toBeVisible()
  expect(await glypheDe(page, 'Atelier')).toEqual(['#i-rocket'])
  expect(await glypheDe(page, 'Futur')).toEqual(['#i-pin'])
})

test('le panneau s’ouvre juste sous l’icône, compact, visible et dans la fenêtre', async ({
  page,
}) => {
  await simulerLeCoeur(page)
  await page.goto('/')
  // **Par le menu**, le chemin clavier : il doit ouvrir le même panneau, sous la même icône.
  await ligne(page, 'Atelier').hover()
  await page.getByRole('button', { name: 'Actions de Atelier' }).click()
  await page.getByRole('button', { name: 'Couleur et icône…' }).click()
  const panneau = panneauDe(page, 'Atelier')
  await expect(panneau).toBeVisible()
  const grille = panneau.getByRole('group', { name: 'Icône de Atelier' })
  await expect(grille.getByRole('radio')).toHaveCount(56)

  const icone = await boite(iconeDe(page, 'Atelier'))
  const lui = await boite(panneau)
  // **Des égalités** (règle n° 18) : le haut du panneau est à l'écart de `Popover` sous l'icône, et
  // son bord gauche est celui de l'icône. « Plus bas que l'icône » resterait vrai d'un panneau posé
  // n'importe où en dessous, jusqu'au bas de la fenêtre.
  //
  // **À un demi-pixel près, et pas davantage** : le panneau est posé au pixel entier (`Math.round`),
  // quand l'icône peut tomber sur une demi-coordonnée — l'écart toléré est celui de l'arrondi, ce qui
  // reste une égalité. Et le panneau, lui, est **entier**, ce que dit la seconde paire d'assertions.
  expect(Math.abs(lui.y - (icone.y + icone.height + 3))).toBeLessThanOrEqual(0.5)
  expect(Math.abs(lui.x - icone.x)).toBeLessThanOrEqual(0.5)
  expect(Number.isInteger(lui.x)).toBe(true)
  expect(Number.isInteger(lui.y)).toBe(true)

  // **Compact** : huit colonnes de 22 px et sept rangées, 3 px d'écart — et le panneau ne fait que
  // la grille, son rembourrage et son filet.
  const laGrille = await boite(grille)
  expect(laGrille.width).toBe(8 * 22 + 7 * 3)
  expect(laGrille.height).toBe(7 * 22 + 6 * 3)
  expect(lui.width).toBe(laGrille.width + 2 * 9 + 2)

  // Dans la fenêtre, et **réellement sous le pointeur** : un `overflow` d'ancêtre le rognerait sans
  // qu'aucune assertion de visibilité s'en aperçoive (défaut n° 35).
  const fenetre = page.viewportSize()
  if (!fenetre) throw new Error('fenêtre inconnue')
  expect(lui.x + lui.width).toBeLessThanOrEqual(fenetre.width)
  expect(lui.y + lui.height).toBeLessThanOrEqual(fenetre.height)
  const derniere = await boite(grille.locator('label').last())
  const sousLePointeur = await page.evaluate(
    ({ x, y }) =>
      document.elementFromPoint(x, y)?.closest('[role="dialog"]')?.getAttribute('aria-label'),
    { x: derniere.x + derniere.width / 2, y: derniere.y + derniere.height / 2 },
  )
  expect(sousLePointeur).toBe('Couleur et icône de Atelier')
  // Les cases radio masquées n'élargissent pas la page.
  const deborde = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(deborde).toBe(false)
})

test('le contrôle d’icône se pose exactement sur la place de l’icône dans la ligne', async ({
  page,
}) => {
  await simulerLeCoeur(page)
  await page.goto('/')
  await expect(ligne(page, 'Atelier')).toBeVisible()
  const place = await boite(ligne(page, 'Atelier').locator('[data-icon-slot]'))
  const glyphe = await boite(iconeDe(page, 'Atelier').locator('svg'))
  // Le glyphe tombe au pixel sur la case que la ligne garde vide : rien n'a bougé dans la ligne.
  expect(glyphe).toEqual(place)
})

test('presser l’icône et glisser n’arme pas le glisser-déposer de la ligne', async ({ page }) => {
  await simulerLeCoeur(page)
  await page.goto('/')
  const icone = await boite(iconeDe(page, 'Atelier'))
  await page.mouse.move(icone.x + icone.width / 2, icone.y + icone.height / 2)
  await page.mouse.down()
  await page.mouse.move(icone.x + icone.width / 2, icone.y + 40, { steps: 5 })
  // Contrôle du sujet, pendant le geste : aucune ligne n'est saisie.
  await expect(page.locator('[data-glisse]')).toHaveCount(0)
  await page.mouse.up()
  await expect(ligne(page, 'Atelier')).toHaveAttribute('aria-selected', 'false')
})

test('dans une fenêtre courte, le panneau reste entier dans la fenêtre', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 300 })
  await simulerLeCoeur(page)
  await page.goto('/')
  await iconeDe(page, 'Futur').click()
  const lui = await boite(panneauDe(page, 'Futur'))
  expect(lui.y).toBeGreaterThanOrEqual(8)
  expect(lui.y + lui.height).toBeLessThanOrEqual(300 - 8)
})

test('sous une icône près du bas de la fenêtre, le panneau s’ouvre au-dessus d’elle', async ({
  page,
}) => {
  // Seize dossiers : le dernier tombe dans le bas d'une fenêtre de 560 px, où les 217 px du panneau
  // ne tiennent pas dessous. Le cœur simulé relit l'arbre qu'il trouve rangé.
  await page.addInitScript(() => {
    const folders = Array.from({ length: 16 }, (_, i) => ({
      id: `f${String(i + 1).padStart(15, '0')}`,
      name: `Dossier ${String(i + 1).padStart(2, '0')}`,
      readOnly: false,
    }))
    window.localStorage.setItem('coeur-simule-171', JSON.stringify({ folders, connections: [] }))
  })
  await page.setViewportSize({ width: 1100, height: 560 })
  await simulerLeCoeur(page)
  await page.goto('/')
  const dernier = iconeDe(page, 'Dossier 16')
  await dernier.scrollIntoViewIfNeeded()
  await dernier.click()
  const icone = await boite(dernier)
  const lui = await boite(panneauDe(page, 'Dossier 16'))
  // Contrôle du décor : dessous, il n'aurait pas tenu.
  expect(icone.y + icone.height + 3 + lui.height).toBeGreaterThan(560 - 8)
  // Une égalité, comme dessous : le bas du panneau est à l'écart de `Popover` au-dessus de l'icône.
  expect(Math.abs(lui.y + lui.height - (icone.y - 3))).toBeLessThanOrEqual(0.5)
  expect(Math.abs(lui.x - icone.x)).toBeLessThanOrEqual(0.5)
})

test('les pastilles tombent dans les colonnes des icônes, nommées en toutes lettres', async ({
  page,
}) => {
  await simulerLeCoeur(page)
  await page.goto('/')
  await iconeDe(page, 'Atelier').click()
  const panneau = panneauDe(page, 'Atelier')
  const nuancier = panneau.getByRole('radiogroup', { name: 'Couleur de Atelier' })
  const noms = ['Aucune', 'Vert', 'Ambre', 'Rouge', 'Ardoise', 'Violet']
  const cases = panneau.getByRole('group', { name: 'Icône de Atelier' }).locator('label')
  for (const [i, nom] of noms.entries()) {
    const pastille = await boite(nuancier.getByRole('radio', { name: new RegExp(`^${nom}$`) }))
    const colonne = await boite(cases.nth(i))
    // **Une égalité** (règle n° 18) : le centre de la pastille est celui de la colonne d'icônes
    // au-dessous. « À peu près au-dessus » resterait vrai d'un `gap` de 9 px sur les deux premières.
    expect(pastille.x + pastille.width / 2).toBe(colonne.x + colonne.width / 2)
    // Le dessin garde ses 9 px ; c'est la **case** qui se vise, de la largeur d'une colonne.
    expect(pastille.width).toBe(9)
    const laCase = await boite(nuancier.getByTitle(nom, { exact: true }))
    expect(laCase.width).toBe(colonne.width)
    expect(laCase.height).toBe(colonne.height)
  }
})

test('le panneau porte le fond, le rayon et l’ombre des menus', async ({ page }) => {
  await simulerLeCoeur(page)
  await page.goto('/')
  const habillage = (selecteur: string) =>
    page.locator(selecteur).evaluate((el) => {
      const cs = getComputedStyle(el)
      return {
        fond: cs.backgroundColor,
        rayon: cs.borderRadius,
        ombre: cs.boxShadow,
        filet: cs.borderTopColor,
      }
    })
  // Le menu au clic droit de la même ligne : c'est la référence, mesurée et non recopiée.
  await ligne(page, 'Atelier').click({ button: 'right' })
  await expect(page.getByRole('menu')).toBeVisible()
  const menu = await habillage('[role="menu"]')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toBeHidden()

  await iconeDe(page, 'Atelier').click()
  await expect(panneauDe(page, 'Atelier')).toBeVisible()
  expect(await habillage('[role="dialog"]')).toEqual(menu)
  // Contrôle positif : le fond mesuré n'est pas le blanc du champ, qu'il portait avant.
  expect(menu.fond).not.toBe('rgb(255, 255, 255)')
})
