import { expect, test } from '@playwright/test'

// **Trois références régénérées le 19 août 2026**, en remplaçant les `<select>` natifs par la liste
// déroulante maison (« pas de composant natif » — décision de ce jour). L'écart mesuré valait
// 387 pixels sur 1,1 million, tous dans le texte des deux champs de liste ; il est tombé à 90 en
// retirant le remplissage `1px 6px` que Chromium pose sur tout `<button>`, et le reste tient à la
// rastérisation des glyphes dans un `<button>` plutôt que dans un `<select>`.
//
// **Régénérées une seconde fois le 19 août**, pour un libellé : « Variante d'environnement » est
// devenu « Environnement » (`23d`). Le mot « variante » décrivait le modèle que `23b` a retiré — une
// base déclinée en plusieurs environnements — et le garder aurait nommé une chose qui n'existe plus.
// L'écart mesuré valait 249 pixels, tous dans ce libellé, et le diff l'a confirmé avant régénération.
//
// **Trois références régénérées le 25 août 2026** — `a2-nouvelle-connexion`, `a2-tunnel` et
// `a3-echec`, et **elles seules** : `a1-accueil` et `a1-etape-projet` sont inchangées au pixel, parce
// que `A1` n'a ni centre de barre de titre ni sidebar. Les trois autres se capturent **par-dessus la
// démo** (seul décor où les deux étapes s'enchaînent), donc elles montrent l'écran de travail derrière
// la modale — et c'est lui qui a changé, pour trois causes visibles dans le diff et vérifiées avant
// régénération :
//
//   1. la barre de titre perd son centre et sa liste « ENV » (`25b`) — rien n'est sélectionné dans la
//      démo au chargement, donc le centre est vide, et la barre ne bouge pas d'un pixel ;
//   2. la colonne de gauche passe de 212 à 228 px (`25a`), ce qui déplace les deux actions du pied ;
//   3. les lignes projet perdent leur badge d'environnement et comptent « n connexions » et non
//      « n bases » (`25a`, `23b`).
//
// 977 pixels d'écart sur 1,1 million pour `A2`, 504 pour `A3`, tous dans ces trois zones. Une capture
// qu'on rafraîchit sans le dire cesse d'être une référence.
//
// **Les cinq références régénérées le 10 septembre 2026** (`API-46`), pour deux causes qui se
// distinguent dans les diffs, chacune à l'abscisse attendue :
//
//   1. le bouton des préférences a quitté le coin droit de la barre de titre pour la bande en tête de
//      la sidebar, à côté du « + ». C'est ce qui bouge entre x=41 et x=213, la bande, dans
//      `a2-nouvelle-connexion`, `a2-tunnel` et `a3-echec` ;
//   2. le glyphe des préférences n'est plus l'engrenage mais `slid`, deux curseurs : à 14 px, les huit
//      dents du rouage se rejoignaient en un anneau où rien ne disait « réglages » (vu à la loupe, à
//      `deviceScaleFactor` élevé). Il change donc **partout où les préférences se nomment**, dont la
//      barre de titre de l'accueil — 47 et 24 pixels dans `a1-accueil` et `a1-etape-projet`, tous
//      dans la boîte de 13 px du bouton, x=1330..1342.
//
// **Et une troisième cause est née de la rencontre avec `API-47`**, arrivé le même jour : le centre
// de la barre — logo compris — est centré dans la place que lui laissent ses voisins, et l'écran de
// travail n'a plus de zone d'actions à sa droite. Le logo y est donc **treize pixels plus à droite
// que sur l'accueil**, la moitié des 26 px du bouton disparu (mesuré : 696 contre 683). C'est ce qui
// fait bouger la rangée du haut jusqu'à x=1341 dans les trois références qui montrent l'écran de
// travail derrière la modale. Deux écrans, deux abscisses de logo : la conséquence est assumée — un
// emplacement réservé pour un bouton absent serait la boîte fantôme que ce fichier refuse déjà pour
// le centre, et personne ne voit les deux écrans à la fois.
//
// `a1-accueil` **garde son bouton là où il était** : cet écran n'a pas d'arborescence, donc pas de
// bande où le mettre. Si son diff avait porté ailleurs que sur le glyphe, c'est que le retrait de la
// barre était allé trop loin.
//
// **La géométrie, elle, a été vérifiée au chiffre avant de toucher aux références** : même abscisse de
// texte, même corps, valeur centrée dans un champ de 30 px, boîtes de 32 et 19 px inchangées — ce que
// les mesures de `a2-nouvelle-connexion` et `a4-barre-de-titre` affirment indépendamment. Une capture
// régénérée sans cette vérification n'aurait plus rien gardé.

test('A1 est conforme à la référence', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
  await expect(page).toHaveScreenshot('a1-accueil.png', { fullPage: true })
})

// La modale de `A2` par-dessus `A1`, capturée comme référence de la même façon. Elle inclut
// la barre de titre ternie derrière, qui fait partie de l'écran.
//
// **Ces captures montrent l'état « aucun projet »**, celui d'une application neuve — et non celui
// du mockup, qui montre un `Select` rempli. L'écart existait avant `08f` (le sélecteur disait
// « Aucun projet ») ; depuis, il porte en plus le champ « Nom du nouveau projet », que le handoff
// ne maquette pas. Les références ont donc été **régénérées délibérément** le 10 août 2026 : une
// capture qu'on rafraîchit sans le dire cesse d'être une référence.
//
// **Les trois feux ne sont pas dans la capture** : ils sont dessinés par macOS par-dessus la
// fenêtre, hors du DOM et hors de portée de Playwright comme du CSS. Le mockup les grise ;
// nous ne pouvons pas — écart consigné dans `AGENTS.md`.
// **Les trois captures suivantes ont changé de décor le 19 août 2026** (`24d`). Le bouton de `A1`
// ouvrait `A2` ; il ouvre maintenant l'étape 1 du parcours de création. Par-dessus `A1`, c'est donc
// l'étape 1 qui se capture — et c'est juste : c'est ce que ce bouton fait. `A2` et `A3`, eux, se
// capturent depuis la démo, seul décor où les deux étapes s'enchaînent (`create_project` est une
// commande Tauri, qui ne répond pas dans un navigateur).
test('l’étape 1 par-dessus A1 est conforme à la référence', async ({ page }) => {
  await page.goto('/')
  await page
    .getByRole('button', { name: /Nouveau projet/ })
    .first()
    .click()
  await page.waitForSelector('[role=dialog][aria-label="Nouveau projet"]')
  await page.evaluate(() => document.fonts.ready)
  await expect(page).toHaveScreenshot('a1-etape-projet.png', { fullPage: true })
})

/** Les deux étapes, jusqu'à `A2` — dans la démo, où la création répond. */
async function allerAA2(page: import('@playwright/test').Page) {
  await page.goto('/?demo')
  await page.getByRole('button', { name: /Nouveau projet/ }).click()
  // **Un nom que le décor ne porte pas.** Le projet de la démo s'appelle « Atelier Nord » depuis la
  // relecture du 19 août 2026 ; créer un homonyme fait refuser la création — à juste titre — et le
  // bouton « Continuer » reste désactivé. Vingt-quatre tests sont tombés d'un coup sur ce point, tous
  // pour la même raison.
  await page.getByLabel('Nom du projet').fill('Comptoir Sud')
  await page.getByRole('button', { name: /Continuer/ }).click()
  await page.waitForSelector('[data-testid=projet-de-la-modale]')
  await page.evaluate(() => document.fonts.ready)
}

test('A2 est conforme à la référence', async ({ page }) => {
  await allerAA2(page)
  await expect(page).toHaveScreenshot('a2-nouvelle-connexion.png', { fullPage: true })
})

// Le panneau proxy / tunnel déplié et renseigné, comme le mockup le montre. Capturé
// séparément parce que `A2` s'ouvre panneau replié : les deux états méritent une référence.
test('A2 avec le panneau tunnel est conforme à la référence', async ({ page }) => {
  await allerAA2(page)
  await page.getByRole('button', { name: /Proxy \/ tunnel/ }).click()
  await page.getByLabel('Hôte du bastion').fill('bastion.exemple.net')
  await page.getByLabel('Clé privée').fill('~/.ssh/id_ed25519')
  // Le focus reste sur le dernier champ rempli, et son anneau entrerait dans la référence :
  // celle-ci dépendrait alors de l'ordre de remplissage. Un `blur` la rend déterministe.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.evaluate(() => document.fonts.ready)
  await expect(page).toHaveScreenshot('a2-tunnel.png', { fullPage: true })
})

// `A3` — la sous-modale d'échec.
//
// Le message d'erreur est **rendu déterministe**, et c'est délibéré : sans cela, l'échec réel du
// pont dans le navigateur de Playwright inscrirait « Cannot read properties of undefined » dans
// la référence, qui casserait à la prochaine montée de version de Tauri ou du navigateur — pour
// une raison qui n'a rien à voir avec l'écran. Le chemin d'échec *réel* est couvert par les
// tests de `a2-nouvelle-connexion.spec.ts`, qui n'assènent pas le texte.
//
// Le message posé ici est celui de `06e` pour un hôte absent de `known_hosts` : le cas où la
// distinction « ça dit la manœuvre » compte le plus.
test('A3 est conforme à la référence', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: () =>
          Promise.reject({
            code: null,
            position: null,
            message:
              'le bastion bastion.exemple.net n’est pas dans ~/.ssh/known_hosts : DoraBase refuse de s’y connecter sans l’avoir déjà vu. Lancez « ssh bastion.exemple.net » une fois pour enregistrer sa clé, puis réessayez',
          }),
        transformCallback: (f: unknown) => f,
      },
      configurable: true,
    })
  })
  await allerAA2(page)
  await page.getByRole('button', { name: /Tester la connexion/ }).click()
  await page.waitForSelector('[role=dialog][aria-label="Connexion impossible"]')
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.evaluate(() => document.fonts.ready)
  await expect(page).toHaveScreenshot('a3-echec.png', { fullPage: true })
})

/**
 * **L'engrenage de `A1` ouvre les préférences** (26 août 2026).
 *
 * Il ne faisait rien : `WelcomeScreen` montait la barre sans `onOpenPreferences`, donc `TitleBar`
 * retombait sur son `disabled` — et l'infobulle renvoyait vers l'écran de travail, qui n'existe pas
 * tant qu'aucun projet n'est déclaré. Le premier écran du produit avait un réglage inatteignable.
 *
 * **Et le test part de `/`**, non de la galerie : c'est exactement le défaut que la galerie ne peut
 * pas voir — le composant était juste dans sa vitrine, c'est l'assemblage qui manquait.
 */
test('depuis l’accueil, l’engrenage ouvre les préférences', async ({ page }) => {
  await page.goto('/')
  const engrenage = page.getByRole('button', { name: 'Préférences' })
  await expect(engrenage).toBeEnabled()
  await engrenage.click()
  await expect(page.getByRole('dialog', { name: 'Préférences' })).toBeVisible()
})
