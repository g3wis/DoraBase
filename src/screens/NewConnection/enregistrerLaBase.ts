import { invoke } from '@tauri-apps/api/core'
import type {
  CreateProjectRequest,
  DeleteDatabaseRequest,
  DeleteProjectRequest,
  DeleteResult,
  Project,
  RenameDatabaseRequest,
  RenameProjectRequest,
  RenameResult,
  SaveDatabaseRequest,
  UpdateVariantRequest,
} from '../../domain/config'
import type { ConnectionDraft } from './ConnectionDraft'
import { baseDAuthentificationAEnvoyer } from './draftToRequest'
import { tunnelDraftToTunnel } from './tunnelDraftToTunnel'

/**
 * Appelle la commande `save_database`, et rend les projets **à jour**.
 *
 * Rendre la liste plutôt qu'un simple succès évite un second aller-retour pour rafraîchir
 * l'écran, et supprime la fenêtre pendant laquelle l'écran et le disque divergeraient.
 *
 * Injectée dans `NewConnection` comme `onTest` et `onBrowseKey`, pour la même raison : le pont
 * ne répond pas hors de la webview, et ce qui est testable ici est le **câblage**.
 */
export async function enregistrerLaBase(request: SaveDatabaseRequest): Promise<Project[]> {
  return invoke<Project[]>('save_database', { request })
}

/**
 * Crée un projet vide, et rend les projets **à jour**.
 *
 * Distincte de `save_database`, et pas par symétrie : `enregistrer` refuse un projet inconnu, et
 * une commande qui créerait l'entité manquante par effet de bord ferait d'une faute de frappe un
 * second projet silencieux. Voir `08f`.
 */
export async function creerLeProjet(request: CreateProjectRequest): Promise<Project[]> {
  return invoke<Project[]>('create_project', { request })
}

/**
 * Met à jour les réglages d'une variante existante (`08g`), et rend les projets à jour.
 *
 * Distincte de `save_database`, qui **ajoute** et refuse une base déjà là : c'est cette garde qui
 * protège d'un écrasement par mégarde, et la fondre dans une commande « enregistrer ou mettre à
 * jour » l'effacerait.
 */
export async function mettreAJourLaVariante(request: UpdateVariantRequest): Promise<Project[]> {
  return invoke<Project[]>('update_variant', { request })
}

/**
 * Renomme un projet (`08i`), et rend les projets à jour **avec ce qu'il y a à dire**.
 *
 * Le nom d'un projet est dans la clé d'identité de ses secrets (`05a`) : renommer déplace des mots
 * de passe dans le Trousseau. La commande rend donc deux listes en plus des projets — ceux qui
 * étaient déclarés mais introuvables, et ceux qu'elle n'a pas su effacer. Les taire laisserait
 * l'utilisateur découvrir l'un ou l'autre bien plus tard, sur un échec de connexion sans raison
 * apparente.
 */
export async function renommerLeProjet(request: RenameProjectRequest): Promise<RenameResult> {
  return invoke<RenameResult>('rename_project', { request })
}

/**
 * Renomme une connexion (`26`), et rend les projets à jour **avec ce qu'il y a à dire**.
 *
 * Le nom d'une connexion est le deuxième tiers de sa clé d'identité (`05a`) : renommer déplace un mot
 * de passe dans le Trousseau et ferme la connexion ouverte. La commande rend donc, comme
 * `renommerLeProjet`, le secret introuvable et celui qu'elle n'a pas su effacer — les taire
 * laisserait l'utilisateur les découvrir sur un échec de connexion sans raison apparente.
 */
export async function renommerLaConnexion(request: RenameDatabaseRequest): Promise<RenameResult> {
  return invoke<RenameResult>('rename_database', { request })
}

/**
 * Convertit le brouillon de `A2` en requête de mise à jour.
 *
 * Le nom, l'environnement et le moteur ne sont **pas** repris du brouillon : ils désignent la
 * variante et ne se modifient pas (`08g`). Le mot de passe part `null` quand le champ est vide,
 * ce que le cœur lit comme « inchangé ».
 */
export function draftToUpdateRequest(
  draft: ConnectionDraft,
  cible: { project: string; database: string; environment: ConnectionDraft['environment'] },
): UpdateVariantRequest {
  const complet = draftToSaveRequest(draft)
  return {
    project: cible.project,
    database: cible.database,
    environment: cible.environment,
    variant: complet.variant,
    password: draft.password === '' ? null : draft.password,
  }
}

/**
 * Convertit le brouillon de `A2` en requête d'enregistrement.
 *
 * **Distincte de `draftToRequest`** de `08d`, et pas par duplication : celle-là produit une
 * variante *jetable* pour un test, où un champ vide n'est pas une erreur. Celle-ci produit ce
 * qui sera **persisté**, donc soumis aux invariants de `05a` — que Rust vérifie, pas ce fichier.
 *
 * La variante part avec `password: null` : aucune `SecretRef` n'existe encore, et c'est
 * `enregistrer` côté Rust qui la fabrique après avoir rangé le secret. La poser ici obligerait
 * le front à connaître la convention de nommage des références, donc à la dupliquer.
 */
export function draftToSaveRequest(draft: ConnectionDraft): SaveDatabaseRequest {
  const port = Number.parseInt(draft.port, 10)

  return {
    project: draft.project,
    database: draft.name,
    engine: draft.engine,
    // Hors des réglages : l'environnement appartient à la connexion (`23b`).
    environment: draft.environment,
    variant: {
      host: draft.host,
      port: Number.isFinite(port) ? port : 0,
      defaultDatabase: draft.defaultDatabase,
      username: draft.username,
      password: null,
      sslMode: draft.sslMode,
      // Le vide devient `null` : « aucune autorité déclarée » se dit par l'absence,
      // et une chaîne vide dans le fichier de configuration se lirait comme un chemin.
      caCertificate: draft.caCertificate.trim() === '' ? null : draft.caCertificate.trim(),
      authDatabase: baseDAuthentificationAEnvoyer(draft),
      readOnly: draft.readOnly,
      reconnectOnStartup: draft.reconnectOnStartup,
      tunnel: tunnelDraftToTunnel(draft.tunnel),
    },
    password: draft.password === '' ? null : draft.password,
  }
}

/**
 * Retire la **déclaration de connexion** d'une base, et son mot de passe (`08j`).
 *
 * **Rien n'est supprimé sur le serveur.** La commande ne reçoit aucun moteur, n'ouvre aucune
 * connexion et n'émet aucun SQL — elle en ferme, au contraire. Le nom de cette fonction dit ce
 * qu'elle fait : `supprimerLaBase` aurait laissé planer exactement l'ambiguïté que `08j` combat.
 */
export async function retirerLaConnexion(request: DeleteDatabaseRequest): Promise<DeleteResult> {
  return invoke<DeleteResult>('delete_database', { request })
}

/** Retire un projet et toutes ses déclarations de connexion (`08j`). Même garantie. */
export async function retirerLeProjet(request: DeleteProjectRequest): Promise<DeleteResult> {
  return invoke<DeleteResult>('delete_project', { request })
}
