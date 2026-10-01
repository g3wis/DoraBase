import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sprite } from '../../design/icons/Sprite'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { choisirDansLaListe, optionsDeLaListe } from '../../ui/Select/pourLesTests'
import { ENGINE_ORDER, ENGINES } from './engines'
import { SSL_MODE_ORDER } from './environments'
import { NewConnection } from './NewConnection'
import { arbreDeTest, ID_DE_TEST, trioDeTest } from './pourLesTests'

/**
 * Monte l'écran **dans un dossier**, à la façon de l'application (#166) : le cadre est toujours
 * désigné par l'appelant — le menu d'une ligne de dossier. Le sous-dossier `dev` du décor migré.
 */
function monter(dossier: string | null = ID_DE_TEST.dev) {
  return render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <NewConnection onClose={() => {}} arbre={ARBRE} dossier={dossier} />
      </LanguageProvider>
    </>,
  )
}

const ARBRE = arbreDeTest(trioDeTest())

test('la modale s’annonce sous le titre du handoff', () => {
  monter()
  expect(screen.getByRole('dialog', { name: 'Nouvelle base de données' })).toBeInTheDocument()
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

test('quatre moteurs ont une icône, un a un monogramme, deux n’ont ni l’un ni l’autre', () => {
  // Vérifié sur le mockup pour ces deux derniers : le `<span>` du monogramme est absent de
  // Snowflake et BigQuery. Depuis le 27 août 2026, les quatre moteurs adaptés (`06`, `16`, `17`,
  // `18`) portent une icône dessinée plutôt qu'un monogramme texte ; Redis, sans adaptateur, garde
  // le sien faute d'icône.
  const avecIcone = ENGINE_ORDER.filter((engine) => ENGINES[engine].icon !== undefined)
  const avecMonogramme = ENGINE_ORDER.filter((engine) => ENGINES[engine].monogram !== undefined)
  expect(avecIcone).toEqual(['postgresql', 'mysql', 'sqlite', 'mongodb'])
  expect(avecMonogramme).toEqual(['redis'])
})

test('les icônes et le monogramme sont visibles, et hors du nom accessible', () => {
  monter()
  for (const engine of ENGINE_ORDER) {
    const { icon, monogram, label } = ENGINES[engine]
    if (icon) {
      const radio = screen.getByRole('radio', { name: label })
      // `use[href]` plutôt qu'un rôle : le `<svg>` de `Icon` est `aria-hidden`, donc invisible à
      // `getByRole` — c'est justement ce que la seconde moitié du test vérifie.
      expect(radio.closest('label')?.querySelector(`use[href="#i-${icon}"]`)).toBeInTheDocument()
    }
    if (monogram) expect(screen.getByText(monogram)).toBeInTheDocument()
    // Le nom accessible est le seul libellé : l'icône ou le monogramme abrège un nom déjà présent.
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
  // `prefer`, que MongoDB n'exprime pas — choisi à la main depuis que le brouillon part sur
  // `verify-full` (#87), que tous les moteurs à serveur expriment.
  await choisirDansLaListe('Mode SSL', 'prefer')
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

// --- Valeurs par défaut ---

test('le formulaire ouvre vide, pas rempli des valeurs du mockup', () => {
  monter()
  // Le mockup montre « analytics » et « db-analytics.internal » : c'est une illustration,
  // pas un état initial. Les y coller mettrait une fausse connexion sous les yeux de
  // l'utilisateur à chaque ouverture.
  expect(screen.getByLabelText('Hôte')).toHaveValue('')
  expect(screen.getByLabelText('Utilisateur')).toHaveValue('')
})

test('le dossier du cadre s’annonce en tête, par son chemin', () => {
  monter(ID_DE_TEST.staging)
  // **Le dossier désigné, et nul autre** : il n'y a plus de sélecteur, ni de projet ni
  // d'environnement — la connexion se range là d'où part le geste.
  expect(screen.getByTestId('dossier-de-la-modale')).toHaveTextContent('Atelier Nord › staging')
  expect(screen.queryByRole('group', { name: 'Environnement' })).toBeNull()
})

test('choisir un moteur amène son port', async () => {
  monter()
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
  monter()
  // Un mode que MongoDB n'exprime pas, sans quoi le report n'aurait rien à faire (#87 : le défaut,
  // `verify-full`, est offert partout).
  await choisirDansLaListe('Mode SSL', 'prefer')
  await userEvent.click(screen.getByRole('radio', { name: 'MongoDB' }))
  expect(screen.getByLabelText('Port')).toHaveValue('27017')
  expect(screen.getByRole('combobox', { name: 'Mode SSL' })).toHaveTextContent('require')
})

test('un port saisi à la main n’est pas emporté par le moteur', async () => {
  monter()
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
  monter()
  expect(screen.getByLabelText('Port')).toHaveValue('5432')
  // **Le contenu du champ, et non `toHaveValue`.** Le champ n'est plus un `<select>` : il n'a pas de
  // `value`, il affiche le libellé de l'option choisie. Ce qui compte est ce que l'utilisateur lit.
  //
  // **`verify-full`, et c'est l'exception au titre de ce test** (#87) : `prefer` était vrai dans
  // presque tous les cas parce qu'il replie en clair sans le dire. Le défaut est désormais le seul
  // mode qui authentifie le serveur ; desserrer est un geste.
  expect(screen.getByRole('combobox', { name: 'Mode SSL' })).toHaveTextContent('verify-full')
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

// --- Le cadre ---

test('le dossier ne se choisit pas dans cet écran, et la racine est un cadre valide', () => {
  monter(null)
  // **Aucun sélecteur** : en proposer un reviendrait à offrir de déplacer une connexion, geste de
  // #167 qui ne se confond pas avec la déclaration.
  expect(screen.queryByRole('combobox', { name: /Projet|Dossier/ })).toBeNull()
  expect(screen.queryByLabelText('Nom du nouveau projet')).toBeNull()
  expect(screen.getByTestId('dossier-de-la-modale')).toHaveTextContent('Racine')
  // Plus de garde « sans projet » : la racine est un endroit où enregistrer.
  expect(screen.getByRole('button', { name: /Enregistrer & ouvrir/ })).toBeEnabled()
})

// --- Pied ---

test('les trois boutons du pied sont présents', () => {
  monter()
  expect(screen.getByRole('button', { name: /Tester la connexion/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Enregistrer & ouvrir/ })).toBeInTheDocument()
})

// Un bouton désactivé sans explication ferait croire à un bug : les deux sont donc actifs.
test('« Tester » et « Enregistrer » sont actifs', () => {
  monter()
  expect(screen.getByRole('button', { name: /Tester la connexion/ })).toBeEnabled()
  expect(screen.getByRole('button', { name: /Enregistrer & ouvrir/ })).toBeEnabled()
})

test('« Annuler » ferme la modale', async () => {
  const onClose = vi.fn()
  render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <NewConnection onClose={onClose} />
      </LanguageProvider>
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
      <LanguageProvider preferences={{ language: 'fr' }}>
        <NewConnection onClose={onClose} />
      </LanguageProvider>
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
  monter()
  const attendus = [
    'PostgreSQL', // groupe de moteurs : une seule entrée
    // **Le panneau proxy / tunnel vient en deuxième** (24 août 2026) : il précède désormais le
    // formulaire, parce que le choix du proxy change les champs qui suivent. Son en-tête est un
    // bouton, donc il entre dans l'ordre de tabulation avant le formulaire.
    'Proxy / tunnel',
    // **« Nom de la base » n'est plus dans le parcours** (1er septembre 2026) : le champ est
    // parti, `name` étant désormais un identifiant technique généré, jamais saisi.
    // **« Projet » n'est plus dans le parcours** (26 août 2026) : le sélecteur est parti, le projet
    // s'annonçant en tête de la modale. Une indication n'est pas un contrôle, donc elle ne tabule pas.
    // **Le groupe « Environnement » n'est plus dans le parcours** (#166) : la connexion se range
    // dans le dossier du cadre.
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
  // `verify-full`, le mode par défaut depuis #87 : il authentifie, donc le champ est là d'emblée.
  expect(screen.getByLabelText('Certificat d’autorité')).toBeInTheDocument()

  // `prefer` chiffre si le serveur l'offre, sans authentifier.
  await choisirDansLaListe('Mode SSL', 'prefer')
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
