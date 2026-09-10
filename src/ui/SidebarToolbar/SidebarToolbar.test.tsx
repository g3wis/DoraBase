import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sprite } from '../../design/icons/Sprite'
import { SidebarToolbar, SidebarToolbarButton } from './SidebarToolbar'

function monter(props: Partial<Parameters<typeof SidebarToolbarButton>[0]> = {}) {
  return render(
    <>
      <Sprite />
      <SidebarToolbar>
        <SidebarToolbarButton icon="plus" label="Nouveau projet" {...props} />
      </SidebarToolbar>
    </>,
  )
}

test('la bande s’annonce comme un groupe de contrôles', () => {
  monter()
  // `role="toolbar"` plutôt qu'un `<div>` nu : c'est ce qui fait annoncer « barre d'outils, 1 élément »
  // au lieu d'un bouton isolé au milieu de rien.
  expect(screen.getByRole('toolbar', { name: 'Actions du panneau' })).toBeInTheDocument()
})

test('une action sans libellé visible porte quand même son nom', () => {
  monter()
  // **Le nom accessible est obligatoire dans le type**, et c'est le remède au premier des quatre
  // pièges d'accessibilité de ce projet : une icône seule n'a rien qui la nomme, et un `aria-label`
  // optionnel finit par manquer.
  expect(screen.getByRole('button', { name: 'Nouveau projet' })).toBeInTheDocument()
})

test('l’infobulle porte le raccourci, le nom ne le porte pas', () => {
  monter({ title: 'Nouveau projet (⌘N)' })
  const bouton = screen.getByRole('button', { name: 'Nouveau projet' })
  // Une infobulle *décrit*, elle ne *nomme* pas : le nom annoncé reste la fonction, jamais le
  // raccourci — sinon la voix lit « Nouveau projet commande N ».
  expect(bouton).toHaveAttribute('title', 'Nouveau projet (⌘N)')
})

test('le clic appelle l’action', async () => {
  const clic = vi.fn()
  monter({ onClick: clic })
  await userEvent.click(screen.getByRole('button', { name: 'Nouveau projet' }))
  expect(clic).toHaveBeenCalledOnce()
})

/**
 * Deux actions dans la bande (`API-46`), **groupées à gauche**.
 *
 * Ce qui est mesurable ici est l'ordre du DOM, qui est celui du parcours clavier ; la mise en page,
 * elle, est hors de portée de jsdom (règle n° 9), et c'est `geometrie-reelle` qui garde que les deux
 * carrés sont voisins. Une variante poussait les préférences contre le bord droit ; elle est partie le
 * jour même — voir la note du composant.
 */
test('deux actions se suivent dans la bande, sans enveloppe intermédiaire', () => {
  render(
    <>
      <Sprite />
      <SidebarToolbar>
        <SidebarToolbarButton icon="plus" label="Nouveau projet" onClick={() => {}} />
        <SidebarToolbarButton icon="slid" label="Préférences" onClick={() => {}} />
      </SidebarToolbar>
    </>,
  )
  const bande = screen.getByRole('toolbar')
  // Enfants directs : c'est ce qui interdit une enveloppe de rangement au milieu, dont l'`auto`
  // déplacerait le second carré sans que le DOM en dise rien.
  expect(bande.children).toHaveLength(2)
  const plus = screen.getByRole('button', { name: 'Nouveau projet' })
  const reglages = screen.getByRole('button', { name: 'Préférences' })
  expect(plus.compareDocumentPosition(reglages)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
})
