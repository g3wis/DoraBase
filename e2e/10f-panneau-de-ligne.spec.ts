import { expect, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

// Largeur du panneau, largeur des étiquettes, bouton pleine largeur : de la mise en page, donc
// hors de portée de Vitest. `10f` les nomme.
test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await page.getByRole('treeitem', { name: /^orders 1\.9/ }).click()
  await page.waitForSelector('[role=grid]')
  await page.evaluate(() => document.fonts.ready)
  // Sélectionner la première ligne : le panneau ne se remplit pas sans elle.
  await page.getByRole('grid').getByRole('row').nth(2).click()
  await page.waitForSelector('[aria-label="Détail de la ligne 1"]')
})

test('le panneau fait 296 px, et l’en-tête du cadre 34', async ({ page }) => {
  const mesures = await page.evaluate(() => {
    const panneau = document.querySelector('[aria-label="Détail de la ligne 1"]')
    // **L'en-tête n'est plus dans le panneau** : il appartient au cadre de la colonne depuis `22`,
    // pour survivre à la bascule de vue et au panneau des modifications. Sa mesure reste celle du
    // mockup — c'est la même barre, elle a changé de contenu, pas de hauteur.
    // **Le séparateur est nommé par son orientation** : la zone d'instances (`API-32`) en pose un
    // second, horizontal, dans la sidebar — un `[role=separator]` nu prendrait celui-là.
    const entete = document.querySelector('[role=separator][aria-orientation=vertical] ~ * header')
    if (!panneau || !entete) return null
    return {
      // La largeur **calculée** : le rectangle inclurait le filet gauche.
      panneau: getComputedStyle(panneau).width,
      entete: getComputedStyle(entete).height,
    }
  })
  expect(mesures?.panneau).toBe('296px')
  expect(mesures?.entete).toBe('34px')
})

/**
 * **La clé au-dessus, la valeur au-dessous** (`API-49`) — le mockup les mettait côte à côte, avec
 * une étiquette de 96 px qui ne laissait à la donnée qu'un tiers du panneau.
 *
 * Ce test mesure **l'empilement et la largeur rendue**, non un ordre de grandeur : sans le
 * `flex-direction: column`, les deux boîtes se partagent la ligne — leurs bords haut coïncident et
 * la valeur perd la moitié de sa largeur. C'est une égalité, pas une comparaison (règle n° 18).
 */
test('la clé est au-dessus de sa valeur, et chacune occupe toute la largeur', async ({ page }) => {
  const mesures = await page.evaluate(() => {
    const champ = document.querySelector('[aria-label="Détail de la ligne 1"] dl > div')
    const dt = champ?.querySelector('dt')
    const dd = champ?.querySelector('dd')
    if (!champ || !dt || !dd) return null
    const boites = { champ: champ.getBoundingClientRect(), dt: dt.getBoundingClientRect() }
    return {
      // Le bas de la clé est au niveau du haut de la valeur, aux arrondis près : elles sont
      // empilées, pas côte à côte.
      empile: Math.round(dd.getBoundingClientRect().top - boites.dt.bottom),
      largeurDeLaCle: Math.round(boites.dt.width),
      largeurDuChamp: Math.round(boites.champ.width),
      // La valeur est **décalée** pour s'aligner sur le nom de sa clé, jamais rétrécie de 96 px.
      retrait: Math.round(dd.getBoundingClientRect().left - boites.champ.left),
    }
  })
  expect(mesures?.empile).toBe(0)
  expect(mesures?.largeurDeLaCle).toBe(mesures?.largeurDuChamp)
  expect(mesures?.retrait).toBeLessThan(30)
})

test('l’aperçu de ligne liée apparaît et nomme ses champs détectés', async ({ page }) => {
  // `users` porte `email` et `name` : deux champs de la liste blanche du handoff.
  await expect(page.getByText(/Ligne liée · users/)).toBeVisible()
  await expect(page.getByText(/email, name détectés/)).toBeVisible()
  await expect(page.getByText('marie.l@example.com')).toBeVisible()
})

test('le bouton « Copier la ligne en INSERT » occupe toute la largeur', async ({ page }) => {
  const bouton = page.getByRole('button', { name: /Copier la ligne en INSERT/ })
  await expect(bouton).toBeVisible()

  const mesures = await page.evaluate(() => {
    const panneau = document.querySelector('[aria-label="Détail de la ligne 1"]')
    const corps = panneau?.querySelector('[class*="corps"]')
    const b = panneau?.querySelector('[class*="copier"]')
    if (!corps || !b) return null
    return {
      corps: Math.round(corps.clientWidth),
      bouton: Math.round(b.getBoundingClientRect().width),
      hauteur: Math.round(b.getBoundingClientRect().height),
    }
  })
  // Le padding du corps est déjà retiré par `clientWidth` du conteneur en `flex-direction:
  // column` : le bouton doit donc l'occuper entièrement.
  expect(mesures?.bouton).toBe((mesures?.corps ?? 0) - 22)
  // 27 px déclarés + 2 de bordure, `content-box` comme partout dans ce projet.
  expect(mesures?.hauteur).toBe(29)
})

test('les deux onglets rendent deux contenus distincts', async ({ page }) => {
  const panneau = page.getByLabel('Détail de la ligne 1')

  await expect(panneau.locator('dl')).toBeVisible()
  // **Il y en avait un troisième, « Liens »** (`API-49`) : il listait les relations de la table dans
  // un onglet où l'on n'allait pas. C'est une **section** de celui-ci, sous la liste des champs, donc
  // le lien de `user_id` se lit sans changer d'onglet.
  await expect(page.getByRole('tab', { name: 'Liens' })).toHaveCount(0)
  const liens = panneau.getByRole('heading', { name: 'Liens' })
  await expect(liens).toBeVisible()
  await expect(panneau.getByText('users.id')).toBeVisible()
  // **Sous la liste, et non au-dessus** : c'est l'ordre demandé, et jsdom ne peut pas en juger.
  const dl = await panneau.locator('dl').boundingBox()
  const titre = await liens.boundingBox()
  expect(titre?.y).toBeGreaterThan((dl?.y ?? 0) + (dl?.height ?? 0) - 1)

  await page.getByRole('tab', { name: 'JSON' }).click()
  await expect(panneau.locator('pre')).toContainText('"total_cents"')
  await expect(panneau.locator('dl')).toHaveCount(0)

  // Le JSON est **coloré** : quatre couleurs du handoff, dont les jetons existaient depuis `02`
  // sans avoir jamais servi. Une clé et une chaîne ne doivent pas se rendre pareil.
  const couleurs = await page.evaluate(() => {
    const pre = document.querySelector('[aria-label^="Détail de la ligne"] pre')
    const spans = [...(pre?.querySelectorAll('span') ?? [])]
    const cle = spans.find((s) => s.textContent?.startsWith('"id"'))
    const nombre = spans.find((s) => s.textContent === '184220')
    if (!cle || !nombre) return null
    return { cle: getComputedStyle(cle).color, nombre: getComputedStyle(nombre).color }
  })
  expect(couleurs?.cle).not.toBe(couleurs?.nombre)

  await page.getByRole('tab', { name: 'Champs' }).click()
  await expect(panneau.locator('dl')).toBeVisible()
  await expect(panneau.locator('pre')).toHaveCount(0)
})

test('le bouton de copie du JSON ne recouvre ni le texte ni la barre de défilement', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'JSON' }).click()
  const bouton = page.getByRole('button', { name: 'Copier le JSON de la ligne' })
  await expect(bouton).toBeVisible()

  const mesures = await page.evaluate(() => {
    const bouton = [...document.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Copier le JSON de la ligne',
    )
    const bloc = document.querySelector('[aria-label="Détail de la ligne 1"] pre')
    if (!bouton || !bloc) return null
    const boite = bouton.getBoundingClientRect()
    const dessus = document.elementFromPoint(boite.x + boite.width / 2, boite.y + boite.height / 2)
    return {
      // **Le point, pas le rectangle.** Un bouton posé sur du texte peut avoir les bonnes coordonnées
      // et se retrouver *sous* le bloc : c'est la leçon de la gouttière de `11b`, où une mesure de
      // position validait un élément inatteignable.
      cliquable: bouton.contains(dessus) || dessus === bouton,
      // Il reste à l'intérieur du panneau, et à l'écart du bord droit où se posent les curseurs de
      // défilement — huit pixels, sinon c'est le curseur qu'on attrape en visant le bouton.
      ecartDuBordDroit: Math.round(bloc.getBoundingClientRect().right - boite.right),
      opaque: getComputedStyle(bouton).backgroundColor,
    }
  })

  expect(mesures?.cliquable).toBe(true)
  expect(mesures?.ecartDuBordDroit).toBeGreaterThanOrEqual(8)
  // Opaque : posé **sur** du texte, un fond translucide laisse lire des accolades au travers de
  // l'icône.
  expect(mesures?.opaque).not.toBe('rgba(0, 0, 0, 0)')
})

test('une valeur trop longue est coupée à l’ellipse, sur une seule ligne', async ({ page }) => {
  const mesures = await page.evaluate(() => {
    const champs = [...document.querySelectorAll('[aria-label="Détail de la ligne 1"] dd')]
    const debordants = champs.filter((dd) => dd.scrollWidth > dd.clientWidth + 1)
    const hauteurs = champs.map((dd) => Math.round(dd.getBoundingClientRect().height))
    return {
      // Au moins une valeur du décor dépasse : sinon la mesure ne mesurerait rien.
      coupes: debordants.length,
      ellipse: debordants.map((dd) => getComputedStyle(dd).textOverflow),
      // **Toutes sur une ligne.** Avant, la valeur revenait à la ligne : un identifiant de 36
      // caractères prenait trois lignes, un JSON quinze, et la liste des champs devenait un pavé où
      // l'on ne repérait plus les noms de colonnes.
      surPlusieursLignes: hauteurs.filter((h) => h > 20).length,
    }
  })
  expect(mesures.coupes).toBeGreaterThan(0)
  expect(mesures.ellipse.every((valeur) => valeur === 'ellipsis')).toBe(true)
  expect(mesures.surPlusieursLignes).toBe(0)
})

test('le survol assombrit l’écriture du champ, sans teinter son fond', async ({ page }) => {
  // **`.at(-1)` et non `dd:last-of-type`** : chaque `dd` est seul dans son bloc de champ, donc
  // `last-of-type` les désigne tous les neuf. Le mode strict de Playwright l'a dit ; sans lui, la
  // mesure aurait porté sur le premier venu.
  const styleDe = () =>
    page.evaluate(() => {
      const dd = [...document.querySelectorAll('[aria-label="Détail de la ligne 1"] dd')].at(
        -1,
      ) as HTMLElement
      const champ = dd.parentElement as HTMLElement
      return {
        encre: getComputedStyle(dd).color,
        fond: getComputedStyle(dd).backgroundColor,
        fondDuChamp: getComputedStyle(champ).backgroundColor,
      }
    })

  const repos = await styleDe()
  await page.locator('[aria-label="Détail de la ligne 1"] dd').last().hover()
  const survol = await styleDe()

  // **L'encre change, le fond non.** Un fond teinté sur une ligne de 21 px se lit comme une
  // sélection — donc comme un état, alors que le survol n'en est pas un.
  expect(survol.encre).not.toBe(repos.encre)
  expect(survol.fond).toBe(repos.fond)
  expect(survol.fondDuChamp).toBe(repos.fondDuChamp)

  // Et elle va vers le sombre : `rgb(35, 32, 28)` est `--ink`, le repos étant un cran plus clair.
  expect(survol.encre).toBe('rgb(35, 32, 28)')
})

test('l’aperçu ne paraît qu’après un demi-seconde, et seulement pour une valeur coupée', async ({
  page,
}) => {
  const apercu = page.locator('[class*="apercu"]')

  // 1. Une valeur **courte** : rien, jamais. Un aperçu qui répète une valeur entièrement lisible
  //    n'apprend rien et masque ses voisines.
  await page.locator('[aria-label="Détail de la ligne 1"] dd').nth(2).hover()
  await page.waitForTimeout(900)
  await expect(apercu).toHaveCount(0)

  // 2. Une valeur **coupée** : rien tout de suite — traverser la liste à la souris ne doit rien
  //    allumer. C'est la moitié de l'exigence, et la seule que mesurer trop tard ferait passer par
  //    accident.
  await page.locator('[aria-label="Détail de la ligne 1"] dd').last().hover()
  await page.waitForTimeout(200)
  await expect(apercu).toHaveCount(0)

  // 3. Puis il paraît, et montre la valeur en entier.
  await expect(apercu).toBeVisible({ timeout: 2000 })
  await expect(apercu).toContainText('suite-qui-deborde-largement')

  const place = await page.evaluate(() => {
    const boite = document.querySelector('[class*="apercu"]')?.getBoundingClientRect()
    if (!boite) return null
    return {
      // Posé en coordonnées de fenêtre, il pourrait en sortir par la droite d'un panneau qui touche
      // le bord.
      dansLaFenetre: boite.right <= window.innerWidth && boite.bottom <= window.innerHeight,
      // Et il n'intercepte pas le pointeur, sans quoi il disparaîtrait dès que le curseur l'atteint
      // et le survol clignoterait.
      transparentAuPointeur: getComputedStyle(
        document.querySelector('[class*="apercu"]') as Element,
      ).pointerEvents,
    }
  })
  expect(place?.dansLaFenetre).toBe(true)
  expect(place?.transparentAuPointeur).toBe('none')

  // 4. Il s'efface en quittant le champ.
  await page.getByRole('tab', { name: 'Champs' }).hover()
  await expect(apercu).toHaveCount(0)
})

test('le clic droit ouvre le menu au pointeur, et il est cliquable', async ({ page }) => {
  const champ = page.locator('[aria-label="Détail de la ligne 1"] dd').first()
  await champ.click({ button: 'right' })

  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  const atteignable = await page.evaluate(() => {
    const entree = document.querySelector('[role=menuitem]')
    if (!entree) return null
    const boite = entree.getBoundingClientRect()
    const dessus = document.elementFromPoint(boite.x + boite.width / 2, boite.y + boite.height / 2)
    // **`elementFromPoint`, pas `toBeVisible`.** Le menu s'ouvre au-dessus d'un panneau qui défile et
    // qui découpe son contenu : un `overflow: hidden` d'ancêtre le rognerait sans qu'aucune assertion
    // de visibilité s'en aperçoive — c'est le défaut n° 35.
    return entree.contains(dessus) || dessus === entree
  })
  expect(atteignable).toBe(true)

  // Un clic ailleurs referme.
  await page.getByRole('tab', { name: 'JSON' }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
})
