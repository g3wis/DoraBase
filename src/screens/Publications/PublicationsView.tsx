import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../design/icons/Icon'
import type { DatabaseKey } from '../../domain/arbre'
import type { ConnectionState, PublicationInfo } from '../../domain/engine'
import { useT } from '../../i18n/LanguageContext'
import { Button } from '../../ui/Button/Button'
import type { Column } from '../../ui/DataTable/DataTable'
import { DataTable } from '../../ui/DataTable/DataTable'
import { ABSENT } from '../../ui/format'
import { ageLisible } from '../Instances/instances'
// **Le même lecteur d'erreur que le gestionnaire de schémas**, et non une neuvième copie : la commande
// rend un `EngineError` comme `list_schemas`, et une panique de commande rend une chaîne.
import { messageDe } from '../SchemaManager/SchemaManager'
import styles from './PublicationsView.module.css'
import type { PasserellePublications } from './publicationsCommands'

/** Ce que la lecture a rendu. Trois phases, comme une section du gestionnaire d'instances. */
type Lecture =
  | { phase: 'chargement' }
  | { phase: 'prete'; publications: readonly PublicationInfo[]; releve: number }
  | { phase: 'echouee'; message: string }

export type PublicationsViewProps = {
  cle: DatabaseKey
  /** L'état de la connexion de la base — la lecture attend qu'elle soit ouverte. */
  etat: ConnectionState
  passerelle: PasserellePublications
  /** Ouvre la connexion : le bouton d'un état fermé ou injoignable l'appelle. */
  onOuvrir: () => void
  /** `Date.now`, injectable : l'âge du relevé est ce que le décor doit pouvoir figer. */
  maintenant?: () => number
}

/**
 * Les publications de réplication logique d'une base PostgreSQL (#195), **en lecture seule**.
 *
 * # Un onglet, sur le patron du gestionnaire d'instances
 *
 * Tranché à l'entretien du ticket : une entrée du menu « … » de la base de données ouvre un onglet,
 * comme le diagramme d'un schéma. **Aucune maquette n'existe**, donc rien n'est dessiné ici : la
 * barre d'outils est celle d'une section d'instance — bouton de relecture, âge du relevé —, le
 * tableau est `DataTable`, et les mots des états sont ceux de l'instance, rapportés à une base.
 *
 * # Ce que la vue montre, et ce qu'elle tait délibérément
 *
 * Chaque publication telle qu'elle se déclare : nom, propriétaire, portée, opérations publiées, et
 * publication via la racine de partition. **Pas ses tables ni ses schémas** : hors du périmètre du
 * ticket. La colonne « tables » dit donc la *forme* — toutes, ou désignées une à une — sans
 * prétendre les lister.
 *
 * # Le rafraîchissement est à la demande, et l'âge du relevé est dit
 *
 * Aucun minuteur, pour la raison du gestionnaire d'instances : un tableau qui bouge sous les yeux
 * et un serveur interrogé sans que personne regarde. « Pas encore relevé » n'est pas « à jour ».
 */
export function PublicationsView({
  cle,
  etat,
  passerelle,
  onOuvrir,
  maintenant = Date.now,
}: PublicationsViewProps) {
  const t = useT()
  const [lecture, setLecture] = useState<Lecture | null>(null)
  const ouverte = etat.kind === 'connected'

  /**
   * « Déjà demandé », **dans une ref et non dans `lecture`** — la raison d'`InstanceView` : une
   * fonction qui lirait l'état changerait d'identité à chaque réponse, et l'effet qui l'appelle
   * relancerait la lecture en boucle.
   */
  const demandee = useRef(false)

  const lire = useCallback(
    async (forcer = false) => {
      if (!ouverte) return
      if (!forcer && demandee.current) return
      demandee.current = true
      setLecture({ phase: 'chargement' })
      try {
        const publications = await passerelle.listPublications(cle)
        setLecture({ phase: 'prete', publications, releve: maintenant() })
      } catch (cause) {
        setLecture({ phase: 'echouee', message: messageDe(cause) })
      }
    },
    [cle, maintenant, ouverte, passerelle],
  )

  // **Une connexion qui se ferme oublie ce qui a été demandé** : sans cela, une lecture échouée
  // pendant la coupure resterait affichée après la réouverture, rien ne venant la relire.
  useEffect(() => {
    if (!ouverte) demandee.current = false
  }, [ouverte])

  useEffect(() => {
    void lire()
  }, [lire])

  const age = lecture?.phase === 'prete' ? ageLisible(lecture.releve, maintenant()) : null

  const colonnes: Column<PublicationInfo>[] = [
    {
      key: 'name',
      header: t('publications.columns.name'),
      ui: true,
      cell: (publication) => publication.name,
    },
    {
      key: 'owner',
      header: t('publications.columns.owner'),
      cell: (publication) => publication.owner,
    },
    {
      key: 'tables',
      header: t('publications.columns.tables'),
      cell: (publication) =>
        publication.allTables ? t('publications.scope.all') : t('publications.scope.listed'),
    },
    {
      key: 'operations',
      header: t('publications.columns.operations'),
      cell: (publication) => {
        const mots = operationsDe(publication)
        return mots.length === 0 ? t('publications.noOperation') : mots.join(' ')
      },
    },
    {
      key: 'viaRoot',
      header: t('publications.columns.viaRoot'),
      cell: (publication) =>
        publication.viaRoot === null ? (
          <span title={t('publications.viaRootUnknown')}>{ABSENT}</span>
        ) : publication.viaRoot ? (
          t('publications.yes')
        ) : (
          t('publications.no')
        ),
    },
  ]

  return (
    <div className={styles.root}>
      <div className={styles.barre}>
        <Button
          size="sm"
          variant="secondary"
          disabled={!ouverte || lecture?.phase === 'chargement'}
          onClick={() => void lire(true)}
        >
          <Icon name="refresh" size={12} strokeWidth={1.8} />
          {t('publications.toolbar.refresh')}
        </Button>
        {/* **L'âge du relevé, en toutes lettres** — ce qui remplace un rafraîchissement périodique. */}
        <span className={styles.releve}>
          {age === null
            ? t('publications.toolbar.neverMeasured')
            : t('publications.toolbar.measured', { age })}
        </span>
        {lecture?.phase === 'prete' && (
          <span className={styles.compte}>
            {t('publications.count', { count: lecture.publications.length })}
          </span>
        )}
      </div>

      <div className={styles.contenu}>
        {!ouverte ? (
          <div className={styles.etat}>
            <p
              className={styles.message}
              data-selectionnable={etat.kind === 'offline' ? true : undefined}
            >
              {etat.kind === 'connecting'
                ? t('publications.state.connecting')
                : etat.kind === 'offline'
                  ? t('publications.state.offline', { reason: etat.reason })
                  : t('publications.state.never')}
            </p>
            {etat.kind !== 'connecting' && (
              <Button size="sm" variant="secondary" onClick={onOuvrir}>
                {t('publications.state.open')}
              </Button>
            )}
          </div>
        ) : lecture === null || lecture.phase === 'chargement' ? (
          <p className={styles.message}>{t('publications.state.loading')}</p>
        ) : lecture.phase === 'echouee' ? (
          <p className={styles.message} role="alert">
            {t('publications.state.failed', { reason: lecture.message })}
          </p>
        ) : (
          <DataTable
            label={t('publications.table')}
            columns={colonnes}
            rows={lecture.publications}
            rowId={(publication) => publication.name}
            empty={t('publications.state.empty')}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Les opérations qu'une publication publie, **dans les mots de PostgreSQL** et dans l'ordre de son
 * option `publish` : c'est ce qu'on écrit pour les régler, et ce qu'on reconnaît en les relisant.
 *
 * `truncate` à `null` — un serveur antérieur à PostgreSQL 11 — n'est simplement pas listé : un tel
 * serveur ne publie pas de `truncate`, donc le taire est exact, et un tiret dans une liste de mots
 * ne voudrait rien dire.
 */
export function operationsDe(publication: PublicationInfo): string[] {
  const mots: string[] = []
  if (publication.insert) mots.push('insert')
  if (publication.update) mots.push('update')
  if (publication.delete) mots.push('delete')
  if (publication.truncate === true) mots.push('truncate')
  return mots
}
