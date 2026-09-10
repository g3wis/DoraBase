import { render, screen } from '@testing-library/react'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { TitleBar } from './TitleBar'

/*
 * **Ce fichier décrit la barre de macOS, et le dit maintenant explicitement** (31 août 2026).
 *
 * `sur: 'macos'` par défaut : les trois feux y sont dessinés par le système, donc la barre ne
 * porte qu'un bouton — les préférences. Sous Windows elle en porte quatre, `decorations: false`
 * rendant les contrôles de fenêtre à notre charge, et c'est `TitleBar.windows.test.tsx` qui
 * décrit cette composition-là.
 *
 * Sans ce paramètre, le fichier mesurait la plateforme de la machine plutôt que le produit :
 * vert ici, rouge sur un poste Windows, et rouge sous `DORABASE_PLATEFORME_DECOR=windows`.
 */
function monter(props: Parameters<typeof TitleBar>[0] = {}) {
  return render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <TitleBar sur="macos" {...props} />
    </LanguageProvider>,
  )
}

test('porte la zone de glissement de la fenêtre', () => {
  const { container } = monter()
  expect(container.firstElementChild).toHaveAttribute('data-tauri-drag-region')
})

/*
 * **Le logo est au centre, et le mot « DoraBase » n'y est plus** (`API-47`).
 *
 * Le contrôle négatif porte la moitié du sens : sans l'absence du texte, une barre qui garderait
 * le wordmark à gauche *et* poserait un logo au centre passerait la première assertion.
 *
 * **Le gestionnaire est passé** depuis `API-46` : sans lui, le bouton n'est plus rendu du tout, et
 * la troisième assertion mesurerait une barre que le produit ne monte que sur l'accueil.
 */
test('porte le logo au centre, sans le nom écrit, et l’accès aux préférences', () => {
  const { container } = monter({ onOpenPreferences: () => {} })
  const centre = container.querySelector('[class*="center"]') as HTMLElement
  expect(centre.querySelector('svg use')).toHaveAttribute('href', '#logo')
  expect(screen.queryByText('DoraBase')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /préférences/i })).toBeInTheDocument()
})

// **Le bouton n'est rendu que si quelqu'un l'écoute** (`API-46`). C'est ce qui laisse l'écran de
// travail monter la barre sans aucune action — les préférences y vivent dans la bande en tête de la
// sidebar — sans y laisser un carré grisé qui annoncerait un réglage inatteignable.
test('sans gestionnaire, le bouton des préférences n’est pas rendu', () => {
  monter()
  expect(screen.queryByRole('button', { name: /préférences/i })).toBeNull()
  expect(screen.queryAllByRole('button')).toHaveLength(0)
})

test('n’a pas d’accès à la console', () => {
  monter()
  expect(screen.queryByRole('button', { name: /console/i })).not.toBeInTheDocument()
})

// **Une seule action dans la barre**, les préférences. Le bouton de console est parti le 26 août 2026 :
// il n'avait pas d'`onClick`, donc il se lisait comme une panne (défaut n° 36).
test('n’a qu’une action, les préférences', () => {
  monter({ onOpenPreferences: () => {} })
  const actions = screen.getAllByRole('button')
  expect(actions).toHaveLength(1)
  expect(actions[0]).toHaveAccessibleName(/préférences/i)
})
