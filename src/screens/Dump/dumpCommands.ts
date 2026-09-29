import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open, save } from '@tauri-apps/plugin-dialog'
import type { DumpRequest, DumpVerdict, Inspection } from '../../domain/dump'
import type { DatabaseKey } from '../../domain/engine'

/**
 * Le pont vers les commandes de dump.
 *
 * **Isolé dans son propre fichier, et injecté dans les modales** : ni `invoke` ni le plugin
 * `dialog` ne répondent hors de la webview de Tauri, donc un test qui les appellerait
 * vraiment échouerait, et un test qui les simulerait ne vérifierait que le simulacre. Ce
 * qui est testé, dans `ExportDump.test.tsx` et `ImportDump.test.tsx`, c'est le **câblage**.
 * Le pont lui-même s'observe dans la sortie de `pnpm tauri dev` — voir `specs/08d`.
 */

/** Le nom de l'événement de progression. **Doit rester identique à `EVENEMENT_PROGRESSION`
 * dans `src-tauri/src/dump/commands.rs`** : Tauri ne type pas les noms d'événements. */
export const EVENEMENT_PROGRESSION = 'dump://progression'

export function dumpAvailability(
  request: Omit<DumpRequest, 'file'>,
  sens: 'export' | 'import',
): Promise<DumpVerdict> {
  return invoke<DumpVerdict>('dump_availability', {
    request: { ...request, file: '' },
    import: sens === 'import',
  })
}

export function startExport(request: DumpRequest): Promise<number> {
  return invoke<number>('start_export', { request })
}

export function cancelExport(key: DatabaseKey): Promise<boolean> {
  return invoke<boolean>('cancel_export', { key })
}

export function inspectDump(request: DumpRequest): Promise<Inspection> {
  return invoke<Inspection>('inspect_dump', { file: request.file, request })
}

export function startImport(request: DumpRequest): Promise<void> {
  return invoke('start_import', { request })
}

/**
 * S'abonne à la progression. Rend la fonction de désabonnement.
 *
 * L'abonnement est lancé sans être attendu et son échec avalé : hors de la webview il n'y a
 * aucun événement à écouter, et un abonnement qui casse l'appelant serait le pire des deux
 * mondes — même raisonnement que le journal de `08d`.
 */
export function ecouterLaProgression(surProgression: (octets: number) => void): () => void {
  let desabonner: (() => void) | null = null
  let annule = false

  void listen<number>(EVENEMENT_PROGRESSION, (evenement) => surProgression(evenement.payload))
    .then((arret) => {
      if (annule) arret()
      else desabonner = arret
    })
    .catch(() => {
      // Volontairement muet : voir la note ci-dessus.
    })

  return () => {
    annule = true
    desabonner?.()
  }
}

/**
 * Le sélecteur de **destination** natif. `dialog:allow-save`, accordée par `22b` et gardée
 * par `tests/permissions.rs`.
 */
export async function choisirDestination(base: string): Promise<string | null> {
  const choisi = await save({
    title: 'Enregistrer le dump',
    defaultPath: `${base}.sql`,
    filters: [{ name: 'Dump SQL', extensions: ['sql'] }],
  })
  return typeof choisi === 'string' ? choisi : null
}

/** Le sélecteur de **source** natif, sur `dialog:allow-open` — celle de `08c`. */
export async function choisirSource(): Promise<string | null> {
  const choisi = await open({
    multiple: false,
    directory: false,
    title: 'Choisir un dump à importer',
    filters: [{ name: 'Dump SQL', extensions: ['sql'] }],
  })
  return typeof choisi === 'string' ? choisi : null
}
