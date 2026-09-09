import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { TransactionState, TransactionStatement } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { TransactionPanel } from './TransactionPanel'

function instruction(partielle: Partial<TransactionStatement> = {}): TransactionStatement {
  return {
    sql: 'update commandes set statut = 1',
    durationMs: 4,
    returned: 0,
    affected: 3,
    displayable: false,
    error: null,
    ...partielle,
  }
}

function monter(
  etat: Omit<TransactionState, 'aborted'> & { aborted?: boolean },
  props: Partial<Parameters<typeof TransactionPanel>[0]> = {},
) {
  return render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <TransactionPanel etat={{ aborted: false, ...etat }} {...props} />
    </LanguageProvider>,
  )
}

test('sans transaction ouverte, le panneau dit ce qui va se passer', () => {
  monter({ open: false, statements: [] })
  // **Il paraît avant la première instruction** : le mode se règle dans la barre d'outils, et la
  // transaction ne s'ouvre qu'à l'exécution. Une colonne vide entre les deux ne dirait rien du
  // régime dans lequel on vient d'entrer.
  expect(screen.getByText(/Rien n’est encore retenu/)).toBeInTheDocument()
})

test('sans transaction ouverte, les deux boutons portent leur raison', () => {
  const valider = vi.fn()
  monter({ open: false, statements: [] }, { onValider: valider })
  const bouton = screen.getByRole('button', { name: 'Valider' })

  // **`aria-disabled`, jamais `disabled`** : un bouton désactivé ne reçoit ni survol ni focus, donc
  // son infobulle serait inatteignable là où elle explique (piège n° 3).
  expect(bouton).toHaveAttribute('aria-disabled', 'true')
  expect(bouton).not.toBeDisabled()
  expect(bouton).toHaveAttribute('title', expect.stringContaining('rien à valider'))
  expect(screen.getByRole('button', { name: 'Annuler' })).toHaveAttribute(
    'title',
    expect.stringContaining('rien à annuler'),
  )
})

test('un bouton figé ne déclenche rien', async () => {
  const utilisateur = userEvent.setup()
  const valider = vi.fn()
  monter({ open: false, statements: [] }, { onValider: valider })
  await utilisateur.click(screen.getByRole('button', { name: 'Valider' }))
  // Le pendant du test précédent : `aria-disabled` n'empêche pas le clic, c'est le gestionnaire
  // retiré qui l'empêche. Sans cette moitié, la garde serait décorative.
  expect(valider).not.toHaveBeenCalled()
})

test('une écriture annonce les lignes touchées, une lecture celles qu’elle rend', () => {
  monter({
    open: true,
    statements: [
      instruction({ sql: 'update commandes set statut = 1', affected: 3, returned: 0 }),
      instruction({ sql: 'select * from commandes', affected: null, returned: 12 }),
    ],
  })

  // **Le mensonge que `affected` existe pour éviter** : sans lui, l'`update` afficherait « 0 ligne
  // rendue » — vrai de ce qu'il rend, faux de ce qu'il a fait, et c'est le chiffre qui décide d'une
  // validation.
  expect(screen.getByText('3 lignes touchées')).toBeInTheDocument()
  expect(screen.getByText('12 lignes rendues')).toBeInTheDocument()
})

/** Une lecture : elle a rendu des lignes, donc le cœur en a gardé la réponse. */
function lecture(partielle: Partial<TransactionStatement> = {}) {
  return instruction({
    sql: 'select jour, commandes from ventes',
    affected: null,
    returned: 12,
    displayable: true,
    ...partielle,
  })
}

test('une lecture se désigne pour remettre sa réponse dans la grille', async () => {
  const utilisateur = userEvent.setup()
  const afficher = vi.fn()
  monter({ open: true, statements: [lecture()] }, { onAfficher: afficher })

  expect(screen.getByText('#1')).toBeInTheDocument()
  // **Le nom du bouton dit ce qu'un clic fera**, en plus de ce que la carte montre : concaténé, il
  // rendrait « #1 12 lignes rendues 4 ms select … », qui décrit sans annoncer.
  const carte = screen.getByRole('button', { name: /Afficher ce résultat dans la grille/ })
  expect(carte).toHaveAttribute('aria-pressed', 'false')
  await utilisateur.click(carte)
  // Le **rang**, celui du journal : c'est par lui que le cœur retrouve la réponse, et comme le
  // journal est celui de cette console, c'est aussi la place de la carte.
  expect(afficher).toHaveBeenCalledWith(0)
})

test('l’instruction affichée porte sa marque, et elle seule', () => {
  monter(
    { open: true, statements: [lecture(), lecture({ sql: 'select 2' })] },
    { onAfficher: () => {}, affichee: 1 },
  )
  const cartes = screen.getAllByRole('button', { name: /Afficher ce résultat/ })
  expect(cartes[0]).toHaveAttribute('aria-pressed', 'false')
  expect(cartes[1]).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('#2')).toBeInTheDocument()
})

test('une écriture ne se désigne pas : son compte est sa réponse', () => {
  monter(
    { open: true, statements: [instruction({ affected: 3, returned: 0 })] },
    {
      onAfficher: () => {},
    },
  )
  // `displayable` est faux : il n'y a aucune ligne à remettre dans une grille, et un clic ne ferait
  // que la vider. Le compte de lignes touchées est déjà là.
  expect(screen.queryByRole('button', { name: /Afficher ce résultat/ })).toBeNull()
  expect(screen.getByText('3 lignes touchées')).toBeInTheDocument()
})

test('sans geste d’affichage, aucune carte n’est cliquable', () => {
  // La vitrine et les tests qui ne portent pas sur ce geste montent le panneau sans lui : une carte
  // cliquable et inerte se lirait comme une panne (défaut n° 36).
  monter({ open: true, statements: [lecture()] })
  expect(screen.queryByRole('button', { name: /Afficher ce résultat/ })).toBeNull()
})

test('une instruction refusée est listée avec son message', () => {
  monter({
    open: true,
    statements: [instruction({ error: 'relation « commande » inexistante', affected: null })],
  })
  // Elle fait partie de ce qui s'est passé — et sur PostgreSQL c'est même elle qu'on cherche, la
  // transaction étant abandonnée jusqu'à son annulation.
  expect(screen.getByText('relation « commande » inexistante')).toBeInTheDocument()
  expect(screen.getByText('refusée')).toBeInTheDocument()
})

test('les deux issues appellent leur geste', async () => {
  const utilisateur = userEvent.setup()
  const valider = vi.fn()
  const annuler = vi.fn()
  monter({ open: true, statements: [instruction()] }, { onValider: valider, onAnnuler: annuler })

  await utilisateur.click(screen.getByRole('button', { name: 'Valider' }))
  await utilisateur.click(screen.getByRole('button', { name: 'Annuler' }))
  expect(valider).toHaveBeenCalledTimes(1)
  expect(annuler).toHaveBeenCalledTimes(1)
})

test('une transaction abandonnée n’offre plus que l’annulation', () => {
  monter(
    {
      open: true,
      aborted: true,
      statements: [
        instruction({ affected: 3 }),
        instruction({ error: 'relation « commande » inexistante', affected: null }),
      ],
    },
    { onValider: () => {}, onAnnuler: () => {} },
  )

  // **Retiré, et non grisé** : un `commit` sur une transaction abandonnée se comporte comme un
  // `rollback`, donc le bouton promettrait l'inverse de son acte — pire qu'un bouton absent.
  expect(screen.queryByRole('button', { name: 'Valider' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument()
  // Et la raison prend sa place, écrite : un bouton disparu sans explication ferait chercher où il
  // est passé.
  expect(screen.getByText(/le moteur a abandonné la transaction/)).toBeInTheDocument()
})

test('une transaction qui a échoué sans être abandonnée garde sa validation', () => {
  monter(
    {
      open: true,
      aborted: false,
      statements: [instruction({ error: 'contrainte violée', affected: null })],
    },
    { onValider: () => {}, onAnnuler: () => {} },
  )

  // **C'est le moteur qui décide, pas l'échec.** SQLite et MySQL n'abandonnent pas : leurs
  // instructions précédentes restent validables, et conclure de l'erreur seule leur retirerait une
  // capacité qu'ils ont. Sans ce test, l'écran pourrait le déduire sans que rien ne le dise.
  expect(screen.getByRole('button', { name: 'Valider' })).toBeInTheDocument()
  expect(screen.queryByText(/le moteur a abandonné/)).toBeNull()
})

test('le refus d’une validation s’affiche, et il s’annonce', () => {
  monter(
    { open: true, statements: [instruction()] },
    { erreur: 'la transaction a été annulée : conflit de sérialisation' },
  )
  // `role="alert"` sur celui-là seulement : c'est la réponse à un geste, là où les échecs
  // d'instructions **racontent** ce qui s'est passé.
  expect(screen.getByRole('alert')).toHaveTextContent(/conflit de sérialisation/)
})

test('pendant la validation, les deux boutons attendent', () => {
  monter({ open: true, statements: [instruction()] }, { enCours: true })
  expect(screen.getByRole('button', { name: 'Validation…' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  expect(screen.getByRole('button', { name: 'Annuler' })).toHaveAttribute('aria-disabled', 'true')
})

test('le compte des instructions est celui de la transaction', () => {
  monter({ open: true, statements: [instruction(), instruction(), instruction()] })
  const panneau = screen.getByRole('complementary', { name: 'Transaction en cours' })
  // Le nom accessible du panneau vient de l'`<aside>` : un `aria-label` sur un élément sans rôle
  // serait ignoré (piège n° 2), et c'est le seul moyen de le distinguer du panneau des
  // modifications de la grille.
  expect(panneau).toBeInTheDocument()
  expect(screen.getAllByRole('listitem')).toHaveLength(3)
})
