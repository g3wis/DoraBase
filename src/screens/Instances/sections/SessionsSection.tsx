import type { InstanceSession } from '../../../domain/instances'
import { useT } from '../../../i18n/LanguageContext'
import { Badge } from '../../../ui/Badge/Badge'
import type { Column } from '../../../ui/DataTable/DataTable'
import { DataTable } from '../../../ui/DataTable/DataTable'
import { ABSENT } from '../../../ui/format'
import { dureeLisible, permis, raisonDuRefus } from '../instances'
import { ActionsCell, LARGEUR_ACTIONS } from './ActionsCell'
import { correspond, type PropsDeSection } from './communes'

/**
 * Les sessions ouvertes (`API-32`).
 *
 * # Sa propre session ne se termine pas
 *
 * C'est le refus qui compte ici, et il n'est pas une question de droit : `pg_terminate_backend` sur
 * son propre backend **réussit**, et referme la connexion de cet écran — après quoi la lecture
 * suivante répond « aucune connexion ouverte » et l'instance paraît tombée. Le cœur marque la ligne
 * (`isSelf`), l'écran désactive l'entrée *avec sa raison*.
 *
 * Le comparer ici, en confrontant des PID, aurait demandé que le front connaisse le nôtre — donc une
 * seconde vérité, sur la seule question dont la réponse fausse ferme l'écran.
 */
export function SessionsSection({
  sessions,
  filtre,
  capacites,
  onDemander,
}: { sessions: readonly InstanceSession[] } & PropsDeSection) {
  const t = useT()
  const lignes = sessions.filter((session) =>
    correspond(
      filtre,
      session.user,
      session.database,
      session.client,
      session.process,
      session.state,
    ),
  )

  const colonnes: Column<InstanceSession>[] = [
    {
      key: 'actions',
      header: t('instances.columns.actions'),
      width: LARGEUR_ACTIONS,
      cell: (session) => (
        <ActionsCell
          actions={[
            {
              icon: 'x',
              label: t('instances.actions.terminateSession', { pid: session.pid }),
              ...(session.isSelf
                ? { reason: t('instances.actions.ownSession') }
                : permis(capacites, 'terminateSession')
                  ? { onClick: () => onDemander({ kind: 'terminateSession', session }) }
                  : { reason: raisonDuRefus(capacites, 'terminateSession') }),
            },
          ]}
        />
      ),
    },
    {
      key: 'pid',
      header: t('instances.columns.pid'),
      numeric: true,
      cell: (session) => (
        <>
          {session.pid}
          {session.isSelf && (
            <>
              {' '}
              <Badge tone="violet" size="xs">
                {t('instances.rows.self')}
              </Badge>
            </>
          )}
        </>
      ),
    },
    {
      key: 'user',
      header: t('instances.columns.user'),
      ui: true,
      // Un processus interne du serveur — l'autovacuum, le writer — n'a pas de rôle : le tiret le
      // dit, là où une cellule vide se lirait comme une donnée manquante.
      cell: (session) => session.user ?? ABSENT,
    },
    {
      key: 'database',
      header: t('instances.columns.database'),
      cell: (session) => session.database ?? ABSENT,
    },
    { key: 'client', header: t('instances.columns.client'), cell: (session) => session.client },
    {
      key: 'process',
      header: t('instances.columns.process'),
      /* **Ce que le client déclare, ou le type du processus interne** — jamais le processus système
         qui s'est connecté, que le serveur ne peut pas connaître : le PID est celui du backend, et
         le client tourne le plus souvent ailleurs. Voir `InstanceSession::process`. */
      cell: (session) => session.process ?? ABSENT,
    },
    {
      key: 'state',
      header: t('instances.columns.state'),
      cell: (session) => session.state ?? ABSENT,
    },
    {
      key: 'duration',
      header: t('instances.columns.duration'),
      numeric: true,
      cell: (session) => dureeLisible(session.durationSeconds),
    },
  ]

  return (
    <DataTable
      label={t('instances.tables.sessions')}
      columns={colonnes}
      rows={lignes}
      rowId={(session) => String(session.pid)}
      empty={t('instances.state.empty')}
    />
  )
}
