import { useState } from 'react'
import type { TableSummary } from '../../domain/engine'
import { useT } from '../../i18n/LanguageContext'
import { type Column, DataTable } from '../../ui/DataTable/DataTable'
import { ABSENT, formatBytes, formatRowCount } from '../../ui/format'
import { MenuContextuel } from '../../ui/MenuContextuel/MenuContextuel'
import type { TypeObjet } from './BreadcrumbBar'

type ObjectTableProps = {
  schema: string
  objects: readonly TableSummary[]
  type: TypeObjet
  selectedName?: string | null
  onSelect: (objet: TableSummary) => void
  /** Ouvre l'objet dans un onglet — double-clic ou `Entrée`. Voir `10b`. */
  onOpen?: (objet: TableSummary) => void
  /** Vrai pendant le chargement des objets du schéma. */
  loading?: boolean
  /** Le message d'échec, quand le chargement a échoué. */
  error?: string | null
}

/**
 * Le tableau des objets d'un schéma : sept colonnes, ligne sélectionnable.
 *
 * **Les colonnes sans objet portent un tiret cadratin**, jamais zéro ni du vide. Un index n'a ni
 * « Lignes », ni « Clé primaire », ni « Dernier ANALYZE » — trois des sept colonnes — et le
 * mockup ne montre jamais le segment « Index » actif. « 0 ligne » sur un index serait un
 * mensonge ; du vide ressemblerait à une donnée manquante. Un jeu de colonnes propre à chaque
 * type serait la vraie réponse, et c'est du design : consigné au § « À trancher ».
 */
export function ObjectTable({
  schema,
  objects,
  type,
  selectedName = null,
  onSelect,
  onOpen,
  loading = false,
  error = null,
}: ObjectTableProps) {
  const t = useT()
  /**
   * La ligne visée par le clic droit, et où le menu s'ouvre (#162).
   *
   * **Le nom est capturé, pas l'objet** : le menu survit à un rechargement de `objects` — un
   * rafraîchissement de l'arbre pendant qu'il est ouvert —, et une référence gardée pointerait alors
   * sur une ligne qui n'est plus dans la liste. Ce qu'on copie est une chaîne ; c'est elle qu'on
   * garde.
   */
  const [menu, setMenu] = useState<{ x: number; y: number; nom: string } | null>(null)
  return (
    <>
      {menu !== null && (
        <MenuContextuel
          x={menu.x}
          y={menu.y}
          label={t('explorer.objectTable.actionsFor', { cible: menu.nom })}
          entrees={[
            {
              libelle: t('explorer.sidebar.menu.copyName'),
              icone: 'copy',
              // **Le même libellé que dans l'arbre**, et il vient du même endroit : c'est le même
              // geste sur le même objet, et deux chaînes pour une action auraient divergé à la
              // première reformulation. Muet, comme les autres copies du produit.
              onClick: () => void navigator.clipboard?.writeText(menu.nom),
            },
          ]}
          onFermer={() => setMenu(null)}
        />
      )}
      <DataTable
        label={t('explorer.objectTable.label', { schema })}
        columns={colonnes(t)}
        rows={objects}
        rowId={(objet) => objet.name}
        selectedId={selectedName}
        onSelect={onSelect}
        onOpen={onOpen}
        onContextMenu={(objet, evenement) =>
          setMenu({ x: evenement.clientX, y: evenement.clientY, nom: objet.name })
        }
        // **Vide, chargement et échec se distinguent, et aucun ne ressemble aux deux autres.** Le
        // handoff n'en maquette aucun des trois ; le minimum défendable est une ligne de texte,
        // sans illustration inventée.
        empty={<span>{messageVide(t, type, schema, loading, error)}</span>}
      />
    </>
  )
}

function messageVide(
  t: ReturnType<typeof useT>,
  type: TypeObjet,
  schema: string,
  loading: boolean,
  error: string | null,
): string {
  if (error) return error
  if (loading) return t('explorer.objectTable.loading')
  const cleQuoi = {
    tables: 'explorer.objectTable.kind.table',
    views: 'explorer.objectTable.kind.view',
    functions: 'explorer.objectTable.kind.function',
    indexes: 'explorer.objectTable.kind.index',
  }[type]
  // Un schéma sans table est normal — `public` d'une base neuve. Le dire, plutôt que de laisser
  // un tableau à zéro ligne qui ressemble à un chargement inachevé.
  return t('explorer.objectTable.empty', { schema, quoi: t(cleQuoi) })
}

/**
 * Les sept colonnes du mockup, avec leurs largeurs de `<colgroup>`.
 *
 * `ui: true` sur la seule colonne du nom : le mockup pose `td { font: 500 11.5px JetBrains
 * Mono }` pour toutes les cellules, et seule celle-là y échappe.
 */
function colonnes(t: ReturnType<typeof useT>): Column<TableSummary>[] {
  return [
    {
      key: 'name',
      header: t('explorer.objectTable.columns.name'),
      cell: (o) => o.name,
      ui: true,
      width: '210px',
    },
    {
      key: 'rows',
      header: t('explorer.objectTable.columns.rows'),
      // `RowCount` distingue `estimated` de `exact` au niveau du type (`06c`). Le tableau n'affiche
      // qu'un nombre — la distinction sert à `09f`, dont la tuile ne doit pas présenter une
      // estimation comme un fait exact.
      cell: (o) => formatRowCount(o.rows),
      numeric: true,
      width: '88px',
    },
    {
      key: 'size',
      header: t('explorer.objectTable.columns.size'),
      // `None` quand le moteur ne sait pas donner de taille physique — une vue, par exemple.
      cell: (o) => (o.sizeBytes === null ? ABSENT : formatBytes(o.sizeBytes)),
      numeric: true,
      width: '78px',
    },
    {
      key: 'columns',
      header: t('explorer.objectTable.columns.columns'),
      cell: (o) => o.columnCount,
      numeric: true,
      width: '66px',
    },
    {
      key: 'pk',
      header: t('explorer.objectTable.columns.primaryKey'),
      cell: (o) => o.primaryKey ?? ABSENT,
      width: '150px',
    },
    {
      key: 'analyze',
      header: t('explorer.objectTable.columns.lastAnalyze'),
      cell: (o) => o.lastAnalyze ?? ABSENT,
      width: '120px',
    },
    {
      key: 'comment',
      header: t('explorer.objectTable.columns.comment'),
      cell: (o) => o.comment ?? ABSENT,
    },
  ]
}
