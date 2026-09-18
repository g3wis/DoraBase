import { expect, type Page, test } from '@playwright/test'
import { deplierUnEnvironnement, ouvrirUneConsole } from './pourLesTests'

/**
 * Le résultat de la console remplit la hauteur qu'on lui donne (`API-74`).
 *
 * # Ce que ce niveau garde, et qu'aucun autre ne peut garder
 *
 * `ConsoleResult` montait sa grille avec un `viewportHeight={320}` **écrit en dur** : 320 px moins
 * les 26 px de l'en-tête collé font onze lignes, quelles que soient la fenêtre et la position de la
 * poignée — rapporté à l'usage, « always 11 rows, does not scale with available space ». Le DOM
 * était juste, les rôles aussi, le nom accessible inchangé : **une hauteur n'est ni une présence ni
 * un ordre**, et jsdom ne calcule aucune mise en page (règle n° 9). Rien de la suite unitaire ne
 * pouvait le voir, et la vitrine de la galerie moins encore — elle passe ses propres hauteurs,
 * délibérément (règle n° 8).
 *
 * # Ce qui est gardé, et pourquoi c'est la cause plutôt que la conséquence
 *
 * La conséquence visible est « onze lignes », mais la compter demanderait un décor qui en rende
 * plus de onze, quand `?demo` en rend deux — et un décor écrit pour un test mesure le décor
 * (règle n° 5). Ce qui est vrai de tout décor est le **mécanisme** : la zone défilante de la grille
 * vaut l'emplacement qu'on lui donne, au pixel. Elle vaut alors autant de lignes qu'il y tient,
 * quel que soit leur nombre.
 *
 * Et c'est une **égalité**, non un ordre de grandeur (règle n° 18). « La grille est plus haute
 * qu'avant » resterait vrai d'une constante de 400, et « elle ne dépasse pas » resterait vrai de
 * n'importe quelle valeur trop petite — c'est-à-dire du défaut lui-même.
 */

/**
 * Tout se mesure d'un seul passage, et **les repères se désignent par leur rôle**.
 *
 * Les classes d'un module CSS sont hachées. L'emplacement de la grille est, par construction, le
 * parent de la grille — c'est la définition même de « la place qu'on lui donne » —, et la zone
 * défilante est le `presentation` que `VirtualGrid` pose pour porter le débordement : c'est elle
 * que `viewportHeight` règle, donc elle qu'il faut mesurer plutôt que la racine, dont la hauteur ne
 * fait que suivre.
 */
async function mesurer(page: Page) {
  return await page.evaluate(() => {
    const grille = document.querySelector('[role=grid]')
    const barre = document.querySelector('[role=status]')
    if (grille === null || barre === null) throw new Error('la grille et sa barre doivent être là')

    const emplacement = grille.parentElement
    if (emplacement === null) throw new Error('la grille doit avoir un emplacement')

    const zone = grille.querySelector('[role=presentation]')
    if (zone === null) throw new Error('la grille doit porter sa zone défilante')

    const lignes = [...grille.querySelectorAll('[role=row]')]
    const derniere = lignes.at(-1)
    if (derniere === undefined) throw new Error('le résultat doit porter au moins une ligne')

    const rond = (valeur: number) => Math.round(valeur)
    return {
      emplacement: rond(emplacement.getBoundingClientRect().height),
      zone: rond(zone.getBoundingClientRect().height),
      basDeLaGrille: rond(grille.getBoundingClientRect().bottom),
      basDeLaDerniereLigne: rond(derniere.getBoundingClientRect().bottom),
      basDeLEmplacement: rond(emplacement.getBoundingClientRect().bottom),
      hautDeLaBarre: rond(barre.getBoundingClientRect().top),
      basDeLaBarre: rond(barre.getBoundingClientRect().bottom),
      fenetre: window.innerHeight,
    }
  })
}

type Mesure = Awaited<ReturnType<typeof mesurer>>

/**
 * **Le contrôle positif, et il porte le décor.** `?demo` rend deux lignes : si elles remplissaient
 * l'emplacement, l'égalité serait vraie sans rien prouver — il n'y aurait aucun vide à combler, et
 * la constante de 320 px aurait pu y tenir aussi.
 *
 * Il se mesure sur une quantité **que le défaut ne déplace pas** : le bas de la dernière ligne, qui
 * dépend du nombre de lignes et du pas, non de la hauteur de la zone (règle n° 1, le corollaire
 * d'`API-62` — un contrôle qui bouge avec le défaut tombe à la place de l'assertion qu'il doit
 * laisser parler).
 */
function ilResteDeLaPlaceSousLesLignes(m: Mesure) {
  expect(m.basDeLaDerniereLigne).toBeLessThan(m.basDeLEmplacement)
}

/** Jusqu'à la requête écrite, mais **sans l'exécuter** : un test pose son guetteur avant. */
async function ouvrirEtEcrire(page: Page) {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await ouvrirUneConsole(page, 'analytics')
  await page.waitForSelector('.cm-content')
  await page.locator('.cm-content').click()
  await page.keyboard.insertText('select * from ventes')
}

async function executer(page: Page) {
  await page
    .getByRole('button', { name: /Exécuter|Run/ })
    .first()
    .click()
  await page.getByRole('grid').waitFor()
  await page.evaluate(() => document.fonts.ready)
}

test.beforeEach(async ({ page }) => {
  await ouvrirEtEcrire(page)
  await executer(page)
})

test('la grille remplit l’emplacement qu’on lui donne', async ({ page }) => {
  const m = await mesurer(page)
  ilResteDeLaPlaceSousLesLignes(m)

  // **L'égalité qui mord.** La constante laissait 130 px de vide entre la dernière ligne et la
  // barre de chiffres, sur une fenêtre de 860 px.
  expect(m.zone).toBe(m.emplacement)

  // Et la conséquence quand même, parce que c'est elle qu'on subit : rien de la grille ne se peint
  // sous la barre de chiffres. Sur une fenêtre haute, c'est du vide ; sur une fenêtre courte, ce
  // sont des lignes qu'aucun geste n'atteint (voir plus bas).
  expect(m.basDeLaGrille).toBeLessThanOrEqual(m.hautDeLaBarre)
})

test('elle suit la poignée du partage', async ({ page }) => {
  const avant = await mesurer(page)
  ilResteDeLaPlaceSousLesLignes(avant)

  // **La poignée du partage qui porte le résultat**, désignée par ce qu'elle sépare et non par sa
  // place. L'orientation ne suffit pas : la sidebar porte elle aussi un partage empilé, donc un
  // second séparateur horizontal, et les deux ensemble rendent la résolution ambiguë. Le partage
  // cherché est celui qui porte une telle poignée **en enfant direct** et la grille quelque part
  // dessous ; il n'y en a qu'un.
  //
  // Au clavier plutôt qu'au glissement : un pas de flèche est un geste complet et déterministe, là
  // où un glissement dépend du pixel visé.
  const poignee = page
    .locator(':has(> [role=separator][aria-orientation=horizontal]):has([role=grid])')
    .locator('> [role=separator]')
  await poignee.focus()
  for (let pas = 0; pas < 6; pas += 1) await poignee.press('ArrowDown')

  // **Le contrôle positif du geste** : l'emplacement a bel et bien changé. Sans lui, une poignée
  // qui ne bougerait pas rendrait l'égalité ci-dessous vraie pour la mauvaise raison — c'est
  // exactement l'état que le défaut décrit, un résultat qui ne suit rien.
  await expect.poll(async () => (await mesurer(page)).emplacement).toBeLessThan(avant.emplacement)

  // **En `poll`, et ce n'est pas une précaution** (règle n° 15). Le contrôle ci-dessus rend la main
  // dès que l'emplacement a rétréci ; la grille, elle, ne suit qu'au rendu que l'observateur
  // déclenche, soit une trame plus tard. Une lecture sèche daterait la mesure de l'instant où
  // l'emplacement seul avait bougé — mesuré, elle tombe une fois sur deux.
  //
  // L'écart plutôt que les deux valeurs : on ne sait pas d'avance où la poignée s'arrête, et zéro
  // est l'égalité qu'on veut (règle n° 18). Un échec dit de combien la grille reste en arrière.
  await expect
    .poll(async () => {
      const apres = await mesurer(page)
      return apres.zone - apres.emplacement
    })
    .toBe(0)

  const apres = await mesurer(page)
  expect(apres.basDeLaGrille).toBeLessThanOrEqual(apres.hautDeLaBarre)
})

/**
 * **Une fenêtre courte, et c'est l'autre moitié du défaut.** La constante était *trop grande* ici :
 * l'emplacement faisait 110 px pendant que la grille en déclarait 320, donc elle se peignait sous
 * la barre de chiffres et 196 px au-delà du bord de la fenêtre. Ces lignes-là n'étaient atteignables
 * par aucun geste — ni molette, ni clavier, la racine ne défilant pas.
 *
 * Rapetisser la fenêtre plutôt que rendre mille lignes : la propriété est vraie de toute hauteur, et
 * un décor long ferait dépendre le test des allers-retours de son chargement (la leçon d'`API-62`).
 */
test.describe('sur une fenêtre courte', () => {
  test.use({ viewport: { width: 1100, height: 520 } })

  test('rien de la grille ne passe sous la barre de chiffres', async ({ page }) => {
    const m = await mesurer(page)

    // Le contrôle positif porte ici sur le décor : la barre est dans la fenêtre, donc « sous la
    // barre » veut dire quelque chose. Une fenêtre où elle serait déjà sortie rendrait l'assertion
    // suivante vraie sans rien garder.
    //
    // C'est son **haut** qu'on mesure, et non son bas : la coquille dépasse d'un pixel de la
    // fenêtre — `scrollHeight` vaut `clientHeight + 1` jusqu'au `body`, mesuré avant ce chantier
    // comme après, donc étranger à ce qu'on garde ici. Le borner au bas ferait tomber le contrôle
    // sur un défaut qui n'est pas le sien.
    expect(m.hautDeLaBarre).toBeLessThan(m.fenetre)

    expect(m.zone).toBe(m.emplacement)
    expect(m.basDeLaGrille).toBeLessThanOrEqual(m.hautDeLaBarre)
  })
})

/**
 * **La hauteur est la bonne dès le premier rendu**, et cela se mesure.
 *
 * La mesure vit dans une ref de rappel, appelée pendant le commit, plutôt que dans le seul
 * `ResizeObserver`, qui ne rend la sienne qu'après la peinture. Sans cette lecture immédiate, la
 * zone défilante prend **deux** hauteurs à chaque ouverture de résultat — celle du repli, puis la
 * bonne : relevé `400px` puis `450px`. C'est un saut d'une trame, qu'aucune assertion de géométrie
 * prise après coup ne peut voir, toutes arrivant une fois la seconde valeur posée.
 *
 * Ce qui est gardé est donc la **suite** des hauteurs, et non la dernière : il n'y en a qu'une.
 */
test('elle n’est jamais rendue à sa hauteur de repli', async ({ page }) => {
  await ouvrirEtEcrire(page)

  // Le guetteur est posé **avant** l'exécution : c'est le montage de la grille qu'on regarde, et il
  // n'a pas encore eu lieu. Toute hauteur écrite sur la zone défilante est relevée, dans l'ordre, et
  // les répétitions sont écartées — c'est le nombre de valeurs *distinctes* qui dit le saut.
  await page.evaluate(() => {
    const vues: string[] = []
    ;(window as unknown as { hauteursVues: string[] }).hauteursVues = vues
    const relever = () => {
      const zone = document.querySelector<HTMLElement>('[role=grid] [role=presentation]')
      if (zone !== null && vues.at(-1) !== zone.style.height) vues.push(zone.style.height)
    }
    new MutationObserver(relever).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style'],
    })
  })

  await executer(page)
  const m = await mesurer(page)

  // **Le contrôle positif, et il porte le décor** : la hauteur de repli du crochet est 400 px, donc
  // un emplacement qui vaudrait justement 400 rendrait l'assertion suivante vraie sans rien garder
  // — le repli *serait* la bonne réponse, et le saut qu'on cherche n'existerait pas.
  expect(m.emplacement).not.toBe(400)

  const vues = await page.evaluate(
    () => (window as unknown as { hauteursVues: string[] }).hauteursVues,
  )
  expect(vues).toEqual([`${m.emplacement}px`])
})
