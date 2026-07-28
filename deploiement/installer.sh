#!/usr/bin/env bash
#
# Installation de Smartfixx sur un serveur Ubuntu 24.04 neuf.
#
#   sudo bash deploiement/installer.sh
#
# Idempotent : on peut le relancer sans rien casser.
#
# Ce script NE demande et NE contient aucun secret. Le mot de passe du panel
# est tiré au hasard au premier démarrage et affiché dans le journal ; les
# identifiants OVH pour le certificat se posent ensuite, à la main.

set -euo pipefail

DOMAINE="${DOMAINE:-smartfixx.fr}"
DEPOT="${DEPOT:-https://github.com/blacgoku991/newrepo.git}"
BRANCHE="${BRANCHE:-main}"
RACINE="/opt/smartfixx"
UTILISATEUR="smartfixx"

info() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "À lancer en root : sudo bash $0" >&2
  exit 1
fi

# --- 1. Paquets système ------------------------------------------------------
info "Paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git nginx ufw >/dev/null
ok "curl, git, nginx, ufw"

# --- 2. Node 22 --------------------------------------------------------------
info "Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi
ok "$(node -v)"

# --- 3. Compte de service ----------------------------------------------------
info "Compte de service"
if ! id -u "$UTILISATEUR" >/dev/null 2>&1; then
  # Sans shell de connexion : ce compte fait tourner le service, personne
  # ne s'y connecte.
  useradd --system --create-home --home-dir "/home/$UTILISATEUR" \
          --shell /usr/sbin/nologin "$UTILISATEUR"
fi
ok "utilisateur « $UTILISATEUR »"

# --- 4. Code -----------------------------------------------------------------
info "Code du projet"
# Git refuse d'opérer en root sur un dépôt appartenant à quelqu'un d'autre
# (« dubious ownership »). On travaille donc SOUS le compte de service : sans
# cela, une deuxième exécution du script ne mettrait rien à jour.
if [[ -d "$RACINE/.git" ]]; then
  chown -R "$UTILISATEUR:$UTILISATEUR" "$RACINE"
  sudo -u "$UTILISATEUR" git -C "$RACINE" fetch --quiet origin "$BRANCHE"
  sudo -u "$UTILISATEUR" git -C "$RACINE" reset --hard --quiet "origin/$BRANCHE"
else
  rm -rf "$RACINE"
  install -d -o "$UTILISATEUR" -g "$UTILISATEUR" "$RACINE"
  sudo -u "$UTILISATEUR" git clone --quiet --branch "$BRANCHE" "$DEPOT" "$RACINE"
fi
VERSION="$(sudo -u "$UTILISATEUR" git -C "$RACINE" rev-parse --short HEAD)"
ok "$RACINE ($VERSION)"

# --- 5. Dépendances et navigateur -------------------------------------------
info "Dépendances Node et Chromium"
# Chromium est installé dans le dossier du compte de service : c'est lui qui
# lancera les robots.
sudo -u "$UTILISATEUR" bash -lc "cd $RACINE && npm ci --omit=dev --silent"
sudo -u "$UTILISATEUR" bash -lc "cd $RACINE && npx --yes playwright install chromium" >/dev/null
# Les bibliothèques système dont Chromium a besoin (root requis).
(cd "$RACINE" && npx --yes playwright install-deps chromium >/dev/null 2>&1) || true
ok "dépendances et Chromium installés"

# --- 6. Service systemd ------------------------------------------------------
info "Service systemd"
install -m 0644 "$RACINE/deploiement/smartfixx.service" /etc/systemd/system/smartfixx.service
sed -i "s|__DOMAINE__|$DOMAINE|g" /etc/systemd/system/smartfixx.service
systemctl daemon-reload
systemctl enable --now smartfixx >/dev/null
ok "service actif"

# --- 7. nginx ----------------------------------------------------------------
info "nginx"
install -m 0644 "$RACINE/deploiement/nginx-smartfixx.conf" "/etc/nginx/sites-available/smartfixx"
sed -i "s|__DOMAINE__|$DOMAINE|g" "/etc/nginx/sites-available/smartfixx"
ln -sf /etc/nginx/sites-available/smartfixx /etc/nginx/sites-enabled/smartfixx
rm -f /etc/nginx/sites-enabled/default
# Avant d'avoir le certificat, on sert en clair : nginx refuserait de démarrer
# sur un fichier de certificat absent. On écrit alors une configuration
# PROVISOIRE dédiée, plutôt que de charcuter la définitive à coups de sed —
# c'est ce qui produisait deux blocs en écoute sur le port 80 et le message
# « conflicting server name ».
if [[ ! -d "/etc/letsencrypt/live/$DOMAINE" ]]; then
  cat > /etc/nginx/sites-available/smartfixx <<PROVISOIRE
# Configuration PROVISOIRE, en clair, le temps d'obtenir le certificat.
# « activer-tls.sh » la remplace par la version HTTPS définitive.
server {
    listen 80;
    server_name saas.$DOMAINE *.$DOMAINE;

    client_max_body_size 2m;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
PROVISOIRE
fi
nginx -t >/dev/null && systemctl reload nginx
ok "site servi"

# --- 8. Pare-feu -------------------------------------------------------------
info "Pare-feu"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ok "22, 80 et 443 ouverts — le reste fermé"

# --- 9. Ce qu'il reste à faire ----------------------------------------------
cat <<FIN

  ────────────────────────────────────────────────────────────────
  Installation terminée.

  Mot de passe du panel (affiché une seule fois au premier
  démarrage) :

      journalctl -u smartfixx | grep -A2 "mot de passe"

  Certificat TLS générique — il couvre tous les sous-domaines,
  présents et à venir. Il exige la validation par DNS :

      apt install -y python3-certbot-dns-ovh
      # Créer les identifiants sur https://api.ovh.com/createToken/
      # Droits : GET/POST/PUT/DELETE sur /domain/zone/*
      nano /root/.ovh.ini && chmod 600 /root/.ovh.ini

      # Si votre site vitrine reste hébergé ailleurs (cas habituel) :
      certbot certonly --dns-ovh --dns-ovh-credentials /root/.ovh.ini \\
              -d '*.$DOMAINE'

      # S'il est servi par CE serveur, ajoutez le domaine racine :
      #   ... -d '$DOMAINE' -d '*.$DOMAINE'

      bash $RACINE/deploiement/activer-tls.sh

  Rappel DNS : « *.$DOMAINE » ne couvre PAS « $DOMAINE » lui-même.
  Votre site vitrine reste donc intact tant que l'enregistrement
  racine n'est pas modifié.

  Ensuite : https://saas.$DOMAINE
  ────────────────────────────────────────────────────────────────

FIN
