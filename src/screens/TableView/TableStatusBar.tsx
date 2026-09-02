import { Icon } from '../../design/icons/Icon'
import type { RowWindow } from '../../domain/engine'
import { useT } from '../../i18n/LanguageContext'
import { cx } from '../../ui/cx'
import { formatInteger } from '../../ui/format'
import styles from './TableStatusBar.module.css'

type TableStatusBarProps = {
  fenetre: RowWindow | null
  loading: boolean
  error: string | null
  /**
   * Le nombre de modifications en attente (`11b`). Au-dessus de zéro, la barre passe en ambre et
   * dit ce qui attend plutôt que ce qui a été lu.
   */
  pendingChanges?: number
  /** Vrai quand l'onglet est en mode édition — le rappel `⌘E` change de sens. */
  editing?: boolean
}

/**
 * La barre d'état de 26 px : `500 lignes · 41 ms · limit 500`, puis « lecture seule ».
 *
 * **Elle ne porte plus l'annonce de mise à jour** (2 septembre 2026). Elle l'a portée à partir du
 * 26 août, parce que l'annonce ne vivait que dans `shell/StatusBar` — celle du seul écran d'accueil
 * — et disparaissait donc dès qu'un onglet s'ouvrait. Le remède d'alors était de la monter dans les
 * trois barres ; celui d'aujourd'hui est qu'elle n'en soit plus une ligne du tout, mais une
 * notification en bas à droite montée au niveau de l'application (`shell/AnnonceMiseAJour`). Le trou
 * que le montage en trois exemplaires laissait — un onglet de console n'a aucune barre au niveau de
 * l'écran — se referme du même coup.
 *
 * **Les chiffres viennent de `RowWindow`**, pas d'un recalcul : la durée est celle mesurée par le
 * moteur, et le compte est celui de la fenêtre reçue. Les recalculer côté front produirait des
 * valeurs *plausibles* qui cesseraient d'être vraies au premier écart.
 *
 * Elle vit au niveau de l'**écran**, pas du centre : le mockup la fait courir sous les trois
 * colonnes, sidebar et panneau droit compris.
 */
export function TableStatusBar({
  fenetre,
  loading,
  error,
  pendingChanges = 0,
  editing = false,
}: TableStatusBarProps) {
  const t = useT()
  // **La barre du mode édition dit autre chose**, et le mockup le montre : « 3 modifications en
  // attente · 0 envoyée · transaction non ouverte ». Le compte de lignes lu n'est plus l'information
  // qui compte quand quelque chose attend d'être écrit.
  if (pendingChanges > 0) {
    return (
      <div
        className={cx(styles.root, styles.edition)}
        role="status"
        aria-label={t('tableView.statusBar.ariaLabel')}
      >
        <span className={styles.attente}>
          {t('tableView.statusBar.pendingCount', { count: pendingChanges })}
        </span>
        <span>·</span>
        {/* « 0 envoyée » est **vrai et important** : c'est la promesse que rien n'est parti. Elle
            restera à zéro jusqu'à `11d`, qui écrit. */}
        <span>{t('tableView.statusBar.zeroSent')}</span>
        <span>·</span>
        <span>{t('tableView.statusBar.noTransaction')}</span>
        <span className={styles.espace} />
        <span>{t('tableView.statusBar.exitEditing')}</span>
      </div>
    )
  }

  return (
    <div className={styles.root} role="status" aria-label={t('tableView.statusBar.ariaLabel')}>
      {error ? (
        // Le message complet vit dans la grille, là où l'utilisateur cherche ses lignes ; la barre
        // ne porte que le verdict. L'écrire aux deux endroits ferait lire deux fois la même
        // phrase, et allongerait une barre de 26 px.
        <span className={styles.echec}>{t('tableView.statusBar.readFailed')}</span>
      ) : loading ? (
        <span>{t('tableView.statusBar.loading')}</span>
      ) : fenetre ? (
        <>
          <span className={styles.compte}>
            {t('tableView.statusBar.rowCount', {
              count: fenetre.rows.length,
              formatted: formatInteger(fenetre.rows.length),
            })}
          </span>
          <span>·</span>
          <span>{fenetre.durationMs} ms</span>
          <span>·</span>
          <span>limit {fenetre.rows.length === 0 ? '—' : limiteLue(fenetre.sql)}</span>
        </>
      ) : (
        <span>{t('tableView.statusBar.noRead')}</span>
      )}
      <span className={styles.espace} />
      {/* **Le rappel `⌘E` est enfin honoré.** `10c` l'avait retiré faute d'écran qui y réponde — un
          raccourci affiché qui ne répond pas est pire qu'un raccourci absent (`09e`). `11b` livre la
          bascule, donc il revient. */}
      <span className={styles.lecture}>
        <Icon name={editing ? 'pencil' : 'lock'} size={11} strokeWidth={2.2} />
        {editing ? t('tableView.statusBar.editingNoChange') : t('tableView.statusBar.readOnlyHint')}
      </span>
    </div>
  )
}

/** Le `limit` du SQL réellement exécuté — jamais une valeur reconstruite depuis l'état. */
function limiteLue(sql: string): string {
  return /limit\s+(\d+)/i.exec(sql)?.[1] ?? '—'
}
