import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sprite } from '../../design/icons/Sprite'
import type { ConnectionRequest, ConnectionTest } from '../../domain/engine'
import { NewConnection } from './NewConnection'
import { TRIO_DE_TEST } from './pourLesTests'
import { codeDe, messageDe } from './testerLaConnexion'

const REUSSI: ConnectionTest = {
  latencyMs: 240,
  serverVersion: 'PostgreSQL 17.6',
  tunnelLocalPort: null,
  tlsUnverified: false,
}

// Un projet par défaut : sans aucun projet, « Enregistrer & ouvrir » est désactivé (`08e`),
// ce qui masquerait l'effet du test de connexion sur ce bouton.
const PROJETS = [{ id: 'print', name: 'Atelier Nord', environments: TRIO_DE_TEST }]

function monter(onTest: (request: ConnectionRequest) => Promise<ConnectionTest>) {
  return render(
    <>
      <Sprite />
      <NewConnection
        onClose={() => {}}
        projects={PROJETS}
        // Le cadre : depuis le 26 août 2026, c'est l'appelant qui désigne le projet, et sans lui
        // l'enregistrement est refusé — ce qui masquerait ce que ce fichier mesure.
        projet={PROJETS[0]?.name ?? ''}
        onBrowseKey={async () => null}
        onTest={onTest}
      />
    </>,
  )
}

const tester = () => userEvent.click(screen.getByRole('button', { name: /Tester la connexion/ }))

/**
 * La sous-modale de `A3`, une fois ouverte.
 *
 * Les requêtes doivent y être restreintes : le message du moteur apparaît **trois fois** — dans
 * le texte explicatif, dans l'encart de log, et dans le pied de `A2`. C'est voulu (le handoff
 * montre les trois) et une recherche globale échoue donc sur « Found multiple elements ».
 */
const sousModale = async () =>
  within(await screen.findByRole('dialog', { name: 'Connexion impossible' }))

// --- Succès ---

test('un test réussi affiche la latence et la version', async () => {
  monter(async () => REUSSI)
  await tester()
  await waitFor(() =>
    expect(screen.getByText(/Connecté en 240 ms · PostgreSQL 17\.6/)).toBeInTheDocument(),
  )
})

test('le port local du tunnel est montré quand il y en a un', async () => {
  monter(async () => ({ ...REUSSI, tunnelLocalPort: 63342 }))
  await tester()
  // `A2` affiche « auto (63342) » dans le panneau ; le pied confirme que c'est bien par là
  // que la connexion est passée.
  await waitFor(() => expect(screen.getByText(/tunnel :63342/)).toBeInTheDocument())
})

// **Le point le plus important de `08d`.** `06b` emploie `NoTls` : un test en `verify-ca` ou
// `verify-full` réussit sans que l'identité du serveur ait été contrôlée. Afficher « Connecté »
// sans plus serait exact et trompeur.
test('un mode SSL exigeant une vérification affiche « TLS non vérifié »', async () => {
  monter(async () => ({ ...REUSSI, tlsUnverified: true }))
  await tester()
  await waitFor(() => expect(screen.getByText(/TLS non vérifié/)).toBeInTheDocument())
})

test('un mode SSL sans vérification n’affiche pas la mention', async () => {
  monter(async () => REUSSI)
  await tester()
  await waitFor(() => expect(screen.getByText(/Connecté en/)).toBeInTheDocument())
  expect(screen.queryByText(/TLS non vérifié/)).not.toBeInTheDocument()
})

// --- Le moteur, qui doit voyager avec la requête ---

// **Le défaut que ce test attrape.** La requête ne portait pas le moteur, et la commande Rust
// appelait l'adaptateur PostgreSQL en dur : tester une base MongoDB faisait parler le protocole
// PostgreSQL à un `mongod`, qui ne répond rien qu'un pilote PostgreSQL sache lire — l'appel restait
// **pendu**, sans verdict ni message. Vu de l'écran, un clic sans effet.
//
// Ce qui a manqué n'est pas un test de plus sur le résultat, mais un test sur **ce qui part**.
// Chacun des quatre moteurs livrés est vérifié, et non le seul MongoDB : le défaut n'était pas
// propre à un moteur, il était propre au champ absent.
test.each([
  ['MongoDB', 'mongodb'],
  ['MySQL', 'mysql'],
  ['SQLite', 'sqlite'],
  ['PostgreSQL', 'postgresql'],
])('le moteur choisi (%s) part dans la requête de test', async (libelle, attendu) => {
  const requetes: ConnectionRequest[] = []
  monter(async (request) => {
    requetes.push(request)
    return REUSSI
  })

  // Le sélecteur de moteur est un groupe de boutons radio : on le choisit comme l'utilisateur.
  await userEvent.click(screen.getByRole('radio', { name: new RegExp(`^${libelle}$`) }))
  await tester()

  await waitFor(() => expect(requetes).toHaveLength(1))
  expect(requetes[0]?.engine).toBe(attendu)
})

// **La base d'authentification voyage, et le vide se dit par l'absence.** Un `''` traversant l'IPC
// ferait s'authentifier MongoDB contre une base nommée « », qui n'existe pas — donc un échec dont le
// message n'apprendrait rien.
test('un brouillon neuf part sur « admin » pour MongoDB', async () => {
  const requetes: ConnectionRequest[] = []
  monter(async (request) => {
    requetes.push(request)
    return REUSSI
  })

  await userEvent.click(screen.getByRole('radio', { name: /^MongoDB$/ }))
  // **Préremplie, et non devinée** : la valeur est dans le champ, donc visible et effaçable. C'est
  // ce qui la distingue du défaut `admin` que `18b` avait refusé côté moteur.
  expect(screen.getByLabelText('Base d’authentification')).toHaveValue('admin')

  await tester()
  await waitFor(() => expect(requetes).toHaveLength(1))
  expect(requetes[0]?.variant.authDatabase).toBe('admin')
})

test('le champ vidé rend la main à la base déclarée', async () => {
  const requetes: ConnectionRequest[] = []
  monter(async (request) => {
    requetes.push(request)
    return REUSSI
  })

  await userEvent.click(screen.getByRole('radio', { name: /^MongoDB$/ }))
  await userEvent.clear(screen.getByLabelText('Base d’authentification'))
  await tester()

  // `null` et non `''` : c'est ce qui fait retomber le moteur sur la décision de `18b`, au lieu de
  // s'authentifier contre une base nommée « », qui n'existe pas.
  await waitFor(() => expect(requetes).toHaveLength(1))
  expect(requetes[0]?.variant.authDatabase).toBeNull()
})

test('un espace de trop dans le nom est élagué', async () => {
  const requetes: ConnectionRequest[] = []
  monter(async (request) => {
    requetes.push(request)
    return REUSSI
  })

  await userEvent.click(screen.getByRole('radio', { name: /^MongoDB$/ }))
  await userEvent.clear(screen.getByLabelText('Base d’authentification'))
  await userEvent.type(screen.getByLabelText('Base d’authentification'), '  comptes  ')
  await tester()

  // Un espace de bord dans un nom de base est une faute de frappe, pas une intention.
  await waitFor(() => expect(requetes).toHaveLength(1))
  expect(requetes[0]?.variant.authDatabase).toBe('comptes')
})

test('un moteur qui authentifie au niveau du serveur n’envoie aucune base d’authentification', async () => {
  const requetes: ConnectionRequest[] = []
  monter(async (request) => {
    requetes.push(request)
    return REUSSI
  })

  // **Le brouillon porte `admin` quel que soit le moteur** — c'est un seul état, et le champ
  // n'apparaît que pour MongoDB. Sans ce filtre, chaque connexion PostgreSQL enregistrerait une
  // base d'authentification que rien ne lit : du bruit dans le fichier, et une affirmation fausse.
  await tester()
  await waitFor(() => expect(requetes).toHaveLength(1))
  expect(requetes[0]?.engine).toBe('postgresql')
  expect(requetes[0]?.variant.authDatabase).toBeNull()
})

// --- Attente ---

test('pendant le test, le bouton le dit et ne se reclique pas', async () => {
  let debloquer: (() => void) | undefined
  let appels = 0
  monter(async () => {
    appels += 1
    await new Promise<void>((resolve) => {
      debloquer = resolve
    })
    return REUSSI
  })

  await tester()

  // Le mockup ne maquette **pas** l'attente, et un test vers un hôte injoignable prend jusqu'à
  // 30 secondes (`06e`). Sans cet état, le bouton semble mort et l'utilisateur reclique.
  const bouton = await screen.findByRole('button', { name: /Test en cours…/ })
  expect(bouton).toBeDisabled()
  await userEvent.click(bouton)
  expect(appels).toBe(1)

  debloquer?.()
})

// --- Échec, et A3 ---

test('un échec ouvre la sous-modale de A3', async () => {
  monter(async () => {
    throw { code: null, position: null, message: 'le bastion bastion.example est injoignable' }
  })
  await tester()

  const sous = await sousModale()
  expect(sous.getByText(/bastion.example est injoignable/)).toBeInTheDocument()
})

test('le message du moteur n’est pas réécrit', async () => {
  // `06b`–`06e` produisent des messages qui **disent la manœuvre**. Les reformuler créerait
  // deux vérités, dont une périmée.
  const message =
    'le bastion b n’est pas dans ~/.ssh/known_hosts : lancez « ssh b » une fois pour enregistrer sa clé'
  monter(async () => {
    throw { code: null, position: null, message }
  })
  await tester()
  const sous = await sousModale()
  // Le message du moteur, **mot pour mot**, dans le texte explicatif — sa place, puisqu'il dit
  // la manœuvre. L'encart de log ne le recopie pas : voir la note du composant.
  expect(sous.getByText(message)).toBeInTheDocument()
})

test('un SQLSTATE est montré dans l’encart de log', async () => {
  monter(async () => {
    throw { code: '28P01', position: null, message: 'authentification refusée' }
  })
  await tester()
  const sous = await sousModale()
  expect(sous.getByText('28P01')).toBeInTheDocument()
})

// L'encart porte ce que le texte explicatif ne dit **pas**. Sans code ni tunnel, il n'a rien à
// ajouter : le rendre quand même reviendrait à afficher le même paragraphe deux fois, en mono.
test('sans SQLSTATE ni tunnel, aucun encart de log', async () => {
  monter(async () => {
    throw { code: null, position: null, message: 'hôte injoignable' }
  })
  await tester()
  const sous = await sousModale()
  expect(sous.getByText('hôte injoignable')).toBeInTheDocument()
  expect(sous.queryByText(/sqlstate/)).not.toBeInTheDocument()
})

test('la seconde ligne du log ne parle de tunnel que s’il y en avait un', async () => {
  monter(async () => {
    throw { code: null, position: null, message: 'échec' }
  })
  await tester()
  await screen.findByRole('dialog', { name: 'Connexion impossible' })
  // L'inventer sur une connexion directe enverrait chercher un bastion inexistant.
  expect(screen.queryByText(/pg connect skipped/)).not.toBeInTheDocument()
})

test('fermer la sous-modale ne ferme pas A2, et garde le message dans le pied', async () => {
  monter(async () => {
    throw { code: null, position: null, message: 'hôte injoignable' }
  })
  await tester()
  const sous = await sousModale()

  await userEvent.click(sous.getByRole('button', { name: /Fermer/ }))

  expect(screen.queryByRole('dialog', { name: 'Connexion impossible' })).not.toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: 'Nouvelle connexion' })).toBeInTheDocument()
  // Le handoff le montre : le pied garde « Retester » et son message inline.
  expect(screen.getByRole('button', { name: 'Retester' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'hôte injoignable' })).toBeInTheDocument()
})

test('le message du pied rouvre la sous-modale', async () => {
  monter(async () => {
    throw { code: null, position: null, message: 'hôte injoignable' }
  })
  await tester()
  const sous = await sousModale()
  await userEvent.click(sous.getByRole('button', { name: /Fermer/ }))

  await userEvent.click(screen.getByRole('button', { name: 'hôte injoignable' }))
  expect(await screen.findByRole('dialog', { name: 'Connexion impossible' })).toBeInTheDocument()
})

test('« Enregistrer & ouvrir » est désactivé après un échec, réactivé après un succès', async () => {
  let echoue = true
  monter(async () => {
    if (echoue) throw { code: null, position: null, message: 'échec' }
    return REUSSI
  })

  // Requêté à chaque étape plutôt que gardé dans une variable : `Button` reçoit un `disabled`
  // qui change, et un nœud gardé pourrait être détaché par un rendu — le test échouerait alors
  // pour une raison qui n'a rien à voir avec le sujet.
  const enregistrer = () => screen.getByRole('button', { name: /Enregistrer & ouvrir/ })
  expect(enregistrer()).toBeEnabled()

  await tester()
  const sous = await sousModale()
  expect(enregistrer()).toBeDisabled()

  await userEvent.click(sous.getByRole('button', { name: /Fermer/ }))
  echoue = false
  await userEvent.click(screen.getByRole('button', { name: 'Retester' }))
  await waitFor(() => expect(enregistrer()).toBeEnabled())
})

// Le handoff insiste : « La modale sous-jacente n'est pas surlignée en rouge ». L'erreur ne vit
// que dans la sous-modale et le message du pied.
test('les champs de A2 ne sont pas surlignés après un échec', async () => {
  monter(async () => {
    throw { code: null, position: null, message: 'échec' }
  })
  await tester()
  await screen.findByRole('dialog', { name: 'Connexion impossible' })

  for (const nom of ['Hôte', 'Utilisateur', 'Mot de passe']) {
    const champ = screen.getByLabelText(nom)
    expect(champ).not.toHaveAttribute('aria-invalid')
    expect(champ.className).not.toMatch(/error|invalid|danger/i)
  }
})

// --- Les deux formes d'erreur que l'IPC peut rendre ---

// Tauri sérialise un `Err(EngineError)` en objet, mais une panique de commande ou un pont
// cassé rendent une **chaîne**. Un `catch` qui suppose la forme structurée afficherait
// « undefined » là où la cause était lisible.
test('une erreur en chaîne est affichée telle quelle', () => {
  expect(messageDe('la commande a paniqué')).toBe('la commande a paniqué')
  expect(codeDe('la commande a paniqué')).toBeNull()
})

test('une erreur structurée rend son message et son code', () => {
  const erreur = { code: '3D000', position: null, message: 'base inconnue' }
  expect(messageDe(erreur)).toBe('base inconnue')
  expect(codeDe(erreur)).toBe('3D000')
})

test('une erreur d’une forme inattendue ne rend pas « undefined »', () => {
  expect(messageDe(undefined)).toBe('undefined')
  expect(messageDe({ inattendu: true })).toContain('object')
})

// --- Moteur sans adaptateur ---

test('« Tester » est désactivé pour un moteur sans adaptateur', async () => {
  monter(async () => REUSSI)
  // **Redis** : MySQL a son adaptateur depuis `16`, et garder l'ancien exemple ferait échouer ce
  // test en accusant le bouton là où c'est l'exemple qui a vieilli.
  await userEvent.click(screen.getByRole('radio', { name: 'Redis' }))
  // Le laisser actif ferait tenter une connexion vers un serveur qu'aucun adaptateur ne sait
  // interroger — message trompeur là où le pied dit déjà la vraie raison.
  expect(screen.getByRole('button', { name: /Tester la connexion/ })).toBeDisabled()
  expect(screen.getByText(/Redis n’a pas encore d’adaptateur/)).toBeInTheDocument()
})
