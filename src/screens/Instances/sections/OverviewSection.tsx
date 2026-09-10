import type { ManagedInstance } from '../../../domain/config'
import type { InstanceOverview } from '../../../domain/instances'
import { useT } from '../../../i18n/LanguageContext'
import { formatBytes, formatInteger } from '../../../ui/format'
import { StatTile } from '../../../ui/StatTile/StatTile'
import { dureeLisible } from '../instances'
import styles from './OverviewSection.module.css'

/**
 * La vue d'ensemble d'une instance (`API-32`) : six tuiles, l'identité de la connexion, et les
 * gestes que ce compte a le droit de faire.
 *
 * # Pourquoi la liste des gestes est ici et pas ailleurs
 *
 * C'est la réponse à « qu'est-ce que je peux faire depuis cet écran ? », et elle doit être lisible
 * **avant** d'essayer. Les six autres sections désactivent chacune ses boutons avec leur raison,
 * mais il faut y aller pour le découvrir : cette liste la donne d'un coup d'œil, à l'endroit où l'on
 * arrive.
 */
export function OverviewSection({
  overview,
  instance,
}: {
  overview: InstanceOverview
  instance: ManagedInstance
}) {
  const t = useT()

  return (
    <div className={styles.root}>
      <div className={styles.tuiles}>
        <StatTile label={t('instances.overview.version')} value={overview.serverVersion} />
        <StatTile
          label={t('instances.overview.uptime')}
          value={dureeLisible(overview.uptimeSeconds)}
          {...(overview.uptimeSeconds === null
            ? { unknownHint: t('instances.overview.unknownUptime') }
            : {})}
        />
        <StatTile
          label={t('instances.overview.connections')}
          value={`${formatInteger(overview.connections)} / ${formatInteger(overview.maxConnections)}`}
        />
        <StatTile
          label={t('instances.overview.databases')}
          value={formatInteger(overview.databases)}
        />
        <StatTile label={t('instances.overview.roles')} value={formatInteger(overview.roles)} />
        {/* **Un tiret plutôt qu'une somme partielle** : une taille amputée passerait pour la taille
            de l'instance, et personne ne pourrait la recouper. L'infobulle dit pourquoi. */}
        <StatTile
          label={t('instances.overview.size')}
          value={overview.totalSizeBytes === null ? '—' : formatBytes(overview.totalSizeBytes)}
          {...(overview.totalSizeBytes === null
            ? { unknownHint: t('instances.overview.partialSize') }
            : {})}
        />
      </div>

      <section className={styles.bloc}>
        <h2 className={styles.titre}>{t('instances.overview.identity')}</h2>
        <dl className={styles.identite}>
          <Ligne libelle={t('instances.overview.host')}>
            {overview.identity.host}:{overview.identity.port}
          </Ligne>
          <Ligne libelle={t('instances.overview.role')}>{overview.identity.role}</Ligne>
          <Ligne libelle={t('instances.overview.database')}>{overview.identity.database}</Ligne>
          <Ligne libelle={t('instances.overview.secret')}>
            {overview.identity.secretLocation ?? t('instances.overview.noSecret')}
          </Ligne>
          {/* **Ce que la session *est*, non ce que le formulaire a demandé** : un `prefer` qui a
              replié en clair afficherait « chiffré » si l'on lisait le réglage. */}
          <Ligne libelle={t('instances.overview.tls')}>
            {overview.identity.tls
              ? (overview.identity.tlsCipher ?? 'TLS')
              : t('instances.overview.tlsOff')}
          </Ligne>
        </dl>
      </section>

      <section className={styles.bloc}>
        <h2 className={styles.titre}>{t('instances.overview.gestures')}</h2>
        <ul className={styles.gestes}>
          {overview.capabilities.map((capacite) => (
            <li
              key={capacite.gesture}
              className={capacite.allowed ? styles.permis : styles.refuse}
              /* La raison porte le `title` de la ligne refusée — c'est elle qui nomme l'attribut
                 qui manque, là où « refusé » n'apprendrait rien. */
              title={capacite.reason ?? undefined}
            >
              <span className={styles.verdict} aria-hidden="true">
                {capacite.allowed ? '✓' : '✕'}
              </span>
              {t(`instances.gestures.${capacite.gesture}`)}
              {/* Le verdict en texte masqué : une coche et une croix ne se distinguent pas à la
                  voix, et la couleur seule ne doit jamais porter une information. */}
              <span className={styles.masque}>
                {' '}
                {capacite.allowed
                  ? t('instances.overview.allowed')
                  : t('instances.overview.denied')}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Le libellé de l'instance, en pied : c'est le cadre de l'écran, pas une de ses données. */}
      <p className={styles.cadre}>{instance.label}</p>
    </div>
  )
}

function Ligne({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <>
      <dt className={styles.cle}>{libelle}</dt>
      <dd className={styles.valeur}>{children}</dd>
    </>
  )
}
