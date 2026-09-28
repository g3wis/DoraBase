---
name: ticket
description: Traiter un ticket de bout en bout sur DoraBase, sous forme d'issue GitHub — lire l'issue avec `gh` ou la créer quand le besoin n'en a pas, poser son statut à `status: in progress`, écrire le code sur une branche dédiée, ouvrir la PR et la rattacher à l'issue, puis passer en `status: in review`. À invoquer dès qu'une demande nomme un ticket ("#146", "API-57", une URL github.com/…/issues/…, "traite le ticket 44"), demande d'en ouvrir un, ou qu'un chantier va commencer et doit être rattaché à un ticket.
---

# Traiter un ticket

Ce dépôt tient trois traces qui ne disent pas la même chose : le code dit *ce qui est*,
`CLAUDE.md` dit *pourquoi c'est ainsi*, le ticket dit **ce que quelqu'un a demandé et où en est la
réponse**. Ce skill tient la troisième à jour pendant qu'on écrit les deux autres.

**Les tickets sont des issues GitHub du dépôt `g3wis/DoraBase`**, et plus des tickets Linear. Les
anciens tickets Linear y ont été migrés : ils portent le label `linear` et leur ancien identifiant
en tête de titre — `[API-57] Fix zoom` est l'issue #141.

**L'argument est le numéro de l'issue** — `#146`, `146`, l'URL GitHub, ou un ancien `API-57` —
**ou le besoin lui-même**, quand personne n'a encore écrit le ticket : le skill le cherche, et le
crée s'il n'existe pas. Sans argument du tout, demander lequel plutôt que deviner.

Les outils sont ceux de la CLI `gh` (`gh issue view`, `gh issue list`, `gh issue create`,
`gh issue edit`, `gh issue close`). Toujours passer `-R g3wis/DoraBase` : un worktree peut avoir
un remote différent, et une issue créée ailleurs est perdue.

## Le cadre, une fois pour toutes

| | |
| --- | --- |
| Dépôt | `g3wis/DoraBase` |
| Base des PR | `main` |
| Statut en cours | un label **exclusif** parmi `status: backlog`, `status: todo`, `status: in progress`, `status: in review` |
| Terminé | l'issue **fermée**, raison `completed` — on retire alors le label de statut |
| Abandonné | fermée en `not planned`, avec sa raison en commentaire |
| Doublon | fermée en `duplicate` (`gh issue close --reason duplicate --duplicate-of <n>`) |
| Nature | `bug`, `enhancement` ou `improvement` ; `design-ready` quand une maquette existe |
| Priorité | `priority: urgent`, `priority: high`, `priority: medium`, `priority: low` |

**Un seul label `status:` à la fois.** Changer de statut, c'est retirer l'ancien *et* poser le
nouveau dans le même `gh issue edit` — deux labels de statut font dire deux choses au tableau.

## 1. Trouver le ticket — ou le créer

**Rien ne s'écrit sans un ticket**, et l'ordre ne se saute pas.

### a. L'identifiant donné fait foi

- un **numéro GitHub** (`#146`, `146`, une URL) : `gh issue view 146 -R g3wis/DoraBase` ;
- un **ancien identifiant Linear** (`API-57`) : il ne correspond **pas** au numéro GitHub. Le
  retrouver par le titre :

  ```bash
  gh issue list -R g3wis/DoraBase --state all --search '"[API-57]" in:title' \
    --json number,title,state
  ```

Puis **dire son titre à l'utilisateur avant de commencer**. C'est le seul contrôle contre un chiffre
mal recopié — ou contre un `57` qu'on aurait pris pour `#57` alors qu'il voulait dire `API-57` —,
et il coûte une ligne.

### b. Sinon, chercher dans le dépôt

Un besoin formulé aujourd'hui a souvent déjà son ticket au backlog, écrit par quelqu'un d'autre,
dans l'autre langue, et sous un titre qu'on n'aurait pas choisi.

```bash
gh issue list -R g3wis/DoraBase --state all --limit 50 \
  --search "<mots-clés du besoin>" --json number,title,state,labels
```

Chercher par mots-clés **et** parcourir la liste, **fermées comprises** (`--state all`) : un besoin
qui revient est soit un défaut rouvert, soit un doublon qu'il vaut mieux lier que réécrire. Essayer
les mots-clés dans les deux langues — les tickets migrés sont tantôt en français, tantôt en
anglais. Les candidats plausibles se **montrent** à l'utilisateur ; c'est lui qui dit si c'est le
même besoin. Dans le doute, demander plutôt que deviner — la question coûte moins cher que le
doublon.

### c. Et seulement si rien ne couvre le besoin, en créer un

**La recherche de l'étape b n'est pas facultative, même quand la demande est « ouvre un ticket
pour X ».** Demander la création dit qu'on n'en connaît pas d'existant, pas qu'il n'y en a pas :
c'est précisément le cas où le doublon se fabrique. Donc chercher d'abord, **puis** dire ce qu'on a
trouvé — « rien de similaire dans le dépôt, fermées comprises », ou les candidats — et créer
ensuite. Une issue qui ressemble sans être la même se **lie** (une ligne `Lié à #NN` dans la
description) plutôt que de s'ignorer ; le même besoin déjà écrit se reprend, et s'il a été fermé,
c'est un défaut rouvert (`gh issue reopen`) et non une issue neuve.

#### D'abord l'entretien, ensuite l'écriture

**Un ticket ne s'écrit pas sur une phrase.** Ce qui manque à la demande initiale manquera au ticket,
puis à l'implémentation — et c'est six mois plus tard qu'on lira le ticket sans avoir le dépôt sous
la main. Donc **demander à l'utilisateur ce qui manque à la compréhension du besoin, avant
d'écrire**, et mettre ses réponses dans la description.

Ce qu'il faut avoir, et qui décide de ce qu'on demande :

| | |
| --- | --- |
| **Le déclencheur** | ce qui se passe aujourd'hui, et en quoi c'est un problème. Un signalement d'usage se cite tel quel : c'est ce que les entrées de `CLAUDE.md` appellent « rapporté à l'usage », et c'est ce qui survit le mieux |
| **Où** | l'écran (`A1`…`A10`), le panneau, et **quels moteurs** sont concernés — les cinq ne répondent pas la même chose à la même question |
| **Ce qui est attendu** | le comportement voulu, dans les mots du demandeur |
| **Le périmètre** | ce qui est explicitement **dehors**, et qui deviendra son propre ticket |
| **Les arbitrages** | ceux que l'utilisateur veut trancher lui-même, et ceux qu'il nous laisse |
| **Le design** | existe-t-il une maquette ? Sinon, le dépôt **n'invente pas de pixels** : c'est un point ouvert, pas une liberté |
| **Comment on saura que c'est fait** | et ce qui restera à voir à l'œil — l'outillage ne pilote ni WKWebView ni WebView2 |
| **La suite** | enchaîner sur l'implémentation, ou s'arrêter au ticket |

Cinq règles pour cet entretien :

- **ne demander que ce dont la réponse change le ticket.** Ce que le code, `CLAUDE.md` ou une issue
  voisine répondent déjà se **cherche**, il ne se demande pas : une question dont la réponse est
  déjà écrite fait payer à l'utilisateur ce qu'on n'a pas lu ;
- **peu de questions à la fois, groupées** — quatre au plus, avec les réponses plausibles proposées.
  Un interrogatoire fait abandonner, et un ticket abandonné est un ticket écrit de mémoire ;
- **les réponses entrent dans la description dans les mots du demandeur**, pas reformulées en
  solution. Le titre et le besoin lui appartiennent ; la solution changera en écrivant ;
- **ce qui reste sans réponse s'écrit comme point ouvert nommé**, et une hypothèse s'écrit comme
  hypothèse. Combler un trou en silence, c'est prendre une décision à la place de quelqu'un et la
  faire passer pour une donnée ;
- **le brouillon complet se relit avant `gh issue create`** — c'est le dernier moment où corriger
  coûte une phrase.

Le gabarit de description qui en sort :

```markdown
## La demande
> la formulation d'origine, citée

## Ce qui se passe aujourd'hui
## Ce qui est attendu
## Hors périmètre
## Points ouverts
## Comment on saura que c'est fait
```

Une section sans matière se retire : une rubrique vide occupe la place de ce qu'elle promet.

Le corps s'écrit dans un fichier du scratchpad puis se passe par `--body-file` — un corps
multiligne passé en `--body` se casse sur la première apostrophe :

```bash
gh issue create -R g3wis/DoraBase --title "…" --body-file <brouillon.md> \
  --label "status: todo" --label enhancement
```

Cinq choses à ne pas défaire :

- **le titre porte le besoin dans les mots de qui l'a demandé, pas la solution qu'on a déjà en
  tête.** C'est la raison qui fait qu'aucune modale du produit ne nomme un objet à sa création : la
  solution changera en écrivant, la demande non. **Pas de préfixe `[API-NN]`** sur une issue neuve :
  ce préfixe marque une issue migrée de Linear, et en inventer un désignerait un ticket qui n'existe
  pas ;
- **la description porte ce que l'entretien a rendu**, la demande citée en tête. Ce qu'on ne sait
  toujours pas s'y écrit comme **point ouvert nommé**, jamais comme une décision prise à la place de
  l'utilisateur — ces points-là seront tranchés à l'étape 2, et la réponse retenue reviendra dans la
  description à l'étape 10 ;
- **le brouillon — titre, description et labels — se montre avant d'appeler `gh issue create`.**
  Créer est une écriture publique dans l'outil que d'autres lisent, et un ticket mal cadré se
  corrige plus mal qu'il ne s'écrit ;
- **le statut de départ est `status: todo`** quand on enchaîne tout de suite, `status: backlog`
  quand on écrit le ticket pour plus tard — un morceau détaché du périmètre, par exemple, qu'on
  relie alors à celui d'où il vient (`Lié à #NN`) ;
- **le `#NN` ne s'écrit nulle part avant que l'issue existe** : ni dans un commentaire de code,
  ni dans `CLAUDE.md`, ni dans le corps d'une PR. Le numéro est rendu par la création — `gh issue
  create` imprime l'URL —, il ne se devine pas : issues et PR partagent la même numérotation, et un
  numéro écrit d'avance désigne la PR ou l'issue de quelqu'un d'autre.

Une issue créée se poursuit à l'étape 2 comme n'importe quelle autre : elle a une description, et
c'est elle qui fait foi.

## 2. La lire en entier, avant toute décision

```bash
gh issue view <n> -R g3wis/DoraBase --comments
```

La description **fait foi** : elle porte souvent des arbitrages déjà tranchés, une maquette, et des
« points ouverts » nommés. Les rejouer est du travail jeté ; les ignorer est pire. Une issue migrée
de Linear peut porter en tête son ancien lien `linear.app` : c'est de l'histoire, pas un endroit
où aller mettre à jour quoi que ce soit.

- ce qui est **tranché** dans l'issue ne se rediscute pas ;
- ce qui est **laissé ouvert** se tranche avant d'écrire, et la décision s'écrit — dans `CLAUDE.md`
  pour le pourquoi détaillé, dans l'issue pour la version courte ;
- ce que l'issue ne dit pas et qui change le travail se **demande**.

Lire aussi `CLAUDE.md` sur le domaine touché : la moitié des décisions y sont déjà, avec leur raison.

## 3. Passer l'issue en `status: in progress`

Au moment où le travail commence, jamais en lot à la fin. Retirer le statut précédent dans le même
geste :

```bash
gh issue edit <n> -R g3wis/DoraBase \
  --remove-label "status: todo" --remove-label "status: backlog" \
  --add-label "status: in progress" --add-assignee @me
```

`--remove-label` sur un label absent ne fait rien, donc lister les deux anciens est sûr.
L'assignation ne se pose que si l'issue n'a pas déjà quelqu'un.

## 4. La branche

Les branches récentes du dépôt sont en `claude/<sujet>-<empreinte>` ; `gh issue develop <n>` en
propose une liée à l'issue, sans que ce soit obligatoire — mais **une branche dédiée l'est** :
jamais de commit sur `main`.

Si la session tourne déjà dans un worktree sur une branche à elle, c'est celle-là. Sinon, en créer
une depuis `main` à jour.

## 5. Écrire

Les conventions du dépôt sont dans `CLAUDE.md` et n'ont pas à être redites ici. Les trois qui se
perdent le plus souvent en travaillant sur un ticket :

- **le code, les identifiants et les noms de fichiers restent en anglais** — sauf le Rust de
  `src-tauri/`, dont les identifiants sont en français ;
- **on n'écrit plus de numéro de spec** (`06d`, `25a`) dans un commentaire : ce qu'on écrit à leur
  place est la référence de l'issue, `#146`. Les `API-NN` déjà présents dans le code et dans
  `CLAUDE.md` restent en place — ils nomment le chantier qui a produit une décision, et leur issue
  migrée se retrouve par son titre ;
- **un test vert ne prouve rien tant qu'un sabotage ne l'a pas fait tomber** (règle n° 1).

## 6. La barrière, avant de committer

Une seule commande, celle que lance la CI. Elle ne tronque rien et échoue vraiment :

```bash
export PATH="$HOME/.cargo/bin:$PATH"
./scripts/verifier-tout.sh
```

Les décors de test (PostgreSQL, MongoDB, MySQL, bastion SSH) et les variables qui les nomment sont
listés dans `CLAUDE.md`, section « Commandes ». Sans eux, les tests sur base réelle sont **sautés**,
et le script le dit à l'écran.

## 7. Les commits

En **anglais**, succincts, `type(scope): ce que ça fait` à l'impératif, sous cinquante caractères.
**Aucune référence d'issue dans la ligne de sujet** : le rattachement se fait par la PR. Le
pourquoi va dans le code, dans `CLAUDE.md`, ou dans le corps du message.

## 8. La PR

```bash
gh pr create -R g3wis/DoraBase --base main --title "…" --body-file <corps.md>
```

- **titre** : la ligne de commit, en anglais — `feat(schemas): manage a connection's schemas`.
  GitHub y ajoute lui-même le numéro de la PR à la fusion ;
- **corps** : en français, et il commence par le mot-clé de fermeture, seul sur sa ligne —
  `Closes #146`. C'est ce qui rattache la PR à l'issue (elle paraît dans « Development ») **et** ce
  qui fermera l'issue en `completed` à la fusion dans `main`. Une PR qui ne livre qu'une partie de
  l'issue écrit `Refs #146` à la place, pour ne pas fermer un ticket à moitié.

Puis les sections que les PR du dépôt tiennent déjà, et qui sont ce qu'un relecteur vient chercher :

```markdown
## Ce que ça fait
## Pourquoi
## Les décisions à connaître en relisant
## Tests
```

Une PR qui régénère des captures de fidélité le **dit**, et dit ce que le diff porte : c'est la
règle n° 6, et un compte de pixels ne se lit pas tout seul.

## 9. `status: in review`, et le rattachement vérifié

Dès la PR ouverte :

```bash
gh issue edit <n> -R g3wis/DoraBase \
  --remove-label "status: in progress" --add-label "status: in review"
```

Puis vérifier que la PR paraît bien liée à l'issue :

```bash
gh issue view <n> -R g3wis/DoraBase --json closedByPullRequestsReferences \
  -q '.closedByPullRequestsReferences[].url'
```

Rien ne sort quand le corps porte `Refs` et non `Closes`, ou quand le mot-clé est mal écrit : dans
le premier cas c'est voulu, dans le second corriger le corps de la PR (`gh pr edit --body-file`).

## 10. Mettre la description à jour

**Un ticket faux est pire qu'un ticket absent.** La description doit dire ce qui a été **livré**,
pas seulement ce qui était demandé. On **ajoute** une section, on ne réécrit pas ce que quelqu'un
d'autre a écrit : relire le corps actuel, y ajouter la section à la fin, et le réécrire entier.

```bash
gh issue view <n> -R g3wis/DoraBase --json body -q .body > <corps.md>
# ajouter à la fin : "\n\n---\n\n## Ce qui est livré (…)\n…"
gh issue edit <n> -R g3wis/DoraBase --body-file <corps.md>
```

`gh issue edit --body` **remplace** le corps : ne jamais l'appeler sans être reparti du corps
actuel, sinon on efface ce que l'issue portait.

Y écrire, et rien de plus :

- les **points ouverts tranchés**, avec la réponse retenue ;
- les **écarts** entre ce qui était demandé et ce qui est livré — un arbitrage retenu contre un
  autre, une moitié remise à plus tard ;
- le renvoi vers `CLAUDE.md` pour le pourquoi détaillé. Le recopier ferait diverger les deux, et
  c'est l'issue qui aurait tort.

**Ce qui sort du périmètre s'en détache** : un morceau reporté devient sa propre issue, jamais une
case non cochée dans celle qu'on ferme. Chercher d'abord s'il en existe déjà une (`gh issue list
--state all --search`) avant d'en créer une — un doublon coupe l'historique en deux.

## 11. Après la fusion

La fusion d'une PR portant `Closes #n` ferme l'issue en `completed` d'elle-même. Il reste à
**retirer le label de statut**, qui sinon dirait `in review` sur une issue fermée :

```bash
gh issue edit <n> -R g3wis/DoraBase --remove-label "status: in review"
```

Si la fusion se fait dans la même session, le faire ; sinon le dire à l'utilisateur. Une PR fusionnée
avec `Refs` ne ferme rien : fermer à la main (`gh issue close <n> --reason completed`) seulement si
l'issue est livrée en entier.

Un besoin abandonné se ferme en `not planned` **avec sa raison** en commentaire
(`gh issue close <n> --reason "not planned" --comment "…"`), un doublon en `duplicate` vers celle
qu'on garde (`--reason duplicate --duplicate-of <m>`). Dans les deux cas, on ferme : on ne laisse
pas traîner.

## Ce que ce skill ne fait pas

- **il ne crée pas d'issue sans avoir cherché**, ni sans montrer le brouillon : une seconde issue
  sur un besoin déjà décrit coupe l'historique en deux, et c'est la moitié la moins fournie qu'on
  retrouve six mois plus tard ;
- **il ne crée rien dans Linear** : les tickets vivent désormais sur GitHub ;
- **il ne fusionne pas la PR** sans qu'on le lui demande ;
- **il ne ferme pas une issue sur une PR non fusionnée**.
