import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { DatabaseKey } from '../../domain/arbre'
import type { ColumnInfo, RowQuery, Value } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { auModificateur } from '../../test/raccourcis'
import type { EnAttente, Modification, ModificationDeCellule } from './modifications'
import { TableView } from './TableView'
import type { PasserelleLignes } from './useLignes'

/** La modification de cellule attendue — les assertions portent sur ses champs. */
function cellule(modification: Modification | undefined): ModificationDeCellule {
  if (modification === undefined || modification.sorte !== 'cellule') {
    throw new Error('une modification de cellule était attendue')
  }
  return modification
}

const CLE: DatabaseKey = { connection: 'analytics' }

const colonne = (name: string, over: Partial<ColumnInfo> = {}): ColumnInfo => ({
  position: 1,
  name,
  typeName: 'text',
  category: 'text',
  nullable: true,
  default: null,
  identity: null,
  key: null,
  comment: null,
  frequency: null,
  ...over,
})

const COLONNES = [
  colonne('id', { category: 'number', key: 'primary' }),
  colonne('status'),
  colonne('note'),
]

const LIGNES: Value[][] = [
  [{ kind: 'int', value: 184_217 }, { kind: 'text', value: 'paid' }, { kind: 'null' }],
  [
    { kind: 'int', value: 184_219 },
    { kind: 'text', value: 'pending' },
    { kind: 'text', value: 'cadeau' },
  ],
]

function monter(
  options: {
    columns?: ColumnInfo[]
    edition?: boolean
    lignes?: Value[][]
    moteur?: 'postgresql' | 'mongodb'
  } = {},
) {
  const readRows = vi.fn(async (_c: DatabaseKey, _r: RowQuery) => ({
    offset: 0,
    rows: options.lignes ?? LIGNES,
    total: null,
    sql: 'select …',
    durationMs: 1,
  }))
  const attentes: EnAttente[] = []
  // **Créée une fois**, hors du composant : `useLignes` relance sa lecture quand la passerelle
  // change d'identité, et un objet littéral en prop en crée une neuve à chaque rendu — donc une
  // lecture par frappe.
  const passerelle = { readRows } as unknown as PasserelleLignes

  function Pilotee() {
    const [attente, setAttente] = useState<EnAttente>([])
    // La sélection est pilotée par l'écran (`rang`/`onRangChange`), comme `attente` — sans ce fil,
    // un clic sur une ligne ne la sélectionnerait jamais, et `Suppr` n'aurait aucune ligne à viser.
    const [rang, setRang] = useState<number | null>(null)
    return (
      <TableView
        cle={CLE}
        schema="public"
        table="orders"
        moteur={options.moteur}
        columns={options.columns ?? COLONNES}
        edition={options.edition ?? true}
        attente={attente}
        onAttenteChange={(a) => {
          attentes.push(a)
          setAttente(a)
        }}
        rang={rang}
        onRangChange={setRang}
        passerelle={passerelle}
      />
    )
  }

  render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <Pilotee />
      </LanguageProvider>
    </>,
  )
  return { readRows, attentes, derniere: () => attentes[attentes.length - 1] ?? [] }
}

async function attendreLaGrille() {
  const grille = await screen.findByRole('grid')
  await waitFor(() => expect(within(grille).getByText('paid')).toBeInTheDocument())
  return grille
}

describe('ouvrir une cellule', () => {
  it('en mode édition, une cellule éditable est un contrôle nommé', async () => {
    monter()
    await attendreLaGrille()
    // Un `<button>` plutôt qu'un double-clic : le clavier vient gratuitement, là où un
    // gestionnaire de double-clic n'a aucun équivalent.
    expect(screen.getAllByRole('button', { name: 'Modifier status' })).toHaveLength(2)
  })

  it('hors mode édition, aucune cellule ne s’ouvre', async () => {
    monter({ edition: false })
    await attendreLaGrille()
    expect(screen.queryByRole('button', { name: 'Modifier status' })).not.toBeInTheDocument()
  })

  it('cliquer ouvre la saisie sur la valeur brute', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await attendreLaGrille()

    await utilisateur.click(
      screen.getAllByRole('button', { name: 'Modifier status' })[0] as HTMLElement,
    )
    expect(screen.getByLabelText('Nouvelle valeur')).toHaveValue('paid')
  })

  it('la saisie s’ouvre aussi au clavier', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await attendreLaGrille()

    const cellule = screen.getAllByRole('button', { name: 'Modifier status' })[0] as HTMLElement
    cellule.focus()
    await utilisateur.keyboard('{Enter}')
    expect(screen.getByLabelText('Nouvelle valeur')).toBeInTheDocument()
  })

  it('la clé primaire n’est pas éditable, et le dit', async () => {
    monter()
    const grille = await attendreLaGrille()
    expect(screen.queryByRole('button', { name: 'Modifier id' })).not.toBeInTheDocument()
    // La raison est portée par la cellule : un refus muet passerait pour un bug.
    const cellule = within(grille).getByText('184 217')
    expect(cellule).toHaveAttribute('title', expect.stringContaining('identifie la ligne'))
  })

  it('une table sans clé primaire n’est pas éditable du tout', async () => {
    monter({
      columns: [colonne('message'), colonne('niveau')],
      lignes: [
        [
          { kind: 'text', value: 'ok' },
          { kind: 'text', value: 'info' },
        ],
      ],
    })
    const grille = await screen.findByRole('grid')
    await waitFor(() => expect(within(grille).getByText('ok')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: /Modifier/ })).not.toBeInTheDocument()
    expect(within(grille).getByText('ok')).toHaveAttribute(
      'title',
      expect.stringContaining('pas de clé primaire'),
    )
  })
})

describe('valider, abandonner, retenir', () => {
  async function ouvrirStatus(utilisateur: ReturnType<typeof userEvent.setup>) {
    await attendreLaGrille()
    await utilisateur.click(
      screen.getAllByRole('button', { name: 'Modifier status' })[0] as HTMLElement,
    )
    return screen.getByLabelText('Nouvelle valeur')
  }

  it('« Copier la valeur » copie la saisie retenue, pas celle de la base', async () => {
    const utilisateur = userEvent.setup()
    const writeText = vi.fn(async (_texte: string) => {})
    // `navigator.clipboard` n'a qu'un accesseur sous jsdom : il faut redéfinir la propriété.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    monter()
    const champ = await ouvrirStatus(utilisateur)

    await utilisateur.clear(champ)
    await utilisateur.type(champ, 'shipped{Enter}')
    await waitFor(() => expect(screen.getAllByText('shipped')).not.toHaveLength(0))

    // La cellule affiche désormais « shipped » ; c'est ce qu'on lit, donc ce qui doit être copié.
    // Copier « paid » rendrait une valeur que l'écran ne montre plus nulle part.
    const cellule = screen.getAllByText('shipped')[0]?.closest('[role="gridcell"]')
    if (!(cellule instanceof HTMLElement)) throw new Error('cellule introuvable')
    fireEvent.contextMenu(cellule, { clientX: 40, clientY: 40 })

    const menu = await screen.findByRole('menu', { name: 'Actions sur la valeur de status' })
    await utilisateur.click(within(menu).getByRole('menuitem', { name: 'Copier la valeur' }))
    expect(writeText.mock.calls[0]?.[0]).toBe('shipped')
  })

  it('↩ retient la modification, et rien n’est envoyé', async () => {
    const utilisateur = userEvent.setup()
    const { derniere, readRows } = monter()
    const champ = await ouvrirStatus(utilisateur)

    await utilisateur.clear(champ)
    await utilisateur.type(champ, 'shipped{Enter}')

    await waitFor(() => expect(derniere()).toHaveLength(1))
    expect(cellule(derniere()[0]).column).toBe('status')
    expect(derniere()[0]?.cle).toBe('184217')
    expect(cellule(derniere()[0]).apres).toEqual({ kind: 'texte', texte: 'shipped' })
    // **Rien n'est envoyé** : c'est le sens de « en attente ». Une seule lecture, celle du montage.
    expect(readRows).toHaveBeenCalledTimes(1)
  })

  it('la valeur retenue s’affiche dans la grille, pas l’ancienne', async () => {
    const utilisateur = userEvent.setup()
    monter()
    const champ = await ouvrirStatus(utilisateur)

    await utilisateur.clear(champ)
    await utilisateur.type(champ, 'shipped{Enter}')

    const grille = screen.getByRole('grid')
    await waitFor(() => expect(within(grille).getByText('shipped')).toBeInTheDocument())
    // Afficher l'ancienne ferait croire que la saisie a été perdue.
    expect(within(grille).queryByText('paid')).not.toBeInTheDocument()
  })

  it('esc abandonne la saisie sans rien retenir', async () => {
    const utilisateur = userEvent.setup()
    const { derniere } = monter()
    const champ = await ouvrirStatus(utilisateur)

    await utilisateur.clear(champ)
    await utilisateur.type(champ, 'shipped')
    await utilisateur.keyboard('{Escape}')

    expect(screen.queryByLabelText('Nouvelle valeur')).not.toBeInTheDocument()
    expect(derniere()).toHaveLength(0)
    expect(within(screen.getByRole('grid')).getByText('paid')).toBeInTheDocument()
  })

  it('rouvrir une cellule modifiée montre ce qu’on y a mis', async () => {
    const utilisateur = userEvent.setup()
    monter()
    let champ = await ouvrirStatus(utilisateur)
    await utilisateur.clear(champ)
    await utilisateur.type(champ, 'shipped{Enter}')

    await utilisateur.click(
      screen.getAllByRole('button', { name: 'Modifier status' })[0] as HTMLElement,
    )
    champ = screen.getByLabelText('Nouvelle valeur')
    expect(champ).toHaveValue('shipped')
  })

  it('⌥⌫ pose NULL, distinct d’un champ vidé', async () => {
    const utilisateur = userEvent.setup()
    const { derniere } = monter()
    const champ = await ouvrirStatus(utilisateur)

    await utilisateur.clear(champ)
    await utilisateur.keyboard('{Alt>}{Backspace}{/Alt}')
    expect(champ).toHaveValue('NULL')
    await utilisateur.keyboard('{Enter}')

    await waitFor(() => expect(cellule(derniere()[0]).apres).toEqual({ kind: 'null' }))
  })

  it('vider le champ donne la chaîne vide, pas NULL', async () => {
    const utilisateur = userEvent.setup()
    const { derniere } = monter()
    const champ = await ouvrirStatus(utilisateur)

    await utilisateur.clear(champ)
    await utilisateur.keyboard('{Enter}')

    // La distinction que `10c` a posée et qu'un client de bases ne doit pas brouiller.
    await waitFor(() => expect(cellule(derniere()[0]).apres).toEqual({ kind: 'texte', texte: '' }))
  })
})

describe('⌘Z annule la dernière modification retenue', () => {
  async function retenirDeux(utilisateur: ReturnType<typeof userEvent.setup>) {
    await attendreLaGrille()
    const cellules = screen.getAllByRole('button', { name: 'Modifier status' })
    for (const [rang, cellule] of cellules.entries()) {
      await utilisateur.click(cellule as HTMLElement)
      const champ = screen.getByLabelText('Nouvelle valeur')
      await utilisateur.clear(champ)
      await utilisateur.type(champ, `valeur${rang}{Enter}`)
    }
  }

  it('retire la dernière, pas la première', async () => {
    const utilisateur = userEvent.setup()
    const { derniere } = monter()
    await retenirDeux(utilisateur)
    await waitFor(() => expect(derniere()).toHaveLength(2))

    await utilisateur.keyboard(auModificateur('z'))

    await waitFor(() => expect(derniere()).toHaveLength(1))
    expect(derniere()[0]?.cle).toBe('184217')
  })

  it('est inopérant pendant une saisie', async () => {
    const utilisateur = userEvent.setup()
    const { derniere } = monter()
    await retenirDeux(utilisateur)
    await waitFor(() => expect(derniere()).toHaveLength(2))

    // Ouvrir une cellule, puis ⌘Z : dans un champ, ⌘Z est l'annulation du navigateur, et la
    // détourner surprendrait.
    await utilisateur.click(
      screen.getAllByRole('button', { name: 'Modifier note' })[0] as HTMLElement,
    )
    await utilisateur.keyboard(auModificateur('z'))

    expect(derniere()).toHaveLength(2)
  })

  it('hors mode édition, il ne fait rien', async () => {
    const utilisateur = userEvent.setup()
    const { derniere } = monter({ edition: false })
    await attendreLaGrille()
    await utilisateur.keyboard(auModificateur('z'))
    expect(derniere()).toHaveLength(0)
  })
})

describe('ajouter une ligne', () => {
  it('le bouton n’existe qu’en mode édition', async () => {
    monter({ edition: false })
    await attendreLaGrille()
    // Absent plutôt que désactivé : l'ajout marche dès qu'on entre en édition, et un bouton grisé
    // dirait « ceci ne marche pas ici ».
    expect(screen.queryByRole('button', { name: 'Ajouter une ligne' })).not.toBeInTheDocument()
  })

  it('chaque clic ajoute une ligne à la grille, sous les lignes lues', async () => {
    const utilisateur = userEvent.setup()
    const { derniere } = monter()
    const grille = await attendreLaGrille()

    const ajouter = screen.getByRole('button', { name: 'Ajouter une ligne' })
    await utilisateur.click(ajouter)
    await utilisateur.click(ajouter)

    await waitFor(() => expect(derniere()).toHaveLength(2))
    // **En bas** : ajoutées en tête, elles pousseraient la table d'un cran à chaque clic et la
    // ligne qu'on lisait changerait de place.
    expect(within(grille).getByText('+1')).toBeInTheDocument()
    expect(within(grille).getByText('+2')).toBeInTheDocument()
  })

  it('une cellule non renseignée annonce le défaut de la base, pas NULL', async () => {
    const utilisateur = userEvent.setup()
    monter()
    const grille = await attendreLaGrille()

    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une ligne' }))

    // « vide » et « la base décidera » sont deux choses différentes : les confondre ferait attendre
    // un `NULL` là où une séquence ou un `now()` va s'appliquer. La mesure porte sur **la ligne
    // ajoutée seule** — une ligne lue de ce décor porte un vrai `NULL`, qui lui est juste.
    const ajoutee = await waitFor(() => {
      const trouvee = within(grille)
        .getAllByRole('row')
        .find((ligne) => within(ligne).queryByText('+1') !== null)
      if (trouvee === undefined) throw new Error('la ligne ajoutée n’est pas rendue')
      return trouvee
    })
    expect(within(ajoutee).getAllByText('défaut')).toHaveLength(3)
    expect(within(ajoutee).queryByText('NULL')).not.toBeInTheDocument()
  })

  it('une cellule qui attend le défaut n’a pas de valeur à copier, et le dit', async () => {
    const utilisateur = userEvent.setup()
    monter()
    const grille = await attendreLaGrille()

    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une ligne' }))
    const ajoutee = await waitFor(() => {
      const trouvee = within(grille)
        .getAllByRole('row')
        .find((ligne) => within(ligne).queryByText('+1') !== null)
      if (trouvee === undefined) throw new Error('la ligne ajoutée n’est pas rendue')
      return trouvee
    })

    const defaut = within(ajoutee).getAllByText('défaut')[0]?.closest('[role="gridcell"]')
    if (!(defaut instanceof HTMLElement)) throw new Error('cellule introuvable')
    fireEvent.contextMenu(defaut, { clientX: 40, clientY: 40 })

    // **L'entrée est désactivée, pas absente** : un menu vide n'apprend rien, et « défaut » est un
    // mot de l'interface — le copier rendrait un texte qui n'est la valeur de rien.
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Copier la valeur' })).toBeDisabled()
  })

  it('la clé primaire se saisit dans une ligne ajoutée, pas dans une ligne lue', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await attendreLaGrille()

    // Aucune ligne lue n'offre sa clé : la modifier déplacerait la cible du `WHERE`.
    expect(screen.queryByRole('button', { name: 'Modifier id' })).not.toBeInTheDocument()

    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une ligne' }))
    // Celle qu'on ajoute l'offre : il n'y a pas de `WHERE`, et une table dont la clé est un code
    // saisi ne pourrait recevoir aucune ligne autrement.
    expect(await screen.findByRole('button', { name: 'Renseigner id' })).toBeInTheDocument()
  })

  it('une valeur saisie dans une ligne ajoutée est retenue, et rien n’est lu de plus', async () => {
    const utilisateur = userEvent.setup()
    const { derniere, readRows } = monter()
    await attendreLaGrille()

    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une ligne' }))
    await utilisateur.click(await screen.findByRole('button', { name: 'Renseigner status' }))
    await utilisateur.type(
      screen.getByRole('textbox', { name: 'Nouvelle valeur' }),
      'pending{Enter}',
    )

    await waitFor(() => {
      const ligne = derniere()[0]
      expect(ligne?.sorte === 'ligne' ? ligne.valeurs.status : undefined).toEqual({
        kind: 'texte',
        texte: 'pending',
      })
    })
    // **Rien n'est envoyé** : c'est le sens de « en attente », et une ligne ajoutée n'y échappe pas.
    expect(readRows).toHaveBeenCalledTimes(1)
    // Et le modèle ne porte toujours qu'une entrée : une ligne, pas une par cellule remplie.
    expect(derniere()).toHaveLength(1)
  })

  it('ouvrir puis sortir sans rien taper laisse la colonne à son défaut', async () => {
    const utilisateur = userEvent.setup()
    const { derniere } = monter()
    await attendreLaGrille()

    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une ligne' }))
    await utilisateur.click(await screen.findByRole('button', { name: 'Renseigner status' }))
    await utilisateur.keyboard('{Enter}')

    // Le geste est courant, et le prendre pour une saisie écrirait `''` dans une colonne qu'on n'a
    // pas voulu remplir — en volant à la table sa valeur par défaut.
    await waitFor(() => {
      const ligne = derniere()[0]
      expect(ligne?.sorte === 'ligne' ? ligne.valeurs : undefined).toEqual({})
    })
  })

  it('une table sans clé primaire refuse la modification et accepte l’ajout', async () => {
    const utilisateur = userEvent.setup()
    monter({ columns: [colonne('status'), colonne('note')] })
    await attendreLaGrille()

    // Sans clé, aucune ligne lue n'est modifiable : `11d` n'aurait pas de `WHERE`.
    expect(screen.queryByRole('button', { name: 'Modifier status' })).not.toBeInTheDocument()
    // L'ajout, lui, ne vise aucune ligne — le refuser interdirait un geste possible.
    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une ligne' }))
    expect(await screen.findByRole('button', { name: 'Renseigner status' })).toBeInTheDocument()
  })
})

describe('supprimer une ligne', () => {
  /** Sélectionne la ligne qui porte ce texte, en cliquant la `row` elle-même — pas une cellule, qui
   *  ouvrirait aussi une saisie et compliquerait l'assertion. */
  async function selectionnerLaLigne(
    utilisateur: ReturnType<typeof userEvent.setup>,
    grille: HTMLElement,
    texte: string,
  ) {
    const ligne = within(grille)
      .getAllByRole('row')
      .find((r) => within(r).queryByText(texte) !== null)
    if (ligne === undefined) throw new Error(`aucune ligne ne porte « ${texte} »`)
    await utilisateur.click(ligne)
    return ligne
  }

  it('Suppr marque la ligne sélectionnée, et la remarque l’annule', async () => {
    const utilisateur = userEvent.setup()
    const { derniere } = monter()
    const grille = await attendreLaGrille()

    await selectionnerLaLigne(utilisateur, grille, 'cadeau')
    await utilisateur.keyboard('{Delete}')

    await waitFor(() => expect(derniere()).toHaveLength(1))
    expect(derniere()[0]).toMatchObject({ sorte: 'suppression', cle: '184219' })
    // Marquée, la ligne ne se modifie plus.
    expect(
      screen.getByRole('button', { name: 'Annuler la suppression de la ligne 2' }),
    ).toBeInTheDocument()

    // Le même geste bascule : la remarquer annule la marque.
    await utilisateur.keyboard('{Delete}')
    await waitFor(() => expect(derniere()).toHaveLength(0))
  })

  it('efface les modifications de cellule en attente de la ligne marquée', async () => {
    const utilisateur = userEvent.setup()
    const { derniere } = monter()
    const grille = await attendreLaGrille()

    await utilisateur.click(
      screen.getAllByRole('button', { name: 'Modifier status' })[1] as HTMLElement,
    )
    const champ = screen.getByLabelText('Nouvelle valeur')
    await utilisateur.clear(champ)
    await utilisateur.type(champ, 'shipped{Enter}')
    await waitFor(() => expect(derniere()).toHaveLength(1))

    await selectionnerLaLigne(utilisateur, grille, 'cadeau')
    await utilisateur.keyboard('{Delete}')

    await waitFor(() => {
      expect(derniere()).toEqual([{ sorte: 'suppression', cle: '184219', rang: 2 }])
    })
  })

  it('la croix révélée au survol du numéro fait le même geste que Suppr', async () => {
    const utilisateur = userEvent.setup()
    const { derniere } = monter()
    await attendreLaGrille()

    await utilisateur.click(screen.getByRole('button', { name: 'Supprimer la ligne 1' }))
    await waitFor(() => expect(derniere()).toHaveLength(1))
    expect(derniere()[0]).toMatchObject({ sorte: 'suppression', cle: '184217' })

    await utilisateur.click(
      screen.getByRole('button', { name: 'Annuler la suppression de la ligne 1' }),
    )
    await waitFor(() => expect(derniere()).toHaveLength(0))
  })

  it('Backspace dans un champ de filtre ne supprime pas la ligne sélectionnée', async () => {
    const utilisateur = userEvent.setup()
    const { derniere } = monter()
    const grille = await attendreLaGrille()

    await selectionnerLaLigne(utilisateur, grille, 'cadeau')
    await utilisateur.click(screen.getByRole('textbox', { name: 'Filtrer status' }))
    await utilisateur.keyboard('{Backspace}')

    expect(derniere()).toHaveLength(0)
  })

  it('une ligne ajoutée, pas encore écrite, se retire entière au lieu de se marquer', async () => {
    const utilisateur = userEvent.setup()
    const { derniere } = monter()
    await attendreLaGrille()

    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une ligne' }))
    await waitFor(() => expect(derniere()).toHaveLength(1))

    await utilisateur.click(screen.getByRole('button', { name: 'Retirer la nouvelle ligne 1' }))
    expect(derniere()).toHaveLength(0)
  })
})

/** L'éditeur CodeMirror de la modale JSON (`18g`) — un seul monté à la fois. */
function contenuEditeurJson() {
  return [...document.querySelectorAll('.cm-content > .cm-line')].map((l) => l.textContent ?? '')
}

/** Remplace le document entier : sélectionner tout, puis taper le nouveau texte.
 *
 * `userEvent.keyboard` ne donne un sens spécial qu'à `{` (`{Enter}`, `{Control>}`…, ouverture d'un
 * descripteur) : seule l'accolade ouvrante doit être doublée (`{{`) pour être tapée comme un simple
 * caractère. `}` seule, hors d'un descripteur ouvert, est déjà littérale.
 */
async function remplacerLeDocument(utilisateur: ReturnType<typeof userEvent.setup>, texte: string) {
  const contenu = document.querySelector('.cm-content') as HTMLElement
  await utilisateur.click(contenu)
  await utilisateur.keyboard('{Control>}a{/Control}{Backspace}')
  await utilisateur.keyboard(texte.replaceAll('{', '{{'))
}

describe('éditer un document en JSON (mongo, 18g)', () => {
  it('l’icône n’apparaît que sur une base mongo', async () => {
    monter({ moteur: 'postgresql' })
    await attendreLaGrille()
    expect(
      screen.queryByRole('button', { name: 'Éditer la ligne 1 en JSON' }),
    ).not.toBeInTheDocument()
  })

  it('hors mode édition, l’icône n’apparaît pas non plus', async () => {
    monter({ moteur: 'mongodb', edition: false })
    await attendreLaGrille()
    expect(
      screen.queryByRole('button', { name: 'Éditer la ligne 1 en JSON' }),
    ).not.toBeInTheDocument()
  })

  it('ouvre le document courant, en JSON', async () => {
    const utilisateur = userEvent.setup()
    monter({ moteur: 'mongodb' })
    await attendreLaGrille()

    await utilisateur.click(screen.getByRole('button', { name: 'Éditer la ligne 1 en JSON' }))
    expect(await screen.findByRole('dialog', { name: 'Éditer le document' })).toBeInTheDocument()
    expect(contenuEditeurJson().join('\n')).toContain('"status": "paid"')
  })

  it('enregistrer un champ changé retient une modification de cellule, comme une saisie', async () => {
    const utilisateur = userEvent.setup()
    const { derniere } = monter({ moteur: 'mongodb' })
    await attendreLaGrille()

    await utilisateur.click(screen.getByRole('button', { name: 'Éditer la ligne 1 en JSON' }))
    await screen.findByRole('dialog')
    await remplacerLeDocument(utilisateur, '{"id": 184217, "status": "shipped", "note": null}')
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(derniere()).toHaveLength(1))
    expect(cellule(derniere()[0]).column).toBe('status')
    expect(cellule(derniere()[0]).apres).toEqual({ kind: 'texte', texte: 'shipped' })
    // La modale se referme, comme une cellule qui valide.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('un JSON invalide garde la modale ouverte et le dit, plutôt que de fermer sur une erreur', async () => {
    const utilisateur = userEvent.setup()
    monter({ moteur: 'mongodb' })
    await attendreLaGrille()

    await utilisateur.click(screen.getByRole('button', { name: 'Éditer la ligne 1 en JSON' }))
    await screen.findByRole('dialog')
    await remplacerLeDocument(utilisateur, '{invalide')
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('JSON invalide')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('changer la clé primaire est refusé, avec la même raison qu’une cellule', async () => {
    const utilisateur = userEvent.setup()
    monter({ moteur: 'mongodb' })
    await attendreLaGrille()

    await utilisateur.click(screen.getByRole('button', { name: 'Éditer la ligne 1 en JSON' }))
    await screen.findByRole('dialog')
    await remplacerLeDocument(utilisateur, '{"id": 999, "status": "paid", "note": null}')
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('identifie la ligne')
  })
})

describe('créer un document en JSON (mongo, 18g)', () => {
  it('le + ouvre l’éditeur JSON plutôt qu’une ligne vide', async () => {
    const utilisateur = userEvent.setup()
    monter({ moteur: 'mongodb' })
    await attendreLaGrille()

    await utilisateur.click(screen.getByRole('button', { name: 'Nouveau document' }))
    expect(await screen.findByRole('dialog', { name: 'Nouveau document' })).toBeInTheDocument()
    expect(screen.queryByText('+1')).not.toBeInTheDocument()
  })

  it('enregistrer compose une ligne ajoutée avec les champs saisis', async () => {
    const utilisateur = userEvent.setup()
    const { derniere } = monter({ moteur: 'mongodb' })
    await attendreLaGrille()

    await utilisateur.click(screen.getByRole('button', { name: 'Nouveau document' }))
    await screen.findByRole('dialog')
    await remplacerLeDocument(utilisateur, '{"id": 42, "status": "new"}')
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(derniere()).toHaveLength(1))
    const ligne = derniere()[0]
    expect(ligne?.sorte).toBe('ligne')
    expect(ligne?.sorte === 'ligne' ? ligne.valeurs : undefined).toEqual({
      id: { kind: 'texte', texte: '42' },
      status: { kind: 'texte', texte: 'new' },
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('un champ neuf, absent des colonnes déduites, apparaît dans la grille, teinté', async () => {
    const utilisateur = userEvent.setup()
    monter({ moteur: 'mongodb' })
    const grille = await attendreLaGrille()

    await utilisateur.click(screen.getByRole('button', { name: 'Nouveau document' }))
    await screen.findByRole('dialog')
    await remplacerLeDocument(utilisateur, '{"status": "new", "priorite": "haute"}')
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }))

    // La colonne n'existait pas au catalogue : sans elle, « priorite » serait invisible alors
    // qu'elle part déjà dans le SQL prévu et dans le panneau des modifications en attente.
    await waitFor(() => expect(within(grille).getByText('priorite')).toBeInTheDocument())
    const cellule = within(grille).getByText('haute')
    // Même teinte qu'une colonne connue remplie dans une ligne ajoutée (`--modified`, cf. AGENTS.md
    // « le coin ambre dit ceci partira ») : rien qui distingue une colonne synthétique à l'œil.
    expect(cellule.closest('[class*="modified"]')).not.toBeNull()
  })
})
