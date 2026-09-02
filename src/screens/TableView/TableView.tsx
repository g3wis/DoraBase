import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../design/icons/Icon'
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
  Value,
} from '../../domain/engine'
import { useT } from '../../i18n/LanguageContext'
import { modificateurActif } from '../../shell/plateforme'
import { cx } from '../../ui/cx'
import { type GridColumn, VirtualGrid } from '../../ui/VirtualGrid/VirtualGrid'
import { apercuDeLaSaisie, estNumerique, rendreValeur } from './cellule'
import { DocumentJsonModal } from './DocumentJsonModal'
import { diffCreation, diffDocument, documentDepuisTexte, documentJson } from './documentJson'
import { EditableCell } from './EditableCell'
import { FilterCell } from './FilterCell'
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
import { basculerTri, filtreDe, poserFiltre, rangDeTri } from './tri'
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

/** Largeur par défaut d'une colonne de données, faute de mesure du contenu. */
const LARGEUR_COLONNE = 130
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

  // `useCallback` : la fonction entre dans le `useMemo` des colonnes, qu'une nouvelle identité à
  // chaque rendu recalculerait pour rien.
  const appliquerFiltre = useCallback(
    (column: string, operator: FilterOperator, saisie: string) => {
      setOperateurs((precedent) => ({ ...precedent, [column]: operator }))
      setFilters((precedent) => poserFiltre(precedent, column, filtreDe(column, operator, saisie)))
    },
    [],
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
    })
  }, [fenetre, loading, error, ligneChoisie, lignes.length, onLectureChange])

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

  const colonnes: GridColumn<Ligne>[] = useMemo(
    () => [
      {
        key: '#',
        header: '#',
        width: moteur === 'mongodb' ? LARGEUR_GOUTTIERE_MONGO : LARGEUR_GOUTTIERE,
        // Rien à redimensionner dans la gouttière : elle n'a que le rang et deux icônes d'action.
        resizable: false,
        // **`+2` plutôt qu'un rang** : une ligne ajoutée n'a pas de place dans la table, seulement
        // un ordre d'arrivée. Lui donner un rang la ferait passer pour la 501ᵉ ligne lue.
        //
        // **Les actions remplacent le numéro au survol**, motif repris de `TreeRow` :
        // `visibility: hidden` par défaut, révélée par `:hover`/`:focus-within`. Une ligne déjà
        // marquée pour suppression les garde visibles en permanence — la marque ne doit pas
        // dépendre du survol pour se voir.
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
                      className={styles.supprimerLigne}
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
                      <Icon name="x" size={11} strokeWidth={2.4} />
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
      ...colonnesEffectives
        .map((colonne, rang) => ({ colonne, rang }))
        .filter(({ colonne }) => !masquees.has(colonne.name))
        .map(({ colonne, rang }) => {
          const filtre = filters.find((f) => f.column === colonne.name)
          const critere = sort.find((c) => c.column === colonne.name)
          const rangDuTri = rangDeTri(sort, colonne.name)
          return {
            key: colonne.name,
            header: (
              <button
                type="button"
                className={styles.entete}
                // Le `⌘`-clic empile un second critère : la convention de tous les tableurs et de
                // tous les clients SQL, que le handoff ne dit pas et qu'inventer autrement serait
                // gratuit. `aria-sort` porte l'état pour qui n'en voit pas la flèche.
                onClick={(evenement) =>
                  setSort((precedent) =>
                    basculerTri(precedent, colonne.name, evenement.metaKey || evenement.ctrlKey),
                  )
                }
                aria-label={t('tableView.grid.sortBy', { column: colonne.name })}
              >
                {colonne.name}
                {critere && (
                  <Icon
                    name={critere.direction === 'ascending' ? 'asc' : 'desc'}
                    size={11}
                    strokeWidth={2.4}
                  />
                )}
                {/* La pastille de rang n'apparaît qu'à partir de **deux** critères : un « 1 »
                  solitaire sur la seule colonne triée serait du bruit. */}
                {rangDuTri !== null && sort.length > 1 && (
                  <span className={styles.rang}>{rangDuTri}</span>
                )}
              </button>
            ),
            width: largeurs[colonne.name] ?? LARGEUR_COLONNE,
            resizeLabel: t('tableView.grid.resizeColumn', { column: colonne.name }),
            // L'alignement suit la **valeur**, pas le nom de la colonne : une colonne numérique
            // dont une cellule est `NULL` garde son `NULL` à gauche, comme le mockup le montre.
            numeric: colonne.category === 'number',
            tint: filtre ? ('filtered' as const) : critere ? ('sorted' as const) : undefined,
            filter: (
              <FilterCell
                column={colonne.name}
                operator={operateurs[colonne.name] ?? 'eq'}
                value={filtre?.value ?? ''}
                onApply={(operator, saisie) => appliquerFiltre(colonne.name, operator, saisie)}
                numeric={colonne.category === 'number'}
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
              const affichee = modifiee ? apercuDeLaSaisie(modifiee.apres) : rendreValeur(valeur)
              const classe = estNumerique(valeur) ? styles.nombre : undefined

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
      colonnesEffectives,
      filters,
      sort,
      operateurs,
      appliquerFiltre,
      masquees,
      largeurs,
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
        columns={colonnesEffectives}
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
        // **Le `+` s'adapte au moteur, il ne s'ajoute pas.** Sur MongoDB, poser une ligne vide
        // éditée cellule par cellule n'a pas de sens sans colonnes déclarées : le geste ouvre
        // directement l'éditeur JSON (`18g`), qui compose le document entier d'un coup.
        onAjouterUneLigne={
          edition && onAttenteChange !== undefined
            ? moteur === 'mongodb'
              ? () => setDocumentJsonOuvert({ sorte: 'creer' })
              : () => onAttenteChange(ajouterUneLigne(attente))
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
            // L'identité locale d'une ligne ajoutée, jamais son rang : `+1` et la première ligne
            // lue partagent le rang 1, et deux lignes de même identité feraient sauter la sélection
            // de l'une à l'autre.
            rowId={(ligne) => (ligne.sorte === 'ajoutee' ? ligne.cle : String(ligne.rang))}
            onColumnResize={(cle, largeur) =>
              setLargeurs((precedent) => ({ ...precedent, [cle]: largeur }))
            }
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
