#!/usr/bin/env bash
# Génération d'une licence, en mode questions/réponses (macOS / Linux).
# Rien à retenir : le script demande ce qu'il faut et affiche la licence.
set -u
cd "$(dirname "$0")"

CLE="${HOME}/.algonis/licence-private.pem"

echo
echo "  ═══ Algonis — génération d'une licence client ═══"
echo

if [ ! -f "$CLE" ]; then
  echo "  Aucune clé de signature trouvée ($CLE)."
  printf "  La créer maintenant ? [O/n] "
  read -r reponse
  case "${reponse:-O}" in
    [nN]*) echo "  Abandon."; exit 1 ;;
  esac
  node scripts/licence-keygen.js || exit 1
  echo
  echo "  ⚠  N'oubliez pas de coller la ligne « const CLE_PUBLIQUE = … »"
  echo "     dans src/licence.js du portail, puis de le livrer."
  echo
  printf "  Appuyez sur Entrée pour continuer… "
  read -r _
fi

printf "  Nom du client                      : "
read -r client
printf "  Dernier jour de validité (AAAA-MM-JJ) : "
read -r fin
printf "  Identifiant d'installation du client  : "
read -r install

if [ -z "${client:-}" ] || [ -z "${fin:-}" ]; then
  echo
  echo "  Le nom du client et la date de fin sont obligatoires. Rien n'a été généré."
  exit 1
fi

ARGS=(--client "$client" --fin "$fin")
if [ -n "${install:-}" ]; then
  ARGS+=(--install "$install")
else
  echo
  echo "  ⚠  Sans identifiant d'installation, la licence fonctionnera sur"
  echo "     n'importe quel serveur. À réserver aux dépannages."
fi

printf "  Référence / note (optionnel)          : "
read -r note
[ -n "${note:-}" ] && ARGS+=(--note "$note")

echo
if node scripts/licence-signer.js "${ARGS[@]}"; then
  echo "  Copiez la ligne ALG1… ci-dessus et envoyez-la au client."
  echo "  Il la colle dans Administration → Réglages → Licence."
else
  echo "  Aucune licence générée : corrigez les informations et relancez."
fi
echo
