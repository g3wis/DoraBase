import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { ColumnInfo, DatabaseKey, RowWindow, Value } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { estNumerique, rendreValeur } from './cellule'
import { TableView } from './TableView'
import type { PasserelleLignes } from './useLignes'

const CLE: DatabaseKey = {
  project: 'Atelier Nord',
  database: 'analytics',
  environment: 'prod',
}

const colonne = (name: string, category: ColumnInfo['category']): ColumnInfo => ({
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
  colonne('id', 'number'),
  colonne('status', 'text'),
  colonne('shipped_at', 'timestamp'),
]

function fenetre(rows: Value[][], over: Partial<RowWindow> = {}): RowWindow {
  return {
    offset: 0,
    rows,
    total: null,
    sql: 'select * from public.orders limit 500 offset 0',
    durationMs: 41,
    ...over,
  }
}

function monter(resultat: RowWindow | Promise<never>, colonnes = COLONNES) {
  const passerelle: PasserelleLignes = {
    readRows: vi.fn(async () => {
      if (resultat instanceof Promise) return resultat
      return resultat
    }),
  }
  render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <TableView
          cle={CLE}
          schema="public"
          table="orders"
          columns={colonnes}
          passerelle={passerelle}
        />
      </LanguageProvider>
    </>,
  )
  return passerelle
}

describe('TableView', () => {
  it('demande une fenêtre bornée, jamais « tout »', async () => {
    const passerelle = monter(fenetre([[{ kind: 'int', value: 1 }]]))

    await waitFor(() => expect(passerelle.readRows).toHaveBeenCalled())
    const [cle, requete] = vi.mocked(passerelle.readRows).mock.calls[0] ?? []
    expect(cle).toEqual(CLE)
    // Le palier vient de `RowLimit`, énumération fermée : « demander tout » n'est pas
    // exprimable, et c'est le type qui le garantit — pas la discipline de l'appelant.
    expect(requete?.limit).toBe('fiveHundred')
    expect(requete?.offset).toBe(0)
    expect(requete?.schema).toBe('public')
    expect(requete?.table).toBe('orders')
  })

  it('rend une ligne par ligne reçue, avec son rang en gouttière', async () => {
    monter(
      fenetre([
        [{ kind: 'int', value: 184_220 }, { kind: 'text', value: 'paid' }, { kind: 'null' }],
        [{ kind: 'int', value: 184_219 }, { kind: 'text', value: 'pending' }, { kind: 'null' }],
      ]),
    )

    const grille = await screen.findByRole('grid', { name: 'Lignes de public.orders' })
    // Deux lignes de données, plus les **deux** lignes d'en-tête : celle des noms de colonnes et
    // celle des filtres (`10d`).
    await waitFor(() => expect(within(grille).getAllByRole('row')).toHaveLength(4))
    expect(within(grille).getByText('184 220')).toBeInTheDocument()
    expect(within(grille).getAllByText('NULL')).toHaveLength(2)
  })

  it('une table sans ligne le dit, et ne ressemble ni à un chargement ni à un échec', async () => {
    monter(fenetre([]))
    expect(await screen.findByText(/ne contient aucune ligne/)).toBeInTheDocument()
  })

  it('un échec de lecture est affiché, et la grille ne prétend pas être vide', async () => {
    const passerelle: PasserelleLignes = {
      readRows: vi.fn(async () => {
        throw new Error('la connexion a été fermée')
      }),
    }
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

    // Le message complet vit dans la **grille** ; la barre d'état, qui n'appartient plus à cette
    // vue depuis `10f`, ne porte que le verdict.
    expect(await screen.findByText(/la connexion a été fermée/)).toBeInTheDocument()
    expect(screen.queryByText(/ne contient aucune ligne/)).not.toBeInTheDocument()
  })

  it('réordonner une colonne au clavier change l’affichage, jamais les valeurs des cellules', async () => {
    const utilisateur = userEvent.setup()
    monter(
      fenetre([
        [
          { kind: 'int', value: 101 },
          { kind: 'text', value: 'paid' },
          { kind: 'text', value: '2024-01-01' },
        ],
      ]),
    )

    const grille = await screen.findByRole('grid', { name: 'Lignes de public.orders' })
    // **La première ligne seulement** : `filterRow` (`10d`) ajoute une seconde ligne
    // `role="columnheader"` pour les filtres, que `getAllByRole` sans portée confondrait.
    const enteteDesNoms = within(grille).getAllByRole('row')[0]
    if (enteteDesNoms === undefined) throw new Error('ligne d’en-tête introuvable')
    expect(
      within(enteteDesNoms)
        .getAllByRole('columnheader')
        .map((e) => e.textContent),
    ).toEqual(['#', 'id', 'status', 'shipped_at'])

    const poignee = screen.getByLabelText('Déplacer status (flèches gauche et droite)')
    poignee.focus()
    await utilisateur.keyboard('{ArrowLeft}')

    expect(
      within(enteteDesNoms)
        .getAllByRole('columnheader')
        .map((e) => e.textContent),
    ).toEqual(['#', 'status', 'id', 'shipped_at'])
    // **Les valeurs suivent leur colonne, pas la position d'affichage** : c'est le rang d'origine
    // dans `ligne.valeurs`, calculé avant tout réordonnancement, qui les désigne.
    const cellules = within(grille).getAllByRole('gridcell')
    expect(cellules.map((c) => c.textContent)).toEqual(['1', 'paid', '101', '2024-01-01'])
  })
})

describe('rendu d’une valeur', () => {
  // Un conteneur neuf par appel : deux rendus dans un même test laisseraient deux `cellule`
  // dans le document, et la requête échouerait sur l'ambiguïté plutôt que sur le fond.
  const rendu = (value: Value) => {
    const { container } = render(<span>{rendreValeur(value)}</span>)
    return container.firstElementChild as HTMLElement
  }

  it('rend NULL écrit, jamais du vide', () => {
    expect(rendu({ kind: 'null' })).toHaveTextContent('NULL')
  })

  it('distingue NULL de la chaîne vide', () => {
    render(
      <>
        <span data-testid="a">{rendreValeur({ kind: 'null' })}</span>
        <span data-testid="b">{rendreValeur({ kind: 'text', value: '' })}</span>
      </>,
    )
    expect(screen.getByTestId('a').textContent).toBe('NULL')
    expect(screen.getByTestId('b').textContent).toBe('')
  })

  it('groupe les entiers sans les abréger', () => {
    // `formatCount` rendrait « 1.9 M » : juste pour une tuile, faux dans une cellule où
    // l'utilisateur lit une valeur exacte de sa base.
    expect(rendu({ kind: 'int', value: 1_904_220 }).textContent).toBe('1 904 220')
  })

  it('ne retouche ni les flottants ni les dates', () => {
    expect(rendu({ kind: 'float', value: 12.5 })).toHaveTextContent('12.5')
    expect(rendu({ kind: 'timestamp', value: '2026-07-31 09:41:02' })).toHaveTextContent(
      '2026-07-31 09:41:02',
    )
  })

  it('rend un décimal exactement, sans reformatage', () => {
    // **Le défaut du 10 août 2026** : un `numeric` arrivait en `Null` faute de transtypage, et une
    // colonne de montants s'affichait vide. Corrigé côté Rust ; ici on vérifie que le genre est
    // rendu tel quel — le regrouper ou l'arrondir trahirait une valeur lue pour sa précision.
    expect(rendu({ kind: 'decimal', value: '12345678.91' }).textContent).toBe('12345678.91')
    expect(rendu({ kind: 'decimal', value: '0.0100' }).textContent).toBe('0.0100')
  })

  it('un décimal s’aligne à droite, comme un nombre', () => {
    // Il voyage en texte pour garder sa précision, mais c'est un nombre.
    expect(estNumerique({ kind: 'decimal', value: '1.5' })).toBe(true)
    expect(estNumerique({ kind: 'text', value: '1.5' })).toBe(false)
  })

  it('rend les booléens en toutes lettres', () => {
    expect(rendu({ kind: 'bool', value: true })).toHaveTextContent('true')
    expect(rendu({ kind: 'bool', value: false })).toHaveTextContent('false')
  })

  it('met un JSON sur une seule ligne', () => {
    const valeur = rendu({ kind: 'json', value: '{\n  "gift": true\n}' })
    expect(valeur.textContent).not.toContain('\n')
    expect(valeur).toHaveTextContent('{ "gift": true }')
  })

  it('rend la taille d’un binaire, jamais son contenu', () => {
    // 8 octets encodés : le contenu ne doit apparaître nulle part.
    const valeur = rendu({ kind: 'binary', base64: 'AQIDBAUGBwg=' })
    expect(valeur).toHaveTextContent('8 o')
    expect(valeur.textContent).not.toContain('AQIDBAUGBwg')
  })
})
