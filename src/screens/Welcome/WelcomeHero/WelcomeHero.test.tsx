import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '../../../i18n/LanguageContext'
import { raccourci } from '../../../shell/plateforme'
import { WelcomeHero } from './WelcomeHero'

function monter(onNewFolder: () => void = () => {}, onImportProjects?: () => void) {
  return render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <WelcomeHero onNewFolder={onNewFolder} onImportProjects={onImportProjects} />
    </LanguageProvider>,
  )
}

// Le mockup pose un espace insécable avant le point d'interrogation (« Prêt à
// explorer ? »). `toHaveTextContent` ne convient pas : sa normalisation par défaut
// collapse l'espace insécable du DOM réel en espace normal, mais ne normalise pas la
// chaîne attendue — elle masquerait silencieusement exactement la régression que ce
// test doit détecter. D'où une comparaison stricte sur `textContent`.
test('conserve l’espace insécable du titre', () => {
  monter()
  expect(screen.getByRole('heading').textContent).toBe('Prêt à explorer ?')
})

test('n’expose qu’un seul bouton quand l’écran ne relie pas l’import', () => {
  // La galerie monte cet écran sans application autour de lui : le second bouton n'y mène nulle
  // part, donc il n'est pas rendu — plutôt que rendu inerte (défaut n° 36).
  monter()
  expect(screen.getAllByRole('button')).toHaveLength(1)
})

test('« Importer des dossiers… » paraît à côté, et appelle le geste', async () => {
  // **C'est ici que l'import manquait le plus** (`API-30`, 17 septembre 2026, à la demande) : sur un
  // second poste, il n'y a ni arbre ni bande d'actions, donc rien à l'écran ne disait qu'un fichier
  // pouvait rendre ses projets. Le seul chemin était le menu natif, que personne n'a trouvé.
  const onImportProjects = vi.fn()
  const onNewFolder = vi.fn()
  monter(onNewFolder, onImportProjects)

  await userEvent.click(screen.getByRole('button', { name: 'Importer des dossiers…' }))

  expect(onImportProjects).toHaveBeenCalledOnce()
  // **Et il ne prend pas la place du geste attendu** : « Nouveau dossier » reste là, avec son
  // raccourci — deux boutons, non un remplacement.
  expect(onNewFolder).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Nouveau dossier' })).toBeInTheDocument()
  expect(screen.getByText(raccourci('N'))).toBeInTheDocument()
})

test('le bouton demande un nouveau dossier', async () => {
  const onNewFolder = vi.fn()
  monter(onNewFolder)
  await userEvent.click(screen.getByRole('button'))
  expect(onNewFolder).toHaveBeenCalledOnce()
})

test('le raccourci ⌘N est affiché sans polluer le nom accessible', () => {
  monter()
  expect(screen.getByRole('button', { name: 'Nouveau dossier' })).toBeInTheDocument()
  expect(screen.getByText(raccourci('N'))).toBeInTheDocument()
})
