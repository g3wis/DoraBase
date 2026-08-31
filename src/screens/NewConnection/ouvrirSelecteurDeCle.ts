import { homeDir } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'

/**
 * Ouvre le sélecteur de fichier de la clé privée, et rend son chemin.
 *
 * **Isolé dans son propre fichier**, et injecté dans `NewConnection` plutôt qu'appelé
 * directement : le plugin `dialog` ne répond que dans la webview de Tauri. Sous Vitest,
 * l'import lui-même passe mais l'appel rejette — un test du câblage du bouton devrait donc
 * simuler le module entier. Un paramètre suffit, et laisse ce fichier comme seul point de
 * contact avec le plugin.
 *
 * **Aucun filtre d'extension, et c'est le remède d'un défaut mesuré** (31 août 2026). Le
 * sélecteur portait `extensions: ['pem', 'key', '']`, avec un commentaire qui pariait que
 * la chaîne vide laisserait passer les noms sans extension. Elle ne le fait pas : sur macOS,
 * un filtre pose des types de contenu autorisés, et `~/.ssh/id_rsa` — le nom **usuel** d'une
 * clé, sans extension — apparaissait **grisé**, donc impossible à choisir. Le bouton
 * « Parcourir… » n'ouvrait alors que sur un refus, et il fallait taper le chemin à la main.
 * Une clé privée OpenSSH n'a pas d'extension conventionnelle : il n'y a pas de filtre juste,
 * seulement un filtre qui exclut le cas le plus fréquent.
 *
 * **Le sélecteur s'ouvre dans `~/.ssh`**, qui est masqué dans le Finder comme dans le
 * sélecteur : `⌘⇧.` est le seul geste qui l'y ferait paraître, et personne n'a à le
 * connaître. Un dossier **désigné en `defaultPath`** est ouvert et listé même masqué, ce qui
 * met les clés sous les yeux sans changer les droits ni les réglages de l'utilisateur.
 *
 * **La permission accordée est `dialog:allow-open`, et rien d'autre.** `dialog:default`
 * ajouterait `allow-save`, `allow-message`, `allow-ask` et `allow-confirm` — dont une qui
 * écrit sur le disque. Gardé par `src-tauri/tests/permissions.rs`.
 *
 * **Aucune lecture du fichier ici.** `06e` lit la clé à l'ouverture du tunnel, avec un
 * message qui nomme le chemin et le panneau en cas d'échec. Lire une clé privée pour
 * « valider » la saisie ferait entrer de la matière privée dans l'écran sans nécessité — et
 * un chemin peut devenir valable entre la saisie et la connexion.
 */
export async function ouvrirSelecteurDeCle(): Promise<string | null> {
  // Le dossier par défaut est une **commodité** : s'il n'est pas résolu, le sélecteur
  // s'ouvre où le système décide, ce qui reste utilisable. Un échec ici n'a donc pas à
  // empêcher de choisir un fichier.
  const dossierSsh = await homeDir()
    .then((maison) => `${maison}/.ssh`)
    .catch(() => undefined)

  const choisi = await open({
    multiple: false,
    directory: false,
    title: 'Choisir une clé privée SSH',
    defaultPath: dossierSsh,
  })

  // Le plugin rend `null` sur annulation, ou une chaîne quand `multiple: false`. Le tableau
  // est impossible ici, mais TypeScript ne le sait pas depuis la signature.
  return typeof choisi === 'string' ? choisi : null
}
