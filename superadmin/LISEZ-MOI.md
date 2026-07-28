# Smartfixx — hébergement du parc clients

Un seul programme à lancer. Il sert le panel super-admin, démarre un portail par
société cliente, et aiguille chaque visiteur vers le bon d'après l'adresse
demandée.

```
npm start
```

```
                        ┌──────────────────────────────┐
   *.smartfixx.fr  ───► │  superadmin/index.js  :4000  │
        (nginx)         └──────────────┬───────────────┘
                                       │
              saas.smartfixx.fr ───────┤────► panel super-admin (vous)
              adef.smartfixx.fr ───────┤────► portail ADEF     :3100  base propre
            autre.smartfixx.fr  ───────┘────► portail Autre    :3101  base propre
```

Chaque société a **son processus et sa base**. Aucune requête ne peut traverser
d'une société à l'autre : le cloisonnement est une propriété de l'architecture,
pas une clause `WHERE` qu'on peut oublier une fois. Avec des données de santé,
cette garantie vaut le coût de quelques processus.

---

## Les quatre façons de se connecter

### 1. Vous — super-admin

**https://saas.smartfixx.fr**

Identifiant et mot de passe d'opérateur, créés au premier démarrage. Vous seul y
accédez. C'est ici que vous créez les sociétés, émettez les licences et pilotez
les portails.

### 2. L'administrateur d'une société

**https://adef.smartfixx.fr/admin.html**

Compte local à cette société (identifiant + mot de passe), défini par
`ADMIN_USERNAME` / `ADMIN_PASSWORD` dans le `.env` de son instance. Il voit les
demandes, le journal, les référents et les réglages **de sa société uniquement**
— il ne sait même pas que les autres existent.

### 3. Les référents de la société

**https://adef.smartfixx.fr**

Connexion **Microsoft 365** de leur propre organisation (SSO). Aucun mot de
passe à retenir, aucun compte à créer. Qui a le droit d'entrer se règle par
`ACCES_PORTAIL` dans le `.env` de la société :

| Valeur | Qui entre |
|---|---|
| `tenant` | toute personne du tenant Microsoft 365 de la société |
| `attribut` | ceux dont le compte porte un attribut convenu (Exchange) |
| `liste` | uniquement les référents déclarés dans le panneau d'administration |

### 4. Le bénéficiaire d'un compte

**Aucune connexion.** Il reçoit un e-mail avec un lien à usage unique, valable
7 jours, qui lui montre ses identifiants **une seule fois**. Aucun mot de passe
ne circule en clair dans une boîte mail.

---

## Créer une société, de bout en bout

1. **Panel → Nouvelle société.** Nom, contact, sous-domaine (déduit du nom si
   vous le laissez vide). L'adresse `https://<sous-domaine>.smartfixx.fr` est
   attribuée immédiatement.
2. **Logo** (facultatif) : PNG, JPEG ou WebP, 512 ko maximum. Il s'affichera sur
   le portail de la société.
3. **Émettre une licence.** Le portail de la société **démarre aussitôt** : rien
   à faire sur le serveur, la licence est posée automatiquement.
4. **Renseigner ses réglages** dans
   `~/.smartfixx/instances/<sous-domaine>/.env` — identifiants BlueKanGo et
   NetSoins, SSO Microsoft 365, SMTP — puis **Redémarrer** depuis le panel.

Le portail est en ligne, à son nom, avec « propulsé par Smartfixx » en pied de
page.

### Renouveler

Panel → **Renouveler**. La nouvelle licence part du lendemain de l'échéance en
cours : aucun trou entre les deux. L'ancienne reste valable jusqu'à son terme, et
le portail redémarre pour prendre la nouvelle en compte.

### Couper l'accès

**Archiver** la société : son portail s'arrête et l'adresse renvoie « Portail
fermé ».

Révoquer une licence marque la fin du contrat **au registre**, mais ne coupe
rien : le jeton déjà installé reste valable jusqu'à sa date de fin, puisque sa
vérification est hors ligne. Pour fermer réellement, archivez.

---

## Mise en ligne sur le serveur OVH

### DNS — une seule fois

Un enregistrement **générique** suffit. Vous n'aurez plus jamais à toucher au
DNS en ajoutant une société :

| Type | Nom | Cible |
|---|---|---|
| A | `*` | adresse IP du serveur |

C'est tout. `saas`, `adef`, et toute société future sont couverts.

⚠️ **`*.smartfixx.fr` ne couvre PAS `smartfixx.fr` lui-même.** C'est une bonne
nouvelle : votre site vitrine reste intact tant que l'enregistrement racine
n'est pas modifié. Les enregistrements `MX` (messagerie) ne sont pas non plus
concernés.

Un enregistrement explicite l'emporte toujours sur le générique : si `www` a
déjà le sien, il continue de pointer où il pointait.

Pour servir aussi le site vitrine depuis ce serveur, ajoutez alors `@` et `www`
en `A` vers la même adresse, et un bloc nginx dédié.

### Certificat — une seule fois

Un certificat **générique** couvre tous les sous-domaines présents et à venir.
Il exige la validation par DNS (`--dns-ovh`), la validation par HTTP ne sachant
pas produire de certificat générique :

```bash
# Site vitrine hébergé ailleurs (cas habituel) : le générique suffit.
certbot certonly --dns-ovh \
  --dns-ovh-credentials /root/.ovh.ini \
  -d '*.smartfixx.fr'

# Site vitrine servi par CE serveur : ajouter le domaine racine.
#   ... -d 'smartfixx.fr' -d '*.smartfixx.fr'
```

La validation par DNS pose un enregistrement `TXT` temporaire : elle
fonctionne même si le domaine racine pointe vers un autre hébergeur.

### nginx — une seule fois

```nginx
server {
    listen 443 ssl http2;
    server_name saas.smartfixx.fr *.smartfixx.fr;

    ssl_certificate     /etc/letsencrypt/live/smartfixx.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/smartfixx.fr/privkey.pem;

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        # Indispensable : sans cet en-tête, les portails se croient en clair et
        # n'apposent ni le drapeau Secure sur les cookies, ni HSTS.
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name saas.smartfixx.fr *.smartfixx.fr;
    return 301 https://$host$request_uri;
}
```

### systemd

```ini
[Unit]
Description=Smartfixx
After=network.target

[Service]
WorkingDirectory=/opt/smartfixx
ExecStart=/usr/bin/node superadmin/index.js
Environment=SMARTFIXX_DOMAINE=smartfixx.fr
Environment=SMARTFIXX_PASSWORD=…
Restart=always
User=smartfixx
UMask=0077

[Install]
WantedBy=multi-user.target
```

---

## Réglages

| Variable | Rôle | Défaut |
|---|---|---|
| `SMARTFIXX_DOMAINE` | domaine racine | `smartfixx.fr` |
| `SMARTFIXX_PORT` | port d'écoute | `4000` |
| `SMARTFIXX_HOST` | interface d'écoute | `127.0.0.1` |
| `SMARTFIXX_HOTES_PANEL` | hôtes menant au panel | `saas.…, panel.…, localhost` |
| `SMARTFIXX_USER` | premier opérateur | `smartfixx` |
| `SMARTFIXX_PASSWORD` | son mot de passe | aléatoire, affiché une fois |
| `SMARTFIXX_DIR` | registre, clé, logos, instances | `~/.smartfixx` |
| `SMARTFIXX_PORT_BASE` | premier port attribué aux instances | `3100` |

Les portails n'écoutent que sur `127.0.0.1` : personne ne les atteint sans
passer par le routage.

---

## Ce qu'il faut savoir

**La clé de signature.** Créée au premier démarrage dans
`~/.smartfixx/cle-privee.pem`. La console affiche alors la **clé publique** :
recopiez-la dans `src/licence.js` (constante `CLE_PUBLIQUE`) avant de compiler
la version livrée. **Sauvegardez le fichier hors du serveur** — sans lui, plus
aucune licence ne peut être émise ni renouvelée, pour aucun client.

**Les secrets des clients** (identifiants BlueKanGo, NetSoins, SSO) vivent dans
le `.env` de chaque instance, en permissions `600`. Ils ne transitent jamais par
le panel et ne figurent pas dans son registre.

**Redémarrage automatique.** Une instance qui plante repart seule, avec un délai
croissant. Un arrêt demandé depuis le panel, lui, est respecté.

**Extinction propre.** `Ctrl+C` ou `systemctl stop` prévient les portails, qui
terminent les demandes en cours plutôt que d'abandonner un robot en plein
travail.

## Sécurité du panel

- Le panel n'est servi que sur les hôtes prévus : un `Host` forgé reçoit 404.
- Sessions par cookie `HttpOnly`/`SameSite`, `Secure` automatique en HTTPS.
- Mots de passe en scrypt, comparaison à temps constant, durée de réponse
  identique que le compte existe ou non.
- 10 tentatives de connexion par quart d'heure et par adresse.
- Anti-CSRF par vérification de l'origine ; CSP stricte, aucun script inline.
- Logos validés sur leurs **octets réels**, pas sur le type annoncé. SVG refusé :
  c'est du XML qui peut porter du script. Servis sous session, avec `nosniff`.
- Journal de tout : émission, révocation, création, logo, démarrages, arrêts,
  connexions réussies comme échouées. Aucun jeton de licence n'y est recopié.
