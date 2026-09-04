/**
 * La plateforme, et les quatre choses que la coquille en déduit (31 août 2026, Linux le
 * 4 septembre 2026).
 *
 * # Pourquoi un module, et pas `__APP_PLATFORM__` lu sur place
 *
 * Le global est une valeur de construction — trois caractères de sens et aucune règle. Ce qui
 * doit être écrit une seule fois, ce sont les **conséquences** : quel modificateur ouvre les
 * raccourcis, comment un raccourci s'écrit, qui dessine les boutons de fenêtre, et s'il existe
 * une voie de mise à jour. Les deux premières diffèrent plus qu'il n'y paraît, et c'est la
 * raison d'être de `raccourci` — voir plus bas.
 *
 * Conséquence pratique : **aucun composant ne lit `__APP_PLATFORM__`**. Un composant qui le
 * ferait perdrait `DORABASE_PLATEFORME_DECOR`, donc sortirait du champ des tests.
 *
 * # Ce que l'ajout de Linux a appris : l'axe était mal nommé, pas incomplet
 *
 * `estWindows` a vécu du 31 août au 4 septembre 2026, et **aucune de ses quatre questions ne
 * portait sur Windows** : elles demandaient toutes « est-ce macOS ? ». Le modificateur est `⌘`
 * sur macOS et `Ctrl` partout ailleurs ; `ctrl` + molette est le pincement du trackpad sur
 * macOS et le geste de zoom volontaire partout ailleurs ; les boutons de fenêtre sont dessinés
 * par le système sur macOS et par nous partout ailleurs. Linux n'a donc ajouté **aucune
 * troisième branche** — il a révélé que le prédicat était nommé pour la plateforme qu'on venait
 * d'ajouter plutôt que pour la question qu'il posait.
 *
 * C'est exactement le défaut de `seulLeModificateur` d'un cran plus haut : là, `ctrlKey` voulait
 * dire « un modificateur qui n'est pas le nôtre » ; ici, `estWindows` voulait dire « pas
 * macOS ». Un prédicat nommé pour un cas plutôt que pour sa question se dénonce à l'ajout du
 * deuxième cas, jamais avant. D'où `estMacos`, et `Plateforme` à trois valeurs.
 *
 * # Pourquoi la plateforme est un paramètre partout
 *
 * `__APP_PLATFORM__` est figé à la compilation : sous Vitest il vaut celui de la machine, donc
 * une seule des trois branches serait jamais exercée. Chaque fonction prend donc la plateforme
 * en dernier argument, avec le vrai comme défaut — exactement la forme de
 * `langueAppliquee(preferences, systeme = detecterLangueSysteme())` dans `i18n/LanguageContext`,
 * et de `decouvrir_dans` / `selectionner_pour` côté Rust.
 */

export type Plateforme = 'macos' | 'windows' | 'linux'

/** Les trois valeurs, pour les tests qui veulent balayer l'axe entier. */
export const PLATEFORMES: readonly Plateforme[] = ['macos', 'windows', 'linux']

/**
 * La plateforme pour laquelle ce bundle a été construit.
 *
 * Tout ce qui n'est ni `'windows'` ni `'linux'` vaut `'macos'` : la valeur vient de notre propre
 * `vite.config.ts`, donc un quatrième mot serait une faute de frappe, et le repli sur la
 * plateforme historique du produit est le moins surprenant.
 */
export function plateforme(): Plateforme {
  if (__APP_PLATFORM__ === 'windows') return 'windows'
  if (__APP_PLATFORM__ === 'linux') return 'linux'
  return 'macos'
}

/**
 * macOS, et rien d'autre.
 *
 * **C'est le seul prédicat de plateforme du produit**, et c'est délibéré : les quatre écarts de
 * la coquille séparent macOS du reste, jamais Windows de Linux. Un `estLinux` n'aurait aucun
 * appelant, et en écrire un ferait chercher ce qu'il distingue.
 */
export function estMacos(sur: Plateforme = plateforme()): boolean {
  return sur === 'macos'
}

/**
 * L'application dessine-t-elle elle-même ses trois boutons de fenêtre ?
 *
 * Vrai partout sauf macOS, où le système les dessine par-dessus la fenêtre
 * (`titleBarStyle: "Overlay"`) et où ils sont hors d'atteinte du CSS. Sous Windows comme sous
 * Linux, `decorations: false` retire le cadre du système : sans nos boutons, la fenêtre ne se
 * réduirait, ne s'agrandirait et ne se fermerait plus depuis la barre.
 *
 * **Nommé pour le fait plutôt que pour la plateforme** — c'est la leçon d'`estWindows`, en
 * en-tête de ce module.
 */
export function dessineSesBoutonsDeFenetre(sur: Plateforme = plateforme()): boolean {
  return !estMacos(sur)
}

/**
 * Ce bundle a-t-il une voie de mise à jour en place ?
 *
 * **macOS seulement**, et la raison n'est pas la même des deux côtés :
 *
 *   - **Windows** n'a pas de certificat Authenticode, donc rien n'atteste qu'un exécutable
 *     téléchargé vient de nous — c'est « rien n'est proposé qui n'ait été notarié », transposé ;
 *   - **Linux** n'a pas ce problème (la clé minisign du projet suffit à authentifier une
 *     archive), mais le plugin `updater` n'y sait remplacer qu'un **AppImage** : une release
 *     installée par le `.deb` ne pourrait pas se mettre à jour, et son écran annoncerait
 *     pourtant une version. Une voie qui marche pour une moitié des installations et échoue
 *     pour l'autre n'est pas une voie.
 *
 * Ce que ce prédicat évite concrètement : `check_update` interroge `latest.json`, qui ne porte
 * que les deux clefs `darwin-*`. Sur un autre système le plugin **échoue** — « the platform
 * `linux-x86_64` was not found on the response `platforms` object » — donc le bouton
 * « Rechercher » d'`A10` afficherait un message qui accuse une installation correcte, ce qui est
 * le mode de défaillance que ce dépôt refuse le plus systématiquement. Le bouton est donc
 * **désactivé avec sa raison**, et la notification de démarrage ne cherche rien.
 */
export function aUneVoieDeMiseAJour(sur: Plateforme = plateforme()): boolean {
  return estMacos(sur)
}

/**
 * Le modificateur des raccourcis de l'application est-il enfoncé ?
 *
 * **Hors macOS, `metaKey` est la touche Windows ou la touche « super », et elle n'ouvre rien.**
 * Laisser les gestionnaires sur `metaKey` n'aurait pas produit une erreur : les raccourcis
 * n'auraient simplement jamais répondu, pendant que leurs libellés continuaient de les
 * annoncer.
 *
 * Le test est **exclusif** dans les deux sens : sur macOS un `ctrl` + touche ne doit pas
 * déclencher un raccourci `⌘` (les deux existent et ne veulent pas dire la même chose), et
 * ailleurs la touche système ne doit pas se substituer à `Ctrl`.
 */
export function modificateurActif(
  evenement: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'>,
  sur: Plateforme = plateforme(),
): boolean {
  return estMacos(sur) ? evenement.metaKey : evenement.ctrlKey
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
 * voulait dire « un modificateur qui n'est pas le nôtre ». Hors macOS, `ctrl` **est** le
 * nôtre : la condition serait devenue vraie à chaque fois, et `Ctrl+N` n'aurait jamais rien
 * ouvert — en silence, puisque rien n'échoue quand un raccourci ne répond pas. La touche à
 * exclure est celle qui n'est pas le modificateur : `metaKey` hors macOS, `ctrlKey` sur macOS.
 */
export function seulLeModificateur(
  evenement: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  sur: Plateforme = plateforme(),
): boolean {
  if (!modificateurActif(evenement, sur)) return false
  if (evenement.shiftKey || evenement.altKey) return false
  return estMacos(sur) ? !evenement.ctrlKey : !evenement.metaKey
}

/** Les modificateurs qui s'ajoutent à celui de l'application. */
export type Modificateurs = { maj?: boolean; alt?: boolean }

/**
 * Les touches dont le **nom** change de plateforme, et pas seulement le symbole.
 *
 * macOS écrit les touches en pictogrammes, Windows et les bureaux Linux en mots. `↩` sur un
 * clavier PC ne dit rien à personne : c'est `Enter`.
 */
const TOUCHES_HORS_MACOS: Record<string, string> = { '↩': 'Enter' }

/**
 * Un raccourci écrit dans la convention de la plateforme.
 *
 * **Ce n'est pas une substitution de caractère, et c'est pourquoi cette fonction existe.**
 * Trois choses changent à la fois :
 *
 *   - le modificateur — `⌘` contre `Ctrl` ;
 *   - le **séparateur** — macOS colle les symboles (`⇧⌘E`), Windows et GTK joignent par `+`
 *     (`Ctrl+Shift+E`) ;
 *   - l'**ordre** — la convention macOS place `⌘` en dernier, juste avant la touche, donc
 *     après `⇧` ; ailleurs `Ctrl` vient en tête. Un simple remplacement de `⌘` par `Ctrl+`
 *     aurait donné « Shift+Ctrl+E », qui se lit mal et qu'aucun logiciel n'écrit.
 *
 * **Windows et Linux écrivent la même chose**, et ce n'est pas un raccourci de mise en œuvre :
 * `Ctrl+Shift+E` est la graphie des deux — celle du guide d'interface de Microsoft comme celle
 * de GTK, qui la rend telle quelle dans ses propres libellés de menu.
 *
 * Et le résultat est **plus large** que sur macOS : `Ctrl+Shift+E` contre `⇧⌘E`. C'est mesuré
 * par les tests e2e de la coquille hors macOS, pas supposé — `Button.module.css` réserve une
 * place à `.shortcut`.
 */
export function raccourci(
  touche: string,
  modificateurs: Modificateurs = {},
  sur: Plateforme = plateforme(),
): string {
  const { maj = false, alt = false } = modificateurs

  if (!estMacos(sur)) {
    const parties = ['Ctrl']
    if (alt) parties.push('Alt')
    if (maj) parties.push('Shift')
    parties.push(TOUCHES_HORS_MACOS[touche] ?? touche)
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
 * `TOUCHES_HORS_MACOS` : macOS écrit les touches en pictogrammes, Windows et les bureaux Linux en
 * mots, et `⇧` ne dit rien sur un clavier PC.
 */
export function toucheMajuscule(sur: Plateforme = plateforme()): string {
  return estMacos(sur) ? '⇧' : 'Shift'
}
