import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { DumpAvailability, Inspection } from '../../domain/dump'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { ImportDump } from './ImportDump'

const CIBLE = { chemin: 'Boutique › staging', base: 'commandes' }
const FICHIER = '/Users/x/dump.sql'

const PSQL_PRET: DumpAvailability = {
  kind: 'ready',
  tool: '/opt/homebrew/opt/postgresql@17/bin/psql',
  version: { majeure: 17, mineure: 4 },
}

function inspection(kind: Inspection['kind']): Inspection {
  switch (kind) {
    case 'pgDump':
      return { kind: 'pgDump', origine: { majeure: 17, mineure: 6 } }
    case 'tronque':
      return { kind: 'tronque' }
    case 'tropRecent':
      return {
        kind: 'tropRecent',
        origine: { majeure: 18, mineure: 1 },
        cible: { majeure: 17, mineure: 6 },
      }
    case 'etranger':
      return { kind: 'etranger' }
    case 'vide':
      return { kind: 'vide' }
    case 'illisible':
      return { kind: 'illisible', cause: 'No such file or directory' }
  }
}

function monter(options: Partial<Parameters<typeof ImportDump>[0]> = {}) {
  // Langue figée : voir la note de `ExportDump.test.tsx`.
  return render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <ImportDump
        availability={PSQL_PRET}
        cible={CIBLE}
        fichier={FICHIER}
        onClose={() => {}}
        onChoisirFichier={async () => null}
        onImporter={async () => {}}
        {...options}
      />
    </LanguageProvider>,
  )
}

test('nomme le chemin, la connexion et le fichier avant de laisser confirmer', () => {
  monter({ inspection: inspection('pgDump') })

  // L'erreur que la modale empêche est de se tromper de cible : c'est nommer la cible qui
  // l'empêche, pas une case à cocher.
  const dialogue = screen.getByRole('dialog', { name: /Importer un dump/i })
  expect(dialogue).toHaveTextContent('Boutique')
  expect(dialogue).toHaveTextContent('commandes')
  expect(dialogue).toHaveTextContent('staging')
  expect(dialogue).toHaveTextContent(FICHIER)
  expect(screen.getByRole('button', { name: /Importer dans commandes/ })).toBeInTheDocument()
})

test.each([
  ['tronque', /incomplet/i],
  ['tropRecent', /version.*plus récente/i],
  ['etranger', /pas été produit par pg_dump/i],
  ['vide', /vide/i],
  ['illisible', /pas pu être lu/i],
] as const)('l’issue %s rend un message distinct', (kind, attendu) => {
  const { unmount } = monter({ inspection: inspection(kind) })
  expect(screen.getByRole('dialog', { name: attendu })).toBeInTheDocument()
  unmount()
})

test('les six titres d’inspection sont deux à deux distincts', () => {
  // Contrôle positif : six expressions régulières pourraient toutes tomber sur un titre
  // fourre-tout qui les contiendrait toutes.
  const titres = (
    ['pgDump', 'tronque', 'tropRecent', 'etranger', 'vide', 'illisible'] as const
  ).map((kind) => {
    const { unmount } = monter({ inspection: inspection(kind) })
    const titre = screen.getByRole('dialog').getAttribute('aria-label')
    unmount()
    return titre
  })
  expect(new Set(titres).size).toBe(6)
})

test('un fichier tronqué ne laisse pas confirmer l’import', () => {
  // Le refus est côté Rust — mais proposer le bouton reviendrait à annoncer une action que
  // la commande refusera, ce qui ferait douter du refus.
  monter({ inspection: inspection('tronque') })
  expect(screen.queryByRole('button', { name: /Importer dans/ })).not.toBeInTheDocument()
})

test('un fichier étranger laisse confirmer, lui', () => {
  // Contrôle positif du test précédent : sans lui, « ne laisse pas confirmer » pourrait
  // valoir pour toutes les issues, et la spec accepte explicitement un fichier venu
  // d'ailleurs.
  monter({ inspection: inspection('etranger') })
  expect(screen.getByRole('button', { name: /Importer dans commandes/ })).toBeInTheDocument()
})

test('sans fichier choisi, il n’y a rien à confirmer', () => {
  monter({ inspection: null, fichier: undefined })
  expect(screen.queryByRole('button', { name: /Importer dans/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Choisir un fichier/ })).toBeInTheDocument()
})

test('psql manquant n’offre ni choix de fichier ni import', () => {
  // `ToolMissing` du binaire d'**import**, et non de celui d'export.
  monter({ availability: { kind: 'toolMissing', binary: 'psql' }, inspection: null })
  expect(screen.getByRole('dialog', { name: /psql.*introuvable/i })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Choisir un fichier/ })).not.toBeInTheDocument()
})

test('l’import échoué rend le message de psql tel quel', async () => {
  const utilisateur = userEvent.setup()
  monter({
    inspection: inspection('pgDump'),
    onImporter: async () => {
      throw { kind: 'echec', message: 'psql a échoué (code 3) : relation « users » existe déjà' }
    },
  })

  await utilisateur.click(screen.getByRole('button', { name: /Importer dans commandes/ }))
  expect(await screen.findByText(/existe déjà/)).toBeInTheDocument()
})

test('l’import réussi le dit', async () => {
  const utilisateur = userEvent.setup()
  const importer = vi.fn(async () => {})
  monter({ inspection: inspection('pgDump'), onImporter: importer })

  await utilisateur.click(screen.getByRole('button', { name: /Importer dans commandes/ }))

  expect(importer).toHaveBeenCalledWith(FICHIER)
  expect(await screen.findByText(/Import terminé/)).toBeInTheDocument()
})
