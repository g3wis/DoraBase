import { useMemo, useState } from 'react'
import type { QueryResult, Value } from '../../domain/engine'
import { useT } from '../../i18n/LanguageContext'
import { formatInteger } from '../../ui/format'
import { MenuContextuel } from '../../ui/MenuContextuel/MenuContextuel'
import { SegmentedControl } from '../../ui/SegmentedControl/SegmentedControl'
import { largeurAjustee } from '../../ui/VirtualGrid/ajustement'
import { type GridColumn, type PositionDuMenu, VirtualGrid } from '../../ui/VirtualGrid/VirtualGrid'
import { estNumerique, rendreValeur, texteDeValeur } from '../TableView/cellule'
import type { Dialecte } from '../Workbench/onglets'
import { ArbreJson } from './ArbreJson'
import styles from './ConsoleResult.module.css'
import { documentsDe } from './documents'
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
  // Les colonnes masquées, par nom — l'écart au défaut, comme dans `A5`. Elles survivent à une
  // nouvelle exécution : corriger sa requête ne doit pas défaire la mise en page qu'on vient de
  // régler, et un nom absent du nouveau résultat est simplement sans effet.
  const [masquees, setMasquees] = useState<ReadonlySet<string>>(new Set())
  // Les largeurs posées à la main, par nom — elles l'emportent sur l'ajustement, comme dans `A5` :
  // ce qu'on a réglé soi-même ne bouge plus. Même survie que `masquees`, pour la même raison.
  const [largeurs, setLargeurs] = useState<Record<string, number>>({})
  // L'ordre d'affichage des colonnes, par nom — `null` tant que rien n'a été glissé, auquel cas
  // l'ordre est celui du résultat. Même écart-au-défaut que `masquees` et `largeurs`.
  const [ordre, setOrdre] = useState<readonly string[] | null>(null)
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

  // L'ordre d'affichage : celui que la poignée a posé, ou celui du résultat tant que rien n'a été
  // glissé. Un nom de `ordre` absent du résultat est ignoré ; un nom du résultat absent de `ordre`
  // (la requête a changé depuis) reste affiché, en fin — jamais perdu. Même tolérance que dans
  // `A5`, par un tri **stable** : deux colonnes homonymes gardent leur ordre relatif, là où une
  // table de correspondance en perdrait une.
  const rangs = new Map((ordre ?? []).map((nom, rang) => [nom, rang] as const))
  const enBout = Number.MAX_SAFE_INTEGER

  const colonnes: GridColumn<readonly Value[]>[] = resultat.columns
    .map((nom, index) => ({ nom, index }))
    .sort((a, b) => (rangs.get(a.nom) ?? enBout) - (rangs.get(b.nom) ?? enBout))
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

  const onglets = onVueChange && (
    <div className={styles.vues}>
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
          onColumnReorder={(nouvelOrdre) => setOrdre(nouvelOrdre)}
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
                  visibles.length > 1
                    ? () => setMasquees((precedent) => new Set(precedent).add(menu.colonne))
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
                      onClick: () => setMasquees(new Set()),
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
