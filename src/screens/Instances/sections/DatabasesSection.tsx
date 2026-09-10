import type { InstanceDatabase } from '../../../domain/instances'
import { useT } from '../../../i18n/LanguageContext'
import { Badge } from '../../../ui/Badge/Badge'
import type { Column } from '../../../ui/DataTable/DataTable'
import { DataTable } from '../../../ui/DataTable/DataTable'
import { ABSENT, formatBytes, formatInteger } from '../../../ui/format'
import { permis, raisonDuRefus } from '../instances'
import { ActionsCell, LARGEUR_ACTIONS } from './ActionsCell'
import { correspond, type PropsDeSection } from './communes'

/**
 * Les bases de l'instance (`API-32`).
 *
 * # Deux refus portés par la ligne, non par le compte
 *
 * Une base **modèle** ne se supprime pas — `template0` et `template1` sont ce à partir de quoi
 * PostgreSQL crée les autres, et le serveur refuse leur suppression. L'entrée est donc désactivée
 * *avec sa raison*, comme la dernière colonne visible d'une grille : la griser sans le dire ferait
 * chercher un droit manquant là où c'est la base qui n'est pas supprimable.
 */
export function DatabasesSection({
  databases,
  filtre,
  capacites,
  onDemander,
}: { databases: readonly InstanceDatabase[] } & PropsDeSection) {
  const t = useT()
  const lignes = databases.filter((base) => correspond(filtre, base.name, base.owner))

  const colonnes: Column<InstanceDatabase>[] = [
    {
      key: 'actions',
      header: t('instances.columns.actions'),
      width: LARGEUR_ACTIONS,
      cell: (base) => (
        <ActionsCell
          actions={[
            {
              icon: 'pencil',
              label: t('instances.actions.editDatabase', { database: base.name }),
              ...(permis(capacites, 'alterDatabase')
                ? { onClick: () => onDemander({ kind: 'editDatabase', database: base }) }
                : { reason: raisonDuRefus(capacites, 'alterDatabase') }),
            },
            {
              icon: 'trash',
              label: t('instances.actions.dropDatabase', { database: base.name }),
              ...(base.isTemplate
                ? { reason: t('instances.actions.templateDatabase') }
                : permis(capacites, 'dropDatabase')
                  ? { onClick: () => onDemander({ kind: 'dropDatabase', database: base }) }
                  : { reason: raisonDuRefus(capacites, 'dropDatabase') }),
            },
          ]}
        />
      ),
    },
    {
      key: 'name',
      header: t('instances.columns.database'),
      ui: true,
      cell: (base) => (
        <>
          {base.name}
          {base.isTemplate && (
            <>
              {' '}
              <Badge tone="muted" size="xs">
                {t('instances.rows.template')}
              </Badge>
            </>
          )}
          {/* Une base qui refuse les connexions se dit : sinon on cherche pourquoi la console
              répond « database is not currently accepting connections ». */}
          {!base.allowConnections && (
            <>
              {' '}
              <Badge tone="warn" size="xs">
                {t('instances.rows.noConnections')}
              </Badge>
            </>
          )}
        </>
      ),
    },
    { key: 'owner', header: t('instances.columns.owner'), cell: (base) => base.owner },
    { key: 'encoding', header: t('instances.columns.encoding'), cell: (base) => base.encoding },
    { key: 'collation', header: t('instances.columns.collation'), cell: (base) => base.collation },
    {
      key: 'size',
      header: t('instances.columns.size'),
      numeric: true,
      // Le tiret, jamais zéro : « 0 B » dirait que la base est vide là où le rôle n'a simplement
      // pas le droit de la mesurer.
      cell: (base) => (base.sizeBytes === null ? ABSENT : formatBytes(base.sizeBytes)),
    },
    {
      key: 'connections',
      header: t('instances.columns.connections'),
      numeric: true,
      cell: (base) => formatInteger(base.connections),
    },
  ]

  return (
    <DataTable
      label={t('instances.tables.databases')}
      columns={colonnes}
      rows={lignes}
      rowId={(base) => base.name}
      empty={t('instances.state.empty')}
    />
  )
}
