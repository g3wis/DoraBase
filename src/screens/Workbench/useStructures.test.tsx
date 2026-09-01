import { act, render } from '@testing-library/react'
import type { DatabaseKey, SchemaInfo, TableDetail, TableSummary } from '../../domain/engine'
import {
  cleDeStructure,
  type PasserelleStructures,
  type Structures,
  useStructures,
} from './useStructures'

const CLE: DatabaseKey = { project: 'Atelier Nord', database: 'analytics', environment: 'prod' }

const schema = (name: string): SchemaInfo => ({
  name,
  counts: { tables: 2, views: 0, functions: 0, indexes: 0 },
})

const objet = (name: string, kind: TableSummary['kind'] = 'table'): TableSummary => ({
  name,
  kind,
  rows: { kind: 'exact', value: 12 },
  sizeBytes: 4096,
  columnCount: 3,
  primaryKey: 'id',
  lastAnalyze: null,
  comment: null,
})

const detail = (table: string): TableDetail => ({
  schema: 'atelier',
  name: table,
  rows: { kind: 'exact', value: 12 },
  sizeBytes: 4096,
  comment: null,
  columns: [],
  indexes: [],
  constraints: [],
  triggers: [],
  relations: [],
  ddl: `create table ${table}()`,
})

/**
 * Le hook monté dans un composant jetable : les hooks ne s'appellent pas hors rendu, et
 * `@testing-library/react-hooks` n'est pas une dépendance de ce dépôt.
 */
function monter(passerelle: PasserelleStructures) {
  const vu: { courant: Structures | null } = { courant: null }
  function Sonde() {
    vu.courant = useStructures(passerelle)
    return null
  }
  render(<Sonde />)
  // Non nul dès le premier rendu ; l'assertion est là pour le typage, pas pour le doute.
  return vu as { courant: Structures }
}

/** Une passerelle qui compte ses appels et rend de quoi préchauffer. */
function passerelleDe(
  objets: Readonly<Record<string, readonly TableSummary[]>>,
  surDescribe?: (table: string) => Promise<TableDetail>,
) {
  const appels: string[] = []
  return {
    appels,
    passerelle: {
      listObjects: async (_cle: DatabaseKey, nom: string) => {
        appels.push(`list:${nom}`)
        return [...(objets[nom] ?? [])]
      },
      describeTable: async (_cle: DatabaseKey, nom: string, table: string) => {
        appels.push(`describe:${nom}.${table}`)
        return surDescribe ? surDescribe(table) : detail(table)
      },
    } satisfies PasserelleStructures,
  }
}

test('le préchauffage descend la cascade : les schémas, leurs objets, puis les structures', async () => {
  const { appels, passerelle } = passerelleDe({
    atelier: [objet('commandes'), objet('paliers')],
    archives: [objet('journal')],
  })
  const vu = monter(passerelle)

  await act(async () => {
    vu.courant.prechauffer(CLE, [schema('atelier'), schema('archives')])
  })

  expect(appels).toEqual([
    'list:atelier',
    'describe:atelier.commandes',
    'describe:atelier.paliers',
    'list:archives',
    'describe:archives.journal',
  ])
  // Et le cache porte ce qui a été lu : c'est tout l'objet de la cascade.
  expect(vu.courant.detail(CLE, 'atelier', 'commandes')?.name).toBe('commandes')
  expect(vu.courant.detail(CLE, 'archives', 'journal')?.name).toBe('journal')
  // La liste des objets de chaque schéma est gardée aussi — `list_objects` la lit déjà pour savoir
  // quelles tables décrire, et c'est ce qui rend un schéma qualifié (`sch.`) complétable sans que
  // l'utilisateur ait déplié `archives` dans l'arbre.
  expect(vu.courant.objetsDuSchema(CLE, 'atelier')?.map((o) => o.name)).toEqual([
    'commandes',
    'paliers',
  ])
  expect(vu.courant.objetsDuSchema(CLE, 'archives')?.map((o) => o.name)).toEqual(['journal'])
})

test('un schéma jamais déplié n’a pas d’objets tant que la cascade ne l’a pas atteint', async () => {
  const { passerelle } = passerelleDe({ atelier: [objet('commandes')] })
  const vu = monter(passerelle)
  expect(vu.courant.objetsDuSchema(CLE, 'atelier')).toBeUndefined()

  await act(async () => {
    vu.courant.prechauffer(CLE, [schema('atelier')])
  })
  expect(vu.courant.objetsDuSchema(CLE, 'atelier')).toBeDefined()
})

test('vider oublie aussi les objets par schéma', async () => {
  const { passerelle } = passerelleDe({ atelier: [objet('commandes')] })
  const vu = monter(passerelle)
  await act(async () => {
    vu.courant.prechauffer(CLE, [schema('atelier')])
  })
  expect(vu.courant.objetsDuSchema(CLE, 'atelier')).toBeDefined()

  act(() => {
    vu.courant.vider()
  })
  expect(vu.courant.objetsDuSchema(CLE, 'atelier')).toBeUndefined()
})

test('oublier une connexion emporte les objets de ses schémas, et pas ceux de sa voisine', async () => {
  const dev: DatabaseKey = { ...CLE, environment: 'dev' }
  const { passerelle } = passerelleDe({ atelier: [objet('commandes')] })
  const vu = monter(passerelle)

  await act(async () => {
    vu.courant.prechauffer(CLE, [schema('atelier')])
    vu.courant.prechauffer(dev, [schema('atelier')])
  })

  act(() => {
    vu.courant.oublierLaConnexion(CLE)
  })
  expect(vu.courant.objetsDuSchema(CLE, 'atelier')).toBeUndefined()
  expect(vu.courant.objetsDuSchema(dev, 'atelier')).toBeDefined()
})

test('les objets qui ne sont pas des tables ne sont pas décrits', async () => {
  const { appels, passerelle } = passerelleDe({
    atelier: [objet('resume', 'view'), objet('commandes')],
  })
  const vu = monter(passerelle)
  await act(async () => {
    vu.courant.prechauffer(CLE, [schema('atelier')])
  })

  // `describe_table` décrit une table ; ce qu'une vue a à montrer relève de `14`.
  expect(appels).toEqual(['list:atelier', 'describe:atelier.commandes'])
})

test('une requête à la fois : la file n’émet jamais deux describe en parallèle', async () => {
  let enVol = 0
  let maximum = 0
  const { passerelle } = passerelleDe(
    { atelier: [objet('a'), objet('b'), objet('c')] },
    async (t) => {
      enVol += 1
      maximum = Math.max(maximum, enVol)
      await Promise.resolve()
      enVol -= 1
      return detail(t)
    },
  )
  const vu = monter(passerelle)

  await act(async () => {
    vu.courant.prechauffer(CLE, [schema('atelier')])
  })

  // **Séquentiel, et c'est la règle** : une rafale saturerait la connexion dont l'écran a besoin
  // pour la table qu'on vient de cliquer.
  expect(maximum).toBe(1)
})

test('le plafond arrête la file', async () => {
  const tables = Array.from({ length: 305 }, (_, i) => objet(`t${i}`))
  const { appels, passerelle } = passerelleDe({ atelier: tables })
  const vu = monter(passerelle)

  await act(async () => {
    vu.courant.prechauffer(CLE, [schema('atelier')])
  })

  // 300 structures, plus le `list_objects` : au-delà, le préchauffage deviendrait un balayage de
  // catalogue que personne n'a demandé.
  expect(appels.filter((appel) => appel.startsWith('describe:'))).toHaveLength(300)
})

test('vider annule la file en cours : rien n’est écrit après coup', async () => {
  let laisserPasser: (() => void) | null = null
  const { passerelle } = passerelleDe({ atelier: [objet('a'), objet('b')] }, async (t) => {
    await new Promise<void>((resoudre) => {
      laisserPasser = resoudre
    })
    return detail(t)
  })
  const vu = monter(passerelle)

  await act(async () => {
    vu.courant.prechauffer(CLE, [schema('atelier')])
  })
  await act(async () => {
    vu.courant.vider()
    laisserPasser?.()
  })

  // La génération a changé pendant l'attente : la réponse arrive dans le vide. Sans cela, un
  // préchauffage lancé avant un renommage (`26`) reposerait des structures sous une clé disparue.
  expect(vu.courant.detail(CLE, 'atelier', 'a')).toBeUndefined()
})

test('ce qui est déjà en cache n’est pas redemandé', async () => {
  const { appels, passerelle } = passerelleDe({ atelier: [objet('commandes'), objet('paliers')] })
  const vu = monter(passerelle)

  act(() => {
    vu.courant.poser(CLE, 'atelier', 'commandes', detail('commandes'))
  })
  await act(async () => {
    vu.courant.prechauffer(CLE, [schema('atelier')])
  })

  expect(appels).toEqual(['list:atelier', 'describe:atelier.paliers'])
})

test('un schéma illisible n’arrête pas les suivants, et ne remonte rien', async () => {
  const appels: string[] = []
  const passerelle: PasserelleStructures = {
    listObjects: async (_cle, nom) => {
      appels.push(`list:${nom}`)
      if (nom === 'atelier') throw new Error('permission refusée')
      return [objet('journal')]
    },
    describeTable: async (_cle, nom, table) => {
      appels.push(`describe:${nom}.${table}`)
      return detail(table)
    },
  }
  const vu = monter(passerelle)

  await act(async () => {
    vu.courant.prechauffer(CLE, [schema('atelier'), schema('archives')])
  })

  // Personne n'a rien demandé : l'échec est silencieux, et le schéma suivant est servi quand même.
  expect(appels).toEqual(['list:atelier', 'list:archives', 'describe:archives.journal'])
  expect(vu.courant.detail(CLE, 'archives', 'journal')).toBeDefined()
})

test('oublier retire une seule table, et laisse ses voisines', async () => {
  const { passerelle } = passerelleDe({ atelier: [objet('commandes'), objet('paliers')] })
  const vu = monter(passerelle)
  await act(async () => {
    vu.courant.prechauffer(CLE, [schema('atelier')])
  })

  act(() => {
    vu.courant.oublier(CLE, 'atelier', 'commandes')
  })
  expect(vu.courant.detail(CLE, 'atelier', 'commandes')).toBeUndefined()
  expect(vu.courant.detail(CLE, 'atelier', 'paliers')).toBeDefined()
})

test('deux connexions homonymes ne partagent pas leurs structures', () => {
  const dev: DatabaseKey = { ...CLE, environment: 'dev' }
  // L'identité porte l'environnement (`23b`) : sans lui, la structure de `dev` s'afficherait pour
  // `prod`, sur un serveur qui n'est pas le même.
  expect(cleDeStructure(CLE, 'atelier', 'commandes')).not.toBe(
    cleDeStructure(dev, 'atelier', 'commandes'),
  )
})

test('oublier une connexion emporte ses structures, et pas celles de sa voisine', async () => {
  const dev: DatabaseKey = { ...CLE, environment: 'dev' }
  const { passerelle } = passerelleDe({ atelier: [objet('commandes')] })
  const vu = monter(passerelle)

  await act(async () => {
    vu.courant.prechauffer(CLE, [schema('atelier')])
    vu.courant.prechauffer(dev, [schema('atelier')])
  })
  expect(vu.courant.detail(CLE, 'atelier', 'commandes')).toBeDefined()
  expect(vu.courant.detail(dev, 'atelier', 'commandes')).toBeDefined()

  act(() => {
    vu.courant.oublierLaConnexion(CLE)
  })

  // Renommer une connexion (`26`) ferme la sienne : ses structures ne seront plus lues, et une
  // connexion homonyme recréée plus tard lirait la structure d'une autre base.
  expect(vu.courant.detail(CLE, 'atelier', 'commandes')).toBeUndefined()
  // L'homonyme de dev est une **autre** connexion (`23b`) : elle garde les siennes.
  expect(vu.courant.detail(dev, 'atelier', 'commandes')).toBeDefined()
})

describe('la priorité du schéma déplié', () => {
  /** Une passerelle dont chaque réponse attend d'être libérée, une par une. */
  function passerelleAuRalenti(objets: Readonly<Record<string, readonly TableSummary[]>>) {
    const appels: string[] = []
    const attentes: (() => void)[] = []
    const bloquer = () =>
      new Promise<void>((resoudre) => {
        attentes.push(resoudre)
      })
    return {
      appels,
      /** Libère la réponse en cours et laisse le worker avancer d'un cran. */
      async avancer() {
        const suivant = attentes.shift()
        suivant?.()
        // Deux tours de microtâches : l'un pour la réponse, l'autre pour le tour de boucle suivant.
        await Promise.resolve()
        await Promise.resolve()
      },
      passerelle: {
        listObjects: async (_cle: DatabaseKey, nom: string) => {
          appels.push(`list:${nom}`)
          await bloquer()
          return [...(objets[nom] ?? [])]
        },
        describeTable: async (_cle: DatabaseKey, nom: string, table: string) => {
          appels.push(`describe:${nom}.${table}`)
          await bloquer()
          return detail(table)
        },
      } satisfies PasserelleStructures,
    }
  }

  test('le schéma déplié passe devant la cascade en cours', async () => {
    const { appels, avancer, passerelle } = passerelleAuRalenti({
      archives: [objet('journal'), objet('vieux')],
      atelier: [objet('commandes')],
    })
    const vu = monter(passerelle)

    // La cascade part sur `archives` d'abord — l'ordre de `list_schemas`.
    await act(async () => {
      vu.courant.prechauffer(CLE, [schema('archives'), schema('atelier')])
    })
    expect(appels).toEqual(['list:archives'])

    // Pendant que `list_objects` d'`archives` est en vol, on déplie `atelier`.
    await act(async () => {
      vu.courant.prechaufferLeSchema(CLE, 'atelier', [objet('commandes')])
    })
    // Le worker est occupé : rien n'a bougé, et c'est la règle « une requête à la fois ».
    expect(appels).toEqual(['list:archives'])

    await act(async () => {
      await avancer()
    })

    // **La table du schéma déplié est servie avant celles d'`archives`**, dont les tâches viennent
    // d'être empilées par le `list_objects` qui vient de répondre.
    expect(appels).toEqual(['list:archives', 'describe:atelier.commandes'])
  })

  test('le dépliage fournit les objets : le préchauffage n’en redemande pas', async () => {
    const { appels, passerelle } = passerelleDe({ atelier: [objet('commandes')] })
    const vu = monter(passerelle)

    await act(async () => {
      // Les objets viennent de l'arbre, qui vient de les lister pour les afficher.
      vu.courant.prechaufferLeSchema(CLE, 'atelier', [objet('commandes')])
    })

    // Aucun `list_objects` : le dépliage a déjà payé cette requête.
    expect(appels).toEqual(['describe:atelier.commandes'])
  })

  test('un schéma déplié n’est pas relisté par la cascade', async () => {
    const { appels, passerelle } = passerelleDe({
      atelier: [objet('commandes')],
      archives: [objet('journal')],
    })
    const vu = monter(passerelle)

    await act(async () => {
      vu.courant.prechauffer(CLE, [schema('atelier'), schema('archives')])
    })
    await act(async () => {
      vu.courant.prechaufferLeSchema(CLE, 'atelier', [objet('commandes')])
    })

    // `atelier` est listé **une fois** — par la cascade ou par le dépliage, jamais les deux. La
    // cascade démarre de façon synchrone, donc l'ordre exact dépend du moment du dépliage ; ce qui
    // est garanti, c'est qu'aucun schéma n'est listé deux fois.
    expect(appels.filter((appel) => appel === 'list:atelier')).toHaveLength(1)
    expect(appels.filter((appel) => appel === 'describe:atelier.commandes')).toHaveLength(1)
  })

  test('un schéma déplié deux fois ne redemande rien', async () => {
    const { appels, passerelle } = passerelleDe({ atelier: [objet('commandes')] })
    const vu = monter(passerelle)

    await act(async () => {
      vu.courant.prechaufferLeSchema(CLE, 'atelier', [objet('commandes')])
    })
    await act(async () => {
      vu.courant.prechaufferLeSchema(CLE, 'atelier', [objet('commandes')])
    })

    // La seconde fois, la structure est en cache : la tâche est dépilée sans requête.
    expect(appels).toEqual(['describe:atelier.commandes'])
  })
})
