/**
 * La ressource Kubernetes d'`A2`, lue et écrite comme **deux** choix (`API-73`).
 *
 * Le champ « Ressource » demandait `svc/postgres` à la main ; il porte désormais une liste de sortes
 * et une liste de noms. Ce qui est **stocké n'a pas changé** — `ProxyKubernetes.resource` reste la
 * chaîne que `kubectl port-forward` reçoit —, et c'est la décision qui tient tout le reste : aucune
 * migration, aucune connexion existante à reprendre, et la règle de `config/model.rs` reste vraie au
 * mot près, « transmise telle quelle, jamais réécrite ». Nous **composons** une valeur, nous n'en
 * corrigeons aucune.
 *
 * **Pur, et séparé du composant**, comme `kubeconfigs.ts` l'est pour la liste voisine : ce qui décide
 * de la sorte lue dans une chaîne, et de la chaîne écrite depuis deux listes, se vérifie sous Vitest
 * sans rendre quoi que ce soit.
 */

import type { IconName } from '../../design/icons/names'

type Traduire = (cle: string, parametres?: Record<string, string | number>) => string

/**
 * Une entrée de liste, avec le **nom** de son icône et non l'icône elle-même.
 *
 * C'est ce qui laisse ces fonctions rester pures et vérifiables sans rien rendre : un `ReactNode`
 * ferait de ce fichier du JSX, et l'assertion d'un test porterait sur un élément React plutôt que
 * sur la décision — quelle entrée porte quel glyphe. `ChampCatalogue` fait la conversion, au seul
 * endroit qui rende déjà.
 */
export type EntreeDeCatalogue = { value: string; label: string; icone?: IconName }

/**
 * Les sortes proposées, dans l'ordre où on les rencontre devant une base.
 *
 * **Quatre, et non ce que `kubectl api-resources` rendrait.** Le dépôt écrit ailleurs que « la liste
 * des types est celle de `kubectl` et grandit sans nous » — vrai de ce qu'on *accepte*, et ce module
 * n'en refuse aucun : une sorte qui n'est pas ici reste lisible et modifiable (voir
 * `optionsDeSorte`). Ce qui est décidé ici est ce qu'on **propose**, et la liste complète en
 * propose une soixantaine dont `port-forward` refuse la quasi-totalité — un `ConfigMap` n'a pas de
 * pod derrière lui. `service` d'abord : c'est celle qui survit à un redéploiement, et ce que le
 * placeholder recommandait déjà.
 *
 * Les libellés sont les noms propres de Kubernetes, donc les mêmes dans les deux langues : rien à
 * traduire, et un dictionnaire les ferait diverger de ce que `kubectl` accepte.
 */
export const SORTES = [
  { value: 'service', label: 'Service' },
  { value: 'pod', label: 'Pod' },
  { value: 'deployment', label: 'Deployment' },
  { value: 'statefulset', label: 'StatefulSet' },
] as const

/** La sorte d'une ressource écrite sans barre — c'est ce que `kubectl` en fait. */
const SORTE_IMPLICITE = 'pod'

/** La sorte d'un formulaire neuf : celle que le placeholder recommandait. */
const SORTE_PAR_DEFAUT = 'service'

/** La valeur de l'entrée « Rafraîchir la liste », qui **agit** au lieu de désigner. */
export const RAFRAICHIR = '-rafraichir'

/** La valeur de l'entrée « Saisir à la main… », qui agit elle aussi. */
export const A_LA_MAIN = '-a-la-main'

/**
 * Les deux moitiés d'une ressource écrite.
 *
 * **Dérivées, jamais gardées à côté** : le brouillon ne porte que la chaîne, donc rouvrir une
 * connexion et ne rien toucher la laisse intacte au caractère près. Tenir la sorte et le nom dans
 * l'état aurait fait exister une seconde vérité sur la même valeur, qu'il aurait fallu remettre en
 * phase à chaque lecture.
 *
 * Trois formes à lire, et `kubectl` en décide de deux :
 * - `svc/postgres` → la sorte telle qu'elle est écrite, jamais canonisée. `svc` reste `svc`, sans
 *   quoi rouvrir une connexion en réécrirait la valeur enregistrée ;
 * - `postgres-0` → **un pod**, parce que c'est ce que `kubectl port-forward` en fait. Lire autre
 *   chose ferait mentir la liste sur ce que la connexion joindra ;
 * - `` (vide) → aucune ressource ; la sorte est celle d'un formulaire neuf.
 */
export function decomposerRessource(resource: string): { sorte: string; nom: string } {
  const ecrit = resource.trim()
  if (ecrit === '') return { sorte: SORTE_PAR_DEFAUT, nom: '' }

  const barre = ecrit.indexOf('/')
  if (barre < 0) return { sorte: SORTE_IMPLICITE, nom: ecrit }

  const sorte = ecrit.slice(0, barre).trim()
  return {
    // Une ressource qui commencerait par `/` n'a pas de sorte écrite ; la traiter comme un pod est
    // encore ce que `kubectl` en dirait de plus proche, et cela évite une sorte vide dans la liste.
    sorte: sorte === '' ? SORTE_IMPLICITE : sorte,
    nom: ecrit.slice(barre + 1).trim(),
  }
}

/**
 * La chaîne que `kubectl` recevra.
 *
 * **Un nom vide rend une ressource vide**, et ce n'est pas un détail : `service/` est une chaîne non
 * vide, donc elle franchirait le contrôle du cœur — qui refuse une ressource *absente* avec une
 * phrase utile — pour échouer vingt secondes plus tard sur un message de `kubectl`. Le vide doit
 * rester le vide.
 *
 * **Un nom qui porte déjà sa sorte l'emporte**, et c'est le seul cas où la liste des sortes cède.
 * `svc/postgres` tapé dans le champ du nom est ce qu'écrit qui a l'habitude du champ d'avant
 * `API-73`, ou qui recopie une ligne de terminal ; le composer donnerait `service/svc/postgres`,
 * que `kubectl` refuse, et l'erreur n'arriverait qu'à l'ouverture. Ce n'est pas une correction de
 * saisie — nous ne réécrivons rien, nous **honorons** ce qui est écrit : le tour suivant,
 * `decomposerRessource` le relit et la liste des sortes affiche `svc`.
 */
export function composerRessource(sorte: string, nom: string): string {
  const propre = nom.trim()
  if (propre === '') return ''
  if (propre.includes('/')) return propre
  return `${sorte.trim()}/${propre}`
}

/**
 * Les entrées de la liste des sortes.
 *
 * **Une sorte qu'on ne propose pas reçoit son entrée**, comme une référence de kubeconfig retirée
 * reçoit la sienne : `ListeDeroulante` rend le libellé de l'option choisie, donc une valeur absente
 * des options n'afficherait **rien du tout**. Le cas est ordinaire — une connexion déclarée avant
 * `API-73` porte `svc/…`, et `svc` n'est pas dans les quatre — et le seul affichage honnête est de
 * la montrer telle qu'elle est écrite.
 */
export function optionsDeSorte(sorteChoisie: string): EntreeDeCatalogue[] {
  const options: EntreeDeCatalogue[] = SORTES.map((sorte) => ({
    value: sorte.value,
    label: sorte.label,
  }))
  if (!options.some((option) => option.value === sorteChoisie)) {
    options.push({ value: sorteChoisie, label: sorteChoisie })
  }
  return options
}

/**
 * Les entrées d'une liste lue au cluster : les noms, puis les deux entrées qui **agissent**.
 *
 * L'ordre est celui d'`optionsDeKubeconfig`, et pour la même raison : ce qui désigne d'abord, ce qui
 * agit en dernier — là où l'on ne tombe pas par accident en parcourant la liste au clavier.
 *
 * `videLibelle` est l'entrée du vide, et les **deux** listes suivent la même règle : elle n'existe
 * que tant que rien n'est choisi. Sans elle, `ListeDeroulante` n'aurait aucun libellé à rendre sur un
 * formulaire neuf et la liste paraîtrait vide ; avec elle en permanence, elle offrirait de défaire ce
 * qu'on vient de choisir — et, pour l'espace de noms, elle aurait porté la phrase qui décrit ce que
 * *le vide* vaut, laquelle est une aide à la saisie et non le nom d'un espace de noms (18 septembre
 * 2026, à la demande).
 */
export function optionsDeCatalogue(
  noms: readonly string[],
  choisi: string,
  t: Traduire,
  videLibelle: string | null,
): EntreeDeCatalogue[] {
  const options: EntreeDeCatalogue[] = []
  if (videLibelle !== null) options.push({ value: '', label: videLibelle })
  options.push(...noms.map((nom) => ({ value: nom, label: nom })))

  // La valeur enregistrée que le cluster ne porte plus : un pod détruit par un redéploiement, un
  // espace de noms supprimé. La taire viderait le champ **en silence**, donc changerait ce que la
  // connexion joindra sans que personne l'ait demandé.
  if (choisi !== '' && !noms.includes(choisi)) {
    options.push({
      value: choisi,
      label: t('newConnection.tunnel.catalogueAbsent', { nom: choisi }),
    })
  }

  /**
   * **Les deux entrées qui agissent portent un glyphe, les noms n'en portent pas** (18 septembre
   * 2026, à la demande). Leur place dans la liste — en queue — dit déjà qu'elles ne sont pas des
   * noms, mais seulement à qui la parcourt en entier : d'un coup d'œil, « Rafraîchir la liste » au
   * milieu de dix pods se lit comme un onzième pod. Le glyphe le dit **avant** la lecture.
   *
   * `refresh` est celui de la barre d'outils et du témoin du diagramme, donc « relire » dans ce
   * produit. `kbd` est un clavier, et c'est **littéralement** ce que l'entrée offre : taper soi-même.
   * Le crayon aurait été le choix naturel ailleurs — ici il dit déjà « une ligne est modifiée »,
   * dans l'indicateur de sélection et le panneau des modifications, et un même glyphe pour deux
   * choses fait annoncer l'une par le nom de l'autre. `i-kbd` vivait dans le sprite sans appelant
   * depuis son extraction du handoff ; c'est son premier.
   */
  options.push({
    value: RAFRAICHIR,
    label: t('newConnection.tunnel.catalogueRafraichir'),
    icone: 'refresh',
  })
  options.push({
    value: A_LA_MAIN,
    label: t('newConnection.tunnel.catalogueALaMain'),
    icone: 'kbd',
  })
  return options
}
