#!/usr/bin/env bash
#
# Relève le numéro de version, en un seul geste, et pose le tag qui déclenche la publication.
#
#   ./scripts/version.sh correctif     0.1.0 -> 0.1.1   une correction, rien de neuf
#   ./scripts/version.sh fonction      0.1.0 -> 0.2.0   une fonctionnalité, rien de cassé
#   ./scripts/version.sh majeur        0.1.0 -> 1.0.0   une rupture assumée
#   ./scripts/version.sh 0.4.2         le numéro exact, quand aucun des trois ne convient
#
# Ce que le script fait, dans cet ordre : il calcule le numéro demandé, vérifie l'état du
# dépôt, écrit les **trois** fichiers qui portent la version, exige que son propre résultat soit
# cohérent, committe, puis pose un tag annoté `vX.Y.Z`. Il ne pousse rien — la commande à lancer
# est affichée à la fin.
#
# Le numéro **avant** l'état du dépôt, et c'est délibéré : refuser « 1.2 » ne demande ni réseau
# ni arbre propre, et un message d'usage vaut mieux qu'un échec de `git fetch`.
#
# # Pourquoi un script, et pas trois `sed` à la main
#
# La version vit dans `package.json`, `src-tauri/Cargo.toml` et `src-tauri/Cargo.lock`, et
# aucun des trois ne connaît les autres. Relever deux fichiers sur trois laisse la CI verte et
# publie un `.dmg` dont le nom, l'`Info.plist` et la crate ne s'accordent pas. Voir l'en-tête
# de `scripts/verifier-version.py`, qui garde cet invariant et que ce script appelle sur sa
# propre sortie.
#
# # Pourquoi le tag est annoté, et posé ici
#
# Un tag léger n'a ni auteur, ni date, ni message : `git describe` s'en sert quand même, mais
# rien ne dit **qui** a publié **quoi**. Le tag est la seule trace durable d'une publication,
# et c'est lui qui déclenche `.github/workflows/publication.yml` — il vaut mieux qu'il porte
# son propre récit.
#
# Le tag est posé sur le commit de relèvement, jamais sur un commit antérieur : le binaire
# publié doit annoncer exactement le numéro du tag qui l'a produit.

set -euo pipefail
cd "$(dirname "$0")/.."

rouge() { printf '\033[31m%s\033[0m\n' "$*" >&2; }
gras() { printf '\033[1m%s\033[0m\n' "$*"; }

forcer_branche=false
argument=

for brut in "$@"; do
  case $brut in
    # Prévu pour essayer le script ailleurs que sur `main` — pas pour publier depuis une
    # branche de travail. Une publication vient de `main`, sinon le tag désigne un état que
    # personne ne relira.
    --forcer-branche) forcer_branche=true ;;
    -*)
      rouge "option inconnue : $brut"
      exit 1
      ;;
    *) argument=$brut ;;
  esac
done

if [[ -z $argument ]]; then
  gras "usage : ./scripts/version.sh <correctif|fonction|majeur|X.Y.Z>"
  printf '\nversion actuelle : %s\n' "$(sed -n 's/^  "version": "\(.*\)",/\1/p' package.json)"
  exit 1
fi

# ── Le numéro ───────────────────────────────────────────────────────────────────────────────

actuelle=$(python3 -c 'import json,sys; print(json.load(open("package.json"))["version"])')
IFS=. read -r majeur fonction correctif <<<"$actuelle"

case $argument in
  majeur) nouvelle="$((majeur + 1)).0.0" ;;
  fonction) nouvelle="$majeur.$((fonction + 1)).0" ;;
  correctif) nouvelle="$majeur.$fonction.$((correctif + 1))" ;;
  *)
    if [[ ! $argument =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
      rouge "« $argument » n'est ni un cran (correctif|fonction|majeur) ni un majeur.fonction.correctif"
      exit 1
    fi
    nouvelle=$argument
    ;;
esac

if [[ $nouvelle == "$actuelle" ]]; then
  rouge "la version est déjà $actuelle — il n'y a rien à relever."
  exit 1
fi

if git rev-parse --verify --quiet "refs/tags/v$nouvelle" >/dev/null; then
  rouge "le tag v$nouvelle existe déjà : ce numéro a été publié."
  rouge "  un tag republié sur un autre commit fait mentir tout ce qui l'a téléchargé."
  exit 1
fi

# Un numéro qui recule n'est pas une erreur de frappe repérable à l'œil quand il est proche du
# précédent (0.2.10 après 0.2.9 est juste, 0.2.9 après 0.2.10 ne l'est pas).
plus_grand=$(printf '%s\n%s\n' "$actuelle" "$nouvelle" | sort -V | tail -1)
if [[ $plus_grand != "$nouvelle" ]]; then
  rouge "$nouvelle est antérieure à $actuelle : une version ne recule pas."
  exit 1
fi

gras "── $actuelle → $nouvelle"

# ── L'état du dépôt, avant d'écrire quoi que ce soit ────────────────────────────────────────

branche=$(git rev-parse --abbrev-ref HEAD)
if [[ $branche != main && $forcer_branche != true ]]; then
  rouge "sur « $branche » : une publication se coupe depuis « main »."
  rouge "  la CI n'a validé que ce qui y est fusionné ; un tag ailleurs désigne un état"
  rouge "  que personne ne relira. --forcer-branche pour passer outre, en connaissance."
  exit 1
fi

if [[ -n $(git status --porcelain) ]]; then
  rouge "l'arbre n'est pas propre : le commit de relèvement emporterait du travail en cours."
  git status --short >&2
  exit 1
fi

# `main` doit être **exactement** `origin/main` : en avance, on publierait du code que la CI
# n'a pas vu ; en retard, on publierait un état déjà dépassé sous un numéro neuf.
if [[ $branche == main ]]; then
  if ! git fetch --quiet origin main; then
    rouge "impossible de joindre origin — rien n'a été écrit."
    rouge "  la comparaison avec origin/main est la garantie que le tag désigne l'état"
    rouge "  que la CI a validé ; sans elle, on publierait à l'aveugle."
    exit 1
  fi
  local_sha=$(git rev-parse HEAD)
  distant_sha=$(git rev-parse origin/main)
  if [[ $local_sha != "$distant_sha" ]]; then
    rouge "main et origin/main divergent — rien n'a été écrit."
    rouge "  local   : $local_sha"
    rouge "  distant : $distant_sha"
    rouge "  synchronisez, laissez la CI passer, puis relancez."
    exit 1
  fi
fi

# ── Les trois fichiers ──────────────────────────────────────────────────────────────────────

# **En Python, et non plus par `sed -i ''`** (#189) : c'est la forme BSD, qui échoue sous GNU, et
# `release.yml` tourne désormais sur Linux — une minute macOS s'y facturait dix pour relever trois
# fichiers. Chaque motif doit correspondre **exactement une fois**, ce que `sed` ne vérifiait pas.
#
# Le verrou : la ligne `version` qui **suit** `name = "dorabase"`, et pas une autre. Six cents
# paquets y portent la même clef. `cargo` la réécrirait aussi, mais il exigerait d'être dans le
# `PATH` (voir AGENTS.md, pièges propres à cette machine) et toucherait au reste du verrou.
python3 - "$nouvelle" <<'PY'
import re, sys
from pathlib import Path

nouvelle = sys.argv[1]
for fichier, motif in (
    ("package.json", r'(?m)^(  "version": ")[^"]+(",)$'),
    ("src-tauri/Cargo.toml", r'(?m)^(version = ")[^"]+(")$'),
    ("src-tauri/Cargo.lock", r'(?m)^(name = "dorabase"\nversion = ")[^"]+(")'),
):
    chemin = Path(fichier)
    texte = chemin.read_text(encoding="utf-8")
    remplace, combien = re.subn(
        motif, lambda m: m.group(1) + nouvelle + m.group(2), texte
    )
    if combien != 1:
        sys.exit(f"{fichier} : {combien} occurrence(s) de la version, 1 attendue")
    chemin.write_text(remplace, encoding="utf-8")
PY

# Le producteur vérifie sa propre sortie. Si les trois fichiers ne s'accordent pas, rien n'est
# committé et l'arbre garde les modifications, à inspecter.
python3 scripts/verifier-version.py "$nouvelle"

# ── Le commit et le tag ─────────────────────────────────────────────────────────────────────

git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit --quiet --message "chore(version): $nouvelle"
git tag --annotate "v$nouvelle" --message "DoraBase $nouvelle"

gras "── commit et tag v$nouvelle posés localement"
cat <<TEXTE

Rien n'a été poussé. Pour publier :

  git push origin main --follow-tags

Le tag déclenche .github/workflows/publication.yml, qui construit le bundle macOS
universel, le signe en ad hoc et l'attache à une release GitHub.

Pour défaire avant d'avoir poussé :

  git tag --delete v$nouvelle && git reset --hard HEAD~1
TEXTE
