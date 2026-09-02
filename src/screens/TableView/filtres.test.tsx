import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { ColumnInfo, DatabaseKey, RowQuery } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { TableView } from './TableView'
import type { PasserelleLignes } from './useLignes'

const CLE: DatabaseKey = {
  project: 'Atelier Nord',
  database: 'analytics',
  environment: 'prod',
}

const colonne = (name: string, category: ColumnInfo['category'] = 'text'): ColumnInfo => ({
  position: 1,
  name,
  typeName: 'text',
  category,
  nullable: true,
  default: null,
  identity: null,
  key: null,
  comment: null,
  frequency: null,
})

const COLONNES = [
  colonne('status'),
  colonne('total_cents', 'number'),
  colonne('created_at', 'timestamp'),
]

function monter() {
  const readRows = vi.fn(async (_cle: DatabaseKey, requete: RowQuery) => ({
    offset: 0,
    rows: [
      [
        { kind: 'text' as const, value: 'paid' },
        { kind: 'int' as const, value: 1 },
        { kind: 'null' as const },
      ],
    ],
    total: null,
    sql: `select * from public.orders limit 500 offset 0 -- ${requete.filters.length} filtre(s)`,
    durationMs: 41,
  }))
  const passerelle: PasserelleLignes = { readRows }
  render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <TableView
          cle={CLE}
          schema="public"
          table="orders"
          columns={COLONNES}
          passerelle={passerelle}
        />
      </LanguageProvider>
    </>,
  )
  return { readRows }
}

/** La dernière requête envoyée au serveur. */
function derniereRequete(readRows: ReturnType<typeof monter>['readRows']): RowQuery {
  const appels = vi.mocked(readRows).mock.calls
  return appels[appels.length - 1]?.[1] as RowQuery
}

describe('filtres par en-tête', () => {
  it('un filtre appliqué part au serveur, il ne trie pas la fenêtre', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    await utilisateur.type(await screen.findByLabelText('Filtrer status'), 'paid{Enter}')

    // **Le critère central de `10d`.** Filtrer les lignes déjà reçues serait immédiat et faux :
    // l'utilisateur croirait voir toutes les commandes payées de la table alors qu'il ne verrait
    // que celles des cinq cents premières lignes lues. Le test porte donc sur la **requête**.
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(2))
    expect(derniereRequete(readRows).filters).toEqual([
      { column: 'status', operator: 'eq', value: 'paid' },
    ])
  })

  it('taper sans valider n’envoie rien', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    // Un filtre relancé à chaque frappe enverrait cinq requêtes pour `paid`.
    await utilisateur.type(await screen.findByLabelText('Filtrer status'), 'paid')
    expect(readRows).toHaveBeenCalledTimes(1)
  })

  it('la perte de focus applique, comme Entrée', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    await utilisateur.type(await screen.findByLabelText('Filtrer status'), 'paid')
    await utilisateur.tab()

    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(2))
    expect(derniereRequete(readRows).filters).toHaveLength(1)
  })

  it('vider un filtre le retire de la requête', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    const champ = await screen.findByLabelText('Filtrer status')

    await utilisateur.type(champ, 'paid{Enter}')
    await waitFor(() => expect(derniereRequete(readRows).filters).toHaveLength(1))

    await utilisateur.clear(champ)
    await utilisateur.keyboard('{Enter}')
    await waitFor(() => expect(derniereRequete(readRows).filters).toHaveLength(0))
  })

  it('« is null » s’applique sans saisie et désactive le champ', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    await utilisateur.click(screen.getByRole('button', { name: 'Opérateur de created_at' }))
    await utilisateur.click(await screen.findByRole('button', { name: /is null/ }))

    await waitFor(() =>
      expect(derniereRequete(readRows).filters).toEqual([
        { column: 'created_at', operator: 'isNull', value: null },
      ]),
    )
    expect(screen.getByLabelText('Filtrer created_at')).toBeDisabled()
  })

  it('le popover propose les cinq opérateurs de `FilterOperator` sur une colonne texte', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await utilisateur.click(await screen.findByRole('button', { name: 'Opérateur de status' }))

    const panneau = await screen.findByRole('dialog', { name: 'Opérateur · status' })
    expect(panneau.querySelectorAll('li')).toHaveLength(5)
  })

  it('le popover ajoute les quatre comparaisons sur une colonne numérique', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await utilisateur.click(await screen.findByRole('button', { name: 'Opérateur de total_cents' }))

    const panneau = await screen.findByRole('dialog', { name: 'Opérateur · total_cents' })
    // Les cinq de base, plus `>`, `≥`, `≤`, `<` — réservées aux colonnes numériques.
    expect(panneau.querySelectorAll('li')).toHaveLength(9)
  })

  it('une comparaison numérique part au serveur', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    await utilisateur.click(await screen.findByRole('button', { name: 'Opérateur de total_cents' }))
    await utilisateur.click(await screen.findByRole('button', { name: /supérieur à/ }))
    await utilisateur.type(await screen.findByLabelText('Filtrer total_cents'), '5000{Enter}')

    await waitFor(() =>
      expect(derniereRequete(readRows).filters).toEqual([
        { column: 'total_cents', operator: 'gt', value: '5000' },
      ]),
    )
  })
})

describe('tri', () => {
  it('un clic trie côté serveur, un second inverse le sens', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    const entete = screen.getByRole('button', { name: 'Trier par created_at' })
    await utilisateur.click(entete)
    await waitFor(() =>
      expect(derniereRequete(readRows).sort).toEqual([
        { column: 'created_at', direction: 'ascending' },
      ]),
    )

    await utilisateur.click(entete)
    await waitFor(() =>
      expect(derniereRequete(readRows).sort).toEqual([
        { column: 'created_at', direction: 'descending' },
      ]),
    )
  })

  it('un ⌘-clic empile un second critère, dans l’ordre des clics', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    await utilisateur.click(screen.getByRole('button', { name: 'Trier par created_at' }))
    await utilisateur.keyboard('{Meta>}')
    await utilisateur.click(screen.getByRole('button', { name: 'Trier par status' }))
    await utilisateur.keyboard('{/Meta}')

    await waitFor(() =>
      expect(derniereRequete(readRows).sort.map((c) => c.column)).toEqual(['created_at', 'status']),
    )
  })

  it('la pastille de rang n’apparaît qu’à partir de deux critères', async () => {
    const utilisateur = userEvent.setup()
    monter()

    // Dans l'**en-tête** : « 1 » se trouve aussi dans la gouttière et dans les cellules, où il
    // ne veut rien dire de tel.
    const rang = (entete: HTMLElement) => entete.querySelector('[class*="rang"]')

    const created = await screen.findByRole('button', { name: 'Trier par created_at' })
    await utilisateur.click(created)
    // Un « 1 » solitaire sur la seule colonne triée serait du bruit.
    expect(rang(created)).toBeNull()

    await utilisateur.keyboard('{Meta>}')
    await utilisateur.click(screen.getByRole('button', { name: 'Trier par status' }))
    await utilisateur.keyboard('{/Meta}')

    expect(rang(screen.getByRole('button', { name: 'Trier par created_at' }))).toHaveTextContent(
      '1',
    )
    expect(rang(screen.getByRole('button', { name: 'Trier par status' }))).toHaveTextContent('2')
  })
})
