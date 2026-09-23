import { expect, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

/**
 * Le diagramme de structure d'un schéma (3 septembre 2026).
 *
 * # Ce que ce niveau garde, et qu'aucun autre ne peut garder
 *
 * `disposition.test.ts` vérifie la géométrie **calculée**, `DiagramView.test.tsx` le contenu et les
 * gestes, `Workbench.test.tsx` l'assemblage. Deux faits leur échappent tous les trois, parce que
 * jsdom ne calcule aucune mise en page (règle n° 9) :
 *
 * 1. **que le rendu tombe là où le calcul l'a mis.** Les hauteurs viennent de `disposition.ts` et
 *    sont posées en style *inline* par le composant : si les deux se désaccordaient, les flèches
 *    arriveraient à côté des lignes qu'elles désignent, et rien ne le dirait — le DOM serait juste,
 *    et seul l'œil verrait le décalage ;
 * 2. **que la toile défile vraiment**, plutôt que de déborder de son cadre. C'est le défaut n° 35 par
 *    un autre bout, et la seule mesure qui en décide est celle d'un vrai navigateur.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  // **Le survol est obligatoire** : le « … » d'une ligne est en `visibility: hidden` hors survol, et
  // Playwright refuse de cliquer un élément invisible — l'attente expirerait sans rien dire d'utile.
  await page.getByRole('treeitem', { name: 'public' }).hover()
  await page.getByRole('button', { name: 'Actions de public' }).click()
  await page.getByRole('button', { name: 'Diagramme du schéma' }).click()
  // Les structures arrivent **une par une** : attendre la dernière boîte, et non un délai.
  await page.getByRole('button', { name: /^users ·/ }).waitFor()
  await page.evaluate(() => document.fonts.ready)
})

test('le diagramme dessine les tables du schéma et leurs clés', async ({ page }) => {
  await expect(page.getByRole('tab', { name: /public/ })).toHaveAttribute('aria-selected', 'true')

  // Les six tables du décor `?demo` — les vues en sont écartées, une vue n'ayant pas de clé
  // étrangère à montrer.
  for (const table of [
    'users',
    'orders',
    'order_items',
    'inventory_movements',
    'shipment_batches',
    'pricing_rules',
    'audit_events',
    // Ajoutée le 3 septembre 2026 : la seule table `1:1` du décor, sans quoi les deux marques de
    // cardinalité seraient indiscernables (règle n° 5).
    'user_profiles',
  ]) {
    await expect(page.getByRole('button', { name: new RegExp(`^${table} ·`) })).toHaveCount(1)
  }
  await expect(page.getByRole('button', { name: /^orders_daily/ })).toHaveCount(0)

  // La barre d'état, et le nombre qui manquerait : `audit_events.snapshot_id` vise
  // `archive.snapshots`, dont la boîte n'existe pas — le taire ferait lire le dessin comme complet.
  const pied = page.getByRole('status', { name: 'Résumé du diagramme' })
  await expect(pied).toContainText('8 tables')
  await expect(pied).toContainText('7 liens')
  await expect(pied).toContainText('1 hors du schéma')
})

test('une flèche arrive au pixel où sa ligne est rendue', async ({ page }) => {
  /*
   * **Le fait que ce fichier existe pour garder.**
   *
   * `disposition` ancre le lien `orders_user_id_fkey` au centre de la ligne `user_id` de `orders`,
   * et au centre de la ligne `id` de `users`. Les hauteurs qui produisent ces centres — en-tête et
   * ligne — sont **exportées** par le module de calcul et posées en style *inline* par le composant,
   * précisément pour qu'il n'y ait qu'une valeur. Ce test est ce qui le vérifie : une seconde valeur
   * dans la CSS aurait décalé toutes les flèches sans faire rougir un seul test unitaire.
   *
   * **La tolérance est d'un demi-pixel, et c'est un correctif.** Elle valait un pixel, et le
   * sabotage l'a dénoncée : rendre au flux la bordure de la boîte décale les lignes d'exactement un
   * pixel, ce qu'une tolérance d'un pixel laisse passer. Or les cotes sont entières de bout en bout
   * — hauteurs, positions, coordonnées du tracé —, donc l'égalité est exacte et le demi-pixel ne
   * couvre plus qu'un éventuel arrondi de `getBoundingClientRect`. C'est la règle n° 18 : un test
   * qui mesure un ordre de grandeur ne garde pas une cote.
   */
  const mesures = await page.evaluate(() => {
    const boite = (table: string) =>
      document.querySelector(`[data-boite="${table}"]`) as HTMLElement | null
    const ligne = (table: string, colonne: string) =>
      boite(table)?.querySelector(`[data-colonne="${colonne}"]`) as HTMLElement | null
    const centre = (element: HTMLElement | null) => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return rect.top + rect.height / 2
    }
    // Les deux bouts d'un tracé : ses **deux premiers** nombres et ses **deux derniers**, quel que
    // soit ce qu'il y a entre. Le compte, lui, varie — un lien droit porte deux points, un coude
    // arrondi en porte six — et une version de ce test l'avait figé à huit, la longueur d'une
    // courbe de Bézier. Elle ne mesurait donc plus rien le jour où les courbes sont devenues des
    // coudes : `filter` vidait la liste, et `some` sur une liste vide est faux… donc le test
    // rougissait. Un compte figé aurait aussi bien pu la laisser verte.
    const chemins = [...document.querySelectorAll('[data-liens] path[d]')]
      .map((path) => path.getAttribute('d') ?? '')
      .map((d) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number))
      .filter((nombres) => nombres.length >= 4)
      .map((nombres) => ({
        depart: nombres[1] as number,
        arrivee: nombres[nombres.length - 1] as number,
      }))
    const toile = document.querySelector('[data-liens]')?.getBoundingClientRect()
    return {
      chemins,
      // Le décalage entre les coordonnées du calcul et celles de la fenêtre.
      origine: toile ? toile.top : null,
      fk: centre(ligne('orders', 'user_id')),
      cible: centre(ligne('users', 'id')),
      // Le contrôle négatif du décor : les deux ancres sont à des hauteurs différentes **dans leur
      // boîte**, donc une inversion des deux bouts ne pourrait pas passer inaperçue.
      rangFk: [...(boite('orders')?.querySelectorAll('[data-colonne]') ?? [])].findIndex(
        (element) => element.getAttribute('data-colonne') === 'user_id',
      ),
      rangCible: [...(boite('users')?.querySelectorAll('[data-colonne]') ?? [])].findIndex(
        (element) => element.getAttribute('data-colonne') === 'id',
      ),
    }
  })

  expect(mesures.origine).not.toBeNull()
  expect(mesures.fk).not.toBeNull()
  expect(mesures.cible).not.toBeNull()
  expect(mesures.rangFk).not.toBe(mesures.rangCible)

  const origine = mesures.origine as number
  const depart = (mesures.fk as number) - origine
  const arrivee = (mesures.cible as number) - origine
  // L'un des tracés du dessin part de la ligne `user_id` et arrive sur la ligne `id`. On le
  // retrouve par ses deux ordonnées plutôt que par un ordre dans le DOM, qui n'est pas une garantie.
  // La prémisse : il y a bien des tracés à examiner. Sans elle, une extraction devenue muette
  // rendrait ce test faux pour la mauvaise raison.
  expect(mesures.chemins.length).toBeGreaterThan(0)
  const trouve = mesures.chemins.some(
    (bouts) => Math.abs(bouts.depart - depart) < 0.5 && Math.abs(bouts.arrivee - arrivee) < 0.5,
  )
  expect(
    trouve,
    `aucun tracé ne va de ${depart} à ${arrivee} ; tracés vus : ${JSON.stringify(mesures.chemins)}`,
  ).toBe(true)
})

test('les tables se rangent de gauche à droite, dans le sens des références', async ({ page }) => {
  const abscisses = await page.evaluate(() =>
    Object.fromEntries(
      ['inventory_movements', 'order_items', 'orders', 'users'].map((table) => [
        table,
        document.querySelector(`[data-boite="${table}"]`)?.getBoundingClientRect().left ?? null,
      ]),
    ),
  )

  // `inventory_movements → order_items → orders → users` : une table est à gauche de celles qu'elle
  // référence, donc la chaîne se lit comme la phrase. C'est un ordre **strict** : deux tables à la
  // même abscisse voudraient dire que le calcul des couches n'a rien classé.
  expect(abscisses.inventory_movements).toBeLessThan(abscisses.order_items as number)
  expect(abscisses.order_items).toBeLessThan(abscisses.orders as number)
  expect(abscisses.orders).toBeLessThan(abscisses.users as number)
})

test('la toile défile, elle ne déborde pas de son cadre', async ({ page }) => {
  // **Le débordement est provoqué, pas espéré.** À l'échelle 1 le dessin du décor tient à peu près
  // dans le centre : un test qui compterait sur son débordement mesurerait la largeur de la fenêtre
  // du jour. Deux crans de zoom le rendent forcément plus large que son cadre, et c'est là que la
  // question se pose — le dessin doit se **parcourir**, pas être rogné en silence.
  await page.getByRole('button', { name: 'Agrandir le diagramme' }).click()
  await page.getByRole('button', { name: 'Agrandir le diagramme' }).click()
  await expect(page.getByRole('button', { name: /^Échelle 150 %/ })).toBeVisible()

  const mesures = await page.evaluate(() => {
    // `data-toile` plutôt qu'une remontée d'ancêtres : celle-ci se cassait au premier `div`
    // intercalé, et un test qui suit la forme du DOM mesure la forme du DOM.
    const zone = document.querySelector('[data-toile]') as HTMLElement | null
    if (!zone) return null
    const deborde = zone.scrollWidth > zone.clientWidth
    zone.scrollLeft = 400
    return {
      deborde,
      defile: zone.scrollLeft,
      largeurDeLaRacine: document.documentElement.scrollWidth,
      largeurVisible: document.documentElement.clientWidth,
    }
  })

  expect(mesures).not.toBeNull()
  const vu = mesures as {
    deborde: boolean
    defile: number
    largeurDeLaRacine: number
    largeurVisible: number
  }
  // La prémisse, dite plutôt que supposée : sans débordement, « ça défile » n'a rien à vérifier.
  expect(vu.deborde).toBe(true)
  // Un `scrollLeft` qui resterait à zéro dirait que la zone ne défile pas — donc que le dessin est
  // rogné, ce qui est le défaut n° 35 par un autre bout.
  expect(vu.defile).toBeGreaterThan(0)
  // **Et la racine ne défile jamais** (règle n° 10) : c'est la zone du diagramme qui absorbe la
  // largeur, pas la fenêtre.
  expect(vu.largeurDeLaRacine).toBe(vu.largeurVisible)
})

test('le zoom agrandit le dessin, sans le déformer', async ({ page }) => {
  const mesure = () =>
    page.evaluate(() => {
      const boite = document.querySelector('[data-boite="users"]')?.getBoundingClientRect()
      return boite ? { largeur: boite.width, hauteur: boite.height } : null
    })

  const cent = await mesure()
  await page.getByRole('button', { name: 'Agrandir le diagramme' }).click()
  await expect(page.getByRole('button', { name: /^Échelle 125 %/ })).toBeVisible()
  const cent25 = await mesure()

  expect(cent).not.toBeNull()
  expect(cent25).not.toBeNull()
  const avant = cent as { largeur: number; hauteur: number }
  const apres = cent25 as { largeur: number; hauteur: number }
  // Une **échelle**, donc les deux dimensions dans le même rapport : un zoom qui n'agirait que sur
  // la largeur étirerait le dessin, ce que `transform: scale` ne fait pas — et c'est bien la raison
  // pour laquelle le zoom est une transformation et non un recalcul des cotes.
  expect(apres.largeur / avant.largeur).toBeCloseTo(1.25, 2)
  expect(apres.hauteur / avant.hauteur).toBeCloseTo(1.25, 2)
})

/**
 * Le zoom à la souris (`API-82`).
 *
 * **Une fenêtre courte, et c'est le décor qui l'exige** (règle n° 5). Le dessin de `?demo` fait
 * 1000 × 485 : dans la fenêtre par défaut il tient tout entier dans la toile, donc il n'y a **rien
 * à faire défiler** — le navigateur borne alors le défilement à zéro, aucun ancrage ne peut tenir,
 * et la propriété serait fausse sans que le code y soit pour rien. Mesuré avant de l'écrire :
 * `scrollHeight - clientHeight` valait 0 même à 125 %.
 */
test.describe('le zoom à la souris', () => {
  test.use({ viewport: { width: 900, height: 560 } })

  test('`Ctrl` + molette zoome sous le pointeur, sans déplacer ce qu’on regarde', async ({
    page,
  }) => {
    // **Ce que ce niveau garde et qu'aucun autre ne peut garder.** L'ancrage est de l'arithmétique
    // chez `zoomALaSouris.test.ts` ; que le **rendu** tombe là où le calcul le met demande un vrai
    // défilement et une vraie mise en page, dont jsdom n'a ni l'un ni l'autre (règle n° 9).
    //
    // **`shipment_batches` et pas `users`** : le point visé doit garder du défilement devant lui
    // dans les deux sens, sinon le navigateur borne et c'est la borne qu'on mesure. `users` est
    // contre le bord droit du dessin (x = 840 sur 1000), celle-ci est au milieu.
    const cible = page.locator('[data-boite="shipment_batches"]')
    const boite = () => cible.boundingBox()
    await cible.hover()
    const avant = await boite()
    if (!avant) throw new Error('la boîte `shipment_batches` est absente du dessin')
    const vise = { x: avant.x + avant.width / 2, y: avant.y + avant.height / 2 }

    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -100)
    await page.keyboard.up('Control')

    await expect(page.getByRole('button', { name: /^Échelle 125 %/ })).toBeVisible()
    // **Le contrôle positif, et il ne bouge pas avec le défaut** (règle n° 1) : un geste qui ne
    // zoomerait pas laisserait la boîte exactement où elle est, donc l'immobilité vérifiée ensuite
    // serait verte pour la raison contraire à celle qu'on mesure. Ce qui l'atteste est que le
    // dessin a **grandi**.
    await expect
      .poll(async () => {
        const apres = await boite()
        return apres ? Math.round((apres.width / avant.width) * 100) : 0
      })
      .toBe(125)

    // Et le point visé n'a pas bougé de l'écran : toute la différence entre un zoom ancré sous le
    // pointeur et un zoom accroché au coin haut-gauche, où la table qu'on regardait file au
    // deuxième cran.
    const apres = await boite()
    if (!apres) throw new Error('la boîte `shipment_batches` a disparu du dessin')
    expect(Math.abs(apres.x + apres.width / 2 - vise.x)).toBeLessThan(2)
    expect(Math.abs(apres.y + apres.height / 2 - vise.y)).toBeLessThan(2)
  })

  test('la molette nue défile la toile, elle ne la zoome pas', async ({ page }) => {
    // L'autre moitié de l'arbitrage d'`API-82`, et celle qui se casserait sans qu'on la regarde :
    // le défilement est le seul geste confortable sur un schéma plus haut que la fenêtre.
    const toile = page.locator('[data-toile]')
    await toile.hover()
    await page.mouse.wheel(0, 200)

    await expect.poll(() => toile.evaluate((n) => n.scrollTop)).toBeGreaterThan(0)
    await expect(page.getByRole('button', { name: /^Échelle 100 %/ })).toBeVisible()
  })
})

test('l’interrupteur « Toutes les colonnes » ouvre ce que l’aperçu résume', async ({ page }) => {
  // `audit_events` porte cinq colonnes dont trois clés : l'aperçu les montre toutes, ce qui ne
  // prouverait rien. `orders` en porte neuf dans le décor, donc elle résume.
  await expect(page.getByText('+ 1 autre')).toHaveCount(1)
  await page.getByRole('switch', { name: 'Toutes les colonnes' }).click()
  await expect(page.getByRole('switch', { name: 'Toutes les colonnes' })).toBeChecked()
  await expect(page.getByText(/autre/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^orders · 9 colonnes/ })).toBeVisible()
})

test('un double-clic sur une boîte ouvre la table, et le diagramme reste', async ({ page }) => {
  await page.getByRole('button', { name: /^orders ·/ }).dblclick()

  await expect(page.getByRole('tab', { name: /^orders/ })).toHaveAttribute('aria-selected', 'true')
  // **C'est toute la raison d'un onglet plutôt qu'une vue de table** : le diagramme parle du schéma,
  // donc il survit à l'ouverture des tables qu'il montre.
  await expect(page.getByRole('tab', { name: /public/ })).toBeVisible()
  await page.getByRole('tab', { name: /public/ }).click()
  await expect(page.getByRole('button', { name: /^users ·/ })).toBeVisible()
})

test('aucun nom ni aucun type n’est coupé sous le plafond', async ({ page }) => {
  /*
   * **Le juge des constantes de largeur**, comme le test de bout en bout d'`ajustement.ts` l'est des
   * siennes. La largeur d'une boîte est un **calcul** — un compte de caractères multiplié par
   * l'avance du mono, plus ce que la feuille de style consomme hors texte — et rien dans ce calcul
   * ne sait ce que le navigateur rend vraiment.
   *
   * C'est ce test qui manquait : la première version comptait 30 px de chrome par ligne là où la CSS
   * en consomme 36, et les six pixels manquants coupaient **tous** les `timestamptz` du décor. Vu à
   * l'œil sur une capture, invisible à la suite entière — jsdom ne calcule aucune mise en page, et le
   * calcul se croyait juste.
   *
   * « Sous le plafond » est la nuance qui compte : au-delà de `LARGEUR_BOITE_MAX`, l'ellipse est le
   * comportement **voulu** — une boîte assez large pour un `character varying(255)[]` pousserait
   * tout le reste du graphe hors de l'écran. Le test regarde donc les boîtes que le plafond n'a pas
   * bornées.
   */
  const coupes = () =>
    page.evaluate(() => {
      // Le plafond de `disposition.ts`. Une boîte qui l'atteint a le droit de couper.
      const PLAFOND = 268
      const tronque = (element: Element | null | undefined) =>
        element ? element.scrollWidth - element.clientWidth : 0
      const vues: string[] = []
      for (const boite of document.querySelectorAll<HTMLElement>('[data-boite]')) {
        if (Math.round(boite.getBoundingClientRect().width) >= PLAFOND) continue
        const table = boite.dataset.boite ?? '?'
        const tete = boite.firstElementChild?.querySelector('span')
        if (tronque(tete) > 0) vues.push(`${table} : en-tête coupé de ${tronque(tete)} px`)
        for (const ligne of boite.querySelectorAll<HTMLElement>('[data-colonne]')) {
          const spans = [...ligne.querySelectorAll('span')]
          const perdu = Math.max(tronque(spans[0]), tronque(spans[1]))
          if (perdu > 0) vues.push(`${table}.${ligne.dataset.colonne} : coupé de ${perdu} px`)
        }
      }
      return vues
    })

  expect(await coupes(), 'en mode « Clés »').toEqual([])

  // **Et en « Toutes »**, où les colonnes masquées reparaissent : ce sont souvent les plus longues,
  // et le mode par défaut ne les aurait jamais mesurées.
  await page.getByRole('switch', { name: 'Toutes les colonnes' }).click()
  await expect(page.getByRole('button', { name: /^orders · 9 colonnes/ })).toBeVisible()
  expect(await coupes(), 'en mode « Toutes »').toEqual([])
})

test('la recherche amène la table trouvée à l’écran', async ({ page }) => {
  /*
   * **Ce qu'aucun test unitaire ne peut voir.** `Entrée` amène la correspondance à l'écran par
   * `scrollIntoView`, qui n'existe pas sans mise en page (règle n° 9) — jsdom en reçoit un
   * complément vide, et Vitest se contente de vérifier que la table est *désignée*. Que la vue se
   * **déplace** ne se mesure que dans un navigateur.
   */
  const champ = page.getByRole('textbox', { name: /Chercher une table ou une colonne/ })

  // Deux crans de zoom, pour que le dessin dépasse largement son cadre : sans débordement il n'y a
  // rien à faire défiler, et le test se vérifierait lui-même.
  await page.getByRole('button', { name: 'Agrandir le diagramme' }).click()
  await page.getByRole('button', { name: 'Agrandir le diagramme' }).click()
  const depart = await page
    .locator('[data-toile]')
    .evaluate((zone) => ({ x: zone.scrollLeft, y: zone.scrollTop }))

  await champ.fill('users')
  // Le compte répond avant qu'on appuie : c'est lui qui dit s'il y a quelque part où aller.
  await expect(page.getByText('1 trouvée')).toBeVisible()
  // La frappe seule **ne déplace pas** : elle marque. Déplacer sous les doigts de qui tape serait
  // désorientant sur une toile de plusieurs milliers de pixels.
  expect(
    await page.locator('[data-toile]').evaluate((zone) => ({
      x: zone.scrollLeft,
      y: zone.scrollTop,
    })),
  ).toEqual(depart)

  await champ.press('Enter')
  // **La table trouvée est à l'écran**, et non seulement quelque part dans la toile. La mesure
  // porte sur le recouvrement des deux rectangles : c'est la seule qui dise « visible » plutôt que
  // « présent dans la mise en page ».
  const dansLaVue = await page.evaluate(() => {
    const zone = document.querySelector('[data-toile]')?.getBoundingClientRect()
    const boite = document.querySelector('[data-boite="users"]')?.getBoundingClientRect()
    if (!zone || !boite) return null
    return (
      boite.left >= zone.left &&
      boite.right <= zone.right &&
      boite.top >= zone.top &&
      boite.bottom <= zone.bottom
    )
  })
  expect(dansLaVue).toBe(true)
  // Et elle est désignée : ses liens et les colonnes de ses clés s'allument, ce qui est la raison
  // d'y être allé.
  await expect(page.getByRole('button', { name: /^users ·/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('la recherche éteint ce qu’elle ne désigne pas, et le dit quand elle ne trouve rien', async ({
  page,
}) => {
  const champ = page.getByRole('textbox', { name: /Chercher/ })

  // Une colonne, pas seulement une table : `account_id` n'existe dans aucun nom de table du décor.
  await champ.fill('user_id')
  // Deux tables la portent depuis que `user_profiles` existe : `orders.user_id` et
  // `user_profiles.user_id`, qui est justement la clé `1:1` du décor.
  await expect(page.getByText('2 trouvées')).toBeVisible()
  const eteintes = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-boite]')]
        .filter((boite) => (boite as HTMLElement).className.includes('boiteEteinte'))
        .map((boite) => boite.getAttribute('data-boite'))
        .sort(),
    )
  // Six des huit tables s'effacent ; `orders` et `user_profiles` portent `user_id` et restent.
  expect((await eteintes()).length).toBe(6)

  await champ.fill('zzzz')
  await expect(page.getByText('aucune')).toBeVisible()
  expect((await eteintes()).length).toBe(8)

  // Vider le champ rend le dessin entier : une recherche abandonnée ne laisse pas de trace.
  await champ.fill('')
  expect(await eteintes()).toEqual([])
})

test('un ⇧-clic sur deux boîtes écrit le chemin de clés qui les relie', async ({ page }) => {
  /*
   * **Ce que ce niveau ajoute aux deux autres.**
   *
   * `disposition.test.ts` garde le chemin lui-même et `DiagramView.test.tsx` la bande et ses gestes.
   * Deux faits leur échappent, et ce sont ceux d'une mise en page : que le `⇧`-clic passe **dans un
   * vrai navigateur** — le geste part d'un `pointerdown` que la toile écoute aussi pour se déplacer,
   * et rien sous jsdom ne dit lequel des deux gagne — et que la bande prenne sa place **dans le
   * flux** au lieu de recouvrir le dessin.
   */
  const toileHaut = () =>
    page.evaluate(() => document.querySelector('[data-toile]')?.getBoundingClientRect().top ?? null)
  const avant = await toileHaut()

  await page.getByRole('button', { name: /^order_items ·/ }).click()
  await page.getByRole('button', { name: /^users ·/ }).click({ modifiers: ['Shift'] })

  // `inventory_movements` → `order_items` → `orders` → `users` : les deux bouts choisis ne se
  // touchent pas, ce qui est le cas où l'on ne sait pas répondre soi-même.
  const bande = page.getByRole('status', { name: 'Ce qui relie les tables choisies' })
  await expect(bande).toContainText('Reliées en 2 étapes')
  await expect(bande).toContainText('order_items.order_id')
  await expect(bande).toContainText('orders.id')
  await expect(bande).toContainText('orders.user_id')
  await expect(bande).toContainText('users.id')

  /*
   * **La bande est au-dessus de la toile, et lui prend exactement sa hauteur.**
   *
   * Une carte flottante n'aurait rien décalé, mais elle aurait recouvert une part du dessin — or ce
   * qu'elle nomme est justement ce qu'on y regarde. Les deux mesures se tiennent : le haut de la
   * toile descend de la hauteur de la bande, et le bas de la bande touche ce haut. Une bande
   * *posée* satisferait la seconde et pas la première.
   *
   * La tolérance est d'un demi-pixel, ce que peut coûter un arrondi de `getBoundingClientRect` :
   * les cotes sont entières de bout en bout. **Le rectangle mesuré contient déjà le filet du bas** —
   * `.relation` n'est pas en `border-box`, comme `.barre` avant elle : ses 26 px de `--h-statusbar`
   * plus 1 px de bordure font les 27 px qu'elle prend au flux, et c'est cette même valeur que le
   * haut de la toile doit descendre.
   */
  const geometrie = await page.evaluate(() => {
    const dansLaBande = document.querySelector(
      '[role=status][aria-label="Ce qui relie les tables choisies"]',
    )
    const toile = document.querySelector('[data-toile]')
    if (!dansLaBande || !toile) return null
    return {
      basDeLaBande: dansLaBande.getBoundingClientRect().bottom,
      hautDeLaToile: toile.getBoundingClientRect().top,
      hauteurDeLaBande: dansLaBande.getBoundingClientRect().height,
    }
  })
  if (geometrie === null || avant === null) throw new Error('la bande ou la toile manque')
  expect(Math.abs(geometrie.basDeLaBande - geometrie.hautDeLaToile)).toBeLessThan(0.5)
  expect(Math.abs(geometrie.hautDeLaToile - avant - geometrie.hauteurDeLaBande)).toBeLessThan(0.5)
})

test('deux tables que rien ne relie le disent, plutôt que de ne rien afficher', async ({
  page,
}) => {
  // `pricing_rules` ne porte qu'une clé réflexive : aucune suite de clés ne mène de là à `users`.
  // Une bande muette laisserait croire que la question n'a pas été comprise.
  await page.getByRole('button', { name: /^users ·/ }).click()
  await page.getByRole('button', { name: /^pricing_rules ·/ }).click({ modifiers: ['Shift'] })

  const bande = page.getByRole('status', { name: 'Ce qui relie les tables choisies' })
  await expect(bande).toContainText('Aucun chemin de clés entre users et pricing_rules')

  // Et le dessin revient au repos par le bouton de la bande, sans avoir à retrouver les boîtes.
  await page.getByRole('button', { name: 'Ne plus rien choisir' }).click()
  await expect(bande).toHaveCount(0)
})

test('un lien 1:1 et un lien 1:n ne se dessinent pas de la même façon', async ({ page }) => {
  /*
   * **Ce que ce niveau garde, et qu'aucun autre ne peut garder.**
   *
   * `DiagramView.test.tsx` vérifie *quelle* marque chaque lien porte — c'est du DOM. Qu'elle
   * **atterrisse au bon endroit** ne se mesure qu'ici : une marque juste dans sa forme et fausse
   * dans son ancrage se rend sans se voir, ou se pose à l'envers au milieu du trait. jsdom ne
   * calcule aucune mise en page, donc il ne verrait ni l'un ni l'autre (règle n° 9).
   *
   * # Ce qui est devenu mesurable, et ne l'était pas
   *
   * Les marques étaient des `<marker>` SVG. Un `marker` vit dans `<defs>` : **sa boîte englobante
   * est nulle par construction**, donc aucun test ne pouvait constater qu'il avait peint quelque
   * part — une première version l'assertait et mesurait le fait qu'un `defs` n'a pas de boîte. On
   * se rabattait sur ses deux attributs d'ancrage, `refX` et `orient`, c'est-à-dire sur une
   * *déclaration* tenant lieu de résultat. Depuis que ce sont des `<path>` ordinaires (voir la
   * raison dans `DiagramView`), la question se pose directement : où est-ce peint ?
   */
  const marques = await page.evaluate(() => {
    const boites = [...document.querySelectorAll('[data-boite]')].map((b) => ({
      table: b.getAttribute('data-boite'),
      rect: b.getBoundingClientRect(),
    }))
    return [...document.querySelectorAll('[data-liens] path[data-marque]')].map((m) => {
      const rect = m.getBoundingClientRect()
      /*
       * **La distance au bord vertical de boîte le plus proche.** C'est l'assertion qui remplace
       * `refX` et `orient` d'un coup : une marque doit s'appuyer contre un bord de boîte, et une
       * marque posée au milieu du trait — ou retournée du mauvais côté sur un lien qui sort par la
       * gauche, ce que les cycles produisent — s'en éloigne de toute la longueur du lien.
       *
       * On cherche le bord le plus proche plutôt que celui de *sa* boîte : le test n'a alors pas à
       * connaître la forme des identités, ni à distinguer le départ de l'arrivée.
       */
      const distances = boites.flatMap(({ rect: b }) =>
        // Seules les boîtes à la hauteur de la marque comptent : un bord à trois cents pixels
        // au-dessus n'est pas un bord contre lequel elle pourrait s'appuyer.
        rect.top >= b.top - 1 && rect.bottom <= b.bottom + 1
          ? [
              Math.abs(rect.left - b.right),
              Math.abs(rect.right - b.left),
              Math.abs(rect.right - b.right),
              Math.abs(rect.left - b.left),
            ]
          : [],
      )
      return {
        lien: m.getAttribute('data-marque-lien'),
        sorte: m.getAttribute('data-marque'),
        // **Peinte quelque part** : une largeur et une hauteur non nulles. C'est précisément ce
        // qu'un `<marker>` ne pouvait pas dire de lui-même.
        largeur: rect.width,
        hauteur: rect.height,
        auBord: distances.length > 0 ? Math.min(...distances) : null,
      }
    })
  })

  const departs = marques.filter((m) => m.sorte !== 'fleche')
  const par = (fin: string) => departs.find((m) => m.lien?.endsWith(fin))
  // `user_profiles.user_id` est à la fois clé primaire et clé étrangère : un profil par compte.
  expect(par('user_profiles_user_id_fkey')?.sorte).toBe('one')
  // Plusieurs commandes par compte : rien ne les borne.
  expect(par('orders_user_id_fkey')?.sorte).toBe('many')

  // Trois marques de départ au moins, et une flèche par lien.
  expect(departs.length).toBeGreaterThan(2)
  expect(marques.filter((m) => m.sorte === 'fleche')).toHaveLength(departs.length)

  for (const m of marques) {
    /*
     * **Chacune a peint.** Mesuré sur la plus grande des deux dimensions, et non sur les deux : la
     * boîte englobante d'un `<path>` est sa **géométrie**, sans l'épaisseur du trait, donc la barre
     * du `1:1` — un segment vertical — est large de zéro. Une première version l'exigeait non nulle
     * et échouait sur elle : le trait qu'on voit à l'écran n'est pas dans la boîte qu'on mesure.
     */
    expect(Math.max(m.largeur, m.hauteur), `${m.sorte} de ${m.lien}`).toBeGreaterThan(4)
    // Et chacune s'appuie contre un bord de boîte, à l'épaisseur d'un trait près.
    expect(m.auBord, `${m.sorte} de ${m.lien}`).not.toBeNull()
    expect(m.auBord ?? Number.NaN, `${m.sorte} de ${m.lien}`).toBeLessThan(6)
  }
})

test('une marque est le trait qui se termine, à l’arrêt comme choisie', async ({ page }) => {
  /*
   * **Trois signalements, la même règle.** « La largeur devrait être la même que le reste du
   * trait », « le surlignage d'un trait ne s'applique pas à la marque », puis « le demi-cercle
   * reste surligné pour toujours ». Une marque au bout d'un trait doit être *ce trait qui se
   * termine* : même épaisseur, même encre, dans chacun de ses états.
   *
   * Les trois avaient des causes différentes, toutes retirées :
   *
   * - l'épaisseur, parce que `markerUnits` valait `strokeWidth` — la boîte d'un `<marker>` se
   *   comptait alors en multiples de l'épaisseur du trait marqué, donc les cotes qu'on croyait
   *   poser en pixels n'en étaient pas et le trait de la marque était peint plus gras ;
   * - l'encre, parce que la marque portait un gris plus sombre que le lien « pour mieux se lire » ;
   * - la persistance, parce que l'état se choisissait en basculant la **référence** d'un `marker` à
   *   un autre, et que la webview de l'application ne la repeignait pas toujours.
   *
   * Les marques sont donc des `<path>` qui portent **les classes du trait** (voir la raison dans
   * `DiagramView`), ce qui rend les deux égalités structurelles plutôt que tenues à la main. Ce
   * test cesse d'être le garde-fou d'un réglage et devient le contrôle de cette structure : il
   * mordrait si une marque reprenait des déclarations à elle.
   */
  const mesurer = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-liens] path[data-marque]')].map((marque) => {
        const id = marque.getAttribute('data-marque-lien') ?? ''
        const trait = document.querySelector(
          `[data-liens] path[data-lien="${CSS.escape(id)}"]`,
        ) as SVGPathElement | null
        const deLaMarque = getComputedStyle(marque)
        const duTrait = trait ? getComputedStyle(trait) : null
        return {
          quoi: `${marque.getAttribute('data-marque')} de ${id}`,
          // Les deux styles, pris **calculés** : ils viennent de classes de module CSS, donc les
          // attributs n'existent pas et seul le style résolu les porte.
          traitDuLien: duTrait?.strokeWidth ?? null,
          traitDeLaMarque: deLaMarque.strokeWidth,
          encreDuLien: duTrait?.stroke ?? null,
          encreDeLaMarque: deLaMarque.stroke,
          opaciteDuLien: duTrait?.opacity ?? null,
          opaciteDeLaMarque: deLaMarque.opacity,
        }
      }),
    )

  const verifier = async (etat: string) => {
    const mesures = await mesurer()
    expect(mesures.length, etat).toBeGreaterThan(0)
    for (const m of mesures) {
      expect(m.traitDeLaMarque, `${etat} — ${m.quoi}`).toBe(m.traitDuLien)
      expect(m.encreDeLaMarque, `${etat} — ${m.quoi}`).toBe(m.encreDuLien)
      // L'effacement d'une recherche aussi : il porte sur l'élément, donc il n'atteindrait pas une
      // marque qui ne voyagerait pas avec son trait.
      expect(m.opaciteDeLaMarque, `${etat} — ${m.quoi}`).toBe(m.opaciteDuLien)
    }
  }

  await verifier('à l’arrêt')

  /*
   * **Et choisie**, ce qui est la moitié qui a été signalée deux fois. `orders` porte une clé
   * sortante et une entrante, donc ce tour-ci mesure des marques des deux états — accentué et
   * ordinaire — sur le même dessin.
   */
  await page.getByRole('button', { name: /^orders ·/ }).click()
  await verifier('table choisie')

  // **Puis rendue à son état de repos**, qui est le signalement littéral : « le demi-cercle reste
  // surligné pour toujours ». Une marque qui garderait l'accent après le clic de désélection
  // n'aurait plus l'encre de son trait, et l'égalité ci-dessus le dirait.
  await page.getByRole('button', { name: 'Ne plus rien choisir' }).click()
  await verifier('sélection retirée')
})

test('un trait accentué n’a jamais un trait ordinaire par-dessus', async ({ page }) => {
  /*
   * **Rapporté à l'usage : « parfois un trait gris est rendu au-dessus d'un trait surligné, pareil
   * pour les flèches ».**
   *
   * SVG n'a pas de `z-index` : il peint dans l'**ordre du document**. Un lien gris déclaré après un
   * lien accentué passe donc par-dessus, et sur un dessin où les traits se croisent cela arrive tout
   * le temps. C'est aussi ce qui expliquait le signalement précédent — « le surlignage ne s'applique
   * pas à la marque » : deux liens partant de la même ligne de colonne posent leurs marques au même
   * pixel, et la grise se peignait après l'accentuée. Le DOM était juste des deux côtés, ce qui
   * rendait le défaut introuvable en le cherchant dans la couleur ou dans le câblage.
   *
   * # Pourquoi l'ordre, et non deux pixels comparés
   *
   * L'ordre est la **cause**, il est exact, et il vaut pour tous les recouvrements à la fois — y
   * compris ceux que ce décor-ci ne produit pas. Comparer la couleur d'un pixel de croisement
   * demanderait un croisement à l'endroit choisi, donc un décor à maintenir pour cette seule
   * question, et un test muet le jour où la disposition cesse d'en produire un. C'est le même
   * arbitrage que pour l'opacité, juste en dessous.
   */
  const rangs = async () =>
    page.evaluate(() => {
      const styles = [...document.querySelectorAll('[data-liens] path[data-lien]')].map((t) => ({
        lien: t.getAttribute('data-lien'),
        // Les deux états se lisent sur le style **calculé** plutôt que sur la classe : celle d'un
        // module CSS est un nom engendré, et s'y accrocher mesurerait l'outil de construction.
        accentue: getComputedStyle(t).strokeWidth === '1.8px',
        eteint: getComputedStyle(t).opacity !== '1',
      }))
      return styles.map((s) => ({ ...s, rang: s.eteint ? 0 : s.accentue ? 2 : 1 }))
    })

  // Une table choisie : ses liens sont accentués, les autres non.
  await page.getByRole('button', { name: /^orders ·/ }).click()
  const choisie = await rangs()
  expect(choisie.some((l) => l.rang === 2)).toBe(true)
  expect(choisie.some((l) => l.rang === 1)).toBe(true)
  // **Croissant, donc rien d'ordinaire après un accentué.** Le tri étant stable, l'ordre de
  // `vue.liens` survit à l'intérieur de chaque rang — peindre n'est pas disposer.
  expect(choisie.map((l) => l.rang)).toEqual([...choisie.map((l) => l.rang)].sort())

  // Et l'autre bout de la même règle : ce qu'une recherche efface passe **sous** tout le reste.
  await page.getByRole('button', { name: 'Ne plus rien choisir' }).click()
  await page.getByRole('textbox', { name: /Chercher une table/ }).fill('users')
  await expect(page.locator('[data-liens] path[data-lien]').first()).toBeVisible()
  const cherche = await rangs()
  expect(cherche.some((l) => l.rang === 0)).toBe(true)
  expect(cherche.some((l) => l.rang === 1)).toBe(true)
  expect(cherche.map((l) => l.rang)).toEqual([...cherche.map((l) => l.rang)].sort())
})

test('deux liens qui se croisent ne s’assombrissent pas', async ({ page }) => {
  /*
   * **Rapporté à l'usage : « la couleur n'est pas cohérente là où deux traits se superposent ».**
   *
   * Les liens portaient `--ink-5`, une encre à 30 %. Deux couches sur la même toile donnent
   * 1 − 0,70² = 51 % : un point plus sombre que tout le reste du dessin, à l'endroit précis où l'œil
   * cherche à suivre un trait, et qui se lit comme une désignation alors que rien n'y est désigné.
   *
   * # Pourquoi l'opacité déclarée, et non deux pixels comparés
   *
   * Comparer la couleur d'un croisement à celle d'un trait seul mesurerait la **conséquence**, et il
   * faudrait un croisement dans le décor pour la mesurer — donc un décor à maintenir pour cette
   * seule question, et un test muet le jour où la disposition cesse d'en produire un. Ce qui est
   * vrai indépendamment du dessin est qu'**une encre translucide ne peut pas se superposer à
   * elle-même sans s'assombrir** : c'est la cause, elle tient dans un canal alpha, et elle se
   * mesure sur n'importe quel trait.
   *
   * `.lienEteint` n'est pas concerné : son `opacity` est un effacement voulu, il porte sur
   * l'élément et non sur l'encre, et il ne paraît que pendant une recherche.
   */
  const encres = await page.evaluate(() => {
    const peints = [
      ...document.querySelectorAll('[data-liens] path[data-lien]'),
      ...document.querySelectorAll('[data-liens] path[data-marque]'),
    ]
    return peints.map((p) => {
      const style = getComputedStyle(p)
      return { stroke: style.stroke, opacite: style.opacity }
    })
  })

  expect(encres.length).toBeGreaterThan(0)
  for (const e of encres) {
    // `getComputedStyle` rend une couleur résolue : `rgb(…)` quand elle est opaque, `rgba(…, a)`
    // — ou `color(… / a)` — dès qu'elle ne l'est pas. C'est l'alpha qu'on refuse, sous ses deux
    // formes, et non une valeur précise : la teinte reste libre de changer.
    expect(e.stroke).not.toMatch(/rgba|\/\s*0?\.\d/)
    expect(e.opacite).toBe('1')
  }
})

test('la cardinalité s’écrit dans l’infobulle, que la notation soit connue ou non', async ({
  page,
}) => {
  // Un demi-cercle ne dit rien à qui n'a jamais vu la notation, et un tracé SVG n'a aucun texte qu'une
  // voix puisse rendre : le mot doit exister quelque part.
  const ligne = page.locator('[data-boite="user_profiles"] [data-colonne="user_id"]')
  await expect(ligne).toHaveAttribute('title', /un à un/)

  const autre = page.locator('[data-boite="orders"] [data-colonne="user_id"]')
  await expect(autre).toHaveAttribute('title', /un à plusieurs/)
})

test('la notation garde de l’air des deux côtés, et non du seul gauche', async ({ page }) => {
  /*
   * **Rapporté à l'usage : « 1:n est collé au nom de la table de droite ».**
   *
   * L'air à gauche venait du `padding` de la flèche, celui de droite de rien du tout — et
   * « 1:nusers.id » se lit comme un seul mot. La notation porte donc son propre `padding-right`.
   *
   * # Pourquoi la valeur **calculée**, et non le rectangle
   *
   * C'est la règle n° 9 dans sa seconde moitié : un `padding` vit **à l'intérieur** de la boîte que
   * `getBoundingClientRect` rend. Mesurer l'écart entre le bord droit de la notation et le nom qui
   * suit donnerait donc zéro — que le `padding` soit là ou non —, et le test serait vert dans les
   * deux cas. Ce qui se mesure ici est la déclaration elle-même, et la **symétrie** qu'elle promet :
   * l'air de droite est celui de gauche, qui est le `padding` de la flèche.
   */
  await page.getByRole('button', { name: /^order_items ·/ }).click()
  await page.getByRole('button', { name: /^users ·/ }).click({ modifiers: ['Shift'] })

  const air = await page.evaluate(() => {
    const notation = document.querySelector('[data-notation]')
    const fleche = document.querySelector('[data-fleche]')
    if (!notation || !fleche) return null
    return {
      droite: getComputedStyle(notation).paddingRight,
      gauche: getComputedStyle(fleche).paddingRight,
    }
  })

  expect(air).not.toBeNull()
  // Un écart réel, et non « 0px » : c'est le défaut lui-même.
  expect(air?.droite).not.toBe('0px')
  // Et le même des deux côtés : le trio « nom · flèche · notation » doit se lire comme un groupe.
  expect(air?.droite).toBe(air?.gauche)
})
