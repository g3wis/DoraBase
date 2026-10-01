import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { ExportReport } from '../../domain/arbre'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { ExportProjects } from './ExportProjects'

const RAPPORT: ExportReport = {
  folders: 1,
  connections: 3,
  consoles: 5,
  passwordsCarried: 0,
  passwordsMissing: [],
}

function Piloté({
  dossier = 'Atelier Nord',
  total = 3,
  onChoisirFichier = () => Promise.resolve('/tmp/dossiers.json'),
  onExporter = () => Promise.resolve(RAPPORT),
}: {
  dossier?: string | null
  total?: number
  onChoisirFichier?: (dossier: string | null) => Promise<string | null>
  onExporter?: (fichier: string, avecLesMotsDePasse: boolean) => Promise<ExportReport>
}) {
  return (
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <ExportProjects
          dossier={dossier}
          total={total}
          onClose={() => {}}
          onChoisirFichier={onChoisirFichier}
          onExporter={onExporter}
        />
      </LanguageProvider>
    </>
  )
}

test('la portée est nommée : le dossier, ou tout l’arbre', () => {
  const { unmount } = render(<Piloté dossier="Atelier Nord" />)
  expect(screen.getByText('Atelier Nord')).toBeInTheDocument()
  unmount()

  // **La seule chose qui distingue les deux portées**, et le compte dit combien de dossiers
  // partent — « tout » sans nombre ne dirait pas si c'en est un ou trente.
  render(<Piloté dossier={null} total={3} />)
  expect(screen.getByText('Toute l’arborescence (3 dossiers)')).toBeInTheDocument()
})

test('un dossier exporté seul annonce qu’il emporte ce qu’il hérite, tout l’arbre non', () => {
  // **Dit avant le geste** (#169) : sans cette phrase, un dossier arrivé en lecture seule sur
  // l'autre poste se lirait comme un défaut. Le contrôle négatif : l'arbre entier n'a pas
  // d'ancêtre à perdre, et la phrase y serait fausse.
  const { unmount } = render(<Piloté dossier="prod" />)
  expect(screen.getByText(/emporte la lecture seule et les libellés/)).toBeInTheDocument()
  unmount()

  render(<Piloté dossier={null} />)
  expect(screen.queryByText(/emporte la lecture seule/)).toBeNull()
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
          folders: 2,
          connections: 4,
          consoles: 7,
          passwordsCarried: 3,
          passwordsMissing: ['Atelier Nord › prod › stocks'],
        })
      }
    />,
  )

  await userEvent.click(screen.getByRole('button', { name: 'Choisir un fichier…' }))

  expect(
    await screen.findByText(/2 dossier\(s\), 4 base\(s\) de données, 7 console\(s\)/),
  ).toBeVisible()
  expect(screen.getByText(/3 mot\(s\) de passe écrit\(s\) en clair/)).toBeVisible()
  // **Dit, jamais tu** : sans cette ligne, le fichier serait incomplet et on ne le découvrirait
  // qu'à l'import, sur une autre machine.
  expect(screen.getByText(/Atelier Nord › prod › stocks/)).toBeVisible()
  expect(screen.getByText('/tmp/dossiers.json')).toBeVisible()
  // Le geste est fait : le proposer encore ferait écrire un second fichier sans qu'on l'ait demandé.
  expect(screen.queryByRole('button', { name: 'Choisir un fichier…' })).toBeNull()
})

test('un échec est affiché, et non avalé', async () => {
  render(<Piloté onExporter={() => Promise.reject('il n’y a rien à exporter')} />)

  await userEvent.click(screen.getByRole('button', { name: 'Choisir un fichier…' }))

  expect(await screen.findByText('il n’y a rien à exporter')).toBeVisible()
})
