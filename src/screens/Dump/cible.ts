/**
 * Ce que les deux modales de dump **nomment** : le chemin de dossiers et la connexion (#166).
 *
 * Un type à part plutôt que la `DumpRequest` entière : la modale d'import nomme la cible pour
 * empêcher l'erreur de se tromper de base, et lui passer la variante complète — donc l'hôte,
 * l'utilisateur et la référence de secret — l'exposerait à afficher un jour ce qu'on ne veut pas
 * voir dans une capture d'écran.
 */
export type CibleDeDump = {
  /** Les dossiers de la connexion, joints par « › » ; vide pour une connexion rangée à la racine. */
  chemin: string
  /** Le libellé de la connexion, tel que l'arbre le montre. */
  base: string
}
