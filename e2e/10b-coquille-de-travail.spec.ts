import { expect, test } from '@playwright/test'
import { deplierUnEnvironnement, ouvrirUneConsole } from './pourLesTests'

// **Ce test part de `/`, pas de `?gallery`.** C'est le point de `10b` : `A4` était vérifié pièce
// par pièce en galerie et n'avait jamais été vu entier dans l'application. Un écran qu'on ne
// peut atteindre qu'en galerie n'est pas livré.
//
// `?demo` fournit des données figées, faute de pont Tauri sous Chromium — même montage à deux
// conditions que la galerie, donc absent du bundle de production.
test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await page.waitForSelector('[role=tree]')
  await page.evaluate(() => document.fonts.ready)
})

test('la coquille a les dimensions du mockup', async ({ page }) => {
  // **Descendre jusqu'au schéma avant de mesurer, et c'est la coquille elle-même qui le demande** :
  // tant que la sélection s'arrête avant le schéma, le corps montre l'état vide — ses deux colonnes
  // sont là, avec leur poignée, mais il n'y a pas de bande d'onglets dont mesurer la hauteur. Le
  // schéma est le premier palier qui remplit le centre.
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  const mesures = await page.evaluate(() => {
    const barre = document.querySelector('[data-tauri-drag-region]')
    // Le panneau de gauche du `SplitPane` extérieur : c'est lui qui porte la largeur, la
    // sidebar étant en variante `fill`. Le mesurer sur la sidebar elle-même mesurerait une
    // largeur qu'elle ne décide plus.
    const separateurs = [...document.querySelectorAll('[role=separator]')]
    const sidebar = separateurs[0]?.previousElementSibling?.getBoundingClientRect()
    const bande = document.querySelector('[role=tablist]')?.parentElement?.parentElement
    return {
      // La hauteur **calculée**, pas le rectangle : celui-ci inclut le filet bas et rendrait 41
      // là où la déclaration — et le mockup — disent 40.
      titre: barre ? getComputedStyle(barre).height : null,
      sidebar: sidebar ? Math.round(sidebar.width) : null,
      // Comme la barre de titre : la hauteur calculée, le filet bas en plus dans le rectangle.
      bande: bande ? getComputedStyle(bande).height : null,
      poignees: [...document.querySelectorAll('[role=separator]')].map((p) =>
        Math.round(p.getBoundingClientRect().width),
      ),
      // La zone attrapable, elle, déborde : c'est un pseudo-élément, donc invisible aux mesures de
      // boîte. Elle se constate au point (voir la spec du séparateur dans `geometrie-reelle`).
      saisie: [...document.querySelectorAll('[role=separator]')].map((p) => {
        const boite = p.getBoundingClientRect()
        const gauche = document.elementFromPoint(boite.left - 2, boite.top + 40)
        const droite = document.elementFromPoint(boite.right + 2, boite.top + 40)
        return [p.contains(gauche) || gauche === p, p.contains(droite) || droite === p]
      }),
    }
  })

  expect(mesures.titre).toBe('40px')
  // **228 et non 212, et c'est le cinquième palier de l'arbre qui les demande** (`25a`). La taille par
  // défaut du `SplitPane` suit la colonne de `A4`, passée de 252 à 268 px de contenu : le palier le
  // plus profond y a gagné les 16 px que son indentation lui prenait. Le plancher suit aussi — 196 au
  // lieu de 180 — parce qu'à 180 un objet du palier 4 laisse cinq caractères, formellement correct et
  // illisible.
  expect(mesures.sidebar).toBe(228)
  expect(mesures.bande).toBe('34px')
  // **Deux poignées d'un pixel, et non de cinq.** Elles en faisaient cinq, transparents : entre une
  // sidebar en `--paper-alt` et un centre en `--paper`, ces cinq pixels dessinaient une bande claire
  // avec le trait perdu au milieu. La poignée **est** le trait désormais, et ce qu'on attrape déborde
  // sans rien occuper.
  expect(mesures.poignees).toEqual([1, 1])
  // Trois pixels de part et d'autre restent attrapables : viser un trait d'un pixel relèverait de
  // l'adresse.
  expect(mesures.saisie).toEqual([
    [true, true],
    [true, true],
  ])
})

test('ouvrir une table depuis l’arbre ouvre un onglet, et retire « Colonnes de » de la sidebar', async ({
  page,
}) => {
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()

  await page.getByRole('treeitem', { name: /^orders 1\.9/ }).click()

  await expect(page.getByRole('tab', { name: /orders/ })).toHaveAttribute('aria-selected', 'true')
  // **`API-44`** : la section redisait sept colonnes que l'en-tête de la grille nomme déjà, et
  // qu'un clic sur « Structure » liste en entier. Elle prenait cette hauteur sur l'arbre.
  //
  // Mesuré sur la grille rendue, et non sur le clic : la table s'ouvre en deux temps — la structure
  // arrive avant les lignes —, et une assertion négative posée trop tôt serait verte pour la
  // mauvaise raison, la section n'ayant encore rien à afficher (règle n° 15).
  await page.waitForSelector('[role=grid]')
  await expect(page.getByRole('columnheader', { name: /total_cents/ }).first()).toBeVisible()
  await expect(page.getByText(/^Colonnes de/)).toHaveCount(0)
})

test('les trois colonnes se partagent la largeur, et la grille en garde l’essentiel', async ({
  page,
}) => {
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await page.getByRole('treeitem', { name: /^orders 1\.9/ }).click()
  await page.waitForSelector('[role=grid]')

  // **Le défaut que ce test verrouille** : le `SplitPane` ne dimensionnait que son panneau de
  // gauche, donc le centre recevait 296 px et la grille tombait à **zéro** pixel de large. Aucun
  // test ne mesurait le centre — chacun vérifiait la colonne qui l'intéressait.
  const mesures = await page.evaluate(() => {
    const separateurs = [...document.querySelectorAll('[role=separator]')]
    const grille = document.querySelector('[role=grid]')
    // **La colonne de droite se mesure par sa poignée**, comme la sidebar juste au-dessus : depuis
    // `22`, son cadre est une mise en page sans nom accessible — et le panneau de ligne qu'elle
    // contenait n'existe pas tant qu'aucune ligne n'est sélectionnée.
    return {
      sidebar: Math.round(
        separateurs[0]?.previousElementSibling?.getBoundingClientRect().width ?? 0,
      ),
      grille: Math.round(grille?.getBoundingClientRect().width ?? 0),
      panneau: Math.round(separateurs[1]?.nextElementSibling?.getBoundingClientRect().width ?? 0),
      fenetre: window.innerWidth,
    }
  })

  expect(mesures.sidebar).toBe(228)
  expect(mesures.panneau).toBe(296)
  // Le centre prend tout le reste : la fenêtre moins les deux colonnes, les deux poignées et les
  // filets. Une valeur exacte serait fragile ; ce qui compte est qu'elle soit large.
  expect(mesures.grille).toBeGreaterThan(700)
})

test('la barre d’état court sur toute la largeur, sous les trois colonnes', async ({ page }) => {
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await page.getByRole('treeitem', { name: /^orders 1\.9/ }).click()
  await page.waitForSelector('[role=status]')

  const mesures = await page.evaluate(() => {
    const barre = document.querySelector('[role=status]')?.getBoundingClientRect()
    const separateurs = [...document.querySelectorAll('[role=separator]')]
    const panneau = separateurs[1]?.nextElementSibling?.getBoundingClientRect()
    return {
      largeur: Math.round(barre?.width ?? 0),
      fenetre: window.innerWidth,
      // La barre est **sous** le panneau droit, pas à côté : c'est ce que le mockup montre.
      sousLePanneau: (barre?.top ?? 0) >= (panneau?.bottom ?? Number.POSITIVE_INFINITY) - 1,
    }
  })
  expect(mesures.largeur).toBe(mesures.fenetre)
  expect(mesures.sousLePanneau).toBe(true)
})

test('avec beaucoup d’onglets, la bande défile et le couple de vues reste atteignable', async ({
  page,
}) => {
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()

  // Ouvrir toutes les tables du schéma : assez pour déborder de la bande.
  for (const nom of [
    /^orders 1\.9/,
    /shipment_batches/,
    /inventory_movements/,
    /pricing_rules/,
    /audit_events/,
    /order_items/,
    /^users/,
  ]) {
    await page.getByRole('treeitem', { name: nom }).click()
  }
  // **Puis trois consoles, et c'est un fait sur la largeur.** Sept onglets débordaient de la bande
  // tant que le couple « Données / Structure » lui prenait 180 px sur la droite ; depuis `22`, la
  // bande occupe toute la largeur du centre et sept onglets y tiennent. Le cas à exercer étant le
  // débordement, il faut donc de quoi déborder — sans quoi ce test se vérifierait lui-même.
  for (let i = 0; i < 3; i++) {
    await ouvrirUneConsole(page, 'analytics')
  }
  await expect(page.getByRole('tab')).toHaveCount(10)
  // Une console masque le couple (décision de `12a`) : on revient sur une table pour le mesurer.
  await page.getByRole('tab', { name: /orders/ }).click()

  const mesures = await page.evaluate(() => {
    const bande = document.querySelector('[role=tablist]')
    const enveloppe = bande?.parentElement
    const vues = [...document.querySelectorAll('button')].find(
      (bouton) => bouton.textContent?.trim() === 'Données',
    )
    if (!bande || !enveloppe || !vues) return null

    // **Le recouvrement se mesure au point, pas au rectangle.** `getBoundingClientRect` rend la
    // géométrie réelle d'un élément même découpé par un `overflow` : deux premières versions de ce
    // test étaient vertes sans le correctif. Ce qui compte est **ce qui se trouve sous le pixel** où
    // « Données » s'affiche.
    const boite = vues.getBoundingClientRect()
    const dessus = document.elementFromPoint(
      Math.round(boite.left + boite.width / 2),
      Math.round(boite.top + boite.height / 2),
    )

    return {
      recouvertParUnOnglet: bande.contains(dessus),
      // Le cas est bien exercé : sans débordement, il n'y a rien à recouvrir.
      deborde: bande.scrollWidth > enveloppe.clientWidth,
    }
  })

  // **Ce que ce test verrouillait, et ce qu'il verrouille maintenant.** « Données » était à droite de
  // la bande d'onglets, et sept onglets ouverts passaient **par-dessus** — `TabStrip` portait
  // `flex: none`, juste dans son contexte et faux dans celui-là. Depuis `22`, le couple est dans une
  // autre colonne : le recouvrement est devenu structurellement impossible, et ce test le constate
  // plutôt que de disparaître — c'est la garantie qui compte, pas le mécanisme qui la tenait.
  expect(mesures?.deborde).toBe(true)
  expect(mesures?.recouvertParUnOnglet).toBe(false)
  await expect(page.getByRole('button', { name: 'Données' })).toBeVisible()
})

test('fermer le dernier onglet laisse l’écran de travail debout', async ({ page }) => {
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await page.getByRole('treeitem', { name: /^orders 1\.9/ }).click()
  await page.getByRole('button', { name: 'Fermer orders' }).click()

  await expect(page.getByRole('tab')).toHaveCount(0)
  await expect(page.getByRole('tree')).toBeVisible()
  await expect(page.getByRole('table')).toBeVisible()
})

// **L'état vide du corps, mesuré là où il se voit.** jsdom dit que le texte est présent ; il ne dit
// pas que la colonne de droite garde ses 296 px, ni que la bande d'onglets a disparu du centre.
test('sans sélection, les deux colonnes restent et le message occupe le centre', async ({
  page,
}) => {
  await expect(page.getByText('Sélectionner une entité pour commencer')).toBeVisible()
  await expect(page.getByRole('tablist')).toHaveCount(0)
  // Deux poignées, comme dans la coquille pleine : la largeur réglée survit à l'état vide.
  await expect(page.locator('[role=separator]')).toHaveCount(2)

  const mesures = await page.evaluate(() => {
    const separateurs = [...document.querySelectorAll('[role=separator]')]
    const sidebar = separateurs[0]?.previousElementSibling?.getBoundingClientRect()
    const colonne = separateurs[1]?.nextElementSibling?.getBoundingClientRect()
    // Les deux logos : celui du centre à 72 px, celui de la colonne à 40. Tous deux décolorés.
    const logos = [...document.querySelectorAll('svg')]
      .filter((svg) => svg.querySelector('use')?.getAttribute('href') === '#logo')
      .map((svg) => ({
        largeur: Math.round(svg.getBoundingClientRect().width),
        filtre: getComputedStyle(svg).filter,
      }))
    return {
      sidebar: Math.round(sidebar?.width ?? 0),
      colonne: Math.round(colonne?.width ?? 0),
      logos,
      fenetre: window.innerWidth,
    }
  })

  expect(mesures.sidebar).toBe(228)
  expect(mesures.colonne).toBe(296)
  // Le logo de la barre de titre est du lot : il n'est pas décoloré, et c'est ce qui distingue le
  // décor de l'état vide du repère permanent de la fenêtre.
  expect(
    mesures.logos.filter((logo) => logo.filtre === 'grayscale(1)').map((l) => l.largeur),
  ).toEqual([72, 40])

  // Le schéma remplit le centre : la bande d'onglets revient, le message part.
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await expect(page.getByText('Sélectionner une entité pour commencer')).toHaveCount(0)
  await expect(page.getByRole('tablist')).toHaveCount(1)
})

// **Les trois paliers au-dessus du schéma ne remplissent pas le centre.** Ils n'ont ni liste
// d'objets ni structure : seulement des enfants dans l'arbre.
test('un projet, un environnement, une connexion : le centre reste vide', async ({ page }) => {
  // Le double-clic déplie **et** sélectionne : il faut le dépliage pour atteindre le palier suivant,
  // et la sélection est ce que ce test regarde. Le dernier geste est un clic simple — une connexion
  // désignée sans être dépliée est exactement le cas à couvrir.
  await page.getByRole('treeitem', { name: /Atelier Nord/ }).dblclick()
  await expect(page.getByText('Sélectionner une entité pour commencer')).toBeVisible()
  await page.getByRole('treeitem', { name: /^prod\b/ }).dblclick()
  await expect(page.getByText('Sélectionner une entité pour commencer')).toBeVisible()
  await page.getByRole('treeitem', { name: /analytics/ }).click()
  await expect(page.getByText('Sélectionner une entité pour commencer')).toBeVisible()
})

// **La zone attrapable de la flèche est un pseudo-élément**, donc invisible aux mesures de boîte et
// hors de portée de jsdom : elle se constate au point, comme celle de la poignée du `SplitPane`. Le
// test clique **à côté** de la flèche, dans son débord — le seul endroit qui prouve que viser onze
// pixels n'est pas nécessaire.
test('la flèche déplie seule, et sa zone attrapable déborde', async ({ page }) => {
  const projet = page.getByRole('treeitem', { name: /Atelier Nord/ })
  await expect(projet).toHaveAttribute('aria-expanded', 'false')

  const point = await page.evaluate(() => {
    const zone = document.querySelector('[data-chevron-zone]')?.getBoundingClientRect()
    if (!zone) return null
    // Quatre pixels à gauche du rectangle de la flèche : dehors, et dans le débord de 5.
    return { x: zone.left - 4, y: zone.top + zone.height / 2, largeur: Math.round(zone.width) }
  })
  if (!point) throw new Error('aucune flèche dans l’arbre')
  // La gouttière garde la largeur du mockup : le débord n'occupe rien.
  expect(point.largeur).toBe(11)

  await page.mouse.click(point.x, point.y)
  await expect(projet).toHaveAttribute('aria-expanded', 'true')
  // La flèche ouvre ; elle ne désigne pas. Sélectionner au passage déplacerait le centre de l'écran
  // pour un geste qui ne parlait que de l'arbre.
  await expect(projet).toHaveAttribute('aria-selected', 'false')
  await expect(page.getByText('Sélectionner une entité pour commencer')).toBeVisible()
})
