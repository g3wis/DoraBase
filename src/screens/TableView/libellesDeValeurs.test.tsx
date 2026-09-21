import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { ColumnInfo, DatabaseKey, RowQuery, Value } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import type { LibellesDeTable } from './libelles'
import { TableView } from './TableView'
import type { PasserelleLignes } from './useLignes'

/**
 * Les libellés de valeurs dans la vue de table (`API-75`) — le **câblage**, là où `libelles.test.ts`
 * garde le calcul.
 *
 * Ce qui n'est pas ici, et pourquoi : l'alignement d'une colonne libellée et la géométrie de
 * l'éditeur n'ont pour juge que Playwright, jsdom ne calculant aucune mise en page (règle n° 9).
 */

const CLE: DatabaseKey = { project: 'Halle', database: 'analytics', environment: 'prod' }

const colonne = (name: string, over: Partial<ColumnInfo> = {}): ColumnInfo => ({
  position: 1,
  name,
  typeName: 'int4',
  category: 'number',
  nullable: true,
  default: null,
  identity: null,
  key: null,
  comment: null,
  frequency: null,
  ...over,
})

/**
 * **Deux colonnes numériques et une de texte** (règle n° 5) : `status` porte un code, `quantite` un
 * compte. Rien ne les distingue dans le catalogue — c'est tout le sujet —, donc un décor à une
 * seule colonne d'entiers ne dirait pas si les libellés suivent *la* colonne ou *toutes* les
 * colonnes numériques. `devise` est du texte : c'est elle qui sépare « l'entrée est absente » de
 * « l'entrée est proposée partout ».
 */
const COLONNES = [
  // **Une clé primaire est nécessaire au mode édition** : sans elle, `cleDe` ne sait pas quelle
  // ligne une écriture viserait, et la grille rend des cellules inertes. C'est ce qui permet de
  // mesurer l'invariant central — la cellule qu'on ouvre montre l'entier.
  colonne('id', { key: 'primary', nullable: false }),
  colonne('status'),
  colonne('quantite'),
  colonne('devise', { category: 'text' }),
]

/**
 * **Deux valeurs dans la colonne libellée, dont une seule est nommée.** Sans la seconde, on ne
 * verrait pas qu'une valeur qu'aucun libellé ne nomme reste l'entier qu'elle est — la moitié du
 * comportement.
 */
const LIGNES: Value[][] = [
  [
    { kind: 'int', value: 101 },
    { kind: 'int', value: 3 },
    { kind: 'int', value: 12 },
    { kind: 'text', value: 'EUR' },
  ],
  [
    { kind: 'int', value: 102 },
    { kind: 'int', value: 7 },
    { kind: 'int', value: 12 },
    { kind: 'text', value: 'EUR' },
  ],
]

const ETATS: LibellesDeTable = { status: { '0': 'en attente', '3': 'expédiée' } }

function monter(
  options: {
    libelles?: LibellesDeTable
    onLibelles?: (colonne: string, valeurs: Record<string, string>) => Promise<void>
    edition?: boolean
  } = {},
) {
  const readRows = vi.fn(async (_c: DatabaseKey, _r: RowQuery) => ({
    offset: 0,
    rows: LIGNES,
    total: null,
    sql: 'select * from public.orders',
    durationMs: 3,
  }))
  const passerelle: PasserelleLignes = { readRows }
  const onLibelles = options.onLibelles ?? vi.fn(async () => {})
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
          libelles={options.libelles}
          {...(options.onLibelles === null ? {} : { onLibelles })}
          edition={options.edition ?? false}
          onAttenteChange={() => {}}
        />
      </LanguageProvider>
    </>,
  )
  return { readRows, onLibelles }
}

/** Ouvre le menu de l'en-tête d'une colonne, au clic droit. */
async function menuDEntete(colonne: string) {
  const entete = screen.getByRole('columnheader', { name: new RegExp(`^${colonne}`) })
  fireEvent.contextMenu(entete)
  return screen.findByRole('menu', { name: `Actions sur la colonne ${colonne}` })
}

const entree = (nom: string | RegExp) => screen.getByRole('menuitem', { name: nom })

describe('l’affichage d’une colonne libellée', () => {
  it('rend l’entier suivi de son libellé, et laisse l’entier nu quand rien ne le nomme', async () => {
    const { readRows } = monter({ libelles: ETATS })
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    expect(screen.getByText('3 (expédiée)')).toBeInTheDocument()
    // **La seconde ligne est ce qui rend le test honnête** : `7` n'est pas déclaré, donc il reste
    // le nombre qu'il est. Sans cette assertion, un libellé posé sur toutes les valeurs passerait.
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  /**
   * **La déclaration suit la colonne, pas la catégorie.** `quantite` est numérique elle aussi et
   * porte `12` : c'est le décor qui sépare « les libellés de `status` » de « les libellés des
   * colonnes numériques ».
   */
  it('ne libelle pas une colonne voisine qui porterait la même valeur', async () => {
    const { readRows } = monter({
      libelles: { status: { '12': 'expédiée' }, quantite: { '3': 'trois' } },
    })
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    // `quantite` vaut 12 dans les deux lignes et n'a pas de libellé pour 12.
    expect(screen.getAllByText('12')).toHaveLength(2)
    // `status` vaut 3, libellé par la *voisine* seulement : il reste nu.
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.queryByText('3 (trois)')).not.toBeInTheDocument()
  })

  it('n’ajoute rien quand rien n’est déclaré', async () => {
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.queryByText(/\(/)).not.toBeInTheDocument()
  })

  /**
   * **L'affichage seul** — l'invariant central d'`API-75`, et celui dont la violation serait la plus
   * grave : la cellule qu'on ouvre à la saisie montre l'entier, parce que c'est lui qui partira vers
   * une colonne numérique.
   */
  it('la cellule ouverte à la saisie montre l’entier, jamais le libellé', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter({ libelles: ETATS, edition: true })
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    // Le nom accessible d'une cellule éditable est « Modifier <colonne> » — il ne porte pas la
    // valeur, donc c'est le rang qui désigne : la première ligne est celle qui vaut 3.
    const cellules = screen.getAllByRole('button', { name: 'Modifier status' })
    expect(cellules[0]).toHaveTextContent('3 (expédiée)')
    await utilisateur.click(cellules[0] as HTMLElement)

    // Le nom de la saisie, et non le seul rôle : la ligne de filtres porte un `textbox` par
    // colonne, et `getByRole('textbox')` en trouverait cinq.
    const saisie = await screen.findByRole('textbox', { name: 'Nouvelle valeur' })
    expect(saisie).toHaveValue('3')
  })
})

describe('l’entrée de menu', () => {
  it('n’existe que pour une colonne numérique', async () => {
    monter()
    await menuDEntete('status')
    expect(entree(/Libellés des valeurs/)).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    await menuDEntete('devise')
    expect(screen.queryByRole('menuitem', { name: /Libellés des valeurs/ })).not.toBeInTheDocument()
  })

  /**
   * **Le compte distingue « déclarer » de « corriger »** avant d'ouvrir la modale : sans lui, il
   * faudrait l'ouvrir pour savoir s'il y a déjà quelque chose à relire.
   */
  it('porte le compte des libellés déjà déclarés', async () => {
    monter({ libelles: ETATS })
    await menuDEntete('status')
    expect(entree('Libellés des valeurs (2)…')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    await menuDEntete('quantite')
    expect(entree('Libellés des valeurs…')).toBeInTheDocument()
  })

  /**
   * **Désactivée avec sa raison quand la colonne est lue en horodatage.** La déclaration
   * s'enregistrerait très bien et ne se verrait nulle part : `valeurRelue` a déjà changé l'entier en
   * date avant qu'un libellé ne soit cherché. Un geste dont l'effet est invisible se lit comme une
   * panne (défaut n° 36).
   */
  it('se désactive avec sa raison sous une lecture en horodatage', async () => {
    const utilisateur = userEvent.setup()
    monter({ libelles: ETATS })

    await menuDEntete('status')
    await utilisateur.click(entree(/millisecondes/))

    await menuDEntete('status')
    const sous = entree(/Libellés des valeurs/)
    expect(sous).toHaveAttribute('disabled')
    expect(sous).toHaveAttribute('title', expect.stringContaining('horodatage'))
  })

  /**
   * Et l'inverse n'a pas besoin de garde : choisir une échelle sur une colonne libellée **change
   * visiblement** la colonne en dates. Ce test garde ce fait — c'est lui qui rend la garde ci-dessus
   * suffisante, plutôt qu'une moitié de règle.
   */
  it('une lecture en horodatage l’emporte sur les libellés, visiblement', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter({ libelles: ETATS })
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))
    expect(screen.getByText('3 (expédiée)')).toBeInTheDocument()

    await menuDEntete('status')
    await utilisateur.click(entree(/secondes \(déduit\)|· secondes/))

    expect(screen.queryByText('3 (expédiée)')).not.toBeInTheDocument()
    expect(screen.getByText('1970-01-01 00:00:03')).toBeInTheDocument()
  })

  it('se désactive avec sa raison quand l’écran n’écrit pas', async () => {
    // `onLibelles: null` retire la prop : c'est le cas de la galerie.
    monter({ libelles: ETATS, onLibelles: null as never })
    await menuDEntete('status')
    const sans = entree(/Libellés des valeurs/)
    expect(sans).toHaveAttribute('disabled')
    expect(sans).toHaveAttribute('title', expect.stringContaining('enregistrement'))
  })
})

describe('l’éditeur', () => {
  /** Ouvre l'éditeur sur `status`. */
  async function ouvrir(options: Parameters<typeof monter>[0] = {}) {
    const utilisateur = userEvent.setup()
    const rendu = monter(options)
    await menuDEntete('status')
    await utilisateur.click(entree(/Libellés des valeurs/))
    await screen.findByRole('dialog', { name: /Libellés des valeurs de status/ })
    return { ...rendu, utilisateur }
  }

  it('s’ouvre sur les libellés déclarés, triés par valeur', async () => {
    await ouvrir({ libelles: { status: { '10': 'dix', '3': 'expédiée' } } })

    expect(screen.getByLabelText('Valeur de la ligne 1')).toHaveValue('3')
    expect(screen.getByLabelText('Valeur de la ligne 2')).toHaveValue('10')
  })

  it('s’ouvre sur une ligne vide quand rien n’est déclaré', async () => {
    await ouvrir()
    expect(screen.getByLabelText('Valeur de la ligne 1')).toHaveValue('')
    expect(screen.queryByLabelText('Valeur de la ligne 2')).not.toBeInTheDocument()
  })

  it('enregistre la table saisie, et se ferme', async () => {
    const onLibelles = vi.fn(async () => {})
    const { utilisateur } = await ouvrir({ onLibelles })

    await utilisateur.type(screen.getByLabelText('Valeur de la ligne 1'), '3')
    await utilisateur.type(screen.getByLabelText('Libellé de la ligne 1'), 'expédiée')
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(onLibelles).toHaveBeenCalledWith('status', { '3': 'expédiée' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('ajoute et retire des lignes', async () => {
    const { utilisateur } = await ouvrir({ libelles: ETATS })
    expect(screen.getByLabelText('Valeur de la ligne 2')).toHaveValue('3')

    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une valeur' }))
    expect(screen.getByLabelText('Valeur de la ligne 3')).toHaveValue('')

    await utilisateur.click(screen.getByRole('button', { name: 'Retirer la ligne 1' }))
    expect(screen.getByLabelText('Valeur de la ligne 1')).toHaveValue('3')
    expect(screen.queryByLabelText('Valeur de la ligne 3')).not.toBeInTheDocument()
  })

  /**
   * **Retirer la dernière ligne la vide au lieu de la faire disparaître** : un éditeur sans aucune
   * ligne n'aurait plus rien où taper, et le bouton de retrait aurait mené à une impasse.
   */
  it('retirer la dernière ligne la vide', async () => {
    const { utilisateur } = await ouvrir({ libelles: { status: { '3': 'expédiée' } } })

    await utilisateur.click(screen.getByRole('button', { name: 'Retirer la ligne 1' }))

    expect(screen.getByLabelText('Valeur de la ligne 1')).toHaveValue('')
    expect(screen.getByLabelText('Libellé de la ligne 1')).toHaveValue('')
  })

  /** Vider tout **retire** la déclaration : c'est le chemin de retour du geste. */
  it('enregistre une table vide quand tout est vidé', async () => {
    const onLibelles = vi.fn(async () => {})
    const { utilisateur } = await ouvrir({ libelles: { status: { '3': 'expédiée' } }, onLibelles })

    await utilisateur.clear(screen.getByLabelText('Valeur de la ligne 1'))
    await utilisateur.clear(screen.getByLabelText('Libellé de la ligne 1'))
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(onLibelles).toHaveBeenCalledWith('status', {})
  })

  it('refuse une valeur qui n’est pas un entier, sans rien envoyer', async () => {
    const onLibelles = vi.fn(async () => {})
    const { utilisateur } = await ouvrir({ onLibelles })

    await utilisateur.type(screen.getByLabelText('Valeur de la ligne 1'), 'pending')
    await utilisateur.type(screen.getByLabelText('Libellé de la ligne 1'), 'en attente')
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/pending.*n’est pas un entier/)
    expect(onLibelles).not.toHaveBeenCalled()
    // La modale reste ouverte : c'est le seul endroit où corriger.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('refuse une valeur déclarée deux fois, sans rien envoyer', async () => {
    const onLibelles = vi.fn(async () => {})
    const { utilisateur } = await ouvrir({ libelles: { status: { '3': 'expédiée' } }, onLibelles })

    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une valeur' }))
    await utilisateur.type(screen.getByLabelText('Valeur de la ligne 2'), '3')
    await utilisateur.type(screen.getByLabelText('Libellé de la ligne 2'), 'partie')
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/3 est déclarée deux fois/)
    expect(onLibelles).not.toHaveBeenCalled()
  })

  /** Un refus du cœur s'affiche tel quel, et la modale reste ouverte. */
  it('affiche le refus de l’écriture', async () => {
    const onLibelles = vi.fn(async () => {
      throw new Error('le projet « Halle » n’existe pas')
    })
    const { utilisateur } = await ouvrir({ onLibelles })

    await utilisateur.type(screen.getByLabelText('Valeur de la ligne 1'), '3')
    await utilisateur.type(screen.getByLabelText('Libellé de la ligne 1'), 'expédiée')
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('le projet « Halle » n’existe pas')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
