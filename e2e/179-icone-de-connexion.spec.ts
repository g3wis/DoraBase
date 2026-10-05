import { expect, type Locator, type Page, test } from '@playwright/test'

/**
 * **L'icône et la couleur d'une connexion, depuis `/`** (#179).
 *
 * Ce que les tests unitaires ne peuvent pas dire : que l'assemblage `App` → `recolor_database` /
 * `set_database_icon` est branché, que la ligne redessine ce que le cœur a renvoyé et qu'elle le garde
 * **après une relance** — et surtout que la couleur **s'impose au logo**. Le logo est un aplat peint
 * dans le sprite, `fill="var(--logo-tint,#4169E1)"` ; jsdom ne peint rien, et la variable posée sur la
 * ligne ne prouve pas que le `<use>` en hérite. La seule mesure qui le dise est celle des **pixels**.
 *
 * Le cœur est simulé comme pour #171, et il range son arbre dans `localStorage` : recharger rejoue
 * `load_config` sur ce qu'il a écrit. Deux connexions PostgreSQL à la racine, aux noms inventés — le
 * cas même de la demande, « all postgres icons everywhere with same color ».
 */
async function simulerLeCoeur(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Base = { id: string; name: string; color?: string | null; icon?: string | null }
    const reglages = {
      host: 'localhost',
      port: 5432,
      defaultDatabase: 'atelier',
      username: 'lecteur',
      password: null,
      sslMode: 'prefer',
      caCertificate: null,
      authDatabase: null,
      readOnly: false,
      reconnectOnStartup: false,
      tunnel: null,
    }
    const base = (id: string, name: string) => ({
      id,
      name,
      engine: 'postgresql',
      connection: reglages,
      consoles: [],
    })
    const CLE = 'coeur-simule-179'
    const lu = window.localStorage.getItem(CLE)
    const arbre: { folders: unknown[]; connections: Base[] } = lu
      ? JSON.parse(lu)
      : {
          folders: [],
          connections: [base('c000000000000001', 'entrepot'), base('c000000000000002', 'vitrine')],
        }
    const ecrire = () => window.localStorage.setItem(CLE, JSON.stringify(arbre))
    const trouver = (id: unknown) => {
      const trouvee = arbre.connections.find((d) => d.id === id)
      if (!trouvee) throw new Error('connexion introuvable')
      return trouvee
    }
    const copie = () => JSON.parse(JSON.stringify(arbre))
    // Comme le cœur : `null` retire la clé, il n'écrit ni « pg » ni une couleur vide.
    const poser = (cible: Base, cle: 'color' | 'icon', valeur: unknown) => {
      if (valeur == null) delete cible[cle]
      else cible[cle] = valeur as string
    }
    const repondre: Record<string, (args: { request?: Record<string, unknown> }) => unknown> = {
      load_config: () => ({
        kind: 'loaded',
        tree: copie(),
        preferences: {
          theme: 'cahier',
          language: 'fr',
          accent: 'terracotta',
          rowHeight: 26,
          codeFontTenths: 125,
          guards: {
            pendingBeforeWrite: true,
            refuseUnrestrictedWrites: true,
            keepInversePatch: true,
          },
        },
        instances: [],
        kubeconfigs: { declarations: [], default: null },
      }),
      connection_states: () => [],
      recolor_database: ({ request }) => {
        poser(trouver(request?.connection), 'color', request?.color)
        ecrire()
        return copie()
      },
      set_database_icon: ({ request }) => {
        poser(trouver(request?.connection), 'icon', request?.icon)
        ecrire()
        return copie()
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

const ligne = (page: Page, nom: string) =>
  page.getByRole('treeitem', { name: new RegExp(`^${nom}\\b`) })

const iconeDe = (page: Page, nom: string) =>
  page.getByRole('button', { name: `Changer la couleur et l’icône de « ${nom} »` })

const glypheDe = (page: Page, nom: string) =>
  iconeDe(page, nom).evaluate((el) =>
    [...el.querySelectorAll('use')].map((use) => use.getAttribute('href')),
  )

const panneauDe = (page: Page, nom: string) =>
  page.getByRole('dialog', { name: `Couleur et icône de ${nom}` })

/**
 * La couleur **peinte** d'un glyphe : le pixel le plus saturé de sa capture.
 *
 * Le fond de la ligne — papier, survol — est quasi gris, et le logo est un aplat : son pixel le plus
 * saturé est sa teinte, à l'anticrénelage près. Décodé dans la page par `createImageBitmap`, sans
 * dépendance : Playwright rend un PNG, le navigateur sait le lire.
 */
async function teintePeinte(page: Page, glyphe: Locator): Promise<[number, number, number]> {
  const png = await glyphe.screenshot()
  return page.evaluate(
    async (octets) => {
      const image = await createImageBitmap(
        new Blob([new Uint8Array(octets)], { type: 'image/png' }),
      )
      const toile = new OffscreenCanvas(image.width, image.height)
      const contexte = toile.getContext('2d')
      if (!contexte) throw new Error('aucun contexte 2d')
      contexte.drawImage(image, 0, 0)
      const { data } = contexte.getImageData(0, 0, image.width, image.height)
      let retenu: [number, number, number] = [0, 0, 0]
      let saturation = -1
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] ?? 0
        const v = data[i + 1] ?? 0
        const b = data[i + 2] ?? 0
        const ecart = Math.max(r, v, b) - Math.min(r, v, b)
        if (ecart > saturation) {
          saturation = ecart
          retenu = [r, v, b]
        }
      }
      return retenu
    },
    [...png],
  )
}

/** Le bleu de l'éléphant (`#4169E1`) : le bleu domine nettement le rouge. */
const estBleu = ([r, , b]: [number, number, number]) => b - r > 80
/** Le rouge de `--danger` (`#D9432F`) : le rouge domine nettement le bleu. */
const estRouge = ([r, , b]: [number, number, number]) => r - b > 80

test('une couleur choisie s’impose au logo de la connexion, et « Aucune » rend sa teinte de marque', async ({
  page,
}) => {
  await simulerLeCoeur(page)
  await page.goto('/')
  await expect(ligne(page, 'entrepot')).toBeVisible()
  const logo = iconeDe(page, 'entrepot').locator('svg')
  const voisin = iconeDe(page, 'vitrine').locator('svg')

  // **Contrôle positif du décor** : deux éléphants bleus, indiscernables — la demande.
  expect(await glypheDe(page, 'entrepot')).toEqual(['#i-pg'])
  expect(estBleu(await teintePeinte(page, logo))).toBe(true)
  expect(estBleu(await teintePeinte(page, voisin))).toBe(true)

  await iconeDe(page, 'entrepot').click()
  const panneau = panneauDe(page, 'entrepot')
  await panneau.getByRole('radiogroup', { name: 'Couleur de entrepot' }).getByTitle('Rouge').click()
  await expect(panneau.getByRole('radio', { name: 'Rouge' })).toBeChecked()

  // **Le sujet** : le même éléphant, peint en rouge. L'icône n'a pas changé.
  await expect.poll(async () => estRouge(await teintePeinte(page, logo))).toBe(true)
  expect(await glypheDe(page, 'entrepot')).toEqual(['#i-pg'])

  // Et la connexion voisine n'est pas touchée — mesurée **panneau fermé** : ouvert sous l'icône, il
  // couvre la ligne suivante, et la capture lirait le panneau.
  await page.keyboard.press('Escape')
  await expect(panneau).toBeHidden()
  expect(estBleu(await teintePeinte(page, voisin))).toBe(true)

  await iconeDe(page, 'entrepot').click()
  await panneau.getByTitle('Aucune', { exact: true }).click()
  await expect(panneau.getByRole('radio', { name: 'Aucune' })).toBeChecked()
  await expect.poll(async () => estBleu(await teintePeinte(page, logo))).toBe(true)
})

test('une icône et une couleur choisies se voient sur la ligne, et survivent à la relance', async ({
  page,
}) => {
  await simulerLeCoeur(page)
  await page.goto('/')
  // **Par le menu**, le chemin clavier : il ouvre le même panneau, sous la même icône.
  await ligne(page, 'entrepot').hover()
  await page.getByRole('button', { name: 'Actions de entrepot' }).click()
  await page.getByRole('button', { name: 'Couleur et icône…' }).click()
  const panneau = panneauDe(page, 'entrepot')
  const grille = panneau.getByRole('group', { name: 'Icône de entrepot' })
  // La géométrie d'un dossier : 56 cases, le logo du moteur en tête et coché.
  await expect(grille.getByRole('radio')).toHaveCount(56)
  await expect(grille.getByRole('radio').first()).toHaveAccessibleName('PostgreSQL')
  await expect(grille.getByRole('radio', { name: 'PostgreSQL' })).toBeChecked()

  await grille.getByTitle('Fusée').click()
  await expect.poll(() => glypheDe(page, 'entrepot')).toEqual(['#i-rocket'])
  await panneau.getByRole('radiogroup', { name: 'Couleur de entrepot' }).getByTitle('Rouge').click()
  await expect(panneau.getByRole('radio', { name: 'Rouge' })).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(panneau).toBeHidden()

  await page.reload()
  await expect(ligne(page, 'entrepot')).toBeVisible()
  expect(await glypheDe(page, 'entrepot')).toEqual(['#i-rocket'])
  expect(await glypheDe(page, 'vitrine')).toEqual(['#i-pg'])
  expect(estRouge(await teintePeinte(page, iconeDe(page, 'entrepot').locator('svg')))).toBe(true)
})

test('le contrôle d’icône d’une connexion se pose exactement sur la place de son logo', async ({
  page,
}) => {
  await simulerLeCoeur(page)
  await page.goto('/')
  await expect(ligne(page, 'entrepot')).toBeVisible()
  const place = await ligne(page, 'entrepot').locator('[data-icon-slot]').boundingBox()
  const glyphe = await iconeDe(page, 'entrepot').locator('svg').boundingBox()
  // La ligne d'une connexion porte un chevron et un badge d'état : rien n'y a bougé d'un pixel.
  expect(glyphe).toEqual(place)
})
