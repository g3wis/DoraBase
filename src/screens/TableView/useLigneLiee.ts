import { useEffect, useState } from 'react'
import type { DatabaseKey } from '../../domain/arbre'
import type { Relation, Value } from '../../domain/engine'
import type { PasserelleDetail } from '../Workbench/useDetailTable'
import { champsLisibles } from './ligneLiee'
import type { PasserelleLignes } from './useLignes'

export type Apercu = {
  /** Les champs détectés et leur valeur, dans l'ordre de la liste blanche du handoff. */
  champs: { name: string; value: string }[]
  /** Le nom de la table cible, pour l'en-tête « Ligne liée · users ». */
  table: string
}

/**
 * L'aperçu de la ligne cible d'une clé étrangère, **sous la règle du handoff**.
 *
 * Deux lectures : le détail de la table cible pour savoir si elle porte un champ lisible, puis
 * une fenêtre filtrée sur la clé si — et seulement si — c'est le cas. Aucune commande nouvelle :
 * `describe_table` (`06c`) et `read_rows` (`10c`) suffisent, et la contrainte IPC tient sans
 * effort puisque la fenêtre est au plus petit palier.
 *
 * **Rien n'est demandé quand la règle refuse.** L'ordre des deux lectures est ce qui le
 * garantit : la seconde ne part qu'après que la première a trouvé un champ lisible. Lire d'abord
 * la ligne « au cas où » ferait traverser l'IPC à des données que l'écran s'est engagé à ne pas
 * montrer.
 */
export function useLigneLiee(
  cle: DatabaseKey | null,
  relation: Relation | undefined,
  valeurDeLaCle: string | null,
  passerelleDetail: PasserelleDetail,
  passerelleLignes: PasserelleLignes,
): Apercu | null {
  const [apercu, setApercu] = useState<Apercu | null>(null)

  const connection = cle?.connection ?? null
  const schemaCible = relation?.targetSchema ?? null
  const tableCible = relation?.targetTable ?? null
  const colonneCible = relation?.targetColumns[0] ?? null

  useEffect(() => {
    if (!connection || !schemaCible || !tableCible || !colonneCible || valeurDeLaCle === null) {
      setApercu(null)
      return
    }
    let vivant = true
    const cleCible: DatabaseKey = { connection }

    async function lire() {
      const detail = await passerelleDetail.describeTable(
        cleCible,
        schemaCible as string,
        tableCible as string,
      )
      const lisibles = champsLisibles(detail.columns)
      // La règle du handoff, appliquée **avant** toute lecture de données : une table cible sans
      // champ lisible n'est jamais interrogée.
      if (lisibles.length === 0) return null

      const fenetre = await passerelleLignes.readRows(cleCible, {
        schema: schemaCible as string,
        table: tableCible as string,
        filters: [{ column: colonneCible as string, operator: 'eq', value: valeurDeLaCle }],
        sort: [],
        offset: 0,
        limit: 'oneHundred',
      })
      const ligne = fenetre.rows[0]
      if (!ligne) return null

      const champs = lisibles
        .map((colonne) => {
          const index = detail.columns.findIndex((c) => c.name === colonne.name)
          const valeur = ligne[index]
          return { name: colonne.name, value: texteDe(valeur) }
        })
        // Un champ lisible mais vide n'apporte rien : « email » suivi de rien se lit comme un
        // défaut d'affichage.
        .filter((champ) => champ.value !== '')

      return champs.length > 0 ? { champs, table: tableCible as string } : null
    }

    lire()
      .then((resultat) => {
        if (vivant) setApercu(resultat)
      })
      // Un aperçu est un supplément : son échec ne doit pas signaler d'erreur, l'utilisateur
      // n'ayant rien demandé de tel. Il n'apparaît simplement pas.
      .catch(() => {
        if (vivant) setApercu(null)
      })

    return () => {
      vivant = false
    }
  }, [
    connection,
    schemaCible,
    tableCible,
    colonneCible,
    valeurDeLaCle,
    passerelleDetail,
    passerelleLignes,
  ])

  return apercu
}

function texteDe(valeur: Value | undefined): string {
  if (!valeur) return ''
  switch (valeur.kind) {
    case 'text':
    case 'timestamp':
    case 'json':
      return valeur.value
    case 'int':
    case 'float':
      return String(valeur.value)
    case 'decimal':
      return valeur.value
    case 'bool':
      return valeur.value ? 'true' : 'false'
    default:
      return ''
  }
}
