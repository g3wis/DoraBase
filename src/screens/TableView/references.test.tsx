import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type {
  ColumnInfo,
  DatabaseKey,
  Filter,
  Relation,
  RowWindow,
  Value,
} from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import type { EnAttente } from './modifications'
import { TableView } from './TableView'
import type { PasserelleLignes } from './useLignes'

/**
 * Suivre une clé étrangère depuis la grille (`API-55`).
 *
 * Ce que ce fichier **ne peut pas** juger, et qui va donc en bout de chaîne : que le bouton tienne
 * dans la cellule sans recouvrir la valeur, et qu'il ne paraisse qu'au survol. jsdom ne calcule
 * aucune mise en page (règle n° 9) et ne résout pas `visibility: var(--cell-actions)` — ici, tous
 * les boutons sont donc « visibles ». C'est `e2e/references.spec.ts` qui mesure.
 */

const CLE: DatabaseKey = { project: 'Atelier Nord', database: 'analytics', environment: 'prod' }

const colonne = (name: string, over: Partial<ColumnInfo> = {}): ColumnInfo => ({
  position: 1,
  name,
  typeName: 'int8',
  category: 'number',
  nullable: true,
  default: null,
  identity: null,
  key: null,
  comment: null,
  frequency: null,
  ...over,
})

const COLONNES = [
  colonne('id', { key: 'primary' }),
  colonne('user_id', { key: 'foreign' }),
  colonne('status', { typeName: 'text', category: 'text' }),
]

const VERS_USERS: Relation = {
  constraintName: 'orders_user_id_fkey',
  direction: 'outgoing',
  cardinality: 'many',
  columns: ['user_id'],
  targetSchema: 'public',
  targetTable: 'users',
  targetColumns: ['id'],
}

/** Deux lignes : la première désigne `users.id = 42`, la seconde ne désigne personne. */
const LIGNES: Value[][] = [
  [
    { kind: 'int', value: 1 },
    { kind: 'int', value: 42 },
    { kind: 'text', value: 'paid' },
  ],
  [{ kind: 'int', value: 2 }, { kind: 'null' }, { kind: 'text', value: 'pending' }],
]

function fenetre(rows: Value[][]): RowWindow {
  return {
    offset: 0,
    rows,
    total: null,
    sql: 'select * from public.orders limit 500 offset 0',
    durationMs: 41,
  }
}

type Options = {
  relations?: readonly Relation[]
  onSuivreLaReference?: (cible: { schema: string; table: string; filters: Filter[] }) => void
  arrivee?: { jeton: number; filters: readonly Filter[] } | null
  onArriveeAppliquee?: () => void
}

function monter(options: Options = {}) {
  const passerelle: PasserelleLignes = { readRows: vi.fn(async () => fenetre(LIGNES)) }
  const vue = (opts: Options) => (
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <TableView
          cle={CLE}
          schema="public"
          table="orders"
          columns={COLONNES}
          relations={opts.relations ?? [VERS_USERS]}
          onSuivreLaReference={opts.onSuivreLaReference ?? (() => {})}
          arrivee={opts.arrivee ?? null}
          onArriveeAppliquee={opts.onArriveeAppliquee}
          passerelle={passerelle}
        />
      </LanguageProvider>
    </>
  )
  const { rerender } = render(vue(options))
  return { passerelle, rerender: (suite: Options) => rerender(vue({ ...options, ...suite })) }
}

async function grille() {
  const trouvee = await screen.findByRole('grid', { name: 'Lignes de public.orders' })
  await waitFor(() => expect(within(trouvee).getAllByRole('gridcell').length).toBeGreaterThan(3))
  return trouvee
}

describe('la colonne de clé étrangère se marque', () => {
  it('nomme la colonne suivie, et ne touche pas les autres', async () => {
    monter()
    const g = await grille()

    const entete = within(g).getByRole('columnheader', { name: 'user_id — clé étrangère' })
    // **Le glyphe, et pas seulement le nom accessible.** Les deux disent la même chose à deux
    // publics, et une assertion sur le seul nom laisserait retirer le dessin sans rien casser.
    // `Icon` pose `aria-hidden`, donc c'est le `title` de son enveloppe qui le désigne — et il
    // porte au passage la cible, que le nom accessible laisse volontairement de côté.
    expect(within(entete).getByTitle('Clé étrangère vers users.id')).toBeInTheDocument()
    expect(entete.querySelector('use[href="#i-fk"]')).not.toBeNull()
    // **Les autres colonnes gardent leur nom nu.** Une marque partout ne marquerait rien, et
    // `id` est une clé *primaire* — le glyphe de ce chantier ne parle que des sortantes.
    expect(within(g).getByRole('columnheader', { name: /^id$/ })).toBeInTheDocument()
    expect(within(g).getByRole('columnheader', { name: /^status$/ })).toBeInTheDocument()
  })

  it('sans relation, la grille est celle d’avant', async () => {
    monter({ relations: [] })
    const g = await grille()

    // Le cas de MongoDB et de BigQuery, qui ne déclarent aucune clé étrangère : rien à marquer,
    // et rien à désactiver avec sa raison — il n'y a rien à offrir.
    expect(within(g).getByRole('columnheader', { name: /^user_id$/ })).toBeInTheDocument()
    expect(within(g).queryByTitle(/Clé étrangère/)).not.toBeInTheDocument()
    expect(within(g).queryByRole('button', { name: /^Suivre/ })).not.toBeInTheDocument()
  })
})

describe('le bouton de la cellule', () => {
  it('mène à la table visée, filtrée sur la ligne désignée', async () => {
    const utilisateur = userEvent.setup()
    const suivre = vi.fn()
    monter({ onSuivreLaReference: suivre })
    const g = await grille()

    await utilisateur.click(
      within(g).getByRole('button', { name: 'Suivre user_id de la ligne 1 vers users.id' }),
    )
    expect(suivre).toHaveBeenCalledWith({
      schema: 'public',
      table: 'users',
      filters: [{ column: 'id', operator: 'eq', value: '42' }],
    })
  })

  it('ne paraît pas sur une cellule nulle, qui ne désigne aucune ligne', async () => {
    monter()
    const g = await grille()

    expect(
      within(g).queryByRole('button', { name: 'Suivre user_id de la ligne 2 vers users.id' }),
    ).not.toBeInTheDocument()
  })

  it('ne choisit pas la ligne qu’on quitte', async () => {
    const utilisateur = userEvent.setup()
    const rang = vi.fn()
    const passerelle: PasserelleLignes = { readRows: vi.fn(async () => fenetre(LIGNES)) }
    render(
      <>
        <Sprite />
        <LanguageProvider preferences={{ language: 'fr' }}>
          <TableView
            cle={CLE}
            schema="public"
            table="orders"
            columns={COLONNES}
            relations={[VERS_USERS]}
            onSuivreLaReference={() => {}}
            onRangChange={rang}
            passerelle={passerelle}
          />
        </LanguageProvider>
      </>,
    )
    const g = await grille()

    await utilisateur.click(
      within(g).getByRole('button', { name: 'Suivre user_id de la ligne 1 vers users.id' }),
    )
    // Le clic s'arrête au bouton : suivre une référence emmène ailleurs, ce n'est pas l'occasion
    // de désigner la ligne qu'on quitte.
    expect(rang).not.toHaveBeenCalled()
  })
})

describe('le bouton et la saisie en attente', () => {
  it('disparaît dès qu’une saisie est retenue sur la cellule', async () => {
    const utilisateur = userEvent.setup()
    const passerelle: PasserelleLignes = { readRows: vi.fn(async () => fenetre(LIGNES)) }
    // L'attente est **contrôlée par l'écran** (`11b`) : le harnais la tient, comme `Workbench`.
    function Harnais() {
      const [attente, setAttente] = useState<EnAttente>([])
      return (
        <TableView
          cle={CLE}
          schema="public"
          table="orders"
          columns={COLONNES}
          relations={[VERS_USERS]}
          onSuivreLaReference={() => {}}
          edition
          attente={attente}
          onAttenteChange={setAttente}
          passerelle={passerelle}
        />
      )
    }
    render(
      <>
        <Sprite />
        <LanguageProvider preferences={{ language: 'fr' }}>
          <Harnais />
        </LanguageProvider>
      </>,
    )
    const g = await grille()
    const nom = 'Suivre user_id de la ligne 1 vers users.id'
    expect(within(g).getByRole('button', { name: nom })).toBeInTheDocument()

    // La première ligne : les deux en portent une, et c'est celle qui désigne `users.id = 42`.
    const cellule = within(g).getAllByRole('button', { name: 'Modifier user_id' })[0]
    if (!cellule) throw new Error('cellule éditable introuvable')
    await utilisateur.click(cellule)
    await utilisateur.type(screen.getByRole('textbox', { name: 'Nouvelle valeur' }), '77{Enter}')

    // **La saisie n'a pas de ligne au bout** : elle n'est pas écrite, donc `users.id = 77` ne
    // désigne peut-être rien. Et suivre l'ancienne valeur mènerait à une ligne que la cellule ne
    // montre plus — un bouton qui contredit ce qu'on lit juste à sa gauche.
    await waitFor(() =>
      expect(within(g).queryByRole('button', { name: nom })).not.toBeInTheDocument(),
    )
  })
})

describe('le menu du clic droit', () => {
  it('porte l’entrée sur une colonne suivie, et pas ailleurs', async () => {
    const utilisateur = userEvent.setup()
    const suivre = vi.fn()
    monter({ onSuivreLaReference: suivre })
    const g = await grille()

    const cellules = within(g).getAllByRole('gridcell')
    // Gouttière, `id`, `user_id` : la troisième cellule de la première ligne.
    const cellule = cellules[2]
    if (!cellule) throw new Error('cellule introuvable')
    fireEvent.contextMenu(cellule, { clientX: 60, clientY: 60 })
    const menu = await screen.findByRole('menu', { name: 'Actions sur la valeur de user_id' })
    await utilisateur.click(within(menu).getByRole('menuitem', { name: 'Aller à la ligne liée' }))
    expect(suivre).toHaveBeenCalledWith({
      schema: 'public',
      table: 'users',
      filters: [{ column: 'id', operator: 'eq', value: '42' }],
    })

    const statut = cellules[3]
    if (!statut) throw new Error('cellule introuvable')
    fireEvent.contextMenu(statut, { clientX: 60, clientY: 60 })
    const autre = await screen.findByRole('menu', { name: 'Actions sur la valeur de status' })
    // **L'entrée n'existe pas** sur une colonne qui ne mène nulle part — la proposer partout
    // ferait chercher à quoi elle sert.
    expect(
      within(autre).queryByRole('menuitem', { name: 'Aller à la ligne liée' }),
    ).not.toBeInTheDocument()
  })

  it('reste, désactivée avec sa raison, sur une cellule nulle', async () => {
    monter()
    const g = await grille()

    // La ligne 2 : gouttière, `id`, `user_id` — donc la septième cellule de la grille.
    const cellule = within(g).getAllByRole('gridcell')[6]
    if (!cellule) throw new Error('cellule introuvable')
    fireEvent.contextMenu(cellule, { clientX: 60, clientY: 60 })

    const menu = await screen.findByRole('menu', { name: 'Actions sur la valeur de user_id' })
    const entree = within(menu).getByRole('menuitem', { name: 'Aller à la ligne liée' })
    // **Désactivée, et non absente** : c'est la cellule qui ne désigne personne, pas le geste qui
    // n'existe pas sur cette colonne.
    expect(entree).toBeDisabled()
    expect(entree).toHaveAttribute(
      'title',
      'Cette cellule est vide : elle ne désigne aucune ligne.',
    )
  })
})

describe('le saut qui arrive', () => {
  it('pose ses filtres sur la lecture', async () => {
    const { passerelle, rerender } = monter()
    await grille()

    rerender({ arrivee: { jeton: 1, filters: [{ column: 'id', operator: 'eq', value: '42' }] } })
    await waitFor(() => {
      const derniere = vi.mocked(passerelle.readRows).mock.calls.at(-1)
      expect(derniere?.[1].filters).toEqual([{ column: 'id', operator: 'eq', value: '42' }])
    })
  })

  it('ne s’applique qu’une fois, même si l’appelant repose le même saut', async () => {
    const utilisateur = userEvent.setup()
    const { passerelle, rerender } = monter()
    await grille()

    rerender({ arrivee: { jeton: 7, filters: [{ column: 'id', operator: 'eq', value: '42' }] } })
    await waitFor(() =>
      expect(vi.mocked(passerelle.readRows).mock.calls.at(-1)?.[1].filters).toHaveLength(1),
    )

    // L'utilisateur reprend la main sur le filtre que le saut avait posé.
    const champ = screen.getByRole('textbox', { name: 'Filtrer id' })
    await utilisateur.clear(champ)
    await utilisateur.type(champ, '99{Enter}')
    await waitFor(() =>
      expect(vi.mocked(passerelle.readRows).mock.calls.at(-1)?.[1].filters).toEqual([
        { column: 'id', operator: 'eq', value: '99' },
      ]),
    )

    // **Un objet neuf, le même jeton** : c'est ce que fait un appelant qui reconstruit ses props à
    // chaque rendu. Sans le témoin de jeton, la saisie de l'utilisateur serait écrasée par un saut
    // déjà consommé.
    rerender({ arrivee: { jeton: 7, filters: [{ column: 'id', operator: 'eq', value: '42' }] } })
    await waitFor(() => expect(true).toBe(true))
    expect(vi.mocked(passerelle.readRows).mock.calls.at(-1)?.[1].filters).toEqual([
      { column: 'id', operator: 'eq', value: '99' },
    ])
  })
})
