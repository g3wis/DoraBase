import { expect, test } from 'vitest'
import {
  cransDeMolette,
  cransDePincement,
  defilementAncre,
  deltaEnPixels,
  FACTEUR_DE_PINCEMENT,
  SEUIL_DE_CRAN,
} from './zoomALaSouris'

/**
 * L'arithmétique du zoom à la souris (`API-82`).
 *
 * **Ce qui se mesure ici, et pourquoi pas ailleurs.** jsdom ne calcule aucune mise en page (règle
 * n° 9) et un vrai navigateur ne sait pas envoyer un pincement de trackpad : ni Vitest ni
 * Playwright ne peuvent donc juger le **rythme** d'un geste. Ce qui en est indépendant — combien de
 * paliers un `deltaY` vaut, et où le défilement doit tomber pour qu'un point reste sous le
 * pointeur — se calcule, donc se vérifie ici, en valeurs posées plutôt que rendues.
 */

test('un crantage de souris vaut un palier, et vers le bas il réduit', () => {
  // 100 px est ce qu'une souris envoie pour un cran, en `DOM_DELTA_PIXEL`.
  expect(cransDeMolette(0, SEUIL_DE_CRAN)).toEqual({ cumul: 0, crans: -1 })
  // **Le signe s'inverse** : défiler vers le bas réduit, comme le pincement qui se referme.
  expect(cransDeMolette(0, -SEUIL_DE_CRAN)).toEqual({ cumul: 0, crans: 1 })
})

test('un pincement s’accumule, et ne franchit qu’au seuil', () => {
  // Un trackpad envoie des dizaines d'événements de quelques pixels : un cran par événement
  // traverserait les sept paliers en un geste, et l'échelle ne se viserait plus.
  let cumul = 0
  let rendus = 0
  for (let i = 0; i < 9; i++) {
    const tour = cransDeMolette(cumul, -12)
    cumul = tour.cumul
    rendus += tour.crans
  }
  // Neuf fois douze font 108 : un seul franchissement, et huit pixels restent en réserve.
  expect(rendus).toBe(1)
  expect(cumul).toBe(-8)
})

test('un changement de sens repart de zéro', () => {
  // Sans cette remise à zéro, inverser le geste devrait d'abord « rembourser » les 80 px accumulés,
  // et le premier cran du retour arriverait avec un crantage de retard — exactement au moment où
  // l'on corrige sa visée.
  expect(cransDeMolette(80, -SEUIL_DE_CRAN)).toEqual({ cumul: 0, crans: 1 })
  // Et le même sens, lui, continue de s'accumuler : c'est ce qui distingue la remise à zéro d'un
  // accumulateur qui n'accumulerait rien.
  expect(cransDeMolette(80, 20)).toEqual({ cumul: 0, crans: -1 })
})

test('un geste franc franchit plusieurs paliers d’un coup', () => {
  // Une molette accélérée envoie de grands `deltaY` : n'en rendre qu'un cran ferait traîner le
  // zoom derrière le geste.
  expect(cransDeMolette(0, 3 * SEUIL_DE_CRAN)).toEqual({ cumul: 0, crans: -3 })
})

test('les unités de `deltaMode` sont ramenées à des pixels', () => {
  // Firefox rend des **lignes**, où un crantage vaut 3 : sans conversion, le seuil n'y serait
  // jamais franchi — un zoom qui ne répond pas, sans que rien échoue.
  expect(deltaEnPixels(3, 1)).toBe(48)
  expect(deltaEnPixels(1, 2)).toBe(400)
  // Contrôle négatif : en pixels, rien n'est mis à l'échelle.
  expect(deltaEnPixels(100, 0)).toBe(100)
})

test('le point sous le pointeur y reste, à la nouvelle échelle', () => {
  const ancre = { defilement: 400, pointeur: 300, echelle: 1 }
  // Le point du plan que le pointeur désigne : (400 + 300) / 1.
  const vise = 700

  const apres = defilementAncre(ancre, 1.25)

  // À 125 %, ce point est peint à 875 px du bord du plan ; pour qu'il reste à 300 px du bord de la
  // zone visible, il faut avoir défilé de 575.
  expect(apres).toBe(575)
  expect((apres + ancre.pointeur) / 1.25).toBe(vise)
  // **Le contrôle qui dit que la fonction sert à quelque chose** : garder le défilement d'avant —
  // ce que fait un zoom non ancré — amènerait un autre point sous le pointeur, et la table qu'on
  // regardait filerait hors de l'écran.
  expect((ancre.defilement + ancre.pointeur) / 1.25).not.toBe(vise)
})

test('l’ancrage vaut dans les deux sens, et peut demander un défilement négatif', () => {
  const ancre = { defilement: 400, pointeur: 300, echelle: 1.25 }
  expect((defilementAncre(ancre, 1) + ancre.pointeur) / 1).toBe((400 + 300) / 1.25)
  // Près de l'origine, réduire demande un défilement que la zone ne peut pas tenir. La valeur est
  // rendue telle quelle — le DOM la ramène à zéro lui-même —, et la borner ici ferait croire à une
  // règle qui n'existe pas.
  expect(defilementAncre({ defilement: 0, pointeur: 300, echelle: 1.5 }, 0.4)).toBeLessThan(0)
})

test('un pincement franchit un cran au facteur, et laisse sa référence derrière lui', () => {
  // `GestureEvent.scale` est cumulatif depuis le début du geste : ce qui compte est son rapport à
  // l'échelle du dernier cran rendu.
  expect(cransDePincement(1, FACTEUR_DE_PINCEMENT)).toEqual({
    reference: FACTEUR_DE_PINCEMENT,
    crans: 1,
  })
  // Juste en dessous, rien ne bouge — et la référence ne bouge pas non plus, sinon le geste
  // avancerait par petits pas sans jamais franchir.
  expect(cransDePincement(1, 1.19)).toEqual({ reference: 1, crans: 0 })
  // Qui se referme réduit.
  expect(cransDePincement(1, 1 / FACTEUR_DE_PINCEMENT).crans).toBe(-1)
  // Un pincement franc franchit deux paliers entre deux événements.
  expect(cransDePincement(1, FACTEUR_DE_PINCEMENT ** 2).crans).toBe(2)
})

test('une échelle de pincement absurde ne fait rien plutôt que n’importe quoi', () => {
  // `scale` vaut 0 au tout premier `gesturechange` de certains moteurs : le logarithme y rendrait
  // `-Infinity`, donc un `Math.trunc` qui n'est pas un nombre de crans.
  expect(cransDePincement(1, 0)).toEqual({ reference: 1, crans: 0 })
})
