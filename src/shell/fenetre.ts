import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * Les quatre gestes de fenêtre que `TitleBar` doit pouvoir faire hors macOS.
 *
 * # Pourquoi une passerelle et non des appels directs
 *
 * La même raison que `PASSERELLE_ZOOM` : `getCurrentWindow()` n'existe pas hors de la webview,
 * donc un appel direct ferait planter la galerie, `?demo` et toute la suite Playwright — qui
 * tournent dans un Chromium ordinaire. Injectée, la passerelle se remplace par un double dans
 * les tests, et c'est le seul moyen de vérifier que les boutons appellent bien quelque chose
 * (le défaut n° 36 : un bouton cliquable et inerte se lit comme une panne).
 *
 * # Pourquoi `estMaximisee` et pas seulement `basculerMaximisation`
 *
 * Le bouton central change de glyphe selon l'état : un carré quand la fenêtre est
 * normale, deux carrés décalés quand elle est agrandie. Sans lire l'état, le bouton annoncerait
 * toujours « agrandir » y compris quand il restaure — il mentirait sur ce qu'il va faire.
 */
export type PasserelleFenetre = {
  reduire: () => Promise<void>
  basculerMaximisation: () => Promise<void>
  fermer: () => Promise<void>
  estMaximisee: () => Promise<boolean>
}

/**
 * La passerelle réelle. Les quatre commandes correspondent une pour une aux permissions de
 * `capabilities/boutons-de-fenetre.json` — `allow-minimize`, `allow-toggle-maximize`,
 * `allow-close`, `allow-is-maximized` — et `tests/permissions.rs` garde la liste.
 *
 * # Les quatre `async` ne sont pas décoratifs
 *
 * **`getCurrentWindow()` lève *synchronément* hors de la webview**, il ne rend pas une promesse
 * rejetée : il lit `__TAURI_INTERNALS__.metadata`, donc « Cannot read properties of undefined
 * (reading 'metadata') » au moment de l'appel. Écrit `() => getCurrentWindow().minimize()`, le
 * `.catch()` de l'appelant n'est jamais construit — l'exception traverse le gestionnaire de clic
 * et l'effet de montage. Mesuré le 31 août 2026 : **81 tests** sont tombés d'un coup sous
 * `DORABASE_PLATEFORME_DECOR=windows`, tous ceux qui montent la barre.
 *
 * Le corps `async` est ce qui convertit le jet en rejet, donc ce qui rend `.catch()` capable de
 * l'attraper. C'est le même piège que le `SecurityError` synchrone d'un WebSocket refusé par la
 * CSP, consigné dans AGENTS.md — et il aurait frappé pour de vrai la galerie, `?demo` et toute
 * la suite Playwright d'un build Windows.
 */
export const PASSERELLE_FENETRE: PasserelleFenetre = {
  reduire: async () => {
    await getCurrentWindow().minimize()
  },
  basculerMaximisation: async () => {
    await getCurrentWindow().toggleMaximize()
  },
  fermer: async () => {
    await getCurrentWindow().close()
  },
  estMaximisee: async () => getCurrentWindow().isMaximized(),
}
