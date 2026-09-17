#!/usr/bin/env python3
"""Que le fichier de CI décrive bien ce qu'on croit qu'il décrit.

# Pourquoi ce garde existe

Une édition automatisée a un jour coupé le fichier aux mauvais indices : le job `engine` s'est
retrouvé **déclaré deux fois**, et le premier avait avalé les étapes du job `build`. Or une clé
dupliquée dans un mappage YAML ne fait pas échouer `yaml.safe_load` — le dernier gagne, en silence.

Conséquence : la construction macOS ne tournait plus en CI, et rien ne le disait. C'est exactement le
genre de panne que ce projet refuse — une vérification qui ne peut pas échouer est un mensonge poli.

Lancé par `scripts/verifier-tout.sh`.
"""

import re
import sys
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / ".github" / "workflows"
CI = WORKFLOWS / "ci.yml"
PUBLICATION = WORKFLOWS / "publication.yml"
RACINE = Path(__file__).resolve().parent.parent


def noms_de_jobs_dupliques(chemin: Path) -> list[str]:
    """Les noms de jobs déclarés plus d'une fois.

    Écrit à la main plutôt que par un analyseur YAML : c'est précisément parce que l'analyseur
    **accepte** les doublons que ce garde existe — il en garde le dernier, sans rien dire.

    **Seulement les noms de jobs**, et non toutes les clés : `runs-on` et `steps` existent
    légitimement dans chacun. Une première version les comptait globalement et refusait un fichier
    correct — un garde qui crie sur du juste finit par être désactivé.
    """
    vues: dict[str, int] = {}
    for ligne in chemin.read_text(encoding="utf-8").splitlines():
        # Un nom de job : deux espaces d'indentation exactement, sous `jobs:`.
        if not ligne.startswith("  ") or ligne.startswith("   "):
            continue
        nu = ligne[2:]
        if not nu or nu.startswith("#") or nu.startswith("-") or not nu.endswith(":"):
            continue
        nom = nu[:-1]
        if " " in nom or '"' in nom:
            continue
        vues[nom] = vues.get(nom, 0) + 1
    return [nom for nom, compte in vues.items() if compte > 1]


def charger(chemin: Path) -> dict:
    """Le workflow, après avoir refusé les doublons de jobs."""
    import yaml

    doublons = noms_de_jobs_dupliques(chemin)
    if doublons:
        print(f"jobs déclarés deux fois dans {chemin.name} : {', '.join(doublons)}",
              file=sys.stderr)
        print("un doublon YAML ne fait pas échouer l'analyseur : le dernier gagne, en silence",
              file=sys.stderr)
        raise SystemExit(1)
    return yaml.safe_load(chemin.read_text(encoding="utf-8"))


def declencheurs(workflow: dict) -> dict:
    """La section `on:` — sous la clef `True` quand PyYAML a cru lire un booléen.

    YAML 1.1 fait de `on` un synonyme de vrai. `workflow["on"]` rend donc `KeyError` sur un
    fichier parfaitement valide, et un garde écrit sans le savoir passe en croyant vérifier.
    """
    return workflow.get("on") or workflow.get(True) or {}


def etapes_de(jobs: dict, nom: str, minimum: int, fichier: str) -> list:
    """Les étapes d'un job, en refusant qu'il ait disparu ou maigri.

    **Le compte d'étapes est le cœur du garde** : c'est lui qui aurait attrapé la panne du
    19 juillet 2026, le job `build` étant passé de vingt-et-une étapes à zéro sans que rien ne
    le dise. Un minimum, et non une égalité — sinon toute étape ajoutée fait échouer la CI qui
    l'ajoute, et le chiffre finit par être relevé sans être lu. Le relever *en même temps*
    qu'on ajoute une étape reste le geste attendu.
    """
    if nom not in jobs:
        print(f"le job « {nom} » a disparu de {fichier}", file=sys.stderr)
        raise SystemExit(1)
    etapes = jobs[nom].get("steps") or []
    if len(etapes) < minimum:
        print(f"le job « {nom} » de {fichier} n'a que {len(etapes)} étapes, "
              f"au moins {minimum} attendues", file=sys.stderr)
        raise SystemExit(1)
    return etapes


def commandes_de(etapes: list) -> str:
    """Les commandes des étapes, **commentaires retirés**.

    Un `run:` est un script shell, donc il porte des commentaires — et ce dépôt en écrit
    beaucoup. Chercher un fragment dans le texte brut fait donc passer un garde que la phrase
    *expliquant* la commande suffit à satisfaire : le 25 août 2026, remplacer
    `xcrun stapler validate` par un `echo` a laissé le garde vert, parce que le commentaire au-
    dessus nommait `stapler validate`. Vérifié par sabotage, comme il se doit.
    """
    lignes = []
    for etape in etapes:
        for ligne in str(etape.get("run", "")).splitlines():
            if not ligne.lstrip().startswith("#"):
                lignes.append(ligne)
    return " ".join(lignes)


def verifier_gh_nomme_son_depot(workflow: dict, fichier: str) -> None:
    """Qu'un `gh` lancé sans le dépôt sous la main nomme le dépôt qu'il vise.

    **Le défaut que ce garde attrape** (16 septembre 2026, publication 0.11.0). `gh` déduit le
    dépôt du **remote git du répertoire courant** : dans un job qui ne s'est pas fait
    `checkout`, il n'y en a pas, et il répond `failed to run git: fatal: not a git repository`.
    C'est ce qui est arrivé au job `manifeste`, qui n'a rien à lire dans le dépôt et ne le
    clone donc pas, délibérément — il a composé un manifeste juste, puis n'a pas su où le
    poser. Ce qui s'est perdu n'est pas une clef du manifeste mais `latest.json` **en entier** :
    plus personne ne se met à jour, sur aucune plateforme, jusqu'à la version suivante.

    **Et rien avant la publication ne le disait.** Le workflow est syntaxiquement juste, tous
    les autres gardes de ce fichier étaient verts, et les trois autres jobs se font `checkout`
    — donc le défaut n'existe que dans celui qui ne le fait pas. C'est la même famille que le
    `var()` mort : une commande qui ne peut pas aboutir ne se dénonce pas, il faut aller lui
    demander.

    Le garde porte sur le **mécanisme** et non sur ce job-ci : tout job sans `checkout` qui
    appelle `gh` doit nommer son dépôt, par `--repo` ou par `GH_REPO` dans son environnement.
    """
    for nom, job in (workflow.get("jobs") or {}).items():
        etapes = job.get("steps") or []
        if any("actions/checkout" in str(etape.get("uses", "")) for etape in etapes):
            continue
        for etape in etapes:
            commande = commandes_de([etape])
            # `\bgh\s` plutôt que `"gh "` : le second se satisfait d'un mot qui finit par
            # « gh », et les commentaires sont déjà retirés par `commandes_de`.
            if not re.search(r"\bgh\s", commande):
                continue
            environnement = {
                **(workflow.get("env") or {}),
                **(job.get("env") or {}),
                **(etape.get("env") or {}),
            }
            if "--repo" in commande or "GH_REPO" in environnement:
                continue
            print(f"{fichier} : le job « {nom} » appelle `gh` sans s'être fait `checkout`, et "
                  "sans nommer\n"
                  "  son dépôt. `gh` le déduit du remote git du répertoire courant : il "
                  "répondra\n"
                  "  `fatal: not a git repository`, après avoir fait tout le travail.\n"
                  "  Ajouter `--repo \"$GITHUB_REPOSITORY\"`, ou `GH_REPO` à son "
                  "environnement.", file=sys.stderr)
            raise SystemExit(1)


def verifier_ci() -> None:
    workflow = charger(CI)
    jobs = workflow.get("jobs", {})

    build = etapes_de(jobs, "build", 25, "ci.yml")
    etapes_de(jobs, "engine", 11, "ci.yml")
    e2e = etapes_de(jobs, "e2e", 6, "ci.yml")
    windows = etapes_de(jobs, "windows", 13, "ci.yml")

    # **Le job Windows doit rester sur Windows, et compiler.**
    #
    # Sa raison d'être est d'attraper ce que ni macOS ni Linux ne voient : `std::os::unix` sans
    # garde compile parfaitement sur les deux. Déplacé sur un autre runner, il deviendrait un
    # doublon coûteux du job Linux ; privé de `cargo test` ou de `tauri build`, il ne dirait plus
    # que « ça compile », ce que `clippy` dit déjà.
    if "windows" not in str(jobs["windows"].get("runs-on", "")):
        print("ci.yml : le job « windows » a quitté un runner Windows — il ne verrait plus les "
              "API propres à unix, qui compilent sur macOS comme sur Linux", file=sys.stderr)
        raise SystemExit(1)

    commandes_windows = commandes_de(windows)
    for fragment, raison in (
        ("pnpm proxy:embarquer",
         "toute commande cargo échouerait sur l'`externalBin` absent (défaut n° 111)"),
        ("verifier-conf-windows.py",
         "le recouvrement de configuration pourrait perdre la fenêtre en silence"),
        ("cargo clippy", "les avertissements propres à Windows repasseraient"),
        ("cargo test", "clippy compile les tests sans les exécuter"),
        ("tauri build", "rien ne dirait que le bundle NSIS se fabrique"),
    ):
        if fragment not in commandes_windows:
            print(f"ci.yml : le job « windows » a perdu « {fragment} » — {raison}",
                  file=sys.stderr)
            raise SystemExit(1)

    # **Une exécution par commit.** `on: [push, pull_request]` faisait tourner toute la CI deux
    # fois sur chaque branche ayant une PR : deux verdicts identiques, à la seconde près. Le
    # remède est un push restreint à `main`, et il se défait d'une ligne — d'où ce garde. Un
    # `push:` sans filtre de branches, ou filtrant autre chose que `main`, rétablirait le
    # doublon sans que personne ne le voie autrement qu'en comptant les exécutions.
    sur = declencheurs(workflow)
    # `on: [push, pull_request]` — la forme abrégée — rend une **liste**, où rien ne peut être
    # filtré. C'est exactement la forme fautive, et la nommer valait mieux qu'une trace de pile
    # sur `.get` : constaté par sabotage.
    if not isinstance(sur, dict):
        print(f"ci.yml : `on:` est une liste ({sur!r}), donc sans filtre de branches",
              file=sys.stderr)
        print("  le push doit être restreint à `main`, sinon chaque commit à PR passe deux fois",
              file=sys.stderr)
        raise SystemExit(1)
    branches = (sur.get("push") or {}).get("branches")
    if branches != ["main"]:
        print(f"ci.yml : le push est filtré sur {branches!r}, attendu ['main']", file=sys.stderr)
        print("  sans ce filtre, chaque commit d'une branche à PR fait tourner la CI deux fois",
              file=sys.stderr)
        raise SystemExit(1)
    if "pull_request" not in sur:
        print("ci.yml : sans `pull_request`, plus rien ne vérifie une branche de travail",
              file=sys.stderr)
        raise SystemExit(1)

    # **Playwright doit rester découpé, et rester sur macOS.** Les captures de fidélité portent
    # le suffixe de plateforme (`-darwin.png`) : sur un runner Linux, Playwright ne les
    # trouverait pas, les **écrirait**, et rendrait une suite verte qui ne compare rien. Quant au
    # `--shard`, c'est lui qui tient le job sous les deux minutes ; retiré, il ne casse rien et
    # ne se remarque qu'au chronomètre.
    commandes_e2e = commandes_de(e2e)
    if "test:e2e" not in commandes_e2e:
        print("ci.yml : le job « e2e » ne lance plus Playwright", file=sys.stderr)
        raise SystemExit(1)
    if "--shard=" not in commandes_e2e:
        print("ci.yml : le job « e2e » ne découpe plus la suite — six minutes au lieu de deux",
              file=sys.stderr)
        raise SystemExit(1)
    if "macos" not in str(jobs["e2e"].get("runs-on", "")):
        print("ci.yml : le job « e2e » a quitté macOS — les captures `-darwin` seraient "
              "réécrites au lieu d'être comparées", file=sys.stderr)
        raise SystemExit(1)

    # Le job macOS doit **construire** : c'est la raison de son existence, et c'est ce qui avait
    # disparu.
    commandes = commandes_de(build)
    if "tauri build" not in commandes:
        print("le job « build » ne construit plus le .app", file=sys.stderr)
        raise SystemExit(1)

    # Et il doit **rendre** ce qu'il construit. Un bundle jeté à la fin du job ne prouve que sa
    # compilation ; c'est l'artefact qui permet d'essayer un commit sans le recompiler.
    utilise = " ".join(str(e.get("uses", "")) for e in build)
    if "actions/upload-artifact" not in utilise:
        print("le job « build » ne publie plus le .dmg en artefact", file=sys.stderr)
        raise SystemExit(1)

    # **Sans `TAURI_BUNDLER_DMG_IGNORE_CI`, le `.dmg` sort dépouillé.** Le bundler DMG ajoute
    # `--skip-jenkins` dès qu'il voit `CI`, et ce drapeau saute l'AppleScript qui pose le fond,
    # la taille de fenêtre et les deux positions d'icônes — sans erreur et sans trace. La
    # variable ne se lit dans aucun `run:`, elle vit dans un `env:` : d'où cette lecture
    # séparée, qui regarde l'étape et non son texte.
    if not any(
        "TAURI_BUNDLER_DMG_IGNORE_CI" in (etape.get("env") or {})
        for etape in build
        if "tauri build" in str(etape.get("run", ""))
    ):
        print("ci.yml : `tauri build` sans TAURI_BUNDLER_DMG_IGNORE_CI — le .dmg perdrait "
              "son fond, sa taille de fenêtre et ses positions d'icônes, en silence",
              file=sys.stderr)
        raise SystemExit(1)

    verifier_gh_nomme_son_depot(workflow, "ci.yml")

    print(f"ci.yml cohérent — {len(jobs)} jobs, aucun doublon")


def verifier_publication() -> None:
    """Le workflow de publication, dont chaque erreur ne se voit qu'une fois le tag poussé.

    C'est ce qui justifie de le vérifier ici plutôt que « à l'usage » : il ne tourne que sur un
    tag, un tag ne se rejoue pas, et une release ratée est publique.
    """
    if not PUBLICATION.exists():
        print("publication.yml a disparu : plus rien ne construit les versions publiées",
              file=sys.stderr)
        raise SystemExit(1)

    workflow = charger(PUBLICATION)
    jobs = workflow.get("jobs", {})
    etapes_release = etapes_de(jobs, "release", 4, "publication.yml")
    etapes = etapes_de(jobs, "macos", 29, "publication.yml")

    sur = declencheurs(workflow)
    # **Le déclencheur, et rien d'autre que lui.** `on: push` sans filtre publierait une release
    # à chaque commit ; un motif de tag non ancré (`v*`) accepterait `v1.2` ou `v0.1.0-essai`,
    # dont le nom de bundle n'a été décidé par personne.
    tags = (sur.get("push") or {}).get("tags")
    if tags != ["v[0-9]+.[0-9]+.[0-9]+"]:
        print(f"publication.yml : le motif de tag est {tags!r}", file=sys.stderr)
        print("  attendu : ['v[0-9]+.[0-9]+.[0-9]+'] — ancré sur les trois nombres",
              file=sys.stderr)
        raise SystemExit(1)
    if (sur.get("push") or {}).get("branches") or "pull_request" in sur:
        print("publication.yml : un déclencheur autre qu'un tag publierait sans qu'on le demande",
              file=sys.stderr)
        raise SystemExit(1)

    # Sans `contents: write`, tout le job réussit et **seule la dernière étape** échoue : trente
    # minutes de construction pour découvrir qu'on ne peut pas créer la release.
    if (workflow.get("permissions") or {}).get("contents") != "write":
        print("publication.yml : il manque `permissions: contents: write`", file=sys.stderr)
        raise SystemExit(1)

    commandes = commandes_de(etapes)
    for fragment, raison in (
        ("universal-apple-darwin", "le bundle publié ne serait plus universel"),
        ("verifier-version.py", "rien ne vérifierait que le tag et les fichiers s'accordent"),
        ("codesign --verify", "rien ne vérifierait la signature, dont dépend le lancement"),
        ("notarytool submit", "l'image ne serait plus notariée — Tauri ne notarie que l'app"),
        ("stapler validate", "rien ne vérifierait l'agrafage du ticket de notarisation"),
        ("source=Notarized Developer ID",
         "rien ne vérifierait le verdict que le système rend vraiment au lancement"),
        ("gh release upload", "rien ne publierait les artefacts macOS"),
        ("verifier-aucun-decor-de-version.sh",
         "la version de décor pourrait partir dans le bundle livré"),
        ("verifier-dmg-monte.sh",
         "rien ne dirait que la fenêtre d'installation a bien été posée sur le volume"),
    ):
        if fragment not in commandes:
            print(f"publication.yml : « {fragment} » a disparu — {raison}", file=sys.stderr)
            raise SystemExit(1)

    # **La release elle-même est créée par le job `release`, une seule fois, avant qu'aucun
    # bundle ne soit construit** — c'est ce qui laisse `macos` et `windows` tourner en
    # parallèle plutôt que l'un après l'autre. `macos` et `windows` n'y ajoutent que des
    # artefacts, jamais une seconde création : deux appels à `gh release create` diviseraient
    # la décision du titre, des notes et du `--latest` entre deux endroits.
    commandes_release = commandes_de(etapes_release)
    if "gh release create" not in commandes_release:
        print("publication.yml : le job « release » ne crée plus la release — rien ne la "
              "publierait avant que macOS et Windows n'y téléversent leurs artefacts",
              file=sys.stderr)
        raise SystemExit(1)
    if "gh release create" in commandes:
        print("publication.yml : le job « macos » crée encore la release — c'est le job "
              "« release » qui doit le faire, seul, pour que macOS et Windows publient en "
              "parallèle plutôt que l'un après l'autre", file=sys.stderr)
        raise SystemExit(1)

    for nom in ("macos", "windows"):
        if jobs[nom].get("needs") != "release":
            print(f"publication.yml : le job « {nom} » doit déclarer `needs: release` — il "
                  "téléverse dans une release que le job « release » crée, et sans l'ordre "
                  "l'upload court contre la création", file=sys.stderr)
            raise SystemExit(1)
    # **Et macOS ne doit plus attendre Windows, ni l'inverse : c'est tout le point.** Deux
    # jobs qui dépendent tous deux de « release » sans dépendre l'un de l'autre tournent en
    # parallèle ; un `needs: macos` réapparu sur `windows` les resserialiserait en silence.
    if jobs["windows"].get("needs") == "macos" or jobs["macos"].get("needs") == "windows":
        print("publication.yml : macOS et Windows dépendent l'un de l'autre — ils ne "
              "publieraient plus en parallèle", file=sys.stderr)
        raise SystemExit(1)

    # Même variable, même raison — et ici la conséquence est publique.
    if not any(
        "TAURI_BUNDLER_DMG_IGNORE_CI" in (etape.get("env") or {})
        for etape in etapes
        if "tauri build" in str(etape.get("run", ""))
    ):
        print("publication.yml : `tauri build` sans TAURI_BUNDLER_DMG_IGNORE_CI — la version "
              "publiée s'ouvrirait sur la vue Finder par défaut", file=sys.stderr)
        raise SystemExit(1)

    # ── L'installateur Windows, depuis le 1er septembre 2026 ──────────────────────────────
    #
    # Il s'attache à une release que le job `release` a déjà créée, en parallèle du job
    # `macos` (voir plus haut, 2 septembre 2026). Deux faits le tiennent, et aucun ne se
    # remarquerait autrement qu'en regardant une release publiée :
    windows = etapes_de(jobs, "windows", 16, "publication.yml")
    commandes_windows = commandes_de(windows)

    # 1. Ce qu'il fait, et ce qu'il vérifie avant de publier.
    for fragment, raison in (
        ("pnpm proxy:embarquer",
         "toute commande cargo échouerait sur l'`externalBin` absent (défaut n° 111)"),
        ("verifier-conf-windows.py",
         "le recouvrement de configuration pourrait perdre la fenêtre en silence"),
        ("cargo test", "une release publique ne se pose pas sur des tests non joués"),
        ("tauri build", "rien ne construirait l'installateur"),
        ("verifier-aucun-decor-de-version.sh",
         "la version de décor pourrait partir dans le binaire livré"),
        ("cloud-sql-proxy.exe --version",
         "le sidecar embarqué pourrait manquer, ou porter une autre version que le verrou"),
        ("gh release upload", "l'installateur ne serait attaché à aucune release"),
        # Les deux moitiés d'un même couple : l'étape qui nomme l'installateur **exporte** son
        # chemin, celle qui publie la signature le relit. Sans l'export, `set -u` fait échouer
        # la seconde — bruyamment, mais seulement une fois la publication lancée, et vingt
        # minutes de construction plus tard.
        ('INSTALLATEUR=$exe',
         "l'étape suivante n'aurait plus de quoi dériver la signature, et tomberait sur une "
         "variable non définie"),
        ('cp "$INSTALLATEUR.sig"',
         "la signature ne serait pas copiée, donc l'artefact partirait vide vers le "
         "manifeste"),
    ):
        if fragment not in commandes_windows:
            print(f"publication.yml : le job « windows » a perdu « {fragment} » — {raison}",
                  file=sys.stderr)
            raise SystemExit(1)

    # 2. **Et il publie de quoi se mettre à jour — depuis le 14 septembre 2026 (`API-58`).**
    #
    #    Jusque-là, deux gardes refusaient exactement l'inverse : ni archive `.nsis.zip`
    #    téléversée, ni clef `windows-x86_64` au manifeste. La raison écrite était « sans
    #    certificat Authenticode, rien n'atteste qu'un exécutable téléchargé vient de nous » —
    #    et elle valait pour ce que **SmartScreen** montre à qui télécharge l'installateur, non
    #    pour la mise à jour en place, qu'une signature minisign atteste déjà. Ces deux gardes
    #    ont donc été retirés, et ceux-ci prennent leur place : ce qui se remarquerait le moins
    #    n'est plus qu'on ouvre cette voie, c'est qu'on la referme.
    #
    #    **Deux fichiers, et l'un d'eux porte deux rôles.** Il n'y a pas d'archive séparée :
    #    avec `createUpdaterArtifacts: true`, le bundler signe l'installateur NSIS lui-même, et
    #    le plugin accepte un `.exe` nu. Donc le `.exe` de la release **est** la mise à jour —
    #    c'est lui que l'URL du manifeste désigne — et le `.sig` est ce qui l'atteste. Chacun
    #    est gardé pour sa propre raison : sans le premier l'URL est en 404, sans le second le
    #    job `manifeste` n'a aucune signature à mettre en face.
    #
    #    Les motifs portent leurs **guillemets fermants** : sans eux,
    #    `"publication/DoraBase-$VERSION-x64-setup.exe"` est satisfait par les lignes voisines
    #    du `.sha256` et du `.sig`, dont il est le préfixe. C'est le piège du motif non ancré
    #    des assertions de nom accessible, ici sur un nom de fichier (vérifié par sabotage).
    #    Et le garde porte sur l'étape **qui téléverse**, non sur le job entier : les étapes
    #    voisines *nomment* ces fichiers en les copiant, et un fragment cherché dans tout le
    #    job s'en contenterait — c'est-à-dire resterait vert sur un job qui les construit et ne
    #    les publie pas (vérifié par sabotage, comme les guillemets ci-dessus).
    televersement = commandes_de(
        [etape for etape in windows if "gh release upload" in str(etape.get("run", ""))]
    )
    for fichier_publie, raison in (
        ('"publication/DoraBase-$VERSION-x64-setup.exe"',
         "le manifeste porterait une clef `windows-x86_64` dont l'URL est en 404, donc une\n"
         "  mise à jour annoncée que rien ne peut installer"),
        ('"publication/DoraBase-$VERSION-x64-setup.exe.sig"',
         "l'application refuserait la mise à jour qu'elle vient de télécharger : c'est cette\n"
         "  signature qu'elle vérifie avant de se remplacer"),
    ):
        if fichier_publie not in televersement:
            print(f"publication.yml : le job « windows » ne téléverse plus "
                  f"{fichier_publie}.\n  {raison}.", file=sys.stderr)
            raise SystemExit(1)

    #    Et les deux artefacts de signature refusent de partir **vides** : le défaut
    #    d'`upload-artifact` est `warn`, donc une signature non copiée ne ferait rien échouer
    #    là où elle manque — c'est le job `manifeste` qui tomberait, vingt minutes plus tard,
    #    sur un téléchargement introuvable.
    for nom_job, etapes_job in (("macos", etapes), ("windows", windows)):
        artefacts = [
            etape for etape in etapes_job
            if str((etape.get("with") or {}).get("name", "")).startswith("maj-")
        ]
        if not artefacts:
            print(f"publication.yml : le job « {nom_job} » ne téléverse plus d'artefact "
                  "`maj-*` — le job « manifeste » n'aurait aucune signature à lire",
                  file=sys.stderr)
            raise SystemExit(1)
        for artefact in artefacts:
            if (artefact.get("with") or {}).get("if-no-files-found") != "error":
                print(f"publication.yml : l'artefact `maj-*` du job « {nom_job} » n'a pas "
                      "`if-no-files-found: error`.\n"
                      "  Le défaut est `warn` : une signature non copiée partirait en artefact"
                      "\n  vide, et l'échec se déclarerait dans un autre job.",
                      file=sys.stderr)
                raise SystemExit(1)

    # ── Le manifeste de mise à jour ───────────────────────────────────────────────────────
    #
    # Il vit dans son **propre** job depuis `API-58` : il porte une clef par plateforme, et la
    # signature Windows n'existe que dans le job Windows. Trois faits le tiennent, et aucun ne
    # se remarquerait autrement qu'en regardant une release publiée — ou, pire, qu'en essayant
    # de se mettre à jour depuis une installation existante.
    etapes_manifeste = etapes_de(jobs, "manifeste", 5, "publication.yml")
    commandes_manifeste = commandes_de(etapes_manifeste)

    # a. **Un seul producteur.** Le manifeste écrit par `macos` ne pourrait pas porter la clef
    #    Windows, et un manifeste complété *après coup* par le job Windows serait un fichier
    #    engendré à deux mains — ce que ce dépôt refuse partout ailleurs.
    if "latest.json" in commandes:
        print("publication.yml : le job « macos » touche encore à `latest.json` — c'est le "
              "job « manifeste » qui l'écrit, seul, une fois les deux constructions faites",
              file=sys.stderr)
        raise SystemExit(1)
    if "latest.json" in commandes_windows:
        print("publication.yml : le job « windows » touche à `latest.json` — un manifeste "
              "complété par deux jobs est un fichier engendré à deux producteurs",
              file=sys.stderr)
        raise SystemExit(1)

    # b. **Il attend les deux constructions, et il téléverse.** Sans `needs`, il courrait
    #    contre elles et n'aurait aucune signature à lire ; sans téléversement, il écrirait un
    #    fichier que personne ne va chercher.
    if sorted(jobs["manifeste"].get("needs") or []) != ["macos", "windows"]:
        print("publication.yml : le job « manifeste » doit déclarer `needs: [macos, "
              "windows]` — il lit les signatures que les deux constructions produisent",
              file=sys.stderr)
        raise SystemExit(1)
    if "gh release upload" not in commandes_manifeste:
        print("publication.yml : le job « manifeste » ne téléverse rien — les installations "
              "existantes liraient le manifeste de la release précédente, ou un 404",
              file=sys.stderr)
        raise SystemExit(1)

    # c. **Les trois clefs y sont.** C'est le défaut d'`API-58` lui-même : une clef absente ne
    #    fait échouer ni la construction ni la publication, elle ne se voit qu'en cherchant une
    #    mise à jour depuis la plateforme qu'elle nomme. Les deux clefs `darwin-*` sont là pour
    #    la même raison, et parce qu'il en faut deux pour **une** archive universelle.
    for clef in ("darwin-aarch64", "darwin-x86_64", "windows-x86_64"):
        if clef not in commandes_manifeste:
            print(f"publication.yml : le manifeste ne porte plus `{clef}` — cette "
                  "plateforme-là\n"
                  "  recevrait « the platform was not found in the response `platforms` "
                  "object »,\n"
                  "  et rien avant la publication ne le dirait.", file=sys.stderr)
            raise SystemExit(1)

    # d. **Chaque plateforme entre au manifeste par sa propre sortie de job**, et non par son
    #    `result` : un job `macos` réussi mais non notarié n'a pas d'archive à proposer, et
    #    `download-artifact` échouerait sur un artefact absent. C'est aussi ce qui garde la
    #    propriété du 1er septembre — un échec d'un côté ne coûte pas la publication de
    #    l'autre — en la rendant symétrique.
    for nom in ("macos", "windows"):
        if not (jobs[nom].get("outputs") or {}).get("maj"):
            print(f"publication.yml : le job « {nom} » ne déclare plus la sortie `maj` — le "
                  "job « manifeste » ne saurait plus si cette plateforme a produit une "
                  "archive signée", file=sys.stderr)
            raise SystemExit(1)
        if f"needs.{nom}.outputs.maj" not in str(etapes_manifeste):
            print(f"publication.yml : le job « manifeste » ne consulte plus `needs.{nom}."
                  "outputs.maj` — il téléchargerait un artefact qui peut ne pas exister",
                  file=sys.stderr)
            raise SystemExit(1)

    verifier_gh_nomme_son_depot(workflow, "publication.yml")

    print(f"publication.yml cohérent — {len(jobs)} jobs, tag ancré, release publiée, "
          "manifeste à trois clefs écrit par un seul job")


def verifier_playwright() -> None:
    """Que les captures de fidélité soient **comparées**, et non réécrites.

    Le gabarit de chemin par défaut de Playwright est
    `…/{arg}{-projectName}{-snapshotSuffix}{ext}`. Depuis l'ajout des deux projets (`macos` et
    `windows`, 31 août 2026), ce `{-projectName}` suffit à renommer les références : Playwright
    a cherché `a1-accueil-macos-darwin.png`, ne l'a pas trouvé, et l'a **écrit**. Les cinq tests
    de fidélité sont passés au vert en ne comparant rien — mesuré au premier lancement.

    C'est le même piège que le runner Linux, déjà gardé plus haut, atteint par un autre chemin :
    et il est pire, parce qu'il se déclenche sur le **bon** système. D'où ce contrôle, qui porte
    sur le mécanisme plutôt que sur ses symptômes.
    """
    chemin = RACINE / "playwright.config.ts"
    source = chemin.read_text()

    if "snapshotPathTemplate" not in source:
        print(
            "playwright.config.ts : `snapshotPathTemplate` n'est plus déclaré.\n"
            "  Le gabarit par défaut insère `{-projectName}` : les cinq références seraient\n"
            "  réécrites sous un nouveau nom au lieu d'être comparées, et la suite serait verte\n"
            "  sans rien mesurer.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    # Le nom du projet ne doit pas entrer dans le chemin : un seul projet prend des captures, et
    # le suffixe qui distingue quelque chose est celui de la plateforme.
    ligne = next(
        (l for l in source.splitlines() if "{testFileName}-snapshots" in l),
        "",
    )
    if "{-projectName}" in ligne:
        print(
            "playwright.config.ts : le gabarit des captures contient `{-projectName}`.\n"
            "  Les références sur disque n'en portent pas (a1-accueil-darwin.png) : elles\n"
            "  seraient donc réécrites au lieu d'être comparées.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    if "{-snapshotSuffix}" not in ligne:
        print(
            "playwright.config.ts : le gabarit des captures a perdu `{-snapshotSuffix}`.\n"
            "  C'est lui qui porte `-darwin` : sans lui, une exécution sur un autre système\n"
            "  écraserait les références de macOS.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    # Les captures ne doivent porter aucun nom de projet.
    #
    # **`endswith("-darwin.png")` ne suffisait pas**, et le sabotage l'a montré :
    # `a1-accueil-macos-darwin.png` finit lui aussi par `-darwin.png`. Le nom du projet s'insère
    # *avant* le suffixe de plateforme, jamais après — c'est donc lui qu'il faut chercher, et il
    # est lu dans la configuration plutôt qu'écrit ici, pour qu'un troisième projet soit couvert
    # sans qu'on y pense.
    projets = re.findall(r"^\s*name: '([a-z0-9-]+)',", source, re.MULTILINE)
    references = sorted((RACINE / "e2e").glob("*-snapshots/*.png"))

    intruses = [
        r.name
        for r in references
        if not r.name.endswith("-darwin.png")
        or any(f"-{projet}-" in r.name for projet in projets)
    ]
    if intruses:
        print(
            f"e2e : {len(intruses)} référence(s) hors convention : {intruses}\n"
            f"  (projets déclarés : {projets})\n"
            "  Une référence portant un nom de projet est le signe que Playwright en a écrit de\n"
            "  nouvelles au lieu de comparer les anciennes — donc que les tests de fidélité sont\n"
            "  verts sans rien mesurer. Retirez-la et rétablissez `snapshotPathTemplate`.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    print(f"playwright.config.ts cohérent — {len(references)} référence(s), toutes en `-darwin.png`")


def main() -> int:
    verifier_ci()
    verifier_publication()
    verifier_playwright()
    return 0


if __name__ == "__main__":
    sys.exit(main())
