import { describe, expect, it, vi } from 'vitest'
import type { ExportFormat, Value } from '../../domain/engine'
import {
  exporterLeResultat,
  NOM_PAR_DEFAUT,
  nomDeFichier,
  type PasserelleExport,
} from './exportResultat'

const LIBELLES = { titre: 'Exporter le résultat', nomDuFiltre: 'Valeurs séparées par des virgules' }

const COLONNES = ['id', 'statut']
const LIGNES: readonly (readonly Value[])[] = [
  [
    { kind: 'int', value: 7 },
    { kind: 'text', value: 'paid' },
  ],
]

/** Un pont qui accepte la destination qu'on lui donne et compte ce qu'il a reçu. */
function passerelle(destination: string | null = '/tmp/resultat.csv') {
  const choisirDestination = vi.fn(async () => destination)
  const exportResult = vi.fn(async () => 42)
  return {
    pont: { choisirDestination, exportResult } as PasserelleExport,
    choisirDestination,
    exportResult,
  }
}

describe('nomDeFichier', () => {
  it('propose le libellé de la console et l’extension du format', () => {
    expect(nomDeFichier('console 2', 'csv')).toBe('console-2.csv')
    expect(nomDeFichier('ventes', 'json')).toBe('ventes.json')
  })

  /**
   * `defaultPath` est un **chemin** : une barre oblique y désignerait un répertoire, et le sélecteur
   * s'ouvrirait ailleurs — ou pas du tout.
   */
  it('assainit ce qui ferait un chemin plutôt qu’un nom', () => {
    expect(nomDeFichier('ventes / 2026', 'csv')).toBe('ventes-2026.csv')
    expect(nomDeFichier('../../etc/passwd', 'csv')).toBe('etc-passwd.csv')
  })

  /** Un tiret par accent ferait « donn-es » d'un onglet nommé « données ». */
  it('retire les diacritiques plutôt que de les remplacer par un tiret', () => {
    expect(nomDeFichier('données brutes', 'csv')).toBe('donnees-brutes.csv')
  })

  it('retombe sur un nom par défaut quand il ne reste rien', () => {
    expect(nomDeFichier('///', 'json')).toBe(`${NOM_PAR_DEFAUT}.json`)
    expect(nomDeFichier('', 'csv')).toBe(`${NOM_PAR_DEFAUT}.csv`)
  })

  /**
   * **Aucun horodatage**, donc deux exports du même onglet proposent le même nom : c'est le
   * sélecteur natif qui prévient d'un écrasement, et un nom imprévisible ne se testerait qu'en le
   * recalculant (règle n° 3).
   */
  it('est stable d’un appel à l’autre', () => {
    expect(nomDeFichier('console 1', 'csv')).toBe(nomDeFichier('console 1', 'csv'))
  })
})

describe('exporterLeResultat', () => {
  it('demande la destination, puis écrit ce qu’on lui a donné', async () => {
    const { pont, choisirDestination, exportResult } = passerelle()

    const octets = await exporterLeResultat(pont, 'console 2', LIBELLES, 'csv', COLONNES, LIGNES)

    expect(octets).toBe(42)
    expect(choisirDestination).toHaveBeenCalledWith('console-2.csv', LIBELLES)
    expect(exportResult).toHaveBeenCalledWith('/tmp/resultat.csv', 'csv', COLONNES, LIGNES)
  })

  /**
   * **Renoncer n'est pas échouer**, et c'est ce que `null` porte : un « export réussi » sur un
   * fichier qui n'existe pas serait un mensonge, une erreur sur un geste qu'on vient d'annuler
   * ferait chercher ce qui a cassé.
   */
  it('n’écrit rien quand le sélecteur est refermé sans choisir', async () => {
    const { pont, exportResult } = passerelle(null)

    await expect(
      exporterLeResultat(pont, 'console 2', LIBELLES, 'csv', COLONNES, LIGNES),
    ).resolves.toBeNull()
    expect(exportResult).not.toHaveBeenCalled()
  })

  /** L'échec remonte : c'est l'écran qui l'affiche, à côté du bouton. */
  it('laisse remonter un refus d’écriture', async () => {
    const pont: PasserelleExport = {
      choisirDestination: async () => '/interdit/resultat.csv',
      exportResult: async () => {
        throw 'le fichier « /interdit/resultat.csv » n’a pas pu être écrit'
      },
    }

    await expect(
      exporterLeResultat(pont, 'console 2', LIBELLES, 'csv', COLONNES, LIGNES),
    ).rejects.toContain('/interdit/resultat.csv')
  })

  /** Le format voyage jusqu'à la commande **et** jusqu'au nom proposé. */
  it.each<ExportFormat>(['csv', 'json'])('porte le format %s de bout en bout', async (format) => {
    const { pont, choisirDestination, exportResult } = passerelle('/tmp/x')

    await exporterLeResultat(pont, 'ventes', LIBELLES, format, COLONNES, LIGNES)

    expect(choisirDestination).toHaveBeenCalledWith(`ventes.${format}`, LIBELLES)
    expect(exportResult).toHaveBeenCalledWith('/tmp/x', format, COLONNES, LIGNES)
  })
})
