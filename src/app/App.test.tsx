import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

/**
 * **L'import est atteignable depuis l'écran des débuts** (`API-30`, 17 septembre 2026).
 *
 * Ce test existe pour un défaut précis, et il l'aurait attrapé : `TransferDialogs` était montée
 * **dans la branche de l'écran de travail**, donc sur `A1` — aucun projet — l'entrée « Importer des
 * projets… » du menu natif posait son état et **rien ne paraissait**. C'est le défaut de l'engrenage
 * d'`A1` du 26 août 2026, à la lettre : un composant juste dans sa vitrine ne prouve rien de
 * l'assemblage (règle n° 8), et il faut partir de `/` pour le voir.
 *
 * Sous Vitest le pont IPC ne répond pas, donc `load_config` rejette et l'application retombe sur
 * `A1` : c'est exactement l'écran qu'on veut ici, et il vient gratuitement.
 */
test('depuis l’écran d’accueil, « Importer des projets… » ouvre la modale', async () => {
  const utilisateur = userEvent.setup()
  render(<App />)

  /* **Un motif, non un libellé**, et c'est délibéré : `App` résout sa propre langue depuis
     `navigator.language` — ce test ne monte pas le fournisseur, donc il ne peut pas la fixer sans
     truquer le navigateur. Ce qui est en cause ici est le **câblage**, pas la traduction, que la
     parité des dictionnaires garde par ailleurs. Le motif reste **ancré** : rien d'autre, sur cet
     écran, ne commence par « Import ». */
  await utilisateur.click(await screen.findByRole('button', { name: /^Import/ }))

  expect(await screen.findByRole('dialog', { name: /^Import/ })).toBeInTheDocument()
})
