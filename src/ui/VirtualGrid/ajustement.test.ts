import { describe, expect, it } from 'vitest'
import { LARGEUR_AJUSTEE_MAX, LARGEUR_AJUSTEE_MIN, largeurAjustee } from './ajustement'

describe('largeurAjustee', () => {
  it('suit la plus longue valeur, pas la première ni la dernière', () => {
    const court = largeurAjustee('c', ['a'])
    const long = largeurAjustee('c', ['a', 'aaaaaaaaaaaaaaaaaaaaaaaaa', 'a'])
    expect(long).toBeGreaterThan(court)
  })

  it('tient compte de l’en-tête quand il est plus long que les valeurs', () => {
    // Une colonne de booléens sous un nom à rallonge : c'est le nom qui décide.
    const parLEntete = largeurAjustee('est_remboursable_par_le_marchand', ['true', 'false'])
    const parLesValeurs = largeurAjustee('ok', ['true', 'false'])
    expect(parLEntete).toBeGreaterThan(parLesValeurs)
  })

  it('ne descend pas sous le plancher, même sans rien à montrer', () => {
    expect(largeurAjustee('', [])).toBe(LARGEUR_AJUSTEE_MIN)
    expect(largeurAjustee('a', ['b'])).toBe(LARGEUR_AJUSTEE_MIN)
  })

  it('ne dépasse pas le plafond, quelle que soit la valeur', () => {
    // Le cas qui motive le plafond : une colonne de texte libre pousserait toutes ses voisines
    // hors de l'écran.
    expect(largeurAjustee('note', ['x'.repeat(4000)])).toBe(LARGEUR_AJUSTEE_MAX)
    expect(largeurAjustee('x'.repeat(4000), [])).toBe(LARGEUR_AJUSTEE_MAX)
  })

  it('réserve la place de la flèche de tri quand on la demande', () => {
    const sans = largeurAjustee('created_at', [])
    const avec = largeurAjustee('created_at', [], { margeDEntete: 15 })
    expect(avec - sans).toBe(15)
  })

  it('réserve la place du bouton de saut dans chaque cellule', () => {
    // `API-55` : une colonne de clé étrangère porte un bouton **dans** ses cellules. Sans cette
    // réserve, l'ajustement rendrait juste la place du texte, et le bouton se peindrait dessus.
    const sans = largeurAjustee('user_id', ['184220000000'])
    const avec = largeurAjustee('user_id', ['184220000000'], { margeDeValeur: 17 })
    expect(avec - sans).toBe(17)
  })

  it('les deux réserves s’ajoutent, chacune de son côté', () => {
    // L'en-tête et les valeurs sont deux candidats à la largeur, et `largeurAjustee` prend le plus
    // grand : une réserve posée du côté qui **ne gagne pas** ne changerait rien, et c'est
    // exactement ce qu'un test à décor court ne verrait pas.
    const valeursLongues = ['184220000000000000']
    expect(
      largeurAjustee('id', valeursLongues, { margeDeValeur: 17 }) -
        largeurAjustee('id', valeursLongues),
    ).toBe(17)
    expect(
      largeurAjustee('est_remboursable_par_le_marchand', [], { margeDEntete: 14 }) -
        largeurAjustee('est_remboursable_par_le_marchand', []),
    ).toBe(14)
  })

  it('une valeur de 19 caractères tient dans sa colonne, marges comprises', () => {
    // `2026-07-31 09:41:02`, la valeur du décor : 19 × 6,9 + 16 = 147,1 → 148.
    const largeur = largeurAjustee('created_at', ['2026-07-31 09:41:02'])
    expect(largeur).toBe(148)
    // Le contrôle qui mord : la largeur du texte seul, sans les deux fois 8 px de `padding`,
    // laisserait la valeur affleurer les bords et l'ellipse s'allumer.
    expect(largeur).toBeGreaterThan(19 * 6.9 + 15)
  })
})
