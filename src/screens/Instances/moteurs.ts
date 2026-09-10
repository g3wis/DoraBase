import type { Engine } from '../../domain/config'
import type { useT } from '../../i18n/LanguageContext'

/**
 * Les moteurs dont une instance se gère (`API-32`).
 *
 * **Le pendant côté écran de `config::moteur_manage`, et ce n'est pas une redondance** : l'écran
 * cache ce qu'on ne peut pas choisir, le cœur refuse ce qui arrive quand même — un fichier de
 * configuration écrit à la main, ou une déclaration faite par une version future. Les deux gardent
 * deux chemins différents, exactement comme les modes SSL par moteur.
 */
export const MOTEURS_MANAGES: readonly Engine[] = ['postgresql']

/**
 * Pourquoi un moteur n'est pas managé, **dans ses termes**.
 *
 * `undefined` pour PostgreSQL : une infobulle sur un contrôle actif se lirait comme une limite qui
 * n'existe pas — la règle du piège n° 4.
 */
export function raisonDuMoteur(engine: Engine, t: ReturnType<typeof useT>): string | undefined {
  if (MOTEURS_MANAGES.includes(engine)) return undefined
  return t('instances.form.engineOnlyPostgres')
}

/**
 * Les moteurs que le bloc « Moteur » **liste**, managés ou non.
 *
 * **Quatre, et non les sept d'`A2`.** Les trois absents n'ont pas d'instance à gérer au sens de cet
 * écran : Redis est un espace de clés sans rôles SQL, Snowflake n'a pas de décor de test dans ce
 * projet, et les autorisations d'un projet BigQuery sont celles d'IAM, qui vit hors de la base. Les
 * lister désactivés dirait « pas encore » d'un cas qui ne viendra pas — la distinction que les cinq
 * verdicts du dump tiennent déjà.
 */
export const MOTEURS_OFFERTS: readonly Engine[] = ['postgresql', 'mysql', 'mongodb', 'sqlite']
