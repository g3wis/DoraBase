import type { SslMode } from '../../domain/config'
import { useT } from '../../i18n/LanguageContext'
import { Badge } from '../../ui/Badge/Badge'
import { Button } from '../../ui/Button/Button'
import { Modal } from '../../ui/Modal/Modal'
import styles from './ConfirmationTls.module.css'

/** Ce qui rend une cible sensible — voir « Le mode SSL d'un brouillon neuf » dans `CLAUDE.md`. */
export type CibleSensible = { kind: 'instance' } | { kind: 'folder'; name: string }

type ConfirmationTlsProps = {
  /** Le mode qu'on s'apprête à enregistrer — non authentifiant, par construction de l'appelant. */
  mode: Exclude<SslMode, 'verify-ca' | 'verify-full'>
  /**
   * **La cible**, que le corps nomme et que le titre ne nomme pas (#173) : une instance marquée
   * production, ou le dossier qui impose la lecture seule à la connexion.
   */
  cible: CibleSensible
  onConfirmer: () => void
  onClose: () => void
}

/**
 * Le rappel qui précède l'enregistrement d'un mode SSL non authentifiant sur une cible sensible
 * (#87) — une connexion d'`A2` sous un dossier en lecture seule, ou une instance managée marquée
 * production.
 *
 * **Le titre nomme le risque, le corps nomme la cible** (#173). Le titre disait « en production »
 * pour les deux appelants, or un dossier en lecture seule n'est pas forcément de production : un
 * titre par appelant aurait été deux phrases à tenir en phase, et c'est le risque — un serveur que
 * rien n'authentifie — qui est commun aux quatre modes et aux deux cibles. Le badge suit la cible
 * pour la même raison : « PROD » devant un dossier en lecture seule redisait l'erreur du titre.
 *
 * **Une confirmation qui nomme le mode**, dans le corps et sur le bouton : « êtes-vous sûr ? »
 * n'apprendrait rien, « enregistrer en prefer » dit ce qui part. Le corps dit la
 * conséquence propre à ce mode — le repli en clair de `prefer` n'est pas le serveur non authentifié
 * de `require` —, et la note dit où remonter. C'est le patron du rappel de production de
 * `SqlConfirm` et du gestionnaire de schémas : le drapeau, jamais le libellé.
 *
 * **« Revenir » est le bouton de repli, et `Échap` aussi** : la modale se ferme sans rien enregistrer,
 * et le formulaire garde sa saisie.
 */
export function ConfirmationTls({ mode, cible, onConfirmer, onClose }: ConfirmationTlsProps) {
  const t = useT()
  const rappel =
    cible.kind === 'instance'
      ? t('newConnection.tlsConfirm.instance')
      : t('newConnection.tlsConfirm.folder', { name: cible.name })

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
            {t(`newConnection.tlsConfirm.badge.${cible.kind}`)}
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
