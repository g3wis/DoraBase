import { describe, expect, it } from 'vitest'
import brut from '../../../src-tauri/tests/fixtures/nature-sql.json?raw'
import { demandeConfirmation, natureDe, sansRestriction } from './nature'

/**
 * **La fixture partagée avec le cœur** (#168) : `engine/nature.rs` la lit aussi, et refuse côté Rust
 * ce que ce classificateur refuse avant la modale sur une connexion en lecture seule. Les deux
 * doivent rendre exactement `expected`.
 */
describe('la nature d’une requête, telle que le cœur la lit aussi (#168)', () => {
  it('rend exactement ce que la fixture partagée attend', () => {
    const { cases } = JSON.parse(brut) as { cases: { sql: string; expected: unknown }[] }
    expect(cases.length).toBeGreaterThanOrEqual(10)
    for (const { sql, expected } of cases) expect(natureDe(sql), sql).toEqual(expected)
  })
})

describe('la nature d’une requête (`12c`)', () => {
  it('une lecture ne demande aucune confirmation', () => {
    for (const sql of [
      'select * from orders',
      'with x as (select 1) select * from x',
      'table orders',
      'explain select 1',
      'show search_path',
    ]) {
      expect(natureDe(sql).kind, sql).toBe('lecture')
      expect(demandeConfirmation(natureDe(sql)), sql).toBe(false)
    }
  })

  it('une écriture est reconnue et nommée', () => {
    // **Nommée**, pas seulement détectée : la confirmation dit quelle instruction va partir, ce qui
    // permet de s'apercevoir qu'on s'est trompé de console.
    expect(natureDe('delete from orders where id = 1')).toEqual({
      kind: 'ecriture',
      instruction: 'DELETE',
    })
    expect(natureDe('INSERT INTO orders (id) VALUES (1)')).toEqual({
      kind: 'ecriture',
      instruction: 'INSERT',
    })
  })

  it('une modification de schéma est distinguée d’une écriture de données', () => {
    // `drop` est le plus coûteux à défaire : la confirmation ne dit pas la même chose.
    expect(natureDe('drop table orders')).toEqual({ kind: 'schema', instruction: 'DROP' })
    expect(natureDe('alter table orders add column x int')).toEqual({
      kind: 'schema',
      instruction: 'ALTER',
    })
  })

  it('un commentaire en tête ne cache pas le vrai premier mot', () => {
    // **Le cas dangereux** : une requête classée « lecture » par erreur passerait sans confirmation.
    expect(natureDe('-- nettoyage\ndelete from orders').kind).toBe('ecriture')
    expect(natureDe('/* rapport mensuel */ truncate orders').kind).toBe('ecriture')
  })

  it('un mot-clé dans une chaîne déclenche une confirmation de trop, et c’est voulu', () => {
    // **Demander une confirmation de trop est un inconfort ; manquer un `drop` ne l'est pas.** La
    // reconnaissance est volontairement large, et ce test fixe le compromis pour qu'il ne soit pas
    // « corrigé » par erreur plus tard.
    expect(natureDe("select * from logs where action = 'delete'").kind).toBe('lecture')
    expect(natureDe("with x as (select 'delete') select * from x").kind).toBe('ecriture')
  })

  it('un `with` qui écrit est reconnu malgré son premier mot', () => {
    // PostgreSQL permet `with … delete from` : classer sur le seul premier mot laisserait passer une
    // écriture sous couvert de CTE.
    expect(natureDe('with vieux as (select id from orders) delete from orders').kind).toBe(
      'ecriture',
    )
  })

  it('un `update` sans `where` est signalé à part', () => {
    // « UPDATE sans WHERE » dit *quoi* vérifier, là où « UPDATE » ne dit que ce qu'on a tapé.
    expect(sansRestriction('update orders set status = 1')).toBe(true)
    expect(sansRestriction('update orders set status = 1 where id = 2')).toBe(false)
    expect(sansRestriction('delete from orders')).toBe(true)
    // Un `select` sans `where` n'a rien d'inquiétant.
    expect(sansRestriction('select * from orders')).toBe(false)
    // Un `where` en commentaire ne compte pas : c'est le cas qui rendrait le signalement inutile.
    expect(sansRestriction('delete from orders -- where id = 1')).toBe(true)
  })
})
