import { useState } from 'react'
import type { ManagedInstance } from '../../domain/config'
import { useT } from '../../i18n/LanguageContext'
import { Button } from '../../ui/Button/Button'
import { Modal } from '../../ui/Modal/Modal'
import styles from './DeleteInstanceDialog.module.css'
import { nomAffiche } from './instances'

export type DeleteInstanceDialogProps = {
  instance: ManagedInstance
  onClose: () => void
  /** Retire l'instance. Rend `true` quand un secret n'a pas pu être effacé. */
  onRetirer: () => Promise<boolean>
}

/**
 * La confirmation de retrait d'une instance (`API-32`).
 *
 * # Le mot « supprimer » ne désigne jamais le serveur
 *
 * C'est la règle de `DeleteConnectionDialog`, et elle compte davantage ici : cet écran **sait**
 * supprimer des bases, et la même modale au même endroit doit dire sans ambiguïté qu'elle ne touche
 * rien sur le serveur. Le titre dit « Retirer l'instance », le corps dit ce qui disparaît — une
 * ligne de la sidebar et un mot de passe du magasin — et le dit en toutes lettres.
 *
 * # Le secret résiduel est rendu, jamais tu
 *
 * Un mot de passe qui survit à la déclaration qui le référençait est invisible et non nettoyable
 * depuis l'application. Le retrait réussit quand même — refuser de retirer une instance parce que le
 * Trousseau a bronché laisserait une ligne qu'on ne peut plus enlever — mais la phrase le dit.
 */
export function DeleteInstanceDialog({ instance, onClose, onRetirer }: DeleteInstanceDialogProps) {
  const t = useT()
  const [enCours, setEnCours] = useState(false)
  const [residuel, setResiduel] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  async function retirer() {
    setEnCours(true)
    setErreur(null)
    try {
      const reste = await onRetirer()
      if (reste) {
        // On ne ferme pas : la phrase qui dit qu'un secret est resté doit être lue, et une modale
        // qui se ferme sur cette nouvelle-là ne la montrerait qu'à qui regardait au bon moment.
        setResiduel(true)
        setEnCours(false)
        return
      }
      onClose()
    } catch (cause) {
      setErreur(messageDe(cause))
      setEnCours(false)
    }
  }

  return (
    <Modal
      title={t('instances.delete.title')}
      icon="trash"
      compact
      onClose={onClose}
      footer={
        <div className={styles.pied}>
          {residuel ? (
            <Button variant="dark" size="md" onClick={onClose}>
              {t('instances.delete.cancel')}
            </Button>
          ) : (
            <>
              <Button variant="secondary" size="md" onClick={onClose} disabled={enCours}>
                {t('instances.delete.cancel')}
              </Button>
              <Button variant="dark" size="md" onClick={retirer} disabled={enCours}>
                {t('instances.delete.confirm')}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className={styles.corps}>
        <p className={styles.texte}>
          {t('instances.delete.body', { instance: nomAffiche(instance) })}
        </p>
        {residuel && (
          <p className={styles.avertissement} role="alert">
            {t('instances.delete.residual')}
          </p>
        )}
        {erreur !== null && (
          <p className={styles.avertissement} role="alert">
            {erreur}
          </p>
        )}
      </div>
    </Modal>
  )
}

function messageDe(cause: unknown): string {
  if (typeof cause === 'string') return cause
  if (cause && typeof cause === 'object' && 'message' in cause) {
    return String((cause as { message: unknown }).message)
  }
  return String(cause)
}
