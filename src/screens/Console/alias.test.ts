import { describe, expect, it } from 'vitest'
import { qualifiantAvant, tablesCitees } from './alias'

describe('les alias de tables (`12d`)', () => {
  it('reconnaît un alias sans `as`, comme le mockup l’écrit', () => {
    const par = tablesCitees('select * from orders o join users u on u.id = o.user_id')
    expect(par.get('o')).toBe('orders')
    expect(par.get('u')).toBe('users')
  })

  it('indexe aussi par nom de table, pour les requêtes sans alias', () => {
    // `from orders` puis `orders.status` est courant sur une requête à une seule table.
    const par = tablesCitees('select * from orders where')
    expect(par.get('orders')).toBe('orders')
  })

  it('un nom qualifié est ramené à son nom court', () => {
    // C'est le nom court que l'arbre connaît : `09d` indexe les objets par schéma, pas par nom
    // qualifié.
    const par = tablesCitees('select * from public.orders o')
    expect(par.get('o')).toBe('orders')
    expect(par.get('orders')).toBe('orders')
  })

  it('un mot réservé n’est jamais pris pour un alias', () => {
    // **Sans cette garde, `from orders where …` ferait de `where` un alias** — et `where.` proposerait
    // les colonnes d'`orders`, ce qui est absurde et trompeur.
    const par = tablesCitees('select * from orders where status = 1')
    expect(par.has('where')).toBe(false)
    const groupe = tablesCitees('select * from orders group by 1')
    expect(groupe.has('group')).toBe(false)
  })

  it('accepte `as` quand il est écrit', () => {
    expect(tablesCitees('select * from orders as o').get('o')).toBe('orders')
  })

  it('un deuxième `join` sans alias explicite n’est pas avalé par le premier', () => {
    // Sans alias sur `orders`, le mot réservé `join` qui suit est le candidat naturel du groupe
    // d'alias — s'il est consommé avant d'être rejeté, le `matchAll` suivant reprend après lui et
    // rate `join users` entièrement.
    const par = tablesCitees('select * from orders join users u on u.id = orders.user_id')
    expect(par.get('orders')).toBe('orders')
    expect(par.get('users')).toBe('users')
    expect(par.get('u')).toBe('users')
  })

  it('ignore ce qui est en commentaire', () => {
    // Une table citée dans un commentaire n'est pas dans la requête : proposer ses colonnes
    // produirait une requête en erreur que l'utilisateur croirait correcte.
    const par = tablesCitees('-- from secrets s\nselect * from orders o')
    expect(par.has('s')).toBe(false)
    expect(par.get('o')).toBe('orders')
  })

  it('lit le qualifiant à l’endroit du curseur', () => {
    expect(qualifiantAvant('select o.', 9)).toBe('o')
    expect(qualifiantAvant('select o.cou', 12)).toBe('o')
    // Sans point, aucune qualification : la liste proposera des tables et des mots-clés.
    expect(qualifiantAvant('select cou', 10)).toBeNull()
    // Le curseur en amont du point ne qualifie rien.
    expect(qualifiantAvant('select o.cou', 8)).toBeNull()
  })
})
