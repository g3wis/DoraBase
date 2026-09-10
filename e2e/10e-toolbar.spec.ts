import { expect, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

// Hauteurs, alignement des chips et débordement du panneau SQL : de la mise en page, donc hors
// de portée de Vitest. `10e` les nomme.
test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await page.getByRole('treeitem', { name: /^orders 1\.9/ }).click()
  await page.waitForSelector('[role=grid]')
  await page.evaluate(() => document.fonts.ready)
})

test('la toolbar fait 36 px et ses contrôles 25', async ({ page }) => {
  const mesures = await page.evaluate(() => {
    // La barre **de la table** : « Rafraîchir » existe aussi dans le pied de la sidebar.
    const barre = document.querySelector('[role=toolbar][aria-label="Outils de la table"]')
    const rafraichir = barre?.querySelector('[aria-label="Rafraîchir"]')
    if (!barre || !rafraichir) return null
    return {
      barre: getComputedStyle(barre).height,
      bouton: Math.round(rafraichir.getBoundingClientRect().height),
    }
  })
  expect(mesures?.barre).toBe('36px')
  // 25 px déclarés + 2 de bordure : `--h-btn-sm` est une hauteur de contenu, comme partout
  // ailleurs dans ce projet.
  expect(mesures?.bouton).toBe(27)
})

test('le panneau SQL s’ouvre sans sortir de la fenêtre', async ({ page }) => {
  await page.getByRole('button', { name: /Voir le SQL/ }).click()
  const panneau = page.getByRole('dialog', { name: 'SQL exécuté' })
  await expect(panneau).toContainText('select * from public.orders limit 500')

  const boite = await panneau.boundingBox()
  const largeur = await page.evaluate(() => window.innerWidth)
  expect(boite?.x).toBeGreaterThanOrEqual(0)
  expect((boite?.x ?? 0) + (boite?.width ?? 0)).toBeLessThanOrEqual(largeur)
})

test('masquer une colonne la retire de la grille', async ({ page }) => {
  // L'en-tête de nom, pas la cellule de filtre — les deux sont des `columnheader`.
  const entete = page.getByRole('button', { name: 'Trier par currency' })
  await expect(entete).toBeVisible()

  await page.getByRole('button', { name: 'Colonnes affichées' }).click()
  await page.getByRole('dialog', { name: 'Colonnes affichées' }).getByText('currency').click()

  await expect(page.getByRole('button', { name: 'Trier par currency' })).toHaveCount(0)
  // 8 sur 9 : le décor de démo porte une neuvième colonne depuis `10f`, dont la valeur ne tient pas
  // dans le panneau de ligne — c'est ce qui rend l'ellipse et l'aperçu mesurables. Un compte en dur
  // dans un test est un lien vers le décor, et il faut le suivre quand le décor change.
  await expect(page.getByRole('button', { name: 'Colonnes affichées' })).toContainText('8/9')
})

test('un filtre actif produit un chip d’accent, distinct du chip de tri', async ({ page }) => {
  await page.getByLabel('Filtrer status').fill('paid')
  await page.getByLabel('Filtrer status').press('Enter')
  await page.getByRole('button', { name: 'Trier par created_at' }).click()

  const filtre = page.getByText('status = paid')
  const tri = page.getByText('created_at asc')
  await expect(filtre).toBeVisible()
  await expect(tri).toBeVisible()

  const fondFiltre = await filtre.evaluate((e) => getComputedStyle(e).backgroundColor)
  const fondTri = await tri.evaluate((e) => getComputedStyle(e).backgroundColor)
  expect(fondFiltre).not.toBe(fondTri)
})

test.describe('beaucoup de filtres', () => {
  const COLONNES = ['status', 'currency', 'coupon_code', 'external_ref', 'user_id']

  async function poserCinqFiltres(page: import('@playwright/test').Page) {
    for (const colonne of COLONNES) {
      await page.getByLabel(`Filtrer ${colonne}`).fill('x')
      await page.getByLabel(`Filtrer ${colonne}`).press('Enter')
    }
    // Rule 13 : la mesure ne vaut qu'après le rendu des cinq chips, pas après la dernière frappe.
    await expect(page.getByRole('button', { name: /^Retirer le filtre/ })).toHaveCount(
      COLONNES.length,
    )
  }

  const bande = (page: import('@playwright/test').Page) =>
    page.locator('[role=toolbar][aria-label="Outils de la table"] > [class*=chips]')

  test('les chips défilent dans leur zone au lieu de pousser les contrôles dehors', async ({
    page,
  }) => {
    await poserCinqFiltres(page)

    const mesures = await page.evaluate(() => {
      const barre = document.querySelector('[role=toolbar][aria-label="Outils de la table"]')
      const zone = barre?.querySelector('[class*=chips]')
      const sql = [...(barre?.querySelectorAll('button') ?? [])].find((b) =>
        b.textContent?.includes('Voir le SQL'),
      )
      if (!barre || !zone || !sql) return null
      const cadre = barre.getBoundingClientRect()
      const boite = sql.getBoundingClientRect()
      return {
        deborde: zone.scrollWidth > zone.clientWidth,
        // Le bouton reste **dans** la barre, sur une seule ligne : c'est le repli du libellé sur
        // trois lignes qui était le symptôme visible du débordement.
        hauteurSql: Math.round(boite.height),
        droite: Math.round(boite.right),
        droiteBarre: Math.round(cadre.right),
        basSql: Math.round(boite.bottom),
        basBarre: Math.round(cadre.bottom),
      }
    })

    expect(mesures?.deborde).toBe(true)
    expect(mesures?.hauteurSql).toBe(27)
    expect(mesures?.droite).toBeLessThanOrEqual(mesures?.droiteBarre ?? 0)
    expect(mesures?.basSql).toBeLessThanOrEqual(mesures?.basBarre ?? 0)
  })

  test('le geste vertical défile la zone horizontalement', async ({ page }) => {
    await poserCinqFiltres(page)
    await bande(page).hover()
    await page.mouse.wheel(0, 300)

    // Une lecture sèche daterait la mesure d'avant le défilement (règle 13).
    await expect.poll(() => bande(page).evaluate((e) => e.scrollLeft)).toBeGreaterThan(0)

    // Et la barre elle-même ne défile pas : c'est la zone qui a pris le geste.
    const defilementBarre = await page
      .locator('[role=toolbar][aria-label="Outils de la table"]')
      .evaluate((e) => e.scrollLeft)
    expect(defilementBarre).toBe(0)
  })
})

// L'animation du bouton « Rafraîchir », mesurée dans la galerie : la démo répond
// instantanément, donc l'état d'attente n'y est jamais observable, et jsdom ne calcule aucune
// animation. C'est le seul endroit où cette garantie tient.
test.describe('l’attente du rafraîchissement', () => {
  const animation = (page: import('@playwright/test').Page, testid: string) =>
    page.evaluate((id) => {
      const bouton = document
        .querySelector(`[data-testid=${id}]`)
        ?.querySelector('button[aria-label=Rafraîchir]')
      const icone = bouton?.querySelector('svg')
      if (!bouton || !icone) return null
      const style = getComputedStyle(icone)
      return {
        nom: style.animationName,
        duree: style.animationDuration,
        inerte: (bouton as HTMLButtonElement).disabled,
        occupe: bouton.getAttribute('aria-busy'),
      }
    }, testid)

  test('le bouton tourne et devient inerte pendant la relecture', async ({ page }) => {
    await page.goto('/?gallery')
    await page.waitForSelector('[data-testid=toolbar-en-cours]')

    const enCours = await animation(page, 'toolbar-en-cours')
    expect(enCours?.nom).not.toBe('none')
    expect(enCours?.duree).toBe('0.9s')
    // **Les deux vont ensemble** : un bouton qui tourne mais reste cliquable lance trois relectures
    // dont deux pour rien.
    expect(enCours?.inerte).toBe(true)
    expect(enCours?.occupe).toBe('true')

    // Au repos, rien ne tourne — sans quoi la mesure ci-dessus ne dirait rien.
    const repos = await animation(page, 'toolbar-repos')
    expect(repos?.nom).toBe('none')
    expect(repos?.inerte).toBe(false)
  })

  test('sous prefers-reduced-motion, le mouvement part et l’information reste', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/?gallery')
    await page.waitForSelector('[data-testid=toolbar-en-cours]')

    const enCours = await animation(page, 'toolbar-en-cours')
    // Ignorer ce réglage est un défaut d'accessibilité, pas un choix esthétique.
    expect(enCours?.nom).toBe('none')
    // L'état demeure lisible sans elle : c'est ce qui rend le retrait acceptable.
    expect(enCours?.inerte).toBe(true)
    expect(enCours?.occupe).toBe('true')
  })
})

/**
 * La bascule du mode édition, **dans l'écran assemblé**.
 *
 * Le composant est déjà vérifié en pur, et la galerie le montre : ni l'un ni l'autre ne dit que le
 * bouton est branché à l'onglet, qui est le seul endroit où le mode existe (règle n° 8 — un
 * composant juste dans sa vitrine ne prouve rien de l'assemblage). Ce test part donc de l'écran de
 * travail, comme l'utilisateur.
 */
test.describe('mode édition', () => {
  test('la bascule ouvre l’édition, et le clavier ferme celle qu’elle a ouverte', async ({
    page,
  }) => {
    const bascule = page.getByRole('switch', { name: 'Verrouiller la table' })
    // Coché vaut **verrouillé** : au repos la table est en lecture seule.
    await expect(bascule).toBeChecked()
    // Rien n'est éditable tant que rien n'est ouvert : sans ce témoin, la mesure d'après passerait
    // sur un écran qui aurait toujours été en édition.
    await expect(page.getByRole('button', { name: 'Modifier status' })).toHaveCount(0)

    await bascule.click()
    await expect(bascule).not.toBeChecked()
    // C'est **ceci** que la galerie ne peut pas montrer : la grille de l'onglet a suivi le bouton.
    await expect(page.getByRole('button', { name: 'Modifier status' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ajouter une ligne' })).toBeVisible()

    // **Un seul état, deux commandes.** Le raccourci doit fermer ce que le bouton a ouvert — deux
    // mécaniques parallèles laisseraient l'une des deux en arrière (règle n° 17), et la première
    // divergence se lirait comme un bouton qui ne répond plus.
    // `Meta+e`, la syntaxe de Playwright et non celle de `userEvent` — c'est déjà celle des trois
    // specs de `11a`–`11c`. Ce fichier ne tourne que sous le projet `macos` : le projet `windows`
    // n'exécute que les `*.windows.spec.ts`.
    await page.keyboard.press('Meta+e')
    await expect(bascule).toBeChecked()
    await expect(page.getByRole('button', { name: 'Modifier status' })).toHaveCount(0)
  })

  test('la pastille glisse et l’accent change de verrou', async ({ page }) => {
    const bascule = page.getByRole('switch', { name: 'Verrouiller la table' })

    // La pastille est le premier enfant, les deux cellules suivent — gauche « ouvert », droite
    // « fermé ». On mesure la **position rendue** et non la déclaration : `transform` se lit en
    // matrice, et c'est l'abscisse de la boîte qui dit où la pastille est vraiment tombée.
    const lire = () =>
      bascule.evaluate((e) => {
        const [pastille, gauche, droite] = [...e.children] as [
          HTMLElement,
          HTMLElement,
          HTMLElement,
        ]
        const boite = (n: HTMLElement) => Math.round(n.getBoundingClientRect().x)
        return {
          pastille: boite(pastille),
          gauche: { x: boite(gauche), encre: getComputedStyle(gauche).color },
          droite: { x: boite(droite), encre: getComputedStyle(droite).color },
        }
      })

    const verrouille = await lire()
    // Verrouillé, la pastille est **sur la cellule de droite**, celle du cadenas fermé, et c'est
    // ce verrou-là qui porte l'accent. Comparer les deux cellules entre elles suffit ici, à la
    // différence d'un décor où elles se ressembleraient : l'une est accentuée, l'autre non, et
    // c'est précisément la propriété demandée.
    expect(verrouille.pastille).toBe(verrouille.droite.x)
    expect(verrouille.droite.encre).not.toBe(verrouille.gauche.encre)

    await bascule.click()
    // La transition dure 140 ms : on attend la position, on ne la lit pas sèchement (règle n° 15).
    await expect.poll(async () => (await lire()).pastille).toBe((await lire()).gauche.x)

    const ouvert = await lire()
    // L'accent a changé de côté, et les deux verrous sont restés à leur place — c'est ce qui
    // distingue cette bascule d'un bouton qui échangerait son icône.
    expect(ouvert.gauche.encre).toBe(verrouille.droite.encre)
    expect(ouvert.droite.encre).toBe(verrouille.gauche.encre)
    expect(ouvert.gauche.x).toBe(verrouille.gauche.x)
    expect(ouvert.droite.x).toBe(verrouille.droite.x)
  })

  /**
   * L'infobulle du bouton, **lisible et dans la fenêtre**.
   *
   * Rapporté à l'usage : « l'infobulle est illisible, la fenêtre est trop courte ». Ce n'était pas
   * la fenêtre — une infobulle absolument positionnée se dimensionne contre son bloc conteneur,
   * donc contre le carré de 27 px qui la déclenche : elle rendait 55 px de large et 98 px de haut,
   * un mot par ligne, et ces 98 px la portaient hors de la fenêtre par le haut.
   *
   * Le test garde la **cause** — la largeur ne dépend pas du déclencheur — plutôt que la
   * conséquence, qui variait avec la longueur du libellé. Une hauteur d'une seule ligne le dit
   * mieux qu'un compte de pixels : deux lignes veulent dire que la largeur est retombée.
   */
  test('l’infobulle tient sur une ligne et reste dans la fenêtre', async ({ page }) => {
    await page.getByRole('switch', { name: 'Verrouiller la table' }).hover()
    const info = page.getByRole('tooltip')
    await expect(info).toBeVisible()

    const mesures = await page.evaluate(() => {
      const bulle = document.querySelector('[role=tooltip]') as HTMLElement
      const boite = bulle.getBoundingClientRect()
      const ligne = Number.parseFloat(getComputedStyle(bulle).lineHeight)
      return {
        boite: {
          haut: boite.top,
          bas: boite.bottom,
          gauche: boite.left,
          droite: boite.right,
          hauteur: boite.height,
        },
        ligne,
        fenetre: { w: window.innerWidth, h: window.innerHeight },
        // **Les ancêtres qui rognent, et non `elementFromPoint`.** C'est la mesure que le défaut
        // n° 35 recommande, et elle ne s'applique pas ici : une infobulle porte `pointer-events:
        // none` — délibérément, sans quoi elle disparaîtrait sous le curseur qui l'atteint —, donc
        // `elementFromPoint` rend toujours ce qu'il y a **dessous**. L'assertion était verte pour
        // une raison qui n'avait rien à voir avec la question posée. On énumère donc la chaîne
        // d'ancêtres : le rognage de n° 35 vient d'un `overflow` non visible, et il n'y en a aucun.
        rogneurs: (() => {
          const noms: string[] = []
          let n = bulle.parentElement
          while (n && n !== document.body) {
            const style = getComputedStyle(n)
            const cache =
              style.overflow !== 'visible' ||
              style.overflowX !== 'visible' ||
              style.overflowY !== 'visible'
            if (cache) noms.push(n.className)
            n = n.parentElement
          }
          return noms
        })(),
      }
    })

    // Une seule ligne : la largeur vient du contenu, non du carré de 27 px qui la déclenche.
    expect(mesures.boite.hauteur).toBeLessThan(mesures.ligne * 2)
    // Et les quatre bords sont dans la fenêtre — c'est la moitié « trop courte » du signalement.
    expect(mesures.boite.haut).toBeGreaterThanOrEqual(0)
    expect(mesures.boite.bas).toBeLessThanOrEqual(mesures.fenetre.h)
    expect(mesures.boite.gauche).toBeGreaterThanOrEqual(0)
    expect(mesures.boite.droite).toBeLessThanOrEqual(mesures.fenetre.w)
    expect(mesures.rogneurs).toEqual([])
  })

  /**
   * Le `+` **descend jusqu'à la ligne qu'il pose**, et l'y laisse.
   *
   * Rapporté à l'usage le 8 septembre 2026. Une ligne ajoutée va en **bas** de la grille : sur les
   * cinq cents lignes de la fenêtre, le `+` la posait à douze mille pixels sous le regard et rien ne
   * bougeait à l'écran — un bouton dont l'effet est hors du champ se lit comme un bouton qui ne fait
   * rien, le défaut n° 36 sous une autre forme.
   *
   * **Et ouvrir une de ses cellules ne ramène pas la fenêtre.** Second signalement du même geste,
   * cause différente : l'effet qui suit la ligne *sélectionnée* partait à chaque rendu de `A5` —
   * `rowId` y est une fonction fléchée du JSX, donc une identité neuve à chaque fois — et ramenait
   * la fenêtre sur une sélection qui n'avait pas bougé. Mesuré : de 12 405 px à 26. Les deux tiennent
   * dans le même parcours parce que c'est le même parcours qui les a trouvés.
   */
  test('le + descend au bas de la grille, et y reste quand on remplit la ligne', async ({
    page,
  }) => {
    const position = () =>
      page.evaluate(() => {
        const zone = document.querySelector('[role=grid] > [role=presentation]') as HTMLElement
        return { haut: Math.round(zone.scrollTop), fond: zone.scrollHeight - zone.clientHeight }
      })

    await page.getByRole('switch', { name: 'Verrouiller la table' }).click()
    // Le témoin de départ : sans lui, une grille déjà en bas passerait le test sans rien prouver.
    expect((await position()).haut).toBe(0)

    // **La sélection se prend ici, en haut, et c'est ce qui arme le second défaut.** Prise une fois
    // descendu, elle porterait sur une ligne du bas et il n'y aurait nulle part où revenir : le test
    // resterait vert sous le sabotage du dédoublonnage — mesuré, c'est la première version qu'il en
    // a coûté. **Et on constate qu'elle a bien eu lieu** : `getByRole('row')` compte aussi les deux
    // lignes d'en-tête, dont celle des filtres, et cliquer l'une d'elles ne sélectionne rien — c'est
    // la seconde version qu'il en a coûté, verte pour cette raison-là.
    await page.getByRole('row').nth(2).click()
    await expect(page.locator('[role=row][aria-selected=true]')).toHaveCount(1)

    await page.getByRole('button', { name: 'Ajouter une ligne' }).click()
    await expect.poll(async () => (await position()).haut).toBe((await position()).fond)

    // La ligne ajoutée est la dernière, et sa gouttière porte `+` plutôt qu'un rang.
    const ajoutee = page.getByRole('row').last()
    await expect(ajoutee).toContainText('+1')

    const avant = (await position()).haut
    await ajoutee
      .getByRole('button', { name: /^Renseigner / })
      .first()
      .click()
    await expect(page.locator('[data-saisie]')).toBeVisible()
    expect((await position()).haut).toBe(avant)
  })
})
