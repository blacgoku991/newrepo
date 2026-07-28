#!/usr/bin/env bash
# Bascule nginx sur HTTPS une fois le certificat générique obtenu.
set -euo pipefail
DOMAINE="${DOMAINE:-smartfixx.fr}"
RACINE="/opt/smartfixx"

if [[ ! -d "/etc/letsencrypt/live/$DOMAINE" ]]; then
  echo "Certificat absent pour $DOMAINE — lancez d'abord certbot (voir LISEZ-MOI)." >&2
  exit 1
fi
install -m 0644 "$RACINE/deploiement/nginx-smartfixx.conf" /etc/nginx/sites-available/smartfixx
sed -i "s|__DOMAINE__|$DOMAINE|g" /etc/nginx/sites-available/smartfixx
nginx -t && systemctl reload nginx
echo "HTTPS actif : https://saas.$DOMAINE"
