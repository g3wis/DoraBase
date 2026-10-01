import { useState } from 'react'
import type { ConnectionId, FolderId } from '../../domain/config'
import { useT } from '../../i18n/LanguageContext'
import { Button } from '../../ui/Button/Button'
import { Modal } from '../../ui/Modal/Modal'
import styles from './DeleteConnectionDialog.module.css'

/**
 * Ce qu'un retrait vise (#166) : une connexion, ou un dossier et tout ce qu'il contient.
 *
 * **Désigné par identifiant, et nommé à part.** Le nom n'est là que pour la phrase de la modale :
 * deux connexions homonymes vivent dans deux dossiers, et c'est l'identifiant qui dit laquelle part.
 */
export type CibleDeSuppression =
  | { kind: 'database'; connection: ConnectionId; nom: string; connexions: number }
  | { kind: 'folder'; folder: FolderId; nom: string; connexions: number }

type DeleteConnectionDialogProps = {
  cible: CibleDeSuppression
  /** Les modifications en attente (`11b`) que la fermeture des onglets ferait perdre. */
  modificationsEnAttente: number
  onClose: () => void
  /** Rejette avec le refus à afficher. Rend les mots de passe que le magasin n'a pas su effacer. */
  onDelete: () => Promise<{ leftoverSecrets: string[] }>
}

/**
 * La confirmation de retrait d'une déclaration de connexion (`08j`).
 *
 * **Le mot « supprimer » n'apparaît nulle part, et c'est la décision centrale de cette spec.** Ce
 * qui part est une *déclaration* sur cet ordinateur ; ce qui reste est un serveur intact. La
 * confusion entre les deux est la seule chose ici qui pourrait coûter des données à quelqu'un,
 * alors trois choses la préviennent :
 *
 * - le titre et le bouton disent **« Retirer … de DoraBase »**, jamais « supprimer la base » ;
 * - la confirmation nomme les deux faits — celui qui inquiète *et* celui qui rassure ;
 * - le bouton porte le **verbe du geste** plutôt qu'un « OK », dernière chance de lire ce qu'on
 *   fait.
 */
export function DeleteConnectionDialog({
  cible,
  modificationsEnAttente,
  onClose,
  onDelete,
}: DeleteConnectionDialogProps) {
  const t = useT()
  const [etat, setEtat] = useState<
    | { phase: 'confirmation' }
    | { phase: 'en-cours' }
    | { phase: 'refuse'; message: string }
    | { phase: 'fait'; leftoverSecrets: string[] }
  >({ phase: 'confirmation' })

  const nom = cible.nom
  const verbe =
    cible.kind === 'folder'
      ? t('explorer.deleteConnection.removeFolder')
      : t('explorer.deleteConnection.removeConnection')

  async function retirer() {
    setEtat({ phase: 'en-cours' })
    try {
      const issue = await onDelete()
      // Comme en `08i` : on ne referme pas sur un fait qui mérite d'être lu.
      if (issue.leftoverSecrets.length > 0) {
        setEtat({ phase: 'fait', leftoverSecrets: issue.leftoverSecrets })
        return
      }
      onClose()
    } catch (erreur) {
      setEtat({ phase: 'refuse', message: String(erreur) })
    }
  }

  const enCours = etat.phase === 'en-cours'

  return (
    <Modal
      title={t('explorer.deleteConnection.title', { nom })}
      icon="trash"
      onClose={onClose}
      footer={
        etat.phase === 'fait' ? (
          <Button variant="dark" size="md" onClick={onClose}>
            {t('explorer.deleteConnection.done')}
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="md" onClick={onClose} disabled={enCours}>
              {t('explorer.deleteConnection.cancel')}
            </Button>
            {/* Le bouton porte le **verbe du geste**, et non « OK » ou « Supprimer » : un bouton qui
                nomme son acte est la dernière chance de lire ce qu'on fait. */}
            <Button variant="dark" size="md" onClick={retirer} disabled={enCours}>
              {enCours ? t('explorer.deleteConnection.removing') : verbe}
            </Button>
          </>
        )
      }
    >
      {etat.phase === 'fait' ? (
        <div className={styles.corps} role="status">
          <p className={styles.titre}>{t('explorer.deleteConnection.doneTitle')}</p>
          <p>
            {etat.leftoverSecrets.length === 1
              ? t('explorer.deleteConnection.leftoverOne')
              : t('explorer.deleteConnection.leftoverMany', {
                  count: etat.leftoverSecrets.length,
                })}
            {t('explorer.deleteConnection.leftoverSuffix')}
          </p>
        </div>
      ) : (
        <div className={styles.corps}>
          <p className={styles.efface}>
            <strong>{t('explorer.deleteConnection.erasedTitle')}</strong>{' '}
            {/* Les accords sont écrits, pas suffixés de « (s) » : la modale la plus lue de
                l'application est celle qui précède un geste irréversible, et un texte bâclé y
                inspire moins confiance qu'ailleurs. */}
            {cible.kind === 'folder'
              ? t('explorer.deleteConnection.erasedFolder', {
                  folder: cible.nom,
                  connexions: connexionsDe(t, cible.connexions),
                })
              : t('explorer.deleteConnection.erasedConnection', { database: cible.nom })}
            {t('explorer.deleteConnection.erasedSuffix')}
          </p>
          {/* **Le fait qui rassure, dit aussi fort que celui qui inquiète.** Sans cette phrase, un
              utilisateur pressé peut lire « supprimer une base de données » et croire qu'il efface
              son serveur de production. */}
          <p className={styles.intact}>
            <strong>{t('explorer.deleteConnection.intactTitle')}</strong>{' '}
            {t('explorer.deleteConnection.intactBody')}
          </p>
          {modificationsEnAttente > 0 && (
            <p className={styles.attention}>
              {modificationsEnAttente === 1
                ? t('explorer.deleteConnection.pendingOne')
                : t('explorer.deleteConnection.pendingMany', {
                    count: modificationsEnAttente,
                  })}{' '}
              {t('explorer.deleteConnection.pendingSuffix')}
            </p>
          )}
          <p className={styles.definitif}>{t('explorer.deleteConnection.noUndo')}</p>
          {etat.phase === 'refuse' && (
            <p className={styles.refus} role="alert">
              {etat.message}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

/** « sa connexion déclarée » ou « ses 3 connexions déclarées » — le compte s'écrit, il ne se suffixe pas. */
function connexionsDe(t: ReturnType<typeof useT>, nombre: number): string {
  if (nombre === 0) return t('explorer.deleteConnection.connexionNone')
  return nombre === 1
    ? t('explorer.deleteConnection.connexionSingular')
    : t('explorer.deleteConnection.connexionPlural', { count: nombre })
}
