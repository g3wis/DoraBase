import type { DatabasePrivilege, InstancePrivilege } from '../../../domain/instances'
import { useT } from '../../../i18n/LanguageContext'
import { basesDe, matriceDe, permis, raisonDuRefus, sigleDe } from '../instances'
import { correspond, type PropsDeSection } from './communes'
import styles from './PrivilegesSection.module.css'

/**
 * La matrice rôle × base (`API-32`).
 *
 * # Pourquoi ce n'est pas un `DataTable`
 *
 * `DataTable` a des colonnes **déclarées** : le tableau d'objets d'`A4` en a sept, connues à
 * l'écriture. Ici les colonnes sont les **bases de l'instance**, donc une donnée, et il y en a
 * autant que le serveur en porte. Les lui passer en `columns` reconstruites à chaque rendu
 * fonctionnerait, mais ce tableau a en plus une propriété qu'aucun autre n'a : **chaque cellule est
 * un contrôle**. Un clic bascule un privilège, ce qui traverse la confirmation SQL.
 *
 * # Le sigle, et ce qu'il ne dit pas
 *
 * `ALL`, `CTc`, `Tc`, `c`, `—`. La légende vit dans la barre d'outils, pas sous le tableau : c'est
 * une clé de lecture, et elle doit être visible pendant qu'on lit — pas après avoir défilé jusqu'en
 * bas. Le sigle est **doublé d'un `title`** qui nomme les privilèges en toutes lettres : trois
 * lettres dont deux se distinguent par leur casse ne sont pas lisibles à la voix.
 *
 * # Ce qu'un clic fait, et ce qu'il ne peut pas défaire
 *
 * Basculer une cellule accorde ou révoque **un** privilège — celui de la colonne du clic serait
 * ambigu, une cellule en portant trois. Le clic ouvre donc un petit menu des trois, et chaque entrée
 * dit ce qu'elle fera. Un privilège reçu par appartenance à un autre rôle, ou accordé à `PUBLIC`, ne
 * se révoque pas ici : la cellule restera cochée, et la note du plan le dit.
 */
export function PrivilegesSection({
  privileges,
  filtre,
  capacites,
  onDemander,
}: { privileges: readonly InstancePrivilege[] } & PropsDeSection) {
  const t = useT()
  const bases = basesDe(privileges)
  const matrice = matriceDe(privileges)
  const roles = [...matrice.keys()].filter((role) => correspond(filtre, role))
  const accordable = permis(capacites, 'grantPrivilege')
  const raison = raisonDuRefus(capacites, 'grantPrivilege')

  if (bases.length === 0 || roles.length === 0) {
    return <p className={styles.vide}>{t('instances.state.empty')}</p>
  }

  return (
    <div className={styles.cadre}>
      <table className={styles.matrice}>
        <caption className={styles.legende}>{t('instances.tables.privileges')}</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.enteteRole}>
              {t('instances.columns.role')}
            </th>
            {bases.map((base) => (
              <th key={base} scope="col" className={styles.enteteBase}>
                {base}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role}>
              <th scope="row" className={styles.role}>
                {role}
              </th>
              {bases.map((base) => {
                const cellule = matrice.get(role)?.get(base)
                return (
                  <td key={base} className={styles.cellule}>
                    <span className={styles.groupe}>
                      {(['create', 'temporary', 'connect'] as const).map((privilege) => {
                        const actif = cellule?.[privilege] ?? false
                        const libelle = t(
                          actif ? 'instances.actions.revoke' : 'instances.actions.grant',
                          { privilege: MOT_SQL[privilege], role, database: base },
                        )
                        return (
                          <button
                            key={privilege}
                            type="button"
                            className={actif ? styles.actif : styles.inactif}
                            aria-pressed={actif}
                            aria-label={libelle}
                            title={raison ?? libelle}
                            aria-disabled={accordable ? undefined : true}
                            onClick={() => {
                              if (!accordable) return
                              onDemander({
                                kind: 'privilege',
                                role,
                                database: base,
                                privilege,
                                accorder: !actif,
                              })
                            }}
                          >
                            {SIGLE[privilege]}
                          </button>
                        )
                      })}
                      {/* Le sigle composé — `ALL`, `—` — **en plus** des trois boutons : c'est lui
                          qu'on balaie du regard pour comparer deux lignes, là où les boutons sont ce
                          qu'on vise pour agir. Masqué à la voix, qui lit déjà les trois états. */}
                      <span className={styles.sigle} aria-hidden="true">
                        {cellule === undefined ? '—' : sigleDe(cellule)}
                      </span>
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Le mot du SQL, pour le libellé d'un bouton. Le sigle, lui, est ce que la cellule affiche. */
const MOT_SQL: Record<DatabasePrivilege, string> = {
  create: 'CREATE',
  temporary: 'TEMPORARY',
  connect: 'CONNECT',
}

/** `C T c`, l'ordre de la légende — toujours le même, pour que deux lignes se comparent. */
const SIGLE: Record<DatabasePrivilege, string> = {
  create: 'C',
  temporary: 'T',
  connect: 'c',
}
