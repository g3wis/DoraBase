import { estMacos } from '../shell/plateforme'

/**
 * La frappe du modificateur de l'application, dans la syntaxe de `userEvent.keyboard`.
 *
 * **Pourquoi les tests ne peuvent pas écrire `{Meta>}` en dur.** `Meta` hors macOS est la
 * touche Windows ou « super », et aucun raccourci du produit n'y répond : une suite écrite en
 * `{Meta>}` passe sur macOS et échoue en bloc sur une machine Windows ou Linux — 29 tests,
 * mesuré le 31 août 2026. Or « Windows tourne » et « Linux tourne » veulent aussi dire « on
 * peut y développer », donc `pnpm test` doit y être vert.
 *
 * Le pendant côté produit est `raccourci` (`shell/plateforme`) : là les **libellés**, ici les
 * **frappes**. Les deux lisent la même plateforme, et `plateforme.test.ts` est le seul endroit
 * qui épingle les chaînes littérales des trois systèmes — partout ailleurs on les demande.
 *
 * @example
 *   await userEvent.keyboard(auModificateur('n'))                       // ⌘N   / Ctrl+N
 *   await userEvent.keyboard(auModificateur('{Shift>}N{/Shift}'))       // ⇧⌘N  / Ctrl+Shift+N
 */
export function auModificateur(sequence: string): string {
  const touche = estMacos() ? 'Meta' : 'Control'
  return `{${touche}>}${sequence}{/${touche}}`
}
