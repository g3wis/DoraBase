import { useCallback, useEffect, useRef, useState } from 'react'
import {
  commitTransaction,
  rollbackTransaction,
  transactionResult,
  transactionState,
} from '../../data/commandes'
import type {
  DatabaseKey,
  QueryResult,
  TransactionMode,
  TransactionState,
} from '../../domain/engine'
import { demandeConfirmation, natureDe, sansRestriction } from './nature'

/** Ce qui appelle les commandes. Injectable : le pont ne répond pas hors de la webview. */
export type PasserelleTransaction = {
  transactionState: (key: DatabaseKey, console: string) => Promise<TransactionState>
  transactionResult: (key: DatabaseKey, console: string, index: number) => Promise<QueryResult>
  commitTransaction: (key: DatabaseKey, console: string) => Promise<void>
  rollbackTransaction: (key: DatabaseKey, console: string) => Promise<void>
}

export const PASSERELLE_TRANSACTION: PasserelleTransaction = {
  transactionState,
  transactionResult,
  commitTransaction,
  rollbackTransaction,
}

/** Une transaction au repos : aucune n'est ouverte, et ce n'est pas une transaction vide. */
const AUCUNE_TRANSACTION: TransactionState = { open: false, statements: [], aborted: false }

/**
 * Une console, et la connexion sur laquelle elle porte.
 *
 * **Les deux, parce que les deux états ne sont pas au même endroit** : le régime et ce qu'on
 * regarde appartiennent à la **console** — l'onglet —, la transaction elle-même appartient à la
 * **session**, donc à la connexion. Une seule clef aurait forcé l'un des deux à mentir.
 */
export type Console = {
  cle: DatabaseKey
  /** L'identité de l'onglet, celle d'`idOnglet` — le même index que le texte et le résultat. */
  id: string
}

/**
 * L'index d'une connexion dans les tables de ce module.
 *
 * **Ce n'est pas la clé du registre**, que le Rust compose lui-même (`registry::cle`) et que le
 * front n'a jamais à écrire : c'est un index d'état React, du même genre que celui d'`idOnglet`.
 * Les commandes reçoivent toujours le `DatabaseKey` en trois champs.
 */
function index(cle: DatabaseKey): string {
  return `${cle.project}/${cle.database}/${cle.environment}`
}

/**
 * Ce qu'une validation met en jeu, tel que la confirmation le récapitule (`API-38`).
 *
 * **Dérivé du journal, jamais compté à part** : les instructions sont classées par `natureDe`, le
 * même classificateur que la confirmation d'une requête isolée. Deux règles pour « est-ce que ceci
 * écrit ? » finiraient par diverger, et c'est la question dont dépend l'affichage de cette modale.
 */
export type ValidationADemander = {
  /** La console qui a demandé la validation : c'est elle qui la reçoit, et son onglet la porte. */
  console: Console
  /** Le nombre d'instructions de la transaction, écritures comprises. */
  instructions: number
  /** Les verbes des écritures, dans l'ordre — « DELETE », « UPDATE »… */
  ecritures: readonly string[]
  /**
   * Vrai quand l'une des écritures ne porte pas de `where`.
   *
   * Le fait le plus coûteux de tout ce qui attend, et celui que la confirmation d'une requête isolée
   * met en premier : le taire au milieu d'un récapitulatif serait le noyer.
   */
  sansRestriction: boolean
}

export type Transactions = {
  /** Le régime de **cette console** — `auto` tant que personne n'a rien réglé sur elle. */
  mode: (console: Console | null) => TransactionMode
  poserLeMode: (console: Console, mode: TransactionMode) => void
  /**
   * Ce que la transaction contient **pour cette console**, tel que le Rust l'a dit : ses propres
   * instructions, plus le compte de celles des autres. Voir la doc de tête.
   */
  etat: (console: Console | null) => TransactionState
  /** Le refus d'une validation, d'une annulation ou d'une lecture de réponse, s'il y en a un. */
  erreur: (console: Console | null) => string | null
  /**
   * Le rang de l'instruction dont la réponse est dans la grille de cette console, ou `null`.
   *
   * **`null` après chaque exécution**, et le panneau ne marque alors rien : la grille montre la
   * réponse de la dernière exécution *de cette console*, et rien ne dit quelle entrée du journal
   * l'a produite — deux consoles y écrivent. Marquer la dernière entrée serait juste presque
   * toujours, et faux dès qu'une voisine a exécuté après nous.
   */
  affichee: (console: Console | null) => number | null
  /**
   * Demande la réponse d'une instruction, et retient laquelle est affichée.
   *
   * Rend `null` quand le cœur a refusé — l'appelant laisse alors sa grille telle quelle, et le
   * refus paraît dans le panneau.
   */
  afficher: (console: Console, index: number) => Promise<QueryResult | null>
  /** Relit le journal. Appelé après chaque exécution, et par l'effet de cette fonction. */
  apresExecution: (console: Console) => void
  /**
   * Rend la session d'une console qu'on **ferme**, en annulant sa transaction (`API-38`).
   *
   * Voir la doc de tête, « Fermer l'onglet annule la transaction ». Le régime, lui, reste : c'est un
   * réglage de cet onglet, et le retrouver éteint au retour serait l'avoir défait en silence.
   */
  oublier: (console: Console) => void
  /**
   * Le jeton d'origine de cette console, celui que `run_sql` inscrit à côté de l'instruction.
   *
   * **Opaque, et le cœur ne le compare qu'à lui-même** : il n'a pas à être lisible, il a à être
   * stable. Voir la doc de tête, « L'origine d'une instruction est un jeton, non l'identité de
   * l'onglet ». Rend `''` hors d'une console, où rien ne s'exécute.
   */
  jeton: (console: Console | null) => string
  /**
   * Fait suivre un changement d'identité d'onglet — un renommage de console ou de connexion.
   *
   * **Quatre tables en dépendent ici**, et le jeton de session est celle qui compte le plus : il
   * désigne une session **côté serveur** : un jeton qui ne suivrait pas son onglet laisserait une
   * transaction ouverte, avec ses verrous, que plus rien ne pourrait atteindre — ni valider ni
   * annuler. Le régime suit pour la même sorte de raison : sans lui, renommer une console en
   * pleine transaction la ferait retomber en `auto`, donc en ferait disparaître le panneau.
   */
  reindexer: (nouvelId: (id: string) => string) => void
  /**
   * Demande la validation — passe par la confirmation quand la transaction contient des écritures.
   *
   * **C'est ici que la confirmation a lieu, et non à l'exécution** (`API-38`) : en transaction
   * manuelle, le moment où l'on s'engage est la validation. Une transaction qui n'a fait que lire
   * n'a rien à confirmer, comme un `select` n'en demande pas.
   */
  demanderLaValidation: (console: Console) => void
  /** Ce qu'une validation met en jeu, quand elle attend une confirmation. */
  aValider: ValidationADemander | null
  annulerLaValidation: () => void
  /** Valide pour de bon. Appelé par la confirmation. */
  valider: (console: Console) => void
  annuler: (console: Console) => void
  /** Vrai pendant une validation ou une annulation : les deux boutons attendent. */
  enCours: boolean
}

/**
 * La transaction manuelle d'une console (`API-38`).
 *
 * # Une console, un régime, une transaction, une session
 *
 * Tout ce qui suit tient à un fait de serveur : **une transaction est un état de session**. Deux
 * consoles qui partagent une session partagent sa transaction, quoi qu'en dise l'écran — un `BEGIN`
 * posé depuis l'une englobe ce que l'autre exécute, et un `commit` emporte les deux. Le cœur ouvre
 * donc **une session par console** dès qu'elle passe en mode manuel, et sa transaction y vit seule.
 *
 * Les trois états sont alors au même endroit, l'onglet : le régime, ce qu'on regarde, et la
 * transaction elle-même — indexés par identité d'onglet comme le texte (`12a`), le résultat (`12c`)
 * et les modifications en attente (`11b`).
 *
 * # L'origine d'une instruction est un jeton, non l'identité de l'onglet
 *
 * Le cœur retrouve la session d'une console par le jeton que l'écran lui donne, et il ne le compare
 * qu'à lui-même. Ce n'est **pas** `Console.id` : cette identité dérive du nom de l'onglet et de
 * celui de la connexion (voir `idOnglet`), donc un renommage la change — et la console perdrait la
 * main sur une session qui, elle, tient toujours sa transaction et ses verrous.
 *
 * Le jeton est donc une **valeur** que `reindexer` déplace avec son onglet, mintée à la demande
 * depuis un compteur. Sa forme n'est jamais lue — ni par le cœur, ni par un test : c'est ce qui
 * permet d'en changer.
 *
 * # Le journal n'est pas tenu ici
 *
 * Il vit dans le registre, à côté de la session qui porte la transaction, et cette fonction le
 * **relit**. Une liste tenue par l'écran aurait été juste sur ce que l'onglet a lancé et fausse sur
 * ce qu'un « Valider » emporte — un refus, par exemple, entre dans la transaction sans que l'écran
 * l'y mette.
 *
 * # Rien ne part avant qu'on le demande
 *
 * Tant qu'une console n'est pas en manuel et qu'aucune transaction n'est connue ouverte, aucune
 * commande n'est appelée : la galerie, `?demo` et toute la suite Playwright n'y touchent pas. C'est
 * l'arbitrage de la recherche de mise à jour, pour la même raison.
 *
 * # Les deux boutons sont les deux issues, et la bascule ne peut pas les contourner
 *
 * La session s'ouvre à la **première exécution**, jamais au réglage : tant qu'on n'a rien exécuté,
 * il n'y a ni session ni verrou, et éteindre l'interrupteur n'a rien à défaire. Dès qu'une
 * instruction est entrée, en revanche, l'écran fige la bascule — et c'est ce qui garantit qu'une
 * session ne reste jamais ouverte sans que son panneau soit là pour la finir.
 *
 * # Fermer l'onglet annule la transaction
 *
 * C'est la troisième issue, et elle est nécessaire : le panneau et ses deux boutons vivent **dans**
 * l'onglet, donc une transaction dont l'onglet est fermé n'est plus atteignable par aucun geste.
 * La laisser attendre tiendrait ses verrous côté serveur — et sur un fichier SQLite elle
 * empêcherait **toute autre console** d'en ouvrir une, jusqu'au prochain lancement.
 *
 * **Sans confirmation**, et c'est la règle de l'annulation : elle rend la base à son état, il n'y a
 * rien à perdre. Ce qui se perd — les instructions qu'on avait écrites — est dans l'éditeur, que la
 * fermeture d'un onglet n'efface pas.
 *
 * **Le jeton part avec.** Réouvrir la console reminte le sien : c'est un onglet neuf devant une
 * session neuve, et garder l'ancien ferait désigner une session que le cœur a fermée.
 *
 * @param revision le témoin de configuration, `projects` en pratique : **les six commandes qui
 * ferment une connexion le réécrivent**, et une transaction fermée avec sa connexion doit
 * disparaître du panneau plutôt que d'y offrir un « Valider » qui n'a plus rien à valider. C'est la
 * règle de l'arbre — ce que le registre ne tient plus ne doit plus être affiché — appliquée ici.
 */
export function useTransaction(
  passerelle: PasserelleTransaction,
  consoleActive: Console | null,
  revision?: unknown,
): Transactions {
  const [modes, setModes] = useState<Readonly<Record<string, TransactionMode>>>({})
  /** Ce que la transaction contient **pour une console**, indexé par onglet. Voir la doc de tête. */
  const [etats, setEtats] = useState<Readonly<Record<string, TransactionState>>>({})
  const [erreurs, setErreurs] = useState<Readonly<Record<string, string | null>>>({})
  const [affichees, setAffichees] = useState<Readonly<Record<string, number | null>>>({})
  const [aValider, setAValider] = useState<ValidationADemander | null>(null)
  const [enCours, setEnCours] = useState(false)

  // Le jeton d'origine d'un onglet, et le compteur qui les mint. **Des refs, non un état** : rien
  // ne les affiche, donc rien n'a à se rendre de nouveau quand un jeton naît — et le minter est une
  // mémoïsation, une même console rendant toujours le même jeton.
  const jetons = useRef<Record<string, string>>({})
  const prochainJeton = useRef(0)
  const jetonDe = useCallback((id: string) => {
    const connu = jetons.current[id]
    if (connu !== undefined) return connu
    prochainJeton.current += 1
    // Aucun nom d'onglet, de base ni de projet : le cœur ne compare ce jeton qu'à lui-même, et une
    // valeur opaque est ce qui garantit que personne ne se mette à en lire la forme.
    const jeton = `console-${prochainJeton.current}`
    jetons.current[id] = jeton
    return jeton
  }, [])

  const relire = useCallback(
    (console: Console) => {
      const { cle, id } = console
      passerelle
        .transactionState(cle, jetonDe(id))
        // **Une lecture identique ne rend pas un état neuf**, et ce n'est pas une optimisation :
        // l'effet ci-dessous dépend de l'identité de la passerelle, qu'un appelant peut reconstruire
        // à chaque rendu — une lecture qui reposerait toujours un objet neuf relancerait alors
        // l'effet indéfiniment. C'est le piège de `10d` désarmé à la source plutôt que confié à la
        // discipline des appelants.
        .then((etat) =>
          setEtats((precedent) =>
            JSON.stringify(precedent[id]) === JSON.stringify(etat)
              ? precedent
              : { ...precedent, [id]: etat },
          ),
        )
        // **Le rejet est normal et il ne se remonte pas** : hors de la webview le pont ne répond
        // pas, et personne n'a rien demandé. Le panneau garde alors sa dernière lecture, ou son
        // état au repos.
        .catch(() => {})
    },
    [passerelle, jetonDe],
  )

  const connexionActive = consoleActive === null ? null : index(consoleActive.cle)
  const ongletActif = consoleActive === null ? null : consoleActive.id
  const modeActif = consoleActive === null ? 'auto' : (modes[consoleActive.id] ?? 'auto')
  /**
   * Vrai quand **cette console** est connue tenir une transaction.
   *
   * C'est ce qui la fait relire alors qu'elle est repassée en `auto` : sa session existe toujours,
   * et son panneau doit continuer de dire ce qu'elle retient. Une console qui n'a jamais rien
   * ouvert reste muette, ce qui est le prix de « rien ne part avant qu'on le demande ».
   */
  const journalConnu = ongletActif !== null && (etats[ongletActif]?.open ?? false)

  // Quatre dépendances que le corps ne nomme pas, et il en faut quatre :
  //
  // - `connexionActive` **remplace** la clef, que l'appelant reconstruit à chaque rendu — c'est
  //   l'index qui dit qu'on a changé de connexion, pas l'identité de l'objet. Le piège de `10d`, où
  //   une passerelle littérale relisait les lignes à chaque frappe ;
  // - `ongletActif` parce que l'état lu appartient à **une** console : arriver sur une voisine de
  //   la même connexion, dans le même régime, doit relire. Sans lui, son panneau afficherait la
  //   dernière lecture *qu'elle* avait faite — juste au moment où elle l'avait faite, et faux
  //   depuis ;
  // - `modeActif` et `journalConnu` sont les deux raisons de relire, chacune lue par la garde ;
  // - `revision` est un **témoin** : on ne le lit pas, on constate qu'il a bougé. C'est le signal
  //   commun aux six commandes qui ferment une connexion (voir la doc de tête).
  // biome-ignore lint/correctness/useExhaustiveDependencies: voir ci-dessus
  useEffect(() => {
    // **En manuel, ou sur une transaction déjà connue** : hors de ces deux cas il n'y a rien à
    // lire, et aucune commande ne part — la galerie et `?demo` n'y touchent pas.
    if (consoleActive === null || (modeActif !== 'manual' && !journalConnu)) return
    relire(consoleActive)
  }, [connexionActive, ongletActif, modeActif, journalConnu, revision, relire])

  const achever = useCallback(
    (console: Console, ordre: 'valider' | 'annuler') => {
      const { cle, id } = console
      const jeton = jetonDe(id)
      setEnCours(true)
      const geste =
        ordre === 'valider'
          ? passerelle.commitTransaction(cle, jeton)
          : passerelle.rollbackTransaction(cle, jeton)
      geste
        .then(() => setErreurs((precedent) => ({ ...precedent, [id]: null })))
        // **Le refus se dit, ici.** C'est un geste demandé : un bouton qui retombe en silence se
        // lit comme une panne (défaut n° 36), et c'est le seul endroit qui puisse dire qu'une
        // validation n'a pas eu lieu.
        .catch((raison: unknown) =>
          setErreurs((precedent) => ({ ...precedent, [id]: messageDe(raison) })),
        )
        .finally(() => {
          setEnCours(false)
          // Le journal est vidé : il n'y a plus d'instruction à marquer.
          setAffichees((precedent) => ({ ...precedent, [id]: null }))
          // Relu dans les deux cas : côté Rust la transaction est terminée qu'elle ait été validée
          // ou non, et le journal est vide. Le relire plutôt que de le supposer garde une seule
          // vérité. **Les voisines relisent en arrivant** — c'est l'onglet actif qui est une
          // dépendance de l'effet, et leur état d'ici est périmé par construction.
          relire(console)
        })
    },
    [passerelle, relire, jetonDe],
  )

  return {
    mode: (console) => (console === null ? 'auto' : (modes[console.id] ?? 'auto')),
    poserLeMode: (console, mode) => setModes((precedent) => ({ ...precedent, [console.id]: mode })),
    etat: (console) =>
      console === null ? AUCUNE_TRANSACTION : (etats[console.id] ?? AUCUNE_TRANSACTION),
    erreur: (console) => (console === null ? null : (erreurs[console.id] ?? null)),
    affichee: (console) => (console === null ? null : (affichees[console.id] ?? null)),
    afficher: async (console, rang) => {
      try {
        const resultat = await passerelle.transactionResult(console.cle, jetonDe(console.id), rang)
        setErreurs((precedent) => ({ ...precedent, [console.id]: null }))
        setAffichees((precedent) => ({ ...precedent, [console.id]: rang }))
        return resultat
      } catch (raison: unknown) {
        // **Le refus se dit** : c'est un geste demandé, et un clic qui ne change rien se lirait
        // comme une panne (défaut n° 36). La marque ne bouge pas — la grille non plus.
        setErreurs((precedent) => ({ ...precedent, [console.id]: messageDe(raison) }))
        return null
      }
    },
    apresExecution: (console) => {
      // **Rien ne part en mode automatique sans transaction connue.** Le second fait est ce qui
      // fait suivre une console repassée en `auto` alors que sa session tient encore : son panneau
      // doit continuer de dire ce qu'elle retient.
      if ((modes[console.id] ?? 'auto') !== 'manual' && !(etats[console.id]?.open ?? false)) {
        return
      }
      // **L'erreur part avec la transaction qu'elle décrivait.** Une validation refusée a terminé la
      // sienne ; la garder afficherait son refus au-dessus des instructions d'une transaction neuve.
      setErreurs((precedent) => ({ ...precedent, [console.id]: null }))
      // **La marque part avec l'exécution** : la grille montre désormais la réponse toute neuve, et
      // non celle de l'instruction qu'on avait désignée.
      setAffichees((precedent) => ({ ...precedent, [console.id]: null }))
      relire(console)
    },
    oublier: ({ cle, id }) => {
      const jeton = jetons.current[id]
      // **L'annulation part avant l'oubli**, avec le jeton qu'on va justement retirer : c'est lui
      // qui désigne la session à fermer côté cœur.
      if (jeton !== undefined && (etats[id]?.open ?? false)) {
        // **Le rejet ne se remonte pas, et cette fois faute de destinataire** : le panneau qui
        // l'afficherait vient de se fermer. Rien ne se perd pour autant — `achever` ferme la
        // session dans les deux issues, donc la transaction est annulée par le serveur même si
        // l'ordre a échoué.
        passerelle.rollbackTransaction(cle, jeton).catch(() => {})
      }
      delete jetons.current[id]
      // **Le régime reste**, lui : c'est un réglage de cet onglet, comme le texte que la fermeture
      // n'efface pas non plus. Ce qui part est ce que la session portait.
      const sans = <T>(table: Readonly<Record<string, T>>) => {
        const { [id]: _oublie, ...reste } = table
        return reste
      }
      setEtats(sans)
      setErreurs(sans)
      setAffichees(sans)
    },
    jeton: (console) => (console === null ? '' : jetonDe(console.id)),
    reindexer: (nouvelId) => {
      // **Le jeton d'abord** : c'est celui dont l'oubli coûte le plus cher, puisqu'il désigne une
      // **session** côté serveur — la perdre laisserait une transaction ouverte que plus rien ne
      // peut atteindre. Une ref, donc déplacée sur place : rien ne l'affiche, et le rendu que les
      // trois `set` déclenchent suffit.
      jetons.current = Object.fromEntries(
        Object.entries(jetons.current).map(([id, jeton]) => [nouvelId(id), jeton]),
      )
      const deplacer = <T>(table: Readonly<Record<string, T>>) =>
        Object.fromEntries(Object.entries(table).map(([id, valeur]) => [nouvelId(id), valeur]))
      setModes(deplacer)
      setEtats(deplacer)
      setErreurs(deplacer)
      setAffichees(deplacer)
      // `ouvertures` n'existe plus : ce qui restait indexé par connexion était le seul fait qu'une
      // session partagée imposait, et une session par console l'a emporté avec elle.
    },
    demanderLaValidation: (console) => {
      const enjeu = enJeu(console, etats[console.id] ?? AUCUNE_TRANSACTION)
      // Rien d'écrit dans la transaction : il n'y a rien à confirmer, et un clic de plus ne
      // protégerait de rien. C'est la règle de `demandeConfirmation`, appliquée à un lot.

      if (enjeu.ecritures.length === 0) {
        achever(console, 'valider')
        return
      }
      setAValider(enjeu)
    },
    aValider,
    annulerLaValidation: () => setAValider(null),
    valider: (console) => {
      setAValider(null)
      achever(console, 'valider')
    },
    // **L'annulation ne se confirme pas.** Elle rend la base à son état : c'est le geste de repli,
    // et le confronter à une question ferait hésiter là où il n'y a rien à perdre. Ce qui se perd —
    // les instructions qu'on avait écrites — est dans l'éditeur, que rien n'efface.
    annuler: (console) => achever(console, 'annuler'),
    enCours,
  }
}

/**
 * Ce qu'une validation mettrait en jeu, lu dans le journal.
 *
 * Les instructions **refusées** sont écartées : elles n'ont rien écrit, et sur PostgreSQL elles ont
 * même abandonné la transaction — la compter comme une écriture ferait annoncer un `delete` qui n'a
 * pas eu lieu.
 */
function enJeu(console: Console, etat: TransactionState): ValidationADemander {
  const instructions = etat.statements
  const ecrivantes = instructions.filter((instruction) => {
    if (instruction.error !== null) return false
    return demandeConfirmation(natureDe(instruction.sql))
  })
  return {
    console,
    instructions: instructions.length,
    ecritures: ecrivantes.map((instruction) => {
      const nature = natureDe(instruction.sql)
      return nature.kind === 'lecture' ? '' : nature.instruction
    }),
    sansRestriction: ecrivantes.some((instruction) => sansRestriction(instruction.sql)),
  }
}

/** Le même dépliage que dans `useExecution` : une erreur d'IPC n'a pas de forme garantie. */
function messageDe(erreur: unknown): string {
  if (typeof erreur === 'string') return erreur
  if (erreur instanceof Error) return erreur.message
  if (erreur !== null && typeof erreur === 'object' && 'message' in erreur) {
    return String((erreur as { message: unknown }).message)
  }
  return 'la transaction a échoué'
}
