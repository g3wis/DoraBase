#!/usr/bin/env python3
"""Ce qu'une exécution de `ci.yml` doit faire tourner, d'après ce qui a changé (#189).

# Pourquoi ce script existe

Une PR qui ne touche que du Rust faisait tourner Playwright sur macOS — facturé dix fois une
minute Linux —, une PR qui ne touche que du TypeScript compilait Rust sous Windows, et une PR qui
ne change qu'`AGENTS.md` payait les deux, plus un `.dmg` et un `.exe` construits en release. Ce
script lit la liste des fichiers changés et rend cinq portées, une par famille de jobs :

| portée    | jobs                       | runner            |
| --------- | -------------------------- | ----------------- |
| `web`     | `web`                      | Linux             |
| `rust`    | `rust` (décors compris)    | Linux             |
| `windows` | `windows`                  | Windows (2×)      |
| `e2e`     | `e2e` (Playwright)         | macOS (10×)       |
| `paquet`  | `paquet-macos`, `paquet-windows` | macOS, Windows |

# Pourquoi un script plutôt que des `paths:` de workflow

Un filtre `paths:` porte sur le **workflow entier** : il aurait fallu un fichier par famille de
jobs, donc cinq fois la même mise en place et cinq listes de chemins à tenir en phase. Ici la
règle a **un seul lieu**, et ce lieu est testable : `scripts/verifier-ci.py` la soumet à une table
de cas, et la lance sur des chemins qu'on lui donne (`python3 scripts/perimetre-ci.py src/a.ts`).

# Les deux choix qui tiennent tout le reste

- **un fichier que rien ne classe fait tout tourner.** Le défaut sûr est le coût d'avant, pas un
  silence : un dossier ajouté demain sans règle ne doit pas sortir de la CI sans que personne l'ait
  décidé. `verifier-ci.py` garde ce défaut par un cas de sa table ;
- **toucher la CI fait tout tourner** — `.github/` et ce script compris. Une PR qui change un job
  doit l'exercer, sans quoi elle fusionnerait un job qu'aucune exécution n'a vu.
"""

from __future__ import annotations

import os
import subprocess
import sys

PORTEES = ("web", "rust", "windows", "e2e", "paquet")
TOUT = frozenset(PORTEES)

# Ce que le changement d'un des fichiers de la chaîne de paquet peut casser sans qu'aucune
# compilation de débogage le voie : la configuration du bundler, l'habillage du `.dmg`, les
# icônes, le sidecar, les dépendances. Le reste de `src-tauri/` est jugé par `rust` et `windows`.
CHAINE_DE_PAQUET = frozenset({"web", "rust", "windows", "paquet"})

# **Premier motif qui correspond, et il gagne** : l'ordre compte, du plus précis au plus large.
# Un motif finissant par `/` désigne un dossier ; sinon c'est un préfixe de nom de fichier
# (`tsconfig` couvre `tsconfig.app.json`, `scripts/schema-test-` les quatre schémas).
REGLES: tuple[tuple[str, frozenset[str]], ...] = (
    # La CI elle-même : tout, pour qu'une PR qui la change l'exerce.
    (".github/", TOUT),
    ("scripts/perimetre-ci.py", TOUT),
    # Les projections TypeScript des types Rust : `domain:check` les régénère, donc `rust`.
    ("src/domain/", frozenset({"web", "rust", "e2e"})),
    ("src/", frozenset({"web", "e2e"})),
    ("e2e/", frozenset({"web", "e2e"})),
    ("public/", frozenset({"web", "e2e"})),
    ("index.html", frozenset({"web", "e2e"})),
    ("playwright.config.ts", frozenset({"web", "e2e"})),
    ("vite.config.ts", frozenset({"web", "e2e"})),
    ("tsconfig", frozenset({"web", "e2e"})),
    # `package.json` porte aussi les scripts que le job `rust` appelle (`domain:check`).
    ("package.json", frozenset({"web", "rust", "e2e"})),
    ("pnpm-lock.yaml", frozenset({"web", "e2e"})),
    ("biome.json", frozenset({"web"})),
    (".gitignore", frozenset({"web"})),
    # L'habillage du `.dmg` ne se compile pas : seul le bundle macOS le lit.
    ("src-tauri/dmg/", frozenset({"web", "paquet"})),
    ("src-tauri/tauri.", CHAINE_DE_PAQUET),
    ("src-tauri/icons/", CHAINE_DE_PAQUET),
    ("src-tauri/cloud-sql-proxy.lock", CHAINE_DE_PAQUET),
    ("src-tauri/Cargo.", CHAINE_DE_PAQUET),
    ("src-tauri/build.rs", CHAINE_DE_PAQUET),
    ("src-tauri/", frozenset({"web", "rust", "windows"})),
    ("scripts/telecharger-proxy.sh", CHAINE_DE_PAQUET),
    ("scripts/fondre-binaires-universels.sh", frozenset({"web", "paquet"})),
    ("scripts/verifier-dmg-monte.sh", frozenset({"web", "paquet"})),
    ("scripts/verifier-fond-dmg.sh", frozenset({"web", "paquet"})),
    ("scripts/construire-fond-dmg.mjs", frozenset({"web", "paquet"})),
    ("scripts/render-icon.mjs", frozenset({"web", "paquet"})),
    # Les décors de test et ce qui les monte.
    ("scripts/pg-test.sh", frozenset({"web", "rust"})),
    ("scripts/mongo-test.sh", frozenset({"web", "rust"})),
    ("scripts/mysql-test.sh", frozenset({"web", "rust"})),
    ("scripts/bastion-test.sh", frozenset({"web", "rust"})),
    ("scripts/schema-test-", frozenset({"web", "rust"})),
    ("scripts/apt-reessaye.sh", frozenset({"web", "rust"})),
    ("scripts/verifier-default-run.py", frozenset({"web", "rust"})),
    # Ce que le job `web` lance, et rien d'autre.
    ("scripts/build-tokens.mjs", frozenset({"web"})),
    ("scripts/tokens.", frozenset({"web"})),
    ("scripts/verifier-ci.py", frozenset({"web"})),
    ("scripts/verifier-version.py", frozenset({"web"})),
    ("scripts/verifier-conf-windows.py", frozenset({"web"})),
    ("scripts/verifier-aucun-sabotage.sh", frozenset({"web"})),
    ("scripts/verifier-aucun-decor-de-version.sh", frozenset({"web"})),
    ("scripts/verifier-tout.sh", frozenset({"web"})),
    ("scripts/version.sh", frozenset({"web"})),
)


def est_documentation(chemin: str) -> bool:
    """Ce qu'aucun job ne lit : la prose du dépôt, et la configuration de Claude Code."""
    nom = chemin.rsplit("/", 1)[-1]
    return chemin.endswith(".md") or nom.startswith("LICENSE") or chemin.startswith(".claude/")


def portees_de(chemin: str) -> frozenset[str]:
    if est_documentation(chemin):
        return frozenset()
    for motif, portees in REGLES:
        if chemin == motif or chemin.startswith(motif):
            return portees
    return TOUT


def perimetre(fichiers: list[str]) -> frozenset[str]:
    """L'union des portées des fichiers — vide si rien d'autre que de la documentation."""
    resultat: set[str] = set()
    for fichier in fichiers:
        resultat |= portees_de(fichier)
    return frozenset(resultat)


def perimetre_de_l_evenement(evenement: str, portee_demandee: str) -> frozenset[str] | None:
    """Les portées qui ne dépendent pas d'un diff, ou `None` quand il faut lire le diff.

    - **`schedule`** : la chauffe hebdomadaire. Rien ne tourne plus sur `main` à la fusion, or un
      cache n'est partagé entre PR que s'il a été écrit sur la branche par défaut — sans elle,
      chaque PR recompilerait Rust à froid. Elle revérifie `main` au passage, sur les runners bon
      marché : ni Playwright ni bundles ;
    - **`workflow_dispatch`** : à la main, sur n'importe quelle branche. `paquets` ne construit
      que les bundles téléchargeables — le cas courant, « je veux essayer cette branche » ;
    - tout autre événement que `pull_request` fait tout tourner, par prudence.
    """
    if evenement == "pull_request":
        return None
    if evenement == "schedule":
        return frozenset({"web", "rust", "windows"})
    if evenement == "workflow_dispatch" and portee_demandee == "paquets":
        return frozenset({"paquet"})
    return TOUT


def fichiers_du_diff() -> list[str]:
    """Les fichiers que la PR change, lus sur le commit de fusion que GitHub a composé.

    Sur `pull_request`, `actions/checkout` pose `refs/pull/N/merge` : son premier parent est la
    pointe de la base, donc `HEAD^1..HEAD` est exactement ce que la PR apporte — sur **toute** la
    PR, et non sur le seul dernier push. `--no-renames` liste aussi l'ancien chemin d'un fichier
    déplacé : sortir un fichier de `src-tauri/` doit compter pour `src-tauri/`.
    """
    sortie = subprocess.run(
        ["git", "diff", "--name-only", "--no-renames", "HEAD^1", "HEAD"],
        check=True, capture_output=True, text=True,
    ).stdout
    return [ligne for ligne in sortie.splitlines() if ligne]


def main() -> int:
    # À la main : `python3 scripts/perimetre-ci.py chemin…` affiche ce que ces chemins lanceraient.
    if len(sys.argv) > 1:
        portees = perimetre(sys.argv[1:])
        print(" ".join(p for p in PORTEES if p in portees) or "(rien)")
        return 0

    evenement = os.environ.get("EVENEMENT", "")
    portees = perimetre_de_l_evenement(evenement, os.environ.get("PORTEE", "tout"))
    fichiers: list[str] = []
    if portees is None:
        fichiers = fichiers_du_diff()
        portees = perimetre(fichiers)

    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as sortie:
        for portee in PORTEES:
            sortie.write(f"{portee}={'true' if portee in portees else 'false'}\n")

    lignes = [f"## Périmètre de cette exécution ({evenement})", ""]
    lignes += [f"- `{p}` : {'oui' if p in portees else 'non'}" for p in PORTEES]
    if fichiers:
        lignes += ["", f"{len(fichiers)} fichier(s) changé(s)."]
    resume = os.environ.get("GITHUB_STEP_SUMMARY")
    if resume:
        with open(resume, "a", encoding="utf-8") as f:
            f.write("\n".join(lignes) + "\n")
    print("\n".join(lignes))
    return 0


if __name__ == "__main__":
    sys.exit(main())
