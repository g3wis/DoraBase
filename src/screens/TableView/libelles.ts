import type { Project } from '../../domain/config'
import type { Value } from '../../domain/engine'
import { texteDeValeur } from './cellule'

/**
 * Lire une colonne d'entiers comme un **code** dont on connaît le sens (`API-75`) — en fonctions
 * **pures**, comme `horodatage.ts`, `tri.ts` et `ajustement.ts`.
 *
 * # Ce que la déclaration fait, et ce qu'elle ne touche pas
 *
 * `3` devient `3 (expédiée)`. **L'entier reste devant** : c'est ce que la demande d'`API-75` décrit,
 * et c'est ce qui distingue cette lecture d'une réécriture — la valeur stockée est le nombre, et la
 * grille continue de le montrer. Le libellé est ce qu'on ajoute, jamais ce qu'on substitue.
 *
 * **L'affichage seul**, exactement comme la lecture en horodatage : la cellule qu'on édite montre
 * l'entier, `row_as_insert` compose l'entier, l'onglet JSON du panneau de ligne porte l'entier — ce
 * document-là se réécrit. Un libellé parti sur un de ces chemins arriverait en texte dans une
 * colonne numérique.
 *
 * **Le filtre et le tri restent numériques.** `categorieLue` ne détourne rien ici, contrairement à
 * la lecture en horodatage qui donne « avant le » à une colonne de nombres : on tape `3`, et la
 * comparaison part au serveur telle quelle. Filtrer par libellé est hors du périmètre d'`API-75`.
 *
 * # Pourquoi l'utilisateur le déclare, et le moteur ne le devine pas
 *
 * C'est la raison d'`horodatage.ts` à la lettre : un `int4` qui porte un code d'état et un `int4`
 * qui compte des articles sont **le même type déclaré**. Le moteur dit franchement un nombre, et
 * rien dans le catalogue ne dit ce que `3` veut dire. Deviner reviendrait à contredire le catalogue
 * au jugé, dans l'outil dont le métier est de montrer ce qui est stocké.
 *
 * L'écart avec l'horodatage est que la déclaration, ici, est **persistée** : elle vit dans le
 * projet, et pas dans l'état de l'écran. Ce qu'un code veut dire ne change pas d'une session à
 * l'autre, ni d'un environnement à l'autre — voir `Project::value_labels` pour la raison de la
 * poser sur le projet.
 */

/** Ce que les valeurs d'**une** colonne veulent dire : la valeur en texte, vers son libellé. */
export type LibellesDeColonne = Readonly<Record<string, string>>

/** Les colonnes libellées d'**une** table. */
export type LibellesDeTable = Readonly<Record<string, LibellesDeColonne>>

/** Une ligne de l'éditeur : ce qui se saisit, avant toute validation. */
export type LigneDeLibelle = { valeur: string; libelle: string }

/** Ce qu'un entier accepté s'écrit : un signe, des chiffres, et rien d'autre. */
const ENTIER = /^-?\d+$/

/**
 * L'absence de déclaration, **en un seul exemplaire**.
 *
 * Ce n'est pas de la coquetterie : `?? {}` rendrait un objet **neuf à chaque appel**, donc une
 * identité neuve à chaque rendu de l'écran. Or `libelles` entre dans les dépendances de l'effet qui
 * remonte la lecture au panneau de ligne : un objet neuf le fait repartir, il pose un état, l'écran
 * se rend à nouveau, et la boucle ne s'arrête jamais — sur **toute** table qui ne déclare rien,
 * c'est-à-dire le cas courant. C'est le piège de `10d`, désarmé à la source plutôt que confié à la
 * discipline des appelants, et `AUCUN` est ce qui le désarme.
 */
export const AUCUN_LIBELLE: LibellesDeTable = Object.freeze({})

/**
 * Les libellés que ce projet déclare pour cette table — `{}` quand il n'en déclare aucun.
 *
 * **Un seul endroit résout la question**, et c'est celui-ci : la vue de table reçoit des libellés
 * déjà résolus, elle ne fouille pas la liste des projets. La question « que veulent dire les
 * entiers de cette table ? » n'a qu'une réponse, donc elle doit n'avoir qu'un lieu — c'est le
 * motif du `HOME` lu à quatre endroits et de la hauteur disponible d'une grille.
 *
 * **Le nom de la table, sans son schéma.** C'est l'arbitrage assumé d'`API-75` : deux tables
 * homonymes dans deux schémas partagent leurs libellés. Le nom du schéma ne veut pas la même chose
 * d'un moteur à l'autre — les schémas d'une base chez PostgreSQL, les bases du serveur chez MySQL
 * et MongoDB —, et un code d'état est une propriété du modèle de données, pas de l'endroit où la
 * table est rangée.
 */
export function libellesDeLaTable(
  projects: readonly Project[],
  projet: string,
  table: string,
): LibellesDeTable {
  const declaration = projects.find((candidat) => candidat.name === projet)
  return declaration?.valueLabels?.[table] ?? AUCUN_LIBELLE
}

/**
 * La valeur telle que la colonne se **lit** : un entier connu gagne son libellé, tout le reste passe
 * intact.
 *
 * **Rendre une `Value` plutôt qu'une chaîne**, comme `valeurRelue` : `texteDeValeur` la met en
 * texte, `rendreValeur` en nœud, et l'ajustement de largeur mesure `3 (expédiée)` et non `3` — sans
 * quoi la colonne couperait le libellé à l'ellipse dès le premier affichage.
 *
 * **Le texte de l'entier vient de `texteDeValeur`**, jamais d'un second formatage : la grille
 * groupe les milliers, donc `12900` s'y lit `12 900`, et composer le nombre ici en aurait fait deux
 * vérités dont l'une aurait cessé de suivre l'autre (règle n° 17). La **clé**, elle, est le décimal
 * brut : c'est ce que l'éditeur écrit, et une clé groupée ne correspondrait à rien.
 *
 * **Ce qui n'est pas libellé, et délibérément** : un `float`, un `decimal` — qui voyage en texte
 * pour garder sa précision — et un `null`. Un code d'état est un entier ; étendre la lecture à un
 * décimal ferait dépendre la correspondance d'une écriture (`3` contre `3.0`) que rien ne
 * normalise. Un libellé **vide** ne compte pas non plus : `3 ()` serait une parenthèse pour rien.
 */
export function valeurLibellee(value: Value, libelles: LibellesDeColonne | undefined): Value {
  if (libelles === undefined || value.kind !== 'int') return value
  const libelle = libelles[String(value.value)]
  if (libelle === undefined || libelle.trim() === '') return value
  return { kind: 'text', value: `${texteDeValeur(value)} (${libelle.trim()})` }
}

/**
 * Les libellés en lignes d'éditeur, **triés par valeur numérique**.
 *
 * Le tri est celui qu'on attend d'une liste de codes — 0, 1, 2, 10 —, et il ne peut pas venir du
 * stockage : les clés d'une `BTreeMap` sont ordonnées **lexicographiquement**, où `"10"` précède
 * `"2"`. Une clé qui n'est pas un entier — donc écrite à la main dans le fichier — passe en fin de
 * liste plutôt que d'être tue : l'éditeur est le seul endroit d'où la corriger.
 */
export function lignesDepuisLesLibelles(libelles: LibellesDeColonne): LigneDeLibelle[] {
  return Object.entries(libelles)
    .map(([valeur, libelle]) => ({ valeur, libelle }))
    .sort((a, b) => {
      const ga = ENTIER.test(a.valeur)
      const gb = ENTIER.test(b.valeur)
      if (ga && gb) return Number(a.valeur) - Number(b.valeur)
      if (ga !== gb) return ga ? -1 : 1
      return a.valeur.localeCompare(b.valeur)
    })
}

/** Ce que la validation de l'éditeur rend : la table à envoyer, ou ce qui l'empêche. */
export type Verdict =
  | { ok: true; libelles: Record<string, string> }
  | { ok: false; refus: 'valeurNonEntiere' | 'valeurEnDouble'; valeur: string }

/**
 * Les lignes de l'éditeur en table à envoyer, ou le refus qui l'empêche.
 *
 * Trois règles, et chacune évite une déclaration qui ne dirait rien :
 *
 * - **une ligne entièrement vide est ignorée**, jamais refusée : c'est la ligne qu'on vient
 *   d'ajouter et qu'on n'a pas remplie, et c'est aussi la façon de retirer une entrée — la vider.
 *   La refuser demanderait de la supprimer avant d'enregistrer, pour rien ;
 * - **une valeur qui n'est pas un entier est refusée, en la nommant.** Elle ne correspondrait
 *   jamais à aucune cellule : un libellé déclaré qui ne paraît nulle part est la famille du `var()`
 *   vers un jeton inexistant, et rien ne le dénoncerait. C'est aussi pourquoi le stockage, lui,
 *   *tolère* une telle clé sans la refuser — un refus à la lecture coûterait la mise en quarantaine
 *   de toute la configuration (voir `Project::value_labels`) ;
 * - **une valeur en double est refusée, en la nommant.** La table de destination est une `Map` :
 *   la seconde écraserait la première **en silence**, et l'éditeur rendrait à la réouverture une
 *   liste plus courte que celle qu'on avait enregistrée.
 *
 * Une ligne dont la valeur est renseignée mais **pas** le libellé est ignorée de la même façon
 * qu'une ligne vide : il n'y a rien à afficher pour cette valeur, donc rien à déclarer.
 */
export function libellesDepuisLesLignes(lignes: readonly LigneDeLibelle[]): Verdict {
  const libelles: Record<string, string> = {}
  for (const ligne of lignes) {
    const valeur = ligne.valeur.trim()
    const libelle = ligne.libelle.trim()
    if (valeur === '' || libelle === '') continue
    if (!ENTIER.test(valeur)) return { ok: false, refus: 'valeurNonEntiere', valeur }
    // **L'ordre des deux refus n'est pas indifférent.** `in` traverse la chaîne de prototypes, donc
    // `'toString' in {}` répond vrai : si le double se mesurait d'abord, une valeur nommée
    // `toString` serait refusée comme un doublon que personne n'a saisi. Refuser d'abord ce qui
    // n'est pas un entier fait qu'aucun nom hérité n'atteint jamais cette ligne.
    if (valeur in libelles) return { ok: false, refus: 'valeurEnDouble', valeur }
    libelles[valeur] = libelle
  }
  return { ok: true, libelles }
}
