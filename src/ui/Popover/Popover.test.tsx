import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Popover } from './Popover'

function monter(content = <button type="button">égal</button>) {
  return render(
    <>
      <Popover title="Opérateur · status" content={content}>
        <button type="button">status</button>
      </Popover>
      <button type="button">ailleurs</button>
    </>,
  )
}

describe('Popover', () => {
  it('s’ouvre au clic et annonce son état', async () => {
    const utilisateur = userEvent.setup()
    monter()
    const declencheur = screen.getByRole('button', { name: 'status' })

    expect(declencheur).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await utilisateur.click(declencheur)
    expect(declencheur).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: 'Opérateur · status' })).toBeInTheDocument()
  })

  it('se ferme sur Échap, et rend le focus au déclencheur', async () => {
    const utilisateur = userEvent.setup()
    monter()
    const declencheur = screen.getByRole('button', { name: 'status' })

    await utilisateur.click(declencheur)
    await utilisateur.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(declencheur).toHaveFocus()
  })

  it('se ferme sur un clic extérieur', async () => {
    const utilisateur = userEvent.setup()
    monter()

    await utilisateur.click(screen.getByRole('button', { name: 'status' }))
    await utilisateur.click(screen.getByRole('button', { name: 'ailleurs' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('se ferme sur un clic dans le vide, qui ne déplace aucun focus', async () => {
    const utilisateur = userEvent.setup()
    render(
      <>
        <Popover title="Opérateur" content={<button type="button">égal</button>}>
          <button type="button">status</button>
        </Popover>
        {/* Une zone inerte : cliquer dessus ne donne le focus à personne, donc `blur` ne se
            déclenche pas. C'est le seul cas qui exerce vraiment la fermeture au pointeur — sans
            lui, le test du clic extérieur passerait pour la mauvaise raison. */}
        <div data-testid="vide" style={{ width: 100, height: 100 }} />
      </>,
    )

    await utilisateur.click(screen.getByRole('button', { name: 'status' }))
    await utilisateur.click(screen.getByTestId('vide'))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('se ferme quand le focus sort au clavier', async () => {
    const utilisateur = userEvent.setup()
    monter()

    await utilisateur.click(screen.getByRole('button', { name: 'status' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Tabuler depuis le contenu jusqu'au bouton extérieur : c'est la fermeture qu'on oublie,
    // et sans elle le panneau resterait visible sans plus rien concerner.
    await utilisateur.tab()
    await utilisateur.tab()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('un clic dans le panneau ne le ferme pas', async () => {
    const utilisateur = userEvent.setup()
    monter()

    await utilisateur.click(screen.getByRole('button', { name: 'status' }))
    await utilisateur.click(screen.getByRole('button', { name: 'égal' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  // **La décision, faute de mise en page** : jsdom ne calcule rien, donc ce qui est mesurable ici
  // est le sens choisi, pas le panneau posé. Ce que ce sens *produit* — un panneau réellement dans
  // la fenêtre — reste hors de portée de Vitest. Le seul appelant de `'haut'` a disparu le
  // 2 septembre 2026 avec l'annonce de mise à jour ; voir la prop, qui dit pourquoi elle reste.
  it('s’ouvre vers le bas par défaut', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await utilisateur.click(screen.getByRole('button', { name: 'status' }))
    expect(screen.getByRole('dialog')).toHaveAttribute('data-ouverture', 'bas')
  })

  it('s’ouvre vers le haut quand l’appelant le demande — un déclencheur au bas de la fenêtre', async () => {
    const utilisateur = userEvent.setup()
    render(
      <Popover title="Version 0.2.1" ouvertureVers="haut" content={<span>notes</span>}>
        <button type="button">disponible</button>
      </Popover>,
    )
    await utilisateur.click(screen.getByRole('button', { name: 'disponible' }))
    expect(screen.getByRole('dialog')).toHaveAttribute('data-ouverture', 'haut')
  })

  it('le contenu peut refermer lui-même, et le focus revient', async () => {
    const utilisateur = userEvent.setup()
    render(
      <Popover
        title="Opérateur"
        content={(fermer) => (
          <button type="button" onClick={fermer}>
            choisir
          </button>
        )}
      >
        <button type="button">status</button>
      </Popover>,
    )

    await utilisateur.click(screen.getByRole('button', { name: 'status' }))
    await utilisateur.click(screen.getByRole('button', { name: 'choisir' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'status' })).toHaveFocus()
  })
})
