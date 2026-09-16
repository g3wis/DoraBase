import { expect, type Page, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

/**
 * Le panneau gauche défile (`API-62`).
 *
 * # Ce que ce niveau garde, et qu'aucun autre ne peut garder
 *
 * Le défaut ne vivait dans aucun composant : `Sidebar` déclarait bien son `overflow-y: auto`, et
 * `SplitPane` sa colonne — chacun juste dans sa vitrine (règle n° 8). Ce qui manquait était le
 * `min-height: 0` du panneau **souple** d'un partage vertical, sans quoi il grandit avec son contenu
 * au lieu de le laisser défiler. Cela ne se voit qu'en mesurant un rendu, donc hors de portée de
 * Vitest (règle n° 9) — et cela ne se voit qu'**assemblé**, la sidebar de l'écran de travail étant le
 * seul endroit du produit où un `SplitPane` vertical porte une zone défilante.
 *
 * **Une fenêtre courte plutôt qu'un arbre long**, et c'est un choix de décor. La propriété demandée
 * est « l'arbre défile dans la hauteur qu'on lui laisse, quelle qu'elle soit » : la faire mordre en
 * dépliant vingt nœuds ferait dépendre le test des allers-retours de chargement du décor, quand
 * rapetisser la fenêtre la fait mordre d'un seul geste et sans attente.
 */
test.use({ viewport: { width: 1360, height: 340 } })

type Mesure = {
  arbre: number
  zoneClient: number
  zoneScroll: number
  zoneApresDefilement: number
  racineClient: number
  racineScroll: number
  instances: number
  basDesInstances: number
  hauteurDeLaFenetre: number
}

/**
 * Tout se mesure d'un seul passage, et **les deux repères se désignent par leur rôle**, non par leur
 * place dans le DOM.
 *
 * Les classes d'un module CSS sont hachées, et compter les parents ferait dépendre le test de la
 * profondeur d'imbrication de deux composants qui n'ont rien promis là-dessus. Ce qu'on cherche est
 * « l'ancêtre qui défile » d'un côté, « celui qui porte la poignée du partage » de l'autre : c'est
 * ce que les deux boucles disent, et elles survivront à une coquille de plus.
 */
async function mesurer(page: Page): Promise<Mesure> {
  return await page.evaluate(() => {
    const arbre = document.querySelector('[role=tree][aria-label^="Projets"]')
    const instances = document.querySelector('[role=tree][aria-label="Instances"]')
    if (arbre === null || instances === null) throw new Error('les deux zones doivent être rendues')

    let zone = arbre.parentElement
    while (zone !== null && !['auto', 'scroll'].includes(getComputedStyle(zone).overflowY)) {
      zone = zone.parentElement
    }
    if (zone === null) throw new Error('aucune zone défilante au-dessus de l’arbre')

    let racine: HTMLElement | null = zone
    while (racine !== null && racine.querySelector(':scope > [role=separator]') === null) {
      racine = racine.parentElement
    }
    if (racine === null) throw new Error('aucun partage au-dessus de la zone défilante')

    // Le panneau qui porte la zone d'instances est le dernier enfant du partage ; sa hauteur est
    // celle que le `SplitPane` lui a réglée, indépendante du défaut qu'on mesure.
    const panneauDesInstances = racine.lastElementChild as HTMLElement

    zone.scrollTop = 99999
    const zoneApresDefilement = zone.scrollTop
    zone.scrollTop = 0

    return {
      arbre: Math.round(arbre.getBoundingClientRect().height),
      zoneClient: zone.clientHeight,
      zoneScroll: zone.scrollHeight,
      zoneApresDefilement,
      racineClient: racine.clientHeight,
      racineScroll: racine.scrollHeight,
      instances: Math.round(panneauDesInstances.getBoundingClientRect().height),
      basDesInstances: Math.round(instances.getBoundingClientRect().bottom),
      hauteurDeLaFenetre: window.innerHeight,
    }
  })
}

/**
 * **Le contrôle positif, et il porte le décor.** Sans lui, un arbre qui tiendrait dans la fenêtre
 * rendrait tout le fichier vert sans rien prouver : une zone qui n'a rien à faire défiler ne défile
 * pas, et c'est correct.
 *
 * Il se mesure sur des quantités **que le défaut ne déplace pas** — la hauteur de l'arbre, celle du
 * panneau d'instances réglée par le partage, et la hauteur de la colonne. Comparer l'arbre à la zone
 * défilante aurait été circulaire : c'est la zone qui grandissait, donc le contrôle serait tombé à
 * la place de l'assertion qu'il doit laisser parler (vérifié par sabotage).
 */
function leDecorDemandePlusQueLaColonneNEnA(m: Mesure) {
  expect(m.arbre + m.instances).toBeGreaterThan(m.racineClient)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await page.getByRole('tree', { name: 'Instances' }).waitFor()
  await deplierUnEnvironnement(page)
  await page.evaluate(() => document.fonts.ready)
})

test('l’arbre défile dans la hauteur qu’on lui laisse', async ({ page }) => {
  const m = await mesurer(page)
  leDecorDemandePlusQueLaColonneNEnA(m)

  // Ce que le défaut retirait : la zone valait exactement son contenu, donc son `overflow-y: auto`
  // n'avait rien à faire défiler. `client === scroll` était la signature du défaut.
  expect(m.zoneScroll).toBeGreaterThan(m.zoneClient)

  // **Une égalité, non un ordre de grandeur** (règle n° 18) : arrivé en bas, le décalage vaut ce qui
  // dépasse, au pixel. `> 0` resterait vrai d'une zone qui ne défilerait que de moitié.
  expect(m.zoneApresDefilement).toBe(m.zoneScroll - m.zoneClient)
})

test('la molette fait défiler l’arbre', async ({ page }) => {
  leDecorDemandePlusQueLaColonneNEnA(await mesurer(page))

  // C'est le geste du signalement — « l'arbre est coupé, et la molette ne fait rien ». Le mesurer
  // plutôt que de le déduire de `scrollHeight` garde au passage le refus du zoom d'`API-57` : il ne
  // doit avaler que `wheel` + `ctrlKey`, jamais une molette nue.
  await page.getByRole('tree', { name: /^Projets/ }).hover()
  await page.mouse.wheel(0, 200)

  // Une lecture sèche daterait la mesure du mauvais instant (règle n° 15) : le défilement est peint
  // au rendu suivant.
  await expect.poll(async () => (await mesurer(page)).zoneApresDefilement).toBeGreaterThan(0)
})

test('la colonne ne déborde pas, et la zone « Instances » reste atteignable', async ({ page }) => {
  const m = await mesurer(page)
  leDecorDemandePlusQueLaColonneNEnA(m)

  // **L'égalité qui mord.** Le panneau souple prenait 760 px dans un conteneur de 379 : la racine du
  // partage débordait de tout ce que l'arbre dépassait, et ce débord poussait la zone d'en dessous
  // hors de l'écran. On garde ici la **cause** — rien ne dépasse —, qui vaut pour toute hauteur de
  // fenêtre, là où le débord mesuré dépend de celle du jour.
  expect(m.racineScroll).toBe(m.racineClient)

  // Et la conséquence quand même, parce que c'est elle qu'on subit : la zone « Instances » est la
  // dernière de la colonne, donc la première à sortir par le bas. Elle porte le `+` qui fait exister
  // une instance — hors de l'écran, il n'y a plus de geste pour y revenir.
  expect(m.basDesInstances).toBeLessThanOrEqual(m.hauteurDeLaFenetre)
})
