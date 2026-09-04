import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { Preferences } from '../../domain/config'
import type { AvailableUpdate } from '../../domain/maj'
import { LanguageProvider } from '../../i18n/LanguageContext'
import type { Plateforme } from '../../shell/plateforme'
import { PreferencesDialog } from './PreferencesDialog'
import { HAUTEUR_MIN, PREFERENCES_PAR_DEFAUT } from './preferences'

function monter(
  preferences: Preferences = PREFERENCES_PAR_DEFAUT,
  // Les deux commandes de mise à jour sont **toujours** injectées : les vraies passent par l'IPC,
  // qui ne répond pas sous jsdom. Le défaut refuse, ce qui suffit aux tests qui ne les touchent pas.
  maj: {
    chercher?: () => Promise<AvailableUpdate | null>
    installer?: () => Promise<void>
  } = {},
  // **La plateforme est nommée, jamais déduite.** La section « Mises à jour » n'offre son bouton
  // que là où une voie de mise à jour existe, donc laisser la valeur suivre `__APP_PLATFORM__`
  // ferait dépendre les six tests de cette section du décor sous lequel la suite tourne —
  // `pnpm test` doit être vert sous les trois.
  sur: Plateforme = 'macos',
) {
  const onChange = vi.fn()
  const onClose = vi.fn()
  render(
    <>
      <Sprite />
      {/* Le français forcé, indépendamment de `preferences.language` : ce fichier ne teste pas la
          langue elle-même (voir « la langue » plus bas), et le laisser suivre `navigator.language`
          de jsdom rendrait les assertions en français instables selon la machine. */}
      <LanguageProvider preferences={{ language: 'fr' }}>
        <PreferencesDialog
          preferences={preferences}
          onChange={onChange}
          onClose={onClose}
          version="DoraBase 0.4.2 (arm64)"
          chercherMiseAJour={maj.chercher ?? (() => Promise.reject(new Error('pas de pont')))}
          installerMiseAJour={maj.installer ?? (() => Promise.reject(new Error('pas de pont')))}
          sur={sur}
        />
      </LanguageProvider>
    </>,
  )
  return { onChange, onClose }
}

function allerA(nom: string) {
  return userEvent.click(screen.getByRole('tab', { name: nom }))
}

describe('la coquille (`15a`)', () => {
  it('liste les cinq sections du mockup, plus les mises à jour, et affiche la version', () => {
    monter()
    expect(screen.getAllByRole('tab')).toHaveLength(6)
    expect(screen.getByText('DoraBase 0.4.2 (arm64)')).toBeInTheDocument()
  })

  it('ouvre sur Apparence, la seule section qui a du contenu', () => {
    monter()
    // Ouvrir sur « Général » montrerait d'abord une section qui annonce ce qu'elle portera.
    expect(screen.getByRole('tab', { name: 'Apparence' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Thème' })).toBeInTheDocument()
  })

  it('les sections sans contenu disent ce qu’elles porteront', async () => {
    monter()
    for (const nom of ['Général', 'Connexions']) {
      await allerA(nom)
      // **Ni cachées ni vides** : cacher ferait croire à une interface plus pauvre qu'elle ne sera,
      // laisser vide ferait croire à un défaut. La règle de `09f`, appliquée à une section.
      expect(screen.getByText(/Cette section portera/)).toBeInTheDocument()
    }
  })

  it('« Terminé » ferme sans valider : il n’y a rien à valider', async () => {
    const { onChange, onClose } = monter()
    await userEvent.click(screen.getByRole('button', { name: 'Terminé' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    // Pas de bouton « Appliquer », donc pas de formulaire tampon : « Terminé » n'écrit rien de plus
    // que ce que chaque réglage a déjà écrit.
    expect(onChange).not.toHaveBeenCalled()
  })

  it('« Réinitialiser » demande confirmation, et la confirmation dit ce qui revient', async () => {
    const { onChange } = monter({
      ...PREFERENCES_PAR_DEFAUT,
      theme: 'nuit',
      guards: { ...PREFERENCES_PAR_DEFAUT.guards, prodReadOnly: false },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }))

    // Elle dit **ce qui** revient, pas « êtes-vous sûr ? » — la règle de `08j` et `11d`.
    expect(screen.getByText(/garde-fous d’écriture seront réactivés/)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /valeurs d’origine/ }))
    expect(onChange).toHaveBeenCalledWith(PREFERENCES_PAR_DEFAUT)
  })
})

describe('la langue (26 août 2026)', () => {
  it('les trois réglages se choisissent, et « Système » est le défaut', async () => {
    const { onChange } = monter()
    await allerA('Général')
    expect(screen.getByRole('radio', { name: 'Système' })).toBeChecked()

    await userEvent.click(screen.getByRole('radio', { name: 'English' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ language: 'en' }))
  })

  it('« Général » dit encore ce qui n’est pas livré, sous la langue', async () => {
    monter()
    await allerA('Général')
    expect(screen.getByText(/Cette section portera/)).toBeInTheDocument()
  })
})

describe('l’apparence (`15b`)', () => {
  it('les trois thèmes se choisissent, et l’actif est marqué', async () => {
    const { onChange } = monter()
    const groupe = screen.getByRole('radio', { name: /Cahier/ })
    expect(groupe).toBeChecked()

    await userEvent.click(screen.getByRole('radio', { name: /Nuit/ }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ theme: 'nuit' }))
  })

  it('« Nuit » ne porte plus de réserve : les jetons sombres existent', () => {
    // La mention « incomplet » a été retirée le 26 août 2026, en même temps que les 73 jetons
    // sombres de `tokens.json`. Le test la garde **retirée** : la remettre demanderait d'abord de
    // retirer les valeurs, et c'est ce que ce test rendrait rouge.
    // **Le texte, et non `role="status"`** : la section « Mises à jour » en porte un légitime, et
    // viser le rôle ferait tomber ce test sur un changement qui n'a rien à voir avec le thème.
    monter({ ...PREFERENCES_PAR_DEFAUT, theme: 'nuit' })
    expect(screen.queryByText(/incomplet/)).toBeNull()
  })

  it('les six accents sont nommés, pas seulement colorés', async () => {
    const { onChange } = monter()
    // Une couleur seule n'est pas un nom : « terracotta » doit s'annoncer à la voix.
    expect(
      screen.getAllByRole('radio', { name: /terracotta|framboise|brique|sauge|ardoise|violette/ }),
    ).toHaveLength(6)

    await userEvent.click(screen.getByRole('radio', { name: 'sauge' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ accent: 'sauge' }))
  })
})

describe('la grille et le code (`15c`)', () => {
  it('la densité se règle, et sa valeur s’affiche', async () => {
    const { onChange } = monter()
    await allerA('Grille de données')
    const curseur = screen.getByRole('slider', { name: 'Densité des lignes' })
    expect(screen.getByText('26px')).toBeInTheDocument()

    // **`fireEvent` sur un `input[type=range]`** : `userEvent.type` n'y produit pas d'événement de
    // changement, et `clear` refuse un contrôle non éditable. Le geste réel est un glissement, que
    // jsdom ne sait pas simuler — Playwright le fait, sur la géométrie.
    fireEvent.change(curseur, { target: { value: '30' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rowHeight: 30 }))
  })

  it('un corps de police élevé relève le plancher du curseur, et le dit', async () => {
    monter({ ...PREFERENCES_PAR_DEFAUT, codeFontTenths: 160, rowHeight: 26 })
    await allerA('Grille de données')

    const curseur = screen.getByRole('slider', { name: 'Densité des lignes' })
    // **La contrainte est portée par le curseur lui-même** : proposer une position que le disque
    // refuserait ferait remonter la valeur toute seule, ce qui se lirait comme un bogue.
    expect(Number(curseur.getAttribute('min'))).toBeGreaterThan(HAUTEUR_MIN)
    // Et la phrase dit pourquoi il ne descend plus.
    expect(screen.getByText(/le texte des cellules serait rogné/)).toBeInTheDocument()
  })

  it('au corps par défaut, aucune contrainte n’est annoncée', async () => {
    monter()
    await allerA('Grille de données')
    const curseur = screen.getByRole('slider', { name: 'Densité des lignes' })
    // Le mockup montre le curseur allant jusqu'à « compact » : la borne du handoff doit être
    // atteignable tel que le produit est livré.
    expect(Number(curseur.getAttribute('min'))).toBe(HAUTEUR_MIN)
    expect(screen.queryByText(/serait rogné/)).toBeNull()
  })

  it('la police du code se règle', async () => {
    const { onChange } = monter()
    await allerA('Grille de données')
    fireEvent.change(screen.getByRole('slider', { name: /Corps de la police/ }), {
      target: { value: '140' },
    })
    // 140 dixièmes, soit 14 px : le plancher de densité monte avec, ce que `borner` applique.
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ codeFontTenths: 140 }))
  })
})

describe('les garde-fous (`15d`)', () => {
  it('les quatre apparaissent, et chacun dit ce qu’il protège', async () => {
    monter()
    await allerA('Sécurité & écriture')
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(4)
    // Chaque bascule dit **ce qu'elle protège**, pas comment elle marche — et ce qui arrive quand on
    // l'éteint, ce que `11d` réclamait avant de les rendre réglables.
    expect(screen.getByText(/part directement dans la base/)).toBeInTheDocument()
    expect(screen.getByText(/s’ouvre modifiable/)).toBeInTheDocument()
  })

  it('les trois premiers se règlent', async () => {
    const { onChange } = monter()
    await allerA('Sécurité & écriture')
    await userEvent.click(screen.getByRole('switch', { name: /lecture seule/ }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        guards: expect.objectContaining({ prodReadOnly: false }),
      }),
    )
  })

  it('« Garder le patch inverse » est désactivé avec sa raison, pas allumé sans effet', async () => {
    monter()
    await allerA('Sécurité & écriture')
    const bascule = screen.getByRole('switch', { name: /patch inverse/ })
    // **La leçon du défaut n° 36** : un réglage qui ne fait rien est pire qu'un réglage absent.
    // `11c` et `11d` avaient annoncé cette promesse puis l'avaient retirée, faute de persister.
    expect(bascule).toBeDisabled()
    expect(screen.getByText(/ce n’est pas encore tranché/)).toBeInTheDocument()
  })

  it('les quatre sont actifs sur des préférences neuves', async () => {
    monter()
    await allerA('Sécurité & écriture')
    const actifs = screen
      .getAllByRole('switch')
      .filter((bascule) => bascule.getAttribute('aria-checked') === 'true')
    // Trois allumés, le quatrième désactivé : le défaut du modèle est `true` pour les quatre, et
    // c'est ce qui compte — un défaut à `false` transformerait une mise à jour en levée
    // silencieuse des garde-fous.
    expect(actifs).toHaveLength(3)
  })
})

describe('la navigation', () => {
  it('changer de section ne perd pas les réglages affichés', async () => {
    monter({ ...PREFERENCES_PAR_DEFAUT, rowHeight: 32 })
    await allerA('Grille de données')
    expect(screen.getByText('32px')).toBeInTheDocument()
    await allerA('Apparence')
    await allerA('Grille de données')
    // L'état vient des propriétés, pas d'un état local de section : le contraire ferait revenir la
    // valeur par défaut au retour.
    expect(screen.getByText('32px')).toBeInTheDocument()
  })

  it('la modale porte son nom accessible', () => {
    monter()
    const modale = screen.getByRole('dialog', { name: 'Préférences' })
    expect(within(modale).getByRole('tablist', { name: /Sections/ })).toBeInTheDocument()
  })
})

/**
 * « Mises à jour » (26 août 2026).
 *
 * **Le point qui compte : rien n'est cherché tant que rien n'est cliqué.** Un appel au montage
 * ferait dépendre le rendu de la modale d'une réponse réseau, donc de l'instant, et toute capture
 * de fidélité de `A10` deviendrait instable.
 */
describe('les mises à jour', () => {
  it('ne cherche rien tant qu’on n’a rien demandé', async () => {
    const chercher = vi.fn(() => Promise.resolve(null))
    monter(PREFERENCES_PAR_DEFAUT, { chercher })
    await allerA('Mises à jour')
    expect(chercher).not.toHaveBeenCalled()
    // « Pas encore cherché » n'est pas « à jour » : rien n'est affirmé avant la réponse.
    expect(screen.queryByText(/est à jour/)).not.toBeInTheDocument()
  })

  it('dit que l’application est à jour quand il n’y a rien', async () => {
    monter(PREFERENCES_PAR_DEFAUT, { chercher: () => Promise.resolve(null) })
    await allerA('Mises à jour')
    await userEvent.click(screen.getByRole('button', { name: 'Rechercher une mise à jour' }))
    expect(await screen.findByText('DoraBase est à jour.')).toBeInTheDocument()
  })

  it('annonce la version trouvée, ses notes, et propose de l’installer', async () => {
    const installer = vi.fn(() => new Promise<void>(() => {}))
    monter(PREFERENCES_PAR_DEFAUT, {
      chercher: () => Promise.resolve({ version: '9.9.9', notes: 'Deux moteurs de plus.' }),
      installer,
    })
    await allerA('Mises à jour')
    await userEvent.click(screen.getByRole('button', { name: 'Rechercher une mise à jour' }))

    expect(await screen.findByText('9.9.9')).toBeInTheDocument()
    expect(screen.getByText('Deux moteurs de plus.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Installer et redémarrer' }))
    expect(installer).toHaveBeenCalledOnce()
    // L'installation ne rend jamais la main au succès : le bouton dit ce qu'il fait en attendant.
    expect(screen.getByRole('button', { name: 'Téléchargement…' })).toBeDisabled()
  })

  it('tient sans notes — une release peut n’en avoir aucune', async () => {
    monter(PREFERENCES_PAR_DEFAUT, {
      chercher: () => Promise.resolve({ version: '9.9.9', notes: null }),
    })
    await allerA('Mises à jour')
    await userEvent.click(screen.getByRole('button', { name: 'Rechercher une mise à jour' }))
    expect(await screen.findByText('Cette version n’a pas de notes.')).toBeInTheDocument()
  })

  /*
   * **Ici l'échec se dit**, à l'inverse de la barre d'état qui l'avale : l'utilisateur a cliqué, et
   * un bouton qui retombe en silence se lit comme une panne.
   */
  it('dit pourquoi la recherche n’a pas abouti', async () => {
    monter(PREFERENCES_PAR_DEFAUT, {
      chercher: () => Promise.reject(new Error('réseau injoignable')),
    })
    await allerA('Mises à jour')
    await userEvent.click(screen.getByRole('button', { name: 'Rechercher une mise à jour' }))
    expect(await screen.findByText(/réseau injoignable/)).toBeInTheDocument()
  })

  /*
   * `install_update` ne rend jamais `Ok` : au succès le processus est remplacé. Une promesse qui se
   * résout est donc un **échec**, et le bouton doit cesser de tourner.
   */
  it('traite une installation qui rend la main comme un échec', async () => {
    monter(PREFERENCES_PAR_DEFAUT, {
      chercher: () => Promise.resolve({ version: '9.9.9', notes: null }),
      installer: () => Promise.resolve(),
    })
    await allerA('Mises à jour')
    await userEvent.click(screen.getByRole('button', { name: 'Rechercher une mise à jour' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Installer et redémarrer' }))
    expect(await screen.findByText(/n’a pas abouti/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Installer et redémarrer' })).toBeEnabled()
  })

  /*
   * **Sans voie de mise à jour, le bouton est désactivé avec sa raison** (4 septembre 2026).
   *
   * `latest.json` ne porte que les deux clefs `darwin-*` : ailleurs le plugin échoue sur « the
   * platform … was not found on the response `platforms` object ». Un bouton actif afficherait
   * donc ce message, qui accuse une installation parfaitement correcte — c'est exactement le mode
   * de défaillance que ce dépôt refuse. Les deux plateformes sont nommées séparément parce
   * qu'elles rendent la même chose pour deux raisons différentes (voir `shell/plateforme`).
   */
  it.each(['windows', 'linux'] as const)(
    'sous %s, la recherche est refusée avec sa raison plutôt que tentée',
    async (sur) => {
      const chercher = vi.fn(() => Promise.resolve(null))
      monter(PREFERENCES_PAR_DEFAUT, { chercher }, sur)
      await allerA('Mises à jour')

      const bouton = screen.getByRole('button', { name: 'Rechercher une mise à jour' })
      // `aria-disabled` et non `disabled` : un bouton désactivé pour de bon ne reçoit ni focus ni
      // survol, donc son infobulle serait inatteignable (piège n° 3 d'accessibilité).
      expect(bouton).toHaveAttribute('aria-disabled', 'true')
      expect(bouton).toBeEnabled()
      expect(bouton).toHaveAttribute('title', expect.stringContaining('ne se met pas à jour'))
      expect(screen.getByText(/que sur macOS/)).toBeInTheDocument()

      // **Et le clic ne cherche rien.** `aria-disabled` n'empêche rien de lui-même : sans
      // l'`onClick` retiré, ce test resterait vert sur un bouton qui part quand même en échec.
      await userEvent.click(bouton)
      expect(chercher).not.toHaveBeenCalled()
    },
  )

  it('sur macOS, la recherche est bien offerte — le contrôle négatif', async () => {
    monter(PREFERENCES_PAR_DEFAUT, { chercher: () => Promise.resolve(null) }, 'macos')
    await allerA('Mises à jour')
    const bouton = screen.getByRole('button', { name: 'Rechercher une mise à jour' })
    expect(bouton).not.toHaveAttribute('aria-disabled')
    expect(screen.queryByText(/que sur macOS/)).not.toBeInTheDocument()
  })
})
