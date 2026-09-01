import type { CompletionContext } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { type Catalogue, sourceDeCompletion } from './completion'

const CATALOGUE: Catalogue = {
  tables: ['orders', 'users'],
  colonnes: {
    users: [
      { name: 'country', typeName: 'char(2)' },
      { name: 'counter_signup', typeName: 'int4' },
    ],
  },
  schemas: ['public', 'archives'],
  tablesParSchema: {
    // `public` n'a pas d'entrée : c'est le schéma courant, déjà couvert par `tables` — un schéma
    // jamais déplié comme un autre n'en a pas non plus, et `archives` ci-dessous en a une pour le
    // distinguer.
    archives: ['orders_2024', 'orders_2023'],
  },
}

/**
 * Un contexte de complétion minimal.
 *
 * CodeMirror n'expose pas de constructeur de `CompletionContext` : on en fournit la surface qu'emploie
 * `sourceDeCompletion`, ce qui laisse le test porter sur *nos* règles plutôt que sur celles de la
 * bibliothèque — c'est l'e2e qui vérifie l'intégration réelle.
 */
function contexteA(state: EditorState, position: number): CompletionContext {
  const texte = state.doc.toString()
  return {
    state,
    pos: position,
    explicit: false,
    matchBefore: (motif: RegExp) => {
      const ligne = state.doc.lineAt(position)
      const avant = texte.slice(ligne.from, position)
      const trouve = new RegExp(`(?:${motif.source})$`).exec(avant)
      return trouve ? { from: position - trouve[0].length, to: position, text: trouve[0] } : null
    },
  } as unknown as CompletionContext
}

/** Appelle la source de complétion sur un texte, curseur en fin. */
function proposer(texte: string, catalogue = CATALOGUE) {
  const state = EditorState.create({ doc: texte, selection: { anchor: texte.length } })
  return sourceDeCompletion(() => catalogue)(contexteA(state, texte.length))
}

describe('l’autocomplétion (`12d`)', () => {
  it('après un alias résolu, propose les colonnes avec leur type', () => {
    const resultat = proposer('select * from users u where u.cou')
    const labels = resultat?.options.map((o) => o.label)
    expect(labels).toEqual(['country', 'counter_signup'])
    // Le type est **affiché** : c'est ce qui permet de choisir sans aller voir la structure.
    expect(resultat?.options[0]?.detail).toBe('char(2)')
    // Et la provenance, comme le pied de liste du mockup — `users.country`.
    expect(resultat?.options[0]?.info).toBe('users.country')
  })

  it('l’insertion remplace le mot après le point, pas le qualifiant', () => {
    // Le `from` est nécessaire pour que l'alias soit résolu : sans lui, la liste se referme — ce que
    // le test suivant vérifie.
    const texte = 'select u.cou from users u'
    const curseur = 'select u.cou'.length
    const state = EditorState.create({ doc: texte, selection: { anchor: curseur } })
    const resultat = sourceDeCompletion(() => CATALOGUE)(contexteA(state, curseur))
    // Sans cela, compléter `u.cou` donnerait `country` au lieu de `u.country`.
    expect(resultat?.from).toBe(texte.indexOf('.') + 1)
  })

  it('un alias inconnu ne propose AUCUNE colonne', () => {
    // **La garantie centrale de `12d`** : une suggestion fausse produit une requête en erreur que
    // l'utilisateur croira correcte. En cas de doute, la liste ne devine pas — elle se referme.
    expect(proposer('select x.cou')).toBeNull()
  })

  it('une table dont les colonnes ne sont pas chargées ne propose rien', () => {
    // `orders` est dans l'arbre, mais ses colonnes ne sont connues qu'une fois la table ouverte.
    expect(proposer('select * from orders o where o.sta')).toBeNull()
  })

  it('sans qualifiant, propose les tables et les mots-clés', () => {
    const resultat = proposer('select * from ord')
    const labels = resultat?.options.map((o) => o.label) ?? []
    expect(labels).toContain('orders')
    expect(labels).toContain('where')
    // Les tables d'abord : c'est ce qu'on cherche après `from`.
    expect(labels.indexOf('orders')).toBeLessThan(labels.indexOf('where'))
  })

  it('sans qualifiant, une unique table citée propose aussi ses colonnes', () => {
    // `where ema` doit suggérer `country`/`counter_signup` d'`users`, sans taper `users.` : écrire le
    // qualifiant à chaque fois serait pénible sur une requête à une seule table.
    const resultat = proposer('select * from users where cou')
    const labels = resultat?.options.map((o) => o.label) ?? []
    expect(labels).toContain('country')
    expect(labels).toContain('counter_signup')
    // Les colonnes d'abord : c'est ce qu'on cherche après `where`.
    expect(labels.indexOf('country')).toBeLessThan(labels.indexOf('users'))
    expect(resultat?.options.find((o) => o.label === 'country')?.detail).toBe('char(2)')
  })

  it('deux tables citées ne proposent aucune colonne nue', () => {
    // `id` ne dit pas de laquelle des deux tables il vient : rien plutôt qu'un choix arbitraire.
    const resultat = proposer('select * from users join orders on true where cou')
    const labels = resultat?.options.map((o) => o.label) ?? []
    expect(labels).not.toContain('country')
  })

  it('sans qualifiant, propose aussi les autres schémas de la connexion', () => {
    const resultat = proposer('select * from arch')
    const labels = resultat?.options.map((o) => o.label) ?? []
    expect(labels).toContain('archives')
  })

  it('un schéma qualifié propose ses tables', () => {
    const resultat = proposer('select * from archives.ord')
    const labels = resultat?.options.map((o) => o.label) ?? []
    expect(labels).toEqual(['orders_2024', 'orders_2023'])
    // Le pied de la liste dit d'où vient la suggestion, comme pour une colonne qualifiée.
    expect(resultat?.options[0]?.info).toBe('archives.orders_2024')
  })

  it('un schéma connu mais jamais déplié ne propose aucune table', () => {
    // `public` est un schéma connu (il est dans `schemas`), mais `tablesParSchema` n'en dit rien : le
    // même compromis que pour une table jamais ouverte s'applique.
    expect(proposer('select * from public.ord')).toBeNull()
  })

  it('un qualifiant qui n’est ni un alias ni un schéma ne propose rien', () => {
    expect(proposer('select * from xyz.abc')).toBeNull()
  })

  it('n’ouvre pas la liste sur un curseur sans mot commencé', () => {
    // Trente entrées dès le premier clic dans un éditeur vide seraient du bruit.
    expect(proposer('select * from ')).toBeNull()
  })

  it('un catalogue vide se replie sur les mots-clés, toujours sûrs', () => {
    const resultat = proposer('sel', { tables: [], colonnes: {}, schemas: [], tablesParSchema: {} })
    expect(resultat?.options.map((o) => o.label)).toContain('select')
  })
})
