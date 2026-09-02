import { useMemo, useState } from 'react'
import { Icon } from '../../design/icons/Icon'
import type { ColumnInfo, TableDetail } from '../../domain/engine'
import { useT } from '../../i18n/LanguageContext'
import { type Column, DataTable } from '../../ui/DataTable/DataTable'
import { ABSENT, formatBytes, formatRowCount } from '../../ui/format'
import styles from './StructureView.module.css'
import { annotationDe, defautLisible } from './structure'

type StructureViewProps = {
  detail: TableDetail | null
  schema: string
  loading?: boolean
  error?: string | null
}

/**
 * La vue Structure de `A9` (`14a` → `14c`) : les colonnes, les index et contraintes, le DDL.
 *
 * **Aucune lecture nouvelle n'est envoyée au moteur.** `TableDetail` (`06c`) porte déjà tout ce que
 * cet écran affiche ; il en est le troisième lecteur, après le panneau droit de `09f` et la section
 * « Colonnes de *table* » de la sidebar (`10c`). C'est l'écran le plus complet du produit pour le
 * moins de code — et c'est `06c` qui l'avait prévu, en rendant `ddl` que personne n'affichait.
 *
 * **Le DDL n'est plus ici.** Il occupait une colonne de 392 px sur la droite de cette vue, comme le
 * mockup d'`A9` le montre, et cette vue prenait donc toute la largeur du centre — comme une console.
 * Depuis `22`, le DDL est dans la colonne de droite commune : cette vue redevient un centre
 * ordinaire, qui entre dans le partage comme la grille.
 */
export function StructureView({
  detail,
  schema,
  loading = false,
  error = null,
}: StructureViewProps) {
  const t = useT()
  const [filtre, setFiltre] = useState('')

  const visibles = useMemo(() => {
    if (!detail) return []
    const cherche = filtre.trim().toLowerCase()
    if (cherche === '') return detail.columns
    // **Le nom et le type.** On cherche « les colonnes en `timestamptz` » au moins aussi souvent
    // qu'une colonne par son nom, et un filtre qui ne porterait que sur le nom laisserait croire
    // qu'aucune colonne ne correspond.
    return detail.columns.filter(
      (colonne) =>
        colonne.name.toLowerCase().includes(cherche) ||
        colonne.typeName.toLowerCase().includes(cherche),
    )
  }, [detail, filtre])

  if (error)
    return (
      <div className={styles.root}>
        <p className={styles.vide}>{error}</p>
      </div>
    )
  if (loading)
    return (
      <div className={styles.root}>
        <p className={styles.vide}>{t('structure.view.lecture')}</p>
      </div>
    )
  if (!detail)
    return (
      <div className={styles.root}>
        <p className={styles.vide}>{t('structure.view.aucuneTable')}</p>
      </div>
    )

  const colonnes: Column<ColumnInfo>[] = [
    {
      key: 'position',
      header: t('structure.view.entetes.rang'),
      width: '34px',
      cell: (colonne) => <span className={styles.rang}>{colonne.position}</span>,
    },
    {
      key: 'name',
      header: t('structure.view.entetes.colonne'),
      width: '150px',
      ui: true,
      cell: (colonne) => (
        // Une clé primaire en gras, comme le mockup : c'est la colonne par laquelle on désigne
        // une ligne, et c'est ce qu'on cherche en premier dans un tableau de dix-huit lignes.
        <span className={colonne.key === 'primary' ? styles.nomCle : undefined}>
          {colonne.name}
        </span>
      ),
    },
    {
      key: 'type',
      header: t('structure.view.entetes.type'),
      width: '118px',
      cell: (colonne) => colonne.typeName,
    },
    {
      key: 'nullable',
      header: t('structure.view.entetes.nullable'),
      width: '54px',
      cell: (colonne) => (
        // `no` en rouge et `yes` en vert : le mockup l'assume, et ce n'est pas un jugement de
        // valeur — c'est la couleur d'une contrainte présente contre une contrainte absente.
        <span className={colonne.nullable ? styles.oui : styles.non}>
          {colonne.nullable ? 'yes' : 'no'}
        </span>
      ),
    },
    {
      key: 'default',
      header: t('structure.view.entetes.defaut'),
      width: '130px',
      cell: (colonne) => {
        const defaut = defautLisible(colonne)
        return defaut === null ? (
          <span className={styles.absent}>{ABSENT}</span>
        ) : (
          <span className={styles.defaut} title={defaut}>
            {defaut}
          </span>
        )
      },
    },
    {
      key: 'key',
      header: t('structure.view.entetes.cle'),
      width: '70px',
      cell: (colonne) => {
        if (colonne.key === null) return null
        const quoi =
          colonne.key === 'primary'
            ? t('structure.view.clePrimaire')
            : t('structure.view.cleEtrangere')
        // **Une cellule qui ne contient qu'une icône est muette.** `Icon` pose `aria-hidden`, à
        // raison — l'icône est décorative quand un texte voisin la nomme. Ici il n'y en a pas :
        // le mot est donc porté par un texte réservé aux lecteurs d'écran, et par l'infobulle
        // pour ceux qui voient un pictogramme sans savoir lequel.
        return (
          <span className={styles.cle} title={quoi}>
            <Icon
              name={colonne.key === 'primary' ? 'key' : 'fk'}
              size={12}
              strokeWidth={2.2}
              className={colonne.key === 'primary' ? styles.iconePk : styles.iconeFk}
            />
            <span className={styles.pourLaVoix}>{quoi}</span>
          </span>
        )
      },
    },
    {
      key: 'comment',
      header: t('structure.view.entetes.commentaire'),
      ui: true,
      cell: (colonne) => {
        const annotation = annotationDe(colonne, detail.relations, detail.constraints)
        if (annotation === null) return <span className={styles.absent}>{ABSENT}</span>
        // **Un commentaire écrit et une déduction ne se lisent pas pareil.** Le mockup les met dans
        // la même colonne ; les rendre à l'identique ferait passer « → users.id », que DoraBase
        // déduit, pour une phrase qu'un collègue a écrite. Le titre le dit aussi à la voix.
        return (
          <span
            className={annotation.deduit ? styles.deduit : undefined}
            title={
              annotation.deduit
                ? t('structure.view.colonneDeduite')
                : t('structure.view.colonneCommentee')
            }
          >
            {annotation.texte}
          </span>
        )
      },
    },
  ]

  return (
    <div className={styles.root}>
      <div className={styles.gauche}>
        <div className={styles.comptes}>
          {/* Les trois comptes viennent de l'introspection, **pas d'un recalcul** : `detail` les
              porte, et les recompter ailleurs finirait par en donner deux versions. */}
          <span>{t('structure.view.comptes.colonnes', { count: detail.columns.length })}</span>
          <span className={styles.barre} />
          <span>{t('structure.view.comptes.index', { count: detail.indexes.length })}</span>
          <span className={styles.barre} />
          <span>
            {t('structure.view.comptes.contraintes', { count: detail.constraints.length })}
          </span>
          <span className={styles.espace} />
          <label className={styles.filtre}>
            <Icon name="search" size={12} strokeWidth={1.9} />
            <input
              type="text"
              value={filtre}
              placeholder={t('structure.view.filtrerPlaceholder')}
              aria-label={t('structure.view.filtrerAriaLabel')}
              onChange={(evenement) => setFiltre(evenement.target.value)}
            />
          </label>
        </div>

        <div className={styles.tableau}>
          <DataTable
            label={t('structure.view.colonnesTableLabel', { schema, table: detail.name })}
            columns={colonnes}
            rows={visibles}
            rowId={(colonne) => colonne.name}
            empty={<span>{t('structure.view.aucuneColonneNeCorrespond', { filtre })}</span>}
          />
        </div>

        <div className={styles.panneaux}>
          <ListeDuCatalogue
            titre={t('structure.view.panneaux.titreIndex')}
            entrees={detail.indexes.map((index) => ({
              nom: index.name,
              detail: resumeDIndex(index.definition),
              icone: /unique/i.test(index.definition) ? 'key' : 'sort',
              accent: /unique/i.test(index.definition),
              complet: index.definition,
            }))}
            vide={t('structure.view.panneaux.aucunIndex')}
          />
          <ListeDuCatalogue
            titre={t('structure.view.panneaux.titreContraintes')}
            entrees={[
              ...detail.constraints.map((contrainte) => ({
                nom: contrainte.name,
                detail: contrainte.definition,
                icone: 'shield' as const,
                accent: false,
                complet: contrainte.definition,
              })),
              ...detail.triggers.map((declencheur) => ({
                nom: declencheur.name,
                detail: momentDuDeclencheur(declencheur.definition),
                icone: 'flask' as const,
                accent: false,
                complet: declencheur.definition,
              })),
            ]}
            vide={t('structure.view.panneaux.aucuneContrainte')}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Une liste du catalogue — index, ou contraintes et déclencheurs (`14b`).
 *
 * **Un vide se dit, il ne s'efface pas.** Une section absente se lit comme une donnée non chargée,
 * et c'est exactement le doute que le défaut de `06d` a produit — des colonnes vides qu'on a crues
 * nulles. Une table sans déclencheur a donc une section qui le dit.
 */
function ListeDuCatalogue({
  titre,
  entrees,
  vide,
}: {
  titre: string
  entrees: {
    nom: string
    detail: string
    icone: 'key' | 'sort' | 'shield' | 'flask'
    accent: boolean
    complet: string
  }[]
  vide: string
}) {
  return (
    <section className={styles.panneau}>
      <h3 className={styles.panneauTitre}>{titre}</h3>
      {entrees.length === 0 ? (
        <p className={styles.panneauVide}>{vide}</p>
      ) : (
        <ul className={styles.liste}>
          {entrees.map((entree) => (
            <li key={`${titre}/${entree.nom}`} className={styles.entree} title={entree.complet}>
              <Icon
                name={entree.icone}
                size={12}
                strokeWidth={2}
                className={entree.accent ? styles.iconePk : styles.iconeTerne}
              />
              <span className={styles.entreeNom}>{entree.nom}</span>
              <span className={styles.entreeDetail}>{entree.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * `btree(created_at desc)` depuis `CREATE INDEX … USING btree (created_at DESC)`.
 *
 * **Le résumé, pas la définition.** Une définition d'index tient sur 120 caractères et répète le
 * schéma, la table et le nom de l'index qui est déjà à côté. Le texte entier reste accessible par
 * l'infobulle de la ligne, et il est dans le DDL.
 *
 * **L'unicité est dite en tête, pas seulement colorée.** Le mockup ne la distingue que par la
 * teinte de l'icône — or c'est la propriété la plus lourde de conséquences d'un index : elle
 * empêche des écritures. Un lecteur d'écran, ou un œil qui ne discrimine pas l'or du gris, ne
 * verrait pas la différence entre un index et une contrainte d'unicité.
 */
export function resumeDIndex(definition: string): string {
  const unique = /\bunique\b/i.test(definition) ? 'unique ' : ''
  const trouve = /using\s+(\w+)\s*\((.*)\)\s*$/is.exec(definition)
  const methode = trouve?.[1]
  const colonnes = trouve?.[2]
  if (methode === undefined || colonnes === undefined) return definition
  return `${unique}${methode.toLowerCase()}(${colonnes.replace(/\s*,\s*/g, ',').trim()})`
}

/** `before update` depuis `CREATE TRIGGER … BEFORE UPDATE ON … EXECUTE FUNCTION …`. */
export function momentDuDeclencheur(definition: string): string {
  const trouve = /\b(before|after|instead\s+of)\s+([a-z\s,]*?)\s+on\b/i.exec(definition)
  if (!trouve) return definition
  return `${trouve[1]} ${trouve[2]}`.toLowerCase().replace(/\s+/g, ' ')
}

/**
 * La barre d'état sous la structure.
 *
 * **Distincte de celle de `A5`** : la barre des données annonce une fenêtre de lignes et sa durée,
 * chiffres qu'aucune lecture n'a produits ici. La réutiliser afficherait « 500 lignes · 41 ms »
 * sous une structure, donc les restes de la dernière lecture de la grille.
 *
 * **Deux des cinq mentions du mockup manquent, et c'est dit** : le propriétaire de la table
 * (`owner: analytics_app`) n'est pas dans `TableDetail`, et l'heure de lecture du DDL demanderait
 * d'horodater l'introspection. Les inventer serait pire que les taire.
 */
export function StructureStatusBar({ detail }: { detail: TableDetail }) {
  const t = useT()
  const taille = detail.sizeBytes === null ? null : formatBytes(detail.sizeBytes)
  const morceaux = [
    t('structure.statusBar.colonnes', { count: detail.columns.length }),
    t('structure.statusBar.index', { count: detail.indexes.length }),
    t('structure.statusBar.contraintes', { count: detail.constraints.length }),
    t('structure.statusBar.lignes', { count: formatRowCount(detail.rows) }),
    taille,
  ].filter((morceau): morceau is string => morceau !== null)

  return (
    <div className={styles.pied} role="status" aria-label={t('structure.statusBar.ariaLabel')}>
      {morceaux.map((morceau, rang) => (
        <span key={morceau}>
          {rang > 0 && <span className={styles.piedPoint}>·</span>}
          {morceau}
        </span>
      ))}
    </div>
  )
}
