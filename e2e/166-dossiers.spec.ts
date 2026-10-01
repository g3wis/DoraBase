import { expect, type Page, test } from '@playwright/test'

/**
 * **L'arbre en dossiers, depuis `/`** (#166).
 *
 * Ce que ni la galerie ni `?demo` ne peuvent prouver : que l'assemblage crée un dossier depuis
 * l'accueil, en crée dans un dossier, puis déclare une connexion **dans** le plus profond — et que
 * l'arbre qui en sort suit la règle d'indentation au pixel. C'est la règle n° 8 : un composant juste
 * dans sa vitrine ne prouve rien de l'assemblage, et le test qui manquait partait de `/`.
 *
 * **Le cœur est simulé, et au plus près de son contrat** : un faux `__TAURI_INTERNALS__.invoke` tient
 * un `FolderTree` et répond aux cinq commandes que ce parcours emploie — `load_config`, `create_folder`,
 * `rename_folder`, `save_database`, `connection_states`. Tout le reste est refusé, comme hors de la
 * webview. Les identifiants sont tirés par le double, **jamais dérivés d'un nom** : c'est ce qui laisse
 * un renommage ne rien changer à l'identité d'un nœud.
 */
async function simulerLeCoeur(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Dossier = {
      id: string
      name: string
      readOnly: boolean
      folders?: Dossier[]
      connections?: unknown[]
    }
    const arbre: { folders: Dossier[]; connections: unknown[] } = { folders: [], connections: [] }
    let compteur = 0
    const tirer = (prefixe: string) => `${prefixe}${(++compteur).toString(16).padStart(15, '0')}`
    const trouver = (liste: Dossier[], id: string): Dossier | null => {
      for (const d of liste) {
        if (d.id === id) return d
        const dedans = trouver(d.folders ?? [], id)
        if (dedans) return dedans
      }
      return null
    }
    const copie = () => JSON.parse(JSON.stringify(arbre))
    const repondre: Record<string, (args: { request?: Record<string, unknown> }) => unknown> = {
      load_config: () => ({ kind: 'fresh' }),
      connection_states: () => [],
      create_folder: ({ request }) => {
        const parent = (request?.parent as string | null) ?? null
        const freres = parent ? (trouver(arbre.folders, parent)?.folders ?? []) : arbre.folders
        let n = 1
        while (freres.some((d) => d.name === `dossier ${n}`)) n += 1
        const dossier: Dossier = { id: tirer('f'), name: `dossier ${n}`, readOnly: false }
        if (parent) {
          const hote = trouver(arbre.folders, parent)
          if (!hote) throw new Error('dossier introuvable')
          hote.folders = [...(hote.folders ?? []), dossier]
        } else arbre.folders.push(dossier)
        return { tree: copie(), folder: dossier.id }
      },
      rename_folder: ({ request }) => {
        const dossier = trouver(arbre.folders, request?.folder as string)
        if (!dossier) throw new Error('dossier introuvable')
        dossier.name = request?.name as string
        return copie()
      },
      save_database: ({ request }) => {
        const connexion = {
          id: tirer('c'),
          name: (request?.name as string) || 'psql',
          engine: request?.engine,
          connection: request?.variant,
          label: request?.label ?? null,
          consoles: [],
        }
        const hote = trouver(arbre.folders, request?.folder as string)
        if (!hote) throw new Error('dossier introuvable')
        hote.connections = [...(hote.connections ?? []), connexion]
        return { tree: copie(), connection: connexion.id }
      },
    }
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: (commande: string, args: { request?: Record<string, unknown> }) => {
          const reponse = repondre[commande]
          if (!reponse) return Promise.reject(new Error(`hors webview : ${commande}`))
          try {
            return Promise.resolve(reponse(args ?? {}))
          } catch (cause) {
            return Promise.reject(cause)
          }
        },
        transformCallback: (f: unknown) => f,
      },
      configurable: true,
    })
  })
}

/** La ligne d'arbre d'un dossier ou d'une connexion, par son nom — motif ancré. */
const ligne = (page: Page, nom: string) =>
  page.getByRole('treeitem', { name: new RegExp(`^${nom}\\b`) })

/** Ouvre le menu « … » d'une ligne, puis choisit une entrée. */
async function choisir(page: Page, nom: string, entree: RegExp): Promise<void> {
  const cible = ligne(page, nom)
  await cible.hover()
  await cible
    .locator('xpath=..')
    .getByRole('button', { name: `Actions de ${nom}` })
    .click()
  await page.getByRole('button', { name: entree }).last().click()
}

/** Renomme sur place la ligne qui vient de naître en renommage. */
async function nommer(page: Page, nom: string): Promise<void> {
  const champ = page.getByRole('textbox', { name: /^Nouveau nom de/ })
  await expect(champ).toBeVisible()
  await champ.fill(nom)
  await champ.press('Enter')
  await expect(ligne(page, nom)).toBeVisible()
}

const retrait = (page: Page, nom: string) =>
  ligne(page, nom).evaluate((el) => getComputedStyle(el).paddingLeft)

test('trois niveaux de dossiers et une connexion, créés depuis l’accueil', async ({ page }) => {
  await simulerLeCoeur(page)
  await page.goto('/')

  // `A1` crée un dossier, et l'écran de travail prend sa place avec la ligne en renommage.
  await page
    .getByRole('button', { name: /Nouveau dossier/ })
    .last()
    .click()
  await nommer(page, 'Racine A')

  await choisir(page, 'Racine A', /^Nouveau dossier/)
  await nommer(page, 'Niveau 2')
  await choisir(page, 'Niveau 2', /^Nouveau dossier/)
  await nommer(page, 'Niveau 3')

  // `A2` s'annonce par le chemin du dossier d'où part le geste, et ne le laisse pas choisir.
  await choisir(page, 'Niveau 3', /Nouvelle base de données/)
  await expect(page.getByTestId('dossier-de-la-modale')).toHaveText(
    'Racine A › Niveau 2 › Niveau 3',
  )
  await page.getByRole('button', { name: /Enregistrer & ouvrir/ }).click()
  // **« Enregistrer & ouvrir » révèle la connexion** (#108) : son dossier hôte se déplie de lui-même
  // et sa ligne est sélectionnée, sans aucun geste de plus. Avant, rien ne bougeait à l'écran — il
  // fallait déplier « Niveau 3 » à la main pour voir que l'enregistrement avait eu lieu.
  await expect(ligne(page, 'psql')).toBeVisible()
  await expect(ligne(page, 'psql')).toHaveAttribute('aria-selected', 'true')
  await expect(ligne(page, 'Niveau 3')).toHaveAttribute('aria-expanded', 'true')

  // **La règle, au pixel** : 8 + 14 × niveau pour un dossier comme pour une connexion.
  expect(await retrait(page, 'Racine A')).toBe('8px')
  expect(await retrait(page, 'Niveau 2')).toBe('22px')
  expect(await retrait(page, 'Niveau 3')).toBe('36px')
  expect(await retrait(page, 'psql')).toBe('50px')

  // Et le palier logique, que la voix annonce : quatre niveaux, pas trois paliers fixes.
  await expect(ligne(page, 'Racine A')).toHaveAttribute('aria-level', '1')
  await expect(ligne(page, 'Niveau 3')).toHaveAttribute('aria-level', '3')
  await expect(ligne(page, 'psql')).toHaveAttribute('aria-level', '4')
})

/**
 * **Un renommage ne change aucune identité** : le dossier renommé garde ses enfants dépliés. Si
 * l'identité d'un nœud portait son nom, la ligne renommée perdrait son dépliage et ses enfants
 * disparaîtraient de l'arbre — c'est ce que `idApresRenommage` réparait à la main avant #166.
 */
test('renommer un dossier déplié garde ses enfants à l’écran', async ({ page }) => {
  await simulerLeCoeur(page)
  await page.goto('/')
  await page
    .getByRole('button', { name: /Nouveau dossier/ })
    .last()
    .click()
  await nommer(page, 'Racine A')
  await choisir(page, 'Racine A', /^Nouveau dossier/)
  await nommer(page, 'Enfant')

  await choisir(page, 'Racine A', /^Renommer/)
  await nommer(page, 'Racine B')
  await expect(ligne(page, 'Enfant')).toBeVisible()
})
