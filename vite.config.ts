import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import pkg from './package.json' with { type: 'json' }

// `tauri dev` ne fait pas respecter la CSP de `tauri.conf.json` : ce garde-fou n'existe
// qu'en release sans ce plugin, et une source externe ajoutée par erreur passerait
// silencieusement en développement. On pose donc la même famille de contrainte sur le
// serveur Vite — avec les seuls écarts que le serveur de dev exige lui-même :
// `ws://localhost:5173` pour le WebSocket du rechargement à chaud, et
// `'unsafe-inline' 'unsafe-eval'` sur `script-src` pour la transformation à la volée de
// Vite. Aucun de ces deux écarts n'a de raison d'exister en production.
function devCsp(): Plugin {
  return {
    name: 'dev-csp',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; connect-src 'self' ipc: http://ipc.localhost ws://localhost:5173; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        )
        next()
      })
    },
  }
}

/**
 * La plateforme pour laquelle on construit, dans le vocabulaire du produit.
 *
 * `process.platform` en connaît une douzaine ; le produit en connaît trois. Les BSD sont
 * rangés avec macOS par le repli et non par une affirmation : personne n'y a jamais construit
 * ce bundle, et prétendre le contraire serait inventer un fait.
 */
function plateformeDeConstruction(): 'macos' | 'windows' | 'linux' {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'linux') return 'linux'
  return 'macos'
}

export default defineConfig({
  plugins: [react(), devCsp()],
  clearScreen: false,
  // La version affichée (barre d'état, `tauri.conf.json`) vient du build, pas de l'IPC :
  // `getVersion()` échouerait sous Playwright, qui exécute l'app dans Chromium sans
  // runtime Tauri, et rendrait les captures de référence non déterministes.
  define: {
    // **Et sous Playwright, elle est figée.** La version s'affiche dans la barre d'état, donc dans
    // chaque capture de fidélité pleine page : sans cela, `scripts/version.sh` rendrait rouges
    // toutes les références à chaque publication. Constaté à la 0.1.1 — douze pixels, le dernier
    // chiffre, et deux écrans rouges sur `main`. Le décor vaut `9.9.9` : la largeur d'un vrai
    // numéro, puisque la fidélité mesure une mise en page, et manifestement pas un vrai numéro.
    // Posé par `playwright.config.ts` seul ; un build ordinaire porte la vraie version.
    __APP_VERSION__: JSON.stringify(process.env.DORABASE_VERSION_DECOR ?? pkg.version),
    // L'architecture de la machine qui **construit**, affichée en pied des préférences (`15a`).
    // `navigator.userAgent` ne la donne pas de façon fiable dans un WKWebView, et une valeur écrite
    // à la main cesserait d'être vraie sur l'autre plateforme.
    __APP_ARCH__: JSON.stringify(process.arch === 'arm64' ? 'arm64' : 'x86_64'),
    // **La plateforme de construction** (31 août 2026, Linux le 4 septembre 2026), pour tout ce
    // que la coquille doit faire autrement hors de macOS : les boutons de fenêtre que le système
    // n'y dessine plus, le modificateur des raccourcis — `⌘` d'un côté, `Ctrl+` de l'autre —, le
    // sens de `ctrl` + molette, et l'existence d'une voie de mise à jour.
    //
    // La même raison que `__APP_ARCH__`, et elle vaut doublement ici : `navigator.userAgent` est
    // peu fiable dans une webview, et surtout un bundle est **construit pour** une plateforme —
    // celle du build est donc celle qui tournera, sans détection à l'exécution.
    //
    // **`DORABASE_PLATEFORME_DECOR` est ce qui rend la coquille Windows vérifiable depuis un
    // Mac** — troisième valeur figée pour le décor, après la version et la locale, et pour la
    // même raison qu'elles : ce que la machine décide ne doit pas décider ce que les tests
    // mesurent. Sans elle, Playwright ne pourrait exercer les trois boutons et les libellés
    // `Ctrl+` que sur un runner Windows ou Linux, et le job de fidélité doit rester sur macOS
    // (les références portent le suffixe `-darwin.png`).
    //
    // **Trois valeurs depuis le 4 septembre 2026**, et le repli reste `'macos'` : la liste est
    // fermée côté écran (`shell/plateforme.ts`), donc un quatrième mot serait une faute de
    // frappe, pas une plateforme.
    __APP_PLATFORM__: JSON.stringify(
      process.env.DORABASE_PLATEFORME_DECOR ?? plateformeDeConstruction(),
    ),
  },
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  build: { target: 'safari16.4', cssTarget: 'safari16.4' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Le glob par défaut de Vitest (`**/*.spec.ts`) ramasse aussi `e2e/*.spec.ts`, qui
    // importe son propre `test` depuis `@playwright/test` — Vitest l'exécute alors avec
    // sa fonction `test()` globale au lieu de celle de Playwright, et le fichier échoue
    // au chargement avec « did not expect test() to be called here ». Trouvé en CI,
    // reproduit en local : `pnpm test` sortait en 1 en silence, la ligne de résumé des
    // tests ne comptant pas une suite qui a échoué au chargement. `scripts/` est inclus
    // explicitement, ses `.test.mjs` n'étant pas sous `src/`.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
})
