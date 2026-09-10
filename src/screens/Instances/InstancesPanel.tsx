import { Icon } from '../../design/icons/Icon'
import type { ManagedInstance } from '../../domain/config'
import type { ConnectionState } from '../../domain/engine'
import { useT } from '../../i18n/LanguageContext'
import { Badge } from '../../ui/Badge/Badge'
import { SidebarSectionTitle } from '../../ui/SidebarSectionTitle/SidebarSectionTitle'
import { INDENT, TreeRow } from '../../ui/TreeRow/TreeRow'
import { RowMenu } from '../Explorer/RowMenu'
import styles from './InstancesPanel.module.css'
import { nomAffiche } from './instances'

export type InstancesPanelProps = {
  instances: readonly ManagedInstance[]
  /** L'état de chaque instance, indexé par identifiant. Absent : « jamais tentée ». */
  etats: Readonly<Record<string, ConnectionState>>
  /** L'instance dont l'onglet est au premier plan, s'il y en a un. */
  selectedId?: string | null
  onSelect: (instance: ManagedInstance) => void
  /** Ouvre la déclaration d'une instance. Absent, le `+` ne paraît pas. */
  onDeclare?: () => void
  /** Ouvre la modification d'une instance déclarée. */
  onEdit?: (instance: ManagedInstance) => void
  /** Ouvre la confirmation de retrait. */
  onRemove?: (instance: ManagedInstance) => void
}

/**
 * La seconde zone de la sidebar : les instances managées (`API-32`).
 *
 * # Une zone, et non un onglet
 *
 * L'arbre des projets et la liste d'instances se lisent **ensemble** : on regarde une base, et l'on
 * va voir sur quelle instance elle vit. Une bascule cacherait l'un pour montrer l'autre, et
 * remplacerait un coup d'œil par deux clics et un aller-retour.
 *
 * Elle vit donc sous l'arbre, dans un `SplitPane` d'axe vertical dont la poignée porte le filet :
 * la hauteur qu'on donne à chacune est un réglage, comme la largeur de la colonne — et un mockup
 * figé ne peut pas exprimer un panneau que l'utilisateur déplace.
 *
 * # Pas de dépliage
 *
 * Une ligne d'instance n'a **pas de chevron**, et c'est une décision : ce qui est *dans* une
 * instance — ses bases, ses rôles, ses sessions — se regarde au centre, dans un onglet, où il y a
 * la place d'un tableau. Le déplier ici ferait entrer dans une colonne de 228 px une matrice de
 * rôles × bases.
 *
 * L'indentation reste celle d'une ligne de projet : `INDENT[0] + 16`, la reprise de la gouttière du
 * chevron qu'une feuille n'occupe pas — la règle de `TreeRow`. L'icône tombe donc à `x = 24`, dans
 * la **même colonne** que les lignes de projet de l'arbre du dessus. Deux listes voisines dont les
 * icônes ne s'alignent pas se lisent comme deux composants mal assemblés.
 */
export function InstancesPanel({
  instances,
  etats,
  selectedId = null,
  onSelect,
  onDeclare,
  onEdit,
  onRemove,
}: InstancesPanelProps) {
  const t = useT()

  return (
    <div className={styles.root}>
      <div className={styles.entete}>
        <SidebarSectionTitle>{t('instances.sidebar.title')}</SidebarSectionTitle>
        {onDeclare && (
          <button
            type="button"
            className={styles.ajouter}
            aria-label={t('instances.sidebar.add')}
            title={t('instances.sidebar.add')}
            onClick={onDeclare}
          >
            <Icon name="plus" size={12} strokeWidth={2} />
          </button>
        )}
      </div>
      <div className={styles.liste} role="tree" aria-label={t('instances.sidebar.title')}>
        {instances.length === 0 ? (
          <p className={styles.vide}>{t('instances.sidebar.empty')}</p>
        ) : (
          instances.map((instance) => {
            const etat = etats[instance.id] ?? { kind: 'never' as const }
            return (
              <TreeRow
                key={instance.id}
                depth={0}
                /* **La gouttière du chevron, reprise sans chevron.** Voir l'en-tête : c'est ce qui
                   aligne l'icône `srv` sur celle des projets, une ligne au-dessus. */
                indent={`calc(${INDENT[0]} + 16px)`}
                icon="srv"
                iconColor="var(--engine-pg)"
                label={nomAffiche(instance)}
                /* La version du serveur, en méta mono : « pg 16.2 ». Elle ne paraît qu'une fois la
                   connexion faite — l'annoncer avant serait affirmer une version qu'on n'a pas lue. */
                meta={etat.kind === 'connected' ? abregerVersion(etat.serverVersion) : undefined}
                metaVariant="mono"
                selected={selectedId === instance.id}
                title={t('instances.sidebar.row', {
                  host: instance.connection.host,
                  port: instance.connection.port,
                  role: instance.connection.username,
                })}
                trailing={
                  <>
                    {/* **Le badge d'état, celui de l'arbre des connexions**, et pour la même raison :
                        quatre états et non deux, et « jamais tentée » n'en porte aucun — une
                        instance qu'on n'a pas ouverte n'est pas en défaut. */}
                    {badgeDEtat(etat) && (
                      <Badge tone={badgeDEtat(etat)?.tone ?? 'muted'} size="xs">
                        {t(`explorer.arbre.${badgeDEtat(etat)?.cle}`)}
                      </Badge>
                    )}
                    {instance.production && (
                      <Badge tone="danger" size="xs">
                        {t('instances.sidebar.production')}
                      </Badge>
                    )}
                  </>
                }
                onClick={() => onSelect(instance)}
                /* **Le menu « … » de l'arbre, et non deux carrés nus** (9 septembre 2026, rapporté
                   à l'usage : « les boutons edit/delete sont superposés aux métadonnées »).

                   Deux boutons de 18 px occupent 45 px depuis le bord droit ; la version et le badge
                   d'état s'arrêtaient, eux, à la gouttière réservée — donc ils se recouvraient. La
                   parade évidente aurait été d'élargir la gouttière, et elle aurait coûté 45 px de
                   libellé **en permanence** pour deux gestes rares.

                   `RowMenu` règle les deux : un seul déclencheur dans la gouttière de 24 px que
                   `TreeRow` réserve déjà, peint au survol et au focus seulement — donc la méta reste
                   lisible tant qu'on ne vise pas la ligne. Et c'est ce que portent déjà les lignes de
                   projet, d'environnement et de connexion : deux formes d'actions de ligne voisines
                   dans la même colonne auraient été deux conventions à apprendre. */
                actions={
                  onEdit || onRemove ? (
                    <RowMenu
                      cible={nomAffiche(instance)}
                      entrees={[
                        {
                          libelle: t('instances.actions.edit'),
                          icone: 'pencil',
                          ...(onEdit === undefined ? {} : { onClick: () => onEdit(instance) }),
                        },
                        {
                          libelle: t('instances.actions.remove'),
                          icone: 'trash',
                          ...(onRemove === undefined ? {} : { onClick: () => onRemove(instance) }),
                        },
                      ]}
                    />
                  ) : undefined
                }
              />
            )
          })
        )}
      </div>
    </div>
  )
}

/**
 * « PostgreSQL 16.2 » → « pg 16.2 », la méta que la maquette montre.
 *
 * **Ici et non dans le cœur** : la version complète est ce que `probe` rend, et c'est elle que la
 * modale de connexion affiche. L'abréviation est une contrainte de largeur de cette colonne-là.
 */
function abregerVersion(version: string): string {
  return version.replace(/^PostgreSQL\s+/i, 'pg ')
}

/**
 * Le badge d'état, **et les libellés de l'arbre**, réemployés.
 *
 * Une instance ouverte et une base ouverte sont dans le même état, décrit par le même type : leur
 * donner deux vocabulaires ferait lire « OK » d'un côté et « Connectée » de l'autre, dans la même
 * colonne, à trois lignes d'écart.
 */
function badgeDEtat(
  etat: ConnectionState,
): { cle: string; tone: 'warn' | 'success' | 'danger' } | undefined {
  switch (etat.kind) {
    case 'never':
      return undefined
    case 'connecting':
      return { cle: 'connectingBadge', tone: 'warn' }
    case 'connected':
      return { cle: 'connectedBadge', tone: 'success' }
    case 'offline':
      return { cle: 'offlineBadge', tone: 'danger' }
  }
}
