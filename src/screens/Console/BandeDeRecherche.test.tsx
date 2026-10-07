import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { type CommandesEditeur, SqlEditor } from './SqlEditor'

/**
 * La bande de recherche de la console (#185), montée par l'éditeur lui-même : c'est un panneau de
 * CodeMirror, donc son assemblage — le portail, l'abonnement aux transactions — n'existe qu'avec
 * lui. `ConsoleView.test.tsx` garde le chemin `⌘F` ; ici on part de la commande qu'il appelle.
 */

const LIGNE_DE_MESURE = 'abc def ghi jkl mno pqr stu vwx yz'
const texteAffiche = () =>
  [...document.querySelectorAll('.cm-content > .cm-line')]
    .map((l) => l.textContent ?? '')
    .filter((t) => !t.startsWith(LIGNE_DE_MESURE.slice(0, 11)))
    .join('\n')

function monter(texteInitial: string) {
  const commandes: { current: CommandesEditeur | null } = { current: null }
  const vus: string[] = []
  render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <SqlEditor
        texteInitial={texteInitial}
        onTexteChange={(texte) => vus.push(texte)}
        commandes={commandes}
      />
    </LanguageProvider>,
  )
  return { commandes, vus }
}

async function ouvrir(commandes: { current: CommandesEditeur | null }) {
  act(() => commandes.current?.ouvrirLaRecherche())
  return screen.findByRole('search', { name: 'Rechercher et remplacer dans la requête' })
}

const champ = () => screen.getByRole('textbox', { name: 'Rechercher dans la requête' })
const remplacement = () => screen.getByRole('textbox', { name: 'Remplacer par' })

test('la commande ouvre la bande, focus dans le champ', async () => {
  const { commandes } = monter('select 1')
  expect(screen.queryByRole('search')).toBeNull()

  await ouvrir(commandes)

  // Le focus est donné par la bande à son montage : `openSearchPanel` cherche le champ avant que
  // le portail ne l'ait rendu. Sans ce relais, `⌘F` ouvrirait une bande où il faudrait cliquer.
  expect(champ()).toHaveFocus()
})

test('la bande est en tête de l’éditeur, dans son conteneur de panneaux', async () => {
  const { commandes } = monter('select 1')
  const bande = await ouvrir(commandes)
  // `top: true` : en bas, la bande passerait sous le résultat dès que l'éditeur défile.
  expect(bande.closest('.cm-panels-top')).not.toBeNull()
})

test('la sélection devient la recherche', async () => {
  const utilisateur = userEvent.setup()
  const { commandes } = monter('orders')
  await utilisateur.click(document.querySelector('.cm-content') as HTMLElement)
  // `Mod-a` sous jsdom, qui ne se présente pas comme un Mac — voir `SqlEditor.test.tsx`.
  await utilisateur.keyboard('{Control>}a{/Control}')

  await ouvrir(commandes)

  expect(champ()).toHaveValue('orders')
})

test('la frappe compte, Entrée emmène, ⇧Entrée revient', async () => {
  const utilisateur = userEvent.setup()
  // **Trois occurrences, pas deux** : avec deux, revenir depuis la seconde et avancer en bouclant
  // mènent au même endroit, et un `⇧Entrée` qui avancerait passerait le test.
  const { commandes } = monter('select id from t\nwhere id = 1 or id = 2')
  const bande = await ouvrir(commandes)

  await utilisateur.type(champ(), 'id')
  // La frappe marque sans déplacer : il n'y a pas encore d'occurrence courante.
  expect(within(bande).getByText('3 occurrences')).toBeInTheDocument()
  expect(document.querySelectorAll('.cm-searchMatch')).toHaveLength(3)

  await utilisateur.keyboard('{Enter}')
  expect(within(bande).getByText('1 / 3')).toBeInTheDocument()
  await utilisateur.keyboard('{Enter}')
  expect(within(bande).getByText('2 / 3')).toBeInTheDocument()
  await utilisateur.keyboard('{Shift>}{Enter}{/Shift}')
  expect(within(bande).getByText('1 / 3')).toBeInTheDocument()
  // L'occurrence courante a sa propre marque : le focus est dans la bande, donc la sélection native
  // de l'éditeur ne se voit pas.
  expect(document.querySelectorAll('.cm-searchMatch-selected')).toHaveLength(1)
  // Le focus n'a pas quitté le champ : on enchaîne les `Entrée`.
  expect(champ()).toHaveFocus()
})

test('le compte suit le texte de l’éditeur, pas seulement le champ', async () => {
  const utilisateur = userEvent.setup()
  const { commandes } = monter('id')
  const bande = await ouvrir(commandes)
  await utilisateur.type(champ(), 'id')
  expect(within(bande).getByText('1 occurrence')).toBeInTheDocument()

  // Une frappe dans le texte, bande ouverte : sans l'abonnement aux transactions de l'éditeur, le
  // compte resterait celui de la dernière frappe dans le champ.
  await utilisateur.click(document.querySelector('.cm-content') as HTMLElement)
  await utilisateur.keyboard('{Control>}{End}{/Control}, id')
  expect(within(bande).getByText('2 occurrences')).toBeInTheDocument()
})

test('rien à trouver : « aucune », et les gestes sont désactivés avec leur raison', async () => {
  const utilisateur = userEvent.setup()
  const { commandes } = monter('select 1')
  const bande = await ouvrir(commandes)
  await utilisateur.type(champ(), 'orders')

  expect(within(bande).getByText('aucune')).toBeInTheDocument()
  for (const nom of [
    'Occurrence précédente',
    'Occurrence suivante',
    'Remplacer',
    'Tout remplacer',
  ]) {
    const bouton = within(bande).getByRole('button', { name: nom })
    expect(bouton).toHaveAttribute('aria-disabled', 'true')
    expect(bouton).toHaveAttribute('title', 'Aucune occurrence')
  }
})

test('un champ vide n’annonce rien', async () => {
  const { commandes } = monter('select 1')
  const bande = await ouvrir(commandes)
  // Ni « aucune » ni « 0 » : le champ n'a encore rien demandé.
  expect(within(bande).queryByText('aucune')).toBeNull()
})

test('« Tout remplacer » réécrit le texte, et ⌘Z le rend', async () => {
  const utilisateur = userEvent.setup()
  const { commandes, vus } = monter('select id from t where id = 1')
  const bande = await ouvrir(commandes)
  await utilisateur.type(champ(), 'id')
  await utilisateur.type(remplacement(), 'uid')

  await utilisateur.click(within(bande).getByRole('button', { name: 'Tout remplacer' }))

  expect(texteAffiche()).toBe('select uid from t where uid = 1')
  // Le remplacement passe par le circuit des frappes : l'écran reçoit le nouveau texte.
  expect(vus.at(-1)).toBe('select uid from t where uid = 1')

  // `Échap` ferme et rend le focus à l'éditeur, où l'annulation défait le remplacement.
  await utilisateur.keyboard('{Escape}')
  await utilisateur.keyboard('{Control>}z{/Control}')
  expect(texteAffiche()).toBe('select id from t where id = 1')
})

test('« Remplacer » remplace l’occurrence courante et passe à la suivante', async () => {
  const utilisateur = userEvent.setup()
  const { commandes } = monter('id, id')
  const bande = await ouvrir(commandes)
  await utilisateur.type(champ(), 'id')
  await utilisateur.type(remplacement(), 'x')

  // Le premier `Entrée` du champ de remplacement sélectionne la première occurrence, le second la
  // remplace — la conduite de `replaceNext`, qui ne remplace que ce qu'on a sous les yeux.
  await utilisateur.keyboard('{Enter}{Enter}')
  expect(texteAffiche()).toBe('x, id')

  await utilisateur.click(within(bande).getByRole('button', { name: 'Remplacer' }))
  expect(texteAffiche()).toBe('x, x')
})

test('Échap ferme la bande et rend le focus à l’éditeur', async () => {
  const utilisateur = userEvent.setup()
  const { commandes } = monter('select 1')
  await ouvrir(commandes)

  await utilisateur.keyboard('{Escape}')

  expect(screen.queryByRole('search')).toBeNull()
  expect(document.querySelector('.cm-content')).toHaveFocus()
})

test('Échap dans le texte ferme aussi la bande', async () => {
  const utilisateur = userEvent.setup()
  const { commandes } = monter('select 1')
  await ouvrir(commandes)
  await utilisateur.click(document.querySelector('.cm-content') as HTMLElement)

  await utilisateur.keyboard('{Escape}')

  expect(screen.queryByRole('search')).toBeNull()
})

test('la croix ferme la bande, et la recherche reste pour la prochaine fois', async () => {
  const utilisateur = userEvent.setup()
  const { commandes } = monter('select id')
  const bande = await ouvrir(commandes)
  await utilisateur.type(champ(), 'id')

  await utilisateur.click(within(bande).getByRole('button', { name: 'Fermer la recherche' }))
  expect(screen.queryByRole('search')).toBeNull()
  // Les marques partent avec la bande : un texte cerclé sans bande pour dire pourquoi.
  expect(document.querySelectorAll('.cm-searchMatch')).toHaveLength(0)

  await ouvrir(commandes)
  expect(champ()).toHaveValue('id')
})

test('rouvrir bande ouverte sélectionne le texte du champ', async () => {
  const utilisateur = userEvent.setup()
  const { commandes } = monter('select id')
  await ouvrir(commandes)
  await utilisateur.type(champ(), 'id')
  const saisie = champ() as HTMLInputElement
  saisie.setSelectionRange(2, 2)

  act(() => commandes.current?.ouvrirLaRecherche())

  // Le second `⌘F` d'une bande déjà focalisée : on retape par-dessus, comme partout.
  expect(saisie.selectionStart).toBe(0)
  expect(saisie.selectionEnd).toBe(2)
})
