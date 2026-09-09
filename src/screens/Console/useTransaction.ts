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
  transactionResult: (key: DatabaseKey, index: number) => Promise<QueryResult>
  commitTransaction: (key: DatabaseKey) => Promise<void>
  rollbackTransaction: (key: DatabaseKey) => Promise<void>
}

export const PASSERELLE_TRANSACTION: PasserelleTransaction = {
  transactionState,
  transactionResult,
  commitTransaction,
  rollbackTransaction,
}

/** Une transaction au repos : aucune n'est ouverte, et ce n'est pas une transaction vide. */
const AUCUNE_TRANSACTION: TransactionState = {
  open: false,
  statements: [],
  foreign: 0,
  aborted: false,
}

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
  /** Le nombre d'instructions **de cette console**, écritures comprises. */
  instructions: number
  /**
   * Combien d'instructions d'**autres consoles** la validation emporte en plus.
   *
   * Zéro dans le cas ordinaire. Au-delà, la confirmation le dit : le panneau ne montre que ses
   * propres instructions, et un `commit` emporte la transaction entière — c'est la seule chose que
   * le filtre par console oblige à dire ailleurs, et c'est ici qu'elle se dit.
   */
  etrangeres: number
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
  /** Ce que la transaction de sa **connexion** contient, tel que le Rust l'a dit. */
  etat: (console: Console | null) => TransactionState
  /**
   * Vrai quand une transaction est ouverte sur la connexion de cette console alors qu'elle est,
   * elle, en mode `auto`.
   *
   * **Le seul écart que le régime par console laisse ouvert, et il se dit.** Les consoles d'une même
   * connexion partagent une session : les requêtes de celle-ci entrent donc dans une transaction
   * qu'une voisine a ouverte, et qu'un « Valider » ou un « Annuler » d'ailleurs décidera. Le taire
   * serait laisser croire à une écriture validée.
   */
  transactionEtrangere: (console: Console | null) => boolean
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
   * **Cinq tables en dépendent ici**, et le jeton d'origine est celle qui compte le plus : le cœur
   * garde l'origine des instructions déjà jouées, donc un jeton qui ne suivrait pas son onglet
   * rendrait à cette console **ses propres instructions comme étrangères** — un panneau vide et un
   * « Valider » qui emporte trois instructions invisibles. Le régime suit pour la même sorte de
   * raison : sans lui, renommer une console en pleine transaction la ferait retomber en `auto`,
   * donc en ferait disparaître le panneau.
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
 * # Le régime appartient à la console, la transaction à la session
 *
 * **Deux états, et ils ne sont pas au même endroit.** Le régime — manuel ou automatique — et ce
 * qu'on regarde sont des propriétés de l'**onglet** : c'est sur cette console-là qu'on a allumé
 * l'interrupteur, et passer à une autre ne doit pas en montrer le panneau. Ils sont donc indexés par
 * identité d'onglet, comme le texte (`12a`), le résultat (`12c`) et les modifications en attente
 * (`11b`).
 *
 * La **transaction**, elle, appartient à la session, donc à la connexion : le registre ne tient
 * qu'un adaptateur par base, et un `begin` posé depuis une console englobe ce que ses voisines
 * exécutent. C'est un fait du serveur, pas un choix d'écran, et le journal est indexé par connexion
 * pour cette raison — deux consoles réglées en manuel sur la même base regardent **la même**
 * transaction, et un `commit` de l'une emporte ce que l'autre a écrit.
 *
 * # L'écart que cela laisse, et comment il se dit
 *
 * Une console en `auto` sur une connexion dont une voisine a ouvert une transaction y écrit sans
 * l'avoir demandé. Rien ne peut l'empêcher — c'est une seule session —, mais le taire serait laisser
 * croire à une écriture validée : `transactionEtrangere` le rend, et le pied de la console le dit.
 * Une première version faisait du régime une propriété de la connexion pour supprimer le cas ; ce
 * qu'elle supprimait vraiment était le **choix** — le panneau d'une console apparaissait sur toutes
 * celles de la même base.
 *
 * # Le journal n'est pas tenu ici, et chaque console n'en reçoit que sa part
 *
 * Il vit dans le registre, et cette fonction le **relit**. Ce que la lecture rend n'est pas le
 * journal entier : ce sont les instructions de la console qui lit, plus le compte de celles des
 * autres (`TransactionState.foreign`). Une console montre ce qu'elle a fait — les requêtes d'une
 * voisine dans son propre panneau se lisaient comme les siennes, alors qu'elle ne les a ni écrites
 * ni vues passer.
 *
 * **Le filtre est au cœur, non ici**, et c'est ce qui le rend sûr : une console ne *peut* pas voir
 * les instructions d'une autre, donc aucun lecteur du journal — le compteur du panneau, le
 * récapitulatif d'une validation, le prochain qui s'y branchera — n'a de filtre à ne pas oublier.
 * Ce que le filtre oblige à dire ailleurs est le compte des autres, et c'est la confirmation de
 * validation qui le porte : le `commit` emporte la transaction **entière**.
 *
 * **Conséquence sur l'indexation** : l'état lu est celui d'une console, donc il est indexé par
 * onglet — deux consoles de la même base en reçoivent deux versions différentes de la même
 * transaction. Ce qui reste indexé par **connexion** est le seul fait qui appartienne à la session :
 * *une transaction est-elle ouverte*. C'est lui qui fait relire une console en `auto` dont la
 * voisine a ouvert une transaction, et il est vrai quelle que soit la console qui l'a appris.
 *
 * # L'origine d'une instruction est un jeton, non l'identité de l'onglet
 *
 * Le cœur inscrit à côté de chaque instruction l'origine que l'écran lui donne, et il ne la compare
 * qu'à elle-même. Ce n'est **pas** `Console.id` : cette identité dérive du nom de l'onglet et de
 * celui de la connexion (voir `idOnglet`), donc un renommage la change — et le cœur, lui, garde
 * l'ancienne à côté des instructions déjà jouées. Une console renommée en pleine transaction
 * retrouverait ses propres instructions **étrangères** : panneau vide, et un « Valider » qui
 * emporte ce qu'elle ne voit plus.
 *
 * Le jeton est donc une **valeur** que `reindexer` déplace avec son onglet, mintée à la demande
 * depuis un compteur. Sa forme n'est jamais lue — ni par le cœur, ni par un test : c'est ce qui
 * permet d'en changer.
 *
 * # Rien ne part avant qu'on le demande
 *
 * Tant qu'aucune console de la connexion n'est en manuel et qu'aucune transaction n'est connue
 * ouverte, aucune commande n'est appelée : la galerie, `?demo` et toute la suite Playwright n'y
 * touchent pas. C'est l'arbitrage de la recherche de mise à jour, pour la même raison.
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
  /**
   * *Une transaction est-elle ouverte*, par **connexion**.
   *
   * Le seul fait de la transaction qui appartienne à la session plutôt qu'à une console, et le seul
   * que la lecture d'une console enseigne aux autres : c'est lui qui fait relire une console en
   * `auto` dont la voisine a ouvert une transaction, pour que le pied puisse le dire. Une
   * transaction qu'aucune console n'a jamais lue reste invisible — le prix de « rien ne part avant
   * qu'on le demande ».
   *
   * **Ce qu'il ne suit pas** : un renommage de connexion, qui change l'index. Le cœur ferme la
   * connexion dans ce geste, donc l'entrée laissée sous l'ancien nom ne décrit plus rien ; elle ne
   * serait relue que par une connexion homonyme recréée plus tard, dont la première lecture la
   * corrige. Le déplacer aurait demandé de reconnaître un renommage de connexion ici, là où cette
   * fonction ne reçoit qu'un témoin opaque.
   */
  const [ouvertures, setOuvertures] = useState<Readonly<Record<string, boolean>>>({})
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
        // discipline des appelants. Même raison pour l'ouverture, que la garde de l'effet lit.
        .then((etat) => {
          setEtats((precedent) =>
            JSON.stringify(precedent[id]) === JSON.stringify(etat)
              ? precedent
              : { ...precedent, [id]: etat },
          )
          setOuvertures((precedent) =>
            precedent[index(cle)] === etat.open
              ? precedent
              : { ...precedent, [index(cle)]: etat.open },
          )
        })
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
  /** Vrai quand une transaction est **connue** ouverte sur la connexion de la console active. */
  const journalConnu = connexionActive !== null && (ouvertures[connexionActive] ?? false)

  // Quatre dépendances que le corps ne nomme pas, et il en faut quatre :
  //
  // - `connexionActive` **remplace** la clef, que l'appelant reconstruit à chaque rendu — c'est
  //   l'index qui dit qu'on a changé de connexion, pas l'identité de l'objet. Le piège de `10d`, où
  //   une passerelle littérale relisait les lignes à chaque frappe ;
  // - `ongletActif` est ce qui a été ajouté avec le filtre par console : l'état lu appartient
  //   désormais à **une** console, donc arriver sur une voisine de la même connexion, dans le même
  //   régime, doit relire. Sans lui, son panneau afficherait la dernière lecture *qu'elle* avait
  //   faite — juste au moment où elle l'avait faite, et faux depuis ;
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
      setEnCours(true)
      const geste =
        ordre === 'valider'
          ? passerelle.commitTransaction(cle)
          : passerelle.rollbackTransaction(cle)
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
    [passerelle, relire],
  )

  return {
    mode: (console) => (console === null ? 'auto' : (modes[console.id] ?? 'auto')),
    poserLeMode: (console, mode) => setModes((precedent) => ({ ...precedent, [console.id]: mode })),
    etat: (console) =>
      console === null ? AUCUNE_TRANSACTION : (etats[console.id] ?? AUCUNE_TRANSACTION),
    transactionEtrangere: (console) => {
      if (console === null) return false
      // **Ouverte sur la connexion, alors que cette console-ci ne l'a pas demandé.** C'est le seul
      // écart que le régime par console laisse ouvert : une seule session, plusieurs onglets. Lu
      // dans `ouvertures`, la table de connexion : une console en `auto` n'a pas d'état à elle
      // tant qu'elle n'a pas lu, et c'est justement ce qu'il faut lui apprendre.
      const ouverte = ouvertures[index(console.cle)] ?? false
      return ouverte && (modes[console.id] ?? 'auto') === 'auto'
    },
    erreur: (console) => (console === null ? null : (erreurs[console.id] ?? null)),
    affichee: (console) => (console === null ? null : (affichees[console.id] ?? null)),
    afficher: async (console, rang) => {
      try {
        const resultat = await passerelle.transactionResult(console.cle, rang)
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
      // **Rien ne part en mode automatique sur une connexion sans transaction connue.** La
      // condition porte sur les deux faits, et le second est ce qui fait suivre une console `auto`
      // dont la voisine a ouvert une transaction : ses requêtes y entrent, et le pied doit le dire.
      if (
        (modes[console.id] ?? 'auto') !== 'manual' &&
        !(ouvertures[index(console.cle)] ?? false)
      ) {
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
    jeton: (console) => (console === null ? '' : jetonDe(console.id)),
    reindexer: (nouvelId) => {
      // **Le jeton d'abord** : c'est celui dont l'oubli coûte le plus cher, le cœur gardant
      // l'origine des instructions déjà jouées. Une ref, donc déplacée sur place — rien ne
      // l'affiche, et le rendu que les quatre `set` déclenchent suffit.
      jetons.current = Object.fromEntries(
        Object.entries(jetons.current).map(([id, jeton]) => [nouvelId(id), jeton]),
      )
      const deplacer = <T>(table: Readonly<Record<string, T>>) =>
        Object.fromEntries(Object.entries(table).map(([id, valeur]) => [nouvelId(id), valeur]))
      setModes(deplacer)
      setEtats(deplacer)
      setErreurs(deplacer)
      setAffichees(deplacer)
    },
    demanderLaValidation: (console) => {
      const enjeu = enJeu(console, etats[console.id] ?? AUCUNE_TRANSACTION)
      // Rien d'écrit dans la transaction : il n'y a rien à confirmer, et un clic de plus ne
      // protégerait de rien. C'est la règle de `demandeConfirmation`, appliquée à un lot.
      //
      // **Sauf si la transaction porte des instructions qu'on ne voit pas** : celles d'une voisine
      // ne sont pas rendues à cette console, donc rien ne dit qu'elles ne sont que des lectures, et
      // ce `commit` les emporte. Sans cette seconde condition, une console qui n'a fait que lire
      // validerait le `delete` d'une autre **sans aucune confirmation** — le trou que le filtre
      // aurait ouvert.
      if (enjeu.ecritures.length === 0 && enjeu.etrangeres === 0) {
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
    // **Ce que le panneau ne montre pas et que le `commit` emporte.** Les verbes de ces
    // instructions-là ne sont pas connus d'ici — le cœur ne les rend pas à une console qui ne les a
    // pas jouées —, donc la confirmation en dit le **nombre** plutôt que de les taire.
    etrangeres: etat.foreign,
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
