import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { auModificateur } from '../../test/raccourcis'
import { WelcomeScreen } from './WelcomeScreen'

function monter(props: Partial<Parameters<typeof WelcomeScreen>[0]> = {}) {
  return render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <WelcomeScreen
        onNewProject={() => {}}
        onOpenPreferences={() => {}}
        projectCount={0}
        {...props}
      />
    </LanguageProvider>,
  )
}

test('les deux boutons appellent le même callback', async () => {
  const onNewProject = vi.fn()
  monter({ onNewProject })
  const boutons = screen.getAllByRole('button', { name: /nouveau projet/i })
  expect(boutons).toHaveLength(2)
  for (const b of boutons) await userEvent.click(b)
  expect(onNewProject).toHaveBeenCalledTimes(2)
})

// **Les deux tests de `⌘N` ont déménagé** dans `src/app/useRaccourcisDeCreation.test.tsx` (`24d`), avec
// le raccourci lui-même : monté dans cet écran, il ne répondait que sur `A1`. Cet écran n'écoute plus
// le clavier, donc il n'a plus rien à en dire — et un test qui frapperait `⌘N` ici passerait au vert
// sans que le raccourci existe nulle part.
test('cet écran n’écoute plus le clavier', async () => {
  const onNewProject = vi.fn()
  monter({ onNewProject })
  await userEvent.keyboard(auModificateur('n'))
  await userEvent.keyboard('n')
  expect(onNewProject).not.toHaveBeenCalled()
})

test('assemble la barre de titre, la barre d’état et le compteur de projets', () => {
  const { container } = monter({ projectCount: 2 })
  // La barre de titre, désignée par sa zone de glissement : elle ne porte plus le mot « DoraBase »
  // depuis `API-47`, son logo étant passé au centre.
  expect(container.querySelector('[data-tauri-drag-region]')).toBeInTheDocument()
  expect(screen.getByText('2 projets')).toBeInTheDocument()
})

/*
 * **L'engrenage de `A1` ouvre les préférences** (26 août 2026).
 *
 * Il ne faisait rien : `WelcomeScreen` montait la barre sans `onOpenPreferences`, donc `TitleBar`
 * retombait sur son `disabled` — dont l'infobulle renvoyait vers l'écran de travail, qui n'existe
 * pas tant qu'aucun projet n'est déclaré. Le premier écran du produit avait un réglage
 * inatteignable.
 */
test('l’engrenage ouvre les préférences, et n’est pas désactivé', async () => {
  const onOpenPreferences = vi.fn()
  monter({ onOpenPreferences })
  const engrenage = screen.getByRole('button', { name: 'Préférences' })
  expect(engrenage).toBeEnabled()
  await userEvent.click(engrenage)
  expect(onOpenPreferences).toHaveBeenCalledOnce()
})
