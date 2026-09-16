/**
 * L'ajustement d'une colonne à son contenu — « auto fit », et son plafond.
 *
 * # Pourquoi c'est un calcul et non une mesure
 *
 * Mesurer le rendu donnerait la largeur exacte, et coûterait un `getBoundingClientRect` par cellule
 * après un premier rendu à la mauvaise taille — donc un saut visible à chaque lecture. Surtout, la
 * mesure est **hors de portée de Vitest** : jsdom ne calcule aucune mise en page (règle n° 9), et
 * l'ajustement ne serait vérifiable nulle part.
 *
 * Le calcul, lui, est exact là où il compte : **les cellules sont en JetBrains Mono**, dont chaque
 * glyphe fait la même largeur. Un compte de caractères suffit donc à décider de la largeur d'une
 * colonne de données, au pixel près. C'est l'en-tête, en Nunito, qui est estimé — et c'est le moins
 * grave, un nom de colonne étant court et coupé par une ellipse plutôt que par un débordement.
 *
 * Les deux avances ont été **mesurées dans le navigateur**, pas déduites d'une table de police :
 * 6,9014 px pour le mono à `--text-dense`, et de 5,98 à 6,30 px pour un identifiant en Nunito à
 * `--text-label` — d'où le 7 retenu, qui laisse de quoi absorber une majuscule sans élargir toutes
 * les colonnes pour le cas rare. Un test de bout en bout vérifie qu'aucune cellule visible n'est
 * tronquée : c'est lui qui juge ces constantes, pas leur provenance.
 */

/**
 * L'avance d'un caractère de cellule — JetBrains Mono à `--text-dense`, mesurée.
 *
 * **Exportée depuis le 3 septembre 2026** : le diagramme de schéma dimensionne ses boîtes par le
 * même calcul et à la même taille de texte, et une seconde copie de la mesure aurait vieilli à
 * part. C'est la leçon de `programme::repertoire_personnel` transposée — une mesure n'a qu'une
 * valeur, elle doit n'avoir qu'un lieu.
 */
export const AVANCE_MONO = 6.9
/** Celle d'un caractère d'en-tête — Nunito 700 à `--text-label`, arrondie vers le haut. */
export const AVANCE_ENTETE = 7
/** Les deux fois 8 px de `padding` d'une cellule. */
const MARGE_CELLULE = 16

/** Le plancher : en dessous, une colonne n'est plus une colonne. */
export const LARGEUR_AJUSTEE_MIN = 60
/**
 * Le plafond — « unless size would be too large ».
 *
 * **Une colonne large n'est pas une colonne lisible.** Au-delà, une seule valeur de texte libre
 * pousserait toutes ses voisines hors de l'écran, et c'est l'inverse de ce qu'on demande à un
 * ajustement. Ce qui dépasse est coupé par l'ellipse, comme aujourd'hui, et la poignée de
 * redimensionnement reste là pour l'ouvrir à la demande.
 */
export const LARGEUR_AJUSTEE_MAX = 320

export type OptionsDAjustement = {
  min?: number
  max?: number
  /**
   * Les pixels réservés dans l'en-tête au-delà de son texte : la flèche de tri de `A5` et son
   * écart, qui paraissent **quand la colonne est triée**. Les réserver toujours évite qu'un clic
   * de tri ne tronque le nom de la colonne qu'on vient de trier.
   */
  margeDEntete?: number
  /**
   * Les pixels réservés dans **chaque cellule** au-delà de son texte : le bouton de saut d'une
   * colonne de clé étrangère (`API-55`), qui vit à droite de la valeur.
   *
   * Réservés toujours, comme la flèche de tri l'est dans l'en-tête, et pour la même raison prise
   * par l'autre bout : le bouton ne paraît qu'au survol, donc une place prise à ce moment-là
   * déplacerait la valeur sous le pointeur qui vient de s'y poser.
   */
  margeDeValeur?: number
}

/**
 * La largeur qui fait tenir l'en-tête et chacune des valeurs données, bornée aux deux extrémités.
 *
 * `valeurs` est un **échantillon** : l'appelant décide combien de lignes il mesure. Les mesurer
 * toutes coûterait un parcours de la fenêtre entière à chaque lecture, pour une différence que
 * seule une valeur exceptionnellement longue, tout en bas, produirait.
 */
export function largeurAjustee(
  entete: string,
  valeurs: readonly string[],
  options: OptionsDAjustement = {},
): number {
  const min = options.min ?? LARGEUR_AJUSTEE_MIN
  const max = options.max ?? LARGEUR_AJUSTEE_MAX
  let caracteres = 0
  for (const valeur of valeurs) {
    if (valeur.length > caracteres) caracteres = valeur.length
  }
  const largeurDesValeurs = caracteres * AVANCE_MONO + MARGE_CELLULE + (options.margeDeValeur ?? 0)
  const largeurDeLEntete =
    entete.length * AVANCE_ENTETE + MARGE_CELLULE + (options.margeDEntete ?? 0)
  return Math.min(max, Math.max(min, Math.ceil(Math.max(largeurDesValeurs, largeurDeLEntete))))
}
