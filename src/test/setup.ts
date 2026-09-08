import '@testing-library/jest-dom/vitest'

// Node 26 expose un `localStorage` global expérimental, inactif sans `--localstorage-file` :
// son accesseur renvoie `undefined`. Sous Vitest, ce getter natif masque celui de jsdom —
// vérifié par sondes : `sessionStorage` de jsdom est bien un objet, `localStorage` non, et
// jsdom seul (hors Vitest) le fournit correctement. Le descripteur global est
// `configurable: true`, donc surchargeable ici.
//
// Sans ce correctif, tout accès à `localStorage` dans un test lève
// « Cannot read properties of undefined ». Les composants qui l'entourent d'un `try/catch`
// (voir `SplitPane`) dégradent proprement et **passeraient leurs tests sans rien
// persister** : c'est justement ce qui rendrait le défaut invisible. Le vrai runtime
// (WKWebView sous Tauri) n'est pas concerné.
if (globalThis.localStorage === undefined) {
  const entries = new Map<string, string>()

  const storage: Storage = {
    get length() {
      return entries.size
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(String(key)) ?? null,
    setItem: (key, value) => {
      entries.set(String(key), String(value))
    },
    removeItem: (key) => {
      entries.delete(String(key))
    },
    clear: () => {
      entries.clear()
    },
  }

  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  })
}

// CodeMirror (`12b`) **mesure** son texte pour placer le curseur et calculer les hauteurs de ligne :
// il appelle `getClientRects()` sur un `Range`, que jsdom n'implémente pas. Sans ce complément, la
// vue lève neuf exceptions non gérées par run — et Vitest fait échouer la suite entière, alors que
// tous les tests passent : un mode d'échec particulièrement déroutant.
//
// **Un tableau vide est la bonne réponse ici**, pas une mesure inventée : dire « aucun rectangle »
// laisse CodeMirror conclure qu'il ne peut pas mesurer, ce qui est exactement la vérité sous jsdom.
// Rendre des dimensions plausibles ferait croire à une mise en page qui n'existe pas — et c'est
// Playwright qui vérifie tout ce qui dépend d'une mesure réelle.
if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () =>
    Object.assign([] as DOMRect[], { item: () => null }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}

// `scrollIntoView` n'existe pas sous jsdom : il n'y a pas de mise en page, donc rien à amener à
// l'écran. Le diagramme de schéma l'appelle quand `Entrée` emmène à la correspondance suivante, et
// sans ce complément la recherche lèverait une exception **après** avoir désigné la table — donc un
// test rouge pour une raison qui n'est pas le sujet.
//
// **Une fonction vide est la bonne réponse ici**, comme le tableau vide de `getClientRects` : dire
// « rien à faire » est exactement la vérité sous jsdom. Ce que le défilement produit vraiment est
// hors de portée de Vitest (règle n° 9), et c'est `e2e/diagramme-de-schema.spec.ts` qui le mesure.
if (typeof Element !== 'undefined' && Element.prototype.scrollIntoView === undefined) {
  Element.prototype.scrollIntoView = () => {}
}

// `Element.prototype.scrollTo` n'existe pas non plus sous jsdom, et pour la même raison :
// il n'y a pas de mise en page, donc aucune position à atteindre. `VirtualGrid` l'appelle à deux
// endroits — ramener la ligne sélectionnée dans la fenêtre, et descendre au bas de la grille quand
// `A5` ajoute une ligne.
//
// **Ce complément a manqué longtemps sans qu'on le sache** : le premier appel n'était atteint par
// aucun test — il faut que la sélection sorte de la fenêtre visible, ce qu'aucun décor ne faisait —
// et le second est arrivé le 8 septembre 2026, faisant tomber d'un coup les huit tests qui cliquent
// « Ajouter une ligne ». Un `TypeError` sur une API absente ne se distingue pas d'un défaut du
// sujet, ce qui est le mode d'échec le plus coûteux à lire.
//
// **Une fonction vide, comme `scrollIntoView`** : « rien à faire » est la vérité sous jsdom. Ce que
// le défilement produit vraiment se mesure dans `e2e/`, et l'état interne qui décide des lignes
// montées, lui, reste observable — c'est `aria-rowindex` qui le dit, et ce sont les tests de
// `VirtualGrid` qui le lisent.
if (typeof Element !== 'undefined' && Element.prototype.scrollTo === undefined) {
  Element.prototype.scrollTo = () => {}
}

// `elementFromPoint` n'existe pas sous jsdom, et c'est la même famille que les trois ci-dessus :
// sans mise en page, aucun point n'a d'élément dessous. `BarresDeDefilement` l'appelle à chaque
// trame où le pointeur bouge, pour trouver la zone défilante dont une bande est survolée — donc
// depuis un `requestAnimationFrame`, où un `TypeError` devient une **exception non gérée** que
// Vitest impute au fichier de test qui tournait, quel qu'il soit : la suite entière échouait en
// annonçant 1369 tests verts, ce qui est le mode d'échec le plus difficile à rattacher à sa cause.
//
// **`null` est la bonne réponse ici**, comme le tableau vide de `getClientRects` : « rien sous ce
// point » est exactement la vérité sous jsdom, et le survol se mesure dans `e2e/geometrie-reelle`,
// à la fenêtre réelle (règle n° 9).
if (typeof Document !== 'undefined' && Document.prototype.elementFromPoint === undefined) {
  Document.prototype.elementFromPoint = () => null
}
