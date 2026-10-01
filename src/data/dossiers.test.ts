import { describe, expect, it } from 'vitest'
import brut from '../../src-tauri/tests/fixtures/lecture-seule.json?raw'
import type { FolderTree } from '../domain/config'
import { connexions, estEnLectureSeule, lectureSeuleEffective } from './dossiers'

/**
 * **La fixture partagée avec le cœur** (#168) : `config/arbre.rs` la lit aussi, et les deux
 * implémentations de la lecture seule effective doivent rendre exactement `expected`. Sans elle,
 * l'écran pourrait laisser éditer ce que le cœur refuse d'écrire — ou l'inverse —, et rien ne
 * dirait lequel des deux a tort.
 */
describe('la lecture seule effective (#168)', () => {
  const fixture = JSON.parse(brut) as {
    tree: FolderTree
    expected: Record<string, unknown>
  }

  it('rend exactement ce que la fixture partagée attend, connexion par connexion', () => {
    const attendus = Object.entries(fixture.expected)
    // Contrôle positif : la fixture couvre chaque connexion de son arbre, plus une inconnue — sans
    // quoi une comparaison vide passerait.
    expect(attendus).toHaveLength(connexions(fixture.tree).length + 1)
    for (const [id, attendu] of attendus) {
      expect(lectureSeuleEffective(fixture.tree, id), id).toEqual(attendu)
    }
    const sortes = new Set(attendus.map(([, a]) => (a as { kind?: string } | null)?.kind ?? null))
    expect([...sortes].sort()).toEqual(['imposed', 'local', null].sort())
  })

  it('une lecture seule imposée l’est quel que soit le réglage local', () => {
    expect(estEnLectureSeule(lectureSeuleEffective(fixture.tree, 'prod-reglee-inscriptible'))).toBe(
      true,
    )
    expect(estEnLectureSeule(lectureSeuleEffective(fixture.tree, 'dev-inscriptible'))).toBe(false)
    expect(estEnLectureSeule(lectureSeuleEffective(fixture.tree, 'inconnue'))).toBe(false)
  })
})
