import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  closeDatabase,
  connectionStates,
  databaseKey,
  etatDe,
  listObjects,
  listSchemas,
  openDatabase,
} from '../../data/commandes'
import type { EnvironmentId, Project } from '../../domain/config'
import type {
  ConnectionState,
  ConnectionStateEntry,
  DatabaseKey,
  SchemaInfo,
  TableSummary,
} from '../../domain/engine'
import { type Charge, idBase, type Noeud, schemasAffiches } from '../Explorer/arbre'

/**
 * Les commandes dont l'arbre a besoin, **injectables**.
 *
 * Même arbitrage qu'en `08d` et `09b` : le pont ne répond pas hors de la webview, donc ce qui
 * est testable est le câblage. Un test qui passerait par `invoke` ne testerait que son échec.
 */
export type PasserelleArbre = {
  openDatabase: typeof openDatabase
  closeDatabase: typeof closeDatabase
  connectionStates: typeof connectionStates
  listSchemas: typeof listSchemas
  listObjects: typeof listObjects
}

export const PASSERELLE_TAURI: PasserelleArbre = {
  openDatabase,
  closeDatabase,
  connectionStates,
  listSchemas,
  listObjects,
}

const CHARGE_VIDE: Charge = { schemas: {}, objets: {}, enCours: new Set(), echecs: {} }

/**
 * De quoi ouvrir une connexion : ses coordonnées, et l'identité sous laquelle l'arbre la cache.
 *
 * **`chargerBase` prenait un `Noeud`**, ce qui liait l'ouverture d'une connexion à la ligne d'arbre
 * qui la montre. Une console s'ouvre sans que cette ligne soit dépliée — le menu « … » d'une
 * connexion crée la sienne et l'ouvre —, et fabriquer un faux nœud pour l'occasion aurait inventé une
 * profondeur, un libellé et un chevron dont l'ouverture n'a que faire.
 *
 * **L'identité reste celle du nœud, et n'est jamais écrite à la main** : les deux appelants la
 * tiennent d'`idBase`, l'un par le nœud qu'`arbre.ts` a composé, l'autre en l'appelant. Le défaut
 * qu'elle a déjà coûté est là pour le rappeler : `chargerBase` composait un `idBase(project,
 * database)` sans environnement quand la clé de connexion, deux lignes plus bas, en portait un — les
 * deux identités divergeaient, et les schémas d'`analytics` en dev s'affichaient sous la ligne
 * d'`analytics` en prod.
 */
type BaseAOuvrir = {
  id: string
  project: string
  database: string
  environment: EnvironmentId
}

/**
 * L'état de l'arbre : ce qui est déplié, ce qui est chargé, l'état de chaque base.
 *
 * **Le dépliage est paresseux et le chargement suit le dépliage.** Un schéma replié ne produit
 * aucun nœud, donc rien n'est demandé — c'est la contrainte transverse de `06c` appliquée à
 * l'arbre, et c'est pour cela que la commande rend les objets d'**un** schéma.
 *
 * **L'arbre se lit sans réseau** (décision du 7 août) : ouvrir la connexion n'a lieu qu'au
 * dépliage d'une base, jamais au chargement de l'écran. Un hôte muet bloquerait sinon l'écran
 * jusqu'à trente secondes.
 */
export function useArbre(
  projects: readonly Project[],
  passerelle: PasserelleArbre = PASSERELLE_TAURI,
  /**
   * Appelé quand une connexion vient de s'ouvrir **et** que ses schémas sont connus.
   *
   * L'arbre ne préchauffe rien lui-même : il sait *quand*, pas *quoi en faire*. Le cache des
   * structures vit dans l'écran de travail, qui le partage avec le panneau de détail — le lui faire
   * porter ici mêlerait deux durées de vie sans rapport.
   */
  onOuverture?: (cle: DatabaseKey, schemas: readonly SchemaInfo[]) => void,
  /**
   * Appelé quand un schéma vient d'être déplié **et** que ses objets sont connus.
   *
   * Les objets sont passés parce que l'arbre vient de les lister pour les afficher : les faire
   * redemander par le préchauffage paierait deux fois la même requête.
   */
  onSchemaDeplie?: (cle: DatabaseKey, schema: string, objets: readonly TableSummary[]) => void,
) {
  const [deplies, setDeplies] = useState<ReadonlySet<string>>(new Set())
  const [charge, setCharge] = useState<Charge>(CHARGE_VIDE)
  const [etats, setEtats] = useState<readonly ConnectionStateEntry[]>([])

  const etatDeBase = useCallback(
    (project: string, database: string, environment: EnvironmentId): ConnectionState =>
      etatDe(etats, project, database, environment),
    [etats],
  )

  /**
   * Le tour de lecture des états, pour écarter une réponse dépassée.
   *
   * Deux appels concurrents existent — l'effet ci-dessous et le `finally` de `chargerBase` — et
   * `connectionStates` n'est pas instantané. Sans ce compteur, une lecture partie **avant** une
   * ouverture pourrait répondre **après** elle et remettre l'arbre à « jamais tentée » sur une base
   * qui vient de s'ouvrir. C'est le défaut n° 112 par un autre bout : une lecture asynchrone rend
   * l'état de son propre instant, pas de celui où elle atterrit.
   */
  const tourDesEtats = useRef(0)

  /**
   * Le compte des ouvertures **abouties**, témoin d'une purge partie trop tôt (1er septembre 2026).
   *
   * `tourDesEtats` empêche une lecture dépassée d'écraser une plus récente ; il ne dit rien du cas
   * inverse, où une lecture **à jour au départ** est appliquée à un cache qui a grandi entre-temps.
   * C'est ce qui arrive dès qu'une ouverture et un changement de configuration partent du même geste
   * — et « ouvrir une console » est exactement cela : la création réécrit `projects`, donc déclenche
   * la relecture du registre, pendant que la connexion s'ouvre. La lecture partait avant que le
   * registre ne tienne la connexion, revenait après que ses schémas étaient en cache, et **les
   * reprenait** : console sans catalogue, ligne d'arbre repliée, et rien pour le dire.
   *
   * Le témoin est incrémenté quand des schémas entrent en cache. Une purge qui le voit bouger pendant
   * sa lecture ne conclut rien : elle a mesuré un instant qui n'est plus. La lecture des **états**,
   * elle, reste appliquée — elle est vraie de son instant, et `tourDesEtats` en garde l'ordre.
   */
  const ouverturesAbouties = useRef(0)

  /**
   * Relit les états **au registre**, et fait suivre le cache.
   *
   * # Le défaut que cette fonction corrige (31 août 2026)
   *
   * `connection_states` lit le registre, qui est la seule vérité sur ce qui est ouvert. L'arbre ne
   * le relisait qu'à un seul endroit : le `finally` de `chargerBase`. Or **six commandes de
   * configuration ferment des connexions** — renommer un projet, renommer une connexion, retirer une
   * base, retirer un projet, `update_variant`, et la suppression de console —, et aucune ne le
   * disait à l'écran. Après une modification de connexion, l'arbre affichait donc « OK » sur une
   * base que le registre avait fermée, et toute requête répondait « aucune connexion ouverte ».
   *
   * **Et le cache aggravait le mensonge en le rendant irréparable.** `charger` n'appelle
   * `chargerBase` que si `charge.schemas[id]` est vide : les schémas de l'ancienne base restant en
   * cache, replier puis déplier **ne rouvrait rien**, et l'arbre continuait de montrer les schémas
   * de la base précédente. C'est mot pour mot ce que le commentaire d'`update_variant` disait
   * vouloir éviter en fermant la connexion — la moitié Rust était faite, la moitié écran jamais.
   *
   * **Le cache suit donc le registre, plutôt qu'un signal envoyé par chaque appelant.** Une purge
   * déclenchée par les commandes demanderait de la brancher aux six, et la septième l'oublierait.
   * Ici la règle est une : *ce que le registre ne tient plus ne peut plus être lu, donc ne doit plus
   * être caché*. Elle vaut pour les six sans les connaître.
   */
  const rafraichirEtats = useCallback(async (): Promise<readonly ConnectionStateEntry[] | null> => {
    const tour = tourDesEtats.current + 1
    tourDesEtats.current = tour
    const lus = await passerelle.connectionStates().catch(() => [])
    // Une réponse dépassée ne dit plus rien de l'instant : elle n'écrase pas, et elle ne purge pas.
    if (tour !== tourDesEtats.current) return null
    setEtats(lus)
    return lus
  }, [passerelle])

  /**
   * Relit les états **et fait suivre le cache** : ce que le registre ne tient plus est oublié.
   *
   * **Séparée de `rafraichirEtats`, et cette séparation est le fruit d'une erreur.** La purge avait
   * d'abord été mise dans la lecture elle-même — donc aussi dans le `finally` de `chargerBase`, qui
   * lit les états juste après avoir mis des schémas en cache. Elle les reprenait aussitôt : **61
   * tests sont tombés d'un coup**, et le défaut aurait valu en production au moindre écart entre
   * « l'ouverture a réussi » et « le registre l'annonce ».
   *
   * La leçon tient en une phrase : **une purge est une réaction à un changement de configuration,
   * pas à une lecture d'état.** Les deux gestes lisent la même chose ; ils n'en concluent pas la
   * même.
   */
  const synchroniserAvecLeRegistre = useCallback(async () => {
    const temoin = ouverturesAbouties.current
    const lus = await rafraichirEtats()
    if (!lus) return
    // **Une ouverture aboutie pendant la lecture périme la purge, pas la lecture.** Voir
    // `ouverturesAbouties` : sans ce contrôle, ouvrir une console reprenait aussitôt les schémas
    // qu'elle venait d'obtenir. Le prochain changement de configuration purgera ce qui doit l'être.
    if (ouverturesAbouties.current !== temoin) return
    const ouvertes = new Set(lus.map((entree) => identiteDeBase(entree.key)))
    setCharge((precedent) => oublierLesFermees(precedent, ouvertes))
    setDeplies((precedent) => replierLesFermees(precedent, ouvertes))
  }, [rafraichirEtats])

  /**
   * **Relu à chaque changement de projets**, et c'est ce qui couvre les six commandes d'un coup.
   *
   * Toutes rendent `Vec<Project>` et `App` les pose par `setProjects` : ce changement est donc le
   * signal commun, sans qu'aucune ait à se déclarer. Le coût est un appel IPC par écriture de
   * configuration — y compris pour celles qui ne ferment rien, comme l'enregistrement du SQL d'une
   * console —, ce qui est le prix d'une règle unique plutôt que de six branchements.
   *
   * **`projects` est le déclencheur, pas une donnée lue** — d'où l'exemption ci-dessous, qui suit la
   * forme des quatre autres du dépôt. Biome a raison sur la lettre : la fonction ne lit rien de
   * `projects`. Le retirer des dépendances rendrait pourtant l'effet inerte après le montage, donc
   * rendrait le défaut du 31 août 2026 exactement à son état d'avant.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: voir ci-dessus
  useEffect(() => {
    void synchroniserAvecLeRegistre()
  }, [projects, synchroniserAvecLeRegistre])

  const marquer = useCallback((id: string, enCours: boolean, echec?: string) => {
    setCharge((precedent) => {
      const suivant = new Set(precedent.enCours)
      if (enCours) suivant.add(id)
      else suivant.delete(id)
      const echecs = { ...precedent.echecs }
      if (echec) echecs[id] = echec
      else delete echecs[id]
      return { ...precedent, enCours: suivant, echecs }
    })
  }, [])

  const chargerBase = useCallback(
    async ({ id, project, database, environment }: BaseAOuvrir) => {
      const cle = databaseKey(project, database, environment)
      // **La connexion est identifiée par son nom *et* son environnement** (`23b`) : deux connexions
      // homonymes coexistent, et n'en chercher qu'une par le nom ouvrirait la première venue — celle
      // de dev alors qu'on a cliqué celle de prod.
      const declaration = baseDeclaree(projects, project, database, environment)
      const variante = declaration?.connection
      if (!declaration || !variante) return

      marquer(id, true)
      try {
        // **Le moteur déclaré décide de l'adaptateur** (`18a`) : la variante ne le porte pas, la
        // `Database` si. Le déduire côté Rust demanderait de relire la configuration à chaque
        // ouverture.
        await passerelle.openDatabase(cle, declaration.engine, variante)
        /* **Filtré avant d'être caché** (`API-33`). `list_schemas` rend tout, catalogue compris :
           ce que la connexion montre est décidé par sa préférence, et `schemasAffiches` est le seul
           endroit qui le décide. Cacher la liste complète pour la filtrer au rendu aurait laissé le
           préchauffage des structures décrire `pg_catalog` en entier — et le catalogue
           d'autocomplétion d'une console proposer des schémas que l'arbre ne montre pas. */
        const schemas = schemasAffiches(
          await passerelle.listSchemas(cle),
          declaration.visibleSchemas,
        )
        setCharge((precedent) => ({
          ...precedent,
          schemas: { ...precedent.schemas, [id]: schemas },
        }))
        // **Dans le même bloc synchrone que la mise en cache**, et avant tout ce qui suit : une purge
        // dont la lecture revient après cette ligne doit la voir bouger, sinon elle se croirait à jour
        // et reprendrait les schémas posés juste au-dessus.
        ouverturesAbouties.current += 1
        marquer(id, false)
        // **Après l'affichage, jamais avant** : la cascade de préchauffage est un service en fond, et
        // l'arbre doit avoir ses schémas à l'écran sans l'attendre.
        onOuverture?.(cle, schemas)
      } catch (cause) {
        // L'échec vit **sur la ligne du nœud** : une base injoignable ne doit pas vider l'arbre
        // ni bloquer les autres. C'est la décision « l'arbre se lit sans réseau », appliquée à
        // son chargement.
        marquer(id, false, message(cause))
      } finally {
        // **La lecture seule, jamais la synchronisation.** Ce `finally` suit une ouverture qui vient
        // de mettre des schémas en cache : y purger reprendrait ce qu'on vient d'obtenir.
        await rafraichirEtats()
      }
    },
    [projects, passerelle, marquer, onOuverture, rafraichirEtats],
  )

  const chargerSchema = useCallback(
    async (noeud: Noeud) => {
      const { project, database, environment, schema } = noeud
      if (!project || !database || !environment || !schema) return
      const id = noeud.id
      const cle = databaseKey(project, database, environment)

      marquer(id, true)
      try {
        const objets = await passerelle.listObjects(cle, schema)
        setCharge((precedent) => ({ ...precedent, objets: { ...precedent.objets, [id]: objets } }))
        marquer(id, false)
        // **Après l'affichage**, comme à l'ouverture d'une connexion : le dépliage ne doit pas
        // attendre le préchauffage, il le déclenche.
        onSchemaDeplie?.(cle, schema, objets)
      } catch (cause) {
        marquer(id, false, message(cause))
      }
    },
    [passerelle, marquer, onSchemaDeplie],
  )

  /**
   * Charge ce qu'un nœud rend lisible, **sans le déplier**.
   *
   * Extrait de `basculer`, et ce n'est pas un rangement : le clic sur une ligne ne déplie plus, il
   * sélectionne. Sélectionner un schéma affiche donc `A4` — sa liste d'objets — sans qu'aucun
   * dépliage l'ait chargée, et la liste serait restée vide. Le chargement suit désormais **ce qu'on
   * regarde**, non le geste qui l'a ouvert.
   *
   * Rien n'est rechargé au second appel : ce qui est déjà là est déjà à jour, et le bouton
   * « Rafraîchir » du pied existe pour le cas contraire.
   */
  const charger = useCallback(
    (noeud: Noeud) => {
      if (noeud.kind === 'database' && !charge.schemas[noeud.id]) {
        const { project, database, environment } = noeud
        // Les coordonnées d'un nœud sont optionnelles — un message n'en a pas —, et c'est ici
        // qu'elles se contrôlent : `chargerBase` les reçoit désormais complètes.
        if (project && database && environment) {
          void chargerBase({ id: noeud.id, project, database, environment })
        }
      }
      if (noeud.kind === 'schema' && !charge.objets[noeud.id]) void chargerSchema(noeud)
    },
    [charge, chargerBase, chargerSchema],
  )

  /**
   * Ouvre la connexion d'une base **sans passer par sa ligne d'arbre** (1er septembre 2026).
   *
   * # Le défaut
   *
   * L'ouverture n'avait qu'un déclencheur : regarder ou déplier la ligne de la connexion. Or une
   * console s'ouvre ailleurs — le menu « … » d'une connexion crée la sienne et l'ouvre du même geste,
   * sans que la ligne ait jamais été dépliée. L'onglet passait donc au premier plan et **rien
   * n'était joignable** : la première exécution répondait « aucune connexion ouverte pour … », et
   * l'autocomplétion ne proposait ni schéma, ni table, ni colonne — sans le dire, `charge.schemas`
   * étant simplement vide.
   *
   * # Ce qu'elle garantit, et ce qu'elle ne fait pas
   *
   * **Idempotente** : ce qui est en cache ou en vol n'est pas redemandé. Un **échec**, en revanche,
   * n'est pas mémorisé comme un refus — c'est ce qui laisse un second geste retenter, exactement
   * comme `charger` le fait sur une ligne d'arbre, et il le faut : les consoles d'une connexion
   * s'affichent malgré son échec, délibérément (voir `aplatir`).
   *
   * Et elle **ne déplie rien** : ouvrir une connexion n'est pas la montrer. Le cache qu'elle remplit
   * sert la console ; la ligne d'arbre, elle, ne bouge que si on la déplie — et `charger` n'y
   * rouvrira pas ce qui est déjà là.
   *
   * # Attendable, et pas seulement lancée (`API-33`)
   *
   * Elle rendait `void`, ce qui suffit à ses trois premiers appelants : ils ouvrent un onglet, et
   * l'onglet se remplira quand la connexion répondra. Le gestionnaire de schémas, lui, **lit** juste
   * après — et sa lecture serait partie sur une connexion pas encore ouverte, pour échouer sur
   * « aucune connexion ouverte » alors que rien n'allait mal. Le cas déjà couvert rend une promesse
   * déjà résolue : attendre ce qui est en cache ne coûte pas un tour de boucle d'événements de plus
   * que ce que `await` impose de toute façon.
   */
  const assurerLOuverture = useCallback(
    (cle: DatabaseKey): Promise<void> => {
      const id = idBase(cle.project, cle.environment, cle.database)
      // **`enCours` en plus des schémas**, là où `charger` ne regarde que les schémas : un clic sur
      // une console n'est pas une bascule, donc rien n'empêche un second d'arriver pendant que le
      // premier ouvre.
      if (charge.schemas[id] || charge.enCours.has(id)) return Promise.resolve()
      return chargerBase({
        id,
        project: cle.project,
        database: cle.database,
        environment: cle.environment,
      })
    },
    [charge, chargerBase],
  )

  /**
   * Relit les schémas d'**une** connexion, avec la liste des schémas à montrer (`API-33`).
   *
   * # Pourquoi le cache ne peut pas s'en passer
   *
   * `charge.schemas` retient la liste **déjà filtrée** — voir `chargerBase`. Les deux gestes du
   * gestionnaire de schémas la périment donc, chacun à sa façon : régler les schémas affichés
   * change le filtre, et `create schema` ajoute un schéma que la lecture précédente ne pouvait pas
   * connaître. Sans cette relecture, l'arbre garderait la liste d'avant et le seul recours serait
   * « Rafraîchir l'arborescence », qui replie tout.
   *
   * # La préférence est **passée**, non relue dans `projects`
   *
   * L'appelant vient de l'enregistrer, et les projets à jour remontent par `onProjets` : les lire
   * ici les prendrait dans la fermeture de ce rendu-ci, donc **avant** l'écriture — et le filtre
   * appliqué serait celui qu'on vient de remplacer. C'est le même piège que `tourDesEtats` par un
   * autre bout : ce qui est vrai à l'appel ne l'est pas au retour.
   *
   * # Ce qu'elle ne fait pas
   *
   * Elle n'ouvre rien et ne déplie rien : une connexion dont aucun schéma n'est en cache n'a rien à
   * relire — le prochain regard la chargera, avec la préférence à jour.
   */
  const rechargerLesSchemas = useCallback(
    async (cle: DatabaseKey, affiches: readonly string[] | null) => {
      const id = idBase(cle.project, cle.environment, cle.database)
      if (!charge.schemas[id]) return

      try {
        const schemas = schemasAffiches(await passerelle.listSchemas(cle), affiches)
        setCharge((precedent) => ({
          ...precedent,
          schemas: { ...precedent.schemas, [id]: schemas },
        }))
      } catch (cause) {
        // L'échec vit sur la ligne du nœud, comme celui d'un dépliage : une relecture qui échoue ne
        // doit pas laisser croire que l'enregistrement a échoué, lui qui a bien eu lieu.
        marquer(id, false, message(cause))
      }
    },
    [charge, passerelle, marquer],
  )

  /** Déplie ou replie un nœud, et charge ce que le dépliage rend visible. */
  const basculer = useCallback(
    (noeud: Noeud) => {
      const ouvrait = !deplies.has(noeud.id)
      setDeplies((precedent) => {
        const suivant = new Set(precedent)
        if (suivant.has(noeud.id)) suivant.delete(noeud.id)
        else suivant.add(noeud.id)
        return suivant
      })
      if (!ouvrait) return
      charger(noeud)
    },
    [deplies, charger],
  )

  /** Oublie tout ce qui est chargé, sans replier : le prochain regard rechargera. */
  const rafraichir = useCallback(() => {
    setCharge(CHARGE_VIDE)
    setDeplies(new Set())
  }, [])

  return useMemo(
    () => ({
      deplies,
      charge,
      etatDeBase,
      basculer,
      charger,
      assurerLOuverture,
      rechargerLesSchemas,
      rafraichir,
    }),
    [
      deplies,
      charge,
      etatDeBase,
      basculer,
      charger,
      assurerLOuverture,
      rechargerLesSchemas,
      rafraichir,
    ],
  )
}

/**
 * L'identité d'une base telle que les identifiants de l'arbre la portent.
 *
 * `idBase` compose `d:projet/environnement/base`, `idSchema` compose
 * `s:projet/environnement/base/schéma` : la part commune est ce que cette fonction rend, et c'est
 * elle qui permet d'apparier un nœud à une entrée du registre.
 *
 * **Réserve connue** : un nom de projet, d'environnement ou de base qui contiendrait une barre
 * oblique rendrait ces identifiants ambigus. Le défaut est antérieur et vaut pour tout l'arbre, pas
 * seulement ici.
 */
function identiteDeBase(key: DatabaseKey): string {
  return `${key.project}/${key.environment}/${key.database}`
}

/** L'identifiant de nœud, privé de son étiquette de sorte (`d:`, `s:`, `o:`). */
function identiteDuNoeud(id: string): string {
  return id.slice(id.indexOf(':') + 1)
}

/** Ce nœud décrit-il cette base, ou quelque chose dessous ? */
function sousLaBase(id: string, identite: string): boolean {
  const nu = identiteDuNoeud(id)
  return nu === identite || nu.startsWith(`${identite}/`)
}

/**
 * Les identités de base dont des schémas sont en cache alors que le registre ne les tient plus.
 *
 * Partir des schémas en cache, et non des entrées du registre, est ce qui rend la comparaison
 * possible : le registre ne dit que ce qui est **ouvert**, il ne peut pas énumérer ce qui a été
 * fermé.
 */
function basesFermees(charge: Charge, ouvertes: ReadonlySet<string>): readonly string[] {
  return Object.keys(charge.schemas)
    .map(identiteDuNoeud)
    .filter((identite) => !ouvertes.has(identite))
}

/**
 * Oublie ce qui est chargé pour les bases que le registre ne tient plus.
 *
 * **Rend `charge` inchangé quand il n'y a rien à oublier**, et ce n'est pas une micro-optimisation :
 * cette fonction est appelée à chaque changement de projets, y compris ceux qui ne ferment rien, et
 * un objet neuf à chaque fois ferait re-rendre l'arbre entier pour rien.
 */
function oublierLesFermees(charge: Charge, ouvertes: ReadonlySet<string>): Charge {
  const fermees = basesFermees(charge, ouvertes)
  if (fermees.length === 0) return charge

  const aOublier = (id: string) => fermees.some((identite) => sousLaBase(id, identite))
  const garder = <T>(table: Readonly<Record<string, T>>): Record<string, T> =>
    Object.fromEntries(Object.entries(table).filter(([id]) => !aOublier(id)))

  return {
    schemas: garder(charge.schemas),
    objets: garder(charge.objets),
    echecs: garder(charge.echecs),
    // **`enCours` n'est pas purgé** : un chargement en vol appartient à la requête qui l'a lancé, et
    // le lui retirer laisserait son `marquer(id, false)` final poser un état pour un nœud oublié.
    enCours: charge.enCours,
  }
}

/**
 * Replie les bases que le registre ne tient plus.
 *
 * **Nécessaire en plus de la purge du cache**, et pour une raison qui se voit à l'écran : `charger`
 * n'est appelé que par `basculer`, donc un nœud resté **déplié** avec des schémas oubliés
 * afficherait un vide que rien ne viendrait remplir. Replier rend le geste au prochain regard, ce
 * qui est exactement la règle de `rafraichir`.
 */
function replierLesFermees(
  deplies: ReadonlySet<string>,
  ouvertes: ReadonlySet<string>,
): ReadonlySet<string> {
  const concernes = [...deplies].filter(
    (id) => id.startsWith('d:') && !ouvertes.has(identiteDuNoeud(id)),
  )
  if (concernes.length === 0) return deplies

  const identites = concernes.map(identiteDuNoeud)
  const suivant = new Set(
    [...deplies].filter((id) => !identites.some((identite) => sousLaBase(id, identite))),
  )
  return suivant
}

/** La variante d'environnement d'une base, celle que `open_database` réclame. */
/**
 * La base **déclarée**, et non sa seule variante d'environnement.
 *
 * Depuis `18`, l'ouverture a besoin du moteur, qui vit au niveau de la `Database` : rendre la
 * variante seule obligeait à refaire la même recherche une seconde fois pour l'obtenir.
 */
/**
 * La connexion déclarée, par projet, nom **et** environnement (`23b`).
 *
 * Le dernier paramètre n'est pas une commodité : `analytics` peut exister en dev et en prod, et deux
 * connexions homonymes ont des hôtes différents. Chercher par le seul nom ouvrirait l'une pour
 * l'autre — sans erreur, sur le mauvais serveur.
 */
function baseDeclaree(
  projects: readonly Project[],
  project: string,
  database: string,
  environment: string,
) {
  return projects
    .find((p) => p.name === project)
    ?.databases.find((d) => d.name === database && d.environment === environment)
}

function message(cause: unknown): string {
  if (typeof cause === 'string') return cause
  if (cause && typeof cause === 'object' && 'message' in cause) {
    return String((cause as { message: unknown }).message)
  }
  return String(cause)
}
