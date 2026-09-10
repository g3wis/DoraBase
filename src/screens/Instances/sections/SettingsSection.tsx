import type { InstanceSetting } from '../../../domain/instances'
import { useT } from '../../../i18n/LanguageContext'
import { Badge } from '../../../ui/Badge/Badge'
import type { Column } from '../../../ui/DataTable/DataTable'
import { DataTable } from '../../../ui/DataTable/DataTable'
import { ABSENT } from '../../../ui/format'
import { permis, raisonDuRefus } from '../instances'
import { ActionsCell, LARGEUR_ACTIONS } from './ActionsCell'
import { correspond, type PropsDeSection } from './communes'

/**
 * Les paramètres du serveur (`API-32`).
 *
 * # Un paramètre `internal` ne se règle pas, et l'entrée le dit
 *
 * `block_size`, `segment_size` : le serveur les calcule à la compilation, et `ALTER SYSTEM SET` y
 * échoue toujours. Le cœur les marque (`settable: false`), l'écran désactive *avec sa raison* — un
 * champ qui accepterait une valeur pour la voir refusée à chaque fois serait le défaut n° 36 avec un
 * aller-retour en plus.
 *
 * # Le redémarrage en attente est une colonne, pas un détail
 *
 * `pending_restart` dit qu'une valeur a été changée et n'a pas encore d'effet. Sans elle, régler un
 * paramètre de contexte « postmaster » paraîtrait sans effet — et l'on recommencerait.
 */
export function SettingsSection({
  settings,
  filtre,
  capacites,
  onDemander,
}: { settings: readonly InstanceSetting[] } & PropsDeSection) {
  const t = useT()
  const lignes = settings.filter((setting) =>
    correspond(filtre, setting.name, setting.value, setting.context, setting.source),
  )

  const colonnes: Column<InstanceSetting>[] = [
    {
      key: 'actions',
      header: t('instances.columns.actions'),
      width: LARGEUR_ACTIONS,
      cell: (setting) => (
        <ActionsCell
          actions={[
            {
              icon: 'pencil',
              label: t('instances.actions.setParameter', { parameter: setting.name }),
              ...(!setting.settable
                ? { reason: t('instances.actions.internalSetting') }
                : permis(capacites, 'setParameter')
                  ? { onClick: () => onDemander({ kind: 'setParameter', setting }) }
                  : { reason: raisonDuRefus(capacites, 'setParameter') }),
            },
            {
              icon: 'refresh',
              label: t('instances.actions.resetParameter', { parameter: setting.name }),
              ...(!setting.settable
                ? { reason: t('instances.actions.internalSetting') }
                : permis(capacites, 'setParameter')
                  ? { onClick: () => onDemander({ kind: 'resetParameter', name: setting.name }) }
                  : { reason: raisonDuRefus(capacites, 'setParameter') }),
            },
          ]}
        />
      ),
    },
    {
      key: 'name',
      header: t('instances.columns.parameter'),
      ui: true,
      cell: (setting) => setting.name,
    },
    { key: 'value', header: t('instances.columns.value'), cell: (setting) => setting.value },
    {
      key: 'unit',
      header: t('instances.columns.unit'),
      cell: (setting) => setting.unit ?? ABSENT,
    },
    { key: 'context', header: t('instances.columns.context'), cell: (setting) => setting.context },
    { key: 'source', header: t('instances.columns.source'), cell: (setting) => setting.source },
    {
      key: 'restart',
      header: t('instances.columns.restart'),
      cell: (setting) =>
        setting.pendingRestart ? (
          <Badge tone="warn" size="xs">
            {t('instances.rows.pendingRestart')}
          </Badge>
        ) : (
          ABSENT
        ),
    },
  ]

  return (
    <DataTable
      label={t('instances.tables.settings')}
      columns={colonnes}
      rows={lignes}
      rowId={(setting) => setting.name}
      empty={t('instances.state.empty')}
    />
  )
}
