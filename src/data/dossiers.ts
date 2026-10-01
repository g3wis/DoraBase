import type { ConnectionId, Database, Folder, FolderId, FolderTree } from '../domain/config'

/**
 * L'arbre de dossiers (#166), lu par l'écran : des fonctions **pures**, sans IPC.
 *
 * Le cœur tient les mêmes en Rust (`config/arbre.rs`) — `connexion`, `chemin_de`,
 * `libelles_de`… — et c'est lui qui décide ce qui s'écrit. Celles-ci ne font que **lire** l'arbre
 * que le cœur a rendu : retrouver une connexion par son identifiant, nommer son chemin, dire quel
 * ancêtre impose la lecture seule. Aucune ne décide d'un état d'arrivée ; les écritures nomment un
 * geste (`create_folder`, `rename_folder`…) et reposent l'arbre rendu.
 *
 * **Tout se désigne par identifiant, jamais par nom.** Un dossier se renomme, une connexion aussi,
 * et aucun des deux ne change d'identité pour autant : c'est ce qui a fait partir la réindexation
 * des onglets et des consoles qu'un renommage exigeait avant (#166).
 */

/** L'arbre vide : ni dossier, ni connexion. */
export const ARBRE_VIDE: FolderTree = Object.freeze({
  folders: [],
  connections: [],
}) as unknown as FolderTree

/**
 * L'identifiant d'une connexion.
 *
 * **Transitoire** : la projection de #164 le déclare encore facultatif (`id?`), parce que la chaîne
 * de chargement lit des fichiers v6 qui n'en portent pas. #165 le rend obligatoire ; ce détour
 * devient alors un simple accès, et il est le seul endroit du front qui ait à le savoir.
 */
export function idDeConnexion(base: Database): ConnectionId {
  return base.id ?? ''
}

/** Vrai quand l'arbre ne porte rien — l'écran d'accueil prend alors la place de l'écran de travail. */
export function arbreEstVide(arbre: FolderTree): boolean {
  return arbre.folders.length === 0 && arbre.connections.length === 0
}

/** Une connexion et les dossiers qui la contiennent, du plus extérieur au plus proche. */
export type ConnexionSituee = { base: Database; ancetres: readonly Folder[] }

/** Un dossier et ses ancêtres, du plus extérieur au plus proche (lui exclu). */
export type DossierSitue = { dossier: Folder; ancetres: readonly Folder[] }

/** Toutes les connexions de l'arbre, à toute profondeur, dans l'ordre déclaré. */
export function connexions(arbre: FolderTree): ConnexionSituee[] {
  const toutes: ConnexionSituee[] = arbre.connections.map((base) => ({ base, ancetres: [] }))
  const parcourir = (dossier: Folder, ancetres: readonly Folder[]) => {
    const chemin = [...ancetres, dossier]
    for (const sous of dossier.folders ?? []) parcourir(sous, chemin)
    for (const base of dossier.connections ?? []) toutes.push({ base, ancetres: chemin })
  }
  for (const dossier of arbre.folders) parcourir(dossier, [])
  return toutes
}

/** Tous les dossiers de l'arbre, à toute profondeur, parents avant enfants. */
export function dossiers(arbre: FolderTree): DossierSitue[] {
  const tous: DossierSitue[] = []
  const parcourir = (dossier: Folder, ancetres: readonly Folder[]) => {
    tous.push({ dossier, ancetres })
    for (const sous of dossier.folders ?? []) parcourir(sous, [...ancetres, dossier])
  }
  for (const dossier of arbre.folders) parcourir(dossier, [])
  return tous
}

/** La connexion que cet identifiant désigne, avec ses ancêtres ; `null` si elle n'existe plus. */
export function connexion(arbre: FolderTree, id: ConnectionId): ConnexionSituee | null {
  return connexions(arbre).find((situee) => idDeConnexion(situee.base) === id) ?? null
}

/** Le dossier que cet identifiant désigne, avec ses ancêtres ; `null` s'il n'existe plus. */
export function dossier(arbre: FolderTree, id: FolderId): DossierSitue | null {
  return dossiers(arbre).find((situe) => situe.dossier.id === id) ?? null
}

/** Les connexions d'un dossier, **à toute profondeur** — ce qu'un retrait emporte. */
export function connexionsDescendantes(dossier: Folder): Database[] {
  return [
    ...(dossier.folders ?? []).flatMap(connexionsDescendantes),
    ...(dossier.connections ?? []),
  ]
}

/**
 * Le chemin de dossiers d'une connexion, par leurs **noms** — « Atelier Nord › prod ».
 *
 * Un affichage, jamais une identité : deux chemins identiques peuvent désigner deux connexions.
 */
export function cheminDe(arbre: FolderTree, id: ConnectionId): string[] {
  return connexion(arbre, id)?.ancetres.map((ancetre) => ancetre.name) ?? []
}

/**
 * Le dossier le plus extérieur qui impose la lecture seule, parmi ces ancêtres.
 *
 * C'est la raison que l'entrée « Passer en lecture seule » donne quand elle est désactivée : un
 * ancêtre en lecture seule l'impose à tous ses descendants (#108), donc le réglage local d'un
 * sous-dossier n'y changerait rien.
 */
export function ancetreEnLectureSeule(ancetres: readonly Folder[]): Folder | null {
  return ancetres.find((ancetre) => ancetre.readOnly) ?? null
}

/**
 * Vrai quand un dossier contenant cette connexion est en lecture seule.
 *
 * **La lecture la plus simple de la lecture seule effective**, et elle ne remplace pas celle de
 * #168 : elle tient lieu, en attendant, du drapeau `production` que les environnements portaient.
 * Le décor migré marque justement `prod` en lecture seule, donc les garde-fous qui s'allumaient sur
 * « prod » s'allument toujours au même endroit.
 */
export function imposeeParUnDossier(arbre: FolderTree, id: ConnectionId): boolean {
  const situee = connexion(arbre, id)
  return situee !== null && ancetreEnLectureSeule(situee.ancetres) !== null
}

/** Le dossier coloré le plus proche parmi ces ancêtres — la pastille de la barre de titre. */
export function couleurLaPlusProche(ancetres: readonly Folder[]): Folder['color'] {
  for (let rang = ancetres.length - 1; rang >= 0; rang -= 1) {
    const couleur = ancetres[rang]?.color
    if (couleur) return couleur
  }
  return null
}

/**
 * Applique une transformation au dossier désigné, et rend l'arbre neuf — **pour les doubles de
 * test et la démo**, qui rejouent un geste faute de cœur. L'écran de production ne s'en sert pas :
 * il repose l'arbre que la commande rend.
 */
export function surDossier(
  arbre: FolderTree,
  id: FolderId,
  transforme: (dossier: Folder) => Folder,
): FolderTree {
  const visiter = (dossier: Folder): Folder => {
    const courant = dossier.id === id ? transforme(dossier) : dossier
    const sous = courant.folders
    return sous === undefined ? courant : { ...courant, folders: sous.map(visiter) }
  }
  return { ...arbre, folders: arbre.folders.map(visiter) }
}

/** Applique une transformation à la connexion désignée, où qu'elle soit. Même usage. */
export function surConnexion(
  arbre: FolderTree,
  id: ConnectionId,
  transforme: (base: Database) => Database,
): FolderTree {
  const surListe = (liste: readonly Database[]) =>
    liste.map((base) => (idDeConnexion(base) === id ? transforme(base) : base))
  const visiter = (dossier: Folder): Folder => ({
    ...dossier,
    ...(dossier.folders === undefined ? {} : { folders: dossier.folders.map(visiter) }),
    ...(dossier.connections === undefined ? {} : { connections: surListe(dossier.connections) }),
  })
  return { folders: arbre.folders.map(visiter), connections: surListe(arbre.connections) }
}

/** Retire les dossiers et connexions désignés, où qu'ils soient. Même usage. */
export function sansLesElements(
  arbre: FolderTree,
  retirer: { dossiers?: ReadonlySet<FolderId>; connexions?: ReadonlySet<ConnectionId> },
): FolderTree {
  const garderBase = (base: Database) => !retirer.connexions?.has(idDeConnexion(base))
  const garderDossier = (d: Folder) => !retirer.dossiers?.has(d.id)
  const visiter = (d: Folder): Folder => ({
    ...d,
    ...(d.folders === undefined ? {} : { folders: d.folders.filter(garderDossier).map(visiter) }),
    ...(d.connections === undefined ? {} : { connections: d.connections.filter(garderBase) }),
  })
  return {
    folders: arbre.folders.filter(garderDossier).map(visiter),
    connections: arbre.connections.filter(garderBase),
  }
}

/**
 * « dossier N », le plus petit N libre parmi les frères — la règle de `create_folder`, rejouée par
 * les doubles. C'est celle des consoles (« console N ») : aucune modale ne nomme un objet à sa
 * création.
 */
export function nomDeDossierLibre(freres: readonly Folder[]): string {
  const pris = new Set(freres.map((frere) => frere.name.trim()))
  let rang = 1
  while (pris.has(`dossier ${rang}`)) rang += 1
  return `dossier ${rang}`
}

/**
 * Ce que l'écran affiche pour une connexion : son libellé s'il est renseigné, son nom sinon
 * (`27a`). **Un affichage, jamais une identité** — c'est l'identifiant qui désigne.
 */
export function libelleDeConnexion(arbre: FolderTree, id: ConnectionId): string | undefined {
  const base = connexion(arbre, id)?.base
  return base === undefined ? undefined : base.label?.trim() || base.name
}
