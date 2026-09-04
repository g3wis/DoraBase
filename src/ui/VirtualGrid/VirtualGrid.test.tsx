import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { type GridColumn, VirtualGrid } from './VirtualGrid'

// jsdom ne définit pas `elementFromPoint` : la production le lit toujours, au relâchement d'un
// glissement de réordonnancement (voir `debuterLeReordonnancement`). Un bouchon qui rend `null`
// par défaut suffit à la majorité des tests ; ceux qui déposent réellement le remplacent.
document.elementFromPoint = vi.fn(() => null)

type Ligne = { id: number; nom: string }

const lignes = (combien: number): Ligne[] =>
  Array.from({ length: combien }, (_, i) => ({ id: i, nom: `ligne ${i}` }))

const COLONNES: GridColumn<Ligne>[] = [
  {
    key: 'id',
    header: 'id',
    width: 64,
    numeric: true,
    cell: (l) => l.id,
    resizable: false,
    resizeLabel: 'Redimensionner id',
  },
  {
    key: 'nom',
    header: 'nom',
    width: 120,
    cell: (l) => l.nom,
    filter: <input aria-label="filtre nom" />,
    resizeLabel: 'Redimensionner nom',
  },
]

function grille(over: Partial<Parameters<typeof VirtualGrid<Ligne>>[0]> = {}) {
  return render(
    <VirtualGrid
      label="Lignes de public.orders"
      columns={COLONNES}
      rows={lignes(100_000)}
      rowId={(l) => String(l.id)}
      viewportHeight={260}
      {...over}
    />,
  )
}

describe('VirtualGrid', () => {
  it('ne monte que les lignes visibles, plus la marge', () => {
    grille()
    // 260 / 26 = 10 lignes visibles, + 4 de marge de chaque côté (la première est en haut,
    // donc seule la marge basse compte) — et surtout : très loin des 100 000.
    const rendues = screen.getAllByRole('row').length
    expect(rendues).toBeLessThan(30)
    // Le sabotage à faire tomber : monter toutes les lignes.
    expect(rendues).toBeGreaterThan(2)
  })

  it('annonce le total, pas ce qui est monté', () => {
    grille()
    // 100 000 lignes + une ligne d'en-tête.
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '100001')
  })

  it('donne à chaque ligne son indice réel, en-tête comprise', () => {
    grille({ rows: lignes(5) })
    const lignesRendues = screen.getAllByRole('row')
    // L'en-tête est la ligne 1 ; la première ligne de données est donc la 2.
    expect(lignesRendues[1]).toHaveAttribute('aria-rowindex', '2')
    expect(lignesRendues[5]).toHaveAttribute('aria-rowindex', '6')
  })

  it('après défilement, les lignes montées changent sans changer de nombre', () => {
    grille()
    const avant = screen.getAllByRole('row').length
    const contenuAvant = screen.getAllByRole('gridcell')[0]?.textContent

    const viewport = screen.getByRole('grid').querySelector('[class*="viewport"]')
    if (!viewport) throw new Error('conteneur de défilement introuvable')
    fireEvent.scroll(viewport, { target: { scrollTop: 5_000 } })

    expect(screen.getAllByRole('row').length).toBe(avant)
    expect(screen.getAllByRole('gridcell')[0]?.textContent).not.toBe(contenuAvant)
    // 5000 / 26 = 192, moins 4 de marge.
    expect(screen.getAllByRole('row')[1]).toHaveAttribute('aria-rowindex', '190')
  })

  it('la seconde ligne d’en-tête n’existe que si on la demande', () => {
    grille({ rows: lignes(3) })
    expect(screen.queryByLabelText('filtre nom')).not.toBeInTheDocument()

    grille({ rows: lignes(3), filterRow: true })
    expect(screen.getByLabelText('filtre nom')).toBeInTheDocument()
    // Deux lignes d'en-tête : le total et les indices se décalent d'autant.
    expect(screen.getAllByRole('grid')[1]).toHaveAttribute('aria-rowcount', '5')
  })

  it('sélectionne au clic et au clavier', async () => {
    const utilisateur = userEvent.setup()

    function Pilotee() {
      const [selection, setSelection] = useState<string | null>(null)
      return (
        <VirtualGrid
          label="Lignes"
          columns={COLONNES}
          rows={lignes(20)}
          rowId={(l) => String(l.id)}
          viewportHeight={260}
          selectedId={selection}
          onSelect={(l) => setSelection(String(l.id))}
        />
      )
    }
    render(<Pilotee />)

    await utilisateur.click(screen.getByText('ligne 2'))
    expect(screen.getAllByRole('row')[3]).toHaveAttribute('aria-selected', 'true')

    await utilisateur.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('row')[4]).toHaveAttribute('aria-selected', 'true')
    await utilisateur.keyboard('{ArrowUp}')
    expect(screen.getAllByRole('row')[3]).toHaveAttribute('aria-selected', 'true')
  })

  it('Suppr sur la ligne sélectionnée appelle onDeleteKey avec cette ligne', async () => {
    const utilisateur = userEvent.setup()
    const supprimees: string[] = []

    function Pilotee() {
      const [selection, setSelection] = useState<string | null>(null)
      return (
        <VirtualGrid
          label="Lignes"
          columns={COLONNES}
          rows={lignes(20)}
          rowId={(l) => String(l.id)}
          viewportHeight={260}
          selectedId={selection}
          onSelect={(l) => setSelection(String(l.id))}
          onDeleteKey={(l) => supprimees.push(String(l.id))}
        />
      )
    }
    render(<Pilotee />)

    await utilisateur.click(screen.getByText('ligne 2'))
    await utilisateur.keyboard('{Delete}')
    expect(supprimees).toEqual(['2'])

    await utilisateur.keyboard('{Backspace}')
    expect(supprimees).toEqual(['2', '2'])
  })

  it('Backspace dans un champ de filtre ne déclenche pas onDeleteKey', async () => {
    const utilisateur = userEvent.setup()
    const supprimees: string[] = []

    function Pilotee() {
      const [selection, setSelection] = useState<string | null>('2')
      return (
        <VirtualGrid
          label="Lignes"
          columns={COLONNES}
          rows={lignes(20)}
          rowId={(l) => String(l.id)}
          viewportHeight={260}
          filterRow
          selectedId={selection}
          onSelect={(l) => setSelection(String(l.id))}
          onDeleteKey={(l) => supprimees.push(String(l.id))}
        />
      )
    }
    render(<Pilotee />)

    // Une ligne est déjà sélectionnée, comme au clic — c'est le cas que la garde doit distinguer :
    // le focus est sur le champ de filtre, pas sur la grille ni sur une `row`.
    await utilisateur.click(screen.getByLabelText('filtre nom'))
    await utilisateur.keyboard('{Backspace}')
    expect(supprimees).toEqual([])
  })

  it('sans onSelect, aucune ligne n’est annoncée sélectionnable', () => {
    grille({ rows: lignes(3) })
    expect(screen.getAllByRole('row')[1]).not.toHaveAttribute('aria-selected')
  })

  it('rend l’état vide plutôt qu’une grille sans ligne', () => {
    grille({ rows: [], empty: 'Aucune ligne' })
    expect(screen.getByText('Aucune ligne')).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(1)
  })

  describe('redimensionnement des colonnes', () => {
    it('sans onColumnResize, aucune poignée ne se rend', () => {
      grille({ rows: lignes(3) })
      expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    })

    it('une poignée par colonne redimensionnable, aucune sur celle qui ne l’est pas', () => {
      grille({ rows: lignes(3), onColumnResize: () => {} })
      // `id` porte `resizable: false` : une seule poignée doit exister, celle de `nom`.
      expect(screen.getAllByRole('slider')).toHaveLength(1)
      expect(screen.getByLabelText('Redimensionner nom')).toBeInTheDocument()
      expect(screen.queryByLabelText('Redimensionner id')).not.toBeInTheDocument()
    })

    it('sans headerLabel, le nom de la cellule d’en-tête absorbe celui de la poignée', () => {
      // Contrôle **positif** du test suivant : c'est ce qui arrive quand la cellule tire son nom de
      // son contenu et que ce contenu comprend un contrôle. Sans ce test, `headerLabel` pourrait
      // cesser de servir à quoi que ce soit sans que rien ne bouge.
      //
      // **Et ce qui s'y ajoute est la *valeur*, pas le libellé** : un widget de plage rencontré au
      // fil du contenu compte pour son `aria-valuenow` (accname 2F), donc la colonne s'annonce
      // « nom 120 » — et le nom d'une colonne **changerait à chaque redimensionnement**.
      grille({ rows: lignes(3), onColumnResize: () => {} })
      expect(screen.queryByRole('columnheader', { name: /^nom$/ })).not.toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'nom 120' })).toBeInTheDocument()
    })

    it('headerLabel rend son nom à la cellule d’en-tête', () => {
      grille({
        rows: lignes(3),
        onColumnResize: () => {},
        columns: COLONNES.map((colonne) => ({ ...colonne, headerLabel: colonne.key })),
      })
      expect(screen.getByRole('columnheader', { name: /^nom$/ })).toBeInTheDocument()
    })

    it('glisser la poignée redimensionne, et onColumnResize n’est appelé qu’au relâchement', () => {
      const largeurs: Array<[string, number]> = []
      grille({ rows: lignes(3), onColumnResize: (cle, largeur) => largeurs.push([cle, largeur]) })

      const poignee = screen.getByLabelText('Redimensionner nom')
      fireEvent.pointerDown(poignee, { clientX: 200, pointerId: 1 })
      fireEvent.pointerMove(poignee, { clientX: 230, pointerId: 1 })
      // Pendant le geste, rien n'est encore remonté à l'appelant.
      expect(largeurs).toEqual([])

      fireEvent.pointerUp(poignee, { clientX: 230, pointerId: 1 })
      // La colonne `nom` faisait 120 px ; +30 px de glissement.
      expect(largeurs).toEqual([['nom', 150]])
    })

    it('le glissement ne descend pas sous la largeur minimale', () => {
      const largeurs: Array<[string, number]> = []
      grille({ rows: lignes(3), onColumnResize: (cle, largeur) => largeurs.push([cle, largeur]) })

      const poignee = screen.getByLabelText('Redimensionner nom')
      fireEvent.pointerDown(poignee, { clientX: 200, pointerId: 1 })
      fireEvent.pointerMove(poignee, { clientX: -1000, pointerId: 1 })
      fireEvent.pointerUp(poignee, { clientX: -1000, pointerId: 1 })

      // `minWidth` n'est pas fourni sur la colonne : le plancher par défaut est 60.
      expect(largeurs).toEqual([['nom', 60]])
    })

    it('les flèches du clavier redimensionnent par pas de 8 px, et remontent aussitôt', async () => {
      const utilisateur = userEvent.setup()
      const largeurs: Array<[string, number]> = []
      grille({ rows: lignes(3), onColumnResize: (cle, largeur) => largeurs.push([cle, largeur]) })

      const poignee = screen.getByLabelText('Redimensionner nom')
      poignee.focus()
      await utilisateur.keyboard('{ArrowRight}')
      expect(largeurs).toEqual([['nom', 128]])

      await utilisateur.keyboard('{ArrowLeft}')
      expect(largeurs).toEqual([
        ['nom', 128],
        ['nom', 112],
      ])
    })
  })

  describe('réordonnancement des colonnes', () => {
    const COLONNES_REORDER: GridColumn<Ligne>[] = [
      { key: 'id', header: 'id', width: 64, numeric: true, cell: (l) => l.id, reorderable: false },
      {
        key: 'nom',
        header: 'nom',
        width: 120,
        cell: (l) => l.nom,
        reorderLabel: 'Déplacer nom (flèches gauche et droite)',
      },
      {
        key: 'ville',
        header: 'ville',
        width: 120,
        cell: () => 'x',
        reorderLabel: 'Déplacer ville (flèches gauche et droite)',
      },
      {
        key: 'pays',
        header: 'pays',
        width: 120,
        cell: () => 'x',
        reorderLabel: 'Déplacer pays (flèches gauche et droite)',
      },
    ]

    it('sans onColumnReorder, aucune poignée ne se rend', () => {
      grille({ columns: COLONNES_REORDER, rows: lignes(3) })
      expect(screen.queryByLabelText(/^Déplacer /)).not.toBeInTheDocument()
    })

    it('une poignée par colonne réordonnable, aucune sur celle qui ne l’est pas', () => {
      grille({ columns: COLONNES_REORDER, rows: lignes(3), onColumnReorder: () => {} })
      // `id` porte `reorderable: false` : trois poignées doivent exister, une par colonne restante.
      expect(screen.getAllByLabelText(/^Déplacer /)).toHaveLength(3)
      expect(screen.queryByLabelText(/Déplacer id/)).not.toBeInTheDocument()
    })

    it('les flèches du clavier déplacent d’un cran, et remontent l’ordre complet aussitôt', async () => {
      const utilisateur = userEvent.setup()
      const ordres: Array<readonly string[]> = []
      grille({
        columns: COLONNES_REORDER,
        rows: lignes(3),
        onColumnReorder: (ordre) => ordres.push(ordre),
      })

      const poignee = screen.getByLabelText('Déplacer ville (flèches gauche et droite)')
      poignee.focus()
      await utilisateur.keyboard('{ArrowLeft}')
      // **L'ordre complet des colonnes réordonnables**, `id` exclue puisqu'elle n'y participe pas.
      expect(ordres).toEqual([['ville', 'nom', 'pays']])
    })

    it('la première colonne ne recule pas, la dernière n’avance pas', async () => {
      const utilisateur = userEvent.setup()
      const ordres: Array<readonly string[]> = []
      grille({
        columns: COLONNES_REORDER,
        rows: lignes(3),
        onColumnReorder: (ordre) => ordres.push(ordre),
      })

      screen.getByLabelText('Déplacer nom (flèches gauche et droite)').focus()
      await utilisateur.keyboard('{ArrowLeft}')
      screen.getByLabelText('Déplacer pays (flèches gauche et droite)').focus()
      await utilisateur.keyboard('{ArrowRight}')
      // Un ordre inchangé remonté referait recalculer toute la grille chez l'appelant pour rien.
      expect(ordres).toEqual([])
    })

    it('glisser au pointeur jusqu’à un autre en-tête envoie l’ordre complet au relâchement', () => {
      const ordres: Array<readonly string[]> = []
      grille({
        columns: COLONNES_REORDER,
        rows: lignes(3),
        onColumnReorder: (ordre) => ordres.push(ordre),
      })

      // **Aux événements pointeur, jamais au glisser-déposer HTML5** : WKWebView ne délivre pas
      // `dragstart` de façon fiable (`23h`). La cible du dépôt est retrouvée par
      // `elementFromPoint`, que jsdom ne simule pas — on le fait à sa place, exactement comme la
      // production le lit : l'en-tête réel sous les coordonnées du relâchement.
      const cible = document.querySelector('[data-colonne="nom"]')
      if (cible === null) throw new Error('en-tête cible introuvable')
      vi.mocked(document.elementFromPoint).mockReturnValue(cible as Element)

      const poignee = screen.getByLabelText('Déplacer pays (flèches gauche et droite)')
      fireEvent.pointerDown(poignee, { clientX: 400, clientY: 10, pointerId: 1 })
      // Rien n'est encore remonté pendant le geste — seul le relâchement dépose.
      expect(ordres).toEqual([])
      fireEvent.pointerUp(poignee, { clientX: 100, clientY: 10, pointerId: 1 })

      expect(ordres).toEqual([['pays', 'nom', 'ville']])
    })

    it('le déplacement du pointeur marque l’en-tête survolé comme cible du dépôt', () => {
      grille({ columns: COLONNES_REORDER, rows: lignes(3), onColumnReorder: () => {} })

      const cibleVille = document.querySelector('[data-colonne="ville"]')
      const ciblePays = document.querySelector('[data-colonne="pays"]')
      if (cibleVille === null || ciblePays === null) throw new Error('en-têtes introuvables')

      const poignee = screen.getByLabelText('Déplacer nom (flèches gauche et droite)')
      fireEvent.pointerDown(poignee, { clientX: 100, clientY: 10, pointerId: 1 })

      vi.mocked(document.elementFromPoint).mockReturnValue(cibleVille as Element)
      fireEvent.pointerMove(poignee, { clientX: 250, clientY: 10, pointerId: 1 })
      expect(cibleVille.className).toMatch(/cibleColonne/)
      expect(ciblePays.className).not.toMatch(/cibleColonne/)

      // Le pointeur avance encore : l'indicateur suit, il ne reste pas sur le premier survolé.
      vi.mocked(document.elementFromPoint).mockReturnValue(ciblePays as Element)
      fireEvent.pointerMove(poignee, { clientX: 380, clientY: 10, pointerId: 1 })
      expect(cibleVille.className).not.toMatch(/cibleColonne/)
      expect(ciblePays.className).toMatch(/cibleColonne/)

      // Et il s'efface au relâchement — rien ne doit rester marqué une fois le geste terminé.
      fireEvent.pointerUp(poignee, { clientX: 380, clientY: 10, pointerId: 1 })
      expect(ciblePays.className).not.toMatch(/cibleColonne/)
    })

    it('survoler sa propre colonne ne montre aucun indicateur', () => {
      grille({ columns: COLONNES_REORDER, rows: lignes(3), onColumnReorder: () => {} })
      const cibleNom = document.querySelector('[data-colonne="nom"]')
      if (cibleNom === null) throw new Error('en-tête introuvable')

      const poignee = screen.getByLabelText('Déplacer nom (flèches gauche et droite)')
      fireEvent.pointerDown(poignee, { clientX: 100, clientY: 10, pointerId: 1 })
      vi.mocked(document.elementFromPoint).mockReturnValue(cibleNom as Element)
      fireEvent.pointerMove(poignee, { clientX: 105, clientY: 10, pointerId: 1 })

      // Un dépôt sur soi-même ne changerait rien : l'indicateur ne doit rien promettre ici.
      expect(cibleNom.className).not.toMatch(/cibleColonne/)
    })

    it('un relâchement hors de tout en-tête ne dépose rien', () => {
      const ordres: Array<readonly string[]> = []
      grille({
        columns: COLONNES_REORDER,
        rows: lignes(3),
        onColumnReorder: (ordre) => ordres.push(ordre),
      })

      // Réinitialisé : un test précédent de ce fichier a pu le faire rendre un en-tête.
      vi.mocked(document.elementFromPoint).mockReturnValue(null)

      const poignee = screen.getByLabelText('Déplacer pays (flèches gauche et droite)')
      fireEvent.pointerDown(poignee, { clientX: 400, clientY: 10, pointerId: 1 })
      fireEvent.pointerUp(poignee, { clientX: 4000, clientY: 4000, pointerId: 1 })

      expect(ordres).toEqual([])
    })

    it('la poignée est le nom même de la colonne, atteignable au clavier', () => {
      grille({ columns: COLONNES_REORDER, rows: lignes(3), onColumnReorder: () => {} })
      // **Sans cela, réordonner n'existe pas sans souris.** Le nom accessible annonce la façon de
      // s'en servir — les flèches, pas un clic, puisque le clic seul active un `<button>`.
      const poignee = screen.getByLabelText('Déplacer nom (flèches gauche et droite)')
      expect(poignee.tagName).toBe('BUTTON')
      expect(poignee).toHaveTextContent('nom')
    })

    describe('le défilement au bord', () => {
      /**
       * Les trames, tenues à la main : `requestAnimationFrame` réel rendrait ces tests dépendants
       * du temps — règle n° 3, un test calé sur une durée réelle est un tirage au sort. Et
       * `cancelAnimationFrame` retire vraiment de la file : sans cela, « le relâchement arrête le
       * défilement » resterait vert même si la production n'annulait rien.
       */
      function boucherLesTrames() {
        const file = new Map<number, FrameRequestCallback>()
        let prochaine = 1
        const demande = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((rappel) => {
          file.set(prochaine, rappel)
          return prochaine++
        })
        const annule = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
          file.delete(id)
        })
        return {
          avancer() {
            const rappels = [...file.values()]
            file.clear()
            act(() => {
              for (const rappel of rappels) rappel(0)
            })
          },
          restaurer() {
            demande.mockRestore()
            annule.mockRestore()
            vi.mocked(document.elementFromPoint).mockReturnValue(null)
          },
        }
      }

      /** Les bords de la fenêtre de défilement, bouchonnés — jsdom ne mesure rien (règle n° 9). */
      function fenetreDeDefilement(): HTMLElement {
        const zone = screen.getByRole('grid').querySelector<HTMLElement>('[class*="viewport"]')
        if (zone === null) throw new Error('conteneur de défilement introuvable')
        zone.getBoundingClientRect = () => ({ left: 0, right: 400 }) as DOMRect
        return zone
      }

      it('près du bord droit, la grille défile — et continue sans nouveau mouvement', () => {
        const boucle = boucherLesTrames()
        try {
          grille({ columns: COLONNES_REORDER, rows: lignes(3), onColumnReorder: () => {} })
          const zone = fenetreDeDefilement()
          vi.mocked(document.elementFromPoint).mockReturnValue(null)

          const poignee = screen.getByLabelText('Déplacer nom (flèches gauche et droite)')
          fireEvent.pointerDown(poignee, { clientX: 200, clientY: 10, pointerId: 1 })
          fireEvent.pointerMove(poignee, { clientX: 395, clientY: 10, pointerId: 1 })

          boucle.avancer()
          const apresUneTrame = zone.scrollLeft
          expect(apresUneTrame).toBeGreaterThan(0)

          // **Sans aucun `pointermove` de plus** : une souris posée contre le bord n'émet plus
          // rien, et c'est précisément là que le défilement doit continuer. Un pas par
          // `pointermove` — le sabotage naturel — s'arrêterait ici.
          boucle.avancer()
          boucle.avancer()
          expect(zone.scrollLeft).toBeGreaterThan(apresUneTrame)

          // Le relâchement arrête tout : plus une trame ne défile après lui.
          fireEvent.pointerUp(poignee, { clientX: 395, clientY: 10, pointerId: 1 })
          const auRelachement = zone.scrollLeft
          boucle.avancer()
          expect(zone.scrollLeft).toBe(auRelachement)
        } finally {
          boucle.restaurer()
        }
      })

      it('au milieu de la fenêtre, glisser ne défile pas', () => {
        const boucle = boucherLesTrames()
        try {
          grille({ columns: COLONNES_REORDER, rows: lignes(3), onColumnReorder: () => {} })
          const zone = fenetreDeDefilement()
          vi.mocked(document.elementFromPoint).mockReturnValue(null)

          const poignee = screen.getByLabelText('Déplacer nom (flèches gauche et droite)')
          fireEvent.pointerDown(poignee, { clientX: 100, clientY: 10, pointerId: 1 })
          fireEvent.pointerMove(poignee, { clientX: 200, clientY: 10, pointerId: 1 })

          boucle.avancer()
          boucle.avancer()
          expect(zone.scrollLeft).toBe(0)
        } finally {
          boucle.restaurer()
        }
      })

      it('près du bord gauche, le défilement revient en arrière', () => {
        const boucle = boucherLesTrames()
        try {
          grille({ columns: COLONNES_REORDER, rows: lignes(3), onColumnReorder: () => {} })
          const zone = fenetreDeDefilement()
          zone.scrollLeft = 100
          vi.mocked(document.elementFromPoint).mockReturnValue(null)

          const poignee = screen.getByLabelText('Déplacer pays (flèches gauche et droite)')
          fireEvent.pointerDown(poignee, { clientX: 200, clientY: 10, pointerId: 1 })
          fireEvent.pointerMove(poignee, { clientX: 5, clientY: 10, pointerId: 1 })

          boucle.avancer()
          expect(zone.scrollLeft).toBeLessThan(100)
        } finally {
          boucle.restaurer()
        }
      })

      it('les colonnes qui glissent sous un pointeur immobile font suivre la cible du dépôt', () => {
        const boucle = boucherLesTrames()
        try {
          grille({ columns: COLONNES_REORDER, rows: lignes(3), onColumnReorder: () => {} })
          fenetreDeDefilement()
          const cibleVille = document.querySelector('[data-colonne="ville"]')
          const ciblePays = document.querySelector('[data-colonne="pays"]')
          if (cibleVille === null || ciblePays === null) throw new Error('en-têtes introuvables')

          const poignee = screen.getByLabelText('Déplacer nom (flèches gauche et droite)')
          fireEvent.pointerDown(poignee, { clientX: 100, clientY: 10, pointerId: 1 })
          vi.mocked(document.elementFromPoint).mockReturnValue(cibleVille as Element)
          fireEvent.pointerMove(poignee, { clientX: 395, clientY: 10, pointerId: 1 })
          expect(cibleVille.className).toMatch(/cibleColonne/)

          // Le pointeur ne bouge plus ; le défilement amène `pays` sous lui. L'indicateur doit
          // suivre sans attendre un `pointermove` qui ne viendra pas.
          vi.mocked(document.elementFromPoint).mockReturnValue(ciblePays as Element)
          boucle.avancer()
          expect(cibleVille.className).not.toMatch(/cibleColonne/)
          expect(ciblePays.className).toMatch(/cibleColonne/)
        } finally {
          boucle.restaurer()
        }
      })
    })
  })

  describe('le tri, séparé du glissement (23h)', () => {
    it('le clic sur le nom ne trie pas, seule la flèche de tri le fait', async () => {
      const utilisateur = userEvent.setup()
      const tris: string[] = []
      const COLONNES_TRIABLES: GridColumn<Ligne>[] = [
        {
          key: 'nom',
          header: 'nom',
          width: 120,
          cell: (l) => l.nom,
          reorderLabel: 'Déplacer nom (flèches gauche et droite)',
          sort: {
            label: 'Trier par nom',
            icon: 'sort',
            active: false,
            onClick: () => tris.push('nom'),
          },
        },
      ]
      grille({ columns: COLONNES_TRIABLES, rows: lignes(3), onColumnReorder: () => {} })

      // Le clic sur le nom — la poignée de glissement — ne déclenche aucun tri.
      await utilisateur.click(screen.getByLabelText('Déplacer nom (flèches gauche et droite)'))
      expect(tris).toEqual([])

      // Seule la flèche dédiée le fait.
      await utilisateur.click(screen.getByRole('button', { name: 'Trier par nom' }))
      expect(tris).toEqual(['nom'])
    })
  })

  describe('menus contextuels', () => {
    it('sans les props, le clic droit laisse passer le menu natif', () => {
      grille({ rows: lignes(3) })
      const cellule = screen.getAllByRole('gridcell')[0]
      const entete = screen.getAllByRole('columnheader')[0]
      if (!cellule || !entete) throw new Error('cellule introuvable')
      // `fireEvent` rend `false` quand le défaut a été empêché : ici rien ne doit l'être, sans quoi
      // la webview n'aurait ni le menu de l'application ni le sien.
      expect(fireEvent.contextMenu(cellule)).toBe(true)
      expect(fireEvent.contextMenu(entete)).toBe(true)
    })

    it('le clic droit sur un en-tête rend sa clé et le point du clic', () => {
      const appels: Array<[string, number, number]> = []
      grille({
        rows: lignes(3),
        onHeaderContextMenu: (cle, position) => appels.push([cle, position.x, position.y]),
      })
      const entete = screen.getAllByRole('columnheader')[1]
      if (!entete) throw new Error('en-tête introuvable')

      expect(fireEvent.contextMenu(entete, { clientX: 40, clientY: 12 })).toBe(false)
      expect(appels).toEqual([['nom', 40, 12]])
    })

    it('le bouton secondaire ouvre le menu sans passer par `contextmenu`', () => {
      // **La voie que WebKit distribue.** `contextmenu` n'est pas émis sur un élément en
      // `-webkit-user-select: none`, que `reset.css` pose sur tout le `body` : sans ce second
      // chemin, le clic droit ne fait rien dans la fenêtre de `pnpm tauri dev` — et rien ne le dit,
      // puisque Chromium, lui, émet les deux.
      const entetes: string[] = []
      const cellules: string[] = []
      grille({
        rows: lignes(3),
        onHeaderContextMenu: (cle) => entetes.push(cle),
        onCellContextMenu: (_ligne, cle) => cellules.push(cle),
      })
      const entete = screen.getAllByRole('columnheader')[1]
      const cellule = screen.getAllByRole('gridcell')[1]
      if (!entete || !cellule) throw new Error('cellule introuvable')

      fireEvent.pointerDown(entete, { button: 2 })
      fireEvent.pointerDown(cellule, { button: 2 })
      expect(entetes).toEqual(['nom'])
      expect(cellules).toEqual(['nom'])
    })

    it('`ctrl`+clic sur la poignée de glissement ouvre le menu, sans démarrer de déplacement', () => {
      // Le clic secondaire de macOS arrive avec `button === 0` : sans la garde posée dans
      // `debuterLeReordonnancement`, il armerait un déplacement en même temps qu'il ouvre le menu.
      const entetes: string[] = []
      const ordres: Array<readonly string[]> = []
      const COLONNES_REORDER: GridColumn<Ligne>[] = [
        { key: 'id', header: 'id', width: 64, cell: (l) => l.id, reorderable: false },
        {
          key: 'nom',
          header: 'nom',
          width: 120,
          cell: (l) => l.nom,
          reorderLabel: 'Déplacer nom (flèches gauche et droite)',
        },
      ]
      grille({
        columns: COLONNES_REORDER,
        rows: lignes(3),
        onColumnReorder: (ordre) => ordres.push(ordre),
        onHeaderContextMenu: (cle) => entetes.push(cle),
      })
      const poignee = screen.getByLabelText('Déplacer nom (flèches gauche et droite)')
      fireEvent.pointerDown(poignee, { button: 0, ctrlKey: true, clientX: 0, pointerId: 1 })
      fireEvent.pointerMove(poignee, { clientX: 200, pointerId: 1 })
      fireEvent.pointerUp(poignee, { clientX: 200, pointerId: 1 })

      // Le menu s'ouvre — la voie `pointerdown` bulle depuis la poignée jusqu'à l'en-tête.
      expect(entetes).toEqual(['nom'])
      // Et le déplacement ne démarre pas : aucun écouteur n'a été posé.
      expect(ordres).toEqual([])
    })

    it('le clic droit sur une cellule rend sa ligne, sa colonne et son rang', () => {
      const appels: Array<[number, string, number]> = []
      grille({
        rows: lignes(3),
        onCellContextMenu: (ligne, cle, rang) => appels.push([ligne.id, cle, rang]),
      })
      // La deuxième ligne, seconde colonne : trois coordonnées qui diffèrent toutes, sans quoi une
      // permutation des arguments passerait inaperçue (règle n° 5).
      const cellule = screen.getAllByRole('gridcell')[3]
      if (!cellule) throw new Error('cellule introuvable')

      expect(fireEvent.contextMenu(cellule)).toBe(false)
      expect(appels).toEqual([[1, 'nom', 1]])
    })
  })
})
