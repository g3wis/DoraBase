import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import type { QueryResult } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { ConsoleView } from './ConsoleView'

// jsdom ne définit pas `elementFromPoint`, que la grille lit au relâchement d'un glissement — le
// même bouchon que `VirtualGrid.test.tsx` ; ici seuls les déplacements au clavier servent.
document.elementFromPoint = vi.fn(() => null)

const RESULTAT: QueryResult = {
  columns: ['id', 'statut', 'total'],
  rows: [
    [
      { kind: 'int', value: 7 },
      { kind: 'text', value: 'paid' },
      { kind: 'decimal', value: '12.50' },
    ],
  ],
  sql: 'select * from commandes',
  durationMs: 12,
  appliedLimit: null,
  affected: null,
}

/** Le texte du document de l'éditeur — même lecture que `SqlEditor.test.tsx`, même raison. */
const LIGNE_DE_MESURE = 'abc def ghi jkl mno pqr stu vwx yz'
const texteDeLEditeur = () =>
  [...document.querySelectorAll('.cm-content > .cm-line')]
    .map((l) => l.textContent ?? '')
    .filter((t) => !t.startsWith(LIGNE_DE_MESURE.slice(0, 11)))
    .join('\n')

/**
 * L'écran est monté **avec la tenue du texte**, comme le poste de travail le fait : le stepper lit
 * la limite dans la prop `texte`, donc une réécriture doit redescendre pour qu'il la voie — c'est
 * précisément le circuit qu'on mesure.
 */
function Harnais({
  texteInitial,
  resultat = RESULTAT,
}: {
  texteInitial: string
  resultat?: QueryResult
}) {
  const [texte, setTexte] = useState(texteInitial)
  return (
    <ConsoleView texte={texte} onTexteChange={setTexte} resultat={resultat} onExecuter={() => {}} />
  )
}

function monter(texteInitial: string, resultat?: QueryResult) {
  return render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <Harnais texteInitial={texteInitial} resultat={resultat} />
    </LanguageProvider>,
  )
}

/** Le même harnais, avec une oreille sur le texte : le test du repli lit ce que l'écran détient. */
function HarnaisEspion({
  texteInitial,
  resultat,
  onTexte,
}: {
  texteInitial: string
  resultat: QueryResult
  onTexte: (texte: string) => void
}) {
  const [texte, setTexte] = useState(texteInitial)
  return (
    <ConsoleView
      texte={texte}
      onTexteChange={(nouveau) => {
        setTexte(nouveau)
        onTexte(nouveau)
      }}
      resultat={resultat}
      onExecuter={() => {}}
    />
  )
}

test('réordonner une colonne du résultat réécrit la projection dans l’éditeur', async () => {
  const utilisateur = userEvent.setup()
  monter('select * from commandes')

  screen.getByRole('button', { name: 'Déplacer statut (flèches gauche et droite)' }).focus()
  await utilisateur.keyboard('{ArrowLeft}')

  // L'éditeur porte la requête réécrite — complète, exécutable —, reçue par le circuit normal
  // d'`onTexteChange`, comme une frappe.
  expect(texteDeLEditeur()).toBe('select statut, id, total from commandes')
})

test('une requête que la réécriture ne sait pas lire reste intacte — la grille, elle, se réordonne', async () => {
  const utilisateur = userEvent.setup()
  monter('select count(*) as n, statut, id, total from commandes group by 2, 3, 4')

  screen.getByRole('button', { name: 'Déplacer statut (flèches gauche et droite)' }).focus()
  await utilisateur.keyboard('{ArrowLeft}')

  // Corrompre la requête serait pire que ne pas la réécrire : le texte n'a pas bougé…
  expect(texteDeLEditeur()).toBe(
    'select count(*) as n, statut, id, total from commandes group by 2, 3, 4',
  )
  // …et l'affichage, lui, a bien suivi le geste.
  const noms = screen.getAllByRole('columnheader').map((entete) => entete.textContent)
  expect(noms).toEqual(['statut', 'id', 'total'])
})

test('masquer une colonne au menu d’en-tête la retire du select', async () => {
  const utilisateur = userEvent.setup()
  monter('select * from commandes')

  const [, statut] = screen.getAllByRole('columnheader')
  if (!statut) throw new Error('en-tête introuvable')
  fireEvent.contextMenu(statut, { clientX: 40, clientY: 20 })
  await utilisateur.click(
    within(await screen.findByRole('menu', { name: 'Actions sur la colonne statut' })).getByRole(
      'menuitem',
      { name: 'Masquer la colonne' },
    ),
  )

  // La requête dit exactement ce qui s'affiche : le `*` s'est développé sans la colonne masquée.
  expect(texteDeLEditeur()).toBe('select id, total from commandes')
})

test('le menu des colonnes de la barre coche, masque et rend — et la requête suit chaque bascule', async () => {
  const utilisateur = userEvent.setup()
  monter('select * from commandes')

  // Le même bouton qu'`A5`, compte compris.
  const bouton = screen.getByRole('button', { name: 'Colonnes affichées' })
  expect(bouton).toHaveTextContent('3/3')

  await utilisateur.click(bouton)
  await utilisateur.click(screen.getByRole('checkbox', { name: 'statut' }))
  expect(texteDeLEditeur()).toBe('select id, total from commandes')
  expect(bouton).toHaveTextContent('2/3')

  // Recocher rend la colonne au select — nue, à sa place d'affichage.
  await utilisateur.click(screen.getByRole('checkbox', { name: 'statut' }))
  expect(texteDeLEditeur()).toBe('select id, statut, total from commandes')
  expect(bouton).toHaveTextContent('3/3')

  // La dernière colonne visible ne se décoche pas : ce menu est le chemin du retour de la
  // console, et une grille sans aucune colonne n'en offrirait plus. Même règle que le menu
  // d'en-tête.
  await utilisateur.click(screen.getByRole('checkbox', { name: 'statut' }))
  await utilisateur.click(screen.getByRole('checkbox', { name: 'id' }))
  expect(texteDeLEditeur()).toBe('select total from commandes')
  expect(screen.getByRole('checkbox', { name: 'total' })).toBeDisabled()
})

test('le stepper LIMIT écrit dans la requête, et lit ce qu’elle porte', async () => {
  const utilisateur = userEvent.setup()
  monter('select * from commandes')

  // Sans `limit` écrit, le stepper montre celui que le moteur ajoutera — et le dit.
  const valeur = screen.getByTitle(/ne porte pas de LIMIT/)
  expect(valeur).toHaveTextContent('1000')

  await utilisateur.click(screen.getByRole('button', { name: 'Réduire la limite' }))
  expect(texteDeLEditeur()).toBe('select * from commandes\nlimit 500')
  // La limite est désormais **écrite** : plus d'infobulle d'implicite, et le stepper la lit.
  expect(screen.queryByTitle(/ne porte pas de LIMIT/)).not.toBeInTheDocument()

  await utilisateur.click(screen.getByRole('button', { name: 'Augmenter la limite' }))
  expect(texteDeLEditeur()).toBe('select * from commandes\nlimit 1000')
})

test('une longue liste s’affiche repliée derrière une `…`, mais le texte porte tout — et le clic déplie', async () => {
  const utilisateur = userEvent.setup()
  const colonnes = [
    'identifiant_commande',
    'identifiant_client',
    'statut_livraison',
    'montant_total_cents',
    'devise_facturation',
    'date_de_creation',
    'date_expedition',
    'code_promotionnel',
  ]
  const large: QueryResult = {
    ...RESULTAT,
    columns: colonnes,
    rows: [colonnes.map((_, index) => ({ kind: 'int', value: index }))],
  }
  const textes: string[] = []
  render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <HarnaisEspion
        texteInitial="select * from orders"
        resultat={large}
        onTexte={(t) => textes.push(t)}
      />
    </LanguageProvider>,
  )

  screen
    .getByRole('button', { name: 'Déplacer identifiant_client (flèches gauche et droite)' })
    .focus()
  await utilisateur.keyboard('{ArrowLeft}')

  // **Le texte porte la requête entière** — c'est lui que `⌘↩` exécute et qu'une copie emporte…
  const complet = textes.at(-1) ?? ''
  for (const colonne of colonnes) expect(complet).toContain(colonne)
  // …et **l'affichage la replie** : les lignes de continuation sont derrière la marque `…`.
  expect(texteDeLEditeur()).not.toContain('code_promotionnel')
  const marque = document.querySelector('.cm-foldPlaceholder')
  if (!(marque instanceof HTMLElement)) throw new Error('marque de repli introuvable')
  expect(marque).toHaveTextContent('…')

  // Cliquer la marque déplie — le texte, lui, n'a jamais bougé.
  await utilisateur.click(marque)
  expect(texteDeLEditeur()).toContain('code_promotionnel')
  expect(textes.at(-1)).toBe(complet)

  // Et le geste a un retour : la gouttière repose le pli — on bascule entre les deux à volonté.
  const replier = screen.getAllByTitle('Replier').at(-1)
  if (!replier) throw new Error('marque de gouttière introuvable')
  await utilisateur.click(replier)
  expect(texteDeLEditeur()).not.toContain('code_promotionnel')
  expect(document.querySelector('.cm-foldPlaceholder')).not.toBeNull()
  // **C'est notre pli, pas celui de la grammaire SQL** : le repli syntaxique de CodeMirror, qui
  // reste en repli de service, cacherait la clause `from` avec la liste. La nôtre la laisse en
  // vue — c'est ce qui distingue « replier les colonnes » de « replier la requête ».
  expect(texteDeLEditeur()).toContain('from orders')
  expect(textes.at(-1)).toBe(complet)
})

test('une requête qui porte déjà sa limite pilote le stepper', () => {
  monter('select * from commandes limit 37')
  // 37 n'est pas un palier : la valeur affichée reste celle de la requête, jamais arrondie.
  const stepper = screen.getByText('LIMIT').parentElement
  if (!stepper) throw new Error('stepper introuvable')
  expect(stepper).toHaveTextContent('37')
})

/**
 * Le régime de transaction (`API-38`), dans la barre d'outils.
 *
 * Ce que ces tests mesurent est le **contrôle** : qu'il ne paraît pas sans son réglage, qu'il
 * publie les deux modes, et qu'il ne bouge pas quand une raison l'en empêche. Qu'il soit branché à
 * la connexion — donc que le panneau de droite suive — appartient à l'assemblage, et c'est
 * `Workbench.test.tsx` qui le garde (règle n° 8).
 */
function monterAvecTransaction(
  transaction: Parameters<typeof ConsoleView>[0]['transaction'],
  texteInitial = 'select 1',
) {
  return render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <ConsoleView
        texte={texteInitial}
        onTexteChange={() => {}}
        onExecuter={() => {}}
        transaction={transaction}
      />
    </LanguageProvider>,
  )
}

test('sans réglage de transaction, la barre d’outils n’en montre pas', () => {
  monter('select 1')
  // **Une bascule sans effet se lirait comme une panne** (défaut n° 36) : la galerie et les
  // vitrines montent la console sans connexion, donc sans régime à régler.
  expect(screen.queryByRole('switch', { name: 'Transaction manuelle' })).toBeNull()
})

test('la bascule publie les deux modes', async () => {
  const utilisateur = userEvent.setup()
  const changements: string[] = []
  monterAvecTransaction({
    mode: 'auto',
    onModeChange: (mode) => changements.push(mode),
  })

  const bascule = screen.getByRole('switch', { name: 'Transaction manuelle' })
  expect(bascule).toHaveAttribute('aria-checked', 'false')
  await utilisateur.click(bascule)
  expect(changements).toEqual(['manual'])
})

test('en mode manuel, la bascule est allumée et rend au mode automatique', async () => {
  const utilisateur = userEvent.setup()
  const changements: string[] = []
  monterAvecTransaction({
    mode: 'manual',
    onModeChange: (mode) => changements.push(mode),
  })

  const bascule = screen.getByRole('switch', { name: 'Transaction manuelle' })
  expect(bascule).toHaveAttribute('aria-checked', 'true')
  await utilisateur.click(bascule)
  expect(changements).toEqual(['auto'])
})

test('une raison fige la bascule, et l’explique', async () => {
  const utilisateur = userEvent.setup()
  const changements: string[] = []
  monterAvecTransaction({
    mode: 'auto',
    onModeChange: (mode) => changements.push(mode),
    raison: 'La console MongoDB ne fait que lire.',
  })

  const bascule = screen.getByRole('switch', { name: 'Transaction manuelle' })
  // **`aria-disabled` et non `disabled`** : la raison vit dans une infobulle, qu'un bouton
  // désactivé rendrait inatteignable (piège n° 3).
  expect(bascule).toHaveAttribute('aria-disabled', 'true')
  expect(bascule).not.toBeDisabled()
  expect(bascule).toHaveAttribute('title', 'La console MongoDB ne fait que lire.')
  // Et la garde n'est pas décorative : le clic ne change rien.
  await utilisateur.click(bascule)
  expect(changements).toEqual([])
})

/**
 * L'export porte la projection **affichée** (`API-29`).
 *
 * C'est ici que ça se vérifie et pas ailleurs : les colonnes masquées et l'ordre vivent dans cet
 * écran — c'est déjà d'ici que la requête est réécrite —, et le cœur n'en sait rien. Un export qui
 * porterait les colonnes du résultat brut rendrait celles qu'on vient de masquer, dans l'ordre du
 * serveur plutôt que celui qu'on a réglé.
 */
test('l’export porte les colonnes visibles, dans l’ordre affiché', async () => {
  const utilisateur = userEvent.setup()
  const onExporter = vi.fn(async () => 10)
  const [texte, setTexte] = ['select * from commandes', vi.fn()]
  render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <ConsoleView
        texte={texte}
        onTexteChange={setTexte}
        resultat={RESULTAT}
        onExecuter={() => {}}
        onExporter={onExporter}
      />
    </LanguageProvider>,
  )

  // Le décor est déplacé **puis** amputé : les deux gestes doivent se retrouver dans le fichier,
  // et un décor qui n'en ferait qu'un ne distinguerait pas « l'ordre suit » de « le masquage suit ».
  screen.getByRole('button', { name: 'Déplacer statut (flèches gauche et droite)' }).focus()
  await utilisateur.keyboard('{ArrowLeft}')
  const [, id] = screen.getAllByRole('columnheader')
  if (!id) throw new Error('en-tête introuvable')
  fireEvent.contextMenu(id, { clientX: 40, clientY: 20 })
  await utilisateur.click(
    within(await screen.findByRole('menu', { name: 'Actions sur la colonne id' })).getByRole(
      'menuitem',
      { name: 'Masquer la colonne' },
    ),
  )
  expect(screen.getAllByRole('columnheader').map((e) => e.textContent)).toEqual(['statut', 'total'])

  await utilisateur.click(screen.getByRole('button', { name: /^Exporter$/ }))
  await utilisateur.click(screen.getByRole('button', { name: 'Fichier CSV' }))

  // Les colonnes **et** les valeurs suivent : projeter les noms sans réduire les lignes aurait
  // décalé chaque valeur d'une colonne, ce qu'une assertion sur les seuls noms laisserait passer.
  expect(onExporter).toHaveBeenCalledWith(
    'csv',
    ['statut', 'total'],
    [
      [
        { kind: 'text', value: 'paid' },
        { kind: 'decimal', value: '12.50' },
      ],
    ],
  )
})
