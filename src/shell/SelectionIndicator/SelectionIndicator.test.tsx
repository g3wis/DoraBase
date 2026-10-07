import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sprite } from '../../design/icons/Sprite'
import type { ConnectionState } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { libelleDeConnexion, SelectionIndicator } from './SelectionIndicator'

/**
 * L'indicateur de sélection de la barre de titre (`25b`).
 *
 * **Ce fichier hérite de deux tests supprimés** — `ProjectPill` et `EnvironmentPicker` — et de leurs
 * garanties qui survivent au passage : les quatre états du point, le texte masqué visuellement, le
 * badge « ÉDITION » qui chasse « LECTURE SEULE », la couleur d'environnement lue de la déclaration,
 * et `libelleDeConnexion`. Ce qui portait sur le clic, le menu et le combobox est parti avec eux :
 * il n'y a plus de contrôle ici.
 */

const CONNECTEE: ConnectionState = {
  kind: 'connected',
  serverVersion: 'PostgreSQL 17.6',
  tunnelLocalPort: null,
}

function monter(props: Partial<Parameters<typeof SelectionIndicator>[0]> = {}) {
  return render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <Sprite />
      <SelectionIndicator chemin={['Atelier Nord']} {...props} />
    </LanguageProvider>,
  )
}

/**
 * La racine de l'indicateur.
 *
 * **Elle ne porte aucun rôle**, et c'est délibéré : `status` est une région live, et `role="group"`
 * est destiné par ARIA à un ensemble de *contrôles* — il n'y en a plus ici. Reste du texte, lu dans
 * l'ordre du document. Faute de rôle, les tests l'atteignent par son contenu.
 */
const racine = () =>
  // Le texte du chemin, dans sa boîte raccourcie, dans la racine.
  screen.getByText('Atelier Nord').parentElement?.parentElement as HTMLElement

// --- Un indicateur, plus un contrôle ---

/*
 * **Rien de focalisable au centre** (`25b`).
 *
 * `ProjectPill` était un `<button>` ouvrant le menu des projets, et le sélecteur d'environnement un
 * `combobox`. Les deux sont partis : le projet s'édite depuis le « … » de l'arbre, l'environnement
 * s'y choisit comme palier. Un contrôle inerte se lirait comme un contrôle en panne — c'est
 * l'arbitrage que `24` a déjà rendu contre un `Chip` inerte.
 */
test('l’indicateur ne porte aucun élément focalisable', async () => {
  monter({ couleur: 'green', breadcrumb: 'catalogue · public', connection: CONNECTEE })

  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.queryByRole('link')).toBeNull()

  // Et rien ne prend le focus au `Tab` : c'est ce qui rend la barre entièrement glissable.
  await userEvent.tab()
  expect(racine().contains(document.activeElement)).toBe(false)
})

/*
 * **Surtout pas `role="status"`.**
 *
 * `status` est une région live implicite. La sélection changeant à chaque flèche dans l'arbre, un
 * lecteur d'écran énoncerait tout l'indicateur par-dessus l'annonce de la ligne en cours de
 * parcours : le pire endroit du produit pour une région live.
 */
test('l’indicateur n’est pas une région live', () => {
  monter({ connection: CONNECTEE })
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(racine()).not.toHaveAttribute('aria-live')
})

test('le chemin de dossiers est visible', () => {
  monter()
  expect(screen.getByText('Atelier Nord')).toBeInTheDocument()
})

// --- Le chemin de dossiers (#166) ---

test('le chemin s’écrit en entier, séparé par des chevrons, sans capitales', () => {
  monter({ chemin: ['Atelier Nord', 'Pré-production'] })
  expect(screen.getByText('Atelier Nord › Pré-production')).toBeInTheDocument()
  expect(screen.queryByText(/PRÉ-PRODUCTION/)).toBeNull()
})

/*
 * **Raccourci à gauche** : c'est la fin du chemin — le dossier le plus proche — qui dit où l'on est.
 * jsdom ne calcule aucune ellipse ; ce qui se vérifie ici est la déclaration qui la place à gauche.
 */
test('le chemin est raccourci par la gauche', () => {
  monter({ chemin: ['un', 'deux', 'trois'] })
  const texte = screen.getByText('un › deux › trois')
  expect(texte.className).toMatch(/cheminTexte/)
  expect(texte.parentElement?.className).toMatch(/name/)
})

// **La couleur vient de la déclaration, non d'un attribut lu par le CSS** : une table de teintes par
// identifiant serait une seconde source.
test('la pastille prend la couleur du dossier coloré le plus proche', () => {
  const { container, unmount } = monter({ couleur: 'green' })
  expect((container.querySelector('span[style]') as HTMLElement).style.background).toContain(
    '--success',
  )
  unmount()

  const rouge = monter({ couleur: 'red' })
  expect((rouge.container.querySelector('span[style]') as HTMLElement).style.background).toContain(
    '--danger',
  )
})

test('la pastille de couleur est décorative', () => {
  const { container } = monter({ couleur: 'green' })
  expect(container.querySelector('span[style]')).toHaveAttribute('aria-hidden', 'true')
})

test('sans dossier coloré, aucune pastille — et plus aucun badge PROD', () => {
  const { container } = monter()
  expect(container.querySelector('span[style]')).toBeNull()
  expect(screen.queryByText('PROD')).toBeNull()
})

// --- Le fil d'Ariane ---

test('le fil d’Ariane est rendu quand il y en a un', () => {
  monter({ breadcrumb: 'catalogue · public' })
  expect(screen.getByText('catalogue · public')).toBeInTheDocument()
})

test('sans connexion ouverte, aucun fil d’Ariane', () => {
  monter()
  expect(screen.queryByText(/·/)).not.toBeInTheDocument()
})

// --- Les icônes de l'arbre (#183) ---

/** Les symboles dessinés par l'indicateur, dans l'ordre du document. */
const dessins = () =>
  [...racine().querySelectorAll('svg use')].map((use) => use.getAttribute('href'))

test('le chemin porte l’icône et la couleur du projet, comme sa ligne d’arbre', () => {
  monter({ projet: { icon: 'rocket', color: 'green' } })
  expect(dessins()).toEqual(['#i-rocket'])
  expect(racine().querySelector('svg')).toHaveStyle({ color: 'var(--success)' })
})

test('un projet sans icône choisie garde le `pin`', () => {
  monter({ projet: { icon: null, color: null } })
  expect(dessins()).toEqual(['#i-pin'])
})

test('le nom de la connexion est précédé de son icône, le logo du moteur à défaut', () => {
  monter({
    breadcrumb: 'catalogue · public',
    base: { engine: 'postgresql', icon: null, color: null },
  })
  expect(dessins()).toEqual(['#i-pin', '#i-pg'])
  // **Avant le nom** : l'icône est le voisin immédiat du fil d'Ariane.
  expect(screen.getByText('catalogue · public').previousElementSibling?.tagName).toBe('svg')
})

test('une icône choisie et une couleur choisie s’appliquent à la connexion', () => {
  monter({
    breadcrumb: 'catalogue · public',
    base: { engine: 'postgresql', icon: 'rocket', color: 'violet' },
  })
  const icone = screen.getByText('catalogue · public').previousElementSibling as SVGElement
  expect(icone.querySelector('use')).toHaveAttribute('href', '#i-rocket')
  expect(icone).toHaveStyle({ color: 'var(--violet)' })
})

// --- Le point d'état ---

// Un dossier n'a pas d'état de connexion — ses connexions en ont. Sans connexion ouverte, **aucun
// point** plutôt qu'un point gris inventé.
test('sans connexion ouverte, aucun point d’état', () => {
  const { container } = monter()
  expect(container.querySelector('[data-state]')).toBeNull()
})

// L'état entre dans le nom du groupe, par du texte masqué visuellement. `aria-label` sur le point
// lui-même serait ignoré : un `<span>` sans rôle ne le porte pas — même piège qu'en `08c`.
test('l’état de connexion est annoncé, en texte et non en couleur', () => {
  monter({ connection: CONNECTEE })
  expect(racine()).toHaveTextContent('connectée · PostgreSQL 17.6')
})

test('le point lui-même est décoratif', () => {
  const { container } = monter({ connection: CONNECTEE })
  expect(container.querySelector('[data-state]')).toHaveAttribute('aria-hidden', 'true')
})

test('les quatre états portent leur nature dans un attribut, pas dans une classe', () => {
  const etats: ConnectionState[] = [
    { kind: 'never' },
    { kind: 'connecting' },
    CONNECTEE,
    { kind: 'offline', reason: 'hôte injoignable' },
  ]
  for (const etat of etats) {
    const { container, unmount } = monter({ connection: etat })
    expect(container.querySelector(`[data-state="${etat.kind}"]`)).not.toBeNull()
    unmount()
  }
})

/*
 * **Le point change de sens quand quelque chose attend**, et c'est le mockup qui le dit : `A5` le
 * montre vert (connexion ouverte), `A6` ambre — la même connexion. Le badge lève l'ambiguïté sans
 * dépendre de la couleur.
 */
test('des modifications en attente font passer le point à l’ambre', () => {
  const { container } = monter({ connection: CONNECTEE, pendingChanges: 2 })
  expect(container.querySelector('[data-state="pending"]')).not.toBeNull()
})

test('le compte de modifications est annoncé, avec son pluriel', () => {
  const { unmount } = monter({ connection: CONNECTEE, pendingChanges: 2 })
  expect(racine()).toHaveTextContent('2 modifications en attente')
  unmount()

  monter({ connection: CONNECTEE, pendingChanges: 1 })
  expect(racine()).toHaveTextContent('1 modification en attente')
})

// --- Les deux badges qui ne cohabitent pas ---

test('le badge de lecture seule suit le réglage', () => {
  monter({ readOnly: true })
  expect(screen.getByText('Lecture seule')).toBeInTheDocument()
})

test('sans lecture seule, aucun badge', () => {
  monter()
  expect(screen.queryByText('Lecture seule')).toBeNull()
})

// **« Lecture seule » disparaît en édition** : les deux badges côte à côte se contrediraient. Le
// mockup d'`A6` met « ÉDITION » là où `A5` met « LECTURE SEULE ».
test('« ÉDITION » chasse « LECTURE SEULE », jamais les deux ensemble', () => {
  monter({ readOnly: true, pendingChanges: 3 })
  expect(screen.getByText('Édition')).toBeInTheDocument()
  expect(screen.queryByText('Lecture seule')).toBeNull()
})

// --- Les libellés d'état ---

test('les quatre libellés sont distincts et disent la nature de l’état', () => {
  const libelles = [
    libelleDeConnexion({ kind: 'never' }),
    libelleDeConnexion({ kind: 'connecting' }),
    libelleDeConnexion(CONNECTEE),
    libelleDeConnexion({ kind: 'offline', reason: 'hôte injoignable' }),
  ]
  expect(new Set(libelles).size).toBe(4)
  // « jamais connectée » n'est pas « hors ligne » : les confondre décrirait en panne une base
  // qu'on n'a simplement pas ouverte.
  expect(libelles[0]).not.toContain('hors ligne')
  expect(libelles[3]).toContain('hors ligne')
})

test('le libellé d’un échec porte la raison du moteur', () => {
  // `06b`–`06e` produisent des messages qui disent la manœuvre ; les réécrire créerait deux
  // vérités, dont une périmée.
  expect(libelleDeConnexion({ kind: 'offline', reason: 'hôte injoignable' })).toContain(
    'hôte injoignable',
  )
})

test('le libellé d’une connexion ouverte nomme la version du serveur', () => {
  // C'est ce qui distingue cette formulation du `resumeEtat` de l'arbre : une ligne d'arbre n'a pas
  // la place de la version, la barre de titre l'a.
  expect(libelleDeConnexion(CONNECTEE)).toContain('PostgreSQL 17.6')
})
