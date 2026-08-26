import { invoke } from '@tauri-apps/api/core'
import { debug, error as logError } from '@tauri-apps/plugin-log'
import type { ConnectionRequest, ConnectionTest, EngineError } from '../../domain/engine'

/**
 * Journalise **sans jamais faire échouer l'appelant**.
 *
 * Une première version faisait `await debug(...)` avant l'`invoke`. Or le plugin `log` est
 * derrière une permission (`log:allow-log`, qui manquait) et n'est enregistré qu'en
 * développement (`debug_assertions` dans `lib.rs`) : en release, ou permission absente, ce
 * `await` **rejetait et emportait le test de connexion avec lui**. Un journal est un outil de
 * diagnostic ; il ne doit pas pouvoir casser ce qu'il observe.
 *
 * Trouvé en lançant l'app, pas par un test : sous Vitest comme sous Playwright, le plugin
 * n'existe pas et l'appel échoue de toute façon — donc aucun test ne distinguait les deux
 * situations.
 */
function journal(ecrire: (message: string) => Promise<void>, message: string): void {
  void ecrire(message).catch(() => {
    // Volontairement muet : `console.error` ici doublerait le bruit dans une webview où le
    // plugin est justement absent.
  })
}

/**
 * Appelle la commande `test_connection` de la couche moteur.
 *
 * **C'est le premier passage réel du pont JavaScript → Rust du projet.** Rien ne l'avait
 * exercé depuis `01` : l'enregistrement des commandes était garanti par la compilation,
 * l'aller-retour non. Playwright ne pilotant pas WKWebView, aucun test automatisé ne peut le
 * traverser — d'où les journaux, qui remontent dans la console de `pnpm tauri dev` grâce à la
 * cible `Webview` de `tauri-plugin-log` (branchée dans `lib.rs`).
 *
 * **Ce qui serait un faux confort** : un test Vitest qui simule `invoke`. Il vérifierait le
 * simulacre. La fonction est donc injectée dans `NewConnection`, et c'est le *câblage* qui est
 * testé — pas le pont.
 */
export async function testerLaConnexion(request: ConnectionRequest): Promise<ConnectionTest> {
  // Ni mot de passe ni nom d'utilisateur ici : l'hôte et le port suffisent à reconnaître
  // l'appel dans la console, et un journal est un fichier comme un autre.
  // Le moteur est dans la ligne : sans lui, la trace d'un test qui emploie le mauvais pilote est
  // indiscernable de celle d'un test normal — c'est ce qui a laissé passer un `test_connection`
  // qui parlait PostgreSQL à toutes les bases.
  journal(
    debug,
    `invoke test_connection → ${request.engine} ${request.variant.host}:${request.variant.port}`,
  )

  try {
    const resultat = await invoke<ConnectionTest>('test_connection', { request })
    journal(debug, `test_connection ✓ ${resultat.serverVersion} en ${resultat.latencyMs} ms`)
    return resultat
  } catch (cause) {
    journal(logError, `test_connection ✗ ${messageDe(cause)}`)
    throw cause
  }
}

/**
 * Le message d'une erreur remontée par l'IPC.
 *
 * Tauri sérialise un `Err(EngineError)` en l'objet lui-même. Mais une panique de commande, une
 * erreur de désérialisation ou un pont cassé rendent une **chaîne** — et un `catch` qui suppose
 * la forme structurée afficherait alors « undefined » là où la cause était lisible.
 */
export function messageDe(cause: unknown): string {
  if (typeof cause === 'string') return cause
  if (cause && typeof cause === 'object' && 'message' in cause) {
    return String((cause as EngineError).message)
  }
  return String(cause)
}

/** Le `SQLSTATE` quand le moteur en a donné un. `null` pour un échec en amont — réseau,
 * tunnel, configuration. C'est la distinction que `06d` a apprise à ses dépens. */
export function codeDe(cause: unknown): string | null {
  if (cause && typeof cause === 'object' && 'code' in cause) {
    const code = (cause as EngineError).code
    return typeof code === 'string' ? code : null
  }
  return null
}
