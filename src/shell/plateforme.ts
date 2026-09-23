/**
 * La plateforme, et les deux choses que la coquille en déduit (31 août 2026).
 *
 * # Pourquoi un module, et pas `__APP_PLATFORM__` lu sur place
 *
 * Le global est une valeur de construction — trois caractères de sens et aucune règle. Ce qui
 * doit être écrit une seule fois, ce sont les **conséquences** : quel modificateur ouvre les
 * raccourcis, et comment un raccourci s'écrit. Les deux diffèrent plus qu'il n'y paraît, et
 * c'est la raison d'être de `raccourci` — voir plus bas.
 *
 * Conséquence pratique : **aucun composant ne lit `__APP_PLATFORM__`**. Un composant qui le
 * ferait perdrait `DORABASE_PLATEFORME_DECOR`, donc sortirait du champ des tests.
 *
 * # Pourquoi la plateforme est un paramètre partout
 *
 * `__APP_PLATFORM__` est figé à la compilation : sous Vitest il vaut celui de la machine, donc
 * une seule des deux branches serait jamais exercée. Chaque fonction prend donc la plateforme
 * en dernier argument, avec le vrai comme défaut — exactement la forme de
 * `langueAppliquee(preferences, systeme = detecterLangueSysteme())` dans `i18n/LanguageContext`,
 * et de `decouvrir_dans` / `selectionner_pour` côté Rust.
 */

export type Plateforme = 'macos' | 'windows'

/**
 * La plateforme pour laquelle ce bundle a été construit.
 *
 * Tout ce qui n'est pas `'windows'` vaut `'macos'` : la valeur vient de notre propre
 * `vite.config.ts`, donc un troisième mot serait une faute de frappe, et le repli sur la
 * plateforme historique du produit est le moins surprenant.
 */
export function plateforme(): Plateforme {
  return __APP_PLATFORM__ === 'windows' ? 'windows' : 'macos'
}

export function estWindows(sur: Plateforme = plateforme()): boolean {
  return sur === 'windows'
}

/**
 * Le modificateur des raccourcis de l'application est-il enfoncé ?
 *
 * **Sous Windows, `metaKey` est la touche Windows, et elle n'ouvre rien.** Laisser les
 * gestionnaires sur `metaKey` n'aurait pas produit une erreur : les raccourcis n'auraient
 * simplement jamais répondu, pendant que leurs libellés continuaient de les annoncer.
 *
 * Le test est **exclusif** dans les deux sens : sur macOS un `ctrl` + touche ne doit pas
 * déclencher un raccourci `⌘` (les deux existent et ne veulent pas dire la même chose), et sous
 * Windows la touche Windows ne doit pas se substituer à `Ctrl`.
 */
export function modificateurActif(
  evenement: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'>,
  sur: Plateforme = plateforme(),
): boolean {
  return estWindows(sur) ? evenement.ctrlKey : evenement.metaKey
}

/**
 * Le modificateur de l'application, **et lui seul** — aucun autre enfoncé.
 *
 * Sert aux raccourcis dont une variante enrichie appartient à quelqu'un d'autre : `⌘N` est à
 * nous, `⇧⌘N` ne l'est pas, et le laisser passer sans le consommer demande de distinguer les
 * deux.
 *
 * **C'est le piège que le portage aurait laissé.** `useRaccourcisDeCreation` écrivait
 * `if (evenement.shiftKey || evenement.ctrlKey || evenement.altKey) return`, où `ctrlKey`
 * voulait dire « un modificateur qui n'est pas le nôtre ». Sous Windows, `ctrl` **est** le
 * nôtre : la condition serait devenue vraie à chaque fois, et `Ctrl+N` n'aurait jamais rien
 * ouvert — en silence, puisque rien n'échoue quand un raccourci ne répond pas. La touche à
 * exclure est celle qui n'est pas le modificateur : `metaKey` sous Windows, `ctrlKey` ailleurs.
 */
export function seulLeModificateur(
  evenement: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  sur: Plateforme = plateforme(),
): boolean {
  if (!modificateurActif(evenement, sur)) return false
  if (evenement.shiftKey || evenement.altKey) return false
  return estWindows(sur) ? !evenement.metaKey : !evenement.ctrlKey
}

/** Les modificateurs qui s'ajoutent à celui de l'application. */
export type Modificateurs = { maj?: boolean; alt?: boolean }

/**
 * Les touches dont le **nom** change de plateforme, et pas seulement le symbole.
 *
 * macOS écrit les touches en pictogrammes, Windows en mots. `↩` sur un clavier Windows ne dit
 * rien à personne : c'est `Enter`.
 */
const TOUCHES_WINDOWS: Record<string, string> = { '↩': 'Enter' }

/**
 * Un raccourci écrit dans la convention de la plateforme.
 *
 * **Ce n'est pas une substitution de caractère, et c'est pourquoi cette fonction existe.**
 * Trois choses changent à la fois :
 *
 *   - le modificateur — `⌘` contre `Ctrl` ;
 *   - le **séparateur** — macOS colle les symboles (`⇧⌘E`), Windows joint par `+`
 *     (`Ctrl+Shift+E`) ;
 *   - l'**ordre** — la convention macOS place `⌘` en dernier, juste avant la touche, donc
 *     après `⇧` ; Windows met `Ctrl` en tête. Un simple remplacement de `⌘` par `Ctrl+` aurait
 *     donné « Shift+Ctrl+E », qui se lit mal et qu'aucun logiciel Windows n'écrit.
 *
 * Et le résultat est **plus large** sous Windows : `Ctrl+Shift+E` contre `⇧⌘E`. C'est mesuré
 * par les tests e2e de la coquille Windows, pas supposé — `Button.module.css` réserve une place
 * à `.shortcut`.
 */
export function raccourci(
  touche: string,
  modificateurs: Modificateurs = {},
  sur: Plateforme = plateforme(),
): string {
  const { maj = false, alt = false } = modificateurs

  if (estWindows(sur)) {
    const parties = ['Ctrl']
    if (alt) parties.push('Alt')
    if (maj) parties.push('Shift')
    parties.push(TOUCHES_WINDOWS[touche] ?? touche)
    return parties.join('+')
  }

  // L'ordre du guide d'Apple : ⌥ puis ⇧ puis ⌘, la touche en dernier.
  return `${alt ? '⌥' : ''}${maj ? '⇧' : ''}⌘${touche}`
}

/**
 * Le nom de la touche majuscule, dans la convention de la plateforme.
 *
 * **Elle n'a pas sa place dans `raccourci`**, qui écrit les raccourcis de l'*application* et pose
 * donc toujours `⌘` / `Ctrl`. Ce que ce nom sert à dire est un **geste de souris** — `⇧`-clic —, où
 * le modificateur de l'application n'entre pas. La règle, elle, est la même que celle de
 * `TOUCHES_WINDOWS` : macOS écrit les touches en pictogrammes, Windows en mots, et `⇧` ne dit rien
 * sur un clavier Windows.
 */
export function toucheMajuscule(sur: Plateforme = plateforme()): string {
  return estWindows(sur) ? 'Shift' : '⇧'
}

/**
 * Le nom du modificateur de l'application, pour un **geste de souris**.
 *
 * Même partage que `toucheMajuscule`, et pour la même raison : `raccourci` écrit les raccourcis de
 * l'*application*, donc toujours une touche au bout — `⌘E`, `Ctrl+Shift+E`. Ce qu'on nomme ici
 * n'est pas un raccourci mais la moitié d'un geste, « ⌘ + molette », dont l'autre moitié n'est pas
 * une touche. En passer par `raccourci` demanderait de lui donner une touche vide, et sa règle
 * d'ordre — le modificateur en tête sous Windows, en queue sur macOS — n'aurait plus rien à ordonner.
 */
export function toucheModificateur(sur: Plateforme = plateforme()): string {
  return estWindows(sur) ? 'Ctrl' : '⌘'
}
