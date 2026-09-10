import { render, waitFor } from '@testing-library/react'
import { App } from './App'

// **L'app ne rend plus rien synchronement.** Depuis `09b`, elle lit d'abord la configuration :
// afficher `A1` (« aucun projet ») pendant la lecture ferait clignoter l'écran d'accueil devant
// un utilisateur qui en a dix. Le test attend donc que la lecture aboutisse.
//
// Sous Vitest, le pont IPC n'existe pas : `load_config` rejette, et l'app tombe dans l'état
// « injoignable » — qui affiche `A1` faute de mieux, la configuration restant inconnue.
//
// **Ce qu'on regarde n'est plus le nom écrit** (`API-47`) : la barre de titre ne porte plus le mot
// « DoraBase », son logo étant passé au centre. Le témoin de l'écran monté est donc la zone de
// glissement de la fenêtre, que le test suivant emploie déjà en négatif.
test('rend l’écran une fois la configuration lue', async () => {
  const { container } = render(<App />)
  await waitFor(() =>
    expect(container.querySelector('[data-tauri-drag-region]')).toBeInTheDocument(),
  )
})

test('rien n’est rendu avant que la configuration ait répondu', () => {
  const { container } = render(<App />)
  // Le sprite d'icônes est toujours là ; l'écran, non.
  expect(container.querySelector('[data-tauri-drag-region]')).toBeNull()
})
