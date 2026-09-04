#!/usr/bin/env python3
"""Que les recouvrements de plateforme ne perdent rien de la fenêtre déclarée par `tauri.conf.json`.

# Le défaut que ce script empêche

Tauri fusionne `tauri.<plateforme>.conf.json` dans `tauri.conf.json` par **RFC 7386**
(`json_patch::merge`), où un **tableau est remplacé en entier**, jamais fusionné élément par
élément. Or la fenêtre est déclarée dans `app.windows`, qui est un tableau.

Mesuré le 31 août 2026 contre `json-patch` 3.0.1, la version du verrou : un recouvrement
réduit à `{"app":{"windows":[{"decorations":false}]}}` rend exactement

    {"app": {"windows": [{"decorations": false}]}}

— `title`, `width`, `height`, `minWidth`, `minHeight`, `resizable` : tous disparus. Le build
aurait alors pris les défauts de Tauri (800 × 600, sans titre), **sans que rien n'échoue** : la
construction réussit, le bundle se fabrique, et l'écart ne se voit qu'en lançant l'application.
C'est le mode de défaillance de `TAURI_BUNDLER_DMG_IGNORE_CI`, sur un autre réglage.

Chaque recouvrement doit donc **répéter toute la fenêtre**, et ce script est ce qui garde la
répétition honnête : sans lui, relever `width` dans `tauri.conf.json` laisserait les autres
plateformes à l'ancienne valeur, en silence et pour toujours.

# Deux recouvrements depuis le 4 septembre 2026, et un seul script

Le script s'appelait `verifier-conf-windows.py` et ne connaissait qu'un fichier. Le dupliquer
pour Linux aurait été la première recopie d'un garde-fou de ce dépôt — exactement le défaut à
quatre exemplaires de « où habite l'utilisateur » (31 août 2026), dont la leçon est qu'**une
question qui n'a qu'une réponse doit n'avoir qu'un lieu**. La question est ici « le recouvrement
répète-t-il la fenêtre ? », et elle est la même pour les deux.

Ce qui **diffère** d'un recouvrement à l'autre vit dans `RECOUVREMENTS`, en données : les cibles
de bundle qui lui sont interdites, et rien d'autre. Tout le reste — les clefs macOS écartées, les
clefs exigées — est commun, parce que la raison l'est : `decorations: false` retire le cadre du
système sous Windows comme sous Linux, et `titleBarStyle` / `hiddenTitle` n'ont de sens sur
aucune des deux.

# Ce qui est *censé* différer

`titleBarStyle` et `hiddenTitle` sont des clefs **macOS seulement** : elles n'ont pas de sens
ailleurs, où c'est `decorations: false` qui retire le cadre du système pour laisser `TitleBar`
dessiner ses trois boutons. Elles sont donc attendues absentes des recouvrements, et leur
présence est signalée — une clef macOS dans un fichier Windows ou Linux est soit une confusion,
soit une attente qui ne sera pas honorée.
"""

import json
import pathlib
import sys

RACINE = pathlib.Path(__file__).resolve().parent.parent
BASE = RACINE / "src-tauri" / "tauri.conf.json"

# Les clefs qui appartiennent à macOS et n'ont rien à faire dans un recouvrement.
MACOS_SEULEMENT = {"titleBarStyle", "hiddenTitle"}

# Ce que tout recouvrement doit ajouter de son propre chef.
#
# **`decorations: false` pour les deux, et pour la même raison.** Sans lui, le système dessine sa
# propre barre de titre **au-dessus** de la nôtre : deux barres, 72 px de chrome pour 40 px
# d'information, et « DoraBase » écrit deux fois.
EXIGE_HORS_MACOS = {"decorations": False}

# Les cibles de bundle qu'un recouvrement ne peut pas viser, par plateforme.
#
# La liste est **négative** — ce qui est interdit — et non positive : ajouter une cible légitime
# (un `msi` à côté du `nsis`, un `rpm` à côté du `deb`) est une décision de packaging qui n'a
# aucune raison de demander l'édition d'un garde-fou. Ce qui doit échouer, c'est une cible qui
# n'existe pas sur la plateforme visée, parce que le bundler l'ignorerait en silence.
RECOUVREMENTS = {
    "tauri.windows.conf.json": {"cibles_interdites": {"app", "dmg", "deb", "rpm", "appimage"}},
    "tauri.linux.conf.json": {"cibles_interdites": {"app", "dmg", "nsis", "msi"}},
}


def fenetre(chemin: pathlib.Path) -> dict:
    conf = json.loads(chemin.read_text())
    fenetres = conf.get("app", {}).get("windows", [])
    if len(fenetres) != 1:
        print(
            f"ÉCHEC : {chemin.name} déclare {len(fenetres)} fenêtre(s), une seule est attendue.\n"
            "  Ce script compare la fenêtre unique du produit ; à plusieurs, il faudrait dire\n"
            "  laquelle correspond à laquelle.",
            file=sys.stderr,
        )
        sys.exit(1)
    return fenetres[0]


def verifier(nom: str, cibles_interdites: set[str], base: dict) -> list[str]:
    """Les problèmes d'un recouvrement, avec leur explication. Liste vide = cohérent."""
    chemin = RACINE / "src-tauri" / nom
    if not chemin.exists():
        return [
            f"{chemin} manque — le build de cette plateforme perdrait toute la fenêtre,\n"
            f"    et prendrait les défauts de Tauri sans que rien n'échoue."
        ]

    recouvrement = fenetre(chemin)
    problemes: list[str] = []

    # 1. Tout ce que macOS déclare et qui n'est pas macOS-seulement doit être repris à l'identique.
    for clef, valeur in base.items():
        if clef in MACOS_SEULEMENT:
            continue
        if clef not in recouvrement:
            problemes.append(
                f"« {clef} » ({valeur!r}) manque dans {nom}.\n"
                f"    RFC 7386 remplace le tableau `app.windows` en entier : une clef absente\n"
                f"    n'est pas héritée, elle retombe sur le défaut de Tauri."
            )
        elif recouvrement[clef] != valeur:
            problemes.append(
                f"« {clef} » diverge : {valeur!r} sur macOS, {recouvrement[clef]!r} dans {nom}.\n"
                f"    Si c'est voulu, ajoutez la clef à une liste d'écarts assumés de ce script,\n"
                f"    avec sa raison. Sinon, les deux fichiers ont dérivé."
            )

    # 2. Les clefs macOS n'ont rien à faire là.
    for clef in sorted(MACOS_SEULEMENT & recouvrement.keys()):
        problemes.append(
            f"« {clef} » est une clef macOS et n'a pas d'effet dans {nom} ; retirez-la du"
            " recouvrement."
        )

    # 3. Ce que le recouvrement doit apporter.
    for clef, attendu in EXIGE_HORS_MACOS.items():
        if recouvrement.get(clef) != attendu:
            problemes.append(
                f"« {clef} » doit valoir {attendu!r} dans {nom} (actuellement"
                f" {recouvrement.get(clef)!r}).\n"
                f"    Sans lui, le système dessine sa propre barre de titre **au-dessus** de la\n"
                f"    nôtre : deux barres, 72 px de chrome pour 40 px d'information."
            )

    # 4. Et il ne peut pas viser une cible d'une autre plateforme.
    cibles = set(json.loads(chemin.read_text()).get("bundle", {}).get("targets", []))
    if not cibles:
        problemes.append(
            f"{nom} ne déclare aucune cible de bundle.\n"
            f"    Tauri retomberait sur celles de `tauri.conf.json` — « app » et « dmg », qui\n"
            f"    sont macOS — et la construction ne produirait rien d'installable."
        )
    for interdite in sorted(cibles & cibles_interdites):
        problemes.append(
            f"bundle.targets de {nom} porte « {interdite} », qui n'existe pas sur cette"
            " plateforme."
        )

    return problemes


def main() -> int:
    base = fenetre(BASE)
    en_echec = False

    for nom, regles in RECOUVREMENTS.items():
        problemes = verifier(nom, regles["cibles_interdites"], base)
        if problemes:
            en_echec = True
            print(f"ÉCHEC : tauri.conf.json et {nom} ont dérivé.\n", file=sys.stderr)
            for probleme in problemes:
                print(f"  - {probleme}", file=sys.stderr)
            print(file=sys.stderr)

    if en_echec:
        return 1

    reprises = len([c for c in base if c not in MACOS_SEULEMENT])
    print(
        f"recouvrements cohérents ({', '.join(RECOUVREMENTS)}) : "
        f"{reprises} clef(s) de fenêtre reprises par chacun, "
        f"{len(MACOS_SEULEMENT)} clef(s) macOS écartées"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
