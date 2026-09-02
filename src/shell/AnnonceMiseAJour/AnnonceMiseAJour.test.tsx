import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { AnnonceMiseAJour } from './AnnonceMiseAJour'

function monter(props: Parameters<typeof AnnonceMiseAJour>[0]) {
  return render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <AnnonceMiseAJour {...props} />
      </LanguageProvider>
    </>,
  )
}

// **Le cas nominal est de ne rien afficher.** C'est aussi celui de tous les autres tests du
// produit, de la galerie et de Playwright : hors de la webview, la recherche est rejetée.
test("ne rend rien quand la recherche échoue — le pont ne répond pas hors de l'application", async () => {
  const { container } = monter({
    chercher: () => Promise.reject(new Error('pont absent')),
    onInstaller: vi.fn(),
  })
  await waitFor(() => expect(container.querySelector('[role="status"]')).toBeNull())
})

test("ne rend rien quand il n'y a pas de version plus récente", async () => {
  const { container } = monter({ chercher: () => Promise.resolve(null), onInstaller: vi.fn() })
  await waitFor(() => expect(container.querySelector('[role="status"]')).toBeNull())
})

test('annonce la version trouvée', async () => {
  monter({
    chercher: () => Promise.resolve({ version: '0.2.0', notes: null }),
    onInstaller: vi.fn(),
  })
  // **Le nom accessible se concatène sans espace** dès qu'un composant place deux contenus côte à
  // côte : le numéro est dans un `<strong>`, donc les espaces qui l'entourent doivent être
  // explicites. Le motif est **ancré** — sans les bornes, il compterait aussi une phrase plus
  // longue qui commencerait pareil.
  const annonce = await screen.findByRole('status', { name: 'Mise à jour disponible' })
  expect(annonce).toHaveTextContent(/^La version 0\.2\.0 est disponible/)
})

// **Le chemin, pas seulement le résultat visible** : ce qui compte est que le clic remette la mise
// à jour *trouvée* à l'appelant — c'est elle qui évite à `A10` de refaire la recherche. Un test qui
// ne vérifierait que l'appel resterait vert si la notification passait `null`.
test("« Installer » remet la mise à jour trouvée à l'appelant", async () => {
  const utilisateur = userEvent.setup()
  const onInstaller = vi.fn()
  monter({
    chercher: () => Promise.resolve({ version: '0.2.0', notes: 'Deux moteurs de plus.' }),
    onInstaller,
  })
  await utilisateur.click(await screen.findByRole('button', { name: 'Installer' }))
  expect(onInstaller).toHaveBeenCalledWith({ version: '0.2.0', notes: 'Deux moteurs de plus.' })
})

// La notification s'efface en menant aux préférences : la modale la couvrirait, et la retrouver en
// la fermant redemanderait ce qu'on vient d'aller faire.
test('« Installer » efface la notification', async () => {
  const utilisateur = userEvent.setup()
  monter({
    chercher: () => Promise.resolve({ version: '0.2.0', notes: null }),
    onInstaller: vi.fn(),
  })
  await utilisateur.click(await screen.findByRole('button', { name: 'Installer' }))
  expect(screen.queryByRole('status')).toBeNull()
})

test("la croix écarte la notification, sans rien demander à l'appelant", async () => {
  const utilisateur = userEvent.setup()
  const onInstaller = vi.fn()
  monter({ chercher: () => Promise.resolve({ version: '0.2.0', notes: null }), onInstaller })
  await utilisateur.click(await screen.findByRole('button', { name: 'Écarter la notification' }))
  expect(screen.queryByRole('status')).toBeNull()
  expect(onInstaller).not.toHaveBeenCalled()
})

// **« Une seule recherche » est une propriété du produit**, et `StrictMode` monte deux fois en
// développement. Sans la mémoïsation, ce sont deux requêtes réseau pour une promesse au produit.
test('deux montages de la même recherche ne comptent que pour un appel', async () => {
  let appels = 0
  const chercher = () => {
    appels += 1
    return Promise.resolve({ version: '0.2.0', notes: null })
  }
  monter({ chercher, onInstaller: vi.fn() })
  monter({ chercher, onInstaller: vi.fn() })
  await screen.findAllByRole('button', { name: 'Installer' })
  expect(appels).toBe(1)
})
