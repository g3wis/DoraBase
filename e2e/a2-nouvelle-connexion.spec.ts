import { expect, test } from '@playwright/test'

// `08b` est presque entièrement une spec de **mise en page**, donc presque entièrement hors de
// portée de Vitest : jsdom ne calcule aucun layout, et une grille dont les colonnes ne
// s'alignent pas y passe tous les tests unitaires. Les mesures ci-dessous sont la vérification
// principale de cette spec, pas un complément.
//
// **L'écran est atteint par les deux étapes du parcours** (`24d`). Le bouton de `A1` ouvrait
// directement cette modale, du temps où elle savait créer un projet au passage (`08f`) ; il ouvre
// maintenant l'étape 1, et `A2` est l'étape 2. Le chemin a changé, les mesures non — et c'est
// précisément ce que ce passage vérifie en s'y rendant.
test.beforeEach(async ({ page }) => {
  // **Par la démo, où le parcours répond.** `create_project` est une commande Tauri : sur `/`, l'étape 1
  // refuse hors de la webview, et l'étape 2 — c'est-à-dire cet écran — serait inatteignable. La démo
  // fournit sa propre création (`24d`), donc les deux étapes s'enchaînent.
  await page.goto('/?demo')
  await page.getByRole('button', { name: /Nouveau projet/ }).click()
  // Étape 1 : un nom suffit, les environnements arrivant préremplis du trio de `23a`.
  // **Un nom que le décor ne porte pas.** Le projet de la démo s'appelle « Atelier Nord » depuis la
  // relecture du 19 août 2026 ; créer un homonyme fait refuser la création — à juste titre — et le
  // bouton « Continuer » reste désactivé. Vingt-quatre tests sont tombés d'un coup sur ce point, tous
  // pour la même raison.
  await page.getByLabel('Nom du projet').fill('Comptoir Sud')
  await page.getByRole('button', { name: /Continuer/ }).click()
  // Étape 2 : la modale de connexion, projet imposé.
  await page.waitForSelector('[data-testid=projet-de-la-modale]')
  await page.evaluate(() => document.fonts.ready)
})

/** Le rectangle d'un champ, désigné par son étiquette. */
async function boite(page: import('@playwright/test').Page, etiquette: string) {
  return page.evaluate((nom) => {
    // **Deux façons d'être étiqueté, depuis que les listes ne sont plus natives.** Un `<input>` garde
    // son `<label for>` ; une liste déroulante maison n'est pas un contrôle de formulaire, son
    // étiquette est un `<span>` qu'elle désigne par `aria-labelledby`. Chercher les `<label>` seuls
    // rendait `undefined` sur « Projet » et « Mode SSL », et trois mesures de grille avec.
    // **Trois façons d'être étiqueté.** Un `<input>` garde son `<label for>` ; une liste déroulante
    // maison désigne un `<span id>` par `aria-labelledby` (`23d`) ; et le constat de projet imposé
    // (`24c`) n'est ni l'un ni l'autre — c'est du texte sous un `div` d'étiquette. Le troisième
    // sélecteur le rattrape, sans quoi trois mesures de grille rendaient `undefined`.
    const etiquettes = [...document.querySelectorAll('label, span[id], [class*="label"]')]
    const cible = etiquettes.find((l) => l.textContent?.trim() === nom)
    const champ =
      cible instanceof HTMLLabelElement && cible.htmlFor
        ? document.getElementById(cible.htmlFor)
        : cible?.id
          ? document.querySelector(`[aria-labelledby="${cible.id}"]`)
          : (cible?.nextElementSibling ?? null)
    // Le champ à suffixe est enveloppé : c'est l'enveloppe qui porte la bordure, donc la
    // boîte visible.
    // L'enveloppe porte la bordure, donc la boîte visible. Pour une liste, le champ est le `button`
    // à l'intérieur de cette enveloppe, et la racine de `ListeDeroulante` s'interpose : on remonte
    // jusqu'à celle qui porte `wrap`.
    const visible =
      champ?.closest('[class*="wrap"]') ??
      (champ?.parentElement?.className.includes('wrap') ? champ.parentElement : champ)
    if (!visible) return null
    const r = visible.getBoundingClientRect()
    return {
      x: Math.round(r.x),
      droite: Math.round(r.right),
      largeur: Math.round(r.width),
      hauteur: Math.round(r.height),
    }
  }, etiquette)
}

test('les champs du formulaire font 30 px', async ({ page }) => {
  const hauteurs = await Promise.all(
    ['Nom de la base', 'Hôte', 'Port', 'Base par défaut', 'Utilisateur', 'Mot de passe'].map(
      async (nom) => (await boite(page, nom))?.hauteur,
    ),
  )
  // 30 px de contenu plus 1 px de bordure de chaque côté, comme le mockup. `Field` est en
  // `border-box` avec la hauteur explicitée : voir la note de `Field.module.css`, réécrite
  // après avoir mesuré un débordement de largeur.
  expect(hauteurs).toEqual([32, 32, 32, 32, 32, 32])
})

// **Ce test a trouvé le défaut le plus sérieux de `08b`.** En `content-box`, `width: 100%`
// désigne la largeur du *contenu* : remplissage et bordure s'ajoutent par-dessus, et le champ
// déborde de sa piste. Le Port rendait 104 px dans une piste de 84. Le mockup n'a pas ce
// problème parce que ses champs sont des `<div>` à largeur `auto`, qui se rétractent.
test('le port occupe exactement sa piste de 84 px et se colle à l’hôte', async ({ page }) => {
  const hote = await boite(page, 'Hôte')
  const port = await boite(page, 'Port')

  expect(port?.largeur).toBe(84)
  // Gap de 8 px entre les deux, contre les 18 px de la grille principale : le port est une
  // sous-partie de l'hôte, pas un champ voisin. C'est exactement ce qu'une pile de flex
  // aurait perdu.
  expect((port?.x ?? 0) - (hote?.droite ?? 0)).toBe(9)
})

test('les colonnes de la grille s’alignent d’une rangée à l’autre', async ({ page }) => {
  const gauche = await Promise.all(
    ['Hôte', 'Base par défaut', 'Mode SSL'].map(async (nom) => (await boite(page, nom))?.x),
  )
  const droite = await Promise.all(
    ['Base par défaut', 'Utilisateur'].map(async (nom) => (await boite(page, nom))?.x),
  )

  // La colonne de gauche est la même sur les trois rangées où elle apparaît. Reproduire la
  // grille en flex imbriqué donnerait des colonnes décalées — le défaut que `08b` nomme et
  // que Vitest ne peut pas voir.
  expect(new Set(gauche.filter((x) => x === gauche[0])).size).toBe(1)
  expect(droite[0]).not.toBe(gauche[0])
})

test('le projet s’annonce dans la bande d’en-tête, pas dans le formulaire', async ({ page }) => {
  // **La piste de 196px a disparu de la rangée d'identité** (26 août 2026) : elle portait le projet,
  // monté depuis dans l'en-tête. Ce qui se mesure ici est qu'il est bien *là* et pas *ici* — un
  // sélecteur laissé dans le formulaire, même désactivé, rendrait le geste ambigu.
  const boiteIndication = await page.getByTestId('projet-de-la-modale').boundingBox()
  const boiteEnTete = await page.locator('[role=dialog] > div').first().boundingBox()
  // Dans la bande de 44px de l'en-tête, et non ailleurs dans la coquille.
  expect(boiteIndication?.y ?? 0).toBeGreaterThanOrEqual(boiteEnTete?.y ?? 0)
  expect((boiteIndication?.y ?? 0) + (boiteIndication?.height ?? 0)).toBeLessThanOrEqual(
    (boiteEnTete?.y ?? 0) + (boiteEnTete?.height ?? 0),
  )
  // Et la rangée d'identité ne le contient plus.
  const dansLaRangee = await page.evaluate(
    () =>
      document
        .querySelector('[class*=rowIdentity]')
        ?.querySelector('[data-testid=projet-de-la-modale]') !== null,
  )
  expect(dansLaRangee).toBe(false)
})

test('un nom de projet long ne pousse pas la croix hors de la bande', async ({ page }) => {
  // **Rien ne borne un nom de projet**, et la croix est la seule commande de sortie visible de la
  // modale : la faire dépendre de la longueur d'un nom serait un piège. Le nom est allongé de force,
  // comme le faisait le test du pied de sidebar — mesurer le nom du jour ne mesure que sa brièveté.
  await page.evaluate(() => {
    const nom = document.querySelector('[data-testid=projet-de-la-modale] span')
    // Démesuré volontairement : la modale fait 820 px, et un nom de soixante caractères y tient
    // encore. Ce qui se mesure est la mise en page sous contrainte, pas la brièveté du nom du jour.
    if (nom) nom.textContent = 'Atelier Nord de la Vitrine Sud '.repeat(12)
  })
  const croix = await page.getByRole('button', { name: 'Fermer' }).boundingBox()
  const coquille = await page.locator('[role=dialog]').boundingBox()
  expect((croix?.x ?? 0) + (croix?.width ?? 0)).toBeLessThanOrEqual(
    (coquille?.x ?? 0) + (coquille?.width ?? 0),
  )
  // Et c'est le nom qui a cédé, par l'ellipse : il est coupé, non replié.
  const coupe = await page.evaluate(() => {
    const nom = document.querySelector('[data-testid=projet-de-la-modale] span') as HTMLElement
    return { coupe: nom.scrollWidth > nom.clientWidth, replie: nom.scrollHeight > nom.clientHeight }
  })
  expect(coupe.coupe).toBe(true)
  expect(coupe.replie).toBe(false)
})

test('les deux cellules de la rangée d’identité s’alignent en bas', async ({ page }) => {
  const bas = await page.evaluate(() => {
    const rangee = document.querySelector('[class*=rowIdentity]')
    if (!rangee) return null
    // **Deux, et non trois** : le nom de la base et le groupe d'environnements. Les **boîtes
    // visibles**, pas les contrôles nus — une première version mesurait le `<select>` lui-même et
    // trouvait 16 px de haut dans une boîte de 32, ce qui a révélé un autre défaut.
    const controles = [rangee.querySelector('input'), rangee.querySelector('fieldset label')]
    return controles.map((c) => (c ? Math.round(c.getBoundingClientRect().bottom) : null))
  })

  // `align-items: end` : les étiquettes n'ont pas la même hauteur, donc sans lui les
  // contrôles se décaleraient verticalement les uns par rapport aux autres.
  expect(new Set(bas)).toHaveProperty('size', 1)
})

// L'autre défaut trouvé à la mesure : le `<select>` gardait sa hauteur intrinsèque de 16 px
// dans une boîte de 32, donc cliquer dans le remplissage du champ n'ouvrait pas la liste.
// Invisible en test unitaire, et invisible à l'œil — la boîte, elle, avait la bonne taille.
test('le select occupe toute la hauteur de sa boîte, donc tout le champ est cliquable', async ({
  page,
}) => {
  const mesures = await page.evaluate(() => {
    // **`[role=combobox]` et non `select`** : le natif est parti (aucun composant natif visible dans
    // ce produit). Le défaut que ce test garde, lui, n'a pas changé de nature — un champ qui ne
    // remplit pas sa boîte laisse du remplissage inerte au clic.
    const champ = document.querySelector('[role=combobox]')
    const enveloppe = champ?.closest('[class*="wrap"]')
    if (!champ || !enveloppe) return null
    return {
      select: Math.round(champ.getBoundingClientRect().height),
      boite: Math.round(enveloppe.getBoundingClientRect().height),
    }
  })

  // 32 px de boîte moins les 2 px de bordure : le select remplit les 30 px intérieurs.
  expect(mesures?.boite).toBe(32)
  expect(mesures?.select).toBe(30)
})

test('les trois boutons d’environnement ont la même boîte, prod compris', async ({ page }) => {
  const boites = await page.evaluate(() => {
    const groupe = [...document.querySelectorAll('fieldset')].find((f) =>
      f.querySelector('input[value=prod]'),
    )
    return [...(groupe?.querySelectorAll('label') ?? [])].map((l) => {
      const r = l.getBoundingClientRect()
      return { hauteur: Math.round(r.height) }
    })
  })

  // `prod` porte une bordure de 1.5 px là où ses voisins en ont 1. En `content-box`, il
  // serait plus haut d'un pixel — visible dans une rangée de trois boutons collés. C'est la
  // raison d'être du `border-box` de `RadioGroup`.
  expect(boites).toHaveLength(3)
  expect(new Set(boites.map((b) => b.hauteur))).toHaveProperty('size', 1)
})

// **Portée à la modale.** Le décor est la démo depuis `24d`, et sa barre de titre porte un sélecteur
// d'environnement dont la valeur est aussi « prod » : une recherche à l'échelle de la page en trouve
// deux, et le mode strict de Playwright refuse — à juste titre.
test('prod garde son habillage rouge même sélectionné', async ({ page }) => {
  // C'est le `<label>` qu'on clique, pas l'`<input>` : celui-ci est masqué visuellement et en
  // `pointer-events: none`, comme il doit l'être. Un vrai utilisateur clique le libellé.
  const modale = page.getByRole('dialog')
  await modale.getByText('prod', { exact: true }).click()
  await expect(modale.getByRole('radio', { name: 'prod' })).toBeChecked()

  const couleurs = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('input[value=prod]')
    const label = input?.closest('label')
    if (!label) return null
    const style = getComputedStyle(label)
    return { fond: style.backgroundColor, bordure: style.borderTopColor }
  })

  // `RadioGroup` met le fond accent sur l'option active. Ici il faut qu'il perde : le rouge
  // est une propriété de *prod*, pas de *actif*. Sans le sélecteur doublé qui gagne en
  // spécificité, `prod` sélectionné deviendrait orange.
  expect(couleurs?.fond).toBe('rgb(252, 233, 228)') // --danger-bg
  expect(couleurs?.bordure).toBe('rgb(217, 67, 47)') // --danger
})

test('le sélecteur de moteur tient sur une seule ligne', async ({ page }) => {
  const lignes = await page.evaluate(() => {
    const groupe = [...document.querySelectorAll('fieldset')].find((f) =>
      f.querySelector('input[value=postgresql]'),
    )
    const hauts = [...(groupe?.querySelectorAll('label') ?? [])].map((l) =>
      Math.round(l.getBoundingClientRect().top),
    )
    return new Set(hauts).size
  })

  // Sept boutons dans 820 px moins les marges : ils doivent tenir. `flex-wrap` les
  // laisserait passer à la ligne sans que rien ne le signale.
  expect(lignes).toBe(1)
})

// **Ce test a déménagé.** Il vérifiait que la barre de titre de `A1` se ternit derrière la modale ;
// depuis `24d`, le bouton de `A1` ouvre l'étape 1, et cette spec atteint `A2` par la démo — où il n'y a
// pas d'écran d'accueil à ternir. La propriété reste vraie et reste vérifiée : `a1.spec.ts` la mesure
// sur `A1`, qui est son écran.

test('à 960 px la modale reste entièrement visible et la grille tient', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 })

  const etat = await page.evaluate(() => {
    const coquille = document.querySelector('[role=dialog]')
    if (!coquille) return null
    const r = coquille.getBoundingClientRect()
    return {
      gauche: r.left,
      droite: window.innerWidth - r.right,
      // Le corps de la modale peut dépasser la hauteur de la fenêtre à 600 px : c'est
      // attendu et non un défaut, mais la largeur ne doit jamais déborder.
      debordeEnLargeur: document.documentElement.scrollWidth > window.innerWidth,
    }
  })

  expect(etat?.gauche).toBeGreaterThanOrEqual(0)
  expect(etat?.droite).toBeGreaterThanOrEqual(0)
  expect(etat?.debordeEnLargeur).toBe(false)
})

// --- Panneau proxy / tunnel (08c) -------------------------------------------------------

async function deplierTunnel(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /Proxy \/ tunnel/ }).click()
  await page.waitForSelector('input[inputmode=numeric] >> nth=1')
}

// Ce test a longtemps été déclaré inobservable, « le formulaire vivant derrière un assistant en
// deux étapes ». La cause réelle était ailleurs : Playwright réutilisait le serveur de
// développement **d'un autre worktree** — celui-là même dont le parcours en deux étapes est
// devenu `24c`. Voir la note en tête de `playwright.config.ts`. Le test est observé, et un
// `size="md"` sur le champ « Instance » le fait tomber.
test('les champs du visage Cloud SQL font 28 px aussi (08k)', async ({ page }) => {
  await deplierTunnel(page)
  // **Deux gestes et non `selectOption`** : le `<select>` natif est parti du produit, remplacé par
  // `ListeDeroulante`. Le passage par les rôles ARIA est ce qui garde le test honnête — il
  // échouerait si le composant cessait de les porter.
  await page.getByRole('combobox', { name: 'Type' }).click()
  await page.getByRole('option', { name: 'Cloud SQL' }).click()
  await page.waitForSelector('input[placeholder="projet:région:instance"]')

  const mesures = await page.evaluate(() => {
    const panneau = [...document.querySelectorAll('section')].find((s) =>
      s.textContent?.includes('Proxy / tunnel'),
    )
    if (!panneau) return null
    const hauteur = (el: Element | null) =>
      el ? Math.round(el.getBoundingClientRect().height) : null
    const instance = panneau.querySelector<HTMLInputElement>(
      'input[placeholder="projet:région:instance"]',
    )
    return {
      champs: [...panneau.querySelectorAll('input')].map((i) =>
        hauteur(i.parentElement?.className.includes('wrap') ? i.parentElement : i),
      ),
      // L'instance doit occuper les trois colonnes restantes : un nom de connexion long serait
      // illisible sur une colonne `1fr`.
      largeurInstance: Math.round(instance?.getBoundingClientRect().width ?? 0),
      // `[role=combobox]` et non `select` : plus de composant natif dans ce produit.
      largeurType: Math.round(
        panneau.querySelector('[role=combobox]')?.getBoundingClientRect().width ?? 0,
      ),
      // Les pistes **calculées** : c'est contre elles qu'une largeur de champ dit combien de
      // colonnes il occupe.
      pistes: getComputedStyle(panneau.querySelector('[class*=tunnelGrid]') as Element)
        .gridTemplateColumns.split(' ')
        .map((v) => Number.parseFloat(v)),
      espace: Number.parseFloat(
        getComputedStyle(panneau.querySelector('[class*=tunnelGrid]') as Element).columnGap,
      ),
    }
  })

  // 28 px de contenu plus les 2 px de bordure, comme le visage SSH. Le mockup ne montre pas ce
  // visage : l'aligner sur l'autre est la seule cohérence disponible.
  expect(new Set(mesures?.champs)).toHaveProperty('size', 1)
  expect(mesures?.champs[0]).toBe(30)
  // **Mesurée contre les pistes de la grille, et non par un `> 2 ×` contre « Type »** (31 août
  // 2026). L'ancienne forme de cette assertion était satisfaite par une piste `1fr` **seule** :
  // elle est donc restée verte pendant que le `grid-column` de `.tunnelInstance` n'avait aucun
  // effet, ayant été posé sur l'`<input>` — que `Field` reçoit son `className` là et non sur son
  // `<div>` racine. Un test plus faible que le contrat qu'il garde finit par ne garder que sa
  // propre faiblesse ; ici il aura mis trois semaines à se voir, et c'est le visage Kubernetes,
  // écrit sur le même patron, qui l'a révélé.
  //
  // Les pistes sont lues et non fixées en pixels : une valeur exacte dépendrait de la largeur de
  // la modale, donc casserait au premier ajustement de mise en page.
  const [, ...apresType] = mesures?.pistes ?? []
  const espace = mesures?.espace ?? 0
  const troisDernieres = apresType.reduce((somme, piste) => somme + piste + espace, -espace)
  expect(mesures?.largeurInstance ?? 0).toBeCloseTo(troisDernieres, 0)
})

// Le visage Kubernetes n'est pas maquetté non plus. Sa cote est ici et non en Vitest parce que
// jsdom ne calcule aucune mise en page — une exigence de largeur y serait structurellement
// inobservable (règle n° 9).
test('les champs du visage Kubernetes font 28 px, et la ressource prend la rangée', async ({
  page,
}) => {
  await deplierTunnel(page)
  await page.getByRole('combobox', { name: 'Type' }).click()
  await page.getByRole('option', { name: 'Kubernetes' }).click()
  await page.waitForSelector('input[placeholder^="svc/postgres"]')

  const mesures = await page.evaluate(() => {
    const panneau = [...document.querySelectorAll('section')].find((s) =>
      s.textContent?.includes('Proxy / tunnel'),
    )
    if (!panneau) return null
    const grille = panneau.querySelector('[class*=tunnelGrid]') as HTMLElement
    const boite = (selecteur: string) =>
      Math.round(panneau.querySelector(selecteur)?.getBoundingClientRect().width ?? 0)
    const hauteur = (el: Element | null) =>
      el ? Math.round(el.getBoundingClientRect().height) : null
    return {
      champs: [...panneau.querySelectorAll('input')].map((i) =>
        hauteur(i.parentElement?.className.includes('wrap') ? i.parentElement : i),
      ),
      espaceDeNoms: boite('input[placeholder*="default"]'),
      kubeconfig: boite('input[placeholder*="KUBECONFIG"]'),
      ressource: boite('input[placeholder^="svc/postgres"]'),
      grilleLargeur: Math.round(grille.getBoundingClientRect().width),
      pistes: getComputedStyle(grille)
        .gridTemplateColumns.split(' ')
        .map((v) => Number.parseFloat(v)),
    }
  })

  // 28 px de contenu plus les 2 px de bordure, comme les deux autres visages. Le mockup ne montre
  // celui-ci pas plus que celui de Cloud SQL : l'aligner sur eux est la seule cohérence disponible.
  expect(new Set(mesures?.champs)).toHaveProperty('size', 1)
  expect(mesures?.champs[0]).toBe(30)

  // **L'espace de noms tient dans une seule piste**, la deuxième — il n'y a plus de cote à
  // répartir depuis le retrait du champ « Contexte » (31 août 2026), et un nom d'espace de noms est
  // court. Mesuré contre la piste calculée et non par un ordre de grandeur : une comparaison
  // laisserait passer un champ tombé dans la piste voisine, qui est le défaut qu'on veut voir.
  const [, piste2 = 0] = mesures?.pistes ?? []
  expect(mesures?.espaceDeNoms ?? 0).toBeCloseTo(piste2, 0)

  // Le fichier et la ressource prennent la rangée entière : un chemin de kubeconfig et un
  // `statefulset/postgres-principal` tiennent mal dans une colonne. Tolérance de 3 px pour les
  // bordures, plutôt qu'une égalité que le sous-pixel ferait échouer.
  for (const large of [mesures?.kubeconfig ?? 0, mesures?.ressource ?? 0]) {
    expect(large).toBeGreaterThan((mesures?.grilleLargeur ?? 0) - 3)
  }
})

test('le panneau est à égale distance du moteur et du formulaire', async ({ page }) => {
  // Mesuré et non lu dans la feuille de style : le `padding` de `.tunnelBlock` et celui de
  // `.form` sont écrits à deux endroits, et c'est leur **somme à l'écran** qui compte. Le
  // panneau est passé entre les deux blocs le 24 août 2026, et s'est retrouvé collé au
  // sélecteur de moteur — un écart de 0 contre 16 en dessous.
  const ecarts = await page.evaluate(() => {
    const bas = (el: Element | null | undefined) => el?.getBoundingClientRect().bottom ?? null
    const haut = (el: Element | null | undefined) => el?.getBoundingClientRect().top ?? null
    // Le bloc du moteur, dont le `padding` bas vaut zéro : son bord est donc celui du
    // sélecteur lui-même. `[role=radiogroup]` ne marcherait pas — `RadioGroup` est un vrai
    // `<fieldset>`, précisément pour que `disabled` désactive nativement ses contrôles.
    const moteur = document.querySelector('[class*=engineBlock]')
    const panneau = [...document.querySelectorAll('section')].find((s) =>
      s.textContent?.includes('Proxy / tunnel'),
    )
    const premierChamp = document.querySelector('[class*=rowIdentity]')
    if (!moteur || !panneau || !premierChamp) return null
    return {
      avant: Math.round((haut(panneau) ?? 0) - (bas(moteur) ?? 0)),
      apres: Math.round((haut(premierChamp) ?? 0) - (bas(panneau) ?? 0)),
    }
  })

  expect(ecarts?.avant).toBe(16)
  expect(ecarts?.apres).toBe(16)
})

test('les champs du panneau font 28 px, contre 30 pour le formulaire', async ({ page }) => {
  await deplierTunnel(page)

  const mesures = await page.evaluate(() => {
    const panneau = [...document.querySelectorAll('section')].find((s) =>
      s.textContent?.includes('Proxy / tunnel'),
    )
    if (!panneau) return null
    const hauteur = (el: Element | null) =>
      el ? Math.round(el.getBoundingClientRect().height) : null
    return {
      champs: [...panneau.querySelectorAll('input')].map((i) =>
        hauteur(i.parentElement?.className.includes('wrap') ? i.parentElement : i),
      ),
      // La boîte visible de la liste : son enveloppe `wrap`, qui porte la bordure. `[role=combobox]`
      // et non `select` — plus de composant natif dans ce produit.
      select: hauteur(panneau.querySelector('[role=combobox]')?.closest('[class*="wrap"]') ?? null),
    }
  })

  // 28 px de contenu plus les 2 px de bordure. Deux pixels de moins que le formulaire
  // principal : c'est ce qui donne au panneau son aspect de bloc secondaire, et l'aligner
  // sur 30 l'effacerait.
  expect(new Set(mesures?.champs)).toHaveProperty('size', 1)
  expect(mesures?.champs[0]).toBe(30)
  expect(mesures?.select).toBe(30)
})

test('la grille du panneau suit 130px 1fr 84px 1fr', async ({ page }) => {
  await deplierTunnel(page)

  const largeurs = await page.evaluate(() => {
    const grille = document.querySelector('[class*=tunnelGrid]')
    if (!grille) return null
    return getComputedStyle(grille)
      .gridTemplateColumns.split(' ')
      .map((v) => Math.round(Number.parseFloat(v)))
  })

  // Rien de commun avec le `1fr 1fr` du formulaire principal : les factoriser serait une
  // abstraction fausse. Les deux `1fr` se partagent ce qui reste des 788 px intérieurs.
  expect(largeurs?.[0]).toBe(130)
  expect(largeurs?.[2]).toBe(84)
  expect(largeurs?.[1]).toBe(largeurs?.[3])
})

// **Le « Port local mappé » a été retiré du panneau** (24 août 2026). Sa mesure part avec lui :
// il était le seul pointillé du handoff — « affiché, pas saisissable » —, et le test comptait
// les bordures en pointillés du formulaire pour qu'aucune autre n'apparaisse. Ce qu'il
// protégeait vaut désormais pour le champ « Port » grisé du formulaire, dont l'état est
// vérifié par Vitest ; un pointillé de plus n'aurait plus de règle à contredire.
test('le badge « SSH activé » apparaît quand un bastion est saisi', async ({ page }) => {
  await deplierTunnel(page)
  await expect(page.getByText('SSH activé')).toHaveCount(0)

  await page.getByLabel('Hôte du bastion').fill('bastion.example')
  await expect(page.getByText('SSH activé')).toHaveCount(1)
})

test('la modale reste dans la fenêtre avec le panneau déplié', async ({ page }) => {
  await deplierTunnel(page)

  const etat = await page.evaluate(() => ({
    debordeEnLargeur: document.documentElement.scrollWidth > window.innerWidth,
    hauteurModale: Math.round(
      document.querySelector('[role=dialog]')?.getBoundingClientRect().height ?? 0,
    ),
  }))

  // La hauteur peut dépasser la fenêtre à 600 px — c'est attendu et le mockup lui-même fait
  // 748 px de corps. La largeur, elle, ne doit jamais déborder.
  expect(etat.debordeEnLargeur).toBe(false)
  expect(etat.hauteurModale).toBeGreaterThan(500)
})

// **Ce test existe parce que le défaut s'est produit.** `.envOption` (ce fichier) et `.option`
// (`RadioGroup.module.css`) sont deux règles à une classe qui posent toutes deux `padding` et
// `font-size` sur les boutons d'environnement. Leur gagnant dépendait de l'ordre des feuilles
// dans le bundle : éditer `NewConnection.module.css` a suffi à l'inverser, et les boutons ont
// changé de largeur d'un build à l'autre. Une capture de référence l'a attrapé ; ce test le
// nomme, pour que la prochaine fois l'échec dise *quoi* est cassé.
test('les boutons d’environnement gardent leur remplissage propre, quel que soit l’ordre du CSS', async ({
  page,
}) => {
  const styles = await page.evaluate(() => {
    const groupe = [...document.querySelectorAll('fieldset')].find((f) =>
      f.querySelector('input[value=prod]'),
    )
    const moteur = [...document.querySelectorAll('fieldset')].find((f) =>
      f.querySelector('input[value=postgresql]'),
    )
    const lire = (el: Element | null | undefined) => {
      if (!el) return null
      const s = getComputedStyle(el)
      return { padding: s.paddingLeft, police: s.fontSize, rayon: s.borderTopLeftRadius }
    }
    return {
      env: lire(groupe?.querySelector('label')),
      moteur: lire(moteur?.querySelector('label')),
    }
  })

  // Les valeurs du mockup : 10px/11.5px/8px pour l'environnement, 12px/12px/9px pour le moteur.
  // Les uniformiser effacerait une intention du design.
  expect(styles.env).toEqual({ padding: '10px', police: '11.5px', rayon: '8px' })
  expect(styles.moteur).toEqual({ padding: '12px', police: '12px', rayon: '9px' })
})

// --- Le pied, quand le test a répondu (08d + 24c) ---------------------------------------

// **Le pied porte trois choses à la fois** : la rangée de boutons, le verdict du test, et la phrase
// « le projet est créé » de `24c`. Elles se sont longtemps disputé une seule ligne de 56 px : le pied
// n'avait pas de `flex-wrap`, donc le `flex-basis: 100%` de la phrase n'allait à la ligne nulle part —
// il écrasait ses voisins. Le verdict tombait alors en colonne sur quatre lignes (« Connecté en / 5 ms ·
// / PostgreSQL / 17.6 ») et la phrase s'empilait à droite des boutons. Aucun test unitaire ne pouvait
// le voir : jsdom ne calcule pas de layout, et le DOM était juste.

/** Les rectangles des enfants du pied, relatifs au pied. */
async function pied(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const boite = document.querySelector('[data-testid=modal-footer]') as HTMLElement | null
    if (!boite) return null
    const r = boite.getBoundingClientRect()
    const lire = (selecteur: string) => {
      const el = boite.querySelector(selecteur)
      if (!el) return null
      const b = el.getBoundingClientRect()
      return {
        y: Math.round(b.y - r.y),
        bas: Math.round(b.bottom - r.y),
        hauteur: Math.round(b.height),
        droite: Math.round(b.right - r.x),
      }
    }
    return {
      hauteur: Math.round(r.height),
      largeur: Math.round(r.width),
      constat: lire('p[role=status]'),
      boutonTester: lire('button'),
      // Le centre vertical de chaque bouton du pied : les hauteurs diffèrent d'un pixel selon
      // l'habillage, les centres non.
      centresDesBoutons: [...boite.querySelectorAll(':scope > button')].map((b) => {
        const c = b.getBoundingClientRect()
        return Math.round(c.y + c.height / 2 - r.y)
      }),
      verdict: lire('[class*=testOkTexte]'),
    }
  })
}

test('la phrase du projet créé passe sous la rangée de boutons', async ({ page }) => {
  const mesures = await pied(page)
  // Sous les boutons, et non à leur droite : c'est la seule façon dont elle ne les rétrécit pas.
  expect(mesures?.constat?.y).toBeGreaterThanOrEqual(mesures?.boutonTester?.bas ?? 0)
  // Sur une seule ligne à cette largeur — sinon c'est qu'elle n'a pas la largeur du pied.
  expect(mesures?.constat?.hauteur).toBeLessThan(20)
})

test('le pied replié garde du souffle entre le filet et les boutons', async ({ page }) => {
  // **Le cas du pied qui se replie**, celui de l'étape 2 : une rangée de boutons *plus* la phrase du
  // projet créé. La hauteur minimale de 57px protégeait le pied à une ligne et lui seul — dès que le
  // contenu la dépassait, la rangée venait s'appuyer sur le filet du dessus, et la phrase sur le bord
  // bas de la modale. C'est un remplissage qu'il fallait, pas une hauteur.
  const mesures = await pied(page)
  // Le filet fait 1px et vit dans la boîte (`border-box`) : le premier bouton commence donc au moins
  // un remplissage plus bas. Le seuil est délibérément bas — ce qui est mesuré, c'est qu'il y a un
  // écart, pas sa valeur exacte, qui appartient à l'échelle d'espacement.
  expect(mesures?.boutonTester?.y ?? 0).toBeGreaterThanOrEqual(6)
  // Et autant sous la phrase : sans elle, le remplissage n'aurait été qu'un demi-remède.
  expect((mesures?.hauteur ?? 0) - (mesures?.constat?.bas ?? 0)).toBeGreaterThanOrEqual(6)
})

test('le verdict d’un test réussi tient sur une ligne, sans écraser les boutons', async ({
  page,
}) => {
  // Le succès ne se produit pas hors de la webview : le pont est simulé, et **seulement pour cette
  // commande** — le reste doit continuer de rejeter, sinon la démo ne se charge plus.
  await page.addInitScript(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: (commande: string) =>
          commande !== 'test_connection'
            ? Promise.reject(new Error('hors webview'))
            : Promise.resolve({
                latencyMs: 5,
                // **Le pire cas réaliste, pas le plus court.** `version()` d'un Postgres empaqueté
                // rend une chaîne de cette longueur, et le verdict y ajoute le port du tunnel et la
                // mention de TLS. C'est là que la place manque — avec « PostgreSQL 17.6 » tout seul,
                // le pied a de la marge et le test ne prouve rien.
                serverVersion: 'PostgreSQL 17.6 (Debian 17.6-1.pgdg120+1)',
                tunnelLocalPort: 63342,
                tlsUnverified: true,
              }),
        transformCallback: (f: unknown) => f,
      },
      configurable: true,
    })
  })
  await page.goto('/?demo')
  await page.getByRole('button', { name: /Nouveau projet/ }).click()
  await page.getByLabel('Nom du projet').fill('Comptoir Sud')
  await page.getByRole('button', { name: /Continuer/ }).click()
  await page.waitForSelector('[data-testid=projet-de-la-modale]')
  await page.getByRole('button', { name: /Tester la connexion/ }).click()
  await page.waitForSelector('[class*=testOk]')
  await page.evaluate(() => document.fonts.ready)

  const mesures = await pied(page)
  // Une ligne de texte dense, pas quatre. Le verdict s'élide par la fin s'il ne tient pas.
  expect(mesures?.verdict?.hauteur).toBeLessThan(24)
  // **Le verdict ne chasse pas les boutons sur une seconde ligne.** C'est la vraie mesure : un
  // verdict trop long qui refuse de céder ne se replie pas lui-même, il fait revenir « Enregistrer
  // & ouvrir » à la ligne — et le pied passe de 76 à 118 px.
  const centres = mesures?.centresDesBoutons ?? []
  expect(centres).toHaveLength(3)
  expect(Math.max(...centres) - Math.min(...centres)).toBeLessThan(4)
  // Une rangée de boutons plus la phrase de `24c`, pas davantage.
  expect(mesures?.hauteur).toBeLessThan(90)
  expect(mesures?.verdict?.droite ?? 0).toBeLessThan(mesures?.largeur ?? 0)
})

// --- A3, la sous-modale d'échec (08d) ---------------------------------------------------

// Le pont IPC ne répond pas hors de la webview : dans le navigateur de Playwright, `invoke`
// rejette. C'est exactement ce qu'il faut pour atteindre `A3` — l'échec est réel, pas simulé,
// et son message est celui que le pont produit quand il n'existe pas.
async function provoquerUnEchec(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /Tester la connexion/ }).click()
  await page.waitForSelector('[role=dialog][aria-label="Connexion impossible"]')
}

test('les six options du mode SSL sont toutes atteignables, malgré le bord de la modale', async ({
  page,
}) => {
  // **Le défaut n° 35, sous une autre forme.** Le panneau de la liste était ancré dans le flux
  // (`position: absolute`), donc rogné par le premier ancêtre en `overflow: hidden` — la coquille de
  // `Modal`, qui en porte un pour ses coins arrondis. « Mode SSL » vit en bas de la modale : ses
  // dernières options tombaient hors du cadre. Rien ne s'en apercevait, le DOM étant juste et les
  // options « visibles » au sens de Playwright.
  await page.getByRole('combobox', { name: 'Mode SSL' }).click()
  const options = page.getByRole('option')
  await expect(options).toHaveCount(6)
  // **`elementFromPoint`, et non une assertion de visibilité** : c'est la seule mesure qui distingue
  // « présent dans la mise en page » de « réellement sous le pointeur ». Chaque option est interrogée
  // en son centre.
  for (const option of await options.all()) {
    const cadre = await option.boundingBox()
    expect(cadre).not.toBeNull()
    const atteignable = await page.evaluate(
      ({ x, y }) => {
        const cible = document.elementFromPoint(x, y)
        return cible?.closest('[role=option]') !== null
      },
      {
        x: (cadre?.x ?? 0) + (cadre?.width ?? 0) / 2,
        y: (cadre?.y ?? 0) + (cadre?.height ?? 0) / 2,
      },
    )
    expect(atteignable, `option « ${await option.textContent()} » sous le pointeur`).toBe(true)
  }
  // Et le panneau reste dans la fenêtre : replié vers le haut plutôt que sorti par le bas.
  const panneau = await page.getByRole('listbox', { name: 'Mode SSL' }).boundingBox()
  expect(panneau?.y ?? -1).toBeGreaterThanOrEqual(0)
  expect((panneau?.y ?? 0) + (panneau?.height ?? 0)).toBeLessThanOrEqual(
    page.viewportSize()?.height ?? 0,
  )
})

test('le panneau ouvert est au moins aussi large que son champ', async ({ page }) => {
  // La géométrie du panneau vient du composant depuis qu'il est en coordonnées de fenêtre :
  // `min-width: 100%` ne veut plus rien dire hors du flux, et un panneau plus étroit que son champ
  // aurait l'air décroché.
  const champ = await page.getByRole('combobox', { name: 'Mode SSL' }).boundingBox()
  await page.getByRole('combobox', { name: 'Mode SSL' }).click()
  const panneau = await page.getByRole('listbox', { name: 'Mode SSL' }).boundingBox()
  expect(panneau?.width ?? 0).toBeGreaterThanOrEqual(champ?.width ?? 0)
  // Et aligné à gauche sur lui, à un pixel de filet près.
  expect(Math.abs((panneau?.x ?? 0) - (champ?.x ?? 0))).toBeLessThanOrEqual(1)
})

test('la sous-modale de A3 fait 436 px et se centre dans la fenêtre', async ({ page }) => {
  await provoquerUnEchec(page)

  const mesures = await page.evaluate(() => {
    const sous = document.querySelector('[role=dialog][aria-label="Connexion impossible"]')
    if (!sous) return null
    const r = sous.getBoundingClientRect()
    return {
      largeur: Math.round(r.width),
      // Centrée verticalement, contrairement à `A2` qui est alignée en haut à 34 px.
      centreeY: Math.abs(r.top + r.height / 2 - window.innerHeight / 2) < 2,
      centreeX: Math.abs(r.left + r.width / 2 - window.innerWidth / 2) < 2,
    }
  })

  expect(mesures?.largeur).toBe(438) // 436 px plus les deux bordures
  expect(mesures?.centreeY).toBe(true)
  expect(mesures?.centreeX).toBe(true)
})

test('la modale A2 n’est pas surlignée en rouge sous la sous-modale', async ({ page }) => {
  await provoquerUnEchec(page)

  const rouge = await page.evaluate(() => {
    const a2 = [...document.querySelectorAll('[role=dialog]')].find(
      (d) => d.getAttribute('aria-label') === 'Nouvelle connexion',
    )
    if (!a2) return null
    // Aucune bordure rouge dans A2 **sauf** celle de `prod`, qui est là de toute façon.
    return [...a2.querySelectorAll('input, select, [class*=wrap]')].filter((el) => {
      const c = getComputedStyle(el).borderTopColor
      return c === 'rgb(217, 67, 47)' || c === 'rgb(176, 51, 31)'
    }).length
  })

  // Le handoff insiste : « la modale sous-jacente n'est pas surlignée en rouge ». L'erreur ne
  // vit que dans la sous-modale et le message du pied.
  expect(rouge).toBe(0)
})

// Sans `SQLSTATE` ni tunnel, l'encart n'a rien à ajouter au texte explicatif : le rendre
// reviendrait à afficher le même paragraphe deux fois, en mono. L'échec du pont dans le
// navigateur de Playwright est justement de ce genre — local, sans code.
test('sans code ni tunnel, aucun encart de log dans A3', async ({ page }) => {
  await provoquerUnEchec(page)
  await expect(page.locator('[class*=failureLog]')).toHaveCount(0)
})

test('esc ferme la sous-modale sans fermer A2', async ({ page }) => {
  await provoquerUnEchec(page)
  await page.keyboard.press('Escape')

  await expect(page.locator('[role=dialog][aria-label="Connexion impossible"]')).toHaveCount(0)
  await expect(page.locator('[role=dialog][aria-label="Nouvelle connexion"]')).toHaveCount(1)
  // Le pied garde son état d'échec : c'est ce que le handoff montre.
  await expect(page.getByRole('button', { name: 'Retester' })).toHaveCount(1)
})

// --- Enregistrement (08e) ---------------------------------------------------------------

// Sans aucun projet, `A2` ne peut rien enregistrer : elle déclare une base *dans un projet
// existant*, et le handoff ne maquette pas le parcours d'un utilisateur qui n'en a aucun.
// Ce que le handoff ne maquettait pas : le parcours d'un utilisateur sans aucun projet.
// **Ce test a disparu avec la sentinelle** (`24c`). Il vérifiait que sans projet, `A2` proposait
// « + Nouveau projet… » et attendait un nom avant d'activer « Enregistrer ». Cet écran ne crée plus de
// projet : la garantie a déménagé dans `NewProject.test.tsx`, où le nom vide désactive « Continuer » en
// disant pourquoi.

test('le bouton désactivé porte l’habillage du handoff, pas seulement l’attribut', async ({
  page,
}) => {
  // **L'état désactivé se produit, il ne s'attend plus.** Ce bouton était désactivé faute de nom de
  // projet — l'écran ouvrait sur « + Nouveau projet… » (`08f`). Depuis `24c`, l'étape 2 arrive avec un
  // projet : il est actif. La cause de désactivation qui reste est l'échec du test de connexion, et
  // c'est elle que ce test provoque — la commande Tauri ne répond pas hors de la webview.
  await page.getByRole('button', { name: /Tester la connexion/ }).click()
  await expect(page.getByRole('button', { name: /Enregistrer & ouvrir/ })).toBeDisabled()

  const styles = await page.evaluate(() => {
    const bouton = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Enregistrer'),
    )
    if (!bouton) return null
    const s = getComputedStyle(bouton)
    return { fond: s.backgroundColor, texte: s.color, curseur: s.cursor }
  })

  // Le handoff donne `rgba(35,32,28,.14)` de fond et `rgba(35,32,28,.4)` de texte pour l'état
  // désactivé de ce bouton (`A3` § pied). Un `disabled` sans habillage laisserait un bouton
  // accent qui a l'air cliquable.
  expect(styles?.fond).toBe('rgba(35, 32, 28, 0.14)')
  expect(styles?.texte).toBe('rgba(35, 32, 28, 0.4)')
  expect(styles?.curseur).toBe('not-allowed')
})

// --- Une fenêtre plus courte que la modale.
//
// Le formulaire d'`A2` mesure plus de 600 px, et la coquille n'avait aucun plafond : sur une
// fenêtre courte, la bande de pied sortait **par le bas**, donc « Enregistrer » et « Annuler »
// devenaient inatteignables — la racine ne défilant pas (`geometrie-reelle`), rien ne venait
// les rattraper. C'est le corps qui doit céder et défiler, jamais l'en-tête ni le pied.
test.describe('sur une fenêtre trop courte pour la modale', () => {
  test.use({ viewport: { width: 1360, height: 520 } })

  test('la coquille tient dans la fenêtre, et le corps défile', async ({ page }) => {
    const mesures = await page.evaluate(() => {
      const coquille = document.querySelector('[role=dialog]')
      const corps = document.querySelector('[data-testid=modal-body]')
      const pied = document.querySelector('[data-testid=modal-footer]')
      const entete = corps?.previousElementSibling
      if (!(coquille && corps && pied && entete)) return null
      return {
        hauteurEntete: Math.round(entete.getBoundingClientRect().height),
        basCoquille: Math.round(coquille.getBoundingClientRect().bottom),
        basPied: Math.round(pied.getBoundingClientRect().bottom),
        hauteurPied: Math.round(pied.getBoundingClientRect().height),
        contenuDuCorps: corps.scrollHeight,
        visibleDuCorps: corps.clientHeight,
        fenetre: window.innerHeight,
        racineDefile: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      }
    })

    expect(mesures?.basCoquille).toBeLessThanOrEqual(mesures?.fenetre as number)
    expect(mesures?.basPied).toBeLessThanOrEqual(mesures?.fenetre as number)
    // Et le décor débordait vraiment, sinon les deux mesures ci-dessus ne prouvent rien
    // (règle n° 5) : c'est le corps qui a cédé, et il a de quoi défiler.
    expect(mesures?.contenuDuCorps).toBeGreaterThan(mesures?.visibleDuCorps as number)
    // L'en-tête garde ses 44px (filet compris) : c'est le corps qui cède, pas lui.
    expect(mesures?.hauteurEntete).toBe(45)
    // Le pied garde sa hauteur : c'est le corps qui cède, pas lui. `A2` en « projet imposé »
    // porte une seconde ligne sous les boutons, d'où la hauteur **minimale** et non une égalité.
    expect(mesures?.hauteurPied).toBeGreaterThanOrEqual(57)
    // Et rien n'est reporté sur la racine, qui ne défile pas.
    expect(mesures?.racineDefile).toBe(false)
  })

  test('les boutons du pied restent sous le pointeur', async ({ page }) => {
    // **`elementFromPoint`, et non une assertion de visibilité** : c'est la seule mesure qui
    // distingue « présent dans la mise en page » de « réellement atteignable » — un pied sorti
    // par le bas de la fenêtre reste « visible » au sens de Playwright.
    const pied = page.getByTestId('modal-footer')
    for (const bouton of await pied.getByRole('button').all()) {
      const cadre = await bouton.boundingBox()
      expect(cadre).not.toBeNull()
      const atteignable = await page.evaluate(
        ({ x, y }) => {
          // `elementFromPoint` rend `null` hors de la fenêtre, et `null?.closest(…)` vaut
          // `undefined` — donc un `!== null` sur l'enchaînement optionnel serait **vrai** pour
          // un bouton sorti de l'écran, c'est-à-dire vert sous sabotage. Le test doit constater
          // qu'il y a bien un élément, puis que c'est ce bouton.
          const cible = document.elementFromPoint(x, y)
          return cible !== null && cible.closest('button') !== null
        },
        {
          x: (cadre?.x ?? 0) + (cadre?.width ?? 0) / 2,
          y: (cadre?.y ?? 0) + (cadre?.height ?? 0) / 2,
        },
      )
      expect(atteignable, `bouton « ${await bouton.textContent()} » sous le pointeur`).toBe(true)
    }
  })
})
