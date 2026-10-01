import type { IconName } from '../design/icons/names'
import type { Folder } from '../domain/config'

/**
 * L'icône d'un dossier qui n'en a pas choisi — et de celui dont le nom est inconnu (#171).
 *
 * `pin` depuis #166 : « un lieu où vivent des connexions » se lit sans légende. Un dossier migré, ou
 * créé sans y toucher, ne change donc pas d'aspect.
 */
export const ICONE_PAR_DEFAUT: IconName = 'pin'

/**
 * Les icônes qu'on peut donner à un dossier, **dans l'ordre de la grille** (#171). C'est la seule
 * liste : le cœur n'en vérifie que la forme (`regler_l_icone`), pour qu'une version plus ancienne
 * relise sans rien perdre ce qu'une plus récente a écrit.
 *
 * **48 icônes copiées de Lucide** (licence ISC, `design/icons/LICENSE-lucide.txt`) et **8 du sprite
 * d'origine**. Les secondes ne sont pas recopiées de Lucide : un second nuage à côté de `cloud` ferait
 * deux dessins pour une seule idée. Rangées par familles — organisation, infrastructure, développement,
 * commerce, mesure, repères —, `pin` en tête parce que c'est celle qu'on retrouve en la retirant.
 *
 * **Ce qui n'est pas offert, et pourquoi** : les glyphes qui *nomment déjà un palier de l'arbre*. Un
 * dossier dessiné en `schema` (un dossier !), `table`, `view`, `term` (une console), `db` (une connexion
 * sans logo de moteur), `bag` (la racine de « Déplacer vers… ») ou `lock` / `unlock` (le verrou de la
 * lecture seule, en bout de la même ligne) se lirait comme cet autre objet. C'est aussi pourquoi aucun
 * dossier de Lucide n'est entré dans la sélection : l'arbre dessine déjà un dossier, et c'est un schéma.
 */
export const ICONES_DE_DOSSIER: readonly IconName[] = [
  'pin',
  // L'organisation
  'building-2',
  'factory',
  'store',
  'landmark',
  'house',
  'briefcase',
  'users',
  'user',
  'graduation-cap',
  'heart-pulse',
  // L'infrastructure
  'srv',
  'cloud',
  'hard-drive',
  'cpu',
  'container',
  'network',
  'globe',
  'layers',
  'box',
  'archive',
  // Le développement
  'code',
  'git-branch',
  'bug',
  'flask',
  'wrench',
  'activity',
  'zap',
  'rocket',
  'puzzle',
  // Le commerce et le mouvement
  'shopping-cart',
  'credit-card',
  'wallet',
  'coins',
  'truck',
  'plane',
  'map',
  'compass',
  // La mesure et les repères
  'chart-column',
  'chart-pie',
  'target',
  'trophy',
  'flag',
  'tag',
  'star',
  'shield',
  // Le reste
  'book-open',
  'file-text',
  'mail',
  'bell',
  'calendar',
  'lightbulb',
  'flame',
  'leaf',
  'gamepad-2',
  'anchor',
]

const OFFERTES: ReadonlySet<string> = new Set(ICONES_DE_DOSSIER)

/**
 * L'icône à dessiner pour un dossier : la sienne si elle est offerte, `pin` sinon.
 *
 * **Le repli est ici, et non à la lecture** : un nom inconnu — écrit à la main, ou par une version
 * plus récente — reste dans le fichier tel quel, et c'est seulement son dessin qui retombe. Rien ne
 * lève : un `<use>` vers un symbole absent rendrait une case **vide**, sans rien pour le dire.
 */
export function iconeDeDossier(dossier: Pick<Folder, 'icon'>): IconName {
  const icone = dossier.icon
  return icone !== undefined && icone !== null && OFFERTES.has(icone)
    ? (icone as IconName)
    : ICONE_PAR_DEFAUT
}
