import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { Project } from '../../domain/config'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { instanceDeTest, passerelleDeTest } from '../Instances/pourLesTests'
import { REGLAGES, TRIO_DE_TEST } from '../NewConnection/pourLesTests'
import { Workbench } from './Workbench'

/**
 * L'assemblage du gestionnaire d'instances dans l'écran de travail (`API-32`).
 *
 * # Pourquoi ce fichier existe à côté des tests d'`InstancesPanel` et d'`InstanceView`
 *
 * **Règle n° 8** : un composant vérifié pièce par pièce n'est pas un écran livré. `InstancesPanel`
 * est juste dans sa vitrine, `InstanceView` aussi, et rien de tout cela ne dit que la sidebar est
 * montée dans la colonne, que le clic ouvre un onglet, ni que cet onglet montre l'instance qu'on a
 * cliquée. C'est exactement ce qui a manqué à l'engrenage d'`A1` et au bouton d'édition de la barre
 * d'outils — dans les deux cas, la galerie montrait un composant correct, branché sur rien.
 */

const PROJETS: Project[] = [
  {
    name: 'Atelier Nord',
    environments: TRIO_DE_TEST,
    queries: [],
    databases: [
      {
        name: 'analytics',
        engine: 'postgresql',
        environment: 'prod',
        connection: REGLAGES,
        consoles: [],
      },
    ],
  },
]

function monter(over: Partial<Parameters<typeof Workbench>[0]> = {}) {
  const passerelleInstances = over.passerelleInstances ?? passerelleDeTest()
  render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <Workbench
          projects={PROJETS}
          instances={[instanceDeTest()]}
          passerelleInstances={passerelleInstances}
          // L'arbre n'est pas le sujet : sa passerelle par défaut ne répond pas hors de la webview,
          // et ces tests ne la sollicitent jamais — ils ne déplient rien.
          passerelle={passerelleDArbre()}
          {...over}
        />
      </LanguageProvider>
    </>,
  )
  return { passerelleInstances }
}

describe('la zone d’instances dans l’écran de travail', () => {
  it('est montée dans la sidebar, sous l’arbre des projets', () => {
    monter()
    // Les deux arbres coexistent : c'est ce que « une zone et non un onglet » veut dire.
    expect(
      screen.getByRole('tree', { name: 'Projets, environnements et connexions' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('tree', { name: 'Instances' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^PG atelier/ })).toBeInTheDocument()
  })

  it('cliquer une instance ouvre son onglet, et l’onglet ouvre la connexion', async () => {
    const openInstance = vi.fn(async () => ({
      kind: 'connected' as const,
      serverVersion: 'PostgreSQL 17.6',
      tunnelLocalPort: null,
    }))
    monter({ passerelleInstances: passerelleDeTest({ openInstance }) })

    await userEvent.setup().click(screen.getByRole('button', { name: /^PG atelier/ }))

    // L'onglet paraît dans la bande, avec le nom de l'instance.
    const bande = await screen.findByRole('tablist')
    expect(within(bande).getByRole('tab', { name: /pg-atelier/ })).toBeInTheDocument()
    // **Et la connexion s'ouvre** : c'est ce que l'écran demande à son montage, comme un onglet de
    // console ouvre la sienne. Sans cela, la première lecture répondrait « aucune connexion
    // ouverte » sur un écran qu'on vient d'ouvrir.
    await waitFor(() => expect(openInstance).toHaveBeenCalledWith('pg-atelier'))
  })

  it('l’onglet montre l’instance cliquée, pas une autre', async () => {
    const seconde = instanceDeTest({ id: 'pg-recette', label: 'PG recette' })
    monter({ instances: [instanceDeTest(), seconde] })

    await userEvent.setup().click(screen.getByRole('button', { name: /^PG recette/ }))

    const bande = await screen.findByRole('tablist')
    expect(within(bande).getByRole('tab', { name: /pg-recette/ })).toBeInTheDocument()
    expect(within(bande).queryByRole('tab', { name: /pg-atelier/ })).toBeNull()
  })

  it('rouvrir la même instance réactive son onglet plutôt que d’en empiler un second', async () => {
    // Comme une table et un diagramme, contrairement à une console : deux onglets sur la même
    // instance montreraient les mêmes tableaux, avec deux sections qui divergeraient.
    monter()
    const utilisateur = userEvent.setup()
    const ligne = screen.getByRole('button', { name: /^PG atelier/ })

    await utilisateur.click(ligne)
    await utilisateur.click(ligne)

    const bande = await screen.findByRole('tablist')
    expect(within(bande).getAllByRole('tab')).toHaveLength(1)
  })

  it('le centre montre l’écran de l’instance, avec ses sept sections', async () => {
    monter()
    await userEvent.setup().click(screen.getByRole('button', { name: /^PG atelier/ }))

    // Le fil d'Ariane porte l'hôte joint, et la bande les sept sections.
    const fil = await screen.findByRole('navigation', { name: /Chemin de l’instance/ })
    expect(within(fil).getByText('localhost:5432')).toBeInTheDocument()
    for (const section of [
      'Vue d’ensemble',
      'Bases',
      'Utilisateurs',
      'Privilèges',
      'Sessions',
      'Extensions',
      'Paramètres',
    ]) {
      expect(screen.getByRole('radio', { name: new RegExp(`^${section}`) })).toBeInTheDocument()
    }
  })

  it('une instance retirée de la liste ferme son onglet', async () => {
    // **Sur la liste déclarée, non sur le geste de retrait** : brancher chaque chemin demanderait de
    // les connaître tous, et le prochain l'oublierait. Ce que le registre ne tient plus ne doit plus
    // être affiché — la règle de la purge du cache de l'arbre.
    function Pilote() {
      const [instances, setInstances] = useState([instanceDeTest()])
      return (
        <>
          <button type="button" onClick={() => setInstances([])}>
            retirer
          </button>
          <Workbench
            projects={PROJETS}
            instances={instances}
            passerelleInstances={passerelleDeTest()}
            passerelle={passerelleDArbre()}
          />
        </>
      )
    }
    render(
      <>
        <Sprite />
        <LanguageProvider preferences={{ language: 'fr' }}>
          <Pilote />
        </LanguageProvider>
      </>,
    )
    const utilisateur = userEvent.setup()

    await utilisateur.click(screen.getByRole('button', { name: /^PG atelier/ }))
    expect(await screen.findByRole('tablist')).toBeInTheDocument()

    await utilisateur.click(screen.getByRole('button', { name: 'retirer' }))
    await waitFor(() => expect(screen.queryByRole('tab', { name: /pg-atelier/ })).toBeNull())
  })

  it('le « + » et le menu de ligne remontent à l’application', async () => {
    const onDeclareInstance = vi.fn()
    const onEditInstance = vi.fn()
    const onRemoveInstance = vi.fn()
    monter({ onDeclareInstance, onEditInstance, onRemoveInstance })
    const utilisateur = userEvent.setup()

    await utilisateur.click(screen.getByRole('button', { name: 'Déclarer une instance' }))
    expect(onDeclareInstance).toHaveBeenCalled()

    await utilisateur.click(screen.getByRole('button', { name: 'Actions de PG atelier' }))
    await utilisateur.click(screen.getByRole('button', { name: 'Modifier' }))
    expect(onEditInstance).toHaveBeenCalledWith(instanceDeTest())

    await utilisateur.click(screen.getByRole('button', { name: 'Actions de PG atelier' }))
    await utilisateur.click(screen.getByRole('button', { name: 'Supprimer' }))
    expect(onRemoveInstance).toHaveBeenCalledWith(instanceDeTest())
  })

  it('une ouverture qui échoue laisse l’onglet, marqué hors ligne, avec de quoi retenter', async () => {
    // Un onglet inerte serait le pire des deux : la console fait déjà ce choix — l'échec n'est pas
    // mémorisé comme un refus, et le clic doit retenter.
    const openInstance = vi.fn(async () => {
      throw new Error('hôte injoignable')
    })
    monter({ passerelleInstances: passerelleDeTest({ openInstance }) })

    await userEvent.setup().click(screen.getByRole('button', { name: /^PG atelier/ }))

    expect(await screen.findByText(/hôte injoignable/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ouvrir l’instance' })).toBeInTheDocument()
    // Et la ligne de la sidebar le dit aussi : la pastille suit le même état.
    expect(screen.getByText('HORS LIGNE')).toBeInTheDocument()
  })
})

/**
 * La passerelle de l'arbre, muette.
 *
 * **Toutes ses entrées**, y compris celles qu'aucun de ces tests n'appelle : un double doit répondre
 * à *tous* les appels que la production fait (règle n° 19), et un `PasserelleArbre` incomplet ne
 * compile pas — ce qui est la bonne façon de s'en souvenir.
 */
function passerelleDArbre() {
  return {
    openDatabase: vi.fn(async () => ({ kind: 'never' as const })),
    closeDatabase: vi.fn(async () => {}),
    connectionStates: vi.fn(async () => []),
    listSchemas: vi.fn(async () => []),
    listObjects: vi.fn(async () => []),
    // **L'arbre s'y abonne au montage**, donc le double doit répondre même si aucun de ces tests
    // ne perd de connexion (règle n° 19).
    surEchecDeCommande: () => () => {},
  }
}
