import { expect, test } from '@playwright/test'

// `04` a coûté quatre défauts de mise en page invisibles en test unitaire. Les mêmes propriétés
// sont ici hors de portée de jsdom : largeur de la colonne, indentation par niveau, absence de
// débordement horizontal.
test.beforeEach(async ({ page }) => {
  await page.goto('/?gallery')
  await page.waitForSelector('[data-testid=sidebar-a4]')
  await page.evaluate(() => document.fonts.ready)
})

test('la colonne fait 268 px de contenu, contre 228 pour A5 → A9', async ({ page }) => {
  const largeur = await page.evaluate(() => {
    const colonne = document.querySelector('[data-testid=sidebar-a4]')
      ?.firstElementChild as HTMLElement | null
    return colonne ? Math.round(colonne.getBoundingClientRect().width) : null
  })
  // Le compte, refait : la variante `wide` déclare `width: 268px` et `.root` est en `content-box`,
  // donc le `border-right` de 1 px s'**ajoute** — 268 + 1 = **269** rendus. C'est la même
  // arithmétique qu'avant, sur un autre chiffre de contenu.
  //
  // **268 px de contenu et non les 252 du handoff, et c'est le cinquième palier qui les demande**
  // (`25a`). Les 252 px mesuraient une colonne dont l'arbre avait quatre paliers ; avec
  // l'environnement il en a cinq, et l'indentation du plus profond passe de 52 à 68 px. Ces 16 px
  // sont pris sur le libellé : à 252, un objet du palier 4 ne disposait plus que de 107 px de nom là
  // où le mockup en donnait 123 à son palier le plus profond. Les rendre à la colonne rend
  // exactement ce budget — et c'est ce budget, non le chiffre, que les 252 px servaient.
  //
  // Quarante pixels de plus que les 228 px que le `SplitPane` des écrans de travail donne par
  // défaut, et pour la raison d'avant : l'arbre de `A4` a un palier de plus pour la même profondeur
  // d'indentation.
  expect(largeur).toBe(269)
})

test('les cinq niveaux suivent la table d’indentation de TreeRow', async ({ page }) => {
  const indentations = await page.evaluate(() => {
    const sidebar = document.querySelector('[data-testid=sidebar-a4]')
    const parNiveau = new Map<string, string>()
    for (const ligne of sidebar?.querySelectorAll('[role=treeitem]') ?? []) {
      const niveau = ligne.getAttribute('aria-level')
      if (niveau && !parNiveau.has(niveau)) {
        parNiveau.set(niveau, getComputedStyle(ligne).paddingLeft)
      }
    }
    return [...parNiveau.entries()].sort()
  })

  // La table littérale de `TreeRow` : 8, 22, 36, 52, 68 — écarts 14, 14, **16**, **16**. Le mockup a
  // deux cadences, lisibles sur l'abscisse des icônes plutôt que sur le remplissage : `+14` d'un nœud
  // dépliable au suivant, `+16` vers une feuille, ces 16 px valant `chevron (11) + gap (5)`. Le pas
  // 3 → 4 va d'un schéma à un objet, donc `+16` (`25a`). **Les quatre premières valeurs ne bougent
  // pas** : elles sont mesurées contre le mockup, et `04` les avait déjà établies.
  expect(indentations).toEqual([
    ['1', '8px'],
    ['2', '22px'],
    ['3', '36px'],
    ['4', '52px'],
    ['5', '68px'],
  ])
})

test('aucune ligne ne déborde horizontalement de la colonne', async ({ page }) => {
  const debordements = await page.evaluate(() => {
    const colonne = document.querySelector('[data-testid=sidebar-a4]')?.firstElementChild
    if (!colonne) return null
    const droite = colonne.getBoundingClientRect().right
    return [...colonne.querySelectorAll('[role=treeitem]')].filter(
      (l) => l.getBoundingClientRect().right > droite + 1,
    ).length
  })
  // Un nom de table long doit être tronqué, pas déborder : c'est le genre de défaut que `04` a
  // trouvé à la mesure.
  expect(debordements).toBe(0)
})

test('les lignes font 22 px', async ({ page }) => {
  const hauteurs = await page.evaluate(() => {
    const sidebar = document.querySelector('[data-testid=sidebar-a4]')
    return [
      ...new Set(
        [...(sidebar?.querySelectorAll('[role=treeitem]') ?? [])].map((l) =>
          Math.round(l.getBoundingClientRect().height),
        ),
      ),
    ]
  })
  expect(hauteurs).toEqual([22])
})

test('la ligne sélectionnée porte l’aplat d’accent et son filet gauche', async ({ page }) => {
  const style = await page.evaluate(() => {
    const choisie = document
      .querySelector('[data-testid=sidebar-a4]')
      ?.querySelector('[aria-selected=true]')
    if (!choisie) return null
    const s = getComputedStyle(choisie)
    return { fond: s.backgroundColor, gauche: s.borderLeftWidth, ombre: s.boxShadow }
  })
  expect(style?.fond).not.toBe('rgba(0, 0, 0, 0)')
  // `TreeRow` de `04` porte déjà le filet : bordure ou liseré, l'un des deux doit être là.
  expect(style?.gauche !== '0px' || style?.ombre !== 'none').toBe(true)
})

// L'échec d'un dépliage ne doit pas vider l'arbre : une erreur de réseau sur une base ne fait
// pas disparaître les autres.
test('une base hors ligne affiche son échec sans masquer les autres', async ({ page }) => {
  const sidebar = page.locator('[data-testid=sidebar-a4]')
  await expect(sidebar.getByText('hôte injoignable')).toHaveCount(1)
  await expect(sidebar.getByRole('treeitem', { name: /^analytics/ })).toHaveCount(1)
  // `/orders/` seul matcherait aussi `orders_by_day` : un motif de nom accessible doit être
  // ancré, sans quoi il compte des lignes voisines. Le nom complet porte la métadonnée —
  // « orders 1.9 M » — l'espace venant de `TreeRow` depuis la correction de `09d`.
  await expect(sidebar.getByRole('treeitem', { name: /^orders 1\.9 M$/ })).toHaveCount(1)
})

test('le pied reste visible quand l’arbre déborde', async ({ page }) => {
  const visible = await page.evaluate(() => {
    const colonne = document.querySelector('[data-testid=sidebar-a4]')?.firstElementChild
    const pied = colonne?.lastElementChild
    if (!colonne || !pied) return null
    const c = colonne.getBoundingClientRect()
    const p = pied.getBoundingClientRect()
    // Le pied doit rester dans la colonne, l'arbre défilant au-dessus.
    return p.bottom <= c.bottom + 1 && p.top >= c.top
  })
  expect(visible).toBe(true)
})

/**
 * Le palier d'environnement, et ce qu'il rend possible de casser (`25a`).
 *
 * Le décor déclare quatre environnements et **deux connexions homonymes** : `analytics` en
 * « vitrine » et `analytics` en « atelier ». C'est la seule forme de décor qui met une collision
 * d'identité de nœud en évidence, et elle est ici volontaire.
 */
const sidebar = (page: import('@playwright/test').Page) => page.locator('[data-testid=sidebar-a4]')

/** La ligne d'un environnement, désignée par son libellé — le nom accessible commence par lui. */
const environnement = (page: import('@playwright/test').Page, libelle: string) =>
  sidebar(page).getByRole('treeitem', { name: new RegExp(`^${libelle}\\b`) })

/**
 * **Le test le plus important du lot.**
 *
 * `idBase` ne portait pas l'environnement, et sa justification était explicite : « l'arbre ne montre
 * jamais que les connexions de l'environnement actif ». Le palier annule cette prémisse. Sans
 * l'identifiant dans la clé, les deux `analytics` partagent leur dépliage, leur sélection, leur clé
 * de rendu React et — le plus grave — leur entrée dans `charge.schemas` : la structure d'un serveur
 * s'affiche sous la ligne d'un autre, ce qu'aucun message d'erreur ne signale.
 *
 * Les deux lignes se distinguent par leur **état**, que `TreeRow` met dans le nom accessible depuis
 * `09d` : le décor ne connecte que celle de « vitrine ». C'est plus lisible qu'un index de position,
 * et cela ne dépend pas de l'ordre de déclaration des environnements.
 */
test('deux connexions homonymes de deux environnements se déplient indépendamment', async ({
  page,
}) => {
  const enVitrine = sidebar(page).getByRole('treeitem', { name: /^analytics · connectée/ })
  const enAtelier = sidebar(page).getByRole('treeitem', { name: /^analytics · non connectée/ })

  // Au départ : « vitrine » est dépliée jusqu'au schéma `public`, « atelier » est repliée.
  await expect(enVitrine).toHaveAttribute('aria-expanded', 'true')
  await expect(enAtelier).toHaveCount(0)

  // Déplier est un double-clic depuis que le clic simple ne fait que sélectionner.
  await environnement(page, 'atelier').dblclick()
  // La seconde `analytics` paraît, **repliée** : le dépliage de sa jumelle ne la concerne pas.
  await expect(enAtelier).toHaveAttribute('aria-expanded', 'false')
  await expect(enVitrine).toHaveAttribute('aria-expanded', 'true')

  await enAtelier.dblclick()

  // Les deux sont dépliées, et l'une n'affiche pas la structure de l'autre : `charge.schemas` ne
  // porte de schémas que pour la connexion de « vitrine », donc celle d'« atelier » n'a que sa
  // console et la ligne « Aucun objet ».
  await expect(enAtelier).toHaveAttribute('aria-expanded', 'true')
  await expect(enVitrine).toHaveAttribute('aria-expanded', 'true')
  await expect(sidebar(page).getByRole('treeitem', { name: /^public/ })).toHaveCount(1)
  await expect(sidebar(page).getByRole('treeitem', { name: /^introspection/ })).toHaveCount(1)
  await expect(sidebar(page).getByRole('treeitem', { name: /Comptes du jour/ })).toHaveCount(1)
  await expect(sidebar(page).getByText('Aucun objet')).toHaveCount(1)

  // Et la sélection ne se partage pas non plus : cliquer l'une ne marque pas l'autre.
  await expect(enAtelier).toHaveAttribute('aria-selected', 'true')
  await expect(enVitrine).toHaveAttribute('aria-selected', 'false')
})

// Un nœud déplié sans enfant se lit comme un chargement en cours — le doute du défaut de `06d`. Ici
// rien ne charge : la liste vient de la configuration, donc le vide est un fait, et il se dit.
test('un dossier vide le dit, aligné au palier 2', async ({ page }) => {
  await environnement(page, 'coulisses').dblclick()

  const message = sidebar(page).getByText('Dossier vide')
  await expect(message).toBeVisible()

  const alignement = await page.evaluate(() => {
    const ligne = [...document.querySelectorAll('[data-testid=sidebar-a4] p')].find((p) =>
      p.textContent?.includes('Dossier vide'),
    )
    if (!ligne) return null
    // L'indentation vient d'`INDENT`, la table exportée par `TreeRow`, et non d'une copie en CSS :
    // un palier de retard entre les deux tables se lit comme un message mal aligné (`25a`).
    return {
      remplissage: getComputedStyle(ligne).paddingLeft,
      palier: ligne.getAttribute('data-depth'),
    }
  })
  // Enfant d'un dossier de palier 1, donc palier 2 : `indentation(2)`, soit 36 px — la même valeur
  // qu'une ligne de connexion, puisque c'est la place qu'une connexion y aurait occupée.
  expect(alignement).toEqual({ remplissage: '36px', palier: '2' })
})

/**
 * La lecture seule suit le **drapeau**, jamais le nom (#166).
 *
 * Le décor nomme son dossier en lecture seule « vitrine » précisément pour attraper un écran qui
 * relirait un nom `prod` en dur : un tel écran ne marquerait rien ici, et se trahirait.
 */
test('la lecture seule est sur « vitrine », et sur elle seule', async ({ page }) => {
  await expect(environnement(page, 'vitrine')).toHaveAccessibleName(/lecture seule/)

  for (const libelle of ['atelier', 'coulisses', 'bac à sable']) {
    await expect(environnement(page, libelle)).not.toHaveAccessibleName(/lecture seule/)
  }
  // Le compte, plutôt que trois assertions négatives seulement : une marque qui paraîtrait sur une
  // ligne de connexion ou de dossier racine passerait entre les mailles.
  await expect(sidebar(page).getByRole('treeitem', { name: /lecture seule/ })).toHaveCount(1)
})
