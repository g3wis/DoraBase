import { useT } from '../../i18n/LanguageContext'
import { Button } from '../../ui/Button/Button'
import { Modal } from '../../ui/Modal/Modal'
import styles from './NewConnection.module.css'

type ConnectionFailureProps = {
  /** Le message du moteur, tel quel. */
  message: string
  /** Le `SQLSTATE`, quand le moteur en a donné un. */
  code: string | null
  /** Vrai quand la variante déclarait un tunnel : la seconde ligne du log en dépend. */
  viaTunnel: boolean
  onClose: () => void
}

/**
 * `A3` — la sous-modale bloquante d'échec de connexion.
 *
 * **Le message vient du moteur, pas d'ici.** `06b`–`06e` produisent déjà des textes qui disent
 * la manœuvre : un hôte absent de `known_hosts` renvoie vers `ssh <hote>`, une clé refusée parle
 * d'`authorized_keys`. Les réécrire créerait deux vérités, dont une périmée.
 *
 * **La modale sous-jacente n'est pas surlignée en rouge** — le handoff insiste : « l'erreur ne
 * vit que dans la sous-modale ». C'est `NewConnection` qui le garantit en ne changeant rien à
 * `A2`, sinon le pied.
 *
 * **L'encart de log n'est rendu que s'il a quelque chose à dire.** Le mockup y met une
 * transcription — `ssh auth publickey → permission denied` puis `tunnel aborted · pg connect
 * skipped` — dont la cause est *courte*. Nos messages, eux, sont des phrases qui disent la
 * manœuvre, et leur place est le texte explicatif. Une première version les recopiait dans
 * l'encart : le résultat était le même paragraphe deux fois, en mono. L'encart porte donc ce que
 * le texte ne dit pas — le `SQLSTATE` et la ligne de tunnel — et disparaît quand il n'y a ni
 * l'un ni l'autre, plutôt que d'être rempli d'une copie.
 */
export function ConnectionFailure({ message, code, viaTunnel, onClose }: ConnectionFailureProps) {
  const t = useT()

  return (
    <Modal
      title={t('newConnection.failure.title')}
      icon="warn"
      nested
      onClose={onClose}
      footer={
        <Button variant="dark" size="md" shortcut="esc" onClick={onClose}>
          {t('newConnection.failure.close')}
        </Button>
      }
    >
      <div className={styles.failureBody}>
        <p data-selectionnable className={styles.failureText}>
          {message}
        </p>

        {/* Affiché *et* copiable, donc c'est le point du produit le plus exposé à une fuite de
            secret — d'où le contrôle par sentinelle côté Rust (`08d`), et le fait que rien ne
            soit reformulé ici. */}
        {(code !== null || viaTunnel) && (
          <div className={styles.failureLog}>
            {code !== null && (
              <div>
                {t('newConnection.failure.sqlstate')}{' '}
                <span className={styles.failureCause}>{code}</span>
              </div>
            )}
            {/* La seconde ligne du mockup : « tunnel aborted · pg connect skipped ». Elle ne
                s'affiche que s'il y avait un tunnel — l'inventer sur une connexion directe
                enverrait chercher un bastion inexistant. */}
            {viaTunnel && <div>{t('newConnection.failure.tunnelLine')}</div>}
          </div>
        )}
      </div>
    </Modal>
  )
}
