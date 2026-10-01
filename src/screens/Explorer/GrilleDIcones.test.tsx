import { render, screen } from '@testing-library/react'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { GrilleDIcones } from './GrilleDIcones'

/** Le symbole que dessine la case nommée `nom`. */
function dessinDe(nom: string): string | null {
  const caseRadio = screen.getByRole('radio', { name: nom })
  return caseRadio.closest('label')?.querySelector('use')?.getAttribute('href') ?? null
}

test('la grille dessine les quatre icônes d’origine par leur équivalent de Lucide (#175)', () => {
  const choix: string[] = []
  render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <GrilleDIcones
        valeur="cloud"
        onChange={(icone) => choix.push(icone)}
        label="Icône"
        name="g"
      />
    </LanguageProvider>,
  )

  expect(dessinDe('Nuage')).toBe('#i-lucide-cloud')
  expect(dessinDe('Code')).toBe('#i-lucide-code')
  expect(dessinDe('Étoile')).toBe('#i-lucide-star')
  expect(dessinDe('Boussole')).toBe('#i-lucide-compass')
  // Le reste n'est pas touché.
  expect(dessinDe('Fusée')).toBe('#i-rocket')
  // **La valeur reste le nom** : la case cochée est celle de `cloud`, et c'est `cloud` qu'on écrit.
  expect(screen.getByRole('radio', { name: 'Nuage' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Nuage' })).toHaveAttribute('value', 'cloud')
})
