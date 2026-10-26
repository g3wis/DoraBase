import { Icon } from '../../design/icons/Icon'
import type { IconName } from '../../design/icons/names'
import type { TableDetail } from '../../domain/engine'
import { useT } from '../../i18n/LanguageContext'
import { ABSENT, formatBytes, formatRowCount } from '../../ui/format'
import { StatTile } from '../../ui/StatTile/StatTile'
import { Tooltip } from '../../ui/Tooltip/Tooltip'
import styles from './DetailPanel.module.css'

type DetailPanelProps = {
  /** `null` quand aucune ligne n'est sélectionnée. */
  detail: TableDetail | null
  schema: string
  loading?: boolean
  error?: string | null
  pinned?: boolean
  onTogglePin?: () => void
  /**
   * Ouvre les données de l'objet — l'action que `09f` avait livrée désactivée.
   *
   * Absente, l'action reste désactivée avec son infobulle « Viendra avec A5 ». Fournie, elle
   * s'active et perd son infobulle : dire qu'un écran est à venir alors qu'il répond serait
   * pire que ne rien dire.
   */
  onOpenData?: () => void
}

/** Les cinq premières colonnes du catalogue, et le compte de celles qui restent. */
const APERCU = 5

/**
 * Les quatre actions du panneau, et **l'écran qui les apportera**.
 *
 * **Désactivées avec une infobulle, à l'inverse de `A1` et `08b`** — qui ont livré des boutons
 * présents et actifs mais sans effet, au motif qu'un bouton désactivé sans explication fait
 * croire à un bug. L'écart est assumé : à `A1` un seul bouton était inerte et son écran venait
 * dans la spec suivante ; ici quatre sur quatre le sont, et leurs écrans sont à trois specs de
 * distance. Un panneau dont tout est cliquable et rien ne répond est pire qu'un panneau qui dit
 * ce qui n'est pas encore là.
 *
 * `aria-disabled` et non `disabled` : un bouton désactivé ne reçoit ni focus ni survol, donc son
 * infobulle serait inatteignable — exactement là où elle est le plus utile.
 */
type Action = {
  key: string
  labelKey: string
  icon: IconName
  accent?: boolean
  /** Un code d'écran (`A5`) reste tel quel ; sinon, une clé du dictionnaire à traduire. */
  ecran: string
  ecranEstUneCle?: boolean
}

const ACTIONS: Action[] = [
  {
    key: 'open',
    labelKey: 'explorer.detailPanel.actions.openData',
    icon: 'table',
    accent: true,
    ecran: 'A5',
  },
  {
    key: 'structure',
    labelKey: 'explorer.detailPanel.actions.structure',
    icon: 'cols',
    ecran: 'A9',
  },
  {
    key: 'select',
    labelKey: 'explorer.detailPanel.actions.selectInConsole',
    icon: 'term',
    ecran: 'A7',
  },
  {
    key: 'export',
    labelKey: 'explorer.detailPanel.actions.exportCsv',
    icon: 'dl',
    ecran: 'explorer.detailPanel.actions.exportScreenName',
    ecranEstUneCle: true,
  },
]

/**
 * Le panneau de détail de `A4`, à droite.
 *
 * **Sans sélection, il le dit** plutôt que de laisser 300 px blancs — ou de sélectionner d'office
 * la première ligne, ce qui déclencherait une requête `table_detail` que l'utilisateur n'a pas
 * demandée.
 */
export function DetailPanel({
  detail,
  schema,
  loading = false,
  error = null,
  pinned = false,
  onTogglePin,
  onOpenData,
}: DetailPanelProps) {
  const t = useT()
  if (error)
    return (
      <aside className={styles.root}>
        <p data-selectionnable className={styles.vide}>
          {error}
        </p>
      </aside>
    )
  if (loading)
    return (
      <aside className={styles.root}>
        <p className={styles.vide}>{t('explorer.detailPanel.loading')}</p>
      </aside>
    )
  if (!detail)
    return (
      <aside className={styles.root} aria-label={t('explorer.detailPanel.ariaLabelEmpty')}>
        <p className={styles.vide}>{t('explorer.detailPanel.noSelection')}</p>
      </aside>
    )

  const colonnes = detail.columns.slice(0, APERCU)
  const restantes = detail.columns.length - colonnes.length

  return (
    <aside
      className={styles.root}
      aria-label={t('explorer.detailPanel.ariaLabel', { schema, name: detail.name })}
    >
      <header className={styles.header}>
        <span className={styles.title}>
          {schema}.{detail.name}
        </span>
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.pin}
          onClick={onTogglePin}
          aria-pressed={pinned}
          aria-label={pinned ? t('explorer.detailPanel.unpin') : t('explorer.detailPanel.pin')}
        >
          <Icon name="pin" size={13} strokeWidth={1.9} />
        </button>
      </header>

      <div className={styles.body}>
        <div className={styles.tiles}>
          {/* **Le compte de lignes est une estimation, la taille est exacte.** `RowCount` le dit
              au niveau du type (`06c`) : le drapeau se **dérive** au lieu d'être supposé. Les
              présenter à l'identique serait un mensonge de précision, que le handoff commet. */}
          <StatTile
            label={t('explorer.detailPanel.rows')}
            value={formatRowCount(detail.rows)}
            approximate={detail.rows.kind === 'estimated'}
            unknownHint={
              detail.rows.kind === 'unknown' ? t('explorer.detailPanel.rowsUnknownHint') : undefined
            }
          />
          <StatTile
            label={t('explorer.detailPanel.size')}
            value={detail.sizeBytes === null ? ABSENT : formatBytes(detail.sizeBytes)}
          />
        </div>

        <section className={styles.bloc}>
          <h3 className={styles.blocTitre}>
            {t('explorer.detailPanel.columnsTitle', { count: detail.columns.length })}
          </h3>
          <div className={styles.encadre}>
            {colonnes.map((colonne) => (
              <div key={colonne.name} className={styles.colonne}>
                <span className={styles.marque} aria-hidden="true">
                  {marqueDe(colonne)}
                </span>
                <span className={styles.colonneNom}>{colonne.name}</span>
                <span className={styles.colonneType}>{colonne.typeName}</span>
              </div>
            ))}
            {/* **Les cinq premières du catalogue**, et non « les cinq plus significatives » :
                c'est l'ordre que l'utilisateur connaît de sa table, et « significatif »
                demanderait une règle que personne n'a écrite. La liste complète appartient à
                `A9` (`14`), qui est faite pour ça. */}
            {restantes > 0 && (
              <div className={styles.colonne}>
                <span className={styles.reste}>
                  {t('explorer.detailPanel.moreColumns', { count: restantes })}
                </span>
              </div>
            )}
          </div>
        </section>

        <section className={styles.bloc}>
          <h3 className={styles.blocTitre}>{t('explorer.detailPanel.actionsTitle')}</h3>
          <div className={styles.actions}>
            {/* « Ouvrir les données » a son écran depuis `10b` : elle s'active dès qu'un
                gestionnaire est fourni, et perd l'infobulle qui annonçait `A5`. Les trois autres
                restent désactivées avec la leur — la règle de `09f` tient tant que l'écran nommé
                n'existe pas. */}
            {ACTIONS.map((action) => (
              <ActionDeDetail
                key={action.key}
                action={action}
                onActivate={action.key === 'open' ? onOpenData : undefined}
              />
            ))}
          </div>
        </section>

        <section className={styles.bloc}>
          <h3 className={styles.blocTitre}>{t('explorer.detailPanel.relationsTitle')}</h3>
          <div className={styles.encadre}>
            {detail.relations.length === 0 ? (
              <div className={styles.colonne}>
                <span className={styles.reste}>{t('explorer.detailPanel.noForeignKey')}</span>
              </div>
            ) : (
              detail.relations.map((relation) => (
                <div
                  key={relation.constraintName}
                  className={
                    relation.direction === 'incoming' ? styles.relationEntrante : styles.relation
                  }
                >
                  {/* **La direction n'est pas décorative.** `06c` la porte dans le type, et le
                      mockup grise sa troisième ligne : une relation *sortante* dit de quoi cette
                      table dépend, une *entrante* dit qui dépend d'elle. Les afficher pareil
                      ferait lire « orders → users » et « invoices → orders » comme deux faits de
                      même nature, alors que l'un se lit dans l'autre sens. */}
                  <Icon
                    name="fk"
                    size={12}
                    strokeWidth={2}
                    className={relation.direction === 'incoming' ? styles.fkEntrante : styles.fk}
                  />
                  {relation.direction === 'outgoing'
                    ? `${relation.columns.join(', ')} → ${relation.targetTable}.${relation.targetColumns.join(', ')}`
                    : `${relation.targetTable}.${relation.targetColumns.join(', ')} → ${relation.columns.join(', ')}`}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </aside>
  )
}

/**
 * Une action du panneau : active si elle a un gestionnaire, sinon désactivée sous l'infobulle
 * qui nomme l'écran attendu.
 *
 * Un composant plutôt qu'un ternaire dans la boucle : l'enveloppe `Tooltip` n'existe que dans un
 * cas sur deux, et l'alternance des deux formes rendait la clé de liste invisible au linter.
 */
function ActionDeDetail({
  action,
  onActivate,
}: {
  action: (typeof ACTIONS)[number]
  onActivate?: () => void
}) {
  const t = useT()
  const bouton = (
    <button
      type="button"
      className={action.accent ? styles.actionAccent : styles.action}
      aria-disabled={onActivate ? undefined : 'true'}
      onClick={onActivate}
    >
      <Icon name={action.icon} size={13} strokeWidth={2} />
      {t(action.labelKey)}
    </button>
  )
  if (onActivate) return bouton
  const ecran = action.ecranEstUneCle ? t(action.ecran) : action.ecran
  return <Tooltip label={t('explorer.detailPanel.comingWith', { ecran })}>{bouton}</Tooltip>
}

/**
 * La marque d'une colonne, en tête de ligne.
 *
 * Le mockup montre `#` pour un entier et `T` pour du texte, plus des icônes clé et FK. La
 * catégorie de `06c` porte déjà l'information — c'est elle qui décide du glyphe dans `A5` — donc
 * on la réemploie plutôt que d'analyser le nom du type.
 */
function marqueDe(colonne: TableDetail['columns'][number]): string {
  if (colonne.key === 'primary') return '⚿'
  if (colonne.key === 'foreign') return '↗'
  const glyphes: Record<string, string> = {
    number: '#',
    text: 'T',
    boolean: '☑',
    timestamp: '◷',
    json: '{}',
    uuid: 'ID',
    binary: '▤',
    other: '·',
  }
  return glyphes[colonne.category] ?? '·'
}
