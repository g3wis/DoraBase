import { useCallback, useEffect, useState } from 'react'
import { readRows } from '../../data/commandes'
import type { DatabaseKey } from '../../domain/arbre'
import type { RowQuery, RowWindow } from '../../domain/engine'

export type PasserelleLignes = { readRows: typeof readRows }

export const PASSERELLE_LIGNES: PasserelleLignes = { readRows }

/** Le palier de départ du stepper de `A5`. `10e` le rendra réglable. */
export const LIMITE_PAR_DEFAUT = 'fiveHundred' as const

export type EtatLignes = {
  fenetre: RowWindow | null
  loading: boolean
  error: string | null
  /** Relance la requête **courante** — le bouton « Rafraîchir » de la toolbar (`10e`). */
  relire: () => void
}

/**
 * La fenêtre de lignes d'une table.
 *
 * **Jamais un jeu complet.** `RowWindow` porte au plus `RowLimit` lignes, et `RowLimit` est une
 * énumération fermée depuis `06a` : « tout » n'est pas exprimable. C'est ici que la contrainte
 * IPC transverse est exercée pour la première fois par un écran.
 *
 * L'`offset` reste à 0 : `A5` montre au plus une fenêtre, et sa barre d'état le dit. La
 * pagination au-delà n'est pas dans `10c`, et le mockup ne la montre pas.
 */
export function useLignes(
  key: DatabaseKey | null,
  query: RowQuery | null,
  passerelle: PasserelleLignes = PASSERELLE_LIGNES,
  /**
   * Un compteur **externe** de relecture, pour les écrans qui savent que la base a changé.
   *
   * `11d` en a besoin : après une écriture, la grille doit relire — les valeurs écrites peuvent
   * différer de celles saisies (un `trigger`, une valeur par défaut, une troncature). L'écriture est
   * déclenchée depuis le panneau droit, que l'écran de travail monte, alors que la lecture vit ici.
   * Un compteur qui descend est plus simple qu'une fonction qui remonte, et ne crée pas de référence
   * mutable partagée entre deux composants.
   */
  tourExterne = 0,
): EtatLignes {
  const [fenetre, setFenetre] = useState<RowWindow | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Un compteur, et non un drapeau : rafraîchir deux fois de suite doit relire deux fois, ce
  // qu'un booléen remis à zéro ne permettrait pas.
  const [tour, setTour] = useState(0)

  // L'identifiant plutôt que l'objet : une `DatabaseKey` reconstruite à chaque rendu
  // relancerait la lecture indéfiniment — le même piège qu'en `useDetailTable`. La requête, elle,
  // est mémoïsée par l'appelant : c'est **son** changement qui relance la lecture, filtre et tri
  // compris. Filtrer la fenêtre déjà reçue serait immédiat et faux.
  const connection = key?.connection ?? null

  // `tour` ne sert qu'à relancer cet effet : le lire dedans n'aurait aucun sens, mais il **doit**
  // figurer dans les dépendances, sans quoi « Rafraîchir » ne rafraîchirait rien. Le suppresseur
  // est la dernière ligne de commentaire avant le nœud.
  // biome-ignore lint/correctness/useExhaustiveDependencies: voir ci-dessus
  useEffect(() => {
    if (!connection || !query) {
      setFenetre(null)
      setLoading(false)
      setError(null)
      return
    }
    let vivant = true
    setLoading(true)
    setError(null)
    passerelle
      .readRows({ connection }, query)
      .then((resultat) => {
        if (vivant) {
          setFenetre(resultat)
          setLoading(false)
        }
      })
      .catch((cause) => {
        if (vivant) {
          setFenetre(null)
          setLoading(false)
          setError(message(cause))
        }
      })
    return () => {
      vivant = false
    }
  }, [connection, query, passerelle, tour, tourExterne])

  const relire = useCallback(() => setTour((precedent) => precedent + 1), [])

  return { fenetre, loading, error, relire }
}

function message(cause: unknown): string {
  if (typeof cause === 'string') return cause
  if (cause && typeof cause === 'object' && 'message' in cause) {
    return String((cause as { message: unknown }).message)
  }
  return String(cause)
}
