import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { Project } from '../../domain/config'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { REGLAGES, TRIO_DE_TEST } from '../NewConnection/pourLesTests'
import { DumpDialogs } from './DumpDialogs'
import type * as pont from './dumpCommands'

const PROJET_UNIQUE: Project[] = [
  {
    name: 'Atelier Nord',
    environments: TRIO_DE_TEST,
    queries: [],
    databases: [
      {
        name: 'commandes',
        engine: 'postgresql',
        // Une connexion appartient à **un** environnement depuis `23b`, et c'est le sien
        // qui entre dans la clé — il n'y a plus d'environnement actif depuis `25c`.
        environment: 'staging',
        connection: REGLAGES,
        consoles: [],
      },
    ],
  },
]

/**
 * Monte la modale sous le contexte de langue, en **français figé** : les assertions portent
 * sur des libellés, et suivre la locale de la machine ferait passer ce test ici et échouer
 * ailleurs. Même arbitrage que la locale figée de Playwright.
 */
function monter(element: React.ReactElement) {
  return render(<LanguageProvider preferences={{ language: 'fr' }}>{element}</LanguageProvider>)
}

/** Le pont IPC simulé : ce qui est testé ici est le **câblage**, pas le pont. */
function commandes(surcharges: Partial<typeof pont> = {}): typeof pont {
  return {
    EVENEMENT_PROGRESSION: 'dump://progression',
    dumpAvailability: vi.fn(async () => ({
      availability: {
        kind: 'ready' as const,
        tool: '/usr/bin/pg_dump',
        version: { majeure: 17, mineure: 4 },
      },
      transport: { mode: 'verify-full' as const, root: { kind: 'system' as const } },
    })),
    startExport: vi.fn(async () => 1024),
    cancelExport: vi.fn(async () => true),
    inspectDump: vi.fn(async () => ({ kind: 'tronque' as const })),
    startImport: vi.fn(async () => {}),
    ecouterLaProgression: vi.fn(() => () => {}),
    choisirDestination: vi.fn(async () => '/Users/x/commandes.sql'),
    choisirSource: vi.fn(async () => '/Users/x/dump.sql'),
    ...surcharges,
  }
}

test('sans cible unique, la modale le dit au lieu de choisir', () => {
  monter(<DumpDialogs sens="export" projects={[]} onClose={() => {}} commandes={commandes()} />)
  expect(screen.getByRole('dialog', { name: /Aucune base/i })).toBeInTheDocument()
})

test('sans cible unique, aucun verdict n’est même demandé', () => {
  // Sonder un serveur pour une base qu'on ne saurait pas nommer serait un aller-retour
  // réseau pour rien.
  const pontSimule = commandes()
  monter(<DumpDialogs sens="export" projects={[]} onClose={() => {}} commandes={pontSimule} />)
  expect(pontSimule.dumpAvailability).not.toHaveBeenCalled()
})

test('avec une cible unique, le verdict est demandé et la modale d’export s’ouvre', async () => {
  const pontSimule = commandes()
  monter(
    <DumpDialogs
      sens="export"
      projects={PROJET_UNIQUE}
      onClose={() => {}}
      commandes={pontSimule}
    />,
  )

  expect(await screen.findByRole('dialog', { name: /Exporter un dump/i })).toBeInTheDocument()
  expect(pontSimule.dumpAvailability).toHaveBeenCalledWith(
    expect.objectContaining({ key: expect.objectContaining({ database: 'commandes' }) }),
    'export',
  )
})

test('le sens import demande le verdict de psql, pas celui de pg_dump', async () => {
  const pontSimule = commandes()
  monter(
    <DumpDialogs
      sens="import"
      projects={PROJET_UNIQUE}
      onClose={() => {}}
      commandes={pontSimule}
    />,
  )

  await screen.findByRole('dialog')
  expect(pontSimule.dumpAvailability).toHaveBeenCalledWith(expect.anything(), 'import')
})

test('choisir un fichier à importer lance l’inspection avant toute confirmation', async () => {
  // C'est l'ordre qui compte : un dump tronqué doit être refusé **avant** psql.
  const utilisateur = userEvent.setup()
  const pontSimule = commandes()
  monter(
    <DumpDialogs
      sens="import"
      projects={PROJET_UNIQUE}
      onClose={() => {}}
      commandes={pontSimule}
    />,
  )

  await utilisateur.click(await screen.findByRole('button', { name: /Choisir un fichier/ }))

  expect(pontSimule.inspectDump).toHaveBeenCalledWith(
    expect.objectContaining({ file: '/Users/x/dump.sql' }),
  )
  // Le fichier simulé est tronqué : la modale le dit et ne propose pas d'importer.
  expect(await screen.findByRole('dialog', { name: /incomplet/i })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Importer dans/ })).not.toBeInTheDocument()
  expect(pontSimule.startImport).not.toHaveBeenCalled()
})

test('l’export passe le chemin choisi à start_export', async () => {
  const utilisateur = userEvent.setup()
  const pontSimule = commandes()
  monter(
    <DumpDialogs
      sens="export"
      projects={PROJET_UNIQUE}
      onClose={() => {}}
      commandes={pontSimule}
    />,
  )

  await utilisateur.click(await screen.findByRole('button', { name: /Choisir le fichier/ }))

  expect(pontSimule.startExport).toHaveBeenCalledWith(
    expect.objectContaining({ file: '/Users/x/commandes.sql' }),
  )
})

test('un verdict qui échoue est rendu, et non tu', async () => {
  const pontSimule = commandes({
    dumpAvailability: vi.fn(async () => {
      throw { kind: 'locale', message: 'la base passe par un tunnel SSH : il faut l’ouvrir' }
    }),
  })
  monter(
    <DumpDialogs
      sens="export"
      projects={PROJET_UNIQUE}
      onClose={() => {}}
      commandes={pontSimule}
    />,
  )

  expect(await screen.findByText(/tunnel SSH/)).toBeInTheDocument()
})

test('le transport rendu par le cœur est dit dans la modale, à l’export comme à l’import', async () => {
  // #82 : la modale dit ce que l'outil emploiera. Ce qui est gardé ici est le **câblage** — la
  // phrase vient du verdict, pas de la variante, que ce décor règle sur autre chose.
  for (const sens of ['export', 'import'] as const) {
    const { unmount } = monter(
      <DumpDialogs
        sens={sens}
        projects={PROJET_UNIQUE}
        onClose={() => {}}
        commandes={commandes()}
      />,
    )
    expect(await screen.findByText(/autorités du système \(verify-full\)/)).toBeInTheDocument()
    unmount()
  }
})

test('sans transport — un moteur sans outil — la modale ne dit rien du transport', async () => {
  const pontSimule = commandes({
    dumpAvailability: vi.fn(async () => ({
      availability: { kind: 'noLocalDump' as const, engine: 'bigquery' as const },
      transport: null,
    })),
  })
  monter(
    <DumpDialogs
      sens="export"
      projects={PROJET_UNIQUE}
      onClose={() => {}}
      commandes={pontSimule}
    />,
  )
  await screen.findByText(/pas d'outil local/)
  expect(screen.queryByText(/^Transport/)).not.toBeInTheDocument()
})
