import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { qualifiantAvant, tablesCitees } from './alias'

/**
 * Ce que l'écran connaît déjà de la base, et qui suffit à l'autocomplétion (`12d`).
 *
 * **Aucune requête n'est envoyée pendant la frappe.** L'arbre de `09d` a les tables du schéma, et
 * `06c` les colonnes d'une table déjà ouverte : interroger le serveur à chaque caractère ajouterait
 * une latence à l'endroit le plus sensible de l'écran.
 *
 * Conséquence honnête : une table créée par un tiers depuis l'ouverture n'est pas proposée, et les
 * colonnes d'une table jamais ouverte non plus. « Rafraîchir » recharge les premières ; les secondes
 * arrivent dès qu'on ouvre la table. C'est un compromis que la latence justifie.
 */
export type Catalogue = {
  /** Les tables du schéma courant. */
  tables: readonly string[]
  /** Les colonnes connues, par nom de table. Une table absente n'a rien à proposer. */
  colonnes: Readonly<Record<string, readonly { name: string; typeName: string }[]>>
  /**
   * Les schémas de la connexion — pas seulement celui qu'affiche l'écran.
   *
   * L'arbre les connaît tous dès l'ouverture de la connexion (`listSchemas`), sans dépliage : c'est
   * ce qui rend `sch.` complétable même si `sch` n'est pas le schéma courant.
   */
  schemas: readonly string[]
  /**
   * Les tables **par schéma**, pour ce qu'un schéma a été déplié dans l'arbre au moins une fois.
   *
   * Un schéma absent d'ici n'a pas été déplié : `sch.` ne propose alors rien, plutôt que de deviner —
   * même compromis que les colonnes d'une table jamais ouverte.
   */
  tablesParSchema: Readonly<Record<string, readonly string[]>>
}

/**
 * Les mots-clés proposés faute de mieux.
 *
 * **Toujours sûrs** : ils existent quelle que soit la base. C'est ce qu'on propose quand un alias
 * n'est pas résolu, plutôt que d'inventer des colonnes.
 */
const MOTS_CLES = [
  'select',
  'from',
  'where',
  'group by',
  'order by',
  'having',
  'limit',
  'join',
  'left join',
  'inner join',
  'on',
  'as',
  'and',
  'or',
  'not',
  'null',
  'is null',
  'is not null',
  'in',
  'like',
  'ilike',
  'between',
  'distinct',
  'count(',
  'sum(',
  'avg(',
  'min(',
  'max(',
  'coalesce(',
  'date_trunc(',
  'now()',
]

/**
 * La source de complétion de la console (`12d`).
 *
 * **Cinq natures, dans cet ordre de priorité** : les colonnes d'un alias résolu, les tables d'un
 * schéma qualifié (`sch.`), les colonnes de l'unique table citée quand elle est seule (`where ema`
 * doit suggérer `email_verified` d'`account`, pas seulement `account.email_verified` — écrire le
 * qualifiant à chaque fois serait pénible sur une requête à une seule table, le cas le plus
 * courant), les tables et les schémas du catalogue, les mots-clés. Un qualifiant résolu (alias ou
 * schéma) écarte tout le reste — après `o.` ou `sch.`, une seule nature a un sens.
 *
 * **Un qualifiant non résolu ne propose rien.** Une suggestion fausse produit une requête en erreur
 * que l'utilisateur croira correcte : en cas de doute, la liste ne devine pas. `o.` où `o` n'est ni
 * un alias connu ni un schéma connu ferme la liste, plutôt que de choisir arbitrairement entre les
 * deux lectures possibles.
 *
 * **Deux tables citées ou plus ne proposent aucune colonne nue.** `select * from orders join
 * order_items on … where id` ne dit pas de laquelle `id` vient : plutôt qu'un choix arbitraire, la
 * même règle que l'alias inconnu s'applique — rien.
 */
export function sourceDeCompletion(catalogue: () => Catalogue) {
  return (contexte: CompletionContext): CompletionResult | null => {
    const mot = contexte.matchBefore(/[\w$.]*/)
    if (!mot) return null
    // Sans frappe explicite, on n'ouvre la liste qu'à partir d'un caractère : proposer trente entrées
    // dès le premier clic dans un éditeur vide serait du bruit.
    if (!contexte.explicit && mot.from === mot.to) return null

    const texte = contexte.state.doc.toString()
    const qualifiant = qualifiantAvant(texte, contexte.pos)
    const { tables, colonnes, schemas, tablesParSchema } = catalogue()

    if (qualifiant !== null) {
      const cleQualifiant = qualifiant.toLowerCase()
      const table = tablesCitees(texte).get(cleQualifiant)
      if (table) {
        const connues = colonnes[table]
        // **Rien plutôt qu'une devinette** : une table dont les colonnes ne sont pas chargées ne
        // donne aucune suggestion. La liste se referme, ce qui est un signal juste.
        if (!connues) return null
        return {
          from: debutDuMot(texte, contexte.pos),
          options: connues.map((colonne) => ({
            label: colonne.name,
            type: 'property',
            // Le type est **affiché**, comme dans le mockup : `country char(2)`. C'est ce qui permet
            // de choisir sans aller voir la structure.
            detail: colonne.typeName,
            // Le pied de la liste dit d'où vient la suggestion — `users.country` dans le mockup.
            info: `${table}.${colonne.name}`,
          })),
        }
      }

      // Pas un alias : peut-être un schéma (`sch.` doit proposer ses tables).
      const schema = schemas.find((nom) => nom.toLowerCase() === cleQualifiant)
      if (!schema) return null
      const tablesDuSchema = tablesParSchema[schema]
      // Un schéma jamais déplié dans l'arbre n'a pas de tables connues : même compromis que pour les
      // colonnes d'une table jamais ouverte.
      if (!tablesDuSchema) return null
      return {
        from: debutDuMot(texte, contexte.pos),
        options: tablesDuSchema.map(
          (nom): Completion => ({
            label: nom,
            type: 'class',
            detail: 'table',
            info: `${schema}.${nom}`,
          }),
        ),
      }
    }

    // L'unique table citée, sans alias à taper — `tablesCitees` indexe aussi par nom de table pour ce
    // cas. Deux tables ou plus laissent `tableUnique` absent : voir la garde-fou ci-dessus.
    const references = [...new Set(tablesCitees(texte).values())]
    const tableUnique = references.length === 1 ? references[0] : undefined
    const colonnesSansQualifiant = tableUnique ? (colonnes[tableUnique] ?? []) : []

    return {
      from: mot.from,
      options: [
        ...colonnesSansQualifiant.map(
          (colonne): Completion => ({
            label: colonne.name,
            type: 'property',
            detail: colonne.typeName,
            info: tableUnique,
          }),
        ),
        ...tables.map(
          (nom): Completion => ({ label: nom, type: 'class', detail: 'table', info: nom }),
        ),
        // Les autres schémas de la connexion : taper leur nom insère de quoi continuer en `sch.table`.
        ...schemas.map(
          (nom): Completion => ({ label: nom, type: 'namespace', detail: 'schéma', info: nom }),
        ),
        ...MOTS_CLES.map((mot): Completion => ({ label: mot, type: 'keyword' })),
      ],
    }
  }
}

/**
 * Le début du mot en cours **après le point**, pour que l'insertion ne duplique pas le qualifiant.
 *
 * Sans cela, compléter `o.cou` insérerait `country` à la place de `o.cou` entier et donnerait
 * `country` au lieu de `o.country`.
 */
function debutDuMot(texte: string, position: number): number {
  const avant = texte.slice(0, position)
  const apresPoint = avant.lastIndexOf('.')
  return apresPoint === -1 ? position : apresPoint + 1
}
