import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sprite } from '../../design/icons/Sprite'
import type { SaveDatabaseRequest } from '../../domain/arbre'
import type { SslMode } from '../../domain/config'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { NewInstance, type NewInstanceProps } from '../Instances/NewInstance'
import { confirmationTlsRequise } from './engines'
import { NewConnection } from './NewConnection'
import { arbreDeTest, ID_DE_TEST, trioDeTest } from './pourLesTests'

// Le rappel d'un mode SSL non authentifiant sur une cible marquée production (#87), et le défaut qui
// le rend rare : `verify-full`.

// --- La règle ---

test.each<[SslMode, boolean]>([
  ['disable', true],
  ['allow', true],
  ['prefer', true],
  // **`require` en est** : il chiffre sans authentifier, donc il n'arrête pas un intermédiaire.
  ['require', true],
  ['verify-ca', false],
  ['verify-full', false],
])('en production, %s demande une confirmation : %s', (mode, attendu) => {
  expect(confirmationTlsRequise('postgresql', mode, true)).toBe(attendu)
})

test('hors production, aucun mode ne demande rien', () => {
  expect(confirmationTlsRequise('postgresql', 'disable', false)).toBe(false)
})

test('un moteur sans champ SSL n’a rien à confirmer', () => {
  // SQLite n'a pas de transport, BigQuery pas de réglage : le mode du brouillon n'y est jamais lu.
  expect(confirmationTlsRequise('sqlite', 'prefer', true)).toBe(false)
  expect(confirmationTlsRequise('bigquery', 'prefer', true)).toBe(false)
})

// --- A2 ---

const ARBRE = arbreDeTest(trioDeTest())

/**
 * `A2` cadré sur un dossier. **`prod` est en lecture seule** dans le décor migré : la lecture seule
 * *imposée* par un dossier est le marqueur de cible sensible qui a remplacé le drapeau `production`
 * (#168) — et jamais le réglage local, qu'un brouillon neuf a à vrai.
 */
function monterA2(dossier: string = ID_DE_TEST.dev) {
  const requetes: SaveDatabaseRequest[] = []
  render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <NewConnection
          onClose={() => {}}
          arbre={ARBRE}
          dossier={dossier}
          onBrowseKey={async () => null}
          onTest={async () => {
            throw new Error('non employé')
          }}
          onSave={async (requete) => {
            requetes.push(requete)
            return { tree: ARBRE, connection: 'c-neuve' }
          }}
        />
      </LanguageProvider>
    </>,
  )
  return requetes
}

async function choisirLeMode(mode: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Mode SSL' }))
  await userEvent.click(
    within(screen.getByRole('listbox', { name: 'Mode SSL' })).getByRole('option', { name: mode }),
  )
}

const enregistrerA2 = () => screen.getByRole('button', { name: /Enregistrer & ouvrir/ })
/**
 * **Un seul titre pour les deux appelants, et il nomme le risque** (#173) : un dossier en lecture
 * seule n'est pas forcément de production. Le chercher par ce nom, des deux côtés, est ce qui garde
 * qu'aucun appelant ne revienne à un titre à lui.
 */
const rappel = () => screen.queryByRole('dialog', { name: 'Le serveur ne sera pas authentifié' })

test('en prod, un mode non authentifiant passe par un rappel qui le nomme', async () => {
  const requetes = monterA2(ID_DE_TEST.prod)
  await choisirLeMode('prefer')

  await userEvent.click(enregistrerA2())

  const dialogue = rappel()
  expect(dialogue).not.toBeNull()
  // Le rappel nomme la cible par son libellé et le mode — deux fois : dans le corps et sur le bouton.
  expect(dialogue).toHaveTextContent('Le dossier « prod » est en lecture seule.')
  // **Rien ne dit « production »** sous un dossier en lecture seule (#173) : ni le titre, ni le
  // badge, qui suit la cible.
  expect(dialogue).toHaveTextContent('LECTURE SEULE')
  expect(dialogue).not.toHaveTextContent(/PROD|production/)
  expect(dialogue).toHaveTextContent('Le mode « prefer »')
  expect(dialogue).toHaveTextContent('repasse en clair')
  // Rien n'est parti tant qu'on n'a pas confirmé.
  expect(requetes).toHaveLength(0)

  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer en prefer' }))
  await waitFor(() => expect(requetes).toHaveLength(1))
  expect(requetes[0]?.variant.sslMode).toBe('prefer')
})

test('« Revenir » ferme le rappel sans rien enregistrer', async () => {
  const requetes = monterA2(ID_DE_TEST.prod)
  await choisirLeMode('require')
  await userEvent.click(enregistrerA2())

  await userEvent.click(screen.getByRole('button', { name: 'Revenir au formulaire' }))

  expect(rappel()).toBeNull()
  expect(requetes).toHaveLength(0)
  // Le formulaire garde ce qu'on y avait choisi : revenir n'est pas annuler.
  expect(screen.getByRole('combobox', { name: 'Mode SSL' })).toHaveTextContent('require')
})

test('en prod, le défaut verify-full enregistre sans question', async () => {
  const requetes = monterA2(ID_DE_TEST.prod)

  await userEvent.click(enregistrerA2())

  await waitFor(() => expect(requetes).toHaveLength(1))
  expect(rappel()).toBeNull()
  expect(requetes[0]?.variant.sslMode).toBe('verify-full')
})

test('hors prod, un mode non authentifiant enregistre sans question', async () => {
  // **Le contrôle négatif** : sans lui, un rappel posé sur tout mode non authentifiant, quel que
  // soit le dossier, passerait les trois tests d'au-dessus. **Et c'est aussi celui du réglage
  // local** (#168) : le brouillon neuf naît en lecture seule, donc un rappel branché sur la
  // lecture seule *effective* plutôt qu'*imposée* se déclencherait ici.
  const requetes = monterA2()
  expect(screen.getByRole('switch', { name: 'Ouvrir en lecture seule' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await choisirLeMode('prefer')

  await userEvent.click(enregistrerA2())

  await waitFor(() => expect(requetes).toHaveLength(1))
  expect(rappel()).toBeNull()
})

// --- Instance managée ---

function monterInstance() {
  const requetes: Parameters<NewInstanceProps['onEnregistrer']>[0][] = []
  render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <NewInstance
          onClose={() => {}}
          onEnregistrer={async (requete) => {
            requetes.push(requete)
          }}
        />
      </LanguageProvider>
    </>,
  )
  return requetes
}

test('une instance neuve part sur verify-full', () => {
  monterInstance()
  expect(screen.getByRole('combobox', { name: 'Mode SSL' })).toHaveTextContent('verify-full')
})

test('une instance de production en mode non authentifiant passe par le rappel', async () => {
  const requetes = monterInstance()
  await userEvent.type(screen.getByLabelText('Libellé'), 'principale')
  await userEvent.click(screen.getByRole('switch', { name: 'Instance de production' }))
  await choisirLeMode('disable')

  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer & ouvrir' }))

  expect(rappel()).toHaveTextContent('Cette instance est marquée production.')
  expect(rappel()).toHaveTextContent('PROD')
  expect(rappel()).not.toHaveTextContent('LECTURE SEULE')
  expect(rappel()).toHaveTextContent('Rien n’est chiffré.')
  expect(requetes).toHaveLength(0)

  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer en disable' }))
  await waitFor(() => expect(requetes).toHaveLength(1))
  expect(requetes[0]?.sslMode).toBe('disable')
})

test('une instance hors production enregistre sans question', async () => {
  const requetes = monterInstance()
  await userEvent.type(screen.getByLabelText('Libellé'), 'principale')
  await choisirLeMode('disable')

  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer & ouvrir' }))

  await waitFor(() => expect(requetes).toHaveLength(1))
  expect(rappel()).toBeNull()
})

// --- Les deux langues ---

test('en anglais aussi, le titre nomme le risque et le corps la cible (#173)', async () => {
  render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'en' }}>
        <NewConnection
          onClose={() => {}}
          arbre={ARBRE}
          dossier={ID_DE_TEST.prod}
          onBrowseKey={async () => null}
          onTest={async () => {
            throw new Error('non employé')
          }}
          onSave={async () => ({ tree: ARBRE, connection: 'c-neuve' })}
        />
      </LanguageProvider>
    </>,
  )
  await userEvent.click(screen.getByRole('combobox', { name: 'SSL mode' }))
  await userEvent.click(
    within(screen.getByRole('listbox', { name: 'SSL mode' })).getByRole('option', {
      name: 'require',
    }),
  )
  await userEvent.click(screen.getByRole('button', { name: /Save & open/ }))

  const dialogue = screen.getByRole('dialog', { name: 'The server will not be authenticated' })
  expect(dialogue).toHaveTextContent('The “prod” folder is read-only.')
  expect(dialogue).toHaveTextContent('READ-ONLY')
  expect(dialogue).not.toHaveTextContent(/PROD|production/)
})
