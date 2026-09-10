import { type ReactNode, useMemo, useState } from 'react'
import type { EnvironmentId, Project } from '../../domain/config'
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
import { INDENT, TreeRow } from '../../ui/TreeRow/TreeRow'
import { aplatir, type Charge, type Deplies, type Noeud } from './arbre'
import { type CibleDeSuppression, DeleteConnectionDialog } from './DeleteConnectionDialog'
import styles from './ExplorerSidebar.module.css'
import { type RapportDeRenommage, RenameReportDialog } from './RenameReportDialog'
import { RowMenu } from './RowMenu'

export type ExplorerSidebarProps = {
  projects: readonly Project[]
  deplies: Deplies
  charge: Charge
  etatDe: (project: string, database: string, environment: EnvironmentId) => ConnectionState
  selectedId?: string | null
  onToggle: (noeud: Noeud) => void
  onSelect: (noeud: Noeud) => void
  /**
   * Ouvre la déclaration d'une connexion **dans un environnement d'un projet** (26 août 2026).
   *
   * La cible est **obligatoire**, et c'est le point : une connexion appartient à un environnement,
   * donc le geste ne peut partir que d'un endroit qui sait lequel. Le pied de la sidebar devait
   * deviner, le raccourci `⇧⌘N` aussi — les deux ont été retirés, et le type dit maintenant pourquoi
   * ils ne pouvaient pas marcher.
   */
  onAddDatabase?: (cible: { project: string; environment: EnvironmentId }) => void
  /**
   * Ouvre l'étape 1 du parcours de création (`24d`).
   *
   * Absent, le bouton n'est pas rendu — et non rendu inerte : un contrôle qui ne fait rien est pire
   * qu'un contrôle absent (défaut n° 36). C'est le cas de la galerie, où aucune commande ne répond.
   */
  onNewProject?: () => void
  /**
   * Ouvre les préférences (`API-46`), depuis la fin de la bande de tête.
   *
   * **C'est le seul point d'entrée dans l'écran de travail** : l'engrenage a quitté la barre de titre,
   * qui n'y porte plus aucune action. Il y reste sur l'accueil, faute d'arborescence où le mettre.
   *
   * Absent, le bouton n'est pas rendu — jamais rendu inerte : c'est la règle de `onNewProject` juste
   * au-dessus, et le cas de la galerie, où aucune modale ne répond.
   */
  onOpenPreferences?: () => void
  onRefresh?: () => void
  /**
   * Ce qu'on peut faire d'une console depuis l'arbre — créer, renommer, retirer.
   *
   * **La création part du menu d'une connexion**, et de là seulement : une console appartient à une
   * connexion, et l'endroit où on la crée doit dire laquelle. Créer l'ouvre — personne ne crée une
   * console pour ne pas l'ouvrir.
   */
  consoles?: {
    onCreer: (project: string, database: string, environment: EnvironmentId) => void
    /** Le nouveau nom est **fourni** : le renommage se fait sur place, il n'ouvre pas de modale. */
    onRenommer: (
      project: string,
      database: string,
      environment: EnvironmentId,
      nom: string,
      nouveau: string,
    ) => void
    onRetirer: (project: string, database: string, environment: EnvironmentId, nom: string) => void
  }
  /**
   * Ouvre le diagramme de structure d'un schéma, depuis le menu de sa ligne (3 septembre 2026).
   *
   * **La ligne de schéma est le seul endroit du produit qui nomme un schéma à tout moment** — voir la
   * note de tête d'`entreesDe`. Absent, l'entrée est désactivée avec sa raison : c'est le cas de la
   * galerie, où aucun onglet ne s'ouvre.
   */
  onOpenDiagram?: (
    project: string,
    database: string,
    environment: EnvironmentId,
    schema: string,
  ) => void
  /**
   * Modifier la configuration d'une base depuis son « … » (`08h`) — ouvre la modale de `08g`.
   *
   * Absent, l'entrée « Modifier… » est désactivée avec sa raison plutôt que cliquable et inerte.
   */
  onEditDatabase?: (project: string, database: string, environment: EnvironmentId) => void
  /**
   * Ouvre le gestionnaire de schémas d'une connexion (`API-33`).
   *
   * **Depuis le menu de la connexion**, comme la création d'une console et pour la même raison : le
   * geste part du palier qui connaît son contexte, et une bande en tête de colonne devrait deviner
   * de quelle connexion il s'agit.
   *
   * Absent, l'entrée est désactivée avec sa raison. Hors PostgreSQL elle l'est aussi, avec une autre
   * raison — voir `entreesDe` : la cacher ferait croire qu'elle n'existera jamais.
   */
  onManageSchemas?: (project: string, database: string, environment: EnvironmentId) => void
  /**
   * Renomme une connexion depuis sa ligne (`26`).
   *
   * **Sur place, et non dans une modale** : le nom est le seul champ concerné, et l'ouverture d'un
   * formulaire pour un mot à corriger est ce que le renommage de console a déjà refusé. Le geste rend
   * ce qu'il y a à dire — un mot de passe introuvable, un résidu dans le Trousseau — et **rejette**
   * avec le refus du cœur : un nom déjà pris dans cet environnement (`23b`).
   *
   * Absent, l'entrée « Renommer… » est désactivée avec sa raison plutôt que cliquable et inerte.
   */
  onRenameDatabase?: (
    project: string,
    database: string,
    environment: EnvironmentId,
    nouveau: string,
  ) => Promise<{ missingSecrets: string[]; leftoverSecrets: string[] }>
  /**
   * Ouvre la modale d'édition d'un projet depuis son « … » (`23e`).
   *
   * **Elle remplace « Renommer… »** : le renommage de `08i` est devenu le premier champ de cet écran,
   * et l'ancienne modale n'existe plus. La sidebar ne monte donc plus rien elle-même pour ce geste —
   * la modale vit dans l'écran de travail, qui porte aussi l'autre point d'entrée (la pastille de la
   * barre de titre). Absent, l'entrée est désactivée avec sa raison.
   */
  onEditProject?: (project: string) => void
  /**
   * Retirer la déclaration d'une base, ou un projet entier (`08j`).
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
  projects,
  deplies,
  charge,
  etatDe,
  selectedId = null,
  onToggle,
  onSelect,
  onAddDatabase,
  onNewProject,
  onOpenPreferences,
  onRefresh,
  consoles,
  onOpenDiagram,
  onEditDatabase,
  onManageSchemas,
  onRenameDatabase,
  onEditProject,
  onDelete,
  modificationsEnAttenteDe,
  columns,
  width = 'wide',
  modifications,
}: ExplorerSidebarProps) {
  const t = useT()
  const [filtre, setFiltre] = useState('')
  /**
   * La ligne en cours de renommage, par identité de nœud — une console (`12f`) ou une connexion
   * (`26`).
   *
   * **Un seul état pour les deux sortes** : une seule ligne se renomme à la fois, et deux états
   * jumeaux auraient permis d'en éditer deux, dont une invisible.
   *
   * **Ici et non chez l'appelant** : c'est un état d'interface, qui meurt avec la ligne et n'intéresse
   * ni l'écran de travail ni le disque. Le remonter aurait fait voyager un identifiant de nœud à
   * travers deux composants pour revenir se poser sur la même ligne.
   */
  const [enRenommage, setEnRenommage] = useState<string | null>(null)
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

  const noeuds = useMemo(
    () => aplatir(projects, deplies, charge, etatDe, t),
    [projects, deplies, charge, etatDe, t],
  )

  const visibles = useMemo(() => filtrer(noeuds, filtre), [noeuds, filtre])

  /**
   * Les actions d'une ligne, câblées sur cet écran.
   *
   * **Une seule construction pour les deux ouvertures** — le « … » et le clic droit : le menu est le
   * même, seule la façon de le demander change. Deux listes d'entrées auraient divergé d'une action
   * au premier ajout, et c'est le genre d'écart qu'on ne remarque qu'en montrant le produit.
   */
  const actionsDe = (noeud: Noeud): readonly EntreeDeMenu[] | undefined =>
    entreesDe(
      noeud,
      onAddDatabase,
      onEditDatabase,
      onManageSchemas,
      onRenameDatabase !== undefined,
      onEditProject,
      demanderLeRetrait,
      onRefresh,
      consoles,
      onOpenDiagram,
      setEnRenommage,
      t,
    )

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
    if (noeud.project === undefined || noeud.environment === undefined) return

    if (noeud.kind === 'console' && consoles !== undefined) {
      if (noeud.database === undefined || noeud.console === undefined) return
      consoles.onRenommer(noeud.project, noeud.database, noeud.environment, noeud.console, nouveau)
      return
    }

    if (noeud.kind === 'database' && onRenameDatabase !== undefined) {
      if (noeud.database === undefined) return
      const project = noeud.project
      const environment = noeud.environment
      // **`database`, jamais `label`.** L'ancien nom envoyé au renommage est l'identité de la
      // connexion — voir la note sur `label` ci-dessus, à l'endroit où `TreeRow` reçoit ses props.
      // Le refus et les réserves ne sont pas attendus par le champ, qui est déjà démonté : ils
      // arrivent dans le rapport, seul endroit où un renommage sur place peut parler.
      void onRenameDatabase(project, noeud.database, environment, nouveau).then(
        (issue) => {
          if (issue.missingSecrets.length > 0 || issue.leftoverSecrets.length > 0) {
            setRapport({ nom: nouveau, ...issue })
          }
        },
        (erreur: unknown) => {
          setRapport({
            nom: nouveau,
            refus: String(erreur),
            missingSecrets: [],
            leftoverSecrets: [],
          })
        },
      )
    }
  }

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
             elle. Un seul geste pour l'instant, créer un projet, et c'est délibéré : la bande
             accueillera les suivants, chacun nommé par son glyphe.

             **« Ajouter une connexion » n'y est pas**, et c'est la même raison qui avait déjà chassé
             « Nouvelle console » du pied : une connexion appartient à un environnement, et une bande en
             tête de colonne ne sait pas lequel. Le menu d'une ligne d'environnement, lui, ne devine
             rien.

             **Ce que le pied coûtait** : 78 px pris sur la hauteur de l'arbre, pour deux boutons à
             libellé qui devaient s'annoncer parce qu'ils vivaient seuls en bas d'une colonne. En tête,
             la bande coûte moins, vit là où l'on cherche les actions d'un panneau, et peut porter des
             icônes seules.

             **`plus`, pas `bag`** (27 août 2026) : le sac reste le glyphe du *projet* — celui de
             chaque ligne de l'arbre — mais ce bouton ne désigne pas un projet, il **en crée un**. Une
             icône nue sans « + » se lisait comme un raccourci vers un projet déjà là, pas comme un
             geste d'ajout — la même confusion que le `+` de la grille (`AGENTS.md`) écarte pour une
             ligne. */
          (onNewProject || onOpenPreferences) && (
            <SidebarToolbar>
              {onNewProject && (
                <SidebarToolbarButton
                  icon="plus"
                  label={t('explorer.sidebar.newProject')}
                  title={t('explorer.sidebar.newProjectTitle', { raccourci: raccourci('N') })}
                  onClick={onNewProject}
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
        <div role="tree" aria-label={t('explorer.sidebar.treeLabel')} className={styles.tree}>
          {visibles.length === 0 && filtre !== '' && (
            <p className={styles.vide}>{t('explorer.sidebar.noMatch', { filtre })}</p>
          )}
          {visibles.map((noeud) =>
            noeud.message ? (
              // Une ligne de message n'est pas un `treeitem` : ce n'est pas un nœud de l'arbre
              // mais un état de son chargement, et l'annoncer comme tel ferait compter un
              // enfant qui n'existe pas.
              // L'indentation vient d'`INDENT`, la table exportée par `TreeRow` : le CSS en
              // tenait une copie, qu'un palier ajouté aurait laissée en retard (`25a`).
              <p
                key={noeud.id}
                className={styles.message}
                style={{ paddingLeft: INDENT[noeud.depth] }}
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
                strong={noeud.kind === 'project'}
                trailing={
                  noeud.badge ? (
                    <Badge tone={noeud.badge.tone} size="xs">
                      {noeud.badge.text}
                    </Badge>
                  ) : undefined
                }
                actions={renderActions(noeud, actionsDe(noeud))}
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
                onClick={() => onSelect(noeud)}
                onChevron={noeud.chevron ? () => onToggle(noeud) : undefined}
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

/**
 * Le menu « … » d'une ligne, ou rien (`08h`).
 *
 * **Les lignes qui portent une configuration en ont un** — projet, environnement, connexion,
 * console. Une table n'en a pas : ce qu'un menu y offrirait — copier le nom, ouvrir dans un onglet —
 * double un geste que le clic fait déjà.
 *
 * **Le schéma a fait exception le 3 septembre 2026, et c'est un cas à part motivé.** Ce commentaire
 * disait « seuls le projet et la base en ont un », et sa raison — il n'y a rien à configurer sur un
 * schéma — reste vraie : le diagramme n'est pas de la configuration. Ce qui décide, c'est qu'un
 * diagramme parle d'un **schéma** et que la ligne de schéma est le seul endroit du produit qui en
 * nomme un à tout moment. Le fil d'Ariane du centre en nomme un aussi, mais il disparaît dès qu'un
 * onglet s'ouvre — c'est-à-dire précisément quand on voudrait revenir au diagramme. C'est le même
 * raisonnement que « le geste part du palier qui connaît son contexte », appliqué à un geste de
 * lecture plutôt qu'à un geste de configuration.
 */
function entreesDe(
  noeud: Noeud,
  onAddDatabase: ExplorerSidebarProps['onAddDatabase'],
  onEditDatabase: ExplorerSidebarProps['onEditDatabase'],
  onManageSchemas: ExplorerSidebarProps['onManageSchemas'],
  /**
   * Un booléen et non la fonction : ce menu n'appelle pas le renommage, il **passe la ligne en
   * édition** — c'est le champ de saisie qui appellera. Il n'a donc besoin que de savoir si l'action
   * aboutira, pour désactiver l'entrée avec sa raison plutôt que de l'offrir en vain.
   */
  renommageDisponible: boolean,
  onEditProject: ExplorerSidebarProps['onEditProject'],
  demanderLeRetrait: ((cible: CibleDeSuppression) => void) | undefined,
  onRefresh: ExplorerSidebarProps['onRefresh'],
  consoles: ExplorerSidebarProps['consoles'],
  onOpenDiagram: ExplorerSidebarProps['onOpenDiagram'],
  demanderLeRenommage: (id: string) => void,
  t: ReturnType<typeof useT>,
): readonly EntreeDeMenu[] | undefined {
  const RAISONS = raisons(t)
  if (noeud.kind === 'project') {
    return [
      {
        /* **« Rafraîchir l'arborescence », et non « Rafraîchir »** — l'action a quitté le pied
               de la sidebar le 20 août 2026, où son icône seule faisait nombre avec trois boutons
               de création qu'elle ne rejoignait pas.

               Le nom long lève une ambiguïté qui existait déjà : la toolbar d'une table porte un
               « Rafraîchir » qui relit **les lignes**, quand celui-ci vide le cache de **l'arbre**.
               Deux boutons de même nom pour deux portées différentes — `e2e/10e-toolbar.spec.ts` le
               contournait par un commentaire.

               Sa portée est celle de l'arbre entier, pas du seul projet cliqué ; le menu d'une ligne
               projet est néanmoins le seul déjà monté, et la racine est l'endroit le moins mensonger
               pour l'accrocher. */
        libelle: t('explorer.sidebar.menu.refreshTree'),
        icone: 'refresh',
        onClick: onRefresh,
        raison: onRefresh ? undefined : RAISONS.rafraichirIndisponible,
      },
      {
        // **« Modifier le projet… » et non « Renommer… »** (`23e`) : l'écran fait les deux, et
        // un libellé qui n'annonce que le renommage cacherait les environnements.
        libelle: t('explorer.sidebar.menu.editProject'),
        icone: 'pencil',
        onClick: onEditProject ? () => onEditProject(noeud.label) : undefined,
        raison: onEditProject ? undefined : RAISONS.editionIndisponible,
      },
      {
        // **« Retirer… » et non « Supprimer… »** : le mot compte, et c'est toute la décision de
        // `08j`. Ce qui part est une déclaration sur cet ordinateur, pas une base de données.
        libelle: t('explorer.sidebar.menu.removeFromDoraBase'),
        icone: 'trash',
        onClick: demanderLeRetrait
          ? () =>
              demanderLeRetrait({
                kind: 'project',
                project: noeud.label,
                connexions: noeud.connexions ?? 0,
              })
          : undefined,
        raison: demanderLeRetrait ? undefined : RAISONS.retirerIndisponible,
      },
    ]
  }

  /*
   * **Le menu d'un environnement** : y ajouter une connexion, et rien d'autre.
   *
   * Une connexion appartient à un environnement d'un projet (`23b`) : c'est l'endroit qui dit lequel,
   * exactement comme le menu d'une connexion est l'endroit d'où l'on crée une console. Le pied de la
   * sidebar, lui, devait deviner — et se tromper dès que deux projets étaient dépliés.
   *
   * Pas de « Retirer… » ni de « Renommer… » ici : les environnements d'un projet se déclarent
   * ensemble, dans « Modifier le projet… » (`23e`), et l'identifiant d'un environnement est figé à sa
   * création. Deux entrées de plus feraient croire à un geste qui n'existe pas.
   */
  if (noeud.kind === 'environment') {
    const { project, environment } = noeud
    if (project === undefined || environment === undefined) return undefined
    return [
      {
        libelle: t('explorer.sidebar.menu.addConnection'),
        icone: 'plus',
        onClick: onAddDatabase ? () => onAddDatabase({ project, environment }) : undefined,
        raison: onAddDatabase ? undefined : RAISONS.ajoutIndisponible,
      },
    ]
  }

  /* **Le menu d'une console** : renommer, retirer. Pas de « Modifier… » — une console se modifie en
     l'ouvrant et en y écrivant, ce que le clic sur la ligne fait déjà. */
  if (noeud.kind === 'console') {
    const { project, database, environment, console: nom } = noeud
    if (
      consoles === undefined ||
      project === undefined ||
      database === undefined ||
      environment === undefined ||
      nom === undefined
    ) {
      return undefined
    }
    return [
      {
        /* **Le même mécanisme que le double-clic**, pas une modale. L'entrée reste malgré tout :
               un geste qui n'existe qu'au double-clic est invisible pour qui ne l'essaie pas, et
               inatteignable au clavier. Elle passe la ligne en édition, le champ prend le focus. */
        libelle: t('explorer.sidebar.menu.rename'),
        icone: 'pencil',
        onClick: () => demanderLeRenommage(noeud.id),
      },
      {
        // **« Retirer… » et non « Supprimer… »**, comme partout : le mot est celui de `08j`.
        libelle: t('explorer.sidebar.menu.removeEllipsis'),
        icone: 'trash',
        onClick: () => consoles.onRetirer(project, database, environment, nom),
      },
    ]
  }

  /*
   * **Le menu d'un schéma** : son diagramme, et rien d'autre.
   *
   * Voir la note de tête pour la raison d'être de ce menu. Une seule entrée, comme celui d'un
   * environnement — la bande accueillera les suivantes si le schéma en gagne.
   */
  if (noeud.kind === 'schema') {
    const { project, database, environment, schema } = noeud
    if (
      project === undefined ||
      database === undefined ||
      environment === undefined ||
      schema === undefined
    ) {
      return undefined
    }
    return [
      {
        libelle: t('explorer.sidebar.menu.openDiagram'),
        icone: 'plan',
        onClick: onOpenDiagram
          ? () => onOpenDiagram(project, database, environment, schema)
          : undefined,
        raison: onOpenDiagram ? undefined : RAISONS.diagrammeIndisponible,
      },
    ]
  }

  if (noeud.kind !== 'database') return undefined

  // Les coordonnées viennent du **nœud**, jamais d'une déduction sur son libellé : deux bases
  // peuvent porter le même nom dans deux projets, et c'est la clé d'identité de `05a`.
  //
  // **`database`, jamais `label`.** Depuis que `label` peut afficher un libellé distinct du nom
  // réel (`27a`), c'est `database` — resté `base.name` dans `arbre.ts` — qui reste l'identité à
  // envoyer aux commandes IPC. `label` divergerait dès qu'une connexion porte un libellé, et ces
  // appels viseraient une base qui n'existe pas.
  const { project, database, environment } = noeud
  // Le moteur, tel que le nœud le porte (`API-33`) : c'est lui qui décide si le gestionnaire de
  // schémas est cliquable ou désactivé avec sa raison.
  const estPostgres = noeud.engine === 'postgresql'
  const modifiable =
    onEditDatabase !== undefined && project !== undefined && environment !== undefined

  return [
    {
      /* **La création d'une console part d'ici**, et non du pied de la sidebar. Une console
             appartient à une connexion : l'endroit d'où on la crée doit dire laquelle, sans quoi il
             faudrait deviner le contexte — et se tromper dès que deux connexions sont dépliées. */
      libelle: t('explorer.sidebar.menu.newConsole'),
      icone: 'term',
      onClick:
        consoles && project !== undefined && database !== undefined && environment !== undefined
          ? () => consoles.onCreer(project, database, environment)
          : undefined,
      raison: consoles ? undefined : RAISONS.consoleIndisponible,
    },
    {
      /* **« Gérer les schémas… » en seconde position**, juste après la console (`API-33`). Les deux
         premières entrées du menu sont les deux gestes qui *ouvrent* quelque chose ; les trois
         suivantes configurent la déclaration ou la retirent.

         **Hors PostgreSQL, l'entrée reste et se désactive avec sa raison.** La cacher ferait croire
         qu'elle n'existera jamais, quand c'est un « pas encore » — la distinction que les cinq
         verdicts de disponibilité du dump tiennent déjà. Et le moteur vient du **nœud**, non d'une
         déduction sur son icône. */
      libelle: t('explorer.sidebar.menu.manageSchemas'),
      icone: 'schema',
      onClick:
        onManageSchemas &&
        estPostgres &&
        project !== undefined &&
        database !== undefined &&
        environment !== undefined
          ? () => onManageSchemas(project, database, environment)
          : undefined,
      raison: estPostgres
        ? onManageSchemas
          ? undefined
          : RAISONS.schemasIndisponible
        : RAISONS.schemasHorsPostgres,
    },
    {
      /* **« Renommer… » et « Modifier… » sont deux entrées, pas une** (`26`). Le nom est le seul
             champ qui se corrige sur place, et le seul dont le changement déplace un mot de passe
             dans le Trousseau ; les autres réglages se relisent ensemble, dans un formulaire. Les
             fondre aurait fait ouvrir une modale de quinze champs pour corriger une lettre. */
      libelle: t('explorer.sidebar.menu.rename'),
      icone: 'pencil',
      onClick: renommageDisponible ? () => demanderLeRenommage(noeud.id) : undefined,
      raison: renommageDisponible ? undefined : RAISONS.renommerIndisponible,
    },
    {
      libelle: t('explorer.sidebar.menu.edit'),
      icone: 'pencil',
      onClick:
        modifiable && database !== undefined
          ? () => onEditDatabase(project as string, database, environment as EnvironmentId)
          : undefined,
      raison: modifiable ? undefined : RAISONS.modifierIndisponible,
    },
    {
      libelle: t('explorer.sidebar.menu.removeFromDoraBase'),
      icone: 'trash',
      onClick:
        demanderLeRetrait && project !== undefined && database !== undefined
          ? () =>
              demanderLeRetrait({
                kind: 'database',
                project,
                database,
                // L'environnement fait partie de l'identité de la connexion (`23b`) : sans lui, le
                // retrait viserait la première connexion de ce nom, quel que soit l'environnement.
                environment: environment as EnvironmentId,
                connexions: noeud.connexions ?? 1,
              })
          : undefined,
      raison: demanderLeRetrait ? undefined : RAISONS.retirerIndisponible,
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
    editionIndisponible: t('explorer.sidebar.raisons.projectEditUnavailable'),
    rafraichirIndisponible: t('explorer.sidebar.raisons.refreshUnavailable'),
    consoleIndisponible: t('explorer.sidebar.raisons.consoleUnavailable'),
    ajoutIndisponible: t('explorer.sidebar.raisons.addUnavailable'),
    diagrammeIndisponible: t('explorer.sidebar.raisons.diagramUnavailable'),
    schemasIndisponible: t('explorer.sidebar.raisons.schemasUnavailable'),
    schemasHorsPostgres: t('explorer.sidebar.raisons.schemasPostgresOnly'),
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
