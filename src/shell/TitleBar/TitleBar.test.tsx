import { render, screen } from '@testing-library/react'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { TitleBar } from './TitleBar'

/*
 * **Ce fichier décrit la barre de macOS, et le dit maintenant explicitement** (31 août 2026).
 *
 * `sur: 'macos'` par défaut : les trois feux y sont dessinés par le système, donc la barre ne
 * porte qu'un bouton — l'engrenage. Sous Windows elle en porte quatre, `decorations: false`
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
 */
test('porte le logo au centre, sans le nom écrit, et l’accès aux préférences', () => {
  const { container } = monter()
  const centre = container.querySelector('[class*="center"]') as HTMLElement
  expect(centre.querySelector('svg use')).toHaveAttribute('href', '#logo')
  expect(screen.queryByText('DoraBase')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /préférences/i })).toBeInTheDocument()
})

test('n’a pas d’accès à la console', () => {
  monter()
  expect(screen.queryByRole('button', { name: /console/i })).not.toBeInTheDocument()
})

// **Une seule action dans la barre**, l'engrenage. Le bouton de console est parti le 26 août 2026 :
// il n'avait pas d'`onClick`, donc il se lisait comme une panne (défaut n° 36).
test('n’a qu’une action, les préférences', () => {
  monter()
  const actions = screen.getAllByRole('button')
  expect(actions).toHaveLength(1)
  expect(actions[0]).toHaveAccessibleName(/préférences/i)
})
