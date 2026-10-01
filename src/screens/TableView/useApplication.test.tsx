import { act, renderHook } from '@testing-library/react'
import type { DatabaseKey } from '../../domain/arbre'
import type { ApplyOutcome, ColumnInfo, UpdatePlan } from '../../domain/engine'
import type { EnAttente } from './modifications'
import { type PasserelleApply, useApplication } from './useApplication'

/**
 * Ce que `useApplication` fait d'une demande (`11d`) — **sans confirmation** depuis #168 : la lecture
 * seule refuse en amont, elle ne confirme pas.
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
const CLE: DatabaseKey = { connection: 'catalogue' }

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

test('demander écrit tout de suite, et pose le patch inverse', async () => {
  const pont = passerelle()
  const { result } = renderHook(() =>
    useApplication(CLE, CIBLE, ATTENTE, COLONNES, { passerelle: pont, surSucces: () => {} }),
  )

  await act(async () => {
    result.current.demander()
  })

  expect(pont.plans).toHaveLength(1)
  expect(pont.plans[0]?.table).toBe('fiches')
  // Le patch inverse est posé : c'est le seul moyen de défaire, et il doit arriver avec le succès.
  expect(result.current.patchInverse).toContain('BEGIN;')
})

test('le refus du cœur s’affiche tel qu’il est dit', async () => {
  // Celui de la lecture seule, que le cœur prononce en nommant le dossier qui l'impose (#168).
  const refus =
    'cette base de données est en lecture seule, imposée par le dossier « prod » : impossible d’écrire.'
  const pont: PasserelleApply = { applyChanges: () => Promise.reject({ message: refus }) }
  const { result } = renderHook(() =>
    useApplication(CLE, CIBLE, ATTENTE, COLONNES, { passerelle: pont, surSucces: () => {} }),
  )

  await act(async () => {
    result.current.demander()
  })

  expect(result.current.refus).toBe(refus)
  expect(result.current.enCours).toBe(false)
})
