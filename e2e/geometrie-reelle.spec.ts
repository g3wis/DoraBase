import { expect, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

// Ce que **l'application réelle** a montré, et que les tests de fidélité n'avaient pas vu.
//
// # Pourquoi une spec à part
//
// Le 18 août 2026, une capture de l'application lancée a fait apparaître neuf défauts de mise en page
// dans une interface dont chaque écran avait pourtant sa spec verte. Ils se ressemblent tous : chacun
// est une **conséquence de composition** — une primitive correcte dans sa vitrine, fausse quand un
// voisin décide sa largeur ou quand macOS décide d'afficher ses barres de défilement.
//
// Les specs par écran vérifient qu'un écran ressemble à son mockup. Celle-ci vérifie ce qui n'appartient
// à aucun écran : que rien ne sort de la fenêtre, que ce qui doit défiler défile, et que ce qui a été
// rendu discret l'est resté. Les mesures viennent de la capture, pas d'une intuition.
//
// 1360 × 814 : la taille de la fenêtre sur la capture.

test.use({ viewport: { width: 1360, height: 814 } })

async function ouvrirUneTable(page: import('@playwright/test').Page) {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /^analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await page.getByRole('treeitem', { name: /^orders 1\.9/ }).click()
  await page.waitForSelector('[role=grid]')
  await page.evaluate(() => document.fonts.ready)
}

test('rien ne dépasse le bord droit de la fenêtre', async ({ page }) => {
  await ouvrirUneTable(page)

  const hors = await page.evaluate(() => {
    const limite = window.innerWidth
    /**
     * Un ancêtre qui défile horizontalement **autorise** le débordement : c'est même sa raison d'être.
     *
     * Sans ce filtre, l'assertion comptait les 113 éléments d'une grille de neuf colonnes plus large
     * que sa fenêtre — un état parfaitement sain, qui n'a rien à voir avec le défaut visé. Elle
     * passait tant que le décor de démo tenait dans la largeur, et une colonne ajoutée pour une autre
     * mesure l'a fait basculer : **une assertion qui dépend d'une propriété accidentelle du décor
     * finit par se déclencher sur autre chose que ce qu'elle garde.**
     */
    const dansUnDefilement = (element: Element) => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(parent).overflowX)) return true
      }
      return false
    }
    // Tout élément dont la boîte franchit le bord droit, avec son nom de classe : c'est ainsi que les
    // quatre coupables d'origine ont été trouvés, et c'est la mesure qui les empêche de revenir.
    return [...document.querySelectorAll('body *')]
      .filter((element) => element.getBoundingClientRect().right > limite + 1)
      .filter((element) => !dansUnDefilement(element))
      .map((element) => `${element.tagName}.${element.className}`)
  })
  // La cause de la coupure du bord droit n'était pas un seul élément mais **une chaîne d'un pixel** :
  // une variante `width: 100%` qui ajoutait son filet aux 100 %, puis un bouton de pied de sidebar de
  // 6 px de trop, puis un panneau de détail figé à la mesure du mockup (300 px) dans un panneau
  // redimensionnable de 296. Chacun poussait le suivant. Le projet n'a **pas** de `box-sizing: border-box`
  // global — c'est une décision documentée dans `reset.css` — donc chaque primitive doit déclarer la
  // sienne, et cette assertion est ce qui dit qu'une nouvelle l'a oublié.
  expect(hors).toEqual([])
})

test('aucun élément à `width: 100%` ne déborde de la boîte qui le contient', async ({ page }) => {
  await ouvrirUneTable(page)

  const debordants = await page.evaluate(() => {
    // Le motif exact du défaut : une largeur de 100 %, plus une bordure ou un remplissage, dans une
    // primitive qui n'a pas déclaré `border-box`. On ne teste donc pas tous les éléments — seulement
    // ceux qui portent ce motif, où le débordement est **forcément** un oubli et jamais une intention.
    return [...document.querySelectorAll('body *')]
      .filter((element) => {
        if (getComputedStyle(element).boxSizing !== 'content-box') return false
        const parent = element.parentElement
        if (!parent) return false
        const styleDuParent = getComputedStyle(parent)
        if (styleDuParent.overflowX !== 'visible') return false
        // Le bord droit **utile** du parent : sa boîte moins son remplissage et son filet, c'est-à-dire
        // la ligne que `width: 100%` prétend justement atteindre sans la franchir.
        const bordUtile =
          parent.getBoundingClientRect().right -
          Number.parseFloat(styleDuParent.paddingRight || '0') -
          Number.parseFloat(styleDuParent.borderRightWidth || '0')
        return element.getBoundingClientRect().right > bordUtile + 0.5
      })
      .map((element) => `${element.tagName}.${element.className}`)
  })
  // Le bouton « Nouvelle console » sortait de la colonne de 2 px, et l'assertion du bord de fenêtre ne
  // le voyait pas : un débordement **à l'intérieur** d'un panneau reste dans la fenêtre. Sa cause est
  // la plus discrète de la série — `box-sizing: content-box` posé pour une raison juste, la hauteur du
  // handoff qui désigne le contenu, mais `box-sizing` ne se règle pas par axe et la largeur valait
  // 100 %. La réponse est de convertir la valeur, pas de changer le modèle de boîte.
  expect(debordants).toEqual([])
})

test('la racine ne défile pas horizontalement', async ({ page }) => {
  await ouvrirUneTable(page)
  const debordement = await page.evaluate(() => {
    const racine = document.getElementById('root') ?? document.body
    return racine.scrollWidth - racine.clientWidth
  })
  // Mesure complémentaire de la précédente : un enfant peut être coupé par un ancêtre en `overflow:
  // hidden` — sa boîte reste dans la fenêtre, mais la trame est fausse. `scrollWidth` le voit.
  expect(debordement).toBeLessThanOrEqual(0)
})

test('aucun conteneur défilant ne rebondit aux extrémités', async ({ page }) => {
  await ouvrirUneTable(page)

  const rebondissants = await page.evaluate(() => {
    return [...document.querySelectorAll('body *')]
      .filter((element) => {
        const style = getComputedStyle(element)
        const defile = /auto|scroll/.test(style.overflowX) || /auto|scroll/.test(style.overflowY)
        return defile && style.overscrollBehavior !== 'none'
      })
      .map((element) => `${element.tagName}.${element.className}`)
  })
  // **Une vérification de déclaration, et elle est assumée comme telle.** Le rebond élastique est un
  // comportement de WKWebView : Chromium ne le rend pas, donc il n'y a rien à mesurer géométriquement
  // — c'est le même mur que la discrétion des barres de défilement, et il est dit
  // plutôt que contourné par une fausse mesure. Ce que ce test attrape est réel malgré tout : le
  // prochain panneau défilant qui redéclare `overscroll-behavior` pour son compte, ou une régression
  // de la règle universelle de `reset.css`. Quatorze feuilles déclarent un débordement aujourd'hui ;
  // les nommer une à une ici serait la quinzième à oublier.
  expect(rebondissants).toEqual([])
})

test('un défilement rapide ne laisse aucune bande vide', async ({ page }) => {
  await ouvrirUneTable(page)

  const mesures = await page.evaluate(async () => {
    const zone = document.querySelector('[role=grid] > [role=presentation]') as HTMLElement
    // Le vide **au-dessus et au-dessous** des lignes montées, dans la fenêtre visible. Une valeur
    // négative dit que les lignes dépassent de la fenêtre : c'est l'état sain, celui où l'overscan
    // travaille.
    const vide = () => {
      const fenetre = zone.getBoundingClientRect()
      const boites = [...zone.querySelectorAll('[role=row][aria-rowindex]')]
        .map((ligne) => ligne.getBoundingClientRect())
        .filter((boite) => boite.height > 0)
      return {
        enHaut: Math.round(Math.min(...boites.map((b) => b.top)) - fenetre.top),
        enBas: Math.round(fenetre.bottom - Math.max(...boites.map((b) => b.bottom))),
      }
    }

    // **Un lancer, trame par trame** : vingt sauts de 400 px, et on retient le pire vide observé. Le
    // geste réel du trackpad produit exactement cette suite — un `scroll` par trame, sans pause.
    let pire = { enHaut: 0, enBas: 0 }
    for (let trame = 0; trame < 20; trame++) {
      zone.scrollTop += 400
      await new Promise((resoudre) => requestAnimationFrame(() => resoudre(null)))
      const actuel = vide()
      pire = {
        enHaut: Math.max(pire.enHaut, actuel.enHaut),
        enBas: Math.max(pire.enBas, actuel.enBas),
      }
    }

    // Puis un saut brusque, le cas le plus dur : la barre de défilement traînée d'un bloc.
    zone.scrollTop = 6000
    await new Promise((resoudre) => requestAnimationFrame(() => resoudre(null)))
    return { pire, apresUnSaut: vide() }
  })

  // **La mesure porte sur une seule trame après le geste, et c'est tout le sujet.** Un `scroll` est un
  // événement *continu* pour React : la mise à jour qu'il déclenche est de priorité non urgente, donc
  // différable. Le temps qu'elle passe, la toile est à sa nouvelle position et les lignes montées sont
  // restées à l'ancienne — 265 px de blanc pendant un lancer, près de la hauteur entière de la fenêtre
  // après un saut. Attendre 300 ms avant de mesurer aurait tout montré vert : le défaut n'est pas que
  // l'affichage soit faux, c'est qu'il le soit **le temps d'une trame**.
  expect(mesures.pire.enBas).toBeLessThanOrEqual(0)
  expect(mesures.pire.enHaut).toBeLessThanOrEqual(0)
  expect(mesures.apresUnSaut.enBas).toBeLessThanOrEqual(0)
  expect(mesures.apresUnSaut.enHaut).toBeLessThanOrEqual(0)
})

test('les barres de défilement ne réservent aucune place', async ({ page }) => {
  await ouvrirUneTable(page)
  const gouttieres = await page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter((element) => {
        const style = getComputedStyle(element)
        return /auto|scroll/.test(style.overflowX) || /auto|scroll/.test(style.overflowY)
      })
      .map((element) => ({
        classe: element.className,
        // La gouttière : ce que la barre native prend à la mise en page. Zéro, ou elle dessine une
        // colonne grise sur la trame et rogne le texte des cellules.
        verticale: (element as HTMLElement).offsetWidth - element.clientWidth,
        horizontale: (element as HTMLElement).offsetHeight - element.clientHeight,
      }))
      .filter((mesure) => mesure.verticale > 0 || mesure.horizontale > 0),
  )
  // Les barres natives sont masquées partout (`reset.css`) et celles du produit vivent dans une couche
  // `fixed`. **Styler `::-webkit-scrollbar` ne pouvait pas y arriver** : WebKit rend alors une barre
  // classique, permanente et qui réserve sa place — les deux exigences étaient contradictoires en CSS.
  expect(gouttieres).toEqual([])
})

test('un curseur paraît pendant le geste, sous l’en-tête collé, puis s’efface', async ({
  page,
}) => {
  await ouvrirUneTable(page)

  const curseurs = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[class*="couche"] > div')].map((pouce) => ({
        classe: pouce.className,
        opacite: Number(getComputedStyle(pouce).opacity),
        haut: pouce.getBoundingClientRect().top,
      })),
    )

  // Au repos, aucun curseur n'existe même : ils sont créés au premier geste.
  expect(await curseurs()).toEqual([])

  await page.locator('[role=grid]').hover()
  await page.mouse.wheel(0, 300)
  await expect.poll(async () => (await curseurs()).length).toBeGreaterThan(0)
  // **Le retour en haut de course est posé, non demandé à la molette.** Une roulette rend la main
  // avant que le défilement ne soit arrivé, et la mesure qui suit lisait alors un curseur en pleine
  // course — le test passait seul et échouait dans la suite parallèle, ce qui est la signature d'une
  // attente implicite. Deux trames pour laisser l'événement `scroll` replacer le curseur.
  const mesures = await page.evaluate(async () => {
    const zone = document.querySelector('[role=grid] > [role=presentation]') as HTMLElement
    zone.scrollTop = 0
    await new Promise((resoudre) => requestAnimationFrame(() => resoudre(null)))
    await new Promise((resoudre) => requestAnimationFrame(() => resoudre(null)))
    const pouce = document.querySelector('[class*="vertical"]')?.getBoundingClientRect()
    const entete = document.querySelector('[class*="head"]')?.getBoundingClientRect()
    const premiereLigne = document
      .querySelector('[role=row][aria-rowindex="3"]')
      ?.getBoundingClientRect()
    return {
      pouce: pouce?.top ?? null,
      entete: entete?.bottom ?? null,
      ligne: premiereLigne?.top ?? null,
      defilement: zone.scrollTop,
    }
  })
  // Le garde de la mesure : elle ne vaut qu'en haut de course.
  expect(mesures.defilement).toBe(0)
  // **En haut de course, le curseur commence à la première ligne de données**, pas au-dessus. Sa piste
  // exclut ce qui est collé en haut de la zone — l'en-tête des colonnes et la ligne de filtres. Sans
  // cela, il décrivait un contenu commençant plus haut qu'il ne commence. Signalé le 19 août 2026.
  expect(mesures).toMatchObject({
    pouce: expect.any(Number),
    entete: expect.any(Number),
    ligne: expect.any(Number),
  })
  expect(Math.round(mesures.pouce as number)).toBe(Math.round(mesures.entete as number))
  expect(Math.round(mesures.pouce as number)).toBe(Math.round(mesures.ligne as number))

  // Puis il s'efface, la rémanence passée. C'est la seconde exigence : visible **pendant** le geste.
  await expect
    .poll(async () => (await curseurs()).every((c) => c.opacite === 0), { timeout: 4000 })
    .toBe(true)
})

test('la grille défile horizontalement au lieu d’écraser ses colonnes', async ({ page }) => {
  await ouvrirUneTable(page)

  // **Ni l'élément `role=grid`, ni son parent** : `VirtualGrid` (`10a`) place le débordement sur une
  // enveloppe interne en `role="presentation"`, parce qu'un `role=grid` attend des `rowgroup` pour
  // enfants. C'est cette enveloppe qui défile, et donc elle qu'il faut mesurer.
  const avant = await page.evaluate(() => {
    const zone = document.querySelector('[role=grid] > [role=presentation]')
    if (!zone) return null
    return { debordement: zone.scrollWidth - zone.clientWidth, gauche: zone.scrollLeft }
  })
  // Dix-huit colonnes dans une colonne centrale de 842 px : il **doit** y avoir de quoi défiler. Sans
  // conteneur défilable, `table-layout: fixed` répartissait la largeur disponible entre les dix-huit et
  // écrasait chaque colonne à une trentaine de pixels — les valeurs devenaient illisibles, et la
  // molette n'avait rien à faire défiler puisque rien ne débordait.
  expect(avant?.debordement).toBeGreaterThan(0)

  // Le geste réel : molette horizontale, ou ⇧ + molette, que WebKit traduit en `deltaX`.
  await page.locator('[role=grid]').hover()
  await page.mouse.wheel(240, 0)
  // **`poll` et non une lecture directe** : le défilement à la molette est appliqué par le
  // compositeur, pas dans la foulée de l'événement. Une mesure immédiate lit `0` alors que le geste a
  // bien porté — et ce test-là a d'abord échoué pour cette raison, ce qui aurait fait corriger un code
  // correct.
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector('[role=grid] > [role=presentation]')?.scrollLeft ?? null,
      ),
    )
    // **Le geste, pas une propriété CSS.** Vérifier `overflow-x: auto` dirait que la déclaration est
    // là ; ceci dit que la molette déplace vraiment le contenu.
    .toBeGreaterThan(0)
})

test('glisser un en-tête dans la marge du bord fait défiler la grille, et le dépôt porte au-delà', async ({
  page,
}) => {
  await ouvrirUneTable(page)

  // La zone défilante réelle (voir le test précédent), et l'ordre de départ des en-têtes. Les
  // mesures de Vitest bouchonnent les bords et les trames (`VirtualGrid.test.tsx`) : c'est ici que
  // la géométrie réelle — bords mesurés, vrai `requestAnimationFrame`, vraie borne de course —
  // rencontre le geste pour la première fois.
  const zone = page.locator('[role=grid] > [role=presentation]')
  const placeDeStatus = () =>
    page
      .locator('[role=columnheader][data-colonne]')
      .evaluateAll((les) => les.findIndex((e) => e.getAttribute('data-colonne') === 'status'))
  const depart = await placeDeStatus()

  const poignee = await page
    .getByRole('button', { name: 'Déplacer status (flèches gauche et droite)' })
    .boundingBox()
  const cadre = await zone.boundingBox()
  if (poignee === null || cadre === null) throw new Error('poignée ou grille introuvable')

  await page.mouse.move(poignee.x + poignee.width / 2, poignee.y + poignee.height / 2)
  await page.mouse.down()
  // Dans la marge du bord droit, à hauteur d'en-tête — **peu enfoncé** : la vitesse est
  // proportionnelle à l'enfoncement (`defilementAuBord.ts`), et une course lente laisse aux deux
  // lectures ci-dessous le temps de mesurer avant la fin de la course.
  await page.mouse.move(cadre.x + cadre.width - 25, poignee.y + poignee.height / 2, { steps: 4 })

  const lireLeDefilement = () => zone.evaluate((e) => e.scrollLeft)
  await expect.poll(lireLeDefilement).toBeGreaterThan(0)
  // **Sans autre mouvement du pointeur** : une souris posée contre le bord n'émet plus aucun
  // `pointermove`, et c'est précisément là que le défilement doit continuer — un pas par
  // événement, le sabotage naturel, s'arrêterait ici.
  const enCours = await lireLeDefilement()
  await expect.poll(lireLeDefilement).toBeGreaterThan(enCours + 40)

  await page.mouse.up()

  // Le dépôt a bien porté au-delà du point de départ : `status` a reculé dans l'ordre des
  // en-têtes. La colonne exacte qui reçoit dépend de l'instant du relâchement ; l'exigence — on
  // peut déposer plus loin que ce que la fenêtre montrait — n'en dépend pas.
  await expect.poll(placeDeStatus).toBeGreaterThan(depart)
})

test('la bande d’onglets défile sans montrer de barre', async ({ page }) => {
  await ouvrirUneTable(page)
  const bande = await page.evaluate(() => {
    // Sélection par classe : la bande de `10b` **n'a pas** de `role=tablist`, et c'est délibéré —
    // ses onglets ne commutent pas des panneaux d'une même page, ils portent des tables ouvertes.
    const strip = document.querySelector('[class*="strip"]')
    if (!strip) return null
    const style = getComputedStyle(strip)
    return {
      // **Le débordement vertical, et non l'épaisseur d'une barre.** Chromium sans tête rend des barres
      // en survol, qui n'occupent aucune place : mesurer leur épaisseur ici ne prouverait rien, et un
      // sabotage laissait effectivement le test vert. Ce qui se mesure des deux côtés, c'est la cause —
      // un pixel de contenu de trop dans une enveloppe qui, en posant `overflow-x: auto`, a rendu son
      // axe vertical défilable sans le demander.
      debordementVertical: strip.scrollHeight - strip.clientHeight,
      defilable: style.overflowX,
      confine: style.overflowY,
    }
  })
  expect(bande?.defilable).toBe('auto')
  expect(bande?.confine).toBe('hidden')
  expect(bande?.debordementVertical).toBeLessThanOrEqual(0)
})

test('la barre de fil d’Ariane contient son contrôle segmenté, même à l’étroit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 700 })
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /^analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await page.waitForSelector('nav[aria-label]')
  await page.evaluate(() => document.fonts.ready)

  const mesures = await page.evaluate(() => {
    const fil = document.querySelector('nav[aria-label^="Chemin"]')
    const barre = fil?.parentElement
    const segmente = barre?.querySelector('fieldset')
    if (!barre || !segmente) return null
    const b = barre.getBoundingClientRect()
    const s = segmente.getBoundingClientRect()
    const remplissage = Number.parseFloat(getComputedStyle(barre).paddingRight)
    return {
      dansLaBarre: s.right <= b.right - remplissage + 1,
      remplissage,
      // Le contrôle garde sa largeur : c'est le seul élément de la rangée dont un pixel manquant rend
      // une cible incliquable.
      largeurDuControle: Math.round(s.width),
      dansLaFenetre: s.right <= window.innerWidth,
    }
  })
  // 960 est la largeur minimale déclarée du produit. À cette largeur, la rangée demandait 649 px pour
  // trois éléments fixes dans une colonne centrale de 442 : le contrôle « Tables / Vues / Fonctions /
  // Index », dernier de la rangée, sortait par la droite. Ce qui cède est décidé — le fil se tronque,
  // le champ se rétrécit, le contrôle jamais.
  expect(mesures?.dansLaFenetre).toBe(true)
  expect(mesures?.dansLaBarre).toBe(true)
  expect(mesures?.remplissage).toBeGreaterThan(0)
  expect(mesures?.largeurDuControle).toBe(269)
})

test('le séparateur est un trait d’un pixel, et une barre au survol', async ({ page }) => {
  await ouvrirUneTable(page)
  const poignee = page.locator('[role=separator]').first()

  const trait = await page.evaluate(() => {
    const separateur = document.querySelector('[role=separator]') as HTMLElement
    return {
      // **La poignée est le trait.** Elle faisait 5 px transparents autour d'un trait de 1 : entre une
      // sidebar en `--paper-alt` et un centre en `--paper`, ces 5 px dessinaient une bande claire.
      largeur: Math.round(separateur.getBoundingClientRect().width),
      fond: getComputedStyle(separateur).backgroundColor,
      // La barre du survol est un `::after` en débord : invisible aux mesures de boîte, donc elle ne
      // déplace pas les panneaux quand elle paraît.
      barreAuRepos: Number(getComputedStyle(separateur, '::after').opacity),
    }
  })
  expect(trait.largeur).toBe(1)
  expect(trait.fond).not.toBe('rgba(0, 0, 0, 0)')
  expect(trait.barreAuRepos).toBe(0)

  // **`mouse.move` et non `hover()`.** Sur un élément d'un pixel de large, les vérifications
  // d'actionnabilité de Playwright n'aboutissent pas — elles exigent que l'élément *lui-même* soit
  // sous le point, et le débord attrapable est un pseudo-élément. Ce que ce test veut est le geste ;
  // la preuve que la zone est bien attrapable de part et d'autre est dans `10b`, au point.
  const boite = await poignee.boundingBox()
  if (!boite) throw new Error('la poignée doit être visible')
  await page.mouse.move(boite.x + boite.width / 2, boite.y + 40)
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(
          getComputedStyle(document.querySelector('[role=separator]') as Element, '::after')
            .opacity,
        ),
      ),
    )
    .toBe(1)

  // Et les panneaux n'ont pas bougé d'un pixel : c'est ce que le débord garantit.
  const apres = await page.evaluate(() => {
    const panneau = document.querySelector('[role=separator]')?.previousElementSibling
    return panneau ? Math.round(panneau.getBoundingClientRect().width) : null
  })
  // La taille par défaut du `SplitPane` de l'écran de travail, passée de 212 à 228 px avec le palier
  // d'environnement (`25a`).
  expect(apres).toBe(228)
})

test('les libellés des actions du panneau tiennent dans leur bouton', async ({ page }) => {
  // **La vue schéma avec un objet sélectionné, et non une table ouverte.** Les actions du panneau de
  // détail n'existent que là : une table ouverte laisse la place au panneau de ligne. La première
  // version de ce test ouvrait une table, ne trouvait donc aucun de ces boutons, et **passait sur un
  // ensemble vide** — un sabotage l'a laissé vert, ce qui est la seule façon de s'en apercevoir.
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /^analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await page.waitForSelector('nav[aria-label]')
  await page.getByRole('row').nth(1).click()

  // **Le garde-fou de l'ensemble vide, mais qui attend.** Compter les boutons dans un
  // `page.evaluate` synchrone mesure l'instant du clic, pas l'état qui en résulte : le panneau de
  // détail paraît au rendu suivant, et sur un runner chargé ce rendu arrive après le comptage. Le
  // test trouvait alors zéro bouton et échouait sur une exigence qu'il ne mesurait pas — passé pour
  // « flaky » parce que la reprise le rattrapait, alors qu'il était simplement mal daté.
  // `toHaveCount` réessaie jusqu'à son délai : même refus de l'ensemble vide, sans mesurer
  // l'instant. Vérifié par sabotage — sans le clic qui sélectionne, il trouve zéro et échoue.
  await expect(page.getByRole('button', { name: /SELECT dans console/ })).toHaveCount(1)
  await page.evaluate(() => document.fonts.ready)

  const debordements = await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter((bouton) => bouton.scrollHeight > bouton.clientHeight)
      .map((bouton) => ({
        texte: bouton.textContent?.trim(),
        contenu: bouton.clientHeight,
        reel: bouton.scrollHeight,
      })),
  )
  // « SELECT dans console » demande 118 px de texte dans un bouton qui en offre 104 : il passait donc à
  // la ligne, et deux lignes à l'interligne par défaut débordaient d'un bouton de 28 px. **Le mockup
  // porte exactement le même défaut** — mêmes colonnes, même corps, même libellé — donc la fidélité ne
  // pouvait pas trancher. C'est une mesure que le handoff n'avait pas faite.
  expect(debordements).toEqual([])
})

test('rien ne se sélectionne, sauf ce qui s’édite', async ({ page }) => {
  await ouvrirUneTable(page)

  const chrome = await page.evaluate(() => {
    const selecteurs = [
      '[role=treeitem]',
      '[role=tab]',
      '[role=columnheader]',
      '[role=row] [class*="td"]',
      'button',
      '[role=combobox]',
    ]
    // **Les absents sont écartés, et l'assertion vérifie qu'il en reste.** La liste contenait `label`,
    // qui n'existe plus dans cet écran depuis que les listes déroulantes ne sont pas des contrôles
    // natifs : `getComputedStyle(null)` levait une exception, et un test qui explose ne dit rien de ce
    // qu'il mesurait.
    const presents = selecteurs
      .map((selecteur) => ({ selecteur, element: document.querySelector(selecteur) }))
      .filter(
        (entree): entree is { selecteur: string; element: Element } => entree.element !== null,
      )
    return presents.map(({ selecteur, element }) => ({
      selecteur,
      selection: getComputedStyle(element).userSelect,
      curseur: getComputedStyle(element).cursor,
    }))
  })
  // Le garde de l'ensemble vide : la leçon du n° 72.
  expect(chrome.length).toBeGreaterThanOrEqual(5)
  // Glisser sur un libellé, un onglet, une ligne d'arbre ou une cellule ne surligne plus rien : dans
  // une application de bureau, le texte de l'interface n'est pas du contenu.
  expect(chrome.filter((mesure) => mesure.selection !== 'none')).toEqual([])
  // Et le curseur en I disparaît avec : il annonçait une saisie là où il n'y en a pas.
  expect(chrome.filter((mesure) => mesure.curseur === 'text')).toEqual([])

  // **La limite : ce qui s'édite, et rien d'autre.** Une première version épargnait aussi les blocs de
  // données — `pre`, `code` — au motif qu'un DDL doit pouvoir se copier à la souris. À l'usage, ces
  // blocs *sont* l'interface, et la copie ne dépend plus d'eux : chacun a son bouton, et un champ du
  // panneau se copie au clic droit. Une saisie, elle, ne s'édite pas sans caret.
  await page.getByRole('grid').getByRole('row').nth(2).click()
  await page.getByRole('tab', { name: 'JSON' }).click()
  const donnees = await page.evaluate(() => {
    const bloc = document.querySelector('pre')
    const saisie = document.querySelector('input')
    return {
      bloc: bloc ? getComputedStyle(bloc).userSelect : null,
      saisie: saisie ? getComputedStyle(saisie).userSelect : null,
    }
  })
  expect(donnees.bloc).toBe('none')
  expect(donnees.saisie).toBe('text')

  // Et un vrai glissement sur un bloc de données ne surligne rien — la propriété, pas la déclaration.
  const bloc = page.locator('pre').first()
  const boite = await bloc.boundingBox()
  if (boite) {
    await page.mouse.move(boite.x + 8, boite.y + 6)
    await page.mouse.down()
    await page.mouse.move(boite.x + boite.width - 8, boite.y + boite.height - 6, { steps: 10 })
    await page.mouse.up()
  }
  expect(await page.evaluate(() => document.getSelection()?.toString() ?? '')).toBe('')
})

/*
 * **Les deux tests que ce bloc remplace mesuraient le pied de la sidebar**, retiré le 26 août 2026 :
 * ses deux boutons sur une ligne, et l'ellipse d'un libellé allongé de force. Ils ne sont pas devenus
 * faux, leur sujet a disparu — « Ajouter une connexion » vit dans le menu d'un environnement, et
 * « Nouveau projet » dans la bande en tête, qui n'a pas de libellé à couper.
 *
 * Ce qui reste à mesurer est ce que la bande, elle, peut casser : une action qui sort de la colonne, ou
 * une bande qui grandit sous son contenu.
 */
test('la bande d’actions tient dans la colonne, à hauteur fixe', async ({ page }) => {
  await page.goto('/?demo')
  await page.waitForSelector('[role=tree]')
  await page.evaluate(() => document.fonts.ready)

  const mesures = await page.evaluate(() => {
    const bande = document.querySelector('[role=toolbar]') as HTMLElement | null
    if (!bande) return null
    const colonne = bande.parentElement
    if (!colonne) return null
    const b = bande.getBoundingClientRect()
    const c = colonne.getBoundingClientRect()
    const actions = [...bande.querySelectorAll('button')] as HTMLElement[]
    return {
      // 28 px de contenu plus son filet bas : la conversion habituelle de ce projet. Les deux
      // bandes de tête ont quitté `--h-bar` le 27 août 2026 — 22 px de bouton et 3 px de part
      // et d'autre — et cette mesure n'avait pas suivi.
      hauteur: Math.round(b.height),
      // Aucune action ne sort de la bande, ni par la droite ni par le bas.
      dansLaBande: actions.every((action) => {
        const a = action.getBoundingClientRect()
        return a.right <= b.right + 0.5 && a.bottom <= b.bottom + 0.5
      }),
      // Et la bande ne sort pas de la colonne : c'est le pixel qui s'était propagé jusqu'au bord droit
      // de la fenêtre le 18 août 2026, par un `content-box` de trop.
      dansLaColonne: b.right <= c.right + 0.5,
      carres: actions.map((action) => [
        Math.round(action.getBoundingClientRect().width),
        Math.round(action.getBoundingClientRect().height),
      ]),
    }
  })
  const m = mesures as NonNullable<typeof mesures>

  expect(m.hauteur).toBe(29)
  expect(m.dansLaBande).toBe(true)
  expect(m.dansLaColonne).toBe(true)
  // 22 px, la hauteur d'une ligne d'arbre : la bande n'introduit pas une troisième unité verticale
  // dans une colonne qui en a déjà deux.
  expect(m.carres).toEqual([[22, 22]])
})

/**
 * La largeur minimale d'un onglet, et le fond qui la remplit.
 *
 * **Deux mesures, parce que la première seule laissait passer le défaut.** L'enveloppe respectait
 * bien son minimum, mais le bouton qu'elle contient se dimensionnait sur son texte : le filet
 * supérieur courait sur 120 px au-dessus d'un fond qui s'arrêtait à 46 px, et la croix de fermeture
 * flottait au milieu. Signalé à l'écran le 20 août 2026. Vérifier la largeur de l'onglet sans
 * vérifier que son contenu la remplit revient à mesurer la boîte en ignorant ce qu'on y voit.
 */
test('un onglet au nom très court garde sa largeur, et son fond la remplit', async ({ page }) => {
  await page.goto('/?demo')
  await page.waitForSelector('[role=tree]')
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: /Top coupons/ }).click()
  await page.waitForSelector('.cm-content')

  // Renommé en un seul caractère : le cas que la largeur minimale existe pour tenir.
  await page.getByRole('tab', { name: /Top coupons/ }).dblclick()
  const champ = page.getByLabel('Nouveau nom de Top coupons')
  await champ.fill('1')
  await champ.press('Enter')
  await expect(page.getByRole('tab', { name: '1' })).toBeVisible()

  const mesures = await page.evaluate(() => {
    const bouton = [...document.querySelectorAll('[role=tab]')].find(
      (tab) => (tab.textContent ?? '').trim() === '1',
    )
    const enveloppe = bouton?.parentElement
    if (!bouton || !enveloppe) return null
    const croix = enveloppe.querySelector('button[aria-label^=Fermer]')
    return {
      enveloppe: enveloppe.getBoundingClientRect().width,
      bouton: bouton.getBoundingClientRect().width,
      croix: croix?.getBoundingClientRect().width ?? 0,
    }
  })

  expect(mesures).not.toBeNull()
  if (mesures === null) return
  // L'onglet ne rétrécit pas jusqu'à devenir une pastille dans laquelle on ne vise plus. 98 px est
  // la largeur de l'onglet `orders` du mockup — la plus petite que le handoff connaisse.
  expect(mesures.enveloppe).toBeGreaterThanOrEqual(98)
  // Et son contenu occupe toute la place : le bouton plus la croix couvrent l'enveloppe, à un
  // pixel de sous-pixel près. C'est ce qui manquait.
  expect(mesures.bouton + mesures.croix).toBeGreaterThan(mesures.enveloppe - 2)
})

/**
 * **Un onglet ne change pas de taille quand il passe en édition.**
 *
 * Le double-clic est un geste de visée : si la cible s'élargit au moment où on l'atteint, les onglets
 * voisins se déplacent sous le curseur. Le coupable est la largeur intrinsèque d'un `<input>` — son
 * attribut `size` implicite vaut une vingtaine de caractères, et cette largeur pousse. Signalé à
 * l'écran le 20 août 2026, après une première tentative qui *fixait* une largeur d'édition et
 * aggravait donc le défaut.
 *
 * Le nom est réduit à un caractère avant de mesurer : c'est l'écart maximal entre ce que le libellé
 * demande et ce que le champ demanderait. Sur « CA par jour », le défaut serait presque invisible.
 */
test('un onglet garde sa largeur quand il passe en édition', async ({ page }) => {
  await page.goto('/?demo')
  await page.waitForSelector('[role=tree]')
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: /CA par jour/ }).click()
  await page.waitForSelector('.cm-content')

  await page.getByRole('tab', { name: /CA par jour/ }).dblclick()
  const premier = page.getByLabel('Nouveau nom de CA par jour')
  await premier.fill('1')
  await premier.press('Enter')
  await expect(page.getByRole('tab', { name: '1' })).toBeVisible()

  const largeurOnglet = () =>
    page.evaluate(
      () => document.querySelector('[role=tablist] > div')?.getBoundingClientRect().width ?? 0,
    )
  const avant = await largeurOnglet()
  await page.getByRole('tab', { name: '1' }).dblclick()
  await expect(page.getByLabel('Nouveau nom de 1')).toBeFocused()
  const pendant = await largeurOnglet()

  // Rien ne bouge — au sous-pixel près.
  expect(Math.abs(pendant - avant)).toBeLessThan(1)
  // Et la largeur minimale de l'onglet tient, elle aussi.
  expect(avant).toBeGreaterThanOrEqual(98)
})

test('la ligne sous la bande d’onglets ne se casse pas à la colonne de droite', async ({
  page,
}) => {
  await ouvrirUneTable(page)

  const mesures = await page.evaluate(() => {
    // La bande d'onglets et l'en-tête de la colonne de droite forment **une seule ligne
    // horizontale** à l'écran ; leurs deux filets doivent donc tomber au même pixel.
    const bande = document.querySelector('[role=tablist]')?.parentElement?.parentElement
    const colonne = document.querySelector('[data-testid=colonne-droite]')
    const entete = colonne?.firstElementChild
    if (!bande || !colonne || !entete) return null
    const styleBande = getComputedStyle(bande)
    const styleEntete = getComputedStyle(entete)
    return {
      bande: bande.getBoundingClientRect().bottom,
      entete: entete.getBoundingClientRect().bottom,
      colonneHaut: colonne.getBoundingClientRect().y,
      bandeHaut: bande.getBoundingClientRect().y,
      // **La colonne ne dessine aucun filet** : c'est la poignée du `SplitPane` qui sépare, et tout
      // filet ajouté ici viendrait s'y coller pour faire un trait de 2 px.
      colonneOmbre: getComputedStyle(colonne).boxShadow,
      colonneBord: getComputedStyle(colonne).borderLeftWidth,
      traitBande: `${styleBande.borderBottomWidth} ${styleBande.borderBottomColor}`,
      traitEntete: `${styleEntete.borderBottomWidth} ${styleEntete.borderBottomColor}`,
    }
  })

  // **Un pixel d'écart, et la ligne se voit cassée.** L'en-tête était en `border-box` — 34 px filet
  // compris — là où la bande rend 35 px pour 34 déclarés, la convention du handoff (`TabStrip`).
  expect(mesures?.entete).toBe(mesures?.bande)

  // **Le filet vertical part du haut de la colonne**, comme dans le handoff, qui le pose sur la
  // colonne entière et non sur son contenu. Porté par le panneau de détail, il démarrait sous
  // l'en-tête et laissait une marche à la jonction.
  expect(mesures?.colonneHaut).toBe(mesures?.bandeHaut)
  expect(mesures?.colonneOmbre).toBe('none')
  expect(mesures?.colonneBord).toBe('0px')

  // **Même épaisseur et même teinte**, parce que c'est une seule ligne. Le handoff pose `.08` à
  // droite et `.1` à gauche — deux blocs dessinés séparément — et la jonction se voyait :
  // un trait plus clair se lit comme un trait plus fin. Écart assumé.
  expect(mesures?.traitEntete).toBe(mesures?.traitBande)
  expect(mesures?.traitBande).toBe('1px rgba(35, 32, 28, 0.1)')
})

test('les deux jonctions verticales sont un seul trait, identique à gauche et à droite', async ({
  page,
}) => {
  await ouvrirUneTable(page)

  const jonctions = await page.evaluate(() => {
    const poignees = [...document.querySelectorAll('[role=separator]')]
    // Ce qui borde chaque poignée : si un voisin dessine son propre filet, il se colle à celui de la
    // poignée et le trait fait 2 px — l'écart que l'écran a signalé.
    return poignees.map((poignee) => {
      const r = poignee.getBoundingClientRect()
      const s = getComputedStyle(poignee)
      const gauche = document.elementFromPoint(r.x - 2, r.y + 200)
      const droite = document.elementFromPoint(r.right + 2, r.y + 200)
      const filetDe = (el: Element | null) => {
        if (!el) return 'aucun'
        const st = getComputedStyle(el)
        return `${st.borderLeftWidth}/${st.borderRightWidth}/${st.boxShadow === 'none' ? 'sans ombre' : st.boxShadow}`
      }
      return {
        largeur: r.width,
        haut: r.y,
        bas: r.bottom,
        fond: s.backgroundColor,
        voisinGauche: filetDe(gauche?.closest('[class*=root]') ?? gauche),
        voisinDroite: filetDe(droite?.closest('[class*=root]') ?? droite),
      }
    })
  })

  // Les deux poignées : 1 px, même teinte, toute la hauteur.
  expect(jonctions).toHaveLength(2)
  for (const jonction of jonctions) {
    expect(jonction.largeur).toBe(1)
    expect(jonction.fond).toBe('rgba(35, 32, 28, 0.1)')
  }
  // **Et surtout : les deux sont identiques**, ce que « iso avec la bordure de la sidebar de gauche »
  // demande. Un trait dessiné deux fois d'un côté et une fois de l'autre est le défaut n° 129.
  expect(jonctions[0]?.largeur).toBe(jonctions[1]?.largeur)
  expect(jonctions[0]?.fond).toBe(jonctions[1]?.fond)
  expect(jonctions[0]?.haut).toBe(jonctions[1]?.haut)
  expect(jonctions[0]?.bas).toBe(jonctions[1]?.bas)
})
