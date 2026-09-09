import { useMemo, useState } from 'react'
import { Icon } from '../../design/icons/Icon'
import type { ExportFormat, QueryResult, Value } from '../../domain/engine'
import { useT } from '../../i18n/LanguageContext'
import { cx } from '../../ui/cx'
import { formatBytes, formatInteger } from '../../ui/format'
import { MenuContextuel } from '../../ui/MenuContextuel/MenuContextuel'
import { Popover } from '../../ui/Popover/Popover'
import { SegmentedControl } from '../../ui/SegmentedControl/SegmentedControl'
import { largeurAjustee } from '../../ui/VirtualGrid/ajustement'
import { type GridColumn, type PositionDuMenu, VirtualGrid } from '../../ui/VirtualGrid/VirtualGrid'
import { estNumerique, rendreValeur, texteDeValeur } from '../TableView/cellule'
import type { Dialecte } from '../Workbench/onglets'
import { ArbreJson } from './ArbreJson'
import styles from './ConsoleResult.module.css'
import { documentsDe } from './documents'
import type { IssueDExport } from './exportResultat'
import { VueJson, VueMessages } from './vues'

/**
 * La largeur d'une colonne dont l'échantillon ne dit rien : la valeur unique de `12c`, devenue un
 * repli depuis que les colonnes s'ajustent à leur contenu.
 */
const LARGEUR_PAR_DEFAUT = 160
/** Combien de lignes l'ajustement regarde — même échantillon que `A5`, et pour la même raison. */
const LIGNES_AJUSTEES = 200

/** Les trois vues d'un résultat (`12e`). */
export type VueResultat = 'resultat' | 'json' | 'messages'

type ConsoleResultProps = {
  resultat: QueryResult | null
  erreur: string | null
  enCours: boolean
  vue?: VueResultat
  onVueChange?: (vue: VueResultat) => void
  /**
   * La langue de la console (`13a`).
   *
   * **En mongo, « Résultat » est l'arbre de documents, pas la grille.** Aplatir des documents
   * hétérogènes en colonnes est une décision de produit que `13b` a explicitement remise, et le
   * mockup d'`A8` ne montre pas de grille.
   */
  dialecte?: Dialecte
  /** La densité de `15c`, pour que la grille du résultat suive celle des tables. */
  rowHeight?: number
  /**
   * Les colonnes masquées et l'ordre d'affichage, **tenus par l'écran** (`ConsoleView`) : la barre
   * d'outils y montre le menu « colonnes affichées », et chaque geste — masquer, réafficher,
   * réordonner — y réécrit la projection de la requête (`projection.ts`). Les tenir ici aussi
   * ferait deux vérités. Absents, la grille montre tout, dans l'ordre du résultat, et les entrées
   * de menu qui n'ont pas de rappel sont désactivées.
   */
  masquees?: ReadonlySet<string>
  ordre?: readonly string[] | null
  /** Masque ou réaffiche une colonne — le menu d'en-tête n'expose que le masquage. */
  onBasculerColonne?: (nom: string) => void
  /** Réaffiche toutes les colonnes masquées. */
  onReafficher?: () => void
  /** L'ordre déposé par la grille : ses clés visibles, dans leur nouvel ordre. */
  onOrdreChange?: (ordre: readonly string[]) => void
  /**
   * Écrit le résultat dans un fichier (`API-29`). Rend le nombre d'octets, ou `null` si le
   * sélecteur de destination a été refermé sans choisir.
   *
   * **La projection est déjà faite** par `ConsoleView`, qui tient les colonnes masquées et l'ordre :
   * ce bouton ne choisit qu'un format. Absent, il n'est pas rendu — la galerie et les vitrines
   * montent le résultat sans pont, et un bouton qui n'écrirait rien se lirait comme une panne
   * (défaut n° 36).
   */
  onExporter?: (format: ExportFormat) => Promise<IssueDExport>
}

/** L'ensemble vide, partagé : un défaut `new Set()` en ligne changerait d'identité à chaque rendu. */
const AUCUNE: ReadonlySet<string> = new Set()

/**
 * L'ordre d'affichage : celui que la poignée a posé, ou celui du résultat tant que rien n'a été
 * glissé. Un nom de `ordre` absent du résultat est ignoré ; un nom du résultat absent de `ordre`
 * (la requête a changé depuis) reste affiché, en fin — jamais perdu. Même tolérance que dans `A5`,
 * par un tri **stable** : deux colonnes homonymes gardent leur ordre relatif, là où une table de
 * correspondance en perdrait une.
 */
export function ordonner<Entree extends { nom: string }>(
  entrees: readonly Entree[],
  ordre: readonly string[] | null,
): Entree[] {
  if (ordre === null) return [...entrees]
  const rangs = new Map(ordre.map((nom, rang) => [nom, rang] as const))
  const enBout = Number.MAX_SAFE_INTEGER
  return [...entrees].sort((a, b) => (rangs.get(a.nom) ?? enBout) - (rangs.get(b.nom) ?? enBout))
}

/**
 * Le résultat d'une requête de console (`12c`) : la grille, et les chiffres qui l'accompagnent.
 *
 * **La grille est celle de `10a`**, pas une seconde. Elle attend des colonnes décrites par
 * `ColumnInfo` ; une requête libre n'a que des noms et des valeurs, d'où la reconstitution ci-dessous
 * — dupliquer la grille pour lui donner une autre entrée serait deux grilles à maintenir, et deux
 * densités qui divergeraient au premier réglage.
 */
export function ConsoleResult({
  resultat,
  erreur,
  enCours,
  vue = 'resultat',
  onVueChange,
  dialecte = 'sql',
  rowHeight,
  masquees = AUCUNE,
  ordre = null,
  onBasculerColonne,
  onReafficher,
  onOrdreChange,
  onExporter,
}: ConsoleResultProps) {
  const t = useT()
  // La ligne sélectionnée, pour la vue JSON : elle **suit la sélection**, comme le panneau de `10f`.
  // Sérialiser mille lignes pour l'affichage contredirait la contrainte transverse du projet.
  const [rangChoisi, setRangChoisi] = useState<number | null>(null)
  // Le menu du clic droit sur une valeur ou un en-tête — le même geste et les mêmes libellés que
  // dans la grille d'`A5` et le panneau de ligne : une valeur se copie de la même façon partout où
  // elle s'affiche.
  const [menu, setMenu] = useState<
    | ({ sorte: 'cellule'; colonne: string; texte: string } & PositionDuMenu)
    | ({ sorte: 'entete'; colonne: string } & PositionDuMenu)
    | null
  >(null)
  // Les largeurs posées à la main, par nom — elles l'emportent sur l'ajustement, comme dans `A5` :
  // ce qu'on a réglé soi-même ne bouge plus. Elles survivent à une nouvelle exécution — corriger
  // sa requête ne doit pas défaire la mise en page qu'on vient de régler — et un nom absent du
  // nouveau résultat est simplement sans effet. Le seul état de mise en page resté ici : les
  // masquées et l'ordre sont remontés à l'écran, qui en réécrit la requête.
  const [largeurs, setLargeurs] = useState<Record<string, number>>({})
  /**
   * La largeur ajustée de chaque colonne, par nom (`ajustement.ts`).
   *
   * **C'est ici qu'elle compte le plus** : une requête libre n'a aucun catalogue pour décider des
   * largeurs, et la valeur unique de `12c` — 160 px pour tout le monde — était exactement le
   * défaut faute de mieux qu'un ajustement remplace.
   *
   * Déclarée **avant les quatre issues courtes** ci-dessous, comme les états ci-dessus, et donc sur
   * un résultat qui peut être nul.
   */
  const largeursAjustees = useMemo(() => {
    const parNom: Record<string, number> = {}
    if (resultat === null) return parNom
    const echantillon = resultat.rows.slice(0, LIGNES_AJUSTEES)
    for (const [index, nom] of resultat.columns.entries()) {
      parNom[nom] = largeurAjustee(
        nom,
        echantillon.map((ligne) => texteDeValeur(ligne[index] ?? { kind: 'null' })),
      )
    }
    return parNom
  }, [resultat])
  // **L'erreur passe avant tout le reste**, y compris un résultat précédent encore en mémoire :
  // l'afficher à côté d'une erreur le ferait lire comme le résultat de la requête qui vient
  // d'échouer — la lecture la plus naturelle, et la plus fausse.
  if (erreur !== null) {
    return (
      <div className={styles.root}>
        {/* Le message du serveur, **entier** : c'est lui qui dit où est la faute. L'abréger pour
            tenir dans une ligne enlèverait la position, qui est le plus utile. */}
        <p className={styles.erreur} role="alert">
          {erreur}
        </p>
      </div>
    )
  }

  if (enCours) {
    return (
      <div className={styles.root}>
        <p className={styles.attente}>{t('console.resultat.enCours')}</p>
      </div>
    )
  }

  if (resultat === null) {
    return (
      <div className={styles.root}>
        <p className={styles.vide}>{t('console.resultat.aucun')}</p>
      </div>
    )
  }

  // **La grille de `10a`, avec ses colonnes décrites comme elle l'attend.** Une requête libre n'a que
  // des noms et des valeurs ; la largeur et l'alignement se déduisent donc du résultat lui-même.
  // Ce qui reste affiché : la liste de référence des deux entrées du menu d'en-tête — l'une refuse
  // de masquer la dernière, l'autre ne paraît que s'il y a de quoi rendre.
  //
  // **Les gestes de mise en page d'`A5` — masquer, ajuster, redimensionner, déplacer — sans le tri
  // ni les filtres, et c'est délibéré** : dans `A5` un tri ou un filtre repartent au serveur en
  // recomposant la requête, et la console exécute ce que l'utilisateur a **écrit**. Réécrire sa
  // requête n'est pas un geste de grille ; c'est l'éditeur au-dessus qui le porte.
  const visibles = resultat.columns.filter((nom) => !masquees.has(nom))

  const colonnes: GridColumn<readonly Value[]>[] = ordonner(
    resultat.columns.map((nom, index) => ({ nom, index })),
    ordre,
  )
    .filter(({ nom }) => !masquees.has(nom))
    .map(({ nom, index }) => ({
      key: nom,
      header: nom,
      // Le nom de la colonne, et **lui seul** : sans cela, la poignée de redimensionnement voisine
      // ajoute son propre libellé au nom de la cellule d'en-tête.
      headerLabel: nom,
      // La largeur posée à la main d'abord, puis l'ajustement au contenu, et à défaut la largeur
      // unique de `12c` — celle d'une colonne dont l'échantillon ne dit rien.
      width: largeurs[nom] ?? largeursAjustees[nom] ?? LARGEUR_PAR_DEFAUT,
      resizeLabel: t('console.resultat.redimensionnerLaColonne', { colonne: nom }),
      reorderLabel: t('console.resultat.deplacerLaColonne', { colonne: nom }),
      // L'alignement suit le **genre de la première valeur**, seule information disponible pour une
      // colonne calculée : `count(*)` n'existe dans aucun catalogue.
      numeric: estNumerique(resultat.rows[0]?.[index] ?? { kind: 'null' }),
      cell: (ligne: readonly Value[]) => rendreValeur(ligne[index] ?? { kind: 'null' }),
    }))

  const mongo = dialecte === 'mongo'

  // La bande de tête du résultat : les vues à gauche, l'export à droite.
  //
  // **Elle paraît dès que l'une des deux existe**, et non plus seulement avec les vues : accrocher
  // l'export à la présence de `onVueChange` l'aurait fait disparaître avec les onglets, alors que
  // rien ne les lie — la galerie monte l'un sans l'autre.
  const onglets = (onVueChange || onExporter) && (
    <div className={styles.vues}>
      {onVueChange && (
        <SegmentedControl
          label={t('console.resultat.vueLabel')}
          segments={[
            {
              value: 'resultat' as const,
              // « Documents » et non « Résultat » : c'est ce que la vue contient, et le mot dit du
              // même coup que ce n'est pas une grille de lignes.
              label: mongo ? t('console.resultat.documents') : t('console.resultat.resultat'),
              count: resultat.rows.length,
            },
            // **Pas d'onglet « JSON » en mongo** : la vue « Documents » *est* du JSON. Deux onglets
            // pour la même chose feraient chercher la différence.
            ...(mongo ? [] : [{ value: 'json' as const, label: t('console.resultat.json') }]),
            { value: 'messages' as const, label: t('console.resultat.messages') },
          ]}
          value={vue}
          onValueChange={onVueChange}
        />
      )}
      {onExporter && (
        <BoutonDExport
          onExporter={onExporter}
          mongo={mongo}
          vide={resultat.rows.length === 0}
          pourLeResultat={resultat}
        />
      )}
    </div>
  )

  if (mongo && vue === 'resultat') {
    return (
      <div className={styles.root}>
        {onglets}
        <div className={styles.panneau}>
          <ArbreJson
            documents={documentsDe(resultat)}
            onCopier={(document: unknown) =>
              void navigator.clipboard?.writeText(JSON.stringify(document, null, 2))
            }
          />
        </div>
        <Barre resultat={resultat} dialecte={dialecte} />
      </div>
    )
  }

  if (vue !== 'resultat') {
    return (
      <div className={styles.root}>
        {onglets}
        <div className={styles.panneau}>
          {vue === 'json' && <VueJson resultat={resultat} rang={rangChoisi} />}
          {vue === 'messages' && <VueMessages resultat={resultat} />}
        </div>
        <Barre resultat={resultat} dialecte={dialecte} />
      </div>
    )
  }

  return (
    <div className={styles.root}>
      {onglets}
      <div className={styles.grille}>
        <VirtualGrid
          rowHeight={rowHeight}
          label={t('console.resultat.grilleLabel', { n: resultat.rows.length })}
          columns={colonnes}
          rows={resultat.rows}
          rowId={(_, index) => String(index)}
          selectedId={rangChoisi === null ? null : String(rangChoisi)}
          onSelect={(_, index) => setRangChoisi(index)}
          viewportHeight={320}
          onColumnResize={(cle, largeur) =>
            setLargeurs((precedent) => ({ ...precedent, [cle]: largeur }))
          }
          onColumnReorder={onOrdreChange}
          onHeaderContextMenu={(cle, position) =>
            setMenu({ sorte: 'entete', colonne: cle, ...position })
          }
          onCellContextMenu={(ligne, cle, _rang, position) => {
            // L'indice du **résultat**, et non celui de l'affichage : c'est lui qui désigne la
            // valeur dans la ligne reçue.
            const index = resultat.columns.indexOf(cle)
            const valeur = index === -1 ? undefined : ligne[index]
            // Toute cellule d'un résultat a une valeur — `NULL` en est une, et se copie comme elle
            // s'affiche. Il n'y a donc pas ici l'entrée désactivée qu'`A5` doit prévoir pour une
            // ligne ajoutée dont la cellule attend encore le défaut de la base.
            if (valeur === undefined) return
            setMenu({ sorte: 'cellule', colonne: cle, texte: texteDeValeur(valeur), ...position })
          }}
          empty={<span>{t('console.resultat.grilleVide')}</span>}
        />
      </div>
      <Barre resultat={resultat} dialecte={dialecte} />
      {menu !== null &&
        (menu.sorte === 'cellule' ? (
          <MenuContextuel
            x={menu.x}
            y={menu.y}
            label={t('console.resultat.menuDeLaValeur', { colonne: menu.colonne })}
            entrees={[
              {
                libelle: t('console.resultat.copierLaValeur'),
                // Le texte **tel qu'il est rendu** : `texteDeValeur` est la source de l'affichage
                // comme du presse-papiers, donc un `NULL` copié dit « NULL » et un binaire sa taille.
                onClick: () => void navigator.clipboard?.writeText(menu.texte),
              },
            ]}
            onFermer={() => setMenu(null)}
          />
        ) : (
          <MenuContextuel
            x={menu.x}
            y={menu.y}
            label={t('console.resultat.menuDeLaColonne', { colonne: menu.colonne })}
            entrees={[
              {
                libelle: t('console.resultat.masquerLaColonne'),
                // **La dernière colonne ne se masque pas.** C'est ce qui garde le chemin du retour
                // ouvert : « Réafficher » vit dans le menu d'un en-tête, et masquer le dernier
                // en-tête retirerait le seul endroit d'où on pourrait revenir. `A5` n'a pas ce
                // souci — sa barre d'outils compte les colonnes et les rend —, la console n'a pas
                // cette barre.
                onClick:
                  onBasculerColonne !== undefined && visibles.length > 1
                    ? () => onBasculerColonne(menu.colonne)
                    : undefined,
                raison: visibles.length > 1 ? undefined : t('console.resultat.derniereColonne'),
              },
              // **L'entrée n'existe que s'il y a de quoi rendre**, et elle dit combien : une entrée
              // permanente à « (0) » se lirait comme une action cassée.
              ...(visibles.length < resultat.columns.length
                ? [
                    {
                      libelle: t('console.resultat.reafficherLesColonnes', {
                        n: resultat.columns.length - visibles.length,
                      }),
                      onClick: onReafficher,
                    },
                  ]
                : []),
            ]}
            onFermer={() => setMenu(null)}
          />
        ))}
    </div>
  )
}

/** Ce qu'un export vient de produire, et qui s'affiche à côté du bouton. */
type EtatDExport =
  | { phase: 'repos' }
  | { phase: 'en-cours' }
  | { phase: 'ecrit'; octets: number }
  | { phase: 'echoue'; message: string }

/**
 * Le bouton d'export du résultat (`API-29`), et le choix du format.
 *
 * **Dans la bande du résultat, et non dans la barre d'outils de la console.** Les quatre actions de
 * la barre — Exécuter, Sélection, Enregistrer, Formater — agissent sur le **texte** de la requête ;
 * celle-ci agit sur la **réponse**. La bande de tête du résultat est aussi celle qui porte le compte
 * de lignes et les vues, c'est-à-dire tout ce qui décrit ce qu'on va exporter.
 *
 * **Un menu et non deux boutons** : les deux formats sont deux façons de faire le même geste, et
 * deux boutons côte à côte auraient laissé croire à deux gestes différents.
 */
function BoutonDExport({
  onExporter,
  mongo,
  vide,
  pourLeResultat,
}: {
  onExporter: (format: ExportFormat) => Promise<IssueDExport>
  mongo: boolean
  vide: boolean
  /**
   * Le résultat que l'issue affichée décrit — **un jeton d'identité, jamais lu**.
   *
   * Sans lui, « Exporté · 12 ko » survivrait au résultat qu'il décrit. Une nouvelle exécution
   * démonte ce bouton en passant par « Exécution… », donc le cas ordinaire se règle tout seul ;
   * mais le panneau de transaction **repose** une réponse précédente sans cette étape (`API-38`),
   * et l'issue d'avant serait alors lue comme celle du résultat qu'on vient d'afficher. C'est le
   * motif du commentaire qui survit à la garantie qu'il décrivait (règle n° 20), appliqué à un
   * message d'écran.
   */
  pourLeResultat: QueryResult
}) {
  const t = useT()
  const [etat, setEtat] = useState<EtatDExport>({ phase: 'repos' })
  // Le motif documenté de React pour ajuster un état quand une prop change : le comparer pendant le
  // rendu. Un `useEffect` le ferait après une peinture, donc l'issue périmée serait visible une
  // image.
  const [resultatDecrit, setResultatDecrit] = useState(pourLeResultat)
  if (resultatDecrit !== pourLeResultat) {
    setResultatDecrit(pourLeResultat)
    setEtat({ phase: 'repos' })
  }

  async function exporter(format: ExportFormat) {
    // **Un export à la fois.** Le déclencheur reste dans son `Popover` pendant l'écriture (voir
    // plus bas), donc son menu s'ouvre encore : sans cette garde, un second format cliqué pendant
    // le premier ouvrirait un second sélecteur de destination.
    if (etat.phase === 'en-cours') return
    setEtat({ phase: 'en-cours' })
    try {
      const octets = await onExporter(format)
      // **Renoncer au sélecteur n'annonce rien.** Ni réussite — aucun fichier n'a été écrit —, ni
      // échec : rien n'a cassé, et une erreur sur un geste qu'on vient d'annuler ferait chercher
      // quoi.
      setEtat(octets === null ? { phase: 'repos' } : { phase: 'ecrit', octets })
    } catch (cause) {
      setEtat({ phase: 'echoue', message: messageDe(cause) })
    }
  }

  const enCours = etat.phase === 'en-cours'
  // **Un résultat sans ligne n'a rien à exporter**, et le dire vaut mieux qu'écrire un fichier qui
  // ne porte qu'un en-tête — ou rien du tout, une écriture de console ne rendant aucune colonne.
  // Désactivé avec sa raison, jamais caché.
  const raison = vide ? t('console.export.raisonVide') : null

  const declencheur = (
    <button
      type="button"
      className={styles.exporter}
      // **`aria-disabled` et non `disabled`** quand le bouton porte une explication : un bouton
      // désactivé ne reçoit ni survol ni focus, donc son infobulle serait inatteignable là où elle
      // est le plus utile (piège n° 3).
      aria-disabled={raison !== null || enCours ? true : undefined}
      title={raison ?? undefined}
    >
      <Icon name="dl" size={13} strokeWidth={1.9} />
      {enCours ? t('console.export.enCours') : t('console.export.libelle')}
    </button>
  )

  return (
    <span className={styles.export}>
      {etat.phase === 'ecrit' && (
        // `role="status"` : une réussite s'annonce sans interrompre.
        //
        // **Nommée, parce que la barre du résultat est déjà un `status`** — « État du résultat »,
        // vingt pixels plus bas. Deux régions vives homonymes dans le même sous-arbre ne se
        // distingueraient ni à la voix ni dans un test. Le nom identifie la région ; c'est le
        // **contenu** qui s'annonce quand il change.
        <span
          className={styles.exportIssue}
          role="status"
          aria-label={t('console.export.issueAriaLabel')}
        >
          {t('console.export.ecrit', { taille: formatBytes(etat.octets) })}
        </span>
      )}
      {etat.phase === 'echoue' && (
        // `role="alert"` : un fichier qu'on croyait écrit ne l'est pas. Le message vient du cœur et
        // nomme le fichier — c'est la seule chose que l'utilisateur puisse corriger —, et le `title`
        // le rend en entier là où la bande le rogne.
        <span
          className={cx(styles.exportIssue, styles.exportEchec)}
          role="alert"
          aria-label={t('console.export.issueAriaLabel')}
          title={etat.message}
        >
          {etat.message}
        </span>
      )}
      {raison !== null ? (
        // **Sans le `Popover` quand il n'y a rien à exporter** : celui-ci pose son propre `onClick`,
        // donc un déclencheur enveloppé ouvrirait son menu malgré l'`aria-disabled`. Cet état-là ne
        // change pas sous la main de l'utilisateur — il suit le résultat, qui remonte le bouton de
        // toute façon.
        //
        // **Pendant l'écriture, en revanche, le `Popover` reste** : un déclencheur qui change de
        // place dans l'arbre React est démonté puis remonté, et le focus que `Popover` venait de
        // lui rendre tombe alors sur le `body` — d'où plus aucune touche ne mène nulle part. C'est
        // la garde ci-dessus qui empêche un second export, et non le retrait du menu.
        declencheur
      ) : (
        <Popover
          align="end"
          title={t('console.export.titre')}
          // Un menu d'actions se referme volontiers quand on s'en éloigne — voir `fermerEnSortant`.
          fermerEnSortant
          content={(fermer) => (
            <ul className={styles.formats}>
              {FORMATS.map((format) => {
                // **Pas de CSV pour un résultat mongo.** Sa réponse est un arbre de documents et
                // non une grille (`13b`) : un CSV en serait l'aplatissement en colonnes, décision
                // de produit explicitement remise — et il exporterait ce que l'écran n'a jamais
                // montré. Désactivé avec sa raison plutôt que retiré : le cacher ferait croire
                // qu'il n'existera jamais, comme « Gérer les schémas… » hors PostgreSQL.
                const refus = mongo && format === 'csv' ? t('console.export.raisonMongo') : null
                return (
                  <li key={format}>
                    <button
                      type="button"
                      className={styles.format}
                      aria-disabled={refus !== null ? true : undefined}
                      title={refus ?? undefined}
                      onClick={
                        refus !== null
                          ? undefined
                          : () => {
                              fermer()
                              void exporter(format)
                            }
                      }
                    >
                      {t(`console.export.formats.${format}`)}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        >
          {declencheur}
        </Popover>
      )}
    </span>
  )
}

/** Les deux formats, dans l'ordre où le menu les propose. */
const FORMATS: readonly ExportFormat[] = ['csv', 'json']

/**
 * Le message d'un échec remonté par l'IPC.
 *
 * `export_result` rend un `Err(String)`, que Tauri sérialise en chaîne — mais un pont cassé ou une
 * panique de commande rendent autre chose, et un `catch` qui suppose une seule forme afficherait
 * « undefined » là où la cause était lisible. Même piège que `08d`.
 */
function messageDe(cause: unknown): string {
  if (typeof cause === 'string') return cause
  if (cause instanceof Error) return cause.message
  if (cause !== null && typeof cause === 'object' && 'message' in cause) {
    return String((cause as { message: unknown }).message)
  }
  return String(cause)
}

/** La barre de chiffres, partagée par les trois vues — ils décrivent la même exécution. */
function Barre({ resultat, dialecte }: { resultat: QueryResult; dialecte: Dialecte }) {
  const t = useT()
  // « 4 docs · 61 ms », le pied du mockup d'`A8`. Compter des « lignes » sous un arbre de documents
  // nommerait la mauvaise chose.
  const compte =
    dialecte === 'mongo'
      ? t('console.resultat.compteDocuments', {
          n: resultat.rows.length,
          texte: formatInteger(resultat.rows.length),
        })
      : t('console.resultat.compteLignes', {
          n: resultat.rows.length,
          texte: formatInteger(resultat.rows.length),
        })
  return (
    <div className={styles.barre} role="status" aria-label={t('console.resultat.etatAriaLabel')}>
      <span className={styles.compte}>{compte}</span>
      <span>·</span>
      <span>{resultat.durationMs} ms</span>
      {resultat.appliedLimit !== null && (
        <>
          <span>·</span>
          {/* **La limite ajoutée est dite.** Une limite silencieuse ferait croire à une table de
                mille lignes — un mensonge sur les données, la pire catégorie de défaut pour cet
                outil. Le mot « par DoraBase » distingue cette limite de celle qu'on aurait écrite. */}
          <span className={styles.limite}>
            {t('console.resultat.limite', { n: resultat.appliedLimit })}
          </span>
        </>
      )}
    </div>
  )
}
