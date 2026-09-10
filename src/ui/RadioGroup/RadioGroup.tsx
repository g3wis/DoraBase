import { type ReactNode, useId } from 'react'
import { cx } from '../cx'
import styles from './RadioGroup.module.css'

export type RadioOption<T extends string> = {
  value: T
  label: string
  /** Contenu placé avant le libellé : le monogramme d'un moteur, l'icône warning de prod. */
  prefix?: ReactNode
  /** Classe additionnelle pour l'habillage propre à une option — `prod` en rouge. */
  className?: string
  /**
   * Désactive **cette** option seule (`API-32`).
   *
   * Distinct du `disabled` du groupe, qui verrouille les trois champs d'`A2` en édition : ici une
   * partie des choix reste offerte. Le cas qui l'a fait naître est le bloc « Moteur » du
   * gestionnaire d'instances, où PostgreSQL est le seul managé et où les trois autres sont rendus
   * **désactivés avec leur raison** plutôt que masqués — masquer dirait « jamais » là où c'est un
   * « pas encore ».
   *
   * Porté par l'`<input>`, et le `<label>` prend l'apparence grisée : le `<fieldset>` ne peut pas
   * désactiver une option sur quatre.
   */
  disabled?: boolean
  /**
   * Pourquoi cette option est refusée. Posé sur le `<label>`, **pas sur l'`<input>`** : celui-ci est
   * masqué visuellement, donc il ne se survole pas — l'infobulle serait inatteignable, ce qui est le
   * piège n° 3 de la liste d'accessibilité par un autre bout.
   */
  title?: string
}

type RadioGroupProps<T extends string> = {
  /** Nom accessible du groupe. */
  label: string
  options: readonly RadioOption<T>[]
  value: T
  onValueChange: (value: T) => void
  /**
   * Désactive tout le groupe — les trois champs verrouillés de `08g` en édition.
   *
   * Porté par le `<fieldset>` : un `disabled` sur lui désactive nativement tous ses contrôles, et
   * le poser sur chaque `<input>` reviendrait au même en trois fois plus de lignes.
   */
  disabled?: boolean
  /** Explication du verrou, en infobulle. Un contrôle désactivé sans raison passe pour un bug. */
  title?: string
}

/**
 * Groupe de boutons exclusifs : sélecteur de moteur et variante d'environnement de `A2`.
 *
 * **Pourquoi pas `Chip`.** La forme du `Chip` interactif restait ouverte, à
 * trancher contre un écran réel. `A2` a répondu : son sélecteur de moteur n'a pas de croix de
 * suppression. Il n'y a donc pas de bouton dans un bouton à contourner.
 *
 * **Pourquoi de vrais `<input type="radio">` plutôt que des `<button role="radio">`.** Une
 * première version employait des boutons avec `aria-checked`, `tabIndex` alterné et un
 * gestionnaire de flèches maison — une trentaine de lignes. Or un groupe de radios natifs
 * partageant le même `name` fait déjà tout cela : les flèches sélectionnent et déplacent, le
 * bouclage aux extrémités est géré, et Tab entre puis sort du groupe. Ces lignes ont été
 * supprimées, et les tests de clavier passent sans elles — ce qui est la preuve que le
 * navigateur faisait le travail.
 *
 * L'`<input>` est masqué visuellement mais **reste focalisable** : c'est le `<label>` qui
 * porte l'apparence. Une `visibility: hidden` ou un `display: none` casserait le clavier.
 */
export function RadioGroup<T extends string>({
  label,
  options,
  value,
  onValueChange,
  disabled = false,
  title,
}: RadioGroupProps<T>) {
  const nom = useId()

  return (
    <fieldset className={styles.root} disabled={disabled} title={title}>
      {/* La légende nomme le groupe pour un lecteur d'écran sans être affichée : `A2` met le
          nom du groupe dans une étiquette au-dessus, gérée par l'appelant. */}
      <legend className={styles.legend}>{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cx(
            styles.option,
            option.value === value && styles.active,
            option.disabled === true && styles.desactivee,
            option.className,
          )}
          title={option.title}
        >
          <input
            type="radio"
            name={nom}
            className={styles.input}
            value={option.value}
            checked={option.value === value}
            disabled={option.disabled}
            onChange={() => onValueChange(option.value)}
          />
          {/* Le préfixe est **décoratif** : le monogramme « Pg » abrège un nom déjà donné
              juste après, et l'icône warning de `prod` redouble un mot déjà écrit. Sans
              `aria-hidden`, le nom accessible sortait « PgPostgreSQL », que le lecteur
              d'écran annonce tel quel. */}
          {option.prefix && (
            <span className={styles.prefix} aria-hidden="true">
              {option.prefix}
            </span>
          )}
          {option.label}
        </label>
      ))}
    </fieldset>
  )
}
