import { connexions, idDeConnexion } from '../../data/dossiers'
import type { DumpRequest } from '../../domain/arbre'
import type { ConnectionSettings, FolderTree } from '../../domain/config'
import type { CibleDeDump } from './cible'

/**
 * La connexion sur laquelle `⇧⌘E` et `⇧⌘I` agissent, **quand elle est sans ambiguïté**.
 *
 * # Pourquoi ce détour
 *
 * Le menu natif ne dit pas *quelle* base exporter : un `MenuEvent` ne porte qu'un
 * identifiant d'item. La cible devrait venir de la sélection de l'arbre — mais rien ne la transmet
 * encore aux modales de dump, donc l'app n'a pas de « connexion courante » à leur donner.
 *
 * Plutôt que d'inventer une sélection, cette fonction ne rend une cible que lorsque la
 * configuration n'en laisse qu'une possible : **une seule connexion dans tout l'arbre** (#166). Dans tous
 * les autres cas elle rend `null`, et la modale **le dit** au lieu de choisir à la place de
 * l'utilisateur : exporter la mauvaise base serait sans conséquence, **importer** dans la
 * mauvaise en aurait.
 *
 * À remplacer par la sélection de l'arbre dès qu'elle sera transmise.
 */
export type CibleResolue = {
  request: Omit<DumpRequest, 'file'>
  connection: ConnectionSettings
  /** Ce que les modales nomment. */
  nommee: CibleDeDump
}

export function cibleUnique(arbre: FolderTree): CibleResolue | null {
  const toutes = connexions(arbre)
  // `noUncheckedIndexedAccess` : la longueur vérifiée ne rassure pas le compilateur, et c'est tant
  // mieux — un `!` ici serait une affirmation non vérifiée.
  const seule = toutes.length === 1 ? toutes[0] : undefined
  if (!seule) return null
  const { base, ancetres } = seule

  return {
    request: {
      // **L'identifiant, et rien d'autre** : c'est le cœur qui en dérive la clé du registre.
      key: { connection: idDeConnexion(base) },
      variant: base.connection,
      engine: base.engine,
    },
    connection: base.connection,
    nommee: {
      chemin: ancetres.map((ancetre) => ancetre.name).join(' › '),
      base: base.label?.trim() || base.name,
    },
  }
}
