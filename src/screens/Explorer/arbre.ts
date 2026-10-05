import { connexionsDescendantes, idDeConnexion } from '../../data/dossiers'
import { dessinDeConnexion, teinteDeConnexion } from '../../data/iconesDeConnexion'
import { dessinDeDossier } from '../../data/iconesDeDossier'
import type { IconName } from '../../design/icons/names'
import type {
  ConnectionId,
  Database,
  Engine,
  Folder,
  FolderId,
  FolderTree,
} from '../../domain/config'
import type { ConnectionState, SchemaInfo, TableSummary } from '../../domain/engine'
import type { useT } from '../../i18n/LanguageContext'
import { formatRowCount } from '../../ui/format'
import { indentation } from '../../ui/TreeRow/TreeRow'
import { COULEURS_DE_DOSSIER } from '../NewConnection/environments'

/**
 * `aplatir` est une fonction pure, pas un composant : elle ne peut pas appeler `useT()`
 * elle-même. L'appelant (`ExplorerSidebar`) le fait et passe la fonction de traduction en
 * paramètre — même pattern que `raisons(t)` dans ce même écran.
 */
type Traduire = ReturnType<typeof useT>

/**
 * Le repli par défaut de `t`, en français. **Optionnel plutôt qu'obligatoire** : `arbre.test.ts`
 * appelle `aplatir` partout sans se soucier de la langue, et seul `ExplorerSidebar` a besoin de la
 * vraie traduction, et c'est lui qui la passe.
 */
const traduireEnFrancais: Traduire = (cle, parametres = {}) => {
  switch (cle) {
    case 'explorer.arbre.loading':
      return 'Chargement…'
    case 'explorer.arbre.noObjects':
      return 'Aucun objet'
    case 'explorer.arbre.emptyFolder':
      return 'Dossier vide'
    case 'explorer.arbre.readOnly':
      return 'lecture seule'
    case 'explorer.arbre.connectionCount': {
      const compte = Number(parametres.count)
      return `${compte} connexion${compte > 1 ? 's' : ''}`
    }
    case 'explorer.arbre.connectingBadge':
      return '…'
    case 'explorer.arbre.connectedBadge':
      return 'OK'
    case 'explorer.arbre.offlineBadge':
      return 'HORS LIGNE'
    case 'explorer.arbre.statusNever':
      return 'non connectée'
    case 'explorer.arbre.statusConnecting':
      return 'connexion en cours'
    case 'explorer.arbre.statusConnected':
      return 'connectée'
    case 'explorer.arbre.statusOffline':
      return `hors ligne : ${parametres.reason}`
    default:
      return cle
  }
}

/**
 * L'aplatissement de l'arbre de `A4`, en fonction **pure**.
 *
 * `TreeRow` est purement présentationnelle : « elle ne connaît ni ses enfants, ni son état
 * d'ouverture, ni le modèle de données ». Voici la forme de l'arbre, isolée du rendu pour être
 * testable sans DOM.
 */

/** Ce qui est déplié, par identité de nœud. */
export type Deplies = ReadonlySet<string>

/** Les objets déjà chargés, par identité de nœud parent. */
export type Charge = {
  /** Les schémas d'une connexion, par identité de nœud de connexion. */
  schemas: Readonly<Record<string, SchemaInfo[]>>
  /** Les objets d'un schéma, par identité de nœud de schéma. */
  objets: Readonly<Record<string, TableSummary[]>>
  /** Les dépliages en cours, par identité de nœud. */
  enCours: ReadonlySet<string>
  /** Les dépliages qui ont échoué, par identité de nœud. */
  echecs: Readonly<Record<string, string>>
}

export type NoeudKind = 'folder' | 'database' | 'console' | 'schema' | 'object' | 'message'

export type Noeud = {
  /** Identité stable, employée pour le dépliage, la sélection et la clé de rendu. */
  id: string
  kind: NoeudKind
  /**
   * Le **niveau logique**, sans limite (#166) : `aria-level = depth + 1`, et la pile du filtre s'en
   * sert pour retrouver les ancêtres. **Ce n'est pas l'indentation** — voir `indent`.
   */
  depth: number
  /**
   * L'indentation visuelle, calculée par `indentation()` de `TreeRow`. Séparée de `depth` parce que
   * ce qui est sous une connexion avance de +16 et non de +14 : faire porter les deux par un seul
   * nombre obligeait le filtre à connaître la règle de dessin.
   */
  indent: string
  label: string
  /** Chevron : absent pour une feuille, `closed` ou `open` pour un nœud dépliable. */
  chevron?: 'open' | 'closed'
  /** Le glyphe de la ligne, **typé sur le sprite** et non sur `string`. */
  icon?: IconName
  iconColor?: string
  /** Vrai quand `iconColor` doit s'imposer au logo du moteur — une connexion colorée (#179). */
  tintLogo?: boolean
  meta?: string
  metaVariant?: 'mono' | 'caps'
  /** L'état d'une connexion. */
  badge?: { text: string; tone: 'danger' | 'warn' | 'success' | 'muted' }
  /** Nom accessible complet, quand le libellé seul ne suffit pas. */
  announce?: string
  /** Une ligne de message — chargement, échec, vide — non sélectionnable. */
  message?: boolean
  /**
   * Le nombre de connexions que ce nœud représente — celles d'un dossier, **à toute profondeur**.
   * Sert à la confirmation de retrait, qui compte ce qui part.
   */
  connexions?: number
  /** Le dossier, pour un nœud `folder`. */
  folder?: FolderId
  /** La connexion, pour tout nœud qui en dépend : `database`, `console`, `schema`, `object`. */
  connection?: ConnectionId
  /**
   * Vrai quand **ce dossier-ci** déclare la lecture seule — le verrou de fin de ligne. Un dossier
   * qui ne fait que l'hériter ne porte pas le verrou : c'est l'ancêtre qui la déclare qui le porte,
   * pour qu'on sache où aller la lever.
   */
  readOnly?: boolean
  /**
   * Le nom du dossier ancêtre qui impose la lecture seule à celui-ci, s'il y en a un. C'est la raison
   * que donne l'entrée « Passer en lecture seule » quand elle est désactivée.
   */
  imposeePar?: string
  schema?: string
  /** Le nom de la console, pour un nœud `console` — distinct de `label`, qui peut être décoré. */
  console?: string
  /**
   * Le nom de l'objet, pour un nœud `object` (#162) — le nom que le serveur connaît, que « Copier le
   * nom » rend. Il vaut `label` aujourd'hui, et c'est précisément pourquoi il existe : le jour où un
   * libellé d'objet se décore, c'est ce champ qu'il faut vérifier.
   */
  object?: string
  /**
   * Le nom technique de la connexion (`Database.name`), sur un nœud `database` — ce que
   * « Renommer… » édite, jamais le libellé d'affichage (`27a`).
   */
  database?: string
  /**
   * Le moteur, sur un nœud `database` (`API-33`) : le menu dit « Gérer les schémas… » cliquable
   * sous PostgreSQL et désactivé avec sa raison ailleurs, et une icône ne se relit pas.
   */
  engine?: Engine
}

/*
 * **Les identités de nœud, et aucune n'est composée de noms** (#166).
 *
 * Elles l'étaient — `d:projet/environnement/base` —, et un renommage changeait donc l'identité de
 * tout ce qui était dessous : il fallait réindexer le dépliage, la sélection, les onglets et les
 * consoles ouvertes (`idApresRenommage`), et un nom de projet préfixe d'un autre (« Halle » et
 * « Halles ») rendait la purge ambiguë. Les identifiants de dossier et de connexion sont figés à la
 * création et ne contiennent jamais de `/` : un renommage ne touche plus à aucune identité.
 *
 * Les lettres `f`, `d`, `c`, `s`, `o` sont réservées.
 */
export function idDossier(folder: FolderId): string {
  return `f:${folder}`
}
export function idBase(connection: ConnectionId): string {
  return `d:${connection}`
}
export function idConsole(connection: ConnectionId, console: string): string {
  return `c:${connection}/${console}`
}
export function idSchema(connection: ConnectionId, schema: string): string {
  return `s:${connection}/${schema}`
}
export function idObjet(connection: ConnectionId, schema: string, objet: string): string {
  return `o:${connection}/${schema}/${objet}`
}

/**
 * Aplatit l'arbre de dossiers en une liste de nœuds, selon ce qui est déplié et chargé.
 *
 * **Récursif, et sans profondeur maximale** (#166). Un dossier contient des sous-dossiers puis des
 * connexions, dans l'ordre déclaré ; la racine aussi. Le dépliage reste paresseux : un nœud replié
 * ne produit aucun enfant, donc l'écran n'a rien à demander.
 */
export function aplatir(
  arbre: FolderTree,
  deplies: Deplies,
  charge: Charge,
  etats: (connection: ConnectionId) => ConnectionState,
  t: Traduire = traduireEnFrancais,
): Noeud[] {
  const noeuds: Noeud[] = []
  const contexte: Contexte = { deplies, charge, etats, t, noeuds }
  for (const dossier of arbre.folders) noeudsDeDossier(dossier, 0, null, contexte)
  for (const base of arbre.connections) noeudsDeConnexion(base, 0, contexte)
  return noeuds
}

type Contexte = {
  deplies: Deplies
  charge: Charge
  etats: (connection: ConnectionId) => ConnectionState
  t: Traduire
  noeuds: Noeud[]
}

function noeudsDeDossier(
  dossier: Folder,
  niveau: number,
  imposeePar: string | null,
  contexte: Contexte,
): void {
  const { deplies, t, noeuds } = contexte
  const id = idDossier(dossier.id)
  const deplie = deplies.has(id)
  const compte = connexionsDescendantes(dossier).length
  const sous = dossier.folders ?? []
  const bases = dossier.connections ?? []

  noeuds.push({
    id,
    kind: 'folder',
    depth: niveau,
    indent: indentation(niveau),
    label: dossier.name,
    chevron: deplie ? 'open' : 'closed',
    /*
     * **L'icône du dossier, `pin` à défaut** (#171) : un nom inconnu du fichier retombe sur `pin`
     * dans `iconeDeDossier`, jamais sur une case vide. Ce qui suit reste la raison du défaut.
     *
     * **`pin` pour tous les dossiers**, racine comprise. Le `bag` des projets et la goutte des
     * environnements disaient deux paliers d'un modèle qui n'en a plus qu'un : deux glyphes pour un
     * seul concept ne diraient rien de plus. `pin` a été choisi pour l'environnement parce qu'« un
     * lieu où vivent des connexions » se lit sans légende, et c'est exactement ce qu'est un dossier —
     * sa goutte n'a de voisin nulle part dans l'arbre, là où `srv` se confondait avec le `db` de la
     * connexion à 13 px.
     */
    icon: dessinDeDossier(dossier),
    // Sans couleur, la teinte des projets d'avant : un dossier racine migré ne change pas d'aspect.
    iconColor: dossier.color ? COULEURS_DE_DOSSIER[dossier.color] : 'var(--accent-deep)',
    // Un dossier replié annonce combien de connexions il porte, **à toute profondeur** : « n
    // sous-dossiers » ne dirait pas s'il y a quoi que ce soit dedans.
    meta: deplie ? undefined : t('explorer.arbre.connectionCount', { count: compte }),
    metaVariant: 'caps',
    // **La lecture seule s'entend, pas seulement se voit** : le verrou est un glyphe, et un glyphe
    // n'a pas de nom accessible — l'état entre donc dans l'annonce de la ligne.
    ...(dossier.readOnly
      ? { readOnly: true, announce: `${dossier.name} · ${t('explorer.arbre.readOnly')}` }
      : {}),
    ...(imposeePar === null ? {} : { imposeePar }),
    folder: dossier.id,
    connexions: compte,
  })

  if (!deplie) return

  // **Un dossier vide le dit** : un nœud déplié sans enfant se lit comme un chargement en cours. Ici
  // rien ne charge — la liste vient de la configuration —, donc le vide est un fait.
  if (sous.length === 0 && bases.length === 0) {
    noeuds.push(
      message(`${id}:vide`, niveau + 1, indentation(niveau + 1), t('explorer.arbre.emptyFolder')),
    )
    return
  }

  // Ce qui est imposé à ce dossier l'est à ses enfants ; ce qu'il déclare aussi. Le plus extérieur
  // gagne, comme `ancetreEnLectureSeule` : c'est celui qu'il faut aller lever.
  const imposeAuxEnfants = imposeePar ?? (dossier.readOnly ? dossier.name : null)
  for (const enfant of sous) noeudsDeDossier(enfant, niveau + 1, imposeAuxEnfants, contexte)
  for (const base of bases) noeudsDeConnexion(base, niveau + 1, contexte)
}

function noeudsDeConnexion(base: Database, niveau: number, contexte: Contexte): void {
  const { deplies, charge, etats, t, noeuds } = contexte
  const connection = idDeConnexion(base)
  const id = idBase(connection)
  const deplie = deplies.has(id)
  const etat = etats(connection)
  // **Affichage seulement** : `label`, s'il est renseigné, remplace `name` partout où l'arbre le
  // montre. `database` reste `base.name` — c'est ce que « Renommer… » édite.
  const libelle = base.label?.trim() || base.name
  const teinte = teinteDeConnexion(base)

  noeuds.push({
    id,
    kind: 'database',
    depth: niveau,
    indent: indentation(niveau),
    label: libelle,
    chevron: deplie ? 'open' : 'closed',
    /*
     * **L'icône et la couleur de la connexion, le logo du moteur à défaut** (#179) : un nom inconnu
     * retombe sur le logo dans `iconeDeConnexion`, jamais sur une case vide. Une couleur choisie
     * s'impose au logo lui-même — c'est ce qui distingue deux connexions PostgreSQL sans changer leur
     * icône —, et sans couleur le logo garde sa teinte de marque.
     */
    icon: dessinDeConnexion(base),
    iconColor: teinte.couleur,
    ...(teinte.teinterLeLogo ? { tintLogo: true } : {}),
    badge: badgeEtat(t, etat),
    // L'état est **dans le nom accessible**, pas seulement dans une couleur : un point vert et un
    // point rouge sont indiscernables pour une part des utilisateurs.
    announce: `${libelle} · ${resumeEtat(t, etat)}`,
    connection,
    database: base.name,
    engine: base.engine,
    connexions: 1,
  })

  if (!deplie) return

  /*
   * **Les consoles viennent avant les schémas, et sans chargement.** Elles sont déjà dans la
   * configuration, donc elles s'affichent dès le dépliage, y compris pendant que l'introspection
   * travaille ou après son échec : une console est un texte qu'on a écrit, et le rendre dépendant
   * d'une connexion qui répond en ferait perdre l'accès au pire moment.
   */
  for (const console of base.consoles) {
    noeuds.push({
      id: idConsole(connection, console.name),
      kind: 'console',
      depth: niveau + 1,
      indent: indentation(niveau, 1),
      label: console.name,
      icon: 'term',
      iconColor: 'var(--ink-3)',
      connection,
      console: console.name,
    })
  }

  noeuds.push(
    ...enfantsDe(id, niveau + 1, indentation(niveau, 1), charge, t, () =>
      (charge.schemas[id] ?? []).flatMap((schema) =>
        noeudsDeSchema(connection, niveau, schema, deplies, charge, t),
      ),
    ),
  )
}

/**
 * Les schémas que l'arbre montre sous une connexion (`API-33`).
 *
 * # Le seul endroit où ce choix se prend
 *
 * `list_schemas` rend **tous** les schémas, ceux du catalogue compris et marqués : elle ne pouvait
 * pas les taire sans rendre impossible d'en afficher un, et une seconde commande « avec le
 * catalogue » aurait fait vivre deux listes que rien n'aurait tenues en phase (règle n° 17). Le
 * tri se fait donc ici, et `useArbre` l'applique **avant de mettre en cache** — de sorte que ce
 * qui est caché est ce qui est montré : l'arbre, le catalogue d'autocomplétion d'une console et le
 * préchauffage des structures voient la même liste. Le dernier point n'est pas cosmétique : sans
 * lui, le préchauffage décrirait les quatre cents relations de `pg_catalog` à chaque ouverture.
 *
 * # `undefined` n'est pas la liste vide
 *
 * Rien de réglé — le cas de toute connexion existante — montre les schémas **non-système**, donc
 * exactement ce que l'arbre a toujours montré. La liste vide, elle, est un réglage : quelqu'un a
 * tout décoché, et l'arbre ne montre alors aucun schéma. C'est la distinction que
 * `Database.visible_schemas` porte, et celle que « jamais tentée » n'est pas « hors ligne ».
 *
 * # Une intersection, jamais une promesse
 *
 * Un nom réglé qui ne correspond à aucun schéma est simplement absent du résultat : le
 * gestionnaire n'exige pas que la connexion soit ouverte pour enregistrer, et un schéma peut avoir
 * été retiré côté serveur depuis. L'ordre rendu est celui du catalogue, non celui de la
 * préférence — l'arbre trie par nom, et faire dépendre l'ordre des lignes de l'ordre des cases
 * cochées serait un ordre que personne n'a choisi.
 */
export function schemasAffiches(
  schemas: readonly SchemaInfo[],
  affiches: readonly string[] | null | undefined,
): SchemaInfo[] {
  if (affiches === null || affiches === undefined) {
    return schemas.filter((schema) => !schema.system)
  }
  const retenus = new Set(affiches)
  return schemas.filter((schema) => retenus.has(schema.name))
}

function noeudsDeSchema(
  connection: ConnectionId,
  niveauDeLaConnexion: number,
  schema: SchemaInfo,
  deplies: Deplies,
  charge: Charge,
  t: Traduire,
): Noeud[] {
  const id = idSchema(connection, schema.name)
  const deplie = deplies.has(id)

  const tete: Noeud = {
    id,
    kind: 'schema',
    depth: niveauDeLaConnexion + 1,
    indent: indentation(niveauDeLaConnexion, 1),
    label: schema.name,
    chevron: deplie ? 'open' : 'closed',
    icon: 'schema',
    connection,
    schema: schema.name,
  }

  if (!deplie) return [tete]

  return [
    tete,
    ...enfantsDe(id, niveauDeLaConnexion + 2, indentation(niveauDeLaConnexion, 2), charge, t, () =>
      (charge.objets[id] ?? []).map((objet) => ({
        id: idObjet(connection, schema.name, objet.name),
        kind: 'object' as const,
        depth: niveauDeLaConnexion + 2,
        indent: indentation(niveauDeLaConnexion, 2),
        label: objet.name,
        object: objet.name,
        icon: objet.kind === 'view' ? 'view' : 'table',
        iconColor: objet.kind === 'view' ? 'var(--violet)' : 'var(--success)',
        // `RowCount` distingue `estimated` de `exact` **au niveau du type** (`06c`).
        meta: formatRowCount(objet.rows),
        metaVariant: 'mono' as const,
        connection,
        schema: schema.name,
      })),
    ),
  ]
}

/**
 * Les enfants d'un nœud déplié, ou la ligne de message qui en tient lieu.
 *
 * **Un dépliage qui échoue le dit sur sa ligne et ne vide pas l'arbre** : une erreur de réseau sur
 * un schéma ne doit pas faire disparaître les autres.
 *
 * **La profondeur du message est reçue, non déduite** (#166) : elle se lisait dans le préfixe de
 * l'identité du parent (`d:` au palier 2, `s:` au palier 3), ce qu'un arbre sans profondeur fixe ne
 * permet plus. Le message prend le niveau et l'indentation de ses frères.
 */
function enfantsDe(
  id: string,
  profondeur: number,
  indent: string,
  charge: Charge,
  t: Traduire,
  contenu: () => Noeud[],
): Noeud[] {
  if (charge.echecs[id]) {
    return [message(`${id}:echec`, profondeur, indent, charge.echecs[id] as string)]
  }
  if (charge.enCours.has(id)) {
    return [message(`${id}:chargement`, profondeur, indent, t('explorer.arbre.loading'))]
  }

  const enfants = contenu()
  // Vide **chargé** n'est pas vide **non chargé** : un schéma sans table est un état normal.
  return enfants.length > 0
    ? enfants
    : [message(`${id}:vide`, profondeur, indent, t('explorer.arbre.noObjects'))]
}

function message(id: string, depth: number, indent: string, label: string): Noeud {
  return { id, kind: 'message', depth, indent, label, message: true }
}

/**
 * Le badge d'état d'une connexion.
 *
 * `never` n'a **aucun badge** : une base qu'on n'a pas ouverte n'est pas dans un état
 * remarquable, et lui coller une marque la ferait paraître en défaut.
 */
function badgeEtat(t: Traduire, etat: ConnectionState): Noeud['badge'] {
  switch (etat.kind) {
    case 'never':
      return undefined
    case 'connecting':
      return { text: t('explorer.arbre.connectingBadge'), tone: 'warn' }
    case 'connected':
      return { text: t('explorer.arbre.connectedBadge'), tone: 'success' }
    case 'offline':
      return { text: t('explorer.arbre.offlineBadge'), tone: 'danger' }
  }
}

function resumeEtat(t: Traduire, etat: ConnectionState): string {
  switch (etat.kind) {
    case 'never':
      return t('explorer.arbre.statusNever')
    case 'connecting':
      return t('explorer.arbre.statusConnecting')
    case 'connected':
      return t('explorer.arbre.statusConnected')
    case 'offline':
      return t('explorer.arbre.statusOffline', { reason: etat.reason })
  }
}
