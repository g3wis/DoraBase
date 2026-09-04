import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useEffect, useRef } from 'react'
import { estMacos, modificateurActif, type Plateforme, plateforme } from './plateforme'
import { facteurSuivant, ZOOM_NEUTRE } from './zoom'

export type PasserelleZoom = {
  /** Applique un facteur à la webview. */
  appliquer: (facteur: number) => Promise<void>
}

export const PASSERELLE_ZOOM: PasserelleZoom = {
  appliquer: (facteur) => getCurrentWebview().setZoom(facteur),
}

/**
 * Sous Tauri, et seulement là.
 *
 * Le zoom est une capacité de la **coquille**, pas un style de la page : c'est la webview entière qui
 * grossit, barres de défilement comprises. Dans un navigateur — donc en développement, dans la
 * galerie et sous Playwright — il n'y a pas de webview à piloter, et reprendre le geste pour ne rien
 * en faire retirerait le zoom du navigateur sans rien offrir à la place. Le geste y reste donc natif.
 */
function dansTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Le zoom au geste, à pas fin (`⌘` + molette), et le **refus** du pincement au trackpad.
 *
 * # Pourquoi reprendre un geste que la webview traite déjà
 *
 * WKWebView zoome de dix à vingt-cinq pour cent par cran : deux crans et la grille est méconnaissable.
 * Aucun réglage n'expose ce pas — c'est une constante du moteur. La seule façon de l'adoucir est
 * d'intercepter le geste et d'appliquer son propre facteur, ce que fait ce crochet. Signalé à l'usage
 * le 19 août 2026.
 *
 * # Le pincement ne zoome plus du tout (26 août 2026, à la demande)
 *
 * WebKit et Chromium traduisent tous deux le pincement du trackpad en `wheel` avec `ctrlKey` — une
 * convention, pas un accident. C'est ce qui permettait de couvrir les deux gestes d'un seul écouteur ;
 * c'est aussi ce qui permet de les **séparer**, et c'est ce qui est fait ici : `ctrlKey` sans `metaKey`
 * est le pincement, et il est refusé.
 *
 * La raison est celle d'un outil de bureau : le pincement se déclenche tout seul, en glissant deux
 * doigts sur le trackpad pour défiler une grille. L'interface changeait d'échelle sans que personne
 * l'ait demandé, et retrouver la taille d'origine demandait de connaître `⌘0`. Un geste de zoom
 * intentionnel se fait à deux mains — `⌘` et la molette — et celui-là reste.
 *
 * **Le refus est actif, il n'est pas une abstention** : sans `preventDefault`, ignorer l'événement
 * laisserait la webview appliquer son propre zoom, celui de dix à vingt-cinq pour cent.
 *
 * **Et il vaut dans le navigateur aussi**, contrairement au zoom fin qui ne vaut que sous Tauri. Deux
 * raisons : `pnpm dev` doit se comporter comme l'application livrée — c'est ce que la fenêtre native,
 * invisible à Playwright, ne permet pas de vérifier autrement — et un refus qui ne vivrait que sous
 * Tauri ne serait couvert par aucun test. Le zoom du navigateur reste atteignable au clavier
 * (`⌘ +`/`⌘ -`), donc rien n'est perdu en développement.
 *
 * # Hors macOS, le refus tombe (31 août 2026, Linux le 4 septembre 2026)
 *
 * `Ctrl` + molette y **est** le geste de zoom volontaire — sous Windows comme sous GTK —, et le
 * pincement du pavé de précision arrive par le même événement : cette fois ils sont
 * indiscernables pour de bon. Les deux tombent donc dans le zoom à pas fin. Le détail est dans
 * `auGeste`.
 *
 * `sur` est un paramètre pour la même raison que `passerelle` : sans lui, `estMacos()` lisant
 * une constante de compilation, la branche hors macOS n'aurait été exercée par aucun test —
 * celle qui vient d'être écrite, donc, et pas celle qui marchait déjà.
 */
export function useZoom(
  passerelle: PasserelleZoom = PASSERELLE_ZOOM,
  sur: Plateforme = plateforme(),
) {
  const facteur = useRef(ZOOM_NEUTRE)

  useEffect(() => {
    function auGeste(evenement: WheelEvent) {
      // **Le pincement du trackpad : refusé, et rien d'autre.** `ctrlKey` sans `metaKey` ne peut venir
      // que de lui ou d'un `ctrl` + molette à la souris, que rien ne distingue — et personne n'emploie
      // le second sur ce système. `passive: false` plus `preventDefault` : sans les deux, la webview
      // applique son propre zoom par-dessus notre abstention.
      //
      // **Et ce refus est macOS seulement, parce que sa prémisse l'est** (31 août 2026). Il tient
      // à ce que `ctrl` + molette ne soit *pas* un geste de zoom sur ce système : `⌘` l'est, donc
      // `ctrl` ne peut être que le pincement, donc le refuser ne coûte rien. Ailleurs — Windows
      // et les bureaux Linux —, `Ctrl` + molette **est** le geste de zoom, celui de tous les
      // logiciels, et le pincement du pavé de précision arrive par le même événement —
      // indiscernables, cette fois pour de bon. Les refuser tous les deux retirerait le zoom au
      // lieu de l'adoucir ; ils tombent donc ensemble dans le zoom à pas fin, juste en dessous.
      //
      // Ce n'est pas un retour en arrière sur la décision du 26 août : ce qu'elle refuse — que
      // l'interface change d'échelle sans qu'on l'ait demandé — n'a pas lieu là où le geste est
      // volontaire.
      if (estMacos(sur) && evenement.ctrlKey && !evenement.metaKey) {
        evenement.preventDefault()
        return
      }
      if (!dansTauri() || !modificateurActif(evenement, sur)) return
      // Même nécessité de `preventDefault` ici : sans lui, le pas natif s'ajoute au nôtre.
      evenement.preventDefault()
      const suivant = facteurSuivant(facteur.current, evenement.deltaY)
      if (suivant === facteur.current) return
      facteur.current = suivant
      void passerelle.appliquer(suivant)
    }

    function auClavier(evenement: KeyboardEvent) {
      if (!dansTauri()) return
      // `⌘0` rend sa taille d'origine, comme partout ailleurs. Sans ce retour, un zoom fin est long à
      // défaire — c'est le corollaire d'un petit pas.
      if (!(modificateurActif(evenement, sur) && evenement.key === '0')) return
      evenement.preventDefault()
      facteur.current = ZOOM_NEUTRE
      void passerelle.appliquer(ZOOM_NEUTRE)
    }

    /**
     * Les `GestureEvent` de WebKit, refusés aussi.
     *
     * Non standard, propres à Safari, et **invérifiables depuis ce poste** : Chromium ne les émet pas,
     * donc aucun test de ce dépôt ne peut les voir passer. Ils sont refusés par précaution parce que le
     * coût est de trois lignes et que le pincement du trackpad les déclenche sous WebKit en même temps
     * que le `wheel` ci-dessus. Si le refus du `wheel` suffit, ces trois lignes ne font rien ; s'il ne
     * suffit pas, elles sont ce qui manque. À ne pas présenter comme vérifié.
     */
    function auPincement(evenement: Event) {
      evenement.preventDefault()
    }

    window.addEventListener('wheel', auGeste, { passive: false })
    window.addEventListener('keydown', auClavier)
    for (const nom of ['gesturestart', 'gesturechange', 'gestureend'])
      window.addEventListener(nom, auPincement, { passive: false })
    return () => {
      window.removeEventListener('wheel', auGeste)
      window.removeEventListener('keydown', auClavier)
      for (const nom of ['gesturestart', 'gesturechange', 'gestureend'])
        window.removeEventListener(nom, auPincement)
    }
  }, [passerelle, sur])
}
