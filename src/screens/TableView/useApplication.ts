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
  /** Demande l'application — passe par la confirmation en production, écrit directement sinon. */
  demander: () => void
  /** Écrit pour de bon. Appelé par la confirmation, ou directement hors production. */
  appliquer: () => void
  annulerLaConfirmation: () => void
  /** Vrai quand la confirmation de production est ouverte. */
  confirmation: boolean
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
 * **La confirmation dépend du drapeau `production` de la déclaration**, pas d'une devinette sur le
 * nom de l'hôte — un serveur nommé `db-prod-replica` peut être une copie de travail — et pas non plus
 * de l'identifiant d'environnement. Cette ligne comparait `cle.environment` à la chaîne `'prod'` :
 * un environnement nommé « live » et marqué production n'ouvrait donc **pas** la confirmation, et un
 * « prod » que l'utilisateur n'avait pas marqué l'ouvrait. C'est exactement la garantie que `23g`
 * refuse d'accrocher à une chaîne de caractères, parce qu'elle devient fausse au premier renommage.
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
  options: { passerelle: PasserelleApply; surSucces: () => void; production?: boolean },
): Application {
  const [confirmation, setConfirmation] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const [refus, setRefus] = useState<string | null>(null)
  const [patchInverse, setPatchInverse] = useState<string | null>(null)

  const { passerelle, surSucces, production = false } = options
  const cleColonne = colonnes.find((colonne) => colonne.key === 'primary')?.name ?? ''

  const appliquer = useCallback(() => {
    if (cle === null || cible === null || attente.length === 0) return
    setEnCours(true)
    setRefus(null)
    const plan: UpdatePlan = planDuModele(cible, cleColonne, attente)
    passerelle
      .applyChanges(cle, plan)
      .then((issue) => {
        setEnCours(false)
        setConfirmation(false)
        // **Le patch est posé avant de vider le modèle** : `surSucces` fait disparaître les cartes,
        // et l'utilisateur doit retrouver de quoi défaire à la place, non un panneau vide.
        setPatchInverse(issue.inverseSql)
        surSucces()
      })
      .catch((erreur: unknown) => {
        setEnCours(false)
        // **La confirmation reste ouverte sur un échec**, et le refus s'affiche dans le panneau :
        // fermer la sous-modale donnerait l'impression que l'écriture a eu lieu.
        setRefus(messageDe(erreur))
        setConfirmation(false)
      })
  }, [attente, cible, cle, cleColonne, passerelle, surSucces])

  const demander = useCallback(() => {
    setRefus(null)
    if (production) {
      setConfirmation(true)
      return
    }
    appliquer()
  }, [appliquer, production])

  return {
    demander,
    appliquer,
    annulerLaConfirmation: () => setConfirmation(false),
    confirmation,
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
