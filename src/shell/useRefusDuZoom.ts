import { useEffect } from 'react'

/**
 * Les trois événements de pincement de WebKit, non standard et propres à Safari.
 *
 * Chromium ne les émet pas, donc aucun test de ce dépôt ne peut les voir passer : ils sont refusés
 * parce qu'ils sont, dans WebKit, la façon dont un pincement de trackpad arrive au document —
 * `wheel` avec `ctrlKey` en étant l'autre. À ne pas présenter comme vérifié.
 */
const PINCEMENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const

/**
 * **L'application n'a aucun zoom global, et le refuse activement** (`API-57`, 14 septembre 2026).
 *
 * # Ce qui a été retiré, et pourquoi
 *
 * Il y avait ici un zoom à pas fin — `⌘` / `Ctrl` + molette appliquant son propre facteur à la
 * webview, `⌘0` le rendant à l'origine —, écrit le 19 août 2026 parce que le pas natif de WKWebView
 * va de dix à vingt-cinq pour cent par cran. Le pincement, lui, était déjà refusé depuis le 26 août.
 * Ce partage ne tient plus : sur un trackpad, le geste que l'on refusait et celui que l'on offrait
 * **sont le même geste à un doigt près**, et il suffit de garder `⌘` enfoncé en défilant pour que
 * l'interface change d'échelle sans que personne l'ait demandé. C'est exactement le défaut que le
 * refus du pincement existait pour corriger, par la porte d'à côté.
 *
 * Un explorateur de bases de données est un outil de bureau dont la densité est *décidée* — 11 px de
 * grille, une échelle d'espacement sans 8 px. Le zoom qui a du sens ici est celui d'une **vue** : les
 * paliers du diagramme de schéma, qui sont des boutons et ne bougent pas le reste de l'écran. Le zoom
 * **global**, lui, n'a plus de position allumée.
 *
 * # Le refus est actif, et sans exception de plateforme
 *
 * **Actif** : s'abstenir laisserait la webview appliquer son propre pas. `passive: false` plus
 * `preventDefault`, sans quoi le refus ne refuse rien.
 *
 * **Sans exception** : la version précédente laissait passer `Ctrl` + molette sous Windows, où c'est
 * le geste de zoom volontaire de tous les logiciels. L'argument tombe avec le zoom qu'il servait —
 * il n'y a plus de pas fin à offrir en échange, et WebView2 refuse déjà le sien (`zoomHotkeysEnabled`
 * vaut `false`, ce qui pose `IsZoomControlEnabled` **et** `IsPinchZoomEnabled`). Un refus par
 * plateforme ferait donc vivre deux comportements pour une seule règle.
 *
 * **Et dans le navigateur aussi**, comme le refus du pincement l'était déjà : `pnpm dev` doit se
 * comporter comme l'application livrée — c'est ce que la fenêtre native, invisible à Playwright, ne
 * permet pas de vérifier autrement —, et un refus qui ne vivrait que sous Tauri ne serait couvert par
 * aucun test. Le zoom du navigateur reste atteignable au clavier (`⌘ +` / `⌘ -`) : ce chemin-là n'est
 * pas repris, parce que sous Tauri il n'existe pas — les raccourcis de zoom de la webview sont
 * désactivés (`zoomHotkeysEnabled`), et aucun item de menu ne les rouvre. Refuser au clavier ne
 * retirerait donc rien à l'application et ne coûterait qu'au développement.
 *
 * # En capture, sur le document
 *
 * L'écoute était sur `window`, en bulle. Elle est passée sur `document` en **capture** : c'est le
 * plus tôt qu'un écouteur puisse arriver, donc avant tout gestionnaire intermédiaire — et c'est la
 * forme que WebKit documente pour ce refus. La différence ne se mesure pas depuis ce poste (rien de
 * cet outillage ne pilote WKWebView), mais elle ne peut pas nuire : le seul événement repris est
 * celui qui porte un modificateur, et aucune vue du produit n'en attend.
 *
 * # Ce que le JavaScript ne peut pas garantir
 *
 * La permission `core:webview:allow-set-webview-zoom` a été **retirée** des capacités : la webview
 * n'est plus zoomable depuis la webview, quoi qu'un appelant futur tente. C'est la moitié
 * structurelle du refus ; celle qui vit ici ne fait qu'empêcher le moteur de rendu de zoomer de
 * lui-même.
 */
export function useRefusDuZoom() {
  useEffect(() => {
    function auGeste(evenement: WheelEvent) {
      // `ctrlKey` est le pincement du trackpad — la convention de WebKit comme de Chromium — et
      // `ctrl` / `⌘` + molette à la souris. Un défilement ordinaire n'en porte aucun : le reprendre
      // paralyserait toutes les grilles du produit.
      if (!evenement.ctrlKey && !evenement.metaKey) return
      evenement.preventDefault()
    }

    function auPincement(evenement: Event) {
      evenement.preventDefault()
    }

    const options = { passive: false, capture: true } as const
    document.addEventListener('wheel', auGeste, options)
    for (const nom of PINCEMENTS) document.addEventListener(nom, auPincement, options)
    return () => {
      // Le drapeau de capture fait partie de l'identité de l'écouteur : le retirer sans lui ne
      // retirerait rien, et le crochet fuirait un écouteur par montage.
      document.removeEventListener('wheel', auGeste, { capture: true })
      for (const nom of PINCEMENTS)
        document.removeEventListener(nom, auPincement, { capture: true })
    }
  }, [])
}
