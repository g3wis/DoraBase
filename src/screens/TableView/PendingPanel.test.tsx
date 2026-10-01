import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { Value } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import type { LigneAjoutee, LigneSupprimee, ModificationDeCellule } from './modifications'
import { PendingPanel } from './PendingPanel'

const SQL =
  'BEGIN;\nUPDATE "public"."orders" SET "status" = \'shipped\' WHERE "id" = \'184219\';\nCOMMIT;'

function modification(over: Partial<ModificationDeCellule> = {}): ModificationDeCellule {
  return {
    sorte: 'cellule',
    cle: '184219',
    rang: 2,
    column: 'status',
    avant: { kind: 'text', value: 'paid' } as Value,
    apres: { kind: 'texte', texte: 'shipped' },
    ...over,
  }
}

function monter(props: Partial<Parameters<typeof PendingPanel>[0]> = {}) {
  const onRetirer = vi.fn()
  const onToutAnnuler = vi.fn()
  render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <PendingPanel
          attente={[modification()]}
          table="public.orders"
          sql={SQL}
          onRetirer={onRetirer}
          onToutAnnuler={onToutAnnuler}
          {...props}
        />
      </LanguageProvider>
    </>,
  )
  return { onRetirer, onToutAnnuler }
}

test('une carte par modification, dans l’ordre du modèle', () => {
  monter({
    attente: [
      modification({ column: 'status' }),
      modification({ cle: '184217', rang: 4, column: 'currency' }),
    ],
  })
  const cartes = screen.getAllByRole('listitem')
  expect(cartes).toHaveLength(2)
  // L'ordre est celui de la saisie : le relire dans un autre ordre que le SQL empêcherait de
  // rapprocher une carte de son `UPDATE`.
  expect(cartes[0]).toHaveTextContent('status')
  expect(cartes[1]).toHaveTextContent('currency')
})

test('la carte porte le rang et la clé, pas seulement l’un des deux', () => {
  monter()
  // Le rang situe la ligne à l'écran ; la clé l'identifie quand un tri l'aura déplacée (`11a`).
  expect(screen.getByRole('listitem')).toHaveTextContent('ligne 2 · 184219')
})

test('la croix retire celle-là, et pas une autre', async () => {
  const { onRetirer } = monter({
    attente: [
      modification({ column: 'status' }),
      modification({ cle: '184217', rang: 4, column: 'currency' }),
    ],
  })
  await userEvent.click(screen.getByRole('button', { name: 'Retirer la modification de currency' }))
  expect(onRetirer).toHaveBeenCalledExactlyOnceWith('184217', 'currency')
})

test('le diff distingue NULL, la chaîne vide et une valeur — chacun par sa forme', () => {
  monter({
    attente: [
      modification({ column: 'a', avant: { kind: 'null' }, apres: { kind: 'texte', texte: 'x' } }),
      modification({
        cle: '2',
        column: 'b',
        avant: { kind: 'text', value: '' },
        apres: { kind: 'texte', texte: 'x' },
      }),
      modification({
        cle: '3',
        column: 'c',
        avant: { kind: 'text', value: 'paid' },
        apres: { kind: 'null' },
      }),
    ],
  })
  const cartes = screen.getAllByRole('listitem')
  // **« NULL → valeur » et « '' → valeur » sont deux changements différents.** Les rendre pareil
  // ferait croire à une correction anodine là où l'on remplace une absence de valeur.
  expect(cartes[0]).toHaveTextContent('NULL')
  expect(within(cartes[1] as HTMLElement).getByText("''")).toBeInTheDocument()
  expect(cartes[1]).not.toHaveTextContent('NULL')
  // Et dans l'autre sens : une valeur qu'on efface vers `NULL`.
  expect(cartes[2]).toHaveTextContent('NULL')
})

test("vider un champ montre '' et non NULL — les deux ne s’écrivent pas pareil", () => {
  monter({
    attente: [
      modification({
        column: 'note',
        avant: { kind: 'text', value: 'texte' },
        apres: { kind: 'texte', texte: '' },
      }),
      modification({
        cle: '2',
        column: 'shipped_at',
        avant: { kind: 'text', value: 'texte' },
        apres: { kind: 'null' },
      }),
    ],
  })
  const cartes = screen.getAllByRole('listitem')
  // **Vider un champ donne la chaîne vide, pas `NULL`** (`11a`), et le SQL généré écrit `''` dans un
  // cas et `NULL` dans l'autre. Un panneau qui rendrait les deux identiques laisserait relire un
  // diff qui ne correspond pas au SQL juste en dessous.
  expect(within(cartes[0] as HTMLElement).getByText("''")).toBeInTheDocument()
  expect(cartes[0]).not.toHaveTextContent('NULL')
  expect(cartes[1]).toHaveTextContent('NULL')
})

test('le nombre n’est pas formaté dans le diff', () => {
  monter({
    attente: [
      modification({
        column: 'total_cents',
        avant: { kind: 'int', value: 12_900 },
        apres: { kind: 'texte', texte: '12901' },
      }),
    ],
  })
  // Le diff montre ce que la base contient et ce qui partira : « 12 900 → 12901 » ferait douter
  // d'une valeur pourtant juste, et l'espace insécable n'est pas dans la base.
  expect(screen.getByRole('listitem')).toHaveTextContent('12900')
  expect(screen.getByRole('listitem')).not.toHaveTextContent('12 900')
})

test('le SQL affiché est celui reçu, caractère pour caractère', () => {
  monter()
  const bloc = screen.getByText(/SQL qui sera exécuté/).parentElement?.parentElement
  // **Le test tombe si l'écran le reconstruit.** Le bloc annonce « SQL qui sera exécuté » : s'il
  // n'est pas exactement celui qui partira, il est pire qu'absent.
  expect(bloc?.textContent).toContain(SQL)
})

test('sans SQL, le panneau le dit plutôt que d’en fabriquer un', () => {
  monter({ sql: null })
  expect(screen.getByText(/prépare la requête/)).toBeInTheDocument()
  expect(screen.queryByText(/UPDATE/)).not.toBeInTheDocument()
})

test('un refus de prévisualisation s’affiche à la place du bloc', () => {
  monter({ sql: null, erreurSql: 'la table n’a pas de clé primaire' })
  expect(screen.getByRole('alert')).toHaveTextContent('pas de clé primaire')
})

test('après une écriture, le panneau montre de quoi défaire et non des cartes vides', () => {
  monter({ attente: [], patchInverse: 'BEGIN;\nUPDATE t SET a = 1;\nCOMMIT;' })
  // **Le panneau survit au vidage du modèle.** Une première version le démontait avec la dernière
  // carte, emportant le patch inverse : l'utilisateur perdait le seul moyen d'annuler, à l'instant
  // précis où il pouvait en avoir besoin.
  expect(screen.getByText(/SQL qui annule cette écriture/)).toBeInTheDocument()
  expect(screen.queryByText(/SQL qui sera exécuté/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Appliquer/ })).not.toBeInTheDocument()
  // Ce qu'il est vraiment : disponible dans la session, pas enregistré.
  expect(screen.getByText(/ne l’a pas enregistré/)).toBeInTheDocument()
})

test('le panneau n’annonce plus aucune confirmation de production (#168)', () => {
  // La lecture seule refuse en amont : il n'y a plus de confirmation à annoncer, ni avant ni après
  // l'écriture.
  monter()
  expect(screen.queryByText(/production/)).not.toBeInTheDocument()
  expect(screen.queryByText(/demande une confirmation/)).not.toBeInTheDocument()
})

test('« Appliquer » est désactivé et dit pourquoi tant que rien n’écrit', () => {
  monter()
  const appliquer = screen.getByRole('button', { name: /Appliquer/ })
  // La leçon du défaut n° 36 : un bouton cliquable et inerte se lit comme une panne.
  expect(appliquer).toBeDisabled()
  expect(appliquer).toHaveAttribute('title', expect.stringContaining('rien ne peut partir'))
})

test('« Tout annuler » vide le modèle', async () => {
  const { onToutAnnuler } = monter()
  await userEvent.click(screen.getByRole('button', { name: 'Tout annuler' }))
  expect(onToutAnnuler).toHaveBeenCalledOnce()
})

test('le compte de l’en-tête suit le modèle', () => {
  monter({ attente: [modification(), modification({ cle: '2' }), modification({ cle: '3' })] })
  expect(screen.getByLabelText('Modifications en attente de la table')).toHaveTextContent('3')
})

function ligneAjoutee(over: Partial<LigneAjoutee> = {}): LigneAjoutee {
  return {
    sorte: 'ligne',
    cle: 'nouvelle-1',
    rang: 1,
    valeurs: { status: { kind: 'texte', texte: 'pending' } },
    ...over,
  }
}

test('une ligne ajoutée se lit comme une liste de valeurs, sans diff', () => {
  monter({ attente: [ligneAjoutee()] })
  const carte = screen.getAllByRole('listitem')[0] as HTMLElement
  // **Pas de clé à montrer** : celle de la base n'existe pas encore, et en inventer une ferait
  // croire à une ligne déjà écrite.
  expect(carte).toHaveTextContent('nouvelle ligne 1')
  expect(carte).toHaveTextContent('status')
  expect(carte).toHaveTextContent('pending')
})

test('une ligne ajoutée se retire entière, d’une seule croix', async () => {
  const { onRetirer } = monter({ attente: [ligneAjoutee()] })
  // Sa carte n'offre pas de retrait par colonne : il n'y a rien à retirer isolément d'une ligne
  // qui n'existe pas encore.
  await userEvent.click(screen.getByRole('button', { name: 'Retirer la nouvelle ligne 1' }))
  expect(onRetirer).toHaveBeenCalledWith('nouvelle-1', '')
})

test('une ligne sans valeur dit que la base appliquera ses défauts', () => {
  monter({ attente: [ligneAjoutee({ valeurs: {} })] })
  // Une carte vide laisserait croire à une entrée perdue ; elle dit ce qui va se passer.
  expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('la base appliquera ses défauts')
})

function ligneSupprimee(over: Partial<LigneSupprimee> = {}): LigneSupprimee {
  return { sorte: 'suppression', cle: '184219', rang: 2, ...over }
}

test('une ligne marquée pour suppression porte le rang, la clé, et dit ce qui va se passer', () => {
  monter({ attente: [ligneSupprimee()] })
  const carte = screen.getAllByRole('listitem')[0] as HTMLElement
  expect(carte).toHaveTextContent('ligne 2')
  expect(carte).toHaveTextContent('184219')
  expect(carte).toHaveTextContent('sera supprimée')
})

test('la croix d’une ligne marquée annule la marque, sans colonne à retirer', async () => {
  const { onRetirer } = monter({ attente: [ligneSupprimee()] })
  await userEvent.click(
    screen.getByRole('button', { name: 'Annuler la suppression de la ligne 2' }),
  )
  expect(onRetirer).toHaveBeenCalledWith('184219', '')
})

/**
 * Une connexion passée en lecture seule **avec des modifications en attente** (#167) : elles restent,
 * « Tout annuler » aussi, et « Appliquer » dit pourquoi il ne part pas — en `aria-disabled`, pour que
 * sa raison reste atteignable (piège n° 3).
 */
test('en lecture seule, « Appliquer » garde les modifications et dit sa raison', async () => {
  const onAppliquer = vi.fn()
  const { onToutAnnuler } = monter({
    onAppliquer,
    lectureSeule: 'Lecture seule imposée par « prod ».',
  })
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
  const appliquer = screen.getByRole('button', { name: /Appliquer/ })
  expect(appliquer).toHaveAttribute('aria-disabled', 'true')
  expect(appliquer).not.toBeDisabled()
  expect(appliquer).toHaveAttribute('title', 'Lecture seule imposée par « prod ».')
  await userEvent.click(appliquer)
  expect(onAppliquer).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: /Tout annuler/ }))
  expect(onToutAnnuler).toHaveBeenCalled()
})
