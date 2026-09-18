/**
 * La liste de kubeconfigs du visage Kubernetes de `A2` (`API-70`).
 *
 * **Pur, et séparé du composant** : ce qui décide des entrées proposées — le repli « celui de
 * `kubectl` », l'entrée qui déclare, et la façon dont une référence morte se montre — se vérifie
 * sous Vitest sans rendre quoi que ce soit, comme `environments.ts` le fait pour le trio
 * d'environnements.
 */
import type { IconName } from '../../design/icons/names'
import type { KubeconfigDeclaration, Kubeconfigs } from '../../domain/config'

/**
 * La valeur de l'entrée « Autre fichier… », qui **agit** au lieu de désigner.
 *
 * **Elle ne peut pas entrer en collision avec un identifiant réel** : ceux-ci sont dérivés d'un
 * libellé par la règle d'`EnvironmentId` — minuscules, chiffres, tirets — et le résultat est
 * *rogné* de ses tirets de tête. Aucun identifiant dérivé ne commence donc par `-`.
 */
export const AUTRE_FICHIER = '-autre-fichier'

/** La valeur qui vaut « celui que `kubectl` choisirait » : aucune référence. */
export const AUCUN = ''

type Traduire = (cle: string, parametres?: Record<string, string | number>) => string

/** Ce qu'on affiche d'une déclaration : son libellé, ou son chemin s'il n'en porte pas. */
export function libelleDeKubeconfig(declaration: KubeconfigDeclaration): string {
  return declaration.label.trim() || declaration.path
}

/**
 * Les entrées de la liste, dans l'ordre où elles se lisent.
 *
 * Trois familles, et l'ordre n'est pas arbitraire : le **repli** d'abord — c'est l'état d'une
 * connexion qui n'a rien choisi, donc celui qu'on quitte —, les **déclarations** ensuite, et
 * l'entrée qui **agit** en dernier, où l'on ne tombe pas par accident en parcourant la liste au
 * clavier.
 *
 * **Une référence morte reçoit son entrée**, faute de quoi la liste n'afficherait rien du tout pour
 * une connexion qui en porte une : `ListeDeroulante` rend le libellé de l'option choisie, et une
 * valeur qui n'est dans aucune option n'en a pas. Le cas vient d'un fichier de configuration écrit à
 * la main, ou d'une déclaration retirée hors de l'application — l'écran refuse de la retirer tant
 * qu'une connexion s'en sert. Montrer la référence et la dire retirée est le seul affichage honnête :
 * la vider ferait *silencieusement* retomber la connexion sur le cluster par défaut de `kubectl`.
 */
export function optionsDeKubeconfig(
  kubeconfigs: Kubeconfigs,
  t: Traduire,
  choisi: string = AUCUN,
): { value: string; label: string; icone?: IconName }[] {
  const declarations = kubeconfigs.declarations ?? []
  const options: { value: string; label: string; icone?: IconName }[] = [
    { value: AUCUN, label: t('newConnection.tunnel.kubeconfigDefaut') },
    ...declarations.map((declaration) => ({
      value: declaration.id,
      label: libelleDeKubeconfig(declaration),
    })),
  ]

  if (choisi !== AUCUN && !declarations.some((declaration) => declaration.id === choisi)) {
    options.push({
      value: choisi,
      label: t('newConnection.tunnel.kubeconfigRetire', { reference: choisi }),
    })
  }

  // **Le même glyphe que les deux entrées d'`API-73` deux rangées plus bas**, et pour la même
  // raison : c'est le même genre d'entrée — une qui *agit* au milieu d'entrées qui désignent. La
  // laisser nue pendant que ses voisines sont ornées ferait deux dessins pour un seul genre, dans le
  // même panneau. `plus` parce qu'elle **déclare** : un fichier choisi ici entre dans la liste.
  options.push({
    value: AUTRE_FICHIER,
    label: t('newConnection.tunnel.kubeconfigAutre'),
    icone: 'plus',
  })
  return options
}

/**
 * La référence qu'une connexion **neuve** prend : le défaut déclaré, s'il y en a un.
 *
 * **Seulement une connexion neuve**, et c'est la décision d'`API-70` : appliquer le défaut à une
 * connexion déjà enregistrée la repointerait en silence vers un autre cluster, ce qu'`update_variant`
 * ferme une connexion pour éviter.
 *
 * Un défaut qui ne désigne plus rien est ignoré plutôt que repris — il vaut alors « celui de
 * `kubectl` », qui est l'état d'avant, et non une référence morte posée sur une connexion qu'on vient
 * de créer.
 */
export function kubeconfigParDefaut(kubeconfigs: Kubeconfigs): string {
  const defaut = kubeconfigs.default
  if (!defaut) return AUCUN
  const declarations = kubeconfigs.declarations ?? []
  return declarations.some((declaration) => declaration.id === defaut) ? defaut : AUCUN
}
