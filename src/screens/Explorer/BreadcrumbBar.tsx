import type { CSSProperties } from 'react'
import { dessinDeConnexion, teinteDeConnexion } from '../../data/iconesDeConnexion'
import { Icon } from '../../design/icons/Icon'
import type { Database, Engine } from '../../domain/config'
import { useT } from '../../i18n/LanguageContext'
import { SANS_CORRECTION } from '../../ui/Field/Field'
import { type Segment, SegmentedControl } from '../../ui/SegmentedControl/SegmentedControl'
import styles from './BreadcrumbBar.module.css'

export type TypeObjet = 'tables' | 'views' | 'functions' | 'indexes'

type BreadcrumbBarProps = {
  database: string
  /** Le moteur de la base ouverte (27 août 2026), pour l'icône devant `database`. Absent tant
   * qu'aucune base n'est ouverte : l'icône générique `db` reste alors le repli. */
  engine?: Engine
  /**
   * L'icône et la couleur choisies pour cette connexion (#179) : **le fil d'Ariane montre ce que la
   * ligne de l'arbre montre** (tranché par le demandeur). Absentes, le logo du moteur.
   */
  icon?: Database['icon']
  color?: Database['color']
  schema: string
  /** Les quatre comptes, **issus des données** — jamais de constantes. */
  counts: Record<TypeObjet, number>
  type: TypeObjet
  onTypeChange: (type: TypeObjet) => void
  filter: string
  onFilterChange: (filter: string) => void
}

const ORDRE: readonly TypeObjet[] = ['tables', 'views', 'functions', 'indexes']

/**
 * La barre de fil d'Ariane du centre de `A4` : chemin, filtre, contrôle segmenté.
 *
 * **Le fil d'Ariane double celui de la barre de titre, et ce n'est pas une redondance.** Celui
 * de la barre de titre suit la base **ouverte** ; celui-ci suit l'**onglet actif**. Avec
 * plusieurs onglets, ils diffèrent. À écrire, parce qu'un relecteur y verra un doublon.
 */
export function BreadcrumbBar({
  database,
  engine,
  icon,
  color,
  schema,
  counts,
  type,
  onTypeChange,
  filter,
  onFilterChange,
}: BreadcrumbBarProps) {
  const t = useT()
  const LIBELLES: Record<TypeObjet, string> = {
    tables: t('explorer.breadcrumb.types.tables'),
    views: t('explorer.breadcrumb.types.views'),
    functions: t('explorer.breadcrumb.types.functions'),
    indexes: t('explorer.breadcrumb.types.indexes'),
  }
  const teinte = engine === undefined ? undefined : teinteDeConnexion({ engine, color })
  const segments: Segment<TypeObjet>[] = ORDRE.map((typeObjet) => ({
    value: typeObjet,
    label: LIBELLES[typeObjet],
    // **Issus des données.** Les coder en dur les rendrait faux dès la première base réelle, et
    // c'est le genre de valeur qu'on oublie de brancher parce qu'elle *ressemble* à du bon.
    count: counts[typeObjet],
  }))

  return (
    <div className={styles.root}>
      <nav className={styles.breadcrumb} aria-label={t('explorer.breadcrumb.path')}>
        <Icon
          name={engine === undefined ? 'db' : dessinDeConnexion({ engine, icon })}
          size={13}
          strokeWidth={1.8}
          className={styles.dbIcon}
          // La teinte de la ligne de l'arbre, logo compris quand une couleur est choisie : la même
          // résolution, `teinteDeConnexion`, et non une seconde règle.
          style={
            teinte === undefined
              ? undefined
              : ({
                  color: teinte.couleur,
                  ...(teinte.teinterLeLogo ? { '--logo-tint': 'currentColor' } : {}),
                } as CSSProperties)
          }
        />
        {database}
        <Icon name="chevr" size={11} strokeWidth={2.4} className={styles.separator} />
        <span className={styles.current}>{schema}</span>
      </nav>

      <span className={styles.spacer} />

      {/* **Le champ ne promet plus une recherche globale.**
          Le mockup écrit « Chercher un objet… » avec un rappel `⌘P`, ce qui annonce deux choses
          qui n'existent pas : une recherche traversant tous les schémas et tous les projets, et
          un raccourci pour l'ouvrir. Ce champ filtre la liste affichée — celle du schéma
          courant — et le dit. Le rappel `⌘P` est retiré plutôt que de désigner un raccourci
          mort : un raccourci affiché qui ne répond pas est pire qu'un raccourci absent.
          La recherche globale reste à faire, et sa spec dira ce que devient ce champ. */}
      <label className={styles.search}>
        <Icon name="search" size={12} strokeWidth={2} className={styles.searchIcon} />
        <input
          {...SANS_CORRECTION}
          type="text"
          className={styles.searchInput}
          value={filter}
          placeholder={t('explorer.breadcrumb.filterPlaceholder', { schema })}
          aria-label={t('explorer.breadcrumb.filterLabel', { schema })}
          onChange={(evenement) => onFilterChange(evenement.target.value)}
        />
      </label>

      <SegmentedControl
        label={t('explorer.breadcrumb.typeLabel')}
        segments={segments}
        value={type}
        onValueChange={onTypeChange}
      />
    </div>
  )
}
