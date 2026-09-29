import type { SslMode } from '../../domain/config'
import { useT } from '../../i18n/LanguageContext'
import { Badge } from '../../ui/Badge/Badge'
import { Button } from '../../ui/Button/Button'
import { Modal } from '../../ui/Modal/Modal'
import styles from './ConfirmationTls.module.css'

type ConfirmationTlsProps = {
  /** Le mode qu'on s'apprête à enregistrer — non authentifiant, par construction de l'appelant. */
  mode: Exclude<SslMode, 'verify-ca' | 'verify-full'>
  /** La phrase de rappel, déjà traduite : elle nomme la cible marquée production. */
  rappel: string
  onConfirmer: () => void
  onClose: () => void
}

/**
 * Le rappel qui précède l'enregistrement d'un mode SSL non authentifiant sur une cible marquée
 * production (#87) — une connexion d'`A2` ou une instance managée.
 *
 * **Une confirmation qui nomme le mode**, dans le titre, dans le corps et sur le bouton : « êtes-vous
 * sûr ? » n'apprendrait rien, « enregistrer en prefer » dit ce qui part. Le corps dit la
 * conséquence propre à ce mode — le repli en clair de `prefer` n'est pas le serveur non authentifié
 * de `require` —, et la note dit où remonter. C'est le patron du rappel de production de
 * `SqlConfirm` et du gestionnaire de schémas : le drapeau, jamais le libellé.
 *
 * **« Revenir » est le bouton de repli, et `Échap` aussi** : la modale se ferme sans rien enregistrer,
 * et le formulaire garde sa saisie.
 */
export function ConfirmationTls({ mode, rappel, onConfirmer, onClose }: ConfirmationTlsProps) {
  const t = useT()

  return (
    <Modal
      title={t('newConnection.tlsConfirm.title')}
      icon="warn"
      nested
      compact
      onClose={onClose}
      footer={
        <div className={styles.pied}>
          <Button variant="secondary" size="md" onClick={onClose}>
            {t('newConnection.tlsConfirm.back')}
          </Button>
          <Button variant="dark" size="md" onClick={onConfirmer}>
            {t('newConnection.tlsConfirm.confirm', { mode })}
          </Button>
        </div>
      }
    >
      <div className={styles.corps}>
        <p className={styles.production}>
          <Badge tone="danger" size="xs">
            {t('newConnection.tlsConfirm.badge')}
          </Badge>{' '}
          {rappel}
        </p>
        <p className={styles.texte}>
          {t('newConnection.tlsConfirm.body', { mode })}{' '}
          {t(`newConnection.tlsConfirm.consequence.${mode}`)}
        </p>
        <p className={styles.note}>{t('newConnection.tlsConfirm.note')}</p>
      </div>
    </Modal>
  )
}
