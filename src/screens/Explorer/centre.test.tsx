import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Sprite } from '../../design/icons/Sprite'
import type { TableSummary } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { BreadcrumbBar, type TypeObjet } from './BreadcrumbBar'
import { ObjectTable } from './ObjectTable'

const COMPTES = { tables: 4, views: 1, functions: 2, indexes: 6 }

function BarrePilotée(
  apparence: Pick<Parameters<typeof BreadcrumbBar>[0], 'engine' | 'icon' | 'color'>,
) {
  const [type, setType] = useState<TypeObjet>('tables')
  const [filtre, setFiltre] = useState('')
  return (
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <BreadcrumbBar
          database="analytics"
          {...apparence}
          schema="public"
          counts={COMPTES}
          type={type}
          onTypeChange={setType}
          filter={filtre}
          onFilterChange={setFiltre}
        />
      </LanguageProvider>
    </>
  )
}

const objet = (over: Partial<TableSummary> = {}): TableSummary => ({
  name: 'orders',
  kind: 'table',
  rows: { kind: 'estimated', value: 1_900_000 },
  sizeBytes: 2.1 * 1024 ** 3,
  columnCount: 18,
  primaryKey: 'id',
  lastAnalyze: '2026-08-06 04:12',
  comment: 'Commandes',
  ...over,
})

// --- Le fil d'Ariane ---

test('le chemin montre la base puis le schéma', () => {
  render(<BarrePilotée />)
  const fil = screen.getByRole('navigation', { name: /Chemin/ })
  expect(fil).toHaveTextContent('analytics')
  expect(fil).toHaveTextContent('public')
})

/** Le glyphe devant le nom de la base : son symbole, sa teinte, et la teinte imposée au logo. */
function glypheDuFil() {
  const svg = screen.getByRole('navigation', { name: /Chemin/ }).querySelector('svg')
  return {
    href: svg?.querySelector('use')?.getAttribute('href'),
    couleur: svg?.style.color,
    teinte: svg?.style.getPropertyValue('--logo-tint'),
  }
}

test('sans réglage, le fil d’Ariane porte le logo du moteur dans sa teinte de marque', () => {
  render(<BarrePilotée engine="postgresql" />)
  expect(glypheDuFil()).toEqual({ href: '#i-pg', couleur: 'var(--engine-pg)', teinte: '' })
})

test('le fil d’Ariane montre l’icône et la couleur choisies, comme la ligne de l’arbre (#179)', () => {
  const { unmount } = render(<BarrePilotée engine="postgresql" color="red" />)
  // La couleur s'impose au logo lui-même.
  expect(glypheDuFil()).toEqual({ href: '#i-pg', couleur: 'var(--danger)', teinte: 'currentColor' })
  unmount()
  render(<BarrePilotée engine="mysql" icon="rocket" />)
  expect(glypheDuFil()).toEqual({ href: '#i-rocket', couleur: 'var(--engine-my)', teinte: '' })
})

test('sans base ouverte, le fil d’Ariane garde l’icône générique', () => {
  render(<BarrePilotée />)
  expect(glypheDuFil().href).toBe('#i-db')
})

// --- Les comptes ---

// **Issus des données, jamais de constantes.** Les coder en dur les rendrait faux dès la première
// base réelle, et c'est le genre de valeur qu'on oublie de brancher parce qu'elle ressemble à du
// bon. Les valeurs ci-dessous sont celles du schéma de test, dont la composition est connue.
test('les quatre comptes viennent des données', () => {
  render(<BarrePilotée />)
  expect(screen.getByRole('radio', { name: 'Tables 4' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Vues 1' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Fonctions 2' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Index 6' })).toBeInTheDocument()
})

test('changer de segment ne change pas les comptes', async () => {
  render(<BarrePilotée />)
  await userEvent.click(screen.getByRole('radio', { name: 'Vues 1' }))
  // Le compte dit ce que le schéma contient, pas ce qui est affiché.
  expect(screen.getByRole('radio', { name: 'Tables 4' })).toBeInTheDocument()
})

// --- Le champ de filtre ---

// **Le mockup promet une recherche globale et un raccourci qui n'existent pas.** « Chercher un
// objet… ⌘P » annonce de traverser tous les schémas et tous les projets. Ce champ filtre la liste
// affichée, et le dit.
test('le champ de filtre dit ce qu’il filtre, et ne promet pas de recherche globale', () => {
  render(<BarrePilotée />)
  const champ = screen.getByRole('textbox', { name: /Filtrer les objets de public/ })
  expect(champ).toHaveAttribute('placeholder', expect.stringContaining('public'))
  expect(screen.queryByText('Chercher un objet…')).not.toBeInTheDocument()
})

// Un raccourci affiché qui ne répond pas est pire qu'un raccourci absent.
test('aucun rappel ⌘P tant que la recherche globale n’existe pas', () => {
  render(<BarrePilotée />)
  expect(screen.queryByText('⌘P')).not.toBeInTheDocument()
})

test('la saisie du filtre se voit', async () => {
  render(<BarrePilotée />)
  const champ = screen.getByRole('textbox', { name: /Filtrer les objets/ })
  await userEvent.type(champ, 'orders')
  expect(champ).toHaveValue('orders')
})

// --- Le tableau ---

function monterTableau(props: Partial<Parameters<typeof ObjectTable>[0]> = {}) {
  return render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <ObjectTable
        schema="public"
        objects={[objet()]}
        type="tables"
        onSelect={() => {}}
        {...props}
      />
    </LanguageProvider>,
  )
}

test('les sept colonnes du handoff sont là, dans l’ordre', () => {
  monterTableau()
  expect(screen.getAllByRole('columnheader').map((e) => e.textContent)).toEqual([
    'Nom',
    'Lignes',
    'Taille',
    'Col.',
    'Clé primaire',
    'Dernier ANALYZE',
    'Commentaire',
  ])
})

test('les valeurs sont formatées, pas brutes', () => {
  monterTableau()
  expect(screen.getByText('1.9 M')).toBeInTheDocument()
  expect(screen.getByText('2.1 GB')).toBeInTheDocument()
})

// **Un tiret cadratin, jamais zéro ni du vide.** « 0 ligne » sur un index serait un mensonge ; du
// vide ressemblerait à une donnée manquante.
test('les colonnes sans objet portent un tiret cadratin', () => {
  monterTableau({
    objects: [objet({ primaryKey: null, lastAnalyze: null, comment: null, sizeBytes: null })],
  })
  expect(screen.getAllByText('—')).toHaveLength(4)
})

// `06c` traduit `reltuples = -1` — « jamais analysée » — et une valeur négative ne doit pas
// s'afficher comme un nombre.
test('une table jamais analysée affiche un tiret, pas zéro', () => {
  monterTableau({ objects: [objet({ rows: { kind: 'estimated', value: -1 } })] })
  expect(screen.getByText('—')).toBeInTheDocument()
  expect(screen.queryByText('0')).not.toBeInTheDocument()
})

// --- Les trois états vides ---

// Vide, chargement et échec se distinguent, et aucun ne ressemble aux deux autres. Le handoff
// n'en maquette aucun des trois.
test('un schéma vide le dit, en nommant le type d’objet', () => {
  monterTableau({ objects: [], type: 'views' })
  expect(screen.getByText(/ne contient aucune vue/)).toBeInTheDocument()
})

test('le chargement se distingue du vide', () => {
  monterTableau({ objects: [], loading: true })
  expect(screen.getByText(/Chargement des objets/)).toBeInTheDocument()
})

test('un échec se distingue des deux autres, et porte le message du moteur', () => {
  monterTableau({ objects: [], error: 'hôte injoignable' })
  expect(screen.getByText('hôte injoignable')).toBeInTheDocument()
  expect(screen.queryByText(/Chargement/)).not.toBeInTheDocument()
  expect(screen.queryByText(/ne contient aucune/)).not.toBeInTheDocument()
})

test('un échec l’emporte sur le chargement', () => {
  // Les deux peuvent être vrais si l'échec arrive pendant qu'un autre chargement est en cours :
  // c'est l'échec qu'il faut montrer.
  monterTableau({ objects: [], loading: true, error: 'échec' })
  expect(screen.getByText('échec')).toBeInTheDocument()
})

// --- La sélection ---

test('une ligne sélectionnée s’annonce comme telle', async () => {
  const choisis: TableSummary[] = []
  monterTableau({ onSelect: (o) => choisis.push(o) })
  await userEvent.click(screen.getByRole('rowheader', { name: 'orders' }))
  expect(choisis.map((o) => o.name)).toEqual(['orders'])
})

test('la ligne choisie porte aria-selected', () => {
  monterTableau({ selectedName: 'orders' })
  expect(screen.getAllByRole('row')[1]).toHaveAttribute('aria-selected', 'true')
})

// --- Le clic droit (#162) ---

/**
 * L'espion du presse-papiers. `navigator.clipboard` n'a qu'un accesseur sous jsdom : `Object.assign`
 * échoue, il faut redéfinir la propriété.
 */
function espionnerLePressePapiers() {
  const writeText = vi.fn(async (_texte: string) => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

test('le clic droit sur une ligne ouvre un menu qui copie son nom', async () => {
  const writeText = espionnerLePressePapiers()
  monterTableau()
  fireEvent.contextMenu(screen.getByRole('rowheader', { name: 'orders' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Copier le nom' }))
  // **Le nom nu**, jamais `public.orders` : le schéma est le palier au-dessus, et le fil d'Ariane le
  // nomme déjà à l'écran.
  expect(writeText).toHaveBeenCalledWith('orders')
})

/**
 * **Le menu vise la ligne cliquée, pas la ligne sélectionnée.**
 *
 * Les deux coïncident dès qu'on clique — le clic droit sélectionne aussi —, et c'est ce qui rend ce
 * contrôle nécessaire : un menu câblé sur `selectedName` passerait le test précédent et copierait la
 * mauvaise ligne ici. Règle n° 5 : rendre les deux distinguables.
 */
test('le nom copié est celui de la ligne visée, pas celui de la sélection', async () => {
  const writeText = espionnerLePressePapiers()
  monterTableau({
    objects: [objet(), objet({ name: 'customers' })],
    selectedName: 'orders',
  })
  fireEvent.contextMenu(screen.getByRole('rowheader', { name: 'customers' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Copier le nom' }))
  expect(writeText).toHaveBeenCalledWith('customers')
})

/**
 * **Toute ligne listée le porte, pas seulement une table** (#162). L'entrée copie le nom de ce qui
 * est sur la ligne ; un index n'y ferait pas exception, et le segment actif ne change rien au geste.
 */
test('une vue et un index le portent aussi', async () => {
  const writeText = espionnerLePressePapiers()
  monterTableau({ objects: [objet({ name: 'orders_by_day', kind: 'view' })], type: 'views' })
  fireEvent.contextMenu(screen.getByRole('rowheader', { name: /^orders_by_day$/ }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Copier le nom' }))
  expect(writeText).toHaveBeenCalledWith('orders_by_day')
})

// **Le menu du système ne doit pas s'ouvrir par-dessus le nôtre.** `useClicDroitDesactive` le
// refuse globalement, mais ce gestionnaire-là est la raison pour laquelle il ne doit pas paraître :
// l'écrire au même endroit que l'ouverture garde les deux ensemble.
test('le clic droit empêche le menu du système', () => {
  monterTableau()
  const evenement = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  screen.getByRole('rowheader', { name: 'orders' }).dispatchEvent(evenement)
  expect(evenement.defaultPrevented).toBe(true)
})
