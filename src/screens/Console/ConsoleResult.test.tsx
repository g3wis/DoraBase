import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ExportFormat, QueryResult } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { ConsoleResult } from './ConsoleResult'
import type { IssueDExport } from './exportResultat'

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
  affected: null,
}

/**
 * Le harnais d'état : les masquées et l'ordre vivent chez l'écran (`ConsoleView`) depuis que la
 * barre d'outils montre le menu des colonnes et que chaque geste réécrit la requête — le composant
 * les reçoit. Le harnais rejoue cette tenue d'état, sans l'éditeur.
 */
function Harnais({
  resultat = RESULTAT,
  onExporter,
  dialecte,
}: {
  resultat?: QueryResult
  onExporter?: (format: ExportFormat) => Promise<IssueDExport>
  dialecte?: 'sql' | 'mongo'
}) {
  const [masquees, setMasquees] = useState<ReadonlySet<string>>(new Set())
  const [ordre, setOrdre] = useState<readonly string[] | null>(null)
  return (
    <ConsoleResult
      resultat={resultat}
      erreur={null}
      enCours={false}
      dialecte={dialecte}
      onExporter={onExporter}
      masquees={masquees}
      ordre={ordre}
      onBasculerColonne={(nom) =>
        setMasquees((precedent) => {
          const suivantes = new Set(precedent)
          if (suivantes.has(nom)) suivantes.delete(nom)
          else suivantes.add(nom)
          return suivantes
        })
      }
      onReafficher={() => setMasquees(new Set())}
      onOrdreChange={setOrdre}
    />
  )
}

function monter(resultat: QueryResult = RESULTAT) {
  render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <Harnais resultat={resultat} />
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
        <Harnais />
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
        <Harnais
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

/**
 * L'export du résultat (`API-29`).
 *
 * **Ce qui se vérifie ici est le geste et ses refus**, pas le contenu du fichier : la
 * sérialisation est du Rust, et `engine::export` la mesure valeur par valeur. Ce que l'écran doit
 * garantir, c'est qu'on n'exporte rien qui n'ait été demandé, que les deux refus portent leur
 * raison, et qu'aucune issue ne survit au résultat qu'elle décrit.
 */
describe('l’export du résultat', () => {
  function monterAvecExport(
    onExporter: (format: ExportFormat) => Promise<IssueDExport>,
    options: { resultat?: QueryResult; dialecte?: 'sql' | 'mongo' } = {},
  ) {
    render(
      <LanguageProvider preferences={{ language: 'fr' }}>
        <Harnais
          resultat={options.resultat ?? RESULTAT}
          dialecte={options.dialecte}
          onExporter={onExporter}
        />
      </LanguageProvider>,
    )
    return screen.getByRole('button', { name: /^Exporter$/ })
  }

  /** Sans pont, rien n'est rendu : un bouton qui n'écrirait pas se lirait comme une panne. */
  it('n’est pas rendu sans pont', () => {
    render(
      <LanguageProvider preferences={{ language: 'fr' }}>
        <Harnais />
      </LanguageProvider>,
    )
    expect(screen.queryByRole('button', { name: /^Exporter$/ })).toBeNull()
  })

  it('propose les deux formats et annonce la taille écrite', async () => {
    const utilisateur = userEvent.setup()
    const onExporter = vi.fn(async () => 2048)
    await utilisateur.click(monterAvecExport(onExporter))

    await utilisateur.click(screen.getByRole('button', { name: 'Fichier CSV' }))

    expect(onExporter).toHaveBeenCalledWith('csv')
    expect(
      await screen.findByRole('status', { name: 'Issue du dernier export' }),
    ).toHaveTextContent('Exporté · 2.0 KB')
  })

  it('exporte en JSON quand c’est le format choisi', async () => {
    const utilisateur = userEvent.setup()
    const onExporter = vi.fn(async () => 128)
    await utilisateur.click(monterAvecExport(onExporter))

    await utilisateur.click(screen.getByRole('button', { name: 'Fichier JSON' }))

    expect(onExporter).toHaveBeenCalledWith('json')
  })

  /**
   * **Le refus mongo porte sa raison, et l'entrée reste.** La cacher ferait croire qu'elle
   * n'existera jamais ; un `aria-disabled` la laisse atteignable au survol et au clavier, là où un
   * `disabled` rendrait le `title` inaccessible (piège n° 3).
   */
  it('refuse le CSV d’un résultat mongo, en disant pourquoi, et garde le JSON', async () => {
    const utilisateur = userEvent.setup()
    const onExporter = vi.fn(async () => 1)
    await utilisateur.click(monterAvecExport(onExporter, { dialecte: 'mongo' }))

    const csv = screen.getByRole('button', { name: 'Fichier CSV' })
    expect(csv).toHaveAttribute('aria-disabled', 'true')
    expect(csv).not.toHaveAttribute('disabled')
    expect(csv.getAttribute('title')).toMatch(/arbre de documents/)
    await utilisateur.click(csv)
    expect(onExporter).not.toHaveBeenCalled()

    await utilisateur.click(screen.getByRole('button', { name: 'Fichier JSON' }))
    expect(onExporter).toHaveBeenCalledWith('json')
  })

  /** Un fichier qui ne porterait qu'un en-tête — ou rien, une écriture ne rendant aucune colonne. */
  it('est désactivé avec sa raison quand le résultat n’a aucune ligne', async () => {
    const utilisateur = userEvent.setup()
    const onExporter = vi.fn(async () => 1)
    const bouton = monterAvecExport(onExporter, {
      resultat: { ...RESULTAT, columns: [], rows: [], affected: 3 },
    })

    expect(bouton).toHaveAttribute('aria-disabled', 'true')
    expect(bouton.getAttribute('title')).toMatch(/rien à exporter/)
    await utilisateur.click(bouton)
    expect(screen.queryByRole('button', { name: 'Fichier CSV' })).toBeNull()
    expect(onExporter).not.toHaveBeenCalled()
  })

  /**
   * **Renoncer au sélecteur n'annonce rien.** Ni réussite — aucun fichier n'a été écrit —, ni
   * échec : rien n'a cassé.
   */
  it('n’annonce ni réussite ni échec quand le sélecteur est refermé', async () => {
    const utilisateur = userEvent.setup()
    await utilisateur.click(monterAvecExport(async () => null))

    await utilisateur.click(screen.getByRole('button', { name: 'Fichier CSV' }))

    expect(screen.queryByRole('status', { name: 'Issue du dernier export' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  /** Le message vient du cœur et nomme le fichier : c'est la seule chose qu'on puisse corriger. */
  it('affiche le refus d’écriture en alerte', async () => {
    const utilisateur = userEvent.setup()
    await utilisateur.click(
      monterAvecExport(async () => {
        throw 'le fichier « /interdit/console-1.csv » n’a pas pu être écrit : accès refusé'
      }),
    )

    await utilisateur.click(screen.getByRole('button', { name: 'Fichier CSV' }))

    const alerte = await screen.findByRole('alert')
    expect(alerte).toHaveTextContent('/interdit/console-1.csv')
    // Rognée à l'écran, entière dans l'infobulle : la bande fait une ligne.
    expect(alerte.getAttribute('title')).toMatch(/accès refusé/)
  })

  /**
   * **Une issue ne survit pas au résultat qu'elle décrit.** Le cas ordinaire se règle par le
   * démontage — une nouvelle exécution passe par « Exécution… » —, mais le panneau de transaction
   * **repose** une réponse précédente sans cette étape (`API-38`), et « Exporté · 2.0 KB » serait
   * alors lu comme l'issue du résultat qu'on vient d'afficher.
   */
  it('efface l’issue quand un autre résultat est posé sans réexécution', async () => {
    const utilisateur = userEvent.setup()
    const onExporter = vi.fn(async () => 2048)
    const { rerender } = render(
      <LanguageProvider preferences={{ language: 'fr' }}>
        <Harnais resultat={RESULTAT} onExporter={onExporter} />
      </LanguageProvider>,
    )
    await utilisateur.click(screen.getByRole('button', { name: /^Exporter$/ }))
    await utilisateur.click(screen.getByRole('button', { name: 'Fichier CSV' }))
    expect(
      await screen.findByRole('status', { name: 'Issue du dernier export' }),
    ).toHaveTextContent('Exporté')

    rerender(
      <LanguageProvider preferences={{ language: 'fr' }}>
        <Harnais
          resultat={{ ...RESULTAT, sql: 'select 1', rows: [[{ kind: 'int', value: 1 }]] }}
          onExporter={onExporter}
        />
      </LanguageProvider>,
    )

    expect(screen.queryByRole('status', { name: 'Issue du dernier export' })).toBeNull()
  })
})

/**
 * **Le focus reste sur le bouton après un export**, et c'est une exigence du clavier : `Popover`
 * rend le focus à son déclencheur en se fermant, mais un déclencheur qui change de place dans
 * l'arbre React est **démonté puis remonté** — et le focus tombe alors sur le `body`, d'où plus
 * aucune touche ne mène nulle part.
 */
describe('le focus de l’export', () => {
  it('revient au bouton après un export, et n’est pas perdu', async () => {
    const utilisateur = userEvent.setup()
    render(
      <LanguageProvider preferences={{ language: 'fr' }}>
        <Harnais onExporter={async () => 1024} />
      </LanguageProvider>,
    )
    const bouton = screen.getByRole('button', { name: /^Exporter$/ })

    await utilisateur.click(bouton)
    await utilisateur.click(screen.getByRole('button', { name: 'Fichier CSV' }))
    await screen.findByRole('status', { name: 'Issue du dernier export' })

    expect(screen.getByRole('button', { name: /^Exporter$/ })).toHaveFocus()
  })

  /**
   * **Un export à la fois**, et c'est la contrepartie du point ci-dessus : le menu reste ouvrable
   * pendant l'écriture — le retirer démonterait le déclencheur — donc c'est une garde qui empêche
   * un second sélecteur de destination, et non la disparition du menu.
   *
   * Le double **tient sa réponse à la main** : s'il répondait tout de suite, l'export serait fini
   * avant qu'on ait pu en lancer un second, et il n'y aurait plus rien à mesurer.
   */
  it('ignore un second format tant que le premier n’a pas rendu', async () => {
    const utilisateur = userEvent.setup()
    let rendre: ((octets: number) => void) | null = null
    const onExporter = vi.fn(
      () =>
        new Promise<IssueDExport>((resoudre) => {
          rendre = resoudre
        }),
    )
    render(
      <LanguageProvider preferences={{ language: 'fr' }}>
        <Harnais onExporter={onExporter} />
      </LanguageProvider>,
    )

    await utilisateur.click(screen.getByRole('button', { name: /^Exporter$/ }))
    await utilisateur.click(screen.getByRole('button', { name: 'Fichier CSV' }))
    // L'écriture est en vol : le bouton le dit, et se refuse.
    const bouton = screen.getByRole('button', { name: 'Export…' })
    expect(bouton).toHaveAttribute('aria-disabled', 'true')

    await utilisateur.click(bouton)
    await utilisateur.click(screen.getByRole('button', { name: 'Fichier JSON' }))
    expect(onExporter).toHaveBeenCalledTimes(1)

    await act(async () => {
      rendre?.(512)
    })
    expect(
      await screen.findByRole('status', { name: 'Issue du dernier export' }),
    ).toHaveTextContent('512 B')
  })
})
