import { describe, expect, it } from 'vitest'
import type { Filter } from '../../domain/engine'
import {
  basculerTri,
  filtreDe,
  libelleDeFiltre,
  operateursPour,
  poserFiltre,
  rangDeTri,
  signeDe,
} from './tri'

describe('tri', () => {
  it('parcourt trois états : croissant, décroissant, plus de tri', () => {
    const un = basculerTri([], 'created_at', false)
    expect(un).toEqual([{ column: 'created_at', direction: 'ascending' }])

    const deux = basculerTri(un, 'created_at', false)
    expect(deux).toEqual([{ column: 'created_at', direction: 'descending' }])

    // Sans le troisième état, on ne peut plus revenir à l'ordre naturel de la table.
    expect(basculerTri(deux, 'created_at', false)).toEqual([])
  })

  it('un clic simple remplace le tri, un ⌘-clic l’empile', () => {
    const premier = basculerTri([], 'created_at', false)

    expect(basculerTri(premier, 'id', false)).toEqual([{ column: 'id', direction: 'ascending' }])

    const empile = basculerTri(premier, 'id', true)
    expect(empile.map((c) => c.column)).toEqual(['created_at', 'id'])
  })

  it('l’ordre du vecteur est le rang affiché', () => {
    const sort = basculerTri(basculerTri([], 'created_at', false), 'id', true)
    expect(rangDeTri(sort, 'created_at')).toBe(1)
    expect(rangDeTri(sort, 'id')).toBe(2)
    expect(rangDeTri(sort, 'status')).toBeNull()
  })

  it('retirer un critère empilé laisse les autres en place', () => {
    const sort = basculerTri(basculerTri([], 'created_at', false), 'id', true)
    const sansId = basculerTri(basculerTri(sort, 'id', true), 'id', true)
    expect(sansId.map((c) => c.column)).toEqual(['created_at'])
  })
})

describe('filtres', () => {
  it('une saisie vide ne produit aucun filtre', () => {
    expect(filtreDe('status', 'eq', '')).toBeNull()
    expect(filtreDe('status', 'eq', '   ')).toBeNull()
  })

  it('`is null` n’a pas de valeur, et s’applique sans saisie', () => {
    expect(filtreDe('shipped_at', 'isNull', '')).toEqual({
      column: 'shipped_at',
      operator: 'isNull',
      value: null,
    })
  })

  it('poser un filtre remplace celui de la même colonne, retirer le supprime', () => {
    const paid = filtreDe('status', 'eq', 'paid') as Filter
    const pending = filtreDe('status', 'eq', 'pending') as Filter
    const gros = filtreDe('total_cents', 'ne', '5000') as Filter

    const deux = poserFiltre(poserFiltre([], 'status', paid), 'total_cents', gros)
    expect(deux).toHaveLength(2)

    const remplace = poserFiltre(deux, 'status', pending)
    expect(remplace).toHaveLength(2)
    expect(remplace.find((f) => f.column === 'status')?.value).toBe('pending')

    const retire = poserFiltre(remplace, 'status', null)
    expect(retire.map((f) => f.column)).toEqual(['total_cents'])
  })

  it('le libellé d’un chip reprend le signe du mockup', () => {
    expect(libelleDeFiltre({ column: 'status', operator: 'eq', value: 'paid' })).toBe(
      'status = paid',
    )
    expect(libelleDeFiltre({ column: 'shipped_at', operator: 'isNull', value: null })).toBe(
      'shipped_at is null',
    )
    expect(libelleDeFiltre({ column: 'total_cents', operator: 'gt', value: '5000' })).toBe(
      'total_cents > 5000',
    )
  })

  it('les quatre comparaisons ne rejoignent le popover que pour une colonne numérique', () => {
    expect(operateursPour(false)).toHaveLength(5)
    expect(operateursPour(true)).toHaveLength(9)
    expect(operateursPour(true).map((o) => o.valeur)).toEqual(
      expect.arrayContaining(['gt', 'gte', 'lte', 'lt']),
    )
  })

  it('chaque opérateur a un signe, y compris les comparaisons', () => {
    expect(signeDe('gt')).toBe('>')
    expect(signeDe('gte')).toBe('≥')
    expect(signeDe('lte')).toBe('≤')
    expect(signeDe('lt')).toBe('<')
  })
})
