/**
 * Le défilement au bord, pendant le glissement d'une colonne (`debuterLeReordonnancement`).
 *
 * Le dépôt demande un en-tête **rendu sous le pointeur** (`elementFromPoint`) : sans défilement,
 * une colonne ne se dépose jamais au-delà de celles que la fenêtre montre. Approcher le pointeur
 * d'un bord fait donc défiler la grille sous lui, comme dans tout glisser-déposer qui vise plus
 * loin que l'écran.
 *
 * La géométrie vit ici, pure, et non dans le composant : jsdom ne calcule aucune mise en page
 * (règle n° 9), donc c'est cette fonction que Vitest peut juger au pixel — la boucle qui
 * l'applique est exercée à part, bords bouchonnés.
 */

/** Largeur de la marge sensible, en pixels, en deçà de chaque bord de la fenêtre de défilement. */
export const MARGE_DE_DEFILEMENT = 36

/**
 * Vitesse maximale, en pixels **par trame** et non par seconde : la boucle avance au rythme de
 * `requestAnimationFrame`, et un écran à 120 Hz défile donc deux fois plus vite qu'à 60 — assumé,
 * la vitesse reste dans l'ordre de ce qu'on vise et le pas par trame évite un calcul d'horloge.
 */
export const VITESSE_MAX = 20

/**
 * La vitesse de défilement pour un pointeur en `pointeurX`, en pixels par trame, signée — négative
 * vers la gauche, nulle hors des marges. `bordGauche` et `bordDroit` sont les bords de la fenêtre
 * de défilement, dans les mêmes coordonnées d'écran que le pointeur.
 *
 * **Proportionnelle à l'enfoncement dans la marge**, pas tout ou rien : un pas plein dès l'entrée
 * rendrait indéposables les colonnes proches du bord — les viser ferait déjà défiler à pleine
 * vitesse. Le bord même porte le maximum, et le pointeur peut le dépasser (la poignée capte le
 * pointeur) : au-delà, la vitesse plafonne au lieu de croître.
 */
export function vitesseAuBord(pointeurX: number, bordGauche: number, bordDroit: number): number {
  // Sur une fenêtre plus étroite que deux marges, chacune se replie sur sa moitié : sans ce
  // plancher elles se chevaucheraient, et le milieu de la fenêtre défilerait déjà.
  const marge = Math.min(MARGE_DE_DEFILEMENT, (bordDroit - bordGauche) / 2)
  if (marge <= 0) return 0
  const versLaGauche = bordGauche + marge - pointeurX
  if (versLaGauche > 0) return -bornee(versLaGauche / marge)
  const versLaDroite = pointeurX - (bordDroit - marge)
  if (versLaDroite > 0) return bornee(versLaDroite / marge)
  return 0
}

/**
 * La rampe bornée : jamais sous 1 px par trame dans la marge. Un navigateur qui arrondit
 * `scrollLeft` au pixel entier lirait une position inchangée après une écriture fractionnaire,
 * et la boucle de `defilerAuBord` prendrait ce surplace pour la fin de la course.
 */
function bornee(enfoncement: number): number {
  return Math.min(VITESSE_MAX, Math.max(1, enfoncement * VITESSE_MAX))
}
