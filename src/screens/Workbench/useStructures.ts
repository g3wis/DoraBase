import { useCallback, useMemo, useRef, useState } from 'react'
import { describeTable, listObjects } from '../../data/commandes'
import type { DatabaseKey, SchemaInfo, TableDetail, TableSummary } from '../../domain/engine'

/**
 * Les commandes du préchauffage, **injectables** — même arbitrage qu'en `08d` et `09b` : le pont ne
 * répond pas hors de la webview, donc ce qui est testable est le câblage et l'ordonnancement.
 */
export type PasserelleStructures = {
  listObjects: typeof listObjects
  describeTable: typeof describeTable
}

export const PASSERELLE_STRUCTURES: PasserelleStructures = { listObjects, describeTable }

/**
 * Le nombre de tables préchauffées par connexion, au plus.
 *
 * **Au-delà, le préchauffage cesse d'être un service** : il devient un balayage de catalogue que
 * personne n'a demandé, sur une connexion dont l'utilisateur a besoin. 300 couvre les bases réelles
 * de ce produit avec une marge large, et borne le pire cas — un entrepôt à dix mille tables.
 */
const PLAFOND = 300

/**
 * L'identité d'une structure en cache : la connexion, le schéma, la table.
 *
 * Le même format que l'identité d'un onglet (`onglets.ts`), et pour la même raison : deux tables
 * homonymes de deux schémas, ou de deux connexions, ne doivent pas se confondre.
 */
export function cleDeStructure(cle: DatabaseKey, schema: string, table: string): string {
  return `${cle.project}/${cle.database}/${cle.environment}::${schema}.${table}`
}

/**
 * L'identité de la **liste des objets** d'un schéma en cache — un cran au-dessus de
 * `cleDeStructure`, qui identifie une table précise.
 */
export function cleDeSchema(cle: DatabaseKey, schema: string): string {
  return `${cle.project}/${cle.database}/${cle.environment}::${schema}`
}

/**
 * Ce que la file de préchauffage a à faire.
 *
 * **Deux sortes plutôt qu'une liste de tables** : au dépliage d'une connexion, on ne connaît que ses
 * schémas — leurs tables demandent un `list_objects` qui est lui-même du travail de fond. Une tâche
 * `schema` en produit donc des tâches `table`, et la file s'allonge en avançant.
 */
type Tache =
  | { sorte: 'schema'; cle: DatabaseKey; schema: string; generation: number; urgente: boolean }
  | {
      sorte: 'table'
      cle: DatabaseKey
      schema: string
      table: string
      generation: number
      urgente: boolean
    }

/** L'identité d'une connexion dans les tables internes — générations, comptes, files. */
function idDe(cle: DatabaseKey): string {
  return `${cle.project}/${cle.database}/${cle.environment}`
}

export type Structures = {
  /** La structure d'une table, si elle est déjà là. */
  detail: (cle: DatabaseKey, schema: string, table: string) => TableDetail | undefined
  /**
   * Les objets d'un schéma, si la cascade de préchauffage (ou un dépliage) les a déjà lus —
   * **n'importe quel schéma de la connexion**, pas seulement celui que l'écran affiche.
   *
   * `prechauffer` liste tous les schémas dès l'ouverture de la connexion, avant même de décrire
   * leurs tables : c'est ce qui rend l'autocomplétion d'un schéma qualifié (`sch.`) possible sans
   * que l'utilisateur l'ait déplié dans l'arbre.
   */
  objetsDuSchema: (cle: DatabaseKey, schema: string) => readonly TableSummary[] | undefined
  /** Pose ce qu'un écran a chargé lui-même : sinon la même table se redemande à chaque ouverture. */
  poser: (cle: DatabaseKey, schema: string, table: string, detail: TableDetail) => void
  /** Oublie une table — ce que « Rafraîchir » fait de la table ouverte. */
  oublier: (cle: DatabaseKey, schema: string, table: string) => void
  /** Oublie tout, et annule les files en cours : « Rafraîchir l'arborescence » (`08h`). */
  vider: () => void
  /**
   * Oublie une connexion entière, et annule sa file (`26`).
   *
   * Renommer une connexion ferme sa connexion et change sa clé : ses structures deviendraient des
   * orphelines qu'aucun écran ne lira plus — et qu'une connexion homonyme recréée plus tard lirait à
   * tort. La file en cours, elle, écrirait sous une clé disparue.
   */
  oublierLaConnexion: (cle: DatabaseKey) => void
  /** Lance la cascade sur une connexion qui vient de s'ouvrir. */
  prechauffer: (cle: DatabaseKey, schemas: readonly SchemaInfo[]) => void
  /**
   * Fait passer les tables d'un schéma **devant** le reste de la file.
   *
   * Appelé au dépliage : c'est le geste qui précède l'ouverture d'une table, donc celui qui dit ce
   * qui compte maintenant. Les objets viennent de l'arbre, qui vient de les lister.
   */
  prechaufferLeSchema: (cle: DatabaseKey, schema: string, objets: readonly TableSummary[]) => void
}

/**
 * Le cache des structures de tables, et son préchauffage.
 *
 * # Ce que ça change
 *
 * `describe_table` partait à chaque ouverture de table, y compris la deuxième fois sur la même : le
 * panneau de détail restait vide le temps de l'aller-retour. Les structures sont maintenant là avant
 * qu'on les demande, parce que la cascade part à l'ouverture de la connexion.
 *
 * # En fond veut dire : jamais devant l'utilisateur
 *
 * **Séquentiel** — une requête à la fois, pas un `Promise.all` sur trois cents tables : une rafale
 * saturerait la connexion, et c'est celle dont l'écran a besoin pour la table qu'on vient de cliquer.
 * **Non prioritaire** — un `describe_table` demandé par un écran ne passe pas par cette file, il part
 * tout de suite. **Plafonné** — voir `PLAFOND`.
 *
 * # Pourquoi un état *et* une ref
 *
 * L'état fait rendre les écrans quand une structure arrive. La ref porte la **même** table, lue par
 * la file : sans elle, chaque `describe_table` de la cascade lirait un instantané figé au montage et
 * repartirait sur des tables déjà en cache.
 */
export function useStructures(
  passerelle: PasserelleStructures = PASSERELLE_STRUCTURES,
): Structures {
  const [table, setTable] = useState<Readonly<Record<string, TableDetail>>>({})
  const courant = useRef<Readonly<Record<string, TableDetail>>>({})
  /**
   * Les objets d'un schéma, une fois listés — **tous les schémas de la connexion**, pas seulement
   * celui affiché à l'écran. `list_objects` étant déjà appelé pour chaque schéma par la cascade (pour
   * en déduire les tables à décrire), le garder ici ne coûte rien de plus et rend un schéma qualifié
   * (`sch.`) complétable sans dépliage.
   */
  const [objetsSchema, setObjetsSchema] = useState<
    Readonly<Record<string, readonly TableSummary[]>>
  >({})
  /**
   * Le numéro de génération, par connexion.
   *
   * **Trois gestes rendent une file obsolète** : fermer la connexion, la renommer (`26`), vider le
   * cache. La file compare son numéro avant chaque écriture et se tait s'il a bougé — sans quoi un
   * préchauffage lancé avant un renommage viendrait poser des structures sous une clé disparue.
   */
  const generations = useRef<Map<string, number>>(new Map())

  /**
   * Deux files, **un seul worker**.
   *
   * Le worker sert `urgentes` avant `fond`, et c'est ce qui fait passer un schéma déplié devant une
   * cascade en cours. Une file unique avec insertion en tête ne suffisait pas : quand un
   * `list_objects` de fond répond, ses tables doivent aller devant le reste du fond mais **derrière**
   * les urgentes — un seul index ne peut pas exprimer les deux, et la première version servait donc
   * `archives` avant le schéma que l'utilisateur venait d'ouvrir.
   *
   * Deux files et un worker, pas deux workers : la règle « une requête à la fois » tient au worker
   * unique, et c'est elle qui protège la connexion dont l'écran a besoin.
   */
  const urgentes = useRef<Tache[]>([])
  const fond = useRef<Tache[]>([])
  /** Le worker tourne-t-il ? Un seul à la fois, sinon la file est servie en parallèle. */
  const enMarche = useRef(false)
  /** Le compte de structures lues, par connexion : c'est lui que le plafond borne. */
  const faites = useRef<Map<string, number>>(new Map())
  /** Les schémas déjà listés, pour ne pas payer deux fois le même `list_objects`. */
  const listes = useRef<Set<string>>(new Set())

  const ecrire = useCallback((suivant: Readonly<Record<string, TableDetail>>) => {
    courant.current = suivant
    setTable(suivant)
  }, [])

  /**
   * Le worker : dépile et exécute, une tâche à la fois, jusqu'à ce que la file soit vide.
   *
   * **Réentrant sans risque** : `enMarche` fait que le second appel rend la main immédiatement, et
   * les tâches poussées entre-temps seront servies par la boucle déjà en cours. C'est ce qui permet à
   * `prechaufferLeSchema` d'être appelé pendant que la cascade tourne.
   *
   * **Un échec est silencieux** : personne n'a rien demandé, et une structure qui résiste sera lue à
   * l'ouverture de sa table, où l'erreur a un endroit pour s'afficher.
   */
  const travailler = useCallback(() => {
    if (enMarche.current) return
    enMarche.current = true

    void (async () => {
      try {
        for (;;) {
          // Les urgentes d'abord, toujours : c'est là toute la priorité.
          const tache = urgentes.current.shift() ?? fond.current.shift()
          if (!tache) return

          const id = idDe(tache.cle)
          // Périmée : la connexion a été fermée, renommée, ou le cache vidé depuis.
          if (generations.current.get(id) !== tache.generation) continue

          if (tache.sorte === 'schema') {
            const nom = `${id}::${tache.schema}`
            if (listes.current.has(nom)) continue
            listes.current.add(nom)
            let objets: readonly TableSummary[]
            try {
              objets = await passerelle.listObjects(tache.cle, tache.schema)
            } catch {
              continue
            }
            if (generations.current.get(id) !== tache.generation) continue
            setObjetsSchema((precedent) => ({
              ...precedent,
              [cleDeSchema(tache.cle, tache.schema)]: objets,
            }))
            // **En tête de sa propre file**, et non à la queue : on finit le schéma courant avant
            // de lister le suivant, sinon les structures n'arriveraient qu'après tous les
            // `list_objects` de la base. En tête du *fond* si la tâche venait du fond — sans quoi
            // elles passeraient devant un schéma déplié entre-temps.
            const destination = tache.urgente ? urgentes : fond
            destination.current.unshift(
              ...objets
                .filter((objet) => objet.kind === 'table')
                .map((objet) => ({
                  sorte: 'table' as const,
                  cle: tache.cle,
                  schema: tache.schema,
                  table: objet.name,
                  generation: tache.generation,
                  urgente: tache.urgente,
                })),
            )
            continue
          }

          if ((faites.current.get(id) ?? 0) >= PLAFOND) continue
          if (courant.current[cleDeStructure(tache.cle, tache.schema, tache.table)]) continue

          try {
            const lu = await passerelle.describeTable(tache.cle, tache.schema, tache.table)
            if (generations.current.get(id) !== tache.generation) continue
            ecrire({
              ...courant.current,
              [cleDeStructure(tache.cle, tache.schema, tache.table)]: lu,
            })
            faites.current.set(id, (faites.current.get(id) ?? 0) + 1)
          } catch {
            // Voir la note du composant : silencieux, par construction.
          }
        }
      } finally {
        enMarche.current = false
      }
    })()
  }, [passerelle, ecrire])

  const detail = useCallback(
    (cle: DatabaseKey, schema: string, nom: string) => table[cleDeStructure(cle, schema, nom)],
    [table],
  )

  const objetsDuSchema = useCallback(
    (cle: DatabaseKey, schema: string) => objetsSchema[cleDeSchema(cle, schema)],
    [objetsSchema],
  )

  const poser = useCallback(
    (cle: DatabaseKey, schema: string, nom: string, valeur: TableDetail) => {
      ecrire({ ...courant.current, [cleDeStructure(cle, schema, nom)]: valeur })
    },
    [ecrire],
  )

  const oublier = useCallback(
    (cle: DatabaseKey, schema: string, nom: string) => {
      const { [cleDeStructure(cle, schema, nom)]: _oubliee, ...reste } = courant.current
      ecrire(reste)
    },
    [ecrire],
  )

  const vider = useCallback(() => {
    // Les générations montent **avant** de vider : une file qui rendrait la main entre les deux
    // reposerait ce qu'on vient d'effacer.
    for (const [id, numero] of generations.current) generations.current.set(id, numero + 1)
    ecrire({})
    setObjetsSchema({})
  }, [ecrire])

  const oublierLaConnexion = useCallback(
    (cle: DatabaseKey) => {
      const id = `${cle.project}/${cle.database}/${cle.environment}`
      generations.current.set(id, (generations.current.get(id) ?? 0) + 1)
      const prefixe = `${id}::`
      const reste = Object.fromEntries(
        Object.entries(courant.current).filter(([nom]) => !nom.startsWith(prefixe)),
      )
      ecrire(reste)
      setObjetsSchema((precedent) =>
        Object.fromEntries(Object.entries(precedent).filter(([nom]) => !nom.startsWith(prefixe))),
      )
    },
    [ecrire],
  )

  /**
   * Met en file le préchauffage d'une connexion entière, **en fond**.
   *
   * Relancer sur une connexion déjà préchauffée annule la file précédente : rouvrir une connexion
   * doit repartir de zéro, pas doubler le trafic.
   */
  const prechauffer = useCallback(
    (cle: DatabaseKey, schemas: readonly SchemaInfo[]) => {
      const id = idDe(cle)
      const generation = (generations.current.get(id) ?? 0) + 1
      generations.current.set(id, generation)
      // Une nouvelle génération périme tout ce qui attendait pour cette connexion : le worker le
      // verra en dépilant, mais autant ne pas garder la file longue pour rien.
      urgentes.current = urgentes.current.filter((tache) => idDe(tache.cle) !== id)
      fond.current = fond.current.filter((tache) => idDe(tache.cle) !== id)
      listes.current = new Set([...listes.current].filter((nom) => !nom.startsWith(`${id}::`)))
      faites.current.set(id, 0)

      fond.current.push(
        ...schemas.map((schema) => ({
          sorte: 'schema' as const,
          cle,
          schema: schema.name,
          generation,
          urgente: false,
        })),
      )
      travailler()
    },
    [travailler],
  )

  /**
   * Met le schéma **déplié** en tête de file.
   *
   * # Pourquoi une priorité, et pas seulement un second déclencheur
   *
   * La cascade d'ouverture peut avoir trois cents tables devant elle : un schéma déplié à la
   * onzième seconde attendrait derrière des schémas que personne ne regarde. Le dépliage est le
   * geste qui précède immédiatement l'ouverture d'une table — c'est donc lui qui dit ce qui compte
   * *maintenant*, et ses tables passent devant.
   *
   * Les objets sont **fournis** par l'arbre, qui vient de les lister pour les afficher : les
   * redemander doublerait la requête que le dépliage a déjà payée.
   */
  const prechaufferLeSchema = useCallback(
    (cle: DatabaseKey, schema: string, objets: readonly TableSummary[]) => {
      const id = idDe(cle)
      // **La génération est *posée* si elle manque**, et ce n'est pas une précaution : le worker
      // compare `get(id)` au numéro de la tâche, et `undefined !== 0` jetait tout. Une connexion
      // dépliée sans cascade préalable — un écran qui ne branche pas `prechauffer`, un dépliage
      // arrivé avant elle — ne préchauffait alors rien, en silence. Trouvé par un test.
      const generation = generations.current.get(id) ?? 0
      generations.current.set(id, generation)
      // Le schéma est listé : la tâche de fond qui l'aurait relisté n'a plus lieu d'être.
      listes.current.add(`${id}::${schema}`)
      const inutile = (tache: Tache) =>
        tache.sorte === 'schema' && idDe(tache.cle) === id && tache.schema === schema
      urgentes.current = urgentes.current.filter((tache) => !inutile(tache))
      fond.current = fond.current.filter((tache) => !inutile(tache))

      urgentes.current.unshift(
        ...objets
          .filter((objet) => objet.kind === 'table')
          .map((objet) => ({
            sorte: 'table' as const,
            cle,
            schema,
            table: objet.name,
            generation,
            urgente: true,
          })),
      )
      travailler()
    },
    [travailler],
  )

  return useMemo(
    () => ({
      detail,
      objetsDuSchema,
      poser,
      oublier,
      vider,
      oublierLaConnexion,
      prechauffer,
      prechaufferLeSchema,
    }),
    [
      detail,
      objetsDuSchema,
      poser,
      oublier,
      vider,
      oublierLaConnexion,
      prechauffer,
      prechaufferLeSchema,
    ],
  )
}
