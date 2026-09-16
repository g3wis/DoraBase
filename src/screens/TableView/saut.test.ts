import { describe, expect, it } from 'vitest'
import type { ColumnInfo, Relation, Value } from '../../domain/engine'
import { cibleDuSaut } from './saut'

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
  colonne('tenant_id', { typeName: 'text', category: 'text', key: 'foreign' }),
]

function sortante(columns: string[], targetColumns: string[]): Relation {
  return {
    constraintName: 'orders_user_id_fkey',
    direction: 'outgoing',
    cardinality: 'many',
    columns,
    targetSchema: 'public',
    targetTable: 'users',
    targetColumns,
  }
}

describe('cibleDuSaut', () => {
  it('rend la table visée et le filtre qui y désigne la ligne', () => {
    const ligne: Value[] = [{ kind: 'int', value: 7 }, { kind: 'int', value: 42 }, { kind: 'null' }]
    expect(cibleDuSaut(sortante(['user_id'], ['id']), COLONNES, ligne)).toEqual({
      schema: 'public',
      table: 'users',
      filters: [{ column: 'id', operator: 'eq', value: '42' }],
    })
  })

  it('porte toutes les paires d’une clé composite', () => {
    const ligne: Value[] = [
      { kind: 'int', value: 7 },
      { kind: 'int', value: 42 },
      { kind: 'text', value: 'acme' },
    ]
    const cible = cibleDuSaut(sortante(['user_id', 'tenant_id'], ['id', 'tenant']), COLONNES, ligne)
    // **Les deux, et pas la première.** Filtrer sur une moitié de la clé rendrait toutes les
    // lignes qui la partagent — davantage que la ligne qu'on désignait.
    expect(cible?.filters).toEqual([
      { column: 'id', operator: 'eq', value: '42' },
      { column: 'tenant', operator: 'eq', value: 'acme' },
    ])
  })

  it('ne suit pas une clé nulle', () => {
    const ligne: Value[] = [{ kind: 'int', value: 7 }, { kind: 'null' }, { kind: 'null' }]
    expect(cibleDuSaut(sortante(['user_id'], ['id']), COLONNES, ligne)).toBeNull()
  })

  it('ne suit pas une clé composite dont une moitié est nulle', () => {
    const ligne: Value[] = [{ kind: 'int', value: 7 }, { kind: 'int', value: 42 }, { kind: 'null' }]
    expect(
      cibleDuSaut(sortante(['user_id', 'tenant_id'], ['id', 'tenant']), COLONNES, ligne),
    ).toBeNull()
  })

  it('ne suit pas une relation entrante', () => {
    const ligne: Value[] = [{ kind: 'int', value: 7 }, { kind: 'int', value: 42 }, { kind: 'null' }]
    const entrante: Relation = { ...sortante(['id'], ['order_id']), direction: 'incoming' }
    expect(cibleDuSaut(entrante, COLONNES, ligne)).toBeNull()
  })

  it('ne suit rien sans ligne sélectionnée', () => {
    expect(cibleDuSaut(sortante(['user_id'], ['id']), COLONNES, null)).toBeNull()
  })

  it('refuse une contrainte dont les deux bouts ne se correspondent pas', () => {
    const ligne: Value[] = [
      { kind: 'int', value: 7 },
      { kind: 'int', value: 42 },
      { kind: 'text', value: 'acme' },
    ]
    // Un catalogue et une contrainte désaccordés : mieux vaut ne rien offrir qu'un filtre sur
    // une colonne que la cible n'a pas.
    expect(cibleDuSaut(sortante(['user_id', 'tenant_id'], ['id']), COLONNES, ligne)).toBeNull()
    expect(cibleDuSaut(sortante(['absente'], ['id']), COLONNES, ligne)).toBeNull()
    // **Et surtout l'autre sens, qui est le dangereux** : moins de colonnes de départ que de
    // colonnes visées. Sans la garde, la boucle parcourt le départ, ignore les cibles en trop et
    // rend un filtre sur **une partie** de la clé — donc plus de lignes que celle qu'on désignait,
    // en silence. Le premier sabotage de cette garde est resté vert faute de ce cas.
    expect(cibleDuSaut(sortante(['user_id'], ['id', 'tenant']), COLONNES, ligne)).toBeNull()
  })
})
