/**
 * La résolution des alias de tables dans une requête (`12d`), en fonctions **pures**.
 *
 * **Par lecture, pas par analyse syntaxique.** Reconnaître `from orders o` puis proposer les colonnes
 * d'`orders` après `o.` demande de trouver la table associée à l'alias. Un analyseur SQL complet est
 * hors de proportion pour cela ; une lecture des clauses `from` et `join` couvre ce que le mockup
 * montre et l'écrasante majorité des requêtes qu'on écrit à la main.
 *
 * **Les limites sont nommées** : sous-requêtes corrélées, CTE, et alias définis après le point
 * d'usage ne sont pas résolus. Dans ces cas la liste ne devine rien — voir `12d` : une suggestion
 * fausse produit une requête en erreur que l'utilisateur croira correcte.
 */

/** Les mots que SQL réserve, et qui ne peuvent donc pas être des alias. */
const MOTS_RESERVES = new Set([
  'from',
  'where',
  'group',
  'order',
  'having',
  'limit',
  'offset',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'outer',
  'cross',
  'on',
  'using',
  'union',
  'except',
  'intersect',
  'window',
  'fetch',
  'for',
  'returning',
  'set',
  'select',
  'as',
])

/**
 * `from` et `join` introduisent tous deux une table. `as` est optionnel en SQL, et le mockup l'omet
 * (`from orders o`).
 *
 * **Le groupe d'alias exclut les mots réservés par anticipation** (`(?!…)`), et pas seulement après
 * coup : sans cette garde, `from orders join users …` captalait `join` comme alias potentiel d'`orders`
 * — rejeté ensuite par `MOTS_RESERVES`, mais la portion « join » du texte était déjà consommée par ce
 * premier match. Le `matchAll` suivant reprenait donc après elle, et ne voyait plus jamais
 * `join users` : un deuxième `join` sans alias explicite disparaissait de la requête entière.
 */
const MOTIF_TABLE = new RegExp(
  `\\b(?:from|join)\\s+([a-z_][\\w$]*(?:\\.[a-z_][\\w$]*)?)\\s*(?:as\\s+)?(?!(?:${[...MOTS_RESERVES].join('|')})\\b)([a-z_][\\w$]*)?`,
  'gi',
)

/**
 * Les tables citées dans la requête, indexées par **alias et par nom**.
 *
 * Par nom aussi : `from orders` sans alias permet `orders.status`, ce qui est courant sur une requête
 * à une seule table.
 */
export function tablesCitees(sql: string): Map<string, string> {
  const par = new Map<string, string>()
  const nu = sansCommentaires(sql)

  for (const trouve of nu.matchAll(MOTIF_TABLE)) {
    const [, qualifie, alias] = trouve
    if (!qualifie) continue
    // Le nom peut être qualifié (`public.orders`) : l'autocomplétion travaille sur le nom court, que
    // l'arbre connaît.
    const nom = qualifie.split('.').pop() as string
    par.set(nom.toLowerCase(), nom)
    if (alias) par.set(alias.toLowerCase(), nom)
  }
  return par
}

/**
 * Le préfixe qualifiant à l'endroit du curseur — `o` dans `o.cou`, ou `null`.
 *
 * C'est ce qui décide si l'on propose des colonnes ou des tables. Sans point, aucune qualification :
 * la liste propose ce qui est sûr.
 */
export function qualifiantAvant(texte: string, position: number): string | null {
  const avant = texte.slice(0, position)
  const trouve = /([a-z_][\w$]*)\.\s*([\w$]*)$/i.exec(avant)
  return trouve?.[1] ?? null
}

/** Le SQL sans ses commentaires. Pour l'analyse seulement — l'exécution garde le texte entier. */
function sansCommentaires(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}
