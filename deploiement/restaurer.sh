#!/usr/bin/env bash
#
# Restauration d'une sauvegarde Smartfixx.
#
# Une sauvegarde jamais restaurée n'est pas une sauvegarde : c'est une
# hypothèse. Ce script existe pour qu'on l'ait vérifiée AVANT d'en avoir besoin,
# et pour que le jour où il faut l'utiliser, on n'ait pas à réfléchir.
#
#   sudo ./restaurer.sh --lister
#   sudo ./restaurer.sh --essai 2026-07-29-03-00-00      (dans un dossier à part)
#   sudo ./restaurer.sh --pour-de-vrai 2026-07-29-03-00-00
#
set -euo pipefail

UTILISATEUR="${SMARTFIXX_UTILISATEUR:-smartfixx}"
MAISON="$(getent passwd "$UTILISATEUR" 2>/dev/null | cut -d: -f6 || echo "/home/$UTILISATEUR")"
DOSSIER="${SMARTFIXX_DIR:-$MAISON/.smartfixx}"
SAUVEGARDES="${SMARTFIXX_SAUVEGARDES:-$DOSSIER/sauvegardes}"
SERVICE="${SMARTFIXX_SERVICE:-smartfixx}"

rouge() { printf '\033[31m%s\033[0m\n' "$*"; }
vert()  { printf '\033[32m%s\033[0m\n' "$*"; }
gris()  { printf '\033[90m%s\033[0m\n' "$*"; }

usage() {
  cat <<'FIN'
Restauration Smartfixx

  --lister                  Sauvegardes disponibles, de la plus récente à la plus ancienne
  --essai <nom>             Restaure dans un dossier temporaire et vérifie que les bases
                            s'ouvrent. NE TOUCHE À RIEN. C'est l'exercice à faire une fois
                            par trimestre.
  --pour-de-vrai <nom>      Arrête le service, met de côté l'installation actuelle,
                            restaure, redémarre.
  --depuis <archive.tar.gz> Restaure depuis une archive téléchargée plutôt que depuis
                            le dossier local (cas d'une machine neuve).

Variables : SMARTFIXX_UTILISATEUR, SMARTFIXX_DIR, SMARTFIXX_SAUVEGARDES, SMARTFIXX_SERVICE
FIN
}

lister() {
  [ -d "$SAUVEGARDES" ] || { rouge "Aucun dossier de sauvegardes : $SAUVEGARDES"; exit 1; }
  echo
  printf '%-24s %10s  %s\n' "SAUVEGARDE" "TAILLE" "CONTENU"
  for d in $(ls -1 "$SAUVEGARDES" | sort -r); do
    [ -d "$SAUVEGARDES/$d" ] || continue
    taille=$(du -sh "$SAUVEGARDES/$d" | cut -f1)
    bases=$(find "$SAUVEGARDES/$d" -name '*.db' | wc -l)
    cle=$([ -f "$SAUVEGARDES/$d/cle-privee.pem" ] && echo "clé ✓" || echo "clé ✗")
    printf '%-24s %10s  %s base(s), %s\n' "$d" "$taille" "$bases" "$cle"
  done
  echo
  gris "Une sauvegarde SANS la clé privée ne permet pas de réémettre de licence."
}

essai() {
  local nom="$1"
  local source="$SAUVEGARDES/$nom"
  [ -d "$source" ] || { rouge "Sauvegarde introuvable : $source"; exit 1; }

  # Pas de `local` : le piège de nettoyage s'exécute à la sortie du SCRIPT,
  # donc hors de cette fonction, où une variable locale n'existe plus.
  cible=$(mktemp -d)
  trap "rm -rf '$cible'" EXIT
  cp -a "$source/." "$cible/"

  gris "Essai de restauration dans $cible (rien n'est modifié sur l'installation en service)"
  # La vérification passe par le moteur SQLite du projet, pas par l'outil
  # `sqlite3` en ligne de commande : un serveur qui fait tourner Smartfixx a
  # forcément le premier, pas forcément le second — et un contrôle qui ne
  # s'exécute pas ne contrôle rien.
  node "$(dirname "$0")/verifier-sauvegarde.js" "$cible"
}

pour_de_vrai() {
  local nom="$1"
  local source="$SAUVEGARDES/$nom"
  [ -d "$source" ] || { rouge "Sauvegarde introuvable : $source"; exit 1; }
  [ "$(id -u)" -eq 0 ] || { rouge "À lancer avec sudo."; exit 1; }

  echo
  rouge "Cette opération REMPLACE l'installation en service par la sauvegarde $nom."
  read -r -p "Tapez le nom de la sauvegarde pour confirmer : " confirmation
  [ "$confirmation" = "$nom" ] || { rouge "Annulé."; exit 1; }

  gris "Arrêt du service…"
  systemctl stop "$SERVICE" 2>/dev/null || true

  # L'installation actuelle est mise de côté, jamais écrasée : si la sauvegarde
  # se révélait incomplète, on serait sans rien du tout.
  local mise_de_cote="$DOSSIER.avant-restauration-$(date +%Y%m%d-%H%M%S)"
  if [ -d "$DOSSIER" ]; then
    gris "Mise de côté de l'installation actuelle dans $mise_de_cote"
    mv "$DOSSIER" "$mise_de_cote"
  fi

  mkdir -p "$DOSSIER"
  cp -a "$source/smartfixx.db" "$DOSSIER/" 2>/dev/null || true
  cp -a "$source/cle-privee.pem" "$DOSSIER/" 2>/dev/null || true
  cp -a "$source/secret.key" "$DOSSIER/" 2>/dev/null || true
  if [ -d "$source/instances" ]; then
    mkdir -p "$DOSSIER/instances"
    cp -a "$source/instances/." "$DOSSIER/instances/"
  fi
  # Les sauvegardes elles-mêmes ne sont pas dans l'archive : on remet en place
  # celles qu'on avait, sinon on repart sans historique.
  [ -d "$mise_de_cote/sauvegardes" ] && cp -a "$mise_de_cote/sauvegardes" "$DOSSIER/"

  chown -R "$UTILISATEUR":"$UTILISATEUR" "$DOSSIER"
  chmod 700 "$DOSSIER"
  find "$DOSSIER" -name '*.pem' -o -name 'secret.key' | xargs -r chmod 600

  gris "Redémarrage du service…"
  systemctl start "$SERVICE" 2>/dev/null || true
  sleep 3
  systemctl is-active --quiet "$SERVICE" && vert "Service redémarré." || rouge "Le service n'a pas redémarré : journalctl -u $SERVICE -n 50"
  echo
  vert "Restauré depuis $nom."
  gris "L'installation précédente est conservée dans $mise_de_cote — supprimez-la une fois rassuré."
}

depuis_archive() {
  local archive="$1"
  [ -f "$archive" ] || { rouge "Archive introuvable : $archive"; exit 1; }
  mkdir -p "$SAUVEGARDES"
  gris "Extraction de $archive dans $SAUVEGARDES…"
  tar -xzf "$archive" -C "$SAUVEGARDES"
  vert "Extrait. Lancez ensuite --essai puis --pour-de-vrai avec le nom affiché par --lister."
}

case "${1:-}" in
  --lister)       lister ;;
  --essai)        essai "${2:?Indiquez le nom de la sauvegarde}" ;;
  --pour-de-vrai) pour_de_vrai "${2:?Indiquez le nom de la sauvegarde}" ;;
  --depuis)       depuis_archive "${2:?Indiquez le chemin de archive}" ;;
  *)              usage ;;
esac
