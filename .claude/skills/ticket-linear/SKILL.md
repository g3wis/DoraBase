---
name: ticket-linear
description: Traiter un ticket Linear de bout en bout sur DoraBase — lire le ticket par MCP, passer son statut à In Progress, écrire le code sur une branche dédiée, ouvrir la PR et la rattacher au ticket, puis passer en In Review. À invoquer dès qu'une demande nomme un ticket ("API-57", une URL linear.app, "traite le ticket 44") ou qu'un chantier va commencer et doit être rattaché à un ticket.
---

# Traiter un ticket Linear

Ce dépôt tient trois traces qui ne disent pas la même chose : le code dit *ce qui est*,
`CLAUDE.md` dit *pourquoi c'est ainsi*, le ticket dit **ce que quelqu'un a demandé et où en est la
réponse**. Ce skill tient la troisième à jour pendant qu'on écrit les deux autres.

**L'argument est le numéro du ticket** — `API-57`, `57`, ou l'URL Linear. Sans argument, demander
lequel plutôt que deviner.

Les outils sont ceux du serveur MCP Linear : `get_issue`, `save_issue`, `list_comments`,
`list_issues`. Les noms ci-dessous sont les leurs, sans le préfixe d'installation.

## Le cadre, une fois pour toutes

| | |
| --- | --- |
| Équipe | `API` |
| Projet | `DoraBase — explorateur de bases de données` |
| Les sept états | `Backlog`, `Todo`, `In Progress`, `In Review`, `Done`, `Canceled`, `Duplicate` |
| Base des PR | `main` |

## 1. Identifier le ticket, et vérifier que c'est le bon

Un numéro nu est ambigu : **les numéros sont partagés entre les équipes du workspace**, donc `57`
seul peut désigner autre chose. Toujours qualifier en `API-<n>` avant d'appeler `get_issue`.

Puis **dire son titre à l'utilisateur avant de commencer**. C'est le seul contrôle contre un chiffre
mal recopié, et il coûte une ligne.

## 2. Le lire en entier, avant toute décision

`get_issue` avec `includeRelations: true`, puis `list_comments`.

La description **fait foi** : elle porte souvent des arbitrages déjà tranchés, une maquette, et des
« points ouverts » nommés. Les rejouer est du travail jeté ; les ignorer est pire.

- ce qui est **tranché** dans le ticket ne se rediscute pas ;
- ce qui est **laissé ouvert** se tranche avant d'écrire, et la décision s'écrit — dans `CLAUDE.md`
  pour le pourquoi détaillé, dans le ticket pour la version courte ;
- ce que le ticket ne dit pas et qui change le travail se **demande**.

Lire aussi `CLAUDE.md` sur le domaine touché : la moitié des décisions y sont déjà, avec leur raison.

## 3. Passer le ticket en `In Progress`

Au moment où le travail commence, jamais en lot à la fin.

```
save_issue(id: "API-57", state: "In Progress", assignee: "me")
```

L'assignation ne se pose que si le ticket n'a pas déjà quelqu'un.

## 4. La branche

`get_issue` rend un `gitBranchName` (`feature/api-57-…`). Il n'est pas obligatoire — les branches
récentes du dépôt sont en `claude/<sujet>-<empreinte>` — mais **une branche dédiée l'est** : jamais
de commit sur `main`.

Si la session tourne déjà dans un worktree sur une branche à elle, c'est celle-là. Sinon, en créer
une depuis `main` à jour.

## 5. Écrire

Les conventions du dépôt sont dans `CLAUDE.md` et n'ont pas à être redites ici. Les trois qui se
perdent le plus souvent en travaillant sur un ticket :

- **le code, les identifiants et les noms de fichiers restent en anglais** — sauf le Rust de
  `src-tauri/`, dont les identifiants sont en français ;
- **on n'écrit plus de numéro de spec** (`06d`, `25a`) dans un commentaire : ce qu'on écrit à leur
  place est l'identifiant du ticket, `API-57` ;
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
**Aucun identifiant de ticket dans la ligne de sujet** : le rattachement se fait par la PR et par le
ticket. Le pourquoi va dans le code, dans `CLAUDE.md`, ou dans le corps du message.

## 8. La PR

```bash
gh pr create --base main --title "…" --body "…"
```

- **titre** : la ligne de commit, en anglais, avec l'identifiant entre parenthèses à la fin —
  `feat(schemas): manage a connection's schemas (API-33)` ;
- **corps** : en français, et il commence par le lien du ticket, seul sur sa ligne —
  `Ticket: [API-57](https://linear.app/pictarine/issue/API-57/…)`. C'est cette URL qui fait le
  rattachement côté Linear.

Puis les sections que les PR du dépôt tiennent déjà, et qui sont ce qu'un relecteur vient chercher :

```markdown
## Ce que ça fait
## Pourquoi
## Les décisions à connaître en relisant
## Tests
```

Une PR qui régénère des captures de fidélité le **dit**, et dit ce que le diff porte : c'est la
règle n° 6, et un compte de pixels ne se lit pas tout seul.

## 9. `In Review`, et le rattachement vérifié

Dès la PR ouverte :

```
save_issue(id: "API-57", state: "In Review")
```

Le lien de la PR doit ensuite **paraître dans les pièces jointes du ticket**. L'intégration GitHub
s'en charge d'ordinaire ; le vérifier par un `get_issue`, et si rien n'est venu, le poser :

```
save_issue(id: "API-57", links: [{url: "…/pull/66", title: "PR 66 — feat(…): …"}])
```

## 10. Mettre la description à jour

**Un ticket faux est pire qu'un ticket absent.** La description doit dire ce qui a été **livré**, pas
seulement ce qui était demandé. `save_issue` accepte un `patch` — donc on **ajoute** une section, on
ne réécrit pas ce que quelqu'un d'autre a écrit :

```
save_issue(id: "API-57", patch: [{op: "append", text: "\n\n---\n\n## Ce qui est livré (…)\n…"}])
```

Y écrire, et rien de plus :

- les **points ouverts tranchés**, avec la réponse retenue ;
- les **écarts** entre ce qui était demandé et ce qui est livré — un arbitrage retenu contre un
  autre, une moitié remise à plus tard ;
- le renvoi vers `CLAUDE.md` pour le pourquoi détaillé. Le recopier ferait diverger les deux, et
  c'est le ticket qui aurait tort.

**Ce qui sort du périmètre s'en détache** : un morceau reporté devient son propre ticket, jamais une
case grise dans celui qu'on ferme. Chercher d'abord s'il en existe déjà un (`list_issues`, fermés
compris) avant d'en créer un — un doublon coupe l'historique en deux.

## 11. Après la fusion

`Done` quand la PR est fusionnée, jamais avant. Si la fusion se fait dans la même session, poser
l'état ; sinon le dire à l'utilisateur — laisser un ticket livré en `In Progress` fait dire au
tableau qu'un chantier est en cours alors qu'il est en production.

Un besoin abandonné se ferme en `Canceled` **avec sa raison**, un doublon en `Duplicate` vers celui
qu'on garde. Dans les deux cas, on ferme : on ne laisse pas traîner.

## Ce que ce skill ne fait pas

- **il ne crée pas de ticket** : il en traite un qu'on lui nomme. Créer relève de la section « Le
  lien avec Linear » de `CLAUDE.md`, et demande d'avoir cherché avant — dans le projet, fermés
  compris ;
- **il ne fusionne pas la PR** sans qu'on le lui demande ;
- **il ne referme pas un ticket sur une PR non fusionnée**.
