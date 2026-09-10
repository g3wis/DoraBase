import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { SelectionIndicator } from '../SelectionIndicator/SelectionIndicator'
import { TitleBar } from './TitleBar'

/**
 * Le centre de la barre de titre.
 *
 * **Passé en contenu plutôt qu'en propriétés** : `A1` n'en a aucun, les écrans de travail en ont un,
 * et son contenu a déjà changé deux fois. Une liste de propriétés grandirait à chaque écran là où un
 * contenu s'assemble chez l'appelant.
 *
 * **La prop `right` a disparu avec `25b`** : le sélecteur d'environnement en était l'unique appelant.
 */

/** La barre entière, telle que le DOM la rend — première fille du conteneur de rendu. */
const barre = (container: HTMLElement) =>
  container.querySelector('[data-tauri-drag-region]') as HTMLElement

/*
 * **Rien de sélectionné : aucune empreinte réservée** (`25b`).
 *
 * `.center` sans indicateur ne réserve aucune empreinte — la barre garde ses 40 px et les actions ne
 * bougent pas. jsdom ne mesure rien, donc ce qui est testable ici est la **structure** : le centre
 * existe, il ne porte que le logo, et les actions sont là. Une boîte fantôme n'achèterait aucune
 * stabilité, et une boîte vide bordée au centre d'une barre se lirait comme un champ à remplir.
 *
 * **Depuis `API-47`, « vide » veut dire « le logo seul »** : il vit dans cette zone, et c'est lui
 * que `A1` montre seul au milieu de sa barre.
 */
test('sans indicateur, le centre ne porte que le logo, et les actions restent', () => {
  const { container } = render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <Sprite />
      <TitleBar onOpenPreferences={() => {}} />
    </LanguageProvider>,
  )
  expect(screen.queryByText('DoraBase')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Préférences' })).toBeInTheDocument()

  // Le centre est la première zone de la barre — centre, actions — et il n'a que son logo.
  const centre = barre(container).children[0] as HTMLElement
  expect(centre.textContent).toBe('')
  expect(centre.children).toHaveLength(1)
  expect(centre.firstElementChild?.tagName).toBe('svg')
})

test('avec un centre, l’indicateur de sélection y est rendu à côté du logo', () => {
  const { container } = render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <Sprite />
      <TitleBar center={<SelectionIndicator projectName="Atelier Nord" />} />
    </LanguageProvider>,
  )
  expect(screen.getByText('Atelier Nord')).toBeInTheDocument()
  // **L'ordre compte** : le logo précède l'indicateur, comme il précédait le mot qu'il nommait.
  const centre = barre(container).children[0] as HTMLElement
  expect(centre.children).toHaveLength(2)
  expect(centre.firstElementChild?.tagName).toBe('svg')
})

/*
 * **Le parcours clavier de la barre compte un seul arrêt** : les préférences.
 *
 * Il en comptait quatre — la pastille projet et le sélecteur d'environnement occupaient les deux
 * premiers —, puis deux, puis un depuis le retrait du bouton de console. Le centre n'a plus rien de
 * focalisable, ce qui rend au passage toute la bande glissable
 * (`data-tauri-drag-region="deep"` ne s'arrête que sur les éléments focalisables).
 */
test('le parcours clavier de la barre compte un arrêt, et le centre n’en est pas', async () => {
  render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <Sprite />
      <TitleBar
        center={
          <SelectionIndicator
            projectName="Atelier Nord"
            environment={{ label: 'Atelier', color: 'green', production: true }}
            breadcrumb="catalogue · public"
          />
        }
        onOpenPreferences={() => {}}
      />
    </LanguageProvider>,
  )
  await userEvent.tab()
  expect(screen.getByRole('button', { name: 'Préférences' })).toHaveFocus()

  // Et il n'y a rien de plus : le second `Tab` sort de la barre.
  await userEvent.tab()
  expect(screen.getByRole('button', { name: 'Préférences' })).not.toHaveFocus()
})

// La barre n'a plus de prop `right` : le sélecteur d'environnement en était l'unique appelant, et
// une prop sans appelant n'est qu'un emplacement que le prochain écran remplira sans savoir pourquoi.
//
// Elle n'a plus de zone à **gauche** non plus depuis `API-47` : le wordmark en occupait une, et le
// logo qui en reste vit au centre.
test('la barre n’a que deux zones, le centre et les actions', () => {
  const { container } = render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <Sprite />
      <TitleBar center={<SelectionIndicator projectName="Atelier Nord" />} />
    </LanguageProvider>,
  )
  // Deux zones exactement : centre, actions.
  expect(barre(container).children).toHaveLength(2)
})

test('sans gestionnaire, la barre ne rend aucune action', () => {
  const { container } = render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <Sprite />
      <TitleBar />
    </LanguageProvider>,
  )
  // **Il était désactivé avec sa raison jusqu'à `API-46`**, ce qui était juste tant que tous les
  // écrans du produit passaient le gestionnaire et que la galerie était le seul appelant à ne pas le
  // faire. L'écran de travail le monte désormais sans — l'engrenage vit dans la bande en tête de sa
  // sidebar —, et un carré grisé y annoncerait un réglage inatteignable alors qu'il est à trente
  // pixels de là. C'est la leçon du défaut n° 36 par l'autre bout : un contrôle qui ne fait rien est
  // pire qu'un contrôle absent.
  expect(screen.queryByRole('button', { name: 'Préférences' })).toBeNull()

  // Et les deux zones restent deux — centre et actions depuis `API-47` : le retrait ne défait pas la
  // composition de la barre, il vide la seconde. Sans cette assertion, une barre qui perdrait sa
  // zone d'actions passerait aussi.
  expect(barre(container).children).toHaveLength(2)
})

test('avec un gestionnaire, l’engrenage l’appelle', async () => {
  const ouvrir = vi.fn()
  render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <Sprite />
      <TitleBar onOpenPreferences={ouvrir} />
    </LanguageProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Préférences' }))
  expect(ouvrir).toHaveBeenCalledTimes(1)
})
