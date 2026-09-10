import type { InstanceExtension } from '../../../domain/instances'
import { useT } from '../../../i18n/LanguageContext'
import type { Column } from '../../../ui/DataTable/DataTable'
import { DataTable } from '../../../ui/DataTable/DataTable'
import { ABSENT } from '../../../ui/format'
import { permis, raisonDuRefus } from '../instances'
import { ActionsCell, LARGEUR_ACTIONS } from './ActionsCell'
import { correspond, type PropsDeSection } from './communes'
import styles from './ExtensionsSection.module.css'

/**
 * Les extensions de la **base de service** (`API-32`).
 *
 * # La portée est dite, pas tue
 *
 * `pg_extension` est un catalogue **par base** : une extension installée dans `analytics` ne paraît
 * pas dans `postgres`. Les lire toutes demanderait une connexion par base — une poignée de main, un
 * tunnel, et un refus pour chaque base où le rôle n'a pas `CONNECT`, sur une section qu'on ouvre en
 * passant.
 *
 * La lecture porte donc sur la base de service, et **une phrase le dit**. C'est l'honnêteté des deux
 * nombres de la barre d'état du diagramme, sur une autre affirmation : une section « Extensions »
 * qui tairait sa portée se lirait comme la liste des extensions du serveur, ce qu'elle n'est pas.
 *
 * # Les disponibles sont listées avec les installées
 *
 * Une section qui ne montrerait que les installées ne dirait pas ce qu'on peut ajouter — et l'action
 * principale de la barre n'aurait rien à proposer. Les non installées portent le tiret dans la
 * colonne « installée », et leur seul geste est de l'installer.
 */
export function ExtensionsSection({
  extensions,
  filtre,
  capacites,
  onDemander,
}: { extensions: readonly InstanceExtension[] } & PropsDeSection) {
  const t = useT()
  const lignes = extensions.filter((extension) => correspond(filtre, extension.name))
  const base = extensions[0]?.database

  const colonnes: Column<InstanceExtension>[] = [
    {
      key: 'actions',
      header: t('instances.columns.actions'),
      width: LARGEUR_ACTIONS,
      cell: (extension) =>
        extension.installedVersion === null ? (
          <ActionsCell
            actions={[
              {
                icon: 'plus',
                label: t('instances.actions.installExtension', { extension: extension.name }),
                ...(permis(capacites, 'createExtension')
                  ? {
                      onClick: () => onDemander({ kind: 'createExtension', name: extension.name }),
                    }
                  : { reason: raisonDuRefus(capacites, 'createExtension') }),
              },
            ]}
          />
        ) : (
          <ActionsCell
            actions={[
              {
                icon: 'trash',
                label: t('instances.actions.dropExtension', { extension: extension.name }),
                ...(permis(capacites, 'dropExtension')
                  ? { onClick: () => onDemander({ kind: 'dropExtension', name: extension.name }) }
                  : { reason: raisonDuRefus(capacites, 'dropExtension') }),
              },
            ]}
          />
        ),
    },
    {
      key: 'name',
      header: t('instances.columns.extension'),
      ui: true,
      cell: (extension) => extension.name,
    },
    {
      key: 'installed',
      header: t('instances.columns.installed'),
      cell: (extension) => extension.installedVersion ?? ABSENT,
    },
    {
      key: 'available',
      header: t('instances.columns.available'),
      cell: (extension) => extension.defaultVersion ?? ABSENT,
    },
    {
      key: 'database',
      header: t('instances.columns.database'),
      cell: (extension) => extension.database,
    },
    {
      key: 'schema',
      header: t('instances.columns.schema'),
      cell: (extension) => extension.schema ?? ABSENT,
    },
  ]

  return (
    <div className={styles.root}>
      {base !== undefined && (
        <p className={styles.portee}>{t('instances.rows.scope', { database: base })}</p>
      )}
      <DataTable
        label={t('instances.tables.extensions')}
        columns={colonnes}
        rows={lignes}
        rowId={(extension) => extension.name}
        empty={t('instances.state.empty')}
      />
    </div>
  )
}
