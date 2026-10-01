import { useCallback, useState } from 'react'
import { applyChanges } from '../../data/commandes'
import type { DatabaseKey } from '../../domain/arbre'
import type { ApplyOutcome, ColumnInfo, UpdatePlan } from '../../domain/engine'
import type { EnAttente } from './modifications'
import { planDuModele } from './useSqlPrevu'

/** Ce qui appelle la commande d'écriture. Injectable : le pont ne répond pas hors de la webview. */
export type PasserelleApply = {
  applyChanges: (key: DatabaseKey, plan: UpdatePlan) => Promise<ApplyOutcome>
}

export const PASSERELLE_APPLY: PasserelleApply = { applyChanges }

export type Application = {
  /** Écrit les modifications en attente. */
  demander: () => void
  enCours: boolean
  refus: string | null
  /** Le SQL qui annule la dernière écriture réussie. */
  patchInverse: string | null
  /** Écarte le rapport d'écriture — le panneau revient à son état de lecture. */
  ecarterLePatch: () => void
}

/**
 * L'application des modifications en attente (`11d`).
 *
 * **Plus de confirmation de production** (#168). Elle s'ouvrait sur le drapeau `production` des
 * environnements, qui a disparu avec eux ; ce qui le remplace, la lecture seule héritée d'un dossier,
 * ne *confirme* pas — elle **refuse** : l'écran n'entre pas en mode édition, et le cœur refuse
 * `apply_changes` sur une connexion en lecture seule effective. Une connexion qui écrit a donc été
 * rendue inscriptible par quelqu'un, et le panneau des modifications montre déjà le SQL exact qui
 * partira : une seconde question n'y ajouterait rien. C'est la conséquence assumée de l'arbitrage
 * « la lecture seule remplace `production` ».
 *
 * **Le plan est construit par la même fonction que la prévisualisation** (`planDe`) : deux
 * traductions divergeraient, et l'écart tomberait sur les cas rares — une valeur attendue nulle, une
 * chaîne vide. C'est ce qui garantit qu'on écrit ce qui a été montré.
 */
export function useApplication(
  cle: DatabaseKey | null,
  cible: { schema: string; table: string } | null,
  attente: EnAttente,
  colonnes: readonly ColumnInfo[],
  options: { passerelle: PasserelleApply; surSucces: () => void },
): Application {
  const [enCours, setEnCours] = useState(false)
  const [refus, setRefus] = useState<string | null>(null)
  const [patchInverse, setPatchInverse] = useState<string | null>(null)

  const { passerelle, surSucces } = options
  const cleColonne = colonnes.find((colonne) => colonne.key === 'primary')?.name ?? ''

  const demander = useCallback(() => {
    if (cle === null || cible === null || attente.length === 0) return
    setEnCours(true)
    setRefus(null)
    const plan: UpdatePlan = planDuModele(cible, cleColonne, attente)
    passerelle
      .applyChanges(cle, plan)
      .then((issue) => {
        setEnCours(false)
        // **Le patch est posé avant de vider le modèle** : `surSucces` fait disparaître les cartes,
        // et l'utilisateur doit retrouver de quoi défaire à la place, non un panneau vide.
        setPatchInverse(issue.inverseSql)
        surSucces()
      })
      .catch((erreur: unknown) => {
        setEnCours(false)
        // Le refus s'affiche dans le panneau — celui de la lecture seule compris, que le cœur
        // prononce avec le dossier qui l'impose.
        setRefus(messageDe(erreur))
      })
  }, [attente, cible, cle, cleColonne, passerelle, surSucces])

  return {
    demander,
    enCours,
    refus,
    patchInverse,
    ecarterLePatch: () => setPatchInverse(null),
  }
}

function messageDe(erreur: unknown): string {
  if (typeof erreur === 'string') return erreur
  if (erreur instanceof Error) return erreur.message
  if (erreur !== null && typeof erreur === 'object' && 'message' in erreur) {
    return String((erreur as { message: unknown }).message)
  }
  return 'l’écriture a échoué'
}
