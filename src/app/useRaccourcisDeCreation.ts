import { useEffect } from 'react'
import { seulLeModificateur } from '../shell/plateforme'

type Gestes = {
  /** `⌘N`. */
  nouveauDossier: () => void
}

/**
 * Le raccourci de création (`24d`) : `⌘N` crée un dossier à la racine (#166), là où il ouvrait
 * « Nouveau projet » — le même geste que la bande de tête de l'arbre et le bouton de l'accueil.
 *
 * # Pourquoi il vit ici, et pas dans les écrans
 *
 * `⌘N` était monté par `WelcomeScreen`, donc il ne répondait que sur `A1` — la spec le veut « sur tous
 * les écrans », et un raccourci par écran finit par diverger : celui de `A4` n'aurait jamais existé.
 * `App` est le seul composant que les deux écrans ont en commun, et c'est aussi lui qui tient les
 * états que ce geste ouvre.
 *
 * **`⌘N` garde le même sens partout**, contre la recommandation de la conception UX qui suivait la
 * fréquence (`⌘N` devenant « Nouvelle connexion » sur `A4`) : un raccourci qui change de sens selon
 * l'écran demande de savoir où l'on est avant de le presser. Arbitrage du commanditaire du 19 août
 * 2026, consigné dans `24d`.
 *
 * # `⇧⌘N` a été retiré (26 août 2026, à la demande)
 *
 * Il ouvrait « Ajouter une connexion ». Une connexion se range dans un dossier, et **un raccourci
 * clavier ne désigne rien** : il fallait donc deviner lequel, ce qui revenait à retomber sur le
 * premier de la liste. C'est le défaut que le pied de la sidebar avait déjà, et qui
 * l'a fait disparaître le même jour ; le garder ici en aurait laissé la moitié.
 *
 * Le geste n'est pas perdu : il part du menu d'une ligne de dossier, seul endroit qui sache où la
 * connexion se déclare.
 *
 * **Et `⇧⌘N` cesse d'être à nous** : plus de `preventDefault` dessus. Le reprendre pour ne rien en
 * faire serait un raccourci mort qui avale une frappe — la même règle que pour les deux refus
 * ci-dessous.
 *
 * # Ce qu'il refuse de faire
 *
 * **Rien pendant qu'une modale est ouverte.** Un `⌘N` frappé devant `A2` ferait naître un dossier
 * derrière un formulaire en cours de saisie, sans le dire — c'est la perte silencieuse que `12c`
 * refuse déjà ailleurs. La présence d'un `[role=dialog]` est le test : il vaut pour les modales à
 * venir sans que ce fichier ait à les connaître.
 *
 * **Rien dans une zone de saisie**, pour la même raison qu'un `⌘E` : `⌘N` n'a pas de sens dans un
 * champ, et frappé de travers pendant qu'on tape une requête il ne doit pas emporter l'écran.
 */
export function useRaccourcisDeCreation({ nouveauDossier }: Gestes) {
  useEffect(() => {
    function auClavier(evenement: KeyboardEvent) {
      if (evenement.key.toLowerCase() !== 'n') return
      // `⇧⌘N` n'est plus à nous : on le laisse passer sans le consommer. La touche à
      // exclure n'est pas la même sur les deux plateformes — voir `seulLeModificateur`.
      if (!seulLeModificateur(evenement)) return
      if (document.querySelector('[role=dialog]') !== null) return
      const cible = evenement.target
      if (
        cible instanceof HTMLElement &&
        (cible.isContentEditable || cible.matches('input, textarea'))
      )
        return
      // **Après les refus, jamais avant** : sans cette ligne le navigateur ouvre une fenêtre, et dans
      // les cas rendus au-dessus c'est voulu — là, le raccourci n'est pas à nous.
      evenement.preventDefault()
      nouveauDossier()
    }
    window.addEventListener('keydown', auClavier)
    return () => window.removeEventListener('keydown', auClavier)
  }, [nouveauDossier])
}
