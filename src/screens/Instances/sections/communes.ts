import type { Capability } from '../../../domain/instances'
import type { Demande } from '../GestureDialogs'

/**
 * Ce que les six sections en tableau reçoivent toutes (`API-32`).
 *
 * **Un type partagé plutôt que six listes de props recopiées** : les trois entrées sont les mêmes
 * partout — ce que le filtre retient, ce que ce compte a le droit de faire, et par où un geste
 * remonte —, et une recopie qui en oublierait une donnerait une section dont les boutons ne se
 * désactivent pas.
 */
export type PropsDeSection = {
  filtre: string
  capacites: readonly Capability[] | undefined
  onDemander: (demande: Demande) => void
}

/**
 * Vrai quand une ligne correspond au filtre.
 *
 * **Insensible à la casse et à l'accent**, comme le filtre de l'arbre : chercher « rôle » en tapant
 * « role » est le geste courant, et un filtre qui ne le ferait pas se lirait comme un filtre cassé.
 * Les champs comparés sont ceux que la ligne **affiche** : filtrer sur une valeur invisible rendrait
 * des lignes sans rapport apparent avec ce qu'on a tapé.
 */
export function correspond(filtre: string, ...champs: (string | null | undefined)[]): boolean {
  const cherche = normaliser(filtre)
  if (cherche === '') return true
  return champs.some((champ) => champ != null && normaliser(champ).includes(cherche))
}

function normaliser(texte: string): string {
  return texte
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}
