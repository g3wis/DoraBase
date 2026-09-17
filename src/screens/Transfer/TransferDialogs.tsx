import { ExportProjects } from './ExportProjects'
import { ImportProjects } from './ImportProjects'
import * as pont from './transferCommands'

/**
 * Ce que la modale de transfert fait, et sur quoi.
 *
 * **Une seule forme pour les deux sens**, et la portée voyage avec l'export : `null` pour tous les
 * projets, un nom pour un seul. Deux états jumeaux — « quel sens » et « quel projet » — auraient
 * permis un import portant un nom de projet, qui ne veut rien dire : ce qu'un import verse est ce
 * que le fichier porte.
 */
export type DemandeDeTransfert = { sens: 'export'; projet: string | null } | { sens: 'import' }

type TransferDialogsProps = {
  demande: DemandeDeTransfert
  /** Le nombre de projets déclarés, pour l'annonce d'un export complet. */
  total: number
  onClose: () => void
  /**
   * Ce qu'un import a rendu : les projets à jour, que `App` repose.
   *
   * **Remonté plutôt que gardé** : c'est ce changement de `projects` qui fait relire les états du
   * registre et purger le cache de l'arbre. Une modale qui garderait la nouvelle configuration pour
   * elle laisserait l'arbre sur celle d'avant jusqu'au prochain « Rafraîchir ».
   */
  onImported: (projects: import('../../domain/config').Project[]) => void
  /** Le pont IPC, injecté pour les tests — voir `transferCommands.ts`. */
  commandes?: typeof pont
}

/**
 * Ce que « Exporter les projets… », « Importer des projets… » et « Exporter le projet… » ouvrent
 * (`API-30`).
 *
 * **Aucune cible à résoudre**, contrairement aux modales de dump : celles-là doivent deviner de
 * quelle base il s'agit, parce que le menu natif n'émet qu'un identifiant d'item et que rien ne
 * transmet la sélection de l'arbre. Ici la portée est soit « tous les projets », soit le projet dont
 * la ligne a ouvert le menu — qui la passe. Il n'y a donc pas de cas « sans cible unique ».
 */
export function TransferDialogs({
  demande,
  total,
  onClose,
  onImported,
  commandes = pont,
}: TransferDialogsProps) {
  if (demande.sens === 'export') {
    return (
      <ExportProjects
        projet={demande.projet}
        total={total}
        onClose={onClose}
        onChoisirFichier={commandes.choisirDestination}
        onExporter={(file, includePasswords) =>
          commandes.exporter({ file, project: demande.projet, includePasswords })
        }
      />
    )
  }

  return (
    <ImportProjects
      onClose={onClose}
      onChoisirFichier={commandes.choisirSource}
      onInspecter={commandes.inspecter}
      onImporter={async (file, projets) => {
        const resultat = await commandes.importer(file, projets)
        onImported(resultat.projects)
        return resultat.report
      }}
    />
  )
}
