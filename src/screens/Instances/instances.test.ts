import { describe, expect, test } from 'vitest'
import type { Capability, InstancePrivilege, InstanceRole } from '../../domain/instances'
import {
  ageEnSecondes,
  ageLisible,
  attributsDe,
  basesDe,
  destinataireParDefaut,
  dureeLisible,
  matriceDe,
  permis,
  raisonDuRefus,
  sigleDe,
} from './instances'

function privilege(partiel: Partial<InstancePrivilege> = {}): InstancePrivilege {
  return {
    role: 'bi',
    database: 'analytics',
    create: false,
    temporary: false,
    connect: false,
    ...partiel,
  }
}

describe('le sigle d’une cellule de privilège', () => {
  test('trois privilèges s’écrivent ALL, pas CTc', () => {
    // Ce que la maquette montre, et ce qu'on cherche du regard en balayant une colonne : un sigle
    // composé demanderait de lire trois lettres pour voir qu'il n'en manque aucune.
    expect(sigleDe(privilege({ create: true, temporary: true, connect: true }))).toBe('ALL')
  })

  test('les lettres gardent l’ordre de la légende quels que soient les privilèges', () => {
    // Sans ordre fixe, `cT` et `Tc` diraient la même chose et deux lignes ne se compareraient plus
    // d'un coup d'œil.
    expect(sigleDe(privilege({ temporary: true, connect: true }))).toBe('Tc')
    expect(sigleDe(privilege({ create: true, connect: true }))).toBe('Cc')
    expect(sigleDe(privilege({ connect: true }))).toBe('c')
  })

  test('aucun privilège rend le tiret cadratin, pas du vide', () => {
    // Une cellule vide se lirait comme une donnée manquante, là où « aucun privilège » est une
    // réponse.
    expect(sigleDe(privilege())).toBe('—')
  })
})

test('la matrice indexe par rôle puis par base', () => {
  const donnees = [
    privilege({ role: 'bi', database: 'analytics', connect: true }),
    privilege({ role: 'bi', database: 'ventes' }),
    privilege({ role: 'etl', database: 'analytics', create: true }),
  ]
  const matrice = matriceDe(donnees)
  expect(matrice.get('bi')?.get('analytics')?.connect).toBe(true)
  expect(matrice.get('etl')?.get('analytics')?.create).toBe(true)
  expect(matrice.get('etl')?.get('ventes')).toBeUndefined()
})

test('les bases de la matrice gardent leur ordre et ne se répètent pas', () => {
  const bases = basesDe([
    privilege({ role: 'bi', database: 'ventes' }),
    privilege({ role: 'bi', database: 'analytics' }),
    privilege({ role: 'etl', database: 'ventes' }),
  ])
  expect(bases).toEqual(['ventes', 'analytics'])
})

describe('les gestes permis', () => {
  const capacites: Capability[] = [
    { gesture: 'createRole', allowed: false, reason: 'le rôle n’a pas l’attribut CREATEROLE' },
    { gesture: 'createDatabase', allowed: true, reason: null },
  ]

  test('un refus porte sa raison', () => {
    expect(permis(capacites, 'createRole')).toBe(false)
    expect(raisonDuRefus(capacites, 'createRole')).toBe('le rôle n’a pas l’attribut CREATEROLE')
  })

  test('un geste permis n’a pas de raison — elle s’afficherait comme une limite inexistante', () => {
    expect(raisonDuRefus(capacites, 'createDatabase')).toBeUndefined()
  })

  test('tant que la vue d’ensemble n’a pas répondu, tout est permis', () => {
    // L'inverse ferait d'une lecture lente un écran mort : l'utilisateur croirait à un compte sans
    // droits, alors qu'un geste refusé dira son refus au retour.
    expect(permis(undefined, 'dropRole')).toBe(true)
    expect(raisonDuRefus(undefined, 'dropRole')).toBeUndefined()
  })

  test('un geste que le cœur n’a pas nommé est permis, non refusé en silence', () => {
    expect(permis(capacites, 'setParameter')).toBe(true)
  })
})

test('les attributs d’un rôle sortent en mots, et le rôle nu n’en a aucun', () => {
  const role: InstanceRole = {
    name: 'bi',
    canLogin: true,
    superuser: false,
    createDb: true,
    createRole: false,
    replication: false,
    bypassRls: true,
    validUntil: null,
    memberOf: [],
    ownedDatabases: 0,
    system: false,
  }
  expect(attributsDe(role)).toEqual(['CREATEDB', 'BYPASSRLS'])
  expect(attributsDe({ ...role, createDb: false, bypassRls: false })).toEqual([])
})

describe('le destinataire par défaut d’une réattribution', () => {
  test('c’est le rôle courant, seul dont on soit sûr qu’il puisse recevoir', () => {
    expect(destinataireParDefaut('postgres', 'analytics_bi')).toBe('postgres')
  })

  test('un rôle ne se reçoit pas lui-même', () => {
    // `REASSIGN OWNED BY x TO x` est refusé par le serveur : l'écran doit faire choisir.
    expect(destinataireParDefaut('postgres', 'postgres')).toBeNull()
  })
})

describe('la durée d’une session', () => {
  test('un seul palier, celui de l’ordre de grandeur', () => {
    expect(dureeLisible(3)).toBe('3 s')
    expect(dureeLisible(59)).toBe('59 s')
    expect(dureeLisible(60)).toBe('1 min')
    expect(dureeLisible(3599)).toBe('59 min')
    expect(dureeLisible(3600)).toBe('1 h')
    expect(dureeLisible(86399)).toBe('23 h')
    expect(dureeLisible(86400)).toBe('1 j')
  })

  test('une durée absente rend le tiret, pas zéro', () => {
    // « 0 s » dirait « la session vient de changer d'état » là où le serveur n'a rien dit.
    expect(dureeLisible(null)).toBe('—')
  })
})

describe('l’âge d’un relevé', () => {
  test('se dit en paliers, non toujours en secondes', () => {
    // **Aucun rafraîchissement automatique** : un onglet laissé ouvert une nuit annonçait « relevé
    // il y a 41 400 s », un nombre que personne ne convertit de tête — donc une phrase qui cessait
    // de dire l'ordre de grandeur, ce pour quoi elle existe. Rapporté à l'usage le 9 septembre 2026.
    const depart = 1_000_000_000
    expect(ageLisible(depart, depart + 12_000)).toBe('12 s')
    expect(ageLisible(depart, depart + 240_000)).toBe('4 min')
    expect(ageLisible(depart, depart + 7_200_000)).toBe('2 h')
    expect(ageLisible(depart, depart + 259_200_000)).toBe('3 j')
  })

  test('emploie la même échelle que la durée d’une session', () => {
    // Les deux répondent à « depuis combien de temps », dans la même barre d'écran à quelques pixels
    // l'une de l'autre. Deux échelles voisines mais distinctes se liraient comme deux unités.
    const depart = 1_000_000_000
    expect(ageLisible(depart, depart + 90_000)).toBe(dureeLisible(90))
  })

  test('un relevé de l’instant rend « 0 s », non un tiret', () => {
    // Le tiret dit « nous ne savons pas » ; ici on sait, et la réponse est « à l'instant ».
    expect(ageLisible(1_000_000, 1_000_000)).toBe('0 s')
  })
})

test('l’âge d’un relevé ne devient jamais négatif', () => {
  // Une horloge qui recule — un ajustement NTP, un test qui fige le temps — rendrait « il y a -1 s »,
  // qui se lit comme un défaut de l'écran.
  expect(ageEnSecondes(1_000_000, 1_012_000)).toBe(12)
  expect(ageEnSecondes(1_000_000, 999_000)).toBe(0)
})
