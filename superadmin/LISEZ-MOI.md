# Panel Smartfixx — administration du parc clients

Panel privé permettant de gérer les sociétés clientes et leurs licences.
Il ne contient **aucune donnée métier** (ni salarié, ni compte créé) :
seulement le commercial et le contractuel.

## Modèle d'hébergement

**Une instance du portail par société cliente**, toutes sur le serveur OVH.
Chaque société a son processus, sa base et son `.env` — aucune requête ne peut
traverser d'une société à l'autre. C'est ce qui garantit le cloisonnement des
données, y compris de santé.

Le panel, lui, tourne à part et ne parle à aucune instance : il produit les
licences que l'on installe ensuite dans chacune.

```
saas.smartfixx.fr        → ce panel (port 4000)
adef.smartfixx.fr        → instance ADEF (port 3001, base propre)
autreclient.smartfixx.fr → instance suivante (port 3002, base propre)
```

## Démarrage

```bash
npm run panel
```

Au premier lancement :

1. une paire de clés Ed25519 est créée dans `~/.smartfixx/cle-privee.pem` ;
2. la **clé publique** est affichée dans la console — recopiez-la dans
   `src/licence.js` (constante `CLE_PUBLIQUE`) **avant** de compiler la version
   livrée aux clients, sinon aucune licence émise ici ne sera acceptée ;
3. un compte opérateur est créé, avec un mot de passe affiché une seule fois
   (ou celui de `SMARTFIXX_PASSWORD`).

## Réglages

| Variable | Rôle | Défaut |
|---|---|---|
| `SMARTFIXX_PORT` | port d'écoute | `4000` |
| `SMARTFIXX_HOST` | interface d'écoute | `127.0.0.1` |
| `SMARTFIXX_USER` | premier opérateur | `smartfixx` |
| `SMARTFIXX_PASSWORD` | son mot de passe | aléatoire, affiché une fois |
| `SMARTFIXX_DIR` | registre, clé et logos | `~/.smartfixx` |
| `SMARTFIXX_PROXIES` | nombre de reverse proxies devant le panel | `1` |
| `SMARTFIXX_CLE_PRIVEE` | chemin de la clé de signature | `$SMARTFIXX_DIR/cle-privee.pem` |

`SMARTFIXX_HOST` reste sur `127.0.0.1` : le panel n'est jamais exposé
directement. C'est nginx qui écoute en HTTPS et relaie.

## Mise en ligne sur `saas.smartfixx.fr`

nginx, sur le serveur OVH :

```nginx
server {
    listen 443 ssl http2;
    server_name saas.smartfixx.fr;

    ssl_certificate     /etc/letsencrypt/live/saas.smartfixx.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/saas.smartfixx.fr/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        # Indispensable : sans cet en-tête, le panel se croit en clair et
        # n'appose ni le drapeau Secure sur le cookie, ni HSTS.
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name saas.smartfixx.fr;
    return 301 https://$host$request_uri;
}
```

Puis, en service systemd :

```ini
[Unit]
Description=Panel Smartfixx
After=network.target

[Service]
WorkingDirectory=/opt/algonis
ExecStart=/usr/bin/node superadmin/server.js
Environment=SMARTFIXX_PASSWORD=…
Restart=always
User=algonis
UMask=0077

[Install]
WantedBy=multi-user.target
```

### À faire avant d'ouvrir au public

- [ ] Certificat TLS en place (Let's Encrypt) et redirection HTTP → HTTPS.
- [ ] `X-Forwarded-Proto` transmis par nginx (voir ci-dessus).
- [ ] Mot de passe opérateur long et unique.
- [ ] Restreindre l'accès à vos adresses IP dans nginx si possible :
      ce panel n'a aucune raison d'être atteignable depuis le monde entier.
- [ ] **Sauvegarder `~/.smartfixx/`** hors du serveur. Sans la clé privée,
      plus aucune licence ne peut être émise ni renouvelée, pour aucun client.

## Sécurité

- Sessions par cookie `HttpOnly` + `SameSite=Lax`, `Secure` automatique en HTTPS.
- Mots de passe hachés en scrypt, comparaison à temps constant, même durée de
  réponse que l'opérateur existe ou non.
- 10 tentatives de connexion par quart d'heure et par adresse.
- Anti-CSRF par vérification de l'origine ; CSP stricte sans script inline.
- Logos : validés sur leurs **octets réels**, pas sur le type déclaré. SVG
  refusé (il peut porter du script). 512 ko maximum. Servis sous session et
  avec `nosniff`.
- Journal de tous les gestes : émission, révocation, création, logo, connexions
  réussies comme échouées. Aucun jeton de licence n'y est recopié.
- La clé privée vit hors du dépôt, en permissions `600`.

## Ce que la révocation fait — et ne fait pas

Révoquer marque la fin du contrat **dans le registre**. Le jeton déjà installé
chez le client **reste valable jusqu'à sa date de fin** : la vérification se
fait hors ligne, sans nous appeler. C'est le prix de licences qui fonctionnent
même si le client perd sa connexion vers nous.

Pour couper l'accès immédiatement, il faut **arrêter l'instance** de la société.
