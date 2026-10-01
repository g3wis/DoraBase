import { renderHook, waitFor } from '@testing-library/react'
import { useMemo, useRef, useState } from 'react'
import { expect, it, vi } from 'vitest'
import type { DatabaseKey } from '../../domain/arbre'
import type { TableDetail, TableSummary } from '../../domain/engine'
import {
  grouperParBoucle,
  type PasserelleStructures,
  type Structures,
} from '../Workbench/useStructures'
import { PLAFOND_DE_TABLES, useDiagramme } from './useDiagramme'

/**
 * Le chargeur du diagramme, **hors de l'écran**.
 *
 * Ce qui se mesure ici est ce qu'aucun test d'écran n'a pu garder : la première version de la
 * garantie « les objets de l'arbre lui sont passés » vivait dans `Workbench.test.tsx` et **restait
 * verte sous sabotage** — dans l'écran assemblé, la cascade de préchauffage a déjà listé le schéma,
 * donc le repli sur son cache couvrait l'absence du passage de main. Le fait n'était pas faux, il
 * était juste invérifiable là. Ici le cache est vide par construction : chaque source est la seule.
 */

const CLE: DatabaseKey = { connection: 'analytics' }

const objet = (name: string, kind: TableSummary['kind'] = 'table'): TableSummary => ({
  name,
  kind,
  rows: { kind: 'estimated', value: 12 },
  sizeBytes: null,
  columnCount: 1,
  primaryKey: 'id',
  lastAnalyze: null,
  comment: null,
})

const detailDe = (name: string): TableDetail => ({
  schema: 'public',
  name,
  rows: { kind: 'estimated', value: 12 },
  sizeBytes: null,
  comment: null,
  columns: [
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
  ],
  indexes: [],
  constraints: [],
  triggers: [],
  relations: [],
  ddl: '',
})

/**
 * Un cache **vrai**, et non un espion muet — et une miniature fidèle de `useStructures`.
 *
 * Trois propriétés du vrai cache décident du comportement du chargeur, et un double qui en
 * oublierait une mesurerait le double au lieu du sujet (règle n° 14) :
 *
 * - **`poser` rend la table lisible par `detail`**, sinon le chargeur la redemanderait en boucle ;
 * - **une écriture fait rendre**, comme le `setState` de `useStructures` : c'est ce qui fait
 *   paraître une boîte dès qu'elle arrive, et sans quoi `tables` resterait vide pour toujours ;
 * - **son identité change à chaque écriture**, parce que c'est ce changement que le `useMemo` de
 *   `useDiagramme` observe. Un objet figé aurait rendu le premier calcul éternel.
 *
 * Ce qui l'a rendu nécessaire, mesuré : la première version fabriquait le cache **dans** le rappel
 * de `renderHook`, donc un neuf à chaque rendu — chaque table posée était écrite dans une table
 * jetée aussitôt, et les six tests qui attendent des structures échouaient sans que le sujet y soit
 * pour rien.
 */
function useFauxCache(initial: readonly string[] = []) {
  // Le tour de rôle des lectures : c'est lui qui change l'identité de l'objet rendu.
  const [tour, setTour] = useState(0)
  const table = useRef(new Map<string, TableDetail>())
  const pose = useRef<string[]>([])
  const amorce = useRef(false)
  if (!amorce.current) {
    amorce.current = true
    for (const nom of initial) table.current.set(`public.${nom}`, detailDe(nom))
  }

  const structures = useMemo<Structures>(() => {
    // `tour` est **lu** ici, et pas seulement déclaré en dépendance : c'est ce qui fait changer
    // l'identité de l'objet à chaque écriture, comme le fait `useStructures`. Biome a raison de
    // signaler une dépendance qui ne sert à rien ; la réponse est de la faire servir, pas de
    // l'éteindre par une suppression.
    void tour
    return {
      detail: (_cle, schema, nom) => table.current.get(`${schema}.${nom}`),
      objetsDuSchema: () => undefined,
      poser: (_cle, schema, nom, valeur) => {
        table.current.set(`${schema}.${nom}`, valeur)
        pose.current.push(nom)
        setTour((precedent) => precedent + 1)
      },
      oublier: () => {},
      vider: () => {},
      oublierLaConnexion: () => {},
      prechauffer: () => {},
      prechaufferLeSchema: () => {},
    }
  }, [tour])
  return { structures, pose }
}

function passerelle(objets: readonly TableSummary[]): PasserelleStructures {
  const describeTable = vi.fn(async (_cle: DatabaseKey, _schema: string, nom: string) =>
    detailDe(nom),
  )
  return {
    listObjects: vi.fn(async () => [...objets]),
    describeTable,
    // **Le double groupe en bouclant**, et compte ses appels des deux côtés : les tests qui
    // mesurent « combien de tables ont été demandées » lisent `describeTable`, celui qui mesure
    // « combien de demandes groupées » lit `describeTables`.
    describeTables: vi.fn(grouperParBoucle(describeTable)),
  }
}

/** Monte le chargeur sur le faux cache, et expose ce que celui-ci a reçu. */
function monter(
  pont: PasserelleStructures,
  options: {
    objetsConnus?: readonly TableSummary[]
    deja?: readonly string[]
    sansCible?: boolean
  } = {},
) {
  const vu = { pose: [] as string[] }
  const rendu = renderHook(() => {
    const { structures, pose } = useFauxCache(options.deja)
    vu.pose = pose.current
    return useDiagramme(
      options.sansCible ? null : CLE,
      options.sansCible ? null : 'public',
      structures,
      pont,
      options.objetsConnus,
    )
  })
  return { ...rendu, vu }
}

it('liste le schéma quand personne ne le lui a donné', async () => {
  const pont = passerelle([objet('a'), objet('b')])
  const { result } = monter(pont)

  await waitFor(() => expect(result.current.tables).toHaveLength(2))
  expect(pont.listObjects).toHaveBeenCalledTimes(1)
})

it('ne liste rien quand l’arbre lui passe déjà ses objets', async () => {
  // **Les deux caches sont distincts** : `charge.objets` est celui du dépliage, `structures` celui
  // du préchauffage, et `prechaufferLeSchema` ne recopie pas le premier dans le second. Sans ce
  // passage de main, ouvrir le diagramme d'un schéma qu'on vient de déplier redemanderait la liste
  // que le dépliage a déjà payée.
  const pont = passerelle([])
  const { result } = monter(pont, { objetsConnus: [objet('a'), objet('b')] })

  await waitFor(() => expect(result.current.tables).toHaveLength(2))
  expect(pont.listObjects).not.toHaveBeenCalled()
})

it('ne demande pas la structure d’une table que le cache tient déjà', async () => {
  // Le cache est **partagé** avec le préchauffage, le panneau de détail et la vue Structure : une
  // table déjà lue ne se redemande pas, et chaque table lue ici les sert à leur tour.
  const pont = passerelle([objet('a'), objet('b')])
  const { result, vu } = monter(pont, { deja: ['a'] })

  await waitFor(() => expect(result.current.tables).toHaveLength(2))
  expect(pont.describeTable).toHaveBeenCalledTimes(1)
  expect(vu.pose).toEqual(['b'])
})

it('écarte les vues : une vue n’a pas de clé étrangère à montrer', async () => {
  const pont = passerelle([objet('a'), objet('v', 'view'), objet('f', 'function')])
  const { result } = monter(pont)

  await waitFor(() => expect(result.current.total).toBe(1))
  expect(result.current.tables.map((table) => table.name)).toEqual(['a'])
})

it('demande en entier un schéma de cent vingt-quatre tables', async () => {
  /*
   * **Le cas qui a suscité la question** — « pourquoi 60 des 124 tables ? lesquelles ne sont pas
   * affichées ? ». Le plafond valait soixante, et il retirait du dessin les soixante-quatre tables
   * les plus loin dans l'alphabet, sans les nommer. Les deux raisons qui le justifiaient avaient
   * disparu entre-temps : la lecture est douze fois plus rapide, et les trois défauts de disposition
   * qui rendaient un grand dessin illisible sont corrigés.
   */
  const pont = passerelle(
    Array.from({ length: 124 }, (_, rang) => objet(`t${String(rang).padStart(3, '0')}`)),
  )
  const { result } = monter(pont)

  await waitFor(() => expect(result.current.tables).toHaveLength(124))
  expect(result.current.total).toBe(124)
  // **Rien n'est écarté**, donc la barre d'état n'a rien à annoncer.
  expect(result.current.demandees).toBe(124)
  expect(result.current.omises).toEqual([])
})

it('nomme les tables que le plafond écarte', async () => {
  // Un compte dit qu'il manque quelque chose ; une liste dit quoi. C'est la seconde moitié de la
  // question posée, et l'écran ne savait pas y répondre.
  const trop = Array.from({ length: PLAFOND_DE_TABLES + 3 }, (_, rang) =>
    objet(`t${String(rang).padStart(4, '0')}`),
  )
  const { result } = monter(passerelle(trop))

  await waitFor(() => expect(result.current.tables).toHaveLength(PLAFOND_DE_TABLES))
  // Les trois dernières de l'alphabet, nommées et dans l'ordre.
  expect(result.current.omises).toEqual([
    `t${String(PLAFOND_DE_TABLES).padStart(4, '0')}`,
    `t${String(PLAFOND_DE_TABLES + 1).padStart(4, '0')}`,
    `t${String(PLAFOND_DE_TABLES + 2).padStart(4, '0')}`,
  ])
})

it('borne ce qu’il demande, et dit ce que le schéma compte', async () => {
  const beaucoup = Array.from({ length: PLAFOND_DE_TABLES + 12 }, (_, rang) =>
    // Numérotées pour que le tri par nom soit **reproductible** : « les soixante premières » n'a de
    // sens que dans un ordre, et celui du serveur n'en est pas un.
    objet(`t${String(rang).padStart(3, '0')}`),
  )
  const pont = passerelle(beaucoup)
  const { result } = monter(pont)

  await waitFor(() => expect(result.current.tables).toHaveLength(PLAFOND_DE_TABLES))
  // Les deux nombres, et non un seul : c'est leur écart que la barre d'état montre plutôt que de
  // laisser croire à un dessin complet.
  expect(result.current.total).toBe(PLAFOND_DE_TABLES + 12)
  expect(result.current.demandees).toBe(PLAFOND_DE_TABLES)
  expect(pont.describeTable).toHaveBeenCalledTimes(PLAFOND_DE_TABLES)
})

it('demande les tables par lots, un lot à la fois', async () => {
  /*
   * **Ce test a remplacé « lit une table à la fois ».**
   *
   * Celui-là gardait le bon fait pour la mauvaise raison : soixante lectures séparées ne saturaient
   * pas la connexion — le registre tient son verrou pendant chaque opération, donc rien ne se
   * chevauchait de toute façon — elles coûtaient soixante fois six allers-retours SQL, ce qui
   * faisait quelques minutes à travers un tunnel.
   *
   * Deux faits sont gardés ici, et l'un ne va pas sans l'autre : les tables sont demandées **par
   * lots** — sinon rien n'a changé — et les lots partent **l'un après l'autre** — sinon le verrou
   * du registre serait tenu par plusieurs demandes à la fois, et la table que l'utilisateur clique
   * pendant le dessin attendrait derrière tout le schéma.
   *
   * # Et c'est ici, non dans l'écran assemblé
   *
   * Un test de `Workbench.test.tsx` a voulu constater le même chemin ; il ne pouvait pas. Dans
   * l'écran, la cascade de préchauffage a déjà rempli le cache quand le diagramme s'ouvre, donc
   * `describeTables` n'est **pas appelée** — et c'est le bon comportement, le cache étant partagé.
   * L'assertion y était donc vide de sens. Le chemin groupé ne s'observe qu'avec un cache vide,
   * c'est-à-dire ici.
   */
  let enVol = 0
  let maximum = 0
  const lots: number[] = []
  const pont: PasserelleStructures = {
    listObjects: async () => Array.from({ length: 30 }, (_, rang) => objet(`t${rang}`)),
    describeTable: async (_cle, _schema, nom: string) => detailDe(nom),
    describeTables: async (_cle, _schema, tables) => {
      enVol += 1
      maximum = Math.max(maximum, enVol)
      lots.push(tables.length)
      await Promise.resolve()
      enVol -= 1
      return tables.map((nom) => detailDe(nom))
    },
  }
  const { result } = monter(pont)

  await waitFor(() => expect(result.current.tables).toHaveLength(30))
  // Trente tables en trois demandes de douze, douze et six — et non trente demandes.
  expect(lots).toEqual([12, 12, 6])
  expect(maximum).toBe(1)
})

it('n’envoie pas dans un lot une table que le cache tient déjà', async () => {
  // Le cache est partagé avec le préchauffage : une table qu'il a lue est déjà là. La retirer
  // **avant** de découper les lots évite qu'un lot ne soit fait que de tables connues et coûte un
  // aller-retour pour rien.
  const demandees: string[] = []
  const pont: PasserelleStructures = {
    listObjects: async () => [objet('a'), objet('b'), objet('c')],
    describeTable: async (_cle, _schema, nom: string) => detailDe(nom),
    describeTables: async (_cle, _schema, tables) => {
      demandees.push(...tables)
      return tables.map((nom) => detailDe(nom))
    },
  }
  const { result } = monter(pont, { deja: ['b'] })

  await waitFor(() => expect(result.current.tables).toHaveLength(3))
  expect(demandees).toEqual(['a', 'c'])
})

it('dit son échec, là où le préchauffage l’avale', async () => {
  // La règle n'a pas changé : on ne dérange personne pour une requête qu'il n'a pas demandée.
  // Celle-ci, il l'a demandée en ouvrant l'onglet, et une toile vide en silence se lit comme une
  // panne (défaut n° 36).
  const pont: PasserelleStructures = {
    listObjects: async () => {
      throw new Error('aucune connexion ouverte')
    },
    describeTable: async () => detailDe('a'),
    describeTables: async () => [detailDe('a')],
  }
  const { result } = monter(pont)

  await waitFor(() => expect(result.current.error).toContain('aucune connexion ouverte'))
  expect(result.current.loading).toBe(false)
})

it('s’arrête au démontage, plutôt que de continuer à interroger', async () => {
  /*
   * **Les réponses sont tenues à la main**, et c'est ce qui fait mordre ce test.
   *
   * Une version laissait le double répondre tout de suite : la boucle avait alors épuisé ses lots
   * avant même que `waitFor` ne voie le premier appel, et il ne restait rien à interrompre — vert
   * avec la garde, vert sans elle (règle n° 1). Un `setTimeout` aurait fait dépendre le verdict
   * d'une durée, donc d'un tirage au sort (règle n° 3). Une promesse qu'on résout soi-même place le
   * démontage **exactement** entre deux lots.
   */
  const reponses: Array<() => void> = []
  const describeTables = vi.fn(
    async (_cle: DatabaseKey, _schema: string, tables: readonly string[]) => {
      await new Promise<void>((resoudre) => reponses.push(resoudre))
      return tables.map((nom) => detailDe(nom))
    },
  )
  const pont: PasserelleStructures = {
    // Deux lots de douze : de quoi qu'il en reste un après le démontage.
    listObjects: async () => Array.from({ length: 24 }, (_, rang) => objet(`t${rang}`)),
    describeTable: async (_cle, _schema, nom: string) => detailDe(nom),
    describeTables,
  }
  const { unmount } = monter(pont)

  await waitFor(() => expect(describeTables).toHaveBeenCalledTimes(1))
  unmount()

  // La réponse du premier lot arrive **après** le démontage : sans le témoin, elle serait posée
  // dans le cache et la boucle enchaînerait sur le second — donc une demande de plus pour un
  // onglet que personne ne regarde plus.
  reponses[0]?.()
  for (let tour = 0; tour < 5; tour++) await Promise.resolve()
  expect(describeTables).toHaveBeenCalledTimes(1)
})

it('ne demande rien sans schéma : il n’y a pas d’onglet de diagramme ouvert', () => {
  const pont = passerelle([objet('a')])
  const { result } = monter(pont, { sansCible: true })

  expect(pont.listObjects).not.toHaveBeenCalled()
  expect(result.current).toMatchObject({ tables: [], total: 0, demandees: 0, loading: false })
})
