import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type {
  DeleteEnvironmentResult,
  EnvironmentId,
  Project,
  ReorderEnvironmentsRequest,
} from '../../domain/config'
import { ProjectEditor } from './ProjectEditor'

/**
 * Le décor : trois environnements inventés, deux connexions dans « vitrine ».
 *
 * **Aucun nom réel** — ni de table, ni de base, ni d'identifiant : la règle d'`AGENTS.md`. Les
 * propriétés mesurées ici tiennent aux quantités, pas aux noms.
 */
function projet(): Project {
  return {
    name: 'Atelier Nord',
    environments: [
      { id: 'atelier', label: 'atelier', color: 'green', production: false },
      { id: 'vitrine', label: 'vitrine', color: 'red', production: true },
      { id: 'coulisses', label: 'coulisses', color: 'slate', production: false },
    ],
    databases: [
      base('catalogue', 'vitrine'),
      base('reservations', 'vitrine'),
      base('catalogue', 'atelier'),
    ],
    queries: [],
  }
}

function base(nom: string, environnement: EnvironmentId): Project['databases'][number] {
  return {
    name: nom,
    engine: 'postgresql',
    environment: environnement,
    connection: {
      host: 'localhost',
      port: 5432,
      defaultDatabase: nom,
      username: 'lecteur',
      password: null,
      sslMode: 'prefer',
      caCertificate: null,
      authDatabase: null,
      readOnly: true,
      reconnectOnStartup: false,
      tunnel: null,
    },
    consoles: [],
  }
}

const RIEN: DeleteEnvironmentResult = {
  projects: [],
  deletedConnections: [],
  leftoverSecrets: [],
}

/**
 * Monte l'éditeur avec les cinq gestes espionnés.
 *
 * Chacun rend une liste vide : ce qu'on mesure est **l'appel**, pas ce que le cœur en fait — le cœur
 * a ses propres tests, en Rust, et les rejouer ici mesurerait une imitation.
 */
function monter(surcharge: Partial<Project> = {}) {
  const appels: Record<string, unknown[]> = {
    creer: [],
    renommer: [],
    recolorier: [],
    reordonner: [],
    retirer: [],
  }
  const onProjets = vi.fn()
  const onRenameProject = vi.fn(async () => ({ missingSecrets: [], leftoverSecrets: [] }))
  render(
    <>
      <Sprite />
      <ProjectEditor
        projet={{ ...projet(), ...surcharge }}
        onClose={() => {}}
        onProjets={onProjets}
        onRenameProject={onRenameProject}
        onCreer={async (request) => {
          appels.creer?.push(request)
          return []
        }}
        onRenommer={async (request) => {
          appels.renommer?.push(request)
          return []
        }}
        onRecolorier={async (request) => {
          appels.recolorier?.push(request)
          return []
        }}
        onReordonner={async (request) => {
          appels.reordonner?.push(request)
          return []
        }}
        onRetirer={async (request) => {
          appels.retirer?.push(request)
          return RIEN
        }}
      />
    </>,
  )
  return { appels, onProjets, onRenameProject }
}

const ligneDe = (libelle: string) =>
  screen.getByRole('button', { name: `Retirer ${libelle}` }).closest('li') as HTMLElement

test('les trois environnements sont là, avec leur nombre de connexions', () => {
  monter()
  // **Le compte, affiché avant même de cliquer** (`23e`) : c'est ce qui rend l'avertissement de `23f`
  // prévisible. Sans lui, on découvre l'ampleur au moment de confirmer.
  expect(ligneDe('vitrine')).toHaveTextContent('2 connexions')
  expect(ligneDe('atelier')).toHaveTextContent('1 connexion')
  expect(ligneDe('coulisses')).toHaveTextContent('aucune connexion')
})

/*
 * **Aucune ligne ne se dit « actif »** (`25a`, `25c`).
 *
 * L'éditeur marquait l'environnement actif du projet, parce que le retirer changeait le contenu de
 * l'arbre. L'arbre montre désormais tous les environnements déclarés — chacun un palier — donc
 * aucun n'est privilégié, et `activeEnvironment` a quitté le modèle.
 */
test('aucun environnement n’est marqué actif', () => {
  monter()
  for (const libelle of ['atelier', 'vitrine', 'coulisses']) {
    expect(ligneDe(libelle)).not.toHaveTextContent('actif')
  }
})

test('le libellé part au relâchement du champ, débarrassé de ses espaces', async () => {
  const utilisateur = userEvent.setup()
  const { appels } = monter()
  const champ = screen.getByLabelText('Libellé de vitrine')
  await utilisateur.clear(champ)
  await utilisateur.type(champ, '  Boutique  ')
  // **Rien n'est parti pendant la frappe** : une commande par caractère écrirait le disque dix fois
  // pour un mot, et le trousseau n'aime pas ça.
  expect(appels.renommer).toEqual([])
  await utilisateur.tab()

  expect(appels.renommer).toEqual([
    { project: 'Atelier Nord', environment: 'vitrine', label: 'Boutique' },
  ])
})

test('un libellé inchangé ou vide n’envoie rien', async () => {
  const utilisateur = userEvent.setup()
  const { appels } = monter()
  const champ = screen.getByLabelText('Libellé de vitrine')
  await utilisateur.click(champ)
  await utilisateur.tab()
  await utilisateur.clear(champ)
  await utilisateur.tab()
  // Un champ vidé puis quitté **restaure**, il ne supprime pas : le cœur refuserait, et l'écran n'a
  // pas à provoquer un refus qu'il peut éviter.
  expect(appels.renommer).toEqual([])
})

// **Sur « vitrine », dont la production est allumée** — et c'est tout l'objet du test : sur une ligne
// où elle est déjà éteinte, un code qui enverrait `false` en dur passerait au vert. Le premier jet de
// ce test visait « coulisses », et le sabotage « recolorier éteint la production » ne le faisait pas
// tomber. C'est le défaut n° 84 sous une autre forme : une mesure prise là où la faute et le juste
// coïncident ne mesure rien.
test('une couleur s’applique au clic, sans éteindre la production', async () => {
  const utilisateur = userEvent.setup()
  const { appels } = monter()
  const nuancier = within(ligneDe('vitrine')).getByRole('radiogroup')
  await utilisateur.click(within(nuancier).getByRole('radio', { name: 'violet' }))

  // Le drapeau part **inchangé** : le geste du cœur porte les deux ensemble, et envoyer `false` par
  // défaut retirerait les garde-fous d'écriture (`11d`) d'un environnement de production, pour un
  // clic sur une pastille de couleur.
  expect(appels.recolorier).toEqual([
    {
      project: 'Atelier Nord',
      environment: 'vitrine',
      color: 'violet',
      production: true,
    },
  ])
})

test('la couleur choisie est lisible autrement que par la couleur', () => {
  monter()
  const nuancier = within(ligneDe('vitrine')).getByRole('radiogroup')
  // La règle de `09d` : l'état ne vit jamais dans la seule couleur, sinon un daltonien ne peut pas
  // lire laquelle est active. Ce sont de vraies cases radio, donc l'état est `checked` — non
  // `aria-checked`, qu'attendait le premier jet de ce test, écrit quand les pastilles étaient des
  // `<button role="radio">`.
  expect(within(nuancier).getByRole('radio', { name: 'red' })).toBeChecked()
  expect(within(nuancier).getByRole('radio', { name: 'green' })).not.toBeChecked()
})

test('la bascule production garde la couleur', async () => {
  const utilisateur = userEvent.setup()
  const { appels } = monter()
  await utilisateur.click(screen.getByRole('switch', { name: 'Production pour coulisses' }))

  expect(appels.recolorier).toEqual([
    { project: 'Atelier Nord', environment: 'coulisses', color: 'slate', production: true },
  ])
})

test('les flèches sur la poignée envoient l’ordre complet', async () => {
  const utilisateur = userEvent.setup()
  const { appels } = monter()
  const poignee = screen.getByRole('button', { name: /Déplacer coulisses/ })
  poignee.focus()
  await utilisateur.keyboard('{ArrowUp}')

  // **L'ordre complet, non un couple d'indices** : le cœur refuse une permutation partielle (`23c`),
  // parce qu'un ordre partiel se lirait de plusieurs façons — dont une qui supprime.
  expect(appels.reordonner).toEqual([
    { project: 'Atelier Nord', order: ['atelier', 'coulisses', 'vitrine'] },
  ] satisfies ReorderEnvironmentsRequest[] as unknown[])
})

test('la poignée est atteignable au clavier, et le dit', () => {
  monter()
  // **Sans cela, réordonner n'existe pas sans souris.** `draggable` seul est un geste que le clavier
  // ne peut pas produire ; le nom accessible annonce la façon de s'en servir.
  const poignee = screen.getByRole('button', { name: 'Déplacer vitrine (flèches haut et bas)' })
  expect(poignee).toHaveAttribute('draggable', 'true')
})

test('la première ligne ne remonte pas, la dernière ne descend pas', async () => {
  const utilisateur = userEvent.setup()
  const { appels } = monter()
  screen.getByRole('button', { name: /Déplacer atelier/ }).focus()
  await utilisateur.keyboard('{ArrowUp}')
  screen.getByRole('button', { name: /Déplacer coulisses/ }).focus()
  await utilisateur.keyboard('{ArrowDown}')
  // Un ordre inchangé envoyé au cœur écrirait le disque pour rien, et ferait clignoter la liste.
  expect(appels.reordonner).toEqual([])
})

test('un environnement s’ajoute, avec la couleur suivante du nuancier', async () => {
  const utilisateur = userEvent.setup()
  const { appels } = monter()
  await utilisateur.click(screen.getByRole('button', { name: /Ajouter un environnement/ }))

  expect(appels.creer).toEqual([
    { project: 'Atelier Nord', label: 'env 4', color: 'slate', production: false },
  ])
})

test('un environnement sans connexion se retire sans confirmation', async () => {
  const utilisateur = userEvent.setup()
  const { appels } = monter()
  await utilisateur.click(screen.getByRole('button', { name: 'Retirer coulisses' }))

  // **Pas de confirmation pour un geste sans conséquence** (`23f`) : demander confirmation pour rien
  // apprend à cliquer sans lire, et c'est ce qui fait valider les confirmations qui comptent.
  expect(screen.queryByRole('dialog', { name: /Retirer coulisses/ })).toBeNull()
  await waitFor(() =>
    expect(appels.retirer).toEqual([{ project: 'Atelier Nord', environment: 'coulisses' }]),
  )
})

test('un environnement qui porte des connexions demande confirmation, et les nomme', async () => {
  const utilisateur = userEvent.setup()
  const { appels } = monter()
  await utilisateur.click(screen.getByRole('button', { name: 'Retirer vitrine' }))

  const confirmation = screen.getByRole('dialog', { name: /Retirer vitrine/ })
  expect(confirmation).toHaveTextContent('2 connexions déclarées')
  expect(confirmation).toHaveTextContent('catalogue')
  expect(confirmation).toHaveTextContent('reservations')
  expect(confirmation).toHaveTextContent('mots de passe seront retirés du Trousseau')
  // La phrase que `08j` a rendue obligatoire : « supprimer une connexion » se lit comme
  // « supprimer la base ».
  expect(confirmation).toHaveTextContent('bases distantes ne sont pas touchées')
  // Rien n'est parti avant le clic de confirmation.
  expect(appels.retirer).toEqual([])
})

// La confirmation ne parle plus de remplaçant : il n'y a plus d'actif à remplacer.
test('la confirmation de retrait ne nomme aucun remplaçant', async () => {
  const utilisateur = userEvent.setup()
  monter()
  await utilisateur.click(screen.getByRole('button', { name: 'Retirer atelier' }))

  const confirmation = screen.getByRole('dialog', { name: /Retirer atelier/ })
  expect(confirmation).not.toHaveTextContent('environnement actif')
})

test('le dernier environnement ne se retire pas, et le bouton dit pourquoi', () => {
  const seul = projet()
  monter({ environments: [seul.environments[0] as never], databases: [] })
  const bouton = screen.getByRole('button', { name: 'Retirer atelier' })
  expect(bouton).toBeDisabled()
  expect(bouton).toHaveAttribute('title', expect.stringContaining('au moins un environnement'))
})

test('le nom du projet se renomme au relâchement du champ', async () => {
  const utilisateur = userEvent.setup()
  const { onRenameProject } = monter()
  const champ = screen.getByLabelText('Nom du projet')
  await utilisateur.clear(champ)
  await utilisateur.type(champ, '  Atelier Sud  ')
  await utilisateur.tab()

  // **Le geste de `08i`, non un nouveau** : c'est lui qui déplace les mots de passe.
  expect(onRenameProject).toHaveBeenCalledWith('Atelier Sud')
})

test('un nom inchangé ne déclenche aucun renommage', async () => {
  const utilisateur = userEvent.setup()
  const { onRenameProject } = monter()
  await utilisateur.click(screen.getByLabelText('Nom du projet'))
  await utilisateur.tab()
  // Renommer pour le même nom déplacerait des secrets pour rien — donc demanderait une autorisation
  // du système sans raison.
  expect(onRenameProject).not.toHaveBeenCalled()
})

test('le refus du cœur s’affiche, et la modale reste ouverte', async () => {
  const utilisateur = userEvent.setup()
  render(
    <>
      <Sprite />
      <ProjectEditor
        projet={projet()}
        onClose={() => {}}
        onProjets={() => {}}
        onRenameProject={async () => ({ missingSecrets: [], leftoverSecrets: [] })}
        onCreer={async () => {
          throw new Error('« vitrine » est déjà déclaré dans ce projet')
        }}
      />
    </>,
  )
  await utilisateur.click(screen.getByRole('button', { name: /Ajouter un environnement/ }))

  // **Le refus vient du cœur, tel quel** : une seconde implémentation des règles dans l'écran
  // divergerait de la première, et c'est celle du cœur qui décide.
  expect(await screen.findByRole('alert')).toHaveTextContent('déjà déclaré')
  expect(screen.getByRole('dialog', { name: /Modifier Atelier Nord/ })).toBeInTheDocument()
})

test('aucun bouton « Enregistrer » : tout est déjà écrit', () => {
  monter()
  expect(screen.queryByRole('button', { name: /Enregistrer|Appliquer/ })).toBeNull()
  expect(screen.getByRole('button', { name: 'Terminé' })).toBeInTheDocument()
})
