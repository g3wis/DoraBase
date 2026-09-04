import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { LanguageProvider } from '../../i18n/LanguageContext'
import type { PasserelleFenetre } from '../fenetre'
import type { Plateforme } from '../plateforme'
import { TitleBar } from './TitleBar'

/*
 * Les trois boutons de fenêtre, sur les deux plateformes qui les dessinent elles-mêmes.
 *
 * **La plateforme est nommée, jamais déduite.** `__APP_PLATFORM__` est figé à la compilation :
 * sans le paramètre `sur`, ces tests ne s'exécuteraient que sur un runner Windows ou Linux, et
 * le job de fidélité doit rester sur macOS (les références portent le suffixe `-darwin.png`).
 * C'est le même arbitrage que `DORABASE_PLATEFORME_DECOR` d'un cran plus bas.
 *
 * **Et les deux sont nommées séparément, pas « par symétrie »** : elles rendent exactement la
 * même barre, ce qui est précisément ce qui rend un oubli invisible. Un composant resté sur
 * `estWindows(sur)` — le prédicat qui a vécu du 31 août au 4 septembre 2026 — monterait la barre
 * de macOS sous Linux, donc sans aucun bouton de fenêtre, **sans qu'une seule assertion Windows
 * ne bouge**.
 *
 * Ce fichier s'appelait `TitleBar.windows.test.tsx` jusqu'au 4 septembre 2026.
 */

/** Les plateformes où les boutons sont à notre charge. */
const NOS_BOUTONS: readonly Plateforme[] = ['windows', 'linux']

function passerelleDouble(): PasserelleFenetre & { appels: string[] } {
  const appels: string[] = []
  return {
    appels,
    reduire: vi.fn(async () => {
      appels.push('reduire')
    }),
    basculerMaximisation: vi.fn(async () => {
      appels.push('basculer')
    }),
    fermer: vi.fn(async () => {
      appels.push('fermer')
    }),
    estMaximisee: vi.fn(async () => false),
  }
}

function monter(sur: Plateforme, fenetre: PasserelleFenetre = passerelleDouble()) {
  return render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <TitleBar sur={sur} fenetre={fenetre} onOpenPreferences={() => {}} />
    </LanguageProvider>,
  )
}

test.each(NOS_BOUTONS)('sous %s, la barre porte les trois boutons de fenêtre', (sur) => {
  monter(sur)
  // Noms accessibles **ancrés** : `/Réduire/` seul attraperait aussi « Réduire la sidebar » si
  // elle existait un jour (règle d'AGENTS.md).
  expect(screen.getByRole('button', { name: /^Réduire$/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^Agrandir$/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^Fermer$/ })).toBeInTheDocument()
})

/**
 * **Le contrôle négatif, et il porte la moitié du sens du test précédent.**
 *
 * Sur macOS les trois feux sont dessinés par le système, hors d'atteinte du CSS : en ajouter
 * trois à nous les doublerait. Sans cette assertion, une barre qui monterait les boutons
 * *partout* passerait le test précédent.
 */
test('sur macOS, elle ne les porte pas — le système les dessine', () => {
  monter('macos')
  expect(screen.queryByRole('button', { name: /^Réduire$/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Agrandir$/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Fermer$/ })).not.toBeInTheDocument()
  // L'engrenage, lui, est là sur les trois.
  expect(screen.getByRole('button', { name: /^Préférences$/ })).toBeInTheDocument()
})

/**
 * **Le défaut n° 36, sur trois boutons neufs.**
 *
 * Un bouton cliquable et inerte se lit comme une panne — c'est ce qui a fait partir le bouton de
 * console de cette même barre le 26 août 2026, livré sans `onClick` depuis le premier
 * assemblage. Trois boutons ajoutés sans que rien ne vérifie qu'ils appellent quelque chose
 * répéteraient exactement ce défaut, et ici il serait pire : un bouton de fermeture qui ne ferme
 * pas.
 */
test.each(NOS_BOUTONS)('sous %s, les trois boutons appellent bien la passerelle', async (sur) => {
  const utilisateur = userEvent.setup()
  const passerelle = passerelleDouble()
  monter(sur, passerelle)

  await utilisateur.click(screen.getByRole('button', { name: /^Réduire$/ }))
  await utilisateur.click(screen.getByRole('button', { name: /^Agrandir$/ }))
  await utilisateur.click(screen.getByRole('button', { name: /^Fermer$/ }))

  expect(passerelle.appels).toEqual(['reduire', 'basculer', 'fermer'])
})

/**
 * Le glyphe central suit l'état de la fenêtre.
 *
 * Un bouton qui annoncerait toujours « Agrandir » mentirait une fois sur deux sur ce qu'il va
 * faire. C'est la seule raison de la permission `core:window:allow-is-maximized`.
 */
test('agrandie, le bouton central annonce « Restaurer »', async () => {
  const passerelle = { ...passerelleDouble(), estMaximisee: vi.fn(async () => true) }
  monter('windows', passerelle)

  // `findByRole` et non `getByRole` : l'état vient d'une promesse, donc du rendu **suivant**.
  // Une lecture sèche daterait la mesure du mauvais instant (règle 15 d'AGENTS.md).
  expect(await screen.findByRole('button', { name: /^Restaurer$/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Agrandir$/ })).not.toBeInTheDocument()
})

/**
 * Hors de la webview, la passerelle réelle rejette — et la barre doit tenir quand même.
 *
 * C'est le cas de la galerie, de `?demo` et de toute la suite Playwright : il n'y a pas de
 * fenêtre Tauri à interroger. Un rejet non attrapé ferait une erreur non gérée à chaque montage.
 */
test('une passerelle qui rejette ne casse ni le rendu ni le clic', async () => {
  const utilisateur = userEvent.setup()
  const qui_rejette: PasserelleFenetre = {
    reduire: () => Promise.reject(new Error('hors webview')),
    basculerMaximisation: () => Promise.reject(new Error('hors webview')),
    fermer: () => Promise.reject(new Error('hors webview')),
    estMaximisee: () => Promise.reject(new Error('hors webview')),
  }
  monter('windows', qui_rejette)

  const fermer = screen.getByRole('button', { name: /^Fermer$/ })
  await utilisateur.click(fermer)
  // Le glyphe reste celui de l'état de départ, faute de réponse.
  expect(screen.getByRole('button', { name: /^Agrandir$/ })).toBeInTheDocument()
})
