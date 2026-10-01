import { expect, test } from '@playwright/test'

/*
 * La coquille sous Windows : les trois boutons de fenêtre, la barre sans le dégagement des feux,
 * et les libellés de raccourci en `Ctrl+`.
 *
 * # Pourquoi ce fichier tourne contre son propre serveur
 *
 * `__APP_PLATFORM__` est posé à la **construction** par `vite.config.ts`, comme la version : une
 * détection à l'exécution serait fausse dans une webview. Le projet `windows` de
 * `playwright.config.ts` démarre donc un second `pnpm dev` avec
 * `DORABASE_PLATEFORME_DECOR=windows`, et ce fichier est le seul qu'il exécute
 * (`testMatch: /\.windows\.spec\.ts$/`).
 *
 * # Pourquoi aucune capture de fidélité ici
 *
 * Les références portent le suffixe de plateforme (`-darwin.png`) et ce job tourne sur macOS :
 * une capture prise ici serait comparée à une référence macOS et échouerait sur un écart voulu.
 * Le rendu Windows se lit **à l'œil sur une machine Windows** — c'est dans la liste de ce
 * qu'aucun outil ne peut voir, dans AGENTS.md. Ce fichier mesure la **structure** et la
 * **géométrie**, jamais les pixels.
 *
 * # Et pourquoi il part de `/`
 *
 * Règle 8 d'AGENTS.md : un composant juste dans sa vitrine ne prouve rien de l'assemblage. Les
 * tests unitaires de `TitleBar.windows.test.tsx` montent le composant ; celui-ci charge
 * l'application.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('[data-tauri-drag-region]')
  await page.evaluate(() => document.fonts.ready)
})

/** La barre de titre, désignée par sa zone de glissement — le seul élément qui la porte. */
const BARRE = '[data-tauri-drag-region]'

test('la barre porte les trois boutons de fenêtre, dans l’ordre de Windows', async ({ page }) => {
  const barre = page.locator(BARRE).first()

  // Les noms sont **ancrés** : `/Fermer/` seul attraperait « Fermer l'onglet » le jour où il
  // existe (règle d'AGENTS.md sur les noms accessibles).
  await expect(barre.getByRole('button', { name: /^Réduire$/ })).toHaveCount(1)
  await expect(barre.getByRole('button', { name: /^Agrandir$/ })).toHaveCount(1)
  await expect(barre.getByRole('button', { name: /^Fermer$/ })).toHaveCount(1)

  // L'ordre compte : réduire, agrandir, fermer — et fermer **au bord**. L'inverser ferait
  // fermer la fenêtre à qui vise la réduction.
  const noms = await barre
    .getByRole('button')
    .evaluateAll((boutons) => boutons.map((bouton) => bouton.getAttribute('aria-label')))
  expect(noms.slice(-3)).toEqual(['Réduire', 'Agrandir', 'Fermer'])
})

/**
 * **Une seule barre, pas deux.**
 *
 * C'est tout l'enjeu de `decorations: false` : sans lui, Windows dessine sa propre barre
 * au-dessus de la nôtre — 72 px de chrome pour 40 px d'information, et « DoraBase » deux fois.
 * Ce test ne peut pas voir la barre du système (elle est hors de la page), mais il peut voir que
 * la nôtre est unique et à sa hauteur, ce qui est la moitié mesurable du fait.
 */
test('la barre reste unique et à la hauteur du handoff', async ({ page }) => {
  await expect(page.locator(BARRE)).toHaveCount(1)

  // **La valeur *calculée*, pas le rectangle** — et ce test a d'abord échoué pour l'avoir oublié
  // (règle 9 d'AGENTS.md, prise en flagrant délit le 31 août 2026). `.root` porte
  // `box-sizing: content-box` et un filet bas d'un pixel : `getBoundingClientRect()` rend donc
  // **41**, la boîte de contenu plus la bordure. Les 40 px du handoff sont la hauteur déclarée,
  // et c'est elle qu'il faut lire — mesurer le rectangle aurait figé un 41 qui mêle deux
  // décisions, et qui bougerait si le filet changeait d'épaisseur.
  const hauteur = await page
    .locator(BARRE)
    .first()
    .evaluate((element) => getComputedStyle(element).height)
  expect(hauteur).toBe('40px')
})

/**
 * Le dégagement des feux tombe.
 *
 * Les 78 px de `padding-left` dégagent les trois feux de macOS, **à gauche**. Sous Windows les
 * contrôles sont à droite et ce sont les nôtres : garder le retrait laisserait un trou que rien
 * n'occupe. Mesuré sur la valeur **calculée** et non sur le rectangle — celui-ci inclut les
 * bordures et masquerait l'écart derrière un arrondi (règle 9 d'AGENTS.md).
 */
test('le retrait des feux n’est plus là, et la barre est symétrique', async ({ page }) => {
  const { gauche, droite } = await page
    .locator(BARRE)
    .first()
    .evaluate((element) => {
      const calcule = getComputedStyle(element)
      return { gauche: calcule.paddingLeft, droite: calcule.paddingRight }
    })

  expect(gauche).not.toBe('78px')
  expect(gauche).toBe(droite)
})

/**
 * Les boutons sont **réellement sous le pointeur**, pas seulement présents dans la mise en page.
 *
 * `elementFromPoint` est la seule mesure qui distingue les deux — c'est la leçon du défaut n° 35,
 * où un panneau « visible » au sens de Playwright était rogné par un ancêtre en
 * `overflow: hidden`. Ici le risque est le même dans l'autre sens : la zone de glissement de la
 * fenêtre couvre toute la barre, et un ordre d'empilement malheureux la mettrait **par-dessus**
 * les boutons — qui seraient alors parfaitement visibles et impossibles à cliquer.
 */
test('les trois boutons sont cliquables, pas seulement visibles', async ({ page }) => {
  for (const nom of ['Réduire', 'Agrandir', 'Fermer']) {
    const bouton = page
      .locator(BARRE)
      .first()
      .getByRole('button', { name: new RegExp(`^${nom}$`) })
    const boite = await bouton.boundingBox()
    expect(boite, `${nom} doit avoir une boîte`).not.toBeNull()
    if (boite === null) continue

    const auPoint = await page.evaluate(
      ([x, y]) => {
        const element = document.elementFromPoint(x as number, y as number)
        return element?.closest('button')?.getAttribute('aria-label') ?? null
      },
      [boite.x + boite.width / 2, boite.y + boite.height / 2],
    )
    expect(auPoint, `au centre de « ${nom} », c'est « ${nom} » qui répond`).toBe(nom)
  }
})

/**
 * Les libellés de raccourci portent `Ctrl+`, et plus aucun `⌘`.
 *
 * **C'est la moitié qui se voit d'un raccourci porté.** L'autre — que la frappe réponde — est
 * couverte par `plateforme.test.ts` et par les tests unitaires ; un libellé faux, lui, ne se
 * mesure qu'à l'écran. Un `⌘` restant ici voudrait dire qu'une chaîne a échappé au composeur.
 */
test('aucun ⌘ ne subsiste à l’écran, et le raccourci de A1 est en Ctrl+', async ({ page }) => {
  // **Deux boutons « Nouveau dossier » sur `A1`**, et un seul porte le rappel : celui du héros.
  // `.first()` attrapait l'autre — mesuré le 31 août 2026 —, ce qui aurait fait échouer le test
  // sur un rendu parfaitement juste. Le rappel est un `<span aria-hidden>` dans le bouton, donc
  // il est dans son texte sans être dans son nom accessible : c'est par le **texte** qu'on le
  // désigne.
  const bouton = page.getByRole('button', { name: /Nouveau dossier/i }).filter({
    hasText: 'Ctrl+N',
  })
  await expect(bouton).toHaveCount(1)

  const texte = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  expect(texte).not.toContain('⌘')
  expect(texte).not.toContain('⇧')
})
