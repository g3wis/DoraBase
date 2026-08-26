# AGENTS.md

Conventions de travail sur DoraBase, pour les agents comme pour les humains.

**Ce fichier est le seul document *interne* du dépôt.** Le 25 août 2026, `REPRISE.md`, `DEFAUTS.md`,
les 89 specs de `specs/`, les plans de `plans/` et le bundle de handoff `design/handoff/`
ont été retirés. Ce qui restait de vrai y était soit déjà dans le code, soit repris ici.

**Ce qui fait foi désormais** : le code, les tests, et l'application telle qu'elle tourne.
Ce fichier ne garde que ce qu'aucun des trois ne peut dire — les intentions, les
décisions et leurs raisons, les prohibitions, et ce qui reste hors de portée de
l'outillage.

**`README.md` s'est ajouté le 25 août 2026**, et le partage est net : il s'adresse à qui
**télécharge ou publie**, ce fichier à qui **écrit du code**. Le README porte donc le lien
des versions, le geste d'installation et le flux de publication ; les raisons de ces choix
restent ici. Ce qui vaut pour les deux, c'est qu'aucun des deux ne redit ce que le code dit
déjà.

**Les numéros que portent les commentaires** — `06d`, `10b`, `25a`… — sont ceux des specs
retirées. Ils ont été laissés en place : ils nomment le chantier qui a produit une
décision, et se retrouvent dans l'historique Git. Aucun fichier ne leur correspond plus.
N'en écrivez pas de nouveaux.

---

## La langue de travail

Au début de chaque session, **demander la langue de travail** en une question courte,
avant toute autre chose, puis s'y tenir. Cela vaut pour la conversation, les
explications et les questions. **Le code, les identifiants et
les noms de fichiers techniques restent en anglais** — sauf le Rust de `src-tauri/`, dont
les identifiants sont en français : le code en place fait foi, imitez-le.

Si la réponse a déjà été donnée dans la session, ne pas redemander.

**Les messages de commit sont toujours en anglais, et toujours succincts** — quelle que soit
la langue de travail de la session. Un historique se lit des années plus tard, souvent par
quelqu'un d'autre, et souvent à travers `git log --oneline` : c'est le seul texte du dépôt
dont le lecteur n'est pas choisi. Une ligne de sujet en `type(scope): ce que ça fait`, à
l'impératif, sous cinquante caractères. Le pourquoi va dans le code, dans ce fichier, ou dans
le corps du message — pas dans le sujet.

L'historique antérieur au 26 août 2026 est en français : la règle vaut pour ce qui s'écrit
maintenant, et rien n'est à réécrire.

---

## Le produit en trois phrases

DoraBase est un explorateur de bases de données desktop macOS : la densité de
l'explorateur d'IntelliJ, sans l'IDE, et plus soigné que phpMyAdmin ou pgAdmin. La stack
est **Tauri 2 + React / TypeScript / Vite**, choisie pour que les deux composants les plus
coûteux — grille dense et éditeur de code — soient déjà résolus par l'écosystème web.
Quatre moteurs répondent : PostgreSQL, MySQL / MariaDB, SQLite, MongoDB.

Dix écrans sont assemblés et atteignables : accueil, nouvelle connexion et son échec,
explorateur, visualiseur, édition inline, console SQL, console MongoDB, structure et DDL,
préférences.

---

## Le design : ce que le code ne dit pas

### L'intention

Le nom et l'identité s'inspirent de « Dora l'exploratrice » : registre écolier, papier
crème, sac à dos, carte. **Le ton reste celui d'un outil de travail dense — pas d'un
jouet.** Référence visuelle « shadcn-like » : composants classiques, bordures fines, coins
arrondis modérés, icônes **en trait** (stroke, jamais de fill).

L'application était construite à partir d'un handoff haute fidélité, respecté au pixel.
Ce handoff est retiré : **l'état actuel de l'application fait foi**. Ce qui suit est ce
qu'il portait et que le rendu ne dit pas.

### Les prohibitions — les respecter, ne pas les « corriger »

- **N'inventez aucun état de survol.** Quatre en ont un : les lignes d'arbre, les lignes de
  tableau (`--hover-row`), le bouton secondaire, et depuis le 26 août 2026 les actions de la
  bande en tête de sidebar — celles-là reprennent `--hover-row`, la teinte de la ligne d'arbre
  et de l'entrée de menu, parce qu'une icône nue sans retour au survol se lit comme une
  décoration alors qu'elle ouvre une modale. Un survol **ailleurs**, ou avec une valeur qui
  n'est pas déjà un jeton, serait une invention. La galerie l'affiche franchement ; ce n'est
  pas un oubli.
- **Aucune couleur littérale hors `src/design/tokens.json`.** Garde-fou : `pnpm tokens:check`.
- **L'échelle d'espacement n'a pas de 8 px** : 3, 5, 6, 7, 9, 11, 14, 16. Un littéral
  commenté vaut mieux qu'un jeton approximatif choisi « parce que ça se ressemble ».
- **Les raccourcis affichés sont à opacité `.6`**, une valeur représentative — la source
  variait `.5`/`.6`/`.7` selon l'instance, et trois props ne valaient pas ce gain.
- **Pas de composant natif** pour les listes déroulantes : la liste maison partout.
- **Un `var()` vers un jeton inexistant ne casse rien de visible** — ni TypeScript, ni
  Vitest, ni l'œil. Vérifiez qu'un jeton existe avant de l'employer.

### Les arbitrages, avec leur raison

- **Grisé plutôt que masqué, quand la valeur existe mais n'est pas saisie.** Le port et le
  mot de passe derrière un proxy Cloud SQL sont grisés avec un `title` qui dit pourquoi :
  les faire disparaître dirait que la connexion n'a ni port ni mot de passe, alors qu'elle
  a les deux. **Masqué** est le bon choix à l'inverse pour les cinq champs qu'un moteur de
  fichier (SQLite) n'a réellement pas.
- **Un bouton inerte mais actif fait croire à un bug — davantage qu'un bouton désactivé.**
  Quand un écran entier est inerte, désactiver avec une infobulle qui nomme ce qui manque.
  Quand un seul bouton l'est et que sa suite arrive, le laisser actif. Les deux arbitrages
  coexistent, et c'est délibéré.
- **La jointure de deux panneaux est un trait, pas une zone.** 1 px de `--divider` en
  permanence, 3 px assombris au survol et au focus. La zone de saisie garde 5 px : ce
  qu'on voit et ce qu'on peut attraper sont deux mesures différentes. Une jointure n'a
  rien à dire — elle sépare.
- **Une seule colonne de droite**, dont le contenu suit l'écran. La barre d'état court
  **sous** les trois colonnes : elle vit au niveau de l'écran, pas du centre.
- **La sidebar a la même largeur partout**, y compris devant l'explorateur : une coquille
  unique ne peut pas être deux largeurs, et la colonne sauterait à l'ouverture d'un
  onglet. Elle prend la largeur de son `SplitPane` au lieu de l'imposer — sinon la poignée
  ne déplacerait rien. Un mockup figé ne peut pas exprimer un panneau que l'utilisateur
  déplace ; c'est la raison de tous les écarts de cote restants.
- **Aucune modale ne nomme un objet à sa création.** Une console prend « console N », le
  plus petit numéro libre. Nommer avant d'avoir écrit revient à demander un titre pour une
  page blanche. Le renommage se fait **sur place**, au double-clic, sur la ligne d'arbre
  comme sur l'onglet : `Entrée` valide, `Échap` abandonne, la perte de focus valide.
  L'entrée « Renommer… » du menu « … » subsiste — un geste qui n'existe qu'au double-clic
  est invisible et inatteignable au clavier.
- **Le projet est le *cadre* de la modale de connexion, pas un de ses champs** (26 août 2026).
  Il s'annonce dans la bande d'en-tête, à droite du titre, et ne se choisit nulle part : le
  triplet `projet/base/environnement` est la clé du registre et la référence du secret, donc un
  sélecteur y proposait un geste qui **n'existe pas** — déplacer une connexion d'un projet à
  l'autre. Corollaire : le geste de création part du **palier qui connaît son contexte** — le
  menu d'une ligne d'environnement —, comme la création de console part du menu d'une connexion.
  Le pied de la sidebar est parti pour la même raison : il devait deviner, et se trompait dès que
  deux projets étaient dépliés. Ce qu'il portait encore, « Nouveau projet », est monté dans une
  bande d'icônes en tête, où 35 px remplacent ses 78 px pris sur la hauteur de l'arbre.
- **Le port prérempli appartient au moteur, pas au formulaire** — voir le tableau des quatre
  moteurs. Un port **saisi à la main** survit au changement de moteur, le défaut de l'autre
  moteur non : le champ est saisissable parce qu'un serveur peut n'être pas sur le port usuel.
- **Le pincement du trackpad ne zoome pas** (26 août 2026). Il se déclenche tout seul en
  glissant deux doigts pour défiler une grille, et l'interface changeait d'échelle sans que
  personne l'ait demandé. Le refus est **actif** (`preventDefault` sur `wheel` + `ctrlKey`) :
  s'abstenir laisserait la webview appliquer son propre pas, de dix à vingt-cinq pour cent.
  `⌘` + molette reste, à pas fin, et `⌘0` revient à l'origine.
- **`esc` dans un champ rend le focus, il ne ferme pas la modale.** Un second `esc` ferme ;
  depuis un bouton, la fermeture est immédiate — il n'y a pas de saisie à abandonner.
- **Aucune correction automatique dans les champs.** macOS transformait `localhost` en
  `Localhost` et le nom qu'on tapait dans un champ de renommage. Les quatre attributs
  vivent dans `Field` et doivent être réemployés par toute saisie qui n'y passe pas.

### La règle « ligne liée »

Pour une clé étrangère, n'afficher l'aperçu de la ligne cible que si elle contient au
moins un champ lisible par un humain — liste blanche insensible à la casse : `email`,
`name`, `label`, `title`, `first_name`/`firstName`, `last_name`/`lastName`, `username`,
`slug`, `code`, `reference`. Sinon, ne rien afficher : pas de dump d'identifiants
techniques. Mentionner les champs détectés en légende.

### Accessibilité — quatre pièges qui se sont répétés

1. **Le nom accessible se concatène sans espace.** « Tables8 », « orders1.9 M » : quatre
   occurrences. Dès qu'un composant place deux contenus côte à côte, l'espace doit être
   **explicite**, et dans le composant — pas chez l'appelant.
2. **`aria-label` sur un élément sans rôle est ignoré** — trois occurrences, Biome le
   signale à chaque fois et a raison à chaque fois. Quand un élément est la décoration
   d'un contrôle, l'information va dans le **nom du contrôle**, par du texte masqué en
   `clip-path` — jamais `display: none`, qui le retirerait de l'arbre d'accessibilité.
   L'ordre de ce texte décide de l'ordre de lecture : le placer en dernier.
3. **`aria-disabled` plutôt que `disabled` quand un bouton porte une explication.** Un
   `<button disabled>` ne reçoit ni focus ni survol : son infobulle serait inatteignable,
   exactement là où elle est le plus utile.
4. **Une infobulle *décrit*, elle ne *nomme* pas** : `aria-describedby`, jamais
   `aria-label`, qui ferait s'annoncer le contrôle par sa limite plutôt que par sa
   fonction.

**Les assertions de test passent par `getByRole` avec nom accessible**, et le motif doit
être **ancré** : `/orders/` compte aussi `orders_by_day`. Biome n'a aucune règle de nom
accessible — ces tests sont le seul garde-fou du projet sur ce point.

---

## Décisions prises, et pourquoi

Celles qu'il ne faut pas rejouer — sans leur raison, elles seront défaites.

**Tauri 2 plutôt que Kotlin.** La demande initiale était « Kotlin, multiplateforme, sans
runtime Java » : cette combinaison n'existe pas sous forme viable — Compose for Desktop
n'existe que sur JVM, et il n'y a pas de toolkit UI Kotlin/Native mature.

**Plancher macOS 13 Ventura, soit Safari 16.4**, pour que `oklch()` et
`color-mix(in oklab, …)` soient couverts. `build.target`, `build.cssTarget` et
`bundle.macOS.minimumSystemVersion` doivent rester alignés.

**Aucun jeu de résultats complet ne traverse l'IPC.** Le cœur Rust détient les résultats ;
la webview ne reçoit que la fenêtre visible. La **récupération** est paginée, pas seulement
le rendu. C'est ce qui garde l'empreinte mémoire plate quelle que soit la table, et le
principal mode de défaillance à éviter dans un client de bases écrit en Tauri. La
contrainte est portée par un type : `RowLimit` est une énumération fermée (100 / 500 /
1000 / 5000) — « demander tout » n'est pas exprimable. Et aucune commande ne rend « tout
le catalogue ».

**Une seule identité pour une connexion** : `projet/base/environnement`. C'est à la fois
la clé du registre et la référence du secret dans le Trousseau. Deux conventions
divergeraient. Corollaire : **l'identifiant d'un environnement est figé à sa création** —
le renommer change son **libellé seulement**, et installe une divergence assumée entre ce
qui s'affiche et ce qui désigne.

**L'arbre se lit sans réseau.** La configuration ne demande aucune connexion : l'arbre
s'affiche immédiatement et chaque base porte son état. Une base injoignable reste
**visible et marquée**, jamais masquée ni bloquante — attendre les connexions bloquerait
l'écran jusqu'à 30 secondes sur un seul hôte muet. Conséquence : les états sont **quatre**,
pas deux, et « jamais tentée » n'est pas « hors ligne ».

**Un filtre et un tri partent au serveur**, ils ne trient pas la fenêtre reçue. Filtrer
cinq cents lignes déjà lues serait immédiat et faux : l'utilisateur croirait voir toutes
les lignes qui correspondent. Les tests portent donc sur la **requête envoyée**.

**Le stockage des identifiants est abstrait derrière une interface** : Trousseau en release
signée, fichier chiffré en développement. Les ACL du Trousseau sont liées à la signature
de code, et une signature ad-hoc change à chaque build. L'abstraction est de toute façon
nécessaire, Windows et Linux n'ayant pas de Trousseau.

**L'environnement est un palier de l'arbre**, pas un réglage global : projet →
environnement → connexion → console|schéma → objet. Un sélecteur global obligeait à
basculer un réglage pour regarder une connexion voisine, et refaisait de l'environnement
une propriété du **projet** là où c'est une propriété de la **connexion**. La barre de
titre n'est plus qu'un **indicateur passif**. Conséquence à ne pas perdre : **les
identités de nœud portent l'environnement** — six défauts sont nés de garanties adossées à
ce que l'écran *montrait*, dont deux qui lisaient franchement le mauvais serveur.

**Clé d'hôte SSH vérifiée contre `~/.ssh/known_hosts`**, hôte inconnu refusé avec un
message qui donne la manœuvre. Quatre verdicts distincts là où `russh` n'en offre que
deux. **L'écran de confiance à la première connexion serait la vraie réponse** — il reste
à faire.

**Le binaire `cloud-sql-proxy` est embarqué dans le bundle, et l'embarqué gagne contre le
`PATH`.** Version épinglée dans `src-tauri/cloud-sql-proxy.lock`, empreinte SHA-256
vérifiée par `scripts/telecharger-proxy.sh`, binaire jamais commis. Si le `PATH` passait
devant, le comportement dépendrait de ce que l'utilisateur a installé, et un proxy d'une
autre version pourrait écrire des journaux que la détection de disponibilité ne reconnaît
pas. Le `PATH` reste en repli pour `cargo run`/`cargo test`, sans sidecar.

**L'authentification passe par les identifiants par défaut de l'application (ADC), et
`--gcloud-auth` est écarté** : il exigerait `gcloud` dans le `PATH` du sous-processus —
celui d'une app lancée depuis le Finder est minimal. Embarquer le binaire supprimait une
dépendance au `PATH` ; `--gcloud-auth` en réintroduirait une, plus fragile, pour économiser
un login unique.

> **Jamais « authentifiez-vous avec gcloud ».** `gcloud auth login` et
> `gcloud auth application-default login` se ressemblent, ouvrent toutes deux un
> navigateur, et **seule la seconde** écrit le fichier que les bibliothèques clientes
> lisent. Un message doit porter la ligne à copier, et dire que l'autre ne suffit pas.

**Une seule voie d'authentification Cloud SQL** : le champ « Compte de service » a été
retiré. Deux voies obligeaient à choisir laquelle explique un échec, et la voie saisie
était la moins employée tout en étant la seule à devoir être persistée, migrée, projetée
et traduite entre `''` et `null`. `GOOGLE_APPLICATION_CREDENTIALS` reste lue par le proxy
sans qu'on la lui passe : **le champ est fermé, pas la voie.**

**L'authentification IAM n'a pas de bascule, elle est toujours active.** Un interrupteur
dont une position n'est jamais choisie coûte un champ persisté, une conversion, un état
d'écran et deux chemins à tester. Piège associé : `tokio-postgres` échoue **avant tout
échange** si le serveur réclame un mot de passe et qu'aucun n'a été configuré —
l'application configure donc une chaîne **vide**, comme `psql` où l'on valide l'invite
sans rien saisir ; un secret enregistré gagne toujours.

**Un mode SSL qu'un pilote ne sait pas exprimer n'est pas offert — et il est refusé s'il arrive
quand même.** Les six modes étaient proposés pour les sept moteurs, et les adaptateurs ne
testaient que « le chiffrement est-il demandé » : `allow` et `prefer` — « TLS si le serveur
l'offre, clair en repli » — devenaient donc `require` pour MongoDB et MySQL, sans que rien le
dise. Or `prefer` est la valeur **par défaut** du formulaire : contre un `mongod` local sans TLS,
le test échouait après cinq secondes sur « vérifiez l'hôte, le port », qui accuse ce qui va bien
(mesuré le 26 août 2026). La négociation est une propriété du **protocole**, et seul PostgreSQL
l'a — `tokio-postgres` porte un `PgSslMode::Prefer` qui replie vraiment ; les deux autres pilotes
ne reçoivent qu'un drapeau. Deux conséquences à ne pas défaire :

- la liste déroulante est **par moteur** (`SSL_MODES_PAR_MOTEUR`) : PostgreSQL a les six,
  MongoDB et MySQL en ont trois (`disable`, `require`, `verify-full`), SQLite aucun. Un mode
  absent se voit ; un mode remplacé en silence ne se voit jamais ;
- changer de moteur reporte le mode en place vers le plus proche **offert, vers le haut** —
  `prefer` devient `require`, jamais `disable`. Ce n'est pas une promotion silencieuse pour la
  seule raison qui compte : la liste **affiche** le nouveau mode. Descendre relâcherait un
  réglage de sécurité sur un clic de moteur.

Et le refus côté Rust est ce qui tient quand la configuration ne vient pas de l'écran — un
fichier écrit à la main, ou enregistré par une version antérieure. **L'écran qui cache et le
moteur qui refuse ne sont pas une redondance** : ils gardent deux chemins différents.

**MongoDB s'authentifie contre la base déclarée, et un champ existe pour dire laquelle.** La
décision d'origine — « la base déclarée, jamais `admin` » — était juste et le reste : un
utilisateur MongoDB appartient à une base, et supposer `admin` ferait échouer tous ceux qui sont
déclarés dans la leur. Ce qui manquait était le **cas inverse, sans issue** : l'utilisateur racine
que l'image Docker officielle crée (`MONGO_INITDB_ROOT_USERNAME`) vit dans `admin`, donc vouloir
ouvrir une autre base le rendait injoignable — « SCRAM failure: Authentication failed » sur un
formulaire où rien n'était faux. Mesuré le 26 août 2026 contre un `mongo:8`.

`auth_database` est donc `Option<String>`, `#[serde(default)]` — un champ **ajouté** ne demande pas
de cran de migration —, et vide il ne change rien. Trois points à ne pas défaire :

- **le champ n'apparaît que pour MongoDB** (`ENGINES_A_BASE_D_AUTHENTIFICATION`) : PostgreSQL et
  MySQL déclarent leurs rôles au niveau du serveur, donc il n'y aurait rien à régler, et
  l'afficher ferait chercher à quoi il sert ;
- **une valeur vide ou blanche vaut absente**, côté Rust comme côté écran. L'écran envoie `null`,
  mais un fichier écrit à la main peut porter `""` — et `.source("")` échouerait sur une base qui
  n'existe pas, avec le message le moins utile possible ;
- le défaut reste la base déclarée, donc **rien ne bouge** pour les configurations existantes.

**Et le champ est préremplié à `admin` sur un brouillon neuf** (26 août 2026, à la demande, après
essai). Le critère du projet pour préremplir est « vrai pour la quasi-totalité des cas » — celui du
port 22 d'un bastion —, et un utilisateur MongoDB vit dans `admin` presque toujours. **Ce n'est pas
le défaut que `18b` avait refusé** : la valeur est *dans le champ*, donc visible et effaçable, et
c'est toute la différence. Vidé, le comportement de `18b` revient. Deux garde-fous à ne pas perdre :
le préremplissage ne vaut que pour un brouillon **neuf** — reprendre une connexion enregistrée sans
base d'authentification laisse le champ vide, sinon le premier enregistrement changerait une
connexion qui marche —, et ce que l'écran **envoie** est filtré par moteur
(`baseDAuthentificationAEnvoyer`), sans quoi chaque connexion PostgreSQL persisterait un `admin` que
rien ne lit.

**Convention Rust à 4 espaces**, pas de `rustfmt.toml` alignant Rust sur le JS du projet.

### La publication : un tag, et rien d'autre

**Le tag est le déclencheur, le commit ne l'est pas.** `ci.yml` tourne sur chaque push et
chaque PR ; `publication.yml` ne tourne que sur un tag `vX.Y.Z`, motif **ancré** sur les
trois nombres. Une release est un geste, pas un effet de bord d'un push — et un motif large
(`v*`) accepterait `v1.2` ou `v0.1.0-essai`, dont le nom de bundle n'a été décidé par
personne. Le format de version est fermé pour la même raison : un suffixe de pré-version
traverserait `Info.plist`, le nom du `.dmg` et le nom du tag sans que quiconque ait tranché
ce qu'il y devient.

**Le numéro de version vit à trois endroits qui ne se parlent pas** : `package.json` — le
seul que `tauri.conf.json` lise, donc celui qui finit dans l'`Info.plist` et dans le nom du
`.dmg` —, `src-tauri/Cargo.toml` et `src-tauri/Cargo.lock`. Rien dans l'outillage ne les
relie : relevés à la main dans deux fichiers sur trois, ils laissent la CI verte et publient
un `.dmg` dont le nom contredit son `Info.plist`. D'où `scripts/version.sh`, qui les écrit
d'un geste, et `scripts/verifier-version.py`, qui refuse la divergence — appelé par
`verifier-tout.sh`, par la CI, par le script de relèvement sur sa propre sortie, et par le
workflow de publication **avec le numéro du tag en argument**.

**Le bundle publié est universel.** `--target universal-apple-darwin`, donc les deux
architectures du proxy **et leur fusion** (`pnpm proxy:embarquer:tous`, qui appelle `lipo` —
Tauri, lui, ne fond rien) et les deux cibles rustup. Deux fichiers
séparés obligeraient l'utilisateur à savoir quel Mac il a, question à laquelle un explorateur
de bases de données n'a pas à faire répondre. Conséquence à ne pas perdre : `lipo` **invalide
les signatures** des tranches qu'il fusionne, et une étape vérifie que les deux architectures
sont bien là — une cible mal nommée produirait un bundle mono-architecture au chemin attendu,
publié sous le nom « universal ».

**`"signingIdentity": "-"` dans `tauri.conf.json`** — signature ad hoc, posée par Tauri
**avant** la fabrication du `.dmg`, donc au bon moment. JSON n'accepte pas de commentaire :
la raison est ici. Sans elle, le bundle universel n'est pas signé du tout et macOS le refuse
sur toute machine autre que celle qui l'a construit — un exécutable **embarqué** non signé le
fait refuser à coup sûr. Ce n'est pas une notarisation : l'utilisateur garde un geste au
premier lancement, et le README le dit franchement plutôt que de laisser croire à une
application cassée.

**Le Developer ID est acheté, et la notarisation est dans la chaîne de publication** — depuis
la 0.1.5, une version publiée s'installe en double-cliquant. Six secrets `APPLE_*`, et Tauri
signe, soumet, attend le verdict et agrafe. Trois choses apprises en le faisant, dont deux qui
étaient des craintes ouvertes de ce fichier :

- **le binaire embarqué reçoit le *hardened runtime* et l'identité** (`flags=0x10000(runtime)`,
  `Authority=Developer ID Application`). La crainte que la notarisation bute sur le sidecar
  était sans objet ;
- **Tauri notarie l'application, il ne notarie pas l'image.** Il la *signe*, ce qui trompe :
  `stapler validate` sur le `.dmg` répond « does not have a ticket stapled to it » pendant que
  l'application est acceptée. Or c'est l'image que l'utilisateur télécharge, donc elle que macOS
  met en quarantaine et évalue. D'où une étape de soumission explicite, et un verdict lu dans la
  **sortie** de `notarytool` plutôt que dans son code de retour — `--wait` rend la main quand le
  traitement s'achève, ce qui n'est pas la même chose que l'avoir accepté ;
- **tout le bloc est conditionnel** à la présence des secrets, et `"signingIdentity": "-"` reste
  dans `tauri.conf.json`. Sans certificat — un clone, un fork, une bifurcation —, la
  construction reste celle d'avant. Une étape retire la clef de la *copie de travail du runner*
  plutôt que de parier sur une précédence entre la conf et l'environnement que rien ne documente.

**Un secret vide vaut la chaîne vide, et se paie en minutes.** `APPLE_ISSUER_ID` (le nom du
secret) contre `APPLE_API_ISSUER` (la variable que Tauri lit) : la publication a passé un
`--issuer ''` à `notarytool` et échoué **après** la signature, donc après vingt minutes, sur un
message qui ne nommait pas le secret fautif. Les cinq secrets sont donc contrôlés avant de
compiler — présence, puis forme : un Issuer ID est un UUID, un Key ID fait dix caractères, une
identité commence par « Developer ID Application: ». Les deux premiers vivent dans le même écran
d'App Store Connect ; les échanger est l'erreur naturelle, et c'est celle que le message nomme.

### La mise à jour en place

**Le plugin `updater` est enregistré pour son API Rust, et n'ouvre aucune permission.** Deux
commandes maison — `check_update`, `install_update` — remplacent les quatre du plugin plus
`process:allow-restart`, et `capabilities/default.json` n'a pas bougé : les capacités ne
gouvernent que l'IPC venant de la webview, donc le Rust n'a besoin d'aucune. Conséquence à ne
pas perdre : **le front ne sait ni télécharger ni redémarrer**, il sait qu'une version existe
et il sait la demander. Corollaire pratique : la CSP n'est pas concernée, la requête ne partant
pas de la webview.

**Deux signatures, deux questions distinctes.** Apple décide si macOS *ouvre* l'application ;
la clé minisign du projet décide si une application déjà installée accepte de se *remplacer*
par ce qu'on lui envoie. La seconde est **irremplaçable** : sa moitié publique est dans
`tauri.conf.json`, donc dans le bundle que les utilisateurs ont déjà. La perdre coupe la voie
de mise à jour de toutes les installations existantes, sans rattrapage possible.

**Rien n'est proposé qui n'ait été notarié.** Le manifeste et l'archive ne sont attachés à la
release que si les secrets Apple étaient là. Une archive ad hoc — un fork, une bifurcation —
s'installerait proprement puis serait refusée par macOS au redémarrage, chez des gens qui
n'avaient rien demandé et qui n'ont plus de voie de retour. C'est le même arbitrage que
`signingIdentity: "-"`, poussé un cran plus loin : sans certificat, la construction reste
possible, la **distribution** de mises à jour non.

**`--latest` cesse d'être cosmétique.** Les applications installées lisent
`…/releases/latest/download/latest.json`, une URL qui ne nomme aucune version : c'est GitHub
qui la redirige vers l'asset de la release marquée « latest ». Sans le drapeau, plus personne
ne trouve de mise à jour. Et les URL *dans* le manifeste sont épinglées au tag, à l'inverse :
il annonce une version, il doit désigner l'archive de cette version.

**Les deux architectures pointent sur la même archive**, qui est universelle. Tauri cherche la
sienne par `{plateforme}-{architecture}` et ne connaît pas la notion d'universel : le manifeste
doit donc porter `darwin-aarch64` **et** `darwin-x86_64` sur la même URL.

**Pas de `pub_date` dans le manifeste.** Le champ est optionnel et n'est affiché nulle part,
mais il est typé côté Tauri : une date mal formée ne rend pas le manifeste incomplet, elle le
rend *illisible* — donc coupe la mise à jour pour tout le monde. Un champ décoratif ne mérite
pas ce mode de défaillance.

**Une clé jetable en CI, régénérée à chaque tour.** Depuis `createUpdaterArtifacts`, tout
`tauri build` échoue s'il trouve une clé publique sans clé privée en face — donc `ci.yml` ne
compilait plus. Retirer la clé de la copie de travail aurait fait cesser à la CI d'exercer le
chemin qui produit l'archive, et sa première exécution aurait été une publication ; donner le
vrai secret au job aurait rendu la CI rouge sur toute PR venue d'un fork. Une paire jetée
exerce le chemin complet sans secret, et Tauri **dit** que la clé ne correspond pas à la
publique — en avertissement, pas en erreur, ce qui est exactement le fait voulu.

**Trois formes de variable mesurées, les trois fausses au premier essai** :
`TAURI_SIGNING_PRIVATE_KEY` veut le **contenu** de la clé et décode sa valeur en base64 sans
regarder si c'est un fichier ; `TAURI_SIGNING_PRIVATE_KEY_PATH`, qui prend bien un chemin, n'est
lu que par la commande `tauri signer` et **pas par le bundler** ; et la variable de mot de passe
doit être **posée même vide**, faute de quoi la CLI la demande à l'invite et échoue sur un
runner sans terminal, avec un message qui parle de mot de passe incorrect plutôt que de
variable absente.

**L'archive de mise à jour porte un second exemplaire de l'application, et il est vérifié
plutôt que déduit.** Tauri la fabrique après la notarisation — l'ordre des étapes le dit, et la
sortie de `tauri build` le confirme — mais l'erreur serait invisible jusqu'à ce qu'un
utilisateur déjà installé se retrouve avec une application que macOS refuse, sans plus aucune
voie de retour. Le workflow ouvre donc l'archive et demande à `stapler` et `codesign`. C'est
exactement le piège de la notarisation de l'image, à l'étage suivant.

**Aucune recherche périodique, aucune installation automatique.** Une fois au démarrage, et
l'installation attend un clic. Une session dure l'après-midi : une requête toutes les heures ne
ferait qu'annoncer plus tôt une release que le redémarrage suivant aurait trouvée de toute
façon.

**L'annonce vit dans la barre d'état, et ne rend rien par défaut.** Une mise à jour n'est pas un
événement — elle attend, et un bandeau qui prend une bande de l'écran pour attendre coûte plus
que ce qu'il annonce. Propriété qui en découle et qu'il faut garder : hors de la webview
(galerie, `?demo`, tout Playwright) la recherche est rejetée, l'état reste nul, le composant ne
rend rien — donc **aucune capture de fidélité ne bouge et il n'y a pas de variante de décor à
maintenir**. Le silence sur rejet est le comportement voulu, pas un oubli.

**`install_update` ne rend jamais `Ok`** : au succès, le processus est remplacé. Une promesse
qui se résout est donc un **échec**, et l'écran le traite comme tel — sans quoi le bouton
resterait sur « Téléchargement… » indéfiniment, ce qui est le pire des deux messages possibles.

**Le piège vérifié plutôt que supposé** : le plugin amène `reqwest`, donc un second usage de
`rustls` — et deux fournisseurs cryptographiques dans le même binaire font *paniquer*
`ClientConfig::builder()` à l'exécution, là où `engine/tls.rs` l'appelle sans fournisseur
explicite. La panne serait apparue à la première connexion TLS, pas à la compilation.
`cargo tree -e features` dit que ce n'est pas le cas : `reqwest` prend `rustls-no-provider`, la
seule feature de fournisseur activée sur `rustls` reste `ring`, et l'`aws-lc-rs` du graphe vient
de `russh` — il y était déjà. Le jour où une dépendance activerait `aws_lc_rs` sur `rustls`, il
faudra passer le plugin en `native-tls`.

**Les vérifications rapides sont rejouées dans le job de publication** — sabotage, typecheck,
lint, Vitest, `cargo test`. Le tag est censé être posé sur un `main` vert, et le script refuse
de le poser ailleurs ; mais « censé » n'est pas une vérification, et une release est publique.
Playwright et les tests sur base réelle restent dans `ci.yml` : ils demandent un serveur et
quatre décors, et ce job n'a pas à les remonter une seconde fois.

**Un artefact de CI n'est pas une version.** Chaque commit rend son `.dmg` en artefact, gardé
sept jours — sans quoi essayer un commit demandait de le compiler soi-même, alors que
« est-ce que ça se lance ? » ne se tranche qu'en lançant et que Playwright ne pilote pas
WKWebView. Il est **mono-architecture** et réservé aux comptes qui ont accès au dépôt. Et
c'est le `.dmg` seul qui est rendu, pas le `.app` : `upload-artifact` réempaquette dans un zip
qui perd les bits d'exécution et les liens symboliques du bundle, et un `.app` ainsi
transporté ne se lance pas. Le `.dmg` est une image opaque, il traverse intact.

**La fenêtre du volume est habillée, et c'est une image plus des coordonnées.** Le `.dmg`
s'ouvre sur un décor peint et une carte qui dit le geste — glisser l'application sur
`Applications`. Rien de tout cela n'est du code : `bundle.macOS.dmg` porte le fond, la taille
de fenêtre et la position des deux icônes, et le Finder fait le reste. Quatre décisions à ne
pas rejouer :

- **aucun numéro de version dans l'image.** Le volume le porte déjà dans son nom ; le remettre
  dans un bitmap ferait dépendre chaque relèvement d'un Chromium, et une image oubliée
  annoncerait la version précédente pendant toute la vie de la suivante. L'image dit
  « universel », et `scripts/verifier-fond-dmg.sh` refuse une source qui porte trois nombres.
- **le fond est un TIFF multi-résolution**, `fond-dmg.tiff`, fondu par `tiffutil` depuis les
  deux PNG. macOS ne lit pas la convention `@2x` dans un `.DS_Store` : un PNG 1× serait flou
  sur Retina, un PNG 2× deux fois trop grand. Les trois fichiers sont committés — régénérer
  demande un navigateur, ce que le workflow de publication n'a pas à exiger pour poser un tag.
- **la source est `src-tauri/dmg/fond-dmg.html`**, rendue par `pnpm dmg:fond`. C'est du HTML
  parce que le décor est du SVG filtré et les textes des jetons de `tokens.css` : le décrire
  ailleurs qu'en page web aurait voulu dire le redessiner.
- **les deux emplacements d'icônes restent vides dans l'image.** Le Finder y dessine l'icône
  *et* le libellé, en police système ; l'alias `Applications` reçoit l'icône de dossier
  d'Apple, qu'on ne cherche pas à remplacer. Et ces icônes font **128 pt**, pas les 96 du
  handoff : la taille n'est exposée par aucune clef de configuration, le bundler la fixe en
  dur. C'est la composition qui a cédé — les deux lignes mono sont descendues sous le libellé.
  La reprendre par l'autre bout demanderait de poser le `.DS_Store` soi-même, donc de rouvrir
  en écriture une image que Tauri vient de compresser en lecture seule.

**`TAURI_BUNDLER_DMG_IGNORE_CI` décide de ce que voit l'utilisateur.** Le bundler DMG ajoute
`--skip-jenkins` dès qu'il voit `CI` dans l'environnement, et ce drapeau saute **tout**
l'AppleScript de mise en fenêtre : fond, taille, positions. Rien n'échoue, rien ne l'annonce —
le `.dmg` se construit, se signe, se notarie et se publie, dépouillé. La variable est donc
posée dans les deux workflows, `verifier-ci.py` en constate la présence dans l'`env:` des deux
`tauri build`, et `scripts/verifier-dmg-monte.sh` monte l'image construite pour regarder ce
qu'elle porte vraiment. C'est le seul réglage du dépôt dont l'oubli serait invisible partout
sauf chez qui télécharge.

**Baloo 2 restreinte au latin, Nunito et JetBrains Mono complètes.** Le critère n'est pas
« ce sous-ensemble sert-il » mais « cette police rend-elle des données arbitraires ».
Baloo 2 ne porte que du chrome applicatif. Les polices sont **embarquées**, jamais
chargées en ligne.

**Aucune ressource réseau.** La CSP le fait respecter structurellement. `blob:` n'est pas
autorisé — un export par `URL.createObjectURL` sera bloqué. Ne pas élargir la CSP par
anticipation : traiter l'écriture côté Rust.

### La migration du format de configuration

`VERSION_COURANTE` vaut **5**. Les crans successifs sont des passes sur du
`serde_json::Value`, sans type d'ancienne forme à maintenir — c'est pourquoi `migrer` et
les migrations vivent encore dans `config/store.rs` malgré sa taille. **Le déclencheur du
découpage** : la prochaine migration qui demande un `mod vN` de types dédiés. Ce jour-là,
deux d'entre eux cohabiteront, et c'est cette cohabitation — pas le compte de lignes — qui
justifiera le fichier séparé. Deux crans de suite l'ont manqué pour la même raison.

**Ne retirez pas `mod v1`** : la migration v1 → v2 s'en sert pour *déduire les
environnements déclarés*. Un projet dont la seule trace d'un environnement était d'y être
actif perdrait sa déclaration.

**Un champ ajouté avec `#[serde(default)]` ne demande aucun cran** ; un champ **retiré**
en demande un. Et un champ conservé puis vidé (plutôt que supprimé du modèle) est la seule
manière de reprendre des données sans que `serde` les efface en silence.

---

## Acquis techniques — établis par exécution

- **Les capacités Tauri ne gouvernent que les appels IPC venant de la webview.** Elles ne
  restreignent pas ce que fait le code Rust : un menu natif complet s'installe sans la
  permission `core:menu`, et une commande définie par l'app fonctionne sans entrée dans
  `capabilities/default.json`.
- **`core:window:default` n'accorde aucune permission d'écriture** — 0 des 42 disponibles.
  La lecture de géométrie passe, `set_size` est refusé.
- **`data-tauri-drag-region` nu ne rend glissable que l'élément lui-même**, pas son
  sous-arbre. La valeur **`deep`** étend le glissement, et les éléments cliquables le
  bloquent d'eux-mêmes. Nécessite `core:window:allow-start-dragging`.
- **Un panneau flottant ancré dans le flux est rogné par le premier ancêtre en
  `overflow: hidden`.** C'est le défaut n° 35, et il s'est reproduit sur la liste déroulante : la
  coquille de `Modal` porte un `overflow: hidden` pour ses coins arrondis, et le « Mode SSL » de
  `A2`, en bas de la modale, y perdait ses trois dernières options. Rien ne s'en apercevait — le
  DOM était juste et les options « visibles » au sens de Playwright. Tout panneau qui flotte est
  donc en `position: fixed`, sa géométrie posée au pixel par le composant, et la mesure qui
  l'atteste passe par `elementFromPoint` : c'est la seule qui distingue « présent dans la mise en
  page » de « réellement sous le pointeur ».
- **Un WebSocket refusé par la CSP lève un `SecurityError` synchrone** sous WKWebView ; il
  n'échoue pas silencieusement. Du code qui ne l'attrape pas plante net.
- **Une app lancée depuis le Finder n'hérite pas du `PATH` du shell.** macOS lui en donne
  un minimal, sans `/opt/homebrew/bin` ni `/usr/local/bin`. Tout scope qui lance un
  programme tiers doit fouiller les emplacements usuels en plus du `PATH`.
- **Un sous-processus dont personne ne lit la sortie se bloque en écriture** : le tampon du
  système se remplit et l'enfant s'arrête au milieu d'un `write`. Une tâche de drain n'est
  pas un raffinement, c'est une condition de fonctionnement.
- **`JoinHandle::abort` n'est pas synchrone** : il *planifie* l'annulation, et au retour la
  tâche tient encore ses ressources — dont son port local.
- **Les feux tricolores de macOS sont hors d'atteinte du CSS** sous
  `titleBarStyle: "Overlay"` : ils sont dessinés par le système par-dessus la fenêtre.
  Ni grisables derrière une modale, ni capturables par Playwright.
- **`spctl --assess` et `codesign --verify` répondent à deux questions différentes.** Le second
  dit « cette signature est cohérente », y compris pour un ad hoc ; le premier dit « le système
  laisserait-il ceci s'ouvrir ». Un bundle ad hoc passe le second et échoue le premier — c'est
  exactement l'écart qui décide si la fenêtre « Apple n'a pas pu confirmer… » paraît. Et le
  troisième fait, l'agrafage (`stapler validate`), n'est impliqué par aucun des deux : sans lui
  l'application dépend d'un aller-retour réseau chez l'utilisateur.
- **Tauri ne fusionne pas les sidecars pour une cible universelle.** `--target
  universal-apple-darwin` exige un `externalBin` nommé `…-universal-apple-darwin`, **déjà
  fondu** ; les deux fichiers par architecture ne lui suffisent pas. Et l'absence n'apparaît
  qu'au *bundling*, après la compilation des deux cibles — cinq minutes perdues par tentative.
  La fusion est le travail de `scripts/telecharger-proxy.sh --tous`, par `lipo`, et
  `publication.yml` la constate avant de compiler.
- **Le bundler copie *tous* les binaires de la crate, pas seulement l'application.** Pour une
  cible universelle, Tauri ne fond que le binaire de l'app : `export-types` reste absent de
  `target/universal-apple-darwin/release/`, et le bundling échoue dessus — après la compilation
  des deux cibles. D'où `build.beforeBundleCommand`, seul point d'accroche entre la compilation
  et le bundling, branché sur `scripts/fondre-binaires-universels.sh`. Le hook **ne fait rien**
  hors construction universelle : un hook qui échoue hors de son cas finit débranché.
- **`rustup target add` s'applique à la toolchain résolue au répertoire courant.**
  `rust-toolchain.toml` est dans `src-tauri/` : lancé depuis la racine, l'ajout va à une autre
  toolchain, et la compilation croisée échoue avec « Target … is not installed » en annonçant la
  liste où elle manque. La CI le lance avec `working-directory: src-tauri`.
- **`lipo -thin` rend la tranche à l'octet près.** C'est ce qui permet de vérifier
  l'idempotence d'une fusion sur le **contenu** plutôt que sur la présence du fichier : un
  universel laissé par une version antérieure du verrou porterait le bon nom avec le mauvais
  binaire, et le bundle l'embarquerait sans rien remarquer.
- **Le `.DS_Store` d'un volume monté se lit, et il dit ce que le bundler a vraiment posé.**
  Les `bplist00` qu'il contient se chargent par `plistlib` : `WindowBounds`, `iconSize`,
  `textSize`, `backgroundType` et l'alias du fond y sont en clair. C'est ce qui a montré que
  les icônes du `.dmg` font 128 pt et non 96 — un fait qu'aucune configuration n'annonce et
  qu'aucune capture n'était en mesure de mesurer.
- **`bounds` d'une fenêtre Finder est la fenêtre entière, barre de titre comprise.** Mesuré :
  `bounds {100,100,760,540}` donne une fenêtre de 660 × 440 dont la **zone de contenu** fait
  660 × 408, à 32 pt du haut. C'est cette zone que le fond du `.dmg` remplit et dans laquelle
  les positions d'icônes sont exprimées, d'où `windowSize.height` à **472** pour une image de
  440 : lire le handoff au premier degré aurait rogné 32 pt du bas de l'image. Les 32 pt sont
  ceux de macOS 26 sans barre d'outils ni barre d'état ; une autre version pourrait en
  compter d'autres, et c'est la seule cote de l'habillage qui dépende du système.
- **`cloud-sql-proxy` v2 écrit son journal courant sur la sortie standard**, pas sur la
  sortie d'erreur — et il ne compose avec l'instance qu'à la **première connexion** : un
  nom d'instance faux le laisse annoncer « prêt », puis échouer en restant vivant.

---

## Ce que les quatre moteurs ont répondu à la même question

À lire avant d'en ajouter un cinquième.

| Question | PostgreSQL | MongoDB | SQLite | MySQL |
| --- | --- | --- | --- | --- |
| Le niveau « schéma » | les schémas de la base | les **bases** du serveur | un seul, `main` | les **bases** du serveur |
| Les colonnes | déclarées | **déduites** par échantillonnage | déclarées, type **suggéré** | déclarées |
| Le DDL | **reconstruit** | les commandes qui recréent la collection | **presque** d'origine | rendu par le serveur |
| Le compte de lignes | estimé (`reltuples`) | estimé | **exact** | estimé (InnoDB) ou **exact** (MyISAM) |
| L'égalité sûre au nul | `is not distinct from` | `$in: [null]` | `is` | `<=>` |
| Les transactions | toujours | jeu de réplicas requis | toujours | InnoDB oui, MyISAM **non** |
| La citation | guillemet double | — | guillemet double | **backtick** |
| Le port par défaut | 5432 | 27017 | **aucun** — un fichier | 3306 |
| La connexion | hôte et port | hôte et port | **un fichier** | hôte et port |

**La ligne de l'égalité sûre au nul a mordu quatre fois** : avec `=`, une modification
partant d'une cellule vide ne trouve aucune ligne, la transaction s'annule, et
l'utilisateur lit « la ligne a changé » sur une ligne que personne n'a touchée.

**Le pari du contrat de moteur a tenu** — les écrans sont écrits en termes du contrat, pas
de PostgreSQL. Cinq écrans ont fonctionné pour MongoDB, SQLite **et** MySQL sans une ligne
de code propre au moteur. Trois exceptions seulement, toutes dans l'écran et non dans le
contrat : la console mongo (dialecte de l'éditeur), la section « Schéma déduit », et les
cinq champs qu'un moteur de fichier masque.

**Redis n'entre pas dans ce contrat**, et c'est une conclusion, pas un retard : un espace
de clés n'est pas un tableau, et l'y forcer donnerait des écrans qui affichent des
colonnes inventées. Il lui faut son propre écran, qui n'est pas conçu.

---

## Vérifier : les règles tirées des défauts rencontrés

Celles-là se sont **répétées**, et c'est ce qui en fait des règles plutôt que des
anecdotes.

1. **Un test vert ne prouve rien tant qu'un sabotage ne l'a pas fait tomber.** Le contrôle
   négatif se fait par sabotage, pas par relecture : retirer la ligne soupçonnée du sujet
   et constater que la suite reste verte. Un test qui reste vert sous sabotage doit être
   **réécrit** — c'est arrivé quatre fois.

2. **Vérifier le chemin, pas seulement le résultat visible.** Saboter la pagination
   laissait vert le test « la fenêtre rend 500 lignes » — ramener cent mille lignes puis
   n'en garder que cinq cents satisfait la lettre de l'exigence. L'image de test SSH
   livrait `AllowTcpForwarding no` pendant que le test « un tunnel s'ouvre » passait.
   Quand la contrainte porte sur le chemin, mesurer le chemin : un coût, un aller-retour
   réel.

3. **Un décor de test trop régulier ne mesure que le décor.** Neuf défauts du premier
   usage réel tenaient tous à une régularité : colonnes exotiques nulles **partout**,
   tables toutes analysées, numéros d'attribut qui coïncident par hasard entre deux
   tables, grille de démonstration plus étroite que son cadre. Avant d'écrire un test,
   demander **ce que le décor rend indiscernable** — une colonne vide et un type mal lu,
   une table vide et une table jamais analysée, un chevauchement et une découpe par
   `overflow` — puis rendre les deux distinguables.

4. **Une capture de fidélité fait partie du changement qui la périme.** Trois références de
   `a1.spec.ts` sont restées trois commits en retard sur `AucuneSelection` : le fond derrière la
   modale avait changé de quelques valeurs sur toute la zone de travail, et `main` est resté
   rouge du 25 août au soir. Le diff de Playwright compte les pixels **au-dessus du seuil**, pas
   les pixels différents : 200 000 valeurs décalées de 4/255 s'annoncent « 401 pixels ». Lire le
   chiffre comme un ordre de grandeur, puis regarder les deux images côte à côte — c'est ce qui
   dit si le rendu est faux ou si c'est la référence.

5. **Ce qu'un écran affiche de son propre build, une capture de fidélité le fige.** La barre
   d'état porte `DoraBase <version>`, donc chaque capture pleine page contient le numéro : la
   première publication a rendu rouges deux références, douze pixels, le dernier chiffre. Un
   flux de publication et des captures pleine page sont incompatibles tant que la valeur n'est
   pas **figée pour le décor** — `DORABASE_VERSION_DECOR=9.9.9`, posée par
   `playwright.config.ts`, lue par `vite.config.ts`. Et figer une valeur oblige à vérifier
   qu'elle ne fuit pas : `scripts/verifier-aucun-decor-de-version.sh` refuse un `dist/` qui la
   porte — **et** un `dist/` où le libellé aurait disparu, sans quoi il serait vert le jour où
   l'affichage cesse. L'architecture, `__APP_ARCH__`, est dans le même libellé et n'a pas
   encore mordu : la CI et ce poste sont tous deux en `arm64`. Une référence capturée sur un
   Mac Intel divergerait.

6. **Un composant vérifié pièce par pièce n'est pas un écran livré.** Un écran entier
   fidèle et testé n'avait jamais été vu **dans l'application** : tous ses tests visaient
   la galerie, qui donne la même image. Même motif pour trois couches complètes que
   personne ne franchissait. **Au moins un test doit partir de `/`.**

7. **jsdom ne calcule aucune mise en page.** Toute exigence de hauteur, largeur, position
   ou superposition est structurellement hors de portée de Vitest et va dans `e2e/`. Et
   il faut mesurer la valeur **calculée**, pas le rectangle : celui-ci inclut les bordures
   et masque un écart derrière un arrondi.

8. **Un niveau de test manque toujours : celui qui n'appartient à aucun écran.**
   `e2e/geometrie-reelle.spec.ts` existe pour ça, à la taille de fenêtre réelle : rien ne
   franchit le bord droit **et** la racine ne défile pas horizontalement (les deux
   ensemble, un enfant coupé par un ancêtre en `overflow: hidden` échappant à la
   première) ; la grille défile bien **au geste**, molette comprise ; les libellés tiennent
   dans leurs boutons. Chaque composant peut être juste dans sa vitrine et faux dès qu'un
   voisin décide sa largeur.

9. **Les outils qui vérifient doivent eux-mêmes pouvoir échouer.** `cmd | tail` fait
   porter le statut de sortie par `tail`, et « TOUT VERT » s'est affiché avec trois
   vérifications rouges — d'où `scripts/verifier-tout.sh`, qui ne tronque rien. Un garde
   écrit contre une famille de fichiers ne couvre pas celle qu'elle engendre. Un
   `biome-ignore` doit être la **dernière** ligne de commentaire avant le nœud. Et
   `git checkout -- fichier` restaure depuis l'**index** : un sabotage qui y a été ajouté
   est réinstallé par la « restauration » censée l'enlever.

10. **« ÉCHEC à l'étape X » ne dit pas que X a échoué pour la raison qu'on croit.** Lire
    `gh run view --log-failed`, pas seulement le nom de l'étape — la vraie cause est
    souvent en amont *dans* la même commande. Et tout échec de CI n'est pas un défaut du
    code : une panne de GitHub Actions se relance, elle ne se corrige pas.

11. **Quand un scope ajoute une dépendance à un fichier absent du dépôt, la question n'est
    pas « le script qui le fabrique est-il appelé ? » mais « que voit un clone neuf ? ».**
    Un `externalBin` déclaré fait exiger le fichier par **toute** compilation — `cargo
    build`, `cargo test`, `clippy` —, pas seulement par le bundle. Rien ne l'avait vu parce
    que le binaire était présent sur la machine de développement depuis l'écriture du scope.

12. **Ce qu'un double de test émet doit venir d'une observation de l'original** — et une
    observation faite avec `2>&1` ne dit rien de la séparation des flux. Un faux binaire
    en shell peut couvrir tout le pilotage d'un sous-processus et se tromper sur le seul
    point qui compte.

13. **Une lecture sèche après une action asynchrone date la mesure du mauvais instant.**
    `page.evaluate`, `getAttribute`, `boundingBox` ne réessaient pas : ils rendent l'état de
    l'appel, pas celui qui résulte du clic ou du défilement qui précède. Le rendu suivant arrive
    plus tard, et sur un runner chargé il arrive **après**. Le test échoue alors sur une exigence
    qu'il ne mesurait pas — un panneau à zéro bouton, une grille restée à la ligne 3 — et la
    reprise le rattrape, ce qui le fait passer pour instable plutôt que pour faux. Deux
    occurrences le 25 août 2026, dans deux fichiers. Le remède est `expect(locator).toHaveCount`,
    `expect.poll`, ou n'importe quelle attente qui réessaie ; et quand une mesure ne vaut
    qu'après l'effet — l'en-tête qui « n'a pas bougé » —, la placer **après** l'attente qui
    prouve l'effet.

14. **Un `match` à bras attrape-tout ne garantit plus rien, et le commentaire qui promet le
    contraire survit à la garantie.** `AnyEngine::connect_via` portait « le `match` rend l'oubli
    impossible : ajouter un moteur fait échouer la compilation ». Vrai à l'écriture ; faux dès
    qu'un bras `autre =>` a été ajouté pour donner un message aux moteurs non livrés. Il a
    **absorbé** SQLite et MySQL, dont les adaptateurs existaient et que les six autres `match` du
    fichier répartissaient : l'application les refusait avec « DoraBase ne sait pas encore parler
    à MySQL ». Le test censé garder ce point comparait des numéros de spec — une fonction que le
    sujet n'appelle pas —, donc il est resté vert. **Quand une garantie passe du compilateur à un
    test, le commentaire doit le dire, et le test doit toucher le sujet** : ici, joindre chaque
    moteur livré contre un port fermé et vérifier que l'échec n'est pas un refus.

15. **Deux voies pour un même acte en laissent une en arrière.** « Tester la connexion » ouvrait
    par `PostgresAdapter::connect`, l'ouverture réelle par le répartiteur — donc le test parlait
    PostgreSQL à tous les moteurs, et sa requête ne portait même pas le moteur. Contre un `mongod`,
    le pilote reste **pendu** : ni verdict, ni erreur, un bouton « Test en cours… » indéfini, ce
    qui se rapporte comme « rien ne se passe ». Les deux voies passent désormais par le même
    `match`. À retenir pour l'enquête : **un clic sans effet visible est plus souvent un appel
    pendu qu'un appel absent**, et le journal ne le disait pas parce qu'il n'imprimait pas le
    moteur.

**Et la méthode qui a le plus payé** : mesurer le rendu dans un navigateur plutôt que lire
des valeurs déclarées, et comparer deux captures **côte à côte**. Une mesure vérifie une
hypothèse ; un inventaire visuel en révèle l'absence.

---

## Ce que l'outillage ne peut pas voir

**Playwright ne pilote pas WKWebView.** `pnpm dev` est entièrement vérifiable — mesures,
captures, comparaison au pixel. `pnpm tauri dev` compile et s'exécute, mais **la fenêtre
native elle-même ne peut pas être vue**. Piloter le bureau par frappes synthétiques a été
tenté puis abandonné : la fenêtre ne passait pas au premier plan, donc les frappes
risquaient d'atterrir dans les applications de l'utilisateur. **Demander, ne pas forcer.**

Restent quelques observations qu'aucun test ne peut faire, et qu'il ne faut jamais
présenter comme vérifiées tant qu'un humain ne les a pas faites :

- **Renommer une connexion, quitter l'application, la relancer.** Elle doit reparaître sous
  son nouveau nom et s'ouvrir **sans redemander son mot de passe** — c'est ce qui prouve
  que le secret a changé de référence dans le Trousseau réel, et non dans le magasin
  chiffré de développement.
- **Construire un bundle, le lancer depuis le Finder** sur une machine où `cloud-sql-proxy`
  n'est pas installé, et ouvrir une connexion Cloud SQL. Seule preuve du sidecar embarqué
  et du `PATH` minimal d'une app graphique.
- **Lancer l'application sur un *autre* Mac**, téléchargée par un navigateur. Le verdict de
  Gatekeeper a été mesuré — `spctl` répond « accepted, source=Notarized Developer ID » sur
  l'image et sur l'application, quarantaine posée à la main comme le fait Safari —, mais depuis
  la machine qui a construit. Ce qu'il reste à voir chez quelqu'un d'autre : que rien ne
  s'affiche du tout, et que l'application démarre. Un Mac Intel serait le meilleur essai, la
  tranche `x86_64` du bundle universel n'ayant jamais été exécutée.
- **Installer une version, en publier une suivante, et laisser l'application se mettre à
  jour.** Toute la chaîne est vérifiée en CI — l'archive existe, elle est notariée, agrafée,
  universelle, signée par la bonne clé, et le manifeste la désigne — mais **le remplacement du
  bundle par lui-même n'a jamais été exercé**. C'est le geste qui prouve à la fois que
  l'application sait écrire dans `/Applications`, que macOS accepte le bundle remplacé, et que
  le redémarrage rend une application qui s'ouvre. Aucun test ne peut le faire : Playwright ne
  pilote pas WKWebView, et le chemin passe par un vrai téléchargement depuis GitHub.
- **Ouvrir le `.dmg` publié, sur un écran Retina et sur un écran 1×.** Que le fond soit
  *appliqué* se vérifie par script (`verifier-dmg-monte.sh` : le fichier est dans le volume et
  le `.DS_Store` le référence) ; qu'il soit **net**, cadré, et que les deux icônes tombent bien
  sur leurs emplacements ne se voit qu'à l'œil. Le TIFF multi-résolution n'a pas d'autre juge.
  Ne pas chercher à le capturer par `screencapture` : la fenêtre du volume n'est pas
  nécessairement au premier plan, et la capture attrape alors l'écran de quelqu'un.
- **Régler « Afficher les barres de défilement : toujours »**, puis regarder la sidebar et
  la bande d'onglets. Chromium sans tête rend des barres en survol, qui n'occupent aucune
  place : la mesure vaut 0 avec comme sans la correction.
- **Défocaliser l'application.** Les trois feux doivent rester visibles (grisés) ; ils
  disparaissent. Dessinés par le système, donc ni reproductible ni corrigeable depuis le
  web. L'expérience à tenter est de passer `hiddenTitle` à `false` le temps d'un lancement.
- **Le Trousseau entre deux builds.** Les tests `#[ignore]` passent contre le vrai
  Trousseau, mais ils écrivent et relisent dans le **même processus**, donc sous la même
  signature ad-hoc. La crainte réelle est qu'une entrée écrite par un build soit illisible
  par le suivant. L'expérience qui trancherait demande de scinder l'aller-retour en deux
  tests — un qui écrit, un qui relit.

---

## Deux pièges propres à cette machine

**`cargo` n'est pas dans le `PATH`** des commandes shell de cet outillage : `~/.zshenv`
source `~/.cargo/env`, mais ce shell ne le relit pas.

```bash
export PATH="$HOME/.cargo/bin:$PATH"   # devant toute commande cargo ou tauri
```

**Plusieurs worktrees de ce dépôt travaillent en parallèle, et le premier `pnpm dev`
démarré prend 5173.** Playwright ne réutilise donc **plus jamais** de serveur et démarre le
sien en `--strictPort`. Le symptôme d'un conflit est trompeur — tous les tests expirent à
30 s, ou les captures diffèrent de 10 % des pixels, ce qui ressemble trait pour trait à
une régression de rendu. Le réflexe est de regarder qui écoute avant de chercher dans le
code :

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN   # à qui appartient ce serveur ?
export DORABASE_E2E_PORT=5399      # un port à soi, par worktree
```

**`tsc --noEmit` ne vérifie rien.** Le `tsconfig.json` de la racine porte `"files": []` et
deux `references` : c'est un fichier de solution, et la forme `--noEmit` sort 0 sans
regarder `src`. **C'est `pnpm typecheck` (`tsc -b`) qui mord**, et c'est celui de la CI.

---

## Décors de test : rien de réel

Les tests, les décors de démo (`?demo`) et la galerie ne doivent **jamais** porter la
structure d'une base réelle du commanditaire — ni noms de tables, ni noms de colonnes, ni
noms de bases, ni identifiants, ni ports.

**Pourquoi :** un dépôt, une capture d'écran, un rapport de test ou un artefact de CI
publie ce qu'il contient. Un décor de test n'a jamais besoin d'être vrai, seulement
**cohérent** — et les propriétés qu'on mesure (une bande d'onglets qui déborde, une colonne
trop longue) dépendent des longueurs et des quantités, pas des noms.

**En pratique :** tous les noms sont **inventés** — projets, bases, tables, colonnes,
hôtes. Les identifiants de connexion sont fictifs, et `localhost:5432`.

Le 19 août 2026, le dépôt a été relu entièrement pour retirer le nom du commanditaire et
celui de son projet, présents dans 506 endroits : décors de test, démo, galerie, captures
de fidélité, identifiant de bundle, service du Trousseau. L'historique Git a été réécrit
dans le même mouvement. Un nom réel dans un décor ne se remarque plus une fois écrit :
c'est à l'écriture qu'il faut le refuser.

**Cinq décors, et chacun sert en local *et* en CI** — une variante CI qu'on ne peut pas
essayer localement finit par diverger de ce qu'on croit qu'elle fait.

| Décor | Script | Particularité, et pourquoi |
| --- | --- | --- |
| PostgreSQL | `scripts/pg-test.sh` | **TLS activé**, certificat dont le nom ne correspond pas — sans quoi `verify-ca` et `verify-full` seraient indistinguables |
| MongoDB | `scripts/mongo-test.sh` | jeu de réplicas à un nœud — sans quoi l'écriture ne testerait que son refus |
| MySQL | `scripts/mysql-test.sh` | `--default-character-set=utf8mb4` — sans quoi le décor entre en latin1 |
| SQLite | `scripts/schema-test-sqlite.sql` | un fichier temporaire que le test crée : **aucun conteneur**, donc il passe sur une machine sans Docker |
| Bastion SSH | `scripts/bastion-test.sh` | un vrai serveur SSH |

**Sans le bastion, `cargo test --features db-tests` échoue** sur les tests de tunnel — ils
*paniquent* au lieu de se sauter, contrairement à ceux de PostgreSQL. Incohérence connue,
sans conséquence tant que le décor est monté.

---

## Commandes

**Avant tout commit — la barrière, une seule commande.** Elle lance ce que lance la CI, ne
tronque rien, et **échoue vraiment**. Sans `DORABASE_TEST_PG`, les tests sur base réelle
sont sautés — et elle le dit à l'écran plutôt que de les taire.

```bash
export PATH="$HOME/.cargo/bin:$PATH"
export DORABASE_TEST_PG="postgres://dorabase:dorabase-test@localhost:55432/dorabase_test"
export DORABASE_TEST_MONGO=$(./scripts/mongo-test.sh demarrer)
export DORABASE_TEST_MYSQL=$(./scripts/mysql-test.sh demarrer)
export DORABASE_E2E_PORT=5399
./scripts/bastion-test.sh demarrer /tmp/bastion && . /tmp/bastion/bastion.env
./scripts/verifier-tout.sh
```

```bash
pnpm dev            # serveur Vite ; `?gallery` affiche la galerie, `?demo` le décor de démo
pnpm tauri dev      # l'app (bloquant, ouvre une fenêtre)
pnpm test           # Vitest
pnpm test:e2e       # Playwright, webServer auto
pnpm typecheck      # tsc -b — le seul qui compile quelque chose
pnpm lint           # Biome
pnpm tokens:check   # garde-fou : échoue si tokens.css/ts ont été édités à la main
pnpm dmg:fond       # régénère le fond de la fenêtre d'installation .dmg (Chromium + tiffutil)
./scripts/verifier-dmg-monte.sh <fichier.dmg>          # monte une image et regarde son habillage
./scripts/version.sh correctif|fonction|majeur|X.Y.Z   # relève les 3 fichiers, committe, tag
                                                       # ne pousse rien ; le README décrit le flux
pnpm domain:check   # idem pour les projections ts-rs (exige un arbre git propre)

cd src-tauri && cargo test --features db-tests   # avec les décors
cd src-tauri && cargo test                       # sans décor
```

`src-tauri/dmg/fond-dmg.png`, `fond-dmg@2x.png` et `fond-dmg.tiff` sont engendrés par
`pnpm dmg:fond` depuis `fond-dmg.html`, et **committés** : le rendu demande un Chromium, que
le workflow de publication n'a pas à installer pour poser un tag.

**Fichiers générés, jamais édités à la main** : `src/design/tokens.css`,
`src/design/tokens.ts` (depuis `tokens.json`) et `src/domain/*.ts` (depuis Rust, par
`export-types`). **Un fichier généré n'a qu'un seul producteur** — c'est la leçon
d'`export-types`, dont le couplage à `cargo test` corrompait `config.ts` en silence.

`src/design/icons/sprite.svg` et `src/design/icons/names.ts` étaient extraits du mockup de
handoff ; celui-ci ayant été retiré, **ce sont désormais des sources**, éditées à la main.
Les icônes sont des SVG en trait, `viewBox 0 0 24 24`, `fill: none`, `stroke-width` 1.8–2.2
(2.4–2.6 pour les chevrons), extrémités et jointures arrondies.

---

## Ce qui attend une décision humaine

Aucun de ces points ne bloque le code en place.

- **Redis** — un écran de parcours de clés à concevoir. Le forcer dans le contrat de moteur
  donnerait des colonnes inventées.
- **Snowflake et BigQuery** — un compte d'essai pour chacun. Sans décor, l'adaptateur
  serait le premier code du projet dont aucun test ne dirait s'il fonctionne.
- **L'export CSV est un sujet, pas un bouton.** Outre `blob:` refusé par la CSP, il reste à
  trancher la fenêtre ou le résultat complet, l'encodage, le séparateur, le traitement des
  `NULL` et des sauts de ligne. Sur 1,9 million de lignes l'écriture doit être en flux,
  donc côté Rust. Le bouton est livré désactivé, avec l'infobulle qui le dit.
- **Le patch inverse persisté** — où l'écrire, sous quelle forme, et ce qu'il advient d'un
  patch dont la base a changé. Le garde-fou est livré **désactivé avec sa raison** plutôt
  qu'allumé sans effet.
- **Le thème « Nuit »** — le mécanisme existe (`data-theme` sur la racine, suivi de
  `prefers-color-scheme`) et l'écran le dit ; les valeurs sombres des cent jetons de
  `tokens.json` sont un travail de design.
- **L'écran de confiance SSH à la première connexion**, aujourd'hui contourné par un refus.
- **Une variante d'icône simplifiée sous 32 px** : la carte du sac à dos devient un amas de
  pixels. Visible au Dock réduit, en vignette Finder, en barre des menus.
- **Le visage Cloud SQL n'a jamais été conçu** : ses champs et ses libellés sont inventés.
  Un nom d'instance est long et prend trois colonnes de la grille, ce qui n'a pas été
  composé.
- **`export-types` voyage dans le bundle** — 6,3 Mo d'un outil de développement dans le `.app`
  livré, parce que le bundler copie tous les binaires de la crate. Ce n'était pas visible avant
  la cible universelle, qui a rendu la copie bruyante. Le retirer demande qu'il cesse d'être un
  binaire (un `examples/`, par exemple), ce qui touche `domain:build`, la clef `default-run` et
  le garde `verifier-default-run.py` — donc trois décisions déjà prises, à rejouer ensemble.
  Rien n'est cassé en attendant ; c'est du poids, pas un défaut.
- **Déplacer une connexion d'un environnement à un autre** n'existe pas, délibérément : cela
  demande de déplacer un secret du Trousseau, donc son geste et sa conception. La
  confirmation de suppression ne le propose pas — offrir une action absente est pire que
  son absence.

---

## Réserves connues

- **`verify-ca` — vérifier la chaîne sans vérifier le nom — n'est disponible que pour
  PostgreSQL.** Les pilotes MySQL et MongoDB ne savent pas l'exprimer, et le premier a même
  un drapeau silencieusement sans effet. Les deux **refusent avec leur raison** plutôt que
  de remplacer le mode en silence, et depuis le 26 août 2026 l'écran ne le leur propose plus
  — proposer un mode *et* le refuser était l'incohérence restante.
- **Le chemin heureux Cloud SQL contre une vraie instance n'a jamais été exercé.** Tout le
  pilotage du sous-processus est couvert par un faux binaire en shell, mais aucun test n'a
  parlé à Google. Le test se déverrouille avec `DORABASE_TEST_CLOUDSQL_INSTANCE`,
  `_DATABASE`, `_USER`, plus `_PASSWORD` ou `_CREDENTIALS`.
- **Une instance IAM réelle n'a pas été observée** depuis ce poste.
