import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  arbreApresDeplacement,
  deplacementSimule,
  effetSurLaLectureSeule,
  type SujetDuDeplacement,
} from '../../data/dossiers'
import type { MoveResult } from '../../domain/arbre'
import type { Folder, FolderTree } from '../../domain/config'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { connexionDeTest } from '../NewConnection/pourLesTests'
import type { Noeud } from './arbre'
import { DeplacerVers } from './DeplacerVers'
import { arriveeDuDepot, arriveeSansEffet, positionDansLaLigne } from './glissement'

/**
 * Le décor du cœur (`config/arbre.rs`, `decor()`), rejoué ici : `nord` › `prod` (lecture seule) ›
 * `profond`, une connexion à chaque palier, une à la racine, et un dossier voisin.
 */
function dossierDe(
  id: string,
  name: string,
  readOnly: boolean,
  over: Partial<Folder> = {},
): Folder {
  return { id, name, readOnly, ...over }
}

function decor(): FolderTree {
  const profond = dossierDe('profond', 'profond', false, {
    connections: [connexionDeTest('c-profonde', 'profonde')],
  })
  const prod = dossierDe('prod', 'prod', true, {
    folders: [profond],
    connections: [connexionDeTest('c-prod', 'analytics')],
  })
  const nord = dossierDe('nord', 'Atelier Nord', false, {
    folders: [prod],
    connections: [
      connexionDeTest('c-nord', 'nordique', {
        connection: { ...connexionDeTest('x', 'x').connection, readOnly: true },
      }),
    ],
  })
  return {
    folders: [nord, dossierDe('voisin', 'Outils', false)],
    connections: [connexionDeTest('c-racine', 'racine')],
  }
}

const connexion = (connection: string): SujetDuDeplacement => ({ kind: 'database', connection })
const dossier = (folder: string): SujetDuDeplacement => ({ kind: 'folder', folder })

describe('le miroir du déplacement (#167)', () => {
  it('entrer sous « prod » rend la connexion lecture seule, et nomme « prod »', () => {
    const avant = decor()
    const apres = arbreApresDeplacement(avant, connexion('c-racine'), {
      destination: 'profond',
      index: null,
    })
    expect(apres).not.toBeNull()
    expect(effetSurLaLectureSeule(avant, apres as FolderTree)).toEqual({
      becomesReadOnly: ['c-racine'],
      leavesReadOnly: [],
      folders: ['prod'],
    })
  })

  it('sortir de « prod » la quitte ; un dossier en lecture seule emporte la sienne', () => {
    const avant = decor()
    const sortie = arbreApresDeplacement(avant, connexion('c-prod'), {
      destination: null,
      index: null,
    }) as FolderTree
    expect(effetSurLaLectureSeule(avant, sortie)).toEqual({
      becomesReadOnly: [],
      leavesReadOnly: ['c-prod'],
      folders: ['prod'],
    })
    const prodAilleurs = arbreApresDeplacement(avant, dossier('prod'), {
      destination: 'voisin',
      index: null,
    }) as FolderTree
    expect(effetSurLaLectureSeule(avant, prodAilleurs)).toBeNull()
  })

  it('la lecture seule **effective**, pas sa cause : une connexion déjà réglée en lecture seule ne demande rien', () => {
    // `c-nord` est en lecture seule pour elle-même ; sous « prod », elle l'est par imposition. La
    // cause change, l'effet non — et c'est l'effet que le cœur ferme et fait confirmer.
    const avant = decor()
    const apres = arbreApresDeplacement(avant, connexion('c-nord'), {
      destination: 'prod',
      index: null,
    }) as FolderTree
    expect(effetSurLaLectureSeule(avant, apres)).toBeNull()
  })

  it('`index` compte les frères d’arrivée sans le sujet, et un rang trop grand veut dire « en dernier »', () => {
    const avant = decor()
    const premier = arbreApresDeplacement(avant, dossier('voisin'), { destination: null, index: 0 })
    expect(premier?.folders.map((d) => d.id)).toEqual(['voisin', 'nord'])
    const dernier = arbreApresDeplacement(avant, dossier('nord'), { destination: null, index: 99 })
    expect(dernier?.folders.map((d) => d.id)).toEqual(['voisin', 'nord'])
  })

  it('le double refuse ce que le cœur refuse', () => {
    expect(() =>
      deplacementSimule(decor(), dossier('nord'), { destination: 'profond', index: null }, true),
    ).toThrow(/lui-même/)
    const homonyme = decor()
    ;(homonyme.folders[1] as Folder).name = 'profond'
    expect(() =>
      deplacementSimule(homonyme, dossier('profond'), { destination: null, index: null }, true),
    ).toThrow(/existe déjà/)
  })
})

describe('le dépôt d’un glissement (#167)', () => {
  const ligne = (over: Partial<Noeud>): Noeud => ({
    id: 'x',
    kind: 'folder',
    depth: 0,
    indent: '8px',
    label: 'x',
    ...over,
  })

  it('par tiers sur un dossier, par moitié sur une connexion', () => {
    expect(positionDansLaLigne(1, 0, 22, 'folder')).toBe('avant')
    expect(positionDansLaLigne(11, 0, 22, 'folder')).toBe('dedans')
    expect(positionDansLaLigne(21, 0, 22, 'folder')).toBe('apres')
    expect(positionDansLaLigne(10, 0, 22, 'database')).toBe('avant')
    expect(positionDansLaLigne(12, 0, 22, 'database')).toBe('apres')
  })

  it('une connexion lâchée sur un dossier y entre, quelle que soit la position', () => {
    for (const position of ['avant', 'apres', 'dedans'] as const) {
      expect(
        arriveeDuDepot(decor(), connexion('c-racine'), {
          kind: 'ligne',
          noeud: ligne({ id: 'f:voisin', folder: 'voisin' }),
          position,
        }),
      ).toEqual({ arrivee: { destination: 'voisin', index: null }, deplier: 'voisin' })
    }
  })

  it('avant ou après une connexion, à son rang parmi ses sœurs', () => {
    const arbre = decor()
    ;(arbre.folders[1] as Folder).connections = [
      connexionDeTest('a', 'a'),
      connexionDeTest('b', 'b'),
    ]
    expect(
      arriveeDuDepot(arbre, connexion('c-racine'), {
        kind: 'ligne',
        noeud: ligne({ kind: 'database', connection: 'b' }),
        position: 'avant',
      })?.arrivee,
    ).toEqual({ destination: 'voisin', index: 1 })
    expect(
      arriveeDuDepot(arbre, connexion('c-racine'), {
        kind: 'ligne',
        noeud: ligne({ kind: 'database', connection: 'b' }),
        position: 'apres',
      })?.arrivee,
    ).toEqual({ destination: 'voisin', index: 2 })
  })

  it('un dossier ne se dépose ni sur lui-même ni dans un descendant', () => {
    const arbre = decor()
    expect(
      arriveeDuDepot(arbre, dossier('nord'), {
        kind: 'ligne',
        noeud: ligne({ id: 'f:profond', folder: 'profond' }),
        position: 'dedans',
      }),
    ).toBeNull()
    // Avant un descendant, c'est encore dans le parent de ce descendant : un descendant aussi.
    expect(
      arriveeDuDepot(arbre, dossier('nord'), {
        kind: 'ligne',
        noeud: ligne({ id: 'f:profond', folder: 'profond' }),
        position: 'avant',
      }),
    ).toBeNull()
    expect(
      arriveeDuDepot(arbre, dossier('nord'), {
        kind: 'ligne',
        noeud: ligne({ id: 'f:nord', folder: 'nord' }),
        position: 'dedans',
      }),
    ).toBeNull()
  })

  it('un dépôt à sa propre place ne demande rien au cœur', () => {
    const arbre = decor()
    expect(arriveeSansEffet(arbre, dossier('nord'), { destination: null, index: 0 })).toBe(true)
    expect(arriveeSansEffet(arbre, dossier('nord'), { destination: null, index: 1 })).toBe(false)
  })
})

function monter(
  sujet: SujetDuDeplacement,
  onDeplacer = vi.fn<(...args: unknown[]) => Promise<MoveResult>>(async () => ({
    kind: 'moved',
    tree: decor(),
  })),
  extra: Partial<Parameters<typeof DeplacerVers>[0]> = {},
) {
  const onClose = vi.fn()
  render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <DeplacerVers
        arbre={decor()}
        sujet={sujet}
        nom="nom"
        onDeplacer={onDeplacer}
        onClose={onClose}
        {...extra}
      />
    </LanguageProvider>,
  )
  return { onDeplacer, onClose }
}

/** Les lignes de destination, et celles qu'on peut prendre — **comptées**, jamais cherchées par nom. */
function destinations() {
  const liste = screen.getByRole('group', { name: 'Dossier d’arrivée' })
  const toutes = within(liste).getAllByRole('button')
  return { toutes, actives: toutes.filter((b) => b.getAttribute('aria-disabled') !== 'true') }
}

describe('« Déplacer vers… » (#167)', () => {
  it('un dossier ne se propose ni lui-même, ni ses descendants, ni son parent — chacun avec sa raison', () => {
    monter(dossier('prod'))
    const { toutes, actives } = destinations()
    // Racine, nord, prod, profond, voisin : prod et profond sont lui-même et son descendant, nord
    // est son parent.
    expect(toutes.map((b) => b.textContent)).toEqual([
      'Racine',
      'Atelier Nord',
      'prod',
      'profond',
      'Outils',
    ])
    expect(actives.map((b) => b.textContent)).toEqual(['Racine', 'Outils'])
    expect(toutes[2]).toHaveAttribute('title', 'Un dossier ne se range pas dans lui-même.')
    expect(toutes[3]).toHaveAttribute('title', 'Un dossier ne se range pas dans lui-même.')
    expect(toutes[1]).toHaveAttribute('title', 'Déjà ici.')
  })

  it('dit le changement de lecture seule avant « Déplacer », et c’est ce qui confirme', async () => {
    const { onDeplacer, onClose } = monter(connexion('c-prod'))
    expect(screen.queryByRole('status')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Racine' }))
    expect(screen.getByRole('status')).toHaveTextContent(
      '« analytics » quittera la lecture seule imposée par « prod ».',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Déplacer' }))
    expect(onDeplacer).toHaveBeenCalledWith({ destination: null, index: null }, true)
    expect(onClose).toHaveBeenCalled()
  })

  it('sans changement de lecture seule, le déplacement part sans confirmation', async () => {
    const { onDeplacer } = monter(connexion('c-racine'))
    await userEvent.click(screen.getByRole('button', { name: 'Outils' }))
    expect(screen.queryByRole('status')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Déplacer' }))
    expect(onDeplacer).toHaveBeenCalledWith({ destination: 'voisin', index: null }, false)
  })

  it('une question du cœur prend la place de l’aperçu, et le second clic la confirme', async () => {
    const onDeplacer = vi
      .fn<(...args: unknown[]) => Promise<MoveResult>>()
      .mockResolvedValueOnce({
        kind: 'confirmationRequired',
        becomesReadOnly: ['c-racine'],
        leavesReadOnly: [],
        folders: ['prod'],
      })
      .mockResolvedValueOnce({ kind: 'moved', tree: decor() })
    const { onClose } = monter(connexion('c-racine'), onDeplacer)
    await userEvent.click(screen.getByRole('button', { name: 'Outils' }))
    await userEvent.click(screen.getByRole('button', { name: 'Déplacer' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('« racine » passera en lecture seule')
    await userEvent.click(screen.getByRole('button', { name: 'Déplacer' }))
    expect(onDeplacer).toHaveBeenLastCalledWith({ destination: 'voisin', index: null }, true)
    expect(onClose).toHaveBeenCalled()
  })

  it('préremplie par un dépôt, elle garde la place visée et pose la question du cœur', async () => {
    const { onDeplacer } = monter(connexion('c-racine'), undefined, {
      arrivee: { destination: 'profond', index: 0 },
      question: { becomesReadOnly: ['c-racine'], leavesReadOnly: [], folders: ['prod'] },
    })
    expect(screen.getByRole('button', { name: 'profond' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('imposée par « prod »')
    await userEvent.click(screen.getByRole('button', { name: 'Déplacer' }))
    expect(onDeplacer).toHaveBeenCalledWith({ destination: 'profond', index: 0 }, true)
  })

  it('rien de choisi : « Déplacer » est désactivé avec sa raison, et n’envoie rien', async () => {
    const { onDeplacer } = monter(connexion('c-racine'))
    const bouton = screen.getByRole('button', { name: 'Déplacer' })
    expect(bouton).toHaveAttribute('aria-disabled', 'true')
    expect(bouton).toHaveAttribute('title', 'Choisissez un dossier d’arrivée.')
    await userEvent.click(bouton)
    // Une destination désactivée ne se choisit pas non plus.
    await userEvent.click(screen.getByRole('button', { name: 'Racine' }))
    await userEvent.click(bouton)
    expect(onDeplacer).not.toHaveBeenCalled()
  })

  it('un refus du cœur se dit dans la modale', async () => {
    monter(
      connexion('c-racine'),
      vi.fn(async () => Promise.reject('refusé par le cœur')),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Outils' }))
    await userEvent.click(screen.getByRole('button', { name: 'Déplacer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('refusé par le cœur')
  })
})
