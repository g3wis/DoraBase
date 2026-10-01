import { render, screen } from '@testing-library/react'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { raccourci } from '../plateforme'
import { StatusBar } from './StatusBar'

function monter(folderCount: number) {
  return render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <StatusBar folderCount={folderCount} />
    </LanguageProvider>,
  )
}

test('accorde le compteur de dossiers', () => {
  monter(0)
  expect(screen.getByText('0 dossier')).toBeInTheDocument()
})

test('met le compteur au pluriel au-delà de un', () => {
  monter(3)
  expect(screen.getByText('3 dossiers')).toBeInTheDocument()
})

// La version est une donnée, et le handoff impose de remplacer les données fictives —
// le mockup affiche « DoraBase 0.4.2 », ce n'est jamais la vraie version.
test('affiche la version réelle, pas celle de la maquette', () => {
  monter(0)
  expect(screen.getByText(/^DoraBase \d+\.\d+\.\d+$/)).toBeInTheDocument()
  expect(screen.queryByText('DoraBase 0.4.2')).not.toBeInTheDocument()
})

test('affiche le rappel de palette de commandes', () => {
  monter(0)
  expect(screen.getByText(`${raccourci('K')} palette`)).toBeInTheDocument()
})
