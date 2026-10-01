import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '../../../i18n/LanguageContext'
import { ProjectSidebar } from './ProjectSidebar'

function monter(onNewFolder: () => void = () => {}) {
  return render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <ProjectSidebar onNewFolder={onNewFolder} />
    </LanguageProvider>,
  )
}

test('annonce l’absence de dossier', () => {
  monter()
  expect(screen.getByText('Aucun dossier')).toBeInTheDocument()
})

test('le bouton de pied demande un nouveau dossier', async () => {
  const onNewFolder = vi.fn()
  monter(onNewFolder)
  await userEvent.click(screen.getByRole('button', { name: /nouveau dossier/i }))
  expect(onNewFolder).toHaveBeenCalledOnce()
})

// Le sous-texte dit ce qu'est un dossier (#166), à la place de la phrase du mockup sur les
// projets : un texte figé ici le protège d'une reformulation silencieuse.
test('conserve le texte exact du sous-titre', () => {
  monter()
  expect(
    screen.getByText('Un dossier range des connexions, et d’autres dossiers — dev, staging, prod.'),
  ).toBeInTheDocument()
})
