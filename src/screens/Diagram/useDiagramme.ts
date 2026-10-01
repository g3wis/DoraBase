import { useEffect, useMemo, useRef, useState } from 'react'
import type { DatabaseKey } from '../../domain/arbre'
import type { TableSummary } from '../../domain/engine'
import type { PasserelleStructures, Structures } from '../../screens/Workbench/useStructures'
import type { EntreeDeTable } from './disposition'

/**
 * Le plafond de tables d'un diagramme.
 *
 * # Il valait soixante, et c'était une décision prise pour l'utilisateur (3 septembre 2026)
 *
 * Les deux raisons qui le justifiaient ont disparu, l'une après l'autre :
 *
 * - **le coût.** Lire soixante tables prenait quelques minutes à travers un tunnel ; la lecture
 *   ensembliste et les lots l'ont divisé par douze. Cent vingt-quatre tables se lisent aujourd'hui
 *   en une dizaine de lots ;
 * - **la lisibilité.** Elle supposait le dessin d'alors, qui avait trois défauts de disposition —
 *   colonnes centrées sur la plus haute, tables isolées empilées, cycles explosant le nombre de
 *   colonnes. Un dessin de cent tables était effectivement illisible ; il ne l'est plus de la même
 *   façon, et la recherche donne maintenant le moyen d'y retrouver une table.
 *
 * Restait donc un jugement — « au-delà, ça ne se lit plus » — que **le plafond imposait à la place
 * de l'utilisateur**, en retirant du dessin soixante-quatre tables sur cent vingt-quatre. Trois
 * cents est le nombre que le préchauffage emploie déjà, avec la justification que ce fichier avait
 * reprise : il couvre les bases réelles de ce produit avec une marge large et borne le pire cas —
 * un entrepôt à dix mille tables.
 *
 * # Ce qui reste vrai
 *
 * **Ce qui dépasse est dit**, et depuis aujourd'hui **nommé** : un diagramme amputé en silence se
 * lirait comme un schéma complet, et « soixante des cent vingt-quatre » sans dire *lesquelles* ne
 * valait guère mieux. Voir `omises`.
 */
export const PLAFOND_DE_TABLES = 300

/**
 * Combien de tables une même demande groupée décrit.
 *
 * # Pourquoi par lots, et non tout d'un coup
 *
 * `describe_tables` sait décrire soixante tables en six allers-retours SQL ; le faire d'une seule
 * prise serait le plus rapide en pur chronomètre, et le mauvais choix pour deux raisons :
 *
 * - **le verrou du registre est tenu pendant toute l'opération** (voir `ConnectionRegistry::avec`),
 *   délibérément. Une demande de soixante tables bloquerait donc *toute* autre requête sur cette
 *   connexion jusqu'au bout — y compris la table que l'utilisateur vient de cliquer pendant que le
 *   dessin se remplit. Par lots, le verrou se relâche entre chaque ;
 * - **le dessin se remplirait d'un coup, après une attente muette.** Par lots, les boîtes arrivent
 *   par paquets et la barre d'état avance — c'est ce que « montrer ce qu'on sait » veut dire.
 *
 * Douze : soixante tables tiennent en cinq lots, donc trente allers-retours au lieu de trois cent
 * soixante, cinq relâchements du verrou et cinq paliers visibles à l'écran. Le gain suivant serait
 * marginal, la latence n'étant plus le terme dominant.
 */
const TABLES_PAR_LOT = 12

export type Diagramme = {
  /** Les structures déjà lues, dans l'ordre où le diagramme les montrera. */
  tables: readonly EntreeDeTable[]
  /** Les tables que ce schéma compte. */
  total: number
  /** Celles que le diagramme demande — `total` borné par `PLAFOND_DE_TABLES`. */
  demandees: number
  /**
   * Les tables que le plafond a écartées, **nommées**.
   *
   * Vide dans la quasi-totalité des cas. Elle existe parce que « soixante des cent vingt-quatre
   * tables » a suscité exactement la bonne question — « lesquelles ne sont pas affichées ? » — à
   * laquelle l'écran ne savait pas répondre. Un compte dit qu'il manque quelque chose ; une liste
   * dit quoi.
   */
  omises: readonly string[]
  loading: boolean
  error: string | null
}

/**
 * La lecture des structures d'un schéma entier, pour son diagramme.
 *
 * # Pourquoi une file à part, et non celle du préchauffage
 *
 * `useStructures` tient une file **de fond** : une requête à la fois, non prioritaire, plafonnée à
 * trois cents tables par connexion. Sa propre documentation dit la règle qui décide ici — « un
 * `describe_table` demandé par un écran ne passe pas par cette file, il part tout de suite ». Ouvrir
 * un diagramme *est* une demande : ce qu'il montre est exactement ce qu'on est venu voir, et le
 * faire attendre derrière les schémas que personne ne regarde aurait laissé l'écran vide pendant que
 * la donnée arrivait pour d'autres.
 *
 * Ce qui est **partagé**, c'est le cache : une table que le préchauffage a déjà lue ne se redemande
 * pas, et chaque table lue ici est posée dans le même cache — donc servie ensuite au panneau de
 * détail, à la vue Structure et à l'autocomplétion, sans un aller-retour de plus.
 *
 * # Par lots, et non une par une ni toutes d'un coup
 *
 * La première version lisait table par table : sur une base joignable par un tunnel, soixante
 * tables faisaient trois cent soixante allers-retours SQL sérialisés — quelques minutes, rapporté à
 * l'usage. Les lots ramènent cela à trente, sans prendre le verrou du registre pour toute la durée
 * de la lecture et sans faire attendre le dessin jusqu'au bout. Voir `TABLES_PAR_LOT`.
 *
 * # L'état *et* la ref
 *
 * Le cache des structures vit dans un état, donc son objet change à chaque table qui arrive. En
 * dépendre ferait relancer cette lecture à chaque réponse — une boucle qui ne s'arrête pas. La ref
 * porte le même cache, lu au moment où on l'interroge : le motif est celui que `useStructures`
 * documente pour son propre worker, et pour la même raison.
 */
export function useDiagramme(
  cle: DatabaseKey | null,
  schema: string | null,
  structures: Structures,
  passerelle: PasserelleStructures,
  /**
   * Les objets que l'arbre a déjà listés, quand il les a listés.
   *
   * L'arbre garde les siens dans son propre cache (`charge.objets`), que `useStructures` ne voit
   * pas : sans ce passage de main, ouvrir le diagramme d'un schéma qu'on vient de déplier
   * redemanderait la liste que le dépliage a déjà payée.
   */
  objetsConnus?: readonly TableSummary[],
): Diagramme {
  const [noms, setNoms] = useState<readonly string[]>([])
  const [omises, setOmises] = useState<readonly string[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Voir la note du composant : lues au moment de l'appel, jamais en dépendance de l'effet.
  const cache = useRef(structures)
  cache.current = structures
  const listeConnue = useRef(objetsConnus)
  listeConnue.current = objetsConnus

  /**
   * Les coordonnées **décomposées en valeurs primitives**, et la clé rebâtie dans l'effet.
   *
   * `cle` est un objet que l'écran de travail reconstruit à chaque rendu : en dépendre relancerait
   * la lecture sans fin. Le premier remède avait été d'en dériver une chaîne et de taire la règle
   * des dépendances par une suppression — deux choses de trop, une valeur artificielle et un
   * garde-fou éteint. Deux chaînes de caractères disent la même identité, et le compilateur comme
   * Biome n'ont plus rien à croire sur parole.
   */
  const connection = cle?.connection ?? null

  useEffect(() => {
    if (connection === null || schema === null) {
      setNoms([])
      setOmises([])
      setTotal(0)
      return
    }
    const cle: DatabaseKey = { connection }

    /**
     * **Un témoin plutôt qu'un `AbortController`** : rien n'est annulable côté IPC, et ce qu'il faut
     * empêcher n'est pas la requête mais l'écriture de sa réponse. Fermer l'onglet du diagramme
     * pendant sa lecture ne doit pas continuer d'interroger le serveur ni de poser des états sur un
     * composant démonté.
     */
    let vivant = true

    void (async () => {
      setError(null)
      setLoading(true)
      try {
        const objets =
          listeConnue.current ??
          cache.current.objetsDuSchema(cle, schema) ??
          (await passerelle.listObjects(cle, schema))
        if (!vivant) return

        /*
         * **Les tables seulement, et triées par nom.**
         *
         * Une vue n'a pas de clé étrangère à montrer et son contenu est une requête : la dessiner
         * comme une table dirait d'elle quelque chose de faux. Le tri, lui, est ce qui rend le
         * plafond reproductible — « les soixante premières » n'a de sens que dans un ordre, et
         * l'ordre du serveur n'en est pas un.
         */
        const tables = objets
          .filter((objet) => objet.kind === 'table')
          .map((objet) => objet.name)
          .sort((a, b) => a.localeCompare(b))
        setTotal(tables.length)
        const retenues = tables.slice(0, PLAFOND_DE_TABLES)
        setNoms(retenues)
        // **Le tri par nom n'est pas un choix de pertinence, et c'est pourquoi il faut le dire.**
        // Rien de ce qu'on sait avant d'avoir lu les structures — un `TableSummary` ne porte ni clé
        // étrangère ni degré — ne permettrait de garder « les plus reliées » plutôt que « les
        // premières de l'alphabet ». Le tri rend au moins la coupe **reproductible**, et la barre
        // d'état nomme ce qu'elle emporte.
        setOmises(tables.slice(PLAFOND_DE_TABLES))

        /*
         * **Ce que le cache tient déjà n'est pas redemandé**, et le tri se fait avant de découper
         * les lots : sans cela, un lot pourrait n'être fait que de tables déjà connues et coûter un
         * aller-retour pour rien.
         */
        const manquantes = retenues.filter((nom) => !cache.current.detail(cle, schema, nom))

        for (let debut = 0; debut < manquantes.length; debut += TABLES_PAR_LOT) {
          // **Le témoin se lit avant chaque demande**, parce que ce qui doit cesser au démontage
          // est d'interroger le serveur pour un onglet que personne ne regarde plus.
          if (!vivant) return
          const lot = manquantes.slice(debut, debut + TABLES_PAR_LOT)
          const lues = await passerelle.describeTables(cle, schema, lot)
          /*
           * **Et ce qu'on a déjà payé est posé, même si l'onglet s'est fermé entre-temps.**
           *
           * Un second `if (!vivant)` a existé ici, et le sabotage l'a dénoncé : le retirer ne
           * changeait rien d'observable, les deux témoins se couvrant l'un l'autre (règle n° 1).
           * En le retirant, on gagne le bon comportement plutôt que d'en perdre un — le cache
           * appartient à l'**écran de travail**, pas à cet onglet, donc les tables lues serviront
           * encore au panneau de détail, à la vue Structure et à l'autocomplétion. Les jeter aurait
           * été perdre un aller-retour déjà consenti.
           */
          for (const detail of lues) {
            // **`detail.name`, jamais le nom demandé** : c'est celui que le moteur a rendu, et donc
            // celui sous lequel les autres lecteurs du cache le chercheront. Et le résultat peut
            // être plus court que le lot — une table retirée entre le listage et la lecture est
            // omise, pas refusée (voir `describeTables`).
            cache.current.poser(cle, schema, detail.name, detail)
          }
        }
      } catch (erreur) {
        /*
         * **Un échec se dit ici, contrairement au préchauffage qui l'avale.** La règle n'a pas
         * changé : on ne dérange personne pour une requête qu'il n'a pas demandée. Celle-ci, il l'a
         * demandée en ouvrant l'onglet, et une toile qui resterait vide en silence se lirait comme
         * une panne (défaut n° 36).
         */
        if (vivant) setError(String(erreur))
      } finally {
        if (vivant) setLoading(false)
      }
    })()

    return () => {
      vivant = false
    }
  }, [connection, schema, passerelle])

  /**
   * Ce que le dessin a sous la main, **relu à chaque rendu** depuis le cache.
   *
   * Un second état qui recopierait les structures aurait divergé du cache au premier
   * « Rafraîchir » — et c'est bien le cache qui est la seule vérité sur ce qui est lu.
   */
  const tables = useMemo(() => {
    if (connection === null || schema === null) return []
    const cible: DatabaseKey = { connection }
    return noms.flatMap((nom) => {
      const detail = structures.detail(cible, schema, nom)
      return detail ? [detail] : []
    })
    // `structures` **doit** être une dépendance : c'est son changement qui fait paraître une table
    // lue. Les quatre autres sont les coordonnées, décomposées — voir la note plus haut.
  }, [noms, structures, connection, schema])

  return {
    tables,
    total,
    demandees: Math.min(total, PLAFOND_DE_TABLES),
    omises,
    loading,
    error,
  }
}
