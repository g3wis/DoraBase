import { describe, expect, it } from 'vitest'
import { MARGE_DE_DEFILEMENT, VITESSE_MAX, vitesseAuBord } from './defilementAuBord'

// Une fenêtre de 400 px posée à l'origine : les marges vont de 0 à 36 et de 364 à 400.
const GAUCHE = 0
const DROITE = 400

describe('vitesseAuBord', () => {
  it('reste nulle hors des marges, frontières comprises', () => {
    expect(vitesseAuBord(200, GAUCHE, DROITE)).toBe(0)
    // La frontière intérieure appartient au « hors marge » : y poser le pointeur ne défile pas.
    expect(vitesseAuBord(GAUCHE + MARGE_DE_DEFILEMENT, GAUCHE, DROITE)).toBe(0)
    expect(vitesseAuBord(DROITE - MARGE_DE_DEFILEMENT, GAUCHE, DROITE)).toBe(0)
  })

  it('est maximale au bord même, et plafonne au-delà', () => {
    expect(vitesseAuBord(DROITE, GAUCHE, DROITE)).toBe(VITESSE_MAX)
    // La poignée capte le pointeur : il peut sortir de la fenêtre, la vitesse n'augmente plus.
    expect(vitesseAuBord(DROITE + 200, GAUCHE, DROITE)).toBe(VITESSE_MAX)
    expect(vitesseAuBord(GAUCHE, GAUCHE, DROITE)).toBe(-VITESSE_MAX)
    expect(vitesseAuBord(GAUCHE - 200, GAUCHE, DROITE)).toBe(-VITESSE_MAX)
  })

  it('croît avec l’enfoncement dans la marge — proportionnelle, pas tout ou rien', () => {
    // À mi-marge, mi-vitesse : un pas plein dès l'entrée rendrait indéposables les colonnes
    // proches du bord, les viser ferait déjà défiler à pleine vitesse.
    expect(vitesseAuBord(DROITE - MARGE_DE_DEFILEMENT / 2, GAUCHE, DROITE)).toBe(VITESSE_MAX / 2)
    expect(vitesseAuBord(GAUCHE + MARGE_DE_DEFILEMENT / 2, GAUCHE, DROITE)).toBe(-VITESSE_MAX / 2)
    const peuEnfonce = vitesseAuBord(DROITE - MARGE_DE_DEFILEMENT + 10, GAUCHE, DROITE)
    const tresEnfonce = vitesseAuBord(DROITE - 4, GAUCHE, DROITE)
    expect(tresEnfonce).toBeGreaterThan(peuEnfonce)
  })

  it('ne descend jamais sous 1 px par trame dans la marge', () => {
    // Un navigateur qui arrondit `scrollLeft` au pixel entier lirait une position inchangée
    // après une écriture fractionnaire, et la boucle prendrait ce surplace pour la fin de course.
    expect(vitesseAuBord(DROITE - MARGE_DE_DEFILEMENT + 0.5, GAUCHE, DROITE)).toBe(1)
    expect(vitesseAuBord(GAUCHE + MARGE_DE_DEFILEMENT - 0.5, GAUCHE, DROITE)).toBe(-1)
  })

  it('sur une fenêtre plus étroite que deux marges, le milieu ne défile pas', () => {
    // 40 px de large : chaque marge se replie sur 20 px au lieu de se chevaucher.
    expect(vitesseAuBord(20, 0, 40)).toBe(0)
    expect(vitesseAuBord(10, 0, 40)).toBe(-VITESSE_MAX / 2)
    expect(vitesseAuBord(30, 0, 40)).toBe(VITESSE_MAX / 2)
    // Et une fenêtre sans largeur ne défile nulle part.
    expect(vitesseAuBord(10, 10, 10)).toBe(0)
  })
})
