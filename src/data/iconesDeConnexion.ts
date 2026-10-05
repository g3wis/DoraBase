import type { IconName } from '../design/icons/names'
import type { Database, Engine } from '../domain/config'
import { ENGINES } from '../screens/NewConnection/engines'
import { COULEURS_DE_DOSSIER } from '../screens/NewConnection/environments'
import { dessinDIcone, ICONE_PAR_DEFAUT, ICONES_DE_DOSSIER } from './iconesDeDossier'

/**
 * L'icône d'une connexion qui n'en a pas choisi (#179) : **le logo de son moteur**, `db` pour un
 * moteur qui n'en a pas. C'est ce que l'arbre dessinait avant que l'icône se choisisse, donc une
 * connexion existante ne change pas d'aspect.
 */
export function iconeParDefautDeConnexion(engine: Engine): IconName {
  return ENGINES[engine].icon ?? 'db'
}

/**
 * Les icônes qu'on peut donner à une connexion, **dans l'ordre de la grille** (#179) : le logo de son
 * moteur en tête — celle qu'on retrouve en la retirant —, puis celles des dossiers, `pin` excepté.
 *
 * **`pin` n'est pas offert** pour la raison qui fait refuser `db` à un dossier : il nomme déjà un
 * palier de l'arbre, le dossier, et une connexion dessinée ainsi se lirait comme un dossier. Le logo le
 * remplace en tête, donc la grille garde ses **56 cases**, et le panneau la géométrie de celui d'un
 * dossier.
 *
 * **Les logos des autres moteurs ne sont pas offerts** : un éléphant sur une connexion MySQL mentirait
 * sur ce qu'elle est. Le seul logo de la liste est celui du moteur de la connexion.
 */
export function iconesDeConnexion(engine: Engine): readonly IconName[] {
  return [
    iconeParDefautDeConnexion(engine),
    ...ICONES_DE_DOSSIER.filter((icone) => icone !== ICONE_PAR_DEFAUT),
  ]
}

/**
 * L'icône à dessiner pour une connexion : la sienne si elle est offerte, le logo de son moteur sinon.
 *
 * **Le repli est ici, et non à la lecture** — la règle d'`iconeDeDossier` : un nom inconnu reste dans
 * le fichier tel quel, seul son dessin retombe. Et `pg` posé sur une connexion MySQL, écrit à la main,
 * retombe aussi : il n'est pas dans **sa** liste.
 */
export function iconeDeConnexion(base: Pick<Database, 'icon' | 'engine'>): IconName {
  const icone = base.icon
  const offertes = iconesDeConnexion(base.engine)
  return icone !== undefined && icone !== null && offertes.includes(icone as IconName)
    ? (icone as IconName)
    : iconeParDefautDeConnexion(base.engine)
}

/** Le symbole à dessiner pour une connexion — l'arbre et le fil d'Ariane (#179). */
export function dessinDeConnexion(base: Pick<Database, 'icon' | 'engine'>): IconName {
  return dessinDIcone(iconeDeConnexion(base))
}

/**
 * Le jeton de couleur d'un moteur (`--engine-pg`, `--engine-my`, …) : la teinte d'une icône de
 * connexion **sans couleur choisie**, et l'anneau de « Aucune » dans son panneau.
 */
export function jetonDeMoteur(engine: Engine): string {
  return `var(--engine-${ABREGES[engine]})`
}

const ABREGES: Record<Engine, string> = {
  postgresql: 'pg',
  mysql: 'my',
  sqlite: 'sq',
  mongodb: 'mg',
  redis: 'rd',
  snowflake: 'sf',
  bigquery: 'bq',
}

/**
 * La teinte d'une connexion, et si elle **s'impose au logo** (#179, tranché par le demandeur).
 *
 * - **Une couleur choisie teint tout**, logo compris : l'éléphant est dessiné d'une seule teinte, celle
 *   de la pastille. C'est ce qui distingue deux connexions PostgreSQL sans changer leur icône — la
 *   demande même : « it's all postgres icons everywhere with same color ».
 * - **Sans couleur, le logo garde ses couleurs de marque**, et une autre icône prend le jeton du
 *   moteur : l'icône choisie dit encore de quel moteur il s'agit.
 *
 * `teinterLeLogo` dit à la ligne de poser `--logo-tint` : les logos du sprite sont peints en
 * `fill="var(--logo-tint, #…)"`, la forme de la plaque du logo de l'application. Une icône en trait
 * ignore la variable — elle suit `currentColor` —, donc la poser sur elle ne change rien.
 */
export function teinteDeConnexion(base: Pick<Database, 'color' | 'engine'>): {
  couleur: string
  teinterLeLogo: boolean
} {
  const choisie = base.color ?? null
  return choisie === null
    ? { couleur: jetonDeMoteur(base.engine), teinterLeLogo: false }
    : { couleur: COULEURS_DE_DOSSIER[choisie], teinterLeLogo: true }
}
