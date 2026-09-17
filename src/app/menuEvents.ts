import { listen } from '@tauri-apps/api/event'

/**
 * Le nom de l'événement réémis par Rust vers la webview.
 *
 * **Doit rester identique à `menu::EVENEMENT` dans `src-tauri/src/lib.rs`.** Rien ne peut
 * garder les deux côtés d'un nom d'événement : Tauri ne les type pas, et un désaccord
 * produirait un pont muet plutôt qu'une erreur. La seule vérification possible est de lire
 * la ligne de journal des deux côtés dans la sortie de `pnpm tauri dev`.
 */
export const EVENEMENT_DE_MENU = 'menu://declenche'

/** Ce que les entrées de « Fichier » déclenchent, injecté par `App`. */
export type ActionsDeMenu = {
  exporter: () => void
  importer: () => void
  /** L'export de **tous** les projets (`API-30`) — la portée d'un seul part du menu de sa ligne. */
  exporterLesProjets: () => void
  importerDesProjets: () => void
}

/**
 * Branche l'écoute des événements de menu, et rend le dispatcheur.
 *
 * **Le dispatcheur est rendu**, plutôt que gardé privé : c'est la seule partie testable
 * sans runtime Tauri. `listen` n'existe pas sous Vitest — l'import passe, l'appel rejette —
 * donc l'abonnement est lancé sans être attendu et son échec est avalé, comme le journal de
 * `08d`. Un abonnement qui casserait l'appelant serait le pire des deux mondes : le pont ne
 * peut de toute façon être vérifié qu'à l'œil, dans la sortie de `pnpm tauri dev`.
 *
 * Un identifiant inconnu est **ignoré sans lever**, et journalisé en console : les menus à
 * venir (`Affichage`, `Aide`) émettront des identifiants que ce mapping ne connaît pas.
 */
export function brancherEvenementsDeMenu(actions: ActionsDeMenu): (identifiant: string) => void {
  const dire = (identifiant: string): void => {
    switch (identifiant) {
      case 'fichier.exporter-dump':
        console.info(`menu → ${identifiant}`)
        actions.exporter()
        return
      case 'fichier.importer-dump':
        console.info(`menu → ${identifiant}`)
        actions.importer()
        return
      case 'fichier.exporter-projets':
        console.info(`menu → ${identifiant}`)
        actions.exporterLesProjets()
        return
      case 'fichier.importer-projets':
        console.info(`menu → ${identifiant}`)
        actions.importerDesProjets()
        return
      default:
        console.info(`menu → ${identifiant} (aucune action câblée)`)
    }
  }

  void listen<string>(EVENEMENT_DE_MENU, (evenement) => dire(evenement.payload)).catch(() => {
    // Volontairement muet : hors de la webview de Tauri, il n'y a pas d'événement de menu
    // à écouter, et le signaler bruirait tous les tests du front.
  })

  return dire
}
