import { useState } from 'react'
import { Icon } from '../../../design/icons/Icon'
import type { InstanceRole } from '../../../domain/instances'
import { useT } from '../../../i18n/LanguageContext'
import { Badge } from '../../../ui/Badge/Badge'
import type { Column } from '../../../ui/DataTable/DataTable'
import { DataTable } from '../../../ui/DataTable/DataTable'
import { ABSENT, formatInteger } from '../../../ui/format'
import { attributsDe, permis, raisonDuRefus } from '../instances'
import { ActionsCell, LARGEUR_ACTIONS } from './ActionsCell'
import { correspond, type PropsDeSection } from './communes'
import styles from './RolesSection.module.css'

/**
 * Les rôles du serveur (`API-32`) — la section que la maquette intitule « Utilisateurs ».
 *
 * # Deux tableaux : les utilisateurs, puis les groupes (9 septembre 2026, rapporté à l'usage)
 *
 * PostgreSQL n'a que des rôles depuis la 8.1, et la section les listait donc **tous** — un
 * `atelier_lecture` sans `LOGIN` et un `pg_monitor` au milieu des comptes qui se connectent. Le
 * signalement est juste : une section qui s'appelle « Utilisateurs » et montre des rôles de groupe
 * ne dit pas ce qu'elle montre, et c'est la première colonne — celle qu'on balaie — qui ne
 * distingue plus rien.
 *
 * Le partage suit `rolcanlogin`, la seule marque que le catalogue donne : **un utilisateur est un
 * rôle qui peut se connecter**, un groupe est un rôle qui ne le peut pas. Les groupes vivent dans un
 * second tableau, **replié**, exactement comme les schémas de catalogue du gestionnaire de schémas —
 * ils existent, on les nomme dans « membre de » et dans la matrice de privilèges, donc les masquer
 * ferait chercher d'où vient un droit.
 *
 * **Les prédéfinis (`pg_*`) ne forment pas un troisième tableau** : ils sont des groupes, ils n'ont
 * pas `LOGIN`, et leur donner un rang à part aurait fait trois listes pour deux questions. Leur
 * badge suffit à les distinguer là où ils sont.
 *
 * # Deux refus portés par la ligne
 *
 * Un rôle **prédéfini** du serveur (`pg_monitor`, `pg_read_all_data`…) ne se supprime pas, et le
 * rôle **courant** ne peut pas se supprimer lui-même — `REASSIGN OWNED BY x TO x` est refusé, et il
 * n'y aurait plus personne pour exécuter la suite. Les deux sont désactivés *avec leur raison*.
 */
export function RolesSection({
  roles,
  roleCourant,
  filtre,
  capacites,
  onDemander,
}: { roles: readonly InstanceRole[]; roleCourant: string | undefined } & PropsDeSection) {
  const t = useT()
  const [groupesDeplies, setGroupesDeplies] = useState(false)
  const lignes = roles.filter((role) => correspond(filtre, role.name, ...role.memberOf))
  /**
   * **Le partage se fait après le filtre**, non avant : filtrer « pg_ » doit rendre les rôles
   * prédéfinis dans leur tableau, pas les faire disparaître des deux.
   */
  const utilisateurs = lignes.filter((role) => role.canLogin)
  const groupes = lignes.filter((role) => !role.canLogin)

  const colonnes: Column<InstanceRole>[] = [
    {
      key: 'actions',
      header: t('instances.columns.actions'),
      width: LARGEUR_ACTIONS,
      cell: (role) => (
        <ActionsCell
          actions={[
            {
              icon: 'pencil',
              // **Le crayon ouvre tout ce qui se modifie**, mot de passe compris depuis le
              // 10 septembre 2026 : c'est une propriété du rôle, qu'on change en même temps qu'on
              // lui retire un attribut. Deux entrées pour « modifier ce rôle » demandaient de savoir
              // laquelle porte quoi avant de cliquer.
              label: t('instances.actions.editRole', { role: role.name }),
              ...(permis(capacites, 'alterRole')
                ? { onClick: () => onDemander({ kind: 'editRole', role }) }
                : { reason: raisonDuRefus(capacites, 'alterRole') }),
            },
            {
              icon: 'trash',
              label: t('instances.actions.dropRole', { role: role.name }),
              ...(role.system
                ? { reason: t('instances.actions.systemRole') }
                : role.name === roleCourant
                  ? { reason: t('instances.actions.lastVisibleRole') }
                  : permis(capacites, 'dropRole')
                    ? { onClick: () => onDemander({ kind: 'dropRole', role }) }
                    : { reason: raisonDuRefus(capacites, 'dropRole') }),
            },
          ]}
        />
      ),
    },
    {
      key: 'name',
      header: t('instances.columns.role'),
      ui: true,
      cell: (role) => (
        <span title={role.system ? t('instances.rows.systemRole') : undefined}>
          {/* L'icône suit `rolcanlogin` — clé pour un rôle qui se connecte, cadenas sinon.
              **Décorative, et elle le reste** : la colonne « connexion » qui la doublait est partie
              avec le partage en deux tableaux, où elle aurait dit « oui » sur toutes les lignes de
              l'un et « non » sur toutes celles de l'autre. Ce qui porte le fait est désormais le
              tableau lui-même, nommé ; le glyphe le rappelle sans le porter seul. */}
          <Icon
            name={role.canLogin ? 'key' : 'lock'}
            size={12}
            strokeWidth={1.8}
            style={{ color: role.canLogin ? 'var(--gold)' : 'var(--ink-3)' }}
          />{' '}
          {role.name}
          {role.system && (
            <>
              {' '}
              {/* **Un mot, non la phrase.** « rôle prédéfini du serveur » poussait `pg_monitor` sous
                  l'ellipse : le badge doit tenir dans la marge que le nom lui laisse, et c'est le nom
                  qu'on vient lire. La phrase entière reste en infobulle, où elle a la place. */}
              <Badge tone="muted" size="xs" className={styles.badge}>
                {t('instances.rows.systemShort')}
              </Badge>
            </>
          )}
        </span>
      ),
    },
    {
      key: 'attributes',
      header: t('instances.columns.attributes'),
      cell: (role) => {
        const mots = attributsDe(role)
        return mots.length === 0 ? ABSENT : mots.join(' ')
      },
    },
    {
      key: 'memberOf',
      header: t('instances.columns.memberOf'),
      cell: (role) => (role.memberOf.length === 0 ? ABSENT : role.memberOf.join(', ')),
    },
    {
      key: 'owned',
      header: t('instances.columns.ownedDatabases'),
      numeric: true,
      cell: (role) => formatInteger(role.ownedDatabases),
    },
    {
      key: 'validUntil',
      header: t('instances.columns.validUntil'),
      cell: (role) => role.validUntil ?? ABSENT,
    },
  ]

  return (
    <div className={styles.root}>
      <DataTable
        label={t('instances.tables.roles')}
        columns={colonnes}
        rows={utilisateurs}
        rowId={(role) => role.name}
        empty={t('instances.state.empty')}
      />
      {groupes.length > 0 && (
        <>
          {/* **Une ligne de section, pas un second en-tête de tableau.** Le geste et la facture sont
              ceux des schémas système du gestionnaire de schémas : `aria-expanded` porte l'état, et
              le survol reprend `--hover-row` — cette ligne se comporte comme une ligne de liste, non
              comme un bouton. */}
          <button
            type="button"
            className={styles.section}
            aria-expanded={groupesDeplies}
            onClick={() => setGroupesDeplies((precedent) => !precedent)}
          >
            <Icon name={groupesDeplies ? 'chevd' : 'chevr'} size={12} strokeWidth={2.4} />
            {t('instances.rows.groups', { count: groupes.length })}
          </button>
          {groupesDeplies && (
            <DataTable
              label={t('instances.tables.groups')}
              columns={colonnes}
              rows={groupes}
              rowId={(role) => role.name}
            />
          )}
        </>
      )}
    </div>
  )
}
