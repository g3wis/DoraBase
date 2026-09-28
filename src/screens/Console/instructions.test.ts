import { describe, expect, it } from 'vitest'
import { decoupeLesSuites, decouper } from './instructions'

const sqls = (texte: string, moteur: Parameters<typeof decouper>[1] = 'postgresql') =>
  decouper(texte, moteur).map((instruction) => instruction.sql)

describe('decouper', () => {
  it('coupe sur les points-virgules, sans le terminal ni les blancs', () => {
    expect(sqls('select 1;\n  select 2 ;\nselect 3')).toEqual(['select 1', 'select 2', 'select 3'])
  })

  it('rend une seule instruction pour un texte sans point-virgule', () => {
    expect(sqls('select * from orders')).toEqual(['select * from orders'])
  })

  it("n'en fait aucune d'un morceau vide ou de commentaires seuls", () => {
    expect(sqls('select 1;;  ; -- fin\n/* rien */')).toEqual(['select 1'])
    expect(sqls('   ')).toEqual([])
  })

  it('garde le commentaire qui précède une instruction', () => {
    expect(sqls('select 1;\n-- la seconde\nselect 2')).toEqual([
      'select 1',
      '-- la seconde\nselect 2',
    ])
  })

  it('situe chaque instruction dans le texte', () => {
    const texte = 'select 1;\n  select 2;'
    for (const { sql, debut, fin } of decouper(texte, 'postgresql')) {
      expect(texte.slice(debut, fin)).toBe(sql)
    }
  })

  it('ne coupe ni dans une chaîne, ni dans un identifiant cité, ni dans un commentaire', () => {
    expect(sqls(`select 'a;b', "c;d" from t -- e;f\n; select 2`)).toEqual([
      `select 'a;b', "c;d" from t -- e;f`,
      'select 2',
    ])
    expect(sqls('select /* ; */ 1; select 2')).toEqual(['select /* ; */ 1', 'select 2'])
    expect(sqls("select 'l''apostrophe;'; select 2")).toEqual([
      "select 'l''apostrophe;'",
      'select 2',
    ])
    expect(sqls('select `a;b` from t; select 2', 'mysql')).toEqual([
      'select `a;b` from t',
      'select 2',
    ])
    expect(sqls('select [a;b] from t; select 2', 'sqlite')).toEqual([
      'select [a;b] from t',
      'select 2',
    ])
  })

  it("n'échappe par l'antislash que chez MySQL", () => {
    // PostgreSQL et SQLite : `'a\'` est une chaîne complète, et le `;` qui suit coupe.
    expect(sqls("select 'a\\'; select 2", 'postgresql')).toEqual(["select 'a\\'", 'select 2'])
    expect(sqls("select 'a\\'; select 2", 'sqlite')).toEqual(["select 'a\\'", 'select 2'])
    // MySQL : `\'` est une apostrophe, la chaîne continue jusqu'à la suivante.
    expect(sqls("select 'a\\';b'; select 2", 'mysql')).toEqual(["select 'a\\';b'", 'select 2'])
  })

  it('lit `#` comme un commentaire chez MySQL seulement', () => {
    expect(sqls('select 1 # a;b\n; select 2', 'mysql')).toEqual(['select 1 # a;b', 'select 2'])
    expect(sqls('select 1 # a;b', 'postgresql')).toEqual(['select 1 # a', 'b'])
  })

  it('ne coupe pas dans un corps en dollars de PostgreSQL', () => {
    const fonction =
      'create function f() returns int as $$ begin; return 1; end $$ language plpgsql'
    expect(sqls(`${fonction}; select f()`)).toEqual([fonction, 'select f()'])
    const etiquetee = 'do $corps$ begin perform 1; end $corps$'
    expect(sqls(`${etiquetee}; select 2`)).toEqual([etiquetee, 'select 2'])
    // Un paramètre positionnel n'ouvre rien.
    expect(sqls('select $1; select 2')).toEqual(['select $1', 'select 2'])
  })

  it('garde entier le corps `begin atomic … end` de PostgreSQL', () => {
    const corps =
      'create function f() returns int language sql begin atomic select 1; select case when true then 2 end; end'
    expect(sqls(`${corps}; select 3`)).toEqual([corps, 'select 3'])
  })

  it("garde entier le corps d'un trigger SQLite", () => {
    const trigger =
      'create trigger t after insert on a begin insert into b values (case when 1 then 2 end); update c set x = 1; end'
    expect(sqls(`${trigger}; select 1`, 'sqlite')).toEqual([trigger, 'select 1'])
  })

  it("garde entier le corps d'une procédure MySQL, blocs de contrôle compris", () => {
    const procedure = [
      'create definer = root@localhost procedure p()',
      'begin',
      '  if 1 then select 1; end if;',
      '  while 0 do select 2; end while;',
      '  case when 1 then select 3; end case;',
      'end',
    ].join('\n')
    expect(sqls(`${procedure};\nselect 4`, 'mysql')).toEqual([procedure, 'select 4'])
  })

  it("n'ouvre pas de corps sur un simple `begin` de transaction", () => {
    expect(sqls('begin; insert into t values (1); commit', 'sqlite')).toEqual([
      'begin',
      'insert into t values (1)',
      'commit',
    ])
  })

  it("n'ouvre pas de corps sur un nom de colonne qui ressemble à une routine", () => {
    // `begin` n'est pas réservé chez MySQL : il nomme une colonne sans citation. Seul le rang de
    // `event` — au-delà des premiers mots — dit qu'aucune routine n'est déclarée ici.
    const table =
      'create table journal (id int, horodatage int, source text, event text, begin int)'
    expect(sqls(`${table}; select 1`, 'mysql')).toEqual([table, 'select 1'])
  })
})

describe('decoupeLesSuites', () => {
  it('découpe les trois moteurs relationnels, et eux seuls', () => {
    expect(decoupeLesSuites('postgresql')).toBe(true)
    expect(decoupeLesSuites('mysql')).toBe(true)
    expect(decoupeLesSuites('sqlite')).toBe(true)
    expect(decoupeLesSuites('mongodb')).toBe(false)
    expect(decoupeLesSuites('bigquery')).toBe(false)
    expect(decoupeLesSuites(undefined)).toBe(false)
  })
})
