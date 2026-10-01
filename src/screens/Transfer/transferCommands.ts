import { open, save } from '@tauri-apps/plugin-dialog'
import { exportProjects, importProjects, inspectProjectsFile } from '../../data/commandes'
import type {
  ExportProjectsRequest,
  ExportReport,
  ImportProjectsResult,
  ImportReport,
  ImportSelection,
} from '../../domain/arbre'

/**
 * Le pont des deux modales de transfert de projets (`API-30`).
 *
 * **Isolé dans son propre fichier et injecté dans les modales**, comme celui du dump et pour la
 * même raison : ni `invoke` ni le plugin `dialog` ne répondent hors de la webview de Tauri, donc
 * un test qui les appellerait vraiment échouerait, et un test qui les simulerait ne vérifierait
 * que le simulacre. Ce qui est testé, c'est le **câblage**.
 *
 * **Les trois commandes passent par `data/commandes.ts`**, et non par un `invoke` local : c'est le
 * seul point de contact avec l'IPC, et c'est aussi lui qui annonce les échecs de commande à
 * l'arbre. Un appel direct sortirait de ce signal.
 */

/** L'extension du fichier, employée par les deux sélecteurs. */
const EXTENSION = 'json'

export function exporter(request: ExportProjectsRequest): Promise<ExportReport> {
  return exportProjects(request)
}

export function inspecter(file: string): Promise<ImportReport> {
  return inspectProjectsFile(file)
}

export function importer(
  file: string,
  selection: ImportSelection | null,
): Promise<ImportProjectsResult> {
  return importProjects({ file, selection })
}

/**
 * Le sélecteur de **destination** natif, sur `dialog:allow-save` — celle du dump.
 *
 * Le nom proposé est celui du dossier, ou `dossiers` pour un export complet. **Sans horodatage** :
 * le fichier n'en porte pas non plus, ce qui rend deux exports comparables par un `diff`, et un
 * nom daté ferait accumuler des fichiers dont aucun n'a l'air d'être le bon.
 */
export async function choisirDestination(dossier: string | null): Promise<string | null> {
  const choisi = await save({
    // `defaultPath` est un **chemin** : un dossier nommé « ventes / 2026 » y désignerait un
    // répertoire inexistant. Le séparateur est remplacé, comme pour le nom d'une console (`API-29`).
    defaultPath: `${dossier === null ? 'dossiers' : dossier.replace(/[/\\]/g, '-')}.dorabase.${EXTENSION}`,
    filters: [{ name: 'DoraBase', extensions: [EXTENSION] }],
  })
  return typeof choisi === 'string' ? choisi : null
}

/** Le sélecteur de **source** natif, sur `dialog:allow-open`. */
export async function choisirSource(): Promise<string | null> {
  const choisi = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'DoraBase', extensions: [EXTENSION] }],
  })
  return typeof choisi === 'string' ? choisi : null
}

/**
 * Le message d'une erreur remontée par l'IPC.
 *
 * Tauri sérialise un `Err(String)` en chaîne, mais un pont cassé ou une panique de commande
 * rendent autre chose — et un `catch` qui suppose la chaîne afficherait « undefined » là où la
 * cause était lisible. Même piège que dans les modales de dump, d'où la même fonction.
 */
export function messageDe(cause: unknown): string {
  if (typeof cause === 'string') return cause
  if (cause && typeof cause === 'object' && 'message' in cause) {
    return String((cause as { message: unknown }).message)
  }
  return String(cause)
}
