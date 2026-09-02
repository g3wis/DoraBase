// Les trois règles suivantes sont désactivées pour ce fichier, et pour une seule raison : ce
// composant existe **parce que** `<table>` ne convient pas. `09a` a livré `DataTable`, un vrai
// tableau, pour tous les cas où il convient ; ici la virtualisation impose des lignes
// positionnées, donc des `<div>` porteurs de rôles ARIA. Les silencer à la ligne demanderait une
// dizaine d'annotations dans un même fichier, ce qui les rendrait invisibles.
//
// - `useSemanticElements` : proposerait `<table>`, voir ci-dessus.
// - `useFocusableInteractive` : les cellules ne sont pas focalisables **par choix** — le focus
//   reste sur la grille, qui désigne la ligne courante par `aria-activedescendant`.
// - `useKeyWithClickEvents` : le clavier est géré une fois sur la grille (`↑`, `↓`) plutôt que
//   sur chaque ligne, ce que le motif « grid » de l'APG demande.
// biome-ignore-all lint/a11y/useSemanticElements: voir ci-dessus
// biome-ignore-all lint/a11y/useFocusableInteractive: voir ci-dessus
// biome-ignore-all lint/a11y/useKeyWithClickEvents: voir ci-dessus

import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'
import { Icon } from '../../design/icons/Icon'
import type { IconName } from '../../design/icons/names'
import { cx } from '../cx'
import styles from './VirtualGrid.module.css'

/** Pas du redimensionnement au clavier, en pixels — même valeur que `SplitPane`. */
const PAS_CLAVIER = 8
/** Largeur minimale d'une colonne redimensionnée, faute d'un `minWidth` par colonne. */
const LARGEUR_MIN_PAR_DEFAUT = 60

export type GridColumn<Row> = {
  /** Clé stable, employée pour le rendu et l'association en-tête ↔ cellule. */
  key: string
  header: ReactNode
  /** Largeur en pixels. Le mockup emploie un `<colgroup>` fixe ; ici, une grille CSS. */
  width: number
  /** Aligne à droite — les nombres, dans `A5`. */
  numeric?: boolean
  /** Teinte de fond, pour les colonnes filtrées et triées de `10d`. */
  tint?: 'filtered' | 'sorted'
  cell: (row: Row, index: number) => ReactNode
  /** Cellule de la seconde ligne d'en-tête, quand `filterRow` est demandée. */
  filter?: ReactNode
  /**
   * Retire la poignée de redimensionnement de cette colonne, quand `onColumnResize` est fourni à
   * la grille. La gouttière `#` de `A5` n'a rien à redimensionner : elle n'a pas de contenu dont
   * la largeur varie.
   */
  resizable?: boolean
  /** Largeur minimale que le glissement ou les flèches peuvent atteindre. `60` par défaut. */
  minWidth?: number
  /**
   * Nom accessible de la poignée de redimensionnement de cette colonne. Requis dès que
   * `onColumnResize` est fourni et que la colonne n'est pas exclue par `resizable: false` — une
   * poignée anonyme serait illisible à la voix, comme la grille elle-même (voir `label`).
   */
  resizeLabel?: string
  /**
   * Retire le glissement de cette colonne, quand `onColumnReorder` est fourni à la grille. Même
   * raison que `resizable: false` : la gouttière `#` de `A5` n'a pas de place à changer, elle
   * désigne toujours la première.
   */
  reorderable?: boolean
  /**
   * Nom accessible du glissement de cette colonne. Requis dès que `onColumnReorder` est fourni et
   * que la colonne n'est pas exclue par `reorderable: false` — le bouton qu'il annonce **est**
   * `header`, enveloppé pour porter le geste ; sans ce nom, un lecteur d'écran ne dirait plus que
   * « Déplacer », sans dire quoi.
   */
  reorderLabel?: string
  /**
   * Le tri, en petite flèche **séparée** du reste de l'en-tête — jamais le même contrôle que le
   * glissement.
   *
   * **Pourquoi une flèche à part, et non le clic sur `header` comme avant `23h`.** Le clic sur le
   * nom de la colonne servait le tri ; une fois le glissement posé sur ce même clic, les deux
   * gestes se disputaient la même zone — glisser légèrement un en-tête pouvait déclencher un tri
   * non voulu, trier pouvait interrompre un glissement. Les deux vivent maintenant côte à côte,
   * jamais l'un sur l'autre, comme les deux boutons frères d'un onglet de `TabStrip`.
   */
  sort?: {
    /** Nom accessible du bouton — annonce l'action, pas son état (piège n° 4 de `AGENTS.md`). */
    label: string
    /** `asc`/`desc` une fois ce critère actif, `sort` (neutre) sinon. */
    icon: IconName
    /** Teinte pleine une fois actif ; l'icône seule dit déjà « pas encore trié » sinon. */
    active: boolean
    onClick: (evenement: ReactMouseEvent<HTMLButtonElement>) => void
  }
}

type VirtualGridProps<Row> = {
  /** Nom accessible de la grille. Une grille anonyme est illisible à la voix. */
  label: string
  columns: readonly GridColumn<Row>[]
  rows: readonly Row[]
  rowId: (row: Row, index: number) => string
  /**
   * Hauteur du conteneur de défilement, **en pixels et non mesurée**.
   *
   * jsdom ne calcule aucune mise en page : une virtualisation qui lit `clientHeight` rendrait
   * zéro ligne sous Vitest, et le test « seules les lignes visibles sont montées » passerait
   * pour la mauvaise raison. L'hôte passe une hauteur mesurée, le test une hauteur choisie, et
   * c'est Playwright qui vérifie que la mesure réelle suit le panneau.
   */
  viewportHeight: number
  /**
   * Densité de ligne, en pixels. 26 px dans le mockup.
   *
   * **Une prop et non le jeton `--rowh`**, alors que le jeton existe : la virtualisation a besoin
   * d'un **nombre** — elle calcule quelles lignes monter en divisant le défilement par le pas. Lire
   * une variable CSS depuis le JavaScript demanderait un `getComputedStyle` à chaque rendu, et
   * surtout un observateur pour réagir à son changement. La préférence de `15c` descend donc par les
   * props, du seul endroit qui la détient.
   *
   * Le jeton reste employé par le CSS pour l'en-tête ; c'est cette prop qui règle les lignes.
   */
  rowHeight?: number
  /** Lignes montées en marge de la fenêtre visible, pour que le défilement ne clignote pas. */
  overscan?: number
  /** Rend la seconde ligne d'en-tête, celle des filtres de `10d`. */
  filterRow?: boolean
  /**
   * Redimensionnement des colonnes à la poignée, posée sur le bord droit de chaque en-tête.
   *
   * Absente, aucune poignée ne se rend — c'est le cas de la console de `A7`, dont les colonnes
   * n'ont pas encore ce geste. Appelée au relâchement du geste ou à une flèche du clavier
   * seulement, jamais à chaque `pointermove` : la largeur affichée pendant le glissement reste un
   * état interne de la grille, comme la taille de `SplitPane` pendant sa propre poignée — la
   * relever à chaque trame referait retraverser toute la fenêtre visible chez l'appelant pour
   * rien.
   */
  onColumnResize?: (key: string, width: number) => void
  /**
   * Réordonnancement des colonnes, glissées par leur en-tête ou aux flèches du clavier — même
   * geste que celui des environnements d'un projet (`23c`), transposé à l'horizontale.
   *
   * Absente, aucun en-tête n'est glissable. Appelée avec l'**ordre complet** des clés
   * réordonnables, jamais un couple d'indices : un ordre partiel se lirait de plusieurs façons,
   * dont une qui supprime une colonne.
   */
  onColumnReorder?: (order: readonly string[]) => void
  selectedId?: string | null
  onSelect?: (row: Row, index: number) => void
  /**
   * `Suppr`/`Backspace` sur la ligne sélectionnée, jamais posée en écoute globale.
   *
   * `Delete`/`Backspace` seuls sont ce qu'on tape en permanence dans n'importe quel champ texte — y
   * compris la ligne de filtres de cette grille. La garde ne les laisse passer que depuis la grille
   * elle-même ou depuis une `row` focalisée — la cible normale après un clic de sélection — jamais
   * depuis un champ de filtre ou la boîte de saisie d'une cellule.
   */
  onDeleteKey?: (row: Row, index: number) => void
  /**
   * Teinte une **ligne** entière — celles qui portent une modification en attente (`11b`), ou une
   * marque de suppression (`A6`).
   *
   * Symétrique du `tint` de colonne : la grille connaît les raisons de teinter, `filtered`, `sorted`,
   * `modified` et `deleted`. Passer une classe CSS à la place ferait fuir l'habillage hors du module
   * qui le porte.
   */
  rowTint?: (row: Row, index: number) => 'modified' | 'deleted' | undefined
  /** Teinte une **cellule**, et lui ajoute le coin ambre du mockup (`11b`). */
  cellTint?: (row: Row, column: string) => 'modified' | undefined
  /** Rendu à la place des lignes quand `rows` est vide. */
  empty?: ReactNode
}

/**
 * La grille virtualisée de `A5`.
 *
 * **Une seconde grille, et non `DataTable` virtualisé.** `09a` a séparé les deux
 * délibérément : un vrai `<table>` donne gratuitement l'annonce « en-tête, valeur » à la voix,
 * mais ne se virtualise pas sans mentir sur sa hauteur. `A5` doit tenir 5 000 lignes — le
 * palier maximal de `RowLimit`.
 *
 * **`aria-rowcount` porte le total, `aria-rowindex` l'indice réel.** C'est ce qui permet
 * d'annoncer « ligne 812 sur 5 000 » alors que 812 est la troisième ligne présente dans le
 * DOM. Sans ces deux attributs, la virtualisation ment à l'arbre d'accessibilité au lieu de
 * mentir seulement au navigateur.
 */
export function VirtualGrid<Row>({
  label,
  columns,
  rows,
  rowId,
  viewportHeight,
  rowHeight = 26,
  overscan = 4,
  filterRow = false,
  selectedId = null,
  onSelect,
  onDeleteKey,
  rowTint,
  cellTint,
  empty,
  onColumnResize,
  onColumnReorder,
}: VirtualGridProps<Row>) {
  const [scrollTop, setScrollTop] = useState(0)
  const viewport = useRef<HTMLDivElement>(null)
  // Préfixe des identifiants de ligne : `aria-activedescendant` désigne un `id` du document,
  // qui doit donc être unique même avec deux grilles montées côte à côte.
  const idGrille = useId()

  // La colonne en cours de glissement — même arbitrage que `ProjectEditor` : un état local, pas
  // remonté avant le dépôt, qui ne sert qu'à estomper la colonne saisie (`.glisseeColonne`).
  const [colonneGlissee, setColonneGlissee] = useState<string | null>(null)
  // La colonne survolée pendant le glissement — celle qui recevrait le dépôt. Distincte de
  // `colonneGlissee` : l'une dit ce qu'on tient, l'autre où ça se poserait. `null` quand le
  // pointeur n'est au-dessus d'aucun en-tête réordonnable.
  const [colonneCiblee, setColonneCiblee] = useState<string | null>(null)

  // La largeur en cours de glissement, tenue **hors** de la prop `columns` : la remonter à chaque
  // `pointermove` referait recalculer et retraverser tout ce que l'appelant dérive des colonnes —
  // filtres, tri, colonnes effectives de `A5` — à chaque trame. `onColumnResize` n'est appelé
  // qu'au relâchement ou à une flèche, avec la largeur finale.
  const [enRedimensionnement, setEnRedimensionnement] = useState<{
    key: string
    width: number
  } | null>(null)

  const lignesDEnTete = filterRow ? 2 : 1
  const premiere = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const visibles = Math.ceil(viewportHeight / rowHeight) + overscan * 2
  const derniere = Math.min(rows.length, premiere + visibles)
  const fenetre = rows.slice(premiere, derniere)

  // Colonnes telles qu'affichées : celle qu'on glisse porte sa largeur provisoire, jamais encore
  // remontée à l'appelant. Seul l'en-tête en a besoin — les cellules de donnée ne lisent jamais
  // `colonne.width`, la mise en page venant entièrement du gabarit ci-dessous.
  const colonnesAffichees =
    enRedimensionnement === null
      ? columns
      : columns.map((colonne) =>
          colonne.key === enRedimensionnement.key
            ? { ...colonne, width: enRedimensionnement.width }
            : colonne,
        )

  const gabarit = colonnesAffichees.map((colonne) => `${colonne.width}px`).join(' ')
  /**
   * La largeur du **contenu**, somme des colonnes.
   *
   * Elle est portée par l'en-tête et par la toile, faute de quoi tous deux prennent celle du
   * conteneur : le fond de la ligne sélectionnée s'arrêtait alors au bord droit de la fenêtre, et
   * disparaissait dès qu'on défilait horizontalement. Constaté à l'écran le 10 août 2026, sur une
   * table de trente-quatre colonnes.
   */
  const largeurContenu = colonnesAffichees.reduce((somme, colonne) => somme + colonne.width, 0)

  /** Point de départ commun au glissement et aux flèches : la largeur minimale d'une colonne. */
  function largeurMin(colonne: GridColumn<Row>) {
    return colonne.minWidth ?? LARGEUR_MIN_PAR_DEFAUT
  }

  function debuterLeRedimensionnement(
    evenement: ReactPointerEvent<HTMLDivElement>,
    colonne: GridColumn<Row>,
  ) {
    // Sans `stopPropagation`, le geste remonterait au bouton de glissement qui enveloppe l'en-tête
    // (`headerContentGlissable`) sur les navigateurs où `pointerdown` bulle avant tout autre
    // traitement — la poignée doit redimensionner, jamais déclencher un réordonnancement.
    evenement.stopPropagation()
    evenement.preventDefault()
    const origineX = evenement.clientX
    const largeurOrigine = colonne.width
    const poignee = evenement.currentTarget
    poignee.setPointerCapture?.(evenement.pointerId)
    document.body.classList.add(styles.pendantLeRedimensionnement as string)

    let derniereLargeur = largeurOrigine

    function onMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - origineX
      derniereLargeur = Math.max(largeurMin(colonne), largeurOrigine + delta)
      setEnRedimensionnement({ key: colonne.key, width: derniereLargeur })
    }

    function onUp() {
      poignee.removeEventListener('pointermove', onMove)
      poignee.removeEventListener('pointerup', onUp)
      poignee.removeEventListener('pointercancel', onUp)
      document.body.classList.remove(styles.pendantLeRedimensionnement as string)
      setEnRedimensionnement(null)
      onColumnResize?.(colonne.key, derniereLargeur)
    }

    poignee.addEventListener('pointermove', onMove)
    poignee.addEventListener('pointerup', onUp)
    poignee.addEventListener('pointercancel', onUp)
  }

  function redimensionnerAuClavier(
    evenement: KeyboardEvent<HTMLDivElement>,
    colonne: GridColumn<Row>,
  ) {
    if (evenement.key !== 'ArrowLeft' && evenement.key !== 'ArrowRight') return
    evenement.preventDefault()
    const pas = evenement.key === 'ArrowRight' ? PAS_CLAVIER : -PAS_CLAVIER
    onColumnResize?.(colonne.key, Math.max(largeurMin(colonne), colonne.width + pas))
  }

  /** Les clés des colonnes réordonnables, dans leur ordre d'affichage courant. */
  function clesReordonnables(): string[] {
    return columns.filter((colonne) => colonne.reorderable !== false).map((colonne) => colonne.key)
  }

  /**
   * La colonne réordonnable sous un point de l'écran, ou `null` — le pointeur peut survoler la
   * gouttière `#`, une poignée de redimensionnement, du vide au-delà de la dernière colonne. Un
   * dépôt là ne veut rien dire, l'indicateur ne doit pas plus s'y montrer.
   */
  function colonneSousLePointeur(x: number, y: number): string | null {
    const cle = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-colonne]')
      ?.dataset.colonne
    if (cle === undefined) return null
    return clesReordonnables().includes(cle) ? cle : null
  }

  /** Dépose la colonne `glissee` avant celle qui reçoit, et envoie l'ordre **complet** (`23c`). */
  function deposerColonne(glissee: string, cible: string) {
    if (glissee === cible) return
    const cles = clesReordonnables()
    const sans = cles.filter((cle) => cle !== glissee)
    const place = sans.indexOf(cible)
    if (place === -1) return
    sans.splice(place, 0, glissee)
    onColumnReorder?.(sans)
  }

  /**
   * Le glissement d'une poignée de réordonnancement, **aux événements pointeur** — jamais au
   * glisser-déposer HTML5 (`draggable`/`dragstart`/`drop`) que `TabStrip` et `ProjectEditor`
   * emploient ailleurs dans ce dépôt.
   *
   * **WKWebView ne délivre pas `dragstart` de façon fiable pour un élément de page** — constaté à
   * l'usage le 2 septembre 2026 : le geste fonctionnait dans Chromium (Playwright, un vrai
   * glissement souris) et restait inerte dans `pnpm tauri dev`, la seule fenêtre qui compte. Le
   * redimensionnement voisin n'a jamais ce défaut parce qu'il n'a jamais dépendu du DnD natif — il
   * suit exactement ce même chemin, `setPointerCapture` compris. Le reproduire ici plutôt que de
   * dépanner le DnD natif est délibéré : les événements pointeur sont ceux que ce fichier a déjà
   * vérifiés capables de traverser WKWebView.
   *
   * La cible est retrouvée par `elementFromPoint`, au déplacement comme au relâchement —
   * `setPointerCapture` redirige les événements pointeur vers la poignée captée, donc ni l'un ni
   * l'autre ne dit plus quel en-tête est sous le curseur ; leurs coordonnées, elles, restent
   * exactes. `colonneCiblee` ne fait que suivre cette lecture pour l'indicateur visuel — c'est
   * `onUp` qui décide réellement du dépôt, à charge pour lui de la relire une dernière fois.
   */
  function debuterLeReordonnancement(
    evenement: ReactPointerEvent<HTMLButtonElement>,
    colonne: GridColumn<Row>,
  ) {
    evenement.preventDefault()
    const poignee = evenement.currentTarget
    poignee.setPointerCapture?.(evenement.pointerId)
    document.body.classList.add(styles.pendantLeReordonnancement as string)
    setColonneGlissee(colonne.key)

    function onMove(moveEvent: PointerEvent) {
      const cible = colonneSousLePointeur(moveEvent.clientX, moveEvent.clientY)
      setColonneCiblee(cible !== colonne.key ? cible : null)
    }

    function onUp(upEvent: PointerEvent) {
      poignee.removeEventListener('pointermove', onMove)
      poignee.removeEventListener('pointerup', onUp)
      poignee.removeEventListener('pointercancel', onCancel)
      document.body.classList.remove(styles.pendantLeReordonnancement as string)
      setColonneGlissee(null)
      setColonneCiblee(null)
      const cible = colonneSousLePointeur(upEvent.clientX, upEvent.clientY)
      if (cible !== null) deposerColonne(colonne.key, cible)
    }

    function onCancel() {
      poignee.removeEventListener('pointermove', onMove)
      poignee.removeEventListener('pointerup', onUp)
      poignee.removeEventListener('pointercancel', onCancel)
      document.body.classList.remove(styles.pendantLeReordonnancement as string)
      setColonneGlissee(null)
      setColonneCiblee(null)
    }

    poignee.addEventListener('pointermove', onMove)
    poignee.addEventListener('pointerup', onUp)
    poignee.addEventListener('pointercancel', onCancel)
  }

  /** Déplace une colonne d'un cran, au clavier — `ArrowLeft`/`ArrowRight`, l'axe de la grille. */
  function deplacerColonneAuClavier(
    evenement: KeyboardEvent<HTMLButtonElement>,
    colonne: GridColumn<Row>,
  ) {
    if (evenement.key !== 'ArrowLeft' && evenement.key !== 'ArrowRight') return
    evenement.preventDefault()
    const pas = evenement.key === 'ArrowRight' ? 1 : -1
    const cles = clesReordonnables()
    const depart = cles.indexOf(colonne.key)
    const arrivee = depart + pas
    if (depart === -1 || arrivee < 0 || arrivee >= cles.length) return
    const suivant = [...cles]
    const [deplacee] = suivant.splice(depart, 1)
    if (deplacee === undefined) return
    suivant.splice(arrivee, 0, deplacee)
    onColumnReorder?.(suivant)
  }

  // Ramener la ligne sélectionnée dans la fenêtre visible : sans cela, `↓` déplacerait une
  // sélection invisible dès qu'elle sort du bas de l'écran.
  useEffect(() => {
    if (selectedId === null) return
    const index = rows.findIndex((row, rang) => rowId(row, rang) === selectedId)
    if (index === -1) return
    const haut = index * rowHeight
    const bas = haut + rowHeight
    setScrollTop((actuel) => {
      const cible =
        haut < actuel ? haut : bas > actuel + viewportHeight ? bas - viewportHeight : actuel
      if (cible !== actuel) viewport.current?.scrollTo({ top: cible })
      return cible
    })
  }, [selectedId, rows, rowId, rowHeight, viewportHeight])

  function deplacer(evenement: KeyboardEvent<HTMLDivElement>) {
    if (onSelect && (evenement.key === 'ArrowDown' || evenement.key === 'ArrowUp')) {
      evenement.preventDefault()
      const courante = rows.findIndex((row, rang) => rowId(row, rang) === selectedId)
      const suivante =
        evenement.key === 'ArrowDown'
          ? Math.min(rows.length - 1, courante + 1)
          : Math.max(0, courante === -1 ? 0 : courante - 1)
      const row = rows[suivante]
      if (row !== undefined) onSelect(row, suivante)
      return
    }
    // La garde de cible : voir la doc de `onDeleteKey`. Sans elle, `Backspace` dans le champ de
    // filtre d'une colonne supprimerait la ligne sélectionnée au lieu de corriger le filtre.
    //
    // **La cible valide est la grille elle-même, ou une `row`.** Un clic sélectionne une ligne en
    // focalisant son `role="row"` (`tabIndex={-1}`, focalisable par script) — c'est la cible normale
    // d'un `Suppr` sur la ligne choisie. Un champ de filtre ou la boîte de saisie d'une cellule sont
    // de vrais éléments focalisables, sans ce rôle : la garde les exclut.
    const cible = evenement.target as HTMLElement
    if (
      onDeleteKey &&
      (evenement.key === 'Delete' || evenement.key === 'Backspace') &&
      (cible === evenement.currentTarget || cible.getAttribute('role') === 'row')
    ) {
      evenement.preventDefault()
      const courante = rows.findIndex((row, rang) => rowId(row, rang) === selectedId)
      const row = rows[courante]
      if (row !== undefined) onDeleteKey(row, courante)
    }
  }

  return (
    <div
      className={styles.root}
      role="grid"
      aria-label={label}
      // Le **total**, pas le nombre de lignes montées. Les en-têtes comptent : ce sont des
      // lignes de la grille au sens ARIA.
      aria-rowcount={rows.length + lignesDEnTete}
      aria-activedescendant={
        selectedId !== null && onSelect ? `${idGrille}-${selectedId}` : undefined
      }
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={deplacer}
    >
      {/* `role="presentation"` : un `role="grid"` attend des `rowgroup`/`row` pour enfants, et ce
          conteneur de défilement n'existe que pour porter le débordement. Même arbitrage que
          l'enveloppe d'onglet de `TabStrip`. */}
      <div
        ref={viewport}
        role="presentation"
        className={styles.viewport}
        style={{ height: viewportHeight }}
        /*
         * **`flushSync`, et c'est la correction d'un vide au défilement rapide.**
         *
         * Un `scroll` est un événement *continu* pour React, donc la mise à jour qu'il déclenche est
         * de priorité non urgente : React a le droit de la différer d'une trame ou plus. Le temps
         * qu'elle passe, la toile est à sa nouvelle position et les lignes montées sont restées à
         * l'ancienne — mesuré sur un saut de 6 000 px : **621 px de vide au bas de la fenêtre**, et
         * les lignes montées à près de 6 000 px au-dessus. C'est le clignotement blanc qu'on voit en
         * lâchant un défilement rapide.
         *
         * Différer est le bon défaut de React presque partout ; ici l'affichage *est* la position de
         * défilement, et une position différée n'est pas une position. `flushSync` rend donc la trame
         * courante avant qu'elle ne soit peinte. Le coût est réel et connu — un rendu synchrone par
         * événement — et il est borné par ce que le navigateur émet : un `scroll` par trame au plus.
         */
        onScroll={(evenement) => {
          const haut = evenement.currentTarget.scrollTop
          flushSync(() => setScrollTop(haut))
        }}
      >
        {/* **L'en-tête vit dans la zone défilante**, collé en haut. Hors d'elle, il ne suivait pas
            le défilement **horizontal** : au-delà de la largeur de la fenêtre, les en-têtes ne
            désignaient plus les colonnes sous eux. Le `sticky` garde le comportement vertical que
            le test de `10a` vérifie.

            **Rendu à une seule position de l'arbre**, hors de toute branche : une première version
            le plaçait dans les deux issues du ternaire « vide / rempli », et React le démontait au
            passage de l'une à l'autre — donc à l'arrivée de la première lecture. Une saisie de
            filtre en cours et un popover ouvert étaient perdus à cet instant. Attrapé par les tests
            de `10d`, pas par l'œil. */}
        <EnTete
          columns={colonnesAffichees}
          gabarit={gabarit}
          largeur={largeurContenu}
          filterRow={filterRow}
          onColumnResize={onColumnResize}
          onPoigneeDown={debuterLeRedimensionnement}
          onPoigneeKeyDown={redimensionnerAuClavier}
          onColumnReorder={onColumnReorder}
          colonneGlissee={colonneGlissee}
          colonneCiblee={colonneCiblee}
          onReorderPointerDown={debuterLeReordonnancement}
          onReorderKeyDown={deplacerColonneAuClavier}
        />
        {rows.length === 0 && empty !== undefined ? (
          <div className={styles.empty}>{empty}</div>
        ) : (
          // La toile porte la hauteur **totale** : c'est elle qui donne à la barre de défilement
          // la bonne course, alors que seules quelques lignes sont montées.
          <div
            role="rowgroup"
            className={styles.canvas}
            style={{ height: rows.length * rowHeight, width: largeurContenu }}
          >
            {fenetre.map((row, rang) => {
              const index = premiere + rang
              const id = rowId(row, index)
              const selectionnee = id === selectedId
              return (
                <div
                  key={id}
                  id={`${idGrille}-${id}`}
                  role="row"
                  // Focalisable par programme seulement : le focus clavier reste sur la grille,
                  // qui désigne la ligne courante par `aria-activedescendant`. C'est le motif
                  // « grid » de l'APG, et il survit à la virtualisation — une ligne qui portait
                  // le focus et qu'on démonte en défilant le perdrait au profit du `<body>`.
                  tabIndex={-1}
                  aria-rowindex={index + 1 + lignesDEnTete}
                  aria-selected={onSelect ? selectionnee : undefined}
                  className={cx(
                    styles.row,
                    styles.tr,
                    // La teinte de modification **avant** la sélection dans l'ordre des classes :
                    // une ligne à la fois modifiée et sélectionnée doit se lire comme sélectionnée,
                    // c'est l'état que l'utilisateur vient de produire.
                    rowTint?.(row, index) === 'modified' && styles.rowModified,
                    rowTint?.(row, index) === 'deleted' && styles.rowDeleted,
                    selectionnee && styles.selected,
                  )}
                  style={{
                    gridTemplateColumns: gabarit,
                    height: rowHeight,
                    // La densité descend aux cellules, qui y centrent leur texte : elles sont
                    // étirées, et seule la ligne connaît sa hauteur.
                    ['--pitch' as string]: `${rowHeight}px`,
                    transform: `translateY(${index * rowHeight}px)`,
                  }}
                  onClick={onSelect ? () => onSelect(row, index) : undefined}
                >
                  {columns.map((colonne) => (
                    <div
                      key={colonne.key}
                      role="gridcell"
                      className={cx(
                        styles.td,
                        colonne.numeric && styles.numeric,
                        colonne.tint === 'filtered' && styles.filtered,
                        colonne.tint === 'sorted' && styles.sorted,
                        cellTint?.(row, colonne.key) === 'modified' && styles.cellModified,
                      )}
                    >
                      {colonne.cell(row, index)}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Les une ou deux lignes d'en-tête, **collées en haut de la zone défilante**.
 *
 * Extrait pour tenir en un seul endroit du rendu — sa place dans l'arbre doit être **stable**,
 * sans quoi React le démonte et les `FilterCell` perdent leur saisie.
 *
 * Il porte la largeur du contenu : sans elle, il prend celle du conteneur et cesse de désigner les
 * colonnes dès qu'on défile horizontalement.
 */
function EnTete<Row>({
  columns,
  gabarit,
  largeur,
  filterRow,
  onColumnResize,
  onPoigneeDown,
  onPoigneeKeyDown,
  onColumnReorder,
  colonneGlissee,
  colonneCiblee,
  onReorderPointerDown,
  onReorderKeyDown,
}: {
  columns: readonly GridColumn<Row>[]
  gabarit: string
  largeur: number
  filterRow: boolean
  onColumnResize?: (key: string, width: number) => void
  onPoigneeDown: (evenement: ReactPointerEvent<HTMLDivElement>, colonne: GridColumn<Row>) => void
  onPoigneeKeyDown: (evenement: KeyboardEvent<HTMLDivElement>, colonne: GridColumn<Row>) => void
  onColumnReorder?: (order: readonly string[]) => void
  colonneGlissee: string | null
  /** La colonne qui recevrait le dépôt là, maintenant — l'indicateur de position (`.cibleColonne`). */
  colonneCiblee: string | null
  onReorderPointerDown: (
    evenement: ReactPointerEvent<HTMLButtonElement>,
    colonne: GridColumn<Row>,
  ) => void
  onReorderKeyDown: (evenement: KeyboardEvent<HTMLButtonElement>, colonne: GridColumn<Row>) => void
}) {
  return (
    <div className={styles.head} role="rowgroup" style={{ width: largeur }}>
      <div
        className={cx(styles.row, styles.headRow)}
        role="row"
        aria-rowindex={1}
        style={{ gridTemplateColumns: gabarit }}
      >
        {columns.map((colonne) => (
          <div
            key={colonne.key}
            role="columnheader"
            // **Cible du dépôt, retrouvée par `elementFromPoint`** au relâchement du pointeur — le
            // dépôt ne passe plus par `onDrop` natif (voir `debuterLeReordonnancement`), donc rien
            // d'autre ne désigne cet en-tête comme la colonne survolée.
            data-colonne={onColumnReorder ? colonne.key : undefined}
            className={cx(
              styles.th,
              colonne.numeric && styles.numeric,
              colonne.tint === 'filtered' && styles.filtered,
              colonne.tint === 'sorted' && styles.sorted,
              colonneGlissee === colonne.key && styles.glisseeColonne,
              colonneCiblee === colonne.key && styles.cibleColonne,
            )}
          >
            {onColumnReorder && colonne.reorderable !== false ? (
              // **Le nom de la colonne devient lui-même la poignée** — le « reste » de l'en-tête,
              // celui qui n'est ni la flèche de tri ni la poignée de redimensionnement. Aux
              // événements pointeur, jamais au glisser-déposer HTML5 (`draggable`/`dragstart`)
              // que `TabStrip` et `ProjectEditor` emploient ailleurs : WKWebView ne le délivre pas
              // de façon fiable (voir `debuterLeReordonnancement`).
              <button
                type="button"
                className={cx(styles.headerContent, styles.headerContentGlissable)}
                aria-label={colonne.reorderLabel}
                onPointerDown={(evenement) => onReorderPointerDown(evenement, colonne)}
                onKeyDown={(evenement) => onReorderKeyDown(evenement, colonne)}
              >
                {colonne.header}
              </button>
            ) : (
              <span className={styles.headerContent}>{colonne.header}</span>
            )}
            {colonne.sort && (
              // **Bouton frère, pas imbriqué** dans la poignée de glissement — un bouton dans un
              // bouton est invalide en HTML, même motif que les deux boutons de `TabStrip`. Le tri
              // n'est donc plus qu'à ce seul endroit : cliquer ailleurs sur l'en-tête glisse, ne
              // trie plus (`23h`).
              <button
                type="button"
                className={cx(styles.sortHandle, colonne.sort.active && styles.sortHandleActive)}
                aria-label={colonne.sort.label}
                onClick={colonne.sort.onClick}
              >
                <Icon name={colonne.sort.icon} size={11} strokeWidth={2.4} />
              </button>
            )}
            {onColumnResize && colonne.resizable !== false && (
              // Poignée de redimensionnement : le même langage visuel que celle de `SplitPane` —
              // un trait, épaissi au survol et au focus, avec une zone de saisie en débord. Elle
              // ne s'étend qu'**à gauche**, dans la colonne elle-même, plutôt que de chevaucher la
              // colonne voisine comme `SplitPane` le fait entre deux panneaux : le `.th` qui la
              // porte coupe son propre débordement pour l'ellipse du texte, et un débord à droite
              // y serait rogné (défaut n° 34, ici même famille).
              //
              // **`role="slider"`, jamais `separator`.** Toute la suite Playwright mesure les
              // poignées de `SplitPane` par `[role=separator]`, en comptant, en indexant ou en
              // filtrant sur ce seul sélecteur — une convention établie dans une dizaine de
              // specs. Une poignée de colonne partageant ce rôle s'y serait glissée, décalant
              // les index et faussant les comptes sans qu'aucun test ne nomme la vraie cause. Le
              // motif WAI-ARIA de la « fenêtre à onglets redimensionnable » convient d'ailleurs
              // mieux ici : c'est une valeur bornée qu'on fait varier par glissement, exactement
              // ce que `slider` décrit — `aria-valuenow`/`min` restent les mêmes attributs.
              <div
                role="slider"
                aria-orientation="horizontal"
                aria-label={colonne.resizeLabel}
                aria-valuenow={colonne.width}
                aria-valuemin={colonne.minWidth ?? LARGEUR_MIN_PAR_DEFAUT}
                tabIndex={0}
                className={styles.resizeHandle}
                onPointerDown={(evenement) => onPoigneeDown(evenement, colonne)}
                onKeyDown={(evenement) => onPoigneeKeyDown(evenement, colonne)}
              />
            )}
          </div>
        ))}
      </div>
      {filterRow && (
        <div
          className={cx(styles.row, styles.filterRow)}
          role="row"
          aria-rowindex={2}
          style={{ gridTemplateColumns: gabarit }}
        >
          {columns.map((colonne) => (
            <div
              key={colonne.key}
              role="columnheader"
              className={cx(
                styles.tf,
                colonne.tint === 'filtered' && styles.filtered,
                colonne.tint === 'sorted' && styles.sorted,
              )}
            >
              {colonne.filter}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
