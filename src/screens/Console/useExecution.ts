import { useCallback, useState } from 'react'
import { runSql } from '../../data/commandes'
import type { DatabaseKey } from '../../domain/arbre'
import type { Engine } from '../../domain/config'
import type { QueryResult, RowLimit, TransactionMode } from '../../domain/engine'
import type { VueResultat } from './ConsoleResult'
import { decoupeLesSuites, decouper } from './instructions'
import { demandeConfirmation, type Nature, natureDe, sansRestriction } from './nature'

/** Ce qui appelle la commande. Injectable : le pont ne répond pas hors de la webview. */
export type PasserelleExecution = {
  runSql: (
    key: DatabaseKey,
    sql: string,
    limit: RowLimit,
    mode: TransactionMode,
    console: string,
  ) => Promise<QueryResult>
}

export const PASSERELLE_EXECUTION: PasserelleExecution = { runSql }

/** La limite par défaut de la console, celle du mockup. */
export const LIMITE_CONSOLE: RowLimit = 'oneThousand'

/**
 * Où en est une instruction d'une suite (#156).
 *
 * **« Non exécutée » n'est pas « en attente »** : la première dit que la suite s'est arrêtée avant
 * elle, sur un échec, et qu'elle ne partira pas ; la seconde qu'elle va partir. Les confondre ferait
 * lire une suite interrompue comme une suite encore en cours.
 */
export type StatutEtape = 'attente' | 'enCours' | 'ok' | 'erreur' | 'nonExecutee'

/** Une instruction d'une suite, et sa réponse. */
export type Etape = {
  sql: string
  statut: StatutEtape
  resultat: QueryResult | null
  erreur: string | null
}

/** Ce qui attend la confirmation : la suite entière, et le récapitulatif de ses écritures. */
type AConfirmer = {
  /** Les instructions qui partiront, dans l'ordre — une seule quand le texte n'en porte qu'une. */
  suite: readonly string[]
  /** La plus coûteuse des natures de la suite : la structure l'emporte sur l'écriture. */
  nature: Nature
  /** Vrai quand **une** des écritures n'a pas de `where`. */
  sansWhere: boolean
  /** Les verbes des instructions à confirmer, dans l'ordre — « UPDATE, DELETE ». */
  ecritures: readonly string[]
}

/** Ce qu'une console garde de sa dernière exécution. */
type EtatConsole = {
  aConfirmer: AConfirmer | null
  enCours: boolean
  /** Les instructions de la dernière exécution, une seule le plus souvent. */
  etapes: readonly Etape[]
  /** L'onglet de réponse regardé. */
  choisie: number
  /**
   * Vrai tant que l'onglet regardé **suit** la progression de la suite. Choisir un onglet à la main
   * l'éteint : la réponse qu'on lit ne doit pas changer sous les yeux parce qu'une instruction
   * suivante vient de finir.
   */
  suivre: boolean
  vue: VueResultat
}

/** Une console qui n'a rien exécuté. */
const AU_REPOS: EtatConsole = {
  aConfirmer: null,
  enCours: false,
  etapes: [],
  choisie: 0,
  suivre: true,
  vue: 'resultat',
}

export type Execution = {
  /** Demande l'exécution — passe par la confirmation si la requête écrit. */
  demander: (sql: string) => void
  /** Exécute pour de bon. Appelé par la confirmation, ou directement pour une lecture. */
  executer: () => void
  annulerLaConfirmation: () => void
  /** La requête en attente de confirmation, s'il y en a une. */
  aConfirmer: EtatConsole['aConfirmer']
  enCours: boolean
  /** La réponse de l'onglet regardé. */
  resultat: QueryResult | null
  erreur: string | null
  /** Les instructions de la dernière exécution (#156) — un onglet chacune dès qu'il y en a deux. */
  etapes: readonly Etape[]
  choisie: number
  /** Regarde la réponse d'une autre instruction de la suite. */
  choisir: (index: number) => void
  vue: VueResultat
  setVue: (vue: VueResultat) => void
  /**
   * Fait suivre un changement d'identité d'onglet — un renommage, un brouillon baptisé.
   *
   * **C'est la quatrième table indexée par identité d'onglet**, après le texte, les modifications en
   * attente et le mode édition : l'identité d'une console dérive de son nom et de celui de sa
   * connexion (voir `idOnglet`), donc renommer l'une ou l'autre laisserait le résultat sous une clé
   * que plus personne ne lit — la grille se viderait sur un renommage.
   */
  reindexer: (nouvelId: (id: string) => string) => void
  /**
   * Pose un résultat dans la grille sans rien exécuter (`API-38`).
   *
   * C'est par là que le panneau de transaction remet la réponse d'une instruction précédente :
   * **rien n'est rejoué** — une requête de console n'est pas forcément idempotente, et c'est la
   * raison qui interdit déjà de la relancer sur un geste de colonne. Les lignes viennent du cœur,
   * qui les a gardées.
   */
  poserLeResultat: (resultat: QueryResult) => void
}

/**
 * L'exécution d'une requête de console (`12c`).
 *
 * **Le résultat appartient à la console qui l'a demandé**, pas à l'écran. Un état unique le faisait
 * partager par toutes : basculer d'onglet montrait la grille de la console voisine sous le texte de
 * celle-ci — deux requêtes différentes, un seul résultat, et rien pour dire laquelle on regardait.
 * L'état est donc indexé par identité d'onglet, comme le texte de `12a` et les modifications en
 * attente de `11b`, et `idConsole` désigne celle qu'on regarde.
 *
 * Corollaire, et c'est ce qui décide de l'indexation plutôt que d'un remontage : **l'onglet qui a
 * lancé la requête reçoit sa réponse même s'il n'est plus actif**. `lancer` capture l'identité au
 * départ ; une requête lente déposée pendant qu'on lit ailleurs se retrouve à sa place au retour,
 * au lieu d'atterrir sur la console qu'on regarde ou d'être perdue.
 *
 * **La confirmation dépend de ce que la requête fait, pas de l'environnement.** `11d` confirme sur la
 * production parce qu'il écrit toujours la même chose ; ici, c'est l'inverse — un `drop` sur une base
 * de développement mérite d'être confirmé, et un `select` en production non.
 */
export function useExecution(
  cle: DatabaseKey | null,
  passerelle: PasserelleExecution,
  idConsole: string | null,
  /**
   * Le régime de transaction de la connexion (`API-38`).
   *
   * **Passé à chaque exécution plutôt que retenu ici** : il appartient à la connexion, pas à la
   * console, et c'est `useTransaction` qui le tient — deux tables du même réglage divergeraient.
   */
  mode: TransactionMode = 'auto',
  /**
   * Le jeton d'origine de cette console, celui que le cœur inscrit à côté de l'instruction
   * (`API-38`).
   *
   * **Opaque, et tenu par `useTransaction`** : c'est lui qui le mint et le déplace sur un
   * renommage. Il ne sert qu'à une chose — que chaque console retrouve ses propres instructions
   * dans son panneau. Vide hors d'une console, où `lancer` ne part pas.
   */
  jeton = '',
  /**
   * Appelé après chaque exécution, réussie ou non.
   *
   * C'est par là que le journal de la transaction est relu : une instruction refusée y entre aussi,
   * et le panneau doit la montrer — sur PostgreSQL c'est même elle qu'on cherche, la transaction
   * étant abandonnée jusqu'à son annulation.
   */
  apresExecution?: (console: { cle: DatabaseKey; id: string }) => void,
  /**
   * Le moteur de la connexion, qui décide si le texte se découpe en instructions et comment
   * (`instructions.ts`, #156). Absent, rien n'est découpé : le texte part tel quel, comme avant.
   */
  moteur?: Engine,
): Execution {
  const [parConsole, setParConsole] = useState<Readonly<Record<string, EtatConsole>>>({})
  const etat = (idConsole === null ? undefined : parConsole[idConsole]) ?? AU_REPOS

  const poser = useCallback((id: string, suite: (precedent: EtatConsole) => EtatConsole) => {
    setParConsole((precedent) => ({ ...precedent, [id]: suite(precedent[id] ?? AU_REPOS) }))
  }, [])

  const lancer = useCallback(
    (suite: readonly string[]) => {
      if (cle === null || idConsole === null || suite.length === 0) return
      // **L'identité est capturée ici**, et non relue à la réponse : la requête peut revenir alors
      // qu'un autre onglet est actif, et son résultat appartient à la console qui l'a demandée.
      const id = idConsole
      // La clé est capturée comme l'identité, et pour la même raison : `apresExecution` relit le
      // journal de la connexion qui a exécuté, non de celle que l'arbre montre au retour — et il
      // porte **les deux**, le régime étant réglé par console (`API-38`).
      const console = { cle, id }
      poser(id, (precedent) => ({
        ...precedent,
        enCours: true,
        aConfirmer: null,
        etapes: suite.map((sql) => ({ sql, statut: 'attente', resultat: null, erreur: null })),
        choisie: 0,
        suivre: true,
      }))

      const poserLEtape = (index: number, etape: Partial<Etape>, fin = false) =>
        poser(id, (precedent) => ({
          ...precedent,
          enCours: !fin,
          etapes: precedent.etapes.map((e, i) => (i === index ? { ...e, ...etape } : e)),
          choisie: precedent.suivre ? index : precedent.choisie,
        }))

      // **Une par une, et chacune attend la précédente** (#156) : la seconde instruction peut lire ce
      // que la première a écrit, et c'est l'ordre du texte qui le décide. En transaction manuelle,
      // chacune entre ainsi séparément dans le journal — le cœur n'a rien eu à apprendre.
      const executer = async () => {
        for (const [index, instruction] of suite.entries()) {
          poserLEtape(index, { statut: 'enCours' })
          const derniere = index === suite.length - 1
          try {
            const resultat = await passerelle.runSql(cle, instruction, LIMITE_CONSOLE, mode, jeton)
            poserLEtape(index, { statut: 'ok', resultat }, derniere)
          } catch (raison) {
            // **Arrêt à la première erreur**, en automatique comme en manuel : la suite a été écrite
            // en supposant que ce qui précède a réussi, et PostgreSQL refuserait de toute façon tout
            // ce qui suit dans une transaction abandonnée. Ce qui ne part pas le **dit**.
            poser(id, (precedent) => ({
              ...precedent,
              enCours: false,
              etapes: precedent.etapes.map((e, i) =>
                i === index
                  ? { ...e, statut: 'erreur', erreur: messageDe(raison) }
                  : i > index
                    ? { ...e, statut: 'nonExecutee' }
                    : e,
              ),
              // L'échec se montre, même si l'on regardait un onglet précédent : c'est lui qui dit
              // pourquoi la suite s'est arrêtée.
              choisie: index,
            }))
            return
          }
        }
      }
      // **Dans les deux cas** : un refus fait partie de la transaction, et c'est la seule chose
      // que le panneau ait à montrer quand la suite sera refusée jusqu'à l'annulation.
      void executer().finally(() => apresExecution?.(console))
    },
    [cle, idConsole, passerelle, poser, mode, jeton, apresExecution],
  )

  const demander = useCallback(
    (sql: string) => {
      if (idConsole === null || sql.trim() === '') return
      // **Un texte à une seule instruction part tel qu'il est écrit**, point-virgule compris : c'est
      // le chemin d'avant le découpage, et rien n'y change pour qui n'écrit qu'une requête.
      const coupees = decoupeLesSuites(moteur) ? decouper(sql, moteur) : []
      const suite = coupees.length > 1 ? coupees.map((instruction) => instruction.sql) : [sql]

      const aConfirmer = suite
        .map((instruction) => ({ instruction, nature: natureDe(instruction) }))
        .filter(
          ({ nature }) => demandeConfirmation(nature) && !dispenseeParLaTransaction(nature, mode),
        )
      const premiere = aConfirmer[0]
      if (premiere !== undefined) {
        const structure = aConfirmer.find(({ nature }) => nature.kind === 'schema')
        poser(idConsole, (precedent) => ({
          ...precedent,
          aConfirmer: {
            suite,
            nature: (structure ?? premiere).nature,
            sansWhere: aConfirmer.some(({ instruction }) => sansRestriction(instruction)),
            ecritures: aConfirmer.map(({ nature }) =>
              nature.kind === 'lecture' ? '' : nature.instruction,
            ),
          },
        }))
        return
      }
      lancer(suite)
    },
    [idConsole, lancer, poser, mode, moteur],
  )

  const reindexer = useCallback((nouvelId: (id: string) => string) => {
    setParConsole((precedent) =>
      Object.fromEntries(Object.entries(precedent).map(([id, etat]) => [nouvelId(id), etat])),
    )
  }, [])

  const courante = etat.etapes[etat.choisie]

  return {
    demander,
    reindexer,
    vue: etat.vue,
    setVue: (vue) => {
      if (idConsole === null) return
      poser(idConsole, (precedent) => ({ ...precedent, vue }))
    },
    executer: () => {
      if (etat.aConfirmer) lancer(etat.aConfirmer.suite)
    },
    annulerLaConfirmation: () => {
      if (idConsole === null) return
      poser(idConsole, (precedent) => ({ ...precedent, aConfirmer: null }))
    },
    aConfirmer: etat.aConfirmer,
    enCours: etat.enCours,
    // **La réponse regardée, et rien d'autre.** Une instruction encore en attente n'a ni résultat ni
    // erreur : la grille dit alors « Exécution… », ce qui est vrai de la suite.
    resultat: courante?.resultat ?? null,
    erreur: courante?.erreur ?? null,
    etapes: etat.etapes,
    choisie: etat.choisie,
    choisir: (index) => {
      if (idConsole === null) return
      poser(idConsole, (precedent) =>
        index < 0 || index >= precedent.etapes.length
          ? precedent
          : { ...precedent, choisie: index, suivre: false },
      )
    },
    poserLeResultat: (resultat) => {
      if (idConsole === null) return
      // **L'erreur part avec** : la grille montre désormais une réponse qui a réussi, et laisser le
      // refus d'avant au-dessus d'elle ferait lire l'un pour l'autre — `ConsoleResult` donne la
      // priorité à l'erreur. **Les onglets d'une suite partent aussi** (#156) : la réponse posée
      // vient du journal de la transaction, pas de la dernière exécution, et la laisser sous l'onglet
      // d'une autre instruction ferait lire l'une pour l'autre.
      poser(idConsole, (precedent) => ({
        ...precedent,
        etapes: [{ sql: resultat.sql, statut: 'ok', resultat, erreur: null }],
        choisie: 0,
        suivre: true,
      }))
    },
  }
}

/**
 * Vrai quand la transaction manuelle **remplace** la confirmation de cette requête (`API-38`).
 *
 * # Ce que la confirmation garde, et ce qui la rend inutile ici
 *
 * Elle attrape la faute de frappe — le `where` oublié, le `delete` lancé dans la mauvaise console —
 * juste avant que ce soit écrit. En transaction manuelle, rien n'est écrit : la requête entre dans
 * la transaction, le panneau la liste, et c'est **la validation** qui devient le moment où l'on
 * s'engage. Confirmer les deux ferait cliquer deux fois pour un seul engagement, et le premier clic,
 * le plus fréquent, ne protégerait de rien.
 *
 * # Le cas qui n'est pas dispensé : la structure
 *
 * Une modification de structure n'est pas toujours retenue par une transaction. MySQL **valide
 * d'office** ce qui attend avant d'exécuter un `create`, un `alter` ou un `drop` : le `delete` qu'on
 * relisait dans le panneau partirait alors sans qu'aucun clic ne l'ait décidé. Elle garde donc sa
 * confirmation, et celle-ci le dit.
 */
function dispenseeParLaTransaction(nature: ReturnType<typeof natureDe>, mode: TransactionMode) {
  return mode === 'manual' && nature.kind === 'ecriture'
}

function messageDe(erreur: unknown): string {
  if (typeof erreur === 'string') return erreur
  if (erreur instanceof Error) return erreur.message
  if (erreur !== null && typeof erreur === 'object' && 'message' in erreur) {
    return String((erreur as { message: unknown }).message)
  }
  return 'la requête a échoué'
}
