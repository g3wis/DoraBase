#!/usr/bin/env bash
#
# La barrière avant commit : lance localement ce que la CI lancera, et **échoue**.
#
# Écrit après avoir constaté deux fois le même défaut : enchaîner les vérifications à la
# main dans un `bash -c` avec `cmd | tail -3` pour abréger la sortie. Le statut de sortie
# d'un pipeline est celui de sa **dernière** commande, donc `tail` réussit toujours et
# `set -e` ne voit rien. Résultat : « tout vert » affiché avec trois vérifications rouges.
#
# Ici rien n'est tronqué et chaque échec est enregistré puis rappelé à la fin.
#
# Les tests exigeant PostgreSQL ne tournent que si `DORABASE_TEST_PG` est posée — leur
# absence est signalée, jamais silencieuse.

set -u
cd "$(dirname "$0")/.."

echecs=()

etape() {
  local nom="$1"
  shift
  printf '\n\033[1m── %s\033[0m\n' "$nom"
  if "$@"; then
    printf '\033[32m   ok\033[0m\n'
  else
    printf '\033[31m   ÉCHEC\033[0m\n'
    echecs+=("$nom")
  fi
}

etape "aucun sabotage résiduel" ./scripts/verifier-aucun-sabotage.sh
# **Le fichier de CI décrit-il ce qu'on croit ?** Une clé dupliquée dans un mappage YAML ne fait pas
# échouer l'analyseur : le dernier gagne, en silence. Une édition automatisée a un jour dupliqué le
# job `engine`, et le premier avait avalé les étapes du job `build` — la construction macOS ne
# tournait plus, et rien ne le disait.
etape "ci.yml et publication.yml cohérents" python3 scripts/verifier-ci.py
# Les trois fichiers qui portent le numéro de version — `package.json`, `Cargo.toml`,
# `Cargo.lock` — ne se parlent pas. Relever deux sur trois laisse tout vert et publie un `.dmg`
# dont le nom contredit son `Info.plist`. `scripts/version.sh` est le geste qui les relève.
etape "version cohérente" python3 scripts/verifier-version.py
# **Les recouvrements de plateforme ne doivent rien perdre de la fenêtre.** Tauri fusionne
# `tauri.windows.conf.json` et `tauri.linux.conf.json` par RFC 7386, où un tableau est *remplacé*
# et non fusionné : comme la fenêtre est déclarée dans `app.windows`, une clef absente d'un
# recouvrement retombe sur le défaut de Tauri — 800 × 600, sans titre — et **rien n'échoue**. Le
# bundle se construit, se signe, et l'écart ne se voit qu'en lançant l'application.
etape "recouvrements de plateforme cohérents" python3 scripts/verifier-conf-plateformes.py
# L'image de fond de la fenêtre d'installation est un bitmap committé : aucune compilation ne
# la relit. Une régénération à la mauvaise échelle ou une cote changée d'un seul côté
# n'arrêterait rien avant le volume publié.
etape "fond de la fenêtre .dmg" ./scripts/verifier-fond-dmg.sh
etape "rust : format" cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check

if [[ -n "${DORABASE_TEST_PG:-}" && -z "${DORABASE_TEST_SSH_HOST:-}" ]]; then
  printf '\n\033[33m── Bastion SSH absent : les tests de tunnel (06e) seront sautés.\033[0m\n'
  printf '\033[33m   ./scripts/bastion-test.sh demarrer /tmp/bastion && . /tmp/bastion/bastion.env\033[0m\n'
fi

if [[ -n "${DORABASE_TEST_PG:-}" && -z "${DORABASE_TEST_PG_CERTS:-}" ]]; then
  printf '\n\033[33m── Décor TLS absent : les tests de `06f` seront sautés.\033[0m\n'
  printf '\033[33m   export DORABASE_TEST_PG=$(./scripts/pg-test.sh demarrer)\033[0m\n'
fi

if [[ -n "${DORABASE_TEST_PG:-}" && -z "${DORABASE_TEST_MYSQL:-}" ]]; then
  printf '\n\033[33m── MySQL absent : les tests du moteur `16` seront sautés.\033[0m\n'
  printf '\033[33m   export DORABASE_TEST_MYSQL=$(./scripts/mysql-test.sh demarrer)\033[0m\n'
fi

if [[ -n "${DORABASE_TEST_PG:-}" && -z "${DORABASE_TEST_MONGO:-}" ]]; then
  printf '\n\033[33m── MongoDB absent : les tests du moteur `18` seront sautés.\033[0m\n'
  printf '\033[33m   export DORABASE_TEST_MONGO=$(./scripts/mongo-test.sh demarrer)\033[0m\n'
fi

if [[ -n "${DORABASE_TEST_PG:-}" ]]; then
  etape "rust : clippy (avec db-tests)" \
    cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --features db-tests -- -D warnings
  etape "rust : tests (avec base réelle)" \
    cargo test --manifest-path src-tauri/Cargo.toml --features db-tests
else
  printf '\n\033[33m── DORABASE_TEST_PG absente : les tests sur base réelle sont sautés\033[0m\n'
  etape "rust : clippy" \
    cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
  etape "rust : tests" cargo test --manifest-path src-tauri/Cargo.toml
fi

etape "cargo run reste non ambigu" bash -c \
  'cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 --no-deps | python3 scripts/verifier-default-run.py'

# Les trois `*:check` de `package.json` régénèrent puis exigent un `git diff` vide. C'est le
# bon test en CI, où l'arbre est propre. En local il échoue sur toute régénération légitime
# encore non commitée, ce qui pousse à passer outre — donc à ne plus vérifier du tout.
#
# L'invariant vraiment intéressant est autre : **le fichier sur disque est-il celui que son
# producteur émet ?** On photographie, on régénère, on compare. Un écart signifie que la
# projection était périmée ; elle vient d'être remise à jour et doit entrer dans le commit,
# d'où l'échec — une seconde exécution passera. La propreté vis-à-vis de git reste le
# travail de la CI.
regeneration_sans_effet() {
  local producteur="$1"
  shift
  local avant
  avant=$(git hash-object "$@" | tr '\n' ' ')
  pnpm "$producteur" >/dev/null 2>&1 || return 1
  local apres
  apres=$(git hash-object "$@" | tr '\n' ' ')
  if [[ "$avant" == "$apres" ]]; then
    return 0
  fi
  printf '   les fichiers engendrés étaient périmés ; ils viennent d’être régénérés.\n'
  printf '   Intègre-les au commit, puis relance.\n'
  return 1
}

etape "jetons de design à jour" regeneration_sans_effet tokens:build \
  src/design/tokens.css src/design/tokens.ts
etape "projections TypeScript à jour" regeneration_sans_effet domain:build \
  src/domain/config.ts src/domain/engine.ts src/domain/maj.ts
etape "typescript" pnpm typecheck
etape "biome" pnpm lint
etape "vitest" pnpm test

# Playwright en dernier : c'est l'étape la plus lente, et la seule qui démarre un serveur.
# Elle garde les trois faits de mise en page que jsdom ne peut pas voir (`e2e/`).
if [[ -d node_modules/@playwright ]]; then
  etape "playwright" pnpm test:e2e
else
  printf '\n\033[33m── Playwright absent : `pnpm exec playwright install chromium` pour l’activer\033[0m\n'
fi

if [[ ${#echecs[@]} -eq 0 ]]; then
  printf '\n\033[32mTout est vert.\033[0m\n'
  exit 0
fi

printf '\n\033[31m%d vérification(s) en échec :\033[0m\n' "${#echecs[@]}"
printf '  - %s\n' "${echecs[@]}"
exit 1
