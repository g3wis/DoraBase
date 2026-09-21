import { describe, expect, it } from 'vitest'
import type { Project } from '../../domain/config'
import type { Value } from '../../domain/engine'
import {
  libellesDeLaTable,
  libellesDepuisLesLignes,
  lignesDepuisLesLibelles,
  valeurLibellee,
} from './libelles'

/** Un projet minimal qui porte des libellés — seul `valueLabels` compte ici. */
function projet(nom: string, valueLabels: Project['valueLabels']): Project {
  return { name: nom, environments: [], databases: [], queries: [], valueLabels }
}

const ETATS = { '0': 'en attente', '3': 'expédiée' }

describe('libellesDeLaTable', () => {
  it('rend les libellés que le projet déclare pour cette table', () => {
    const projets = [projet('Halle', { orders: { status: ETATS } })]
    expect(libellesDeLaTable(projets, 'Halle', 'orders')).toEqual({ status: ETATS })
  })

  /**
   * **Trois absences, un seul résultat.** Aucune ne doit lever : un projet retiré pendant qu'un
   * onglet est ouvert, une table jamais libellée, et une configuration écrite avant `API-75` — qui
   * n'a pas le champ du tout, `serde` l'omettant à l'écriture (`skip_serializing_if`).
   */
  it('rend une table vide quand rien ne la déclare', () => {
    const projets = [projet('Halle', { orders: { status: ETATS } })]
    expect(libellesDeLaTable(projets, 'Halle', 'users')).toEqual({})
    expect(libellesDeLaTable(projets, 'Ailleurs', 'orders')).toEqual({})
    const sansLeChamp = { ...projet('Halle', {}), valueLabels: undefined }
    expect(libellesDeLaTable([sansLeChamp], 'Halle', 'orders')).toEqual({})
  })

  /**
   * **La même absence rend le même objet**, et ce n'est pas de la coquetterie.
   *
   * `libelles` entre dans les dépendances de l'effet qui remonte la lecture au panneau de ligne :
   * un `{}` neuf à chaque appel le fait repartir, il pose un état, l'écran se rend à nouveau, et la
   * boucle ne s'arrête jamais — **sur toute table qui ne déclare rien**, c'est-à-dire le cas
   * courant. Le défaut a été trouvé en écrivant le test d'assemblage, qui s'est mis à **ne plus
   * finir** ; celui-ci le garde sans dépendre d'un rendu, et il est le seul qui puisse le dire
   * avant qu'un écran ne tourne (le piège de `10d`).
   */
  it('rend la même table vide d’un appel à l’autre', () => {
    const projets = [projet('Halle', {})]
    expect(libellesDeLaTable(projets, 'Halle', 'orders')).toBe(
      libellesDeLaTable(projets, 'Halle', 'users'),
    )
  })

  /**
   * **Le projet désigne, pas la connexion ni l'environnement.** C'est l'arbitrage d'`API-75` : deux
   * projets qui déclarent la même table ne partagent rien, et l'un ne peut pas rendre les libellés
   * de l'autre.
   */
  it('ne franchit pas la frontière d’un projet', () => {
    const projets = [
      projet('Halle', { orders: { status: { '3': 'expédiée' } } }),
      projet('Quai Sud', { orders: { status: { '3': 'partie' } } }),
    ]
    expect(libellesDeLaTable(projets, 'Quai Sud', 'orders')).toEqual({
      status: { '3': 'partie' },
    })
  })
})

describe('valeurLibellee', () => {
  it('ajoute le libellé derrière l’entier, sans le remplacer', () => {
    expect(valeurLibellee({ kind: 'int', value: 3 }, ETATS)).toEqual({
      kind: 'text',
      value: '3 (expédiée)',
    })
  })

  /**
   * **Le texte de l'entier est celui de la grille**, groupement des milliers compris : la clé est
   * le décimal brut, l'affichage passe par `texteDeValeur`. Composer le nombre ici en aurait fait
   * deux vérités, et c'est la moitié qu'on aurait cessé de tenir à jour (règle n° 17).
   */
  it('garde le groupement des milliers de la grille', () => {
    const rendu = valeurLibellee({ kind: 'int', value: 12900 }, { '12900': 'lancement' })
    // L'espace de `formatInteger` est insécable : la comparaison porte sur la forme entière, sans
    // la réécrire à la main.
    expect(rendu.kind === 'text' && rendu.value.endsWith(' (lancement)')).toBe(true)
    expect(rendu.kind === 'text' && rendu.value.replace(/\s/g, '')).toBe('12900(lancement)')
  })

  /** Une valeur sans libellé déclaré reste l'entier qu'elle est — aucune parenthèse vide. */
  it('laisse intacte une valeur qu’aucun libellé ne nomme', () => {
    expect(valeurLibellee({ kind: 'int', value: 7 }, ETATS)).toEqual({ kind: 'int', value: 7 })
  })

  it('laisse tout intact quand la colonne ne déclare rien', () => {
    expect(valeurLibellee({ kind: 'int', value: 3 }, undefined)).toEqual({ kind: 'int', value: 3 })
    expect(valeurLibellee({ kind: 'int', value: 3 }, {})).toEqual({ kind: 'int', value: 3 })
  })

  /**
   * **Seul un `int` se libelle**, et les quatre autres genres le prouvent un par un.
   *
   * Un `decimal` est écarté délibérément : il voyage en texte pour garder sa précision, donc la
   * correspondance dépendrait d'une écriture (`3` contre `3.0`) que rien ne normalise. Un
   * `timestamp` est ce que `valeurRelue` rend d'une colonne lue en horodatage — c'est **par là** que
   * les deux lectures s'excluent, sans règle à retenir.
   */
  it('ne libelle ni décimal, ni flottant, ni texte, ni horodatage, ni nul', () => {
    const libelles = { '3': 'expédiée' }
    const intacts: Value[] = [
      { kind: 'decimal', value: '3' },
      { kind: 'float', value: 3 },
      { kind: 'text', value: '3' },
      { kind: 'timestamp', value: '3' },
      { kind: 'null' },
    ]
    for (const valeur of intacts) {
      expect(valeurLibellee(valeur, libelles)).toEqual(valeur)
    }
  })

  /** Un libellé blanc ne compte pas : `3 ()` serait une parenthèse pour rien. */
  it('ignore un libellé vide ou blanc', () => {
    expect(valeurLibellee({ kind: 'int', value: 3 }, { '3': '   ' })).toEqual({
      kind: 'int',
      value: 3,
    })
  })

  it('libelle un entier négatif, et un zéro', () => {
    expect(valeurLibellee({ kind: 'int', value: -1 }, { '-1': 'inconnu' })).toEqual({
      kind: 'text',
      value: '-1 (inconnu)',
    })
    expect(valeurLibellee({ kind: 'int', value: 0 }, ETATS)).toEqual({
      kind: 'text',
      value: '0 (en attente)',
    })
  })
})

describe('lignesDepuisLesLibelles', () => {
  /**
   * **Le tri est numérique, et il ne peut pas venir du stockage** : les clés d'une `BTreeMap` sont
   * ordonnées lexicographiquement, où `"10"` précède `"2"`. Sans ce tri, l'éditeur rendrait une
   * liste de codes dans un ordre que personne n'attend.
   */
  it('trie par valeur numérique, et non par texte', () => {
    const lignes = lignesDepuisLesLibelles({ '10': 'dix', '2': 'deux', '0': 'zéro' })
    expect(lignes.map((ligne) => ligne.valeur)).toEqual(['0', '2', '10'])
  })

  it('range les négatifs avant les positifs', () => {
    const lignes = lignesDepuisLesLibelles({ '1': 'un', '-5': 'moins cinq' })
    expect(lignes.map((ligne) => ligne.valeur)).toEqual(['-5', '1'])
  })

  /**
   * Une clé qui n'est pas un entier — donc écrite à la main dans le fichier — **passe en fin de
   * liste plutôt que d'être tue** : l'éditeur est le seul endroit d'où la corriger, et une entrée
   * invisible y serait perdue au premier enregistrement.
   */
  it('garde une clé non entière, en fin de liste', () => {
    const lignes = lignesDepuisLesLibelles({ pending: 'en attente', '3': 'expédiée' })
    expect(lignes.map((ligne) => ligne.valeur)).toEqual(['3', 'pending'])
  })

  it('rend une liste vide quand rien n’est déclaré', () => {
    expect(lignesDepuisLesLibelles({})).toEqual([])
  })
})

describe('libellesDepuisLesLignes', () => {
  it('compose la table à envoyer', () => {
    const verdict = libellesDepuisLesLignes([
      { valeur: '0', libelle: 'en attente' },
      { valeur: '3', libelle: 'expédiée' },
    ])
    expect(verdict).toEqual({ ok: true, libelles: ETATS })
  })

  /** Les blancs sont rognés : `" 3 "` et `"3"` désignent la même valeur, et l'un ne correspondrait à rien. */
  it('rogne les blancs de part et d’autre', () => {
    expect(libellesDepuisLesLignes([{ valeur: ' 3 ', libelle: ' expédiée ' }])).toEqual({
      ok: true,
      libelles: { '3': 'expédiée' },
    })
  })

  /**
   * **Une ligne vide est ignorée, jamais refusée** : c'est la ligne qu'on vient d'ajouter et qu'on
   * n'a pas remplie, et c'est aussi la façon de retirer une entrée. Une moitié vide l'est de la
   * même façon — il n'y a rien à afficher pour cette valeur, donc rien à déclarer.
   */
  it('ignore une ligne vide, ou dont une moitié manque', () => {
    expect(
      libellesDepuisLesLignes([
        { valeur: '', libelle: '' },
        { valeur: '3', libelle: 'expédiée' },
        { valeur: '4', libelle: '  ' },
        { valeur: '  ', libelle: 'sans valeur' },
      ]),
    ).toEqual({ ok: true, libelles: { '3': 'expédiée' } })
  })

  /** Tout vider est un verdict valide : c'est ce qui **retire** la déclaration côté cœur. */
  it('rend une table vide quand tout est vide', () => {
    expect(libellesDepuisLesLignes([{ valeur: '', libelle: '' }])).toEqual({
      ok: true,
      libelles: {},
    })
  })

  /**
   * **Une valeur non entière est refusée, en la nommant.** Elle ne correspondrait à aucune cellule :
   * un libellé déclaré qui ne paraît nulle part est la famille du `var()` vers un jeton inexistant,
   * et rien ne le dénoncerait ensuite.
   */
  it('refuse une valeur qui n’est pas un entier, et la nomme', () => {
    for (const valeur of ['pending', '3.5', '3a', '', '-', '+3', '0x3']) {
      const verdict = libellesDepuisLesLignes([{ valeur, libelle: 'un libellé' }])
      if (valeur.trim() === '') {
        expect(verdict).toEqual({ ok: true, libelles: {} })
        continue
      }
      expect(verdict).toEqual({ ok: false, refus: 'valeurNonEntiere', valeur })
    }
  })

  /**
   * **Une valeur en double est refusée, en la nommant.** La destination est une table : la seconde
   * écraserait la première en silence, et l'éditeur rendrait à la réouverture une liste plus courte
   * que celle qu'on avait enregistrée.
   */
  it('refuse une valeur déclarée deux fois, et la nomme', () => {
    expect(
      libellesDepuisLesLignes([
        { valeur: '3', libelle: 'expédiée' },
        { valeur: '3', libelle: 'partie' },
      ]),
    ).toEqual({ ok: false, refus: 'valeurEnDouble', valeur: '3' })
  })

  /** Le double se mesure **après** rognage, sinon `" 3"` passerait à côté de `"3"`. */
  it('voit le double à travers les blancs', () => {
    expect(
      libellesDepuisLesLignes([
        { valeur: '3', libelle: 'expédiée' },
        { valeur: ' 3', libelle: 'partie' },
      ]),
    ).toEqual({ ok: false, refus: 'valeurEnDouble', valeur: '3' })
  })

  /**
   * Une ligne dont le libellé manque **n'entre pas dans le compte des doublons** : elle est ignorée
   * avant, donc vider la seconde moitié d'une paire est bien la façon de retirer sa jumelle.
   */
  it('ne voit pas un double dans une ligne à moitié vide', () => {
    expect(
      libellesDepuisLesLignes([
        { valeur: '3', libelle: 'expédiée' },
        { valeur: '3', libelle: '' },
      ]),
    ).toEqual({ ok: true, libelles: { '3': 'expédiée' } })
  })

  /**
   * **Un nom hérité ne devient pas une valeur.** `{}` en JavaScript répond à `'toString' in objet`
   * par la chaîne de prototypes : sans un objet nu, `toString` serait vu comme un doublon de la
   * première ligne qui le déclare — un refus sur une valeur que personne n'a saisie deux fois. Elle
   * est de toute façon refusée comme non entière ; ce test garde l'ordre des deux règles.
   */
  it('ne confond pas un nom hérité avec une valeur déjà vue', () => {
    expect(libellesDepuisLesLignes([{ valeur: 'toString', libelle: 'x' }])).toEqual({
      ok: false,
      refus: 'valeurNonEntiere',
      valeur: 'toString',
    })
  })
})
