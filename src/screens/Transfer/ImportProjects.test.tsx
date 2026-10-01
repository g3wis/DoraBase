import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { FolderOutcome, ImportReport, ImportSelection } from '../../domain/arbre'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { ImportProjects } from './ImportProjects'

/** Le sort d'une entrée du fichier — `null` pour la ligne des connexions à la racine (#169). */
function sort(name: string | null, patch: Partial<FolderOutcome> = {}): FolderOutcome {
  return {
    folder: name,
    verdict: { kind: 'created' },
    foldersAdded: [],
    foldersKept: [],
    foldersOmitted: [],
    readOnlyFromFile: [],
    connectionsAdded: [],
    connectionsKept: [],
    connectionsRejected: [],
    consolesAdded: [],
    consolesKept: [],
    passwordsStored: [],
    passwordsMissing: [],
    localPaths: [],
    kubeconfigsMissing: [],
    valueLabelsAdded: [],
    valueLabelsKept: [],
    ...patch,
  }
}

function rapport(folders: FolderOutcome[], patch: Partial<ImportReport> = {}): ImportReport {
  return { version: 7, secrets: 'none', folders, ...patch }
}

function Piloté({
  onChoisirFichier = () => Promise.resolve('/tmp/dossiers.json'),
  onInspecter = () => Promise.resolve(rapport([sort('Atelier Nord')])),
  onImporter = () => Promise.resolve(rapport([sort('Atelier Nord')])),
}: {
  onChoisirFichier?: () => Promise<string | null>
  onInspecter?: (fichier: string) => Promise<ImportReport>
  onImporter?: (fichier: string, selection: ImportSelection | null) => Promise<ImportReport>
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
              connectionsAdded: ['Atelier Nord › dev › catalogue'],
              consolesAdded: ['Atelier Nord › dev › catalogue › exploration'],
              foldersAdded: ['Atelier Nord › dev'],
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

  expect(screen.getByText('/tmp/dossiers.json')).toBeVisible()
  expect(screen.getByText(/Dossier existant, complété/)).toBeVisible()
  expect(
    screen.getByText(/\+1 dossier\(s\), \+1 base\(s\) de données, \+1 console\(s\)/),
  ).toBeVisible()
  // **Rien n'est écrit tant que personne n'a cliqué** : c'est l'aperçu, pas l'import.
  expect(onImporter).not.toHaveBeenCalled()
})

test('décocher un dossier le retire de l’appel', async () => {
  const appels: (ImportSelection | null)[] = []
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
  expect(screen.getByRole('button', { name: 'Importer 1 élément' })).toBeVisible()

  await userEvent.click(screen.getByRole('button', { name: 'Importer 1 élément' }))

  expect(appels).toEqual([{ folders: ['Atelier Nord'], rootConnections: false }])
})

test('les connexions de la racine ont leur ligne, nommée, et se retiennent à part', async () => {
  // **La ligne de la racine n'est pas un dossier** (#169) : elle se nomme par un libellé, ne se dit
  // pas « dossier existant », et sa case gouverne `rootConnections`, non la liste des dossiers.
  const appels: (ImportSelection | null)[] = []
  const decor = () => (
    <Piloté
      onInspecter={() =>
        Promise.resolve(
          rapport([
            sort('Atelier Nord'),
            sort(null, { verdict: { kind: 'merged' }, connectionsAdded: ['journal'] }),
          ]),
        )
      }
      onImporter={async (_, selection) => {
        appels.push(selection)
        return rapport([])
      }}
    />
  )
  const { unmount } = render(decor())
  await choisir()

  expect(screen.getByRole('checkbox', { name: 'Bases de données à la racine' })).toBeChecked()
  expect(screen.getByText(/Ajoutées à la racine/)).toBeVisible()
  expect(screen.queryByText(/Dossier existant/)).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Importer 2 éléments' }))
  expect(appels).toEqual([{ folders: ['Atelier Nord'], rootConnections: true }])
  unmount()

  // Décochée, elle ne part pas — et les dossiers, eux, restent.
  appels.length = 0
  render(decor())
  await choisir()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Bases de données à la racine' }))
  await userEvent.click(screen.getByRole('button', { name: 'Importer 1 élément' }))
  expect(appels).toEqual([{ folders: ['Atelier Nord'], rootConnections: false }])
})

test('tout décocher désactive le bouton avec sa raison', async () => {
  render(<Piloté />)
  await choisir()

  await userEvent.click(screen.getByRole('checkbox', { name: 'Atelier Nord' }))

  const bouton = screen.getByRole('button', { name: 'Importer 0 éléments' })
  // `aria-disabled` et non `disabled` : la raison vit dans une infobulle, qu'un bouton désactivé
  // rendrait inatteignable (piège n° 3).
  expect(bouton).toHaveAttribute('aria-disabled', 'true')
  expect(bouton).toHaveAttribute('title', 'Rien n’est retenu')
})

test('un dossier refusé n’a pas de case, et sa raison est écrite', async () => {
  render(
    <Piloté
      onInspecter={() =>
        Promise.resolve(
          rapport([
            sort('Atelier Nord'),
            sort('Bancal', {
              verdict: {
                kind: 'rejected',
                reason: 'le dossier « 3f0c2a91d7e4b605 » n’a pas de nom',
              },
            }),
          ]),
        )
      }
    />,
  )
  await choisir()

  // **Aucune case plutôt qu'une case grisée** : un contrôle désactivé dit « pas maintenant », or
  // celui-ci ne pourra jamais retenir ce dossier-là. Sa raison est écrite sur la ligne.
  //
  // **Le compte, et non l'absence d'une case nommée « Bancal »** : une case rendue sur cette ligne
  // n'aurait aucun nom accessible — le libellé n'est un `<label>` que sur une ligne retenue —, donc
  // une recherche par nom rendrait zéro pour la mauvaise raison. Vérifié par sabotage.
  expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  expect(screen.getByRole('checkbox', { name: 'Atelier Nord' })).toBeInTheDocument()
  expect(screen.getByText(/n’a pas de nom/)).toBeVisible()
  // Et il ne compte pas dans ce qui s'importe.
  expect(screen.getByRole('button', { name: 'Importer 1 élément' })).toBeVisible()
})

test('ce qui n’arrivera pas est dit, avec sa liste en infobulle', async () => {
  render(
    <Piloté
      onInspecter={() =>
        Promise.resolve(
          rapport([
            sort('Atelier Nord', {
              verdict: { kind: 'merged' },
              connectionsKept: ['Ailleurs › catalogue'],
              consolesKept: ['Ailleurs › catalogue › exploration'],
              foldersKept: ['Atelier Nord', 'Atelier Nord › prod'],
              readOnlyFromFile: ['Atelier Nord › prod'],
              passwordsMissing: ['Atelier Nord › dev › catalogue'],
              localPaths: ['Atelier Nord › dev › journal : /Users/alice/journal.db'],
              connectionsRejected: ['Atelier Nord › a/b'],
              valueLabelsAdded: ['Atelier Nord › orders.kind'],
              valueLabelsKept: ['Atelier Nord › orders.status'],
            }),
          ]),
        )
      }
    />,
  )
  await choisir()

  // Le **compte** est visible, la liste est dans l'infobulle : un nom par connexion dans une modale
  // serait illisible, et le compte dit d'abord s'il y a quelque chose à regarder.
  expect(screen.getByText(/1 base\(s\) de données déjà déclarées ici/)).toHaveAttribute(
    'title',
    'Ailleurs › catalogue',
  )
  expect(screen.getByText(/1 console\(s\) homonymes/)).toBeVisible()
  expect(screen.getByText(/2 dossier\(s\) déjà présents ici/)).toBeVisible()
  // **La seule chose qu'un import change à ce qui était déjà là** (#169), nommée en infobulle.
  expect(screen.getByText(/1 dossier\(s\) local\(aux\) passent en lecture seule/)).toHaveAttribute(
    'title',
    'Atelier Nord › prod',
  )
  expect(screen.getByText(/attendent leur mot de passe/)).toBeVisible()
  expect(screen.getByText(/1 chemin\(s\) à vérifier/)).toHaveAttribute(
    'title',
    'Atelier Nord › dev › journal : /Users/alice/journal.db',
  )
  expect(screen.getByText(/leur identifiant n'est pas valable/)).toBeVisible()
  /* Les libellés de valeurs (`API-75`), **et les deux sens**. Ce qui *arrive* se dit en neutre, ce
     qui est *gardé* en réserve : ce dernier est le seul des deux qui demande de savoir que le
     fichier portait autre chose. */
  expect(screen.getByText(/1 colonne\(s\) reçoivent leurs libellés/)).toHaveAttribute(
    'title',
    'Atelier Nord › orders.kind',
  )
  expect(screen.getByText(/1 colonne\(s\) déjà libellées/)).toHaveAttribute(
    'title',
    'Atelier Nord › orders.status',
  )
})

/**
 * **Un dossier qui n'apporte rien le dit** (#108) : réimporté sur son poste d'origine, un sous-dossier
 * trouve toutes ses connexions déjà ici et n'est pas créé. La ligne ne doit pas s'annoncer « Nouveau
 * dossier », et la réserve nomme le dossier omis.
 */
test('un dossier omis faute de rien apporter le dit, sans s’annoncer nouveau', async () => {
  render(
    <Piloté
      onInspecter={() =>
        Promise.resolve(
          rapport([
            sort('Atelier Nord', {
              verdict: { kind: 'omitted' },
              foldersOmitted: ['Atelier Nord'],
              connectionsKept: ['Atelier Nord › prod › catalogue'],
            }),
          ]),
        )
      }
    />,
  )
  await choisir()

  expect(screen.getByText(/Déjà ici : rien à créer/)).toBeVisible()
  expect(screen.queryByText(/Nouveau dossier/)).toBeNull()
  expect(screen.getByText(/1 dossier\(s\) non créés/)).toHaveAttribute('title', 'Atelier Nord')
})

test('une réserve vide ne paraît pas', async () => {
  // **Le contrôle négatif du test précédent** : sans lui, des lignes rendues d'office passeraient
  // aussi — et « 0 connexion(s) déjà déclarées ici » se lirait comme une réserve.
  render(<Piloté />)
  await choisir()

  expect(screen.queryByText(/déjà déclarées ici/)).toBeNull()
  expect(screen.queryByText(/mot de passe/)).toBeNull()
  expect(screen.queryByText(/à vérifier/)).toBeNull()
  expect(screen.queryByText(/libellés/)).toBeNull()
  expect(screen.queryByText(/lecture seule/)).toBeNull()
  expect(screen.queryByText(/non créés/)).toBeNull()
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
      onInspecter={() => Promise.reject('ce fichier n’est pas un export DoraBase : son en-tête…')}
    />,
  )

  await userEvent.click(screen.getByRole('button', { name: 'Choisir un fichier…' }))

  expect(await screen.findByText(/n’est pas un export DoraBase/)).toBeVisible()
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
  await userEvent.click(screen.getByRole('button', { name: 'Importer 1 élément' }))

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

  const dialogue = screen.getByRole('dialog', { name: 'Importer des dossiers' })
  expect(dialogue.querySelector('use[href="#i-ul"]')).not.toBeNull()
  expect(dialogue.querySelector('use[href="#i-save"]')).toBeNull()
})
