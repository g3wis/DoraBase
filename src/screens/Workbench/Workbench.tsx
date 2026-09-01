import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { rowAsInsert as rowAsInsertTauri } from '../../data/commandes'
import type { Database, EnvironmentId, Project } from '../../domain/config'
import type {
  DatabaseKey,
  Filter,
  RowWindow,
  SortKey,
  TableSummary,
  Value,
} from '../../domain/engine'
import { SelectionIndicator } from '../../shell/SelectionIndicator/SelectionIndicator'
import { TitleBar } from '../../shell/TitleBar/TitleBar'
import { SplitPane } from '../../ui/SplitPane/SplitPane'
import { ConsoleView } from '../Console/ConsoleView'
import { RunConfirm } from '../Console/RunConfirm'
import {
  PASSERELLE_EXECUTION,
  type PasserelleExecution,
  useExecution,
} from '../Console/useExecution'
import { idBase, idSchema, type Noeud } from '../Explorer/arbre'
import { BreadcrumbBar, type TypeObjet } from '../Explorer/BreadcrumbBar'
import type { CibleDeSuppression } from '../Explorer/DeleteConnectionDialog'
import { DetailPanel } from '../Explorer/DetailPanel'
import { ExplorerSidebar } from '../Explorer/ExplorerSidebar'
import { ObjectTable } from '../Explorer/ObjectTable'
import { type GestesEnvironnement, ProjectEditor } from '../Explorer/ProjectEditor'
import { DdlPanel } from '../Structure/DdlPanel'
import { StructureStatusBar, StructureView } from '../Structure/StructureView'
import { ApplyConfirm } from '../TableView/ApplyConfirm'
import { type EnAttente, retirer } from '../TableView/modifications'
import { PendingPanel } from '../TableView/PendingPanel'
import { RowPanel } from '../TableView/RowPanel'
import { TableStatusBar } from '../TableView/TableStatusBar'
import { TableView } from '../TableView/TableView'
import { PASSERELLE_APPLY, type PasserelleApply, useApplication } from '../TableView/useApplication'
import { PASSERELLE_LIGNES, type PasserelleLignes } from '../TableView/useLignes'
import { PASSERELLE_PREVIEW, type PasserellePreview, useSqlPrevu } from '../TableView/useSqlPrevu'
import { AucuneSelection } from './AucuneSelection'
import { ColonneDroite } from './ColonneDroite'
import {
  AUCUN_ONGLET,
  baptiserLeBrouillon,
  type Dialecte,
  type EtatOnglets,
  fermer,
  idApresRenommage,
  idDeConsolePersistee,
  idOnglet,
  ongletActif,
  ouvrir,
  ouvrirConsole,
  reindexerParConnexion,
  renommerLaConnexion,
  renommerLaConsole,
  reordonner,
  viseeParLId,
} from './onglets'
import { PASSERELLE_TAURI, type PasserelleArbre, useArbre } from './useArbre'
import { PASSERELLE_DETAIL, type PasserelleDetail, useDetailTable } from './useDetailTable'
import { PASSERELLE_STRUCTURES, type PasserelleStructures, useStructures } from './useStructures'
import styles from './Workbench.module.css'
import { type VueObjet, WorkbenchTabs } from './WorkbenchTabs'

type WorkbenchProps = {
  /**
   * La densité des lignes (`15c`), depuis les préférences.
   *
   * **Passée, pas lue** : la virtualisation de `10a` a besoin d'un nombre, et l'écran de travail est
   * le seul chemin entre les préférences et les deux grilles du produit.
   */
  rowHeight?: number
  /** Ouvre les préférences (`15a`). Absent, l'engrenage reste désactivé avec sa raison. */
  onOpenPreferences?: () => void
  projects: readonly Project[]
  passerelle?: PasserelleArbre
  passerelleDetail?: PasserelleDetail
  /** Le pont du préchauffage des structures. Injectable, comme les autres. */
  passerelleStructures?: PasserelleStructures
  passerelleLignes?: PasserelleLignes
  /** Injectable comme les autres commandes : le pont ne répond pas hors de la webview (`08d`). */
  rowAsInsert?: typeof rowAsInsertTauri
  /**
   * Déclarer une connexion. **La cible traverse, et elle est obligatoire** (26 août 2026) : le menu
   * d'une ligne d'environnement sait de quel projet et de quel environnement il s'agit, et c'est le
   * seul chemin — l'écran de création n'a donc rien à redemander ni à deviner.
   */
  onNewDatabase?: (cible: { project: string; environment: EnvironmentId }) => void
  /** Ouvre l'étape 1 du parcours de création, depuis le pied de la sidebar (`24d`). */
  onNewProject?: () => void
  /** Ouvre `A2` en mode édition sur cette base (`08g`). */
  onEditDatabase?: (project: string, database: Database) => void
  /**
   * Les projets à jour, après un geste de la modale d'édition (`23e`).
   *
   * **Une seule prop pour les cinq gestes** : chacun rend la liste entière, et c'est l'appelant qui la
   * tient. Cinq props jumelles se seraient désynchronisées, et l'écran n'a pas à savoir lequel des cinq
   * a parlé.
   */
  onProjets?: (projects: Project[]) => void
  /**
   * Les cinq gestes de `23c`, pour la modale d'édition. Absents, ce sont les commandes réelles.
   *
   * **Transmis, non réimplémentés** : la démo les fournit contre son état local, faute de pont Tauri en
   * Chromium — c'est ce qui rend `23e` mesurable par Playwright.
   */
  gestesEnvironnement?: GestesEnvironnement
  /**
   * Renomme un projet (`08i`). Ouvre aussi la modale d'édition (`23e`) : sa présence est ce qui rend
   * l'entrée « Modifier le projet… » cliquable, le renommage étant le seul geste de cet écran qui
   * demande une commande que la modale ne porte pas elle-même.
   */
  onRenameProject?: (
    project: string,
    nom: string,
  ) => Promise<{ missingSecrets: string[]; leftoverSecrets: string[] }>
  /**
   * Renomme une connexion (`26`). Absent, l'entrée « Renommer… » de l'arbre est désactivée.
   *
   * **Rejette avec le refus du cœur** — un nom déjà pris dans cet environnement — et la sidebar
   * l'affiche : c'est elle qui porte le geste, donc elle qui doit porter son refus.
   */
  onRenameDatabase?: (
    project: string,
    database: string,
    environment: EnvironmentId,
    nouveau: string,
  ) => Promise<{ missingSecrets: string[]; leftoverSecrets: string[] }>
  /** Le pont vers `preview_updates` (`11c`). Injectable : il ne répond pas hors de la webview. */
  passerellePreview?: PasserellePreview
  /** Le pont vers `apply_changes` (`11d`), la seule commande qui **écrit**. */
  passerelleApply?: PasserelleApply
  /** Le pont vers `run_sql` (`12c`) — le SQL de l'utilisateur. */
  passerelleExecution?: PasserelleExecution
  /** Retirer une déclaration de connexion, ou un projet (`08j`). */
  onDelete?: (cible: CibleDeSuppression) => Promise<{ leftoverSecrets: string[] }>
  /**
   * Crée une console sur une connexion. Absent, l'entrée de menu est désactivée avec sa raison.
   *
   * Les quatre gestes portent l'identité complète de la connexion — projet, base, environnement —
   * parce qu'une console appartient à une connexion et qu'`analytics` en dev et `analytics` en prod
   * sont deux connexions (`23b`).
   */
  onCreateConsole?: (
    project: string,
    database: string,
    environment: EnvironmentId,
    nom: string,
  ) => Promise<void>
  /** Écrit le texte d'une console. */
  onSaveConsole?: (
    project: string,
    database: string,
    environment: EnvironmentId,
    nom: string,
    sql: string,
  ) => Promise<void>
  /** Retire une console. */
  onDeleteConsole?: (
    project: string,
    database: string,
    environment: EnvironmentId,
    nom: string,
  ) => Promise<void>
  /** Renomme une console. */
  onRenameConsole?: (
    project: string,
    database: string,
    environment: EnvironmentId,
    ancien: string,
    nouveau: string,
  ) => Promise<void>
  /** Ouvre l'écran en mode édition au montage — la démo s'en sert (`11a`). */
  edition?: boolean
}

/**
 * L'écran de travail partagé par `A4` → `A9` : sidebar 212 px, centre à onglets, panneau droit.
 *
 * **`A4` n'existait que dans la galerie.** Ses quatre composants étaient écrits, testés et
 * fidèles, mais rien ne les réunissait et `App` ne les montait pas — les tests Playwright de
 * `09c`–`09f` visent tous `/?gallery`. Trou d'assemblage invisible, précisément parce que la
 * galerie donne la même image que l'écran. C'est ce que cette coquille corrige, et elle sert
 * `A5` du même coup.
 */
export function Workbench({
  rowHeight,
  onOpenPreferences,
  projects,
  passerelle = PASSERELLE_TAURI,
  passerelleDetail = PASSERELLE_DETAIL,
  passerelleStructures = PASSERELLE_STRUCTURES,
  passerelleLignes,
  rowAsInsert = rowAsInsertTauri,
  onNewDatabase,
  onNewProject,
  onEditDatabase,
  onRenameProject,
  onRenameDatabase,
  onProjets,
  gestesEnvironnement,
  onDelete,
  onCreateConsole,
  onSaveConsole,
  onDeleteConsole,
  onRenameConsole,
  passerellePreview,
  passerelleApply,
  passerelleExecution,
  edition = false,
}: WorkbenchProps) {
  /**
   * Le cache des structures, **au-dessus de l'arbre et du panneau** : les deux le lisent, et
   * le préchauffage l'alimente. Le poser dans l'un des deux l'aurait rendu inaccessible à l'autre.
   */
  const structures = useStructures(passerelleStructures)
  const { deplies, charge, etatDeBase, basculer, charger, rafraichir } = useArbre(
    projects,
    passerelle,
    structures.prechauffer,
    // Le schéma qu'on vient de déplier passe **devant** le reste de la file : c'est le geste
    // qui précède immédiatement l'ouverture d'une table.
    structures.prechaufferLeSchema,
  )

  /**
   * « Rafraîchir l'arborescence » vide **aussi** les structures.
   *
   * Sans cela, le geste rechargerait les schémas et les objets en laissant les structures d'hier en
   * mémoire — la moitié de l'écran à jour, l'autre non, et rien pour le dire.
   */
  const rafraichirTout = useCallback(() => {
    structures.vider()
    rafraichir()
  }, [structures, rafraichir])
  // Le projet dont on édite les environnements (`23e`). **Ici, et non dans la sidebar** : les deux
  // points d'entrée — le « … » de l'arbre et la pastille de la barre de titre — vivent tous deux dans
  // cet écran, et une modale montée dans la sidebar serait inatteignable depuis la pastille. C'est le
  // défaut n° 89, dont la leçon est appliquée d'emblée cette fois.
  // **Le projet lui-même, non son nom.** Le nom seul suffisait jusqu'à ce que cette modale sache
  // renommer : pendant le renommage, la liste porte le nouveau nom et l'état encore l'ancien, si bien
  // qu'une recherche par nom ne trouve rien le temps d'un rendu — et la modale se démontait, perdant
  // son compte rendu (« un mot de passe était introuvable »). L'objet gardé ici sert de **repli** pour
  // ce seul rendu ; la liste chargée reste la source dès qu'elle a suivi.
  const [aEditer, setAEditer] = useState<Project | null>(null)
  const ouvrirLEditionDe = (nom: string) =>
    setAEditer(projects.find((projet) => projet.name === nom) ?? null)
  const [selection, setSelection] = useState<Noeud | null>(null)
  const [etatOnglets, setEtatOnglets] = useState(AUCUN_ONGLET)
  const [type, setType] = useState<TypeObjet>('tables')
  const [filtre, setFiltre] = useState('')
  const [objetChoisi, setObjetChoisi] = useState<string | null>(null)
  // Les filtres et le tri de la table ouverte, publiés par `TableView` (`10d`) : la sidebar les
  // annote, sans en tenir de copie.
  const [etatRequete, setEtatRequete] = useState<{
    filters: readonly Filter[]
    sort: readonly SortKey[]
  }>({ filters: [], sort: [] })
  // La lecture en cours, remontée par la vue de table : la barre d'état et le panneau de ligne
  // vivent **ici**, parce que le mockup les place hors du centre — le panneau longe tout le corps,
  // la barre court sur toute la largeur.
  const [lecture, setLecture] = useState<{
    fenetre: RowWindow | null
    loading: boolean
    error: string | null
    ligne: readonly Value[] | null
    rang: number | null
    total: number
  }>({ fenetre: null, loading: false, error: null, ligne: null, rang: null, total: 0 })
  const [rangChoisi, setRangChoisi] = useState<number | null>(null)
  /**
   * Le mode édition, **par onglet** (`11b`).
   *
   * Deux tables ouvertes n'ont aucune raison de basculer ensemble : l'état d'édition appartient à ce
   * qu'on édite. Un `Set` des onglets en édition, plutôt qu'un drapeau global.
   */
  const [ongletsEnEdition, setOngletsEnEdition] = useState<ReadonlySet<string>>(new Set())
  /**
   * Les modifications en attente, **par onglet**, remontées par la vue de table.
   *
   * Le compte apparaît à quatre endroits — bandeau, arbre, panneau, barre d'état — et tous lisent
   * **cette** source. Un compteur tenu à part divergerait au premier `⌘Z`.
   */
  const [attentes, setAttentes] = useState<Readonly<Record<string, EnAttente>>>({})

  const actif = ongletActif(etatOnglets)
  // **Deux vues de l'onglet actif**, depuis que `12a` en fait une union. Tout ce qui parle de
  // schéma, de table, de lignes ou de modifications concerne une *table* ; le reste — la barre de
  // titre, la sidebar — se contente de la base. Distinguer ici évite de réinterroger `sorte` à
  // vingt endroits, et laisse le compilateur refuser un accès à `.table` sur une console.
  const table = actif?.sorte === 'table' ? actif : null
  const consoleActive = actif?.sorte === 'console' ? actif : null

  // Le contexte du **centre** : le schéma de l'onglet actif, sinon celui que la sidebar désigne.
  // Distinct de la barre de titre, qui suit la base ouverte — `09e` a posé la distinction, et
  // elle ne devient visible qu'ici, avec plusieurs onglets.
  // **Le contexte porte l'environnement**, et il le portait déjà sans le garder : les deux branches
  // le reçoivent — `table.key` depuis `12a`, le nœud d'arbre depuis `23b` — et toutes deux le
  // jetaient. L'écran le relisait alors sur `projetActif.activeEnvironment`, un réglage global du
  // projet, ce qui suffisait tant que l'arbre ne montrait qu'un environnement à la fois. Depuis
  // `25a` il en montre tous : c'est la sélection qui dit lequel, et rien d'autre.
  const contexte = table
    ? {
        project: table.key.project,
        database: table.key.database,
        environment: table.key.environment,
        schema: table.schema,
      }
    : selection?.schema && selection.project && selection.database && selection.environment
      ? {
          project: selection.project,
          database: selection.database,
          environment: selection.environment,
          schema: selection.schema,
        }
      : null

  /**
   * Ce que la barre de titre **indique** (`25b`) : le projet et l'environnement de la sélection.
   *
   * Plus large que `contexte`, qui exige un schéma : sélectionner un projet, un environnement ou une
   * connexion doit déjà s'afficher. Plus étroit que l'ancien `projetActif`, qui retombait sur
   * `projects[0]` — cette retombée faisait annoncer un projet que personne n'avait désigné, et c'est
   * exactement ce que « rien de sélectionné, indicateur vide » supprime.
   */
  const indication: { project: string; environment: EnvironmentId | null } | null = table
    ? { project: table.key.project, environment: table.key.environment }
    : consoleActive
      ? { project: consoleActive.key.project, environment: consoleActive.key.environment }
      : selection?.project
        ? { project: selection.project, environment: selection.environment ?? null }
        : null

  /**
   * Il n'y a rien à montrer : aucun onglet ouvert, et aucun schéma en vue.
   *
   * **Dérivé de `contexte`, et non d'une liste de paliers.** Un test sur `selection.kind` aurait
   * énuméré `project`, `environment`, `database` — et aurait oublié le palier suivant. `contexte`
   * répond déjà à la question utile : « de quel schéma cet écran parle-t-il ? ». Il ne vaut quelque
   * chose que sur un schéma sélectionné ou une table ouverte, c'est-à-dire exactement quand le centre
   * a un contenu.
   *
   * **Les deux conditions, et non la seule** : une console a un onglet sans avoir de schéma, donc
   * `contexte` y est nul alors que le centre est plein.
   */
  const rienAMontrer = actif === null && contexte === null

  const projetIndique = projects.find((p) => p.name === indication?.project) ?? null
  /** La déclaration de l'environnement indiqué, seule source du drapeau `production` (`23g`). */
  const environnementIndique =
    projetIndique?.environments.find((declaration) => declaration.id === indication?.environment) ??
    null

  /**
   * Le dialecte que la base parle (`13a`).
   *
   * **Dérivé du moteur déclaré, jamais choisi.** Une console mongo sur une base PostgreSQL n'aurait
   * rien à interroger, et l'inverse non plus : le bouton « Nouvelle console » ouvre donc la console
   * de la base sur laquelle on est, sans poser la question.
   */
  const dialecteDe = useCallback(
    (nomProjet: string, nomBase: string, environnement: EnvironmentId): Dialecte => {
      // **L'environnement fait partie de l'identité de la connexion** (`23b`) : chercher par le seul
      // nom rendait le moteur de la première homonyme — le dialecte de la console d'`analytics` en dev
      // pour la console d'`analytics` en prod. `useArbre.baseDeclaree` filtrait déjà correctement ;
      // cette fonction était en retard.
      const moteur = projects
        .find((p) => p.name === nomProjet)
        ?.databases.find((d) => d.name === nomBase && d.environment === environnement)?.engine
      return moteur === 'mongodb' ? 'mongo' : 'sql'
    },
    [projects],
  )

  const objets: readonly TableSummary[] = contexte
    ? (charge.objets[
        idSchema(contexte.project, contexte.environment, contexte.database, contexte.schema)
      ] ?? [])
    : []

  const visibles = useMemo(
    () =>
      objets.filter(
        (objet) =>
          objet.name.toLowerCase().includes(filtre.trim().toLowerCase()) && correspond(objet, type),
      ),
    [objets, filtre, type],
  )

  const cle: DatabaseKey | null = contexte
    ? {
        project: contexte.project,
        database: contexte.database,
        environment: contexte.environment,
      }
    : null

  /**
   * Le moteur de la base ouverte, pour l'édition de document en JSON (`18g`) — **dérivé de la
   * déclaration**, comme `dialecteDe`, jamais deviné depuis le contenu de l'écran.
   */
  const moteurActuel = contexte
    ? projects
        .find((p) => p.name === contexte.project)
        ?.databases.find(
          (d) => d.name === contexte.database && d.environment === contexte.environment,
        )?.engine
    : undefined

  /**
   * Le libellé d'affichage de la base ouverte (27 août 2026), pour le fil d'Ariane du centre, la
   * barre de titre et la confirmation d'exécution — **jamais** `contexte.database` telle quelle,
   * qui reste l'identité (`table.key.database`, les comparaisons d'onglets…). Même dérivation que
   * `moteurActuel` : depuis la déclaration, jamais devinée depuis ce que l'écran montre.
   */
  const libelleActuel = contexte
    ? projects
        .find((p) => p.name === contexte.project)
        ?.databases.find(
          (d) => d.name === contexte.database && d.environment === contexte.environment,
        )
        ?.label?.trim() || contexte.database
    : undefined

  // Le détail sert deux endroits : le panneau droit de `A4` (l'objet sélectionné) et la section
  // « Colonnes de *table* » de la sidebar (la table de l'onglet actif). Une seule lecture, deux
  // lecteurs — la table de l'onglet actif étant aussi celle qu'on vient de sélectionner.
  // **Trois sources, dans cet ordre** : l'onglet actif, l'objet sélectionné dans la liste du centre,
  // et — depuis `13c` — l'objet sélectionné dans l'arbre. Sans la troisième, ouvrir une console
  // faisait disparaître la section « Schéma déduit » de la sidebar, alors que c'est précisément là
  // qu'on la regarde : le mockup d'`A8` la montre pendant qu'on écrit une commande.
  const objetDeLArbre = selection?.kind === 'object' ? selection.label : null
  const cible = table?.table ?? (objetChoisi !== '' ? objetChoisi : null) ?? objetDeLArbre
  /**
   * Le compteur de relecture de la structure, jumeau de celui des lignes.
   *
   * Deux compteurs et non un : le rafraîchissement d'après écriture (`11d`) relit les lignes et
   * seulement elles — la structure n'a pas bougé, et la relire ferait un aller-retour par
   * enregistrement. **Sauf sur MongoDB** (`18g`), où la structure est déduite par échantillonnage
   * et *peut* avoir bougé : `surSucces`, plus bas, la relit aussi dans ce seul cas.
   */
  const [relectureStructure, setRelectureStructure] = useState(0)
  const { detail, loading, error } = useDetailTable(
    cle,
    contexte?.schema ?? null,
    cible,
    passerelleDetail,
    structures,
    relectureStructure,
  )

  /** Oublie la structure d'une table, puis la redemande : ce que fait « Rafraîchir ». */
  const relireLaStructure = useCallback(
    (schema: string, nom: string) => {
      if (!cle) return
      structures.oublier(cle, schema, nom)
      setRelectureStructure((precedent) => precedent + 1)
    },
    [cle, structures],
  )

  // **La vue est un état d'onglet, pas d'écran.** Deux tables ouvertes peuvent être regardées
  // différemment, et revenir sur un onglet doit le retrouver comme on l'a laissé — c'est déjà la
  // règle des modifications en attente (`11b`) et du texte des consoles (`12a`).
  const [vues, setVues] = useState<Record<string, VueObjet>>({})

  const idActif = actif ? idOnglet(actif) : null
  const enEdition = edition || (idActif !== null && ongletsEnEdition.has(idActif))
  const vue: VueObjet = idActif === null ? 'donnees' : (vues[idActif] ?? 'donnees')
  const structureActive = table !== null && vue === 'structure'
  const attente = idActif === null ? [] : (attentes[idActif] ?? [])

  /** Pose l'attente de l'onglet actif. Un seul propriétaire de cet état, décidé en `11b`. */
  const onAttenteChange = useCallback(
    (suivante: EnAttente) => {
      if (idActif === null) return
      setAttentes((precedent) => ({ ...precedent, [idActif]: suivante }))
    },
    [idActif],
  )

  // Le SQL de `11c` vient du **moteur**, jamais de l'écran : composer un équivalent ici produirait
  // un texte *ressemblant* à celui qui partira, sous un titre qui promet l'exactitude.
  const [rafraichissement, setRafraichissement] = useState(0)
  /**
   * Les écritures de console en attente, par identité d'onglet.
   *
   * **Sans amortissement, chaque touche réécrit le fichier de configuration entier** — projets,
   * connexions, préférences — et une frappe soutenue en produirait des dizaines par seconde. Le
   * fichier est réécrit de façon atomique, donc rien ne se corrompt, mais c'est du travail disque pur
   * pour un état intermédiaire que personne ne lira.
   *
   * Le texte à l'écran, lui, n'attend jamais : il vit dans `textes`, et seul le voyage vers le disque
   * est retardé.
   */
  const ecrituresEnAttente = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // Les minuteurs ne survivent pas à l'écran : un onglet fermé pendant qu'une écriture attend n'a
  // plus de raison de l'envoyer, et le minuteur garderait la fermeture en mémoire pour rien.
  useEffect(() => {
    const enAttente = ecrituresEnAttente.current
    return () => {
      for (const minuteur of Object.values(enAttente)) clearTimeout(minuteur)
    }
  }, [])

  /**
   * Renomme une console, et fait suivre tout ce qui la désigne.
   *
   * **Trois choses bougent avec le nom**, et en oublier une casse quelque chose de visible :
   * l'onglet ouvert (son libellé *et* son identité, qui dérive du nom), le texte indexé par cette
   * identité — sans quoi l'éditeur se rouvrirait vide — et l'association qui dit où écrire, faute de
   * quoi la frappe suivante viserait un nom que le disque ne connaît plus.
   */
  const renommerUneConsole = useCallback(
    async (
      project: string,
      database: string,
      environment: EnvironmentId,
      nom: string,
      nouveau: string,
    ) => {
      if (onRenameConsole === undefined) return
      await onRenameConsole(project, database, environment, nom, nouveau)
      setEtatOnglets((etat) =>
        renommerLaConsole(etat, { project, database, environment }, nom, nouveau),
      )
      const ancienId = idDeConsolePersistee({ project, database, environment }, nom)
      const nouvelId = idDeConsolePersistee({ project, database, environment }, nouveau)
      setTextes((precedent) => {
        const texte = precedent[ancienId]
        if (texte === undefined) return precedent
        const { [ancienId]: _oublie, ...reste } = precedent
        return { ...reste, [nouvelId]: texte }
      })
      setConsolesOuvertes((precedent) => {
        if (!(ancienId in precedent)) return precedent
        const { [ancienId]: _oubliee, ...reste } = precedent
        return { ...reste, [nouvelId]: { project, database, environment, nom: nouveau } }
      })
    },
    [onRenameConsole],
  )

  /**
   * Renomme une connexion, et fait suivre tout ce qui portait son nom (`26`).
   *
   * **L'écran de travail est le seul à pouvoir le faire.** La sidebar porte le geste, mais elle ne
   * connaît pas les onglets ; le cœur déplace le secret et ferme la connexion, mais il ne sait rien
   * de ce qui est ouvert. Quatre tables indexées par identité d'onglet vivent ici, et en oublier une
   * casse quelque chose de visible : le texte d'une console, ses modifications en attente, son mode
   * édition, et l'association qui dit où écrire.
   *
   * **Le refus n'est pas capturé** : il remonte à la sidebar, qui a ouvert le champ de saisie et sait
   * l'afficher. Le capturer ici renommerait sans rien renommer, en silence.
   */
  const renommerUneConnexion = useCallback(
    async (
      project: string,
      database: string,
      environment: EnvironmentId,
      nouveau: string,
    ): Promise<{ missingSecrets: string[]; leftoverSecrets: string[] }> => {
      if (onRenameDatabase === undefined) {
        return { missingSecrets: [], leftoverSecrets: [] }
      }
      const issue = await onRenameDatabase(project, database, environment, nouveau)
      const key = { project, database, environment }

      // **Les structures partent avec l'ancienne clé** : le cœur vient de fermer cette
      // connexion, et ce qui reste en mémoire sous son ancien nom ne sera plus jamais lu — sauf par
      // une connexion homonyme recréée plus tard, qui lirait la structure d'une autre base. La file
      // de préchauffage en cours est annulée dans le même geste.
      structures.oublierLaConnexion(key)

      setEtatOnglets((etat) => renommerLaConnexion(etat, key, nouveau))
      setTextes((precedent) => reindexerParConnexion(precedent, key, nouveau))
      setAttentes((precedent) => reindexerParConnexion(precedent, key, nouveau))
      setOngletsEnEdition(
        (precedent) => new Set([...precedent].map((id) => idApresRenommage(id, key, nouveau))),
      )
      // **La sélection de l'arbre est relâchée** si elle visait cette connexion ou l'un de ses
      // descendants. Les identités de l'arbre portent le nom de la base (`d:projet/env/base`) :
      // celles-là n'existent plus. Les réécrire aurait gardé le surlignage, mais aussi les schémas
      // déjà chargés — sur une connexion que le cœur vient de **fermer**. Une ligne repliée et une
      // sélection relâchée disent la vérité ; un arbre qui montre le contenu d'une connexion fermée,
      // non.
      setSelection((precedent) =>
        precedent !== null &&
        precedent.project === project &&
        precedent.database === database &&
        precedent.environment === environment
          ? null
          : precedent,
      )
      // **La valeur bouge autant que la clé** : elle porte le nom de la connexion, et c'est elle que
      // la frappe suivante enverra à `save_console`.
      setConsolesOuvertes((precedent) =>
        Object.fromEntries(
          Object.entries(precedent).map(([id, ouverte]) => [
            idApresRenommage(id, key, nouveau),
            ouverte.project === project &&
            ouverte.database === database &&
            ouverte.environment === environment
              ? { ...ouverte, database: nouveau }
              : ouverte,
          ]),
        ),
      )
      return issue
    },
    [onRenameDatabase, structures],
  )

  /**
   * Crée une console sous un nom par défaut, et rend ce nom.
   *
   * **Aucune modale ne le demande** (20 août 2026). Nommer avant d'avoir écrit revient à demander un
   * titre pour une page blanche : on ne sait pas encore ce que la console contiendra, donc on tape
   * n'importe quoi et on le regrette. « console 1 » suffit, et le double-clic sur la ligne renomme
   * quand le contenu a fini par dire de quoi il s'agit.
   *
   * Le numéro est le plus petit disponible **sur cette connexion**, comme pour les brouillons
   * d'onglets : après avoir retiré « console 2 », la suivante reprend ce numéro plutôt que d'afficher
   * « console 3 » à côté d'une « console 1 » solitaire.
   */
  const creerUneConsole = useCallback(
    async (project: string, database: string, environment: EnvironmentId, sql = '') => {
      if (onCreateConsole === undefined) return undefined
      const pris = new Set(
        consolesDe(projects, { project, database, environment }).map((console) => console.name),
      )
      let numero = 1
      while (pris.has(`console ${numero}`)) numero += 1
      const nom = `console ${numero}`

      await onCreateConsole(project, database, environment, nom)
      if (sql !== '' && onSaveConsole) {
        await onSaveConsole(project, database, environment, nom, sql)
      }

      /* **Créer ouvre.** Le pied de la sidebar ne porte plus de bouton « Nouvelle console » depuis le
         20 août 2026 : le menu « … » d'une connexion est le seul chemin, et s'il fallait ensuite
         retrouver la console dans l'arbre pour la cliquer, créer coûterait deux gestes au lieu d'un.
         Personne ne crée une console pour ne pas l'ouvrir. */
      setEtatOnglets((etat) =>
        ouvrirConsole(
          etat,
          { project, database, environment },
          dialecteDe(project, database, environment),
          nom,
        ),
      )
      const id = idDeConsolePersistee({ project, database, environment }, nom)
      setConsolesOuvertes((precedent) => ({
        ...precedent,
        [id]: { project, database, environment, nom },
      }))
      setTextes((precedent) => ({ ...precedent, [id]: sql }))
      return nom
    },
    [onCreateConsole, onSaveConsole, projects, dialecteDe],
  )
  /**
   * Quelle console **persistée** chaque onglet ouvre, par identité d'onglet.
   *
   * **C'est ce qui distingue un onglet volatile d'un onglet relié au disque.** Le bouton « Nouvelle
   * console » du pied ouvre un brouillon qui ne survit pas à sa fermeture ; un clic sur une console
   * de l'arbre ouvre un onglet dont chaque frappe est écrite. Sans cette table, la frappe ne saurait
   * pas où écrire — et écrire dans « la console du contexte » viserait la mauvaise dès que deux
   * onglets sont ouverts sur deux connexions.
   */
  const [consolesOuvertes, setConsolesOuvertes] = useState<
    Readonly<
      Record<string, { project: string; database: string; environment: EnvironmentId; nom: string }>
    >
  >({})
  // L'exécution des requêtes de console (`12c`). Elle vit ici parce que la confirmation est une
  // sous-modale de l'écran, comme celle de `11d`.
  /**
   * **La clé d'exécution est celle de la console ouverte**, non celle du contexte de l'arbre.
   *
   * `contexte` exige un schéma — il sert la liste d'objets du centre — et une console n'en a pas :
   * une console sélectionnée dans l'arbre laissait donc `cle` à `null`, et l'éditeur ne montait
   * plus. Or une console *sait* sur quoi elle porte, depuis `12a` : sa propre `key`. La lui demander
   * est à la fois ce qui répare le montage et ce qui est juste — deux onglets ouverts sur deux
   * connexions ne doivent pas exécuter sur celle que l'arbre montre.
   */
  const cleConsole: DatabaseKey | null = consoleActive?.key ?? cle
  const execution = useExecution(cleConsole, passerelleExecution ?? PASSERELLE_EXECUTION)

  /**
   * Les colonnes des tables **déjà lues**, accumulées.
   *
   * **Ni `table` ni `cible` ne suffisaient.** Quand une console est l'onglet actif, `table` est nul par
   * construction et `cible` l'est aussi dès qu'aucun objet n'est sélectionné dans le centre :
   * l'autocomplétion des colonnes n'avait alors jamais rien à proposer, ce qui vidait `12d` de son
   * contenu. Vu en écrivant son e2e, où la liste ne s'ouvrait pas.
   *
   * Une entrée par table ouverte, donc borné par ce que l'utilisateur a consulté.
   */
  const [colonnesConnues, setColonnesConnues] = useState<
    Readonly<Record<string, readonly { name: string; typeName: string }[]>>
  >({})

  /**
   * Ce que l'autocomplétion de `12d` propose : **ce que l'écran a déjà chargé**.
   *
   * Les tables viennent de l'arbre (`09d`), les colonnes du détail de la table ouverte (`06c`).
   * Interroger le serveur à chaque frappe ajouterait une latence à l'endroit le plus sensible de
   * l'écran — et ces données sont déjà en mémoire.
   */
  // Le détail lu entre dans le catalogue de l'autocomplétion. `detail.name` plutôt que la cible
  // demandée : c'est la table que le moteur a réellement décrite.
  useEffect(() => {
    if (!detail) return
    setColonnesConnues((connues) =>
      connues[detail.name]
        ? connues
        : {
            ...connues,
            [detail.name]: detail.columns.map((c) => ({ name: c.name, typeName: c.typeName })),
          },
    )
  }, [detail])

  /**
   * Les schémas de la connexion courante, tels que l'arbre les connaît **dès l'ouverture** — pas
   * seulement celui que l'écran affiche. `listSchemas` les lit tous sans qu'aucun ait été déplié,
   * ce qui rend `sch.` reconnaissable comme un schéma même si `sch` n'est pas le schéma courant.
   *
   * **`cleConsole`, pas `cle`.** `cle` vient de `contexte`, lui-même dérivé de la sélection de
   * l'arbre — `null` tant qu'aucun schéma n'y a jamais été cliqué. Une console ouverte depuis le menu
   * de sa connexion, sans être jamais passée par un schéma, se retrouvait alors sans aucun catalogue :
   * ni schémas, ni tables, ni mots-clés proposés, silencieusement. `cleConsole` porte l'identité de la
   * connexion **de la console elle-même** (`12a`), déjà employée pour l'exécution par la même raison.
   */
  const schemasDeLaConnexion = useMemo(
    () =>
      cleConsole
        ? (charge.schemas[
            idBase(cleConsole.project, cleConsole.environment, cleConsole.database)
          ] ?? [])
        : [],
    [charge.schemas, cleConsole],
  )

  /**
   * Les tables **par schéma** — de l'arbre en priorité (ce que l'utilisateur a déplié lui-même), du
   * préchauffage sinon.
   *
   * `structures.prechauffer` liste **tous** les schémas de la connexion en fond dès son ouverture,
   * pas seulement celui affiché à l'écran (`useStructures`) : c'est ce qui rend `sch.` complétable
   * pour un schéma que l'utilisateur n'a jamais déplié dans l'arbre — même principe que
   * `colonnesPrechauffees` pour les colonnes d'une table. Un schéma que ni l'un ni l'autre n'a encore
   * lu n'a toujours pas d'entrée : `sch.` ne propose alors rien, plutôt que de deviner.
   *
   * `cleConsole`, pour la même raison que `schemasDeLaConnexion` ci-dessus.
   */
  const tablesParSchema = useMemo(() => {
    if (!cleConsole) return {}
    const par: Record<string, readonly string[]> = {}
    for (const schema of schemasDeLaConnexion) {
      const objetsDeLArbre =
        charge.objets[
          idSchema(cleConsole.project, cleConsole.environment, cleConsole.database, schema.name)
        ]
      const objetsDuSchema = objetsDeLArbre ?? structures.objetsDuSchema(cleConsole, schema.name)
      if (objetsDuSchema) par[schema.name] = objetsDuSchema.map((objet) => objet.name)
    }
    return par
  }, [cleConsole, schemasDeLaConnexion, charge.objets, structures])

  /**
   * Les colonnes que le **préchauffage** a déjà lues, sans que l'utilisateur les ait ouvertes —
   * **toutes les tables de tous les schémas connus** de la connexion, pas seulement celles du schéma
   * courant.
   *
   * **La première version ne parcourait que `objets`** — les tables du schéma affiché à l'écran. Une
   * table d'un *autre* schéma, atteinte par `sch.table.`, n'avait donc jamais ses colonnes proposées
   * même une fois lue par la cascade de fond : `structures.detail` la connaissait déjà, mais rien
   * n'allait la chercher. `tablesParSchema` couvre déjà tous les schémas pour les *noms* de table ;
   * boucler dessus plutôt que sur `objets` couvre les mêmes schémas pour leurs *colonnes*.
   *
   * `useStructures` précharge en fond jusqu'à `PLAFOND` tables par connexion dès son ouverture : la
   * donnée existe donc souvent déjà en mémoire pour une table que l'utilisateur n'a jamais affichée
   * dans l'onglet Table ou Structure, et la lui refuser reviendrait à demander un aller-retour réseau
   * que le cache a déjà payé. `colonnesConnues` garde la priorité — c'est la lecture la plus directe,
   * celle de la table réellement ouverte — cette source ne comble que ce qu'elle n'a pas.
   */
  const colonnesPrechauffees = useMemo(() => {
    if (!cleConsole) return {}
    const colonnes: Record<string, readonly { name: string; typeName: string }[]> = {}
    for (const [schema, tables] of Object.entries(tablesParSchema)) {
      for (const table of tables) {
        if (colonnesConnues[table]) continue
        const lu = structures.detail(cleConsole, schema, table)
        if (lu) colonnes[table] = lu.columns.map((c) => ({ name: c.name, typeName: c.typeName }))
      }
    }
    return colonnes
  }, [tablesParSchema, colonnesConnues, structures, cleConsole])

  const catalogue = useCallback(
    () => ({
      tables: objets.map((objet) => objet.name),
      colonnes: { ...colonnesPrechauffees, ...colonnesConnues },
      schemas: schemasDeLaConnexion.map((schema) => schema.name),
      tablesParSchema,
    }),
    [objets, colonnesConnues, colonnesPrechauffees, schemasDeLaConnexion, tablesParSchema],
  )
  // Le texte de chaque console, indexé par l'identité de l'onglet — comme les modifications en
  // attente de `11b`. Fermer une console perd son texte, et c'est `12f` qui donnera le moyen de le
  // garder pour les requêtes qu'on choisit d'enregistrer.
  const [textes, setTextes] = useState<Readonly<Record<string, string>>>({})
  const application = useApplication(cle, table, attente, detail?.columns ?? [], {
    passerelle: passerelleApply ?? PASSERELLE_APPLY,
    // **Le drapeau de la déclaration, non l'identifiant** (`23g`) : la confirmation d'écriture doit
    // s'ouvrir pour un environnement nommé « live » et marqué production, et rester fermée pour un
    // « prod » que l'utilisateur n'a pas marqué.
    production: environnementIndique?.production ?? false,
    // **Après le succès, la grille est relue et le modèle vidé.** Les valeurs écrites peuvent
    // différer de celles saisies — un `trigger`, une valeur par défaut, une troncature — et
    // afficher la saisie donnerait un écran qui ne reflète plus la base. Vider le modèle fait
    // disparaître d'un coup toutes les marques de `11b`, sans en effacer aucune à la main.
    surSucces: () => {
      onAttenteChange([])
      // Un compteur qui descend jusqu'à la grille, plutôt qu'une fonction de relecture remontée
      // depuis elle : l'écriture part du panneau droit, la lecture vit dans le centre.
      setRafraichissement((tour) => tour + 1)
      // **La structure aussi, mais seulement pour MongoDB** (`18g`) : ses colonnes sont *déduites*
      // par échantillonnage, et un champ neuf qu'un document venait d'introduire — visible pendant
      // l'édition grâce aux colonnes synthétiques de `TableView` — redevenait invisible sitôt
      // `attente` vidée, alors qu'il existe bel et bien en base. SQL n'a pas ce problème : sa
      // structure est déclarée, une ligne écrite ne la change jamais, et lui infliger un aller-retour
      // par écriture serait le coût que le commentaire de `relectureStructure` refuse déjà.
      if (moteurActuel === 'mongodb' && table) relireLaStructure(table.schema, table.table)
    },
  })

  const sqlPrevu = useSqlPrevu(
    cle,
    table,
    attente,
    detail?.columns ?? [],
    passerellePreview ?? PASSERELLE_PREVIEW,
  )

  /**
   * `⌘E` bascule le mode édition de l'onglet actif.
   *
   * `10c` avait retiré « ⌘E pour éditer » de la barre d'état faute d'écran qui l'honore — un
   * raccourci affiché qui ne répond pas est pire qu'un raccourci absent (`09e`). Il répond
   * maintenant, et le rappel revient.
   */
  useEffect(() => {
    if (idActif === null) return
    function auClavier(evenement: KeyboardEvent) {
      if (!evenement.metaKey || evenement.key !== 'e') return
      evenement.preventDefault()
      setOngletsEnEdition((precedent) => {
        const suivant = new Set(precedent)
        // **Quitter le mode garde les modifications en attente** : les perdre sur une frappe serait
        // le défaut qu'`esc` fermant une modale pleine a déjà produit.
        if (suivant.has(idActif as string)) suivant.delete(idActif as string)
        else suivant.add(idActif as string)
        return suivant
      })
    }
    window.addEventListener('keydown', auClavier)
    return () => window.removeEventListener('keydown', auClavier)
  }, [idActif])

  function ouvrirTable(objet: TableSummary) {
    if (!contexte) return
    setEtatOnglets((etat) =>
      ouvrir(etat, {
        sorte: 'table',
        key: {
          project: contexte.project,
          database: contexte.database,
          environment: contexte.environment,
        },
        schema: contexte.schema,
        table: objet.name,
        kind: objet.kind === 'view' ? 'view' : 'table',
      }),
    )
  }

  /**
   * Le centre de l'écran : la bande d'onglets, puis ce que l'onglet actif ouvre.
   *
   * **Extrait dans une variable, et c'est un correctif.** `12a` l'avait *copié* dans les deux
   * branches — console pleine largeur, ou partage avec le panneau droit — et les deux copies avaient
   * déjà divergé de seize lignes : les ajouts de `12c` à `12e` n'étaient allés que dans la première.
   * Un bloc dupliqué se répare une fois sur deux.
   */
  const centre = (
    <div className={styles.centre}>
      <WorkbenchTabs
        etat={etatOnglets}
        onSelect={(id) => setEtatOnglets((etat) => ({ ...etat, actif: id }))}
        onClose={(id) => setEtatOnglets((etat) => fermer(etat, id))}
        onReorder={(ids) => setEtatOnglets((etat) => reordonner(etat, ids))}
        /* **Le même geste qu'au double-clic sur la ligne d'arbre.** Une console se rencontre aux
           deux endroits, et n'être renommable qu'à l'un des deux obligerait à se souvenir lequel.
           L'identité de l'onglet dit quelle console renommer : c'est `consolesOuvertes` qui la
           porte, la bande d'onglets ne connaissant pas les connexions. */
        onRename={
          onRenameConsole === undefined
            ? undefined
            : (id, nouveau) => {
                const ouverte = consolesOuvertes[id]
                if (ouverte === undefined) return
                void renommerUneConsole(
                  ouverte.project,
                  ouverte.database,
                  ouverte.environment,
                  ouverte.nom,
                  nouveau,
                )
              }
        }
      />
      {consoleActive && cleConsole ? (
        // La console SQL (`12a`). Elle occupe la largeur du centre ; le panneau droit
        // reste celui de l'écran, et `12c` lui donnera un contenu utile.
        <ConsoleView
          // **Une instance par console, et `12b` lui donne sa raison** : CodeMirror tient
          // son propre document, donc sans remontage la seconde console afficherait le
          // texte de la première. `12a` avait retiré cette `key` faute de garantie
          // mesurable — elle en a une maintenant.
          key={idOnglet(consoleActive)}
          dialecte={consoleActive.dialecte}
          rowHeight={rowHeight}
          texte={textes[idOnglet(consoleActive)] ?? ''}
          onTexteChange={(texte) => {
            const id = idOnglet(consoleActive)
            setTextes((precedent) => ({ ...precedent, [id]: texte }))
            // **La frappe écrit, quand l'onglet est relié à une console persistée.** Un onglet
            // volatile — celui du bouton « Nouvelle console » — ne l'est pas, et son texte reste en
            // mémoire jusqu'à ce qu'on lui donne un nom.
            const console = consolesOuvertes[id]
            if (console && onSaveConsole) {
              clearTimeout(ecrituresEnAttente.current[id])
              ecrituresEnAttente.current[id] = setTimeout(() => {
                delete ecrituresEnAttente.current[id]
                void onSaveConsole(
                  console.project,
                  console.database,
                  console.environment,
                  console.nom,
                  texte,
                )
              }, DELAI_ECRITURE)
            }
          }}
          contexte={contexte ? `${libelleActuel} · ${contexte.schema}` : undefined}
          onExecuter={execution.demander}
          onExecuterLaSelection={execution.demander}
          enCours={execution.enCours}
          resultat={execution.resultat}
          erreur={execution.erreur}
          // **Une fonction, pas une valeur** : elle est lue au moment de la frappe, donc une
          // table ouverte après le montage de la console voit ses colonnes proposées.
          catalogue={catalogue}
          vue={execution.vue}
          onVueChange={execution.setVue}
          /* **« Enregistrer » donne un nom à un brouillon**, et le fait exister dans l'arbre. Sur un
             onglet déjà relié à une console, il n'a plus d'objet : chaque frappe est déjà écrite. */
          /* **« Enregistrer » fait exister le brouillon**, sans rien demander : il reçoit le nom par
             défaut, et l'onglet cesse d'être volatile — les frappes suivantes s'écrivent toutes
             seules. Sur un onglet déjà relié à une console, le bouton n'a plus d'objet. */
          onEnregistrer={
            onCreateConsole === undefined || consolesOuvertes[idOnglet(consoleActive)] !== undefined
              ? undefined
              : async (sql) => {
                  const { project, database, environment } = cleConsole
                  const nom = await creerUneConsole(project, database, environment, sql)
                  if (nom === undefined) return
                  const id = idDeConsolePersistee({ project, database, environment }, nom)
                  setEtatOnglets((etat) => baptiserLeBrouillon(etat, idOnglet(consoleActive), nom))
                  setConsolesOuvertes((precedent) => ({
                    ...precedent,
                    [id]: { project, database, environment, nom },
                  }))
                  setTextes((precedent) => ({ ...precedent, [id]: sql }))
                }
          }
        />
      ) : structureActive && table ? (
        // La structure de la table ouverte (`14a` → `14c`). **Aucune lecture nouvelle** : `detail`
        // est celui que la sidebar et le panneau droit lisent déjà.
        <StructureView detail={detail} schema={table.schema} loading={loading} error={error} />
      ) : table && cle ? (
        // Les lignes de la table ouverte (`10c`). La toolbar (`10e`) et le panneau
        // de ligne (`10f`) viendront l'entourer.
        <TableView
          // Une instance par onglet : changer de table remonte la vue, donc remet
          // filtres et tri à zéro sans effet de nettoyage.
          key={`${table.key.project}/${table.key.database}/${table.schema}.${table.table}`}
          cle={cle}
          schema={table.schema}
          table={table.table}
          moteur={moteurActuel}
          columns={detail?.columns ?? []}
          passerelle={passerelleLignes}
          onEtatChange={setEtatRequete}
          onLectureChange={setLecture}
          rang={rangChoisi}
          onRangChange={setRangChoisi}
          edition={enEdition}
          rafraichissement={rafraichissement}
          // Le « Rafraîchir » de la toolbar relit **ce que l'écran montre** : les lignes, que
          // la vue sait relire seule, et la structure, qui vit ici.
          onRelireLaStructure={() => relireLaStructure(table.schema, table.table)}
          // L'animation ne s'arrête que quand les **deux** ont répondu ; la vue connaît l'état de ses
          // lignes, celui de la structure vient d'ici.
          structureEnCours={loading}
          attente={attente}
          onAttenteChange={onAttenteChange}
          rowHeight={rowHeight}
        />
      ) : (
        <>
          <BreadcrumbBar
            database={libelleActuel ?? '—'}
            engine={moteurActuel}
            schema={contexte?.schema ?? '—'}
            counts={comptes(objets)}
            type={type}
            onTypeChange={setType}
            filter={filtre}
            onFilterChange={setFiltre}
          />
          <ObjectTable
            schema={contexte?.schema ?? ''}
            objects={visibles}
            type={type}
            selectedName={objetChoisi}
            onSelect={(objet) => setObjetChoisi(objet.name)}
            onOpen={ouvrirTable}
          />
        </>
      )}
    </div>
  )

  const projetAEditer =
    aEditer === null ? null : (projects.find((projet) => projet.name === aEditer.name) ?? aEditer)

  return (
    <div className={styles.root}>
      {/* La modale d'édition de projet (`23e`). Montée une fois pour les deux points d'entrée. */}
      {projetAEditer !== null && onRenameProject !== undefined && (
        <ProjectEditor
          projet={projetAEditer}
          onClose={() => setAEditer(null)}
          onProjets={(suivants) => onProjets?.(suivants)}
          {...gestesEnvironnement}
          onRenameProject={async (nom) => {
            const issue = await onRenameProject(projetAEditer.name, nom)
            // Le projet a changé de nom : l'état qui le désignait par l'ancien ne trouverait plus
            // rien, et la modale se fermerait d'elle-même sans que l'utilisateur l'ait demandé.
            setAEditer({ ...projetAEditer, name: nom })
            return issue
          }}
        />
      )}
      <TitleBar
        onOpenPreferences={onOpenPreferences}
        // **Rien du tout quand rien n'est sélectionné** (`25b`), et aucune empreinte réservée : un
        // `.center` vide a une hauteur de zéro sans rien déplacer — la barre garde ses 40 px, le
        // wordmark et les actions ne bougent pas. C'est déjà ce que `A1` montre dans le handoff.
        center={
          indication === null ? undefined : (
            <SelectionIndicator
              pendingChanges={attente.length}
              projectName={indication.project}
              environment={
                environnementIndique === null
                  ? undefined
                  : {
                      label: environnementIndique.label,
                      color: environnementIndique.color,
                      production: environnementIndique.production,
                    }
              }
              breadcrumb={contexte ? `${libelleActuel} · ${contexte.schema}` : undefined}
              connection={
                contexte
                  ? etatDeBase(contexte.project, contexte.database, contexte.environment)
                  : undefined
              }
            />
          )
        }
      />
      {/* Le bandeau du mode édition, **sous la barre de titre** et au-dessus du corps : c'est là que
          le mockup le place, et il court sur toute la largeur. */}
      {/* Les deux modales de nommage ont disparu le 20 août 2026 : la création prend un nom par
          défaut, et le renommage se fait sur la ligne de l'arbre. */}
      {execution.aConfirmer && (
        <RunConfirm
          nature={execution.aConfirmer.nature}
          sansRestriction={execution.aConfirmer.sansWhere}
          cible={contexte ? `${libelleActuel} · ${contexte.schema}` : '—'}
          // **Le drapeau de production, non le libellé** (`23g`) : un environnement nommé « live » et
          // marqué production doit porter l'encart rouge, et un environnement nommé « prod » que
          // l'utilisateur n'a pas marqué ne doit pas. Comparer une chaîne rendrait la garantie fausse
          // au premier renommage.
          production={environnementIndique?.production ?? false}
          enCours={execution.enCours}
          onClose={execution.annulerLaConfirmation}
          onConfirmer={execution.executer}
        />
      )}
      {application.confirmation && table && (
        <ApplyConfirm
          attente={attente}
          table={`${table.schema}.${table.table}`}
          enCours={application.enCours}
          onClose={application.annulerLaConfirmation}
          onConfirmer={application.appliquer}
        />
      )}
      <div className={styles.body}>
        <SplitPane
          storageKey="workbench:sidebar"
          // **228 et 196, contre 212 et 180** (`25a`). Le palier d'environnement pousse les objets à
          // 68 px d'indentation : à 180 px de colonne, un nom de table disposait de cinq caractères —
          // formellement correct, illisible. Les 16 px ajoutés au plancher et au défaut rendent au
          // palier le plus profond le budget de libellé qu'il avait avant le palier.
          defaultSize={228}
          min={196}
          max={360}
          start={
            <ExplorerSidebar
              // **212 px, la largeur standard de `A5` → `A9`, y compris quand le centre montre
              // `A4`.** Le handoff donne 252 px à `A4` et 212 aux écrans de travail ; dans une
              // coquille unique, ce ne peut pas être les deux — la colonne sauterait de 40 px à
              // l'ouverture d'un onglet. Le `SplitPane` la rend de toute façon réglable, ce
              // qu'un mockup figé ne peut pas exprimer. Écart consigné dans `AGENTS.md`.
              width="fill"
              projects={projects}
              deplies={deplies}
              charge={charge}
              etatDe={etatDeBase}
              // La pastille de compte sur la table ouverte (`11b`) : le même modèle que le bandeau.
              modifications={
                table && attente.length > 0
                  ? { table: table.table, schema: table.schema, compte: attente.length }
                  : undefined
              }
              // Le « … » d'une ligne de base mène à la même modale que le menu de la pastille
              // (`08g`) : deux chemins vers un seul écran, et c'est voulu — l'arbre est là où
              // l'utilisateur regarde ses bases, la pastille là où il regarde son projet.
              // La sidebar nomme la base ; le projet, lui, connaît son objet `Database`.
              onEditDatabase={(nomProjet, nomBase, environnement) => {
                const base = projects
                  .find((projet) => projet.name === nomProjet)
                  ?.databases.find(
                    (declaration) =>
                      declaration.name === nomBase && declaration.environment === environnement,
                  )
                if (base) onEditDatabase?.(nomProjet, base)
              }}
              onRenameDatabase={onRenameDatabase === undefined ? undefined : renommerUneConnexion}
              onEditProject={onRenameProject === undefined ? undefined : ouvrirLEditionDe}
              consoles={
                onCreateConsole === undefined
                  ? undefined
                  : {
                      onCreer: (project, database, environment) => {
                        void creerUneConsole(project, database, environment)
                      },
                      onRenommer: (project, database, environment, nom, nouveau) => {
                        void renommerUneConsole(project, database, environment, nom, nouveau)
                      },
                      onRetirer: (project, database, environment, nom) => {
                        if (onDeleteConsole === undefined) return
                        void onDeleteConsole(project, database, environment, nom)
                        // L'onglet ouvert sur cette console se ferme avec elle : le laisser
                        // écrirait dans une console retirée à la frappe suivante.
                        setConsolesOuvertes((precedent) =>
                          Object.fromEntries(
                            Object.entries(precedent).filter(
                              ([, ouverte]) =>
                                !(
                                  ouverte.project === project &&
                                  ouverte.database === database &&
                                  ouverte.environment === environment &&
                                  ouverte.nom === nom
                                ),
                            ),
                          ),
                        )
                      },
                    }
              }
              // **Retirer une base ferme ses onglets**, et l'écran de travail est le seul à pouvoir
              // le faire : un onglet survivant lirait une base dont la déclaration est partie.
              onDelete={
                onDelete === undefined
                  ? undefined
                  : async (cible) => {
                      const issue = await onDelete(cible)
                      setEtatOnglets((etat) => sansLesOngletsDe(etat, cible))
                      setAttentes((precedent) =>
                        Object.fromEntries(
                          Object.entries(precedent).filter(([id]) => !viseeParLId(cible, id)),
                        ),
                      )
                      return issue
                    }
              }
              // Ce qui serait perdu, compté **avant** de le perdre : la confirmation le dit.
              modificationsEnAttenteDe={(cible) =>
                Object.entries(attentes)
                  .filter(([id]) => viseeParLId(cible, id))
                  .reduce((total, [, enAttente]) => total + enAttente.length, 0)
              }
              selectedId={selection?.id ?? null}
              onSelect={(noeud) => {
                setSelection(noeud)
                // **Sélectionner charge ce qu'on va regarder**, le dépliage n'étant plus le geste du
                // clic : un schéma sélectionné mais jamais déplié montrerait sinon une liste d'objets
                // vide dans `A4`. Sur une connexion, cela ouvre la connexion — ce que le clic simple
                // faisait déjà quand il dépliait, et ce qui rend vraie la pastille d'état de sa ligne.
                // Sans effet sur ce qui est déjà chargé.
                charger(noeud)
                // Une **feuille** de l'arbre est un objet : la sélectionner l'ouvre. Un simple
                // clic suffit, parce qu'une feuille n'a pas d'autre geste — pas de dépliage à
                // distinguer. Dans la liste du centre, où sélectionner remplit le panneau de
                // détail, il faut au contraire un double-clic.
                // **Aucun repli sur un environnement d'écran** : ces gardes portaient
                // `noeud.environment ?? environnement`, donc un nœud sans environnement ouvrait la
                // connexion d'un environnement arbitraire — sur le mauvais serveur, sans le dire.
                // Tout nœud d'objet en porte un ; l'exiger le prouve au compilateur.
                if (
                  noeud.kind === 'object' &&
                  noeud.project &&
                  noeud.database &&
                  noeud.schema &&
                  noeud.environment
                ) {
                  setEtatOnglets((etat) =>
                    ouvrir(etat, {
                      sorte: 'table',
                      key: {
                        project: noeud.project as string,
                        database: noeud.database as string,
                        environment: noeud.environment as EnvironmentId,
                      },
                      schema: noeud.schema as string,
                      table: noeud.label,
                      kind: noeud.icon === 'view' ? 'view' : 'table',
                    }),
                  )
                }
                /* **Un clic sur une console l'ouvre**, comme un clic sur une table ouvre la table.
                   L'onglet est relié à la console : il porte son texte et lui renvoie chaque
                   frappe. Rouvrir une console déjà ouverte réactive son onglet plutôt que d'en
                   créer un second — c'est `ouvrirConsole` qui le garantit, par l'identité qu'on
                   lui donne. */
                if (
                  noeud.kind === 'console' &&
                  noeud.project &&
                  noeud.database &&
                  noeud.environment &&
                  noeud.console !== undefined
                ) {
                  const identite = {
                    project: noeud.project,
                    database: noeud.database,
                    environment: noeud.environment,
                    nom: noeud.console,
                  }
                  const texte =
                    projects
                      .find((projet) => projet.name === identite.project)
                      ?.databases.find(
                        (base) =>
                          base.name === identite.database &&
                          base.environment === identite.environment,
                      )
                      ?.consoles.find((console) => console.name === identite.nom)?.sql ?? ''
                  setEtatOnglets((etat) => {
                    const suivant = ouvrirConsole(
                      etat,
                      {
                        project: identite.project,
                        database: identite.database,
                        environment: identite.environment,
                      },
                      dialecteDe(identite.project, identite.database, identite.environment),
                      identite.nom,
                    )
                    const id = suivant.actif as string
                    setTextes((precedent) => ({ ...precedent, [id]: texte }))
                    setConsolesOuvertes((precedent) => ({ ...precedent, [id]: identite }))
                    return suivant
                  })
                }
              }}
              onToggle={basculer}
              onAddDatabase={onNewDatabase}
              onNewProject={onNewProject}
              onRefresh={rafraichirTout}
              // **La section suit l'objet lu, pas l'onglet ouvert.** Le mockup d'`A8` montre
              // « Schéma déduit » dans la sidebar *pendant* qu'une console est active : les champs
              // d'une collection sont ce qu'on regarde en écrivant une commande. La condition
              // portait sur `table`, ce qui faisait disparaître la section dès qu'on passait sur la
              // console — et rendait `13c` inatteignable.
              //
              // Les annotations, elles, restent propres à la vue de table : « filtré » et « tri ↓ »
              // décrivent l'état d'une grille, qui n'existe pas sous une console.
              columns={
                detail
                  ? {
                      table: detail.name,
                      columns: detail.columns,
                      loading,
                      annotations: table ? annotationsDe(etatRequete, attente) : undefined,
                    }
                  : undefined
              }
            />
          }
          end={
            // **Une console occupe toute la largeur du centre.** Le mockup d'`A7` ne montre pas de
            // panneau droit, et celui de `A5` proposerait ici de sélectionner une ligne d'un
            // résultat qui n'existe pas encore. Le centre est donc rendu seul ou dans le partage
            // selon ce que l'onglet ouvre. Vu à l'écran en assemblant `12a`.
            // **La structure, elle, entre dans le partage depuis `22`.** Elle en sortait parce
            // qu'elle portait sa propre colonne de DDL à droite, exactement là où le panneau de
            // détail se serait posé. Ce DDL étant maintenant dans la colonne commune, la structure
            // redevient un centre ordinaire, et sa largeur se règle avec la même poignée.
            rienAMontrer ? (
              // **Rien à montrer : ni fil d'Ariane à « — · — », ni liste d'objets vide, ni cadre de
              // détail d'un objet inexistant** — voir `AucuneSelection` pour la raison. Les deux
              // colonnes restent, vides : le partage garde la largeur réglée, et sa poignée avec
              // elle. La sidebar de gauche reste aussi — c'est là qu'on sélectionne.
              //
              // **Le même `storageKey` que le partage ordinaire, et c'est le point** : la largeur
              // survit à l'aller-retour entre un projet et une table, au lieu de retomber à 296 px.
              //
              // **Aucun cadre `ColonneDroite` ici.** Son en-tête existe pour le couple de vues et
              // les flèches de ligne (`22`), dont aucun n'a de sens sans table ouverte : il ne
              // resterait qu'une bande de 35 px et un filet qui ne prolonge rien.
              <SplitPane
                storageKey="workbench:detail"
                defaultSize={296}
                min={240}
                max={420}
                sized="end"
                start={<AucuneSelection />}
                end={<AucuneSelection variante="colonne" />}
              />
            ) : consoleActive ? (
              centre
            ) : (
              <SplitPane
                storageKey="workbench:detail"
                defaultSize={296}
                min={240}
                max={420}
                // **Le panneau dimensionné est celui de droite.** Sans cela, c'est le centre qui
                // recevait 296 px et la grille tombait à zéro pixel de large — défaut de `10b`,
                // constaté en mesurant `A5` le 10 août 2026.
                sized="end"
                start={centre}
                end={
                  // **Un seul panneau droit, dont le contenu suit l'écran** : le détail de l'objet
                  // en `A4`, la ligne sélectionnée en `A5`, les modifications en attente en `A6`,
                  // le DDL en `A9`. Les empiler donnerait deux panneaux là où le mockup n'en montre
                  // qu'un.
                  //
                  // **Le cadre, lui, est toujours là** (`22`) : il porte le couple de vues et les
                  // flèches de ligne, et aucun de ses contenus ne peut les faire disparaître.
                  //
                  // **En édition avec des modifications, ce panneau prend la place du détail** —
                  // conséquence assumée de `11c` : en éditant, ce qu'on veut voir est ce qu'on a
                  // changé, pas la ligne sélectionnée.
                  // Le panneau reste après une écriture réussie, pour montrer de quoi la défaire : le
                  // démonter avec la dernière carte emporterait le patch inverse.
                  <ColonneDroite
                    // Le couple n'a de sens que sur une table ouverte : en `A4`, il n'y a pas de
                    // table dont on basculerait la structure.
                    vue={table ? vue : undefined}
                    onVueChange={
                      idActif === null
                        ? undefined
                        : (suivante: VueObjet) =>
                            setVues((precedent) => ({ ...precedent, [idActif]: suivante }))
                    }
                    // Les flèches n'apparaissent qu'avec une ligne sélectionnée en vue Données —
                    // pas au-dessus d'un DDL, qui n'a pas de ligne suivante.
                    navigation={
                      !structureActive && lecture.rang !== null
                        ? {
                            rang: lecture.rang,
                            total: lecture.total,
                            onNavigate: setRangChoisi,
                          }
                        : undefined
                    }
                  >
                    {structureActive && detail ? (
                      <DdlPanel
                        detail={detail}
                        schema={table?.schema ?? ''}
                        onOuvrirDansLaConsole={
                          cle === null
                            ? undefined
                            : (ddl: string) =>
                                setEtatOnglets((etat) => {
                                  const suivant = ouvrirConsole(
                                    etat,
                                    cle,
                                    dialecteDe(cle.project, cle.database, cle.environment),
                                  )
                                  // Le DDL entre dans la console **qui vient d'être ouverte**, pas
                                  // dans celle qui était active : écraser le texte d'une console où
                                  // l'on travaillait perdrait une requête en cours d'écriture.
                                  if (suivant.actif) {
                                    setTextes((precedent) => ({
                                      ...precedent,
                                      [suivant.actif as string]: ddl,
                                    }))
                                  }
                                  return suivant
                                })
                        }
                      />
                    ) : structureActive ? null : table &&
                      cle &&
                      (attente.length > 0 || application.patchInverse !== null) ? (
                      <PendingPanel
                        attente={attente}
                        table={`${table.schema}.${table.table}`}
                        // **La déclaration, non l'identifiant** : l'encart rouge suit le drapeau
                        // `production` (`23g`), et le comparer à la chaîne « prod » le rendait faux
                        // pour un environnement nommé autrement — et faussement vrai pour un « prod »
                        // que l'utilisateur n'avait pas marqué.
                        production={environnementIndique?.production ?? false}
                        sql={sqlPrevu.sql}
                        erreurSql={sqlPrevu.erreur}
                        onRetirer={(cleLigne, column) =>
                          onAttenteChange(retirer(attente, cleLigne, column))
                        }
                        onToutAnnuler={() => onAttenteChange([])}
                        enCours={application.enCours}
                        refus={application.refus}
                        patchInverse={application.patchInverse}
                        onCopierLePatch={
                          application.patchInverse === null
                            ? undefined
                            : () => {
                                const texte = application.patchInverse
                                if (texte) void navigator.clipboard?.writeText(texte)
                              }
                        }
                        onAppliquer={application.demander}
                        onEcarterLePatch={application.ecarterLePatch}
                        onCopierLeSQL={
                          sqlPrevu.sql === null
                            ? undefined
                            : () => {
                                const texte = sqlPrevu.sql
                                if (texte) void navigator.clipboard?.writeText(texte)
                              }
                        }
                      />
                    ) : actif && cle ? (
                      <RowPanel
                        cle={cle}
                        columns={detail?.columns ?? []}
                        relations={detail?.relations ?? []}
                        ligne={lecture.ligne}
                        rang={lecture.rang}
                        onCopyInsert={
                          lecture.ligne
                            ? () => {
                                const valeurs = lecture.ligne
                                if (!valeurs) return
                                // La constante fige le rétrécissement de type : dans une closure,
                                // TypeScript ne peut pas savoir que `table` est encore non nul.
                                const ouverte = table
                                if (!ouverte) return
                                void rowAsInsert(cle, ouverte.schema, ouverte.table, valeurs).then(
                                  (sql) => navigator.clipboard?.writeText(sql),
                                )
                              }
                            : undefined
                        }
                        passerelleDetail={passerelleDetail}
                        passerelleLignes={passerelleLignes ?? PASSERELLE_LIGNES}
                      />
                    ) : (
                      <DetailPanel
                        detail={detail}
                        schema={contexte?.schema ?? ''}
                        loading={loading}
                        error={error}
                        onOpenData={() => {
                          const objet = objets.find((o) => o.name === objetChoisi)
                          if (objet) ouvrirTable(objet)
                        }}
                      />
                    )}
                  </ColonneDroite>
                }
              />
            )
          }
        />
      </div>
      {/* La barre d'état court sur toute la largeur, **sous les trois colonnes** — le mockup la
          place au niveau de la fenêtre, pas du centre. */}
      {/* **Sur `table`, pas sur `actif`** : ses chiffres sont ceux d'une lecture de table, et les
          afficher sous une console annoncerait « 500 lignes · limit 500 » pour une requête qui n'a
          pas tourné. Vu à l'écran en assemblant `12a`. La console porte son propre pied. */}
      {structureActive && detail && <StructureStatusBar detail={detail} />}
      {table && !structureActive && (
        <TableStatusBar
          fenetre={lecture.fenetre}
          loading={lecture.loading}
          error={lecture.error}
          pendingChanges={attente.length}
          editing={enEdition}
        />
      )}
    </div>
  )
}

/**
 * Ce que la sidebar écrit à droite d'une colonne : « filtré », « tri ↓ », « tri ↑ ».
 *
 * Les mots viennent du mockup, la flèche du sens. Une colonne à la fois filtrée et triée porte
 * les deux — le mockup n'en montre pas d'exemple, et taire l'un des deux états serait pire que
 * les écrire ensemble.
 */
function annotationsDe(
  etat: { filters: readonly Filter[]; sort: readonly SortKey[] },
  attente: EnAttente,
): Record<string, string> {
  const annotations: Record<string, string> = {}
  for (const filtre of etat.filters) annotations[filtre.column] = 'filtré'
  for (const critere of etat.sort) {
    const fleche = critere.direction === 'ascending' ? '↑' : '↓'
    annotations[critere.column] = annotations[critere.column]
      ? `filtré · tri ${fleche}`
      : `tri ${fleche}`
  }
  // **« modifié » prime** : c'est l'état le plus récent et le seul qui attend une action. Le mockup
  // de `A6` remplace bien « bpchar » et « tri ↓ » par « modifié » sur les colonnes touchées.
  // Une **ligne ajoutée** n'annote rien : ses colonnes ne sont pas modifiées dans les lignes que
  // la sidebar décrit, et les marquer ferait chercher un changement invisible dans la grille.
  for (const modification of attente) {
    if (modification.sorte === 'cellule') annotations[modification.column] = 'modifié'
  }
  return annotations
}

function correspond(objet: TableSummary, type: TypeObjet): boolean {
  const attendu = { tables: 'table', views: 'view', functions: 'function', indexes: 'index' }[type]
  return objet.kind === attendu
}

/** Les quatre comptes du contrôle segmenté, **issus des données** — jamais de constantes. */
function comptes(objets: readonly TableSummary[]): Record<TypeObjet, number> {
  return {
    tables: objets.filter((o) => o.kind === 'table').length,
    views: objets.filter((o) => o.kind === 'view').length,
    functions: objets.filter((o) => o.kind === 'function').length,
    indexes: objets.filter((o) => o.kind === 'index').length,
  }
}

/** L'état des onglets débarrassé de ceux qui lisaient la cible du retrait. */
function sansLesOngletsDe(etat: EtatOnglets, cible: CibleDeSuppression): EtatOnglets {
  return etat.onglets
    .map(idOnglet)
    .filter((id) => viseeParLId(cible, id))
    .reduce(fermer, etat)
}

/**
 * Les consoles d'une connexion, pour les tests d'homonymie des deux modales.
 *
 * **Lue depuis `projects` à chaque appel**, et non mémorisée : la liste change sous nos pieds à
 * chaque création, et une copie figée validerait un nom déjà pris.
 */
function consolesDe(
  projects: readonly Project[],
  cible: { project: string; database: string; environment: EnvironmentId },
): readonly { name: string }[] {
  return (
    projects
      .find((projet) => projet.name === cible.project)
      ?.databases.find(
        (base) => base.name === cible.database && base.environment === cible.environment,
      )?.consoles ?? []
  )
}

/**
 * Le délai avant qu'une frappe de console parte vers le disque.
 *
 * 400 ms : au-delà du rythme d'une frappe continue, en dessous du temps qu'il faut pour changer de
 * fenêtre. Voir `ecrituresEnAttente`.
 */
const DELAI_ECRITURE = 400
