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
- **Le formulaire d'`A2` est à deux colonnes qui s'apparient, et un champ de demi-largeur inséré
  décale tout d'une cellule.** « Utilisateur | Mot de passe », « Mode SSL | interrupteurs » : ajouter
  une demi-cellule au milieu laissait « Mot de passe » **seul sur sa rangée, avec un trou à sa
  droite**. Mesuré sur une capture de fidélité le 31 août 2026, sur un champ depuis retiré — la
  leçon reste : un champ qui s'ajoute au milieu prend la **rangée entière** (`grid-column: 1 / -1`,
  comme trois autres de ce formulaire) ou se place en fin de flux. Le compte de pixels d'un diff ne
  dit pas ça ; seules les deux images côte à côte le disent (règle n° 6).
- **Et une propriété de grille posée sur un élément qui n'est pas enfant de la grille ne casse
  rien non plus** (31 août 2026). `Field` pose son `className` sur l'`<input>`, jamais sur le
  `<div>` racine qui porte l'étiquette : le `grid-column` de `.tunnelInstance` était donc **inerte
  depuis `08k`**, et le test de géométrie qui prétendait le garder passait grâce à un seuil trop
  lâche. Même famille que le `var()` mort — une déclaration qui ne s'applique à rien ne se dénonce
  pas. Quand une classe porte `grid-column`, `grid-row` ou `grid-area`, **vérifiez à qui elle
  atterrit**, et mesurez la largeur contre les pistes calculées de la grille, jamais par un ordre
  de grandeur.

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
- **Et cet engrenage n'ouvrait rien sur `A1`** (26 août 2026). `WelcomeScreen` montait la barre sans
  `onOpenPreferences`, donc le bouton retombait sur le `disabled` de `TitleBar` — dont l'infobulle
  renvoyait vers *l'écran de travail*, qui n'existe précisément pas tant qu'aucun projet n'est
  déclaré. Le premier écran du produit avait un réglage inatteignable, et un commentaire d'`App`
  affirmait le contraire depuis que la modale y avait été montée « pour être atteignable depuis
  `A1` ». Deux choses à en retenir : **un composant juste dans sa vitrine ne prouve rien de
  l'assemblage** — le test qui manquait partait de `/` —, et **rien ne se voyait**, parce que
  `.action` n'a aucun style `:disabled` : le bouton mort avait l'exacte apparence du vivant, et son
  `disabled` avalait au passage l'infobulle qui aurait dit pourquoi (le piège n° 3
  d'accessibilité). L'infobulle ne nomme plus d'écran ; la galerie est le dernier appelant à monter
  la barre sans gestionnaire.
- **La barre de titre n'a plus qu'une action, l'engrenage** (26 août 2026). Le bouton de console
  qu'elle portait n'avait pas d'`onClick` depuis le premier assemblage : cliquable et inerte, donc
  lisible comme une panne — le défaut n° 36, dont l'engrenage voisin portait déjà le remède. Et il
  n'y avait pas d'`onClick` à lui donner : une console s'ouvre depuis le menu d'une connexion, qui
  est le palier qui connaît son contexte, là où un bouton de barre aurait dû deviner pour laquelle.
  C'est la même raison qui a fait partir le pied de la sidebar. La prop `showConsole` est partie
  avec.
- **L'engrenage était un soleil.** `i-gear` était un cercle et six rayons — le tracé d'un soleil, pas
  d'un rouage —, et il annonçait les préférences dans la barre de titre comme dans l'en-tête de leur
  modale. Redessiné en rouage à huit dents le 26 août 2026. Quatre captures de fidélité en
  dépendaient : une icône du sprite est un décor partagé, et la changer périme tout écran qui la
  montre.
- **Une modale ne dépasse jamais la fenêtre, et c'est son corps qui défile** (1er septembre 2026). La
  coquille n'avait aucun plafond : le formulaire d'`A2` en fait plus de 600px, donc sur une fenêtre
  courte la bande de pied sortait **par le bas** et « Enregistrer » devenait inatteignable — la
  racine ne défilant pas, rien ne venait le rattraper. Le plafond est `100% - 34px`, la marge du
  haut rendue au bas, et l'en-tête porte un `flex: none` : sans lui ses 44px tombent à 32, mesuré.
  Le pied n'en a pas besoin — sa `min-height` l'en empêche déjà —, et le corps n'a pas besoin de
  `min-height: 0` : un conteneur de défilement est exempté de la hauteur minimale automatique.
  **Deux déclarations inertes de moins**, sur le motif du `grid-column` mort du 31 août. Corollaire
  chez `A10`, la seule modale à porter son propre plancher de hauteur : celui-ci l'emportait sur son
  propre maximum, donc le corps de la modale défilait et emportait la bande de sections avec lui — un
  `min()` le borne au même endroit que le maximum.
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

**Et depuis le 27 août 2026, la base suit le même principe qu'un environnement : un
identifiant, et un libellé optionnel qui peut en diverger.** Le nom d'une base — `Database.name`
— portait un commentaire qui disait le contraire : « il n'y a pas d'étiquette libre ». La raison
tombait avec le champ « Nom » devenu **optionnel** : une base sans nom saisi doit tout de même
désigner quelque chose dans le registre, donc `A2` y substitue l'abréviation du moteur (« psql »,
« mongo »…) avant d'enregistrer — jamais en valeur du champ, toujours en `placeholder`, sinon le
vider ne rendrait plus le défaut. `Database.label: Option<String>` porte l'affichage libre, en
toute fin du formulaire, jamais verrouillé par `verrouille` : contrairement à `name`, il ne fait
partie ni de la clé du registre ni de la référence du secret, et un renommage sur place
(« Renommer… ») continue d'éditer `name`, jamais `label`. Un défaut à surveiller si ce principe
se redéfait : `ExplorerSidebar` faisait voyager `noeud.label` comme identité vers les commandes
IPC (`onCreer`, `onEditDatabase`, `demanderLeRetrait`) — vrai tant que `label === name`, faux dès
que l'un diverge de l'autre. C'est `noeud.database` qui doit y voyager.

**Et le champ « Nom » a fini par disparaître du formulaire** (1er septembre 2026) — le doublon
qu'il formait avec « Libellé » n'avait plus de raison d'être une fois `name` devenu facultatif :
deux champs qui font presque la même chose, l'un obligeant l'autre à exister « au cas où », sont
un doublon plutôt qu'un choix. `A2` ne montre donc plus que l'environnement dans sa rangée
d'identité, et `name` devient un identifiant purement technique, jamais saisi : vide sur un
brouillon neuf, `draftToSaveRequest` y substitue toujours l'abréviation du moteur — ce n'est plus
un repli parmi d'autres, c'est la seule voie. Le titre par défaut de l'explorateur reste donc
cette abréviation, et `label`, en fin de formulaire, continue de le remplacer dès qu'il est
renseigné (`arbre.ts` : `base.label?.trim() || base.name`) — la règle n'a pas changé, seul le
champ qui la contredisait est parti. **Une collision reste un refus, pas une génération de
suffixe** : `Project::valider` refuse déjà deux bases de même `name` dans le même environnement
(`ModelError::ConnexionEnDouble`), et c'est le bon comportement — deviner un suffixe unique
masquerait la collision plutôt que de la dire, quand `label` existe déjà pour désigner deux
connexions du même moteur dans le même environnement.

**Le cache de l'arbre suit le registre, qui est la seule vérité sur ce qui est ouvert** (31 août
2026). `connection_states` lit le registre ; l'arbre ne le relisait qu'au `finally` de son propre
chargement. Or **six commandes de configuration ferment des connexions** — renommer un projet,
renommer une connexion, retirer une base, retirer un projet, `update_variant`, retirer une console —
et aucune ne le disait à l'écran. Conséquence mesurée à l'usage, contre un vrai cluster : l'arbre
affichait **« OK »** sur une base que le registre avait fermée, et la première requête répondait
« aucune connexion ouverte ».

**Et le cache rendait le mensonge irréparable.** `charger` n'appelle `chargerBase` que si les schémas
ne sont pas déjà en cache : replier puis déplier ne rouvrait donc **rien**, et l'arbre continuait
d'afficher les schémas de la base précédente. Or c'est **mot pour mot** ce que le commentaire
d'`update_variant` annonce vouloir éviter en fermant la connexion — « l'arbre continuerait d'afficher
les schémas de la base précédente sans qu'un *Rafraîchir* y change quoi que ce soit ». La moitié Rust
était juste ; la moitié écran n'a jamais été écrite, et le commentaire a survécu à la garantie qu'il
décrivait.

**Le remède est une règle, pas six branchements** : *ce que le registre ne tient plus ne peut plus
être lu, donc ne doit plus être caché*. Les états sont relus à chaque changement de `projects` — le
signal commun aux six, puisque toutes rendent `Vec<Project>` que `App` repose —, et le cache comme le
dépliage se purgent des bases absentes du registre. Brancher chaque commande aurait demandé de les
connaître, et la septième l'aurait oublié. Trois points à ne pas défaire :

- **la purge part des schémas en cache, pas des entrées du registre** : celui-ci ne dit que ce qui
  est **ouvert**, il ne peut pas énumérer ce qui a été fermé ;
- **le dépliage est purgé en plus du cache.** `charger` n'est appelé que par `basculer` : un nœud
  resté déplié avec des schémas oubliés afficherait un vide que rien ne viendrait remplir ;
- **une lecture dépassée ne doit pas écraser une plus récente** (`tourDesEtats`). Deux appels se
  croisent — l'effet et le chargement —, et une lecture partie avant une ouverture peut répondre
  après elle. C'est le défaut n° 112 par un autre bout.

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

**Une base dans un cluster se joint par `kubectl port-forward`, en sous-processus** (31 août 2026).
C'est la **troisième sorte de proxy**, à côté du tunnel SSH et du proxy Cloud SQL, et rien d'autre
n'a bougé : cinq écrans, le registre, les commandes et les trois adaptateurs parlent de « proxy »
sans jamais nommer sa sorte.

**Pourquoi `kubectl` et pas un client Kubernetes.** Le transfert de port n'est pas une redirection
TCP : c'est un flux multiplexé (SPDY, WebSocket depuis la 1.30) au-dessus d'un appel authentifié au
serveur d'API. L'écrire demanderait un client complet — kubeconfig, contextes, certificats, jetons —
et surtout les *exec credential plugins* par lesquels GKE, EKS et l'OIDC délivrent leurs
identifiants. Ce dernier point tranche seul : **ces plugins sont des programmes installés sur la
machine**, donc même un client natif finirait par lancer un sous-processus, avec en plus toute la
surface d'un client à tenir à jour. C'est l'arbitrage de `22b` pour le dump — déléguer à l'outil
natif —, avec la même contrepartie assumée et **dite** : une dépendance externe, cherchée dans le
`PATH` puis dans les emplacements usuels, et un message d'absence qui porte la commande
d'installation.

**Et `kubectl` n'est pas embarqué, contrairement au proxy Cloud SQL.** Trois raisons, chacune
suffisante : il est **apparié au cluster** — au plus une version mineure d'écart avec le serveur
d'API —, donc un exemplaire figé dans le bundle vieillirait contre les clusters de l'utilisateur ;
il ne s'authentifie pas seul, et nous n'embarquerions pas ses plugins ; et il pèse une cinquantaine
de mégaoctets, quand ce fichier trouve déjà lourds les 6,3 Mo d'`export-types`.

**Le `PATH` du sous-processus est enrichi, et c'est le piège propre à cette sorte.** Trouver
`kubectl` ne suffit pas : il cherche ses plugins d'authentification dans le `PATH` **qu'il hérite de
nous**. Une app lancée depuis le Finder lui en transmettrait un minimal, et l'échec serait
« executable gke-gcloud-auth-plugin not found in $PATH » — un message qui accuse une installation
correcte. `programme::path_enrichi` y joint les emplacements usuels et le répertoire de `kubectl`
lui-même. Le test qui le garde a d'abord été **vert sous sabotage** : il lisait tout le journal, où
l'en-tête porte déjà le chemin du binaire, et le `PATH` de ce poste contient déjà Homebrew — il
mesurait la machine. L'assertion qui mord est le répertoire du faux binaire, dans `/tmp`, qui ne
peut pas venir du `PATH` hérité.

**Le kubeconfig se déclare, parce qu'une app graphique n'hérite pas de `$KUBECONFIG`** (31 août
2026, ajouté à la demande). C'est le **même fait** que celui qui a imposé l'enrichissement du `PATH`,
appliqué à une autre variable : macOS ne transmet à une application lancée depuis le Finder aucun
export du shell. Le défaut `~/.kube/config` survit — `HOME`, lui, est transmis —, mais un
`export KUBECONFIG=~/.kube/prod:~/.kube/staging`, qui est la façon courante de tenir plusieurs
clusters, ne parvient jamais jusqu'à nous. Sans ce champ, les contextes de ces fichiers seraient
**invisibles depuis l'app** alors que `kubectl config get-contexts` les liste dans un terminal, et
l'échec dirait « context not found » : un message qui accuse une installation correcte. Quatre
points à ne pas défaire :

- **`--kubeconfig` prend un chemin, `$KUBECONFIG` une liste** — le cas de la fusion de plusieurs
  fichiers n'est donc pas couvert, et c'est assumé : une connexion vise **un** cluster, donc le
  fichier qui le déclare suffit à la décrire. Ce qui se perd est la commodité d'un réglage global,
  pas une capacité ;
- **le même `--kubeconfig` va à `kubectl config current-context`**, et pas seulement au transfert.
  Sans cela, l'en-tête du journal nommerait un contexte lu dans le fichier *par défaut* pendant que
  le transfert emploierait celui qui est déclaré — donc affirmerait, avec aplomb, un cluster qui
  n'est pas celui qu'on vise. **Un en-tête faux est pire que pas d'en-tête**, puisque c'est lui qu'on
  croit en cherchant pourquoi une connexion a échoué. Vérifié par un faux `kubectl` qui répond un nom
  *différent* selon qu'on lui passe le drapeau : un double qui rendrait toujours le même nom
  laisserait ce défaut passer ;
- **le `~/` de tête est développé, et ce n'est pas une « correction automatique »**
  (`programme::chemin_utilisateur`). Nous passons un argv direct, jamais un shell, donc rien ne le
  ferait à notre place : un `~/.kube/prod` littéral ferait chercher un répertoire **nommé `~`**. La
  prohibition porte sur ce qu'on *devine* — une capitale, un préfixe ajouté —, pas sur une notation
  que tous les shells développent. Ce que la fonction ne fait pas : ni `$VAR`, ni
  `~autre-utilisateur`, ni chemin relatif ;
- **l'écran ne développe rien, le Rust seul le fait.** Développer côté écran persisterait un chemin
  absolu que l'utilisateur n'a pas saisi, donc une configuration qui cesse d'être vraie sur une autre
  machine ou sous un autre compte. Seul le processus qui lance `kubectl` connaît son `HOME`.

**Deux autres chemins saisis du produit ne sont pas développés, et c'est un défaut antérieur** :
`ca_certificate`, lu en `std::fs::read` par `engine/tls.rs`, et `private_key_path`, ouvert par
`engine/tunnel/`. Les deux **annoncent** pourtant un `~` — le `placeholder` du certificat propose
`~/certs/interne.pem`, et la capture de fidélité du panneau remplit la clé privée avec
`~/.ssh/id_ed25519`. `programme::chemin_utilisateur` est la fonction à leur brancher ; ce n'a pas été
fait le 31 août pour ne pas mêler deux chantiers.

**La cible est une ressource, pas un hôte — et le champ « Hôte » est donc grisé.** Une base qui vit
dans un cluster n'a pas d'adresse joignable depuis le poste : ce sont trois coordonnées qui la
désignent, `contexte / espace de noms / ressource`. Le champ affiche `127.0.0.1`, qui est vrai — la
connexion se fait sur le bout local du transfert —, avec un `title` qui dit pourquoi ; c'est
l'arbitrage du port « auto » derrière Cloud SQL, appliqué au champ que cette sorte-ci décide.
**L'hôte n'est pas grisé derrière Cloud SQL**, où il est tout aussi inemployé : incohérence connue et
laissée en place, le visage Cloud SQL n'ayant jamais été conçu.

**Le port et le mot de passe, eux, restent saisissables**, et c'est la différence de fond avec Cloud
SQL. Le port est celui de la base **dans le pod** — le membre droit du `local:distant` que `kubectl`
reçoit, donc `ConnectionSettings.port` sans champ de plus, exactement comme le tunnel SSH l'emploie
pour la cible derrière le bastion. Et un PostgreSQL dans un pod s'authentifie comme un autre : il n'y
a pas d'équivalent de l'IAM d'`06k`, et `authentification_iam` reste faux pour cette sorte.

**Le contexte ne se déclare pas : il vient du kubeconfig** (31 août 2026, après essai). Un champ
« Contexte » a existé une demi-journée, avec un long arbitrage sur l'inconfort d'un contexte
optionnel. Il est parti à l'usage, et la raison est simple : **un kubeconfig désigne son contexte
courant**, et l'outil qui l'écrit — Freelens, `gcloud`, `kind` — en produit un par cluster. Déclarer
le contexte revenait donc à recopier une information que le *fichier* porte déjà, et le fichier, lui,
se déclare. Aucun `--context` n'est passé à `kubectl` ; un test le vérifie **en négatif**, un champ
retiré revenant plus facilement qu'il n'est parti.

Ce qui reste de l'arbitrage d'origine, et qui compte davantage maintenant : le contexte est
**toujours deviné**, donc il doit être **dit**. L'en-tête du journal du transfert porte celui que
`kubectl config current-context` a rendu — lu avec le `--kubeconfig` déclaré, sans quoi il nommerait
le contexte d'un *autre* fichier — et voyage dans tout message d'échec. C'est la seule façon de
savoir quel cluster on a joint.

**Un « contexte » est un nom, pas un chemin** — la question s'est posée, donc elle vaut d'être
écrite. Un kubeconfig déclare trois listes : des clusters, des utilisateurs, et des *contextes*. Un
contexte est un triplet **nommé** `(cluster, utilisateur, espace de noms)` ; `kubectl config
get-contexts` les liste. Le *fichier*, lui, est le champ « Fichier kubeconfig ».

**L'espace de noms, lui, se déclare — et son vide vaut `default`.** L'asymétrie avec le contexte est
ce qui décide : un espace de noms absent fait **échouer** `kubectl` sur « not found », donc
bruyamment, là où un contexte absent le fait **réussir** contre le mauvais cluster. C'est pourquoi
seul le contexte est tracé dans le journal. Le `placeholder` nomme `default` **et** dit que le
contexte peut en imposer un autre : écrire « default » tout court serait faux pour un kubeconfig qui
en déclare un, ce qui est le cas courant des fichiers engendrés par un outil.

**La ressource est transmise telle quelle, jamais réécrite.** `kubectl` accepte `svc/postgres`,
`pod/postgres-0`, `statefulset/postgres` ou un nom nu — qu'il lit comme un pod. La liste de ses
types est la sienne et grandit sans nous, et le projet ne corrige aucune saisie : un `svc/` ajouté
d'office viserait un service là où l'utilisateur nommait un pod. Le `placeholder` propose `svc/…`,
qui survit à un redéploiement là où un nom de pod change, mais refuser un nom de pod interdirait le
seul geste possible quand aucun service n'expose la base.

**`--pod-running-timeout` est passé à `kubectl`, et il doit rester sous notre propre délai.** C'est
l'ordre des deux délais qui décide du message que l'utilisateur lit : `kubectl` attend qu'un pod soit
en cours d'exécution puis échoue en le disant — « pod is not running. Current status=Pending » —, et
si notre délai expirait le premier, on le tuerait avant qu'il ait écrit cette phrase. La marge de
cinq secondes est là pour **lui laisser le dernier mot**.

**`kubectl port-forward` reste vivant quand le transfert casse**, et c'est le jumeau du défaut Cloud
SQL du 24 août 2026 : mort du pod, redéploiement ou coupure réseau lui font écrire « lost connection
to pod » sans qu'il s'arrête. `etat()` ne voit donc qu'un processus en bonne santé, et l'erreur du
pilote — « connection reset » — n'apprend rien. D'où le troisième repère de `sortie.rs` et la fenêtre
d'explication, comme pour Cloud SQL.

**Aucun cran de migration n'a été nécessaire.** Une variante *ajoutée* à `Proxy` ne périme aucun
fichier existant, dont l'étiquette reste lisible — la règle des champs de `27a`, appliquée à une
étiquette, et l'inverse d'un *retrait*, qui en demande un (`06j`).

**Le pilotage du sous-processus est désormais partagé** — `engine/sous_processus.rs`, extrait de
`cloudsql/mod.rs`, plus `engine/journal.rs` et `engine/programme.rs` remontés d'un cran. Ce n'est pas
la contradiction de « le patron est partagé, l'implémentation non » qu'`engine/proxy.rs` porte : cette
phrase avait été écrite pour SSH contre Cloud SQL, où les mécaniques de détection *diffèrent*. Ici
elle est la même — lancer, lire les deux sorties, guetter une ligne de disponibilité et un port
annoncé, drainer, tuer sans orphelin — et chacun de ces quatre points a déjà coûté un défaut. Ce qui
reste chez chaque appelant : sa ligne de commande, ses repères de lecture, ses messages. **Les tests
de `cloudsql` n'ont pas bougé d'une ligne**, tous passant par l'API publique : leur vert est la
preuve de l'extraction.

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

**Ajouter une ligne est une modification en attente, pas un écran à part** (26 août 2026). Le `+` de
la barre d'outils n'apparaît qu'en mode édition, chaque clic pose une ligne vide en **bas** de la
grille, et elle s'édite comme les autres — mêmes cellules, même `⌘Z`, même « Appliquer ». Quatre
décisions à ne pas défaire :

- **une ligne ajoutée compte pour *une* entrée**, quel que soit le nombre de cellules remplies : le
  compte affiché à cinq endroits est celui des **écritures qui partiront**, et trois cellules d'une
  ligne neuve font un seul `INSERT` ;
- **une colonne non saisie est absente du SQL, elle n'est pas `NULL`.** C'est ce qui laisse la base
  appliquer ses défauts — une séquence, un `now()` —, et les poser à `NULL` ferait échouer
  l'insertion sur la première colonne obligatoire. La grille l'écrit en toutes lettres, « défaut »,
  plutôt que de laisser une cellule vide se confondre avec `NULL`. Corollaire assumé : **la chaîne
  vide explicite n'est pas exprimable à l'ajout** — vider une cellule la rend à son défaut, parce
  qu'ouvrir puis sortir sans rien taper est un geste bien plus fréquent que vouloir écrire `''` ;
- **la clé primaire s'y saisit**, alors qu'elle est refusée dans une ligne existante : il n'y a
  aucun `WHERE` à déplacer, et une table dont la clé est un code saisi ne pourrait rien recevoir. Une
  table **sans** clé primaire refuse la modification et accepte l'ajout, pour la même raison ;
- **le patch inverse ne défait pas une insertion, et il le dit.** La clé écrite est décidée par la
  base et n'est pas relue — la relire supposerait une clé primaire —, et un `DELETE` sur les valeurs
  saisies emporterait les lignes voisines identiques. Le patch porte donc une phrase en tête plutôt
  que d'être silencieusement incomplet. C'est le seul geste de l'écran qui ne s'annule pas après
  écriture, et c'est ce qui justifie que le bandeau nomme « lignes ajoutées » à part.

**Convention Rust à 4 espaces**, pas de `rustfmt.toml` alignant Rust sur le JS du projet.

### La publication : un tag, et rien d'autre

**Le tag est le déclencheur, le commit ne l'est pas.** `ci.yml` tourne sur chaque push et
chaque PR ; `publication.yml` ne tourne que sur un tag `vX.Y.Z`, motif **ancré** sur les
trois nombres. Une release est un geste, pas un effet de bord d'un push — et un motif large
(`v*`) accepterait `v1.2` ou `v0.1.0-essai`, dont le nom de bundle n'a été décidé par
personne. Le format de version est fermé pour la même raison : un suffixe de pré-version
traverserait `Info.plist`, le nom du `.dmg` et le nom du tag sans que quiconque ait tranché
ce qu'il y devient.

**Le geste peut partir de GitHub, pas seulement d'un poste** (26 août 2026) —
`.github/workflows/release.yml`, un `workflow_dispatch` à un seul champ (le cran :
correctif/fonction/majeur). Il rejoue `scripts/version.sh` sur un `main` fraîchement cloné,
donc à jour et propre par construction, puis pousse. **Le push ne peut pas se faire avec
`GITHUB_TOKEN`** : GitHub n'enchaîne pas les workflows sur un push que `GITHUB_TOKEN` a fait,
pour éviter les boucles — le tag partirait sur `origin` sans jamais déclencher
`publication.yml`, et rien ne le dirait, puisque le push lui-même réussirait. D'où un jeton
personnel dédié, `RELEASE_PUSH_TOKEN`, posé en secret du dépôt. `publication.yml` n'a pas
changé : il continue à ne réagir qu'à un tag `vX.Y.Z`, peu importe qui l'a poussé.

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

**Et une seconde voie, demandée à la main, dans les préférences** (26 août 2026). La barre d'état
annonce ce qu'elle a trouvé au démarrage ; elle ne répond pas à « et maintenant ? », qui est la
question qu'on se pose en attendant un correctif. La section « Mises à jour » de `A10` porte donc un
bouton qui cherche, et le résultat qui s'ensuit. Trois points à ne pas défaire :

- **rien n'est cherché à l'ouverture de la modale.** Une recherche au montage ferait dépendre le
  rendu de `A10` d'une réponse réseau, donc de l'instant, et toute capture de fidélité de cet écran
  deviendrait instable. C'est le même arbitrage que « la barre d'état ne rend rien par défaut »,
  pour la même raison ;
- **ici l'échec se dit**, à l'inverse de la barre d'état qui l'avale. La règle n'a pas changé : on ne
  dérange pas quelqu'un pour une requête qu'il n'a pas demandée. Celle-ci, il l'a demandée, et un
  bouton qui retombe en silence se lit comme une panne (défaut n° 36) ;
- **« pas encore cherché » n'est pas « à jour »**, exactement comme « jamais tentée » n'est pas
  « hors ligne » pour une base de l'arbre. Quatre états, pas deux.

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

**Une exécution de CI par commit, et Playwright à part.** `on: [push, pull_request]` faisait
tourner la CI entière **deux fois** sur toute branche ayant une PR : deux exécutions du même
arbre, lancées à la seconde près, pour un verdict identique. Le push est donc restreint à
`main`, la PR décide partout ailleurs, et `workflow_dispatch` reste pour le cas qu'on perd —
une branche poussée **sans** PR ne construit plus rien, donc n'a plus d'artefact `.dmg`.
Quant aux 247 tests Playwright d'alors, ils prenaient six des quatorze minutes du job `build`, en
**un seul worker** — le défaut de Playwright sous `CI`, que personne n'avait choisi — pendant
que le bundle attendait derrière eux. Ils ont leur job, deux workers et deux tranches
(`--shard`). Trois choses à ne pas rejouer : le job **reste sur macOS**, parce que les
captures de fidélité portent le suffixe de plateforme (`-darwin.png`) et que sur Linux
Playwright les **écrirait** au lieu de les comparer — une suite verte qui ne compare rien ;
`fail-fast: false`, parce qu'on veut les deux verdicts et non le premier ; et un nom
d'artefact par tranche, sans quoi le second téléversement échoue et masque l'échec des tests.
`scripts/verifier-ci.py` tient les quatre — filtre de branches, `--shard`, `macos`, présence
du job —, chacun vérifié par sabotage : aucun ne se remarquerait autrement qu'au chronomètre
ou en comptant les exécutions.

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

### Le thème « Nuit »

**Les valeurs sombres vivent dans `tokens.json`, sous une clé de premier niveau `nuit`** (26 août
2026). Un second fichier aurait été plus simple à lire et aurait mis des couleurs littérales hors du
seul fichier que la prohibition et `pnpm tokens:check` gardent — la règle porte sur le *fichier*,
pas sur le nombre de thèmes. `separerThemes` détache ce sous-arbre avant l'aplatissement, donc
`tokens.ts` ne connaît **que** les noms du clair : les deux thèmes ont forcément le même jeu de
jetons, et un nom sombre sans équivalent clair **arrête le générateur** plutôt que d'engendrer un
`var()` que rien ne casse.

**Trois blocs CSS, et il en faut trois** : `:root` pour le clair, `:root[data-theme="nuit"]` pour le
sombre choisi, et le même sombre sous `@media (prefers-color-scheme: dark)` pour
`:root:not([data-theme="cahier"])`. « Système » ne pose **aucun** attribut (voir `themeApplique`) :
c'est cette absence que la requête média rattrape, et le `:not` est ce qui empêche « Cahier » choisi
*explicitement* de virer au sombre sur un macOS en sombre.

**`color-scheme` est déclaré à la main dans `reset.css`, et ce n'est pas un doublon.** Aucun jeton
n'atteint ce que le moteur dessine lui-même — barres de défilement, curseur de saisie, les
`input[type="range"]` des préférences. Sans lui, « Nuit » laisserait des barres claires sur des
panneaux sombres.

**Les quatre `--preview-*` sont les seuls jetons de couleur que « Nuit » ne redéfinit pas**, et
c'est délibéré : les vignettes du sélecteur de thème montrent *l'autre* thème autant que le leur.
Reprises de `--bar`/`--paper`/`--dark`, elles auraient toutes viré au sombre sous « Nuit » — un
sélecteur de thème qui ne montre plus qu'un thème.

**Ce que le sombre n'a pas touché** : les `--syn-*` de l'éditeur, qui étaient déjà des couleurs de
fond sombre ; `--accent` et ses deux nuances, que les préférences posent en style *inline* sur la
racine, donc hors de portée d'une redéfinition par thème ; et `--gold`, lisible sur les deux fonds.
`--dark` et `--dark-2` restent des surfaces sombres **relevées** (`#35302A`, `#413B33`) : un bouton
« dark » et une infobulle doivent rester distincts du fond, et sous « Nuit » c'est vers le haut que
se fait la distinction.

**Deux défauts trouvés à l'œil dès le premier lancement, et ils ont la même forme** : un jeton de
*surface* employé comme *encre*. `color: var(--paper)` posé sur `background: var(--dark)` — sept
occurrences, dont l'infobulle, le segment actif et la liste des sections d'A10 — donnait un texte
qui disparaissait dans son fond dès que `--paper` cessait d'être clair. D'où **`--on-dark`**, qui
porte la valeur claire d'avant (`#FBF7EF`, donc rien ne bouge au pixel) et une valeur sombre. La
règle qui en sort : **un jeton nommé pour une surface ne doit jamais servir d'encre**, et
inversement — le nom porte le rôle, et c'est le rôle qui décide de la valeur sombre.

**`--btn-strong-bg`/`--btn-strong-ink` est la seule chose du sombre qui s'*inverse*.** Le bouton
plein est celui qui contraste le plus avec la page : le plus sombre sur du papier, donc le plus
**clair** sur une nuit. Les autres surfaces sombres — infobulle, segment actif, blocs de code —
restent sombres et se contentent d'une encre lisible. La variante garde son nom `dark` dans l'API
de `Button` : renommer une variante publique est une autre décision.

**Un littéral ne suit aucun thème, et c'est une raison de plus pour la prohibition.** Le dégradé
d'`A1` portait `#F8F3E9`, autorisé par un commentaire qui disait vrai — « une seule occurrence, pas
un rôle partagé, pas de jeton ». Sous « Nuit », le fond de la fenêtre restait crème en dégradant
depuis un `--paper-bright` devenu noir. C'était **la seule** couleur littérale du dépôt hors
`tokens.json` ; rien ne la vérifie automatiquement.

**La plaque du logo suit le thème, le dessin non.** `sprite.svg` porte la plaque en
`fill="var(--logo-plate,#FBF7EF)"` — la même forme que l'`--accent` juste en dessous, repli compris.
Les autres `#FBF7EF` du symbole sont du **dessin** — la carte, le carnet — et ne bougent pas : ils
doivent contraster avec la plaque, pas avec la page. L'icône de l'application n'est pas concernée,
elle vit dans `src-tauri/icons/icon-dorabase.svg`, un fichier séparé qu'aucune CSS n'atteint.

**Une ombre écrite sur une encre devient un halo.** `box-shadow: … var(--ink-4)` sous le logo
d'`A1` : `--ink-4` passe au crème sous « Nuit », donc l'ombre éclairait. D'où `--shadow-logo`, à la
valeur claire inchangée. Les ombres se déclarent **en entier** dans `tokens.json`, forme comprise —
c'est ce qui laisse le sombre changer l'opacité en même temps que la couleur.

**L'ombre d'un élément accent se dérive de l'accent, elle ne se choisit pas.** `--shadow-accent`
teinte son ombre avec `--accent` lui-même : c'est la seule forme correcte, l'accent étant réglable
et posé en style *inline* par les préférences — une ombre écrite sur `--accent-deeper`, statique et
terracotta, serait orange derrière un bouton vert. Sous « Nuit », l'ombre claire portait trop : elle
passe donc par un `color-mix` **imbriqué**, l'accent d'abord assombri vers `--canvas` (70 / 30) puis
posé à 50 % au lieu de 70 %. Mesuré sur la valeur *calculée* et non sur la déclaration : la
luminosité oklab tombe de .68 à .53, l'alpha de .7 à .5.

**L'imbrication de `color-mix` est le seul endroit du projet qui approche le plancher Safari 16.4.**
Chromium la résout ; WKWebView n'est pas pilotable (voir « Ce que l'outillage ne peut pas voir »), et
une valeur invalide ne dégraderait pas — elle supprimerait l'ombre. À regarder dans l'application
réelle plutôt qu'à supposer.

**Une coïncidence à connaître** : le bouton vert de la console porte `color: var(--paper-bright)`,
qui sous « Nuit » devient une *surface* sombre — donc du texte sombre sur un vert clair, ce qui est
lisible et même souhaitable sur un aplat saturé. Le rendu est juste, le nom ne l'est pas.

**Ce qui reste à faire à l'œil, et qu'aucun test ne dira** : lire les dix écrans en « Nuit ». Toute
la suite Playwright et toutes les captures de fidélité mesurent le **clair** — leur vert prouve
seulement que le sombre n'a rien changé au clair. Un contraste faible, une bordure disparue ou une
pastille illisible sous « Nuit » ne se voient qu'en regardant.

### Le menu natif, l'export et l'import d'un dump

**Le point d'entrée est le menu natif, et rien d'autre.** Le handoff ne maquette aucun bouton
d'export ; en inventer un aurait été le premier pixel inventé du projet. `⇧⌘E` et `⇧⌘I` sont
libres — les dix écrans réservent `⌘N`, `⌘K`, `⌘P`, `⌘Z`, `⌘↩` et `⌥↩`.

**Remplacer le menu par défaut retire le menu Édition**, donc `⌘C` / `⌘V` meurent dans toute
la webview. Le remplacement le reconstruit à l'identique ; c'est la seule raison pour laquelle
`menu::MenuSpec` décrit des items prédéfinis qu'on ne voulait pas décrire. Un test garde la
liste, et un autre garde qu'aucun libellé anglais de muda ne subsiste.

**Le dump délègue à l'outil natif du moteur** — `pg_dump` pour l'export, `psql` pour l'import
—, découvert sur la machine et non empaqueté. Un dump maison incomplet **présenté comme une
sauvegarde** serait le pire défaut que cette feature puisse avoir ; la fidélité est donc
acquise plutôt que promise. Contrepartie assumée : une dépendance externe, cherchée dans le
`PATH` puis dans les emplacements usuels de Homebrew et de Postgres.app — une app lancée
depuis le Finder n'hérite pas du `PATH` du shell.

**Cinq verdicts de disponibilité, jamais un booléen.** « Indisponible » recouvre cinq
situations dont deux se ressemblent sans être la même : `NotYetSupported` est une promesse à
tenir, `NoLocalDump` une impossibilité de construction — Snowflake et BigQuery n'ont pas
d'outil local, leur export sort vers un stockage cloud, ce qui heurte « aucune ressource
réseau ». Les fondre dirait « pas encore » d'un cas qui ne viendra jamais. **L'entrée de menu
reste active dans les cinq cas** : un item natif désactivé ne peut pas être cliqué, donc le
motif serait inatteignable. C'est la modale qui délivre le verdict.

**Le secret ne passe que par l'environnement du fils** (`PGPASSWORD`), jamais en argv — `ps`
l'exposerait à tout utilisateur de la machine — et jamais journalisé, le plugin de log ciblant
la webview en développement. Le processus est lancé par `std::process::Command` avec un argv
direct, **jamais par un shell** : aucune surface de citation ni d'injection.

**La progression est un nombre d'octets, sans total ni pourcentage.** `pg_dump --format=plain`
n'émet aucune progression exploitable et la taille finale est inconnaissable avant la fin :
afficher un pourcentage présenterait une estimation comme un fait.

**À l'échec comme à l'annulation, le fichier partiel est supprimé.** Un dump tronqué qui
ressemble à une sauvegarde est l'artefact dangereux de cette feature.

**Un dump tronqué s'importe partiellement, en silence, avec `exit=0`** — et c'est mesuré.
`psql --single-transaction --set ON_ERROR_STOP=on` ne suffit pas : `psql` lit les données d'un
`COPY … FROM stdin` jusqu'au `\.` terminal, et en atteignant la fin de fichier avant, il
traite l'EOF comme la **fin normale** des données. La `COPY` réussit, le script se termine, la
transaction est **committée**, et `ON_ERROR_STOP` n'a aucune erreur sur laquelle se déclencher.
Un dump de 102 083 lignes coupé à 60 000 a rendu `exit=0`, aucun message, et une base cible
portant 59 646 lignes sur 100 000 dans une table et les cinq autres vides. Le remède est dans
le fichier : `pg_dump --format=plain` termine par
`-- PostgreSQL database dump complete`, absent d'un fichier tronqué, **lu avant de lancer
`psql`**. Ce pied est le contrat entre l'export et l'import : l'un teste qu'il l'écrit, l'autre
qu'il l'exige, et retirer le contrôle fait réussir l'import du fichier coupé. **Ne jamais
« simplifier » ce contrôle en se fiant à la transaction.**

**Le pied n'est pas forcément la dernière ligne du fichier.** `pg_dump` 17.6 termine par
`\unrestrict <jeton>` — une méta-commande `psql` ajoutée par les correctifs d'août 2025 pour
qu'un dump ne puisse pas changer l'état de la session qui le rejoue. Le contrôle porte donc
sur la **présence** du pied dans la queue du fichier, jamais sur la fin exacte. Trouvé par la
CI : sa machine porte 17.6 quand celle de développement porte 17.4, et un test écrit en
`ends_with` a rougi sur une différence de version *mineure* du client. C'est la leçon
générale — un test plus strict que le contrat qu'il garde finit par mesurer la machine.

**Le garde-fou de l'import, c'est la modale qui nomme la cible** : projet, base,
environnement, chemin du fichier. Pas de case à cocher, pas de nom à recopier — l'erreur que
cela empêche est de se tromper de cible, pas d'intention. Et `readOnly` refuse **avant** toute
autre étape : avant la découverte du binaire, avant l'inspection, avant la question posée.

**Une connexion tunnelée exige que la base soit ouverte.** Le tunnel ne vit que tant que la
connexion est au registre, et son port local vient de là : sur une connexion tunnelée, l'hôte
et le port passés à `pg_dump` sont `127.0.0.1` et ce port, jamais ceux de la connexion — qui
décrivent la base **vue depuis le bastion**. Fermée, l'export le **dit** au lieu de rendre une
erreur réseau brute.

**La cible de `⇧⌘E` / `⇧⌘I` n'est résolue que si elle est sans ambiguïté** — un seul projet,
une seule connexion. Le menu natif n'émet qu'un identifiant d'item, et rien ne transmet encore
la sélection de l'arbre aux modales de dump. Sans cible unique, la modale le **dit** plutôt
que de choisir : exporter la mauvaise base est sans conséquence, importer dans la mauvaise en
a une. À reprendre quand la sélection sera transmise.

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
- **Un fichier qu'on vient d'écrire ne s'exécute pas toujours : `ETXTBSY`.** Linux refuse
  d'exécuter un fichier qu'un processus tient ouvert **en écriture**. `std::fs::write` ouvre ce
  descripteur dans *notre* processus ; les tests tournant en parallèle, le `fork` que fait un autre
  fil avant son `exec` le duplique dans l'enfant, et le fichier devient inexécutable le temps que
  cet enfant atteigne son `exec`. Rust pose bien `O_CLOEXEC` — la fenêtre dure quelques
  microsecondes, et c'est assez : elle a fait tomber `main` et une PR le 26 août 2026, sur **deux
  tests différents**, ce qui est la marque d'une course et non d'un test faux. Le remède est que le
  descripteur n'existe jamais chez nous : le faux binaire de `cloudsql` est posé par `cp` dans un
  sous-processus, qui s'achève avant qu'on l'exécute. La source, elle, s'écrit normalement —
  `ETXTBSY` porte sur l'inode qu'on exécute, pas sur celui qu'on lit. Et ce n'est pas reproductible
  à volonté : trois tours verts en local ne prouvent rien, seule la CI juge.
- **Un sous-processus dont personne ne lit la sortie se bloque en écriture** : le tampon du
  système se remplit et l'enfant s'arrête au milieu d'un `write`. Une tâche de drain n'est
  pas un raffinement, c'est une condition de fonctionnement.
- **`russh` laisse l'algorithme de Nagle actif** — `nodelay: false` dans son `Default`, là où
  `ssh` pose `TCP_NODELAY` de lui-même. Le tunnel écrit de petits paquets, et Nagle retient une
  petite écriture jusqu'à l'acquittement de la précédente : cela coûte **un aller-retour de plus
  par échange**. Mesuré le 31 août 2026 contre un bastion à ~50 ms — médiane de 217 ms par canal
  ouvert plus un aller-retour, contre 121 ms pour `ssh -L` au même instant. Le tunnel était deux
  fois plus lent que sa référence. **Invisible en local** : sur la boucle locale l'aller-retour
  retenu ne coûte rien, donc aucun décor de ce dépôt ne pouvait le montrer — d'où un test qui
  garde le réglage et non la durée (règle n° 3 : un test calé sur une durée réelle est un tirage
  au sort).
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

## Ce que les cinq moteurs ont répondu à la même question

À lire avant d'en ajouter un sixième.

| Question | PostgreSQL | MongoDB | SQLite | MySQL | BigQuery |
| --- | --- | --- | --- | --- | --- |
| Le niveau « schéma » | les schémas de la base | les **bases** du serveur | un seul, `main` | les **bases** du serveur | les **jeux de données** du projet |
| Les colonnes | déclarées | **déduites** par échantillonnage | déclarées, type **suggéré** | déclarées | déclarées |
| Le DDL | **reconstruit** | les commandes qui recréent la collection | **presque** d'origine | rendu par le serveur | **reconstruit** |
| Le compte de lignes | estimé (`reltuples`) | estimé | **exact** | estimé (InnoDB) ou **exact** (MyISAM) | estimé (`numRows`, hors tampon de diffusion) |
| L'égalité sûre au nul | `is not distinct from` | `$in: [null]` | `is` | `<=>` | pas nécessaire — filtres en `cast(… as string)` paramétré |
| Les transactions | toujours | jeu de réplicas requis | toujours | InnoDB oui, MyISAM **non** | aucune édition offerte, voir plus bas |
| La citation | guillemet double | — | guillemet double | **backtick** | **backtick**, table en un seul jeton `` `projet.jeu.table` `` |
| Le port par défaut | 5432 | 27017 | **aucun** — un fichier | 3306 | **aucun** — HTTPS vers l'API Google |
| La connexion | hôte et port | hôte et port | **un fichier** | hôte et port | **un projet GCP**, identifiants par défaut de l'application |

**La ligne de l'égalité sûre au nul a mordu quatre fois** : avec `=`, une modification
partant d'une cellule vide ne trouve aucune ligne, la transaction s'annule, et
l'utilisateur lit « la ligne a changé » sur une ligne que personne n'a touchée. BigQuery
n'a pas cette ligne parce qu'il n'a pas d'édition à protéger — voir la spec `21`.

**Le pari du contrat de moteur a tenu** — les écrans sont écrits en termes du contrat, pas
de PostgreSQL. Cinq écrans ont fonctionné pour MongoDB, SQLite **et** MySQL sans une ligne
de code propre au moteur. Trois exceptions seulement, toutes dans l'écran et non dans le
contrat : la console mongo (dialecte de l'éditeur), la section « Schéma déduit », et les
cinq champs qu'un moteur de fichier masque.

**BigQuery (`21`) est le premier moteur du contrat sans édition de lignes.**
`preview_updates` et `apply_updates` refusent, avec leur raison : les DML sont facturés au
volume parcouru, et `gcp_bigquery_client` 0.24 ne modélise pas encore les clés primaires
déclarées de BigQuery — rien ici ne peut garantir le même contrôle de conflit que les
quatre autres moteurs (`11d`). La console SQL, elle, exécute ce que l'utilisateur y
écrit, DML compris ; seule la grille refuse. `row_as_insert` reste offert : copier une
ligne en `INSERT` ne modifie rien.

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

3. **Un test calé sur une durée réelle est un tirage au sort.** Le plan de l'export voulait
   annuler un dump de 100 000 lignes, « qui dure assez pour être annulé » : mesuré, ce dump
   prend **0,136 s**, moins que deux tours de sondage. L'annulation est donc exercée contre un
   faux outil lent — un script qui écrit une ligne toutes les 50 ms — sur exactement le même
   chemin de code, et le binaire réel garde un test où l'annulation est demandée avant le
   lancement. Chronométrer avant d'écrire le test, plutôt que croire un adjectif.

4. **Une liste de tables ou de comptes écrite dans un test se périme en silence.** Celle des
   tests de dump l'a fait deux fois : d'abord contre ce que le chantier annonçait, puis contre
   le décor lui-même, qui avait grandi entre-temps. Les tables et leurs comptes sont désormais
   **lus au serveur**, et le seul chiffre en dur est celui de la grande table — il sert de
   contrôle positif, sans quoi « le dump dit la même chose que la base » passerait aussi sur
   une base vide.

5. **Un décor de test trop régulier ne mesure que le décor.** Neuf défauts du premier
   usage réel tenaient tous à une régularité : colonnes exotiques nulles **partout**,
   tables toutes analysées, numéros d'attribut qui coïncident par hasard entre deux
   tables, grille de démonstration plus étroite que son cadre. Avant d'écrire un test,
   demander **ce que le décor rend indiscernable** — une colonne vide et un type mal lu,
   une table vide et une table jamais analysée, un chevauchement et une découpe par
   `overflow` — puis rendre les deux distinguables.

6. **Une capture de fidélité fait partie du changement qui la périme.** Trois références de
   `a1.spec.ts` sont restées trois commits en retard sur `AucuneSelection` : le fond derrière la
   modale avait changé de quelques valeurs sur toute la zone de travail, et `main` est resté
   rouge du 25 août au soir. Le diff de Playwright compte les pixels **au-dessus du seuil**, pas
   les pixels différents : 200 000 valeurs décalées de 4/255 s'annoncent « 401 pixels ». Lire le
   chiffre comme un ordre de grandeur, puis regarder les deux images côte à côte — c'est ce qui
   dit si le rendu est faux ou si c'est la référence.

7. **Ce qu'un écran affiche de son propre build, une capture de fidélité le fige.** La barre
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

8. **Un composant vérifié pièce par pièce n'est pas un écran livré.** Un écran entier
   fidèle et testé n'avait jamais été vu **dans l'application** : tous ses tests visaient
   la galerie, qui donne la même image. Même motif pour trois couches complètes que
   personne ne franchissait. **Au moins un test doit partir de `/`.**

9. **jsdom ne calcule aucune mise en page.** Toute exigence de hauteur, largeur, position
   ou superposition est structurellement hors de portée de Vitest et va dans `e2e/`. Et
   il faut mesurer la valeur **calculée**, pas le rectangle : celui-ci inclut les bordures
   et masque un écart derrière un arrondi.

10. **Un niveau de test manque toujours : celui qui n'appartient à aucun écran.**
   `e2e/geometrie-reelle.spec.ts` existe pour ça, à la taille de fenêtre réelle : rien ne
   franchit le bord droit **et** la racine ne défile pas horizontalement (les deux
   ensemble, un enfant coupé par un ancêtre en `overflow: hidden` échappant à la
   première) ; la grille défile bien **au geste**, molette comprise ; les libellés tiennent
   dans leurs boutons. Chaque composant peut être juste dans sa vitrine et faux dès qu'un
   voisin décide sa largeur.

11. **Les outils qui vérifient doivent eux-mêmes pouvoir échouer.** `cmd | tail` fait
   porter le statut de sortie par `tail`, et « TOUT VERT » s'est affiché avec trois
   vérifications rouges — d'où `scripts/verifier-tout.sh`, qui ne tronque rien. Un garde
   écrit contre une famille de fichiers ne couvre pas celle qu'elle engendre. Un
   `biome-ignore` doit être la **dernière** ligne de commentaire avant le nœud. Et
   `git checkout -- fichier` restaure depuis l'**index** : un sabotage qui y a été ajouté
   est réinstallé par la « restauration » censée l'enlever.

12. **« ÉCHEC à l'étape X » ne dit pas que X a échoué pour la raison qu'on croit.** Lire
    `gh run view --log-failed`, pas seulement le nom de l'étape — la vraie cause est
    souvent en amont *dans* la même commande. Et tout échec de CI n'est pas un défaut du
    code : une panne de GitHub Actions se relance, elle ne se corrige pas.

13. **Quand un scope ajoute une dépendance à un fichier absent du dépôt, la question n'est
    pas « le script qui le fabrique est-il appelé ? » mais « que voit un clone neuf ? ».**
    Un `externalBin` déclaré fait exiger le fichier par **toute** compilation — `cargo
    build`, `cargo test`, `clippy` —, pas seulement par le bundle. Rien ne l'avait vu parce
    que le binaire était présent sur la machine de développement depuis l'écriture du scope.

14. **Ce qu'un double de test émet doit venir d'une observation de l'original** — et une
    observation faite avec `2>&1` ne dit rien de la séparation des flux. Un faux binaire
    en shell peut couvrir tout le pilotage d'un sous-processus et se tromper sur le seul
    point qui compte.

15. **Une lecture sèche après une action asynchrone date la mesure du mauvais instant.**
    `page.evaluate`, `getAttribute`, `boundingBox` ne réessaient pas : ils rendent l'état de
    l'appel, pas celui qui résulte du clic ou du défilement qui précède. Le rendu suivant arrive
    plus tard, et sur un runner chargé il arrive **après**. Le test échoue alors sur une exigence
    qu'il ne mesurait pas — un panneau à zéro bouton, une grille restée à la ligne 3 — et la
    reprise le rattrape, ce qui le fait passer pour instable plutôt que pour faux. Deux
    occurrences le 25 août 2026, dans deux fichiers. Le remède est `expect(locator).toHaveCount`,
    `expect.poll`, ou n'importe quelle attente qui réessaie ; et quand une mesure ne vaut
    qu'après l'effet — l'en-tête qui « n'a pas bougé » —, la placer **après** l'attente qui
    prouve l'effet.

16. **Un `match` à bras attrape-tout ne garantit plus rien, et le commentaire qui promet le
    contraire survit à la garantie.** `AnyEngine::connect_via` portait « le `match` rend l'oubli
    impossible : ajouter un moteur fait échouer la compilation ». Vrai à l'écriture ; faux dès
    qu'un bras `autre =>` a été ajouté pour donner un message aux moteurs non livrés. Il a
    **absorbé** SQLite et MySQL, dont les adaptateurs existaient et que les six autres `match` du
    fichier répartissaient : l'application les refusait avec « DoraBase ne sait pas encore parler
    à MySQL ». Le test censé garder ce point comparait des numéros de spec — une fonction que le
    sujet n'appelle pas —, donc il est resté vert. **Quand une garantie passe du compilateur à un
    test, le commentaire doit le dire, et le test doit toucher le sujet** : ici, joindre chaque
    moteur livré contre un port fermé et vérifier que l'échec n'est pas un refus.

17. **Deux voies pour un même acte en laissent une en arrière.** « Tester la connexion » ouvrait
    par `PostgresAdapter::connect`, l'ouverture réelle par le répartiteur — donc le test parlait
    PostgreSQL à tous les moteurs, et sa requête ne portait même pas le moteur. Contre un `mongod`,
    le pilote reste **pendu** : ni verdict, ni erreur, un bouton « Test en cours… » indéfini, ce
    qui se rapporte comme « rien ne se passe ». Les deux voies passent désormais par le même
    `match`. À retenir pour l'enquête : **un clic sans effet visible est plus souvent un appel
    pendu qu'un appel absent**, et le journal ne le disait pas parce qu'il n'imprimait pas le
    moteur.

18. **Un test qui mesure un ordre de grandeur ne garde pas une cote.** Trois assertions de
    géométrie écrites le 31 août 2026 sont restées vertes sur une mise en page fausse, et les trois
    pour la même raison : elles comparaient deux valeurs entre elles — « le contexte est plus large
    que l'espace de noms », « l'instance fait plus du double de Type » — là où l'exigence portait sur
    le **nombre de pistes occupées**. Sans le `grid-column`, le champ tombe dans une piste voisine
    plus étroite, donc l'inégalité tient encore. Le remède est de mesurer contre les pistes
    **calculées** (`getComputedStyle(grille).gridTemplateColumns`) et l'écart de colonne, ce qui
    donne une égalité et non une comparaison. Corollaire, et c'est le même que la règle n° 5 : un
    décor où deux valeurs se ressemblent ne les distingue pas — les deux ports d'un
    `local:distant` doivent être différents dans un test, sinon leur inversion passe.

19. **Un décor de double de test doit répondre à *tous* les appels que la production fait, pas
    seulement à celui auquel on a pensé.** Le faux `kubectl` du 31 août 2026 en reçoit deux :
    `port-forward` et `config current-context`. Un décor qui n'aurait connu que le premier aurait pris
    sa propre ligne « Forwarding from… » pour un nom de contexte, et l'en-tête du journal — qui est
    tout le remède au contexte optionnel — se serait rempli de bruit sans qu'un test le voie. C'est
    la règle n° 14 par l'autre bout : ce qu'un double **entend** compte autant que ce qu'il émet.

20. **Une garantie posée d'un seul côté du pont ne garantit rien, et son commentaire le cache.**
    `update_variant` ferme la connexion de la base modifiée, et son commentaire explique que c'est
    pour empêcher l'arbre de montrer les schémas de la base précédente. Le Rust faisait exactement ce
    qu'il disait ; l'écran, lui, ne relisait jamais les états et ne purgeait jamais son cache — donc
    le résultat que le commentaire annonçait prévenir **arrivait quand même**, et le commentaire
    faisait obstacle à l'enquête en affirmant le contraire. C'est le défaut n° 16 déplacé de deux
    fonctions à deux *couches* : quand une garantie traverse l'IPC, le commentaire doit nommer la
    moitié qui reste à faire, et un test doit partir du côté qui **observe** — ici l'arbre, pas la
    commande. Symptôme à reconnaître : « l'écran dit que c'est ouvert, mais rien ne répond ».

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
- **Ouvrir une connexion Kubernetes contre un vrai cluster.** Tout le pilotage de `kubectl` est
  couvert par un faux binaire en shell — port annoncé, mort avant l'ouverture, délai, transfert perdu
  alors que le processus vit, arguments, `PATH` de l'enfant, en-tête du contexte — mais **aucun test
  n'a parlé à un serveur d'API**. Ce qui reste à voir : qu'un `svc/postgres` d'un cluster réel
  s'ouvre, que la grille lise des lignes à travers, et que fermer la connexion ne laisse pas de
  `kubectl` orphelin (`ps -ax | grep port-forward`). Un cluster local — `kind`, `minikube`, Docker
  Desktop — suffit pour les trois. Ce qui demande en plus un cluster **distant**, et qui est le seul
  chemin réellement non exercé : le lancement d'un *exec credential plugin*, donc la raison d'être de
  l'enrichissement du `PATH`. Le geste décisif est de lancer le bundle **depuis le Finder** et
  d'ouvrir une connexion GKE : c'est là, et seulement là, que le `PATH` est minimal.
- **Ouvrir le `.dmg` publié, sur un écran Retina et sur un écran 1×.** Que le fond soit
  *appliqué* se vérifie par script (`verifier-dmg-monte.sh` : le fichier est dans le volume et
  le `.DS_Store` le référence) ; qu'il soit **net**, cadré, et que les deux icônes tombent bien
  sur leurs emplacements ne se voit qu'à l'œil. Le TIFF multi-résolution n'a pas d'autre juge.
  Ne pas chercher à le capturer par `screencapture` : la fenêtre du volume n'est pas
  nécessairement au premier plan, et la capture attrape alors l'écran de quelqu'un.
- **Dérouler chaque menu de la barre, puis exercer le presse-papier.** Six menus en
  français, et « Fichier » portant ses deux entrées de dump avec `⇧⌘E` / `⇧⌘I` ; puis `⌘N`,
  taper dans un champ, `⌘A` `⌘C` `⌘V`. Le presse-papier est **la** régression que le
  remplacement du menu par défaut peut introduire, et aucun test ne voit un menu natif.
- **Déclencher `⇧⌘E` puis `⇧⌘I`.** Deux lignes distinctes doivent paraître dans la sortie de
  `pnpm tauri dev`, côté Rust **et** côté front : c'est la seule vérification du pont menu →
  React, `MenuEvent` ne portant qu'un identifiant.
- **Exporter puis réimporter pour de vrai.** Le sélecteur de sauvegarde natif doit s'ouvrir et
  un fichier non vide arriver au chemin choisi ; puis `⇧⌘I` sur ce fichier doit nommer projet,
  base et environnement avant de laisser confirmer. Les sélecteurs de fichiers natifs ne sont
  pas dans le DOM — même angle mort que « Parcourir… ».
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

## Trois pièges propres à cette machine

**`cargo` n'est pas dans le `PATH`** des commandes shell de cet outillage : `~/.zshenv`
source `~/.cargo/env`, mais ce shell ne le relit pas.

```bash
export PATH="$HOME/.cargo/bin:$PATH"   # devant toute commande cargo ou tauri
```

**`pyyaml` n'est pas installé pour le `python3` du système**, donc
`scripts/verifier-ci.py` — la seule vérification que le fichier de CI décrit ce qu'on croit —
s'arrête sur un `ModuleNotFoundError`, et `verifier-tout.sh` l'inscrit en ÉCHEC. Ce n'est pas un
défaut du dépôt : la CI l'a. Un environnement jetable suffit, et ne touche à rien :

```bash
python3 -m venv /tmp/venv-dorabase && /tmp/venv-dorabase/bin/pip install -q pyyaml
PATH="/tmp/venv-dorabase/bin:$PATH" ./scripts/verifier-tout.sh
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
- **Snowflake** — un compte d'essai. Sans décor, l'adaptateur serait le premier code du
  projet dont aucun test ne dirait s'il fonctionne — la raison pour laquelle il n'est pas
  encore écrit.
- **BigQuery, lui, a été écrit sans compte d'essai** (`21`) — voir « Réserves connues » et
  le commentaire de tête de `src-tauri/src/engine/bigquery/mod.rs`. Ce qui reste à décider
  n'est plus le principe, mais la vérification : quelqu'un doit le pointer vers un vrai
  projet GCP et regarder ce qui se passe.
- **L'export CSV est un sujet, pas un bouton.** Outre `blob:` refusé par la CSP, il reste à
  trancher la fenêtre ou le résultat complet, l'encodage, le séparateur, le traitement des
  `NULL` et des sauts de ligne. Sur 1,9 million de lignes l'écriture doit être en flux,
  donc côté Rust. Le bouton est livré désactivé, avec l'infobulle qui le dit.
- **Le patch inverse persisté** — où l'écrire, sous quelle forme, et ce qu'il advient d'un
  patch dont la base a changé. Le garde-fou est livré **désactivé avec sa raison** plutôt
  qu'allumé sans effet.
- **L'écran de confiance SSH à la première connexion**, aujourd'hui contourné par un refus.
- **Une variante d'icône simplifiée sous 32 px** : la carte du sac à dos devient un amas de
  pixels. Visible au Dock réduit, en vignette Finder, en barre des menus.
- **Le visage Cloud SQL n'a jamais été conçu** : ses champs et ses libellés sont inventés.
  Un nom d'instance est long et prend trois colonnes de la grille, ce qui n'a pas été
  composé. **Et il porte un champ « Hôte » inemployé et non grisé**, là où le visage Kubernetes
  grise le sien : la cohérence demanderait de trancher les deux ensemble, ce qu'un passage de
  design fera mieux qu'un alignement décidé au passage.
- **Le visage Kubernetes n'a pas été conçu non plus** (31 août 2026) : trois champs, leurs libellés
  et leur cote sont inventés sur le patron du visage SSH — hauteurs de 28 px, espace de noms sur une
  piste, kubeconfig et ressource sur la rangée entière. Le kubeconfig n'a **pas** de bouton
  « Parcourir… », à la différence de la clé privée SSH : chacun demande une prop injectée et un test
  de câblage, le sélecteur natif ne répondant pas hors de la webview, et un chemin de kubeconfig est
  presque toujours sous `~/.kube/`. À reprendre si l'usage dit le contraire. Ce qui manque le plus à l'œil : un contexte GKE fait
  rien ne dit **à l'écran** quel contexte sera employé : l'information n'existe que dans l'en-tête du
  journal, donc seulement en cas d'échec. C'est la réserve qui reste après le retrait du champ, et un
  rappel discret sous le fichier serait la vraie réponse ; l'inventer aurait été inventer un état que
  le handoff ne décrit pas.
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
- **Le chemin heureux Kubernetes contre un vrai cluster n'a jamais été exercé** — même réserve, et
  pour la même raison qu'en Cloud SQL : tout le pilotage du sous-processus est couvert par un faux
  binaire en shell, mais aucun test n'a parlé à un serveur d'API. Voir le geste à faire dans « Ce que
  l'outillage ne peut pas voir ». Le décor qui manquerait le moins serait un `kind` en CI, mais il
  n'exercerait pas le seul chemin qui compte vraiment : le lancement d'un *exec credential plugin*,
  qui demande un cluster distant et un compte.
- **Le dump ne connaît pas encore le transfert Kubernetes.** `dump/commands.rs` refuse une connexion
  tunnelée **fermée** avec un message qui nomme « un tunnel SSH » ; le refus est juste — le transfert
  ne vit que tant que la connexion est ouverte, et le port local vient de là —, mais le mot est faux
  pour les deux autres sortes. Il l'était déjà pour Cloud SQL. Rien n'est cassé : le chemin ouvert
  passe par `tunnel_local_port`, qui est indifférent à la sorte.
- **Le chemin heureux Cloud SQL contre une vraie instance n'a jamais été exercé.** Tout le
  pilotage du sous-processus est couvert par un faux binaire en shell, mais aucun test n'a
  parlé à Google. Le test se déverrouille avec `DORABASE_TEST_CLOUDSQL_INSTANCE`,
  `_DATABASE`, `_USER`, plus `_PASSWORD` ou `_CREDENTIALS`.
- **Une instance IAM réelle n'a pas été observée** depuis ce poste.
- **BigQuery (`21`) est livré sans qu'aucun décor n'ait jamais parlé à un vrai projet GCP.**
  Ce qui ne demande pas de réseau — la composition du SQL (`rows.rs`), la conversion des
  types (`valeurs.rs`), le DDL reconstruit (`introspect.rs`) — est testé en pur, sans
  connexion. L'ouverture du client, l'authentification par les identifiants par défaut de
  l'application, et chaque appel à l'API REST (`dataset.list`, `table.get`, `job.query`)
  ne le sont pas : `cargo test --features db-tests` ne les exerce pas, faute de compte
  d'essai — même obstacle que Snowflake, sauf que le contrat, lui, a été jugé assez proche
  de MongoDB (jeux de données = bases du serveur) pour écrire l'adaptateur avant le décor,
  plutôt que d'attendre les deux à la fois. Voir le commentaire de tête de
  `src-tauri/src/engine/bigquery/mod.rs` avant d'y toucher, et vérifier contre un projet
  réel avant de faire confiance au chemin heureux.
