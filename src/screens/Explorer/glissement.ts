import {
  type ArriveeDuDeplacement,
  connexion,
  dossier,
  idDeConnexion,
  luiEtSesDescendants,
  parentDu,
  type SujetDuDeplacement,
} from '../../data/dossiers'
import type { FolderId, FolderTree } from '../../domain/config'
import type { Noeud } from './arbre'

/**
 * Le glisser-déposer de l'arbre (#167), **en fonctions pures** : où tombe un dépôt, et ce qu'il veut
 * dire. Le branchement aux événements pointeur vit dans `ExplorerSidebar` ; la géométrie et le sens
 * vivent ici, où Vitest peut les juger sans mise en page (règle n° 9).
 */

/** Où, sur une ligne, le pointeur relâche : avant elle, après elle, ou dedans (un dossier). */
export type Position = 'avant' | 'apres' | 'dedans'

/** Ce que le pointeur désigne : une ligne et une position, ou la bande de la racine. */
export type CibleDuDepot = { kind: 'racine' } | { kind: 'ligne'; noeud: Noeud; position: Position }

/** Le sujet d'un glissement, tiré de la ligne saisie ; `null` pour une ligne qui ne se déplace pas. */
export function sujetDe(noeud: Noeud): SujetDuDeplacement | null {
  if (noeud.kind === 'folder' && noeud.folder !== undefined) {
    return { kind: 'folder', folder: noeud.folder }
  }
  if (noeud.kind === 'database' && noeud.connection !== undefined) {
    return { kind: 'database', connection: noeud.connection }
  }
  return null
}

/**
 * La position du pointeur dans une ligne, par **tiers** pour un dossier — le tiers haut avant, le
 * tiers bas après, le tiers central dedans — et par **moitié** pour une connexion, qui ne contient
 * rien.
 */
export function positionDansLaLigne(
  y: number,
  haut: number,
  hauteur: number,
  kind: Noeud['kind'],
): Position {
  const relatif = (y - haut) / hauteur
  if (kind !== 'folder') return relatif < 0.5 ? 'avant' : 'apres'
  if (relatif < 1 / 3) return 'avant'
  if (relatif > 2 / 3) return 'apres'
  return 'dedans'
}

/** Le rang d'une ligne parmi ses frères de même sorte, le sujet exclu du compte. */
function rangParmi<T>(
  liste: readonly T[],
  cle: (element: T) => string,
  vise: string,
  sujet: string,
) {
  return liste
    .map(cle)
    .filter((c) => c !== sujet)
    .indexOf(vise)
}

/**
 * Ce qu'un dépôt veut dire : l'arrivée à envoyer au cœur, et le dossier à déplier pour que le sujet
 * reste visible — ou `null` quand le dépôt ne veut rien dire (sur soi-même, dans son propre
 * descendant, sur une ligne qui n'est ni un dossier ni une connexion).
 *
 * Les sortes se rangent chacune dans sa liste — les sous-dossiers, puis les connexions — donc :
 * - **une connexion lâchée sur un dossier y entre**, quelle que soit la position : l'arbre montre les
 *   connexions après les sous-dossiers, et « avant ce dossier » n'aurait aucune place à désigner ;
 * - **un dossier lâché sur une connexion** rejoint le dossier de celle-ci, en dernier de ses
 *   sous-dossiers ;
 * - **« après » un dossier déplié** veut dire « en tête de ses enfants » : c'est la ligne qui suit à
 *   l'écran.
 */
export function arriveeDuDepot(
  arbre: FolderTree,
  sujet: SujetDuDeplacement,
  cible: CibleDuDepot,
): { arrivee: ArriveeDuDeplacement; deplier: FolderId | null } | null {
  const interdits =
    sujet.kind === 'folder' ? luiEtSesDescendants(arbre, sujet.folder) : new Set<FolderId>()
  const permis = (destination: FolderId | null) =>
    destination === null || !interdits.has(destination)

  if (cible.kind === 'racine') return { arrivee: { destination: null, index: null }, deplier: null }

  const { noeud, position } = cible
  const cleSujet = sujet.kind === 'folder' ? sujet.folder : sujet.connection

  if (noeud.kind === 'folder' && noeud.folder !== undefined) {
    const vise = noeud.folder
    if (sujet.kind === 'folder' && vise === sujet.folder) return null
    const dedans =
      sujet.kind === 'database' ||
      position === 'dedans' ||
      (position === 'apres' && noeud.chevron === 'open')
    if (dedans) {
      if (!permis(vise)) return null
      const enTete = sujet.kind === 'folder' && position === 'apres'
      return { arrivee: { destination: vise, index: enTete ? 0 : null }, deplier: vise }
    }
    const parent = parentDu(arbre, { kind: 'folder', folder: vise })
    if (parent === undefined || !permis(parent)) return null
    const freres = parent === null ? arbre.folders : (dossier(arbre, parent)?.dossier.folders ?? [])
    const rang = rangParmi(freres, (d) => d.id, vise, cleSujet)
    return {
      arrivee: { destination: parent, index: rang + (position === 'apres' ? 1 : 0) },
      deplier: null,
    }
  }

  if (noeud.kind === 'database' && noeud.connection !== undefined) {
    const vise = noeud.connection
    if (sujet.kind === 'database' && vise === sujet.connection) return null
    const parent = parentDu(arbre, { kind: 'database', connection: vise })
    if (parent === undefined || !permis(parent)) return null
    if (sujet.kind === 'folder')
      return { arrivee: { destination: parent, index: null }, deplier: null }
    const freres =
      parent === null ? arbre.connections : (dossier(arbre, parent)?.dossier.connections ?? [])
    const rang = rangParmi(freres, idDeConnexion, vise, cleSujet)
    return {
      arrivee: { destination: parent, index: rang + (position === 'apres' ? 1 : 0) },
      deplier: null,
    }
  }

  return null
}

/** Vrai si l'arrivée laisse le sujet exactement où il est — un dépôt qui ne demande rien au cœur. */
export function arriveeSansEffet(
  arbre: FolderTree,
  sujet: SujetDuDeplacement,
  { destination, index }: ArriveeDuDeplacement,
): boolean {
  if (parentDu(arbre, sujet) !== destination || index === null) return false
  const freres =
    sujet.kind === 'folder'
      ? (destination === null
          ? arbre.folders
          : (dossier(arbre, destination)?.dossier.folders ?? [])
        ).map((d) => d.id)
      : (destination === null
          ? arbre.connections
          : (dossier(arbre, destination)?.dossier.connections ?? [])
        ).map(idDeConnexion)
  const cle = sujet.kind === 'folder' ? sujet.folder : sujet.connection
  return freres.indexOf(cle) === index
}

/** Le nom qu'affiche un sujet, pour la modale et les refus. */
export function nomDuSujet(arbre: FolderTree, sujet: SujetDuDeplacement): string {
  if (sujet.kind === 'folder') return dossier(arbre, sujet.folder)?.dossier.name ?? sujet.folder
  const base = connexion(arbre, sujet.connection)?.base
  return base === undefined ? sujet.connection : base.label?.trim() || base.name
}
