import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { ExportReport } from '../../domain/transfert'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { ExportProjects } from './ExportProjects'

const RAPPORT: ExportReport = {
  projects: 1,
  connections: 3,
  consoles: 5,
  passwordsCarried: 0,
  passwordsMissing: [],
}

function Piloté({
  projet = 'Atelier Nord',
  total = 3,
  onChoisirFichier = () => Promise.resolve('/tmp/projets.json'),
  onExporter = () => Promise.resolve(RAPPORT),
}: {
  projet?: string | null
  total?: number
  onChoisirFichier?: (projet: string | null) => Promise<string | null>
  onExporter?: (fichier: string, avecLesMotsDePasse: boolean) => Promise<ExportReport>
}) {
  return (
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <ExportProjects
          projet={projet}
          total={total}
          onClose={() => {}}
          onChoisirFichier={onChoisirFichier}
          onExporter={onExporter}
        />
      </LanguageProvider>
    </>
  )
}

test('la portée est nommée : le projet, ou tous', () => {
  const { unmount } = render(<Piloté projet="Atelier Nord" />)
  expect(screen.getByText('Atelier Nord')).toBeInTheDocument()
  unmount()

  // **La seule chose qui distingue les deux portées**, et le compte dit combien de projets partent —
  // « tous les projets » sans nombre ne dirait pas si c'en est un ou trente.
  render(<Piloté projet={null} total={3} />)
  expect(screen.getByText('Tous les projets (3)')).toBeInTheDocument()
})

test('les mots de passe ne partent pas sans qu’on l’ait demandé', async () => {
  const appels: boolean[] = []
  render(
    <Piloté
      onExporter={async (_, avec) => {
        appels.push(avec)
        return RAPPORT
      }}
    />,
  )

  const interrupteur = screen.getByRole('switch', { name: 'Inclure les mots de passe' })
  expect(interrupteur).toHaveAttribute('aria-checked', 'false')

  await userEvent.click(screen.getByRole('button', { name: 'Choisir un fichier…' }))

  expect(appels).toEqual([false])
})

test('l’interrupteur allumé avertit, et sa valeur part avec l’export', async () => {
  const appels: boolean[] = []
  render(
    <Piloté
      onExporter={async (_, avec) => {
        appels.push(avec)
        return RAPPORT
      }}
    />,
  )

  // **L'avertissement est à côté de l'interrupteur, pas dans une confirmation** : une confirmation
  // arriverait après le choix du fichier, donc après le geste — là où il faut le dire avant.
  await userEvent.click(screen.getByRole('switch', { name: 'Inclure les mots de passe' }))
  expect(screen.getByText(/ne se reprend pas/)).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Choisir un fichier…' }))
  expect(appels).toEqual([true])
})

test('annuler le sélecteur natif n’exporte rien et laisse la modale au choix', async () => {
  const onExporter = vi.fn(() => Promise.resolve(RAPPORT))
  render(<Piloté onChoisirFichier={() => Promise.resolve(null)} onExporter={onExporter} />)

  await userEvent.click(screen.getByRole('button', { name: 'Choisir un fichier…' }))

  expect(onExporter).not.toHaveBeenCalled()
  // Le bouton reste : une modale qui se serait fermée ou figée sur un geste annulé se lirait comme
  // une panne.
  expect(screen.getByRole('button', { name: 'Choisir un fichier…' })).toBeInTheDocument()
})

test('le rapport dit ce qui est parti, et nomme les mots de passe introuvables', async () => {
  render(
    <Piloté
      onExporter={() =>
        Promise.resolve({
          projects: 2,
          connections: 4,
          consoles: 7,
          passwordsCarried: 3,
          passwordsMissing: ['stocks (prod)'],
        })
      }
    />,
  )

  await userEvent.click(screen.getByRole('button', { name: 'Choisir un fichier…' }))

  expect(await screen.findByText(/2 projet\(s\), 4 connexion\(s\), 7 console\(s\)/)).toBeVisible()
  expect(screen.getByText(/3 mot\(s\) de passe écrit\(s\) en clair/)).toBeVisible()
  // **Dit, jamais tu** : sans cette ligne, le fichier serait incomplet et on ne le découvrirait
  // qu'à l'import, sur une autre machine.
  expect(screen.getByText(/stocks \(prod\)/)).toBeVisible()
  expect(screen.getByText('/tmp/projets.json')).toBeVisible()
  // Le geste est fait : le proposer encore ferait écrire un second fichier sans qu'on l'ait demandé.
  expect(screen.queryByRole('button', { name: 'Choisir un fichier…' })).toBeNull()
})

test('un échec est affiché, et non avalé', async () => {
  render(<Piloté onExporter={() => Promise.reject('il n’y a aucun projet à exporter')} />)

  await userEvent.click(screen.getByRole('button', { name: 'Choisir un fichier…' }))

  expect(await screen.findByText('il n’y a aucun projet à exporter')).toBeVisible()
})
