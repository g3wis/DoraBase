#!/usr/bin/env bash
# Installer des paquets Debian sur un runner GitHub, sans qu'un miroir pendu passe pour du travail.
#
#   scripts/apt-reessaye.sh paquet…
#
# Fait `apt-get update` puis `apt-get install --no-install-recommends -y paquet…`, chacun borné
# et retenté. Appelé par l'action `.github/actions/preparer` (la pile GTK/WebKit) et par le job
# `rust` de `ci.yml` (le client PostgreSQL 17). La fonction vivait recopiée deux fois dans le même
# job, et une copie qui diverge de l'autre est la première qu'on corrige sans voir la seconde.
#
# **`Acquire::Timeout` n'a pas suffi, et voici pourquoi.** Il borne chaque *étape* d'une connexion,
# pas la durée totale : un miroir qui répond puis distille les octets ne le déclenche jamais. Le
# 19 août 2026, `apt-get update` est resté pendu **vingt-cinq minutes** après avoir récupéré les
# fichiers `InRelease` — les options posées le matin même n'ont rien empêché, et seule la borne du
# job a rendu la main.
#
# Trois remèdes, du plus précis au plus grossier :
#
# 1. **le miroir Azure est écarté.** Les lignes `Ign:` du log montrent que c'est lui qui ne répond
#    pas ; `archive.ubuntu.com` est déjà celui vers lequel `apt` se rabat, en perdant du temps ;
# 2. **`timeout` autour de chaque appel** — la seule borne qui tienne vraiment, puisqu'elle ne
#    dépend pas de la bonne volonté du serveur ;
# 3. **trois tentatives**, parce qu'un miroir qui pend une fois répond souvent la suivante.

set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage : $0 paquet…" >&2
  exit 2
fi

sudo sed -i 's|azure.archive.ubuntu.com|archive.ubuntu.com|g' \
  /etc/apt/sources.list /etc/apt/sources.list.d/*.list \
  /etc/apt/sources.list.d/*.sources 2>/dev/null || true

reessayer() {
  local tentative
  for tentative in 1 2 3; do
    if sudo timeout 240 apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=15 "$@"; then
      return 0
    fi
    echo "::warning::apt-get $1 a échoué ou pendu (tentative $tentative/3)"
    sleep 5
  done
  return 1
}

reessayer update
reessayer install --no-install-recommends -y "$@"
