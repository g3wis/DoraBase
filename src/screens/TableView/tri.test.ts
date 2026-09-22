import { describe, expect, it } from 'vitest'
import type { Filter } from '../../domain/engine'
import {
  basculerTri,
  filtreDe,
  libelleDeFiltre,
  operateurParDefaut,
  operateursPour,
  poserFiltre,
  prendUneValeur,
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

  it('les quatre prédicats n’ont pas de valeur, et s’appliquent sans saisie', () => {
    for (const operator of ['isNull', 'isNotNull', 'isTrue', 'isFalse'] as const) {
      expect(filtreDe('shipped_at', operator, '')).toEqual({
        column: 'shipped_at',
        operator,
        value: null,
      })
      // Une saisie restée dans le champ ne les suit pas : `Filter.value` est `None` pour eux
      // (`06a`), et l'envoyer ferait échouer l'adaptateur sur une valeur qu'il n'attend pas.
      expect(filtreDe('shipped_at', operator, 'oublié')?.value).toBeNull()
    }
  })

  it('les trois prédicats se disent en mots dans un chip, jamais par leur signe', () => {
    // « actif T » ne se lit pas : un chip est la phrase du filtre.
    expect(libelleDeFiltre({ column: 'actif', operator: 'isTrue', value: null })).toBe(
      'actif is true',
    )
    expect(libelleDeFiltre({ column: 'actif', operator: 'isFalse', value: null })).toBe(
      'actif is false',
    )
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

  it('sans changement, le tableau reçu est rendu tel quel', () => {
    // `RowQuery` est mémoïsée sur `filters` : un tableau neuf est une **requête neuve**, donc une
    // lecture de cinq cents lignes de plus. Choisir un opérateur sur un champ vide en déclenchait
    // une, et chaque segment d'une date tapée à la main aussi.
    const gros = filtreDe('total_cents', 'ne', '5000') as Filter
    const un = poserFiltre([], 'total_cents', gros)

    expect(poserFiltre(un, 'status', null)).toBe(un)
    expect(poserFiltre(un, 'total_cents', filtreDe('total_cents', 'ne', '5000'))).toBe(un)
    // Un vrai changement, lui, rend bien un tableau neuf.
    expect(poserFiltre(un, 'total_cents', filtreDe('total_cents', 'ne', '6000'))).not.toBe(un)
    expect(poserFiltre(un, 'total_cents', null)).not.toBe(un)
  })

  it('le libellé d’un chip reprend le signe du mockup', () => {
    expect(libelleDeFiltre({ column: 'status', operator: 'eq', value: 'paid' })).toBe(
      'status = paid',
    )
    expect(libelleDeFiltre({ column: 'shipped_at', operator: 'isNull', value: null })).toBe(
      'shipped_at is null',
    )
    expect(libelleDeFiltre({ column: 'shipped_at', operator: 'isNotNull', value: null })).toBe(
      'shipped_at is not null',
    )
    expect(libelleDeFiltre({ column: 'total_cents', operator: 'gt', value: '5000' })).toBe(
      'total_cents > 5000',
    )
  })

  it('les quatre comparaisons ne rejoignent le popover que pour une colonne numérique', () => {
    expect(operateursPour('text', true).map((o) => o.valeur)).toEqual([
      'eq',
      'ne',
      'in',
      'matches',
      'isNull',
      'isNotNull',
    ])
    expect(operateursPour('number', true).map((o) => o.valeur)).toEqual([
      'eq',
      'ne',
      'in',
      'matches',
      'isNull',
      'isNotNull',
      'gt',
      'gte',
      'lte',
      'lt',
    ])
  })

  it('les deux prédicats de nullité ne sont proposés que pour une colonne qui peut en porter', () => {
    // Sur une colonne `NOT NULL`, `is null` rendrait toujours zéro ligne — ce qui se lit comme une
    // table vide plutôt que comme un filtre vide — et `is not null` rendrait **toutes** les lignes,
    // ce qui se lit comme un filtre inopérant. Les deux faces du même fait, donc la même porte.
    for (const category of ['text', 'number', 'timestamp', 'boolean'] as const) {
      const sans = operateursPour(category, false).map((o) => o.valeur)
      const avec = operateursPour(category, true).map((o) => o.valeur)
      expect(sans).not.toContain('isNull')
      expect(sans).not.toContain('isNotNull')
      expect(avec).toContain('isNull')
      expect(avec).toContain('isNotNull')
    }
  })

  it('une colonne temporelle reçoit « avant » et « après », pas les quatre comparaisons', () => {
    const dates = operateursPour('timestamp', true)
    expect(dates.map((o) => o.cle)).toEqual([
      'eq',
      'ne',
      'in',
      'matches',
      'isNull',
      'isNotNull',
      'before',
      'after',
    ])
    // Le même SQL que les nombres, dit autrement : c'est la clé de libellé qui change, pas
    // l'opérateur.
    expect(dates.filter((o) => o.cle === 'before').map((o) => o.valeur)).toEqual(['lt'])
    expect(dates.filter((o) => o.cle === 'after').map((o) => o.valeur)).toEqual(['gt'])
    expect(dates.map((o) => o.valeur)).not.toContain('gte')
    expect(dates.map((o) => o.valeur)).not.toContain('lte')
  })

  it('une colonne booléenne n’a que ses prédicats', () => {
    // Un champ de saisie n'a rien à recevoir d'une colonne à deux valeurs, et `= true` / `= 1`
    // dépendent du moteur.
    expect(operateursPour('boolean', true).map((o) => o.valeur)).toEqual([
      'isTrue',
      'isFalse',
      'isNull',
      'isNotNull',
    ])
    expect(operateursPour('boolean', false).map((o) => o.valeur)).toEqual(['isTrue', 'isFalse'])
  })

  it('l’opérateur par défaut est le premier de la liste de la colonne', () => {
    // Un booléen n'a pas d'`=` : sa liste commence par un prédicat, donc son champ paraît
    // désactivé d'emblée — sans filtre appliqué pour autant.
    for (const category of ['text', 'number', 'timestamp'] as const) {
      expect(operateurParDefaut(category)).toBe('eq')
      expect(operateursPour(category, true)[0]?.valeur).toBe(operateurParDefaut(category))
    }
    expect(operateurParDefaut('boolean')).toBe('isTrue')
    expect(operateursPour('boolean', false)[0]?.valeur).toBe(operateurParDefaut('boolean'))
  })

  it('chaque opérateur a un signe, y compris les comparaisons et les prédicats', () => {
    expect(signeDe('gt')).toBe('>')
    expect(signeDe('gte')).toBe('≥')
    expect(signeDe('lte')).toBe('≤')
    expect(signeDe('lt')).toBe('<')
    expect(signeDe('isTrue')).toBe('T')
    expect(signeDe('isFalse')).toBe('F')
    expect(signeDe('isNull')).toBe('∅')
    expect(signeDe('isNotNull')).toBe('≠∅')
  })

  it('seuls les quatre prédicats se passent d’une valeur', () => {
    for (const operator of ['eq', 'ne', 'in', 'matches', 'gt', 'gte', 'lte', 'lt'] as const) {
      expect(prendUneValeur(operator)).toBe(true)
    }
    for (const operator of ['isNull', 'isNotNull', 'isTrue', 'isFalse'] as const) {
      expect(prendUneValeur(operator)).toBe(false)
    }
  })
})
