import { type MouseEvent as MouseEventReact, useEffect, useRef, useState } from 'react'
import { Icon } from '../../design/icons/Icon'
import type { ColumnInfo, DatabaseKey, Relation, Value } from '../../domain/engine'
import { useT } from '../../i18n/LanguageContext'
import { cx } from '../../ui/cx'
import { glypheDeType } from '../../ui/glypheDeType'
import { MenuContextuel } from '../../ui/MenuContextuel/MenuContextuel'
import type { PasserelleDetail } from '../Workbench/useDetailTable'
import { rendreValeur, texteDeValeur } from './cellule'
import { documentJson } from './documentJson'
import { type Echelle, valeurRelue } from './horodatage'
import { JsonColore } from './JsonColore'
import { relationDe, valeurDeCle } from './ligneLiee'
import styles from './RowPanel.module.css'
import { useLigneLiee } from './useLigneLiee'
import type { PasserelleLignes } from './useLignes'

type Onglet = 'champs' | 'json'

/**
 * Le temps de survol avant l'aperçu.
 *
 * Un demi-seconde : assez pour que traverser la liste à la souris n'allume rien, assez peu pour que
 * s'arrêter sur une valeur coupée la révèle sans qu'on ait à y penser.
 */
const SURVOL_MS = 500

/** Ce que le survol prolongé montre : un texte, et où le poser. */
type Apercu = { texte: string; haut: number; gauche: number }

type RowPanelProps = {
  cle: DatabaseKey
  columns: readonly ColumnInfo[]
  relations: readonly Relation[]
  /** La ligne sélectionnée, `null` quand il n'y en a pas. */
  ligne: readonly Value[] | null
  /**
   * La lecture de chaque colonne d'entiers, telle que la grille l'applique (`horodatage.ts`).
   *
   * **Le panneau et la grille montrent la même cellule** : deux lectures divergentes du même entier,
   * l'une en date et l'autre en nombre, se liraient comme un défaut de lecture. C'est le motif de la
   * sélection, pilotée depuis l'écran pour la même raison.
   *
   * **L'onglet JSON n'en tient pas compte, délibérément** : il porte le document qui se *réécrit*
   * (`documentJson`), et une date y remplacerait la valeur stockée.
   */
  lectures?: Readonly<Record<string, Echelle>>
  /**
   * Son rang dans la fenêtre, à partir de 1. **Il ne s'affiche plus** — il sert à nommer le panneau
   * pour un lecteur d'écran, et à savoir qu'une ligne est bien sélectionnée.
   */
  rang: number | null
  /** Le SQL d'insertion, demandé au moteur. `null` quand la commande n'est pas disponible. */
  onCopyInsert?: () => void
  passerelleDetail: PasserelleDetail
  passerelleLignes: PasserelleLignes
}

/**
 * Le panneau droit de `A5` : la ligne sélectionnée en clé-valeur, ses onglets, sa ligne liée.
 *
 * **Il n'a plus d'en-tête.** Son titre « Ligne 5 · id 041ff6ac… » répétait le rang déjà lisible dans
 * la gouttière `#` de la grille et l'identifiant déjà lisible trois centimètres plus bas, et son
 * identifiant long poussait les flèches hors de la barre. Les flèches, elles, sont remontées dans le
 * cadre de la colonne (`22`) : deux barres de chrome empilées là où la capture n'en montre qu'une
 * auraient été le prix de les garder ici.
 *
 * **Les deux onglets ne sont pas deux vues du même contenu.** Champs rend les colonnes dans
 * l'ordre du catalogue ; JSON rend la ligne entière en objet, ce qui sert à la recopier.
 *
 * **Il y en avait un troisième, « Liens »** (`API-49`), et c'est le seul qui ne dépendait pas de la
 * ligne sélectionnée : il listait les relations de la *table*, loin des colonnes qu'elles
 * concernent. Chaque relation est désormais écrite **sur la colonne qu'elle touche**, sous son nom,
 * et rien ne s'est perdu au change — une relation porte les colonnes de cette table (`columns`) dans
 * les deux sens, et `columns` est le catalogue entier, donc chacune trouve sa ligne. Le compte est
 * le même, l'endroit est le bon, et il y a un onglet de moins à visiter pour savoir où mène une clé.
 */
export function RowPanel({
  cle,
  columns,
  relations,
  ligne,
  lectures = {},
  rang,
  onCopyInsert,
  passerelleDetail,
  passerelleLignes,
}: RowPanelProps) {
  const t = useT()
  const [onglet, setOnglet] = useState<Onglet>('champs')
  const [revelation, setRevelation] = useState<Apercu | null>(null)
  const [menu, setMenu] = useState<{
    x: number
    y: number
    /** « la clé » ou « la valeur » : ce que l'entrée du menu annonce copier. */
    quoi: string
    colonne: string
    texte: string
  } | null>(null)
  const minuteur = useRef<number | undefined>(undefined)

  // Le minuteur ne doit pas survivre au démontage : changer de ligne pendant l'attente ferait
  // apparaître l'aperçu d'une valeur qui n'est plus affichée.
  useEffect(() => () => window.clearTimeout(minuteur.current), [])

  function armer(partie: HTMLElement, texte: string) {
    window.clearTimeout(minuteur.current)
    // **Seulement si c'est coupé.** Un aperçu qui répète un texte entièrement lisible n'apprend rien
    // et masque ses voisins. La coupure se mesure sur le rendu — `scrollWidth` contre `clientWidth` —
    // plutôt que sur la longueur du texte : c'est la police, la largeur de la colonne et le zoom qui
    // décident, et aucun seuil de caractères ne les connaît.
    if (partie.scrollWidth <= partie.clientWidth + 1) {
      setRevelation(null)
      return
    }
    // **La boîte est mesurée maintenant, pas à l'échéance.** Dans un demi-seconde, la souris peut
    // avoir fait défiler le panneau ; mesurer au départ garantit que l'aperçu désigne le champ qu'on
    // survolait — et le défilement, lui, referme (voir `desarmer` sur `mouseleave`).
    const boite = partie.getBoundingClientRect()
    minuteur.current = window.setTimeout(() => {
      setRevelation({ texte, haut: boite.bottom + 4, gauche: boite.left })
    }, SURVOL_MS)
  }

  function ouvrirLeMenu(evenement: MouseEventReact, quoi: string, colonne: string, texte: string) {
    evenement.preventDefault()
    // **Et la propagation s'arrête ici** : sans cela, le menu du parent — s'il en vient un — s'ouvrirait
    // par-dessus celui-ci, et le dernier ouvert gagnerait.
    evenement.stopPropagation()
    desarmer()
    setMenu({ x: evenement.clientX, y: evenement.clientY, quoi, colonne, texte })
  }

  function desarmer() {
    window.clearTimeout(minuteur.current)
    setRevelation(null)
  }

  // La première clé étrangère de la ligne, et sa valeur. Le mockup n'en montre qu'une, et rien
  // ne dit comment il en présenterait plusieurs — trou consigné dans la spec.
  const colonneFk = columns.find((colonne) => relationDe(relations, colonne.name))
  const relation = colonneFk ? relationDe(relations, colonneFk.name) : undefined
  const valeurFk = colonneFk ? valeurDeCle(ligne?.[columns.indexOf(colonneFk)] ?? undefined) : null

  const apercu = useLigneLiee(
    ligne ? cle : null,
    relation,
    valeurFk,
    passerelleDetail,
    passerelleLignes,
  )

  const liens = liensOrdonnes(relations, columns)

  // **Rien plutôt qu'une phrase.** Sans ligne sélectionnée, ce panneau affichait « Sélectionnez une
  // ligne pour en voir le détail. » ; l'en-tête permanent du cadre rend la colonne lisible sans elle,
  // et une phrase qui décrit un geste évident finit par se lire comme du remplissage (`22`).
  if (!ligne || rang === null) return null

  return (
    <aside className={styles.root} aria-label={t('tableView.rowPanel.detailLabel', { rang })}>
      <div className={styles.onglets} role="tablist" aria-label={t('tableView.rowPanel.tabsLabel')}>
        {(
          [
            { id: 'champs', label: t('tableView.rowPanel.tabs.fields'), icon: 'cols' },
            { id: 'json', label: t('tableView.rowPanel.tabs.json'), icon: 'json' },
          ] as const
        ).map((vue) => (
          <button
            key={vue.id}
            type="button"
            role="tab"
            aria-selected={onglet === vue.id}
            className={cx(styles.onglet, onglet === vue.id && styles.ongletActif)}
            onClick={() => setOnglet(vue.id)}
          >
            <Icon name={vue.icon} size={12} strokeWidth={2} />
            {vue.label}
          </button>
        ))}
      </div>

      <div className={styles.corps}>
        {onglet === 'champs' && (
          <dl className={styles.champs}>
            {columns.map((colonne, index) => {
              const valeur = valeurRelue(
                ligne[index] ?? { kind: 'null' as const },
                lectures[colonne.name],
              )
              // Deux formes de la même valeur : l'une pour l'œil — `NULL` y est teinté — l'autre pour
              // l'aperçu et le presse-papiers. `texteDeValeur` est la source des deux (voir `cellule`).
              const texte = texteDeValeur(valeur)
              // **Ni `<dt>` ni `<dd>` ne sont des contrôles**, et biome ne s'en plaint pas : la règle
              // `noStaticElementInteractions` épargne les éléments qui portent déjà un rôle implicite
              // de terme et de définition. Le choix reste à justifier : le survol et le clic droit
              // **ajoutent** des chemins vers la donnée, ils n'en sont pas le seul. L'onglet JSON la
              // montre en entier et « Copier la ligne en INSERT » la copie, tous deux au clavier —
              // là où rendre chaque champ focalisable ajouterait dix-huit arrêts de tabulation dans
              // un panneau qui en a trois.
              return (
                <div key={colonne.name} className={styles.champ}>
                  {/* **Survol et clic droit sont portés par chaque partie, pas par la ligne.** Une clé
                      coupée révèle la clé, une valeur coupée révèle la valeur ; le clic droit copie
                      ce sur quoi il tombe. Survoler `external_ref` pour lire le nom de la colonne et
                      recevoir sa valeur serait répondre à côté — et un menu unique posé sur la ligne
                      aurait forcé à choisir laquelle des deux données il copie. */}
                  <dt
                    className={styles.etiquette}
                    /* **La coupure se mesure sur le nom, pas sur la ligne de clé** (`API-49`).
                       Celle-ci porte un glyphe de type et une icône de clé, qui ne se coupent pas :
                       mesurer son propre débordement dirait qu'un nom tient alors qu'il est rogné —
                       ou l'inverse. `armer` posé sur elle n'aurait plus jamais rien révélé, un
                       aperçu qui cesse de paraître sans que rien n'échoue : la famille du `var()`
                       mort. */
                    onMouseEnter={(evenement) => {
                      const nom = evenement.currentTarget.querySelector('[data-nom]')
                      if (nom instanceof HTMLElement) armer(nom, colonne.name)
                    }}
                    onMouseLeave={desarmer}
                    onContextMenu={(evenement) =>
                      ouvrirLeMenu(
                        evenement,
                        t('tableView.rowPanel.theKey'),
                        colonne.name,
                        colonne.name,
                      )
                    }
                  >
                    {/* **Un glyphe de type par clé** (`API-49`), à largeur fixe pour que les noms
                        s'alignent — c'est la marque de la section « Colonnes de » de la sidebar, et
                        `glypheDeType` est le seul endroit qui la décide. `aria-hidden` : « # » n'a
                        rien à dire à une voix, et il entrerait dans le terme sans une espace
                        (piège n° 1). */}
                    <span className={styles.marque} aria-hidden="true">
                      {glypheDeType(colonne.category)}
                    </span>
                    <span className={styles.nom} data-nom="">
                      {colonne.name}
                    </span>
                    {colonne.key === 'primary' && (
                      <Icon name="key" size={11} strokeWidth={2} className={styles.cle} />
                    )}
                    {colonne.key === 'foreign' && (
                      <Icon name="fk" size={11} strokeWidth={2} className={styles.fk} />
                    )}
                  </dt>
                  <dd
                    className={styles.valeur}
                    onMouseEnter={(evenement) => armer(evenement.currentTarget, texte)}
                    onMouseLeave={desarmer}
                    onContextMenu={(evenement) =>
                      ouvrirLeMenu(evenement, t('tableView.rowPanel.theValue'), colonne.name, texte)
                    }
                  >
                    {rendreValeur(valeur)}
                  </dd>
                </div>
              )
            })}
          </dl>
        )}

        {/* **Les liens ont leur propre section, sous les champs** (`API-49`, second tour, à la
            demande). Ils vivaient d'abord sur la ligne de clé de leur colonne, ce qui répondait à
            « où mène ce champ » sans jamais laisser lire le schéma d'un coup : une ligne de clé
            portait alors trois natures de chose — un type, une identité, une destination — et le
            nom de la colonne, qui est ce qu'on cherche, s'y trouvait au milieu. Deux sections
            disent deux questions.

            **Chaque ligne renomme donc sa colonne**, puisqu'elle n'est plus à côté d'elle : c'est
            ce que l'onglet « Liens » écrivait déjà, et sans ce nom la section serait une liste de
            destinations sans départ.

            **Rien quand il n'y a rien.** Une section vide, ou une phrase « aucune clé étrangère »,
            occuperait de la place pour dire ce que son absence dit déjà — c'est la raison qui a fait
            partir la phrase « Sélectionnez une ligne » de ce même panneau. */}
        {onglet === 'champs' && liens.length > 0 && (
          <section className={styles.liens}>
            <h3 className={styles.liensTitre}>{t('tableView.rowPanel.linksTitle')}</h3>
            {liens.map((lien) => (
              <div
                key={lien.constraintName}
                className={cx(styles.lien, lien.direction === 'incoming' && styles.lienEntrant)}
                /* Le `title` porte le lien en entier : l'ellipse coupe, et rien d'autre ici ne
                   rendrait ce qu'elle a coupé — l'aperçu du survol prolongé appartient à la donnée
                   de la ligne, pas au schéma. */
                title={libelleDuLien(lien)}
              >
                <Icon name="fk" size={11} strokeWidth={2} className={styles.lienIcone} />
                <span className={styles.lienDepart}>{lien.columns.join(', ')}</span>
                {/* La flèche est **retirée de l'arbre d'accessibilité**, un verbe masqué la
                    remplaçant avec ses espaces : une voix qui rendrait « user_id → users.id » ne
                    dirait plus laquelle référence l'autre (pièges n° 1 et n° 2, la leçon du
                    diagramme). */}
                <span aria-hidden="true">{lien.direction === 'outgoing' ? '→' : '←'}</span>
                <span className={styles.pourLaVoix}>
                  {t(
                    lien.direction === 'outgoing'
                      ? 'tableView.rowPanel.references'
                      : 'tableView.rowPanel.referencedBy',
                  )}
                </span>
                <span className={styles.lienCible}>{cibleDuLien(lien)}</span>
              </div>
            ))}
          </section>
        )}

        {onglet === 'json' && (
          <div className={styles.json}>
            {/* **Une icône seule, posée sur le JSON.** Le bouton du DDL porte son libellé « Copier »
                dans une barre qui lui est propre ; ici il n'y a pas de barre — le JSON occupe tout
                l'onglet — et en ajouter une prendrait 34 px des 296 de la colonne pour un mot. Le nom
                accessible, lui, est complet : une icône ne s'annonce pas. */}
            <button
              type="button"
              className={styles.copierJson}
              aria-label={t('tableView.rowPanel.copyJson')}
              title={t('tableView.rowPanel.copyJson')}
              onClick={() => void navigator.clipboard?.writeText(documentJson(columns, ligne))}
            >
              <Icon name="copy" size={12} strokeWidth={2.2} />
            </button>
            <JsonColore texte={documentJson(columns, ligne)} />
          </div>
        )}

        {/* **La règle du handoff, appliquée telle qu'elle est écrite.** L'aperçu n'apparaît que si
            la table cible porte un champ de la liste blanche ; sinon, rien — pas de dump
            d'identifiants techniques. La légende nomme les champs réellement détectés. */}
        {onglet === 'champs' && apercu && (
          <section className={styles.liee}>
            <h3 className={styles.lieeTitre}>
              {t('tableView.rowPanel.linkedRow', { table: apercu.table })}
              <span className={styles.detectes}>
                {' '}
                {t('tableView.rowPanel.detectedFields', {
                  champs: apercu.champs.map((c) => c.name).join(', '),
                  count: apercu.champs.length,
                })}
              </span>
            </h3>
            <div className={styles.lieeCorps}>
              {apercu.champs.map((champ) => (
                <div key={champ.name}>
                  <span className={styles.lieeNom}>{champ.name} </span>
                  {champ.value}
                </div>
              ))}
            </div>
          </section>
        )}

        {onCopyInsert && (
          <button type="button" className={styles.copier} onClick={onCopyInsert}>
            <Icon name="copy" size={12} strokeWidth={2} />
            {t('tableView.rowPanel.copyAsInsert')}
          </button>
        )}
      </div>

      {/* **Rendus en fin de panneau, pas dans le champ.** Tous deux sont en `position: fixed` : les
          poser dans la liste les ferait rogner par le corps qui défile — défaut n° 35. */}
      {revelation && onglet === 'champs' && (
        <div className={styles.apercu} style={{ top: revelation.haut, left: revelation.gauche }}>
          {revelation.texte}
        </div>
      )}
      {menu && (
        <MenuContextuel
          x={menu.x}
          y={menu.y}
          label={t('tableView.rowPanel.contextMenuLabel', {
            what: menu.quoi,
            column: menu.colonne,
          })}
          entrees={[
            {
              // Le libellé nomme **ce qui sera copié**, pas l'endroit du clic : « Copier la clé » sur
              // le nom de colonne, « Copier la valeur » sur la donnée. Un libellé unique obligerait à
              // se souvenir de ce qu'on visait.
              libelle: t('tableView.rowPanel.copyWhat', { what: menu.quoi }),
              // Le texte **tel qu'il est rendu**, donc tel qu'on le lit. Copier la représentation
              // brute donnerait une chaîne vide là où l'écran affiche « NULL ».
              onClick: () => void navigator.clipboard?.writeText(menu.texte),
            },
          ]}
          onFermer={() => setMenu(null)}
        />
      )}
    </aside>
  )
}

/**
 * Les liens de la table, **dans l'ordre des champs qui les portent**.
 *
 * Les deux sections se lisent l'une sous l'autre : ranger les liens dans l'ordre du catalogue leur
 * donne le même ordre que la liste au-dessus, donc on retrouve un champ à la même place dans les
 * deux. L'ordre que le moteur rend, lui, groupe les sortantes puis les entrantes — vrai de la
 * contrainte, sans rapport avec ce qu'on lit.
 *
 * `Relation.columns` porte toujours les colonnes de *cette* table — celles qui référencent pour une
 * sortante, celles qui sont référencées pour une entrante —, donc la même clé de tri répond aux
 * deux. Et comme `columns` est le catalogue entier de la table, aucun lien ne se retrouve sans
 * rang : c'est ce qui autorise à retirer l'onglet « Liens » sans rien taire (`API-49`).
 *
 * **Le tri est stable**, donc deux liens partant de la même colonne gardent l'ordre du moteur — la
 * seule chose qui les sépare, et elle est déterministe.
 */
function liensOrdonnes(
  relations: readonly Relation[],
  columns: readonly ColumnInfo[],
): readonly Relation[] {
  const rang = (relation: Relation) => {
    const places = relation.columns.map((nom) => columns.findIndex((c) => c.name === nom))
    // Une colonne absente du catalogue rendrait `-1` et passerait devant tout : elle va à la fin.
    const connues = places.filter((place) => place >= 0)
    return connues.length === 0 ? columns.length : Math.min(...connues)
  }
  return [...relations].sort((a, b) => rang(a) - rang(b))
}

/** L'autre bout d'un lien : la table et les colonnes qu'il désigne. */
function cibleDuLien(relation: Relation): string {
  return `${relation.targetTable}.${relation.targetColumns.join(', ')}`
}

/** Le lien en entier, pour l'infobulle qui rend ce que l'ellipse a coupé. */
function libelleDuLien(relation: Relation): string {
  const fleche = relation.direction === 'outgoing' ? '→' : '←'
  return `${relation.columns.join(', ')} ${fleche} ${cibleDuLien(relation)}`
}
