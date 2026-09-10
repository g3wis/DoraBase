import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { ColumnInfo, DatabaseKey, RowQuery } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { TableView } from './TableView'
import type { PasserelleLignes } from './useLignes'

const CLE: DatabaseKey = { project: 'Halle', database: 'analytics', environment: 'prod' }

const colonne = (name: string): ColumnInfo => ({
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
})

const COLONNES = [colonne('status'), colonne('total_cents'), colonne('created_at')]

function monter(over: Partial<Parameters<typeof TableView>[0]> = {}) {
  const readRows = vi.fn(async (_cle: DatabaseKey, requete: RowQuery) => ({
    offset: 0,
    rows: [
      [
        { kind: 'text' as const, value: 'paid' },
        { kind: 'int' as const, value: 12_900 },
        { kind: 'null' as const },
      ],
    ],
    total: null,
    // Le SQL rendu **porte la limite réellement employée** : c'est lui que « Voir le SQL »
    // affiche, et il doit pouvoir différer de ce que l'écran croit avoir demandé.
    sql: `select * from public.orders limit ${limiteDe(requete)} offset 0`,
    durationMs: 41,
  }))
  render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <TableView
          cle={CLE}
          schema="public"
          table="orders"
          columns={COLONNES}
          passerelle={{ readRows } satisfies PasserelleLignes}
          {...over}
        />
      </LanguageProvider>
    </>,
  )
  return { readRows }
}

function limiteDe(requete: RowQuery): number {
  return { oneHundred: 100, fiveHundred: 500, oneThousand: 1000, fiveThousand: 5000 }[requete.limit]
}

function derniereRequete(readRows: ReturnType<typeof monter>['readRows']): RowQuery {
  const appels = vi.mocked(readRows).mock.calls
  return appels[appels.length - 1]?.[1] as RowQuery
}

/** Une fenêtre d’une ligne, pour les tests qui ne portent que sur la barre. */
const FENETRE_LUE = {
  offset: 0,
  rows: [
    [
      { kind: 'text' as const, value: 'paid' },
      { kind: 'int' as const, value: 12_900 },
      { kind: 'null' as const },
    ],
  ],
  total: null,
  sql: 'select * from public.orders limit 500 offset 0',
  durationMs: 41,
}

/** Une fenêtre sans ligne, pour les tests qui ne portent pas sur les données. */
const FENETRE_VIDE = {
  columns: COLONNES,
  rows: [],
  offset: 0,
  total: null,
  sql: 'select * from public.orders limit 500 offset 0',
  durationMs: 3,
}

describe('toolbar', () => {
  it('le stepper ne produit que les quatre paliers et se bloque aux extrémités', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalled())

    const monter_ = screen.getByRole('button', { name: 'Augmenter la limite' })
    const descendre = screen.getByRole('button', { name: 'Réduire la limite' })

    await utilisateur.click(monter_)
    await waitFor(() => expect(derniereRequete(readRows).limit).toBe('oneThousand'))
    await utilisateur.click(monter_)
    await waitFor(() => expect(derniereRequete(readRows).limit).toBe('fiveThousand'))
    // Au sommet de l'échelle, la flèche se désactive : « demander tout » n'est pas exprimable,
    // et ce n'est pas au bouton d'y suppléer.
    expect(monter_).toBeDisabled()

    await utilisateur.click(descendre)
    await utilisateur.click(descendre)
    await utilisateur.click(descendre)
    await waitFor(() => expect(derniereRequete(readRows).limit).toBe('oneHundred'))
    expect(descendre).toBeDisabled()
  })

  it('changer de palier relance la lecture', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    await utilisateur.click(screen.getByRole('button', { name: 'Augmenter la limite' }))
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(2))
  })

  it('rafraîchir relit la même requête', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    await utilisateur.click(screen.getByRole('button', { name: 'Rafraîchir' }))
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(2))
    expect(derniereRequete(readRows).limit).toBe('fiveHundred')
  })

  it('un chip résume chaque filtre actif, et sa croix le retire', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await utilisateur.type(await screen.findByLabelText('Filtrer status'), 'paid{Enter}')

    await waitFor(() => expect(screen.getByText('status = paid')).toBeInTheDocument())

    await utilisateur.click(screen.getByRole('button', { name: 'Retirer le filtre sur status' }))

    // Un seul état : la croix vide aussi le champ d'en-tête.
    await waitFor(() => expect(derniereRequete(readRows).filters).toHaveLength(0))
    expect(screen.getByLabelText('Filtrer status')).toHaveValue('')
  })

  it('« Voir le SQL » montre le SQL exécuté, pas une chaîne reconstruite', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalled())

    await utilisateur.click(screen.getByRole('button', { name: /Voir le SQL/ }))
    const panneau = await screen.findByRole('dialog', { name: 'SQL exécuté' })
    expect(panneau).toHaveTextContent('select * from public.orders limit 500 offset 0')
  })

  it('masquer une colonne change le compteur, pas le SQL, et garde son filtre visible', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await utilisateur.type(await screen.findByLabelText('Filtrer status'), 'paid{Enter}')
    await waitFor(() => expect(derniereRequete(readRows).filters).toHaveLength(1))
    const avant = derniereRequete(readRows)

    await utilisateur.click(screen.getByRole('button', { name: 'Colonnes affichées' }))
    const panneau = await screen.findByRole('dialog', { name: 'Colonnes affichées' })
    await utilisateur.click(within(panneau).getByLabelText(/status/))

    expect(screen.getByRole('button', { name: 'Colonnes affichées' })).toHaveTextContent('2/3')
    // La requête n'a pas bougé : masquer est un réglage d'affichage.
    expect(derniereRequete(readRows)).toEqual(avant)
    // Et le filtre reste **visible** en chip : un filtre invisible agirait en secret.
    expect(screen.getByText('status = paid')).toBeInTheDocument()
  })

  it('l’export est désactivé et nomme sa spec', async () => {
    monter()
    const bouton = await screen.findByRole('button', { name: 'Exporter' })
    expect(bouton).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('rafraîchir relit tout ce que l’écran montre', () => {
  it('la structure part avec les lignes', async () => {
    const utilisateur = userEvent.setup()
    const relireLaStructure = vi.fn()
    const { readRows } = monter({ onRelireLaStructure: relireLaStructure })
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    await utilisateur.click(screen.getByRole('button', { name: 'Rafraîchir' }))

    // **Les deux, pas l'un.** La structure restait celle du premier chargement, indéfiniment : deux
    // boutons auraient demandé à l'utilisateur de savoir ce qui est périmé, ce qu'il ne peut pas
    // savoir.
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(2))
    expect(relireLaStructure).toHaveBeenCalledTimes(1)
  })

  it('le bouton tourne et devient inerte pendant la relecture de la structure', () => {
    // La structure charge encore alors que les lignes ont répondu : c'est exactement le cas où
    // s'arrêter à la première réponse ferait croire l'écran à jour.
    render(
      <>
        <Sprite />
        <LanguageProvider preferences={{ language: 'fr' }}>
          <TableView
            cle={CLE}
            schema="public"
            table="orders"
            columns={COLONNES}
            passerelle={{ readRows: vi.fn(async () => ({ ...FENETRE_VIDE })) } as PasserelleLignes}
            structureEnCours
          />
        </LanguageProvider>
      </>,
    )

    const bouton = screen.getByRole('button', { name: 'Rafraîchir' })
    expect(bouton).toBeDisabled()
    expect(bouton).toHaveAttribute('aria-busy', 'true')
    // L'animation est portée par une classe sur l'icône ; la rotation elle-même se mesure en e2e,
    // jsdom ne calculant aucune animation.
    expect(bouton.querySelector('svg')?.getAttribute('class')).toMatch(/tourne/)
  })

  it('la bascule d’édition n’existe pas sans gestionnaire', async () => {
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalled())

    // La vue ne possède pas ce mode, elle le reçoit : sans quoi l’écrire, la barre n’offre rien à
    // cliquer plutôt qu’un contrôle qui ne ferait rien.
    expect(screen.queryByRole('switch', { name: 'Verrouiller la table' })).toBeNull()
  })

  it('la bascule ouvre le mode édition, et la position tenue le dit des deux côtés', async () => {
    const utilisateur = userEvent.setup()

    // Contrôlé depuis un parent, comme l’écran de travail le fait : c’est **la bascule** qui rend
    // `aria-pressed` honnête. Un bouton qui ne s’allumerait jamais passerait un test qui ne
    // regarderait que l’état de départ.
    function Ecran() {
      const [edition, setEdition] = useState(false)
      return (
        <TableView
          cle={CLE}
          schema="public"
          table="orders"
          columns={COLONNES}
          passerelle={{ readRows: async () => FENETRE_LUE } as unknown as PasserelleLignes}
          edition={edition}
          onBasculerEdition={() => setEdition((precedent) => !precedent)}
          // Le `+` demande en plus de quoi écrire ce qu'il ajoute : sans lui, il ne paraîtrait pas
          // même en édition, et le test mesurerait son absence pour la mauvaise raison.
          onAttenteChange={() => {}}
        />
      )
    }
    render(
      <>
        <Sprite />
        <LanguageProvider preferences={{ language: 'fr' }}>
          <Ecran />
        </LanguageProvider>
      </>,
    )

    const bascule = screen.getByRole('switch', { name: 'Verrouiller la table' })
    // **Coché vaut « verrouillé »**, donc l’inverse du mode édition : c’est le sens du design, où
    // la position de droite porte le cadenas fermé. Une bascule qui dirait « édition » cochée
    // laisserait le cadenas fermé du côté allumé, ce qui est le contraire de ce qu’il dessine.
    expect(bascule).toBeChecked()
    // **Le `+` n’est pas là tant que l’édition ne l’est pas** : la bascule le fait paraître à
    // l’autre bout de la barre, ce qui reste sa raison d’être même une fois les deux séparés.
    expect(screen.queryByRole('button', { name: 'Ajouter une ligne' })).toBeNull()

    await utilisateur.click(bascule)
    expect(bascule).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Ajouter une ligne' })).toBeInTheDocument()

    // Le nom **n’a pas bougé** : c’est `aria-checked` qui distingue les deux positions, et le
    // même élément qui répond au second clic.
    expect(screen.getByRole('switch', { name: 'Verrouiller la table' })).toBe(bascule)
    await utilisateur.click(bascule)
    expect(bascule).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Ajouter une ligne' })).toBeNull()
  })

  it('les deux verrous sont là en permanence, et l’accent désigne celui qu’on tient', async () => {
    const utilisateur = userEvent.setup()

    function Ecran() {
      const [edition, setEdition] = useState(false)
      return (
        <TableView
          cle={CLE}
          schema="public"
          table="orders"
          columns={COLONNES}
          passerelle={{ readRows: async () => FENETRE_LUE } as unknown as PasserelleLignes}
          edition={edition}
          onBasculerEdition={() => setEdition((precedent) => !precedent)}
          onAttenteChange={() => {}}
        />
      )
    }
    render(
      <>
        <Sprite />
        <LanguageProvider preferences={{ language: 'fr' }}>
          <Ecran />
        </LanguageProvider>
      </>,
    )

    const bascule = screen.getByRole('switch', { name: 'Verrouiller la table' })
    const verrous = () => [...bascule.querySelectorAll('use')].map((u) => u.getAttribute('href'))

    // **Les deux dessins sont là dans les deux positions**, dans cet ordre — le cadenas ouvert à
    // gauche, le fermé à droite. C’est ce qui les rend lisibles : un cadenas fermé lu seul dit
    // l’état sans annoncer qu’on peut l’ouvrir, lu contre son voisin il dit les deux. C’est aussi
    // ce qu’`API-28` reprochait au bouton, et que deux positions règlent.
    expect(verrous()).toEqual(['#i-unlock', '#i-lock'])

    await utilisateur.click(bascule)

    // Rien ne change de dessin ni de place : ce qui bouge est la pastille et l’accent, que
    // `10e-toolbar.spec.ts` mesure — jsdom ne calcule aucune couleur ni aucune position.
    expect(verrous()).toEqual(['#i-unlock', '#i-lock'])
  })

  it('un triple clic n’émet qu’une relecture', async () => {
    const utilisateur = userEvent.setup()
    // Une lecture qui ne répond jamais : le bouton reste en attente, donc inerte.
    const readRows = vi.fn(() => new Promise<never>(() => {}))
    render(
      <>
        <Sprite />
        <LanguageProvider preferences={{ language: 'fr' }}>
          <TableView
            cle={CLE}
            schema="public"
            table="orders"
            columns={COLONNES}
            passerelle={{ readRows } as unknown as PasserelleLignes}
          />
        </LanguageProvider>
      </>,
    )
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    const bouton = screen.getByRole('button', { name: 'Rafraîchir' })
    await utilisateur.click(bouton)
    await utilisateur.click(bouton)
    await utilisateur.click(bouton)

    // Le premier clic n'a pas pu partir non plus : la première lecture n'a jamais répondu, donc le
    // bouton était déjà inerte. C'est le comportement voulu — trois clics, aucune relecture en trop.
    expect(readRows).toHaveBeenCalledTimes(1)
  })
})
