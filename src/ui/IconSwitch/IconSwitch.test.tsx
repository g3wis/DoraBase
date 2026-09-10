import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Sprite } from '../../design/icons/Sprite'
import { IconSwitch } from './IconSwitch'

function Piloté({ initial = false, disabled = false }) {
  const [coche, setCoche] = useState(initial)
  return (
    <>
      <Sprite />
      <IconSwitch
        checked={coche}
        onCheckedChange={setCoche}
        label="Verrouiller la table"
        iconOff="unlock"
        iconOn="lock"
        disabled={disabled}
      />
    </>
  )
}

test('s’annonce comme un interrupteur nommé, et la position vit dans aria-checked', () => {
  render(<Piloté />)
  const bascule = screen.getByRole('switch', { name: 'Verrouiller la table' })
  expect(bascule).not.toBeChecked()
})

test('un clic bascule, et le nom ne bouge pas', async () => {
  render(<Piloté />)
  const bascule = screen.getByRole('switch', { name: 'Verrouiller la table' })

  await userEvent.click(bascule)
  expect(bascule).toBeChecked()
  // Le même élément répond au second clic : un contrôle qui se renommerait sous le doigt se
  // chercherait à nouveau à chaque bascule.
  expect(screen.getByRole('switch', { name: 'Verrouiller la table' })).toBe(bascule)

  await userEvent.click(bascule)
  expect(bascule).not.toBeChecked()
})

// `role="switch"` est un `<button>` : `Espace` et `Entrée` basculent nativement, et c'est la
// raison de ne pas avoir écrit de gestionnaire clavier. Sans ce test, rien ne dirait que le choix
// du `<button>` tient — un `<div role="switch">` passerait tous les autres.
test('le clavier bascule sans gestionnaire écrit', async () => {
  render(<Piloté />)
  await userEvent.tab()
  const bascule = screen.getByRole('switch', { name: 'Verrouiller la table' })
  expect(bascule).toHaveFocus()

  await userEvent.keyboard(' ')
  expect(bascule).toBeChecked()
  await userEvent.keyboard('{Enter}')
  expect(bascule).not.toBeChecked()
})

// **Les deux icônes sont là dans les deux positions**, et dans l'ordre reçu : c'est tout l'écart
// avec un bouton qui montrerait l'état courant seul. Ce que la position change est l'accent et la
// pastille, que seul un vrai navigateur mesure (règle n° 9).
test('les deux icônes sont rendues, gauche puis droite', () => {
  render(<Piloté />)
  const dessins = [...screen.getByRole('switch').querySelectorAll('use')].map((u) =>
    u.getAttribute('href'),
  )
  expect(dessins).toEqual(['#i-unlock', '#i-lock'])
})

test('désactivé, il ne bascule plus', async () => {
  render(<Piloté disabled />)
  const bascule = screen.getByRole('switch', { name: 'Verrouiller la table' })
  await userEvent.click(bascule)
  expect(bascule).not.toBeChecked()
})
