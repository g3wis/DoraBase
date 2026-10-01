import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { DumpAvailability } from '../../domain/dump'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { ExportDump } from './ExportDump'

const CIBLE = { chemin: 'Boutique › staging', base: 'commandes' }

function verdict(kind: DumpAvailability['kind']): DumpAvailability {
  switch (kind) {
    case 'ready':
      return {
        kind: 'ready',
        tool: '/opt/homebrew/opt/postgresql@17/bin/pg_dump',
        version: { majeure: 17, mineure: 4 },
      }
    case 'toolMissing':
      return { kind: 'toolMissing', binary: 'pg_dump' }
    case 'toolTooOld':
      return {
        kind: 'toolTooOld',
        tool: { majeure: 13, mineure: 14 },
        server: { majeure: 17, mineure: 6 },
      }
    case 'notYetSupported':
      return { kind: 'notYetSupported', engine: 'mysql' }
    case 'noLocalDump':
      return { kind: 'noLocalDump', engine: 'bigquery' }
  }
}

function monter(
  availability: DumpAvailability | null,
  options: Partial<Parameters<typeof ExportDump>[0]> = {},
) {
  // **`language: 'fr'` explicite**, jamais la langue de la machine : les assertions portent
  // sur des libellés, et un test qui suivrait la locale du poste passerait ici et échouerait
  // ailleurs. C'est le même arbitrage que la locale figée de Playwright.
  return render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <ExportDump
        availability={availability}
        cible={CIBLE}
        onClose={() => {}}
        onChoisirFichier={async () => null}
        onExporter={async () => 0}
        onAnnuler={() => {}}
        {...options}
      />
    </LanguageProvider>,
  )
}

// Les cinq verdicts rendent cinq messages distincts. « Indisponible » recouvre cinq
// situations, et un message commun ferait chercher une solution là où il n'y en a pas.
test.each([
  ['toolMissing', /pg_dump.*introuvable/i],
  ['toolTooOld', /version.*trop ancienne/i],
  ['notYetSupported', /pas encore disponible/i],
  ['noLocalDump', /pas d.export local/i],
  ['ready', /Exporter un dump/i],
] as const)('le verdict %s rend son propre message', (kind, attendu) => {
  const { unmount } = monter(verdict(kind))
  expect(screen.getByRole('dialog', { name: attendu })).toBeInTheDocument()
  unmount()
})

test('les cinq titres sont deux à deux distincts', () => {
  // Contrôle positif du test précédent : cinq expressions régulières pourraient toutes
  // tomber sur le même titre si celui-ci les contenait toutes.
  const titres = (
    ['ready', 'toolMissing', 'toolTooOld', 'notYetSupported', 'noLocalDump'] as const
  ).map((kind) => {
    const { unmount } = monter(verdict(kind))
    const titre = screen.getByRole('dialog').getAttribute('aria-label')
    unmount()
    return titre
  })
  expect(new Set(titres).size).toBe(5)
})

test('seul le verdict ready propose de choisir un fichier', () => {
  monter(verdict('toolMissing'))
  expect(screen.queryByRole('button', { name: /Choisir le fichier/ })).not.toBeInTheDocument()
})

test('la modale nomme le chemin de dossiers et la connexion', () => {
  monter(verdict('ready'))
  const dialogue = screen.getByRole('dialog')
  // Séparés par des espaces explicites : deux contenus côte à côte se concatènent **sans** espace
  // dans le nom accessible comme dans le texte.
  expect(dialogue).toHaveTextContent('Boutique › staging · commandes')
})

test('la progression est affichée en octets, jamais en pourcentage', async () => {
  // `pg_dump --format=plain` n'émet aucune progression et la taille finale est
  // inconnaissable : un pourcentage serait une estimation présentée comme un fait.
  const utilisateur = userEvent.setup()
  let terminer: (octets: number) => void = () => {}
  const enAttente = new Promise<number>((resolve) => {
    terminer = resolve
  })

  monter(verdict('ready'), {
    onChoisirFichier: async () => '/Users/x/dump.sql',
    onExporter: () => enAttente,
    octetsEcrits: 2_500_000,
  })

  await utilisateur.click(screen.getByRole('button', { name: /Choisir le fichier/ }))
  const progression = await screen.findByText(/écrits/)
  expect(progression).toHaveTextContent('2.4 MB')
  expect(progression.textContent).not.toMatch(/%/)

  terminer(2_500_000)
  await waitFor(() => expect(screen.getByText(/Terminé/)).toBeInTheDocument())
})

test('un export en cours propose de l’annuler, et pas de le relancer', async () => {
  const utilisateur = userEvent.setup()
  const annuler = vi.fn()
  monter(verdict('ready'), {
    onChoisirFichier: async () => '/Users/x/dump.sql',
    onExporter: () => new Promise<number>(() => {}),
    onAnnuler: annuler,
  })

  await utilisateur.click(screen.getByRole('button', { name: /Choisir le fichier/ }))
  const bouton = await screen.findByRole('button', { name: /Annuler l’export/ })
  await utilisateur.click(bouton)

  expect(annuler).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: /Choisir le fichier/ })).not.toBeInTheDocument()
})

test('un échec est rendu tel quel, sans être réécrit', async () => {
  const utilisateur = userEvent.setup()
  monter(verdict('ready'), {
    onChoisirFichier: async () => '/Users/x/dump.sql',
    onExporter: async () => {
      // La forme structurée que Tauri rend pour un `Err(DumpFailure)`.
      throw { kind: 'echec', message: 'pg_dump a échoué (code 1) : rôle inexistant' }
    },
  })

  await utilisateur.click(screen.getByRole('button', { name: /Choisir le fichier/ }))
  expect(await screen.findByText(/rôle inexistant/)).toBeInTheDocument()
})

test('annuler dans le sélecteur natif ne lance rien', async () => {
  const utilisateur = userEvent.setup()
  const exporter = vi.fn(async () => 0)
  monter(verdict('ready'), { onChoisirFichier: async () => null, onExporter: exporter })

  await utilisateur.click(screen.getByRole('button', { name: /Choisir le fichier/ }))

  expect(exporter).not.toHaveBeenCalled()
})
