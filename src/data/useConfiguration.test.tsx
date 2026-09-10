import { render, screen, waitFor } from '@testing-library/react'
import type { ConfigLoad } from '../domain/config'
import { TRIO_DE_TEST } from '../screens/NewConnection/pourLesTests'
import { PREFERENCES_PAR_DEFAUT } from '../screens/Preferences/preferences'
import { type EtatDeDemarrage, useConfiguration } from './useConfiguration'

function Sonde({ charger }: { charger: () => Promise<ConfigLoad> }) {
  const etat: EtatDeDemarrage = useConfiguration(charger)
  return (
    <div>
      <span data-testid="kind">{etat.kind}</span>
      <span data-testid="projets">{etat.kind === 'chargement' ? '' : etat.projects.length}</span>
      <span data-testid="raison">
        {etat.kind === 'blocked' || etat.kind === 'injoignable' ? etat.reason : ''}
      </span>
    </div>
  )
}

// L'état de chargement est distinct d'un état vide : afficher « aucun projet » pendant la
// lecture ferait clignoter l'écran d'accueil devant un utilisateur qui en a dix.
test('l’état de départ est le chargement, pas le vide', () => {
  render(<Sonde charger={() => new Promise(() => {})} />)
  expect(screen.getByTestId('kind')).toHaveTextContent('chargement')
})

test('un fichier lu remplit les projets', async () => {
  render(
    <Sonde
      charger={async () => ({
        kind: 'loaded',
        projects: [
          {
            name: 'Halle',
            environments: TRIO_DE_TEST,
            databases: [],
            queries: [],
          },
        ],
        preferences: PREFERENCES_PAR_DEFAUT,
        instances: [],
      })}
    />,
  )
  await waitFor(() => expect(screen.getByTestId('kind')).toHaveTextContent('loaded'))
  expect(screen.getByTestId('projets')).toHaveTextContent('1')
})

test('un premier lancement donne un état neuf', async () => {
  render(<Sonde charger={async () => ({ kind: 'fresh' })} />)
  await waitFor(() => expect(screen.getByTestId('kind')).toHaveTextContent('fresh'))
})

test('un fichier illisible bloque, avec sa raison', async () => {
  render(
    <Sonde
      charger={async () => ({
        kind: 'unreadable',
        reason: 'JSON invalide',
        quarantinedTo: '/tmp/x',
      })}
    />,
  )
  await waitFor(() => expect(screen.getByTestId('kind')).toHaveTextContent('blocked'))
  expect(screen.getByTestId('raison')).toHaveTextContent('JSON invalide')
})

// Un pont cassé n'est pas un fichier illisible : là le fichier est en cause et l'écriture est
// bloquée ; ici c'est l'app qui ne répond pas, et rien ne dit ce qu'il y a sur le disque. Les
// confondre proposerait de restaurer un fichier qui va peut-être très bien.
test('un échec de la commande est distinct d’un fichier illisible', async () => {
  render(
    <Sonde
      charger={async () => {
        throw new Error('le pont ne répond pas')
      }}
    />,
  )
  await waitFor(() => expect(screen.getByTestId('kind')).toHaveTextContent('injoignable'))
  expect(screen.getByTestId('raison')).toHaveTextContent('le pont ne répond pas')
})

test('une erreur en chaîne est affichée telle quelle', async () => {
  render(
    <Sonde
      charger={async () => {
        throw 'panique de commande'
      }}
    />,
  )
  await waitFor(() => expect(screen.getByTestId('raison')).toHaveTextContent('panique de commande'))
})

// Sans le drapeau de vivacité, la réponse arrivée après démontage poserait un état sur un
// composant démonté — et surtout, un écran démonté n'a rien à afficher.
test('une réponse arrivée après démontage ne pose aucun état', async () => {
  let resoudre: ((issue: ConfigLoad) => void) | undefined
  const { unmount } = render(
    <Sonde
      charger={() =>
        new Promise<ConfigLoad>((r) => {
          resoudre = r
        })
      }
    />,
  )
  unmount()
  resoudre?.({ kind: 'fresh' })
  // Aucun avertissement React, et rien à assener sinon que cela ne casse pas.
  await new Promise((r) => setTimeout(r, 0))
})
