import { useEffect, useRef, useState } from 'react'
import { describeTable } from '../../data/commandes'
import type { DatabaseKey } from '../../domain/arbre'
import type { TableDetail } from '../../domain/engine'
import type { Structures } from './useStructures'

export type PasserelleDetail = { describeTable: typeof describeTable }

export const PASSERELLE_DETAIL: PasserelleDetail = { describeTable }

export type EtatDetail = {
  detail: TableDetail | null
  loading: boolean
  error: string | null
}

/**
 * Le détail d'une table — colonnes, index, relations, DDL.
 *
 * `describe_table` existe depuis `06c` et n'était appelée par personne : `09f` a livré le
 * panneau de détail, la galerie le nourrit de données figées, et aucun écran ne lui en donnait
 * de vraies. C'est le même motif que `load_config` avant `09b`.
 *
 * **Rien n'est demandé sans cible.** Sans table désignée, l'état est vide et aucune commande ne
 * part : sélectionner d'office la première ligne déclencherait une requête que l'utilisateur n'a
 * pas demandée — l'argument que `09f` avait déjà retenu pour son état vide.
 *
 * # Le cache d'abord
 *
 * Une structure déjà en mémoire est rendue **sans passer par `loading`** : un état de chargement sur
 * une donnée qu'on a déjà ferait clignoter le panneau pour rien. Ce qui est chargé ici est *posé* dans
 * le cache, sans quoi une table hors plafond de préchauffage paierait son aller-retour à chaque
 * ouverture.
 *
 * Le cache est **optionnel** : la galerie et les tests qui ne portent pas sur lui s'en passent, et
 * l'ancien comportement — toujours demander — est exactement ce qu'ils obtiennent.
 */
export function useDetailTable(
  key: DatabaseKey | null,
  schema: string | null,
  table: string | null,
  passerelle: PasserelleDetail = PASSERELLE_DETAIL,
  structures?: Structures,
  /**
   * Compteur de relecture, sur le modèle de `useLignes`.
   *
   * L'incrémenter relit la structure **même si la cible n'a pas changé** — c'est exactement le cas du
   * bouton « Rafraîchir », qui vide le cache pour cette table et veut la revoir. Sans lui, oublier une
   * structure ne relancerait rien : les dépendances de cet effet sont la cible, pas le cache.
   */
  relecture = 0,
): EtatDetail {
  const [etat, setEtat] = useState<EtatDetail>({ detail: null, loading: false, error: null })
  /**
   * Le cache, **lu et jamais surveillé**.
   *
   * Par une ref, et c'est la seule subtilité de ce hook : l'objet change à chaque structure qui
   * arrive du préchauffage, donc en dépendre relancerait cet effet des centaines de fois pendant la
   * cascade — et redemanderait la table ouverte à chaque tour. Ce qui décide de relire est la
   * **cible**, pas l'état du cache.
   */
  const cache = useRef(structures)
  cache.current = structures

  // L'identifiant de la clé plutôt que l'objet : une `DatabaseKey` reconstruite à chaque
  // rendu relancerait la lecture indéfiniment.
  const connection = key?.connection ?? null

  // `relecture` ne sert qu'à relancer cet effet : le lire dedans n'aurait aucun sens, mais il
  // **doit** figurer dans les dépendances, sans quoi « Rafraîchir » ne relirait pas la structure. Le
  // même motif qu'en `useLignes`, avec le même suppresseur — dernière ligne de commentaire avant le
  // nœud.
  // biome-ignore lint/correctness/useExhaustiveDependencies: voir ci-dessus
  useEffect(() => {
    if (!connection || !schema || !table) {
      setEtat({ detail: null, loading: false, error: null })
      return
    }
    const cle = { connection }
    // **Le cache court-circuite tout**, y compris l'état de chargement : c'est l'ouverture
    // instantanée qu'un cache de structures permet.
    const enMemoire = cache.current?.detail(cle, schema, table)
    if (enMemoire) {
      setEtat({ detail: enMemoire, loading: false, error: null })
      return
    }

    let vivant = true
    setEtat({ detail: null, loading: true, error: null })
    passerelle
      .describeTable(cle, schema, table)
      .then((detail) => {
        // Posé même si ce hook n'est plus vivant : la structure est bonne, et la prochaine ouverture
        // n'a pas à la redemander parce qu'un onglet s'est fermé entre-temps.
        cache.current?.poser(cle, schema, table, detail)
        if (vivant) setEtat({ detail, loading: false, error: null })
      })
      .catch((cause) => {
        if (vivant) setEtat({ detail: null, loading: false, error: message(cause) })
      })
    return () => {
      vivant = false
    }
  }, [connection, schema, table, passerelle, relecture])

  return etat
}

function message(cause: unknown): string {
  if (typeof cause === 'string') return cause
  if (cause && typeof cause === 'object' && 'message' in cause) {
    return String((cause as { message: unknown }).message)
  }
  return String(cause)
}
