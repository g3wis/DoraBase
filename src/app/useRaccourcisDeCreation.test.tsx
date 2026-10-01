import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { auModificateur } from '../test/raccourcis'
import { useRaccourcisDeCreation } from './useRaccourcisDeCreation'

function Ecran({
  nouveauDossier,
  modale = false,
}: {
  nouveauDossier: () => void
  modale?: boolean
}) {
  useRaccourcisDeCreation({ nouveauDossier })
  return (
    <>
      <input aria-label="Requête" />
      {modale ? <div role="dialog">Une modale</div> : null}
    </>
  )
}

function monter(modale = false) {
  const nouveauDossier = vi.fn()
  render(<Ecran nouveauDossier={nouveauDossier} modale={modale} />)
  return { nouveauDossier }
}

test('⌘N ouvre « Nouveau projet », et consomme la frappe', async () => {
  const { nouveauDossier } = monter()
  const consomme = await enConsommant(() => userEvent.keyboard(auModificateur('n')))
  expect(nouveauDossier).toHaveBeenCalledTimes(1)
  // Sans `preventDefault`, le navigateur ouvre une fenêtre par-dessus la modale qu'on vient d'ouvrir.
  expect(consomme).toBe(true)
})

test('⇧⌘N ne déclenche plus rien, et n’est plus consommé', async () => {
  const { nouveauDossier } = monter()
  // **Le raccourci a été retiré le 26 août 2026.** Il ouvrait « Ajouter une connexion », mais un
  // raccourci clavier ne désigne aucune ligne d'arbre : il fallait deviner le projet, donc retomber
  // sur le premier de la liste. Le geste part désormais du menu d'une ligne d'environnement.
  const consomme = await enConsommant(() => userEvent.keyboard(auModificateur('{Shift>}N{/Shift}')))
  expect(nouveauDossier).not.toHaveBeenCalled()
  // **Et il n'est pas avalé** : reprendre une frappe pour ne rien en faire est un raccourci mort. La
  // même règle que pour les deux refus — modale ouverte, zone de saisie.
  expect(consomme).toBe(false)
})

test('« n » seul ne déclenche rien', async () => {
  const { nouveauDossier } = monter()
  await userEvent.keyboard('n')
  expect(nouveauDossier).not.toHaveBeenCalled()
})

test('rien pendant qu’une modale est ouverte', async () => {
  const { nouveauDossier } = monter(true)
  await userEvent.keyboard(auModificateur('n'))
  expect(nouveauDossier).not.toHaveBeenCalled()
})

test('rien depuis une zone de saisie', async () => {
  const { nouveauDossier } = monter()
  await userEvent.click(screen.getByLabelText('Requête'))
  await userEvent.keyboard(auModificateur('n'))
  expect(nouveauDossier).not.toHaveBeenCalled()
})

/**
 * Joue un geste et dit si **quelqu'un l'a consommé** — c'est-à-dire si un `preventDefault` a été
 * appelé sur l'événement.
 *
 * `defaultPrevented` ne se lit pas sur l'événement que `userEvent` fabrique : il n'est pas rendu.
 * Un écouteur posé en dernier, sur `window`, voit donc l'état après nos crochets.
 */
async function enConsommant(geste: () => Promise<unknown>): Promise<boolean> {
  let consomme = false
  const temoin = (evenement: KeyboardEvent) => {
    consomme = evenement.defaultPrevented
  }
  window.addEventListener('keydown', temoin)
  try {
    await geste()
  } finally {
    window.removeEventListener('keydown', temoin)
  }
  return consomme
}
