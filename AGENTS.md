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
N'en écrivez pas de nouveaux : **ce qu'on écrit à leur place est l'identifiant du ticket
Linear** — `API-28`, `API-33` —, et c'est la section « Le lien avec Linear » qui le dit.

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

## Le lien avec Linear

**Rien ne s'écrit sans un ticket.** Une fonction, un correctif, un chantier de fond : chacun est
rattaché à un ticket Linear avant que la première ligne parte. Les trois traces du projet ne disent
pas la même chose et aucune ne remplace les deux autres — le code dit *ce qui est*, ce fichier dit
*pourquoi c'est ainsi*, le ticket dit **ce que quelqu'un a demandé et où en est la réponse**. C'est
le seul des trois qui se lise sans avoir le dépôt sous la main, et le seul qui se partage avec qui
n'écrit pas de code.

Les tickets du produit vivent dans l'équipe **`API`**, projet **« DoraBase — explorateur de bases de
données »**. Le préfixe `API-` est celui que portent déjà `API-28` et `API-33` dans ce fichier :
**c'est le successeur des numéros de spec retirés**, et c'est lui qu'on écrit désormais dans un
commentaire de code ou dans une entrée d'ici.

### Trouver le ticket avant d'en créer un

L'ordre ne se saute pas :

1. **le ticket donné dans la demande** — un identifiant, une URL, un titre reconnaissable. Il fait
   foi, et on le lit **en entier** avant de commencer : la description porte souvent des arbitrages
   déjà tranchés et des points laissés ouverts, qu'il serait absurde de rejouer ;
2. **sinon, chercher dans le projet.** Un besoin formulé aujourd'hui a souvent déjà son ticket au
   backlog, écrit par quelqu'un d'autre, dans l'autre langue, et sous un titre qu'on n'aurait pas
   choisi. Chercher par mots-clés **et** parcourir le projet, **fermés compris** : un besoin qui
   revient est soit un défaut rouvert, soit un doublon qu'il vaut mieux lier que réécrire ;
3. **et seulement si rien ne couvre le besoin, en créer un.** Un second ticket sur un besoin déjà
   décrit coupe l'historique en deux, et c'est la moitié la moins fournie qu'on retrouve six mois
   plus tard. Dans le doute, **demander plutôt que deviner** : la question coûte moins cher que le
   doublon.

Un ticket créé porte le besoin dans les mots de qui l'a demandé, pas la solution qu'on a déjà en
tête — c'est la même raison qui fait qu'aucune modale ne nomme un objet à sa création.

### Le tenir à jour fait partie du travail

Ni le statut ni la description ne bougent d'eux-mêmes, et **un ticket faux est pire qu'un ticket
absent** : c'est le motif du commentaire qui survit à la garantie qu'il décrivait (règle n° 20),
appliqué à ce que lit quelqu'un qui n'ouvrira jamais le code. Donc :

- **le statut suit le travail au moment où il se fait**, jamais en lot à la fin : `In Progress`
  quand on commence, `In Review` quand la PR est ouverte, `Done` quand elle est fusionnée. Les sept
  états de l'équipe sont `Backlog`, `Todo`, `In Progress`, `In Review`, `Done`, `Canceled` et
  `Duplicate` ; un besoin abandonné se **ferme** en `Canceled` avec sa raison, un doublon en
  `Duplicate` vers celui qu'on garde. Laisser un ticket livré en `In Progress` fait dire au tableau
  qu'un chantier est en cours alors qu'il est en production ;
- **la description dit ce qui a été livré**, pas seulement ce qui était demandé. Chaque écart entre
  les deux s'y écrit : un arbitrage retenu contre un autre, un point ouvert tranché, une moitié
  remise à plus tard. Le *pourquoi* détaillé reste ici — le ticket en porte la version courte et le
  renvoi, sinon les deux divergent et c'est le ticket qui a tort ;
- **ce qui sort du périmètre s'en détache** : un morceau reporté devient son propre ticket, jamais
  une case grise dans celui qu'on ferme. Un ticket qu'on ferme à moitié n'est fermé pour personne.

**Ce qui ne change pas** : le message de commit reste en anglais et succinct, en
`type(scope): ce que ça fait`, **sans identifiant de ticket dans la ligne de sujet** — cinquante
caractères, et un lecteur qui n'est pas choisi. Le rattachement se fait par la PR, par le ticket
lui-même, et par l'`API-NN` écrit dans le code ou ici.

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
- **Pas de composant natif** pour les listes déroulantes : la liste maison partout. **Le sélecteur
  de date des filtres de `A5` est la seule exception**, et elle ne contredit pas la règle : ce que le
  maison remplace pour une liste — l'apparence de la liste elle-même — n'existe pas ici, un
  calendrier étant une vue à concevoir plutôt qu'un panneau à styler. Voir « Les filtres suivent la
  colonne ».
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
- **Les colonnes s'ajustent à leur contenu, sous un plafond** (2 septembre 2026, `ajustement.ts`).
  `A5` donnait 130 px à toutes ses colonnes et la console 160 : deux valeurs faute de mieux, qui
  laissaient une colonne de booléens aussi large qu'une colonne de dates. Quatre points :
  - **c'est un calcul, pas une mesure.** Les cellules sont en JetBrains Mono, dont tous les glyphes
    ont la même avance : un compte de caractères donne la largeur au pixel près, sans rendre puis
    corriger — donc sans saut visible —, et reste vérifiable sous Vitest, là où une mesure de rendu
    ne l'est pas (règle n° 9). Les deux avances employées ont été **mesurées dans le navigateur**,
    pas lues dans une table de police, et c'est un test de bout en bout qui les juge : aucune
    cellule ni aucun en-tête ne doit être tronqué sous le plafond ;
  - **le plafond est ce que la demande appelle « too large »** : au-delà, une seule colonne de texte
    libre pousse toutes ses voisines hors de l'écran, ce qui est l'inverse d'un ajustement. Ce qui
    dépasse est coupé par l'ellipse, et la poignée de redimensionnement reste là pour l'ouvrir ;
  - **un échantillon, pas la fenêtre entière** — deux cents lignes. Cinq mille lignes par
    trente-quatre colonnes font cent soixante-dix mille valeurs à rendre en texte **à chaque
    lecture** ;
  - **une largeur posée à la main l'emporte toujours**, et c'est ce qui rend le recalcul sans
    conséquence : l'ajustement est dérivé, donc il se refait à chaque lecture — filtrer peut
    resserrer une colonne —, mais ce qu'on a réglé soi-même ne bouge plus.
- **La console peut masquer une colonne, et son menu porte le retour** (2 septembre 2026). Le
  masquage y avait d'abord été refusé, faute de chemin de retour : `A5` rend une colonne masquée par
  le menu « colonnes » de sa barre d'outils, que la console n'a pas. Plutôt qu'inventer cette barre,
  l'aller porte son retour — « Réafficher les colonnes masquées (n) » vit dans le menu d'en-tête, et
  n'y paraît que s'il y a de quoi rendre. Ce qui tient l'ensemble : **la dernière colonne visible ne
  se masque pas**, l'entrée étant désactivée avec sa raison. Sans cette garde, masquer le dernier
  en-tête retirerait le seul endroit d'où l'on pouvait revenir.
- **Le clic droit ouvre un menu sur un en-tête et sur une cellule** (2 septembre 2026) — « Masquer
  la colonne » et « Copier la valeur ». C'est le geste et le composant que le panneau de ligne
  emploie déjà (`MenuContextuel`), et les libellés sont **les siens**, réemployés : la même action
  sur la même donnée ne doit pas se dire de deux façons. Cinq points à ne pas défaire :
  - **la grille n'ouvre rien elle-même.** Elle rend le geste et ses coordonnées ; masquer une
    colonne appartient à `A5`, qui tient déjà l'ensemble des masquées, et la grille de la console
    n'a pas la même liste d'actions ;
  - **elle avale en revanche le menu natif** de la webview, là où l'application propose le sien :
    deux menus qui se disputent un clic droit ne sont un choix pour personne ;
  - **il ne suffit pas d'écouter `contextmenu`.** WebKit ne le distribue pas sur un élément en
    `-webkit-user-select: none`, que `reset.css` pose sur tout le `body` : le geste marchait sous
    Chromium, donc dans toute la suite Playwright, et **ne faisait rien** dans la fenêtre de
    `pnpm tauri dev`. Les menus s'ouvrent donc aussi sur un `pointerdown` du bouton secondaire —
    `ctrl`+clic compris, qui arrive avec `button === 0`. `contextmenu` reste indispensable : son
    `preventDefault` est la seule façon de retirer le menu natif de la webview ;
  - **le clic droit ne demande pas de jumeau au clavier**, contrairement au déplacement de colonne.
    Les deux actions en ont déjà un : masquer se fait dans le menu « colonnes » de la barre
    d'outils, et copier une valeur dans le panneau de ligne. Un menu contextuel qui redouble un
    chemin existant n'est pas un chemin unique ;
  - **« Copier la valeur » copie ce qui est *affiché*.** Une saisie en attente prime donc sur la
    valeur de la base — copier l'ancienne rendrait une valeur que l'écran ne montre plus. Et une
    cellule d'une ligne ajoutée qu'on n'a pas remplie affiche « défaut », qui est un mot de
    l'interface : l'entrée y est **désactivée avec sa raison** plutôt que de copier ce mot ;
  - **la console reçoit le menu de copie, pas celui de masquage à distance.** Le masquage lui-même
    existe des deux côtés — `A5` par la barre d'outils et le menu d'en-tête, la console par le
    seul menu d'en-tête, qui porte alors son propre retour (voir ci-dessus).
- **Un schéma se regarde aussi en diagramme** (3 septembre 2026, `src/screens/Diagram/`). `A9`
  décrit **une** table et son bloc « Relations » nomme celles qu'elle touche ; l'arbre liste les
  tables sans jamais dire ce qui les relie. La forme d'un schéma — quelles tables sont au centre,
  lesquelles sont des feuilles, où sont les cycles — n'était donc lisible nulle part, alors que c'est
  la première question qu'on se pose devant une base qu'on ne connaît pas. **Aucune commande
  nouvelle** : le dessin est fait de `describe_table`, ceux-là mêmes que le panneau de détail, la vue
  Structure et l'autocomplétion lisent déjà, et il les pose dans le même cache. Neuf décisions à ne
  pas défaire :
  - **c'est un onglet, pas une troisième valeur de `VueObjet`.** Le couple « Données / Structure » est
    un état *de la table ouverte* ; un diagramme parle d'un **schéma**, et il n'y a pas de table dont
    il serait la troisième vue. Conséquence voulue, et c'est tout l'intérêt : il survit à l'ouverture
    et à la fermeture des tables qu'il montre ;
  - **il s'ouvre du menu de la ligne de schéma**, qui gagne ainsi le premier menu du dépôt à ne pas
    porter de configuration. La raison écrite dans `entreesDe` — « il n'y a rien à configurer sur un
    schéma » — reste vraie ; ce qui décide est que cette ligne est **le seul endroit du produit qui
    nomme un schéma à tout moment**. Le fil d'Ariane du centre en nomme un aussi, mais il disparaît
    dès qu'un onglet s'ouvre, c'est-à-dire précisément quand on voudrait revenir au diagramme ;
  - **la disposition est un calcul, pas une mesure** (`disposition.ts`) — l'arbitrage d'`ajustement.ts`
    à deux dimensions, et les avances de police sont **importées de lui**, pas recopiées. Mesurer le
    rendu coûterait un premier dessin à la mauvaise taille puis un repositionnement de tout le graphe
    à chaque table qui arrive, et surtout la mesure est hors de portée de Vitest (règle n° 9) ;
  - **une table se place à gauche de celles qu'elle référence**, par relaxation bornée plutôt que par
    parcours récursif : un schéma réel a des cycles, et la borne les plafonne sans demander de
    marquage. Les liens réflexifs sont écartés du calcul des couches — une table ne peut pas être à
    gauche d'elle-même — et tracés en boucle à droite, `parent_id` étant trop courant pour n'être
    rien ;
  - **la flèche s'ancre sur la *ligne* de la colonne**, aux deux bouts. C'est ce qui distingue un
    diagramme de schéma d'un graphe de dépendances : ce qu'on vient y lire est quelle colonne
    référence quelle colonne. D'où l'invariant qui gouverne l'aperçu de colonnes : **une colonne qui
    porte une clé ne se masque jamais**, même au-delà du compte d'aperçu, sans quoi une flèche
    arriverait sur « + n autres » ;
  - **des traits coudés et des couloirs, pas des courbes** (rapporté à l'usage, après essai). Le
    premier dessin employait des Béziers, chacune juste, et **elles se confondaient** : deux clés
    visant la même région donnaient ce qui se lisait comme une seule ligne épaisse, et suivre une
    flèche du regard demandait de la sélectionner. Trois segments orthogonaux aux angles arrondis
    remplacent la courbe — deux droites qui se croisent se lisent comme un croisement — et chaque
    lien reçoit un **couloir** dans la gouttière qu'il traverse, attribué du plus court parcours
    vertical au plus long, de sorte qu'aucune verticale n'en recouvre une autre. Le coude se place
    dans la gouttière qui précède la **cible**, pour que toutes les flèches entrant dans une table y
    arrivent droit, à des hauteurs séparées.

    **« Aucune verticale n'en recouvre une autre » a été faux pendant tout ce temps**, et de deux
    façons à la fois (4 septembre 2026, rapporté à l'usage : « deux traits verticaux ne devraient
    jamais être dessinés l'un sur l'autre ; c'est acceptable pour les horizontaux, il le faut bien
    quand ils convergent vers la colonne d'identité d'une table »). Les deux valent d'être connues :

    - **les rangs bouclaient.** Les couloirs s'éloignaient du bord par pas fixe de 14 px et le rang
      était pris modulo ce que la gouttière tenait — cinq. Un commentaire assumait le compromis,
      « deux traits confondus valent mieux qu'un trait passant sous une boîte », en ajoutant que le
      cas « ne se présente qu'à partir de six clés entrant dans une même colonne » : c'est-à-dire
      **dès le premier moyeu**, ce que toute base réelle a. Le pas se resserre désormais au lieu de
      boucler, et reste à 14 px tant qu'il y a de la place — donc aucun dessin existant ne bouge
      d'un pixel ;
    - **et « en avant » et « en arrière » ne partageaient pas leur gouttière.** Les deux sortes
      comptent leurs couloirs depuis le **bord gauche d'une colonne**, vers la gauche, mais sous
      deux identités différentes (`avant:k` et `arriere:k`) : chacune attribuait donc son rang 0, à
      la même abscisse. Aucun compte de couloirs n'aurait corrigé celle-là — c'est une seule
      gouttière physique décrite deux fois. Une seule identité, `colonne:k`, depuis.

    **Ce qui reste, et qu'aucun réglage ne lève** : une gouttière de 86 px a une largeur finie, donc
    quarante liens y sont à deux pixels l'un de l'autre — distincts, non lisibles. L'issue serait un
    écart horizontal qui suive la demande de chaque gouttière, mais élargir à quarante couloirs
    demanderait 574 px entre deux colonnes, ce qui abîmerait tout le schéma pour un seul moyeu. C'est
    une décision de dessin, et elle n'est pas prise.

    **Et une leçon de test, la règle n° 1 par un bout qui coûte cher** : la propriété demandée — deux
    verticales ne se recouvrent pas — **dépend du décor**, puisque deux verticales à la même abscisse
    dont les ordonnées sont disjointes ne se recouvrent pas. Le premier test écrit pour cela est
    resté **vert sous le sabotage du bouclage** : sur son décor, le modulo appariait justement un
    lien qui monte vers le moyeu avec un lien qui en descend. Le test garde donc aussi le
    **mécanisme** — dans une gouttière, deux liens n'ont jamais la même abscisse —, qui est vrai de
    tout décor. Sans les deux assertions, l'une ou l'autre des deux causes passait ;
  - **choisir une table éclaire les colonnes de ses clés, aux deux bouts** (rapporté à l'usage).
    Surligner les traits dit *qu'*une table en référence une autre, pas **par quelle colonne** — or
    c'est la question qu'on se pose en choisissant une boîte. La clé étrangère s'allume chez celle
    qui référence, la colonne référencée chez l'autre, et l'un ou l'autre bout donne le même couple.
    La marque porte sur le **fond et l'encre** : une couleur seule ne doit pas porter une
    information ;
  - **les deux moitiés d'une clé sont le même lien.** Le catalogue la rend sortante chez l'une et
    entrante chez l'autre ; les collecter des deux côtés puis dédupliquer par `(source, contrainte)`
    fait paraître la flèche dès que **l'un** des deux bouts est lu — ce qui compte, les structures
    arrivant une par une. Le nom de la contrainte fait partie de l'identité : `created_by` et
    `updated_by` vers `users` sont deux flèches ;
  - **le plafond de tables valait soixante, et c'était un jugement pris à la place de
    l'utilisateur** (3 septembre 2026, après la question « pourquoi 60 des 124 tables ? lesquelles ne
    sont pas affichées ? »). Les deux raisons qui le justifiaient avaient disparu entre-temps : la
    lecture est douze fois plus rapide depuis les lectures ensemblistes et les lots, et les trois
    défauts de disposition qui rendaient un grand dessin illisible sont corrigés. Ne restait qu'un
    « au-delà, ça ne se lit plus » qui retirait du dessin soixante-quatre tables sur cent
    vingt-quatre. Il vaut **trois cents**, le nombre que le préchauffage emploie déjà avec la
    justification que ce fichier avait reprise. Et quand il mord, l'infobulle dit désormais le
    **critère** — l'ordre alphabétique — puis **les noms** : un compte dit qu'il manque quelque
    chose, une liste dit quoi. Le critère est avoué parce qu'il n'en est pas un : rien de ce qu'on
    sait avant d'avoir lu les structures — un `TableSummary` ne porte ni clé étrangère ni degré — ne
    permettrait de garder « les plus reliées » plutôt que « les premières de l'alphabet ». Le tri
    rend au moins la coupe reproductible.
  - **ce qui n'est pas dessiné est dit.** Les clés dont l'autre bout est hors du schéma n'ont pas de
    boîte où arriver, et les tables au-delà du plafond ne sont pas demandées : la barre d'état porte
    les deux nombres. Un diagramme amputé en silence se lirait comme un schéma complet, ce qui est le
    pire défaut que cette vue puisse avoir ;
  - **les boîtes sont du HTML, les liens du SVG.** Tout en SVG aurait demandé de réinventer l'ellipse
    d'un nom trop long, le survol, le focus, un rôle et un nom accessible — or une boîte est
    **cliquable**, un diagramme dont on ne peut pas ouvrir une table étant une image. Corollaire :
    son nom accessible vient d'un `aria-label`, le contenu concaténé rendant
    « ordersidint8user_id… » — le piège n° 1 dans une forme qu'aucune espace explicite n'arrangerait ;
  - **on y cherche une table *ou* une colonne, et la recherche ne redispose rien** (3 septembre
    2026, à la demande). Deux décisions, chacune avec sa raison :
    - **les deux, tables et colonnes.** « Où est `orders` ? » et « qui porte un `deleted_at` ? » sont
      les deux questions qu'on pose à un schéma, et la seconde n'avait aucune réponse dans le
      produit : l'arbre ne filtre que des libellés, la vue Structure ne cherche que dans **une**
      table. La recherche porte sur les **structures**, non sur le dessin — chercher dans les seules
      lignes visibles aurait rendu « aucune » pour une colonne que l'aperçu masque. Conséquence
      assumée : une table peut être trouvée par une colonne qu'on ne voit pas, et l'interrupteur
      « Toutes les colonnes » est juste à côté pour voir pourquoi. Ne pas la marquer aurait été taire
      une réponse juste ;
    - **elle marque, elle ne filtre pas.** Masquer les tables qui ne correspondent pas aurait
      redisposé le graphe à chaque frappe — or la disposition est *dérivée*, donc elle se refait
      entièrement, et le dessin sauterait sous les doigts de celui qui tape. Les tables trouvées sont
      donc **cerclées** en `--info`, les autres s'**effacent** — leurs liens avec elles, sinon les
      traits gardent toute leur force au-dessus d'un dessin éteint et le dominent. Ni l'un ni l'autre
      n'emprunte l'accent, qui dit « désigné ».
    Le déplacement, lui, est explicite : **`Entrée` emmène** à la correspondance suivante et boucle,
    la frappe se contentant de marquer. **`Échap` et un bouton la vident** (3 septembre 2026, à la
    demande) : la recherche éteint la moitié du dessin, donc en sortir doit coûter un geste et non
    huit reculs. Le bouton ne paraît que s'il y a de quoi vider — un contrôle inerte mais actif se
    lit comme une panne —, il **rend le focus** au champ, et `Échap` est son jumeau au clavier,
    l'idiome qu'ont déjà la cellule de filtre, le renommage et le nom de projet. Le champ a cessé
    d'être un `<label>` pour l'accueillir : une étiquette ne doit contenir aucun contenu interactif
    hors le champ qu'elle nomme, et elle ne nommait rien — l'`aria-label` du champ l'emporte. Faire défiler à chaque caractère serait désorientant sur une
    toile de plusieurs milliers de pixels, et le compte affiché dans le champ dit d'avance s'il y a
    quelque part où aller — « aucune » plutôt qu'un champ muet qui laisserait croire qu'il cherche
    encore.
  - **un interrupteur nommé « Toutes les colonnes », et non un contrôle segmenté « Clés | Toutes »**
    (rapporté à l'usage). Les deux mots ne disaient pas ce que le réglage *fait* : on lisait « Clés »
    comme un filtre sur une nature de colonne, sans comprendre que des lignes étaient **masquées**.
    La forme d'un interrupteur éteint l'annonce, et la ligne « + n autres » de chaque boîte dit
    combien. C'est le `Toggle` de `ui/`, avec son libellé posé dans le diagramme — non le
    `ToggleWithLabel` d'`A2`, qui l'habille avec la feuille de style de son écran ;
  - **un témoin tourne pendant la lecture, dans la bande d'outils** (rapporté à l'usage) — et la
    barre d'état garde le compte. Les deux ne se répètent pas : le témoin dit **que** ça travaille,
    là où le regard est en attendant un dessin ; la barre dit **où en est** la lecture, à vingt-six
    pixels du bas où personne ne la regarde à ce moment-là. La rotation est celle de `Toolbar`,
    valeurs comprises, et `prefers-reduced-motion` la retire en laissant le texte — ignorer ce
    réglage est un défaut d'accessibilité, pas un choix esthétique ;
  - **chaque table se pose en face de celles auxquelles elle est liée, et les tables sans lien
    sortent du flux** (rapporté à l'usage, sur un vrai schéma). Deux règles, un même défaut : « un
    très grand espace vide, puis quatre tables tout à droite ». La première version centrait chaque
    colonne sur la hauteur de la plus haute — juste quand elles se ressemblent, faux dès qu'une seule
    les dépasse : une colonne de cinquante tables plaçait les quatre de la dernière à trois mille
    pixels du haut, seules au milieu d'un vide. L'ordonnée d'une boîte est donc le **barycentre des
    centres de ses voisines déjà placées**, l'empilement ne l'écartant que pour éviter un
    chevauchement — le pendant vertical du barycentre qui ordonne déjà les colonnes. Et une table
    qu'aucun lien du schéma ne touche n'appartient pas à un flux de références : c'est une **liste**,
    rangée en grille sous le graphe. C'est elle qui gonflait la première colonne, une base réelle en
    comptant des dizaines ; mesuré, un schéma de soixante tables dont quarante-quatre sans clé passe
    d'une colonne de plus de quatre mille pixels à une toile de 974 × 1788. Cas limite voulu : un
    schéma sans aucune clé étrangère devient une grille compacte. Corollaire à ne pas perdre : une
    boîte peut se poser **au-dessus de zéro** quand son souhait vient d'une voisine plus haute, donc
    la toile est renormalisée sur sa marge — un dessin au coin haut-gauche négatif sortirait de sa
    zone défilante par le haut, là où aucun défilement ne va ;
  - **le graphe est rendu acyclique avant d'être stratifié** (rapporté à l'usage, troisième tour :
    « des tables tout à droite, et des flèches extrêmement longues »). C'est la première étape du
    dessin en couches, et les deux corrections précédentes l'avaient sautée. Le calcul relâchait
    `couche(cible) ≥ couche(source) + 1` sur **tous** les liens, borné au nombre de tables : sur un
    graphe acyclique il se stabilise et rend le plus long chemin, sur un cycle il ne se stabilise
    **jamais** et la borne devient la réponse. Le commentaire qui vivait là affirmait le contraire —
    « un cycle plafonne simplement à la longueur du chemin qu'il permet » — et c'était faux : il
    plafonne au nombre de tables du schéma. Mesuré sur trente tables, une étoile banale plus **un
    seul** cycle de trois : **quatre-vingt-onze colonnes**, une toile de 20 164 px, et les trois
    tables du cycle abandonnées aux colonnes 88 à 90 pendant que les vingt-sept autres tenaient dans
    les deux premières. Après : **trois colonnes**, 628 px. Un parcours en profondeur écarte donc les
    liens qui referment un chemin — de ce calcul et de lui seul : ils restent tracés, vers l'arrière.
    **Aucun décor ne l'avait vu** : le seul qui portait un cycle n'avait que deux tables, où une
    borne de deux itérations ne peut pas faire de mal. Un décor trop petit ne mesure que le décor
    (règle n° 5), et c'est ici que ça a coûté le plus cher.
  - **et chaque table se resserre contre ses voisines** (rapporté à l'usage : « des liens
    extrêmement longs »). Le calcul des couches place chaque table à sa colonne **minimale**, donc
    une table qu'aucune autre ne référence reste en colonne 0 même quand rien ne l'y oblige. Sur un
    schéma réel, cela donne exactement le signalement : une table centrale — `users`, `account` — est
    poussée loin à droite par la plus longue chaîne qui la référence, et **toutes** ses autres
    référentes lui tirent un trait depuis l'autre bout du dessin. Mesuré sur un décor de dix tables
    en chaîne plus six feuilles vers la dernière : six liens de neuf colonnes de portée, 1862 px
    chacun ; après resserrage, une colonne et 86 px — l'écart horizontal, donc le minimum possible.
    La règle n'a pas de réglage : la longueur totale des liens d'une table vaut
    `colonne × (entrants − sortants)` plus une constante, donc son minimum est toujours à une
    **borne** — au plancher quand les entrants dominent, au plafond quand ce sont les sortants, et
    sur place à égalité, parce qu'un déplacement qui ne gagne rien ferait changer le dessin d'une
    lecture à l'autre. Chaque déplacement fait strictement décroître une somme entière positive : la
    boucle converge d'elle-même. Un cycle rend les deux bornes contradictoires — la table reste alors
    où la relaxation l'a mise, faute d'une position qui satisfasse tout le monde.
  - **il lit son schéma par lots, et c'est ce qui l'a rendu utilisable** (rapporté à l'usage : « il
    faut quelques minutes sur une grosse base »). Le chargeur lisait table par table, et sur un
    schéma de soixante tables cela faisait soixante traversées de l'IPC, soixante prises du verrou du
    registre et trois cent soixante allers-retours SQL, tous sérialisés — le verrou du registre est
    tenu pendant chaque opération, délibérément, donc **la concurrence côté écran n'y aurait rien
    changé**, ce qui est la première idée qu'on a et la mauvaise. Les lots de douze ramènent cela à
    cinq traversées et trente allers-retours. Deux raisons de ne pas tout demander d'un coup, qui
    seraient le plus rapide au chronomètre : le verrou serait tenu le temps du schéma entier — donc
    la table qu'on clique pendant le dessin attendrait derrière lui — et le dessin arriverait d'un
    bloc après une attente muette, là où les lots le remplissent par paliers visibles.
  - **la molette défile, elle ne zoome pas.** `⌘` + molette appartient à `useZoom`, et le pincement
    du trackpad y est refusé activement depuis le 26 août 2026 : un second zoom sur les mêmes gestes
    ferait dépendre l'échelle de qui écoute l'événement le premier. Les paliers sont donc des boutons,
    et le glissement du fond déplace la vue.
  - **et deux tables choisies disent ce qui les relie** (3 septembre 2026, à la demande).
    Sélectionner **une** table éclaire ses voisines immédiates : « qu'est-ce qui touche `orders` ? ».
    L'autre question restait sans réponse nulle part — « qu'est-ce qui relie `orders` à
    `shipment_batches` ? » —, et c'est celle qu'on se pose avant d'écrire une jointure, précisément
    parce qu'aucune clé ne relie directement ces deux tables-là. Un `⇧`-clic adjoint donc une seconde
    table, et le plus court chemin de clés paraît **écrit**, colonne par colonne, dans une bande sous
    la barre d'outils. Sept décisions :
    - **le parcours est non orienté, et c'est tout l'intérêt.** `orders` et `invoices` qui
      référencent toutes deux `users` sont bel et bien reliées ; ne suivre que le sens des flèches
      n'aurait rien eu à dire du cas le plus courant. Le sens de chaque clé n'est pas perdu pour
      autant — `Etape.remonte` le porte, et c'est lui qui décide de la flèche affichée, `←` ou `→`.
      Dire l'inverse ferait écrire la jointure à l'envers, ce qu'aucun autre champ ne rattraperait ;
    - **le plus court, par parcours en largeur** : c'est le plus court à lire et la jointure la plus
      courte à écrire. Il peut en exister plusieurs de même longueur ; celui qui sort est décidé par
      l'ordre des liens, trié par identité, donc le même schéma rend toujours la même réponse ;
    - **la première choisie est l'ancre.** Un troisième `⇧`-clic remplace la **seconde**, jamais la
      première : on garde `users` sous la main et l'on essaie l'une après l'autre les tables dont on
      se demande comment elles s'y rattachent. Remplacer la première rendrait chaque comparaison
      indépendante de la précédente, ce qui n'est jamais ce qu'on veut ;
    - **la bande paraît dès la première table choisie**, pour y annoncer le geste. `⇧`-clic est le
      geste d'extension universel et ne s'annonçait nulle part : un geste qu'on ne peut pas deviner
      n'existe pas. Elle est **dans le flux**, non posée sur la toile — une carte flottante n'aurait
      rien décalé, mais elle aurait recouvert le dessin dont elle parle. Et `⇧Espace` fait au clavier
      ce que le `⇧`-clic fait à la souris, pour la raison du renommage des consoles ;
    - **un chemin resserre la marque sur lui seul.** Quand deux tables sont choisies et qu'une suite
      de clés les relie, la question n'est plus « qu'est-ce qui touche cette table » mais « par où
      passe-t-on » : garder en plus tous les liens incidents des deux bouts allumerait un hub comme
      `users` en entier. Les tables **traversées** portent l'anneau d'accent sans l'en-tête teintée
      des deux choisies — « on passe par ici » n'est pas « j'ai désigné ceci », et la bande nomme les
      trois par écrit ;
    - **et adjoindre une seconde table efface la recherche** (rapporté à l'usage : « la relation est
      partiellement masquée »). Les deux gestes emploient les mêmes canaux en sens contraire : une
      recherche **efface** les tables qu'elle ne désigne pas, or le chemin passe justement par des
      tables qu'on n'a pas cherchées — elles arrivaient à 32 % d'opacité, et la réponse était à
      moitié illisible au moment même où on la demandait. Marquer le chemin plus fort n'aurait rien
      réglé : ce qui manque à une table éteinte est le contraste, pas l'accent. **Seulement à la
      seconde table** : une table choisie et une recherche coexistent très bien — c'est même ce
      qu'`Entrée` produit, qui désigne la correspondance où il emmène —, et effacer dès la première
      rendrait ce parcours impossible, chaque `Entrée` vidant le champ qu'on vient de remplir.
    - **« aucun chemin » ne prétend jamais plus que ce que le dessin contient.** Tant que toutes les
      tables du schéma n'y sont pas — lecture en cours, ou plafond qui mord —, la phrase devient
      « parmi les tables dessinées ». C'est l'honnêteté des deux nombres de la barre d'état, sur une
      autre affirmation. Et **la flèche est retirée de l'arbre d'accessibilité**, un verbe masqué en
      `clip-path` la remplaçant avec ses espaces : une voix qui rendrait « orders.user_id users.id »
      ne dirait plus laquelle référence l'autre (pièges n° 1 et n° 2 dans la même ligne).

    **Deux gardes de moins, dénoncées par le sabotage** (règle n° 1), et ce sont les deux mêmes
    familles que celles déjà relevées ici. Le parcours écartait explicitement les clés réflexives :
    inutile, une table déjà vue étant déjà écartée, et la retirer laissait la suite verte. Et le
    décor qui prétendait garder « le plus court chemin » opposait un saut à deux — or le saut unique
    part du **départ**, donc il est vu au premier tour quel que soit l'ordre de visite : un parcours
    en profondeur y répondait juste. Il oppose désormais deux sauts à trois, avec le détour placé là
    où le tri des liens le fait visiter en second, donc là où une pile le prendrait en premier.
  - **et un `1:1` ne se dessine pas comme un `1:n`** (3 septembre 2026, à la demande). Le dessin
    disait *qu'*une table en référence une autre, jamais **combien de fois** — or c'est la première
    chose qu'on lit sur un schéma, et celle qui décide de ce qu'une jointure va rendre. Un demi-cercle
    marque désormais le départ des liens `1:n`, une barre celui des `1:1`. Six décisions :
    - **la réponse vient du catalogue, et il a fallu l'y aller chercher.** Ce qui sépare les deux est
      l'unicité des colonnes qui **référencent** : clé primaire, contrainte `unique`, ou index unique
      total. L'écran ne pouvait pas la déduire de ce qu'il recevait — `KeyKind` ne connaît que
      `primary` et `foreign`, et `IndexInfo` ne porte qu'une `definition`, le texte que le moteur
      rend. La relire en TypeScript aurait voulu dire analyser la sortie de quatre catalogues qui ne
      l'écrivent pas pareil. `Relation` porte donc un `cardinality`, calculé dans les trois moteurs
      relationnels ; c'est le pendant exact de la règle du DDL — ce que le moteur sait, on le lui
      demande. **Le raccourci qu'on aurait pu prendre** — « `1:1` si la clé étrangère est la clé
      primaire », déductible côté écran sans rien changer au Rust — aurait rendu `1:n` toute clé
      unique sans être primaire, **en silence**, ce qui est le défaut que cette vue tolère le moins ;
    - **le côté référencé est toujours *un*** — une clé étrangère ne peut viser que des colonnes
      uniques —, donc il n'y a qu'un bout où il y ait quelque chose à dire. La marque est au
      **départ**, et la flèche reste à l'arrivée : elle donne le sens, ce qui n'est pas la même
      information, et une flèche qui disparaîtrait serait un lien qui ne dit plus où il va ;
    - **la cardinalité ne dépend pas du sens sous lequel on rencontre la clé.** C'est une propriété
      de la contrainte, pas du regard : les trois moteurs la lisent toujours sur la table qui
      référence, donc les deux moitiés s'accordent — ce dont la déduplication de `liensDe` dépend,
      elle qui garde la première vue sans les comparer. Un test par moteur le vérifie **des deux
      bouts** ;
    - **elle s'écrit aussi en toutes lettres.** Une marque ne dit rien à qui ne connaît pas la
      notation, et un `marker` SVG n'a aucun texte qu'une voix puisse rendre : l'infobulle d'une
      ligne porte « un à un » / « un à plusieurs », et la bande de relation la notation `1:1` / `1:n`
      doublée du mot en texte masqué ;
    - **trois pièges par moteur, et chacun un faux `1:1`.** Ils ne se ressemblent pas d'un catalogue
      à l'autre, et aucun ne se serait vu sans un décor fait pour lui (règle n° 5) : un index unique
      **partiel** ne garantit rien des lignes qu'il ne couvre pas ; les colonnes d'un `include`
      (Postgres) ou une part **fonctionnelle** (`lower(a)`, MySQL et SQLite) ne participent pas à
      l'unicité ; et un `integer primary key` de SQLite n'apparaît **dans aucun index**, étant un
      alias de `rowid` — c'est pourtant le `1:1` le plus courant du moteur. Deux d'entre eux
      demandent d'écarter l'index **entier** plutôt que ligne à ligne : `unique (code(10), compte_id)`
      dont on ne retirerait que la ligne préfixée laisse l'ensemble `{compte_id}`, qui répond « oui »
      à une clé étrangère sur `compte_id` seule alors que rien n'y garantit son unicité.
    - **et la marque du côté « plusieurs » est un demi-cercle, dessiné en `<path>` et non en
      `<marker>`** (4 septembre 2026, à la demande, en quatre tours : « plus rond, comme un
      trident », « comme une fourchette », « comme un demi-cercle », puis « le demi-cercle reste
      surligné pour toujours »). La patte d'oie d'origine était trois segments droits convergents —
      la notation canonique, et le seul endroit du dessin à porter un angle vif, alors que tout le
      reste est fait de coudes arrondis et que la courbe avait justement été bannie des liens pour
      cette raison. Ce que la notation exige est qu'un bout de lien se distingue de l'autre et qu'on
      sache lequel se multiplie ; la patte d'oie est *une* façon de le dire, pas la seule. Quatre
      choses apprises, et les trois dernières valent au-delà de cet écran :
      - **une forme à treize pixels se règle en proportions, et la forme la plus simple gagne.**
        Quatre dessins : trois segments convergents (des angles vifs) ; des dents parallèles
        ramenées par une traverse d'angle droit (un crochet — des dents d'à peine une épaisseur de
        trait) ; des dents cintrées convergeant sans partie droite (un double chevron, le raccord
        prenant plus de place que les dents) ; puis le demi-cercle, **une seule commande d'arc**,
        aucun raccord à proportionner, et rien qui puisse se confondre avec son propre trait ;
      - **`markerUnits` vaut `strokeWidth` par défaut, et c'est un piège muet** — la cause des deux
        échecs du milieu, et elle n'était pas dans le tracé. La boîte d'un `marker` s'exprime alors
        en **multiples de l'épaisseur du trait marqué** : une marque de 9 posée sur un lien de 1,4
        occupe 12,6 px, sa `viewBox` de 10 s'y étire d'un facteur 1,26, et son trait de 1,6 est
        peint à **2 px** — 44 % de plus que le lien qu'elle termine. Les cotes qu'on croit poser en
        pixels n'en sont donc pas, et rien ne le dit : le rendu est *plausible*, simplement gras.
        **On ne règle pas des proportions dans une unité qu'on ignore** ;
      - **et c'est ce qui a fait renoncer aux `marker` tout court.** Le dessin en avait deux
        exemplaires par forme — l'ordinaire et l'accentué — et chaque trait basculait sa *référence*
        de l'un à l'autre selon qu'il était choisi. Le DOM était juste dans tous les états, mesuré
        sur toutes les sélections du décor ; **la webview de l'application gardait le dessin
        précédent**, donc l'accent restait, par intermittence. Rien ne se reproduit sous Chromium,
        sans tête comme avec : le seul endroit où le défaut existe est WKWebView, que rien de cet
        outillage ne pilote. **Le fait qui a tranché est que les traits, eux, se repeignaient
        correctement** — alors les marques sont devenues des traits : trois `<path>` par lien, avec
        les classes du trait, dans le même `<g>` que lui. Il n'y a plus de ressource `marker` à
        invalider, donc plus de famille de défaut à laquelle échapper — et non un contournement d'un
        bogue qu'on ne sait pas mesurer. Quatre choses gagnées, qui rendent l'échange favorable même
        sans le défaut : l'égalité d'encre et d'épaisseur devient **structurelle** (les mêmes
        déclarations, non deux valeurs à tenir en phase, ce qui avait déjà coûté deux signalements) ;
        le piège de `markerUnits` disparaît avec sa cause ; une marque ne peut plus se retrouver
        au-dessus d'un trait accentué, puisqu'elle voyage avec le sien ; et **une marque devient
        mesurable** — un `marker` vit dans `<defs>`, donc sa boîte englobante est nulle par
        construction, et aucun test ne pouvait constater qu'il avait peint quelque part. Ce qui se
        perd est `orient="auto"` : `Lien.sensDepart` et `Lien.sensArrivee` portent désormais le sens
        de parcours, ce qui suffit puisque le tracé est orthogonal ;
      - **rien de tout cela ne se voit autrement qu'à la loupe.** Aucun test ne garde le tracé
        lui-même, et il aurait raison de ne pas le faire : un `d` recopié dans une assertion se
        périme au premier ajustement de forme, et celui-ci en a connu quatre. Ce que les tests
        gardent est l'**ancrage** — chaque marque s'appuie contre un bord de boîte à l'épaisseur d'un
        trait près, ce qui remplace `refX` et `orient` d'un coup — et le fait d'avoir peint. La seule
        mesure qui juge la forme est une capture à `deviceScaleFactor: 6`, **regardée**. C'est la
        méthode qui a le plus payé, appliquée à treize pixels. Piège rencontré en l'écrivant : la
        boîte englobante d'un `<path>` est sa **géométrie**, sans l'épaisseur du trait, donc la barre
        du `1:1` est large de **zéro** — le trait qu'on voit n'est pas dans la boîte qu'on mesure.
  - **et un trait de lien est opaque** (4 septembre 2026, rapporté à l'usage : « la couleur
    n'est pas cohérente là où deux traits se superposent »). Ils portaient `--ink-5`, une encre
    à 30 % : deux couches sur la même toile donnent 1 − 0,70² = 51 %, donc le croisement se
    peint plus sombre que tout le reste du dessin — à l'endroit précis où l'œil cherche à suivre
    un trait, et avec l'aspect d'une désignation alors que rien n'y est désigné. `--link` est le
    **composite exact** de cette encre sur `--canvas`, donc un trait seul ne bouge pas d'une valeur
    et seuls les croisements changent. Trois points :
    - **ce ne pouvait pas être un `--ink-*` de plus.** Le composite dépend du fond, donc chaque
      thème a le sien — c'est exactement ce que l'échelle d'encres ne peut pas exprimer, ses
      valeurs étant *une* couleur à des opacités croissantes ;
    - **`.lienEteint` garde son `opacity`**, qui est un effacement voulu, porte sur l'élément et
      non sur l'encre, et ne paraît que pendant une recherche ;
    - **le test garde la cause, pas la conséquence.** Comparer la couleur d'un croisement à
      celle d'un trait seul demanderait un croisement *dans le décor* — donc un décor à
      maintenir pour cette seule question, et un test muet le jour où la disposition cesse d'en
      produire un. Ce qui est vrai indépendamment du dessin est qu'une encre translucide ne peut
      pas se superposer à elle-même sans s'assombrir : cela tient dans un canal alpha, et se
      mesure sur n'importe quel trait. Vérifié par sabotage sur les deux moitiés, le lien et la
      marque.
  - **et les liens se peignent du fond vers la surface : éteint, ordinaire, accentué** (4 septembre
    2026, rapporté à l'usage : « parfois un trait gris est rendu au-dessus d'un trait surligné,
    pareil pour les flèches »). SVG n'a pas de `z-index` — il peint dans l'**ordre du document** —,
    et l'ordre était celui de la disposition, qui ne sait rien de ce qui est désigné. Trois points :
    - **c'est ce qui expliquait le signalement d'avant**, « le surlignage ne s'applique pas à la
      marque ». Deux liens qui partent de la même ligne de colonne posent leurs deux marques **au
      même pixel** : l'accentuée était bien là et bien accentuée — le DOM le disait, et un balayage
      de toutes les sélections l'a confirmé —, mais la grise du lien voisin se peignait après, donc
      dessus. **Un défaut de recouvrement se présente comme un défaut de couleur**, et se cherche
      en vain dans la couleur ou dans le câblage ;
    - **les deux extrêmes ont la même justification par les deux bouts** : ce qu'une recherche
      efface ne doit pas recouvrir ce qu'elle désigne, et ce qu'une sélection désigne ne doit rien
      avoir au-dessus ;
    - **le tri est stable, et peindre n'est pas disposer.** L'ordre de `vue.liens` est déterministe
      et les couloirs de la disposition en dépendent : il survit à l'intérieur de chaque rang, et
      rien ici ne déplace un trait. Le test garde l'**ordre du document**, qui est la cause et vaut
      pour tous les recouvrements à la fois — y compris ceux que ce décor-ci ne produit pas.
  - **une marque ne déclare ni encre ni épaisseur** (4 septembre 2026, deux signalements : « le
    surlignage d'un trait ne s'applique pas à la marque », puis « le demi-cercle reste surligné pour
    toujours »). Elle portait un gris d'un cran plus sombre « pour mieux se lire », donc aucun état
    du lien n'avait l'air de l'atteindre : à l'arrêt elle ne partageait pas son gris, et l'accent
    d'une sélection semblait s'arrêter au bord de la boîte. **Une marque n'a pas besoin d'un gris à
    elle pour se distinguer — c'est une forme**, et à épaisseur et teinte égales elle se lit très
    bien. Elle porte donc `styles.lien` et l'état du trait, c'est-à-dire *les mêmes déclarations*, et
    `.pointe` ne garde que ce qui lui est propre : ses bouts arrondis. Tant que les deux jeux de
    valeurs étaient écrits séparément, la question pouvait revenir — et elle est revenue deux fois.
    C'est la même règle que l'épaisseur : *une marque est le trait qui se termine, pas un second
    trait posé à son bout*.

    **Et le premier `⇧`-clic a dénoncé un nom accessible en double** : les boutons de zoom
    s'appelaient « Réduire » et « Agrandir », exactement comme les commandes de fenêtre de la barre
    de titre Windows. Deux boutons de la même fenêtre portaient donc le même nom — le piège n° 1 par
    un bout qu'aucune espace n'arrange —, et trois tests e2e ne savaient plus lequel viser dès que la
    suite tournait sur une machine Windows. Ils nomment maintenant ce qu'ils agrandissent. **Aucun
    test unitaire ne pouvait le voir** : `DiagramView` monté seul n'a pas de barre de titre autour de
    lui, et c'est la règle n° 8 sous une forme de plus — un composant juste dans sa vitrine ne prouve
    rien de l'assemblage.

  **Trois choses apprises en le vérifiant, et les trois par sabotage.** Elles valent au-delà de cet
  écran :

  - **le rendu ne tombait pas où le calcul le mettait.** Le dépôt ne pose aucun reset `box-sizing`
    (voir `reset.css`) : la bordure d'une boîte décalait son contenu d'un pixel et le filet de son
    en-tête d'un second, si bien que les flèches arrivaient deux pixels sous leurs lignes. Le DOM
    était juste, tous les tests unitaires verts. La bordure est donc peinte en **ombre interne**, de
    sorte que la boîte occupe exactement ses cotes calculées ; l'autre issue aurait été d'apprendre
    l'épaisseur du trait au module de calcul, donc de faire vivre un même fait dans une constante
    *et* dans une feuille de style ;
  - **le chrome d'une ligne se compte, il ne s'estime pas.** La première version réservait 30 px hors
    texte « comme une cellule de grille » ; la CSS en consomme 36, et les six pixels manquants
    coupaient **tous** les `timestamptz` du décor — vu à l'œil sur une capture, invisible à la suite
    entière. Un test de bout en bout garde désormais qu'aucun nom ni aucun type n'est coupé **sous le
    plafond**, comme `ajustement.ts` a le sien ;
  - **deux gardes qui se couvrent l'une l'autre ne se dénoncent pas.** Le chargeur testait son témoin
    de démontage avant *et* après son `await` : retirer l'une laissait la suite verte, donc aucune des
    deux n'était gardée (règle n° 1). En n'en laissant qu'une, on gagne au passage le bon
    comportement — une table déjà payée est posée dans le cache même si l'onglet s'est fermé, ce
    cache appartenant à l'écran et non à l'onglet. Et le test qui l'observe ne mord que si le double
    **tient ses réponses à la main** : quand il répond tout de suite, la boucle s'achève avant qu'on
    ait pu l'interrompre, et il n'y a plus rien à mesurer.

- **Le mode édition s'ouvre aussi d'un bouton** (8 septembre 2026, `API-28`). Il ne s'ouvrait qu'au
  `⌘E` de l'écran de travail, annoncé par une phrase de la barre d'état — 26 px de texte qui *disent*
  le raccourci sans rien offrir à cliquer. C'est la raison qui a déjà fait doubler le `⇧`-clic du
  diagramme et le renommage des consoles : **un chemin unique au clavier est un chemin que personne
  ne trouve**. Quatre points :
  - **le raccourci et le bouton appellent la même fonction**, `basculerLEdition`, plutôt que deux
    mécaniques qui écriraient le même `Set` — l'idiome de la croix d'un chip et du champ de filtre
    qu'elle vide. Deux voies pour un même acte en laissent une en arrière (règle n° 17), et ici la
    seconde est arrivée un mois après la première ;
  - **le nom du bouton ne bouge pas, `aria-pressed` porte l'état.** « Éditer » puis « Quitter
    l'édition » ferait changer de nom sous le doigt qui vient de le trouver ; c'est le motif de
    l'épingle du panneau de détail et du choix d'une table dans le diagramme ;
  - **le crayon dans les deux états, et non un verrou qui deviendrait crayon** (rapporté à l'usage :
    « l'interface n'est pas claire »). Le premier jet montrait le cadenas de la barre d'état au repos,
    ce qui disait l'état *courant* là où un bouton doit dire l'**acte** qu'il offre : on lisait un
    cadenas, on ne devinait pas qu'on pouvait l'ouvrir. La barre d'état, elle, garde ses deux icônes —
    elle **décrit** là où le bouton **agit** ;
  - **la pastille sombre porte donc l'état seule, et elle en a les moyens.** Le fond allumé est celui
    d'`A9` pour dire quelle vue est à l'écran (`ColonneDroite.vueActive`), non `--accent`, qui veut
    dire « désigné » et que les préférences laissent recolorer. Ce n'est pas une teinte posée sur un
    fond inchangé : le fond **et** l'encre s'inversent, donc la distinction tient sans la couleur, et
    `aria-pressed` la dit à qui ne voit ni l'une ni l'autre. Ce n'est pas non plus un état de survol
    inventé — c'est l'état d'un contrôle ;
  - **le drapeau `edition` de `Workbench` est parti avec.** Il forçait le mode au montage pour la
    démo de `11a`, plus personne ne le passait depuis que `11b` a livré la bascule, et son
    commentaire l'affirmait encore — le motif du `var()` mort et du `grid-column` inerte. Laissé en
    place, il aurait rendu un bouton qui allume sans pouvoir éteindre, c'est-à-dire le défaut n° 36
    au moyen de son propre remède.

  **Ce que la galerie ne pouvait pas prouver** : que le bouton est branché à l'onglet, seul endroit
  où ce mode existe. Elle monte la barre sans écran autour d'elle — d'où un test qui part de l'écran
  de travail et regarde la **grille** suivre le bouton (règle n° 8), et un second qui vérifie que le
  raccourci ferme ce que le bouton a ouvert.

  **Et son infobulle a dénoncé un défaut de `Tooltip` vieux de `09f`** (rapporté à l'usage :
  « l'infobulle est illisible, la fenêtre est trop courte »). Ce n'était pas la fenêtre, et les trois
  points valent au-delà de ce bouton :

  - **une infobulle était large comme son déclencheur.** Un élément absolument positionné se
    dimensionne contre son bloc conteneur, ici l'enveloppe, qui épouse le contrôle : sur un carré de
    27 px, elle rendait **55 px de large et 98 px de haut**, un mot par ligne, et son
    `max-width: 220px` ne s'appliquait jamais faute de 220 px disponibles. `width: max-content`
    d'abord, le plafond ensuite ;
  - **le débordement par le haut en était la conséquence, pas la cause.** Ces 98 px la portaient à
    `top: -23`. Rien ne la rognait — aucun ancêtre en `overflow: hidden`, donc **pas le défaut
    n° 35** —, et une fois la largeur rendue elle tient au-dessus sans qu'aucun appelant ait à
    choisir son côté. La leçon : un symptôme de position peut n'être qu'un symptôme de taille, et
    poser `placement="bottom"` chez les appelants aurait « corrigé » l'écran en laissant les 55 px ;
  - **et la rendre a ouvert l'autre bord.** Mesuré sur « Exporter CSV » du panneau de détail :
    1367 px dans une fenêtre de 1360. Une largeur bornée par le déclencheur ne dépassait jamais ; une
    largeur bornée par son contenu, oui. `Tooltip` mesure donc son décalage horizontal **depuis
    l'ancre** — la leçon de `Popover`, une condition portant sur la position courante oscillerait —
    et laisse le côté vertical explicite, pour la raison qu'`ouvertureVers` donne déjà : l'horizontale
    dépend de la largeur du contenu, la verticale est structurelle chez l'appelant. Une bascule
    verticale automatique a été écrite puis retirée le jour même : **aucun déclencheur du produit
    n'est assez haut dans la fenêtre pour la déclencher**, donc rien n'aurait pu l'exercer.

  **Et le `+` voisin a livré deux défauts de défilement, du même parcours** (8 septembre 2026,
  rapporté à l'usage). Une ligne ajoutée va en **bas** de la grille :

  - **le `+` ne descendait pas.** Sur une fenêtre de cinq cents lignes, il posait la ligne à douze
    mille pixels sous le regard et rien ne bougeait à l'écran — un bouton dont l'effet est hors du
    champ se lit comme un bouton qui ne fait rien, le défaut n° 36 sous une autre forme. `VirtualGrid`
    reçoit donc un `scrollToBottom`, **compteur et non booléen** : le geste se répète, et un drapeau
    devrait être rabaissé par quelqu'un. La cible est **mesurée sur la zone** (`scrollHeight -
    clientHeight`), non calculée depuis `rows` : la hauteur compte l'en-tête collé, et la prévoir
    laisserait la dernière ligne sous le bord ;
  - **et ouvrir une cellule de cette ligne ramenait la fenêtre.** L'effet qui suit la ligne
    *sélectionnée* partait à **chaque rendu de l'hôte** — `rowId` est une fonction fléchée écrite dans
    le JSX de `A5`, donc une identité neuve à chaque fois —, et ramenait la vue sur une sélection qui,
    elle, n'avait pas bougé. Mesuré : de 12 405 px à 26. Il ne part plus que si la sélection **se
    déplace**, et le témoin porte l'**index autant que l'identité** : la même ligne qui change de rang
    (un tri, un filtre) doit être ramenée, une relecture qui la laisse en place ne doit rien bouger.

  **`Element.prototype.scrollTo` n'existe pas sous jsdom, et cela avait caché le premier effet à
  toute la suite.** Aucun test unitaire ne l'atteignait — il faut que la sélection sorte de la fenêtre
  visible, ce qu'aucun décor ne faisait —, si bien que le complément manquait sans qu'on le sache :
  le second appel, ajouté ce jour-là, a fait tomber d'un coup les huit tests qui cliquent « Ajouter
  une ligne », sur un `TypeError` qui ne se distingue pas d'un défaut du sujet. Il vit désormais dans
  `src/test/setup.ts`, à côté de `scrollIntoView` et pour la même raison.

  **Le test de bout en bout a menti deux fois avant de mordre** (règle n° 1, et c'est le meilleur
  exemple du fichier). Version 1 : la sélection était prise **après** la descente, donc sur une ligne
  du bas — il n'y avait nulle part où revenir. Version 2 : elle était prise sur
  `getByRole('row').nth(1)`, qui est la **ligne des filtres** — `getByRole('row')` compte les deux
  lignes d'en-tête, donc rien n'était sélectionné du tout. Les deux fois, le sabotage laissait le test
  vert. Ce qui l'a réparé est une assertion sur le **décor** et non sur le sujet :
  `[role=row][aria-selected=true]` doit exister avant qu'on mesure quoi que ce soit.

  **Deux tests, à deux niveaux, parce que le défaut a deux bords.** L'infobulle du bouton tient sur
  une ligne et reste dans la fenêtre (`10e`) ; et **aucune** infobulle du panneau de détail ne
  franchit un bord (`geometrie-reelle`), le panneau étant contre le bord droit — c'est le niveau qui
  n'appartient à aucun écran, et le seul d'où le second bord se voyait. À ne pas remplacer par
  `elementFromPoint`, que le défaut n° 35 recommande pourtant : une infobulle porte
  `pointer-events: none`, donc la mesure rend toujours ce qu'il y a **dessous** — verte pour une
  raison qui n'a rien à voir avec la question posée.

### Le gestionnaire de schémas (8 septembre 2026, `API-33`)

Une connexion PostgreSQL montrait **tous** ses schémas non-système dans l'arbre, sans qu'on puisse en
choisir, et rien du produit ne savait créer un schéma. « Gérer les schémas… » entre dans le menu
d'une connexion, en seconde position — les deux entrées qui *ouvrent* quelque chose d'abord, celles
qui configurent ensuite. **Le geste part du palier qui connaît son contexte**, comme la création
d'une console : une bande en tête de colonne devrait deviner de quelle connexion il s'agit.

**Hors PostgreSQL, l'entrée reste et se désactive avec sa raison.** La cacher ferait croire qu'elle
n'existera jamais, là où c'est un « pas encore » — la distinction que les cinq verdicts du dump
tiennent déjà. Le moteur vient du **nœud** (`Noeud.engine`, ajouté pour cela) et non d'une déduction
sur son icône : une icône ne se relit pas.

**Les deux temps, et c'est la décision à retenir.** Les schémas affichés sont une **préférence** —
elle vit dans le registre, à côté de la connexion, et attend « Enregistrer » comme tout formulaire de
connexion. `create schema` s'exécute **sur la base** et DoraBase ne peut pas le défaire : il a donc
son propre bouton, dans un bloc séparé, et le schéma créé arrive coché. Les mêler ferait
qu'« Annuler » ne défasse qu'une moitié de ce qu'on a fait. Sur un environnement marqué production,
la bande de création porte le rappel — le drapeau de la déclaration, jamais le libellé (`23g`).

Sept décisions à ne pas défaire :

- **le défaut est « tous les non-système », et non `public` seul.** Le premier ne change rien à
  l'existant — c'est ce que l'arbre montrait avant —, le second aurait vidé l'arbre des bases où
  `public` est justement le schéma vide, et pour **toutes** les connexions déjà déclarées. Corollaire
  qui tient tout le reste : `None` n'est pas la liste vide. « Jamais réglé » montre les non-système,
  `Some(vec![])` dit « aucun » ; les confondre rendrait impossible de tout décocher, ou viderait
  l'arbre de qui n'a rien demandé. C'est « jamais tentée » qui n'est pas « hors ligne », appliqué à
  une préférence ;
- **les schémas système sont listés, repliés — et leur interrupteur fonctionne.** Ils existent, donc
  ils ne sont pas masqués (masquer est le bon choix pour ce qu'un moteur n'a réellement pas), et rien
  n'interdit de les afficher. C'est ce dernier point qui a décidé de l'architecture : `list_schemas`
  **les rend désormais, marqués** (`SchemaInfo.system`), là où la requête PostgreSQL les excluait par
  un `not in` depuis `06c`. Une lecture qui les taisait rendait l'interrupteur menteur, et une
  seconde commande « avec le catalogue » aurait fait vivre deux listes que rien n'aurait tenues en
  phase (règle n° 17) ;
- **le tri se fait une seule fois, dans `schemasAffiches`**, et `useArbre` l'applique **avant de
  mettre en cache**. Ce qui est caché est donc ce qui est montré : l'arbre, le catalogue
  d'autocomplétion d'une console et le préchauffage des structures lisent la même liste. Le dernier
  n'est pas un détail — sans ce filtre à la source, le préchauffage décrirait les quatre cents
  relations de `pg_catalog` à chaque ouverture de connexion, pour un catalogue que personne n'a
  demandé ;
- **le cache retenant une liste filtrée, il faut le relire** (`useArbre.rechargerLesSchemas`). Les
  deux gestes le périment, chacun à sa façon : régler change le filtre, créer ajoute un schéma que la
  lecture précédente ne pouvait pas connaître. Sans cette relecture, décocher un schéma n'aurait
  aucun effet visible jusqu'au prochain « Rafraîchir l'arborescence », qui replie tout. **La
  préférence lui est passée, non relue dans `projects`** : l'appelant vient de l'enregistrer, et les
  projets à jour ne reviennent qu'au rendu suivant — la relire appliquerait le filtre qu'on vient de
  remplacer. C'est `tourDesEtats` par un autre bout ;
- **le propriétaire vient du catalogue** (`SchemaInfo.owner`), le pendant exact de `cardinality`
  ajouté pour le diagramme : ce que le moteur sait, on le lui demande. `pg_get_userbyid(nspowner)`
  plutôt qu'une jointure sur `pg_roles`, qui aurait vidé la colonne pour un utilisateur sans le droit
  de lire le catalogue des rôles. `None` chez les quatre autres moteurs : une base MongoDB, un
  fichier SQLite et un jeu de données BigQuery n'ont pas de propriétaire au sens d'un rôle SQL, et
  MySQL n'en attache pas à une base ;
- **`create schema` est refusé par les quatre autres moteurs, nommés un par un.** Ce n'est pas une
  lacune d'écriture : le niveau « schéma » ne veut pas dire la même chose d'un moteur à l'autre — une
  base du serveur chez MySQL et MongoDB, le fichier lui-même chez SQLite, un jeu de données facturé à
  part chez BigQuery. Le `match` reste exhaustif, sans bras attrape-tout : c'est la leçon du défaut
  n° 16, et un sixième moteur fera échouer la compilation là où son auteur doit choisir. Pas de
  `if not exists` non plus — un schéma déjà là doit se **dire**, sinon la modale annoncerait une
  création qui n'a rien créé, comme le refus d'une connexion en double ne génère pas de suffixe ;
- **`save_visible_schemas` ne ferme pas la connexion**, contrairement à `update_variant`. Celle-là
  ferme parce que ses réglages décrivent *comment joindre le serveur* et que l'ancien hôte reste dans
  le registre ; ici rien de tel n'a changé, et fermer aurait fait perdre une connexion ouverte à
  chaque case cochée.

**Trois choses apprises en le vérifiant**, et les deux dernières valent au-delà de cet écran :

- **`assurerLOuverture` est devenue attendable.** Le menu d'une connexion est atteignable dès que son
  *environnement* est déplié — sa ligne, non —, donc ce chemin arrive sur une connexion **fermée** :
  la lecture des schémas partait sur « aucune connexion ouverte » alors que rien n'allait mal. C'est
  le cinquième point d'ouverture, après les trois consoles et le diagramme, et le premier qui a
  besoin de la réponse plutôt que du seul déclenchement ;
- **un double qui répond dans le tour synchrone de son appel ne mesure rien.** Le test d'assemblage
  est resté **vert sous sabotage** — lire sans attendre l'ouverture — parce que le corps d'une
  fonction `async` court jusqu'à son premier `await` : le faux `openDatabase` inscrivait la connexion
  *pendant* l'appel, donc elle était ouverte avant que la lecture ne parte. Un `await Promise.resolve()`
  dans le double le fait mordre. C'est la leçon du chargeur du diagramme, sous une autre forme :
  ce que le décor rend indiscernable, aucune assertion ne le rattrape ;
- **`ecrire_les_consoles` s'appelle désormais `ecrire_les_projets`.** Elle n'a jamais rien su des
  consoles — elle lit les projets, applique une opération, écrit —, et un nom qui annonce un domaine
  fait hésiter à s'en servir depuis un autre : donc fait écrire une seconde fois la même chose.

**Ce que la maquette portait et qui n'a pas été retenu** : la colonne « objets » montre le **total**
des quatre compteurs, le détail en infobulle — quatre nombres dans une colonne de 90 px seraient
illisibles, et le total est ce qui dit si un schéma est vide. Et les deux planches qui montraient
« seul `public` affiché » ont été écartées avec le défaut correspondant, pour la raison ci-dessus.

**Ce qui reste à voir à l'œil** : les schémas de catalogue sont dans le décor de `?demo` — c'est ce
qui rend la section repliée mesurable par Playwright — mais un vrai `pg_catalog` porte des milliers
de fonctions, et la colonne « objets » n'a jamais affiché cinq chiffres.

### La transaction d'une console : automatique ou manuelle (9 septembre 2026, `API-38`)

La console exécutait toujours à découvert : chaque requête partait telle quelle, et c'était
l'autocommit du serveur qui décidait. Un interrupteur « Transaction manuelle » entre dans sa barre
d'outils, à côté du stepper `LIMIT` — allumé, la première exécution ouvre une transaction, les
suivantes s'y ajoutent, et le panneau de droite liste ce qu'elle retient avec deux boutons pour la
finir.

**Une console, une transaction, une session** — et c'est ce fait de serveur qui tient tout le reste.
Une transaction est un état de **session** : deux consoles qui partagent une session partagent sa
transaction, quoi qu'en dise l'écran. Un `begin` posé depuis l'une englobe ce que l'autre exécute, et
un `commit` emporte les deux.

Le registre ne détenant qu'un adaptateur par connexion, ce partage a d'abord été la règle : le
journal était celui de la connexion, et une console en `auto` participait **en silence** à la
transaction de sa voisine. Trois passages successifs ont essayé de rendre cela lisible — un régime
par connexion, puis un régime par console, puis un journal filtré par console — et le dernier a
montré ce que les deux premiers cachaient : ce n'était pas un problème d'affichage. **Une console qui
passe en mode manuel reçoit donc sa propre session**, ouverte à sa première exécution, et sa
transaction y vit seule (`ConnectionRegistry::assurer_la_session`).

Les trois états sont alors au même endroit, l'onglet — le régime, ce qu'on regarde, et la transaction
elle-même —, indexés par identité d'onglet comme le texte (`12a`), le résultat (`12c`) et les
modifications en attente (`11b`). Ce qui reste côté Rust est le **journal**, à côté de la session qui
porte la transaction : une liste tenue par l'écran aurait été juste sur ce que l'onglet a lancé et
fausse sur ce qu'un « Valider » emporte — un refus, par exemple, entre dans la transaction sans que
l'écran l'y mette.

**Ce que la session par console a fait disparaître**, et qu'il ne faut pas réintroduire :

- la notion de **transaction étrangère**. Une console en `auto` n'entre dans aucune transaction, même
  si sa voisine en tient une : ses requêtes partent sur la session de la connexion, qui n'a pas de
  `begin`. Le pied de la console ne l'annonce donc plus, et `TransactionState` n'a plus à dire quoi
  que ce soit des autres consoles ;
- le **filtre** du journal, et le `foreign` qui l'accompagnait. Le journal d'une console est le sien,
  entier : la place d'une instruction y est son rang, et il n'y a rien de plus à dire sur ce qu'un
  `commit` emporte. Le champ `index` qui portait le rang à part est parti avec ;
- et le **trou** que ce filtre avait ouvert : une console qui n'avait rien écrit validait le `delete`
  d'une voisine sans aucune confirmation. La règle est redevenue celle de `demandeConfirmation` — une
  transaction qui n'a fait que lire se valide sans question —, et elle est de nouveau vraie.

**Ce qu'elle coûte, et qui est le vrai prix** : ce qu'une transaction retient n'est visible que
d'elle. La grille de `A5`, l'arbre et les autres consoles lisent la session de la connexion, donc ils
ne voient pas les lignes qu'une transaction ouverte a écrites. C'est l'isolation que le serveur
promet — la contrepartie exacte de « les transactions ne sont pas partagées » —, et c'est un
renversement : la version à session partagée le notait comme une propriété à garder, MySQL ayant
demandé un champ pour l'obtenir (voir `Prise`). L'aide de l'interrupteur le **dit** plutôt que de le
laisser découvrir.

Dix décisions à ne pas défaire :

- **la transaction s'ouvre à la première exécution**, jamais au réglage. Il n'y a donc pas de bouton
  « Ouvrir », pas d'état intermédiaire où une transaction vide tiendrait des verrous, et rien à
  fermer si l'on change d'avis. Le panneau paraît quand même dès le réglage, et **dit** ce qui va se
  passer : c'est le seul endroit qui puisse expliquer le régime dans lequel on vient d'entrer, et une
  colonne vide n'aurait rien dit ;
- **le mode choisit la session, et une console qui tient la sienne y reste.** Une requête lancée en
  `auto` par une console qui a déjà une transaction ouverte y est inscrite quand même — elle est bel
  et bien dedans, et c'est un `commit` qui décidera de son sort. Une console **voisine**, elle, n'y
  entre jamais ;
- **les échecs y figurent aussi.** PostgreSQL abandonne la transaction après une erreur, donc toute
  la suite sera refusée jusqu'à l'annulation : un journal qui n'aurait gardé que les succès aurait
  laissé chercher pourquoi plus rien ne répond. Une instruction refusée laisse d'ailleurs la
  transaction **ouverte**, le `begin`, lui, ayant réussi ;
- **une instruction se désigne, et sa réponse revient dans la grille.** La grille du centre n'en
  tient qu'une — celle de la dernière exécution : dans une transaction de cinq requêtes, les quatre
  autres n'existaient plus nulle part, et un compte de lignes dit qu'il s'est passé quelque chose
  sans dire quoi, alors que c'est sur ces réponses-là qu'on décide de valider. Cliquer une carte du
  panneau y remet donc sa réponse. Cinq points :
  - **le panneau ne contient pas les réponses, il les désigne.** Le journal est **relu à chaque
    exécution** : y mettre les lignes ferait traverser l'IPC à toutes les réponses de la transaction
    chaque fois qu'on en ajoute une, ce que la contrainte transverse du projet interdit. Elles
    restent donc au cœur — « le cœur détient les résultats ; la webview ne reçoit que ce qu'elle
    montre » — et `transaction_result` en rend **une**, celle qu'on lui nomme. Un premier jet mettait
    un aperçu de cinq lignes dans chaque carte : c'était un tableau de plus dans 330 px, et une
    réponse tronquée là où l'écran a déjà une grille pour la montrer en entier ;
  - **un rang, pas un identifiant.** Le journal d'une transaction ne fait que s'allonger : rien ne
    s'y retire, rien ne s'y déplace, et un `commit` le remplace en entier. Un rang y désigne donc
    toujours la même instruction, sans distribuer d'identifiants ni les faire voyager avec chaque
    exécution — et comme ce journal est celui d'une console, ce rang est la place que le panneau
    affiche. Un champ `index` a porté ce rang à part le temps où la liste était filtrée ; la session
    par console l'a rendu inutile, et il est parti ;
  - **rien n'est rejoué.** Les lignes viennent de ce que le cœur a gardé : relancer la requête serait
    la seule autre façon de les retrouver, et une requête de console n'est pas forcément idempotente
    — c'est déjà la raison pour laquelle un geste de colonne ne réexécute rien ;
  - **une écriture ne se désigne pas.** `displayable` vient du cœur, et il est faux quand
    l'instruction n'a rendu aucune ligne : un clic ne ferait que vider la grille, et son compte de
    lignes touchées est déjà sa réponse. Pas d'infobulle « rien à afficher » sur ces cartes non plus
    — l'information y est déjà lue ;
  - **et ce que garder coûte est borné par `RowLimit`.** Une réponse de console fait au plus mille
    lignes (`12c`), donc le journal pèse au plus ce plafond par instruction qui rend des lignes ; une
    écriture n'en garde aucune, et un `commit` ou un `rollback` efface tout. Ce qui n'a pas été
    retenu : jeter les plus anciennes réponses au-delà d'un plafond global — cela rendrait une
    instruction non consultable pour une raison que l'utilisateur n'a pas provoquée, et qu'il
    faudrait alors lui dire.
- **`QueryResult.affected` a été ajouté pour cela**, et il manquait avant. La console affichait « 0
  ligne » sur un `update` — vrai de ce qu'il *rend*, faux de ce qu'il a *fait* — et le panneau en
  aurait fait sa réponse principale : le seul chiffre qui décide d'un `commit` aurait dit « rien ne
  s'est passé ». Il est rendu **seulement quand l'instruction ne rend pas de lignes**, faute de quoi
  un `select` afficherait deux fois le même nombre sous deux noms dont l'un serait faux. `None` chez
  MongoDB parce que sa console ne fait que lire — ce n'est pas « le pilote ne le dit pas », c'est
  « il n'y a rien à dire » ;
- **deux moteurs refusent, nommés un par un, et pas pour un retard.** La console MongoDB ne fait que
  **lire** — `find`, `aggregate`, `countDocuments`, `distinct` : une transaction manuelle n'y aurait
  rien à valider, alors que la grille en ouvre déjà une dès qu'elle porte plus d'une écriture.
  BigQuery exécute chaque requête comme un **job indépendant** : il n'y a pas de session à tenir
  entre deux exécutions, et ses transactions s'écrivent dans un script, donc en une seule requête —
  ce que la console exécute déjà. L'interrupteur reste et se **désactive avec sa raison**, comme
  l'entrée « Gérer les schémas… » hors PostgreSQL : le cacher ferait croire qu'il n'existera jamais ;
- **MySQL tient une connexion du pool, et c'est le seul écart entre les trois moteurs qui
  transigent.** PostgreSQL et SQLite détiennent *une* connexion : un `BEGIN` y survit d'un appel à
  l'autre sans que personne ait rien à garder. Le pilote MySQL travaille sur un **pool** — sans le
  champ `transaction` de `MysqlAdapter`, le `START TRANSACTION` serait resté sur une connexion rendue
  au pool aussitôt après, et les requêtes suivantes en auraient pris une autre : une transaction qui
  ne contient rien, des écritures validées d'office par l'autocommit de leur propre connexion, et un
  panneau qui promet un `commit` sur du vide. Le pire mode de défaillance possible pour cette
  fonction — pas une panne, une écriture définitive présentée comme en attente. **Le corollaire, lui,
  s'est inversé** : il disait que toute opération de la connexion passait par cette connexion-là
  (`Prise`), lecture de grille comprise, pour que MySQL ne soit pas le seul moteur où la table qu'on
  regarde ignore ce que la transaction vient d'écrire. Depuis qu'une console tient sa transaction
  dans sa **propre session**, cet adaptateur est celui de la console et la grille lit sur celui de la
  connexion : elle ne voit rien, et c'est vrai des trois moteurs de la même façon ;
- **l'écriture de la grille et la création d'un schéma restent refusées pendant une transaction de
  console, et pour une autre raison qu'avant.** Ce n'était d'abord qu'une question de `begin`
  imbriqué : les deux posaient les leurs sur la session de la console, et les trois moteurs en
  faisaient trois choses dont aucune n'était acceptable — MySQL validait implicitement, PostgreSQL
  avalait le `BEGIN` puis validait tout, SQLite échouait en accusant l'écriture plutôt que ce qui la
  gêne. Une session par console a supprimé cette cause ; ce qui reste est **pire**, et c'est le
  **verrou** : les lignes qu'une transaction ouverte a touchées le sont jusqu'à son issue, donc
  l'écriture **attendrait** — indéfiniment sur PostgreSQL. Et le registre tient le verrou de la
  connexion pendant l'opération, donc cette attente gèlerait *toute* lecture de cette base : l'arbre,
  les autres consoles, la grille. Le refus nomme les deux issues ; c'est la règle du bouton désactivé
  qui dit ce qui manque ;
- **un `commit` refusé est suivi d'une annulation**, et le journal est vidé dans les deux cas. Ce
  n'est pas une observation mais une **décision** : l'état d'après un `commit` échoué n'est pas le
  même d'un moteur à l'autre — PostgreSQL a déjà tout annulé, SQLite peut rendre `SQLITE_BUSY` en
  laissant la transaction **ouverte**. Plutôt que d'afficher un état qui dépend du moteur, on le rend
  vrai : après « Valider », la transaction est terminée, et le message dit qu'elle a été annulée.
  C'est la conduite d'`apply_updates`, y compris quand l'annulation échoue à son tour — « rouvrez la
  connexion » ;
- **sortir du mode manuel n'est ni une validation ni une annulation.** Tant que la transaction
  retient des instructions, l'interrupteur est figé avec sa raison : valider d'office écrirait ce que
  personne n'a relu, annuler d'office jetterait un travail en cours. Les deux boutons du panneau
  restent les deux seules issues. Et le figer se fait en `aria-disabled`, non en `disabled` : la
  raison vit dans une infobulle, qu'un bouton désactivé rendrait inatteignable (piège n° 3) ;
- **`BEGIN IMMEDIATE` chez SQLite**, pour la raison d'`apply_updates` : une transaction différée
  prend le verrou de lecture d'abord et doit le *promouvoir* à la première écriture — promotion qui
  échoue en `SQLITE_BUSY` au milieu d'une transaction qu'on croyait tenue. Prendre le verrou
  d'écriture à l'ouverture échoue tout de suite, ou pas du tout.

**Et la confirmation d'écriture a suivi le geste qui engage : elle est passée de l'exécution à la
validation** (rapporté à l'usage). La confirmation de `12c` attrape la faute de frappe juste avant
que ce soit écrit ; en transaction manuelle, rien n'est écrit — la requête entre dans la
transaction, le panneau la liste, et c'est le `commit` qui devient le moment où l'on s'engage.
Confirmer les deux faisait cliquer deux fois pour un seul engagement, et le premier clic, celui
qu'on fait vingt fois, ne protégeait de rien. Quatre points :

- **`CommitConfirm` récapitule ce qui devient définitif** : les verbes des écritures dans l'ordre —
  « UPDATE, DELETE », et non « 2 écritures », parce que deux corrections ne sont pas une suppression
  —, le compte d'instructions, la cible, le drapeau de production, et le `where` manquant **en
  premier** s'il en manque un. Le panneau derrière elle porte déjà la liste complète : la modale
  n'en redit rien, elle en donne la mesure. Elle emprunte la feuille de style de `RunConfirm` plutôt
  qu'une copie — même écran, même coquille, mêmes blocs ;
- **une transaction qui n'a fait que lire se valide sans question.** C'est la règle de
  `demandeConfirmation` — un `select` n'en demande pas — appliquée à un lot, et le classificateur
  est le **même** (`natureDe`) : deux règles pour « est-ce que ceci écrit ? » auraient divergé, et
  c'est de cette question que dépend l'affichage de la modale ;
- **une modification de structure garde la sienne**, et c'est la seule nature qui n'est pas
  dispensée. Une transaction ne la retient pas toujours : MySQL **valide d'office** ce qui attend
  avant d'exécuter un `create`, un `alter` ou un `drop` — le `delete` qu'on relisait dans le panneau
  partirait alors sans qu'aucun clic ne l'ait décidé. Le rappel de la modale dit exactement cela, là
  où « rien ne sera écrit avant que vous validiez » aurait été une promesse que le moteur peut ne
  pas tenir ;
- **et l'annulation ne se confirme pas.** Elle rend la base à son état : c'est le geste de repli, et
  le confronter à une question ferait hésiter là où il n'y a rien à perdre. Ce qui se perd — les
  instructions qu'on avait écrites — est dans l'éditeur, que rien n'efface.

**Une session par console, et ce que cela demande au registre** (rapporté à l'usage, en deux temps :
« les requêtes lancées depuis une autre console ne devraient pas apparaître dans la vue de la
transaction », puis « les transactions ne devraient pas être partagées entre consoles »). Le premier
signalement a été traité comme une question de vue — un filtre au cœur, et le compte de ce qui n'est
pas montré. Le second a dit que ce n'en était pas une : avec une seule session, le partage n'est pas
un choix d'écran, et la seule façon de ne pas partager une transaction est de ne pas partager la
session. Huit décisions :

- **la session est ouverte depuis la recette de la connexion, et par son tunnel.** `assurer_la_session`
  clone la variante, remplace l'hôte et le port par le **bout local du proxy déjà monté**, et retire
  le tunnel : sans cette redirection, `connect_via` monterait un second tunnel SSH par console — une
  session SSH et un port de plus par transaction. Rien d'autre n'est touché, donc la configuration
  TLS est identique à celle de la connexion, au champ près ;
- **et sans proxy vivant, elle refuse plutôt que de joindre le serveur en direct.** C'est
  `postgres::connect::preparer` qui le garantit depuis toujours : une variante qui déclare un tunnel
  sans redirection est un refus. Le port du proxy est donc relu au moment d'ouvrir, et s'il a disparu
  la variante **garde** son tunnel — ce qui fait refuser. Contourner le tunnel serait contourner la
  consigne de sécurité de la connexion, en silence ;
- **elle s'ouvre à la première exécution, jamais au réglage** — la décision d'origine, et elle vaut
  davantage maintenant : ouvrir au réglage prendrait une session sur le serveur et, sur SQLite, le
  verrou d'écriture du fichier, pour une transaction que personne n'a encore remplie. Corollaire :
  `open` implique au moins une instruction, donc la bascule est figée exactement quand une session
  existe — c'est ce qui garantit qu'une session n'est jamais laissée sans son panneau pour la finir.
  Une garde « éteindre l'interrupteur annule la transaction » a été écrite puis retirée le jour même,
  pour cette raison : elle était **inatteignable** ;
- **une session de console n'a pas de reprise, et c'est le seul chemin du produit dans ce cas.**
  `avec` rouvre une connexion perdue parce que la suivante repartira du même endroit ; ici la session
  *est* la transaction — la rouvrir donnerait une session neuve où le `commit` ne validerait rien, et
  le panneau annoncerait des instructions que le serveur a annulées. Une session perdue est donc
  retirée avec sa transaction, et le refus le dit ;
- **`achever` ne consulte plus la connexion du tout.** La session est la sienne : elle est retirée
  avant l'ordre, et **fermée après**, dans les deux issues. C'est aussi ce qui rattrape le pire cas
  — un `commit` refusé dont l'annulation échoue à son tour : la fermeture de la session annule côté
  serveur ce que deux ordres n'ont pas su annuler, là où l'ancien message ne pouvait que dire
  « rouvrez la connexion » ;
- **une session de console meurt avec sa connexion**, et les trois endroits qui retirent une entrée
  du registre les ferment : `fermer`, `tenter` quand la connexion s'est révélée perdue, et `achever`
  pour la sienne. Elle emprunte le proxy de la connexion, donc elle ne lui survit pas — et une
  session oubliée tiendrait une transaction et ses verrous sans que rien à l'écran puisse le dire.
  C'est la seule chose qu'aucun test de comportement ne pouvait voir : d'où
  `sessions_de_console()`, un compteur qui n'existe que pour les tests ;
- **un fichier SQLite ne tient qu'une transaction à la fois, et le refus le dit.** Un fichier n'a
  qu'un verrou d'écriture : la seconde console qui ouvre une transaction reçoit « un autre programme
  tient le verrou d'écriture de ce fichier » — vrai au sens du moteur, et trompeur ici, puisque ce
  programme est nous. `qualifier_le_refus_d_ouvrir` met donc **la cause devant** et garde le mot du
  moteur derrière : un refus peut toujours avoir une autre cause. PostgreSQL et MySQL tiennent autant
  de transactions que de sessions, donc la qualification ne les atteint jamais ;
- **et le jeton d'onglet désigne désormais une session, non plus une origine.** Il était déjà une
  *valeur* que `reindexer` déplace avec son onglet, plutôt que `Console.id`, qui dérive du nom ; ce
  qu'un oubli coûte a changé d'échelle — non plus des instructions qui paraissent étrangères, mais une
  transaction ouverte, avec ses verrous, que plus rien ne peut atteindre.

**Ce que cela coûte, mesuré et non supposé** (9 septembre 2026, contre les décors locaux). Une
session de console est ouverte à la **première exécution en mode manuel** et rendue par sa validation
ou son annulation : tant que personne n'est en manuel, il n'y a **rien** de plus qu'avant — ni
connexion, ni appel.

| | connexions serveur en plus | première exécution | exécution suivante | validation |
| --- | --- | --- | --- | --- |
| PostgreSQL (décor **TLS**) | **+1** backend, rendu au `commit` | 40,4 ms | 0,58 ms | 0,27 ms |
| MySQL (sans TLS) | **+2**, rendues au `commit` | 5,1 ms | 0,22 ms | — |

Trois choses à en retenir :

- **le coût est celui d'une poignée de main, une fois par transaction**, pas par instruction : les
  exécutions suivantes sont au prix habituel. Les 40 ms de PostgreSQL sont dominés par TLS — le décor
  l'active délibérément —, et derrière un tunnel SSH il faut y ajouter l'ouverture d'un canal, que ce
  fichier a mesurée à ~217 ms sur un bastion à 50 ms. C'est le seul endroit du produit où un geste
  d'écran paie une connexion, et il vaut d'être connu avant qu'on le rapporte comme une lenteur ;
- **MySQL en coûte deux, et c'est le prix de son pool.** Une session de console est un second `Pool`,
  paresseux — mais la sonde de version qu'`ouvrir` fait à la connexion en prend une, que
  `DEFAULT_POOL_CONSTRAINTS` (min **10**) garde ensuite au chaud, et la transaction en tient une
  seconde. Les deux repartent avec la session. Le ramener à une demanderait de passer des
  `PoolConstraints` à `connect_via`, donc d'inscrire au contrat des cinq moteurs une optimisation
  qu'un seul a — c'est l'arbitrage de `table_details`, et il tombe du même côté ;
- **et le verrou du registre y gagne.** Avant, une instruction de console en manuel passait par
  `avec`, qui tient `ouvertes` pendant toute l'opération : une requête lente y gelait l'arbre, la
  grille et les autres consoles de cette connexion. Elle ne tient plus que `transactions` — la table
  des sessions —, donc plus rien de la connexion partagée n'attend derrière elle. Ce qui reste vrai,
  et qui l'était déjà, est qu'une instruction lente retarde la **lecture des panneaux** des autres
  consoles, ce verrou étant unique pour toute la table.

**Ce qu'on gagne au passage** : deux consoles peuvent enfin travailler en parallèle, chacune avec sa
transaction, sur PostgreSQL et MySQL. Un test contre un vrai PostgreSQL le mesure — deux `insert`
retenus en même temps, chacune ne voyant que le sien, la connexion partagée n'en voyant aucun, puis
un `commit` qui n'emporte que sa moitié. C'est le test que SQLite ne peut pas porter, et les deux
ensemble sont ce qui rend la limite du fichier digne d'être dite plutôt que subie.

**Le décor du test d'assemblage a dû apprendre l'isolation**, et c'est la règle n° 5 pour la troisième
fois dans ce chantier : un faux journal tenu en commun laissait passer exactement ce que
l'application isole. Il tient donc **un journal par console**, comme le cœur tient une session par
console. Même chose pour `?demo`.

**Et une réserve reste ouverte** : fermer l'onglet d'une console ne rend pas sa session. La
transaction attend, avec ses verrous, et l'on la retrouve en réouvrant l'onglet — le jeton et le
régime survivant à la fermeture, comme le texte. C'est le comportement d'avant, où la transaction
restait sur la connexion ; ce qui change est qu'elle tient maintenant une session à elle, donc, sur
SQLite, le verrou d'écriture du fichier jusqu'à ce qu'on revienne. Fermer l'onglet en demandant une
issue serait la vraie réponse, et c'est une décision de produit qui n'est pas prise.

**Et une transaction abandonnée n'offre plus que l'annulation** (rapporté à l'usage). Après une
instruction refusée, PostgreSQL refuse tout ce qui suit jusqu'à la fin du bloc, et un `commit` s'y
comporte comme un `rollback` : le bouton « Valider » y promettait donc **l'inverse** de ce qu'il
faisait. Il est **retiré**, et non grisé — c'est l'exception à la règle du contrôle désactivé qui
porte sa raison : un contrôle grisé annonce « pas maintenant », or celui-ci ne pourra jamais valider
cette transaction-là. Sa raison prend sa place, **écrite** dans le corps du panneau, un bouton disparu
sans explication faisant chercher où il est passé. Trois points :

- **la réponse vient du moteur, jamais de l'échec.** `AnyEngine::transaction_abandonnee_par_une_erreur`
  est inhérente et répartie par un `match` sans bras attrape-tout, comme `connexion_perdue` : **seul
  PostgreSQL abandonne**. SQLite et MySQL laissent l'instruction échouer seule, et ce qui précède
  reste validable — le déduire de l'erreur aurait retiré à ces deux-là une capacité qu'ils ont, en
  silence. C'est le même arbitrage que les modes SSL : ne pas offrir ce qui ne marche pas, ne pas
  retirer ce qui marche ;
- **le verdict est figé au moment de l'échec**, dans le journal, et non recalculé à la lecture :
  c'est cette instruction-là qui a abandonné la transaction, et une reconnexion survenue depuis ne
  doit pas changer la réponse. C'est aussi ce qui laisse `etat_de_transaction` répondre sans
  consulter l'adaptateur ;
- **et la bascule de mode nomme alors le seul geste qui reste** — « annulez-la », non « validez-la ou
  annulez-la » : proposer dans une infobulle ce que le panneau vient de retirer serait se contredire
  à deux centimètres d'écart.

Les deux moteurs qui n'abandonnent pas ont leur test — SQLite sans décor, PostgreSQL contre le
conteneur —, et c'est **leur paire** qui rend la question digne d'être posée au moteur : la même
suite de gestes donne deux réponses, et un écran qui aurait conclu de l'échec seul se serait trompé
pour l'un des deux.

**Et la reconnexion d'`API-37` a demandé quatre accords**, tous dans le registre. La transaction y
est un état de plus, à côté de l'entrée et de la recette, et c'est leur rapport qu'il faut tenir :

- **le journal vit et meurt avec l'entrée du registre.** Une transaction ne survit pas à sa
  connexion — le serveur l'annule —, donc les trois endroits qui retirent une entrée le vident :
  `fermer`, `tenter` quand la connexion s'est révélée perdue, et `achever`. Laisser ses instructions
  au panneau offrirait un « Valider » sur une session qui n'existe plus ;
- **`achever` est la seule opération qui ne rouvre pas.** Partout ailleurs, rouvrir avant d'agir est
  l'étage du bas de la reconnexion, refusé à personne. Ici il donnerait une session **neuve**, où un
  `commit` réussirait sans rien valider — PostgreSQL n'y voit qu'un avertissement — et l'écran
  lirait « validée » sur une transaction que le serveur avait annulée. Une entrée absente est donc un
  refus ;
- **`executer_une_requete` passe ses deux ordres par `avec`**, plutôt que de refaire sa moitié
  délicate : `Rejouable` pour le `begin`, qui est juste à rejouer sur une connexion qui vient de se
  rouvrir — l'ancienne transaction est partie avec sa session, il n'y a rien à écrire deux fois —, et
  `Unique` pour la requête, qui est le verdict d'`API-37` sur `run_sql`. Sans cela la console aurait
  été le seul chemin du produit où une connexion morte reste au registre ;
- **le panneau, lui, ne s'abonne pas au signal d'échec de commande**, et c'est une limite assumée.
  L'arbre le fait — c'est la moitié écran d'`API-37` —, mais le panneau relit son journal après
  chaque exécution et à chaque changement de `projects` : une connexion perdue par une **autre**
  onglet le laisse donc afficher ses instructions un moment. S'y abonner demanderait d'exclure
  `transaction_state` de l'annonce, comme `connection_states` l'est déjà, faute de quoi une lecture
  qui échoue s'annoncerait à elle-même et tournerait sans fin hors de la webview. Ce qui rattrape
  l'écart : les deux boutons disent la vérité quand on les presse — « aucune transaction n'est
  ouverte » —, et la relecture qui suit ce refus vide le panneau. L'arbre, lui, a déjà rougi.
- **et l'ordre des verrous est `transactions` puis `ouvertes`.** Le journal est pris d'abord et tenu
  pendant les deux ordres : c'est ce qui empêche deux consoles d'ouvrir chacune sa transaction sur la
  même connexion. `tenter` ne les imbrique pas — il rend `ouvertes` avant de purger le journal —,
  donc aucun cycle. La **réouverture**, elle, se fait verrou rendu : elle peut monter un tunnel SSH,
  et tenir le journal pendant ce temps bloquerait la lecture du panneau des autres consoles.

**Le panneau n'existe qu'en mode manuel, et c'est ce qui laisse tout le reste intact.** En `auto` —
le défaut — la console occupe toute la largeur du centre comme avant, aucune commande de transaction
n'est appelée, et aucune capture de fidélité ne bouge. C'est l'arbitrage de la recherche de mise à
jour, pour la même raison : une fonction que personne n'a demandée ne doit rien demander au pont.
Son `storageKey` est le sien (`console:transaction`) et non celui du panneau de détail — deux
partages différents, et régler la largeur de l'un ne doit pas déplacer l'autre.

**Trois choses apprises en le vérifiant, et les trois par sabotage** (règle n° 1) :

- **`QueryResult::columns()` de `mysql_async` rend `Some(liste vide)` pour un `insert`, jamais
  `None`.** Tester l'option — ce que la première version faisait — rendait donc « aucune ligne
  touchée » sur **chaque** écriture, c'est-à-dire exactement le mensonge que ce champ existe pour
  éviter. C'est la **vacuité** de la liste qui dit « cette instruction n'a jamais eu de lignes à
  rendre », et c'est le mot du pilote. Gain au passage : les colonnes viennent maintenant du
  protocole et non de la première ligne, donc un `select` qui ne rend rien garde ses en-têtes —
  PostgreSQL les donnait déjà par son `prepare` ;
- **le test d'assemblage est resté vert sous sabotage parce que le harnais écrivait le décor.**
  `useTransaction` relit le journal quand `projects` change — le témoin des six commandes qui
  ferment une connexion — et le harnais de `Workbench.test.tsx` réécrit `projets` à chaque frappe
  enregistrée : le panneau se remplissait donc même en retirant la relecture qui suit une exécution.
  Le décor rendait le défaut indiscernable (règle n° 5), et le remède est une console dont
  l'enregistrement ne touche pas au décor ;
- **une lecture identique ne doit pas reposer un objet neuf.** L'effet qui relit le journal dépend de
  l'identité de la passerelle, qu'un appelant peut reconstruire à chaque rendu — la démo le fait —
  donc une lecture qui aurait toujours reposé un état neuf aurait relancé l'effet **indéfiniment**.
  C'est le piège de `10d`, désarmé à la source plutôt que confié à la discipline des appelants ; la
  démo mémoïse quand même sa passerelle.

**Et une cote du panneau vient de la capture, non du raisonnement** — la méthode qui a le plus payé,
appliquée à 330 px de large. Le rembourrage d'une carte vit sur **l'enveloppe de son contenu**, et
non sur ses enfants : posé sur les enfants, l'en-tête et le bloc de SQL cumulaient leurs marges dans
une carte **inerte** — quatre pixels de plus entre eux que dans une carte cliquable, où le bouton est
l'unique enfant. Rien ne l'aurait dit : les deux cartes sont justes séparément, et c'est de les voir
côte à côte qui a montré l'écart. Un test de bout en bout compare désormais les deux rythmes au
pixel, ce qui est une **égalité** et non un ordre de grandeur (règle n° 18). Le rembourrage n'est pas
non plus sur la carte : la cible du bouton se serait arrêtée avant la bordure, et le survol aurait
laissé une bande morte.

**Ce qui reste à voir à l'œil** : le panneau sous WKWebView, et en « Nuit » — même réserve que les
dix écrans, pour la même raison. Et le journal de `?demo` est **simulé** au même degré que son
`runSql` : il rend une instruction plausible pour que l'écran soit visible sans base réelle. Ce
qu'une transaction fait vraiment — retenir, puis écrire ou rendre, et n'être visible que d'elle — est
mesuré contre un vrai fichier SQLite (`registry.rs`, sans `db-tests`, donc partout), un vrai
PostgreSQL et un vrai MySQL, où le test regarde ce qu'une **autre session** voit avant la
validation.

### Les filtres suivent la colonne (3 septembre 2026)

Le popover d'en-tête proposait **les mêmes cinq opérateurs à toutes les colonnes**, et les quatre
comparaisons en plus aux numériques. Trois de ces offres ne voulaient rien dire, chacune à sa façon,
et le remède est le même : c'est la **catégorie** de la colonne et sa **nullité** qui décident de la
liste (`operateursPour`), plus deux opérateurs de plus dans le contrat.

- **`is null` demande une colonne `nullable`.** Sur une colonne `NOT NULL`, il promettait un filtre
  qui rend toujours zéro ligne — ce qui se lit comme une **table vide**, pas comme un filtre vide.
  C'est le seul des trois qui ne dépend pas du type.
- **Une colonne booléenne n'a que `is true`, `is false` et `is null`.** Un champ de saisie n'a rien à
  recevoir d'une colonne à deux valeurs, et surtout **il n'y avait aucune valeur juste à y taper** :
  le vrai s'écrit `true` en PostgreSQL, `1` pour le `tinyint(1)` de MySQL et l'affinité de SQLite, et
  `Bson::Boolean` en MongoDB. Un `= true` aurait donc marché sur un moteur et serait resté **muet sur
  les autres**, sans que rien le dise — c'est la raison pour laquelle `IsTrue` / `IsFalse` sont deux
  opérateurs du contrat et non un `Eq` sur une chaîne : chaque adaptateur écrit le prédicat de son
  moteur. `is true` plutôt que `= 1` là où les deux existent : il vaut « différent de zéro », donc il
  couvre toute valeur non nulle, quand `= 1` en manquerait la moitié.
- **Une colonne temporelle reçoit « avant le » et « après le »**, qui sont le `lt` et le `gt` des
  nombres **dits autrement** : le même opérateur, une autre phrase, et c'est la catégorie qui choisit
  laquelle. « Supérieur à » sur une date se comprend, mais ce n'est pas le mot qu'on cherche en
  filtrant un journal. **Deux, et non quatre** : la nuance d'un `≥` sur une date que personne ne
  saisit à la seconde ne valait pas deux entrées de plus dans la liste.

**Le transtypage d'une borne de date appartient au moteur, et il suit le type déclaré de la colonne.**
C'est le point qui se défera le premier si on l'écrit ailleurs :

- **PostgreSQL** transtype la **borne**, jamais la colonne : `cast(cast($1 as text) as {type_name})`,
  le type venant de `format_type()`. Un `::timestamptz` posé d'office aurait paru plus simple et
  aurait été faux deux fois — il écarte l'index de la colonne, et il fait échouer un `time` ou un
  `interval` (que `TypeCategory::Timestamp` recouvre aussi) sur « operator does not exist », un
  message qui accuse la comparaison. Le cast dans l'autre sens rend « invalid input syntax for type
  time », qui nomme ce qui ne va pas. C'est le seul endroit du projet où un nom de type traverse le
  SQL, et il est sûr parce qu'il vient du catalogue, déjà cité par le serveur.
- **BigQuery** fait de même — `cast(@p1 as TIMESTAMP)` — pour une raison plus dure encore : il
  n'accepte **aucune** coercition entre `DATE`, `DATETIME` et `TIMESTAMP`. Conséquence : `rows()`
  demande la table **avant** de composer la requête. Il la demandait déjà, pour le compte de lignes,
  et sa réponse porte le schéma ; l'ordre inversé n'ajoute donc aucun aller-retour, là où un
  `table_detail` de plus en aurait ajouté un par lecture.
- **MySQL et SQLite ne transtypent rien**, et ce n'est pas un oubli : le premier lit lui-même une
  chaîne comme une date quand l'autre membre est temporel, et une date est du texte ISO 8601 en
  SQLite, dont l'ordre lexicographique **est** l'ordre chronologique. Un test le garde **en négatif**
  de chaque côté (« pas de `cast(` »), sans quoi quelqu'un en ajouterait par symétrie.
- **MongoDB convertit en `Bson::DateTime`.** L'ordre BSON compare d'abord les *types* : un `$gt` en
  chaîne contre un champ date ne trouve rien, les dates venant avant les chaînes quelle que soit leur
  valeur. Une date seule vaut **minuit UTC** — le seul instant qu'elle puisse désigner sans inventer
  un fuseau.

**Le sélecteur de date est natif, et c'est la seconde exception au « pas de composant natif ».** La
prohibition porte sur les listes déroulantes, dont le maison remplace l'apparence ; un calendrier
n'est pas un panneau à styler, c'est une vue à concevoir, et le handoff retiré n'en décrit aucune.
Trois conséquences :

- **`type="date"`, pas `datetime-local`** : le second demande une soixantaine de pixels qu'une
  colonne de 130 px n'a pas. Une heure reste saisissable à la main, l'adaptateur l'acceptant ;
- **il ne paraît que sur « avant » et « après »**, jamais sur `=`, `~` ou `in` : un `~` cherche un
  motif (« 2026-03 ») et `in` une liste, deux choses qu'un champ de date ne peut pas exprimer ;
- **il est le seul champ du produit qui s'applique de lui-même.** La règle de `A5` est « sur `Entrée`
  et à la perte de focus, jamais à la frappe » ; un calendrier natif se referme sans que rien perde
  le focus et sans qu'on tape `Entrée`, donc attendre l'un des deux laisserait la date **dans le
  champ sans qu'elle parte** — le bouton inerte du défaut n° 36. La garde qui rend cela compatible
  avec la règle est `!== value`, comparé à la valeur **appliquée** : un `type="date"` rend `''` tant
  que la date est incomplète et émet un événement à *chaque* segment saisi au clavier, donc sans elle
  taper une date enverrait trois lectures non filtrées avant la bonne.

**Et choisir « avant le » *est* la demande d'une date** : le calendrier s'ouvre du même clic
(`showPicker()`). Le premier jet se contentait de changer le type du champ, et c'était un demi-geste
— rapporté à l'usage le 3 septembre 2026 : WebKit affiche la date **du jour** dans un champ de date
vide et met un seul segment en surbrillance au clic, donc l'écran montrait une date que la requête ne
portait pas, et il fallait trois gestes pour en sortir. Deux points à ne pas défaire :

- **`flushSync` autour de `onApply` + `fermer`, et ce n'est pas une optimisation.** `showPicker()`
  exige un champ qui soit **déjà** `type="date"` ; le type suit l'opérateur, qui vit chez l'appelant,
  et React ne pose pas un état d'un gestionnaire d'événement avant la fin de celui-ci. Sans le vidage
  synchrone, l'appel tombe sur le champ texte d'avant — **sans lever et sans rien ouvrir**, donc en
  silence. C'est le second `flushSync` du dépôt, après celui du défilement de `VirtualGrid`, et pour
  la même sorte de raison : un appel impératif a besoin du DOM d'après, pas de celui d'avant ;
- **l'appel doit rester dans l'activation utilisateur du clic**, ce qui exclut de l'attendre dans un
  effet : WebKit refuse `showPicker()` en dehors, avec un `NotAllowedError`. C'est la seule chose que
  Vitest ne peut pas juger — jsdom n'a pas la notion —, donc un test Playwright espionne
  `showPicker` et vérifie que le navigateur **ne refuse pas**. Le `catch` reste : là où l'appel
  manque ou est refusé, le champ garde le focus et reste saisissable au clavier, ce qui était le
  comportement du premier jet.

**Et `poserFiltre` rend le tableau reçu quand rien ne change.** `RowQuery` est mémoïsée sur
`filters` : un tableau neuf est une **requête neuve**, donc cinq cents lignes relues. C'était déjà le
cas en choisissant un opérateur sur un champ vide — un défaut antérieur, que le sélecteur de date
rendait seulement plus visible. L'identité est ici une information, pas un détail de représentation.

### Lire une colonne d'entiers comme un horodatage (3 septembre 2026)

Une époque rangée dans un `bigint` est courante, et l'écran n'en montrait que le nombre. **La
question n'était pas de la convertir mais de savoir laquelle convertir** : un `bigint` qui porte une
époque et un `bigint` qui compte des centimes sont le **même type déclaré**. Aucune règle ne les
sépare — un nom en `_at` peut porter une durée, une plage de valeurs plausible l'est aussi pour un
identifiant — et le moteur, lui, déclare franchement un nombre.

**Donc rien n'est deviné : l'utilisateur le dit, colonne par colonne**, depuis le menu de l'en-tête,
comme il dit déjà quelle colonne masquer et quelle largeur lui donner. Réinterpréter d'office
reviendrait à contredire le catalogue au jugé, et un montant affiché en date de 1970 est un mensonge
silencieux dans l'outil dont le métier est de montrer ce qui est stocké. Sept points à ne pas
défaire :

- **l'échantillon *suggère* l'échelle, il ne la choisit pas.** Le compte de chiffres est fiable — une
  même seconde s'écrit en 10 chiffres, 13 en millisecondes, 16 en microsecondes, et 13 chiffres de
  *secondes* seraient l'an 318857 —, mais il ne l'est **que parce qu'on sait déjà qu'il s'agit d'une
  date**. Appliqué à un nombre quelconque, le même compte ne dit rien. Il ne porte donc que la
  mention « (déduit) » dans un libellé, et les trois échelles restent proposées : se tromper n'y
  coûte rien ;
- **la lecture en vigueur est *désactivée avec sa raison*, pas cochée.** C'est la convention
  d'`EntreeDeMenu` (`onClick` absent + `raison`), déjà celle de la dernière colonne visible et de
  « Copier la valeur » sur une cellule au défaut : l'entrée grisée est celle qui est en vigueur. Une
  coche aurait demandé un glyphe sur **toutes** les entrées du menu, que `MenuContextuel` veut
  homogènes — « un menu sans icône aligne ses libellés au bord, un menu qui en a les aligne après le
  glyphe ». **Réserve, et elle est antérieure** : `MenuContextuel` rend ses entrées désactivées en
  `disabled` et non en `aria-disabled`, donc leur `title` n'est atteignable ni au survol ni au
  clavier — c'est le piège n° 3 d'accessibilité, et il vaut déjà pour « Copier la valeur » et
  « Masquer la colonne ». Le grisé se voit, la raison non ; la corriger touche les quatre appelants du
  composant et n'a pas été mêlée à ce chantier ;
- **les entrées n'existent que pour une colonne numérique.** Une colonne que le moteur déclare déjà
  temporelle n'a rien à choisir, une colonne de texte n'a pas d'époque à lire : les proposer partout
  ferait chercher à quoi elles servent, exactement comme un `is null` sur une colonne `NOT NULL` ;
- **`valeurRelue` rend une `Value`, pas une chaîne**, et c'est ce qui fait suivre tout le reste sans
  une ligne de plus : `texteDeValeur` la met en texte, `rendreValeur` en nœud, `estNumerique` la
  range **à gauche** comme les autres horodatages, et `largeurAjustee` mesure la date (19 caractères)
  et non l'entier (13), sans quoi la colonne serait coupée à l'ellipse ;
- **l'affichage seul.** La valeur reste un nombre partout où elle est **écrite** : la cellule qu'on
  édite montre l'entier, `row_as_insert` compose l'entier, et l'onglet JSON du panneau de ligne porte
  l'entier — c'est le document qui se réécrit (`18g`). Une date convertie sur un de ces chemins
  partirait vers une colonne numérique. Une **saisie en attente** n'est pas relue non plus, pour la
  même raison ;
- **le panneau de ligne applique la même lecture que la grille**, par le canal `onLectureChange` qui
  existait déjà. Deux lectures divergentes de la même cellule — l'une en date, l'autre en nombre — se
  liraient comme un défaut de lecture ; c'est le motif de la sélection, pilotée depuis l'écran pour
  cette raison précise. Les **valeurs**, elles, montent brutes : `row_as_insert` compose son SQL à
  partir de cette même ligne ;
- **`UTC`, et non l'heure locale.** Une époque est un instant absolu : choisir un fuseau ferait
  dépendre l'affichage du poste, donc aussi ce que chaque test et chaque capture de fidélité mesurent
  (la leçon de `DORABASE_VERSION_DECOR`). C'est surtout la cohérence avec le filtre qui décide — la
  borne d'un « avant le » est minuit **UTC**, et une date affichée dans un autre fuseau que celle qui
  filtre se lirait comme un décalage d'un jour.

**Aucun moteur n'a changé d'une ligne, et c'est la propriété qui tient l'ensemble.** La colonne reste
numérique pour le Rust ; `categorieLue` est le seul détour de l'écran — elle rend `'timestamp'` pour
une colonne lue en horodatage, ce qui lui donne « avant le », « après le » et leur calendrier par le
chemin déjà écrit —, et `appliquerFiltre` rend la date choisie à son entier avant de l'envoyer. Le
filtre part donc en comparaison de nombres, et le champ de date se remplit par la conversion inverse
(`dateDepuisLaBorne`) : sans ce retour, un `type="date"` recevrait `1772668800000`, l'écarterait, et
se viderait sous les yeux de qui vient de choisir une date.

**Deux limites assumées.** Le chip de la barre d'outils montre la valeur **envoyée** — l'entier, non
la date : c'est la phrase littérale de la requête, et l'en-tête montre déjà la date choisie. Et
l'échelle **nanoseconde** n'est pas offerte : elle existe (Go, `Instant.toEpochNano`), mais les trois
échelles couvrent ce qu'on rencontre en base, et une quatrième entrée dans le menu se paie sur
chaque clic droit.

**Ce qui n'a pas changé, et qu'il ne faut pas « harmoniser »** : l'opérateur affiché n'est **pas** un
filtre appliqué. Un booléen montre `is true` d'emblée, faute d'`=` pour commencer sa liste ; c'est la
prop `applique` — donc la présence d'un filtre dans `filters` — qui allume la bordure d'accent, et
elle seule. La déduire de la valeur du champ était impossible dès qu'un prédicat s'applique sans
valeur.

### La règle « ligne liée »

Pour une clé étrangère, n'afficher l'aperçu de la ligne cible que si elle contient au
moins un champ lisible par un humain — liste blanche insensible à la casse : `email`,
`name`, `label`, `title`, `first_name`/`firstName`, `last_name`/`lastName`, `username`,
`slug`, `code`, `reference`. Sinon, ne rien afficher : pas de dump d'identifiants
techniques. Mentionner les champs détectés en légende.

### Accessibilité — cinq pièges qui se sont répétés

1. **Le nom accessible se concatène sans espace.** « Tables8 », « orders1.9 M », « ∅is null » :
   cinq occurrences. Dès qu'un composant place deux contenus côte à côte, l'espace doit être
   **explicite**, et dans le composant — pas chez l'appelant. La cinquième s'est vue en *ajoutant*
   des entrées au popover d'opérateur : « ∅is null » passait inaperçu, « Tis true » ne pouvait plus.
   Un `gap` de CSS sépare à l'œil, jamais dans l'arbre d'accessibilité.
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
5. **Un contrôle imbriqué compte pour sa *valeur* dans le nom de ce qui l'entoure.** Une cellule
   d'en-tête tire son nom de son contenu, et un `role="slider"` rencontré au fil de ce contenu y
   entre par son `aria-valuenow` (accname 2F, « embedded control ») : la poignée de
   redimensionnement faisait s'annoncer `nom` « nom 120 », et **le nom de la colonne changeait à
   chaque redimensionnement**. C'est le piège n° 1 par un bout qu'aucun espace explicite
   n'arrangerait — ce n'est pas l'espace qui manque, c'est le nombre qui n'a rien à faire là. D'où
   `GridColumn.headerLabel`, qui rend son nom à la cellule ; un test le garde **des deux côtés**,
   avec et sans.

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

**Et une entrée du registre pouvait survivre à son socket** (8 septembre 2026). C'est le même défaut
par le troisième bout : le 31 août, le registre avait fermé et l'écran disait ouvert ; ici l'écran
**et** le registre disent ouvert, et c'est le socket qui est parti. `tokio-postgres` sépare le client
de sa boucle d'entrées-sorties, et quand celle-ci s'arrête — session inactive coupée par le serveur,
veille du Mac, changement de réseau, proxy tombé — le `Client` **survit, muet**. La seule trace était
un `log::debug!` dans `postgres/connect.rs`. L'entrée restait au registre, l'état restait
`Connected`, et **toute** lecture suivante échouait : la grille affichait « connection closed » — le
mot du pilote, en anglais — pendant que la barre disait « lecture impossible » et que l'arbre disait
« OK » sur la même base.

**Rien n'en sortait, et c'est ce qui en faisait une panne plutôt qu'un incident.**
`marquer_hors_ligne` n'était appelé qu'à l'ouverture ; le front n'expose aucun « fermer la
connexion » — `closeDatabase` existe des deux côtés et **aucun composant ne l'appelle** ; et replier
puis déplier ne rouvre rien, `charger` ne rappelant `chargerBase` que si les schémas ont quitté le
cache. Il fallait relancer l'application.

Le remède tient en une question posée au bon moment, et en quatre points à ne pas défaire :

- **la question est posée au moteur, pas déduite d'une chaîne.** `AnyEngine::connexion_perdue` est
  inhérente et répartie par un `match` sans bras attrape-tout, comme `close` : un sixième moteur ne
  compilera pas tant qu'il n'aura pas répondu. Une méthode de trait à corps par défaut lui donnerait
  « toujours vivante » sans que personne l'ait choisi — le bras attrape-tout de la règle n° 16, avec
  le même prix. Et les réponses **diffèrent** : PostgreSQL est le seul à tenir un socket unique
  (`Client::is_closed`), MySQL et MongoDB s'en remettent à leur pool et ne concluent que d'un proxy
  tombé, SQLite et BigQuery n'ont rien à perdre ;
- **elle n'est posée qu'après un échec.** Une requête qui a rendu ses lignes a prouvé sa connexion,
  et interroger le pilote à chaque succès ferait payer un verdict à tout le chemin heureux. Un échec
  **ordinaire** — SQL fautif, droits refusés — laisse la connexion en place, ce qu'un contrôle
  négatif garde des deux côtés du pont : sans lui, la première faute de frappe dans la console
  fermerait la connexion, tunnel compris ;
- **on ferme, on ne se contente pas de retirer.** L'adaptateur détient le proxy : un client mort
  derrière un tunnel SSH vivant fuirait sa session et son port jusqu'à la fin de l'application ;
- **et l'écran doit demander, sinon la moitié Rust ne garantit rien** (règle n° 20). Une lecture de
  table ou une exécution de console **ne change rien à la configuration**, donc `projects` ne bouge
  pas et l'effet du 31 août ne se rejoue pas. `data/commandes.ts` — le seul point de contact avec
  l'IPC — annonce donc tout échec de commande, et l'arbre y répond par `synchroniserAvecLeRegistre`.
  **Une règle, pas N branchements**, exactement comme la relecture sur `projects` : *toute commande
  qui échoue peut avoir échoué parce que le registre a perdu une connexion*. `connection_states` est
  la seule exclue — l'abonné y répond en l'appelant, et s'annoncer à soi-même ferait tourner la
  boucle sans fin dès que le pont est muet, ce qui est le cas ordinaire hors de la webview.

**Le message aussi a changé, et pour la même raison que l'arbre.** « connection closed » est tout ce
que `Kind::Closed` dit, sans source : ni la cause, ni la manœuvre. `postgres/error.rs` le remplace
par une phrase qui nomme les quatre causes et dit de rouvrir la base — ce qui n'est une vraie
manœuvre que parce que le registre a retiré l'entrée. **Ce n'est pas la réécriture d'un message de
moteur** que la règle des états hors ligne interdit : il n'y a pas de message de moteur ici, il n'y a
plus de moteur au bout du socket.

**`pg_terminate_backend(pg_backend_pid())` est ce qui rend tout cela testable sans dormir.** Le
serveur coupe notre propre session, donc la coupure est un fait et non une attente (règle n° 3). Un
piège en revanche : **c'est la seconde requête qui juge, pas celle qui coupe.** Celle-ci reçoit un
`FATAL` du serveur, donc une erreur *de base* avec son `SQLSTATE`, et la boucle d'entrées-sorties
peut n'avoir pas encore vu la fin du flux. La suivante est fermée dans les deux ordres possibles —
ou l'émetteur est déjà clos, ou la réponse n'arrive jamais et `Responses::next` rend le même
`Error::closed()`. C'est la raison pour laquelle le test du **registre** ne juge pas le message,
qui dépend de l'ordre, mais l'issue — plus d'entrée, un état qui le dit — pendant que le test de
l'**adaptateur** juge le message, où il est déterministe.

**Et le registre rouvre ce qu'il a déjà ouvert** (8 septembre 2026). Retirer une connexion morte
rendait l'arbre honnête ; il restait à l'utilisateur un clic à faire pour une panne dont il n'était
pour rien. La reconnexion a **deux étages**, et c'est la distinction qui porte tout le reste :

- **rouvrir *avant* d'exécuter est sûr pour tout le monde** — l'opération n'a pas encore tourné.
  C'est l'étage du bas, qu'aucun appelant n'a à demander : une entrée absente dont la recette est là
  se rouvre, et le geste suivant marche sans que personne ait rien cliqué ;
- **rejouer *après* un échec ne l'est pas.** Une écriture peut avoir été **validée par le serveur
  avant** que la coupure n'empêche l'accusé de réception d'arriver : la rejouer insérerait une
  seconde fois les lignes ajoutées — le geste que ce fichier dit déjà ne pas savoir défaire.

D'où `Reprise`, **paramètre obligatoire d'`avec` et non seconde méthode** : une méthode « avec
reprise » s'oublie, et le silence prendrait alors la réponse la moins vraie sans que personne l'ait
choisie. C'est la leçon du bras attrape-tout (règle n° 16) appliquée à une décision qui peut écrire
deux fois. Six opérations sont `Rejouable` — les cinq lectures, plus `preview_updates`, qui n'ouvre
aucune transaction et ne rend que du texte. Deux sont `Unique` : `apply_changes`, et **`run_sql`,
dont rien ici ne sait s'il lit ou s'il écrit** — la console accepte les DML. Le prix de `Fn` est un
clone de la requête par essai, qui ne pèse rien contre un aller-retour réseau.

Quatre points à ne pas défaire :

- **une reprise, jamais une boucle.** Un serveur qui coupe chaque session — un répartiteur mal
  réglé, un `idle_session_timeout` à zéro — ferait sinon tourner le registre indéfiniment. Le test
  qui le garde compte les passages de la fermeture : deux, jamais trois ;
- **la recette part à la fermeture, et c'est ce qui distingue une perte d'une fermeture demandée.**
  Les six commandes de configuration qui appellent `fermer` sont exactement celles qui **périment**
  ce que la recette décrit : rouvrir sur l'ancien hôte, ou avec l'ancien secret, serait pire que ne
  rien rouvrir. Corollaire : *le registre ne rouvre que ce qu'il a déjà ouvert avec succès*, donc
  une base jamais jointe s'entend toujours dire qu'elle doit l'être d'abord ;
- **la recette garde un secret en mémoire**, et cela se dit plutôt que se découvre. Ce n'est pas une
  exposition d'une nature nouvelle — le client du pilote détient déjà la configuration qui le porte,
  d'où le `Debug` écrit à la main de chaque adaptateur —, mais c'est un exemplaire de plus ; `Secret`
  n'a ni `Display` ni `Serialize`, donc une recette ne peut ni se journaliser ni traverser l'IPC ;
- **l'entrée morte est retirée sous le verrou qui a porté l'opération**, pas un instant plus tard.
  Le relâcher d'abord ouvrait une fenêtre où une seconde lecture, tombée sur la même connexion
  morte, la retire, la ferme et en rouvre une **neuve** — que nous fermerions ensuite en croyant
  fermer la nôtre. La reconnexion crée cette fenêtre : avant elle, deux lectures concurrentes ne
  pouvaient que retirer deux fois la même entrée, ce qui est sans effet.

**Un défaut antérieur trouvé en route, et corrigé** : la garde d'entrée d'`ouvrir` est relâchée
pendant la connexion, donc deux ouvertures concurrentes de la même base la franchissaient toutes les
deux, et la seconde `insert` **remplaçait** la première sans la fermer — un tunnel SSH et son port
perdus, sans la moindre erreur. Personne ne l'avait vu parce que l'écran sérialise ses ouvertures
(`enCours` d'`useArbre`) ; la reconnexion en crée une nouvelle occasion, deux lectures pouvant
retomber ensemble sur une connexion morte. Sous le verrou, c'est désormais **la nôtre** qu'on
referme quand l'autre a gagné.

**Ce qui prouve une reconnexion, c'est `pg_backend_pid`.** Un test qui vérifierait seulement que la
lecture réussit passerait sur un serveur qui n'aurait rien coupé : le numéro de session nomme le
processus serveur, et deux valeurs différentes ne s'obtiennent qu'en ayant vraiment rouvert. Et
pour le rejeu, c'est un **compte de passages** de la fermeture qui juge, non le message rendu —
mesurer le rejeu par un effet de bord en base aurait demandé une table d'appoint sans rien dire de
plus.

**Ouvrir une console ouvre sa connexion** (1er septembre 2026). L'ouverture n'avait qu'un
déclencheur — regarder ou déplier la ligne de la base dans l'arbre —, or une console s'ouvre
ailleurs : le menu « … » d'une connexion est atteignable dès que son **environnement** est déplié, et
il crée la console *et* l'ouvre du même geste. L'onglet passait donc au premier plan sur une
connexion fermée : première exécution en « aucune connexion ouverte pour … », et catalogue
d'autocomplétion **muet** — ni schéma, ni table, ni colonne, `charge.schemas` étant simplement vide.
`useArbre.assurerLOuverture` ouvre par les coordonnées plutôt que par le nœud d'arbre, et les trois
points d'ouverture d'une console l'appellent. Trois points à ne pas défaire :

- **un échec n'est pas mémorisé comme un refus.** Les consoles d'une connexion s'affichent malgré son
  échec, délibérément — une console est un texte qu'on a écrit —, donc le clic doit **retenter**
  plutôt qu'ouvrir un onglet inerte. C'est ce que `charger` fait déjà sur une ligne d'arbre ;
- **une ouverture en vol n'est pas relancée** (`enCours`), là où `charger` ne regarde que les schémas :
  un clic sur une console n'est pas une bascule, donc rien n'empêche un second d'arriver pendant que
  le premier ouvre — et ce serait deux connexions au même serveur ;
- **ouvrir n'est pas déplier.** Le cache rempli sert la console ; la ligne d'arbre ne bouge que si on
  la déplie, et `charger` n'y rouvrira pas ce qui est déjà là.

**Et une purge ne conclut rien d'une lecture qu'une ouverture a périmée** (`ouverturesAbouties`).
C'est le pendant de `tourDesEtats`, par l'autre bout : celui-ci empêche une lecture **dépassée**
d'écraser une plus récente, il ne dit rien d'une lecture **à jour au départ** appliquée à un cache qui
a grandi depuis. Or ouvrir une console fait exactement se croiser les deux — la création réécrit
`projects`, donc déclenche la relecture du registre, pendant que la connexion s'ouvre : la lecture
partait avant que le registre ne tienne la connexion, revenait après que ses schémas étaient en
cache, et **les reprenait**. Console sans catalogue, ligne repliée, et rien pour le dire. Le témoin
est incrémenté dans le même bloc synchrone que la mise en cache ; une purge qui le voit bouger
pendant sa lecture s'abstient — la lecture des **états**, elle, reste appliquée, puisqu'elle est vraie
de son instant. Ce qui se perd est une purge, pas une garantie : le prochain changement de
configuration la refera.

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

**L'introspection PostgreSQL lit des ensembles, pas des tables** (3 septembre 2026). Deux défauts
de coût, trouvés en cherchant pourquoi le diagramme d'un grand schéma prenait quelques minutes, et
tous deux propres à PostgreSQL — MySQL lit son résumé par un `exec_first` et SQLite par un
`query_row`, une ligne chacun.

- **`table_detail` balayait tout le schéma pour lire une ligne.** Il appelait `objects(schema)` —
  `pg_total_relation_size` par relation, trois sous-requêtes corrélées, une jointure sur
  `pg_stat_all_tables` — puis cherchait sa table en Rust. Mesuré sur un schéma synthétique de deux
  cents relations **vides**, donc le plancher : rejouer soixante `table_detail` coûtait 183 ms de
  requêtes, contre 7,4 ms avec un filtre de noms. La requête en prend un désormais ; `NULL` rend
  tout le schéma, ce dont `list_objects` a besoin.
- **Les cinq requêtes de détail portaient sur une table.** Elles filtrent sur un ensemble d'oid et
  rendent leur `relid`, que `table_details` regroupe : six allers-retours pour un schéma entier au
  lieu de six par table. `pg_indexes` est le seul à se borner par nom — cette vue ne porte pas
  d'oid.

**Il n'y a pas deux versions de ces requêtes** : `table_detail` passe par `table_details` avec un
seul nom. C'est la même SQL pour une table et pour soixante, donc les tests qui existaient
l'exercent toujours, et aucune forme « pour une table » ne vieillit à part. Ce qui reste propre à
`table_detail` est le **refus** : une table nommée absente est une erreur, là où une lecture de
schéma l'omet — celle-ci part d'une liste établie un instant plus tôt, et une table retirée
entre-temps ne doit pas emporter les cinquante-neuf autres.

**Et `table_details` n'entre pas au contrat de moteur.** La lecture ensembliste n'a d'équivalent
chez aucun des quatre autres — MongoDB échantillonne collection par collection, SQLite interroge un
`pragma` par table, BigQuery un appel REST par table — et l'inscrire au contrat aurait obligé chacun
à déclarer une optimisation qu'il n'a pas. C'est une méthode inhérente à `PostgresAdapter`, et
`AnyEngine::table_details` choisit : PostgreSQL, ou une boucle pour les quatre autres, qui gagnent
quand même la prise de verrou unique et les traversées d'IPC économisées. **Le `match` reste
exhaustif** — les quatre sont nommés, pas absorbés par un `autre =>` : c'est la leçon du défaut
n° 16, et un sixième moteur fera échouer la compilation là où son auteur doit choisir.

**Ce qu'aucun test de comportement ne pouvait garder.** Neutraliser le filtre de noms rend
**exactement** les mêmes structures, en soixante fois plus de travail : les soixante-et-un tests sur
base réelle restaient verts sous ce sabotage. Réécrire les cinq requêtes pour une seule table, de
même. Ce sont donc des **réglages** qui sont gardés, par deux tests structurels sur le texte des
requêtes — la leçon de la règle n° 3 et du `nodelay` de `russh`, où un test calé sur une durée
aurait été un tirage au sort. Ce que les tests de base gardent, eux, n'est pas
l'équivalence de l'ancienne lecture avec la nouvelle — `table_detail` *passant par* `table_details`,
les deux côtés d'un `assert_eq!` exécutent le même code, et une omission partagée le laisse vert
(vérifié par sabotage). Ce qui diffère entre les deux côtés est le **nombre de tables demandées**,
un contre quatre, et c'est précisément ce qu'il faut pour dénoncer le défaut propre à la forme
ensembliste : un **regroupement** qui attribue à une table les index ou les triggers d'une autre, et
rend un `TableDetail` complet, plausible et faux. Lue seule, une table n'a que ses propres lignes à
se voir attribuer : la lecture unique est le témoin de la lecture groupée.

**Et ce que deux lectures d'une base vivante ne peuvent pas comparer en est écarté, ce que la CI a
imposé.** La première version comparait `TableDetail` entier, en s'en félicitant — « la comparaison
porte sur tout ». Verte en local et deux fois en CI, puis rouge sur `users` **sans qu'une ligne de
SQL ait bougé** : la lecture unique voyait une relation entrante de plus, venue d'un schéma nommé
`ddl_rejeu_orders`. C'est le schéma jetable de `le_ddl_produit_se_rejoue_et_donne_la_meme_table`, qui
tournait en parallèle et y rejoue le DDL d'`orders` — dont la clé étrangère continue de viser
`introspection.users`, son propre commentaire le disant. Le temps de ce test, `users` a une
référente de plus, et les deux lectures tombent de part et d'autre.

**Aucune sérialisation ne réglerait cela proprement** : le décor est partagé, les tests sont
parallèles par défaut, et un test qui exige que rien d'autre ne tourne s'approprie la suite. Sont
donc écartés les **relations dont l'autre bout est hors du schéma étudié** — la cause observée, et
reproduite depuis à volonté en créant ce schéma *entre* les deux lectures, ce qui fait échouer le
test sans le filtre et passer avec — et, par précaution, le **compte de lignes** et la **taille** :
`reltuples` et `pg_total_relation_size` sont des mesures d'un instant, que tout test écrivant dans
une de ces tables déplace. Cette seconde moitié n'a rien cassé — en CI les deux valent zéro et
`None` — mais c'est un tirage au sort qui n'est pas encore sorti (règle n° 3). Ce qui subsiste d'eux
est ce qui ne dépend pas de l'instant : la même *sorte* de comptage, et une taille rendue par les
deux chemins ou par aucun.

**La leçon générale** : un test qui compare deux lectures d'une base vivante ne peut comparer que ce
qui ne bouge pas entre elles — et sur un décor partagé par des tests parallèles, ce qui bouge n'est
pas seulement les statistiques, c'est **tout ce qu'un autre test peut créer**, jusqu'à une clé
étrangère qui apparaît dans un schéma dont le sujet n'a jamais entendu parler.

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

**L'annonce est une notification en bas à droite, et ne rend rien par défaut** (2 septembre 2026).
La propriété centrale n'a pas bougé : hors de la webview (galerie, `?demo`, tout Playwright) la
recherche est rejetée, l'état reste nul, le composant ne rend rien — donc **aucune capture de
fidélité ne bouge et il n'y a pas de variante de décor à maintenir**. Le silence sur rejet est le
comportement voulu, pas un oubli.

**Ce qui a changé, c'est l'endroit**, et c'est le troisième essai. L'annonce a d'abord été une ligne
de `shell/StatusBar` (26 août), puis des **trois** barres d'état, celle de l'accueil ne servant que
l'écran où personne ne travaille. Deux choses ont fini par la faire partir de là :

- **un onglet de console n'a aucune barre au niveau de l'écran** — son pied vit dans le panneau
  central —, donc le montage en trois exemplaires laissait un trou qu'un quatrième n'aurait pas
  comblé sans changer une composition ;
- **sur l'écran d'accueil, elle se lisait comme une invitation.** Rapporté à l'usage : la seule
  phrase de la barre qui ne *décrivait* pas l'application y demandait quelque chose, glissée entre le
  compte de projets et le numéro de version. Une bande de 26 px n'a pas la place de distinguer ce
  qui décrit de ce qui demande.

`shell/AnnonceMiseAJour` est donc montée **une fois, au niveau de l'application**, en
`position: fixed` : elle ne dépend plus d'aucune composition d'écran. Quatre points à ne pas
défaire :

- **elle n'installe pas, elle mène** — « Installer » ouvre la section « Mises à jour » d'`A10` en lui
  passant la recherche déjà faite (`sectionInitiale`, `majDejaTrouvee`). L'installation demande les
  notes de la release, un avertissement de redémarrage et un état d'échec : trois choses que `A10`
  porte déjà, et qu'un coin d'écran redirait moins bien ;
- **arriver là ne relance pas de recherche.** Sans la recherche transmise, il faudrait recliquer
  « Rechercher » pour réafficher ce que la notification venait de dire, et refaire une requête pour
  une réponse connue. `null` laisse la section sur « pas encore cherché », qui n'est pas « à jour » ;
- **écartée, elle ne revient pas de la session, et rien n'est persisté.** La recherche n'a lieu qu'au
  démarrage : le prochain lancement la refera de toute façon, et se souvenir d'un refus reviendrait à
  taire une version que l'utilisateur n'a toujours pas installée ;
- **elle passe sous le voile d'une modale** (`z-index: 90` contre 100). Quand `A10` s'ouvre, elle a
  fini son travail — elle s'efface d'ailleurs en y menant, sans quoi la retrouver en fermant la
  modale redemanderait ce qu'on vient d'aller faire.

Ce qui reste vrai de l'arbitrage d'origine : **une mise à jour n'est pas un événement.** Elle
attend. Pas de modale, pas de bandeau qui prend une bande de l'écran, pas de recherche périodique.

**Et une seconde voie, demandée à la main, dans les préférences** (26 août 2026). La notification
annonce ce qu'elle a trouvé au démarrage ; elle ne répond pas à « et maintenant ? », qui est la
question qu'on se pose en attendant un correctif. La section « Mises à jour » de `A10` porte donc un
bouton qui cherche, et le résultat qui s'ensuit. Trois points à ne pas défaire :

- **rien n'est cherché à l'ouverture de la modale.** Une recherche au montage ferait dépendre le
  rendu de `A10` d'une réponse réseau, donc de l'instant, et toute capture de fidélité de cet écran
  deviendrait instable. C'est le même arbitrage que « la notification ne rend rien par défaut »,
  pour la même raison ;
- **ici l'échec se dit**, à l'inverse de la notification qui l'avale. La règle n'a pas changé : on ne
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
`input[type="range"]` des préférences, et depuis le 3 septembre 2026 le calendrier du sélecteur de
date des filtres. Sans lui, « Nuit » laisserait des barres claires sur des panneaux sombres, et un
calendrier blanc sur un en-tête sombre. C'est aussi ce qui rend ce contrôle natif acceptable sans
une ligne de CSS de plus : il suit le thème tout seul.

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

### Windows (31 août 2026)

**Windows est une cible de développement, d'exécution et — depuis le 1er septembre 2026 — de
distribution.** Le produit y compile, s'y lance et y fait tout ce qu'il fait sur macOS —
Gestionnaire d'identifiants, SSH, dump, proxy Cloud SQL —, `ci.yml` porte un job
`windows-latest` qui le tient, et `publication.yml` attache un installateur NSIS à chaque
release.

**Ce qui n'existe toujours pas : la signature, et donc la mise à jour en place.** Il n'y a pas
de certificat Authenticode, donc SmartScreen avertit à chaque téléchargement — c'est le même
arbitrage que `signingIdentity: "-"` avant l'achat du Developer ID, un cran plus rude, et les
notes de release le disent plutôt que de le laisser découvrir. Corollaire à ne pas défaire :
`latest.json` ne porte que les deux clefs `darwin-*`, et l'archive `.nsis.zip` que
`createUpdaterArtifacts` produit **n'est pas publiée**. C'est « rien n'est proposé qui n'ait été
notarié » transposé : proposer un remplacement qu'on ne peut pas authentifier, chez des gens qui
n'ont rien demandé, est pire que ne rien proposer. Deux gardes de `verifier-ci.py` le tiennent,
et les retirer est le geste visible en revue qui ouvrirait cette voie.

**L'installateur s'attache après coup, et c'est un ordre, pas une négligence.** Le job `windows`
de `publication.yml` déclare `needs: macos` et emploie `gh release upload` — pas un second
`gh release create`, dont l'unicité décide du `--latest`. La conséquence voulue : **un échec de
la construction Windows ne coûte pas la release macOS**, qui reste l'artefact soutenu. Faire
l'inverse rendrait la publication macOS tributaire d'une plateforme qui n'est même pas signée.
Ce qui se paie en échange est quelques minutes entre la parution de la release et celle du
`.exe`.

**La plateforme est une constante de construction, `__APP_PLATFORM__`** — posée par
`vite.config.ts` depuis `process.platform`, comme `__APP_ARCH__` et pour la raison qui y est
déjà écrite : `navigator.userAgent` n'est pas fiable dans une webview, et un bundle est
*construit pour* une plateforme. Elle est lue par **`src/shell/plateforme.ts` et nulle part
ailleurs** : un composant qui interrogerait le global contournerait le seul endroit où le sens
de cette valeur est écrit, et sortirait du champ des tests.

**`DORABASE_PLATEFORME_DECOR` est la troisième valeur figée pour le décor**, après la version
(`DORABASE_VERSION_DECOR`) et la locale, et pour la même raison : ce que la machine décide ne
doit pas décider ce que les tests mesurent. C'est elle qui rend **toute la coquille Windows
vérifiable depuis un Mac** — les trois boutons, les libellés `Ctrl+`, la géométrie de la barre.
Sans elle, il faudrait un runner Windows pour Playwright, et les captures de fidélité y seraient
*écrites* au lieu d'être comparées. Deux conséquences pratiques :

- `playwright.config.ts` démarre **deux** serveurs Vite et déclare **deux** projets. Le projet
  `windows` n'exécute que les fichiers `*.windows.spec.ts` ; y rejouer la suite entière ferait
  comparer un rendu Windows à des références `-darwin.png` ;
- `pnpm test` est vert **sous les deux décors**, et c'est une exigence, pas une coïncidence : une
  suite qui rougirait sous `windows` rougirait sur un poste Windows, où l'on est censé pouvoir
  développer. Les frappes de test passent donc par `auModificateur` (`src/test/raccourcis.ts`) et
  les libellés par `raccourci`, jamais par un `{Meta>}` ni un `⌘` en dur. Mesuré : 29 tests
  tombaient avant ce détour.

**Le modificateur est `Ctrl`, et ce n'est pas une substitution de caractère.** Trois choses
changent ensemble — le symbole (`⌘` / `Ctrl`), le séparateur (macOS colle, Windows joint par `+`)
et **l'ordre** (`⇧⌘E` contre `Ctrl+Shift+E`). Remplacer `⌘` par `Ctrl+` aurait donné
« Shift+Ctrl+E », que rien n'écrit. D'où `raccourci()`, et non une constante. Piège associé :
`seulLeModificateur` existe parce que `useRaccourcisDeCreation` excluait `ctrlKey` comme
« un modificateur qui n'est pas le nôtre » — sous Windows c'est le nôtre, et `Ctrl+N` n'aurait
jamais rien ouvert, **en silence**, puisque rien n'échoue quand un raccourci ne répond pas.

**La barre de titre est dessinée par nous, boutons compris — les premiers pixels inventés du
projet.** `titleBarStyle: "Overlay"` et `hiddenTitle` sont des clefs macOS : sous Windows elles
ne font rien, et le système dessine sa propre barre **au-dessus** de la nôtre. L'alternative
refusée était de la garder : 72 px de chrome pour 40 px d'information, le mot « DoraBase » deux
fois, et les 78 px de dégagement des feux devenus un trou inexpliqué. `decorations: false` retire
le cadre, et `TitleBar` monte trois boutons à droite. Quatre points à ne pas défaire :

- **le glyphe central suit l'état** (carré / deux carrés décalés) : c'est la seule raison de la
  permission `core:window:allow-is-maximized`. Un bouton qui annoncerait toujours « Agrandir »
  mentirait une fois sur deux sur ce qu'il va faire ;
- **le survol rouge de la fermeture est le cinquième état de survol du dépôt**, et il est
  délibéré : la convention Windows est si forte que s'en écarter ferait chercher le bouton. Le
  rouge est `--hover-close`, **dérivé de `--danger` par `var()`** — donc celui du produit et non
  le `#E81123` de Microsoft, qui jurerait sur du papier crème ; donc aussi aucune couleur
  littérale ajoutée, et « Nuit » suit tout seul sans entrée à tenir en phase. `--hover-close-ink`
  est l'encre : deux jetons plutôt qu'un, parce qu'un jeton nommé pour une surface ne doit jamais
  servir d'encre (la leçon d'`--on-dark`) ;
- **la passerelle `PasserelleFenetre` est injectée**, comme `PASSERELLE_ZOOM`, et ses quatre
  fonctions sont `async`. Ce n'est pas décoratif : **`getCurrentWindow()` lève *synchronément***
  hors de la webview (il lit `__TAURI_INTERNALS__.metadata`), donc un `() => getCurrentWindow()
  .minimize()` ne construit jamais le `.catch()` de l'appelant. Mesuré : **81 tests** sont tombés
  d'un coup, et la galerie, `?demo` et toute la suite Playwright d'un build Windows auraient
  planté net. Même piège que le `SecurityError` synchrone d'un WebSocket refusé par la CSP ;
- **`dimmed` ternit enfin les boutons**, ce que le mockup demandait et que macOS refusait : les
  feux y sont dessinés par le système, les nôtres obéissent au CSS.

**Le Gestionnaire d'identifiants n'a pas de question de signature à poser, et c'est la prémisse
qui diffère, pas le code.** Tout `secrets/signature.rs` existe parce que les ACL du Trousseau
macOS sont liées à la **signature de code**, qui change à chaque build ad-hoc. Les entrées de
Windows sont protégées par DPAPI et rattachées au **compte de l'utilisateur**, qui ne change pas
d'une reconstruction à l'autre : il n'y a rien à détecter. Laisser tourner la détection était le
pire des deux mondes — `codesign` n'existe pas là-bas, `signature_courante` rend `AdHoc` par
prudence, et le résultat aurait été un **fichier chiffré à vie**, y compris installé, annoncé
fidèlement par le badge d'`A2` sans que personne se demande pourquoi. `selectionner` porte donc
un `if cfg!(windows)`, en `cfg!` et non `#[cfg]` pour que les deux branches restent compilées
partout.

**`USERPROFILE` est le `HOME` de Windows, et l'oublier ne plante pas : ça ment.** Windows ne pose
pas `HOME`, donc un `var_os("HOME")` seul y rend `None` — et un `~/` de tête restait **littéral**.
Le fichier SQLite était alors cherché dans un répertoire **nommé `~`**, le certificat d'autorité
aussi, et le `known_hosts` devenant relatif, **toute** connexion tunnelée était refusée avec le
message qui donne la manœuvre. Trois réponses fausses avec l'aplomb d'un diagnostic, là où une
panne franche aurait été plus honnête.

**Le défaut était à quatre endroits, et c'est la leçon.** `tls.rs`, `sqlite/connect.rs`,
`engine/commands.rs` et `programme.rs` lisaient chacun `HOME` de son côté — et le commentaire de
`chemin_absolu` dans `tls.rs` annonçait déjà « une seule fonction vaut mieux que trois », en
comptant juste. C'est ainsi qu'un défaut arrive à quatre exemplaires : la question « où habite
l'utilisateur » n'a qu'une réponse, elle doit n'avoir qu'un lieu. C'est
`programme::repertoire_personnel` désormais, et les trois autres y délèguent.

Deux conséquences voulues de cette délégation, au passage : un `~` **seul** et un
`~autre-utilisateur` ne sont plus développés. Le premier ne désigne pas un fichier ; le second
donnait `<maison>autre-utilisateur/…`, un chemin fabriqué qui n'était jamais celui qu'on visait.

**Et c'est le job Windows de la CI qui l'a trouvé, pas la compilation croisée.** `cargo xwin
clippy --all-targets` **compile** les tests sans les **exécuter** — le même piège que le job macOS
avait connu le 5 août 2026 avec `clippy --all-targets`. Un `cargo test` pour Windows ne peut pas
tourner depuis un Mac, faute de pouvoir exécuter le binaire produit. Ce qui s'en approche le plus
localement, et qui aurait suffi ici : lancer la suite **sans `HOME`**, avec `USERPROFILE` seul —
c'est la forme d'environnement que Windows présente, et elle se simule en une ligne.

```bash
env -u HOME USERPROFILE=/tmp/faux-home target/debug/deps/dorabase_lib-<empreinte>
```

**Deux pièges de configuration mesurés plutôt que supposés :**

- **Tauri fusionne `tauri.windows.conf.json` par RFC 7386, où un tableau est *remplacé*.**
  `app.windows` étant un tableau, un recouvrement réduit à `{"decorations": false}` fait
  disparaître `title`, `width`, `height`, `minWidth`, `minHeight` et `resizable` — le bundle prend
  les défauts de Tauri (800 × 600, sans titre) et **rien n'échoue**. Vérifié contre `json-patch`
  3.0.1, la version du verrou. Le recouvrement répète donc toute la fenêtre, et
  `scripts/verifier-conf-windows.py` garde la répétition honnête : sans lui, relever `width` d'un
  seul côté laisserait Windows à l'ancienne valeur pour toujours.
- **Nommer les projets Playwright a renommé les captures de fidélité.** Le gabarit par défaut est
  `{arg}{-projectName}{-snapshotSuffix}{ext}` : Playwright a cherché `a1-accueil-macos-darwin.png`,
  ne l'a pas trouvé, et l'a **écrit**. Les cinq tests de fidélité sont passés au vert en ne
  comparant rien. C'est le piège que ce fichier consignait pour un runner Linux, atteint sur le
  bon système. D'où un `snapshotPathTemplate` explicite sans `{-projectName}`, et trois contrôles
  dans `verifier-ci.py`.

**Un exécutable se cherche par son extension, et `engine/programme.rs` est le seul endroit qui le
sait.** Windows décide par l'extension là où unix décide par un bit : chercher `kubectl` ou
`cloud-sql-proxy` tout court n'y trouve rien. Pour le proxy c'est même la convention de nommage
des `externalBin` — `<nom>-<triplet><extension>` —, donc **le sidecar embarqué était introuvable
par l'application qui l'embarque**, et le repli `PATH` prenait la main là où rien n'est installé.
`programme::localiser_dans` ajoute donc l'extension pour ses trois appelants à la fois, et le nom
de l'**outil** reste celui qu'ils passent — celui qui paraît dans leurs messages, où
« kubectl.exe est introuvable » nommerait un fichier.

Corollaire : `dump/discover.rs` a rejoint le module au lieu de garder sa copie. C'est ce qui a
retiré le dernier `std::os::unix` non gardé du dépôt **par suppression**, pas par une garde de
plus — et `programme::EMPLACEMENTS_USUELS` est **vide** sous Windows, où le motif qui rend cette
liste nécessaire (le `PATH` minimal d'une app lancée depuis le Finder) n'a pas cours.

**Et un enfant qui est un outil de terminal ouvre une fenêtre, qu'il faut refuser** (7 septembre
2026, rapporté à l'usage : « une fenêtre de terminal apparaît »). Une application graphique Windows
n'a pas de console ; lancer un programme qui en est une — `pg_dump`, `psql`, `kubectl`,
`cloud-sql-proxy` — en fait donc ouvrir une, et c'est une **vraie fenêtre** que l'utilisateur voit.
Elle clignote le temps d'un `--version`, et pour les deux sortes de proxy à sous-processus elle
**reste ouverte aussi longtemps que la connexion** : une fenêtre noire vide à côté de
l'application, que fermer coupe la base. Le `#![windows_subsystem = "windows"]` de `main.rs` ne dit
rien de cela — il retire *notre* console, pas celle que nos enfants demandent, et son
`not(debug_assertions)` laisse d'ailleurs la nôtre en développement, délibérément : c'est là que
les journaux Rust se lisent. Quatre points à ne pas défaire :

- **`CREATE_NO_WINDOW`, et pas `DETACHED_PROCESS`.** Le premier est nommé pour exactement ce cas et
  laisse la **redirection des flux intacte** — or tout ce qui lance ici lit les deux sorties de son
  enfant, c'est même la condition de fonctionnement de `SousProcessus`. Le second parle de la
  console *héritée*, qu'une application graphique n'a de toute façon pas, et Windows l'annonce
  incompatible avec le premier ;
- **un constructeur, pas un réglage à poser** : `programme::commande` et
  `programme::commande_asynchrone` rendent un `Command` déjà marqué, pour la raison que
  `SousProcessus::ouvrir` donne de ses trois redirections — le laisser à l'appelant serait offrir de
  l'oublier. Deux fonctions parce qu'il y a deux types de `Command` dans le dépôt, un seul endroit
  qui porte le drapeau ;
- **la règle est sans exception, y compris pour `codesign`**, que `secrets/signature.rs` lance et
  qui n'est jamais atteint sous Windows. Une liste d'exceptions se périme, et la première y aurait
  fait entrer la deuxième ;
- **et c'est une règle qui est gardée, pas son effet.** `tests/sans_console.rs` refuse tout
  `Command::new` livré ailleurs que dans `programme.rs` — parce qu'un sixième lancement qui
  l'oublierait ne se verrait **d'aucune façon depuis ce poste** : macOS n'a pas de fenêtre à ouvrir,
  le job Windows de la CI compile sans exécuter, et WebView2 n'est pas plus pilotable que WKWebView.
  Le test coupe chaque fichier au couple `#[cfg(…test…)]` + `mod tests` et non au seul attribut :
  `postgres/introspect.rs` en porte un au milieu, et couper là masquerait tout ce qui suit
  (vérifié par sabotage, comme le contrôle positif qui refuse un balayage qui ne trouve rien).

Le nom du fichier chez Google suit un **troisième** vocabulaire, ni le triplet ni `windows.amd64`
mais `cloud-sql-proxy.x64.exe` (vérifié : `windows.amd64` rend 404). Il n'existe pas de binaire
Windows arm64 ; l'émulation x64 couvre ce cas.

**Et les deux sortes de proxy à sous-processus sont en `Box`.** Sous Windows les types de
processus et de handle du système sont bien plus gros : `KubernetesProxy` pèse 368 octets et
`CloudSqlProxy` 328, contre 32 pour `SshTunnel`. Sans `Box`, **chaque** connexion du registre
portait 368 octets, y compris les tunnelées par SSH qui sont le cas courant. Les chiffres viennent
de clippy, et c'est ce qui a évité l'erreur : `CloudSql` boxée la première, c'est `Kubernetes` qui
est devenue la plus grosse. Boxer l'une sans mesurer l'autre n'aurait rien réglé. Sur macOS
l'écart reste sous le seuil du lint, ce qui est la seule raison pour laquelle il a fallu compiler
pour Windows pour le voir.

**Le job `windows` de la CI existe pour une famille de défauts que les deux autres ne peuvent pas
voir.** `src/dump/discover.rs` employait `std::os::unix::fs::PermissionsExt` sans garde : le job
Linux ne pouvait rien en dire, `std::os::unix` existant là aussi. C'était le **seul** défaut de
compilation de tout le dépôt. Le job ne rejoue pas la moitié web — Vitest, Biome, `tsc`, les
jetons et les projections ne dépendent pas de la plateforme — et ne lance pas Playwright, pour la
raison des captures.

**Localement, compiler pour Windows depuis un Mac demande trois outils** : `cargo-xwin` (qui
télécharge le CRT MSVC et le SDK Windows), le `clang-cl` de la formule `llvm` de Homebrew, et
`nasm` (que `aws-lc-sys`, arrivé par `russh`, exige pour son assembleur). `cargo check` suffit et
n'a pas besoin de `lld-link` :

```bash
export PATH="$HOME/.cargo/bin:/opt/homebrew/opt/llvm/bin:$PATH"
pnpm proxy:embarquer x86_64-pc-windows-msvc
cd src-tauri && cargo xwin clippy --target x86_64-pc-windows-msvc --all-targets -- -D warnings
```

**Un défaut préexistant trouvé en route, et corrigé** : `developper()` de `dump/discover.rs` ne
savait pas traiter une étoile occupant un **segment entier**. `Path::new("…/Versions/").parent()`
rend `…/Contents` et `file_name()` rend `Versions`, parce que `Path` ignore la barre finale : le
motif `…/Versions/*/bin` rendait donc `…/Versions/bin`, et **le repli Postgres.app n'a jamais
fonctionné**. Personne ne l'a vu parce que la mesure du 19 août notait « Postgres.app n'est pas
installé » — le seul motif faux était le seul qui ne pouvait rien trouver. Le découpage se fait
désormais sur le segment, et `std::path::is_separator` traite `/` et `\` selon la plateforme.

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
  descripteur n'existe jamais chez nous : le fichier est écrit **par un sous-processus**, qui
  s'achève avant qu'on l'exécute. Et ce n'est pas reproductible à volonté : trois tours verts en
  local ne prouvent rien, seule la CI juge.

  **Et il a fallu qu'il tombe deux fois pour que le remède aille au seul endroit qui compte**
  (7 septembre 2026, `main` rouge sur `dump::discover`). Le 26 août, `cloudsql` puis `kubernetes`
  l'avaient reçu chacun de son côté ; les **cinq autres** poses de faux exécutable du dépôt ne
  l'avaient pas, dont les deux qui *lancent* le leur — le `--version` de `dump::discover`, et le
  faux outil lent de `dump::run`. C'est `programme::poser_un_executable` désormais, seul endroit
  qui puisse se tromper, et `tests/faux_executable.rs` refuse tout autre `chmod` d'exécution :
  **aucun test de comportement ne peut mordre là**, la course n'étant pas reproductible et
  `ETXTBSY` ne se présentant pas de la même façon sur le macOS où l'on développe — un test qui
  poserait un faux binaire puis le lancerait serait vert sous le sabotage. Le verdict rendu, au
  passage, accusait tout autre chose : un `--version` qui ne part pas est indiscernable d'un outil
  absent, donc l'écran aurait dit « `pg_dump` est introuvable, voilà comment l'installer » à
  quelqu'un qui l'a installé.
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
| La transaction **manuelle** d'une console (`API-38`) | oui | **non** — sa console ne fait que lire | oui, en `begin immediate` | oui, sur une connexion **tenue** hors du pool | **non** — un job par requête, pas de session |
| Deux consoles, deux transactions **à la fois** (`API-38`) | oui — une session chacune | — | **non** : un fichier, un verrou d'écriture, et le refus le dit | oui — une session chacune | — |
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
- **Laisser une connexion mourir pour de vrai**, puis lire une table. Le correctif du 8 septembre
  2026 est exercé contre une session que `pg_terminate_backend` coupe — donc une coupure **franche
  et immédiate**. Les causes réelles ne le sont pas : mettre le Mac en veille une heure, débrancher
  le Wi-Fi, redémarrer le serveur, ou attendre un `idle_session_timeout`. Ce qu'il reste à voir, et
  qu'aucun test ne dira : que la ligne d'arbre passe bien au rouge **au moment de la lecture qui
  échoue**, et que la lecture aboutisse d'elle-même après la reconnexion — sans redemander le mot de
  passe, que la recette porte. Le cas d'un proxy tombé vaut d'être fait séparément — tuer le `ssh` ou
  le `kubectl` à la main —, la détection y passant par `ProxyOuvert::est_tombe` et non par le pilote,
  et la reconnexion y remontant un tunnel entier plutôt qu'un socket. C'est aussi le seul geste qui
  dira si l'attente est **supportable** : rouvrir un tunnel SSH ou un `kubectl port-forward` prend
  des secondes, pendant lesquelles la grille paraît simplement lente, et rien à l'écran ne dit
  pourquoi. Si cette attente se révèle pénible, c'est là qu'un mot de l'interface se justifiera —
  pas avant de l'avoir vue.
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
- **Tenir une transaction manuelle du début à la fin, dans l'application** (`API-38`). Tout est
  couvert côté cœur — un vrai fichier SQLite, un vrai PostgreSQL, un vrai MySQL, et jusqu'à deux
  consoles qui retiennent chacune la sienne en même temps — mais le parcours entier n'a jamais été
  fait à la main : allumer l'interrupteur, écrire, relire le panneau, ouvrir la table dans un autre
  onglet (elle ne doit **pas** montrer la ligne retenue, chaque console ayant sa session), valider,
  et la voir paraître. Trois points ne se voient que là : que fermer l'application sans valider ne
  laisse rien derrière — c'est le serveur qui annule —, que le refus d'écrire depuis la grille
  pendant une transaction arrive bien avec sa phrase plutôt qu'avec l'erreur du moteur, et **ce que
  coûte l'ouverture d'une seconde session** : une poignée de main de plus à la première exécution en
  mode manuel, imperceptible en local, à mesurer derrière un tunnel.
- **Régler « Afficher les barres de défilement : toujours »**, puis regarder la sidebar et
  la bande d'onglets. Chromium sans tête rend des barres en survol, qui n'occupent aucune
  place : la mesure vaut 0 avec comme sans la correction.
- **Ouvrir le calendrier du sélecteur de date d'un filtre**, en « Cahier » puis en « Nuit ». C'est le
  seul contrôle natif de l'écran, et WebKit ne le dessine pas comme Chromium : sa géométrie est
  mesurée sous Playwright — la boîte reste à 20 px, le champ ne sort par aucun bord, même sur la
  colonne la plus étroite —, mais **le panneau qui s'ouvre au clic vit hors du DOM**, dans une racine
  fantôme fermée. Ce qu'il reste à voir : que l'indicateur de calendrier ne soit pas
  disproportionné dans une boîte de 20 px, et que le panneau suive le thème (il le devrait, par le
  `color-scheme` de `reset.css`). Aucune CSS n'a été écrite pour ce contrôle, faute de pouvoir en
  mesurer l'effet : c'est cette observation qui dira s'il en faut. **Et ne pas lire le format affiché
  sur une capture de Playwright** : le `locale: 'fr-FR'` de la configuration ne l'atteint pas —
  Chromium prend celui de sa propre interface pour ce champ, et rend donc `03/01/2026` pour le
  1er mars. La valeur qui part au serveur est toujours l'ISO ; c'est l'affichage qui suit le système,
  ce qui est le comportement voulu et l'une des raisons d'avoir pris le contrôle natif.
- **Défocaliser l'application.** Les trois feux doivent rester visibles (grisés) ; ils
  disparaissent. Dessinés par le système, donc ni reproductible ni corrigeable depuis le
  web. L'expérience à tenter est de passer `hiddenTitle` à `false` le temps d'un lancement.
- **Le Trousseau entre deux builds.** Les tests `#[ignore]` passent contre le vrai
  Trousseau, mais ils écrivent et relisent dans le **même processus**, donc sous la même
  signature ad-hoc. La crainte réelle est qu'une entrée écrite par un build soit illisible
  par le suivant. L'expérience qui trancherait demande de scinder l'aller-retour en deux
  tests — un qui écrit, un qui relit.

**Et depuis Windows (31 août 2026), une seconde liste, dont rien n'a encore été fait.** Toute la
coquille Windows est vérifiée *en structure* — trois boutons, géométrie de la barre, libellés
`Ctrl+`, compilation, bundle NSIS — et **rien du rendu**. WebView2 n'est pas plus pilotable que
WKWebView, et les captures de fidélité mesurent le clair de macOS : leur vert prouve seulement
que Windows n'a rien changé à macOS.

- **Lire les dix écrans sous WebView2**, en clair puis en « Nuit ». Le rendu des polices diffère
  de macOS — c'est même pourquoi un second jeu de références serait un jeu à maintenir et non une
  copie. Un contraste faible, une bordure disparue, un libellé qui déborde son bouton ne se
  voient qu'à l'œil. Même réserve que « lire les dix écrans en Nuit », pour la même raison.
- **Les trois boutons de fenêtre, à la main** : survol (dont le rouge de fermeture), anneau de
  focus, glissement de la fenêtre par la barre, double-clic pour agrandir, et le glyphe central
  quand la fenêtre est **déjà** agrandie au lancement. `Win+↑` et `Win+↓` aussi : ils changent la
  maximisation sans que le composant voie autre chose qu'un `resize`.
- **Le presse-papier et les six menus**, comme sur macOS : le menu natif est reconstruit à
  l'identique, et `⌘C`/`⌘V` devenus `Ctrl+C`/`Ctrl+V` sont **la** régression que le remplacement
  du menu par défaut peut introduire. Aucun test ne voit un menu natif.
- **Le Gestionnaire d'identifiants entre deux builds.** Le raisonnement dit qu'une entrée DPAPI
  survit à une reconstruction, contrairement au Trousseau ; personne ne l'a constaté.
- **Le `known_hosts` d'OpenSSH pour Windows**, écrit par le vrai client, contre une connexion
  tunnelée. Le repli `USERPROFILE` est testé ; le format du fichier là-bas ne l'est pas.
- **`pg_dump` avec l'installateur EDB**, et sans rien d'installé. Les deux chemins de
  `C:\Program Files\PostgreSQL\*\bin` viennent de la documentation, **pas d'une mesure** —
  contrairement à ceux de macOS, relevés le 19 août.
- **Le proxy Cloud SQL depuis une application installée**, l'équivalent Windows du `PATH` minimal
  du Finder.
- **L'installateur NSIS** : qu'il s'ouvre, installe, et que l'application se lance. SmartScreen
  avertira — c'est attendu, faute de certificat Authenticode.
- **Qu'aucune fenêtre de terminal ne paraisse**, sur un build **release** : une lecture de version
  au moment d'ouvrir la modale d'export, puis un export, puis une connexion Kubernetes ou Cloud SQL
  — c'est celle-là qui compte, sa fenêtre restant ouverte tout le temps de la connexion là où les
  autres clignotent. `tests/sans_console.rs` garde la règle ; le drapeau lui-même n'a de juge que
  l'œil.

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
pnpm test:e2e       # Playwright, webServer auto — deux projets, `macos` et `windows`
pnpm test:e2e --project=windows   # la coquille Windows seule, depuis un Mac

# La coquille Windows, à l'œil, sans machine Windows : la plateforme est une constante de
# construction, donc c'est le serveur qu'on relance, jamais un réglage à l'exécution.
DORABASE_PLATEFORME_DECOR=windows pnpm dev
DORABASE_PLATEFORME_DECOR=windows pnpm test   # doit être vert, comme sans la variable
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

# Compiler pour Windows depuis ce Mac. Exige `cargo install cargo-xwin`, la formule `llvm` de
# Homebrew (pour `clang-cl`) et `nasm` (qu'`aws-lc-sys`, venu de `russh`, réclame). `cargo check`
# et `clippy` suffisent — ils ne lient pas, donc `lld-link` n'est pas nécessaire.
export PATH="$HOME/.cargo/bin:/opt/homebrew/opt/llvm/bin:$PATH"
pnpm proxy:embarquer x86_64-pc-windows-msvc
cd src-tauri && cargo xwin clippy --target x86_64-pc-windows-msvc --all-targets -- -D warnings
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
- **Un long lien reste long, et c'est la limite du dessin en couches.** Trois défauts de disposition
  ont été corrigés à l'usage — le centrage des colonnes, les tables isolées, les cycles — et il reste
  un cas que ni l'un ni l'autre n'atteint : un schéma dont la plus longue chaîne de références est
  profonde *et* dont une table centrale est référencée depuis toute cette profondeur. Mesuré sur un
  décor de soixante tables, trois moyeux et des chaînes : vingt colonnes, une toile de 4 402 px, et
  dix-huit liens sur soixante-quinze qui traversent presque tout — cinquante-sept sont à une colonne.
  Ces liens-là sont **justes** : la table de la colonne 0 référence bien celle de la colonne 19, et
  aucune stratification ne peut les rapprocher sans cesser de dessiner la chaîne comme une chaîne.
  Deux réponses possibles, et c'est un arbitrage de produit : router ces liens par des **nœuds
  fictifs**, ce qui ne les raccourcit pas mais les empêche de traverser les boîtes ; ou **plafonner
  le nombre de colonnes**, ce qui les raccourcit au prix de quelques flèches qui pointeront vers
  l'arrière. Rien n'est cassé en attendant : le dessin est juste et se défile — et la recherche donne
  le moyen d'y retrouver une table sans la chercher des yeux.
- **Le diagramme de schéma place ses boîtes tout seul, et rien ne se déplace à la main.** La
  disposition est **dérivée** — donc reproductible, comparable d'une lecture à l'autre, et refaite
  gratuitement quand une table arrive. Un placement à la main demanderait l'inverse : le persister
  (où ? sous quelle clé ? avec quel sort pour une table renommée ou retirée ?), et décider ce
  qu'advient une boîte posée à la main quand le schéma change sous elle. Trois questions de
  conception, aucune urgence — le graphe automatique se lit. À rouvrir si l'usage dit que les
  croisements gênent : le passage de barycentre ne fait qu'**une** passe, et la version complète de
  l'algorithme qui les minimise est le prochain cran naturel.
- **Et il ne s'exporte pas** — ni en image, ni en SVG. Même obstacle que l'export CSV, `blob:`
  n'étant pas autorisé par la CSP, et la même conclusion : l'écriture appartient au Rust. Ce qui
  reste à trancher est ce qu'on exporte au juste — le dessin visible, ou le schéma entier au-delà du
  plafond de soixante tables.
- **Déplacer une connexion d'un environnement à un autre** n'existe pas, délibérément : cela
  demande de déplacer un secret du Trousseau, donc son geste et sa conception. La
  confirmation de suppression ne le propose pas — offrir une action absente est pire que
  son absence.

---

## Réserves connues

- **Les deux refus de transaction manuelle n'ont jamais été prononcés par un vrai serveur**
  (`API-38`). Ceux de MongoDB et de BigQuery sont gardés par un test sur leur message — comme le
  refus d'écriture de `21` —, et l'écran ne les atteint pas : l'interrupteur y est figé avant l'appel.
  Ce qui n'est donc pas exercé est le chemin qui contourne l'écran, celui d'un front en retard sur
  son cœur. **Et ce chemin-là dépense une connexion pour rien** depuis qu'une console ouvre sa propre
  session : elle est ouverte, le `begin` est refusé, elle est refermée. Le prévenir demanderait une
  table « quels moteurs tiennent une transaction » côté Rust, donc une seconde source de vérité à
  côté de celle de l'écran (`TRANSACTIONS_MANUELLES_PAR_MOTEUR`) — deux listes qui divergeraient
  (règle n° 17), pour un chemin que l'interface n'offre pas.
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
