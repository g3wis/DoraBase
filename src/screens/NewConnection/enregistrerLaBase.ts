import { invoke } from '@tauri-apps/api/core'
import type {
  DeleteDatabaseRequest,
  DeleteResult,
  RenameDatabaseRequest,
  SaveDatabaseRequest,
  SaveDatabaseResult,
  UpdateVariantRequest,
} from '../../domain/arbre'
import type { ConnectionId, FolderId, FolderTree } from '../../domain/config'
import type { ConnectionDraft } from './ConnectionDraft'
import { baseDAuthentificationAEnvoyer } from './draftToRequest'
import { NOM_PAR_DEFAUT } from './engines'
import { tunnelDraftToTunnel } from './tunnelDraftToTunnel'

/**
 * Appelle la commande `save_database`, et rend l'arbre **à jour** avec l'identifiant de la
 * connexion créée, que le cœur a tiré.
 *
 * Rendre la liste plutôt qu'un simple succès évite un second aller-retour pour rafraîchir
 * l'écran, et supprime la fenêtre pendant laquelle l'écran et le disque divergeraient.
 *
 * Injectée dans `NewConnection` comme `onTest` et `onBrowseKey`, pour la même raison : le pont
 * ne répond pas hors de la webview, et ce qui est testable ici est le **câblage**.
 */
export async function enregistrerLaBase(request: SaveDatabaseRequest): Promise<SaveDatabaseResult> {
  return invoke<SaveDatabaseResult>('save_database', { request })
}

/**
 * Met à jour les réglages d'une variante existante (`08g`), et rend les projets à jour.
 *
 * Distincte de `save_database`, qui **ajoute** et refuse une base déjà là : c'est cette garde qui
 * protège d'un écrasement par mégarde, et la fondre dans une commande « enregistrer ou mettre à
 * jour » l'effacerait.
 */
export async function mettreAJourLaVariante(request: UpdateVariantRequest): Promise<FolderTree> {
  return invoke<FolderTree>('update_variant', { request })
}

/**
 * Renomme une connexion (`26`), et rend l'arbre à jour.
 *
 * **Synchrone et sans rapport depuis #166** : le nom d'une connexion n'est plus dans aucune
 * identité — ni la clé du registre, ni la référence du secret, qui dérivent toutes deux de son
 * identifiant. Il n'y a donc plus de secret à déplacer ni de connexion à fermer, donc rien à dire.
 */
export async function renommerLaConnexion(request: RenameDatabaseRequest): Promise<FolderTree> {
  return invoke<FolderTree>('rename_database', { request })
}

/**
 * Convertit le brouillon de `A2` en requête de mise à jour.
 *
 * Le moteur n'est **pas** repris du brouillon : il ne se modifie pas (`08g`), et la connexion est
 * désignée par son identifiant. Le mot de passe part `null` quand le champ est vide,
 * ce que le cœur lit comme « inchangé ».
 */
export function draftToUpdateRequest(
  draft: ConnectionDraft,
  connection: ConnectionId,
): UpdateVariantRequest {
  const complet = draftToSaveRequest(draft, null)
  return {
    connection,
    variant: complet.variant,
    password: draft.password === '' ? null : draft.password,
    label: complet.label,
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
export function draftToSaveRequest(
  draft: ConnectionDraft,
  folder: FolderId | null,
): SaveDatabaseRequest {
  const port = Number.parseInt(draft.port, 10)

  return {
    // **Le dossier est le cadre de la modale** (#166), jamais un champ du brouillon : il vient de la
    // ligne d'arbre d'où part le geste. `null` range la connexion à la racine.
    folder,
    // **`name` n'est plus un champ du formulaire** (1er septembre 2026) : sur un brouillon neuf
    // il est toujours vide, et devient l'abréviation du moteur — « psql », « mongo »… — qui reste
    // aussi le titre par défaut affiché dans l'explorateur tant qu'aucun libellé ne le remplace
    // (voir `arbre.ts`). `draft.name.trim() ||` protège l'édition, où le brouillon porte le nom
    // existant de la base qu'on modifie.
    name: draft.name.trim() || NOM_PAR_DEFAUT[draft.engine],
    engine: draft.engine,
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
    // Le vide devient `null`, comme le certificat d'autorité juste au-dessus : une chaîne blanche
    // dans la configuration se lirait comme un libellé véritable.
    label: draft.label.trim() === '' ? null : draft.label.trim(),
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
