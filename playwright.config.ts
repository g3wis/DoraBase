import { defineConfig } from '@playwright/test'

// Plusieurs worktrees de ce dépôt vivent côte à côte sur cette machine, et chacun lance son
// propre `pnpm dev`. Le premier démarré prend 5173, les suivants glissent sur 5174, 5175… Avec
// `reuseExistingServer`, une exécution de Playwright servait alors **l'application d'une autre
// branche** sans rien dire : trois références de `a1.spec.ts` ont été capturées ainsi, et le
// fichier `a2-nouvelle-connexion.spec.ts` a été déclaré « rouge depuis toujours » pour cette
// seule raison.
//
// D'où les deux moitiés de la parade : un port par worktree, choisi par l'appelant, et un
// serveur qu'on démarre toujours soi-même, en `--strictPort` pour qu'un port déjà pris fasse
// **échouer** l'exécution au lieu de la dérouter.
const port = Number(process.env.DORABASE_E2E_PORT ?? 5173)

/**
 * Le second serveur, celui du décor Windows (31 août 2026).
 *
 * **Pourquoi un serveur et pas seulement un projet.** `__APP_PLATFORM__` est posé par
 * `vite.config.ts` au moment de **construire**, comme la version et pour la même raison : une
 * détection à l'exécution serait fausse dans une webview. Deux plateformes veulent donc deux
 * serveurs, et non deux contextes de navigateur — un seul `pnpm dev` ne peut porter qu'un seul
 * `define`.
 *
 * C'est ce qui rend la coquille Windows mesurable **depuis un Mac**, ce dont le projet a besoin :
 * les captures de fidélité portent le suffixe `-darwin.png`, donc le job Playwright doit rester
 * sur macOS, où Playwright *comparerait* au lieu d'*écrire* (sur une autre plateforme il écrit,
 * et la suite est verte sans rien comparer).
 */
const portWindows = port + 1

export default defineConfig({
  testDir: './e2e',
  // `forbidOnly` fait échouer la CI si un `test.only` reste oublié dans un commit — sans
  // ça, un tel oubli passerait la CI en silence en ne lançant qu'un sous-ensemble des
  // tests. `retries` absorbe la fragilité résiduelle d'un test e2e en CI sans jamais
  // masquer un échec local, qui reste immédiat.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // **Playwright ne met qu'un seul worker sous `CI`**, et personne ne l'avait demandé : c'est
  // son défaut. Les 251 tests s'exécutaient donc en file indienne, six minutes, au milieu du
  // job qui construit le bundle. Deux workers sur un runner à trois cœurs — les serveurs Vite
  // occupent le reste, et pousser à trois ne gagne que de la contention. Mesuré en local :
  // 1 min 36 pour la suite entière à quatre workers, 1 min 48 et 1 min 12 pour deux moitiés à
  // deux workers — et aucun test instable dans les trois exécutions. La CI ne découpe plus la
  // suite depuis #189 : chaque tranche payait sa mise en place au décuple, sur macOS.
  workers: process.env.CI ? 2 : undefined,
  // `list` seul n'écrit rien sur disque : sans rapporteur `html`, l'artefact de CI
  // uploadé en cas d'échec serait vide — constaté en pratique, `playwright-report/`
  // n'existait pas après un échec.
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: [
    {
      command: `pnpm dev --port ${port} --strictPort`,
      port,
      reuseExistingServer: false,
      // La barre d'état affiche la version, donc **chaque capture pleine page la contient**. Figée
      // pour le décor, les références survivent aux publications au lieu de rougir à chaque
      // relèvement. La raison longue est dans `vite.config.ts`, au `define`.
      env: { DORABASE_VERSION_DECOR: '9.9.9' },
    },
    {
      command: `pnpm dev --port ${portWindows} --strictPort`,
      port: portWindows,
      reuseExistingServer: false,
      env: { DORABASE_VERSION_DECOR: '9.9.9', DORABASE_PLATEFORME_DECOR: 'windows' },
    },
  ],
  /**
   * Deux projets, et **le découpage n'est pas symétrique**.
   *
   * `macos` porte toute la suite, captures de fidélité comprises. `windows` ne porte que les
   * fichiers `*.windows.spec.ts` : y rejouer la suite entière ferait comparer le rendu Windows aux
   * références `-darwin.png`, donc échouer sur un écart voulu — et doublerait le temps du job pour
   * mesurer deux fois la même chose partout où la plateforme ne change rien.
   *
   * `testIgnore` sur `macos` est ce qui garde la symétrie du **fichier** : sans lui, les specs
   * Windows tourneraient aussi contre le serveur macOS et échoueraient sur l'absence des trois
   * boutons.
   */
  projects: [
    {
      name: 'macos',
      testIgnore: /\.windows\.spec\.ts$/,
      use: { baseURL: `http://localhost:${port}` },
    },
    {
      name: 'windows',
      testMatch: /\.windows\.spec\.ts$/,
      use: { baseURL: `http://localhost:${portWindows}` },
    },
  ],
  /**
   * **Le nom du projet est retiré du chemin des captures, et ce n'est pas cosmétique.**
   *
   * Le gabarit par défaut de Playwright est
   * `…/{arg}{-projectName}{-snapshotSuffix}{ext}` : nommer les projets a donc renommé les cinq
   * références en `a1-accueil-macos-darwin.png`, et Playwright, ne trouvant plus
   * `a1-accueil-darwin.png`, les a **écrites** au lieu de les comparer. Les cinq tests de
   * fidélité sont passés au vert en ne comparant rien. Constaté le 31 août 2026, au premier
   * lancement après l'ajout des projets.
   *
   * C'est exactement le piège que consigne AGENTS.md pour un runner Linux — « Playwright les
   * *écrirait* au lieu de les comparer, une suite verte qui ne compare rien » — atteint ici par
   * un autre chemin, sur le bon système. Le suffixe qui compte est celui de la **plateforme**
   * (`-darwin`), pas celui du projet : un seul des deux projets prend des captures, et il n'y a
   * donc rien à distinguer.
   */
  snapshotPathTemplate:
    '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-snapshotSuffix}{ext}',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1360, height: 814 },
    // **Figée, comme la version** (voir `DORABASE_VERSION_DECOR` ci-dessus) — même raison, un
    // symptôme différent : depuis que « Système » résout `navigator.language` (26 août 2026), la
    // langue affichée par défaut suivrait le Chromium de la machine qui exécute la suite. Une CI et
    // un poste de développement n'ont pas la même locale système, ce qui aurait fait dépendre les
    // captures de fidélité et les assertions de texte — toutes en français — de la machine plutôt
    // que du code.
    locale: 'fr-FR',
  },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0 } },
})
