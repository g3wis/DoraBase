import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { FilterOperator, TypeCategory } from '../../domain/engine'
import { useT } from '../../i18n/LanguageContext'
import { cx } from '../../ui/cx'
import { SANS_CORRECTION } from '../../ui/Field/Field'
import { Popover } from '../../ui/Popover/Popover'
import styles from './FilterCell.module.css'
import { estUneBorneDeDate, operateursPour, prendUneValeur, signeDe } from './tri'

type FilterCellProps = {
  column: string
  operator: FilterOperator
  /** La valeur **appliquée**, celle qui est partie au serveur. */
  value: string
  /**
   * Vrai quand un filtre de cette colonne est **en force**.
   *
   * **Pas déductible de `value`** : les trois prédicats s'appliquent sans valeur, donc un champ vide
   * peut porter un filtre. Et l'inverse compte autant — l'opérateur affiché sur un booléen est
   * `is true` avant qu'on ait rien demandé, et la bordure d'accent ne doit pas s'allumer pour ça.
   */
  applique: boolean
  onApply: (operator: FilterOperator, value: string) => void
  /** La catégorie de la colonne : elle décide des opérateurs offerts, et du sélecteur de date. */
  category: TypeCategory
  /** `is null` et `is not null` ne sont proposés que pour une colonne qui peut porter un nul. */
  nullable: boolean
}

/**
 * Un champ de filtre d'en-tête de colonne, avec son popover d'opérateur.
 *
 * **Le filtre part au serveur ; il ne trie pas la fenêtre.** Filtrer les 500 lignes déjà reçues
 * serait immédiat et faux : l'utilisateur croirait voir toutes les commandes payées de la table
 * alors qu'il ne verrait que celles des 500 premières lignes lues.
 *
 * **Appliqué sur `Entrée` et à la perte de focus**, jamais à la frappe : un filtre relancé à
 * chaque caractère enverrait cinq requêtes pour `paid`. Un anti-rebond au jugé aurait demandé
 * une durée que rien ne fonde. **Un sélecteur de date fait exception** — voir plus bas.
 */
export function FilterCell({
  column,
  operator,
  value,
  applique,
  onApply,
  category,
  nullable,
}: FilterCellProps) {
  const t = useT()
  const [saisie, setSaisie] = useState(value)
  const champ = useRef<HTMLInputElement>(null)
  const operateurs = operateursPour(category, nullable)
  const saisissable = prendUneValeur(operator)
  // Le sélecteur de date ne sert qu'aux deux bornes d'une colonne temporelle. Sur `=`, `~` ou `in`,
  // la saisie reste libre : un `~` cherche un motif — « 2026-03 » —, et `in` une liste, deux choses
  // qu'un champ de date ne peut pas exprimer.
  const borneDeDate = estUneBorneDeDate(category, operator)

  // La valeur appliquée fait autorité : vider un chip de la toolbar (`10e`) doit vider le champ,
  // sans quoi les deux affichages du même filtre divergeraient.
  useEffect(() => setSaisie(value), [value])

  const modifie = saisie !== value

  function appliquer() {
    if (modifie) onApply(operator, saisie)
  }

  /**
   * Ouvre le calendrier du champ, tout de suite.
   *
   * **Choisir « avant le » *est* la demande d'une date.** Sans cela, l'écran rendait un champ de
   * date vide qu'il fallait aller cliquer : WebKit y affiche alors la date du jour et met un seul
   * segment en surbrillance — un champ qui montre une date que la requête ne porte pas, et trois
   * gestes pour en sortir. Rapporté à l'usage le 3 septembre 2026.
   *
   * `showPicker` manque sous jsdom et **lève** hors activation utilisateur : le `catch` rend alors
   * le comportement d'avant, un champ saisissable au clavier — c'est pour cela que le focus est pris
   * d'abord, et non après.
   */
  function ouvrirLeCalendrier() {
    const element = champ.current
    if (!element) return
    element.focus()
    try {
      element.showPicker?.()
    } catch {
      // Rien à dire : le champ reste saisissable.
    }
  }

  return (
    <div className={cx(styles.root, applique && styles.actif, modifie && styles.modifie)}>
      <Popover
        title={t('tableView.filterCell.operatorTitle', { column })}
        content={(fermer) => (
          <ul className={styles.liste}>
            {operateurs.map((o) => (
              <li key={o.cle}>
                <button
                  type="button"
                  className={cx(styles.option, o.valeur === operator && styles.choisi)}
                  aria-current={o.valeur === operator}
                  onClick={() => {
                    // **`flushSync` : `showPicker()` exige un champ qui soit *déjà* `type="date"`.**
                    // Le type suit l'opérateur, qui vit chez l'appelant, et React 19 ne pose pas un
                    // état d'un gestionnaire d'événement avant la fin de celui-ci : sans le vidage
                    // synchrone, l'appel tomberait sur le champ texte d'avant. Et il doit rester
                    // dans l'activation utilisateur du clic, ce qui exclut de l'attendre dans un
                    // effet — WebKit refuse `showPicker()` en dehors.
                    //
                    // Un prédicat s'applique **sans valeur** : attendre une saisie qui ne viendra
                    // jamais laisserait le filtre inerte.
                    flushSync(() => {
                      onApply(o.valeur, prendUneValeur(o.valeur) ? saisie : '')
                      fermer()
                    })
                    if (estUneBorneDeDate(category, o.valeur)) ouvrirLeCalendrier()
                  }}
                >
                  {/* **L'espace est explicite, et il est ici** — le piège n° 1 d'accessibilité :
                    le `gap` de la CSS sépare les deux à l'œil, jamais dans le nom accessible, où
                    l'entrée s'annonçait « ∅is null » puis « Tis true ». */}
                  <span className={styles.signe}>{o.signe}</span>{' '}
                  {t(`tableView.filterCell.operators.${o.cle}`)}
                </button>
              </li>
            ))}
          </ul>
        )}
      >
        <button
          type="button"
          className={styles.operateur}
          aria-label={t('tableView.filterCell.operatorLabel', { column })}
        >
          {signeDe(operator)}
        </button>
      </Popover>
      <input
        {...SANS_CORRECTION}
        // `date` plutôt que `datetime-local` : le second demande une soixantaine de pixels de plus
        // qu'une colonne de 130 px n'a pas, et une borne à la minute n'est pas ce qu'on cherche en
        // filtrant une table. Une heure reste saisissable à la main, l'adaptateur l'acceptant.
        type={borneDeDate ? 'date' : 'text'}
        ref={champ}
        className={styles.saisie}
        aria-label={t('tableView.filterCell.filterLabel', { column })}
        value={saisissable ? saisie : ''}
        disabled={!saisissable}
        onChange={(evenement) => {
          setSaisie(evenement.target.value)
          // **Un choix de date s'applique tout seul.** Le calendrier natif se referme sans que rien
          // perde le focus et sans qu'on tape `Entrée` : attendre l'un des deux laisserait la date
          // choisie dans le champ sans qu'elle parte, ce qui est exactement le bouton inerte du
          // défaut n° 36.
          //
          // **`!== value` n'est pas une précaution, c'est ce qui empêche la requête par frappe** que
          // la règle du haut interdit. Un `type="date"` rend `''` tant que la date est incomplète, et
          // il émet un événement à *chaque* segment saisi au clavier : sans cette garde, taper une
          // date à la main enverrait trois lectures non filtrées avant la bonne — `poserFiltre` rend
          // un tableau neuf même quand il n'y a rien à retirer, donc la requête change d'identité et
          // repart. Comparer à la valeur **appliquée** laisse passer le choix et le vidage, rien
          // d'autre.
          if (borneDeDate && evenement.target.value !== value) {
            onApply(operator, evenement.target.value)
          }
        }}
        onKeyDown={(evenement) => {
          if (evenement.key === 'Enter') appliquer()
          // `Échap` rend la saisie à sa valeur appliquée plutôt que de fermer quoi que ce soit.
          if (evenement.key === 'Escape') setSaisie(value)
        }}
        onBlur={appliquer}
      />
    </div>
  )
}
