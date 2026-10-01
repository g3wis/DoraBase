import { useT } from '../../i18n/LanguageContext'
import { Button } from '../../ui/Button/Button'
import { Modal } from '../../ui/Modal/Modal'
import styles from './RenameReportDialog.module.css'

export type RapportDeRenommage = {
  /** Le nom visé — celui qu'on voulait donner. */
  nom: string
  /** Le refus du cœur. Rien n'a été renommé. */
  refus: string
}

type RenameReportDialogProps = {
  rapport: RapportDeRenommage
  onClose: () => void
}

/**
 * Le refus d'un renommage sur place (`26`) — dossier ou connexion.
 *
 * Le renommage se fait **dans la ligne d'arbre** : il n'y a donc aucun écran où loger un refus, d'où
 * cette modale. **Elle ne dit plus que le refus** (#166) : un nom n'étant plus dans aucune identité,
 * renommer ne déplace aucun mot de passe, et les deux réserves sur le Trousseau qu'elle portait
 * n'ont plus de cause. Le succès reste muet : la ligne porte le nouveau nom.
 */
export function RenameReportDialog({ rapport, onClose }: RenameReportDialogProps) {
  const t = useT()
  return (
    <Modal
      title={t('explorer.renameReport.refusedTitle', { nom: rapport.nom })}
      icon="warn"
      onClose={onClose}
      footer={
        <Button variant="dark" size="md" onClick={onClose}>
          {t('explorer.renameReport.done')}
        </Button>
      }
    >
      <div className={styles.corps} role="status">
        <p className={styles.refus}>{rapport.refus}</p>
        {/* **Le fait qui rassure, dit aussi fort que celui qui inquiète** — la règle de `08j` : un
            refus de renommage laisse tout en place. */}
        <p>{t('explorer.renameReport.reassurance')}</p>
      </div>
    </Modal>
  )
}
