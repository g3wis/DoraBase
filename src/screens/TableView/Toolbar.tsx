import { useEffect, useRef } from 'react'
import { Icon } from '../../design/icons/Icon'
import type { ColumnInfo, Filter, RowLimit, SortKey } from '../../domain/engine'
import { useT } from '../../i18n/LanguageContext'
import { raccourci } from '../../shell/plateforme'
import { Chip } from '../../ui/Chip/Chip'
import { IconSwitch } from '../../ui/IconSwitch/IconSwitch'
import { Popover } from '../../ui/Popover/Popover'
import { Tooltip } from '../../ui/Tooltip/Tooltip'
import styles from './Toolbar.module.css'
import { libelleDeFiltre } from './tri'

/** Les quatre paliers de `RowLimit`, dans l'ordre du stepper. */
export const PALIERS: readonly RowLimit[] = [
  'oneHundred',
  'fiveHundred',
  'oneThousand',
  'fiveThousand',
]

/** Ce que le stepper affiche : le nombre, pas le nom de la variante. */
export const VALEURS: Record<RowLimit, number> = {
  oneHundred: 100,
  fiveHundred: 500,
  oneThousand: 1000,
  fiveThousand: 5000,
}

/**
 * Le stepper `LIMIT` — extrait pour que la console porte **le même** (ses libellés compris) : la
 * même commande sur la même donnée ne doit pas se dire de deux façons.
 *
 * Il parle en **nombres**, pas en `RowLimit` : la console lit la limite que la requête porte, qui
 * peut être n'importe quel entier (`limit 37`). Les flèches, elles, ne produisent que les quatre
 * paliers — le palier suivant au-dessus ou en dessous de la valeur affichée —, donc `A5` reste
 * dans son énumération fermée : « demander tout » n'est toujours pas exprimable.
 */
export function StepperDeLimite({
  valeur,
  onChoisir,
  titre,
}: {
  valeur: number
  /** Reçoit toujours l'une des quatre valeurs de `VALEURS`. */
  onChoisir: (valeur: number) => void
  /** Infobulle de la valeur — la console y dit qu'une limite implicite s'applique. */
  titre?: string
}) {
  const t = useT()
  const paliers = PALIERS.map((palier) => VALEURS[palier])
  const auDessus = paliers.find((candidat) => candidat > valeur)
  const enDessous = [...paliers].reverse().find((candidat) => candidat < valeur)

  return (
    <div className={styles.stepper}>
      <span className={styles.stepperLabel}>LIMIT</span>
      <span className={styles.stepperValeur} title={titre}>
        {valeur}
      </span>
      <span className={styles.fleches}>
        <button
          type="button"
          className={styles.fleche}
          aria-label={t('tableView.toolbar.increaseLimit')}
          disabled={auDessus === undefined}
          onClick={() => {
            if (auDessus !== undefined) onChoisir(auDessus)
          }}
        >
          <Icon name="chevd" size={8} strokeWidth={3} className={styles.haut} />
        </button>
        <button
          type="button"
          className={styles.fleche}
          aria-label={t('tableView.toolbar.decreaseLimit')}
          disabled={enDessous === undefined}
          onClick={() => {
            if (enDessous !== undefined) onChoisir(enDessous)
          }}
        >
          <Icon name="chevd" size={8} strokeWidth={3} />
        </button>
      </span>
    </div>
  )
}

/**
 * Le menu « colonnes affichées » — extrait pour la console, comme le stepper.
 *
 * `raisonDeLaDerniere` est l'ajout de la console : fournie, la dernière colonne visible ne se
 * décoche plus, avec l'infobulle qui dit pourquoi. `A5` ne la passe pas — sa barre d'outils reste
 * un chemin de retour même toutes colonnes masquées, quand la console n'a que ce menu.
 */
export function MenuDesColonnes({
  colonnes,
  masquees,
  onToggle,
  raisonDeLaDerniere,
}: {
  colonnes: readonly { name: string; typeName?: string }[]
  masquees: ReadonlySet<string>
  onToggle: (name: string) => void
  raisonDeLaDerniere?: string
}) {
  const t = useT()
  const visibles = colonnes.length - masquees.size

  return (
    <Popover
      align="end"
      title={t('tableView.toolbar.columnsShown')}
      content={
        <ul className={styles.colonnes}>
          {colonnes.map((colonne) => {
            const derniere =
              raisonDeLaDerniere !== undefined && visibles === 1 && !masquees.has(colonne.name)
            return (
              <li key={colonne.name}>
                <label className={styles.colonne} title={derniere ? raisonDeLaDerniere : undefined}>
                  <input
                    type="checkbox"
                    checked={!masquees.has(colonne.name)}
                    disabled={derniere}
                    onChange={() => onToggle(colonne.name)}
                  />
                  {colonne.name}
                  {colonne.typeName !== undefined && (
                    <span className={styles.type}>{colonne.typeName}</span>
                  )}
                </label>
              </li>
            )
          })}
        </ul>
      }
    >
      <button
        type="button"
        className={styles.bouton}
        aria-label={t('tableView.toolbar.columnsShown')}
      >
        <Icon name="cols" size={13} strokeWidth={1.9} />
        {visibles}/{colonnes.length}
      </button>
    </Popover>
  )
}

type ToolbarProps = {
  limite: RowLimit
  onLimiteChange: (limite: RowLimit) => void
  filters: readonly Filter[]
  onRemoveFilter: (column: string) => void
  sort: readonly SortKey[]
  columns: readonly ColumnInfo[]
  masquees: ReadonlySet<string>
  onToggleColonne: (name: string) => void
  /** Le SQL réellement exécuté, rendu par `RowWindow`. `null` tant qu'aucune lecture n'a abouti. */
  sql: string | null
  onRefresh: () => void
  /**
   * Le mode de l'onglet — lecture ou édition —, et sa bascule.
   *
   * **Un contrôle visible, parce qu'un geste qu'on ne peut pas deviner n'existe pas.** `11b`
   * n'ouvrait l'édition qu'au `⌘E` de l'écran de travail, annoncé par une phrase de la barre
   * d'état — 26 px de texte qui *disent* le raccourci sans rien offrir à cliquer. C'est la raison
   * qui a déjà fait doubler le `⇧`-clic du diagramme et le renommage des consoles.
   *
   * **Une bascule à deux verrous, et non un bouton qui s'allume** (`API-48`, sur un design
   * fourni). Un bouton dit l'*acte* qu'il offre, donc il ne peut pas montrer un verrou — c'est ce
   * qui avait fait revenir le crayon en `API-28`. Une bascule ne dit pas un acte : elle montre
   * **les deux états côte à côte** et celui qu'on tient, si bien que le cadenas fermé redevient
   * lisible, lu contre le cadenas ouvert plutôt que seul.
   *
   * Ce que le bouton portait et qui reste : le mode est celui de l'**onglet**, donc l'état vient
   * d'en haut, `⌘E` appelle la même fonction, et le nom du contrôle ne bouge pas — c'est
   * `aria-checked` qui porte la position, pour qui ne voit ni la pastille ni l'accent.
   *
   * Absent, le contrôle ne paraît pas — la galerie monte cette barre sans écran autour d'elle, et
   * l'aiguillage du mode vit dans l'onglet, pas ici.
   */
  edition?: boolean
  onBasculerEdition?: () => void
  /**
   * Ajoute une ligne au modèle — **absent hors mode édition**, où il n'y aurait rien à en faire.
   *
   * Le bouton n'apparaît donc qu'en édition, plutôt que d'y être désactivé en permanence : un
   * bouton grisé dit « ceci ne marche pas ici », alors que l'ajout marche très bien dès qu'on entre
   * en édition — ce que le badge de la pastille et les cellules ouvertes annoncent déjà.
   */
  onAjouterUneLigne?: () => void
  /**
   * Le nom du geste du bouton `+` — « Ajouter une ligne » par défaut, « Nouveau document » sur une
   * table NoSQL (`18g`), dont le `+` ouvre un éditeur JSON plutôt qu'une ligne vide.
   */
  libelleAjouter?: string
  /**
   * Une relecture est en cours : le bouton tourne et devient inerte.
   *
   * **Les deux vont ensemble.** Un bouton qui tourne mais reste cliquable lance trois relectures dont
   * deux pour rien ; un bouton désactivé sans mouvement ne dit pas qu'il travaille.
   */
  enCours?: boolean
}

/**
 * La zone défilante des chips : le geste vertical y défile horizontalement.
 *
 * **Pourquoi un écouteur natif plutôt qu'`onWheel`.** React attache `wheel` à la racine en
 * `passive: true` : `preventDefault` y est sans effet, et le refus est justement ce qui empêche
 * l'ancêtre de défiler à notre place.
 *
 * **Seul l'axe vertical est traduit.** Un glissement horizontal du trackpad est déjà appliqué par la
 * webview ; l'ajouter au nôtre doublerait le pas. Et `ctrlKey`/`metaKey` sont laissés à `useZoom`,
 * qui refuse le pincement et applique le zoom fin — les intercepter ici ferait défiler la bande sur
 * un geste de zoom.
 *
 * `preventDefault` **seulement si la position a bougé** : arrivé au bout, le geste doit redevenir
 * celui de la page plutôt que d'être avalé par une bande qui ne défile plus.
 */
function useDefilementHorizontal() {
  const zone = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = zone.current
    if (!element) return
    const bande = element

    function auGeste(evenement: WheelEvent) {
      if (evenement.ctrlKey || evenement.metaKey) return
      if (Math.abs(evenement.deltaY) <= Math.abs(evenement.deltaX)) return
      const avant = bande.scrollLeft
      bande.scrollLeft = avant + evenement.deltaY
      if (bande.scrollLeft !== avant) evenement.preventDefault()
    }

    element.addEventListener('wheel', auGeste, { passive: false })
    return () => element.removeEventListener('wheel', auGeste)
  }, [])

  return zone
}

/**
 * La barre de 36 px au-dessus de la grille de `A5`.
 *
 * **Les chips lisent l'état, ils ne le possèdent pas.** Un chip qui garderait sa propre copie du
 * filtre divergerait de la ligne d'en-tête à la première modification : la croix d'un chip et le
 * vidage du champ correspondant font exactement la même chose.
 */
export function Toolbar({
  limite,
  onLimiteChange,
  filters,
  onRemoveFilter,
  sort,
  columns,
  masquees,
  onToggleColonne,
  sql,
  onRefresh,
  edition = false,
  onBasculerEdition,
  onAjouterUneLigne,
  libelleAjouter,
  enCours = false,
}: ToolbarProps) {
  const t = useT()
  const chips = useDefilementHorizontal()

  return (
    // `role="toolbar"` : un groupe de commandes qui agissent sur la même chose, et le motif ARIA
    // le dit. Il donne aussi un nom à la barre — sans quoi « Rafraîchir » ici et « Rafraîchir »
    // dans le pied de la sidebar s'annonceraient à l'identique.
    <div className={styles.root} role="toolbar" aria-label={t('tableView.toolbar.ariaLabel')}>
      {/* **`aria-busy` autant que l'animation** : la rotation ne dit rien à un lecteur d'écran, et
          `prefers-reduced-motion` la retire entièrement. L'état, lui, doit rester lisible dans les
          deux cas. */}
      <button
        type="button"
        className={styles.carre}
        onClick={onRefresh}
        disabled={enCours}
        aria-busy={enCours}
        aria-label={t('tableView.toolbar.refresh')}
      >
        <Icon
          name="refresh"
          size={14}
          strokeWidth={1.9}
          className={enCours ? styles.tourne : undefined}
        />
      </button>

      {/* **Le stepper ne peut pas produire une valeur hors des quatre paliers.** `RowLimit` est
          une énumération fermée depuis `06a`, précisément pour que « demander tout » ne soit pas
          exprimable ; un champ de saisie libre rouvrirait le trou que le type a fermé — et le
          composant partagé ne rend que des valeurs de `VALEURS`, donc la recherche du palier
          retrouve toujours le sien. */}
      <StepperDeLimite
        valeur={VALEURS[limite]}
        onChoisir={(valeur) => {
          const palier = PALIERS.find((candidat) => VALEURS[candidat] === valeur)
          if (palier) onLimiteChange(palier)
        }}
      />

      {/* **Contre le stepper, et non dans la moitié droite.** La barre se lit en deux temps : à
          gauche ce qui décide des lignes qu'on voit — relire, la limite, les filtres —, à droite ce
          qui les regarde. Ajouter une ligne appartient au premier groupe.

          Il ne touche donc plus la bascule de mode, partie à droite (`API-48`) : ce qui les liait
          n'était pas la place mais la cause, et elle tient toujours — le `+` ne paraît qu'en
          édition, donc c'est la bascule qui le fait apparaître, d'un bout de la barre à l'autre. */}
      {onAjouterUneLigne !== undefined && (
        <button
          type="button"
          className={styles.carre}
          onClick={onAjouterUneLigne}
          aria-label={libelleAjouter ?? t('tableView.toolbar.addRow')}
        >
          <Icon name="plus" size={14} strokeWidth={2.1} />
        </button>
      )}

      {/* **Les chips vivent dans une zone bornée qui défile, pas dans le flux de la barre.**
          Cinq filtres posés à la fois — un cas ordinaire dès qu'on cherche une ligne — poussaient
          « Voir le SQL », le compte de colonnes et l'export hors de la barre : les libellés se
          repliaient sur trois lignes et débordaient sous la grille. Constaté à l'écran le 26 août
          2026. La zone prend la place restante — `flex: 1`, bornée par son `overflow` — et tient donc
          aussi le rôle d'écarteur qu'un `<span>` jouait ici ; ce qui n'y tient pas se défile, à la
          molette comme au glissement, plutôt que d'écraser les contrôles voisins. */}
      <div className={styles.chips} ref={chips}>
        {filters.map((filtre) => (
          <Chip
            key={filtre.column}
            variant="accent"
            icon={<Icon name="filter" size={13} strokeWidth={1.9} />}
            onRemove={() => onRemoveFilter(filtre.column)}
            removeLabel={t('tableView.toolbar.removeFilter', { column: filtre.column })}
          >
            {libelleDeFiltre(filtre)}
          </Chip>
        ))}

        {sort.length > 0 && (
          // Le chip de tri ne se clique jamais dans le handoff : il **affiche**. Le tri se règle
          // sur les en-têtes, et lui donner une seconde commande dupliquerait l'état.
          <Chip icon={<Icon name="desc" size={13} strokeWidth={1.9} />}>
            {sort
              .map((c) => `${c.column} ${c.direction === 'ascending' ? 'asc' : 'desc'}`)
              .join(', ')}
          </Chip>
        )}
      </div>

      {/* **Le SQL affiché est celui qui a tourné**, pas une chaîne reconstruite depuis l'état :
          la reconstruire donnerait une requête *plausible*, qui divergerait le jour où
          l'adaptateur cite une identité autrement — et c'est précisément quand la requête ne fait
          pas ce qu'on croit qu'on ouvre ce panneau. */}
      <Popover
        align="end"
        title={t('tableView.toolbar.sqlExecuted')}
        content={<pre className={styles.sql}>{sql ?? t('tableView.toolbar.noSqlYet')}</pre>}
      >
        <button type="button" className={styles.bouton}>
          <Icon name="code" size={13} strokeWidth={1.9} />
          {t('tableView.toolbar.viewSql')}
          <Icon name="chevd" size={11} strokeWidth={2.4} />
        </button>
      </Popover>

      <MenuDesColonnes colonnes={columns} masquees={masquees} onToggle={onToggleColonne} />

      {/* **L'export est un sujet, pas un bouton.** La CSP refuse `blob:`, et il reste à trancher
          la fenêtre ou le résultat complet, l'encodage, le séparateur, le traitement des `NULL` —
          sur 1,9 million de lignes, l'écriture doit être en flux, donc côté Rust. Désactivé avec
          l'infobulle qui nomme sa spec, comme les quatre actions de `09f`. */}
      <Tooltip label={t('tableView.toolbar.exportTooltip')}>
        <button
          type="button"
          className={styles.carre}
          aria-disabled="true"
          aria-label={t('tableView.toolbar.export')}
        >
          <Icon name="dl" size={14} strokeWidth={1.9} />
        </button>
      </Tooltip>

      {/* **Le mode se pose au bout de la barre**, à la demande (`API-48`). Il n'agit ni sur les
          lignes qu'on lit — c'est la moitié gauche — ni sur ce qu'on en regarde : il dit ce que la
          grille **accepte**, donc il est le dernier lu, comme un interrupteur au bord d'un tableau
          de bord. C'est aussi le seul contrôle de la barre dont l'effet porte sur toute la grille.

          **`checked` vaut « verrouillé »**, soit l'inverse de `edition` : c'est le sens du design,
          où la position de droite porte le cadenas fermé. Le nom accessible suit — on nomme le
          verrouillage, pas l'édition —, et il ne change pas d'une position à l'autre.

          L'infobulle, elle, **change** : elle dit ce que le clic va faire, ce que deux cadenas ne
          peuvent pas écrire. Une infobulle décrit, elle ne nomme pas — c'est le nom qui doit
          tenir bon, pas la description. */}
      {onBasculerEdition !== undefined && (
        <Tooltip
          label={t(edition ? 'tableView.toolbar.lockHint' : 'tableView.toolbar.unlockHint', {
            raccourci: raccourci('E'),
          })}
        >
          <IconSwitch
            checked={!edition}
            onCheckedChange={onBasculerEdition}
            label={t('tableView.toolbar.lockLabel')}
            iconOff="unlock"
            iconOn="lock"
          />
        </Tooltip>
      )}
    </div>
  )
}
