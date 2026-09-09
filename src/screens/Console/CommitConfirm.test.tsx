import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { CommitConfirm } from './CommitConfirm'
import type { ValidationADemander } from './useTransaction'

const CONSOLE = {
  cle: { project: 'Atelier Nord', database: 'analytics', environment: 'prod' },
  id: 'Atelier Nord/analytics/prod::console:console 1',
}

function monter(
  validation: Partial<ValidationADemander> = {},
  props: Partial<Parameters<typeof CommitConfirm>[0]> = {},
) {
  return render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <CommitConfirm
          validation={{
            console: CONSOLE,
            instructions: 3,
            ecritures: ['UPDATE', 'DELETE'],
            sansRestriction: false,
            ...validation,
          }}
          cible="analytics"
          production={false}
          onClose={() => {}}
          onConfirmer={() => {}}
          {...props}
        />
      </LanguageProvider>
    </>,
  )
}

test('elle récapitule ce qui devient définitif', () => {
  monter()
  // **Les verbes, dans l'ordre**, et non « 2 écritures » : c'est ce qui distingue deux corrections
  // d'une suppression, et c'est ce qui fait s'apercevoir qu'on s'est trompé.
  expect(screen.getByText('UPDATE, DELETE')).toBeInTheDocument()
  expect(screen.getByText('3')).toBeInTheDocument()
  expect(screen.getByText('analytics')).toBeInTheDocument()
  // Le bouton nomme son acte, et compte ce qu'il emporte.
  expect(screen.getByRole('button', { name: 'Valider 2 écritures' })).toBeInTheDocument()
})

test('le `where` manquant passe en premier', () => {
  monter({ sansRestriction: true, ecritures: ['DELETE'] })
  // Le fait le plus coûteux de tout ce qui attend : un `delete` sans `where` touche toute la table,
  // et le noyer au milieu d'un récapitulatif reviendrait à ne pas le dire.
  expect(screen.getByText(/L’une des écritures n’a pas de/)).toBeInTheDocument()
  expect(screen.getByText(/toutes les lignes de sa table/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Valider 1 écriture' })).toBeInTheDocument()
})

test('l’environnement de production porte son encart, et lui seul', () => {
  monter({}, { production: false })
  expect(screen.queryByText('production')).toBeNull()
  monter({}, { production: true })
  // **Le drapeau de la déclaration** (`23g`), jamais le libellé : un environnement nommé « live »
  // et marqué production doit porter l'encart.
  expect(screen.getByText('production')).toBeInTheDocument()
})

test('elle dit ce que DoraBase ne sait pas défaire', () => {
  monter()
  // Une validation ne se défait par aucun geste du produit : il n'y a pas de patch inverse pour une
  // requête de console, et laisser croire à un filet qui n'existe pas serait pire que se taire.
  expect(screen.getByText(/La validation est définitive/)).toBeInTheDocument()
})

test('les deux issues appellent leur geste', async () => {
  const utilisateur = userEvent.setup()
  const fermer = vi.fn()
  const confirmer = vi.fn()
  monter({}, { onClose: fermer, onConfirmer: confirmer })

  await utilisateur.click(screen.getByRole('button', { name: 'Annuler' }))
  await utilisateur.click(screen.getByRole('button', { name: /Valider 2 écritures/ }))
  expect(fermer).toHaveBeenCalledTimes(1)
  expect(confirmer).toHaveBeenCalledTimes(1)
})

test('pendant la validation, les deux boutons attendent', () => {
  monter({}, { enCours: true })
  expect(screen.getByRole('button', { name: 'Annuler' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Validation…' })).toBeDisabled()
})
