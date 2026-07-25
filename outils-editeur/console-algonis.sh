#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js est introuvable."
  echo "  Installez-le depuis https://nodejs.org (version 20 ou plus récente), puis relancez."
  echo
  exit 1
fi

echo
echo "  Démarrage de la console éditeur Algonis…"
echo "  Le navigateur s'ouvre tout seul. Ctrl+C pour arrêter."
echo
exec node console.js
