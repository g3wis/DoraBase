import { expect, test } from '@playwright/test'

/**
 * Le gestionnaire d'instances (`API-32`).
 *
 * # Ce que ce niveau garde, et qu'aucun autre ne peut garder
 *
 * `InstancesPanel.test.tsx` mesure la ligne, `InstanceView.test.tsx` les sections, et
 * `Workbench/instances.test.tsx` l'assemblage. Quatre faits leur échappent aux trois, parce que
 * jsdom ne calcule aucune mise en page (règle n° 9) :
 *
 * 1. **que les deux zones de la sidebar cohabitent** — l'arbre au-dessus, les instances en dessous,
 *    chacune défilant seule et la poignée entre les deux ;
 * 2. **que les icônes des deux listes tombent dans la même colonne** : c'est une mesure d'abscisse,
 *    et c'est le seul endroit où l'on peut la faire ;
 * 3. **que la matrice de privilèges défile dans son conteneur** plutôt que de pousser l'écran — une
 *    instance à vingt bases dépasse toute largeur de fenêtre ;
 * 4. **que l'encart de SQL de la confirmation ne déborde ni de la modale ni de la fenêtre**, et que
 *    son bouton d'exécution reste atteignable. C'est le défaut du 1er septembre 2026, sur la modale
 *    où il coûterait le plus cher.
 *
 * 1360 × 814 : la taille de fenêtre des mesures de `geometrie-reelle`.
 */
test.use({ viewport: { width: 1360, height: 814 } })

test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await page.getByRole('tree', { name: 'Instances' }).waitFor()
  await page.evaluate(() => document.fonts.ready)
})

/**
 * Choisit une section de la bande.
 *
 * **Le `<label>`, jamais l'`<input>`.** `SegmentedControl` est fait de radios natives masquées en
 * `pointer-events: none` — c'est ce qui donne les flèches et le bouclage gratuitement —, et
 * l'apparence est portée par le label. `click()` sur l'input est refusé, `check()` aussi : le label
 * intercepte, et c'est exactement ce qu'il doit faire. Cliquer le label **est** le geste de
 * l'utilisateur.
 */
async function choisirLaSection(page: import('@playwright/test').Page, section: string) {
  await page
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: new RegExp(`^${section}`) }) })
    .click()
}

async function ouvrirLInstance(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /^PG atelier/ }).click()
  await page.getByRole('navigation', { name: /Chemin de l’instance/ }).waitFor()
  await page.evaluate(() => document.fonts.ready)
}

test('les deux zones de la sidebar cohabitent, séparées par une poignée', async ({ page }) => {
  const arbre = page.getByRole('tree', { name: 'Projets, environnements et connexions' })
  const instances = page.getByRole('tree', { name: 'Instances' })

  await expect(arbre).toBeVisible()
  await expect(instances).toBeVisible()

  const haut = await arbre.boundingBox()
  const bas = await instances.boundingBox()
  if (!haut || !bas) throw new Error('les deux zones doivent être mesurables')

  // **Empilées, non côte à côte** : c'est ce que « sous l'arborescence » veut dire, et une
  // disposition en colonnes serait passée sous tous les tests unitaires.
  expect(bas.y).toBeGreaterThan(haut.y)
  // Et dans la **même** colonne : deux largeurs différentes se liraient comme deux panneaux.
  expect(Math.abs(bas.x - haut.x)).toBeLessThanOrEqual(1)

  // La poignée du partage vertical est là, et elle est saisissable.
  const poignee = page.getByRole('separator', { name: /.*/ }).first()
  await expect(poignee).toBeVisible()
})

test('l’icône d’une instance tombe dans la colonne des icônes de projet', async ({ page }) => {
  // **La mesure qui n'appartient à aucun composant** : `INDENT[0] + 16` est la reprise de la
  // gouttière du chevron qu'une feuille n'occupe pas, et son effet est une **abscisse**. Un test
  // unitaire ne peut vérifier que la déclaration ; celui-ci vérifie le rendu.
  const abscisses = await page.evaluate(() => {
    // **L'icône, non le chevron.** Une ligne de projet dépliable porte les deux, dans cet ordre :
    // prendre le premier `<svg>` mesurerait la flèche, qui est justement la gouttière que la ligne
    // d'instance reprend. C'est le piège que ce test existe pour éviter, et il s'y était pris lui-même.
    const boite = (selecteur: string) => {
      const ligne = document.querySelector(selecteur)
      const icones = [...(ligne?.querySelectorAll('svg') ?? [])].filter(
        (svg) => svg.closest('[data-chevron-zone]') === null,
      )
      return icones[0]?.getBoundingClientRect().x ?? null
    }
    return {
      projet: boite('[role="treeitem"][data-depth="0"]'),
      instance: boite('[role="tree"][aria-label="Instances"] [data-depth="0"]'),
    }
  })

  expect(abscisses.projet).not.toBeNull()
  expect(abscisses.instance).not.toBeNull()
  expect(Math.abs((abscisses.instance ?? 0) - (abscisses.projet ?? 0))).toBeLessThanOrEqual(1)
})

test('les actions d’une ligne tiennent dans la gouttière réservée', async ({ page }) => {
  // **Le défaut du 9 septembre 2026** (« les boutons edit/delete sont superposés aux metadata »).
  // Deux boutons de 18 px occupaient 45 px depuis le bord droit, là où la gouttière réservée en fait
  // 24 : ils se peignaient par-dessus « pg 17.6 » et « OK ».
  //
  // **Le test garde la cause, non la conséquence**, et c'est le sabotage qui l'a imposé : mesurer un
  // chevauchement demande une ligne assez pleine pour que les deux boîtes se touchent, et aucun
  // libellé du décor ne l'est. Un test posé dessus restait vert la gouttière retirée. Ce qui est
  // vrai de tout décor est que **ce que la ligne réserve à droite suffit à ce qu'elle y pose** —
  // sinon le recouvrement n'attend que le premier nom d'instance un peu long.
  await page.getByRole('button', { name: /^PG atelier/ }).click()
  await page.getByRole('navigation', { name: /Chemin de l’instance/ }).waitFor()

  const ligne = page.getByRole('button', { name: /^PG atelier/ })
  await ligne.hover()
  await expect(page.getByRole('button', { name: 'Actions de PG atelier' })).toBeVisible()

  const mesures = await page.evaluate(() => {
    const declencheur = [...document.querySelectorAll('button')].find(
      (bouton) => bouton.getAttribute('aria-label') === 'Actions de PG atelier',
    )
    const ligne = [
      ...document.querySelectorAll('[role="tree"][aria-label="Instances"] button'),
    ].find((bouton) => bouton.textContent?.startsWith('PG atelier'))
    if (declencheur === undefined || ligne === undefined) return null

    const cadre = ligne.getBoundingClientRect()
    const actions = declencheur.getBoundingClientRect()
    return {
      // Ce que les actions occupent depuis le bord droit de la ligne…
      occupe: Math.round(cadre.right - actions.left),
      // …et ce que la ligne leur réserve.
      reserve: Number.parseFloat(getComputedStyle(ligne).paddingRight),
      // Le contrôle positif : la méta et le badge sont bien rendus, donc il y a quelque chose à
      // ne pas recouvrir. Sans lui, l'assertion passerait sur une ligne nue.
      aDroite: [...ligne.querySelectorAll('[data-meta], [class*=root]')].filter(
        (element) => (element.textContent ?? '').trim() !== '',
      ).length,
    }
  })

  expect(mesures).not.toBeNull()
  expect(mesures?.aDroite ?? 0).toBeGreaterThanOrEqual(2)
  expect(mesures?.occupe ?? 0).toBeLessThanOrEqual(mesures?.reserve ?? 0)
})

test('l’en-tête de la colonne d’actions n’est pas tronqué', async ({ page }) => {
  // **« actio… », puis « a… » sur les sections à un seul bouton** (9 septembre 2026). La largeur
  // avait été prise sur les deux carrés de 18 px ; c'est l'en-tête qui la décide, seule colonne dont
  // le contenu ne dise pas de quoi elle parle.
  await ouvrirLInstance(page)

  for (const section of ['Bases', 'Utilisateurs', 'Sessions', 'Extensions', 'Paramètres']) {
    await choisirLaSection(page, section)
    const tronque = await page.evaluate(() => {
      const entete = [...document.querySelectorAll('th')].find(
        (cellule) => cellule.textContent?.trim() === 'actions',
      )
      // `scrollWidth > clientWidth` **est** la définition d'un texte ellipsé : la boîte est plus
      // étroite que ce qu'elle contient. Comparer les chaînes ne dirait rien, `textContent` gardant
      // le texte entier sous l'ellipse.
      return entete === undefined ? null : entete.scrollWidth > entete.clientWidth
    })
    expect(tronque, section).toBe(false)
  }
})

test('l’écran d’une instance s’ouvre en onglet, avec ses trois bandes', async ({ page }) => {
  await ouvrirLInstance(page)

  // Les trois bandes de la maquette : 34, 34, 36. Les cotes sont mesurées, non déclarées.
  const hauteurs = await page.evaluate(() => {
    const fil = document.querySelector('nav[aria-label^="Chemin de l’instance"]')?.parentElement
    const bande = fil?.nextElementSibling
    const barre = bande?.nextElementSibling
    return [fil, bande, barre].map((element) => element?.getBoundingClientRect().height ?? null)
  })
  expect(hauteurs).toEqual([34, 34, 36])

  // Le rôle est visible en permanence : c'est ce qui décide de ce que l'écran autorise.
  await expect(page.getByText(/connecté en postgres/)).toBeVisible()
})

test('les sept sections se parcourent, et chacune rend son tableau', async ({ page }) => {
  await ouvrirLInstance(page)

  // **`check()` et non `click()`** : le contrôle segmenté est fait de radios natives masquées en
  // `pointer-events: none`, le `<label>` portant l'apparence. Playwright coche l'input, ce qui est
  // exactement le geste que le clavier fait — et le seul que la souris ne peut pas viser ici.
  for (const [section, repere] of [
    ['Bases', 'Bases de l’instance'],
    ['Utilisateurs', 'Utilisateurs du serveur'],
    ['Sessions', 'Sessions ouvertes'],
    ['Extensions', 'Extensions de la base de service'],
    ['Paramètres', 'Paramètres du serveur'],
  ] as const) {
    await choisirLaSection(page, section)
    await expect(page.getByRole('table', { name: repere })).toBeVisible()
  }
})

test('la matrice de privilèges défile dans son conteneur, jamais l’écran', async ({ page }) => {
  await ouvrirLInstance(page)
  await choisirLaSection(page, 'Privilèges')
  await page.getByRole('rowheader', { name: 'postgres' }).waitFor()

  // **La racine ne défile pas horizontalement** : la règle du produit, et c'est celle qu'une table
  // à colonnes variables menace le plus.
  const racine = await page.evaluate(() => ({
    largeur: document.documentElement.scrollWidth,
    fenetre: window.innerWidth,
  }))
  expect(racine.largeur).toBeLessThanOrEqual(racine.fenetre)

  // Et la colonne des rôles reste en place pendant le défilement horizontal : sans elle, une matrice
  // large afficherait des sigles dont on ne sait plus à quel rôle ils appartiennent.
  const colle = await page.evaluate(() => {
    const cellule = document.querySelector('th[scope="row"]')
    return cellule === null ? null : getComputedStyle(cellule).position
  })
  expect(colle).toBe('sticky')
})

test('la confirmation montre le SQL, et son bouton reste atteignable', async ({ page }) => {
  await ouvrirLInstance(page)
  await choisirLaSection(page, 'Utilisateurs')
  await page.getByRole('button', { name: 'Supprimer le rôle atelier_etl' }).click()

  const modale = page.getByRole('dialog', { name: /Confirmer l’exécution/ })
  // Le formulaire de réattribution d'abord : un `DROP ROLE` seul échoue dès que le rôle possède
  // quelque chose, donc il y a une saisie avant la confirmation.
  const saisie = page.getByRole('dialog', { name: 'Supprimer le rôle' })
  await expect(saisie).toBeVisible()
  await saisie.getByRole('button', { name: 'Exécuter' }).click()

  await expect(modale).toBeVisible()
  // **Les trois ordres, dans l'ordre où ils partent.** C'est la promesse de cet écran.
  const encart = modale.locator('pre')
  await expect(encart).toContainText('REASSIGN OWNED BY "atelier_etl"')
  await expect(encart).toContainText('DROP OWNED BY "atelier_etl"')
  await expect(encart).toContainText('DROP ROLE "atelier_etl"')

  // Et la ligne sous l'encart dit ce que le SQL ne dit pas.
  await expect(modale).toContainText(/Trois ordres/)

  // **Le bouton d'exécution est dans la fenêtre**, et il est rouge : c'est un geste qui retire.
  const bouton = modale.getByRole('button', { name: 'Exécuter' })
  const boite = await bouton.boundingBox()
  const fenetre = page.viewportSize()
  if (!boite || !fenetre) throw new Error('le bouton doit être mesurable')
  expect(boite.y + boite.height).toBeLessThanOrEqual(fenetre.height)

  // Le rouge vient de `--danger`, jamais d'un littéral : la valeur calculée est comparée au jeton.
  const couleurs = await page.evaluate(() => {
    const boutons = [...document.querySelectorAll('button')].filter(
      (element) => element.textContent?.trim() === 'Exécuter',
    )
    const dernier = boutons.at(-1)
    return {
      fond: dernier === undefined ? null : getComputedStyle(dernier).backgroundColor,
      jeton: getComputedStyle(document.documentElement).getPropertyValue('--danger').trim(),
    }
  })
  expect(couleurs.fond).not.toBeNull()
  expect(couleurs.jeton).not.toBe('')
})

test('l’encart de SQL ne franchit aucun bord de sa modale', async ({ page }) => {
  await ouvrirLInstance(page)
  await choisirLaSection(page, 'Bases')
  await page.getByRole('button', { name: 'Supprimer la base atelier' }).click()

  const modale = page.getByRole('dialog', { name: /Confirmer l’exécution/ })
  const encart = modale.locator('pre')
  const dehors = await modale.evaluate((element) => {
    const cadre = element.getBoundingClientRect()
    const bloc = element.querySelector('pre')?.getBoundingClientRect()
    if (bloc === undefined) return null
    return { droite: bloc.right - cadre.right, gauche: cadre.left - bloc.left }
  })
  await expect(encart).toBeVisible()
  expect(dehors).not.toBeNull()
  expect(dehors?.droite ?? 0).toBeLessThanOrEqual(0)
  expect(dehors?.gauche ?? 0).toBeLessThanOrEqual(0)
})

test('poser un mot de passe montre le vérificateur, jamais la saisie', async ({ page }) => {
  // **Le geste dont la confirmation ne pourrait pas tenir sa promesse autrement** : un mot de passe
  // en clair dans l'encart serait affiché à qui demande « je fais ça ? » à son voisin, et le masquer
  // ferait mentir la promesse. Le hachage côté client lève les deux — voir `scram.rs`.
  await ouvrirLInstance(page)
  await choisirLaSection(page, 'Utilisateurs')
  // **Le crayon, non une action à part** : le mot de passe est un champ de l'édition du rôle depuis
  // le 10 septembre 2026.
  await page.getByRole('button', { name: 'Modifier le rôle postgres' }).click()

  const saisie = page.getByRole('dialog', { name: /Modifier le rôle/ })
  await saisie.getByLabel('Nouveau mot de passe').fill('un secret bien à moi')
  await saisie.getByLabel('Confirmation').fill('un secret bien à moi')
  await saisie.getByRole('button', { name: 'Exécuter' }).click()

  const modale = page.getByRole('dialog', { name: /Confirmer l’exécution/ })
  const encart = modale.locator('pre')
  await expect(encart).toContainText('SCRAM-SHA-256')
  // **La saisie n'y est pas** : c'est toute la raison du geste.
  await expect(encart).not.toContainText('un secret bien à moi')

  // Et l'encart défile plutôt que d'élargir la modale : un vérificateur fait une centaine de
  // caractères sur une seule ligne, et une ligne repliée se lirait comme deux ordres.
  const deborde = await modale.evaluate((element) => {
    const bloc = element.querySelector('pre')
    if (bloc === null) return null
    const cadre = element.getBoundingClientRect()
    return {
      dansLaModale: bloc.getBoundingClientRect().right <= cadre.right,
      defile: bloc.scrollWidth > bloc.clientWidth,
    }
  })
  expect(deborde?.dansLaModale).toBe(true)
  expect(deborde?.defile).toBe(true)
})

test('un geste refusé porte sa raison, et le bouton reste survolable', async ({ page }) => {
  // `aria-disabled` et non `disabled` : un `<button disabled>` ne reçoit ni focus ni survol, donc son
  // infobulle serait inatteignable — exactement là où elle est le plus utile (piège n° 3).
  await ouvrirLInstance(page)
  await choisirLaSection(page, 'Paramètres')

  const interne = page.getByRole('button', { name: 'Régler block_size' })
  await expect(interne).toHaveAttribute('aria-disabled', 'true')
  await expect(interne).toHaveAttribute(
    'title',
    'ce paramètre est calculé par le serveur, il ne se règle pas',
  )
  // Le survol répond — c'est ce qu'un `disabled` aurait retiré.
  await interne.hover()
  await expect(interne).toBeVisible()
})

test('la déclaration d’une instance n’offre que PostgreSQL, et le dit', async ({ page }) => {
  await page.getByRole('button', { name: 'Déclarer une instance' }).click()

  const modale = page.getByRole('dialog', { name: 'Nouvelle instance' })
  await expect(modale).toBeVisible()

  // **Désactivés avec leur raison, non masqués** : masquer dirait « jamais » là où c'est un
  // « pas encore ».
  await expect(modale.getByRole('radio', { name: 'PostgreSQL' })).toBeEnabled()
  for (const moteur of ['MySQL', 'MongoDB', 'SQLite']) {
    const option = modale.getByRole('radio', { name: moteur })
    await expect(option).toBeDisabled()
  }

  // La phrase du pied dit ce que le rôle donné doit pouvoir faire.
  await expect(modale).toContainText(/nomme les gestes que ce compte n’a pas le droit de faire/)

  // Et la modale tient dans la fenêtre, pied compris — le défaut du 1er septembre 2026.
  const pied = page.getByTestId('modal-footer')
  await expect(pied).toBeVisible()
  const boite = await pied.boundingBox()
  const fenetre = page.viewportSize()
  if (!boite || !fenetre) throw new Error('le pied doit être mesurable')
  expect(boite.y + boite.height).toBeLessThanOrEqual(fenetre.height)
})
