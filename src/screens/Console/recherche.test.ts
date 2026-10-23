import { SearchQuery } from '@codemirror/search'
import { EditorSelection, EditorState } from '@codemirror/state'
import { expect, test } from 'vitest'
import { compterLesOccurrences } from './recherche'

function etat(texte: string, de = 0, a = de) {
  return EditorState.create({ doc: texte, selection: EditorSelection.single(de, a) })
}

const cherche = (search: string) => new SearchQuery({ search })

test('compte les occurrences, sans tenir compte de la casse', () => {
  const texte = 'select id from orders\nwhere ID = 2 -- id'
  expect(compterLesOccurrences(etat(texte), cherche('id'))).toEqual({
    total: 3,
    rang: null,
    auDela: false,
  })
})

test('situe la sélection quand elle est une occurrence', () => {
  const texte = 'id, id, id'
  // La deuxième occurrence, de 4 à 6.
  expect(compterLesOccurrences(etat(texte, 4, 6), cherche('id')).rang).toBe(2)
})

test('une sélection qui chevauche une occurrence sans l’égaler n’a pas de rang', () => {
  // Un curseur posé au milieu d'un mot n'est pas « sur » l'occurrence : écrire « 1 / 3 » dirait
  // qu'`Entrée` vient d'y mener, ce qui n'est pas vrai.
  expect(compterLesOccurrences(etat('id, id, id', 0, 1), cherche('id')).rang).toBeNull()
})

test('une requête vide ne compte rien', () => {
  // C'est le curseur de `SearchQuery` qui le garantit, pas `compterLesOccurrences` : une recherche
  // vide n'y rend aucune occurrence. Le test l'épingle parce que tout le reste en dépend — une
  // occurrence vide par position annoncerait autant de résultats que de caractères.
  expect(compterLesOccurrences(etat('select 1'), cherche(''))).toEqual({
    total: 0,
    rang: null,
    auDela: false,
  })
})

test('aucune occurrence', () => {
  expect(compterLesOccurrences(etat('select 1'), cherche('orders')).total).toBe(0)
})

test('le plafond arrête le compte et le dit', () => {
  const texte = 'a'.repeat(12)
  expect(compterLesOccurrences(etat(texte), cherche('a'), 5)).toEqual({
    total: 5,
    rang: null,
    auDela: true,
  })
  // Exactement au plafond : le compte est juste, et le dire « au-delà » serait faux.
  expect(compterLesOccurrences(etat('aaaaa'), cherche('a'), 5)).toEqual({
    total: 5,
    rang: null,
    auDela: false,
  })
})
