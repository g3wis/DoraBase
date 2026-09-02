import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { App } from '../../app/App'

/*
 * **Ce fichier mesure l'assemblage, pas le composant** — celui-ci a ses sept tests à côté. La règle
 * qu'il sert est « un composant vérifié pièce par pièce n'est pas un écran livré » : l'ancienne
 * annonce a passé une semaine invisible pendant toute session de travail, montée dans la seule
 * barre d'état que l'écran d'accueil rend, et aucun de ses tests ne partait de l'application.
 *
 * **Pourquoi un double.** `AnnonceMiseAJour` ne rend rien quand la recherche est rejetée, ce qui est
 * le cas sous Vitest : sans double, il n'y aurait rien à observer et le test serait vert quel que
 * soit le câblage.
 */
const MAJ = { version: '0.9.9', notes: 'Deux moteurs de plus.' }

vi.mock('./AnnonceMiseAJour', () => ({
  AnnonceMiseAJour: ({ onInstaller }: { onInstaller: (maj: typeof MAJ) => void }) => (
    <button type="button" onClick={() => onInstaller(MAJ)}>
      double de l’annonce
    </button>
  ),
}))

test("l'application monte l'annonce, hors des deux branches d'écran", async () => {
  render(<App />)
  expect(await screen.findByRole('button', { name: 'double de l’annonce' })).toBeInTheDocument()
})

// **Le chemin, pas seulement l'ouverture** : « Installer » doit mener à la section « Mises à jour »
// *et* y apporter la recherche déjà faite. Un test qui ne vérifierait que l'ouverture de la modale
// resterait vert si elle s'ouvrait sur « Apparence », ou sur une section qui redemande de chercher.
test('« Installer » ouvre les préférences sur « Mises à jour », recherche comprise', async () => {
  const utilisateur = userEvent.setup()
  render(<App />)
  await utilisateur.click(await screen.findByRole('button', { name: 'double de l’annonce' }))

  // **Les assertions ne passent par aucun libellé.** `App` monte son propre `LanguageProvider`
  // depuis les préférences lues, et sous jsdom la lecture échoue : la langue retombe sur celle du
  // navigateur, donc sur ce que la machine annonce. Un nom d'onglet en dur mesurerait le poste.
  const onglet = await waitFor(() => {
    const trouve = document.querySelector('[role="tab"][data-section="maj"]')
    expect(trouve).not.toBeNull()
    return trouve as HTMLElement
  })
  expect(onglet).toHaveAttribute('aria-selected', 'true')
  // Le numéro et les notes ne paraissent que dans l'état « disponible » de la section : « pas
  // encore cherché », « à jour » et « échec » n'en rendent aucun des deux.
  await waitFor(() => expect(screen.getByText('0.9.9')).toBeInTheDocument())
  expect(screen.getByText('Deux moteurs de plus.')).toBeInTheDocument()
})
