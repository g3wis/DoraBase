import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sprite } from '../../design/icons/Sprite'
import type { ColumnInfo, TableDetail } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { DetailPanel } from './DetailPanel'

const colonne = (name: string, over: Partial<ColumnInfo> = {}): ColumnInfo => ({
  position: 1,
  name,
  typeName: 'integer',
  category: 'number',
  nullable: false,
  default: null,
  identity: null,
  key: null,
  comment: null,
  frequency: null,
  ...over,
})

const detail = (over: Partial<TableDetail> = {}): TableDetail => ({
  schema: 'public',
  name: 'orders',
  rows: { kind: 'estimated', value: 1_900_000 },
  sizeBytes: 2.1 * 1024 ** 3,
  comment: null,
  columns: Array.from({ length: 18 }, (_, i) => colonne(`col_${i}`)),
  indexes: [],
  constraints: [],
  triggers: [],
  relations: [],
  ddl: '',
  wordSimilarity: false,
  ...over,
})

function monter(props: Partial<Parameters<typeof DetailPanel>[0]> = {}) {
  return render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <DetailPanel detail={detail()} schema="public" {...props} />
      </LanguageProvider>
    </>,
  )
}

// --- Sans sélection ---

// **Le panneau le dit** plutôt que de laisser 300 px blancs — ou de sélectionner d'office la
// première ligne, ce qui déclencherait une requête `table_detail` non demandée.
test('sans sélection, le panneau le dit', () => {
  monter({ detail: null })
  expect(screen.getByText(/Sélectionnez un objet/)).toBeInTheDocument()
})

test('les trois états sans contenu se distinguent', () => {
  const { unmount } = monter({ detail: null })
  expect(screen.getByText(/Sélectionnez un objet/)).toBeInTheDocument()
  unmount()

  const b = monter({ detail: null, loading: true })
  expect(screen.getByText(/Chargement du détail/)).toBeInTheDocument()
  b.unmount()

  monter({ detail: null, error: 'hôte injoignable' })
  expect(screen.getByText('hôte injoignable')).toBeInTheDocument()
})

// --- Les tuiles ---

// **Le compte de lignes est une estimation, la taille est exacte.** `RowCount` le dit au niveau
// du type (`06c`) : le drapeau se **dérive**, il n'est pas supposé.
test('la tuile de lignes signale l’estimation, celle de taille non', () => {
  monter()
  expect(screen.getByTitle(/estimation du catalogue/)).toHaveTextContent('1.9 M')
  expect(screen.getByText('2.1 GB').closest('[title]')).toBeNull()
})

test('un comptage exact ne porte pas la mention', () => {
  monter({ detail: detail({ rows: { kind: 'exact', value: 42 } }) })
  expect(screen.queryByTitle(/estimation/)).not.toBeInTheDocument()
})

// `06c` traduit `reltuples = -1` — jamais analysée. Un tiret, pas zéro.
test('une table jamais analysée affiche un tiret', () => {
  monter({ detail: detail({ rows: { kind: 'estimated', value: -1 } }) })
  expect(screen.getByTitle(/estimation/)).toHaveTextContent('—')
})

test('une vue sans taille physique affiche un tiret', () => {
  monter({ detail: detail({ sizeBytes: null }) })
  expect(screen.getByText('—')).toBeInTheDocument()
})

// --- Les colonnes ---

// **Les cinq premières du catalogue**, et non « les cinq plus significatives » : c'est l'ordre
// que l'utilisateur connaît de sa table, et « significatif » demanderait une règle non écrite.
test('cinq colonnes sont montrées, et le reste est compté', () => {
  monter()
  expect(screen.getByText('col_0')).toBeInTheDocument()
  expect(screen.getByText('col_4')).toBeInTheDocument()
  expect(screen.queryByText('col_5')).not.toBeInTheDocument()
  expect(screen.getByText('+ 13 autres…')).toBeInTheDocument()
})

test('le titre porte le compte complet, pas celui de l’aperçu', () => {
  monter()
  expect(screen.getByText(/Colonnes · 18/)).toBeInTheDocument()
})

test('une table de moins de cinq colonnes n’affiche aucun reste', () => {
  monter({ detail: detail({ columns: [colonne('id'), colonne('nom')] }) })
  expect(screen.queryByText(/autres…/)).not.toBeInTheDocument()
})

// --- Les actions ---

// **Décision inverse de `A1` et `08b`, assumée.** Là un seul bouton était inerte et son écran
// venait dans la spec suivante ; ici quatre sur quatre le sont, à trois specs de distance. Un
// panneau dont tout est cliquable et rien ne répond est pire qu'un panneau qui dit ce qui manque.
test('les quatre actions sont annoncées indisponibles', () => {
  monter()
  for (const nom of ['Ouvrir les données', 'Structure', 'SELECT dans console', 'Exporter CSV']) {
    expect(screen.getByRole('button', { name: nom })).toHaveAttribute('aria-disabled', 'true')
  }
})

// `aria-disabled` et non `disabled` : un bouton désactivé ne reçoit ni focus ni survol, donc son
// infobulle serait inatteignable — exactement là où elle est le plus utile.
test('chaque action dit dans son infobulle quel écran l’apportera', async () => {
  monter()
  await userEvent.hover(screen.getByRole('button', { name: 'Ouvrir les données' }))
  expect(screen.getByRole('tooltip')).toHaveTextContent('A5')
})

test('les quatre infobulles nomment quatre écrans distincts', async () => {
  monter()
  const ecrans: string[] = []
  for (const nom of ['Ouvrir les données', 'Structure', 'SELECT dans console', 'Exporter CSV']) {
    await userEvent.hover(screen.getByRole('button', { name: nom }))
    ecrans.push(screen.getByRole('tooltip').textContent ?? '')
    await userEvent.unhover(screen.getByRole('button', { name: nom }))
  }
  expect(new Set(ecrans).size).toBe(4)
})

// C'est ce que `aria-disabled` achète : un `disabled` retirerait le bouton du parcours clavier,
// et son infobulle deviendrait inatteignable — exactement là où elle est le plus utile.
test('les actions restent atteignables au clavier malgré leur indisponibilité', async () => {
  monter()
  // Tabulation depuis le début : épingle, puis les quatre actions.
  await userEvent.tab()
  await userEvent.tab()
  const ouvrir = screen.getByRole('button', { name: 'Ouvrir les données' })
  expect(ouvrir).toHaveFocus()
  expect(screen.getByRole('tooltip')).toHaveTextContent('A5')
})

// --- Les relations ---

// **La direction n'est pas décorative.** Une relation sortante dit de quoi cette table dépend,
// une entrante dit qui dépend d'elle : les afficher pareil ferait lire deux faits de même nature
// alors que l'un se lit dans l'autre sens.
test('les relations sortantes et entrantes se lisent dans le bon sens', () => {
  monter({
    detail: detail({
      relations: [
        {
          constraintName: 'fk_user',
          direction: 'outgoing',
          cardinality: 'many',
          columns: ['user_id'],
          targetSchema: 'public',
          targetTable: 'users',
          targetColumns: ['id'],
        },
        {
          constraintName: 'fk_invoice',
          direction: 'incoming',
          cardinality: 'many',
          columns: ['id'],
          targetSchema: 'public',
          targetTable: 'invoices',
          targetColumns: ['order_id'],
        },
      ],
    }),
  })
  expect(screen.getByText('user_id → users.id')).toBeInTheDocument()
  expect(screen.getByText('invoices.order_id → id')).toBeInTheDocument()
})

test('sans clé étrangère, le bloc le dit', () => {
  monter()
  expect(screen.getByText('Aucune clé étrangère')).toBeInTheDocument()
})

// --- L'épingle ---

test('l’épingle annonce son état et bascule', async () => {
  const basculer = vi.fn()
  monter({ pinned: false, onTogglePin: basculer })
  const epingle = screen.getByRole('button', { name: 'Épingler le panneau' })
  expect(epingle).toHaveAttribute('aria-pressed', 'false')
  await userEvent.click(epingle)
  expect(basculer).toHaveBeenCalledOnce()
})

test('le panneau est nommé par l’objet qu’il détaille', () => {
  monter()
  expect(screen.getByRole('complementary', { name: 'Détail de public.orders' })).toBeInTheDocument()
})
