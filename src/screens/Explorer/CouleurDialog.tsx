import { useState } from 'react'
import type { FolderColor } from '../../domain/config'
import { useT } from '../../i18n/LanguageContext'
import { Button } from '../../ui/Button/Button'
import { Modal } from '../../ui/Modal/Modal'
import { Nuancier } from './Nuancier'

type CouleurDialogProps = {
  /** Le nom du dossier, pour le titre. */
  nom: string
  couleur: FolderColor | null
  /** Applique la couleur ; rejette avec le refus du cœur. */
  onRecolorer: (couleur: FolderColor | null) => Promise<void>
  onClose: () => void
}

/**
 * « Couleur… » d'un dossier (#166) : une petite modale autour du nuancier.
 *
 * **Une modale et non un sous-menu** : `RowMenu` n'a que des entrées simples, et un sous-menu serait
 * un composant de plus à concevoir pour cinq pastilles.
 *
 * **La couleur s'applique au clic**, comme dans l'éditeur de projet dont le nuancier est extrait :
 * un bouton « Appliquer » demanderait deux gestes pour un réglage sans conséquence. « Terminé » ne
 * fait que fermer.
 */
export function CouleurDialog({ nom, couleur, onRecolorer, onClose }: CouleurDialogProps) {
  const t = useT()
  const [choisie, setChoisie] = useState<FolderColor | null>(couleur)
  const [refus, setRefus] = useState<string | null>(null)

  const choisir = async (suivante: FolderColor | null) => {
    const avant = choisie
    setChoisie(suivante)
    setRefus(null)
    try {
      await onRecolorer(suivante)
    } catch (erreur) {
      // Un refus défait le geste à l'écran : garder la pastille choisie montrerait une couleur que
      // le disque ne porte pas.
      setChoisie(avant)
      setRefus(String(erreur))
    }
  }

  return (
    <Modal
      title={t('explorer.colorDialog.title', { nom })}
      icon="pin"
      onClose={onClose}
      compact
      footer={
        <Button variant="dark" size="md" onClick={onClose}>
          {t('explorer.colorDialog.done')}
        </Button>
      }
    >
      <Nuancier
        name="couleur-du-dossier"
        valeur={choisie}
        onChange={(suivante) => void choisir(suivante)}
        label={t('explorer.colorDialog.label', { nom })}
        labelAucune={t('explorer.colorDialog.none')}
      />
      {refus !== null && <p role="alert">{refus}</p>}
    </Modal>
  )
}
