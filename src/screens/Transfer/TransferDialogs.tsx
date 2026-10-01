import type { FolderId, FolderTree } from '../../domain/config'
import { ExportProjects } from './ExportProjects'
import { ImportProjects } from './ImportProjects'
import * as pont from './transferCommands'

/**
 * Ce que la modale de transfert fait, et sur quoi.
 *
 * **Une seule forme pour les deux sens**, et la portée voyage avec l'export : `null` pour tout
 * l'arbre, un dossier pour lui seul (#169). Deux états jumeaux — « quel sens » et « quel dossier » —
 * auraient permis un import portant un dossier, qui ne veut rien dire : ce qu'un import verse est ce
 * que le fichier porte, et il le verse à la racine.
 */
export type DemandeDeTransfert =
  | { sens: 'export'; dossier: { id: FolderId; nom: string } | null }
  | { sens: 'import' }

type TransferDialogsProps = {
  demande: DemandeDeTransfert
  /** Le nombre de dossiers racines, pour l'annonce d'un export complet. */
  total: number
  onClose: () => void
  /**
   * Ce qu'un import a rendu : l'arbre à jour, que `App` repose.
   *
   * **Remonté plutôt que gardé** : c'est ce changement d'arbre qui fait relire les états du
   * registre et purger le cache de l'arbre. Une modale qui garderait la nouvelle configuration pour
   * elle laisserait l'arbre sur celle d'avant jusqu'au prochain « Rafraîchir ».
   */
  onImported: (arbre: FolderTree) => void
  /** Le pont IPC, injecté pour les tests — voir `transferCommands.ts`. */
  commandes?: typeof pont
}

/**
 * Ce que « Tout exporter… », « Importer des dossiers… » et « Exporter le dossier… » ouvrent
 * (`API-30`, #169).
 *
 * **Aucune cible à résoudre**, contrairement aux modales de dump : celles-là doivent deviner de
 * quelle base il s'agit, parce que le menu natif n'émet qu'un identifiant d'item et que rien ne
 * transmet la sélection de l'arbre. Ici la portée est soit « tout l'arbre », soit le dossier dont
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
        dossier={demande.dossier?.nom ?? null}
        total={total}
        onClose={onClose}
        onChoisirFichier={commandes.choisirDestination}
        onExporter={(file, includePasswords) =>
          commandes.exporter({ file, folder: demande.dossier?.id ?? null, includePasswords })
        }
      />
    )
  }

  return (
    <ImportProjects
      onClose={onClose}
      onChoisirFichier={commandes.choisirSource}
      onInspecter={commandes.inspecter}
      onImporter={async (file, selection) => {
        const resultat = await commandes.importer(file, selection)
        onImported(resultat.tree)
        return resultat.report
      }}
    />
  )
}
