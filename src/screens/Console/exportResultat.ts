import { save } from '@tauri-apps/plugin-dialog'
import { exportResult } from '../../data/commandes'
import type { ExportFormat, Value } from '../../domain/engine'

/**
 * L'export d'un résultat de console dans un fichier (`API-29`).
 *
 * **Deux appels, un seul geste** : le sélecteur de destination natif, puis la commande qui écrit.
 * Ni l'un ni l'autre ne répond hors de la webview de Tauri — le plugin `dialog` pas plus qu'`invoke`
 * —, donc le pont est **injecté**, comme celui du dump (`08d`) et pour la même raison : un test qui
 * les appellerait vraiment échouerait, et un test qui les simulerait ne vérifierait que le simulacre.
 * Ce qui se teste ici est l'enchaînement.
 */
export type PasserelleExport = {
  /**
   * Le sélecteur de **destination** natif. Rend `null` si l'utilisateur renonce.
   *
   * `dialog:allow-save`, la permission accordée par `22b` pour le dump — aucune capacité nouvelle
   * n'a été nécessaire, et `tests/permissions.rs` garde la liste.
   */
  choisirDestination: (
    nomParDefaut: string,
    libelles: LibellesDuSelecteur,
  ) => Promise<string | null>
  /** Écrit le fichier et rend le nombre d'octets. */
  exportResult: (
    file: string,
    format: ExportFormat,
    columns: readonly string[],
    rows: readonly (readonly Value[])[],
  ) => Promise<number>
}

/**
 * Ce que le sélecteur natif affiche, **pris au dictionnaire**.
 *
 * La langue est une préférence de l'utilisateur (`langueAppliquee`), donc un titre écrit en dur
 * serait en français dans une interface en anglais. `dumpCommands.choisirDestination` le fait
 * pourtant, en dur : c'est un écart antérieur, laissé en place plutôt que corrigé au passage d'un
 * autre chantier.
 */
export type LibellesDuSelecteur = {
  titre: string
  /** Le nom du type de fichier dans le filtre — « Fichier CSV ». */
  nomDuFiltre: string
}

export const PASSERELLE_EXPORT: PasserelleExport = {
  choisirDestination: async (nomParDefaut, libelles) => {
    const choisi = await save({
      title: libelles.titre,
      defaultPath: nomParDefaut,
      filters: [{ name: libelles.nomDuFiltre, extensions: [extensionDe(nomParDefaut)] }],
    })
    return typeof choisi === 'string' ? choisi : null
  },
  exportResult,
}

/** L'extension d'un nom de fichier, pour le filtre du sélecteur. */
function extensionDe(nom: string): string {
  const point = nom.lastIndexOf('.')
  return point === -1 ? '' : nom.slice(point + 1)
}

/** Le nom proposé quand la console n'en fournit aucun — un onglet volatile, la galerie. */
export const NOM_PAR_DEFAUT = 'resultat'

/**
 * Le nom de fichier proposé au sélecteur.
 *
 * **Assaini, et c'est nécessaire** : `defaultPath` est un *chemin*, donc une console nommée
 * « ventes / 2026 » y désignerait un répertoire `ventes ` qui n'existe pas, et le sélecteur
 * s'ouvrirait ailleurs — ou pas du tout. Tout ce qui n'est ni lettre, ni chiffre, ni `-`, ni `_`
 * devient un tiret, les tirets se fondent, et un nom qui n'en laisse rien retombe sur le défaut.
 *
 * **Aucun horodatage.** Il rendrait le nom imprévisible, donc intestable autrement qu'en le
 * recalculant dans le test (règle n° 3), et le sélecteur natif se charge déjà de prévenir d'un
 * écrasement.
 */
export function nomDeFichier(base: string, format: ExportFormat): string {
  const assaini = base
    .normalize('NFD')
    // Les diacritiques : `é` devient `e` plutôt qu'un tiret, sans quoi « données » donnerait
    // « donn-es ».
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${assaini === '' ? NOM_PAR_DEFAUT : assaini}.${EXTENSIONS[format]}`
}

/**
 * L'extension de chaque format.
 *
 * **Écrite, et non déduite de la valeur du format** — les deux coïncident aujourd'hui, et s'en
 * remettre à cette coïncidence ferait nommer `.jsonl` un fichier `.json` le jour où un format
 * s'appellerait autrement que son extension. Le Rust a la sienne (`ExportFormat::extension`), pour
 * le fichier qu'il suppose ; celle-ci nomme le fichier qu'on propose.
 */
const EXTENSIONS: Record<ExportFormat, string> = { csv: 'csv', json: 'json' }

/**
 * Ce qu'un export a produit : le nombre d'octets écrits, ou `null` si l'utilisateur a renoncé.
 *
 * **`null` n'est pas un échec, et la distinction compte** : refermer le sélecteur sans choisir ne
 * doit annoncer ni réussite ni erreur. Un « export réussi » sur un fichier qui n'existe pas serait
 * un mensonge ; une erreur sur un geste qu'on vient d'annuler ferait chercher ce qui a cassé.
 */
export type IssueDExport = number | null

/**
 * Demande la destination, puis écrit. Les échecs **remontent** — l'appelant les affiche.
 *
 * `colonnes` est la projection **affichée** : les colonnes visibles, dans l'ordre de la grille. Elle
 * est décidée par `ConsoleView`, qui tient déjà les masquées et l'ordre, et qui réécrit la requête
 * avec eux.
 */
export async function exporterLeResultat(
  passerelle: PasserelleExport,
  nomDeBase: string,
  libelles: LibellesDuSelecteur,
  format: ExportFormat,
  colonnes: readonly string[],
  lignes: readonly (readonly Value[])[],
): Promise<IssueDExport> {
  const destination = await passerelle.choisirDestination(nomDeFichier(nomDeBase, format), libelles)
  if (destination === null) return null
  return passerelle.exportResult(destination, format, colonnes, lignes)
}
