import { homeDir } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'

/**
 * Ouvre le sélecteur du fichier kubeconfig à déclarer, et rend son chemin (`API-70`).
 *
 * **Isolé dans son propre fichier**, et injecté plutôt qu'appelé directement : le plugin `dialog` ne
 * répond que dans la webview de Tauri. C'est le montage d'`ouvrirSelecteurDeCle`, et pour la même
 * raison — un test du câblage du bouton devrait sinon simuler le module entier.
 *
 * **Aucun filtre d'extension**, et c'est la leçon déjà payée par la clé privée SSH : un kubeconfig
 * n'a pas d'extension conventionnelle. `~/.kube/config` n'en porte aucune, `prod.yaml` en porte une,
 * et un filtre grise sur macOS tout ce qu'il ne nomme pas — donc le cas le plus fréquent.
 *
 * **Le sélecteur s'ouvre dans `~/.kube`**, masqué dans le Finder comme dans le sélecteur : un
 * dossier désigné en `defaultPath` est ouvert et listé même masqué, ce qui met les fichiers sous les
 * yeux sans demander de connaître `⌘⇧.`.
 *
 * **Aucune permission nouvelle** : `dialog:allow-open` est celle que `08c` a accordée pour la clé
 * privée, et `src-tauri/tests/permissions.rs` garde la liste.
 *
 * **Aucune lecture du fichier ici.** Ce qui s'y trouve — les contextes, le contexte courant — est lu
 * par `kubectl` à l'ouverture du transfert, et l'en-tête du journal le dit. Le lire ici ferait entrer
 * des identifiants de cluster dans l'écran sans nécessité, et un chemin peut devenir valable entre la
 * déclaration et la connexion.
 */
export async function ouvrirSelecteurDeKubeconfig(): Promise<string | null> {
  // Une **commodité** : un dossier non résolu laisse le sélecteur s'ouvrir où le système décide, ce
  // qui reste utilisable. Un échec ici n'a pas à empêcher de choisir un fichier.
  const dossierKube = await homeDir()
    .then((maison) => `${maison}/.kube`)
    .catch(() => undefined)

  const choisi = await open({
    multiple: false,
    directory: false,
    title: 'Choisir un fichier kubeconfig',
    defaultPath: dossierKube,
  })

  // Le plugin rend `null` sur annulation, ou une chaîne quand `multiple: false`.
  return typeof choisi === 'string' ? choisi : null
}
