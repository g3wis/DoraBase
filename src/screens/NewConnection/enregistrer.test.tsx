import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sprite } from '../../design/icons/Sprite'
import type { SaveDatabaseRequest, SaveDatabaseResult } from '../../domain/arbre'
import type { FolderTree } from '../../domain/config'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { auModificateur } from '../../test/raccourcis'
import { emptyDraft } from './ConnectionDraft'
import { draftToSaveRequest } from './enregistrerLaBase'
import { NewConnection } from './NewConnection'
import { arbreDeTest, ID_DE_TEST, trioDeTest } from './pourLesTests'

const ARBRE: FolderTree = arbreDeTest(trioDeTest())

const APRES: FolderTree = arbreDeTest(
  trioDeTest(),
  trioDeTest({}, { id: 'f-autre', name: 'Autre' }),
)

type Espion = {
  requetes: SaveDatabaseRequest[]
  arbres: FolderTree[]
}

function monter(
  options: {
    onSave?: (request: SaveDatabaseRequest) => Promise<SaveDatabaseResult>
    arbre?: FolderTree
    onClose?: () => void
    dossier?: string | null
  } = {},
) {
  const espion: Espion = { requetes: [], arbres: [] }
  render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <NewConnection
          onClose={options.onClose ?? (() => {})}
          arbre={options.arbre ?? ARBRE}
          onBrowseKey={async () => null}
          onTest={async () => {
            throw new Error('non employé dans ces tests')
          }}
          onSave={
            options.onSave ??
            (async (request) => {
              espion.requetes.push(request)
              return { tree: APRES, connection: 'c-neuve' }
            })
          }
          // Par défaut, le sous-dossier `dev` du décor : le cadre est toujours désigné par
          // l'appelant — le menu d'une ligne de dossier.
          dossier={options.dossier === undefined ? ID_DE_TEST.dev : options.dossier}
          onSaved={(arbre) => espion.arbres.push(arbre)}
        />
      </LanguageProvider>
    </>,
  )
  return espion
}

const enregistrer = () => screen.getByRole('button', { name: /Enregistrer & ouvrir/ })

// --- La conversion du brouillon ---

test('la variante envoyée ne porte jamais de mot de passe', () => {
  const draft = { ...emptyDraft(), password: 's3cr3t', name: 'analytics' }
  const requete = draftToSaveRequest(draft, 'f-cadre')

  // Aucune `SecretRef` n'existe avant que le secret soit rangé : c'est `enregistrer` côté Rust
  // qui la fabrique. La poser ici obligerait le front à connaître la convention de nommage des
  // références, donc à la dupliquer.
  expect(requete.variant.password).toBeNull()
  expect(requete.password).toBe('s3cr3t')
})

test('un mot de passe vide devient null, pas une chaîne vide', () => {
  // Une chaîne vide se rangerait dans le magasin comme un secret légitime, et la variante
  // porterait une référence vers du vide.
  expect(draftToSaveRequest(emptyDraft(), null).password).toBeNull()
})

test('un port illisible devient 0 plutôt que NaN', () => {
  // `NaN` ferait échouer la désérialisation de `serde` avec un message illisible ; `0` produit
  // une erreur de connexion claire du côté du moteur.
  const requete = draftToSaveRequest({ ...emptyDraft(), port: 'quatre-mille' }, null)
  expect(requete.variant.port).toBe(0)
})

test('le tunnel est null quand il n’y en a pas', () => {
  // `05a` modélise `Option<Tunnel>`, et `06b` refuse une variante déclarant un tunnel qu'on n'a
  // pas ouvert : un objet à champs vides deviendrait une tentative vers un bastion sans nom.
  expect(draftToSaveRequest(emptyDraft(), null).variant.tunnel).toBeNull()
})

// --- L'enregistrement ---

test('cliquer enregistre, puis ferme la modale', async () => {
  const fermer = vi.fn()
  const espion = monter({ onClose: fermer })

  await userEvent.click(enregistrer())

  await waitFor(() => expect(espion.requetes).toHaveLength(1))
  // Le champ « Nom » n'existe plus (1er septembre 2026) : `name` est l'abréviation du moteur par
  // défaut, PostgreSQL — « psql ».
  expect(espion.requetes[0]?.name).toBe('psql')
  // Le dossier est celui du cadre, jamais un champ du brouillon (#166).
  expect(espion.requetes[0]?.folder).toBe(ID_DE_TEST.dev)
  // « Ouvrir » veut dire aller vers `A4`, qui n'existe pas avant `09` : ce scope enregistre et
  // ferme.
  await waitFor(() => expect(fermer).toHaveBeenCalledOnce())
})

test('l’arbre à jour est remonté à l’appelant', async () => {
  const espion = monter()
  await userEvent.click(enregistrer())
  // Rendus par la commande plutôt que relus : sans cela l'écran devrait faire un second
  // aller-retour, et il existerait une fenêtre où l'écran et le disque divergent.
  await waitFor(() => expect(espion.arbres).toEqual([APRES]))
})

test('⌘↩ enregistre', async () => {
  const espion = monter()
  await userEvent.keyboard(auModificateur('{Enter}'))
  await waitFor(() => expect(espion.requetes).toHaveLength(1))
})

test('⌘↩ est inopérant quand le bouton est désactivé', async () => {
  // Un raccourci qui contourne l'état d'un bouton est un piège : il ferait passer outre le refus
  // que l'écran vient d'afficher. Un enregistrement **en cours** désactive le bouton.
  let appels = 0
  monter({
    onSave: async () => {
      appels += 1
      await new Promise(() => {})
      return { tree: APRES, connection: 'c' }
    },
  })
  await userEvent.click(enregistrer())
  await waitFor(() => expect(enregistrer()).toBeDisabled())
  await userEvent.keyboard(auModificateur('{Enter}'))
  expect(appels).toBe(1)
})

test('un refus est affiché et la modale reste ouverte', async () => {
  const fermer = vi.fn()
  monter({
    onClose: fermer,
    onSave: async () => {
      throw { code: null, position: null, message: 'le nom de la base est déjà pris' }
    },
  })

  await userEvent.click(enregistrer())

  // Le refus s'affiche là où `08d` affiche déjà les échecs : `A2` ne maquette aucun message
  // d'erreur de champ. Réemploi plutôt qu'invention.
  await waitFor(() =>
    expect(screen.getByText('le nom de la base est déjà pris')).toBeInTheDocument(),
  )
  expect(fermer).not.toHaveBeenCalled()
})

test('un refus n’empêche pas de corriger puis de réessayer', async () => {
  let refuse = true
  const espion = monter({
    onSave: async (request) => {
      if (refuse) throw { code: null, position: null, message: 'nom déjà pris' }
      espion.requetes.push(request)
      return { tree: APRES, connection: 'c-neuve' }
    },
  })

  await userEvent.click(enregistrer())
  await waitFor(() => expect(screen.getByText('nom déjà pris')).toBeInTheDocument())

  refuse = false
  await userEvent.click(enregistrer())
  await waitFor(() => expect(espion.requetes).toHaveLength(1))
})

test('pendant l’enregistrement, le bouton ne se reclique pas', async () => {
  let debloquer: (() => void) | undefined
  let appels = 0
  monter({
    onSave: async () => {
      appels += 1
      await new Promise<void>((resolve) => {
        debloquer = resolve
      })
      return { tree: APRES, connection: 'c-neuve' }
    },
  })

  await userEvent.click(enregistrer())
  await waitFor(() => expect(enregistrer()).toBeDisabled())
  await userEvent.click(enregistrer())
  expect(appels).toBe(1)

  debloquer?.()
})

// --- Le dossier est le cadre (#166) ---
//
// **Les tests du parcours de création sont partis avec lui** : la bande de progression, « Plus tard »
// et la ligne « le projet est créé » décrivaient une étape 2 qui n'existe plus. Ce qui reste est que
// le dossier s'annonce en tête sans se choisir, et que la connexion s'y enregistre.

test('le chemin du dossier s’annonce en tête, et nulle part ailleurs', () => {
  monter({ dossier: ID_DE_TEST.prod })
  // **Aucun groupe « Environnement »** : la connexion se range dans le dossier d'où part le geste.
  expect(screen.queryByRole('group', { name: 'Environnement' })).toBeNull()
  expect(screen.queryByRole('combobox', { name: /Projet|Dossier/ })).toBeNull()
  expect(screen.getByTestId('dossier-de-la-modale')).toHaveTextContent('Atelier Nord › prod')
})

test('une connexion déclarée à la racine s’annonce « Racine »', () => {
  monter({ dossier: null })
  expect(screen.getByTestId('dossier-de-la-modale')).toHaveTextContent('Racine')
})

test('l’indication de tête n’est pas un contrôle', () => {
  monter()
  const indication = screen.getByTestId('dossier-de-la-modale')
  // **Pas un `Chip`, et pas cliquable** : un chip inerte se lit comme un contrôle en panne.
  expect(indication.closest('button')).toBeNull()
  expect(indication).not.toHaveAttribute('role')
})

test('la connexion est enregistrée dans le dossier du cadre, la racine comprise', async () => {
  const utilisateur = userEvent.setup()
  const espion = monter({ dossier: null })
  await utilisateur.click(enregistrer())

  await waitFor(() => expect(espion.requetes).toHaveLength(1))
  // Le cadre fait foi, et lui seul : `null` range la connexion à la racine.
  expect(espion.requetes[0]?.folder).toBeNull()
})
