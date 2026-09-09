import { expect, type Locator, type Page, test } from '@playwright/test'
import { deplierUnEnvironnement, ouvrirUneConsole } from './pourLesTests'

/**
 * L'export d'un résultat de console (`API-29`) — **ce que Vitest ne peut pas juger**.
 *
 * Le geste lui-même, ses deux refus et l'issue affichée sont couverts par les tests unitaires ; la
 * sérialisation l'est par `engine::export`, valeur par valeur. Ce qui reste ici est de la **mise en
 * page** (règle n° 9) : le bouton et son menu partagent une bande de 27 px avec le contrôle des
 * vues, et rien de jsdom ne dit si l'un pousse l'autre dehors.
 */

/**
 * La bande de tête du résultat : les vues à gauche, l'export à droite.
 *
 * Visée par sa classe, comme les zones sans rôle des specs de `10e` et `10f` : ce n'est ni une
 * `toolbar` ni un `group` — elle porte un contrôle segmenté qui a déjà son nom, et lui en donner un
 * second l'aurait annoncée deux fois.
 */
function bandeDuResultat(page: Page): Locator {
  return page.locator('[class*="vues"]').first()
}

async function boite(cible: Locator) {
  const boite = await cible.boundingBox()
  if (!boite) throw new Error('élément sans boîte')
  return boite
}

async function executer(page: Page, sql: string) {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /analytics/ }).dblclick()
  await ouvrirUneConsole(page, 'analytics')
  await page.locator('.cm-content').click()
  await page.keyboard.insertText(sql)
  await page.getByRole('button', { name: /Exécuter/ }).click()
  await page.waitForSelector('[role=grid]')
  await page.evaluate(() => document.fonts.ready)
}

test('le bouton d’export tient dans la bande du résultat', async ({ page }) => {
  await executer(page, 'select id from orders')

  const bouton = page.getByRole('button', { name: /^Exporter$/ })
  const dansLaBande = await boite(bouton)
  const bande = await boite(bandeDuResultat(page))

  // Ni au-delà du bord droit de la bande, ni au-delà de celui de la fenêtre — les deux, parce qu'un
  // enfant rogné par un ancêtre en `overflow: hidden` échappe à la seconde mesure (règle n° 10).
  expect(dansLaBande.x + dansLaBande.width).toBeLessThanOrEqual(bande.x + bande.width + 1)
  expect(dansLaBande.x + dansLaBande.width).toBeLessThanOrEqual(1360)
  // Et il est bien dans la bande, non sous elle : une bande qui aurait replié son contenu sur deux
  // lignes passerait la mesure horizontale sans qu'on le voie.
  expect(dansLaBande.y).toBeGreaterThanOrEqual(bande.y - 1)
  expect(dansLaBande.y + dansLaBande.height).toBeLessThanOrEqual(bande.y + bande.height + 1)
})

/**
 * **L'issue se place *avant* le bouton, dans un groupe épinglé à droite.**
 *
 * C'est ce qui fait qu'elle ne le déplace pas tant qu'il y a de la place : `margin-left: auto` colle
 * le groupe au bord, donc l'abscisse du bouton est décidée par ce bord et non par la largeur du
 * texte. Mesuré avant et après, parce que l'inverse — une issue posée après le bouton, ou un groupe
 * aligné à gauche — le ferait sauter sous les doigts au moment où l'on vient de cliquer.
 */
test('l’issue de l’export ne déplace pas le bouton', async ({ page }) => {
  await executer(page, 'select id from orders')

  const bouton = page.getByRole('button', { name: /^Exporter$/ })
  const avant = await boite(bouton)

  await bouton.click()
  await page.getByRole('button', { name: 'Fichier CSV' }).click()
  await expect(page.getByRole('status', { name: 'Issue du dernier export' })).toBeVisible()

  const apres = await boite(bouton)
  expect(apres.x).toBeCloseTo(avant.x, 0)
  const bande = await boite(bandeDuResultat(page))
  expect(apres.x + apres.width).toBeLessThanOrEqual(bande.x + bande.width + 1)
})

/**
 * **Et quand la place manque, c'est l'issue qui se rogne** — jamais le bouton qui sort de la bande.
 *
 * # Pourquoi ce test garde des réglages et non une géométrie
 *
 * Le cas qui a besoin de cette garde est le **message d'échec** : « le fichier « … » n'a pas pu être
 * écrit : accès refusé » fait une centaine de caractères, soit plus de 600 px, dans une bande qui
 * porte déjà 250 px de contrôle segmenté et 90 px de bouton. Or il est hors de portée d'une mesure :
 *
 * - **`?demo` n'échoue jamais** — sa passerelle rend une taille plausible, comme son `runSql` rend un
 *   résultat sans rien exécuter. Un décor qui échouerait à la demande serait une variante de décor à
 *   maintenir, ce que ce dépôt refuse ailleurs pour la même raison ;
 * - **et la fenêtre ne peut pas être assez étroite.** `minWidth` vaut 960 (`tauri.conf.json`), et la
 *   bande fait la largeur de la fenêtre moins la sidebar : 731 px au plus étroit, pour un contenu qui
 *   en demande 421 avec l'issue de réussite. **Mesuré**, à cinq largeurs : rien n'est jamais sous
 *   pression, `scrollWidth` égale la largeur à chaque fois, et l'abscisse du bouton ne bouge pas d'un
 *   pixel. La forme géométrique de ce test a d'abord été écrite ainsi, et elle est restée **verte
 *   sous les trois sabotages** — `min-width`, l'ellipse, `flex: none` — parce qu'elle mesurait un
 *   décor où le défaut ne peut pas se produire (règle n° 5).
 *
 * Ce qui est gardé est donc le **réglage** qui produirait le bon comportement, sur sa valeur
 * *calculée* et non sur la déclaration (règle n° 9) — la leçon des deux tests structurels de
 * l'introspection, et de celui du `nodelay` de `russh` : quand le comportement n'est pas atteignable
 * depuis l'outillage, on garde la cause, et on dit pourquoi.
 */
test('l’issue est réglée pour se rogner, et le bouton pour ne pas se comprimer', async ({
  page,
}) => {
  await executer(page, 'select id from orders')
  await page.getByRole('button', { name: /^Exporter$/ }).click()
  await page.getByRole('button', { name: 'Fichier CSV' }).click()
  await expect(page.getByRole('status', { name: 'Issue du dernier export' })).toBeVisible()

  const reglages = await page.evaluate(() => {
    const issue = document.querySelector('[role=status][aria-label*="export"]') as HTMLElement
    const groupe = issue.parentElement as HTMLElement
    const bouton = groupe.querySelector('button') as HTMLElement
    const styleDe = (element: HTMLElement) => getComputedStyle(element)
    return {
      // Les trois qui font qu'un long texte se rogne au lieu de s'étendre.
      overflow: styleDe(issue).overflow,
      ellipse: styleDe(issue).textOverflow,
      retour: styleDe(issue).whiteSpace,
      // Sans lui, la largeur minimale automatique d'un élément flex est celle de son contenu : le
      // texte pousse alors, quoi que dise `overflow`.
      minimumDeLIssue: styleDe(issue).minWidth,
      minimumDuGroupe: styleDe(groupe).minWidth,
      // Le groupe est épinglé à droite, et le bouton refuse de se comprimer.
      margeDuGroupe: styleDe(groupe).marginLeft,
      croissanceDuBouton: styleDe(bouton).flexGrow,
      compressionDuBouton: styleDe(bouton).flexShrink,
    }
  })

  expect(reglages).toEqual({
    overflow: 'hidden',
    ellipse: 'ellipsis',
    retour: 'nowrap',
    minimumDeLIssue: '0px',
    minimumDuGroupe: '0px',
    margeDuGroupe: expect.not.stringMatching(/^0px$/),
    croissanceDuBouton: '0',
    compressionDuBouton: '0',
  })
})

/**
 * Le menu des formats est un `Popover`, donc en `position: fixed` et replacé par lui-même — c'est le
 * défaut n° 35 et son remède. Reste à constater qu'il tient dans la fenêtre depuis **ce**
 * déclencheur, qui est le plus à droite de l'écran.
 */
test('le menu des formats reste dans la fenêtre', async ({ page }) => {
  await executer(page, 'select id from orders')
  await page.getByRole('button', { name: /^Exporter$/ }).click()

  const csv = page.getByRole('button', { name: 'Fichier CSV' })
  await expect(csv).toBeVisible()
  const panneau = await boite(csv)
  expect(panneau.x).toBeGreaterThanOrEqual(0)
  expect(panneau.x + panneau.width).toBeLessThanOrEqual(1360)

  // **Réellement sous le pointeur, et pas seulement « visible » au sens de Playwright** : c'est la
  // mesure que le défaut n° 35 demande, un panneau rogné par un ancêtre restant « visible ».
  const sousLePointeur = await page.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y)
      return element?.textContent ?? null
    },
    { x: panneau.x + panneau.width / 2, y: panneau.y + panneau.height / 2 },
  )
  expect(sousLePointeur).toContain('CSV')
})
