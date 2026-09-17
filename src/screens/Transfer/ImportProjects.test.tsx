import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { ImportReport, ProjectOutcome } from '../../domain/transfert'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { ImportProjects } from './ImportProjects'

function sort(name: string, patch: Partial<ProjectOutcome> = {}): ProjectOutcome {
  return {
    name,
    verdict: { kind: 'created' },
    environmentsAdded: [],
    environmentsKept: [],
    connectionsAdded: [],
    connectionsKept: [],
    connectionsRejected: [],
    consolesAdded: [],
    consolesKept: [],
    passwordsStored: [],
    passwordsMissing: [],
    localPaths: [],
    ...patch,
  }
}

function rapport(projects: ProjectOutcome[], patch: Partial<ImportReport> = {}): ImportReport {
  return { version: 5, secrets: 'none', projects, ...patch }
}

function Piloté({
  onChoisirFichier = () => Promise.resolve('/tmp/projets.json'),
  onInspecter = () => Promise.resolve(rapport([sort('Atelier Nord')])),
  onImporter = () => Promise.resolve(rapport([sort('Atelier Nord')])),
}: {
  onChoisirFichier?: () => Promise<string | null>
  onInspecter?: (fichier: string) => Promise<ImportReport>
  onImporter?: (fichier: string, projets: string[] | null) => Promise<ImportReport>
}) {
  return (
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <ImportProjects
          onClose={() => {}}
          onChoisirFichier={onChoisirFichier}
          onInspecter={onInspecter}
          onImporter={onImporter}
        />
      </LanguageProvider>
    </>
  )
}

/** Choisit le fichier et attend l'aperçu. */
async function choisir() {
  await userEvent.click(screen.getByRole('button', { name: 'Choisir un fichier…' }))
  return screen.findByRole('checkbox', { name: 'Atelier Nord' })
}

test('le fichier est inspecté avant que l’import soit proposé', async () => {
  const onImporter = vi.fn(() => Promise.resolve(rapport([])))
  render(
    <Piloté
      onInspecter={() =>
        Promise.resolve(
          rapport([
            sort('Atelier Nord', {
              verdict: { kind: 'merged' },
              connectionsAdded: ['catalogue (dev)'],
              consolesAdded: ['catalogue (dev) › exploration'],
              environmentsAdded: ['dev'],
            }),
          ]),
        )
      }
      onImporter={onImporter}
    />,
  )

  // Avant le choix, rien n'est proposé à importer : l'inspection est ce qui décide.
  expect(screen.queryByRole('button', { name: /^Importer/ })).toBeNull()
  await choisir()

  expect(screen.getByText('/tmp/projets.json')).toBeVisible()
  expect(screen.getByText(/Projet existant, complété/)).toBeVisible()
  expect(
    screen.getByText(/\+1 environnement\(s\), \+1 connexion\(s\), \+1 console\(s\)/),
  ).toBeVisible()
  // **Rien n'est écrit tant que personne n'a cliqué** : c'est l'aperçu, pas l'import.
  expect(onImporter).not.toHaveBeenCalled()
})

test('décocher un projet le retire de l’appel', async () => {
  const appels: (string[] | null)[] = []
  render(
    <Piloté
      onInspecter={() => Promise.resolve(rapport([sort('Atelier Nord'), sort('Quai Sud')]))}
      onImporter={async (_, projets) => {
        appels.push(projets)
        return rapport([])
      }}
    />,
  )
  await choisir()

  // Tout est coché à l'arrivée : un fichier qu'on vient de désigner s'importe en entier par défaut.
  expect(screen.getByRole('checkbox', { name: 'Quai Sud' })).toBeChecked()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Quai Sud' }))
  expect(screen.getByRole('button', { name: 'Importer 1 projet' })).toBeVisible()

  await userEvent.click(screen.getByRole('button', { name: 'Importer 1 projet' }))

  expect(appels).toEqual([['Atelier Nord']])
})

test('tout décocher désactive le bouton avec sa raison', async () => {
  render(<Piloté />)
  await choisir()

  await userEvent.click(screen.getByRole('checkbox', { name: 'Atelier Nord' }))

  const bouton = screen.getByRole('button', { name: 'Importer 0 projets' })
  // `aria-disabled` et non `disabled` : la raison vit dans une infobulle, qu'un bouton désactivé
  // rendrait inatteignable (piège n° 3).
  expect(bouton).toHaveAttribute('aria-disabled', 'true')
  expect(bouton).toHaveAttribute('title', 'Aucun projet retenu')
})

test('un projet refusé n’a pas de case, et sa raison est écrite', async () => {
  render(
    <Piloté
      onInspecter={() =>
        Promise.resolve(
          rapport([
            sort('Atelier Nord'),
            sort('Bancal', {
              verdict: {
                kind: 'rejected',
                reason: 'le projet « Bancal » doit déclarer au moins un environnement',
              },
            }),
          ]),
        )
      }
    />,
  )
  await choisir()

  // **Aucune case plutôt qu'une case grisée** : un contrôle désactivé dit « pas maintenant », or
  // celui-ci ne pourra jamais retenir ce projet-là. Sa raison est écrite sur la ligne.
  //
  // **Le compte, et non l'absence d'une case nommée « Bancal »** : une case rendue sur cette ligne
  // n'aurait aucun nom accessible — le libellé n'est un `<label>` que sur une ligne retenue —, donc
  // une recherche par nom rendrait zéro pour la mauvaise raison. Vérifié par sabotage.
  expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  expect(screen.getByRole('checkbox', { name: 'Atelier Nord' })).toBeInTheDocument()
  expect(screen.getByText(/doit déclarer au moins un environnement/)).toBeVisible()
  // Et il ne compte pas dans ce qui s'importe.
  expect(screen.getByRole('button', { name: 'Importer 1 projet' })).toBeVisible()
})

test('ce qui n’arrivera pas est dit, avec sa liste en infobulle', async () => {
  render(
    <Piloté
      onInspecter={() =>
        Promise.resolve(
          rapport([
            sort('Atelier Nord', {
              verdict: { kind: 'merged' },
              connectionsKept: ['catalogue (dev)'],
              consolesKept: ['catalogue (dev) › exploration'],
              environmentsKept: ['prod'],
              passwordsMissing: ['catalogue (dev)'],
              localPaths: ['journal (dev) : /Users/alice/journal.db'],
              connectionsRejected: ['fantome (nulle-part)'],
            }),
          ]),
        )
      }
    />,
  )
  await choisir()

  // Le **compte** est visible, la liste est dans l'infobulle : un nom par connexion dans une modale
  // serait illisible, et le compte dit d'abord s'il y a quelque chose à regarder.
  expect(screen.getByText(/1 connexion\(s\) déjà déclarées ici/)).toHaveAttribute(
    'title',
    'catalogue (dev)',
  )
  expect(screen.getByText(/1 console\(s\) homonymes/)).toBeVisible()
  expect(screen.getByText(/1 environnement\(s\) déjà déclarés ici/)).toBeVisible()
  expect(screen.getByText(/attendent leur mot de passe/)).toBeVisible()
  expect(screen.getByText(/1 chemin\(s\) à vérifier/)).toHaveAttribute(
    'title',
    'journal (dev) : /Users/alice/journal.db',
  )
  expect(screen.getByText(/leur environnement n'est déclaré nulle part/)).toBeVisible()
})

test('une réserve vide ne paraît pas', async () => {
  // **Le contrôle négatif du test précédent** : sans lui, des lignes rendues d'office passeraient
  // aussi — et « 0 connexion(s) déjà déclarées ici » se lirait comme une réserve.
  render(<Piloté />)
  await choisir()

  expect(screen.queryByText(/déjà déclarées ici/)).toBeNull()
  expect(screen.queryByText(/mot de passe/)).toBeNull()
  expect(screen.queryByText(/à vérifier/)).toBeNull()
})

test('un fichier qui porte des mots de passe en clair le dit', async () => {
  render(
    <Piloté
      onInspecter={() => Promise.resolve(rapport([sort('Atelier Nord')], { secrets: 'embedded' }))}
    />,
  )
  await choisir()

  expect(screen.getByText('Ce fichier porte des mots de passe en clair.')).toBeVisible()
})

test('un fichier refusé le dit, et rien n’est proposé à importer', async () => {
  render(
    <Piloté
      onInspecter={() =>
        Promise.reject('ce fichier n’est pas un export de projets DoraBase : son en-tête…')
      }
    />,
  )

  await userEvent.click(screen.getByRole('button', { name: 'Choisir un fichier…' }))

  expect(await screen.findByText(/n’est pas un export de projets DoraBase/)).toBeVisible()
  expect(screen.queryByRole('button', { name: /^Importer/ })).toBeNull()
})

test('après l’import, les cases disparaissent et le rapport reste', async () => {
  render(
    <Piloté
      onImporter={() =>
        Promise.resolve(
          rapport([sort('Atelier Nord', { verdict: { kind: 'created' }, passwordsStored: ['a'] })]),
        )
      }
    />,
  )
  await choisir()
  await userEvent.click(screen.getByRole('button', { name: 'Importer 1 projet' }))

  // Il n'y a plus rien à cocher : l'import a eu lieu, et une case encore là proposerait de le
  // refaire.
  expect(await screen.findByText(/1 mot\(s\) de passe rangés/)).toBeVisible()
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(screen.queryByRole('button', { name: /^Importer/ })).toBeNull()
})

test('la modale d’import ne porte pas la disquette d’« enregistrer »', () => {
  /* **Une disquette dit « enregistrer », pas « importer »** (17 septembre 2026, à la demande).
     Le glyphe venait de la modale d'import de dump, qui l'avait déjà faux ; `ul` le remplace — le
     miroir du `dl` de l'export, même sol, une flèche qui en remonte au lieu d'y descendre.

     Le test vise le `<use>` plutôt que le nom de la prop : c'est ce que le DOM porte, donc ce qu'un
     œil voit, et il resterait juste si `Modal` changeait la façon dont il rend son icône. */
  render(<Piloté />)

  const dialogue = screen.getByRole('dialog', { name: 'Importer des projets' })
  expect(dialogue.querySelector('use[href="#i-ul"]')).not.toBeNull()
  expect(dialogue.querySelector('use[href="#i-save"]')).toBeNull()
})
