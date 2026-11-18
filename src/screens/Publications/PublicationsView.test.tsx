import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { ConnectionState, PublicationInfo } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { operationsDe, PublicationsView } from './PublicationsView'
import type { PasserellePublications } from './publicationsCommands'

const OUVERTE: ConnectionState = {
  kind: 'connected',
  serverVersion: 'PostgreSQL 17.6',
  tunnelLocalPort: null,
}

const CLE = { connection: 'c0000000000000a1' }

/**
 * Trois publications qui ne se confondent pas (règle n° 5) : chaque colonne y prend au moins deux
 * valeurs, et `update` y diffère de `delete` — sans quoi lire l'un pour l'autre passerait.
 */
const PUBLICATIONS: PublicationInfo[] = [
  {
    name: 'atelier_cdc',
    owner: 'atelier',
    allTables: true,
    insert: true,
    update: true,
    delete: true,
    truncate: true,
    viaRoot: false,
  },
  {
    name: 'commandes_vers_entrepot',
    owner: 'atelier',
    allTables: false,
    insert: true,
    update: true,
    delete: false,
    truncate: false,
    viaRoot: true,
  },
  {
    name: 'en_pause',
    owner: 'replication',
    allTables: false,
    insert: false,
    update: false,
    delete: false,
    truncate: false,
    viaRoot: false,
  },
]

function passerelle(lire: PasserellePublications['listPublications']): PasserellePublications {
  return { listPublications: lire }
}

function vue(options: Partial<Parameters<typeof PublicationsView>[0]> = {}) {
  return (
    <>
      <Sprite />
      {/* `language: 'fr'` explicite : les assertions portent sur des libellés. */}
      <LanguageProvider preferences={{ language: 'fr' }}>
        <PublicationsView
          cle={CLE}
          etat={OUVERTE}
          passerelle={passerelle(async () => PUBLICATIONS)}
          onOuvrir={() => {}}
          // Le temps est **figé** : l'âge du relevé ne doit pas être un tirage au sort (règle n° 3).
          maintenant={() => 1_000_000}
          {...options}
        />
      </LanguageProvider>
    </>
  )
}

/**
 * Le texte de chaque cellule d'une ligne, désignée par le nom de sa publication.
 *
 * **L'en-tête de ligne compris** : `DataTable` rend la première colonne en `<th scope="row">`, qui
 * n'a pas le rôle `cell` — le compter à part ferait perdre le nom de la ligne qu'on compare.
 */
function cellules(nom: string): string[] {
  const ligne = screen.getByRole('rowheader', { name: nom }).closest('tr')
  if (ligne === null) throw new Error(`aucune ligne pour ${nom}`)
  return [...ligne.querySelectorAll('th, td')].map((cellule) => cellule.textContent ?? '')
}

test('chaque publication dit son propriétaire, sa portée, ses opérations et la racine de partition', async () => {
  render(vue())

  await screen.findByRole('table', { name: 'Publications de la base de données' })
  expect(cellules('atelier_cdc')).toEqual([
    'atelier_cdc',
    'atelier',
    'toutes les tables',
    'insert update delete truncate',
    'non',
  ])
  expect(cellules('commandes_vers_entrepot')).toEqual([
    'commandes_vers_entrepot',
    'atelier',
    'tables désignées',
    'insert update',
    'oui',
  ])
  // **Une publication qui ne publie rien le dit** : un tiret se lirait comme une valeur inconnue.
  expect(cellules('en_pause')).toEqual([
    'en_pause',
    'replication',
    'tables désignées',
    'aucune',
    'non',
  ])
  expect(screen.getByText('3 publications')).toBeInTheDocument()
})

test('les opérations suivent l’ordre de l’option `publish`, quelles que soient celles qui manquent', () => {
  const base = PUBLICATIONS[0] as PublicationInfo
  expect(operationsDe({ ...base, insert: false, update: false })).toEqual(['delete', 'truncate'])
  // `truncate` à `null` — un serveur antérieur à PostgreSQL 11 — ne publie pas de `truncate`.
  expect(operationsDe({ ...base, truncate: null })).toEqual(['insert', 'update', 'delete'])
})

test('un réglage que le serveur ne connaît pas se dit absent, il ne devient pas « non »', async () => {
  // Avant PostgreSQL 13, `pubviaroot` n'existe pas : « non » affirmerait un choix que personne n'a
  // fait. Le tiret porte sa raison en infobulle.
  const ancienne = { ...(PUBLICATIONS[2] as PublicationInfo), viaRoot: null }
  render(vue({ passerelle: passerelle(async () => [ancienne]) }))

  await screen.findByRole('table', { name: 'Publications de la base de données' })
  expect(cellules('en_pause').at(-1)).toBe('—')
  expect(
    screen.getByTitle('ce serveur, antérieur à PostgreSQL 13, ne connaît pas ce réglage'),
  ).toHaveTextContent('—')
})

test('rien n’est lu tant que la connexion n’est pas ouverte — puis une seule fois', async () => {
  const lire = vi.fn(async () => PUBLICATIONS)
  const onOuvrir = vi.fn()
  const { rerender } = render(
    vue({ etat: { kind: 'never' }, passerelle: passerelle(lire), onOuvrir }),
  )

  expect(screen.getByText('La base de données n’est pas encore ouverte.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Ouvrir la connexion' }))
  expect(onOuvrir).toHaveBeenCalledTimes(1)
  expect(lire).not.toHaveBeenCalled()

  // La passerelle est **la même** d'un rendu à l'autre : c'est l'ouverture qui déclenche la lecture.
  const memePasserelle = passerelle(lire)
  rerender(vue({ etat: { kind: 'connecting' }, passerelle: memePasserelle, onOuvrir }))
  expect(screen.getByText('Connexion à la base de données…')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Ouvrir la connexion' })).toBeNull()

  rerender(vue({ passerelle: memePasserelle, onOuvrir }))
  await screen.findByRole('table', { name: 'Publications de la base de données' })
  rerender(vue({ passerelle: memePasserelle, onOuvrir }))
  expect(lire).toHaveBeenCalledTimes(1)
  expect(lire).toHaveBeenCalledWith(CLE)
})

test('une connexion rouverte relit : une lecture d’avant la coupure ne reste pas affichée', async () => {
  const lire = vi.fn(async () => PUBLICATIONS)
  const memePasserelle = passerelle(lire)
  const { rerender } = render(vue({ passerelle: memePasserelle }))
  await waitFor(() => expect(lire).toHaveBeenCalledTimes(1))

  rerender(
    vue({ etat: { kind: 'offline', reason: 'connexion refusée' }, passerelle: memePasserelle }),
  )
  expect(
    screen.getByText('La base de données est injoignable : connexion refusée'),
  ).toBeInTheDocument()

  rerender(vue({ passerelle: memePasserelle }))
  await waitFor(() => expect(lire).toHaveBeenCalledTimes(2))
})

test('« Rafraîchir » relit, et la barre dit l’âge du relevé', async () => {
  let horloge = 1_000_000
  const lire = vi.fn(async () => PUBLICATIONS)
  const options = { passerelle: passerelle(lire), maintenant: () => horloge }
  const { rerender } = render(vue(options))

  expect(await screen.findByText('relevé il y a 0 s')).toBeInTheDocument()

  // **Aucun minuteur** : l'âge ne bouge qu'au rendu suivant, jamais tout seul.
  horloge += 12_000
  rerender(vue(options))
  expect(screen.getByText('relevé il y a 12 s')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Rafraîchir' }))
  await waitFor(() => expect(lire).toHaveBeenCalledTimes(2))
  expect(await screen.findByText('relevé il y a 0 s')).toBeInTheDocument()
})

test('une lecture refusée se dit en alerte, avec le message du moteur', async () => {
  render(
    vue({
      passerelle: passerelle(async () => {
        throw { message: 'permission denied for table pg_publication', code: '42501' }
      }),
    }),
  )

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Lecture impossible : permission denied for table pg_publication',
  )
  expect(screen.getByText('pas encore relevé')).toBeInTheDocument()
})

test('une base sans publication le dit, plutôt qu’un tableau muet', async () => {
  render(vue({ passerelle: passerelle(async () => []) }))

  expect(
    await screen.findByText('Cette base de données ne déclare aucune publication.'),
  ).toBeInTheDocument()
  expect(screen.getByText('0 publication')).toBeInTheDocument()
})
