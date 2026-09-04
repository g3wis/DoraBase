import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { QueryResult } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { ConsoleResult } from './ConsoleResult'

const RESULTAT: QueryResult = {
  columns: ['id', 'statut', 'total'],
  rows: [
    [
      { kind: 'int', value: 7 },
      { kind: 'text', value: 'paid' },
      { kind: 'decimal', value: '12.50' },
    ],
  ],
  sql: 'select id, statut, total from commandes limit 1000',
  durationMs: 12,
  appliedLimit: null,
}

function monter(resultat: QueryResult = RESULTAT) {
  render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <ConsoleResult resultat={resultat} erreur={null} enCours={false} />
    </LanguageProvider>,
  )
  return screen.getByRole('grid')
}

const noms = (grille: HTMLElement) =>
  within(grille)
    .getAllByRole('columnheader')
    .map((entete) => entete.textContent)

const valeurs = (grille: HTMLElement) =>
  within(grille)
    .getAllByRole('gridcell')
    .map((cellule) => cellule.textContent?.replace(/\s+/g, ' '))

describe('ConsoleResult', () => {
  it('le clic droit sur un en-tête masque la colonne, et sait la rendre', async () => {
    const utilisateur = userEvent.setup()
    const grille = monter()
    expect(noms(grille)).toEqual(['id', 'statut', 'total'])

    const [, statut] = within(grille).getAllByRole('columnheader')
    if (!statut) throw new Error('en-tête introuvable')
    fireEvent.contextMenu(statut, { clientX: 40, clientY: 20 })
    await utilisateur.click(
      within(await screen.findByRole('menu', { name: 'Actions sur la colonne statut' })).getByRole(
        'menuitem',
        { name: 'Masquer la colonne' },
      ),
    )
    expect(noms(grille)).toEqual(['id', 'total'])
    expect(valeurs(grille)).toEqual(['7', '12.50'])

    // **Le chemin du retour**, et c'est ce qui autorise le masquage ici : la console n'a pas la
    // barre d'outils qui compte les colonnes dans `A5`, donc l'aller doit porter son retour.
    const [id] = within(grille).getAllByRole('columnheader')
    if (!id) throw new Error('en-tête introuvable')
    fireEvent.contextMenu(id, { clientX: 10, clientY: 20 })
    await utilisateur.click(
      within(await screen.findByRole('menu', { name: 'Actions sur la colonne id' })).getByRole(
        'menuitem',
        { name: 'Réafficher les colonnes masquées (1)' },
      ),
    )
    expect(noms(grille)).toEqual(['id', 'statut', 'total'])
  })

  it('la dernière colonne ne se masque pas : le retour disparaîtrait avec elle', async () => {
    const utilisateur = userEvent.setup()
    const grille = monter({
      ...RESULTAT,
      columns: ['seule'],
      rows: [[{ kind: 'text', value: 'x' }]],
    })

    const [seule] = within(grille).getAllByRole('columnheader')
    if (!seule) throw new Error('en-tête introuvable')
    fireEvent.contextMenu(seule, { clientX: 10, clientY: 20 })

    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Masquer la colonne' })).toBeDisabled()
    // Rien à rendre non plus : l'entrée de retour ne paraît pas quand elle n'aurait rien à faire.
    expect(within(menu).queryByRole('menuitem', { name: /Réafficher/ })).not.toBeInTheDocument()
    // Le geste n'a pas eu lieu.
    await utilisateur.keyboard('{Escape}')
    expect(noms(grille)).toEqual(['seule'])
  })

  it('une colonne se déplace aux flèches, comme dans la grille des tables', async () => {
    const utilisateur = userEvent.setup()
    const grille = monter()
    expect(noms(grille)).toEqual(['id', 'statut', 'total'])

    // Le même libellé mot pour mot qu'`A5` : le même geste ne se dit pas de deux façons.
    screen.getByRole('button', { name: 'Déplacer statut (flèches gauche et droite)' }).focus()
    await utilisateur.keyboard('{ArrowLeft}')
    expect(noms(grille)).toEqual(['statut', 'id', 'total'])
    // Les cellules ont suivi : l'ordre est celui de l'affichage, les valeurs restent les bonnes.
    expect(valeurs(grille)).toEqual(['paid', '7', '12.50'])
  })

  it('la poignée redimensionne, et la largeur posée à la main l’emporte sur l’ajustement', async () => {
    const utilisateur = userEvent.setup()
    const grille = monter()

    const poignee = within(grille).getByRole('slider', { name: 'Redimensionner statut' })
    const ajustee = Number(poignee.getAttribute('aria-valuenow'))
    poignee.focus()
    await utilisateur.keyboard('{ArrowRight}')
    // +8 : le pas clavier de la grille. La nouvelle valeur relue ici prouve que la console a bien
    // repris la largeur dans son état — sans quoi la poignée retomberait sur l'ajustement.
    expect(Number(poignee.getAttribute('aria-valuenow'))).toBe(ajustee + 8)
  })

  it('l’ordre et la largeur posés survivent à une nouvelle exécution', async () => {
    const utilisateur = userEvent.setup()
    const { rerender } = render(
      <LanguageProvider preferences={{ language: 'fr' }}>
        <ConsoleResult resultat={RESULTAT} erreur={null} enCours={false} />
      </LanguageProvider>,
    )
    const grille = screen.getByRole('grid')

    screen.getByRole('button', { name: 'Déplacer statut (flèches gauche et droite)' }).focus()
    await utilisateur.keyboard('{ArrowLeft}')
    const poignee = within(grille).getByRole('slider', { name: 'Redimensionner statut' })
    poignee.focus()
    await utilisateur.keyboard('{ArrowRight}')
    const posee = Number(poignee.getAttribute('aria-valuenow'))

    // Une nouvelle exécution : mêmes colonnes plus une — corriger sa requête ne doit pas défaire
    // la mise en page qu'on vient de régler, et la colonne inconnue de l'ordre arrive **en fin**,
    // jamais perdue.
    rerender(
      <LanguageProvider preferences={{ language: 'fr' }}>
        <ConsoleResult
          resultat={{
            ...RESULTAT,
            columns: ['id', 'statut', 'total', 'devise'],
            rows: [
              [
                { kind: 'int', value: 7 },
                { kind: 'text', value: 'paid' },
                { kind: 'decimal', value: '12.50' },
                { kind: 'text', value: 'EUR' },
              ],
            ],
          }}
          erreur={null}
          enCours={false}
        />
      </LanguageProvider>,
    )
    expect(noms(grille)).toEqual(['statut', 'id', 'total', 'devise'])
    expect(
      Number(
        within(grille)
          .getByRole('slider', { name: 'Redimensionner statut' })
          .getAttribute('aria-valuenow'),
      ),
    ).toBe(posee)
  })

  it('le clic droit sur une cellule copie sa valeur', async () => {
    const utilisateur = userEvent.setup()
    const writeText = vi.fn(async (_texte: string) => {})
    // `navigator.clipboard` n'a qu'un accesseur sous jsdom : il faut redéfinir la propriété.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const grille = monter()

    // La colonne `total` : un décimal, dont le texte copié doit être **exact**, sans regroupement
    // ni arrondi — c'est ce que `texteDeValeur` garantit, et un décimal est la valeur qui le dit.
    const cellule = within(grille).getAllByRole('gridcell')[2]
    if (!cellule) throw new Error('cellule introuvable')
    fireEvent.contextMenu(cellule, { clientX: 30, clientY: 40 })

    const menu = await screen.findByRole('menu', { name: 'Actions sur la valeur de total' })
    await utilisateur.click(within(menu).getByRole('menuitem', { name: 'Copier la valeur' }))
    expect(writeText.mock.calls[0]?.[0]).toBe('12.50')
  })
})
