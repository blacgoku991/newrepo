#!/usr/bin/env bash
#
# Copie des sauvegardes HORS du serveur.
#
# La sauvegarde quotidienne existe déjà, mais elle dort à côté de la machine
# qu'elle protège. Disque mort, serveur perdu, rançongiciel : elle part avec.
# Ce script l'envoie ailleurs, chiffrée.
#
# À installer une fois :
#   sudo cp copier-sauvegardes.sh /usr/local/bin/
#   sudo crontab -e
#     30 3 * * * /usr/local/bin/copier-sauvegardes.sh >> /var/log/smartfixx-copie.log 2>&1
#   (3 h 30 : après la sauvegarde de 3 h, avant la maintenance de 4 h)
#
set -euo pipefail

UTILISATEUR="${SMARTFIXX_UTILISATEUR:-smartfixx}"
MAISON="$(getent passwd "$UTILISATEUR" 2>/dev/null | cut -d: -f6 || echo "/home/$UTILISATEUR")"
SAUVEGARDES="${SMARTFIXX_SAUVEGARDES:-$MAISON/.smartfixx/sauvegardes}"

# Destination rclone, configurée par ailleurs (`rclone config`).
# Exemple pour OVH Object Storage : ovh:smartfixx-sauvegardes
DESTINATION="${SMARTFIXX_DESTINATION:-}"
# Phrase secrète de chiffrement. À CONSERVER AILLEURS QUE SUR CE SERVEUR :
# une archive chiffrée dont la clé est sur la machine perdue ne vaut rien.
PHRASE="${SMARTFIXX_PHRASE_SECRETE:-}"
GARDER_DISTANT="${SMARTFIXX_GARDER_DISTANT:-30}"

if [ -z "$DESTINATION" ]; then
  echo "SMARTFIXX_DESTINATION n'est pas défini (ex. ovh:smartfixx-sauvegardes)." >&2
  echo "Configurez d'abord : rclone config" >&2
  exit 1
fi
command -v rclone >/dev/null || { echo "rclone n'est pas installé : curl https://rclone.org/install.sh | sudo bash" >&2; exit 1; }

derniere=$(ls -1 "$SAUVEGARDES" 2>/dev/null | sort -r | head -1)
[ -n "$derniere" ] || { echo "Aucune sauvegarde à copier dans $SAUVEGARDES." >&2; exit 1; }

archive="/tmp/smartfixx-$derniere.tar.gz"
trap 'rm -f "$archive" "$archive.gpg"' EXIT

echo "[$(date -Is)] Archive de $derniere…"
tar -czf "$archive" -C "$SAUVEGARDES" "$derniere"

if [ -n "$PHRASE" ]; then
  command -v gpg >/dev/null || { echo "gpg est nécessaire pour chiffrer : apt install gnupg" >&2; exit 1; }
  echo "[$(date -Is)] Chiffrement…"
  # Symétrique : pas de trousseau à gérer, une seule phrase à conserver hors ligne.
  gpg --batch --yes --symmetric --cipher-algo AES256 \
      --passphrase "$PHRASE" --output "$archive.gpg" "$archive"
  aEnvoyer="$archive.gpg"
else
  echo "[$(date -Is)] ⚠ SMARTFIXX_PHRASE_SECRETE non défini : l'archive part EN CLAIR." >&2
  echo "   Elle contient les bases de vos clients et la clé qui signe les licences." >&2
  aEnvoyer="$archive"
fi

echo "[$(date -Is)] Envoi vers $DESTINATION…"
rclone copy "$aEnvoyer" "$DESTINATION/" --no-traverse

# Purge distante : un stockage qui grossit sans fin finit par coûter plus cher
# que le serveur qu'il protège.
echo "[$(date -Is)] Purge des copies de plus de $GARDER_DISTANT jours…"
rclone delete "$DESTINATION/" --min-age "${GARDER_DISTANT}d" || true

echo "[$(date -Is)] Terminé : $(basename "$aEnvoyer")"

# Contrôle de bon sens : si la copie distante est vide, la sauvegarde n'existe
# pas. Mieux vaut le savoir maintenant que le jour de la panne.
distant=$(rclone size "$DESTINATION/" --json 2>/dev/null | grep -o '"count":[0-9]*' | cut -d: -f2 || echo 0)
echo "[$(date -Is)] $distant fichier(s) sur la destination distante."
[ "${distant:-0}" -gt 0 ] || { echo "AUCUN fichier à destination : la copie n'a pas abouti." >&2; exit 1; }
