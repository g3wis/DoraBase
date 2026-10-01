import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  type ArriveeDuDeplacement,
  dossier,
  type EffetSurLaLectureSeule,
  type SujetDuDeplacement,
} from '../../data/dossiers'
import { Icon } from '../../design/icons/Icon'
import type { IconName } from '../../design/icons/names'
import type { MoveResult } from '../../domain/arbre'
import type { ConnectionId, FolderColor, FolderId, FolderTree } from '../../domain/config'
import type { ColumnInfo, ConnectionState } from '../../domain/engine'
import { useT } from '../../i18n/LanguageContext'
import { raccourci } from '../../shell/plateforme'
import { Badge } from '../../ui/Badge/Badge'
import { ColumnRow } from '../../ui/ColumnRow/ColumnRow'
import { glypheDeType } from '../../ui/glypheDeType'
import { type EntreeDeMenu, MenuContextuel } from '../../ui/MenuContextuel/MenuContextuel'
import { Sidebar } from '../../ui/Sidebar/Sidebar'
import { SidebarFilterBar } from '../../ui/SidebarFilterBar/SidebarFilterBar'
import { SidebarSectionTitle } from '../../ui/SidebarSectionTitle/SidebarSectionTitle'
import { SidebarToolbar, SidebarToolbarButton } from '../../ui/SidebarToolbar/SidebarToolbar'
import { TreeRow } from '../../ui/TreeRow/TreeRow'
import { vitesseAuBord } from '../../ui/VirtualGrid/defilementAuBord'
import { aplatir, type Charge, type Deplies, idDossier, type Noeud } from './arbre'
import { type CibleDeSuppression, DeleteConnectionDialog } from './DeleteConnectionDialog'
import { DeplacerVers } from './DeplacerVers'
import styles from './ExplorerSidebar.module.css'
import {
  arriveeDuDepot,
  arriveeSansEffet,
  type CibleDuDepot,
  nomDuSujet,
  positionDansLaLigne,
  sujetDe,
} from './glissement'
import { PanneauDApparence } from './PanneauDApparence'
import { type RapportDeRenommage, RenameReportDialog } from './RenameReportDialog'
import { RowMenu } from './RowMenu'

export type ExplorerSidebarProps = {
  arbre: FolderTree
  deplies: Deplies
  charge: Charge
  etatDe: (connection: ConnectionId) => ConnectionState
  selectedId?: string | null
  onToggle: (noeud: Noeud) => void
  onSelect: (noeud: Noeud) => void
  /**
   * Ouvre la déclaration d'une connexion **dans un dossier** (#166).
   *
   * La cible est **obligatoire**, et c'est le point : le geste part du menu d'une ligne de dossier,
   * le palier qui connaît son contexte. Le dossier est le **cadre** de la modale, pas un champ.
   */
  onAddDatabase?: (dossier: FolderId) => void
  /**
   * Crée un dossier — à la racine (`null`), depuis la bande de tête, ou dans un dossier, depuis son
   * menu — et rend son identifiant, que le cœur a tiré.
   *
   * **La ligne passe aussitôt en renommage sur place** : aucune modale ne nomme un objet à sa
   * création, le dossier naît « dossier N » et se nomme ensuite, là où il est. Sans l'identifiant
   * rendu, la sidebar ne saurait pas quelle ligne éditer.
   *
   * Absent, le bouton de la bande n'est pas rendu — et non rendu inerte : un contrôle qui ne fait
   * rien est pire qu'un contrôle absent (défaut n° 36). C'est le cas de la galerie.
   */
  onNewFolder?: (parent: FolderId | null) => Promise<FolderId>
  /**
   * La ligne à passer en renommage dès le montage (#166) — le dossier que l'écran d'accueil vient de
   * créer. `A1` n'a pas d'arbre : c'est la première ligne de l'écran de travail qui se nomme.
   */
  renommageInitial?: string
  /** Renomme un dossier ; rejette avec le refus du cœur (un frère homonyme). */
  onRenameFolder?: (dossier: FolderId, nom: string) => Promise<void>
  /** Change la pastille d'un dossier ; `null` la retire. */
  onRecolorFolder?: (dossier: FolderId, couleur: FolderColor | null) => Promise<void>
  /**
   * Change l'icône d'un dossier ; `null` la rend à `pin` (#171). **Les deux gestionnaires ensemble
   * ouvrent « Couleur et icône… »** : une modale qui ne réglerait que l'un des deux annoncerait par
   * son titre ce qu'elle n'offre pas.
   */
  onSetFolderIcon?: (dossier: FolderId, icone: IconName | null) => Promise<void>
  /** Passe un dossier en lecture seule, ou la lève. */
  onSetFolderReadOnly?: (dossier: FolderId, lectureSeule: boolean) => Promise<void>
  /**
   * Ouvre les préférences (`API-46`), depuis la bande de tête. Absent, le bouton n'est pas rendu.
   */
  onOpenPreferences?: () => void
  onRefresh?: () => void
  /**
   * Ce qu'on peut faire d'une console depuis l'arbre — créer, renommer, retirer. **La création part
   * du menu d'une connexion**, et de là seulement.
   */
  consoles?: {
    onCreer: (connection: ConnectionId) => void
    /** Le nouveau nom est **fourni** : le renommage se fait sur place, il n'ouvre pas de modale. */
    onRenommer: (connection: ConnectionId, nom: string, nouveau: string) => void
    onRetirer: (connection: ConnectionId, nom: string) => void
  }
  /** Ouvre le diagramme d'un schéma, depuis le menu de sa ligne (3 septembre 2026). */
  onOpenDiagram?: (connection: ConnectionId, schema: string) => void
  /** Modifier la configuration d'une connexion depuis son « … » (`08h`). */
  onEditDatabase?: (connection: ConnectionId) => void
  /** Ouvre le gestionnaire de schémas d'une connexion (`API-33`). */
  onManageSchemas?: (connection: ConnectionId) => void
  /**
   * Renomme une connexion depuis sa ligne (`26`), **sur place**. Rejette avec le refus du cœur.
   * Depuis #166 il n'y a plus de réserve à rapporter : le nom n'est dans aucune identité.
   */
  onRenameDatabase?: (connection: ConnectionId, nouveau: string) => Promise<void>
  /**
   * Ouvre l'import de projets (`API-30`), depuis la bande en tête de l'arbre.
   *
   * **Il a fallu ce second chemin, et c'est un signalement qui l'a dit** (17 septembre 2026, « je
   * n'ai pas trouvé comment importer ») : un chemin unique qu'on ne voit pas — le menu natif — est
   * un chemin qui n'existe pas. **Dans cette bande**, à côté de « Nouveau dossier » : les deux gestes
   * produisent la même chose, par deux moyens.
   */
  onImportProjects?: () => void
  /**
   * Exporte **ce dossier** et son sous-arbre dans un fichier de transfert (#169).
   *
   * **Depuis le menu de sa ligne**, comme la création d'une console part du menu de sa connexion : le
   * geste part du palier qui connaît son contexte. « Tout exporter » vit dans le menu natif, où il
   * n'a rien à deviner. Le nom voyage avec l'identifiant pour que la modale nomme la portée.
   *
   * Absent, l'entrée est désactivée avec sa raison — c'est le cas de la galerie.
   */
  onExportFolder?: (folder: FolderId, nom: string) => void
  /**
   * Déplace un dossier ou une connexion (#167) — depuis « Déplacer vers… » ou un glisser-déposer.
   *
   * **Rend l'issue du cœur, et ne rejette que sur un refus** : une question sur la lecture seule
   * (`confirmationRequired`) n'est pas un échec, c'est ce qui ouvre la modale en confirmation.
   * L'appelant repose l'arbre quand l'issue est `moved`.
   *
   * Absent, l'entrée de menu est désactivée avec sa raison et aucune ligne ne se glisse — le cas de
   * la galerie.
   */
  onMove?: (
    sujet: SujetDuDeplacement,
    arrivee: ArriveeDuDeplacement,
    confirmed: boolean,
  ) => Promise<MoveResult>
  /**
   * Retirer la déclaration d'une connexion, ou un dossier entier (`08j`).
   *
   * Une seule prop pour les deux : la cible dit lequel, et deux props jumelles se seraient
   * désynchronisées.
   */
  onDelete?: (cible: CibleDeSuppression) => Promise<{ leftoverSecrets: string[] }>
  /**
   * Les modifications en attente (`11b`) que la fermeture des onglets ferait perdre.
   *
   * L'arbre ne connaît pas les onglets : seul l'écran de travail sait ce qui attend d'être écrit, et
   * une confirmation qui tairait cette perte serait un piège.
   */
  modificationsEnAttenteDe?: (cible: CibleDeSuppression) => number
  /**
   * La section contextuelle « Colonnes de *table* » — l'objet qu'on regarde sans l'avoir ouvert.
   *
   * **Jamais sous une table ouverte** (`API-44`) : l'onglet nomme déjà chaque colonne en en-tête
   * de grille et les liste en entier dans sa vue Structure, donc la section y redisait un extrait
   * de ce qu'on avait sous les yeux, en prenant de la hauteur sur l'arbre. C'est l'appelant qui en
   * décide — la sidebar ne connaît pas les onglets.
   *
   * Ce qui reste : l'explorateur sans onglet, et la console mongo, où c'est « Schéma déduit » qui
   * paraît (`13c`). Les annotations « filtré » et « tri ↓ » du mockup sont parties avec la section
   * qui les portait : elles ne décrivaient qu'une grille ouverte.
   */
  columns?: {
    table: string
    columns: readonly ColumnInfo[]
    loading?: boolean
  }
  /** Voir `Sidebar` : `fill` dans l'écran de travail, où un `SplitPane` porte la largeur. */
  width?: 'standard' | 'wide' | 'fill'
  /**
   * Le compte de modifications en attente sur une table (`11b`), en pastille d'accent sur sa ligne.
   *
   * Le mockup de `A6` remplace le compte de lignes (« 1.9 M ») par ce compte : ce qui attend d'être
   * écrit importe plus que la taille de la table, et les deux au même endroit se liraient mal.
   */
  modifications?: { schema: string; table: string; compte: number }
}

/** Au-delà, la liste se résume — le mockup montre sept colonnes puis « + 11 autres ». */
const APERCU_COLONNES = 7

/**
 * La sidebar de `A4` : filtre, arbre à cinq niveaux, pied.
 *
 * L'arbre est **aplati par `arbre.ts`**, fonction pure et testée sans DOM. Ce composant ne fait
 * que rendre la liste de nœuds et router les clics — `TreeRow` de `04` étant purement
 * présentationnelle, « elle ne connaît ni ses enfants, ni son état d'ouverture, ni le modèle de
 * données ».
 */
export function ExplorerSidebar({
  arbre,
  deplies,
  charge,
  etatDe,
  selectedId = null,
  onToggle,
  onSelect,
  onAddDatabase,
  onNewFolder,
  renommageInitial,
  onRenameFolder,
  onRecolorFolder,
  onSetFolderIcon,
  onSetFolderReadOnly,
  onOpenPreferences,
  onRefresh,
  consoles,
  onOpenDiagram,
  onEditDatabase,
  onManageSchemas,
  onRenameDatabase,
  onImportProjects,
  onExportFolder,
  onMove,
  onDelete,
  modificationsEnAttenteDe,
  columns,
  width = 'wide',
  modifications,
}: ExplorerSidebarProps) {
  const t = useT()
  const [filtre, setFiltre] = useState('')
  /**
   * La ligne en cours de renommage, par identité de nœud — une console (`12f`), une connexion
   * (`26`) ou un dossier (#166).
   *
   * **Un seul état pour les deux sortes** : une seule ligne se renomme à la fois, et deux états
   * jumeaux auraient permis d'en éditer deux, dont une invisible.
   *
   * **Ici et non chez l'appelant** : c'est un état d'interface, qui meurt avec la ligne et n'intéresse
   * ni l'écran de travail ni le disque. Le remonter aurait fait voyager un identifiant de nœud à
   * travers deux composants pour revenir se poser sur la même ligne.
   */
  const [enRenommage, setEnRenommage] = useState<string | null>(renommageInitial ?? null)
  // Une demande qui arrive après le montage — le raccourci de création, porté par l'application.
  useEffect(() => {
    if (renommageInitial !== undefined) setEnRenommage(renommageInitial)
  }, [renommageInitial])
  /**
   * Le dossier dont le panneau « Couleur et icône » est ouvert, par identifiant (#171) — ouvert par
   * son icône comme par l'entrée du menu, sous la même icône.
   */
  const [aColorer, setAColorer] = useState<FolderId | null>(null)
  const [aRetirer, setARetirer] = useState<CibleDeSuppression | null>(null)
  /**
   * Ce qu'un renommage a eu à dire (`26`) — un refus, ou une réserve sur le Trousseau.
   *
   * **`null` la plupart du temps, et c'est le point** : le succès sans réserve ne monte rien, la
   * ligne renommée étant sa propre confirmation.
   */
  const [rapport, setRapport] = useState<RapportDeRenommage | null>(null)
  /**
   * Le menu ouvert au clic droit : **l'identité de la ligne visée, et l'endroit du pointeur**.
   *
   * L'identité plutôt que le nœud lui-même : `aplatir` reconstruit les nœuds à chaque rendu, et un
   * objet mémorisé ici serait une copie périmée dès le premier dépliage. Les entrées sont donc
   * recalculées au rendu, sur le nœud courant — et si la ligne a disparu entre-temps, le menu ne
   * s'ouvre pas plutôt que d'agir sur ce qui n'est plus là.
   */
  const [menuAuPointeur, setMenuAuPointeur] = useState<{ id: string; x: number; y: number } | null>(
    null,
  )
  const demanderLeRetrait = onDelete === undefined ? undefined : setARetirer
  /**
   * « Déplacer vers… » ouverte (#167) : depuis le menu, rien de choisi ; depuis un dépôt dont le cœur
   * a posé une question, l'arrivée du dépôt et la question.
   */
  const [aDeplacer, setADeplacer] = useState<{
    sujet: SujetDuDeplacement
    arrivee?: ArriveeDuDeplacement
    question?: EffetSurLaLectureSeule
  } | null>(null)
  /** La ligne saisie pendant un glissement, et ce que le pointeur désigne. */
  const [glissement, setGlissement] = useState<{
    id: string
    cible: CibleDuDepot | null
  } | null>(null)
  /**
   * Un glissement vient de finir : le `click` que le navigateur émet au relâchement doit être avalé,
   * sans quoi lâcher une ligne la sélectionnerait — un effet de bord sur un geste qui la range.
   */
  const clicAAvaler = useRef(false)
  const arbreDom = useRef<HTMLDivElement>(null)

  const noeuds = useMemo(
    () => aplatir(arbre, deplies, charge, etatDe, t),
    [arbre, deplies, charge, etatDe, t],
  )

  /**
   * Crée un dossier, déplie son parent, et passe la nouvelle ligne en renommage sur place.
   *
   * **Déplier le parent n'est pas une commodité** : un dossier créé sous un parent replié n'aurait
   * aucune ligne où se nommer, et le champ de renommage attendrait une ligne qui n'existe pas.
   */
  const creerUnDossier =
    onNewFolder === undefined
      ? undefined
      : (parent: Noeud | null) => {
          if (parent !== null && parent.chevron === 'closed') onToggle(parent)
          void onNewFolder(parent?.folder ?? null).then(
            (cree) => setEnRenommage(idDossier(cree)),
            () => {
              // Un refus de création n'a pas de ligne où se dire ; le blocage de configuration, seul
              // cas réaliste, est déjà annoncé par l'écran (`09b`).
            },
          )
        }

  const visibles = useMemo(() => filtrer(noeuds, filtre), [noeuds, filtre])

  // **Le panneau vit sur sa ligne** : une ligne qui disparaît l'emporte. Aucun effet n'oublie l'état
  // pour autant, et ce n'est pas un oubli : tout geste qui retire la ligne — replier un parent, taper
  // dans le filtre — passe par un clic ou un focus hors du panneau, qui l'ont déjà fermé. Une garde
  // écrite pour ce cas a été retirée le jour même : aucun test ne pouvait l'atteindre.
  const apparenceDisponible = onRecolorFolder !== undefined && onSetFolderIcon !== undefined

  /**
   * L'icône d'une ligne de dossier, devenue contrôle (#171) : son clic ouvre — ou referme — le
   * panneau, sans sélectionner ni déplier la ligne. Absent quand le panneau ne pourrait rien écrire :
   * l'icône redevient alors un dessin, plutôt qu'un contrôle inerte (défaut n° 36).
   */
  const controleDIcone = (noeud: Noeud) => {
    const folder = noeud.folder
    if (noeud.kind !== 'folder' || folder === undefined) return undefined
    if (onRecolorFolder === undefined || onSetFolderIcon === undefined) return undefined
    const ouvert = aColorer === folder
    return {
      label: t('explorer.sidebar.appearanceFor', { cible: noeud.label }),
      onClick: () => setAColorer(ouvert ? null : folder),
      panneau: ouvert
        ? (ancre: RefObject<HTMLButtonElement | null>) => (
            <PanneauDApparence
              nom={noeud.label}
              couleur={couleurDe(arbre, folder)}
              icone={dossier(arbre, folder)?.dossier.icon ?? null}
              ancre={ancre}
              onRecolorer={(couleur) => onRecolorFolder(folder, couleur)}
              onChangerDIcone={(icone) => onSetFolderIcon(folder, icone)}
              onFermer={() => setAColorer(null)}
            />
          )
        : undefined,
    }
  }

  /**
   * Les actions d'une ligne, câblées sur cet écran.
   *
   * **Une seule construction pour les deux ouvertures** — le « … » et le clic droit : le menu est le
   * même, seule la façon de le demander change. Deux listes d'entrées auraient divergé d'une action
   * au premier ajout, et c'est le genre d'écart qu'on ne remarque qu'en montrant le produit.
   */
  const actionsDe = (noeud: Noeud): readonly EntreeDeMenu[] | undefined =>
    entreesDe(noeud, {
      onAddDatabase,
      onEditDatabase,
      onManageSchemas,
      renommageDisponible:
        noeud.kind === 'folder' ? onRenameFolder !== undefined : onRenameDatabase !== undefined,
      creerUnDossier,
      colorer: apparenceDisponible ? setAColorer : undefined,
      onSetFolderReadOnly,
      refuserLaLectureSeule: (nom: string, refus: unknown) =>
        setRapport({ nom, refus: messageDuRefus(refus), sorte: 'lectureSeule' }),
      onExportFolder,
      demanderLeDeplacement: onMove === undefined ? undefined : (sujet) => setADeplacer({ sujet }),
      demanderLeRetrait,
      onRefresh,
      consoles,
      onOpenDiagram,
      demanderLeRenommage: setEnRenommage,
      t,
    })

  /** La ligne visée par le clic droit, si elle est toujours là, et ce que son menu propose. */
  const viseeAuPointeur =
    menuAuPointeur === null
      ? null
      : (() => {
          const noeud = visibles.find((candidat) => candidat.id === menuAuPointeur.id)
          const entrees = noeud ? actionsDe(noeud) : undefined
          return noeud && entrees ? { noeud, entrees } : null
        })()

  /**
   * Applique un renommage sur place, selon la sorte de ligne.
   *
   * **Une seule fonction pour les deux**, appelée par le champ d'édition : le composant de saisie ne
   * connaît qu'un nouveau nom, et lui faire choisir la commande aurait demandé de lui apprendre le
   * modèle d'arbre.
   *
   * Les coordonnées viennent du **nœud**, jamais d'une déduction sur son libellé : deux connexions
   * homonymes vivent dans deux environnements (`23b`), et c'est le couple qui les distingue.
   */
  function renommer(noeud: Noeud, nouveau: string) {
    const refuser = (erreur: unknown) => setRapport({ nom: nouveau, refus: String(erreur) })

    if (noeud.kind === 'console' && consoles !== undefined) {
      if (noeud.connection === undefined || noeud.console === undefined) return
      consoles.onRenommer(noeud.connection, noeud.console, nouveau)
      return
    }

    // Le refus n'est pas attendu par le champ, qui est déjà démonté : il arrive dans le rapport,
    // seul endroit où un renommage sur place peut parler. Le succès est muet — la ligne le dit.
    if (noeud.kind === 'database' && onRenameDatabase !== undefined) {
      if (noeud.connection === undefined) return
      void onRenameDatabase(noeud.connection, nouveau).catch(refuser)
      return
    }

    if (noeud.kind === 'folder' && onRenameFolder !== undefined) {
      if (noeud.folder === undefined) return
      void onRenameFolder(noeud.folder, nouveau).catch(refuser)
    }
  }

  /**
   * Le sujet rejoint un dossier replié : le déplier, sans quoi il disparaîtrait sous la main — au
   * glisser-déposer comme depuis la modale.
   */
  function deplierLHote(destination: FolderId | null) {
    const hote = destination === null ? undefined : noeuds.find((n) => n.folder === destination)
    if (hote?.chevron === 'closed') onToggle(hote)
  }

  /**
   * Envoie un dépôt au cœur, **sans confirmation** : s'il change la lecture seule, la réponse est une
   * question, et c'est « Déplacer vers… », préremplie, qui la pose — un seul chemin porte la règle
   * (règle n° 17). Un refus n'a pas d'autre endroit où se dire que le rapport.
   */
  function deposer(
    sujet: SujetDuDeplacement,
    arrivee: ArriveeDuDeplacement,
    deplier: FolderId | null,
  ) {
    if (onMove === undefined) return
    const nom = nomDuSujet(arbre, sujet)
    void onMove(sujet, arrivee, false).then(
      (issue) => {
        if (issue.kind === 'confirmationRequired') {
          setADeplacer({
            sujet,
            arrivee,
            question: {
              becomesReadOnly: issue.becomesReadOnly,
              leavesReadOnly: issue.leavesReadOnly,
              folders: issue.folders,
            },
          })
          return
        }
        deplierLHote(deplier)
      },
      (refus: unknown) => setRapport({ nom, refus: messageDuRefus(refus), sorte: 'deplacement' }),
    )
  }

  /**
   * Ce que le pointeur désigne en `(x, y)` : la bande de la racine, une ligne et sa position, ou rien.
   *
   * **`elementFromPoint`, jamais la cible de l'événement** : la ligne saisie capte le pointeur, donc
   * tous les événements lui reviennent — leurs coordonnées, elles, restent exactes. C'est le patron de
   * `VirtualGrid::debuterLeReordonnancement`.
   */
  function cibleSousLePointeur(
    x: number,
    y: number,
    sujet: SujetDuDeplacement,
  ): CibleDuDepot | null {
    const sous = document.elementFromPoint(x, y)
    if (sous?.closest('[data-depot-racine]')) return { kind: 'racine' }
    const ligne = sous?.closest<HTMLElement>('[data-noeud]')
    const noeud = ligne ? visibles.find((n) => n.id === ligne.dataset.noeud) : undefined
    if (ligne == null || noeud === undefined) return null
    const bords = ligne.getBoundingClientRect()
    const cible: CibleDuDepot = {
      kind: 'ligne',
      noeud,
      position: positionDansLaLigne(y, bords.top, bords.height, noeud.kind),
    }
    return arriveeDuDepot(arbre, sujet, cible) === null ? null : cible
  }

  /**
   * Le glissement d'une ligne de dossier ou de connexion (#167), **aux événements pointeur** — jamais
   * `draggable`, que WKWebView ne délivre pas de façon fiable (`VirtualGrid`, 2 septembre 2026).
   *
   * **Il ne s'arme qu'au-delà de quatre pixels** : en deçà, c'est un clic, et la ligne se sélectionne
   * comme avant. Une fois armé, la ligne capte le pointeur, la bande de tête devient la zone « à la
   * racine », et la sidebar défile d'elle-même près de ses bords — la règle de `defilementAuBord`,
   * appliquée à l'axe vertical.
   */
  function debuterLeGlissement(evenement: ReactPointerEvent<HTMLElement>, noeud: Noeud) {
    // `ctrl` compris : sur macOS, `ctrl`+clic est le clic secondaire et arrive avec `button === 0`.
    if (onMove === undefined || evenement.button !== 0 || evenement.ctrlKey) return
    if (enRenommage === noeud.id) return
    const saisi = sujetDe(noeud)
    if (saisi === null) return
    // Une constante typée : les fonctions imbriquées ne voient pas le rétrécissement de `saisi`.
    const sujet: SujetDuDeplacement = saisi
    const ligne = evenement.currentTarget
    const departX = evenement.clientX
    const departY = evenement.clientY
    let arme = false
    let derniereX = departX
    let derniereY = departY
    let trame: number | null = null
    let cible: CibleDuDepot | null = null

    const suivre = () => {
      cible = cibleSousLePointeur(derniereX, derniereY, sujet)
      setGlissement({ id: noeud.id, cible })
    }

    // Un pas de défilement par trame, tant que le pointeur reste dans la marge d'un bord : une souris
    // posée contre le bord n'émet plus de `pointermove`, et c'est là qu'on veut avancer.
    const defilerAuBord = () => {
      trame = null
      const zone = arbreDom.current?.parentElement
      if (zone == null) return
      const bords = zone.getBoundingClientRect()
      const vitesse = vitesseAuBord(derniereY, bords.top, bords.bottom)
      if (vitesse === 0) return
      const avant = zone.scrollTop
      zone.scrollTop = avant + vitesse
      if (zone.scrollTop === avant) return
      suivre()
      trame = requestAnimationFrame(defilerAuBord)
    }

    const terminer = () => {
      window.removeEventListener('pointermove', onMove_)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (trame !== null) cancelAnimationFrame(trame)
      document.body.classList.remove(styles.pendantLeGlissement as string)
      setGlissement(null)
    }

    function onMove_(mouvement: PointerEvent) {
      derniereX = mouvement.clientX
      derniereY = mouvement.clientY
      if (!arme) {
        if (Math.hypot(derniereX - departX, derniereY - departY) < 4) return
        arme = true
        ligne.setPointerCapture?.(mouvement.pointerId)
        document.body.classList.add(styles.pendantLeGlissement as string)
      }
      suivre()
      if (trame === null) trame = requestAnimationFrame(defilerAuBord)
    }

    function onUp(relache: PointerEvent) {
      terminer()
      if (!arme) return
      // Le `click` du relâchement part dans la même tâche : au-delà, le drapeau ne doit pas avaler
      // le clic suivant, qui n'aurait rien à voir — celui d'une ligne relâchée hors de la capture.
      clicAAvaler.current = true
      setTimeout(() => {
        clicAAvaler.current = false
      }, 0)
      // Relue une dernière fois, aux coordonnées du relâchement : l'indicateur ne fait que suivre.
      const finale = cibleSousLePointeur(relache.clientX, relache.clientY, sujet) ?? cible
      const sens = finale === null ? null : arriveeDuDepot(arbre, sujet, finale)
      if (sens === null || arriveeSansEffet(arbre, sujet, sens.arrivee)) return
      deposer(sujet, sens.arrivee, sens.deplier)
    }

    function onCancel() {
      terminer()
    }

    window.addEventListener('pointermove', onMove_)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  /** L'indicateur de dépôt d'une ligne, pendant un glissement. */
  const depotSur = (noeud: Noeud): string | undefined => {
    const cible = glissement?.cible
    if (cible?.kind !== 'ligne' || cible.noeud.id !== noeud.id) return undefined
    // Une connexion lâchée sur un dossier y entre quelle que soit la position : l'indicateur le dit.
    const sujet = visibles.find((n) => n.id === glissement?.id)
    if (noeud.kind === 'folder' && sujet?.kind === 'database') return 'dedans'
    return cible.position
  }

  const depotALaRacine = glissement?.cible?.kind === 'racine'

  return (
    <>
      {rapport !== null && (
        <RenameReportDialog rapport={rapport} onClose={() => setRapport(null)} />
      )}
      {viseeAuPointeur !== null && menuAuPointeur !== null && (
        <MenuContextuel
          x={menuAuPointeur.x}
          y={menuAuPointeur.y}
          label={t('explorer.sidebar.actionsFor', { cible: cibleDe(viseeAuPointeur.noeud) })}
          entrees={viseeAuPointeur.entrees}
          onFermer={() => setMenuAuPointeur(null)}
        />
      )}
      {aDeplacer !== null && onMove !== undefined && (
        <DeplacerVers
          arbre={arbre}
          sujet={aDeplacer.sujet}
          nom={nomDuSujet(arbre, aDeplacer.sujet)}
          {...(aDeplacer.arrivee === undefined ? {} : { arrivee: aDeplacer.arrivee })}
          question={aDeplacer.question ?? null}
          onDeplacer={async (arrivee, confirmed) => {
            const issue = await onMove(aDeplacer.sujet, arrivee, confirmed)
            if (issue.kind === 'moved') deplierLHote(arrivee.destination)
            return issue
          }}
          onClose={() => setADeplacer(null)}
        />
      )}
      {aRetirer !== null && onDelete !== undefined && (
        <DeleteConnectionDialog
          cible={aRetirer}
          modificationsEnAttente={modificationsEnAttenteDe?.(aRetirer) ?? 0}
          onClose={() => setARetirer(null)}
          onDelete={() => onDelete(aRetirer)}
        />
      )}
      <Sidebar
        width={width}
        toolbar={
          /* **La bande d'actions, en tête** (26 août 2026, à la demande) — et le pied a disparu avec
             elle : 78 px pris sur la hauteur de l'arbre pour deux boutons à libellé.

             **« Nouveau dossier » crée à la racine** (#166), là où « Nouveau projet » créait un projet
             — même place, même glyphe. **« Nouvelle connexion » n'y est pas** : une connexion se range
             dans un dossier, et une bande en tête de colonne ne sait pas lequel. Le menu d'une ligne
             de dossier, lui, ne devine rien.

             **`plus`** : ce bouton ne désigne pas un dossier, il **en crée un**. Une icône nue sans
             « + » se lirait comme un raccourci vers un dossier déjà là. */
          /* **Pendant un glissement, la bande devient la zone « à la racine »** (#167). La racine n'a
             pas de ligne — elle n'est pas un dossier —, donc il lui fallait un endroit où déposer, et
             la bande de tête est celui que le pointeur atteint sans défiler. Mêmes cotes que la
             bande, pour que rien ne saute quand elle change de rôle. */
          glissement !== null ? (
            <div
              className={styles.depotRacine}
              data-depot-racine=""
              data-actif={depotALaRacine || undefined}
            >
              <Icon name="bag" size={13} strokeWidth={1.8} />
              {t('explorer.sidebar.dropAtRoot')}
            </div>
          ) : (
            (onNewFolder || onImportProjects || onOpenPreferences) && (
              <SidebarToolbar>
                {creerUnDossier && (
                  <SidebarToolbarButton
                    icon="plus"
                    label={t('explorer.sidebar.newFolder')}
                    title={t('explorer.sidebar.newFolderTitle', { raccourci: raccourci('N') })}
                    onClick={() => creerUnDossier(null)}
                  />
                )}
                {/* **L'import, juste après la création** (`API-30`, 17 septembre 2026, à la demande).
                  Les deux gestes de cette bande produisent la même chose — un projet —, par deux
                  moyens : l'un le déclare, l'autre le reçoit d'un fichier. Les voisiner est ce qui
                  fait trouver le second quand on cherchait le premier.

                  **Le glyphe est `ul`, le miroir de `dl`** : même sol, une flèche qui descend vers
                  le disque pour l'export, une qui en remonte pour l'import. La disquette de `save`
                  a tenu une semaine et disait « enregistrer » — ce qu'un bouton d'icône nue ne peut
                  pas se permettre. Le même geste ne se dessine pas de deux façons, et celui-ci ne
                  s'en dessine plus d'une fausse.

                  **Et il porte un `title`** : les deux autres actions de cette bande sont des
                  gestes qu'on devine, celui-ci nomme un format de fichier. Le nom accessible seul
                  ne se lit pas au survol. */}
                {onImportProjects && (
                  <SidebarToolbarButton
                    icon="ul"
                    label={t('transfer.import.menu')}
                    title={t('transfer.import.menu')}
                    onClick={onImportProjects}
                  />
                )}
                {/* **Les préférences, à gauche avec le reste** (`API-46`, à la demande, second tour).
                  Une fin de bande poussée à droite a existé une demi-heure : elle disait « ce qui crée
                  d'un côté, ce qui configure de l'autre », un rangement que les menus tiennent bien
                  mais qui, dans 22 px de haut, ne se lisait pas comme une séparation — juste comme une
                  icône égarée. Deux carrés côte à côte forment un groupe, ce que `role="toolbar"`
                  annonce déjà.

                  **Et le glyphe n'est pas l'engrenage** : à 14 px, ses huit dents se rejoignent en un
                  anneau, et rien n'y dit « réglages » — vu à la loupe, pas supposé. `slid` porte deux
                  curseurs, la seule forme de ce sprite qui reste lisible à cette taille. Elle est
                  employée **partout où les préférences se nomment**, jamais ici seulement : le même
                  bouton ne peut pas changer de dessin selon l'écran. */}
                {onOpenPreferences && (
                  <SidebarToolbarButton
                    icon="slid"
                    label={t('explorer.sidebar.preferences')}
                    onClick={onOpenPreferences}
                  />
                )}
              </SidebarToolbar>
            )
          )
        }
        filter={
          // Le compteur `n/m` de `04` sert ici : il dit combien de lignes **affichées** le filtre
          // retient, ce qui rappelle implicitement qu'il ne cherche pas au-delà.
          <SidebarFilterBar
            value={filtre}
            onChange={setFiltre}
            matchCount={filtre === '' ? undefined : visibles.length}
            totalCount={filtre === '' ? undefined : noeuds.length}
          />
        }
      >
        {/* `role="tree"` et `treeitem` : l'arbre est aplati dans le DOM, donc `aria-level` porte la
          profondeur qu'une imbrication aurait donnée gratuitement. Sans lui, un lecteur d'écran
          annoncerait une liste plate de vingt éléments sans hiérarchie. */}
        <div
          ref={arbreDom}
          role="tree"
          aria-label={t('explorer.sidebar.treeLabel')}
          className={styles.tree}
        >
          {visibles.length === 0 && filtre !== '' && (
            <p className={styles.vide}>{t('explorer.sidebar.noMatch', { filtre })}</p>
          )}
          {visibles.map((noeud) =>
            noeud.message ? (
              // Une ligne de message n'est pas un `treeitem` : ce n'est pas un nœud de l'arbre
              // mais un état de son chargement, et l'annoncer comme tel ferait compter un
              // enfant qui n'existe pas.
              // L'indentation vient d'`indentation()` de `TreeRow`, calculée par `aplatir` : le CSS
              // en tenait une copie, qu'un palier ajouté aurait laissée en retard (`25a`).
              <p
                key={noeud.id}
                className={styles.message}
                style={{ paddingLeft: noeud.indent }}
                data-depth={noeud.depth}
              >
                {noeud.label}
              </p>
            ) : (
              <TreeRow
                key={noeud.id}
                // Le rôle est **sur la ligne elle-même**, qui est un `<button>` : une enveloppe le
                // portant mettrait l'élément interactif à l'intérieur du nœud d'arbre, où ni le
                // clic ni le focus ne le désignent.
                role="treeitem"
                aria-level={noeud.depth + 1}
                aria-expanded={noeud.chevron ? noeud.chevron === 'open' : undefined}
                aria-selected={noeud.id === selectedId}
                aria-label={noeud.announce}
                depth={noeud.depth}
                indent={noeud.indent}
                // **`label` nourrit aussi le champ d'édition sur place** (`TreeRow` y prend sa
                // `valeurInitiale`). Une connexion qui « Renommer… » modifie son **identité**
                // (`database`, `08i`), jamais son libellé d'affichage (`27a`) — donc pendant
                // *son propre* renommage, la ligne bascule sur `database` plutôt que sur un
                // libellé qui aurait pu diverger. Les autres nœuds n'ont pas cette divergence :
                // ils gardent `label`.
                label={
                  enRenommage === noeud.id && noeud.kind === 'database'
                    ? (noeud.database ?? noeud.label)
                    : noeud.label
                }
                /* **Le double-clic déplie, ou renomme une console.**

                   Déplier : c'est la seconde voie du dépliage, à côté de la flèche, et le geste
                   qu'on a dans les doigts d'un explorateur de fichiers. Les deux clics qu'il contient
                   sélectionnent d'abord la ligne — ce que le geste veut dire aussi.

                   Renommer : réservé aux **consoles**, qui n'ont pas de chevron. Celui d'une table ou
                   d'un schéma vient du serveur ; celui d'une connexion nous appartient depuis `26`,
                   mais sa ligne se déplie — un double-clic y ferait les deux, et le champ de saisie
                   apparaîtrait sur une ligne en train de bouger. Elle se renomme donc par son menu
                   « … », et par là seulement. */
                onDoubleClick={
                  noeud.chevron
                    ? () => onToggle(noeud)
                    : noeud.kind === 'console' && consoles !== undefined
                      ? () => setEnRenommage(noeud.id)
                      : undefined
                }
                edition={
                  enRenommage === noeud.id
                    ? {
                        onValider: (nouveau) => {
                          setEnRenommage(null)
                          renommer(noeud, nouveau)
                        },
                        onAnnuler: () => setEnRenommage(null),
                      }
                    : undefined
                }
                icon={noeud.icon}
                iconColor={noeud.iconColor}
                chevron={noeud.chevron}
                meta={compteDe(noeud, modifications) ?? noeud.meta}
                metaVariant={compteDe(noeud, modifications) ? 'caps' : noeud.metaVariant}
                metaBadge={compteDe(noeud, modifications) !== undefined}
                selected={noeud.id === selectedId}
                // Les dossiers de premier niveau en graisse pleine, comme les projets qu'ils remplacent.
                strong={noeud.kind === 'folder' && noeud.depth === 0}
                trailing={
                  noeud.badge ? (
                    <Badge tone={noeud.badge.tone} size="xs">
                      {noeud.badge.text}
                    </Badge>
                  ) : noeud.readOnly ? (
                    /* **Le verrou, sur le dossier qui déclare la lecture seule** (#166) — à la place
                       du badge `PROD` des environnements. Un glyphe en trait du sprite plutôt
                       qu'un badge de texte : c'est le glyphe que la barre d'état emploie déjà pour
                       « lecture seule ». Il n'a pas de nom accessible ; l'état est dans l'annonce
                       de la ligne. */
                    <Icon name="lock" size={11} strokeWidth={2.2} className={styles.verrou} />
                  ) : undefined
                }
                actions={renderActions(noeud, actionsDe(noeud))}
                iconControl={controleDIcone(noeud)}
                /* **Le clic droit ouvre le même menu, au pointeur.** `08h` l'avait écarté — « le
                   handoff ne le maquette pas, et un “…” visible enseigne son existence là où un clic
                   droit se devine » — puis l'usage l'a réclamé : le « … » reste, il enseigne, et le
                   clic droit est le geste qu'on a dans les doigts. Les deux mènent aux mêmes actions.

                   `preventDefault` ici plutôt que de compter sur `useClicDroitDesactive` : ce
                   gestionnaire-là est la raison pour laquelle le menu du système ne doit pas s'ouvrir,
                   et le dire sur place évite de dépendre d'un ordre d'écouteurs. */
                onContextMenu={(evenement) => {
                  if (actionsDe(noeud) === undefined) return
                  evenement.preventDefault()
                  setMenuAuPointeur({
                    id: noeud.id,
                    x: evenement.clientX,
                    y: evenement.clientY,
                  })
                }}
                /* **Un clic sélectionne, et rien de plus.** Il faisait les deux — sélectionner et
                   déplier — et le mockup ne montrant pas de zone distincte pour la flèche, la cible
                   à onze pixels avait servi d'argument. À l'usage, c'est l'inverse qui coûte :
                   regarder une connexion refermait le sous-arbre qu'on venait d'ouvrir, et le
                   rouvrir le refermait encore. La flèche gagne donc une zone attrapable en débord
                   (voir `TreeRow`), et le double-clic est la seconde voie. */
                onClick={() => {
                  if (clicAAvaler.current) {
                    clicAAvaler.current = false
                    return
                  }
                  onSelect(noeud)
                }}
                onChevron={noeud.chevron ? () => onToggle(noeud) : undefined}
                // Le glisser-déposer (#167) : la ligne se reconnaît par `data-noeud` sous le pointeur,
                // et dit par `data-depot` où le sujet tomberait.
                data-noeud={noeud.id}
                data-depot={depotSur(noeud)}
                data-glisse={glissement?.id === noeud.id || undefined}
                onPointerDown={
                  sujetDe(noeud) === null
                    ? undefined
                    : (evenement: ReactPointerEvent<HTMLButtonElement>) =>
                        debuterLeGlissement(evenement, noeud)
                }
              />
            ),
          )}
        </div>
        {columns && (
          <section className={styles.colonnes}>
            {/* **« Schéma déduit » quand il l'est** (`13c`). Le mot est le plus important de cette
                section : les champs viennent d'un **échantillon** (`18d`), pas d'un catalogue. Le
                titre se déduit de la donnée — une colonne qui porte une fréquence est une colonne
                déduite — plutôt que d'un drapeau que l'appelant pourrait oublier de poser. */}
            <SidebarSectionTitle>
              {estDeduit(columns.columns)
                ? t('explorer.sidebar.inferredSchema', { table: columns.table })
                : t('explorer.sidebar.columnsOf', { table: columns.table })}
            </SidebarSectionTitle>
            {columns.loading ? (
              <p className={styles.message}>{t('explorer.sidebar.loadingColumns')}</p>
            ) : (
              <>
                {columns.columns.slice(0, APERCU_COLONNES).map((colonne) => (
                  <ColumnRow
                    key={colonne.name}
                    label={colonne.name}
                    // La clé prime sur la catégorie : le mockup montre une icône de clé pour `id`
                    // et de clé étrangère pour `user_id`, et un glyphe de type pour les autres.
                    typeIcon={colonne.key === 'primary' ? 'key' : colonne.key ? 'fk' : undefined}
                    typeIconColor={colonne.key === 'primary' ? 'var(--gold)' : 'var(--info)'}
                    typeGlyph={colonne.key ? undefined : glypheDeType(colonne.category)}
                    meta={
                      // **La fréquence prend la place du type quand elle est partielle** — c'est
                      // ce que le mockup d'`A8` montre : `channel 98 %`. Un champ à 100 % affiche
                      // son type : répéter « 100 % » sur quinze lignes noierait les deux qui ne
                      // le sont pas, et ce sont celles-là qui comptent.
                      frequenceLisible(colonne) ?? colonne.typeName
                    }
                    metaActive={frequenceLisible(colonne) !== null}
                  />
                ))}
                {columns.columns.length > APERCU_COLONNES && (
                  <ColumnRow
                    label={t('explorer.sidebar.moreColumns', {
                      count: columns.columns.length - APERCU_COLONNES,
                    })}
                    summary
                  />
                )}
              </>
            )}
          </section>
        )}
      </Sidebar>
    </>
  )
}

/**
 * Le compte de modifications d'une ligne d'arbre, s'il la concerne.
 *
 * Comparé sur le **triplet** schéma / table, pas sur le seul nom : deux schémas peuvent avoir une
 * table homonyme, et la pastille se poserait sur les deux.
 */
function compteDe(
  noeud: Noeud,
  modifications?: { schema: string; table: string; compte: number },
): string | undefined {
  if (!modifications || noeud.kind !== 'object') return undefined
  if (noeud.label !== modifications.table || noeud.schema !== modifications.schema) return undefined
  return String(modifications.compte)
}

/**
 * Le filtre, sur ce qui est **affiché**.
 *
 * Il ne peut pas trouver une table d'un schéma jamais déplié : elle n'a jamais traversé l'IPC.
 * Le placeholder de `SidebarFilterBar` — « Filtrer l'arborescence… », posé en `04` et confirmé
 * sur le mockup — le dit implicitement. La vraie réponse au besoin de chercher partout est la
 * recherche globale `⌘P`, hors périmètre de `09d`.
 *
 * **Les ancêtres d'une correspondance sont conservés** : filtrer sur « orders » sans garder son
 * schéma et sa base produirait une ligne orpheline, indentée sans parent visible.
 */
export function filtrer(noeuds: readonly Noeud[], filtre: string): Noeud[] {
  const terme = filtre.trim().toLowerCase()
  if (terme === '') return [...noeuds]

  const garde = new Set<string>()
  // Les ancêtres se retrouvent par la pile de profondeur : l'arbre étant aplati dans l'ordre du
  // parcours, le dernier nœud de profondeur n-1 est le parent.
  const pile: Noeud[] = []
  for (const noeud of noeuds) {
    pile.length = noeud.depth
    pile[noeud.depth] = noeud
    if (!noeud.message && noeud.label.toLowerCase().includes(terme)) {
      for (const ancetre of pile) if (ancetre) garde.add(ancetre.id)
    }
  }

  return noeuds.filter((noeud) => garde.has(noeud.id))
}

/** Ce dont les menus de ligne ont besoin, câblé par la sidebar. */
type Cablage = {
  onAddDatabase: ExplorerSidebarProps['onAddDatabase']
  onEditDatabase: ExplorerSidebarProps['onEditDatabase']
  onManageSchemas: ExplorerSidebarProps['onManageSchemas']
  /**
   * Un booléen et non la fonction : ce menu n'appelle pas le renommage, il **passe la ligne en
   * édition** — c'est le champ de saisie qui appellera. Il n'a donc besoin que de savoir si l'action
   * aboutira, pour désactiver l'entrée avec sa raison plutôt que de l'offrir en vain.
   */
  renommageDisponible: boolean
  creerUnDossier: ((parent: Noeud | null) => void) | undefined
  colorer: ((dossier: FolderId) => void) | undefined
  onSetFolderReadOnly: ExplorerSidebarProps['onSetFolderReadOnly']
  /** Rapporte un refus de « Passer en / Lever la lecture seule » (#168), qu'aucune ligne ne peut dire. */
  refuserLaLectureSeule: (dossier: string, refus: unknown) => void
  onExportFolder: ExplorerSidebarProps['onExportFolder']
  demanderLeDeplacement: ((sujet: SujetDuDeplacement) => void) | undefined
  demanderLeRetrait: ((cible: CibleDeSuppression) => void) | undefined
  onRefresh: ExplorerSidebarProps['onRefresh']
  consoles: ExplorerSidebarProps['consoles']
  onOpenDiagram: ExplorerSidebarProps['onOpenDiagram']
  demanderLeRenommage: (id: string) => void
  t: ReturnType<typeof useT>
}

/**
 * Le menu « … » d'une ligne (`08h`).
 *
 * **Toute ligne d'arbre en a un** — dossier, connexion, console, schéma, objet. Seules les lignes de
 * message n'en ont pas, et ce ne sont pas des nœuds de l'arbre. Le schéma a gagné le sien pour le
 * diagramme (3 septembre 2026), l'objet pour « Copier le nom » (#162).
 */
function entreesDe(noeud: Noeud, c: Cablage): readonly EntreeDeMenu[] | undefined {
  const { t } = c
  const RAISONS = raisons(t)

  /*
   * **Le menu d'un dossier** (#166), dans cet ordre — le geste destructeur reste le dernier :
   * « Nouvelle connexion… », « Nouveau dossier », « Renommer… », « Couleur et icône… », la lecture seule,
   * « Exporter le dossier… » (#169), « Déplacer vers… » (#167), « Retirer… ».
   *
   * **« Rafraîchir l'arborescence » reste en tête des dossiers de premier niveau**, là où il vivait
   * sur les projets : sa portée est l'arbre entier, et la racine est l'endroit le moins mensonger
   * pour l'accrocher.
   */
  if (noeud.kind === 'folder') {
    const folder = noeud.folder
    if (folder === undefined) return undefined
    const lectureSeule = noeud.readOnly === true
    const rafraichir: EntreeDeMenu[] =
      noeud.depth === 0
        ? [
            {
              libelle: t('explorer.sidebar.menu.refreshTree'),
              icone: 'refresh',
              onClick: c.onRefresh,
              raison: c.onRefresh ? undefined : RAISONS.rafraichirIndisponible,
            },
          ]
        : []
    return [
      ...rafraichir,
      {
        // **Le geste part du palier qui connaît son contexte** : le dossier est le cadre d'`A2`.
        libelle: t('explorer.sidebar.menu.newConnection'),
        icone: 'plus',
        onClick: c.onAddDatabase ? () => c.onAddDatabase?.(folder) : undefined,
        raison: c.onAddDatabase ? undefined : RAISONS.ajoutIndisponible,
      },
      {
        // **Création immédiate, puis renommage sur place** : aucune modale ne nomme un objet à sa
        // création — le dossier naît « dossier N », là où il sera.
        libelle: t('explorer.sidebar.menu.newFolder'),
        icone: 'pin',
        onClick: c.creerUnDossier ? () => c.creerUnDossier?.(noeud) : undefined,
        raison: c.creerUnDossier ? undefined : RAISONS.dossierIndisponible,
      },
      {
        libelle: t('explorer.sidebar.menu.rename'),
        icone: 'pencil',
        onClick: c.renommageDisponible ? () => c.demanderLeRenommage(noeud.id) : undefined,
        raison: c.renommageDisponible ? undefined : RAISONS.renommerIndisponible,
      },
      {
        /* **« Couleur et icône… », et non « Apparence… »** (#171) : un mot qui résume cacherait ce
           que l'entrée a gagné — on ne cherche pas l'icône d'un dossier sous « Apparence », on la
           cherche à côté de sa couleur. Nommer les deux est ce qui rend le second geste trouvable. */
        libelle: t('explorer.sidebar.menu.appearance'),
        icone: 'paint',
        onClick: c.colorer ? () => c.colorer?.(folder) : undefined,
        raison: c.colorer ? undefined : RAISONS.dossierIndisponible,
      },
      {
        /* **Désactivée avec sa raison sous un ancêtre en lecture seule** : celle-ci s'impose à tous
           les descendants (#108), donc la régler ici ne changerait rien — et la lever laisserait
           croire que le dossier devient inscriptible. La raison nomme l'ancêtre à lever. */
        libelle: lectureSeule
          ? t('explorer.sidebar.menu.liftReadOnly')
          : t('explorer.sidebar.menu.setReadOnly'),
        // Le glyphe dit l'état d'arrivée, comme la bascule de la grille (`API-48`).
        icone: lectureSeule ? 'unlock' : 'lock',
        onClick:
          c.onSetFolderReadOnly && noeud.imposeePar === undefined
            ? () =>
                void c.onSetFolderReadOnly?.(folder, !lectureSeule).catch((refus) =>
                  // **Le refus se dit** (#168) : une transaction manuelle ouverte sur une connexion
                  // du dossier l'empêche, et un menu qui se ferme sans effet se lirait comme une
                  // panne.
                  c.refuserLaLectureSeule(noeud.label, refus),
                )
            : undefined,
        raison:
          noeud.imposeePar !== undefined
            ? RAISONS.lectureSeuleImposee(noeud.imposeePar)
            : c.onSetFolderReadOnly
              ? undefined
              : RAISONS.dossierIndisponible,
      },
      {
        /* **Exporter ce dossier et son sous-arbre** (#169) : il devient un dossier racine du
           fichier, sa lecture seule et ses libellés hérités matérialisés par le cœur. Il ne
           configure rien et n'ouvre rien — il produit un fichier —, donc il vient après les
           réglages et avant le geste destructeur, qui reste le dernier. `dl`, le glyphe de l'export
           dans tout le produit, apparié à `ul` de l'import. */
        libelle: t('transfer.export.menu'),
        icone: 'dl',
        onClick: c.onExportFolder ? () => c.onExportFolder?.(folder, noeud.label) : undefined,
        raison: c.onExportFolder ? undefined : RAISONS.exportIndisponible,
      },
      {
        /* **« Déplacer vers… », juste avant le geste destructeur** (#167) : le chemin clavier du
           glisser-déposer. Un chemin unique à la souris est un chemin que personne ne trouve au
           clavier. `goto`, le glyphe de « suivre » ailleurs dans le produit. */
        libelle: t('explorer.sidebar.menu.moveTo'),
        icone: 'goto',
        onClick: c.demanderLeDeplacement
          ? () => c.demanderLeDeplacement?.({ kind: 'folder', folder })
          : undefined,
        raison: c.demanderLeDeplacement ? undefined : RAISONS.deplacementIndisponible,
      },
      {
        // **« Retirer… » et non « Supprimer… »** : ce qui part est une déclaration sur cet
        // ordinateur, pas une base de données (`08j`).
        libelle: t('explorer.sidebar.menu.removeFromDoraBase'),
        icone: 'trash',
        onClick: c.demanderLeRetrait
          ? () =>
              c.demanderLeRetrait?.({
                kind: 'folder',
                folder,
                nom: noeud.label,
                connexions: noeud.connexions ?? 0,
              })
          : undefined,
        raison: c.demanderLeRetrait ? undefined : RAISONS.retirerIndisponible,
      },
    ]
  }

  /* **Le menu d'une console** : renommer, retirer. Pas de « Modifier… » — une console se modifie en
     l'ouvrant et en y écrivant, ce que le clic sur la ligne fait déjà. */
  if (noeud.kind === 'console') {
    const { connection, console: nom } = noeud
    const consoles = c.consoles
    if (consoles === undefined || connection === undefined || nom === undefined) return undefined
    return [
      {
        /* **Le même mécanisme que le double-clic**, pas une modale. L'entrée reste : un geste qui
           n'existe qu'au double-clic est invisible pour qui ne l'essaie pas, et inatteignable au
           clavier. */
        libelle: t('explorer.sidebar.menu.rename'),
        icone: 'pencil',
        onClick: () => c.demanderLeRenommage(noeud.id),
      },
      {
        libelle: t('explorer.sidebar.menu.removeEllipsis'),
        icone: 'trash',
        onClick: () => consoles.onRetirer(connection, nom),
      },
    ]
  }

  /* **Le menu d'un schéma** : son diagramme. La ligne de schéma est le seul endroit du produit qui
     nomme un schéma à tout moment (3 septembre 2026). */
  if (noeud.kind === 'schema') {
    const { connection, schema } = noeud
    if (connection === undefined || schema === undefined) return undefined
    return [
      {
        libelle: t('explorer.sidebar.menu.openDiagram'),
        icone: 'plan',
        onClick: c.onOpenDiagram ? () => c.onOpenDiagram?.(connection, schema) : undefined,
        raison: c.onOpenDiagram ? undefined : RAISONS.diagrammeIndisponible,
      },
    ]
  }

  /*
   * **Le menu d'un objet** : copier son nom (#162). **Le nom, pas le libellé** — `noeud.object` —,
   * et **le nom nu**, `orders` et non `public.orders`. Muet, comme les autres copies du produit.
   */
  if (noeud.kind === 'object') {
    const nom = noeud.object
    if (nom === undefined) return undefined
    return [
      {
        libelle: t('explorer.sidebar.menu.copyName'),
        icone: 'copy',
        onClick: () => void navigator.clipboard?.writeText(nom),
      },
    ]
  }

  if (noeud.kind !== 'database') return undefined

  // **L'identifiant, jamais le libellé ni le nom** : deux connexions homonymes vivent dans deux
  // dossiers, et c'est l'identifiant qui les distingue (#166).
  const { connection } = noeud
  if (connection === undefined) return undefined
  const estPostgres = noeud.engine === 'postgresql'

  return [
    {
      /* **La création d'une console part d'ici** : une console appartient à une connexion. */
      libelle: t('explorer.sidebar.menu.newConsole'),
      icone: 'term',
      onClick: c.consoles ? () => c.consoles?.onCreer(connection) : undefined,
      raison: c.consoles ? undefined : RAISONS.consoleIndisponible,
    },
    {
      /* **« Gérer les schémas… » en seconde position** (`API-33`). Hors PostgreSQL, l'entrée reste
         et se désactive avec sa raison : la cacher ferait croire qu'elle n'existera jamais. */
      libelle: t('explorer.sidebar.menu.manageSchemas'),
      icone: 'schema',
      onClick: c.onManageSchemas && estPostgres ? () => c.onManageSchemas?.(connection) : undefined,
      raison: estPostgres
        ? c.onManageSchemas
          ? undefined
          : RAISONS.schemasIndisponible
        : RAISONS.schemasHorsPostgres,
    },
    {
      /* **« Renommer… » et « Modifier… » sont deux entrées** (`26`) : le nom se corrige sur place,
         les autres réglages se relisent ensemble dans un formulaire. */
      libelle: t('explorer.sidebar.menu.rename'),
      icone: 'pencil',
      onClick: c.renommageDisponible ? () => c.demanderLeRenommage(noeud.id) : undefined,
      raison: c.renommageDisponible ? undefined : RAISONS.renommerIndisponible,
    },
    {
      libelle: t('explorer.sidebar.menu.edit'),
      icone: 'pencil',
      onClick: c.onEditDatabase ? () => c.onEditDatabase?.(connection) : undefined,
      raison: c.onEditDatabase ? undefined : RAISONS.modifierIndisponible,
    },
    {
      // **Le même geste que sur un dossier** (#167), à la même place : juste avant « Retirer… ».
      libelle: t('explorer.sidebar.menu.moveTo'),
      icone: 'goto',
      onClick: c.demanderLeDeplacement
        ? () => c.demanderLeDeplacement?.({ kind: 'database', connection })
        : undefined,
      raison: c.demanderLeDeplacement ? undefined : RAISONS.deplacementIndisponible,
    },
    {
      libelle: t('explorer.sidebar.menu.removeFromDoraBase'),
      icone: 'trash',
      onClick: c.demanderLeRetrait
        ? () =>
            c.demanderLeRetrait?.({
              kind: 'database',
              connection,
              nom: noeud.label,
              connexions: 1,
            })
        : undefined,
      raison: c.demanderLeRetrait ? undefined : RAISONS.retirerIndisponible,
    },
  ]
}

/** Le nom que le menu annonce : celui de la console pour une console, le libellé sinon. */
function cibleDe(noeud: Noeud): string {
  return noeud.kind === 'console' ? (noeud.console ?? noeud.label) : noeud.label
}

/** Le « … » de la ligne, ou rien du tout quand elle n'a pas d'actions. */
function renderActions(
  noeud: Noeud,
  entrees: readonly EntreeDeMenu[] | undefined,
): ReactNode | undefined {
  if (entrees === undefined) return undefined
  return <RowMenu cible={cibleDe(noeud)} entrees={entrees} />
}

/**
 * Pourquoi une entrée n'est pas encore là — **dite, jamais devinée**. La règle de `09f`, et la
 * leçon du défaut n° 36 : un bouton cliquable et inerte se lit comme une panne.
 */
function raisons(t: ReturnType<typeof useT>) {
  return {
    renommerIndisponible: t('explorer.sidebar.raisons.renameUnavailable'),
    retirerIndisponible: t('explorer.sidebar.raisons.removeUnavailable'),
    modifierIndisponible: t('explorer.sidebar.raisons.editUnavailable'),
    dossierIndisponible: t('explorer.sidebar.raisons.folderUnavailable'),
    lectureSeuleImposee: (dossier: string) =>
      t('explorer.sidebar.raisons.readOnlyImposed', { dossier }),
    rafraichirIndisponible: t('explorer.sidebar.raisons.refreshUnavailable'),
    consoleIndisponible: t('explorer.sidebar.raisons.consoleUnavailable'),
    ajoutIndisponible: t('explorer.sidebar.raisons.addUnavailable'),
    diagrammeIndisponible: t('explorer.sidebar.raisons.diagramUnavailable'),
    schemasIndisponible: t('explorer.sidebar.raisons.schemasUnavailable'),
    schemasHorsPostgres: t('explorer.sidebar.raisons.schemasPostgresOnly'),
    exportIndisponible: t('explorer.sidebar.raisons.exportUnavailable'),
    deplacementIndisponible: t('explorer.sidebar.raisons.moveUnavailable'),
  }
}

/**
 * Vrai quand ces colonnes sont **déduites** et non déclarées (`13c`).
 *
 * La fréquence est `None` pour un moteur relationnel — une colonne y existe pour toutes les lignes,
 * la question ne se pose pas (`18d`). Sa présence est donc le signal, et il vient de la donnée : un
 * drapeau passé par l'appelant serait un drapeau qu'on peut oublier de poser.
 */
function estDeduit(colonnes: readonly ColumnInfo[]): boolean {
  return colonnes.some((colonne) => colonne.frequency !== null)
}

/**
 * `98 %` pour un champ partiel, `null` pour un champ complet ou déclaré.
 *
 * **Un champ à 100 % n'est pas garanti pour autant** : l'échantillon n'est pas la collection. C'est
 * la limite de l'exercice, et elle est dite dans le titre de la section — « déduit » — plutôt que
 * répétée sur chaque ligne.
 */
function frequenceLisible(colonne: ColumnInfo): string | null {
  if (colonne.frequency === null || colonne.frequency >= 0.995) return null
  return `${Math.round(colonne.frequency * 100)} %`
}

/** La couleur d'un dossier telle que l'arbre la porte — la modale s'ouvre sur elle. */
function couleurDe(arbre: FolderTree, id: FolderId): FolderColor | null {
  return dossier(arbre, id)?.dossier.color ?? null
}

/**
 * Le message d'un refus du cœur, quelle qu'en soit la forme : une chaîne pour les commandes de
 * configuration, un objet à `message` pour celles du moteur. Un `[object Object]` dans une modale
 * serait pire que rien.
 */
function messageDuRefus(refus: unknown): string {
  if (typeof refus === 'string') return refus
  if (refus !== null && typeof refus === 'object' && 'message' in refus) {
    return String((refus as { message: unknown }).message)
  }
  return String(refus)
}
