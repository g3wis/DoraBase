import type { ManagedInstance } from '../../domain/config'
import type {
  Capability,
  InstanceGesture,
  InstancePrivilege,
  InstanceRole,
} from '../../domain/instances'

/**
 * Les règles de l'écran d'instance, en fonctions **pures** (`API-32`).
 *
 * Isolées du rendu pour la raison d'`arbre.ts` et d'`onglets.ts` : ce qui décide du sigle d'une
 * cellule de privilège, de l'ordre des rôles ou du droit de supprimer une session se teste sans
 * DOM — et ce sont précisément les règles qu'un rendu vérifié à l'œil laisserait passer.
 */

/** Les sept sections de la bande, dans l'ordre de la maquette. */
export type SectionInstance =
  | 'overview'
  | 'databases'
  | 'roles'
  | 'privileges'
  | 'sessions'
  | 'extensions'
  | 'settings'

export const SECTIONS: readonly SectionInstance[] = [
  'overview',
  'databases',
  'roles',
  'privileges',
  'sessions',
  'extensions',
  'settings',
]

/**
 * Le sigle d'une cellule de la matrice : `ALL`, `CTc`, `Tc`, `c`, `—`.
 *
 * **`ALL` n'est pas `CTc` écrit autrement**, bien que les trois privilèges soient les mêmes : c'est
 * ce que la maquette montre, et c'est ce qu'on cherche du regard en balayant une colonne. Un sigle
 * composé aurait demandé de lire trois lettres pour voir qu'il n'en manque aucune.
 *
 * Les lettres suivent l'ordre `C T c` de la légende, **toujours** : un sigle dont l'ordre suivrait
 * les privilèges présents rendrait `cT` et `Tc` pour la même chose, et l'œil ne pourrait plus
 * comparer deux lignes sans les lire.
 */
export function sigleDe(privilege: InstancePrivilege): string {
  if (privilege.create && privilege.temporary && privilege.connect) return 'ALL'
  const lettres = [
    privilege.create ? 'C' : '',
    privilege.temporary ? 'T' : '',
    privilege.connect ? 'c' : '',
  ].join('')
  // Le tiret cadratin, comme partout ailleurs dans le produit : une cellule vide se lirait comme
  // une donnée manquante là où « aucun privilège » est une réponse.
  return lettres === '' ? '—' : lettres
}

/**
 * La matrice, indexée par rôle puis par base.
 *
 * **Une table et non la liste rendue par le cœur** : le tableau est dessiné ligne par ligne, et
 * chercher la cellule `(rôle, base)` dans un tableau plat coûterait un parcours par cellule — sur
 * cinquante rôles et vingt bases, mille parcours de mille éléments à chaque rendu.
 */
export function matriceDe(
  privileges: readonly InstancePrivilege[],
): Map<string, Map<string, InstancePrivilege>> {
  const matrice = new Map<string, Map<string, InstancePrivilege>>()
  for (const privilege of privileges) {
    let ligne = matrice.get(privilege.role)
    if (ligne === undefined) {
      ligne = new Map()
      matrice.set(privilege.role, ligne)
    }
    ligne.set(privilege.database, privilege)
  }
  return matrice
}

/** Les bases de la matrice, dans l'ordre où le cœur les a rendues, sans doublon. */
export function basesDe(privileges: readonly InstancePrivilege[]): string[] {
  const vues = new Set<string>()
  const bases: string[] = []
  for (const privilege of privileges) {
    if (vues.has(privilege.database)) continue
    vues.add(privilege.database)
    bases.push(privilege.database)
  }
  return bases
}

/**
 * Le droit qu'a ce compte de faire un geste, tel que le cœur l'a dit.
 *
 * **Permis par défaut quand la vue d'ensemble n'a pas encore répondu.** L'inverse — tout grisé tant
 * qu'on ne sait pas — ferait d'une lecture lente un écran mort, et l'utilisateur croirait à un
 * compte sans droits. Un geste que le serveur refusera dit son refus au retour ; un bouton grisé
 * sans raison ne dit rien du tout.
 */
export function permis(
  capabilities: readonly Capability[] | undefined,
  gesture: InstanceGesture,
): boolean {
  if (capabilities === undefined) return true
  return capabilities.find((capacite) => capacite.gesture === gesture)?.allowed ?? true
}

/** La raison d'un refus, pour le `title` d'un contrôle désactivé. `undefined` s'il est permis. */
export function raisonDuRefus(
  capabilities: readonly Capability[] | undefined,
  gesture: InstanceGesture,
): string | undefined {
  const capacite = capabilities?.find((entree) => entree.gesture === gesture)
  if (capacite === undefined || capacite.allowed) return undefined
  return capacite.reason ?? undefined
}

/**
 * Les attributs d'un rôle, en mots, pour la colonne « attributs ».
 *
 * Vide quand le rôle n'en a aucun — l'écran y met alors le tiret cadratin. Écrire « aucun » dans la
 * cellule ferait une colonne de « aucun » là où le tiret se lit d'un coup d'œil.
 */
export function attributsDe(role: InstanceRole): string[] {
  const mots: string[] = []
  if (role.superuser) mots.push('SUPERUSER')
  if (role.createDb) mots.push('CREATEDB')
  if (role.createRole) mots.push('CREATEROLE')
  if (role.replication) mots.push('REPLICATION')
  if (role.bypassRls) mots.push('BYPASSRLS')
  return mots
}

/**
 * Vers qui réattribuer ce qu'un rôle possède, par défaut.
 *
 * **Le rôle avec lequel on est connecté**, parce que c'est le seul dont on soit certain qu'il existe
 * et qu'il puisse recevoir : `REASSIGN OWNED … TO` exige d'être membre du rôle destinataire, ce
 * qu'un superutilisateur est toujours de lui-même. Proposer le premier de la liste tomberait sur un
 * `pg_monitor` qui ne peut rien posséder.
 *
 * Rend `null` quand le rôle courant **est** celui qu'on supprime : il ne peut pas se recevoir
 * lui-même, et l'écran doit alors faire choisir.
 */
export function destinataireParDefaut(
  roleCourant: string | undefined,
  aSupprimer: string,
): string | null {
  if (roleCourant === undefined || roleCourant === aSupprimer) return null
  return roleCourant
}

/**
 * Une durée en secondes, telle que la colonne « durée » l'affiche : `3 s`, `2 min`, `4 h`, `3 j`.
 *
 * **Un seul palier, jamais « 2 h 14 min »** : la colonne dit depuis combien de temps une session est
 * dans son état, et l'ordre de grandeur est ce qu'on y cherche. La précision d'une minute sur une
 * session vieille de deux heures n'a aucun lecteur.
 */
export function dureeLisible(secondes: number | null): string {
  if (secondes === null || !Number.isFinite(secondes) || secondes < 0) return '—'
  const entier = Math.trunc(secondes)
  if (entier < 60) return `${entier} s`
  if (entier < 3600) return `${Math.trunc(entier / 60)} min`
  if (entier < 86400) return `${Math.trunc(entier / 3600)} h`
  return `${Math.trunc(entier / 86400)} j`
}

/**
 * L'âge d'un relevé, pour la phrase « relevé il y a 12 s ».
 *
 * **Rendu en secondes entières, plancher à zéro** : une horloge locale qui recule d'une milliseconde
 * — un ajustement NTP, un test qui fige le temps — donnerait « relevé il y a -1 s », qui se lit
 * comme un défaut.
 */
export function ageEnSecondes(releve: number, maintenant: number): number {
  return Math.max(0, Math.trunc((maintenant - releve) / 1000))
}

/**
 * L'âge d'un relevé **en toutes lettres** : `12 s`, `4 min`, `2 h`, `3 j` (9 septembre 2026,
 * rapporté à l'usage).
 *
 * La phrase disait toujours des secondes. Or il n'y a **aucun rafraîchissement automatique** : un
 * onglet d'instance laissé ouvert une nuit annonçait « relevé il y a 41 400 s », un nombre que
 * personne ne convertit de tête — donc une phrase qui cessait de dire ce qu'elle est là pour dire,
 * l'ordre de grandeur de ce qu'on regarde. C'est précisément quand le relevé est vieux qu'elle
 * compte le plus.
 *
 * **La même fonction que la durée d'une session**, `dureeLisible` : les deux répondent à « depuis
 * combien de temps », dans la même barre d'écran à quelques pixels l'une de l'autre. Deux échelles
 * voisines mais distinctes — l'une en secondes, l'autre en paliers — se seraient lues comme deux
 * unités différentes.
 */
export function ageLisible(releve: number, maintenant: number): string {
  return dureeLisible(ageEnSecondes(releve, maintenant))
}

/**
 * L'instance que la sidebar désigne, retrouvée par son identifiant.
 *
 * **Par identifiant et non par libellé** : deux instances peuvent porter le même libellé, et c'est
 * délibéré — l'identifiant est ce qui les distingue depuis qu'il est dérivé puis figé.
 */
export function instanceDe(
  instances: readonly ManagedInstance[],
  id: string,
): ManagedInstance | undefined {
  return instances.find((instance) => instance.id === id)
}

/**
 * Le nom qu'une ligne de sidebar affiche.
 *
 * Le pendant de la règle de l'arbre — `base.label?.trim() || base.name` — avec l'identifiant en
 * dernier recours : une ligne sans texte serait inatteignable au clic comme au clavier.
 */
export function nomAffiche(instance: ManagedInstance): string {
  const libelle = instance.label.trim()
  return libelle === '' ? instance.id : libelle
}
