import { expect, test } from 'vitest'
import type { Database, FolderTree } from '../../domain/config'
import { arbreDeTest, connexionDeTest, REGLAGES, trioDeTest } from '../NewConnection/pourLesTests'
import { cibleUnique } from './cibleUnique'

function base(id: string, name: string, overrides: Partial<Database> = {}): Database {
  return connexionDeTest(id, name, overrides)
}

test('une seule connexion : la cible est résolue, par son identifiant', () => {
  const cible = cibleUnique(
    arbreDeTest(trioDeTest({ staging: [base('c-commandes', 'commandes')] })),
  )

  expect(cible?.request.key).toEqual({ connection: 'c-commandes' })
  expect(cible?.request.engine).toBe('postgresql')
  // Ce que la modale nomme : le chemin de dossiers, puis la connexion.
  expect(cible?.nommee).toEqual({ chemin: 'Atelier Nord › staging', base: 'commandes' })
})

test('deux connexions : aucune cible, la modale doit le dire', () => {
  // Se tromper de base à l'import écrirait dans la mauvaise : choisir à la place de l'utilisateur
  // est précisément ce qu'il ne faut pas faire ici.
  const cible = cibleUnique(
    arbreDeTest(trioDeTest({ dev: [base('c-1', 'commandes'), base('c-2', 'clients')] })),
  )
  expect(cible).toBeNull()
})

test('deux connexions homonymes dans deux dossiers : aucune cible non plus', () => {
  // Le cas le plus dangereux : « commandes » existe en dev et en prod, et rien à ce niveau ne dit
  // laquelle viser.
  const cible = cibleUnique(
    arbreDeTest(trioDeTest({ dev: [base('c-1', 'commandes')], prod: [base('c-2', 'commandes')] })),
  )
  expect(cible).toBeNull()
})

test('deux dossiers racine, une connexion chacun : aucune cible', () => {
  const cible = cibleUnique(
    arbreDeTest(
      trioDeTest({ dev: [base('c-1', 'commandes')] }),
      trioDeTest({ dev: [base('c-2', 'stock')] }, { id: 'f-sud', name: 'Atelier Sud' }),
    ),
  )
  expect(cible).toBeNull()
})

test('un arbre vide : aucune cible', () => {
  expect(cibleUnique({ folders: [], connections: [] })).toBeNull()
})

test('des dossiers sans connexion : aucune cible', () => {
  expect(cibleUnique(arbreDeTest(trioDeTest()))).toBeNull()
})

test('une connexion rangée à la racine se nomme sans chemin', () => {
  const arbre: FolderTree = { folders: [], connections: [base('c-seule', 'seule')] }
  expect(cibleUnique(arbre)?.nommee).toEqual({ chemin: '', base: 'seule' })
})

test('les réglages rendus sont ceux de la connexion, pas un décor par défaut', () => {
  // Contrôle positif : sans lui, `cibleUnique` pourrait rendre n'importe quels réglages et les tests
  // précédents resteraient verts — ils ne regardent que la clé.
  const cible = cibleUnique(
    arbreDeTest(
      trioDeTest({
        prod: [base('c-1', 'commandes', { connection: { ...REGLAGES, host: 'db.prod' } })],
      }),
    ),
  )

  expect(cible?.connection.host).toBe('db.prod')
  expect(cible?.request.variant.host).toBe('db.prod')
})
