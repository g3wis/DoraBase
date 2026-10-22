import type { ReactNode } from 'react'
import type { Value } from '../../domain/engine'
import { formatInteger } from '../../ui/format'
import type { Saisie } from './modifications'
import styles from './TableView.module.css'

/**
 * Le rendu d'une valeur de cellule, **par genre**.
 *
 * `06a` a délibérément rendu des valeurs typées plutôt que préformatées : « c'est donc l'écran
 * qui formate — lui seul connaît la densité et la locale ». Voici cette décision, isolée du
 * composant pour être testable valeur par valeur.
 */
export function rendreValeur(value: Value): ReactNode {
  // **`NULL` écrit, jamais du vide.** Une cellule vide se confondrait avec la chaîne vide, qui est
  // une valeur parfaitement différente — et la distinction est l'une des rares choses qu'un client de
  // bases doit absolument ne pas brouiller. Le seul genre à demander un élément, pour sa teinte.
  if (value.kind === 'null') return <span className={styles.nul}>NULL</span>
  return surUneLigne(texteDeValeur(value))
}

/**
 * Le texte d'une cellule, **sur une seule ligne quoi qu'il porte**.
 *
 * `white-space: nowrap` replie un saut de ligne en espace, mais WebKit — donc WKWebView, donc
 * l'application — honore U+2028 et U+2029 comme des coupures **forcées** malgré lui. Une cellule
 * qui en portait prenait trois lignes de haut, centrées sur la sienne, et son texte se superposait
 * aux deux lignes voisines. Signalé à l'écran le 22 octobre 2026, sur une colonne `jsonb` :
 * PostgreSQL n'échappe que les caractères de contrôle, pas ces deux-là, et la grille de `A5` reçoit
 * le JSON en `text` (le repli `::text` du moteur) — le repliement du genre `json` ne s'y appliquait
 * donc pas. Mesuré : Chromium ne coupe pas, WebKit coupe sur ces deux-là et sur aucun autre
 * séparateur. Playwright pilotant Chromium, aucune capture ne pouvait le voir.
 *
 * **À l'affichage seulement**, comme le repliement du saut de ligne par la CSS : l'aperçu du survol
 * et le presse-papiers gardent la valeur telle qu'elle est.
 */
function surUneLigne(texte: string): string {
  return texte.replace(/[\u2028\u2029]/g, ' ')
}

/**
 * La même valeur, **en texte**.
 *
 * # Pourquoi elle existe, et pourquoi elle est la source
 *
 * L'aperçu du survol prolongé et « Copier la valeur » (`10f`) ont besoin d'une chaîne, là où la
 * grille a besoin d'un nœud. Deux fonctions parallèles auraient divergé au premier genre ajouté —
 * exactement ce qui a produit une cellule vide en ajoutant `decimal` (voir le garde ci-dessous).
 * `rendreValeur` délègue donc ici pour tout sauf `null`, dont la teinte demande un élément — et n'y
 * retire que les séparateurs de ligne qu'une cellule ne sait pas neutraliser (`surUneLigne`).
 *
 * **C'est le texte affiché, pas la valeur brute.** Copier ce qu'on lit est la promesse la plus simple
 * à tenir et à vérifier : un JSON y est donc replié sur une ligne comme à l'écran, et un binaire y
 * donne sa taille et non ses octets. Le JSON d'origine reste accessible en entier par l'onglet JSON,
 * qui a son propre bouton de copie.
 */
export function texteDeValeur(value: Value): string {
  switch (value.kind) {
    case 'null':
      return 'NULL'
    case 'bool':
      return value.value ? 'true' : 'false'
    case 'int':
      return formatInteger(value.value)
    case 'decimal':
      // **Le texte exact que rend la base**, sans reformatage : `numeric` est un décimal de
      // précision arbitraire, et le regrouper par milliers ou l'arrondir trahirait une valeur
      // que l'utilisateur lit précisément pour sa précision — un montant, un taux.
      return value.value
    case 'float':
      // Pas de groupement ni d'arrondi : un flottant tronqué à l'affichage laisserait croire à
      // une valeur ronde. Le moteur rend déjà la représentation textuelle exacte.
      return String(value.value)
    case 'text':
      return value.value
    case 'timestamp':
      // Tel que le moteur le rend. Un reformatage local remplacerait la valeur stockée par une
      // interprétation — et un fuseau appliqué deux fois est un défaut invisible.
      return value.value
    case 'json':
      // Sur une ligne : la grille a 26 px de haut, et un JSON multiligne casserait la trame.
      // Le panneau de ligne (`10f`) le montre en entier.
      return value.value.replace(/\s+/g, ' ')
    case 'binary':
      // **Jamais le contenu.** Des octets rendus en texte produisent du charabia, parfois long ;
      // la taille est ce qui renseigne.
      return `\\x… ${formatInteger(tailleBase64(value.base64))} o`
    default:
      // **L'exhaustivité, vérifiée par le compilateur.** Sans ce garde, un genre ajouté à `Value`
      // tombait dans un `switch` qui rendait `undefined` — et `undefined` étant un `ReactNode`
      // valide, TypeScript ne disait rien : la cellule s'affichait **vide**. C'est ce qui est
      // arrivé en ajoutant `decimal` le 10 août 2026.
      return refuserLInconnu(value)
  }
}

/**
 * Refuse un genre de valeur non traité, **à la compilation**.
 *
 * Le paramètre est typé `never` : si un `switch` laisse un cas de côté, le type restant n'est plus
 * `never` et la compilation échoue en nommant le genre oublié.
 */
function refuserLInconnu(value: never): never {
  throw new Error(`genre de valeur non traité : ${JSON.stringify(value)}`)
}

/**
 * Un nombre s'aligne à droite, le reste à gauche — comme le mockup, et comme `DataTable`.
 *
 * Un décimal en fait partie : c'est un nombre, même s'il voyage en texte pour garder sa précision.
 */
export function estNumerique(value: Value): boolean {
  return value.kind === 'int' || value.kind === 'float' || value.kind === 'decimal'
}

/**
 * La taille en octets d'une chaîne base64, sans la décoder.
 *
 * La décoder pour en mesurer la longueur allouerait le contenu entier — précisément ce que le
 * rendu évite.
 */
function tailleBase64(base64: string): number {
  const rembourrage = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, (base64.length * 3) / 4 - rembourrage)
}

/**
 * L'aperçu d'une **saisie retenue**, dans la grille.
 *
 * Distinct de `rendreValeur` : une saisie est du texte, pas une `Value` typée — sa conversion
 * appartient au moteur (`11a`). Elle s'affiche donc telle qu'elle a été tapée, sans groupement ni
 * formatage, parce que c'est exactement ce qui sera écrit.
 *
 * `NULL` garde le rendu de `rendreValeur` : la même absence de valeur doit se lire pareil, qu'elle
 * vienne de la base ou d'une saisie.
 */
export function apercuDeLaSaisie(saisie: Saisie): ReactNode {
  if (saisie.kind === 'null') return <span className={styles.nul}>NULL</span>
  // Une saisie collée peut porter les mêmes séparateurs que la base : même cellule, même garde.
  return surUneLigne(saisie.texte)
}

/**
 * La même saisie, **en texte** — le jumeau d'`apercuDeLaSaisie`, comme `texteDeValeur` l'est de
 * `rendreValeur`, et pour la même raison : « Copier la valeur » copie ce qu'on lit, et une cellule
 * qui porte une modification en attente affiche la valeur **saisie**, pas celle de la base.
 */
export function texteDeSaisie(saisie: Saisie): string {
  return saisie.kind === 'null' ? 'NULL' : saisie.texte
}
