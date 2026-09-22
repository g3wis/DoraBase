import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { ColumnInfo, DatabaseKey, RowQuery } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { TableView } from './TableView'
import type { PasserelleLignes } from './useLignes'

const CLE: DatabaseKey = {
  project: 'Atelier Nord',
  database: 'analytics',
  environment: 'prod',
}

const colonne = (
  name: string,
  category: ColumnInfo['category'] = 'text',
  nullable = true,
): ColumnInfo => ({
  position: 1,
  name,
  typeName: 'text',
  category,
  nullable,
  default: null,
  identity: null,
  key: null,
  comment: null,
  frequency: null,
})

/**
 * **Cinq colonnes, et aucune paire indiscernable** (règle n° 5) : `status` est nullable et `currency`
 * ne l'est pas, ce qui sépare « `is null` absent » de « `is null` jamais proposé » ; `paye` est un
 * booléen nullable, dont la liste diffère de toutes les autres.
 */
const COLONNES = [
  colonne('status'),
  colonne('currency', 'text', false),
  colonne('total_cents', 'number'),
  colonne('created_at', 'timestamp'),
  colonne('paye', 'boolean'),
  // **Une seconde colonne numérique, et c'est délibéré** : `total_cents` porte un compte,
  // `expedie_ms` une époque. Rien ne les distingue dans le catalogue — c'est tout le sujet —, donc
  // un décor à une seule colonne d'entiers ne dirait pas si la lecture suit la colonne ou toutes
  // les colonnes numériques (règle n° 5).
  colonne('expedie_ms', 'number'),
]

/** 2026-03-05 00:00:00 UTC, en millisecondes — la valeur d'`expedie_ms` dans le décor. */
const MINUIT_MS = 1_772_668_800_000

function monter() {
  const readRows = vi.fn(async (_cle: DatabaseKey, requete: RowQuery) => ({
    offset: 0,
    rows: [
      [
        { kind: 'text' as const, value: 'paid' },
        { kind: 'text' as const, value: 'EUR' },
        { kind: 'int' as const, value: 1 },
        { kind: 'null' as const },
        { kind: 'bool' as const, value: true },
        { kind: 'int' as const, value: MINUIT_MS },
      ],
    ],
    total: null,
    sql: `select * from public.orders limit 500 offset 0 -- ${requete.filters.length} filtre(s)`,
    durationMs: 41,
  }))
  const passerelle: PasserelleLignes = { readRows }
  render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <TableView
          cle={CLE}
          schema="public"
          table="orders"
          columns={COLONNES}
          passerelle={passerelle}
        />
      </LanguageProvider>
    </>,
  )
  return { readRows }
}

/** La dernière requête envoyée au serveur. */
function derniereRequete(readRows: ReturnType<typeof monter>['readRows']): RowQuery {
  const appels = vi.mocked(readRows).mock.calls
  return appels[appels.length - 1]?.[1] as RowQuery
}

describe('filtres par en-tête', () => {
  it('un filtre appliqué part au serveur, il ne trie pas la fenêtre', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    await utilisateur.type(await screen.findByLabelText('Filtrer status'), 'paid{Enter}')

    // **Le critère central de `10d`.** Filtrer les lignes déjà reçues serait immédiat et faux :
    // l'utilisateur croirait voir toutes les commandes payées de la table alors qu'il ne verrait
    // que celles des cinq cents premières lignes lues. Le test porte donc sur la **requête**.
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(2))
    expect(derniereRequete(readRows).filters).toEqual([
      { column: 'status', operator: 'eq', value: 'paid' },
    ])
  })

  it('taper sans valider n’envoie rien', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    // Un filtre relancé à chaque frappe enverrait cinq requêtes pour `paid`.
    await utilisateur.type(await screen.findByLabelText('Filtrer status'), 'paid')
    expect(readRows).toHaveBeenCalledTimes(1)
  })

  it('la perte de focus applique, comme Entrée', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    await utilisateur.type(await screen.findByLabelText('Filtrer status'), 'paid')
    await utilisateur.tab()

    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(2))
    expect(derniereRequete(readRows).filters).toHaveLength(1)
  })

  it('vider un filtre le retire de la requête', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    const champ = await screen.findByLabelText('Filtrer status')

    await utilisateur.type(champ, 'paid{Enter}')
    await waitFor(() => expect(derniereRequete(readRows).filters).toHaveLength(1))

    await utilisateur.clear(champ)
    await utilisateur.keyboard('{Enter}')
    await waitFor(() => expect(derniereRequete(readRows).filters).toHaveLength(0))
  })

  it('« is null » s’applique sans saisie et désactive le champ', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    await utilisateur.click(screen.getByRole('button', { name: 'Opérateur de created_at' }))
    // **Ancré.** `/is null/` ne décrit plus une seule entrée depuis que « is not null » existe —
    // il ne l'attrape pas par sous-chaîne, mais un libellé qui bougerait le rendrait ambigu sans
    // que rien le dise. C'est la règle du nom accessible ancré d'`AGENTS.md`.
    await utilisateur.click(await screen.findByRole('button', { name: /^∅ is null$/ }))

    await waitFor(() =>
      expect(derniereRequete(readRows).filters).toEqual([
        { column: 'created_at', operator: 'isNull', value: null },
      ]),
    )
    expect(screen.getByLabelText('Filtrer created_at')).toBeDisabled()
  })

  it('« is not null » s’applique sans saisie et désactive le champ, comme « is null »', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    await utilisateur.click(screen.getByRole('button', { name: 'Opérateur de created_at' }))
    await utilisateur.click(await screen.findByRole('button', { name: /^≠∅ is not null$/ }))

    await waitFor(() =>
      expect(derniereRequete(readRows).filters).toEqual([
        { column: 'created_at', operator: 'isNotNull', value: null },
      ]),
    )
    expect(screen.getByLabelText('Filtrer created_at')).toBeDisabled()
  })

  it('le popover propose les six opérateurs de `FilterOperator` sur une colonne texte', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await utilisateur.click(await screen.findByRole('button', { name: 'Opérateur de status' }))

    const panneau = await screen.findByRole('dialog', { name: 'Opérateur · status' })
    expect(panneau.querySelectorAll('li')).toHaveLength(6)
  })

  it('ni « is null » ni « is not null » ne paraissent sur une colonne NOT NULL', async () => {
    // `is null` y rendrait toujours zéro ligne — ce qui se lit comme une table vide plutôt que
    // comme un filtre vide — et `is not null` rendrait toutes les lignes, ce qui se lit comme un
    // filtre inopérant. Les deux faces du même fait, donc la même porte.
    const utilisateur = userEvent.setup()
    monter()
    await utilisateur.click(await screen.findByRole('button', { name: 'Opérateur de currency' }))

    const panneau = await screen.findByRole('dialog', { name: 'Opérateur · currency' })
    expect(panneau.querySelectorAll('li')).toHaveLength(4)
    expect(screen.queryByRole('button', { name: /^∅ is null$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^≠∅ is not null$/ })).toBeNull()
  })

  it('une colonne booléenne n’offre que ses prédicats', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await utilisateur.click(await screen.findByRole('button', { name: 'Opérateur de paye' }))

    const panneau = await screen.findByRole('dialog', { name: 'Opérateur · paye' })
    // Les noms accessibles portent leur espace : « Tis true » serait le piège n° 1.
    const libelles = [...panneau.querySelectorAll('li')].map((li) => li.textContent)
    expect(libelles).toEqual(['T is true', 'F is false', '∅ is null', '≠∅ is not null'])
    // Ni `=`, ni `~`, ni `in` : un champ de saisie n'a rien à recevoir d'une colonne à deux
    // valeurs, et `= true` / `= 1` dépendent du moteur.
    expect(screen.queryByRole('button', { name: 'égal' })).toBeNull()
  })

  it('« is true » part au serveur sans valeur, et son champ reste désactivé', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    // Le champ est déjà désactivé avant tout geste : l'opérateur par défaut d'un booléen est un
    // prédicat, faute d'`=`.
    expect(screen.getByLabelText('Filtrer paye')).toBeDisabled()

    await utilisateur.click(screen.getByRole('button', { name: 'Opérateur de paye' }))
    await utilisateur.click(await screen.findByRole('button', { name: /is false/ }))

    await waitFor(() =>
      expect(derniereRequete(readRows).filters).toEqual([
        { column: 'paye', operator: 'isFalse', value: null },
      ]),
    )
    expect(screen.getByLabelText('Filtrer paye')).toBeDisabled()
  })

  it('un booléen n’est pas filtré tant qu’on n’a rien choisi', async () => {
    // **L'opérateur affiché n'est pas un filtre appliqué.** Un booléen montre « is true » d'emblée,
    // sans quoi son champ n'aurait aucun signe ; envoyer le filtre pour autant écarterait la moitié
    // de la table dès l'ouverture de l'onglet.
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))
    expect(derniereRequete(readRows).filters).toEqual([])
  })

  it('une colonne temporelle reçoit « avant le » et « après le », avec un sélecteur de date', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    // Sur `=`, la saisie reste libre : un motif ou une liste ne s'expriment pas dans un champ de
    // date.
    expect(screen.getByLabelText('Filtrer created_at')).toHaveAttribute('type', 'text')

    await utilisateur.click(screen.getByRole('button', { name: 'Opérateur de created_at' }))
    await utilisateur.click(await screen.findByRole('button', { name: /^< avant le$/ }))

    const champ = screen.getByLabelText('Filtrer created_at')
    expect(champ).toHaveAttribute('type', 'date')

    // **Le choix s'applique de lui-même** : le calendrier natif se referme sans perte de focus et
    // sans `Entrée`, donc attendre l'un des deux laisserait la date dans le champ sans qu'elle
    // parte. `« avant »` est un `lt` — le même opérateur que les nombres, dit autrement.
    fireEvent.change(champ, { target: { value: '2026-03-01' } })
    await waitFor(() =>
      expect(derniereRequete(readRows).filters).toEqual([
        { column: 'created_at', operator: 'lt', value: '2026-03-01' },
      ]),
    )

    // Vider la date retire le filtre, comme vider un champ texte.
    fireEvent.change(champ, { target: { value: '' } })
    await waitFor(() => expect(derniereRequete(readRows).filters).toEqual([]))
  })

  it('choisir « avant le » demande la date tout de suite, sur un champ déjà en type date', async () => {
    // **Choisir « avant le » *est* la demande d'une date.** Sans l'ouverture immédiate, l'écran
    // rendait un champ vide qu'il fallait aller cliquer : WebKit y montre alors la date du jour et
    // met un seul segment en surbrillance — un champ qui affiche une date que la requête ne porte
    // pas. Rapporté à l'usage le 3 septembre 2026.
    //
    // **Le `type` relevé au moment de l'appel est ce qui mord.** `showPicker()` sur un champ encore
    // en `text` ne fait rien de visible et ne lève pas : sans le `flushSync`, ce test verrait
    // « text » et tout le reste passerait.
    const types: string[] = []
    const original = (HTMLInputElement.prototype as { showPicker?: () => void }).showPicker
    HTMLInputElement.prototype.showPicker = function showPicker(this: HTMLInputElement) {
      types.push(this.type)
    }

    try {
      const utilisateur = userEvent.setup()
      monter()

      await utilisateur.click(
        await screen.findByRole('button', { name: 'Opérateur de created_at' }),
      )
      await utilisateur.click(await screen.findByRole('button', { name: /^< avant le$/ }))

      expect(types).toEqual(['date'])
      // Le focus est pris avant l'ouverture : c'est ce qui laisse la saisie au clavier possible là
      // où `showPicker()` n'existe pas, ou est refusé.
      expect(document.activeElement).toBe(screen.getByLabelText('Filtrer created_at'))
    } finally {
      if (original === undefined) {
        delete (HTMLInputElement.prototype as { showPicker?: () => void }).showPicker
      } else {
        HTMLInputElement.prototype.showPicker = original
      }
    }
  })

  it('choisir un opérateur qui n’est pas une borne de date n’ouvre aucun calendrier', async () => {
    // `is null` sur la même colonne temporelle : le champ y est désactivé, un calendrier n'aurait
    // rien à recevoir.
    const appels: string[] = []
    const original = (HTMLInputElement.prototype as { showPicker?: () => void }).showPicker
    HTMLInputElement.prototype.showPicker = function showPicker(this: HTMLInputElement) {
      appels.push(this.type)
    }

    try {
      const utilisateur = userEvent.setup()
      monter()

      await utilisateur.click(
        await screen.findByRole('button', { name: 'Opérateur de created_at' }),
      )
      await utilisateur.click(await screen.findByRole('button', { name: /^∅ is null$/ }))

      expect(appels).toEqual([])
    } finally {
      if (original === undefined) {
        delete (HTMLInputElement.prototype as { showPicker?: () => void }).showPicker
      } else {
        HTMLInputElement.prototype.showPicker = original
      }
    }
  })

  it('une date incomplète n’envoie rien, et ne relance pas la lecture', async () => {
    // Un `type="date"` rend `''` tant que la date est incomplète, et il émet un événement à
    // *chaque* segment saisi au clavier : sans garde, taper une date enverrait trois lectures non
    // filtrées avant la bonne — `poserFiltre` rendant un tableau neuf même quand il n'y a rien à
    // retirer, la requête change d'identité et repart.
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    await utilisateur.click(screen.getByRole('button', { name: 'Opérateur de created_at' }))
    await utilisateur.click(await screen.findByRole('button', { name: /^> après le$/ }))
    // Choisir l'opérateur seul n'applique rien : un `>` sans borne n'est pas un filtre.
    expect(readRows).toHaveBeenCalledTimes(1)

    const champ = screen.getByLabelText('Filtrer created_at')
    for (let segment = 0; segment < 3; segment++) {
      fireEvent.change(champ, { target: { value: '' } })
    }
    expect(readRows).toHaveBeenCalledTimes(1)
  })

  it('le popover ajoute les quatre comparaisons sur une colonne numérique', async () => {
    const utilisateur = userEvent.setup()
    monter()
    await utilisateur.click(await screen.findByRole('button', { name: 'Opérateur de total_cents' }))

    const panneau = await screen.findByRole('dialog', { name: 'Opérateur · total_cents' })
    // Les six de base, plus `>`, `≥`, `≤`, `<` — réservées aux colonnes numériques.
    expect(panneau.querySelectorAll('li')).toHaveLength(10)
  })

  it('une comparaison numérique part au serveur', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    await utilisateur.click(await screen.findByRole('button', { name: 'Opérateur de total_cents' }))
    await utilisateur.click(await screen.findByRole('button', { name: /supérieur à/ }))
    await utilisateur.type(await screen.findByLabelText('Filtrer total_cents'), '5000{Enter}')

    await waitFor(() =>
      expect(derniereRequete(readRows).filters).toEqual([
        { column: 'total_cents', operator: 'gt', value: '5000' },
      ]),
    )
  })
})

describe('lire une colonne d’entiers comme un horodatage', () => {
  /**
   * Une entrée du menu ouvert. **`menuitem`, pas `button`** : `MenuContextuel` pose le rôle ARIA du
   * menu sur ses entrées, et chercher un `button` ne les trouve pas — alors que le dump de rôles de
   * Testing Library les affiche, ce qui rend l'échec trompeur.
   */
  const entreeDeMenu = (nom: string | RegExp) => screen.getByRole('menuitem', { name: nom })

  /** Ouvre le menu de l'en-tête d'une colonne, au clic droit. */
  async function menuDEntete(colonne: string) {
    const entete = screen.getByRole('columnheader', { name: new RegExp(`^${colonne}`) })
    fireEvent.contextMenu(entete)
    return screen.findByRole('menu', { name: `Actions sur la colonne ${colonne}` })
  }

  it('rien n’est deviné : la cellule montre l’entier tant qu’on n’a pas choisi', async () => {
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))
    // Le nombre, groupé par milliers comme tout entier. Aucun nom de colonne, aucune plage de
    // valeurs ne fait d'une époque une date : c'est l'utilisateur qui le dit.
    expect(screen.getByText('1 772 668 800 000')).toBeInTheDocument()
  })

  it('le menu ne propose la lecture que pour une colonne numérique', async () => {
    const utilisateur = userEvent.setup()
    monter()

    const surEntier = await menuDEntete('expedie_ms')
    expect(surEntier).toHaveTextContent('Horodatage · millisecondes')
    // L'échelle que l'échantillon suggère est annoncée comme telle — les trois restent proposées.
    expect(surEntier).toHaveTextContent('Horodatage · millisecondes (déduit)')
    expect(surEntier).toHaveTextContent('Horodatage · secondes')
    expect(surEntier).toHaveTextContent('Horodatage · microsecondes')
    await utilisateur.keyboard('{Escape}')

    // Une colonne que le moteur déclare déjà temporelle n'a rien à choisir, et une colonne de
    // texte n'a pas d'époque à lire : l'offrir ferait chercher à quoi elle sert.
    const surDate = await menuDEntete('created_at')
    expect(surDate).not.toHaveTextContent('Horodatage ·')
    await utilisateur.keyboard('{Escape}')

    const surTexte = await menuDEntete('status')
    expect(surTexte).not.toHaveTextContent('Horodatage ·')
  })

  it('choisir l’échelle change la cellule, et la lecture en place se dit', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    await menuDEntete('expedie_ms')
    await utilisateur.click(entreeDeMenu(/Horodatage · millisecondes/))

    expect(screen.getByText('2026-03-05 00:00:00')).toBeInTheDocument()
    expect(screen.queryByText('1 772 668 800 000')).toBeNull()
    // **La lecture n'est pas une requête.** Elle ne touche que l'affichage : rien ne repart au
    // serveur, qui a déjà rendu la valeur.
    expect(readRows).toHaveBeenCalledTimes(1)

    // L'entrée en vigueur est désactivée avec sa raison — la convention d'`EntreeDeMenu`, plutôt
    // qu'une coche qui aurait demandé un glyphe sur toutes les entrées du menu.
    await menuDEntete('expedie_ms')
    const enPlace = entreeDeMenu(/Horodatage · millisecondes/)
    expect(enPlace).toBeDisabled()
    expect(enPlace).toHaveAttribute('title', 'C’est déjà la lecture de cette colonne.')
  })

  it('la lecture suit la colonne, pas toutes les colonnes numériques', async () => {
    const utilisateur = userEvent.setup()
    monter()

    await menuDEntete('expedie_ms')
    await utilisateur.click(entreeDeMenu(/Horodatage · millisecondes/))

    // `total_cents` porte un compte, et rien ne l'a touché. **Mesuré sur ce que la lecture aurait
    // produit** : son `1` lu en millisecondes donnerait `1970-01-01 00:00:00`, donc l'absence de
    // cette date est ce qui dit que la lecture n'a pas débordé sur la colonne voisine.
    expect(screen.getByText('2026-03-05 00:00:00')).toBeInTheDocument()
    expect(screen.queryByText('1970-01-01 00:00:00')).toBeNull()
    await menuDEntete('total_cents')
    // Sa lecture en vigueur est « nombre » : c'est celle-là qui est grisée, aucune échelle.
    expect(entreeDeMenu('Lire comme un nombre')).toBeDisabled()
    expect(entreeDeMenu(/Horodatage · millisecondes/)).toBeEnabled()
    await utilisateur.keyboard('{Escape}')

    // **Et sa liste d'opérateurs n'a pas bougé non plus.** L'affichage et les opérateurs viennent de
    // deux chemins différents — `valeurRelue` et `categorieLue` — donc une lecture qui déborderait
    // sur l'un sans déborder sur l'autre ne se verrait pas sans les deux mesures.
    await utilisateur.click(screen.getByRole('button', { name: 'Opérateur de total_cents' }))
    expect(await screen.findByRole('button', { name: /supérieur à/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /avant le/ })).toBeNull()
  })

  it('« Lire comme un nombre » rend la colonne à son entier', async () => {
    const utilisateur = userEvent.setup()
    monter()

    await menuDEntete('expedie_ms')
    await utilisateur.click(entreeDeMenu(/Horodatage · millisecondes/))
    await waitFor(() => expect(screen.getByText('2026-03-05 00:00:00')).toBeInTheDocument())

    await menuDEntete('expedie_ms')
    await utilisateur.click(entreeDeMenu('Lire comme un nombre'))
    expect(screen.getByText('1 772 668 800 000')).toBeInTheDocument()
  })

  it('la colonne lue en horodatage reçoit « avant le », et sa borne repart en entier', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    // Avant la lecture, c'est une colonne numérique : les quatre comparaisons, pas « avant le ».
    await utilisateur.click(screen.getByRole('button', { name: 'Opérateur de expedie_ms' }))
    expect(await screen.findByRole('button', { name: /supérieur à/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /avant le/ })).toBeNull()
    await utilisateur.keyboard('{Escape}')

    await menuDEntete('expedie_ms')
    await utilisateur.click(entreeDeMenu(/Horodatage · millisecondes/))

    await utilisateur.click(screen.getByRole('button', { name: 'Opérateur de expedie_ms' }))
    await utilisateur.click(await screen.findByRole('button', { name: /^< avant le$/ }))

    const champ = screen.getByLabelText('Filtrer expedie_ms')
    expect(champ).toHaveAttribute('type', 'date')
    fireEvent.change(champ, { target: { value: '2026-03-05' } })

    // **La colonne reste numérique pour le moteur** : la date choisie repart en entier, à l'échelle
    // de la colonne, et aucun adaptateur n'a besoin de savoir qu'on lit une époque.
    await waitFor(() =>
      expect(derniereRequete(readRows).filters).toEqual([
        { column: 'expedie_ms', operator: 'lt', value: String(MINUIT_MS) },
      ]),
    )
    // Et le champ montre la date, non l'entier : sans le retour, un `type="date"` écarterait la
    // valeur et se viderait sous les yeux de qui vient de la choisir.
    expect(champ).toHaveValue('2026-03-05')
  })
})

describe('tri', () => {
  it('un clic trie côté serveur, un second inverse le sens', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    const entete = screen.getByRole('button', { name: 'Trier par created_at' })
    await utilisateur.click(entete)
    await waitFor(() =>
      expect(derniereRequete(readRows).sort).toEqual([
        { column: 'created_at', direction: 'ascending' },
      ]),
    )

    await utilisateur.click(entete)
    await waitFor(() =>
      expect(derniereRequete(readRows).sort).toEqual([
        { column: 'created_at', direction: 'descending' },
      ]),
    )
  })

  it('un ⌘-clic empile un second critère, dans l’ordre des clics', async () => {
    const utilisateur = userEvent.setup()
    const { readRows } = monter()
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1))

    await utilisateur.click(screen.getByRole('button', { name: 'Trier par created_at' }))
    await utilisateur.keyboard('{Meta>}')
    await utilisateur.click(screen.getByRole('button', { name: 'Trier par status' }))
    await utilisateur.keyboard('{/Meta}')

    await waitFor(() =>
      expect(derniereRequete(readRows).sort.map((c) => c.column)).toEqual(['created_at', 'status']),
    )
  })

  it('la pastille de rang n’apparaît qu’à partir de deux critères', async () => {
    const utilisateur = userEvent.setup()
    monter()

    // Dans l'**en-tête** : « 1 » se trouve aussi dans la gouttière et dans les cellules, où il
    // ne veut rien dire de tel. La pastille vit à côté du nom, dans le bouton de glissement
    // (`23h`) — pas dans le bouton de tri, qui ne porte plus que la flèche — donc la recherche
    // part de l'en-tête entier (`role="columnheader"`), le seul ancêtre commun aux deux.
    const rang = (bouton: HTMLElement) =>
      bouton.closest('[role="columnheader"]')?.querySelector('[class*="rang"]') ?? null

    const created = await screen.findByRole('button', { name: 'Trier par created_at' })
    await utilisateur.click(created)
    // Un « 1 » solitaire sur la seule colonne triée serait du bruit.
    expect(rang(created)).toBeNull()

    await utilisateur.keyboard('{Meta>}')
    await utilisateur.click(screen.getByRole('button', { name: 'Trier par status' }))
    await utilisateur.keyboard('{/Meta}')

    expect(rang(screen.getByRole('button', { name: 'Trier par created_at' }))).toHaveTextContent(
      '1',
    )
    expect(rang(screen.getByRole('button', { name: 'Trier par status' }))).toHaveTextContent('2')
  })
})
