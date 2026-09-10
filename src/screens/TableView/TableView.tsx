import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Icon } from '../../design/icons/Icon'
import type { IconName } from '../../design/icons/names'
import type { Engine } from '../../domain/config'
import type {
  ColumnInfo,
  DatabaseKey,
  Filter,
  FilterOperator,
  RowLimit,
  RowQuery,
  RowWindow,
  SortKey,
  TypeCategory,
  Value,
} from '../../domain/engine'
import { useT } from '../../i18n/LanguageContext'
import { modificateurActif } from '../../shell/plateforme'
import { cx } from '../../ui/cx'
import type { EntreeDeMenu } from '../../ui/MenuContextuel/MenuContextuel'
import { MenuContextuel } from '../../ui/MenuContextuel/MenuContextuel'
import { largeurAjustee } from '../../ui/VirtualGrid/ajustement'
import { type GridColumn, type PositionDuMenu, VirtualGrid } from '../../ui/VirtualGrid/VirtualGrid'
import {
  apercuDeLaSaisie,
  estNumerique,
  rendreValeur,
  texteDeSaisie,
  texteDeValeur,
} from './cellule'
import { DocumentJsonModal } from './DocumentJsonModal'
import { diffCreation, diffDocument, documentDepuisTexte, documentJson } from './documentJson'
import { EditableCell } from './EditableCell'
import { FilterCell } from './FilterCell'
import {
  borneDepuisLaDate,
  dateDepuisLaBorne,
  ECHELLES,
  type Echelle,
  echelleDeduite,
  valeurRelue,
} from './horodatage'
import {
  ajouterUneLigne,
  annulerLaDerniere,
  type EnAttente,
  estEditableALAjout,
  estMarqueePourSuppression,
  lignesAjoutees,
  lignesModifiees,
  type Modification,
  marquerPourSuppression,
  modificationDe,
  raisonDuRefus,
  retenir,
  type Saisie,
  saisirDansLaLigne,
  texteBrutDe,
  valeurDeLaLigne,
} from './modifications'
import styles from './TableView.module.css'
import { Toolbar } from './Toolbar'
import {
  basculerTri,
  estUneBorneDeDate,
  filtreDe,
  operateurParDefaut,
  poserFiltre,
  rangDeTri,
} from './tri'
import { LIMITE_PAR_DEFAUT, type PasserelleLignes, useLignes } from './useLignes'

/** L'édition en cours : une cellule ouverte à la saisie. */
type EnEdition = { cle: string; rang: number; column: string }

type TableViewProps = {
  /** La densité de `15c`. Absente, la grille garde celle du mockup. */
  rowHeight?: number
  cle: DatabaseKey
  schema: string
  table: string
  /**
   * Le moteur de la base ouverte — pour la seule différence que le contrat n'absorbe pas :
   * l'édition d'un document entier en JSON, propre au NoSQL (`18g`). Absent, la grille se comporte
   * comme avant : aucune icône de plus, aucun geste de plus.
   */
  moteur?: Engine
  /** Les colonnes du catalogue — elles nomment les en-têtes et donnent l'ordre. */
  columns: readonly ColumnInfo[]
  passerelle?: PasserelleLignes
  /**
   * Publie filtres et tri vers l'écran de travail, qui en annote la liste de colonnes de la
   * sidebar. **Un seul état, deux lecteurs** : une copie dans la sidebar divergerait à la
   * première modification.
   */
  onEtatChange?: (etat: { filters: readonly Filter[]; sort: readonly SortKey[] }) => void
  /**
   * Remonte la fenêtre lue et la ligne choisie.
   *
   * **La barre d'état et le panneau de ligne vivent au-dessus de cette vue**, parce que le mockup
   * les y place : le panneau droit longe tout le corps de l'écran et la barre d'état court sur
   * toute la largeur, sous les trois colonnes. Les rendre ici les enfermerait dans le centre.
   */
  onLectureChange?: (etat: {
    fenetre: RowWindow | null
    loading: boolean
    error: string | null
    ligne: readonly Value[] | null
    rang: number | null
    total: number
    /**
     * La lecture de chaque colonne d'entiers, pour que le panneau de ligne affiche la même chose
     * que la grille.
     *
     * **Les valeurs, elles, montent brutes.** `row_as_insert` compose du SQL à partir de cette même
     * ligne : une date convertie y partirait vers une colonne numérique. Le panneau relit pour
     * *afficher*, comme la grille — la conversion n'appartient à aucun chemin d'écriture.
     */
    lectures: Readonly<Record<string, Echelle>>
  }) => void
  /** Le rang sélectionné, piloté depuis l'écran pour que les flèches du panneau y répondent. */
  rang?: number | null
  onRangChange?: (rang: number | null) => void
  /**
   * Le mode édition (`11b`), par onglet. Sans lui, la grille est en lecture seule — ce qu'elle est
   * depuis `10c`.
   */
  edition?: boolean
  /**
   * Bascule ce mode — le **même acte** que le `⌘E` de l'écran de travail, et pas une seconde
   * mécanique : les deux appellent la fonction que l'écran détient. Deux voies pour un même acte en
   * laissent une en arrière, et le dépôt en a déjà payé une (règle n° 17).
   *
   * Absent, la barre d'outils ne montre pas la bascule : la vue ne possède pas ce mode, elle le
   * reçoit.
   */
  onBasculerEdition?: () => void
  /**
   * Les modifications en attente, **détenues par l'écran** (`11b`).
   *
   * Contrôlées et non locales : le compte s'affiche à quatre endroits hors de cette vue — bandeau,
   * arbre, pastille, barre d'état — et « Tout annuler » vit dans le bandeau. Une copie ici
   * divergerait, et l'a fait : vider depuis le bandeau était aussitôt écrasé par la vue qui
   * repoussait son propre état. Un seul état, plusieurs lecteurs.
   */
  /**
   * Compteur de relecture piloté par l'écran (`11d`) : après une écriture, la grille doit relire.
   *
   * Un nombre qui change plutôt qu'une fonction remontée : l'écriture est déclenchée depuis le
   * panneau droit, que l'écran de travail monte, alors que la lecture vit ici.
   */
  rafraichissement?: number
  /**
   * Relit la structure de la table, en plus des lignes.
   *
   * Absent, le bouton ne relit que les lignes — c'est le cas de la galerie, qui n'a pas de cache de
   * structures à invalider.
   */
  onRelireLaStructure?: () => void
  /** La structure est en cours de relecture : l'animation du bouton en dépend autant que des lignes. */
  structureEnCours?: boolean
  attente?: EnAttente
  onAttenteChange?: (attente: EnAttente) => void
}

/**
 * Une ligne de la grille : lue dans la base, ou **ajoutée** et pas encore écrite.
 *
 * Les deux vivent dans la même grille parce qu'elles s'éditent pareil — c'est ce que « mode édition
 * classique » veut dire. Ce qui les sépare tient en trois points : la ligne ajoutée n'a pas de
 * valeurs d'origine, sa gouttière porte `+` au lieu d'un rang, et la sélectionner n'aurait aucun
 * détail à montrer dans le panneau droit.
 */
type Ligne = LigneLue | { sorte: 'ajoutee'; rang: number; cle: string }

type LigneLue = { sorte: 'lue'; rang: number; valeurs: readonly Value[] }

/**
 * Largeur d'une colonne de données dont on ne sait rien — avant la première lecture, et pour une
 * colonne que l'échantillon ne montre pas.
 */
const LARGEUR_COLONNE = 130
/**
 * Combien de lignes l'ajustement automatique regarde.
 *
 * **Un échantillon, pas la fenêtre entière.** Cinq mille lignes par trente-quatre colonnes font
 * cent soixante-dix mille valeurs à rendre en texte à chaque lecture, pour une différence que seule
 * une valeur exceptionnellement longue, tout en bas, produirait — et l'ellipse la coupe déjà
 * aujourd'hui. Deux cents lignes, c'est vingt écrans : bien au-delà de ce qu'on lit avant de
 * redimensionner soi-même.
 */
const LIGNES_AJUSTEES = 200
/**
 * Ce que l'ajustement réserve dans l'en-tête de `A5` : la flèche de tri et son écart.
 *
 * Réservés **même sur une colonne non triée**, sans quoi trier prendrait cette place au nom de la
 * colonne qu'on vient de trier — au moment précis où on la regarde.
 *
 * **C'est une marge de prudence, et aucun test de rendu ne la tient.** Ce que la réserve change à
 * la largeur calculée est vérifié en pur (`ajustement.test.ts`) ; qu'elle soit *nécessaire* ne
 * l'est pas : mise à zéro, aucune colonne du décor ne se tronque, l'estimation de l'en-tête — 7 px
 * par caractère contre 6,3 mesurés au plus large — accumulant assez de mou pour absorber la flèche.
 */
const MARGE_DE_TRI = 15
/** La gouttière `#`, à 30 px dans le mockup. */
const LARGEUR_GOUTTIERE = 30
/**
 * La gouttière d'une table NoSQL (`18g`) : la croix de suppression et l'icône « éditer en JSON »
 * doivent tenir côte à côte au survol, ce que 30 px ne permet pas.
 */
const LARGEUR_GOUTTIERE_MONGO = 48

/**
 * `A5` : les lignes d'une table.
 *
 * **Le premier écran qui emploie la lecture paginée de `06d`**, écrite et testée le 6 août et
 * appelée par personne jusqu'ici.
 *
 * **Changer de table doit remonter ce composant** — l'appelant lui donne une `key` par onglet.
 * Garder l'état ferait appliquer `status = paid` à une table qui n'a pas cette colonne, et la
 * lecture échouerait sans que rien ne l'explique. Le faire par un effet de remise à zéro coûtait
 * une seconde requête à chaque montage : mesuré, pas supposé.
 */
export function TableView({
  rowHeight,
  cle,
  schema,
  table,
  moteur,
  columns,
  passerelle,
  onEtatChange,
  onLectureChange,
  rang = null,
  onRangChange,
  edition = false,
  onBasculerEdition,
  rafraichissement = 0,
  onRelireLaStructure,
  structureEnCours = false,
  attente = [],
  onAttenteChange,
}: TableViewProps) {
  const t = useT()
  const [filters, setFilters] = useState<readonly Filter[]>([])
  const [sort, setSort] = useState<readonly SortKey[]>([])
  // L'opérateur choisi par colonne, y compris pour un filtre pas encore appliqué. Séparé des
  // filtres : `= ` sur une colonne vide n'est pas un filtre, c'est un champ prêt à recevoir.
  const [operateurs, setOperateurs] = useState<Record<string, FilterOperator>>({})
  const [limite, setLimite] = useState<RowLimit>(LIMITE_PAR_DEFAUT)
  // Les colonnes **masquées**, et non les visibles : une table dont on n'a rien masqué a un
  // ensemble vide, quel que soit le nombre de colonnes qu'elle finira par avoir.
  const [masquees, setMasquees] = useState<ReadonlySet<string>>(new Set())
  // Les largeurs redimensionnées, par nom de colonne — une colonne absente d'ici garde
  // `LARGEUR_COLONNE`. Comme `masquees`, seul l'écart au défaut est tenu : changer de table ne
  // demande aucune remise à zéro, le composant tout entier étant remonté par sa `key` d'onglet.
  const [largeurs, setLargeurs] = useState<Record<string, number>>({})
  // La **lecture** d'une colonne d'entiers : l'échelle d'une époque, ou absente pour le nombre
  // qu'elle est. Comme `masquees` et `largeurs`, seul l'écart au défaut est tenu — et pour la même
  // raison, aucun moteur ne pouvant dire si un `bigint` porte une date (voir `horodatage.ts`).
  const [lectures, setLectures] = useState<Readonly<Record<string, Echelle>>>({})
  /**
   * Le signal « descends au bas de la grille », incrémenté par le `+` de la barre d'outils.
   *
   * **Un compteur, non un booléen** : chaque clic pose une ligne de plus, donc le geste se répète, et
   * un drapeau devrait être rabaissé par quelqu'un — un état de plus qui ne décrit rien. C'est
   * l'idiome de `rafraichissement`, que cette vue reçoit déjà de l'écran pour la même raison.
   */
  const [descendreEnBas, setDescendreEnBas] = useState(0)
  // L'ordre d'affichage des colonnes, par nom — `null` tant qu'on n'a rien réordonné, auquel cas
  // l'ordre est celui de `colonnesEffectives` (le catalogue). Même écart-au-défaut que `masquees`
  // et `largeurs` : changer de table ne demande aucune remise à zéro.
  const [ordreColonnes, setOrdreColonnes] = useState<readonly string[] | null>(null)
  // Le menu du clic droit — sur un en-tête, ou sur une cellule. **Un seul état pour les deux** :
  // ils ne peuvent pas être ouverts ensemble, et le second clic droit remplace le premier.
  const [menu, setMenu] = useState<
    | ({ sorte: 'entete'; colonne: string } & PositionDuMenu)
    | ({ sorte: 'cellule'; colonne: string; texte: string | null } & PositionDuMenu)
    | null
  >(null)
  const [enEdition, setEnEdition] = useState<EnEdition | null>(null)
  // Le document ouvert dans l'éditeur JSON (`18g`) : une ligne existante à éditer, ou `'creer'` pour
  // le geste du `+` sur une base NoSQL. Un seul état — les deux ne peuvent pas être ouverts ensemble.
  const [documentJsonOuvert, setDocumentJsonOuvert] = useState<
    { sorte: 'editer'; cle: string; rang: number } | { sorte: 'creer' } | null
  >(null)
  const hauteur = useHauteurDisponible()
  // La sélection est **pilotée par l'écran** : le panneau de ligne et ses flèches vivent au-dessus
  // de cette vue, et deux copies du même rang divergeraient.
  const choisie = rang === null ? null : String(rang)
  const setChoisie = (valeur: string | null) =>
    onRangChange?.(valeur === null ? null : Number(valeur))

  // Mémoïsée : `useLignes` relance sa lecture quand la requête change, et une requête
  // reconstruite à chaque rendu la relancerait indéfiniment.
  const query: RowQuery = useMemo(
    () => ({
      schema,
      table,
      filters: [...filters],
      sort: [...sort],
      offset: 0,
      limit: limite,
    }),
    [schema, table, filters, sort, limite],
  )

  const { fenetre, loading, error, relire } = useLignes(cle, query, passerelle, rafraichissement)

  // **Un bloc, pas une flèche concise** : une flèche concise *retourne* la valeur du rappel, et
  // React la prend pour une fonction de nettoyage — « destroy is not a function » au démontage dès
  // que le rappel rend autre chose que `undefined`. Trouvé par un test dont le rappel poussait dans
  // un tableau, ce qui rend un nombre.
  useEffect(() => {
    onEtatChange?.({ filters, sort })
  }, [filters, sort, onEtatChange])

  /**
   * Les entrées « lire comme » du menu d'en-tête — **vides pour toute colonne qui n'est pas
   * numérique**.
   *
   * Une colonne que le moteur déclare déjà temporelle n'a rien à choisir, et une colonne de texte
   * n'a pas d'époque à lire : proposer les quatre lectures partout ferait chercher à quoi elles
   * servent, exactement comme un `is null` sur une colonne `NOT NULL`.
   *
   * **La lecture en place est *désactivée avec sa raison*, pas cochée.** C'est la convention d'
   * `EntreeDeMenu` (`onClick` absent + `raison`), déjà celle de la dernière colonne visible et de
   * « Copier la valeur » sur une cellule au défaut : l'entrée grisée est celle qui est en vigueur, et
   * son infobulle le dit. Une coche aurait demandé un glyphe sur *toutes* les entrées du menu, que
   * `MenuContextuel` veut homogènes.
   *
   * **Le libellé de l'échelle que l'échantillon suggère porte « déduit »** — une aide, pas une
   * décision : les trois restent proposées, donc se tromper n'y coûte rien (voir `horodatage.ts`).
   */
  function entreesDeLecture(nom: string): EntreeDeMenu[] {
    const colonne = colonnesEffectives.find((candidate) => candidate.name === nom)
    if (colonne === undefined || colonne.category !== 'number') return []

    const rang = colonnesEffectives.findIndex((candidate) => candidate.name === nom)
    const suggeree = echelleDeduite(
      lignes.slice(0, LIGNES_AJUSTEES).map((ligne) => ligne.valeurs[rang] ?? { kind: 'null' }),
    )
    const enPlace = lectures[nom]

    const poser = (echelle: Echelle | undefined) => () =>
      setLectures((precedent) => {
        const suivant = { ...precedent }
        if (echelle === undefined) delete suivant[nom]
        else suivant[nom] = echelle
        return suivant
      })

    return [
      {
        libelle: t('tableView.grid.readAsNumber'),
        onClick: enPlace === undefined ? undefined : poser(undefined),
        raison: enPlace === undefined ? t('tableView.grid.readingInUse') : undefined,
      },
      ...ECHELLES.map((echelle) => ({
        libelle: t(`tableView.grid.readAs.${echelle}`, {
          suffixe: echelle === suggeree ? t('tableView.grid.deduced') : '',
        }),
        onClick: echelle === enPlace ? undefined : poser(echelle),
        raison: echelle === enPlace ? t('tableView.grid.readingInUse') : undefined,
      })),
    ]
  }

  /**
   * La catégorie sous laquelle une colonne se **lit** : celle du catalogue, sauf pour une colonne
   * d'entiers qu'on lit en horodatage.
   *
   * C'est ce seul détour qui donne à cette colonne « avant le », « après le » et leur calendrier :
   * `operateursPour` et `FilterCell` ne connaissent que des catégories.
   */
  const categorieLue = useCallback(
    (colonne: ColumnInfo): TypeCategory =>
      lectures[colonne.name] === undefined ? colonne.category : 'timestamp',
    [lectures],
  )

  /**
   * Ce que le champ de filtre doit **montrer** : la borne rendue à sa date pour une colonne lue en
   * horodatage, la valeur envoyée sinon.
   *
   * Sans ce retour, un champ `type="date"` recevrait `1772668800000` et l'écarterait — il se
   * viderait sous les yeux de qui vient de choisir une date.
   */
  const valeurAffichableDuFiltre = useCallback(
    (colonne: ColumnInfo, filtre: Filter | undefined): string => {
      const valeur = filtre?.value ?? ''
      const echelle = lectures[colonne.name]
      if (echelle === undefined || filtre === undefined) return valeur
      return estUneBorneDeDate('timestamp', filtre.operator)
        ? dateDepuisLaBorne(valeur, echelle)
        : valeur
    },
    [lectures],
  )

  // `useCallback` : la fonction entre dans le `useMemo` des colonnes, qu'une nouvelle identité à
  // chaque rendu recalculerait pour rien.
  const appliquerFiltre = useCallback(
    (column: string, operator: FilterOperator, saisie: string) => {
      setOperateurs((precedent) => ({ ...precedent, [column]: operator }))
      // **La date choisie redevient un entier avant de partir.** La colonne est numérique pour le
      // moteur — c'est l'écran seul qui la lit en horodatage —, donc le filtre reste une comparaison
      // de nombres et aucun adaptateur n'a besoin de le savoir.
      const echelle = lectures[column]
      const aEnvoyer =
        echelle !== undefined && estUneBorneDeDate('timestamp', operator)
          ? borneDepuisLaDate(saisie, echelle)
          : saisie
      setFilters((precedent) =>
        poserFiltre(precedent, column, filtreDe(column, operator, aEnvoyer)),
      )
    },
    [lectures],
  )

  const lignes: LigneLue[] = useMemo(
    () =>
      (fenetre?.rows ?? []).map((valeurs, rang) => ({
        sorte: 'lue' as const,
        rang: rang + 1,
        valeurs,
      })),
    [fenetre],
  )

  /**
   * Les lignes de la grille : celles de la base, puis celles qu'on ajoute.
   *
   * **En bas, et non en haut.** Une ligne ajoutée en tête pousserait toute la table d'un cran à
   * chaque clic, et la ligne qu'on lisait changerait de place sous les yeux. En bas, elle apparaît
   * là où le regard finit et où l'on défile déjà.
   */
  const toutesLesLignes: Ligne[] = useMemo(
    () =>
      edition
        ? [
            ...lignes,
            ...lignesAjoutees(attente).map((ligne) => ({
              sorte: 'ajoutee' as const,
              rang: ligne.rang,
              cle: ligne.cle,
            })),
          ]
        : lignes,
    [lignes, attente, edition],
  )

  /**
   * `⌘Z` annule la **dernière modification retenue**.
   *
   * Sur la fenêtre et non dans le champ : `esc` abandonne la saisie, `⌘Z` défait un changement
   * validé — le mockup écrit les deux côte à côte, et les confondre ferait perdre une modification
   * en voulant sortir d'une cellule.
   *
   * Inopérant pendant une saisie : là, `⌘Z` est l'annulation du navigateur dans le champ, et la
   * détourner surprendrait.
   */
  useEffect(() => {
    if (!edition) return
    function auClavier(evenement: KeyboardEvent) {
      if (!modificateurActif(evenement) || evenement.key !== 'z' || enEdition !== null) return
      evenement.preventDefault()
      onAttenteChange?.(annulerLaDerniere(attente))
    }
    window.addEventListener('keydown', auClavier)
    return () => window.removeEventListener('keydown', auClavier)
  }, [edition, enEdition, attente, onAttenteChange])

  // Quitter le mode édition ferme la saisie en cours mais **garde** les modifications retenues :
  // les perdre sur une frappe serait le défaut qu'`esc` fermant une modale pleine a déjà produit.
  useEffect(() => {
    if (!edition) setEnEdition(null)
  }, [edition])

  // **Parmi les lignes lues seulement** : une ligne ajoutée n'a pas de détail à montrer dans le
  // panneau droit, et lui en inventer un ferait croire à une ligne déjà écrite.
  const ligneChoisie = lignes.find((l) => String(l.rang) === choisie)

  useEffect(() => {
    onLectureChange?.({
      fenetre,
      loading,
      error,
      ligne: ligneChoisie?.valeurs ?? null,
      rang: ligneChoisie?.rang ?? null,
      total: lignes.length,
      lectures,
    })
  }, [fenetre, loading, error, ligneChoisie, lignes.length, lectures, onLectureChange])

  /**
   * La valeur de la clé primaire d'une ligne, en texte — l'identité d'une modification (`11a`).
   *
   * `null` quand la table n'en a pas : elle n'est alors **pas éditable**, parce que `11d` n'aurait
   * pas de `WHERE` pour retrouver la ligne.
   */
  const rangDeLaCle = columns.findIndex((colonne) => colonne.key === 'primary')
  // `useCallback` : la fonction entre dans le `useMemo` des colonnes, qu'une nouvelle identité à
  // chaque rendu recalculerait pour rien.
  const cleDe = useCallback(
    (ligne: Ligne): string | null => {
      // Une ligne ajoutée porte son identité **locale** : elle n'a pas encore de clé dans la base,
      // et c'est celle-ci qui la désigne dans le modèle jusqu'à l'écriture.
      if (ligne.sorte === 'ajoutee') return ligne.cle
      if (rangDeLaCle === -1) return null
      const valeur = ligne.valeurs[rangDeLaCle]
      return valeur === undefined ? null : texteBrutDe(valeur)
    },
    [rangDeLaCle],
  )

  /** Le document JSON d'une ligne lue, retrouvée par sa clé — `null` si elle n'est plus dans la fenêtre. */
  function documentDeLigne(cle: string): string | null {
    const ligne = lignes.find((l) => cleDe(l) === cle)
    return ligne ? documentJson(columns, ligne.valeurs) : null
  }

  /**
   * Les colonnes réellement rendues : celles du catalogue, plus celles qu'une ligne ajoutée
   * introduit et que l'échantillonnage n'avait pas vues (`18g`) — un champ neuf tapé dans
   * l'éditeur JSON d'un document mongo n'existe encore dans aucun document échantillonné, donc
   * `columns` ne le connaît pas. Sans cette extension, la valeur saisie serait invisible dans la
   * grille alors qu'elle apparaît déjà dans le panneau « modifications en attente » et dans le
   * SQL prévu — deux vérités qui divergeraient.
   *
   * **`columns` reste la référence partout ailleurs** — `rangDeLaCle`, `documentDeLigne`, le diff
   * d'une ligne existante : ces colonnes synthétiques n'existent que pour l'ajout en cours, jamais
   * pour un document déjà lu.
   */
  const colonnesEffectives: readonly ColumnInfo[] = useMemo(() => {
    const connues = new Set(columns.map((colonne) => colonne.name))
    const nouvelles: ColumnInfo[] = []
    for (const ligne of lignesAjoutees(attente)) {
      for (const nom of Object.keys(ligne.valeurs)) {
        if (connues.has(nom) || nouvelles.some((colonne) => colonne.name === nom)) continue
        nouvelles.push({
          position: columns.length + nouvelles.length + 1,
          name: nom,
          typeName: 'mixed',
          category: 'other',
          nullable: true,
          default: null,
          identity: null,
          key: null,
          comment: null,
          // `0`, pas `null` : `null` veut dire « la question ne se pose pas » (un moteur
          // relationnel, où une colonne est déclarée pour toutes les lignes). Ici la question se
          // pose, et la réponse est connue — aucun document lu n'a encore ce champ.
          frequency: 0,
        })
      }
    }
    return nouvelles.length === 0 ? columns : [...columns, ...nouvelles]
  }, [columns, attente])

  /**
   * Chaque colonne effective, avec son **rang d'origine** — l'indice dans `colonnesEffectives`,
   * qui est celui de la valeur dans `ligne.valeurs` (l'ordre de `SELECT *`, jamais celui de
   * l'affichage). Calculé **avant** `colonnesOrdonnees` : réordonner l'affichage ne doit jamais
   * changer quel indice désigne quelle colonne dans une ligne lue.
   */
  const colonnesAvecRang = useMemo(
    () => colonnesEffectives.map((colonne, rang) => ({ colonne, rang })),
    [colonnesEffectives],
  )

  /**
   * Les colonnes dans leur ordre d'**affichage** — celui que la poignée de `VirtualGrid` a posé,
   * ou celui du catalogue tant que rien n'a été glissé.
   *
   * Une colonne de `ordreColonnes` absente du catalogue (renommée, retirée depuis) est ignorée ;
   * une colonne du catalogue absente de `ordreColonnes` (ajoutée depuis, ou une colonne
   * synthétique de `colonnesEffectives`) est ajoutée en fin — jamais perdue.
   */
  const colonnesOrdonnees = useMemo(() => {
    if (ordreColonnes === null) return colonnesAvecRang
    const parNom = new Map(colonnesAvecRang.map((entree) => [entree.colonne.name, entree] as const))
    const connues = new Set<string>()
    const ordonnees: typeof colonnesAvecRang = []
    for (const nom of ordreColonnes) {
      const entree = parNom.get(nom)
      if (entree === undefined) continue
      connues.add(nom)
      ordonnees.push(entree)
    }
    const nouvelles = colonnesAvecRang.filter((entree) => !connues.has(entree.colonne.name))
    return [...ordonnees, ...nouvelles]
  }, [colonnesAvecRang, ordreColonnes])

  /**
   * La largeur ajustée de chaque colonne, par nom — « auto fit », plafonnée (`ajustement.ts`).
   *
   * **Dérivée, jamais mémorisée dans un état.** Elle se recalcule donc à chaque lecture : filtrer
   * ou changer de palier peut resserrer une colonne, ce qui est le comportement qu'on attend d'un
   * ajustement. Une largeur posée à la main l'emporte toujours — c'est `largeurs` qui est consulté
   * en premier — et c'est ce qui rend le recalcul sans conséquence : ce qu'on a réglé soi-même ne
   * bouge plus.
   */
  const largeursAjustees = useMemo(() => {
    const echantillon = lignes.slice(0, LIGNES_AJUSTEES)
    const parNom: Record<string, number> = {}
    for (const [rang, colonne] of colonnesEffectives.entries()) {
      parNom[colonne.name] = largeurAjustee(
        colonne.name,
        // **La valeur relue, pas la brute** : une colonne lue en horodatage affiche 19 caractères
        // là où l'entier en fait 13, et l'ajustement la couperait à l'ellipse.
        echantillon.map((ligne) =>
          texteDeValeur(
            valeurRelue(ligne.valeurs[rang] ?? { kind: 'null' }, lectures[colonne.name]),
          ),
        ),
        { margeDEntete: MARGE_DE_TRI },
      )
    }
    return parNom
  }, [colonnesEffectives, lignes, lectures])

  /**
   * Le texte d'une cellule, pour « Copier la valeur » du menu contextuel — `null` quand il n'y a
   * rien à copier.
   *
   * **C'est ce qui est *affiché*, pas ce que la base a rendu**, et l'ordre des trois cas est celui
   * du rendu de la cellule quelques lignes plus bas : une saisie en attente prime sur la valeur
   * d'origine, sans quoi copier une cellule qu'on vient de modifier rendrait l'ancienne valeur.
   *
   * **`null` sur une cellule d'une ligne ajoutée qu'on n'a pas remplie** : la grille y écrit
   * « défaut », qui est un mot de l'interface et non une donnée. Le menu désactive alors l'entrée
   * en disant pourquoi, plutôt que de copier ce mot ou de ne rien proposer.
   */
  function texteDeLaCellule(ligne: Ligne, nom: string): string | null {
    if (ligne.sorte === 'ajoutee') {
      const saisie = valeurDeLaLigne(attente, ligne.cle, nom)
      return saisie === undefined ? null : texteDeSaisie(saisie)
    }
    const cle = cleDe(ligne)
    const modifiee = cle === null ? undefined : modificationDe(attente, cle, nom)
    if (modifiee !== undefined) return texteDeSaisie(modifiee.apres)
    // Le rang du **catalogue** : c'est l'indice de la valeur dans la ligne reçue, que le
    // déplacement des colonnes ne change pas.
    const rang = colonnesEffectives.findIndex((colonne) => colonne.name === nom)
    const valeur = rang === -1 ? undefined : ligne.valeurs[rang]
    // Relue, comme la cellule : la règle est de copier **ce qu'on lit**, et une colonne lue en
    // horodatage n'affiche plus son entier.
    return valeur === undefined ? null : texteDeValeur(valeurRelue(valeur, lectures[nom]))
  }

  const colonnes: GridColumn<Ligne>[] = useMemo(
    () => [
      {
        key: '#',
        header: '#',
        width: moteur === 'mongodb' ? LARGEUR_GOUTTIERE_MONGO : LARGEUR_GOUTTIERE,
        // Rien à redimensionner dans la gouttière : elle n'a que le rang et deux icônes d'action.
        resizable: false,
        // Rien à réordonner non plus : la gouttière désigne toujours la première colonne.
        reorderable: false,
        // **`+2` plutôt qu'un rang** : une ligne ajoutée n'a pas de place dans la table, seulement
        // un ordre d'arrivée. Lui donner un rang la ferait passer pour la 501ᵉ ligne lue.
        //
        // **Les actions remplacent le numéro au survol de la ligne**, motif repris de `TreeRow` :
        // cachées par défaut, révélées par le survol de la ligne — annoncé par `VirtualGrid` en
        // `--row-actions` (`API-45`) — ou par `:focus-within`. Une ligne déjà marquée pour
        // suppression les garde visibles en permanence : la marque ne doit pas dépendre du survol
        // pour se voir.
        cell: (ligne) => {
          const cle = cleDe(ligne)
          const supprimee = cle !== null && estMarqueePourSuppression(attente, cle)
          const surSuppression =
            edition && onAttenteChange !== undefined && cle !== null
              ? () => onAttenteChange(marquerPourSuppression(attente, cle, ligne.rang))
              : undefined
          // **Seulement une ligne lue, jamais une ligne ajoutée** : celle-ci se compose déjà en
          // JSON depuis le `+` (`18g`), et n'a pas de document d'origine à comparer.
          const surEditionJson =
            moteur === 'mongodb' &&
            edition &&
            onAttenteChange !== undefined &&
            ligne.sorte === 'lue' &&
            cle !== null &&
            !supprimee
              ? () => setDocumentJsonOuvert({ sorte: 'editer', cle, rang: ligne.rang })
              : undefined
          return (
            <span className={cx(styles.gouttiereWrap, supprimee && styles.gouttiereSupprimee)}>
              <span
                className={cx(
                  styles.gouttiere,
                  ligne.sorte === 'ajoutee' && styles.gouttiereAjoutee,
                )}
              >
                {ligne.sorte === 'ajoutee' ? `+${ligne.rang}` : ligne.rang}
              </span>
              {(surSuppression || surEditionJson) && (
                <span className={styles.actions}>
                  {surEditionJson && (
                    <button
                      type="button"
                      className={styles.editerDocument}
                      aria-label={t('tableView.grid.editRowJson', { rang: ligne.rang })}
                      onClick={surEditionJson}
                    >
                      <Icon name="json" size={11} strokeWidth={2.2} />
                    </button>
                  )}
                  {surSuppression && (
                    <button
                      type="button"
                      className={cx(styles.supprimerLigne, !supprimee && styles.destructif)}
                      // **« Retirer la nouvelle ligne » pour une ligne ajoutée**, jamais
                      // « Supprimer » : même vocabulaire que la croix du panneau (`PendingPanel`), et
                      // surtout un nom distinct de celui d'une ligne lue — sans quoi une ligne
                      // ajoutée « +1 » et la première ligne lue partageraient le même nom accessible
                      // « …la ligne 1 ».
                      aria-label={
                        ligne.sorte === 'ajoutee'
                          ? t('tableView.grid.removeNewRow', { rang: ligne.rang })
                          : supprimee
                            ? t('tableView.grid.cancelDeletion', { rang: ligne.rang })
                            : t('tableView.grid.deleteRow', { rang: ligne.rang })
                      }
                      onClick={surSuppression}
                    >
                      {/*
                       * **La poubelle quand le clic supprime, la croix quand il annule**
                       * (`API-45`). Une poubelle sur une ligne déjà marquée annoncerait une
                       * suppression là où le clic la défait — et c'est le même arbitrage que le
                       * crayon du bouton d'édition : une icône dit l'**acte** qu'on offre, jamais
                       * l'état courant. Retirer une ligne ajoutée supprime bien quelque chose,
                       * donc elle porte la poubelle comme une ligne lue.
                       */}
                      {supprimee ? (
                        <Icon name="x" size={12} strokeWidth={2.4} />
                      ) : (
                        <Icon name="trash" size={12} strokeWidth={1.9} />
                      )}
                    </button>
                  )}
                </span>
              )}
            </span>
          )
        },
      },
      // Masquer une colonne ne change pas la requête : `SELECT *` reste, et la colonne est
      // retirée du **rendu**. Restreindre la projection rendrait le SQL affiché dépendant d'un
      // réglage d'affichage, ce qui est déroutant dans un client de bases. Le rang, lui, reste
      // celui du catalogue — c'est l'indice de la valeur dans la ligne reçue. Au-delà de
      // `columns.length`, il ne désigne plus rien dans `ligne.valeurs` d'une ligne **lue** — une
      // colonne synthétique de `colonnesEffectives` n'existe encore que pour l'ajout en cours, et
      // `valeur === undefined` s'affiche déjà comme une cellule vide.
      ...colonnesOrdonnees
        .filter(({ colonne }) => !masquees.has(colonne.name))
        .map(({ colonne, rang }) => {
          const filtre = filters.find((f) => f.column === colonne.name)
          const critere = sort.find((c) => c.column === colonne.name)
          const rangDuTri = rangDeTri(sort, colonne.name)
          return {
            key: colonne.name,
            // **Le nom seul** : ce n'est plus un bouton de tri (`23h`). Le glissement de
            // réordonnancement l'enveloppe déjà (`VirtualGrid`, `onColumnReorder`), et un clic dessus
            // ne doit plus rien déclencher d'autre que ce glissement.
            header: (
              <>
                {colonne.name}
                {/* La pastille de rang n'apparaît qu'à partir de **deux** critères : un « 1 »
                  solitaire sur la seule colonne triée serait du bruit. */}
                {rangDuTri !== null && sort.length > 1 && (
                  <span className={styles.rang}>{rangDuTri}</span>
                )}
              </>
            ),
            width: largeurs[colonne.name] ?? largeursAjustees[colonne.name] ?? LARGEUR_COLONNE,
            resizeLabel: t('tableView.grid.resizeColumn', { column: colonne.name }),
            reorderLabel: t('tableView.grid.reorderColumn', { column: colonne.name }),
            // La cellule d'en-tête s'annonce par le nom de la colonne, pas par la somme des
            // contrôles qu'elle contient — « Trier par id Redimensionner id ».
            headerLabel: colonne.name,
            // **Le tri, sur une flèche à part** — jamais sur le nom (`23h`). Le `⌘`-clic empile un
            // second critère : la convention de tous les tableurs et de tous les clients SQL, que
            // le handoff ne dit pas et qu'inventer autrement serait gratuit.
            sort: {
              label: t('tableView.grid.sortBy', { column: colonne.name }),
              icon: (critere
                ? critere.direction === 'ascending'
                  ? 'asc'
                  : 'desc'
                : 'sort') as IconName,
              active: critere !== undefined,
              onClick: (evenement: ReactMouseEvent<HTMLButtonElement>) =>
                setSort((precedent) =>
                  basculerTri(precedent, colonne.name, evenement.metaKey || evenement.ctrlKey),
                ),
            },
            // L'alignement suit la **valeur**, pas le nom de la colonne : une colonne numérique
            // dont une cellule est `NULL` garde son `NULL` à gauche, comme le mockup le montre.
            // Lue en horodatage, elle s'aligne comme les autres horodatages — à gauche.
            numeric: colonne.category === 'number' && lectures[colonne.name] === undefined,
            tint: filtre ? ('filtered' as const) : critere ? ('sorted' as const) : undefined,
            filter: (
              <FilterCell
                column={colonne.name}
                // **La catégorie *lue*, et tout suit** : une colonne d'entiers lue en horodatage
                // reçoit « avant le » / « après le » et leur calendrier sans une ligne de plus, et
                // c'est `appliquerFiltre` qui rend la borne à son échelle avant de l'envoyer.
                category={categorieLue(colonne)}
                operator={operateurs[colonne.name] ?? operateurParDefaut(categorieLue(colonne))}
                value={valeurAffichableDuFiltre(colonne, filtre)}
                // **Le filtre appliqué, pas la valeur saisie** : les trois prédicats agissent sans
                // valeur, et l'opérateur affiché sur un booléen est `is true` avant qu'on ait rien
                // demandé.
                applique={filtre !== undefined}
                onApply={(operator, saisie) => appliquerFiltre(colonne.name, operator, saisie)}
                nullable={colonne.nullable}
              />
            ),
            cell: (ligne: Ligne) => {
              if (ligne.sorte === 'ajoutee') {
                return (
                  <CelluleAjoutee
                    cle={ligne.cle}
                    colonne={colonne}
                    attente={attente}
                    ouverte={enEdition?.cle === ligne.cle && enEdition.column === colonne.name}
                    onOuvrir={() =>
                      setEnEdition({ cle: ligne.cle, rang: ligne.rang, column: colonne.name })
                    }
                    onFermer={() => setEnEdition(null)}
                    onSaisir={(saisie) =>
                      onAttenteChange?.(saisirDansLaLigne(attente, ligne.cle, colonne.name, saisie))
                    }
                  />
                )
              }
              const valeur = ligne.valeurs[rang]
              if (valeur === undefined) return null
              const cle = cleDe(ligne)
              const modifiee = cle === null ? undefined : modificationDe(attente, cle, colonne.name)
              const ouverte =
                enEdition !== null && enEdition.cle === cle && enEdition.column === colonne.name

              if (ouverte && cle !== null) {
                return (
                  <EditableCell
                    valeur={valeur}
                    retenue={modifiee?.apres}
                    onValider={(saisie) => {
                      onAttenteChange?.(
                        retenir(attente, {
                          cle,
                          rang: ligne.rang,
                          column: colonne.name,
                          avant: valeur,
                          apres: saisie,
                        }),
                      )
                      setEnEdition(null)
                    }}
                    onAbandonner={() => setEnEdition(null)}
                  />
                )
              }

              // **La valeur retenue prime sur celle de la base** : c'est ce que l'utilisateur a
              // tapé, et c'est ce que `11d` écrira. Afficher l'ancienne ferait croire que la
              // saisie a été perdue.
              // **La saisie en attente n'est pas relue.** Une modification retenue est du texte qui
              // partira tel quel vers une colonne numérique : l'afficher en date ferait croire
              // qu'une date sera écrite.
              const relue = valeurRelue(valeur, lectures[colonne.name])
              const affichee = modifiee ? apercuDeLaSaisie(modifiee.apres) : rendreValeur(relue)
              const classe = estNumerique(relue) ? styles.nombre : undefined

              if (!edition) return <span className={classe}>{affichee}</span>

              // **Un `<button>` qui remplit la cellule**, et non un `div` à double-clic : le
              // clavier vient gratuitement — `Tab` pour parcourir, `↩` ou espace pour ouvrir — là
              // où un gestionnaire de double-clic n'a aucun équivalent au clavier.
              const refusDeLaColonne = raisonDuRefus(colonne, t)
              const supprimee = cle !== null && estMarqueePourSuppression(attente, cle)
              if (refusDeLaColonne !== null || cle === null || supprimee) {
                const raison =
                  cle === null
                    ? t('tableView.grid.noPrimaryKeyReason')
                    : supprimee
                      ? t('tableView.grid.deletedRowReason')
                      : refusDeLaColonne
                return (
                  <span className={cx(classe, styles.nonEditable)} title={raison ?? undefined}>
                    {affichee}
                  </span>
                )
              }
              return (
                <button
                  type="button"
                  className={cx(classe, styles.editable)}
                  aria-label={t('tableView.grid.modifyColumn', { column: colonne.name })}
                  onClick={() => setEnEdition({ cle, rang: ligne.rang, column: colonne.name })}
                >
                  {affichee}
                </button>
              )
            },
          }
        }),
    ],
    [
      colonnesOrdonnees,
      filters,
      sort,
      operateurs,
      appliquerFiltre,
      categorieLue,
      valeurAffichableDuFiltre,
      lectures,
      masquees,
      largeurs,
      largeursAjustees,
      attente,
      enEdition,
      edition,
      cleDe,
      onAttenteChange,
      t,
      moteur,
    ],
  )

  return (
    <div className={styles.root} ref={hauteur.ref}>
      <Toolbar
        limite={limite}
        onLimiteChange={setLimite}
        filters={filters}
        // La croix d'un chip et le vidage du champ correspondant font exactement la même chose :
        // un seul état, deux commandes.
        onRemoveFilter={(column) => setFilters((precedent) => poserFiltre(precedent, column, null))}
        sort={sort}
        columns={colonnesOrdonnees.map((entree) => entree.colonne)}
        masquees={masquees}
        onToggleColonne={(name) =>
          setMasquees((precedent) => {
            const suivant = new Set(precedent)
            if (suivant.has(name)) suivant.delete(name)
            else suivant.add(name)
            return suivant
          })
        }
        sql={fenetre?.sql ?? null}
        edition={edition}
        onBasculerEdition={onBasculerEdition}
        // **Le `+` s'adapte au moteur, il ne s'ajoute pas.** Sur MongoDB, poser une ligne vide
        // éditée cellule par cellule n'a pas de sens sans colonnes déclarées : le geste ouvre
        // directement l'éditeur JSON (`18g`), qui compose le document entier d'un coup.
        /* **Et l'ajout descend jusqu'à la ligne qu'il vient de poser** (8 septembre 2026, à la
           demande). Elle s'ajoute en **bas** de la grille : sur une fenêtre de cinq cents lignes,
           le `+` la posait à douze mille pixels sous le regard, et rien ne bougeait — un bouton dont
           l'effet est hors de l'écran se lit comme un bouton qui ne fait rien, le défaut n° 36 sous
           une autre forme. Le compteur ne monte que pour la grille : sur MongoDB le `+` ouvre une
           modale, qui n'a rien à voir avec le défilement. */
        onAjouterUneLigne={
          edition && onAttenteChange !== undefined
            ? moteur === 'mongodb'
              ? () => setDocumentJsonOuvert({ sorte: 'creer' })
              : () => {
                  onAttenteChange(ajouterUneLigne(attente))
                  setDescendreEnBas((precedent) => precedent + 1)
                }
            : undefined
        }
        libelleAjouter={moteur === 'mongodb' ? t('tableView.documentJson.createTitle') : undefined}
        onRefresh={() => {
          relire()
          onRelireLaStructure?.()
        }}
        // **Les deux relectures, pas une** : s'arrêter à la première ferait croire l'écran à jour
        // alors que la moitié charge encore.
        enCours={loading || structureEnCours}
      />
      <div className={styles.centre}>
        <div className={styles.grille}>
          <VirtualGrid
            rowHeight={rowHeight}
            label={t('tableView.grid.gridLabel', { schema, table })}
            columns={colonnes}
            rows={toutesLesLignes}
            scrollToBottom={descendreEnBas}
            // L'identité locale d'une ligne ajoutée, jamais son rang : `+1` et la première ligne
            // lue partagent le rang 1, et deux lignes de même identité feraient sauter la sélection
            // de l'une à l'autre.
            rowId={(ligne) => (ligne.sorte === 'ajoutee' ? ligne.cle : String(ligne.rang))}
            onColumnResize={(cle, largeur) =>
              setLargeurs((precedent) => ({ ...precedent, [cle]: largeur }))
            }
            onColumnReorder={(ordre) => setOrdreColonnes(ordre)}
            // **La gouttière est écartée des deux menus** : elle ne porte ni colonne à masquer —
            // elle numérote les lignes — ni valeur à copier. Ouvrir un menu dessus proposerait un
            // geste sans objet.
            onHeaderContextMenu={(cle, position) => {
              if (cle === '#') return
              setMenu({ sorte: 'entete', colonne: cle, ...position })
            }}
            onCellContextMenu={(ligne, cle, _rang, position) => {
              if (cle === '#') return
              setMenu({
                sorte: 'cellule',
                colonne: cle,
                texte: texteDeLaCellule(ligne, cle),
                ...position,
              })
            }}
            {...(edition
              ? {
                  // Les teintes de `11b`/`A6` : une ligne qui porte une modification, une marque de
                  // suppression, une cellule modifiée. Elles lisent le **même** modèle que le compte
                  // du bandeau. La marque de suppression prime — une fois marquée, une ligne n'a plus
                  // de modification de cellule à côté (`marquerPourSuppression` les efface).
                  rowTint: (ligne: Ligne) => {
                    const cle = cleDe(ligne)
                    if (cle === null) return undefined
                    if (estMarqueePourSuppression(attente, cle)) return 'deleted'
                    return lignesModifiees(attente).has(cle) ? 'modified' : undefined
                  },
                  onDeleteKey:
                    onAttenteChange !== undefined
                      ? (ligne: Ligne) => {
                          const cle = cleDe(ligne)
                          if (cle === null) return
                          onAttenteChange(marquerPourSuppression(attente, cle, ligne.rang))
                        }
                      : undefined,
                  cellTint: (ligne: Ligne, column: string) => {
                    const cle = cleDe(ligne)
                    if (cle === null) return undefined
                    // Dans une ligne ajoutée, la teinte marque les cellules **saisies** : le coin
                    // ambre dit « ceci partira », et les colonnes laissées au défaut ne partent pas.
                    if (ligne.sorte === 'ajoutee') {
                      return valeurDeLaLigne(attente, cle, column) !== undefined
                        ? 'modified'
                        : undefined
                    }
                    return modificationDe(attente, cle, column) !== undefined
                      ? 'modified'
                      : undefined
                  },
                }
              : {})}
            viewportHeight={hauteur.valeur}
            filterRow
            selectedId={choisie}
            // Une ligne ajoutée ne se sélectionne pas : le panneau droit montre le détail d'une
            // ligne **de la base**, et celle-ci n'y est pas encore.
            onSelect={(ligne) => {
              if (ligne.sorte === 'lue') setChoisie(String(ligne.rang))
            }}
            empty={<span>{messageVide(t, loading, error, schema, table)}</span>}
          />
        </div>
      </div>
      {documentJsonOuvert && onAttenteChange !== undefined && (
        <DocumentJsonModal
          titre={
            documentJsonOuvert.sorte === 'creer'
              ? t('tableView.documentJson.createTitle')
              : t('tableView.documentJson.editTitle')
          }
          texteInitial={
            documentJsonOuvert.sorte === 'creer'
              ? '{}'
              : (documentDeLigne(documentJsonOuvert.cle) ?? '{}')
          }
          onFermer={() => setDocumentJsonOuvert(null)}
          onEnregistrer={(texte) => {
            const analyse = documentDepuisTexte(texte, t)
            if (!analyse.ok) return analyse.erreur
            if (documentJsonOuvert.sorte === 'creer') {
              const diff = diffCreation(columns, analyse.valeur, t)
              if (!diff.ok) return diff.erreur
              const avecLaLigne = ajouterUneLigne(attente)
              const nouvelle = lignesAjoutees(avecLaLigne).at(-1)
              if (!nouvelle) return null
              const complete = Object.entries(diff.valeurs).reduce<Modification[]>(
                (courante, [colonne, saisie]) =>
                  saisirDansLaLigne(courante, nouvelle.cle, colonne, saisie),
                avecLaLigne,
              )
              onAttenteChange(complete)
              setDocumentJsonOuvert(null)
              return null
            }
            const ligne = lignes.find((l) => cleDe(l) === documentJsonOuvert.cle)
            if (!ligne) return null
            const diff = diffDocument(
              columns,
              ligne.valeurs,
              ligne.rang,
              documentJsonOuvert.cle,
              analyse.valeur,
              t,
            )
            if (!diff.ok) return diff.erreur
            const complete = diff.modifications.reduce<EnAttente>(
              (courante, modification) => retenir(courante, modification),
              attente,
            )
            onAttenteChange(complete)
            setDocumentJsonOuvert(null)
            return null
          }}
        />
      )}
      {menu !== null &&
        (menu.sorte === 'entete' ? (
          <MenuContextuel
            x={menu.x}
            y={menu.y}
            label={t('tableView.grid.columnMenuLabel', { column: menu.colonne })}
            entrees={[
              {
                libelle: t('tableView.grid.hideColumn'),
                // **Masquer ne change pas la requête** — c'est le `masquees` de la barre d'outils,
                // et rien d'autre. La colonne se retrouve donc au même endroit, dans le menu
                // « colonnes » qui compte les visibles : le geste a un retour, ce qui est ce qui
                // distingue un masquage d'une impasse.
                onClick: () => setMasquees((precedent) => new Set(precedent).add(menu.colonne)),
              },
              ...entreesDeLecture(menu.colonne),
            ]}
            onFermer={() => setMenu(null)}
          />
        ) : (
          <MenuContextuel
            x={menu.x}
            y={menu.y}
            label={t('tableView.rowPanel.contextMenuLabel', {
              what: t('tableView.rowPanel.theValue'),
              column: menu.colonne,
            })}
            entrees={[
              {
                libelle: t('tableView.rowPanel.copyWhat', {
                  what: t('tableView.rowPanel.theValue'),
                }),
                onClick:
                  menu.texte === null
                    ? undefined
                    : () => void navigator.clipboard?.writeText(menu.texte ?? ''),
                raison: menu.texte === null ? t('tableView.grid.nothingToCopy') : undefined,
              },
            ]}
            onFermer={() => setMenu(null)}
          />
        ))}
    </div>
  )
}

/**
 * Une cellule d'une ligne qu'on ajoute.
 *
 * **Toutes les colonnes s'y saisissent, clé primaire comprise** — voir `estEditableALAjout` : il n'y
 * a aucun `WHERE` à déplacer, et une table dont la clé est un code saisi ne pourrait recevoir aucune
 * ligne si on la refusait.
 *
 * **Vide veut dire « au défaut de la base », pas chaîne vide.** Ouvrir une cellule et en sortir sans
 * rien taper est un geste courant ; le prendre pour une saisie écrirait `''` dans une colonne qu'on
 * n'a pas voulu remplir, et volerait à la table sa valeur par défaut. Limite assumée : la chaîne
 * vide **explicite** n'est pas exprimable à l'ajout — elle se pose ensuite, en modifiant la ligne
 * écrite. `⌥⌫` reste le geste pour un `NULL` demandé, qui lui s'écrit.
 */
function CelluleAjoutee({
  cle,
  colonne,
  attente,
  ouverte,
  onOuvrir,
  onFermer,
  onSaisir,
}: {
  cle: string
  colonne: ColumnInfo
  attente: EnAttente
  ouverte: boolean
  onOuvrir: () => void
  onFermer: () => void
  onSaisir: (saisie: Saisie | null) => void
}) {
  const t = useT()
  const saisie = valeurDeLaLigne(attente, cle, colonne.name)

  if (ouverte) {
    return (
      <EditableCell
        // Il n'y a pas de valeur d'origine : `NULL` est le point de départ neutre, et c'est aussi ce
        // que la cellule montre tant que rien n'est saisi.
        valeur={{ kind: 'null' }}
        retenue={saisie}
        onValider={(valeur) => {
          onSaisir(valeur.kind === 'texte' && valeur.texte === '' ? null : valeur)
          onFermer()
        }}
        onAbandonner={onFermer}
      />
    )
  }

  const classe = colonne.category === 'number' ? styles.nombre : undefined
  const affichee =
    saisie === undefined ? (
      // **Dit, pas deviné** : une cellule vide dans une ligne neuve ne veut pas dire « vide », elle
      // veut dire « la base décidera ». Les confondre ferait attendre un `NULL` là où une séquence
      // ou un `now()` va s'appliquer.
      <span className={styles.defaut}>{t('tableView.grid.defaultValue')}</span>
    ) : (
      apercuDeLaSaisie(saisie)
    )

  if (!estEditableALAjout(colonne)) {
    return (
      <span
        className={cx(classe, styles.nonEditable)}
        title={t('tableView.grid.binaryReason', { column: colonne.name })}
      >
        {affichee}
      </span>
    )
  }

  return (
    <button
      type="button"
      className={cx(classe, styles.editable)}
      aria-label={t('tableView.grid.fillColumn', { column: colonne.name })}
      onClick={onOuvrir}
    >
      {affichee}
    </button>
  )
}

function messageVide(
  t: ReturnType<typeof useT>,
  loading: boolean,
  error: string | null,
  schema: string,
  table: string,
): string {
  if (error) return error
  if (loading) return t('tableView.grid.loadingRows')
  // Vide **lu** n'est pas vide **non lu** : une table sans ligne est un état normal, et ne rien
  // dire laisserait croire que la lecture n'a pas abouti.
  return t('tableView.grid.noRows', { schema, table })
}

/**
 * La hauteur du conteneur, mesurée.
 *
 * `VirtualGrid` prend une hauteur en **valeur** — jsdom ne calculant aucune mise en page, une
 * virtualisation qui lit `clientHeight` rendrait zéro ligne sous Vitest. La mesure vit donc ici,
 * dans l'écran, où un test n'en dépend pas.
 */
function useHauteurDisponible() {
  const ref = useRef<HTMLDivElement>(null)
  // 400 px : ce que rend un conteneur non mesuré, sous jsdom notamment. Une valeur nulle ne
  // monterait aucune ligne et ferait passer les tests pour la mauvaise raison.
  const [valeur, setValeur] = useState(400)

  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observateur = new ResizeObserver(() => {
      // La grille, c'est le conteneur **moins la toolbar** (36 px). La barre d'état, elle, vit au
      // niveau de l'écran depuis `10f` : la retirer ici laisserait vingt-six pixels vides sous la
      // grille. Mesuré, pas supposé.
      const disponible = element.clientHeight - 36
      if (disponible > 0) setValeur(disponible)
    })
    observateur.observe(element)
    return () => observateur.disconnect()
  }, [])

  return { ref, valeur }
}
