import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sprite } from '../../design/icons/Sprite'
import { choisirDansLaListe, optionsDeLaListe } from '../../ui/Select/pourLesTests'
import { ENGINE_ORDER, ENGINES } from './engines'
import { SSL_MODE_ORDER } from './environments'
import { NewConnection } from './NewConnection'
import { TRIO_DE_TEST } from './pourLesTests'

/**
 * Monte l'écran dans le **premier** projet de la liste, à la façon de l'application.
 *
 * **Le projet est un paramètre du cadre depuis le 26 août 2026**, plus un choix de l'écran : le
 * décor doit donc le désigner, comme le fait l'appelant réel — le menu d'un environnement, ou le
 * repli du raccourci clavier. Le déduire ici plutôt que de le répéter dans quarante appels.
 */
function monter(
  projects: readonly {
    id: string
    name: string
    environments: readonly import('../../domain/config').EnvironmentDeclaration[]
  }[] = [],
) {
  return render(
    <>
      <Sprite />
      <NewConnection onClose={() => {}} projects={projects} projet={projects.at(0)?.name ?? ''} />
    </>,
  )
}

test('la modale s’annonce sous le titre du handoff', () => {
  monter()
  expect(screen.getByRole('dialog', { name: 'Nouvelle connexion' })).toBeInTheDocument()
})

// --- Sélecteur de moteur ---

test('les sept moteurs sont là, dans l’ordre du handoff', () => {
  monter()
  const radios = screen
    .getByRole('group', { name: 'Moteur' })
    .querySelectorAll<HTMLInputElement>('input[type=radio]')
  expect([...radios].map((r) => r.value)).toEqual([...ENGINE_ORDER])
})

// L'ordre n'est ni alphabétique ni celui du type Rust : il va du plus au moins courant.
test('PostgreSQL vient en premier et est choisi par défaut', () => {
  monter()
  expect(screen.getByRole('radio', { name: 'PostgreSQL' })).toBeChecked()
})

test('deux moteurs n’ont pas de monogramme', () => {
  // Vérifié sur le mockup : le `<span>` du monogramme est absent de Snowflake et BigQuery.
  // Ce n'est pas un oubli à combler.
  const sans = ENGINE_ORDER.filter((engine) => ENGINES[engine].monogram === undefined)
  expect(sans).toEqual(['snowflake', 'bigquery'])
})

test('les cinq monogrammes sont visibles, et hors du nom accessible', () => {
  monter()
  for (const engine of ENGINE_ORDER) {
    const { monogram, label } = ENGINES[engine]
    if (monogram) expect(screen.getByText(monogram)).toBeInTheDocument()
    // Le nom accessible est le seul libellé : le monogramme abrège un nom déjà présent.
    expect(screen.getByRole('radio', { name: label })).toBeInTheDocument()
  }
})

test('choisir un moteur sans adaptateur le dit, au lieu de le masquer', async () => {
  monter()
  expect(screen.queryByText(/adaptateur/)).not.toBeInTheDocument()

  // **Redis, et non MySQL** : ce dernier a son adaptateur depuis `16`. Un test qui garde un exemple
  // devenu faux passe pour la mauvaise raison, ou échoue en accusant le mauvais code.
  await userEvent.click(screen.getByRole('radio', { name: 'Redis' }))

  // Masquer les trois moteurs restants ferait croire que le produit ne les prévoit pas ; les
  // laisser muets ferait croire que « Tester la connexion » est cassé.
  expect(screen.getByText(/Redis n’a pas encore d’adaptateur/)).toBeInTheDocument()
})

// --- Les options viennent du modèle de `05a` ---

// Le mécanisme est **à la compilation** : `ENGINES`, `ENVIRONMENTS` et `SSL_MODES` sont typés
// `Record<T, …>`, donc ajouter une variante en Rust fait échouer `tsc` jusqu'à ce qu'elle soit
// traitée. Vérifié par sabotage (ajout d'un `SslMode` en Rust → erreur TS2741). Ces tests
// vérifient le complément que le type ne dit pas : que l'écran rend bien *toutes* les options.
test('les six modes SSL du modèle sont proposés — pour PostgreSQL', async () => {
  monter()
  // **PostgreSQL est le seul à les avoir tous.** Le test disait « les six modes du modèle sont
  // proposés » sans nommer de moteur, ce qui était vrai de l'écran et faux du produit : deux
  // pilotes n'en savent exprimer que trois, et les six leur étaient offerts quand même.
  expect(await optionsDeLaListe('Mode SSL')).toEqual([...SSL_MODE_ORDER])
})

// --- La base d'authentification, pour MongoDB seul ---

// **Le cas qui n'avait aucune issue.** Un utilisateur MongoDB appartient à une base, et le pilote
// s'authentifie contre celle-là : l'utilisateur racine d'un conteneur officiel, qui vit dans
// `admin`, était injoignable dès qu'on voulait ouvrir une autre base — « authentification
// refusée » sur un formulaire où rien n'était faux. Constaté le 26 août 2026.
test('le champ « base d’authentification » n’apparaît que pour MongoDB', async () => {
  monter()
  // PostgreSQL déclare ses rôles au niveau du serveur : le champ n'aurait rien à régler, et
  // l'afficher ferait chercher à quoi il sert.
  expect(screen.queryByLabelText('Base d’authentification')).toBeNull()

  await choisirLeMoteur('MongoDB')
  expect(screen.getByLabelText('Base d’authentification')).toBeInTheDocument()

  await choisirLeMoteur('MySQL')
  expect(screen.queryByLabelText('Base d’authentification')).toBeNull()
})

// --- Les modes SSL sont ceux du moteur, et rien de plus ---

// **Le défaut retiré ici.** Les six modes étaient offerts aux sept moteurs, et les adaptateurs ne
// testaient que « le chiffrement est-il demandé » : `prefer` — la valeur *par défaut* du formulaire
// — devenait `require` pour MongoDB et MySQL. Contre un serveur sans TLS, la connexion échouait
// après cinq secondes en accusant l'hôte et le port, qui allaient bien. Un mode offert puis trahi
// est pire qu'un mode absent : l'absence se voit.
test.each([
  ['MongoDB', ['disable', 'require', 'verify-full']],
  ['MySQL', ['disable', 'require', 'verify-full']],
])('%s ne propose que les modes SSL que son pilote exprime', async (moteur, attendus) => {
  monter()
  await choisirLeMoteur(moteur)
  expect(await optionsDeLaListe('Mode SSL')).toEqual(attendus)
})

test('changer de moteur emmène le mode SSL vers le plus proche **offert**', async () => {
  monter()
  // Le brouillon part sur `prefer`, que MongoDB n'exprime pas.
  expect(screen.getByRole('combobox', { name: 'Mode SSL' })).toHaveTextContent('prefer')

  await choisirLeMoteur('MongoDB')

  // **`require` et non `disable`** : on resserre, on ne relâche pas. Descendre retirerait le
  // chiffrement d'une connexion pour laquelle il avait été demandé, sur un simple clic de moteur.
  // Et surtout la liste **l'affiche** — c'est ce qui distingue ce report d'une promotion en
  // silence, qui est exactement ce que le pilote faisait avant.
  expect(screen.getByRole('combobox', { name: 'Mode SSL' })).toHaveTextContent('require')
})

test('un mode que le nouveau moteur exprime est **gardé**', async () => {
  monter()
  await choisirDansLaListe('Mode SSL', 'disable')
  await choisirLeMoteur('MongoDB')
  // Sans cette garde, le report se lirait « changer de moteur remet le mode SSL à sa valeur la
  // plus stricte », ce qui écraserait un choix explicite.
  expect(screen.getByRole('combobox', { name: 'Mode SSL' })).toHaveTextContent('disable')
})

test('sans aucun projet, aucun environnement n’est proposé', () => {
  // **Ce test disait l'inverse, et il avait raison de son temps** : `A2` ouvrait sur « + Nouveau
  // projet… », et proposait le trio que ce projet recevrait à sa création. Depuis `24c`, cet écran ne
  // crée plus de projet : les environnements proposés sont **toujours** ceux d'un projet réellement
  // déclaré. Sans projet, il n'y a rien à proposer — et `24d` fait en sorte qu'on n'arrive plus ici
  // dans cet état.
  monter()
  const radios = screen
    .getByRole('group', { name: 'Environnement' })
    .querySelectorAll<HTMLInputElement>('input[type=radio]')
  expect([...radios]).toHaveLength(0)
})

test('les environnements proposés sont **ceux du projet choisi**', async () => {
  // La garantie de `23d` : un projet à quatre environnements en montre quatre, dont un que nulle table
  // de constantes ne connaît.
  const quatre = [
    ...TRIO_DE_TEST,
    { id: 'preprod', label: 'preprod', color: 'violet' as const, production: false },
  ]
  monter([{ id: 'print', name: 'Atelier Nord', environments: quatre }])

  const radios = screen
    .getByRole('group', { name: 'Environnement' })
    .querySelectorAll<HTMLInputElement>('input[type=radio]')
  expect([...radios].map((r) => r.value)).toEqual(['dev', 'staging', 'prod', 'preprod'])
})

// --- Valeurs par défaut ---

test('le formulaire ouvre vide, pas rempli des valeurs du mockup', () => {
  monter()
  // Le mockup montre « analytics » et « db-analytics.internal » : c'est une illustration,
  // pas un état initial. Les y coller mettrait une fausse connexion sous les yeux de
  // l'utilisateur à chaque ouverture.
  expect(screen.getByLabelText('Nom de la base')).toHaveValue('')
  expect(screen.getByLabelText('Hôte')).toHaveValue('')
  expect(screen.getByLabelText('Utilisateur')).toHaveValue('')
})

test('le projet du cadre s’annonce en tête, et l’environnement désigné est préréglé', () => {
  render(
    <>
      <Sprite />
      <NewConnection
        onClose={() => {}}
        projects={[
          { id: 'Comptoir Sud', name: 'Comptoir Sud', environments: TRIO_DE_TEST },
          { id: 'Atelier Nord', name: 'Atelier Nord', environments: TRIO_DE_TEST },
        ]}
        projet="Atelier Nord"
        environnement="staging"
      />
    </>,
  )
  // **Le second projet de la liste, et non le premier** : c'est celui que l'appelant désigne. Le
  // sélecteur qui posait le premier projet de la liste n'existe plus.
  expect(screen.getByTestId('projet-de-la-modale')).toHaveTextContent('Atelier Nord')
  // Et `staging`, non le `dev` par défaut.
  expect(screen.getByRole('radio', { name: 'staging' })).toBeChecked()
})

test('choisir un moteur amène son port', async () => {
  monter([{ id: 'print', name: 'Atelier Nord', environments: TRIO_DE_TEST }])
  await userEvent.click(screen.getByRole('radio', { name: 'MySQL' }))
  expect(screen.getByLabelText('Port')).toHaveValue('3306')
  await userEvent.click(screen.getByRole('radio', { name: 'MongoDB' }))
  expect(screen.getByLabelText('Port')).toHaveValue('27017')
})

test('un seul clic de moteur emmène le port **et** le mode SSL', async () => {
  // **L'interaction que la fusion de deux correctifs a créée.** Le port suivant et le mode SSL
  // suivant sont arrivés par deux chantiers séparés, chacun avec sa fonction et ses tests — et
  // chacun ne mesurait que son champ. Or les deux vivent dans la même transition d'état : un
  // `setDraft` qui en oublierait un laisserait l'autre juste, donc les deux suites vertes.
  //
  // Ce test tient ce que ni l'un ni l'autre ne tient : les deux effets du même clic.
  monter([{ id: 'print', name: 'Atelier Nord', environments: TRIO_DE_TEST }])
  await userEvent.click(screen.getByRole('radio', { name: 'MongoDB' }))
  expect(screen.getByLabelText('Port')).toHaveValue('27017')
  expect(screen.getByRole('combobox', { name: 'Mode SSL' })).toHaveTextContent('require')
})

test('un port saisi à la main n’est pas emporté par le moteur', async () => {
  monter([{ id: 'print', name: 'Atelier Nord', environments: TRIO_DE_TEST }])
  const port = screen.getByLabelText('Port')
  await userEvent.clear(port)
  await userEvent.type(port, '6543')
  await userEvent.click(screen.getByRole('radio', { name: 'MySQL' }))
  // Le câblage, pas la règle : `portSuivant` est testé pour lui-même dans `engines.test.ts`. Ce qui
  // se vérifie ici est que l'écran lui passe bien le moteur **précédent** — avec le nouveau, la
  // comparaison se ferait contre 3306 et le port saisi serait jeté.
  expect(screen.getByLabelText('Port')).toHaveValue('6543')
})

test('les valeurs préremplies sont celles qui sont vraies dans presque tous les cas', () => {
  // **Monté avec un projet, depuis `24c`.** Cet écran déclare une connexion *dans un projet* : sans
  // projet, il n'a aucun environnement à proposer, et ce test cherchait une radio « dev » qui
  // n'existait plus. Ce n'est pas le test qui a changé d'intention, c'est l'écran qui a cessé de
  // savoir créer un projet.
  monter([{ id: 'print', name: 'Atelier Nord', environments: TRIO_DE_TEST }])
  expect(screen.getByLabelText('Port')).toHaveValue('5432')
  // `dev` et non `prod` : ouvrir sur prod serait une invitation à l'accident.
  expect(screen.getByRole('radio', { name: 'dev' })).toBeChecked()
  // **Le contenu du champ, et non `toHaveValue`.** Le champ n'est plus un `<select>` : il n'a pas de
  // `value`, il affiche le libellé de l'option choisie. Ce qui compte est ce que l'utilisateur lit.
  expect(screen.getByRole('combobox', { name: 'Mode SSL' })).toHaveTextContent('prefer')
})

test('« Ouvrir en lecture seule » est actif, « Se reconnecter » non', () => {
  monter()
  expect(screen.getByRole('switch', { name: 'Ouvrir en lecture seule' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  expect(screen.getByRole('switch', { name: 'Se reconnecter au démarrage' })).toHaveAttribute(
    'aria-checked',
    'false',
  )
})

// --- Saisie ---

test('la saisie se voit', async () => {
  monter()
  const hote = screen.getByLabelText('Hôte')
  await userEvent.type(hote, 'db-analytics.internal')
  expect(hote).toHaveValue('db-analytics.internal')
})

test('le mot de passe est masqué, et l’œil le révèle', async () => {
  monter()
  const champ = screen.getByLabelText('Mot de passe')
  expect(champ).toHaveAttribute('type', 'password')

  await userEvent.click(screen.getByRole('button', { name: 'Afficher le mot de passe' }))
  expect(champ).toHaveAttribute('type', 'text')

  await userEvent.click(screen.getByRole('button', { name: 'Masquer le mot de passe' }))
  expect(champ).toHaveAttribute('type', 'password')
})

test('changer de moteur ne perd pas ce qui a été saisi', async () => {
  monter()
  await userEvent.type(screen.getByLabelText('Hôte'), 'db.internal')
  await userEvent.click(screen.getByRole('radio', { name: 'MySQL' }))
  // Le formulaire garde ce qui a été saisi en changeant de moteur : remettre l'état à zéro ne serait
  // qu'une perte pour l'utilisateur. **Deux moteurs de serveur** ici — SQLite masquerait le champ,
  // et le test mesurerait alors le masquage plutôt que la conservation (`17a`).
  expect(screen.getByLabelText('Hôte')).toHaveValue('db.internal')
})

// --- Projets ---

test('l’enregistrement est bloqué sans aucun projet, et le champ de création n’existe plus', () => {
  monter()
  // **`08f` avait fermé cette impasse par le sélecteur ; `24a` la ferme par un écran.** Le champ
  // « Nom du nouveau projet » n'existe plus ici, et la garde de `08e` revient : sans projet, cet
  // écran n'a rien où enregistrer. Le cas ne se produit plus dans l'application — `24d` renvoie vers
  // l'étape 1 — mais un appelant qui l'oublierait verra un refus, non un enregistrement dans le vide.
  expect(screen.queryByLabelText('Nom du nouveau projet')).toBeNull()
  expect(screen.getByRole('button', { name: /Enregistrer & ouvrir/ })).toBeDisabled()
})

test('le projet ne se choisit pas dans cet écran', () => {
  monter([
    { id: 'print', name: 'Atelier Nord', environments: TRIO_DE_TEST },
    { id: 'web', name: 'Atelier Sud', environments: TRIO_DE_TEST },
  ])
  // **Deux projets déclarés, et aucun sélecteur** (26 août 2026). En proposer un revenait à offrir de
  // déplacer une connexion d'un projet à l'autre, geste qui n'existe pas — la confirmation de
  // suppression se garde déjà de le proposer. Le projet vient de la ligne d'arbre d'où part le geste.
  expect(screen.queryByRole('combobox', { name: 'Projet' })).toBeNull()
  // Le champ de création n'est pas revenu par la porte de derrière (`24c`).
  expect(screen.queryByLabelText('Nom du nouveau projet')).not.toBeInTheDocument()
  // Et le projet du cadre est bien celui qui s'annonce.
  expect(screen.getByTestId('projet-de-la-modale')).toHaveTextContent('Atelier Nord')
})

// --- Pied ---

test('les trois boutons du pied sont présents', () => {
  monter()
  expect(screen.getByRole('button', { name: /Tester la connexion/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Enregistrer & ouvrir/ })).toBeInTheDocument()
})

// Un bouton désactivé sans explication ferait croire à un bug : les deux sont donc actifs dès
// qu'il y a un projet où enregistrer.
test('« Tester » et « Enregistrer » sont actifs quand un projet existe', () => {
  monter([{ id: 'print', name: 'Atelier Nord', environments: TRIO_DE_TEST }])
  expect(screen.getByRole('button', { name: /Tester la connexion/ })).toBeEnabled()
  expect(screen.getByRole('button', { name: /Enregistrer & ouvrir/ })).toBeEnabled()
})

// Le trou n°4 du handoff : `A2` déclare une base *dans un projet existant*, et `⌘N` y mène
// directement. Le bouton est donc désactivé, et le sélecteur le dit — plutôt que d'inventer un
// formulaire de création de projet que le mockup ne montre pas.
test('sans aucun projet, « Enregistrer » est désactivé mais « Tester » reste actif', () => {
  monter()
  expect(screen.getByRole('button', { name: /Enregistrer & ouvrir/ })).toBeDisabled()
  // Tester une connexion n'exige aucun projet : c'est justement ce qu'on veut pouvoir faire
  // avant de s'engager.
  expect(screen.getByRole('button', { name: /Tester la connexion/ })).toBeEnabled()
})

test('« Annuler » ferme la modale', async () => {
  const onClose = vi.fn()
  render(
    <>
      <Sprite />
      <NewConnection onClose={onClose} />
    </>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Annuler' }))
  expect(onClose).toHaveBeenCalledOnce()
})

test('esc ferme la modale', async () => {
  const onClose = vi.fn()
  render(
    <>
      <Sprite />
      <NewConnection onClose={onClose} />
    </>,
  )
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledOnce()
})

// --- Clavier ---

test('le focus entre sur le premier champ, pas sur la croix', () => {
  monter()
  // Le sélecteur de moteur précède le formulaire : c'est donc la radio PostgreSQL qui
  // reçoit le focus, seule du groupe à être dans l'ordre de tabulation.
  expect(screen.getByRole('radio', { name: 'PostgreSQL' })).toHaveFocus()
})

test('tout le formulaire est atteignable au clavier', async () => {
  monter([{ id: 'print', name: 'Atelier Nord', environments: TRIO_DE_TEST }])
  const attendus = [
    'PostgreSQL', // groupe de moteurs : une seule entrée
    // **Le panneau proxy / tunnel vient en deuxième** (24 août 2026) : il précède désormais le
    // formulaire, parce que le choix du proxy change les champs qui suivent. Son en-tête est un
    // bouton, donc il entre dans l'ordre de tabulation avant « Nom de la base ».
    'Proxy / tunnel',
    'Nom de la base',
    // **« Projet » n'est plus dans le parcours** (26 août 2026) : le sélecteur est parti, le projet
    // s'annonçant en tête de la modale. Une indication n'est pas un contrôle, donc elle ne tabule pas.
    'dev', // groupe d'environnements : une seule entrée
    // **« Nom du nouveau projet » n'est plus dans le parcours** (`24c`) : le champ existait sous
    // l'entrée « + Nouveau projet… » du sélecteur, et les deux sont partis avec la création depuis
    // cet écran.
    'Hôte',
    'Port',
    'Base par défaut',
    'Utilisateur',
    'Mot de passe',
  ]

  // `textContent` ne respecte pas `aria-hidden` : sur la radio PostgreSQL il rendrait
  // « PgPostgreSQL », le monogramme compris. On retire donc les descendants masqués, comme
  // le fait le calcul du nom accessible.
  function nomAccessible(element: Element | null): string | null {
    if (!element) return null
    const direct = element.getAttribute('aria-label')
    if (direct) return direct

    // **`aria-labelledby` en plus de `<label for>`.** Les listes déroulantes maison ne sont plus des
    // contrôles natifs : leur étiquette visible est un `<span>` qu'elles désignent par cet attribut,
    // et `element.labels` ne les connaît pas. Sans cette branche, le parcours au clavier trouvait un
    // nom nul là où l'écran affiche « Projet ».
    const designee = element.getAttribute('aria-labelledby')
    if (designee) return document.getElementById(designee)?.textContent?.trim() ?? null

    const etiquette =
      (element as HTMLInputElement).labels?.[0] ??
      (element.id ? document.querySelector(`label[for="${element.id}"]`) : null)
    if (!etiquette) return null

    const copie = etiquette.cloneNode(true) as HTMLElement
    for (const masque of copie.querySelectorAll('[aria-hidden="true"]')) masque.remove()
    return copie.textContent?.trim() ?? null
  }

  /**
   * Le nom d'un contrôle qui **porte son nom dans son contenu**, comme l'en-tête du panneau
   * proxy / tunnel.
   *
   * En dernier recours, et c'est important : un `<button role="radio">` du sélecteur de moteur
   * a une étiquette *et* un contenu, et prendre le contenu d'abord rendrait « PgPostgreSQL ».
   */
  function nomOuContenu(element: Element | null): string | null {
    const nom = nomAccessible(element)
    if (nom) return nom
    if (element?.tagName !== 'BUTTON') return null
    const copie = element.cloneNode(true) as HTMLElement
    for (const masque of copie.querySelectorAll('[aria-hidden="true"]')) masque.remove()
    return copie.textContent?.trim() || null
  }

  const atteints: string[] = []
  for (let i = 0; i < attendus.length; i++) {
    const nom = nomOuContenu(document.activeElement)
    if (nom) atteints.push(nom)
    await userEvent.tab()
  }

  expect(atteints).toEqual(attendus)
})

// --- SQLite : un fichier, pas un serveur (`17a`) ---

async function choisirLeMoteur(nom: string) {
  await userEvent.click(screen.getByRole('radio', { name: nom }))
}

test('choisir SQLite retire les cinq champs qui n’ont pas de sens pour un fichier', async () => {
  monter()
  // Le formulaire complet, tel qu'un serveur le demande.
  expect(screen.getByLabelText('Hôte')).toBeInTheDocument()
  expect(screen.getByLabelText('Utilisateur')).toBeInTheDocument()

  await choisirLeMoteur('SQLite')

  // **Un fichier local n'a ni hôte, ni port, ni utilisateur, ni mot de passe, ni TLS.** Les afficher
  // ferait remplir cinq champs pour rien, et laisserait croire qu'ils comptent — c'est la raison qui
  // a fait préférer masquer plutôt qu'ajouter un champ `path` vide pour six moteurs sur sept.
  expect(screen.queryByLabelText('Hôte')).toBeNull()
  expect(screen.queryByLabelText('Port')).toBeNull()
  expect(screen.queryByLabelText('Utilisateur')).toBeNull()
  expect(screen.queryByLabelText('Mot de passe')).toBeNull()
  expect(screen.queryByLabelText('Mode SSL')).toBeNull()
})

test('le champ « base par défaut » devient « fichier de la base », et garde sa donnée', async () => {
  monter()
  await userEvent.type(screen.getByLabelText('Base par défaut'), 'analytics')
  await choisirLeMoteur('SQLite')

  // **Le même champ, deux rôles.** `defaultDatabase` est déjà « la base à ouvrir », et pour SQLite
  // la base *est* un fichier : le libellé change, la donnée non. Un champ `path` distinct aurait
  // obligé `A2` à décider lequel afficher, et le modèle à porter un champ vide six fois sur sept.
  const champ = screen.getByLabelText('Fichier de la base')
  expect(champ).toHaveValue('analytics')
  expect(champ).toHaveAttribute('placeholder', '~/bases/atelier.db')
})

test('les deux bascules restent : elles ont un sens pour un fichier aussi', async () => {
  monter()
  await choisirLeMoteur('SQLite')
  // « Lecture seule » et « se reconnecter au démarrage » ne dépendent pas d'un serveur.
  expect(screen.getByRole('switch', { name: 'Ouvrir en lecture seule' })).toBeInTheDocument()
  expect(screen.getByRole('switch', { name: 'Se reconnecter au démarrage' })).toBeInTheDocument()
})

test('les quatre moteurs livrés n’affichent plus « pas encore d’adaptateur »', async () => {
  monter()
  for (const nom of ['PostgreSQL', 'MongoDB', 'SQLite', 'MySQL']) {
    await choisirLeMoteur(nom)
    expect(screen.queryByText(/n’a pas encore d’adaptateur/)).toBeNull()
  }
})

test('MySQL garde ses champs de serveur : ce n’est pas un moteur de fichier', async () => {
  monter()
  await choisirLeMoteur('MySQL')
  // Seul SQLite s'ouvre depuis un fichier (`17a`). Masquer l'hôte pour MySQL empêcherait de le
  // déclarer — le genre de généralisation qu'un `FILE_ENGINES` trop large produirait.
  expect(screen.getByLabelText('Hôte')).toBeInTheDocument()
  expect(screen.getByLabelText('Port')).toBeInTheDocument()
  expect(screen.getByLabelText('Base par défaut')).toBeInTheDocument()
})

test('un moteur sans adaptateur reste sélectionnable et le dit', async () => {
  monter()
  await choisirLeMoteur('Redis')
  // Le masquer ferait croire que le produit ne le prévoit pas ; le laisser muet ferait croire que
  // « Tester » est cassé. La règle de `08b`, toujours valable pour les quatre moteurs restants.
  expect(screen.getByText(`${ENGINES.redis.label} n’a pas encore d’adaptateur`)).toBeInTheDocument()
})

// --- Le certificat d'autorité (`06f`) ---

test('le champ d’autorité n’apparaît que pour les modes qui authentifient', async () => {
  monter()
  // `prefer`, le mode par défaut : il chiffre si le serveur l'offre, sans authentifier.
  expect(screen.queryByLabelText('Certificat d’autorité')).toBeNull()

  // Le mode SSL est un `Select`, pas un groupe de radios.
  await choisirDansLaListe('Mode SSL', 'verify-ca')
  expect(screen.getByLabelText('Certificat d’autorité')).toBeInTheDocument()

  // **`require` chiffre sans authentifier** : le champ n'y servirait à rien, et l'afficher ferait
  // croire qu'il change quelque chose. C'est « l'erreur classique » que `06b` désignait, rendue
  // visible à l'écran.
  await choisirDansLaListe('Mode SSL', 'require')
  expect(screen.queryByLabelText('Certificat d’autorité')).toBeNull()
})

test('le champ d’autorité dit ce qu’un vide veut dire', async () => {
  monter()
  await choisirDansLaListe('Mode SSL', 'verify-full')
  const champ = screen.getByLabelText('Certificat d’autorité')
  // Sans cette indication, un champ vide se lirait comme un réglage manquant plutôt que comme
  // « les autorités publiques suffisent ».
  expect(champ).toHaveAttribute('placeholder', expect.stringContaining('autorités publiques'))
})

test('un moteur de fichier n’a pas de mode SSL, donc pas d’autorité', async () => {
  monter()
  await choisirLeMoteur('SQLite')
  // Un fichier local n'a pas de transport à chiffrer (`17a`) : ni l'un ni l'autre n'a de sens.
  expect(screen.queryByLabelText('Mode SSL')).toBeNull()
  expect(screen.queryByLabelText('Certificat d’autorité')).toBeNull()
})
