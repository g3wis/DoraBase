/**
 * Ce que le visage Kubernetes d'`A2` sait du cluster, et quand il va le demander (`API-73`).
 *
 * Deux listes vivent ici — les espaces de noms, et les objets d'une sorte dans l'un d'eux —, avec
 * pour chacune **quatre états et non deux** : jamais lue, en lecture, lue, échouée. C'est la règle
 * que l'arbre applique déjà à ses connexions (« jamais tentée » n'est pas « hors ligne ») : un champ
 * qui rend une liste vide sur une lecture qui n'a pas eu lieu dirait qu'il n'y a rien dans un
 * cluster que personne n'a encore interrogé.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Ce que l'hôte sait demander à `kubectl`.
 *
 * **Injecté, comme `onDeclareKubeconfig` et `onBrowseKey`**, et pour la même raison : le pont IPC ne
 * répond pas hors de la webview. Son **absence** est une valeur à part entière — c'est l'état de la
 * galerie et des tests unitaires —, et elle se lit « ce poste ne peut rien demander » : les deux
 * champs restent alors ce qu'ils étaient avant `API-73`, des champs de saisie, sans bouton ni
 * explication. Un catalogue qui refuserait ses deux appels rendrait au contraire une raison, ce qui
 * serait annoncer une panne là où il n'y a pas de pont.
 */
export type CatalogueKubernetes = {
  espacesDeNoms: (kubeconfig: string) => Promise<string[]>
  ressources: (kubeconfig: string, namespace: string, sorte: string) => Promise<string[]>
}

/** L'état d'une des deux listes. */
export type EtatDeListe =
  | { etat: 'jamais' }
  | { etat: 'lecture' }
  | { etat: 'lue'; noms: string[] }
  | { etat: 'echec'; raison: string }

/** Ce que le panneau a besoin de savoir d'une liste, et les trois gestes qu'il lui offre. */
export type Piste = {
  liste: EtatDeListe
  /**
   * Vrai quand le contrôle doit être une **liste** plutôt qu'un champ de saisie.
   *
   * Une lecture qui rend zéro objet ne fait pas une liste : un espace de noms sans pod est
   * ordinaire, et une liste déroulante qui n'offrirait que ses deux entrées d'action se lirait
   * comme une panne. Le champ reste saisissable, et le dit.
   */
  enListe: boolean
  /** Relit au cluster — l'entrée « Rafraîchir la liste ». */
  relire: () => void
  /** Quitte la saisie à la main, et relit si l'on n'a pas encore de liste. */
  choisirDansLaListe: () => void
  /** Passe en saisie à la main — l'entrée « Saisir à la main… ». */
  saisirALaMain: () => void
}

type Options = {
  /** Le visage Kubernetes est à l'écran, panneau déplié. Rien n'est lu autrement. */
  actif: boolean
  catalogue?: CatalogueKubernetes
  kubeconfig: string
  namespace: string
  sorte: string
}

/** Le message d'un rejet d'IPC, qui porte sa phrase sous `message`. */
function raisonDe(cause: unknown): string {
  if (typeof cause === 'string') return cause
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const message = (cause as { message: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(cause)
}

export function useCatalogueKubernetes({
  actif,
  catalogue,
  kubeconfig,
  namespace,
  sorte,
}: Options): {
  espaces: Piste
  ressources: Piste
  /** Relit les ressources d'un espace de noms **nommé**, voir `lireLesRessources`. */
  relireLesRessourcesPour: (espace: string) => void
} {
  const [espaces, setEspaces] = useState<EtatDeListe>({ etat: 'jamais' })
  const [ressources, setRessources] = useState<EtatDeListe>({ etat: 'jamais' })
  const [manuelEspace, setManuelEspace] = useState(false)
  const [manuelRessource, setManuelRessource] = useState(false)

  /**
   * Le catalogue et les trois valeurs, **hors des dépendances d'effet** — c'est le piège de `10d`,
   * désarmé à la source plutôt que confié à la discipline des appelants.
   *
   * `catalogue` est un objet que l'hôte peut reconstruire à chaque rendu : dans les dépendances, il
   * relancerait la lecture **indéfiniment**, et sur le serveur d'API d'un cluster. `namespace` doit
   * en sortir pour une autre raison, et elle est aussi forte : en saisie à la main, chaque frappe
   * ferait partir une requête authentifiée — `prod` en enverrait quatre.
   */
  const ambiant = useRef({ catalogue, kubeconfig, namespace, sorte })
  useEffect(() => {
    ambiant.current = { catalogue, kubeconfig, namespace, sorte }
  })

  /**
   * Le tour de chaque lecture, pour qu'une réponse **dépassée** n'écrase pas une plus récente.
   *
   * C'est `tourDesEtats` de l'arbre, appliqué ici : changer de sorte deux fois de suite lance deux
   * lectures, et rien ne promet qu'elles reviennent dans l'ordre. Une seule garde, et non une
   * seconde sur le démontage : deux gardes qui se couvrent l'une l'autre ne se dénoncent pas, et
   * poser un état après démontage est sans effet depuis React 18.
   */
  const tourEspaces = useRef(0)
  const tourRessources = useRef(0)

  const lireLesEspaces = useCallback(() => {
    const { catalogue: passerelle, kubeconfig: fichier } = ambiant.current
    if (!passerelle) return
    const tour = ++tourEspaces.current
    setEspaces({ etat: 'lecture' })
    passerelle.espacesDeNoms(fichier).then(
      (noms) => {
        if (tour === tourEspaces.current) setEspaces({ etat: 'lue', noms })
      },
      (cause) => {
        if (tour === tourEspaces.current) setEspaces({ etat: 'echec', raison: raisonDe(cause) })
      },
    )
  }, [])

  /**
   * `espaceForce` existe pour **un** appelant, et il est indispensable : le panneau relit les
   * ressources dans le geste même où il pose le nouvel espace de noms, donc avant le rendu qui
   * remettra `ambiant` à jour. Sans lui, choisir « prod » dans la liste listerait les objets de
   * l'espace de noms **précédent**, et le défaut serait invisible — une liste plausible, tirée du
   * mauvais endroit, qui est exactement le mode de défaillance que ce visage traite comme le pire.
   */
  const lireLesRessources = useCallback((espaceForce?: string) => {
    const { catalogue: passerelle, kubeconfig: fichier, sorte: type } = ambiant.current
    const espace = espaceForce ?? ambiant.current.namespace
    if (!passerelle) return
    const tour = ++tourRessources.current
    setRessources({ etat: 'lecture' })
    passerelle.ressources(fichier, espace, type).then(
      (noms) => {
        if (tour === tourRessources.current) setRessources({ etat: 'lue', noms })
      },
      (cause) => {
        if (tour === tourRessources.current)
          setRessources({ etat: 'echec', raison: raisonDe(cause) })
      },
    )
  }, [])

  // **Un booléen dans les dépendances, jamais l'objet.** Voir `ambiant` : c'est la présence d'un
  // catalogue qui décide de lire, pas l'identité de celui-ci.
  const disponible = catalogue !== undefined

  /**
   * Les espaces de noms : à l'arrivée du visage, et à chaque changement de kubeconfig.
   *
   * « À la première visite », comme les sections du gestionnaire d'instances — et pour une raison de
   * plus ici : chaque lecture est une requête authentifiée, que `kubectl` peut faire précéder d'un
   * *exec credential plugin*. Aucun minuteur, aucune relecture périodique.
   *
   * `kubeconfig` est une dépendance **déclencheur** et non une valeur capturée — la lecture la prend
   * dans `ambiant`, voir plus haut. Biome le voit comme une dépendance de trop ; la retirer ferait
   * qu'un changement de cluster laisse la liste du précédent à l'écran, ce qui est le mode de
   * défaillance que ce visage traite comme le pire : une liste plausible, tirée d'ailleurs.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: voir ci-dessus
  useEffect(() => {
    if (!actif || !disponible) return
    lireLesEspaces()
  }, [actif, disponible, kubeconfig, lireLesEspaces])

  /**
   * Les ressources : mêmes déclencheurs, plus la sorte.
   *
   * **L'espace de noms n'y est pas**, et c'est délibéré : il change aussi à la frappe quand le champ
   * est en saisie à la main. Le seul changement d'espace de noms qui relit est celui qui vient de la
   * **liste**, et c'est le panneau qui l'appelle — un geste, jamais une dépendance.
   *
   * `kubeconfig` et `sorte` sont des dépendances **déclencheurs**, comme ci-dessus.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: voir ci-dessus
  useEffect(() => {
    if (!actif || !disponible) return
    lireLesRessources()
  }, [actif, disponible, kubeconfig, sorte, lireLesRessources])

  return {
    espaces: piste(espaces, manuelEspace, setManuelEspace, lireLesEspaces),
    ressources: piste(ressources, manuelRessource, setManuelRessource, lireLesRessources),
    relireLesRessourcesPour: lireLesRessources,
  }
}

function piste(
  liste: EtatDeListe,
  manuel: boolean,
  setManuel: (manuel: boolean) => void,
  lire: () => void,
): Piste {
  return {
    liste,
    enListe: !manuel && liste.etat === 'lue' && liste.noms.length > 0,
    relire: lire,
    choisirDansLaListe: () => {
      setManuel(false)
      // Une liste déjà lue se réaffiche sans rien redemander au cluster ; une liste absente, en
      // échec, ou **vide** se relit — dans le dernier cas, l'objet cherché a pu paraître depuis.
      if (liste.etat !== 'lue' || liste.noms.length === 0) lire()
    },
    saisirALaMain: () => {
      setManuel(true)
    },
  }
}
