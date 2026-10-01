import { act, renderHook } from '@testing-library/react'
import type { DatabaseKey } from '../../domain/arbre'
import type { ApplyOutcome, ColumnInfo, UpdatePlan } from '../../domain/engine'
import type { EnAttente } from './modifications'
import { type PasserelleApply, useApplication } from './useApplication'

/**
 * Ce que `useApplication` décide **avant** d'écrire : la confirmation de production (`11d`).
 *
 * Testé sur le crochet et non à travers l'écran de travail, parce que c'est un choix de règle et
 * non de rendu — et que la règle a été fausse : la ligne comparait `cle.environment` à la chaîne
 * `'prod'`, ce que `23g` interdit explicitement.
 */

const COLONNES: ColumnInfo[] = [
  {
    position: 1,
    name: 'id',
    typeName: 'int8',
    category: 'number',
    nullable: false,
    default: null,
    identity: null,
    key: 'primary',
    comment: null,
    frequency: null,
  },
]

const ATTENTE: EnAttente = [
  {
    sorte: 'cellule',
    cle: '184217',
    rang: 3,
    column: 'libelle',
    avant: { kind: 'text', value: 'brouillon' },
    apres: { kind: 'texte', texte: 'relu' },
  },
]

const CIBLE = { schema: 'atelier', table: 'fiches' }

/** Une connexion dans un environnement **nommé « atelier »** — le nom ne dit rien du drapeau. */
const CLE_ATELIER: DatabaseKey = { connection: 'catalogue' }

/** Une connexion dans un environnement **nommé « prod »** — le nom ne dit rien du drapeau. */
const CLE_PROD: DatabaseKey = { connection: 'catalogue' }

function passerelle(): PasserelleApply & { plans: UpdatePlan[] } {
  const plans: UpdatePlan[] = []
  return {
    plans,
    applyChanges: (_key: DatabaseKey, plan: UpdatePlan): Promise<ApplyOutcome> => {
      plans.push(plan)
      return Promise.resolve({ applied: 1, inverseSql: 'BEGIN;\nCOMMIT;' })
    },
  }
}

function monter(cle: DatabaseKey, production: boolean) {
  const pont = passerelle()
  const rendu = renderHook(() =>
    useApplication(cle, CIBLE, ATTENTE, COLONNES, {
      passerelle: pont,
      surSucces: () => {},
      production,
    }),
  )
  return { ...rendu, pont }
}

/*
 * **Le drapeau, jamais le libellé.**
 *
 * Un environnement nommé « atelier » et marqué production ouvre la confirmation ; un environnement
 * nommé « prod » que l'utilisateur n'a pas marqué écrit directement. Accrocher un garde-fou à une
 * chaîne de caractères le rend faux au premier renommage — et `23a` a rendu les libellés
 * renommables.
 */
test('un environnement marqué production ouvre la confirmation, quel que soit son nom', () => {
  const { result, pont } = monter(CLE_ATELIER, true)

  act(() => result.current.demander())

  expect(result.current.confirmation).toBe(true)
  // **Rien n'est parti.** C'est tout l'objet de la confirmation : demander n'écrit pas.
  expect(pont.plans).toHaveLength(0)
})

test('un environnement nommé « prod » mais non marqué écrit sans confirmation', async () => {
  const { result, pont } = monter(CLE_PROD, false)

  await act(async () => {
    result.current.demander()
  })

  expect(result.current.confirmation).toBe(false)
  expect(pont.plans).toHaveLength(1)
  expect(pont.plans[0]?.table).toBe('fiches')
})

test('confirmer écrit, et ferme la confirmation', async () => {
  const { result, pont } = monter(CLE_ATELIER, true)

  act(() => result.current.demander())
  await act(async () => {
    result.current.appliquer()
  })

  expect(pont.plans).toHaveLength(1)
  expect(result.current.confirmation).toBe(false)
  // Le patch inverse est posé : c'est le seul moyen de défaire, et il doit arriver avec le succès.
  expect(result.current.patchInverse).toContain('BEGIN;')
})

test('annuler la confirmation n’écrit rien', () => {
  const { result, pont } = monter(CLE_ATELIER, true)

  act(() => result.current.demander())
  act(() => result.current.annulerLaConfirmation())

  expect(result.current.confirmation).toBe(false)
  expect(pont.plans).toHaveLength(0)
})

// Le défaut par défaut : sans drapeau, pas de confirmation — et surtout pas une confirmation
// devinée sur le nom de l'environnement.
test('sans drapeau fourni, aucune confirmation n’est devinée', async () => {
  const pont = passerelle()
  const { result } = renderHook(() =>
    useApplication(CLE_PROD, CIBLE, ATTENTE, COLONNES, {
      passerelle: pont,
      surSucces: () => {},
    }),
  )

  await act(async () => {
    result.current.demander()
  })

  expect(result.current.confirmation).toBe(false)
  expect(pont.plans).toHaveLength(1)
})

test('un refus s’affiche et laisse la confirmation fermée', async () => {
  const pont: PasserelleApply = {
    applyChanges: () => Promise.reject(new Error('la table est en lecture seule')),
  }
  const { result } = renderHook(() =>
    useApplication(CLE_ATELIER, CIBLE, ATTENTE, COLONNES, {
      passerelle: pont,
      surSucces: () => {},
      production: true,
    }),
  )

  act(() => result.current.demander())
  await act(async () => {
    result.current.appliquer()
  })

  expect(result.current.refus).toBe('la table est en lecture seule')
})
