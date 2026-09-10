import { useEffect, useState } from 'react'
import type { ConfigLoad, Preferences } from '../domain/config'
import { PREFERENCES_PAR_DEFAUT } from '../screens/Preferences/preferences'
import { type EtatDeConfiguration, interpreter, loadConfig } from './commandes'

/**
 * Lit la configuration au démarrage.
 *
 * **C'est le premier appel de `load_config` du projet.** La commande existe depuis `05b` et
 * n'était appelée par personne, faute d'écran affichant des projets — conséquence : une base
 * enregistrée par `08e` était bien écrite sur le disque mais jamais relue au lancement suivant.
 * `09b` ferme cette boucle.
 *
 * L'état `chargement` est distinct d'un état vide : afficher `A1` (« aucun projet ») pendant la
 * lecture ferait clignoter l'écran d'accueil devant un utilisateur qui a dix projets.
 */
export type EtatDeDemarrage =
  | { kind: 'chargement' }
  | EtatDeConfiguration
  /** La commande elle-même a échoué — pont cassé, panique. Distinct d'un fichier illisible. */
  | {
      kind: 'injoignable'
      projects: never[]
      preferences: Preferences
      /** Vide, comme les projets : rien n'est connu du disque quand le pont ne répond pas. */
      instances: never[]
      reason: string
    }

export function useConfiguration(charger: () => Promise<ConfigLoad> = loadConfig): EtatDeDemarrage {
  const [etat, setEtat] = useState<EtatDeDemarrage>({ kind: 'chargement' })

  useEffect(() => {
    let vivant = true
    charger()
      .then((issue) => {
        if (vivant) setEtat(interpreter(issue))
      })
      .catch((cause) => {
        // Distinct d'un fichier illisible : là le fichier est en cause et l'écriture est
        // bloquée par `05b` ; ici c'est l'app qui ne répond pas, et rien ne dit ce qu'il y a
        // sur le disque. Les confondre proposerait de restaurer un fichier qui va peut-être
        // très bien.
        if (vivant) {
          setEtat({
            kind: 'injoignable',
            projects: [],
            instances: [],
            // Les défauts : sans jetons, le message qui explique la panne serait illisible.
            preferences: PREFERENCES_PAR_DEFAUT,
            reason: messageDe(cause),
          })
        }
      })
    // Le drapeau évite de poser un état après démontage : React le signalerait en avertissement,
    // et surtout un écran démonté n'a rien à afficher.
    return () => {
      vivant = false
    }
  }, [charger])

  return etat
}

function messageDe(cause: unknown): string {
  if (typeof cause === 'string') return cause
  if (cause && typeof cause === 'object' && 'message' in cause) {
    return String((cause as { message: unknown }).message)
  }
  return String(cause)
}
