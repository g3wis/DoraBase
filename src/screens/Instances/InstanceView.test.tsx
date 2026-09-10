import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { ConnectionState } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { InstanceView } from './InstanceView'
import { instanceDeTest, passerelleDeTest, toutesLesCapacites, vueDeTest } from './pourLesTests'

const OUVERTE: ConnectionState = {
  kind: 'connected',
  serverVersion: 'PostgreSQL 17.6',
  tunnelLocalPort: null,
}

function monter(options: Partial<Parameters<typeof InstanceView>[0]> = {}) {
  const passerelle = options.passerelle ?? passerelleDeTest()
  return render(
    <>
      <Sprite />
      {/* `language: 'fr'` explicite, jamais celle de la machine : les assertions portent sur des
          libellés. Même arbitrage que la locale figée de Playwright. */}
      <LanguageProvider preferences={{ language: 'fr' }}>
        <InstanceView
          instance={instanceDeTest()}
          etat={OUVERTE}
          passerelle={passerelle}
          onOuvrir={() => {}}
          // Le temps est **figé** : l'âge du relevé est ce que le décor doit pouvoir décider, sans
          // quoi la phrase « relevé il y a n s » serait un tirage au sort (règle n° 3).
          maintenant={() => 1_000_000}
          {...options}
        />
      </LanguageProvider>
    </>,
  )
}

test('la vue d’ensemble est lue dès l’ouverture — elle porte les capacités', async () => {
  // Les six autres sections attendent leur première visite ; celle-ci ne le peut pas : c'est elle
  // qui dit ce que ce compte a le droit de faire, et toutes les autres en dépendent.
  const instanceOverview = vi.fn(async () => vueDeTest())
  monter({ passerelle: passerelleDeTest({ instanceOverview }) })

  await waitFor(() => expect(instanceOverview).toHaveBeenCalledTimes(1))
  expect(await screen.findByText('PostgreSQL 17.6')).toBeInTheDocument()
})

test('une section n’est lue qu’à sa première visite, et pas deux fois', async () => {
  // Sept lectures au montage feraient sept allers-retours pour une section regardée ; et relire à
  // chaque retour ferait un aller-retour par clic de bande.
  const instanceRoles = vi.fn(async () => [])
  monter({ passerelle: passerelleDeTest({ instanceRoles }) })
  const utilisateur = userEvent.setup()

  expect(instanceRoles).not.toHaveBeenCalled()

  await utilisateur.click(screen.getByRole('radio', { name: /Utilisateurs/ }))
  await waitFor(() => expect(instanceRoles).toHaveBeenCalledTimes(1))

  await utilisateur.click(screen.getByRole('radio', { name: /Bases/ }))
  await utilisateur.click(screen.getByRole('radio', { name: /Utilisateurs/ }))
  // Le retour ne relit pas : c'est la garde de `demandees`.
  expect(instanceRoles).toHaveBeenCalledTimes(1)
})

test('« Rafraîchir » relit la section affichée — et elle seule', async () => {
  const instanceDatabases = vi.fn(async () => [])
  const instanceRoles = vi.fn(async () => [])
  monter({ passerelle: passerelleDeTest({ instanceDatabases, instanceRoles }) })
  const utilisateur = userEvent.setup()

  await utilisateur.click(screen.getByRole('radio', { name: /Bases/ }))
  await waitFor(() => expect(instanceDatabases).toHaveBeenCalledTimes(1))

  await utilisateur.click(screen.getByRole('button', { name: 'Rafraîchir' }))
  await waitFor(() => expect(instanceDatabases).toHaveBeenCalledTimes(2))
  expect(instanceRoles).not.toHaveBeenCalled()
})

test('rien ne se relit tout seul : aucun minuteur', async () => {
  // La décision du 8 septembre 2026 — à la demande seulement. Un relevé périodique ferait bouger un
  // tableau sous les yeux de qui le lit, et interrogerait un serveur de production que personne ne
  // regarde. Le test avance l'horloge de dix minutes.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const instanceOverview = vi.fn(async () => vueDeTest())
    monter({ passerelle: passerelleDeTest({ instanceOverview }) })
    await vi.waitFor(() => expect(instanceOverview).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(600_000)
    expect(instanceOverview).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})

test('l’âge du relevé est dit, et « pas encore relevé » n’est pas « à jour »', async () => {
  // Quatre états, pas deux — la règle de « jamais tentée n'est pas hors ligne », appliquée à une
  // lecture. Le temps est figé : la phrase est donc reproductible.
  let instant = 1_000_000
  monter({
    maintenant: () => instant,
    passerelle: passerelleDeTest({
      instanceOverview: async () => {
        instant = 1_000_000
        return vueDeTest()
      },
    }),
  })

  expect(screen.getByText('pas encore relevé')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByText('relevé il y a 0 s')).toBeInTheDocument())
})

test('un geste refusé désactive son bouton **avec sa raison**', async () => {
  // C'est la promesse que le formulaire de déclaration annonce : DoraBase nomme les gestes que ce
  // compte n'a pas le droit de faire, plutôt que de laisser les boutons échouer.
  const capabilities = toutesLesCapacites().map((capacite) =>
    capacite.gesture === 'createDatabase'
      ? { ...capacite, allowed: false, reason: 'le rôle n’a pas l’attribut CREATEDB' }
      : capacite,
  )
  monter({
    passerelle: passerelleDeTest({
      instanceOverview: async () => vueDeTest({ capabilities }),
    }),
  })
  const utilisateur = userEvent.setup()

  await utilisateur.click(screen.getByRole('radio', { name: /Bases/ }))
  const bouton = await screen.findByRole('button', { name: 'Nouvelle base' })
  expect(bouton).toBeDisabled()
  expect(bouton).toHaveAttribute('title', 'le rôle n’a pas l’attribut CREATEDB')
})

test('le rôle de la session est visible en permanence, quelle que soit la section', async () => {
  // C'est l'information qui décide de ce que cet écran autorise : la lire dans une infobulle, ou
  // seulement dans la vue d'ensemble, obligerait à changer de section pour savoir avec quoi on agit.
  monter()
  const utilisateur = userEvent.setup()

  await waitFor(() => expect(screen.getByText(/connecté en postgres/)).toBeInTheDocument())
  await utilisateur.click(screen.getByRole('radio', { name: /Sessions/ }))
  expect(screen.getByText(/connecté en postgres/)).toBeInTheDocument()
})

test('une instance fermée propose de l’ouvrir plutôt qu’un tableau vide', async () => {
  const onOuvrir = vi.fn()
  const instanceDatabases = vi.fn(async () => [])
  monter({
    etat: { kind: 'offline', reason: 'hôte injoignable' },
    onOuvrir,
    passerelle: passerelleDeTest({ instanceDatabases }),
  })

  expect(screen.getByText(/hôte injoignable/)).toBeInTheDocument()
  // **Et rien n'est lu** : interroger une connexion fermée rendrait « aucune connexion ouverte »,
  // un message qui accuse la mauvaise chose.
  expect(instanceDatabases).not.toHaveBeenCalled()

  await userEvent.setup().click(screen.getByRole('button', { name: 'Ouvrir l’instance' }))
  expect(onOuvrir).toHaveBeenCalled()
})

test('la section Sessions refuse de terminer la nôtre, avec sa raison', async () => {
  // Le refus qui compte : `pg_terminate_backend` sur son propre backend **réussit**, et referme la
  // connexion de cet écran. Le cœur marque la ligne, l'écran la désactive.
  monter()
  const utilisateur = userEvent.setup()
  await utilisateur.click(screen.getByRole('radio', { name: /Sessions/ }))

  const notre = await screen.findByRole('button', { name: 'Terminer la session 101' })
  expect(notre).toHaveAttribute('aria-disabled', 'true')
  expect(notre).toHaveAttribute(
    'title',
    'terminer sa propre session fermerait la connexion de cet écran',
  )

  // Celle d'un autre, elle, reste offerte — sans quoi le test ci-dessus passerait sur un écran où
  // rien n'est cliquable.
  const autre = screen.getByRole('button', { name: 'Terminer la session 202' })
  expect(autre).not.toHaveAttribute('aria-disabled')
})

test('la section Utilisateurs sépare ceux qui se connectent des rôles de groupe', async () => {
  // **Deux tableaux depuis le 9 septembre 2026** (rapporté à l'usage : « la table utilisateurs
  // affiche actuellement les rôles »). Le partage suit `rolcanlogin`, la seule marque du catalogue ;
  // les groupes vivent dans un second tableau **replié**, comme les schémas de catalogue du
  // gestionnaire de schémas — ils existent, et ils sont nommés dans « membre de ».
  monter()
  const utilisateur = userEvent.setup()
  await utilisateur.click(screen.getByRole('radio', { name: /Utilisateurs/ }))

  const premier = await screen.findByRole('table', { name: 'Utilisateurs du serveur' })
  expect(within(premier).getByText('postgres')).toBeInTheDocument()
  // `lecture` ne peut pas se connecter : il n'a rien à faire dans le tableau des utilisateurs.
  expect(within(premier).queryByText('lecture')).toBeNull()
  expect(within(premier).queryByText('pg_monitor')).toBeNull()

  // Replié : les groupes existent, on les compte, et rien ne les montre tant qu'on ne le demande pas.
  expect(screen.queryByRole('table', { name: 'Rôles de groupe' })).toBeNull()
  const bascule = screen.getByRole('button', { name: /Rôles de groupe \(2\)/ })
  expect(bascule).toHaveAttribute('aria-expanded', 'false')

  await utilisateur.click(bascule)
  const second = await screen.findByRole('table', { name: 'Rôles de groupe' })
  expect(within(second).getByText('lecture')).toBeInTheDocument()
  expect(within(second).getByText('pg_monitor')).toBeInTheDocument()
})

test('le filtre de la section Utilisateurs partage avant de masquer, non l’inverse', async () => {
  // Filtrer « pg_ » doit rendre le rôle prédéfini **dans son tableau**, pas le faire disparaître des
  // deux. Le partage se fait donc après le filtre.
  monter()
  const utilisateur = userEvent.setup()
  await utilisateur.click(screen.getByRole('radio', { name: /Utilisateurs/ }))
  await utilisateur.type(await screen.findByRole('textbox', { name: 'Filtrer…' }), 'pg_')

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Rôles de groupe \(1\)/ })).toBeInTheDocument(),
  )
  await utilisateur.click(screen.getByRole('button', { name: /Rôles de groupe/ }))
  expect(
    within(await screen.findByRole('table', { name: 'Rôles de groupe' })).getByText('pg_monitor'),
  ).toBeInTheDocument()
})

test('le mot de passe se pose depuis le formulaire d’édition, et l’ordre ne porte pas la saisie', async () => {
  // **La propriété que le geste existe pour tenir** : ce que la confirmation montre — et ce que le
  // serveur reçoit — est le *vérificateur*, jamais la saisie. Le hachage lui-même est vérifié en
  // Rust, contre un vecteur de la RFC et contre un vrai serveur ; ici c'est le câblage, et le fait
  // que le mot de passe s'arrête à la commande.
  const scramVerifier = vi.fn(async () => 'SCRAM-SHA-256$4096:c2Vs$c3RvY2tlZQ==:c2VydmV1cg==')
  const planInstanceAction = vi.fn(async () => ({
    statements: [
      'ALTER ROLE "postgres" LOGIN PASSWORD \'SCRAM-SHA-256$4096:c2Vs$c3RvY2tlZQ==:c2VydmV1cg==\';',
    ],
    note: 'Ce que l’ordre porte n’est pas le mot de passe mais son vérificateur…',
    destructive: true,
  }))
  monter({ passerelle: passerelleDeTest({ scramVerifier, planInstanceAction }) })
  const utilisateur = userEvent.setup()

  await utilisateur.click(screen.getByRole('radio', { name: /Utilisateurs/ }))
  // **Le crayon, non une action à part** : le mot de passe est une propriété du rôle, qu'on change
  // en même temps qu'un attribut.
  await utilisateur.click(await screen.findByRole('button', { name: 'Modifier le rôle postgres' }))

  const saisie = screen.getByRole('dialog', { name: /Modifier le rôle/ })
  // **La confirmation ne paraît qu'une fois quelque chose saisi** : sur un formulaire d'attributs où
  // le mot de passe reste vide, deux champs de plus seraient deux champs pour rien.
  expect(within(saisie).queryByLabelText('Confirmation')).toBeNull()

  await utilisateur.type(within(saisie).getByLabelText('Nouveau mot de passe'), 'crayon')
  await utilisateur.type(within(saisie).getByLabelText('Confirmation'), 'crayonn')
  expect(within(saisie).getByRole('alert')).toHaveTextContent(/ne sont pas identiques/)
  expect(within(saisie).getByRole('button', { name: 'Exécuter' })).toBeDisabled()

  await utilisateur.clear(within(saisie).getByLabelText('Confirmation'))
  await utilisateur.type(within(saisie).getByLabelText('Confirmation'), 'crayon')
  await utilisateur.click(within(saisie).getByRole('button', { name: 'Exécuter' }))

  // Le hachage part **une fois**, avec la saisie ; le geste, lui, porte ce qui en revient.
  await waitFor(() => expect(scramVerifier).toHaveBeenCalledWith('crayon'))
  await waitFor(() =>
    expect(planInstanceAction).toHaveBeenCalledWith({
      kind: 'alterRole',
      name: 'postgres',
      attributes: { canLogin: true, superuser: true, createDb: true, createRole: true },
      verifier: 'SCRAM-SHA-256$4096:c2Vs$c3RvY2tlZQ==:c2VydmV1cg==',
    }),
  )

  // Et l'encart ne porte pas la saisie — c'est ce qui permet de le montrer.
  const confirmation = await screen.findByRole('dialog', { name: /Confirmer l’exécution/ })
  expect(within(confirmation).getByText(/SCRAM-SHA-256/)).toBeInTheDocument()
  expect(confirmation).not.toHaveTextContent('crayon')
})

test('un formulaire d’édition sans mot de passe n’en hache ni n’en envoie aucun', async () => {
  // **Le champ vide ne coûte rien**, et c'est ce qui a permis de le fusionner : ni aller-retour de
  // hachage, ni `PASSWORD` dans l'ordre. `null` veut dire « laisser en place » — un `PASSWORD NULL`
  // le *retirerait*.
  const scramVerifier = vi.fn(async () => 'jamais appelé')
  const planInstanceAction = vi.fn(async () => ({
    statements: ['ALTER ROLE "postgres" LOGIN;'],
    note: '',
    destructive: false,
  }))
  monter({ passerelle: passerelleDeTest({ scramVerifier, planInstanceAction }) })
  const utilisateur = userEvent.setup()

  await utilisateur.click(screen.getByRole('radio', { name: /Utilisateurs/ }))
  await utilisateur.click(await screen.findByRole('button', { name: 'Modifier le rôle postgres' }))
  await utilisateur.click(
    within(screen.getByRole('dialog', { name: /Modifier le rôle/ })).getByRole('button', {
      name: 'Exécuter',
    }),
  )

  await waitFor(() =>
    expect(planInstanceAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'alterRole', verifier: null }),
    ),
  )
  expect(scramVerifier).not.toHaveBeenCalled()
})

test('un rôle sans LOGIN ne se voit pas proposer de mot de passe, avec sa raison', async () => {
  // PostgreSQL l'accepterait, mais rien ne s'en servirait jamais. Le champ reste **visible** : le
  // masquer ferait chercher où il est passé en décochant `LOGIN`.
  monter()
  const utilisateur = userEvent.setup()
  await utilisateur.click(screen.getByRole('radio', { name: /Utilisateurs/ }))
  await utilisateur.click(await screen.findByRole('button', { name: /Rôles de groupe/ }))
  await utilisateur.click(screen.getByRole('button', { name: 'Modifier le rôle lecture' }))

  const champ = within(screen.getByRole('dialog', { name: /Modifier le rôle/ })).getByLabelText(
    'Nouveau mot de passe',
  )
  expect(champ).toBeDisabled()
  expect(champ).toHaveAttribute(
    'title',
    'ce rôle ne peut pas se connecter : un mot de passe n’y servirait à rien',
  )
})

test('la section Sessions dit ce que le client a déclaré, et le tiret quand il n’a rien dit', async () => {
  // **Le PID est celui du backend serveur** : le processus qui s'est connecté tourne ailleurs, et
  // rien du protocole ne transporte son identité. Ce que le serveur sait est `application_name`, ce
  // que le client déclare — et pour un processus interne, son `backend_type`.
  monter()
  await userEvent.setup().click(screen.getByRole('radio', { name: /Sessions/ }))

  const tableau = await screen.findByRole('table', { name: 'Sessions ouvertes' })
  expect(within(tableau).getByText('DoraBase')).toBeInTheDocument()
  expect(within(tableau).getByText('psql')).toBeInTheDocument()
})

test('la section Bases refuse de supprimer un modèle, avec sa raison', async () => {
  monter()
  const utilisateur = userEvent.setup()
  await utilisateur.click(screen.getByRole('radio', { name: /Bases/ }))

  const modele = await screen.findByRole('button', { name: 'Supprimer la base template1' })
  expect(modele).toHaveAttribute('title', 'une base modèle ne se supprime pas')
  expect(screen.getByRole('button', { name: 'Supprimer la base atelier' })).not.toHaveAttribute(
    'aria-disabled',
  )
})

test('la section Paramètres refuse de régler un paramètre interne, avec sa raison', async () => {
  monter()
  const utilisateur = userEvent.setup()
  await utilisateur.click(screen.getByRole('radio', { name: /Paramètres/ }))

  const interne = await screen.findByRole('button', { name: 'Régler block_size' })
  expect(interne).toHaveAttribute(
    'title',
    'ce paramètre est calculé par le serveur, il ne se règle pas',
  )
  expect(screen.getByRole('button', { name: 'Régler max_connections' })).not.toHaveAttribute(
    'aria-disabled',
  )
})

test('la section Extensions dit dans quelle base elle a lu', async () => {
  // L'honnêteté des deux nombres de la barre d'état du diagramme, sur une autre affirmation : une
  // section « Extensions » qui tairait sa portée se lirait comme la liste des extensions du serveur.
  monter()
  await userEvent.setup().click(screen.getByRole('radio', { name: /Extensions/ }))

  expect(await screen.findByText(/base de service « postgres »/)).toBeInTheDocument()
})

test('le compte d’un segment ne paraît que pour une section lue', async () => {
  // Un zéro sur une section jamais ouverte dirait « cette instance n'a aucun rôle », ce qui est faux
  // et se lit comme une réponse.
  monter()
  const utilisateur = userEvent.setup()

  const avant = screen.getByRole('radio', { name: /Utilisateurs/ })
  expect(avant).toHaveAccessibleName('Utilisateurs')

  await utilisateur.click(avant)
  // **Un, et non trois** : le décor porte un rôle `LOGIN`, un rôle de groupe et un prédéfini. Depuis
  // que la section les sépare, un compte de trois au-dessus d'un tableau d'une ligne se lirait comme
  // un tableau amputé — les groupes ont leur propre compte, sur la ligne qui les déplie.
  await waitFor(() =>
    expect(screen.getByRole('radio', { name: /Utilisateurs/ })).toHaveAccessibleName(
      'Utilisateurs 1',
    ),
  )
})

test('la matrice de privilèges rend un sigle par cellule, et le clic vise un privilège', async () => {
  const planInstanceAction = vi.fn(async () => ({
    statements: ['GRANT CREATE ON DATABASE "atelier" TO "lecture";'],
    note: '',
    destructive: false,
  }))
  monter({ passerelle: passerelleDeTest({ planInstanceAction }) })
  const utilisateur = userEvent.setup()
  await utilisateur.click(screen.getByRole('radio', { name: /Privilèges/ }))

  // `ALL` et non `CTc` : ce que la maquette montre, et ce qu'on cherche du regard. La ligne du rôle
  // qui n'a que `CONNECT` porte `c` — le décor distingue donc les deux sigles, sans quoi un sigle
  // figé passerait (règle n° 5).
  const ligneLecture = (await screen.findByRole('rowheader', { name: 'lecture' })).closest('tr')
  expect(ligneLecture).not.toBeNull()
  // Le sigle composé est un `<span>` : les trois pastilles portent la même lettre, et c'est voulu —
  // elles disent l'état d'un privilège, il dit celui de la cellule.
  const sigles = within(ligneLecture as HTMLElement)
    .getAllByText('c')
    .filter((element) => element.tagName !== 'BUTTON')
  expect(sigles).toHaveLength(1)
  const lignePostgres = screen.getByRole('rowheader', { name: 'postgres' }).closest('tr')
  expect(within(lignePostgres as HTMLElement).getByText('ALL')).toBeInTheDocument()

  // Le clic porte sur **un** privilège nommé, non sur la cellule : un `grant` ne peut pas en viser
  // trois à la fois.
  await utilisateur.click(
    screen.getByRole('button', { name: 'Accorder CREATE à lecture sur atelier' }),
  )
  await waitFor(() =>
    expect(planInstanceAction).toHaveBeenCalledWith({
      kind: 'grantDatabase',
      role: 'lecture',
      database: 'atelier',
      privilege: 'create',
    }),
  )
})

test('une lecture qui échoue le dit, et ne laisse pas un tableau vide', async () => {
  monter({
    passerelle: passerelleDeTest({
      instanceRoles: async () => {
        throw new Error('permission denied for table pg_authid')
      },
    }),
  })
  await userEvent.setup().click(screen.getByRole('radio', { name: /Utilisateurs/ }))

  expect(await screen.findByRole('alert')).toHaveTextContent(/permission denied/)
})

test('le filtre est propre à la section, et se vide en changeant', async () => {
  // Le garder ferait arriver sur un tableau vide, avec un champ rempli qu'on n'a pas rempli pour lui.
  monter()
  const utilisateur = userEvent.setup()
  await utilisateur.click(screen.getByRole('radio', { name: /Bases/ }))

  const filtre = await screen.findByRole('textbox', { name: 'Filtrer…' })
  await utilisateur.type(filtre, 'template')
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Supprimer la base atelier' })).toBeNull(),
  )

  await utilisateur.click(screen.getByRole('radio', { name: /Utilisateurs/ }))
  expect(screen.getByRole('textbox', { name: 'Filtrer…' })).toHaveValue('')
})

test('le geste renvoyé à l’exécution est le geste, jamais le SQL affiché', async () => {
  // **La propriété centrale du garde-fou.** L'écran montre les ordres que le cœur a composés, et
  // renvoie le *geste* : lui faire renvoyer le SQL ferait exécuter une chaîne venue de la webview,
  // et « ce que vous voyez est ce qui part » deviendrait « ce que vous nous renvoyez est ce qui
  // part ».
  const runInstanceAction = vi.fn(async () => ({ statements: [], message: 'fait' }))
  monter({
    passerelle: passerelleDeTest({
      runInstanceAction,
      planInstanceAction: async () => ({
        statements: ['DROP DATABASE "atelier";'],
        note: 'Sans IF EXISTS…',
        destructive: true,
      }),
    }),
  })
  const utilisateur = userEvent.setup()
  await utilisateur.click(screen.getByRole('radio', { name: /Bases/ }))
  await utilisateur.click(await screen.findByRole('button', { name: 'Supprimer la base atelier' }))

  // Le SQL exact est affiché — c'est ce qu'on relit avant d'agir.
  const confirmation = await screen.findByRole('dialog', { name: /Confirmer l’exécution/ })
  expect(within(confirmation).getByText('DROP DATABASE "atelier";')).toBeInTheDocument()
  // Et la note dit ce que le SQL ne dit pas.
  expect(within(confirmation).getByText(/Sans IF EXISTS/)).toBeInTheDocument()

  await utilisateur.click(within(confirmation).getByRole('button', { name: 'Exécuter' }))
  await waitFor(() =>
    expect(runInstanceAction).toHaveBeenCalledWith('pg-atelier', {
      kind: 'dropDatabase',
      name: 'atelier',
    }),
  )
})

test('un geste réussi relit la section, et la vue d’ensemble avec elle', async () => {
  // Les comptes de la vue d'ensemble ont bougé : les laisser ferait afficher « 3 bases » après en
  // avoir supprimé une, jusqu'au prochain clic de bande.
  const instanceDatabases = vi.fn(async () => [])
  const instanceOverview = vi.fn(async () => vueDeTest())
  monter({ passerelle: passerelleDeTest({ instanceDatabases, instanceOverview }) })
  const utilisateur = userEvent.setup()

  await utilisateur.click(screen.getByRole('radio', { name: /Bases/ }))
  await waitFor(() => expect(instanceDatabases).toHaveBeenCalledTimes(1))
  const lecturesInitiales = instanceOverview.mock.calls.length

  await utilisateur.click(screen.getByRole('button', { name: 'Nouvelle base' }))
  await utilisateur.type(screen.getByRole('textbox', { name: 'Nom' }), 'ventes')
  await utilisateur.click(screen.getByRole('button', { name: 'Exécuter' }))
  await utilisateur.click(await screen.findByRole('button', { name: 'Exécuter' }))

  await waitFor(() => expect(instanceDatabases).toHaveBeenCalledTimes(2))
  expect(instanceOverview.mock.calls.length).toBeGreaterThan(lecturesInitiales)
})
