import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { SchemaInfo } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { SchemaManager } from './SchemaManager'

const CIBLE = { projet: 'Atelier Nord', environnement: 'prod', base: 'analytics' }

function schema(name: string, over: Partial<SchemaInfo> = {}): SchemaInfo {
  return {
    name,
    owner: 'atelier',
    system: false,
    counts: { tables: 3, views: 1, functions: 0, indexes: 4 },
    ...over,
  }
}

/** Le décor : deux schémas ordinaires, et les trois schémas de catalogue de PostgreSQL. */
const SCHEMAS: SchemaInfo[] = [
  schema('public'),
  schema('reporting', {
    owner: 'analyste',
    counts: { tables: 1, views: 0, functions: 2, indexes: 1 },
  }),
  schema('information_schema', { system: true, owner: 'postgres' }),
  schema('pg_catalog', { system: true, owner: 'postgres' }),
  schema('pg_toast', { system: true, owner: 'postgres' }),
]

function monter(options: Partial<Parameters<typeof SchemaManager>[0]> = {}) {
  return render(
    <>
      <Sprite />
      {/* **`language: 'fr'` explicite**, jamais la langue de la machine : les assertions portent sur
          des libellés. Même arbitrage que la locale figée de Playwright. */}
      <LanguageProvider preferences={{ language: 'fr' }}>
        <SchemaManager
          cible={CIBLE}
          affiches={null}
          onClose={() => {}}
          onLire={async () => SCHEMAS}
          onCreer={async () => {}}
          onEnregistrer={async () => {}}
          {...options}
        />
      </LanguageProvider>
    </>,
  )
}

/** L'interrupteur d'un schéma, par son nom accessible. */
function interrupteur(nom: string) {
  return screen.getByRole('switch', { name: `Afficher ${nom} dans l’arbre` })
}

test('le cadre s’annonce dans l’en-tête : projet, environnement, connexion', async () => {
  monter()
  const modale = await screen.findByRole('dialog', { name: 'Gérer les schémas' })

  // Le triplet est le **cadre** de cet écran, pas un de ses champs — la leçon du projet dans `A2`.
  expect(modale).toHaveTextContent('Atelier Nord')
  expect(modale).toHaveTextContent('prod')
  expect(modale).toHaveTextContent('analytics')
})

test('sans préférence enregistrée, tous les non-système sont cochés', async () => {
  monter({ affiches: null })
  await waitFor(() => expect(interrupteur('public')).toBeInTheDocument())

  // **La décision de `API-33`** : rien de réglé montre ce que l'arbre montre déjà. Cocher `public`
  // seul viderait l'arbre des bases où `public` est justement le schéma vide.
  expect(interrupteur('public')).toHaveAttribute('aria-checked', 'true')
  expect(interrupteur('reporting')).toHaveAttribute('aria-checked', 'true')
})

test('une préférence enregistrée décide seule, y compris pour un schéma de catalogue', async () => {
  monter({ affiches: ['reporting', 'pg_catalog'] })
  await waitFor(() => expect(interrupteur('reporting')).toBeInTheDocument())

  expect(interrupteur('public')).toHaveAttribute('aria-checked', 'false')
  expect(interrupteur('reporting')).toHaveAttribute('aria-checked', 'true')

  // Les schémas système sont **repliés** : il faut ouvrir la section pour voir le leur.
  await userEvent.click(screen.getByRole('button', { name: /Schémas système \(3\)/ }))
  expect(interrupteur('pg_catalog')).toHaveAttribute('aria-checked', 'true')
  expect(interrupteur('pg_toast')).toHaveAttribute('aria-checked', 'false')
})

test('les schémas système sont listés et repliés, non masqués', async () => {
  monter()
  const section = await screen.findByRole('button', { name: /Schémas système \(3\)/ })

  // **Listés** : ils existent, donc ils ne sont pas tus — masquer est le bon choix pour ce qu'un
  // moteur n'a réellement pas. **Repliés** : ce n'est pas ce qu'on vient régler.
  expect(section).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('switch', { name: /pg_catalog/ })).toBeNull()

  await userEvent.click(section)
  expect(section).toHaveAttribute('aria-expanded', 'true')
  // Et l'interrupteur y fonctionne comme ailleurs : un contrôle sans effet serait pire qu'absent.
  await userEvent.click(interrupteur('pg_catalog'))
  expect(interrupteur('pg_catalog')).toHaveAttribute('aria-checked', 'true')
})

test('« Enregistrer » envoie les noms cochés, dans l’ordre du catalogue', async () => {
  const envoyes: unknown[] = []
  monter({
    affiches: null,
    onEnregistrer: async (schemas) => {
      envoyes.push(schemas)
    },
  })
  await waitFor(() => expect(interrupteur('public')).toBeInTheDocument())

  // Décoché puis recoché : un `Set` aurait rendu `['reporting', 'public']`, l'ordre des clics.
  await userEvent.click(interrupteur('public'))
  await userEvent.click(interrupteur('public'))
  await userEvent.click(screen.getByRole('button', { name: /Enregistrer/ }))

  expect(envoyes).toEqual([['public', 'reporting']])
})

test('tout décocher s’enregistre — la liste vide est un réglage', async () => {
  const envoyes: unknown[] = []
  monter({ affiches: null, onEnregistrer: async (s) => void envoyes.push(s) })
  await waitFor(() => expect(interrupteur('public')).toBeInTheDocument())

  await userEvent.click(interrupteur('public'))
  await userEvent.click(interrupteur('reporting'))
  await userEvent.click(screen.getByRole('button', { name: /Enregistrer/ }))

  // **`[]`, et non « rien à faire »** : c'est ce qui distingue « aucun » de « jamais réglé ».
  expect(envoyes).toEqual([[]])
})

test('un enregistrement réussi ferme la modale ; un refus la laisse ouverte et le dit', async () => {
  const fermetures: number[] = []
  const { unmount } = monter({
    onEnregistrer: async () => {
      throw new Error('aucune connexion « absente » en « prod »')
    },
    onClose: () => fermetures.push(1),
  })
  await waitFor(() => expect(interrupteur('public')).toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name: /Enregistrer/ }))

  expect(fermetures).toEqual([])
  expect(await screen.findByText(/aucune connexion/)).toBeInTheDocument()
  unmount()

  // Contrôle positif : sans lui, une modale qui ne se fermerait **jamais** passerait le test.
  const succes: number[] = []
  monter({ onClose: () => succes.push(1) })
  await waitFor(() => expect(interrupteur('public')).toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name: /Enregistrer/ }))
  await waitFor(() => expect(succes).toEqual([1]))
})

test('la création part d’un bouton à elle, et le schéma créé arrive coché', async () => {
  const crees: string[] = []
  const apres = [...SCHEMAS, schema('audit')]
  let tour = 0
  monter({
    affiches: ['public'],
    onLire: async () => (tour++ === 0 ? SCHEMAS : apres),
    onCreer: async (nom) => void crees.push(nom),
  })
  await waitFor(() => expect(interrupteur('public')).toBeInTheDocument())

  await userEvent.type(screen.getByLabelText('Créer un schéma'), 'audit')
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }))

  expect(crees).toEqual(['audit'])
  // **Coché**, et sans avoir touché aux autres cases : la relecture repart de la sélection courante,
  // non de la préférence enregistrée.
  await waitFor(() => expect(interrupteur('audit')).toHaveAttribute('aria-checked', 'true'))
  expect(interrupteur('reporting')).toHaveAttribute('aria-checked', 'false')
  // Et la création n'a **rien enregistré** : les deux temps sont distincts.
  expect(screen.getByRole('button', { name: /Enregistrer/ })).toBeEnabled()
})

test('la création dit ce que le moteur a refusé', async () => {
  monter({
    onCreer: async () => {
      throw { message: 'le schéma « public » existe déjà' }
    },
  })
  await waitFor(() => expect(interrupteur('public')).toBeInTheDocument())

  await userEvent.type(screen.getByLabelText('Créer un schéma'), 'public')
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }))

  // Le refus vient du moteur, et il est **repris tel quel** : un « la création a échoué » générique
  // ferait chercher ailleurs. Et il arrive en objet, non en chaîne — le piège de `08d`.
  expect(await screen.findByText(/existe déjà/)).toBeInTheDocument()
})

test('le bouton de création est désactivé tant que le champ est vide', async () => {
  monter()
  await waitFor(() => expect(interrupteur('public')).toBeInTheDocument())

  // Un bouton actif et inerte se lit comme une panne (défaut n° 36) ; ici, c'est le nom qui manque,
  // et le champ juste à côté le dit.
  expect(screen.getByRole('button', { name: 'Créer' })).toBeDisabled()
  await userEvent.type(screen.getByLabelText('Créer un schéma'), '  ')
  expect(screen.getByRole('button', { name: 'Créer' })).toBeDisabled()
})

test('le rappel de production ne paraît que sur un environnement marqué', async () => {
  const { unmount } = monter({ production: false })
  await waitFor(() => expect(interrupteur('public')).toBeInTheDocument())
  expect(screen.queryByText(/ne peut pas la défaire/)).toBeNull()
  unmount()

  monter({ production: true })
  await waitFor(() => expect(interrupteur('public')).toBeInTheDocument())
  expect(screen.getByText(/ne peut pas la défaire/)).toBeInTheDocument()
})

test('le filtre porte sur les deux listes, et le pied compte ce que l’arbre montrera', async () => {
  monter({ affiches: ['public'] })
  await waitFor(() => expect(interrupteur('public')).toBeInTheDocument())

  // Le pied **dit l'état**, il ne propose pas d'action.
  // Le nombre affiché s'accorde : « 1 … est affiché », « 2 … sont affichés ».
  expect(screen.getByText(/1 des 5 schémas de analytics est affiché/)).toBeInTheDocument()

  await userEvent.type(screen.getByRole('textbox', { name: 'Filtrer les schémas…' }), 'pg_')
  // Deux correspondances, toutes deux dans la section système : la section reste comptée.
  expect(screen.getByRole('button', { name: /Schémas système \(2\)/ })).toBeInTheDocument()
  expect(screen.getByText('Aucun schéma ne correspond au filtre.')).toBeInTheDocument()
})

test('une lecture qui échoue le dit, et n’offre rien à enregistrer', async () => {
  monter({
    onLire: async () => {
      throw 'aucune connexion ouverte pour Atelier Nord/analytics'
    },
  })

  // La cause remonte en **chaîne** ici, en objet ailleurs : les deux formes traversent l'IPC.
  expect(await screen.findByText(/aucune connexion ouverte/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Enregistrer/ })).toBeDisabled()
})

test('la lecture n’est demandée qu’une fois', async () => {
  const onLire = vi.fn(async () => SCHEMAS)
  monter({ onLire })
  await waitFor(() => expect(interrupteur('public')).toBeInTheDocument())

  // Une lecture relancée à chaque changement de préférence rechargerait la modale sous les doigts
  // de qui vient d'enregistrer, et rendrait les cases à leur état d'avant.
  expect(onLire).toHaveBeenCalledTimes(1)
})

test('chaque interrupteur porte le nom de son schéma', async () => {
  monter()
  await waitFor(() => expect(interrupteur('public')).toBeInTheDocument())

  // Le piège n° 1 par un bout qu'aucun `gap` n'arrange : sans le nom dans le nom du contrôle, chaque
  // ligne porterait un interrupteur « affiché », indiscernable de ses voisins à la voix.
  const tableau = screen.getByRole('table', { name: 'Schémas de la connexion' })
  expect(within(tableau).getAllByRole('switch')).toHaveLength(2)
  expect(interrupteur('reporting')).toBeInTheDocument()
})
