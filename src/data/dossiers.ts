import type {
  ConnectionId,
  Database,
  EffectiveReadOnly,
  Engine,
  Folder,
  FolderId,
  FolderTree,
} from '../domain/config'

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
 * L'identifiant d'une connexion — obligatoire depuis #165, donc un simple accès. La fonction reste
 * parce que tout le front la lit par là : c'est le seul endroit qui dise que l'identité d'une
 * connexion est son `id`, jamais son nom.
 */
export function idDeConnexion(base: Database): ConnectionId {
  return base.id
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
 * sous-dossier n'y changerait rien. C'est aussi celui que nomment la case figée d'`A2`, la barre
 * d'état de la grille et le refus de la console — le premier de `EffectiveReadOnly.folders`.
 */
export function ancetreEnLectureSeule(ancetres: readonly Folder[]): Folder | null {
  return ancetres.find((ancetre) => ancetre.readOnly) ?? null
}

/**
 * La lecture seule **effective** d'une connexion (#168) — le miroir exact de
 * `FolderTree::lecture_seule_effective`, que les commandes qui écrivent consultent côté cœur.
 *
 * **Imposée** si un ancêtre au moins la déclare — tous les ancêtres, pas le seul parent —, les
 * dossiers allant du plus extérieur au plus proche ; **locale** sinon, le réglage de la connexion
 * décidant seul. `null` pour une connexion que l'arbre ne porte pas.
 *
 * **Une règle, deux côtés du pont** (règle n° 20) : l'écran s'en sert pour désactiver ce que le cœur
 * refuserait — ⌘E, la case d'`A2`, la console —, et la fixture partagée
 * `src-tauri/tests/fixtures/lecture-seule.json` est lue par les deux implémentations, qui doivent
 * rendre la même chose.
 */
export function lectureSeuleEffective(
  arbre: FolderTree,
  id: ConnectionId,
): EffectiveReadOnly | null {
  const situee = connexion(arbre, id)
  if (situee === null) return null
  return lectureSeuleSituee(situee)
}

/** La même règle sur une connexion déjà située — pour qui a déjà ses ancêtres sous la main. */
export function lectureSeuleSituee(situee: ConnexionSituee): EffectiveReadOnly {
  const folders = situee.ancetres.filter((ancetre) => ancetre.readOnly).map((a) => a.id)
  return folders.length > 0
    ? { kind: 'imposed', folders }
    : { kind: 'local', readOnly: situee.base.connection.readOnly }
}

/** Vrai quand la connexion est en lecture seule, quelle qu'en soit la cause. */
export function estEnLectureSeule(lecture: EffectiveReadOnly | null): boolean {
  if (lecture === null) return false
  return lecture.kind === 'imposed' || lecture.readOnly
}

/**
 * Le nom du dossier qui impose la lecture seule — le plus extérieur, celui qu'il faut aller lever —,
 * ou `null` quand elle n'est pas imposée. C'est ce que nomment la case figée d'`A2`, la barre d'état
 * de la grille, le bouton du mode édition et le refus de la console.
 */
export function dossierQuiImpose(
  arbre: FolderTree,
  lecture: EffectiveReadOnly | null,
): string | null {
  if (lecture?.kind !== 'imposed') return null
  const premier = lecture.folders[0]
  return (premier === undefined ? null : dossier(arbre, premier)?.dossier.name) ?? null
}

/**
 * La raison d'une lecture seule effective, **déjà traduite** — ou `null` quand la connexion écrit.
 *
 * Une seule phrase pour tous les endroits qui refusent ou figent (#168) : le bouton du mode édition,
 * le gestionnaire de schémas, le refus de la console. Elle nomme **où** la lever — le dossier, ou le
 * réglage de la connexion —, parce qu'un refus qui ne dit pas quoi faire se lit comme une panne.
 */
export function raisonDeLaLectureSeule(
  t: (cle: string, parametres?: Record<string, string | number>) => string,
  arbre: FolderTree,
  lecture: EffectiveReadOnly | null,
  moteur?: Engine,
): string | null {
  if (!estEnLectureSeule(lecture)) return null
  const nom = dossierQuiImpose(arbre, lecture)
  const raison =
    nom === null
      ? t('shell.lectureSeule.locale')
      : t('shell.lectureSeule.imposee', { dossier: nom })
  // **Deux moteurs n'ont pas de session en lecture seule**, et cela se dit plutôt que se découvre :
  // MongoDB n'a pas d'équivalent à `SET SESSION … READ ONLY`, BigQuery exécute chaque requête comme
  // un job indépendant. Le refus y est celui de DoraBase seul — l'écran et le cœur —, pas du serveur.
  return moteur !== undefined && !MOTEURS_A_SESSION_EN_LECTURE_SEULE.has(moteur)
    ? `${raison} ${t('shell.lectureSeule.sansSession')}`
    : raison
}

/**
 * Les moteurs dont l'adaptateur met la **session** en lecture seule (#168) : `SET SESSION
 * CHARACTERISTICS AS TRANSACTION READ ONLY`, `SET SESSION TRANSACTION READ ONLY`, `PRAGMA
 * query_only`. Le miroir des trois `connect_via` qui la posent côté cœur.
 */
const MOTEURS_A_SESSION_EN_LECTURE_SEULE: ReadonlySet<Engine> = new Set([
  'postgresql',
  'mysql',
  'sqlite',
])

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

// -------------------------------------------------------------------------------------------------
// Déplacer (#167)
// -------------------------------------------------------------------------------------------------

/** Ce qu'on déplace : un dossier et tout ce qu'il contient, ou une connexion. */
export type SujetDuDeplacement =
  | { kind: 'folder'; folder: FolderId }
  | { kind: 'database'; connection: ConnectionId }

/** Où on le range : un dossier (`null` : la racine), et la place parmi ses frères d'arrivée. */
export type ArriveeDuDeplacement = { destination: FolderId | null; index: number | null }

/** Ce qu'un déplacement fait à la lecture seule — la forme de `confirmationRequired`. */
export type EffetSurLaLectureSeule = {
  becomesReadOnly: ConnectionId[]
  leavesReadOnly: ConnectionId[]
  folders: FolderId[]
}

/** Le dossier qui range ce sujet, `null` à la racine ; `undefined` s'il n'est plus dans l'arbre. */
export function parentDu(
  arbre: FolderTree,
  sujet: SujetDuDeplacement,
): FolderId | null | undefined {
  const ancetres =
    sujet.kind === 'folder'
      ? dossier(arbre, sujet.folder)?.ancetres
      : connexion(arbre, sujet.connection)?.ancetres
  if (ancetres === undefined) return undefined
  return ancetres.at(-1)?.id ?? null
}

/** Le dossier et tous ses descendants — les destinations où il ne peut pas se ranger. */
export function luiEtSesDescendants(arbre: FolderTree, id: FolderId): Set<FolderId> {
  const situe = dossier(arbre, id)
  const tous = new Set<FolderId>()
  const parcourir = (d: Folder) => {
    tous.add(d.id)
    for (const sous of d.folders ?? []) parcourir(sous)
  }
  if (situe !== null) parcourir(situe.dossier)
  return tous
}

/**
 * L'arbre d'arrivée d'un déplacement, **sans aucun refus** — l'aperçu de la modale et les doubles.
 *
 * Le miroir de `deplacer_dossier` / `deplacer_connexion` : `index` compte les frères d'arrivée sans
 * le sujet, et un rang trop grand veut dire « en dernier ». `null` si le sujet ou la destination
 * n'existe plus. **Ce n'est pas l'écran qui décide** : il repose l'arbre que le cœur rend.
 */
export function arbreApresDeplacement(
  arbre: FolderTree,
  sujet: SujetDuDeplacement,
  { destination, index }: ArriveeDuDeplacement,
): FolderTree | null {
  if (destination !== null && dossier(arbre, destination) === null) return null
  let extrait: Folder | Database | null = null
  const garderDossier = (d: Folder) => {
    if (sujet.kind === 'folder' && d.id === sujet.folder) {
      extrait = d
      return false
    }
    return true
  }
  const garderBase = (b: Database) => {
    if (sujet.kind === 'database' && idDeConnexion(b) === sujet.connection) {
      extrait = b
      return false
    }
    return true
  }
  const visiter = (d: Folder): Folder => ({
    ...d,
    ...(d.folders === undefined ? {} : { folders: d.folders.filter(garderDossier).map(visiter) }),
    ...(d.connections === undefined ? {} : { connections: d.connections.filter(garderBase) }),
  })
  const sans: FolderTree = {
    folders: arbre.folders.filter(garderDossier).map(visiter),
    connections: arbre.connections.filter(garderBase),
  }
  const element = extrait as Folder | Database | null
  if (element === null) return null
  const inserer = <T>(liste: readonly T[]): T[] => {
    const rang = Math.min(index ?? liste.length, liste.length)
    return [...liste.slice(0, rang), element as T, ...liste.slice(rang)]
  }
  if (destination === null) {
    return sujet.kind === 'folder'
      ? { ...sans, folders: inserer(sans.folders) }
      : { ...sans, connections: inserer(sans.connections) }
  }
  return surDossier(sans, destination, (d) =>
    sujet.kind === 'folder'
      ? { ...d, folders: inserer(d.folders ?? []) }
      : { ...d, connections: inserer(d.connections ?? []) },
  )
}

/**
 * Ce qu'un changement d'arbre fait à la lecture seule effective, ou `null` s'il n'y change rien —
 * le miroir de `question_de_lecture_seule` côté cœur.
 *
 * **La lecture seule effective, pas le drapeau des dossiers** : un dossier en lecture seule emporte
 * la sienne où il va, et une connexion réglée en lecture seule le reste partout. Le dossier nommé est
 * celui qui l'impose **après** pour une entrée, **avant** pour une sortie.
 */
export function effetSurLaLectureSeule(
  avant: FolderTree,
  apres: FolderTree,
): EffetSurLaLectureSeule | null {
  const effet: EffetSurLaLectureSeule = { becomesReadOnly: [], leavesReadOnly: [], folders: [] }
  for (const { base } of connexions(avant)) {
    const id = idDeConnexion(base)
    const lectureAvant = lectureSeuleEffective(avant, id)
    const lectureApres = lectureSeuleEffective(apres, id)
    if (lectureApres === null) continue
    const devient = estEnLectureSeule(lectureApres)
    if (estEnLectureSeule(lectureAvant) === devient) continue
    const source = devient ? lectureApres : lectureAvant
    if (source?.kind === 'imposed') {
      for (const folder of source.folders)
        if (!effet.folders.includes(folder)) effet.folders.push(folder)
    }
    ;(devient ? effet.becomesReadOnly : effet.leavesReadOnly).push(id)
  }
  return effet.becomesReadOnly.length + effet.leavesReadOnly.length === 0 ? null : effet
}

/**
 * Le déplacement **rejoué sans cœur** — pour la démo et les doubles de test, jamais pour l'écran de
 * production. Les mêmes refus, la même question, dans le même ordre que `deplacer_*`.
 */
export function deplacementSimule(
  arbre: FolderTree,
  sujet: SujetDuDeplacement,
  arrivee: ArriveeDuDeplacement,
  confirmed: boolean,
):
  | { kind: 'moved'; tree: FolderTree }
  | ({ kind: 'confirmationRequired' } & EffetSurLaLectureSeule) {
  if (sujet.kind === 'folder' && arrivee.destination !== null) {
    if (luiEtSesDescendants(arbre, sujet.folder).has(arrivee.destination)) {
      throw 'un dossier ne se range pas dans lui-même ni dans ses sous-dossiers'
    }
  }
  const apres = arbreApresDeplacement(arbre, sujet, arrivee)
  if (apres === null) throw 'le dossier ou la connexion désignée n’existe plus'
  if (sujet.kind === 'folder') {
    const nom = dossier(arbre, sujet.folder)?.dossier.name.trim()
    const freres =
      arrivee.destination === null
        ? arbre.folders
        : (dossier(arbre, arrivee.destination)?.dossier.folders ?? [])
    if (freres.some((frere) => frere.id !== sujet.folder && frere.name.trim() === nom)) {
      throw `un dossier nommé « ${nom} » existe déjà à cet endroit : renommez l'un des deux avant de déplacer`
    }
  }
  const effet = confirmed ? null : effetSurLaLectureSeule(arbre, apres)
  return effet === null
    ? { kind: 'moved', tree: apres }
    : { kind: 'confirmationRequired', ...effet }
}
