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
    windows = etapes_de(jobs, "windows", 14, "publication.yml")
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
    ):
        if fragment not in commandes_windows:
            print(f"publication.yml : le job « windows » a perdu « {fragment} » — {raison}",
                  file=sys.stderr)
            raise SystemExit(1)

    # 2. **Et surtout : il ne publie pas de mise à jour.** Faute de certificat Authenticode,
    #    rien n'atteste qu'un exécutable téléchargé vient de nous — c'est « rien n'est proposé
    #    qui n'ait été notarié », transposé. Téléverser l'archive `.nsis.zip` ou ajouter
    #    `windows-x86_64` au manifeste ouvrirait cette voie **en silence**, chez des gens qui
    #    n'ont rien demandé. Le jour où c'est décidé, c'est ce garde qu'il faut retirer, et le
    #    retirer est alors un geste visible en revue.
    if "nsis.zip" in commandes_windows:
        print("publication.yml : le job « windows » téléverse une archive de mise à jour.\n"
              "  Sans certificat Authenticode, rien n'atteste son origine — et le chemin de mise\n"
              "  à jour n'a jamais été exercé, même sur macOS. Si c'est voulu, retirez ce garde\n"
              "  avec sa raison.", file=sys.stderr)
        raise SystemExit(1)

    manifeste = commandes_de(etapes)
    if "windows-x86_64" in manifeste:
        print("publication.yml : le manifeste de mise à jour porte `windows-x86_64`.\n"
              "  Les installations Windows se mettraient à jour avec un exécutable que rien\n"
              "  n'authentifie. Si c'est voulu, retirez ce garde avec sa raison.",
              file=sys.stderr)
        raise SystemExit(1)

    print(f"publication.yml cohérent — {len(jobs)} jobs, tag ancré, release publiée, "
          "installateur Windows attaché sans voie de mise à jour")


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
