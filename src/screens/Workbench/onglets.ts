import type { DatabaseKey } from '../../domain/engine'

/**
 * Le modèle d'onglets de l'écran de travail, en fonctions **pures**.
 *
 * `TabStrip` (`03`) ne connaît que des `Tab` — identifiant, icône, libellé. Ce que `A5` ouvre
 * est une **table dans une base** : l'identité d'un onglet porte donc la `DatabaseKey` entière.
 * Deux bases peuvent avoir une table `public.orders` ; un identifiant réduit au nom les
 * confondrait, et l'utilisateur verrait le contenu de l'autre.
 *
 * Isolé du rendu pour la même raison qu'`arbre.ts` en `09d` : ces règles se testent sans DOM.
 */

/**
 * Une table ouverte dans un onglet.
 *
 * **`sorte` discrimine l'union, `kind` reste ce que le domaine appelle ainsi** — table ou vue, pour
 * l'icône de la bande. Deux champs voisins, et c'est délibéré : renommer `kind` le désaccorderait de
 * `TableSummary.kind`, qui vient des projections de `ts-rs` et n'est pas à nous.
 */
export type OngletTable = {
  sorte: 'table'
  key: DatabaseKey
  schema: string
  table: string
  /** Pilote l'icône de la bande — une vue n'est pas une table. */
  kind: 'table' | 'view'
}

/**
 * Une console SQL ouverte dans un onglet (`12a`).
 *
 * **Le numéro fait partie de l'identité**, et pas seulement du libellé : deux consoles sur la même
 * base sont deux consoles, contrairement à deux onglets sur la même table qui n'en font qu'un. On
 * ouvre une seconde console *parce qu'on veut* garder la première.
 */
export type OngletConsole = {
  sorte: 'console'
  key: DatabaseKey
  numero: number
  /**
   * La langue que la console parle (`13a`).
   *
   * **Un dialecte, et non une troisième forme d'onglet.** Ce qui change entre une console SQL et une
   * console mongo est la **grammaire** de l'éditeur et la forme du résultat — pas la nature de
   * l'onglet : il se ferme, se réordonne et garde son texte exactement pareil.
   *
   * Le dialecte suit le moteur de la base, il ne se choisit pas : une console mongo sur une base
   * PostgreSQL n'aurait rien à interroger.
   */
  dialecte: Dialecte
  /**
   * Le nom de la console **persistée** que cet onglet ouvre, quand il en ouvre une.
   *
   * Absent, l'onglet est un brouillon : il porte « console 1 » et son texte meurt avec lui. Présent,
   * l'identité de l'onglet dérive du nom et non du numéro — rouvrir la même console depuis l'arbre
   * réactive l'onglet au lieu d'en empiler un second, et le renommer côté disque ne casse rien tant
   * que l'écran met la table des onglets à jour.
   */
  nom?: string
}

/**
 * Le libellé d'une console : son nom si elle est persistée, « console N » sinon.
 *
 * **Un seul endroit, parce que deux endroits en font deux vérités** (règle n° 17). Il nomme l'onglet
 * et, depuis `API-29`, le fichier que l'export propose : un fichier nommé autrement que l'onglet
 * dont il sort ferait chercher lequel des deux a raison.
 */
export function libelleDeConsole(onglet: Pick<OngletConsole, 'nom' | 'numero'>): string {
  return onglet.nom ?? `console ${onglet.numero}`
}

/** Les langues de console que le projet connaît. `19` (Redis) en ajoutera une troisième. */
export type Dialecte = 'sql' | 'mongo'

/**
 * Le diagramme de structure d'un schéma (3 septembre 2026).
 *
 * **Un onglet et non une troisième valeur de `VueObjet`.** Le couple « Données / Structure » est un
 * état *de la table ouverte* : il vit par onglet et se lit dans la colonne de droite. Un diagramme
 * ne parle pas d'une table, il parle d'un **schéma** — il n'y a pas de table dont il serait la
 * troisième vue, et le loger là aurait demandé d'en désigner une arbitrairement.
 *
 * **Il porte le schéma, pas la table** : c'est toute la différence avec `OngletTable`, et c'est ce
 * qui fait qu'un diagramme survit à l'ouverture et à la fermeture des tables qu'il montre.
 */
export type OngletDiagramme = {
  sorte: 'diagramme'
  key: DatabaseKey
  schema: string
}

/**
 * Ce qu'un onglet de l'écran de travail peut être.
 *
 * **Une union, depuis `12a`.** L'onglet était « une table ouverte » ; `A7` en fait aussi une console,
 * dans la **même bande** — un second système d'onglets à côté du premier doublerait la navigation
 * pour un seul écran. Le diagramme de schéma est le troisième membre, et il y entre pour la même
 * raison : c'est un contenu du centre, qui se ferme et se réordonne comme les autres.
 */
export type Onglet = OngletTable | OngletConsole | OngletDiagramme

/**
 * L'identité d'un onglet, **dérivée de la base et de ce qu'il ouvre**.
 *
 * **Un `switch` exhaustif, et non un test de la sorte qui compte** (`sorte !== 'console'`). Cette
 * fonction s'écrivait ainsi tant que l'union n'avait que deux membres : le troisième aurait alors
 * été traité comme une table, et l'accès à `onglet.table` aurait rendu `undefined` dans une chaîne —
 * donc une identité `…::undefined.undefined`, partagée par tous les diagrammes, sans que rien
 * échoue. C'est le défaut n° 16 par avance : un bras attrape-tout absorbe le membre suivant.
 */
export function idOnglet(onglet: Onglet): string {
  const { project, database, environment } = onglet.key
  const coordonnees = `${project}/${database}/${environment}`
  switch (onglet.sorte) {
    case 'table':
      return `${coordonnees}::${onglet.schema}.${onglet.table}`
    case 'diagramme':
      // Le préfixe sépare cet espace de celui des tables : un schéma nommé `diagramme` et une table
      // nommée `x` ne peuvent pas produire la même chaîne, `::diagramme/` n'étant pas `::diagramme.`.
      return `${coordonnees}::diagramme/${onglet.schema}`
    case 'console':
      // Une console persistée est identifiée par son nom ; un brouillon, par son numéro. Les deux
      // espaces ne se croisent pas : le préfixe les sépare.
      return onglet.nom === undefined
        ? `${coordonnees}::console/${onglet.numero}`
        : `${coordonnees}::console:${onglet.nom}`
  }
}

export type EtatOnglets = {
  onglets: readonly Onglet[]
  /** `null` quand il n'y a plus d'onglet — la bande reste, le centre revient à `A4`. */
  actif: string | null
}

export const AUCUN_ONGLET: EtatOnglets = { onglets: [], actif: null }

/**
 * Ouvre une table, ou **active l'onglet existant**.
 *
 * Deux onglets sur la même table donneraient deux états de filtres divergents pour une même
 * donnée. Aucun éditeur ne le fait par défaut, et le mockup ne montre pas de doublon.
 */
export function ouvrir(etat: EtatOnglets, onglet: OngletTable): EtatOnglets {
  const id = idOnglet(onglet)
  if (etat.onglets.some((existant) => idOnglet(existant) === id)) {
    return { onglets: etat.onglets, actif: id }
  }
  return { onglets: [...etat.onglets, onglet], actif: id }
}

/**
 * Ferme un onglet et active un voisin.
 *
 * **Fermer le dernier ne ferme pas l'écran.** Le mockup ne montre jamais zéro onglet ; le
 * minimum défendable est que la bande reste et que le centre revienne à la liste des objets.
 * Faire disparaître l'écran de travail sous les pieds de l'utilisateur serait hostile.
 */
export function fermer(etat: EtatOnglets, id: string): EtatOnglets {
  const index = etat.onglets.findIndex((onglet) => idOnglet(onglet) === id)
  if (index === -1) return etat

  const onglets = etat.onglets.filter((_, rang) => rang !== index)
  if (etat.actif !== id) return { onglets, actif: etat.actif }

  // Le voisin de droite, ou celui de gauche quand on ferme le dernier — l'ordre de tous les
  // éditeurs à onglets. Revenir au premier ferait sauter le regard à l'autre bout de la bande.
  const voisin = onglets[index] ?? onglets[index - 1]
  return { onglets, actif: voisin ? idOnglet(voisin) : null }
}

/**
 * Ouvre une **nouvelle** console sur une base, et l'active.
 *
 * **Elle ne réutilise jamais une console existante**, contrairement à `ouvrir` : deux onglets sur la
 * même table donneraient deux états de filtres divergents pour une même donnée, alors que deux
 * consoles sont deux brouillons — c'est le but.
 *
 * Le numéro est le plus petit disponible **sur cette base**, et non un compteur qui monte : après
 * avoir fermé « console 2 », la suivante reprend ce numéro plutôt que d'afficher « console 3 » à côté
 * d'une « console 1 » solitaire.
 */
export function ouvrirConsole(
  etat: EtatOnglets,
  key: DatabaseKey,
  dialecte: Dialecte = 'sql',
  nom?: string,
): EtatOnglets {
  // **Une console persistée déjà ouverte est réactivée**, jamais dupliquée : contrairement à un
  // brouillon, elle désigne un objet unique, et deux onglets sur le même texte divergeraient à la
  // première frappe.
  if (nom !== undefined) {
    const existant = etat.onglets.find(
      (onglet) => onglet.sorte === 'console' && onglet.nom === nom && memeBase(onglet.key, key),
    )
    if (existant) return { onglets: etat.onglets, actif: idOnglet(existant) }
    const console: OngletConsole = { sorte: 'console', key, numero: 0, dialecte, nom }
    return { onglets: [...etat.onglets, console], actif: idOnglet(console) }
  }

  const pris = new Set(
    etat.onglets
      .filter(
        (onglet): onglet is OngletConsole =>
          onglet.sorte === 'console' && onglet.nom === undefined && memeBase(onglet.key, key),
      )
      .map((onglet) => onglet.numero),
  )
  let numero = 1
  while (pris.has(numero)) numero += 1

  const console: OngletConsole = { sorte: 'console', key, numero, dialecte }
  return { onglets: [...etat.onglets, console], actif: idOnglet(console) }
}

/**
 * Ouvre le diagramme d'un schéma, ou **active celui qui l'est déjà**.
 *
 * Comme `ouvrir` et contrairement à `ouvrirConsole` : deux diagrammes du même schéma montreraient
 * le même dessin, avec deux échelles et deux sélections qui divergeraient. On ouvre une seconde
 * console *parce qu'on veut* garder la première ; personne ne veut deux fois le même diagramme.
 */
export function ouvrirDiagramme(etat: EtatOnglets, key: DatabaseKey, schema: string): EtatOnglets {
  const onglet: OngletDiagramme = { sorte: 'diagramme', key, schema }
  const id = idOnglet(onglet)
  if (etat.onglets.some((existant) => idOnglet(existant) === id)) {
    return { onglets: etat.onglets, actif: id }
  }
  return { onglets: [...etat.onglets, onglet], actif: id }
}

function memeBase(a: DatabaseKey, b: DatabaseKey): boolean {
  return a.project === b.project && a.database === b.database && a.environment === b.environment
}

export function reordonner(etat: EtatOnglets, ids: readonly string[]): EtatOnglets {
  const parId = new Map(etat.onglets.map((onglet) => [idOnglet(onglet), onglet]))
  const onglets = ids.map((id) => parId.get(id)).filter((onglet): onglet is Onglet => !!onglet)
  // Un réordonnancement qui perdrait un onglet en route est un bogue, pas une réorganisation :
  // mieux vaut garder l'ordre précédent que rendre une bande amputée.
  return onglets.length === etat.onglets.length ? { onglets, actif: etat.actif } : etat
}

export function ongletActif(etat: EtatOnglets): Onglet | null {
  return etat.onglets.find((onglet) => idOnglet(onglet) === etat.actif) ?? null
}

/**
 * Vrai quand un identifiant d'onglet appartient à la cible d'un retrait (`08j`).
 *
 * **Sur les coordonnées, pas sur le préfixe de la chaîne.** `idOnglet` compose
 * `projet/base/env::schema.table`, et un test de préfixe ferait de « Halle » un préfixe de
 * « Halles » — deux projets distincts dont l'un emporterait les onglets de l'autre.
 */
export function viseeParLId(
  cible: {
    kind: 'database' | 'project'
    project: string
    database?: string
    /**
     * L'environnement de la connexion visée, **obligatoire pour une cible `database`**.
     *
     * `idOnglet` le compose depuis toujours ; cette fonction ne le lisait pas. Retirer `analytics` en
     * production fermait donc aussi les onglets d'`analytics` en dev, et faussait le compte de
     * modifications que la confirmation de `08j` promet exact. Le défaut ne se voyait pas tant que
     * l'arbre ne montrait qu'un environnement à la fois ; le palier de `25a` le rend franc.
     */
    environment?: string
  },
  id: string,
): boolean {
  // `??` plutôt qu'un `!` : `split` rend toujours au moins un élément, mais l'affirmer au
  // compilateur pour une ligne n'apprend rien à personne — la valeur par défaut est vraie.
  const [coordonnees = ''] = id.split('::')
  const [projet, base, environnement] = coordonnees.split('/')
  if (projet !== cible.project) return false
  if (cible.kind === 'project') return true
  return base === cible.database && environnement === cible.environment
}

/**
 * L'identité d'un onglet ouvert sur une console persistée, sans avoir l'onglet sous la main.
 *
 * Les tables indexées par identité d'onglet — le texte, l'association à la console — doivent suivre
 * un renommage, et elles n'ont pas accès à l'objet onglet. Reconstruire la chaîne à la main chez
 * l'appelant ferait vivre le format à deux endroits.
 */
export function idDeConsolePersistee(key: DatabaseKey, nom: string): string {
  return idOnglet({ sorte: 'console', key, numero: 0, dialecte: 'sql', nom })
}

/**
 * Fait suivre un renommage de console aux onglets ouverts.
 *
 * **L'identité d'un onglet de console persistée dérive de son nom** (voir `idOnglet`) : renommer
 * change donc son `id`, et `actif` doit être réécrit dans le même mouvement, sans quoi la bande
 * désignerait un onglet qui n'existe plus et le centre reviendrait à `A4`.
 */
export function renommerLaConsole(
  etat: EtatOnglets,
  key: DatabaseKey,
  ancien: string,
  nouveau: string,
): EtatOnglets {
  const cible = etat.onglets.find(
    (onglet) => onglet.sorte === 'console' && onglet.nom === ancien && memeBase(onglet.key, key),
  )
  if (cible === undefined) return etat

  const ancienId = idOnglet(cible)
  const onglets = etat.onglets.map((onglet) =>
    onglet === cible ? { ...cible, nom: nouveau } : onglet,
  )
  const renomme = onglets.find((onglet) => onglet.sorte === 'console' && onglet.nom === nouveau)
  return {
    onglets,
    actif: etat.actif === ancienId && renomme ? idOnglet(renomme) : etat.actif,
  }
}

/**
 * Donne son nom à un brouillon : l'onglet volatile devient l'onglet d'une console persistée.
 *
 * **Son identité change en même temps** — elle dérive du numéro tant qu'il n'y a pas de nom, du nom
 * ensuite (voir `idOnglet`) — donc `actif` doit suivre, sans quoi la bande désignerait un onglet
 * disparu et le centre reviendrait à `A4` juste après un enregistrement réussi.
 */
export function baptiserLeBrouillon(etat: EtatOnglets, id: string, nom: string): EtatOnglets {
  const cible = etat.onglets.find((onglet) => idOnglet(onglet) === id)
  if (cible === undefined || cible.sorte !== 'console') return etat

  const baptise: OngletConsole = { ...cible, nom }
  return {
    onglets: etat.onglets.map((onglet) => (onglet === cible ? baptise : onglet)),
    actif: etat.actif === id ? idOnglet(baptise) : etat.actif,
  }
}

/**
 * Fait suivre un **renommage de connexion** aux onglets ouverts (`26`).
 *
 * # Pourquoi les onglets suivent au lieu de se fermer
 *
 * `08j` les ferme quand une connexion est *retirée* : leur déclaration a disparu. Ici elle existe
 * toujours, sous un autre nom — les fermer ferait perdre la place de l'utilisateur, et une
 * modification en attente non appliquée avec elle. Un renommage est une correction de libellé du
 * point de vue de celui qui le fait ; le lui faire payer d'une bande d'onglets vidée serait une
 * punition.
 *
 * # Ce que ça demande
 *
 * `idOnglet` compose `projet/base/env::…` : la `key` de chaque onglet concerné est réécrite, donc son
 * identité change, donc **`actif` aussi** — sans quoi la bande désignerait un onglet qui n'existe
 * plus et le centre reviendrait à `A4` juste après un renommage réussi. C'est la même mécanique que
 * `renommerLaConsole`, un cran au-dessus : là c'était le nom d'un onglet, ici les coordonnées de
 * tous ceux d'une connexion.
 */
export function renommerLaConnexion(
  etat: EtatOnglets,
  key: DatabaseKey,
  nouveau: string,
): EtatOnglets {
  if (nouveau === key.database) return etat

  const onglets = etat.onglets.map((onglet) =>
    memeBase(onglet.key, key) ? { ...onglet, key: { ...onglet.key, database: nouveau } } : onglet,
  )
  return {
    onglets,
    actif: etat.actif === null ? null : idApresRenommage(etat.actif, key, nouveau),
  }
}

/**
 * L'identifiant d'onglet tel qu'il devient après le renommage d'une connexion (`26`).
 *
 * **Sur les coordonnées décomposées, pas sur un remplacement de sous-chaîne.** `id.replace(ancien,
 * nouveau)` renommerait aussi une table homonyme de la base — `orders/orders::public.orders` en est
 * l'exemple minimal — et le bogue ne se verrait que sur ce cas précis. C'est la leçon du test de
 * préfixe de `viseeParLId`.
 *
 * Un identifiant qui ne vise pas cette connexion est rendu **tel quel** : la fonction est donc sûre
 * à appliquer à toutes les clés d'une table indexée par identifiant d'onglet.
 */
export function idApresRenommage(id: string, key: DatabaseKey, nouveau: string): string {
  const [coordonnees = '', reste] = id.split('::')
  const [projet, base, environnement] = coordonnees.split('/')
  if (projet !== key.project || base !== key.database || environnement !== key.environment) {
    return id
  }
  const suffixe = reste === undefined ? '' : `::${reste}`
  return `${key.project}/${nouveau}/${key.environment}${suffixe}`
}

/**
 * Réindexe une table dont les clés sont des identifiants d'onglets (`26`).
 *
 * Le texte d'une console, ses modifications en attente, l'association d'un onglet à sa console
 * persistée : trois tables indexées par un identifiant qui **contient le nom de la connexion**. Sans
 * cette réindexation, un renommage vide silencieusement l'éditeur et perd les modifications en
 * attente — l'onglet est là, sous son nouveau nom, et ne trouve plus rien à sa clé.
 *
 * Une fonction générique plutôt que trois boucles chez l'appelant : ce sont les mêmes clés, et la
 * troisième copie serait celle qu'on oublie de corriger.
 */
export function reindexerParConnexion<T>(
  table: Readonly<Record<string, T>>,
  key: DatabaseKey,
  nouveau: string,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(table).map(([id, valeur]) => [idApresRenommage(id, key, nouveau), valeur]),
  )
}
