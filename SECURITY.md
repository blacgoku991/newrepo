# Sécurité du Portail Comptes

Audit réalisé sur l'ensemble du code (frontend + backend), avec les protections
mises en place et la checklist de mise en production.

## Protections en place

### Authentification & sessions
- **Mots de passe admin hachés avec scrypt** (sel aléatoire par compte), comparaison
  à temps constant (`timingSafeEqual`). Jamais stockés ni journalisés en clair.
- **Anti-énumération** : la vérification prend le même temps que l'identifiant
  existe ou non (comparaison factice), et le message d'erreur est identique.
- **Sessions par cookie `HttpOnly` + `SameSite`** (jeton aléatoire 256 bits stocké
  en base, expiration côté serveur, purge au démarrage). Aucun jeton en
  `localStorage`.
- **Mot de passe admin : 8 caractères minimum** ; alerte dans Réglages si le
  compte « admin » utilise encore le mot de passe par défaut.
- **SSO Microsoft 365** : OpenID Connect « authorization code » + **PKCE (S256)**,
  `state` et `nonce` aléatoires à usage unique (10 min), vérification de
  l'audience, de l'émetteur, de l'expiration et du nonce du jeton. L'échange du
  code se fait exclusivement côté serveur, en TLS direct avec Microsoft.
  Le paramètre `next` n'accepte qu'un chemin local (anti open-redirect) : ni
  schéma, ni hôte, ni antislash — que les navigateurs lisent comme une barre
  oblique —, ni caractère de contrôle.

### Anti brute-force & anti-abus (rate limiting par IP)
- Connexion admin : 10 tentatives / 15 min (compteur remis à zéro en cas de succès).
- SSO (login + callback) : 30 / 10 min.
- Dépôt de demandes : 60 / 10 min (large pour les lots multi-comptes).
- Suivi par référence : 120 / 10 min (anti-énumération de références — les
  références sont par ailleurs aléatoires et non séquentielles).
- Chaque tentative de connexion (réussie **ou échouée**) est tracée au journal
  avec l'adresse IP.

### Anti-CSRF & CORS
- Toute requête modifiante venant d'un navigateur dont l'en-tête `Origin` ne
  correspond ni à l'hôte du portail ni aux origines `ALLOWED_ORIGINS` est
  rejetée (403).
- CORS fermé par défaut (`ALLOWED_ORIGINS` vide = même origine uniquement).
- Cookies `SameSite=Lax` par défaut.

### En-têtes de sécurité (toutes les réponses)
- `Content-Security-Policy` stricte : **aucun script inline autorisé**
  (tous les scripts du projet sont des fichiers externes), pas de frame,
  pas d'objet, formulaires limités au portail + login.microsoftonline.com.
- `X-Frame-Options: DENY` (anti-clickjacking), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
  (caméra/micro/géoloc désactivés), `Strict-Transport-Security` en HTTPS.
- `X-Powered-By` supprimé.

### Injections
- **SQL** : 100 % des requêtes utilisent des paramètres préparés (better-sqlite3),
  aucune concaténation.
- **XSS** : tout contenu dynamique passe par `escapeHtml()` côté frontend, y
  compris les noms/types de champs de formulaire (pourtant déjà validés côté
  serveur par liste blanche `[a-z0-9_]`), avec la CSP en filet de sécurité.
- **Traversée de chemin** : les noms de fichiers (`/img/:name`) sont filtrés
  sur liste blanche de caractères ; les artefacts sont servis par
  `express.static` (protégé) derrière l'authentification admin.
- Corps JSON limité à 100 ko ; champs limités à 500 caractères ; valeurs des
  listes/radios validées contre les options déclarées.

### Secrets & données sensibles
- Aucun identifiant d'application métier (BlueKanGo, etc.) dans le code : tout
  vient de variables d'environnement (`.env`, non versionné).
- Le mot de passe initial des comptes créés n'est **jamais** stocké dans la
  table des demandes ; il n'apparaît que dans l'e-mail d'identifiants
  (boîte d'envoi visible des seuls admins) et impose un changement au premier
  login.
- Les messages d'erreur serveur sont génériques (pas de stack trace exposée).

## Checklist de mise en production

1. **HTTPS obligatoire** : placer le portail derrière un reverse proxy TLS
   (nginx/Caddy/IIS) — un bandeau d'alerte s'affiche dans Réglages sinon.
2. `ADMIN_PASSWORD` fort dès le premier démarrage, puis rotation régulière.
   Ne jamais laisser « admin/admin » (alerte affichée dans Réglages).
3. Rien à faire pour les cookies : le drapeau `Secure` est posé dès que la
   requête arrive en HTTPS, y compris quand le chiffrement s'arrête au reverse
   proxy (`X-Forwarded-Proto`). `ADMIN_COOKIE_SECURE` / `COOKIE_SECURE` ne
   servent plus qu'à le forcer dans un montage particulier.
4. **Activer le SSO Microsoft 365** (`M365_*`) pour restreindre le site public
   au personnel ADEF ; garder `SSO_REQUIRED=true`.
5. `ALLOWED_ORIGINS` : laisser vide sauf frontend externe réellement utilisé.
6. SMTP : utiliser un compte d'envoi dédié avec mot de passe d'application.
7. Sauvegarder `data/portail.db` (demandes, comptes créés, journal) et
   restreindre les droits de lecture du fichier `.env` (`chmod 600`).
8. Mettre à jour les dépendances régulièrement (`npm audit`).

## Limites connues (assumées et documentées)

- La signature du jeton SSO n'est pas re-vérifiée par JWKS : le jeton est reçu
  directement de Microsoft via TLS dans le flux code serveur, ce qui rend la
  falsification impossible sans compromettre TLS lui-même. Les revendications
  critiques (aud, iss, exp, nonce) sont vérifiées.
- Le rate limiting est en mémoire : il repart de zéro au redémarrage du
  serveur (suffisant pour un déploiement mono-instance).
- La console de démonstration `/demo` (comptes factices, identifiants de démo
  publics) est nécessaire au mode démo du robot ; elle ne touche à aucune
  donnée réelle.

---

## Audit du 25 juillet 2026

Audit complet (backend, frontend, robots, licence, dépendances) : voir
`docs/AUDIT-2026-07-25.md`. Deux failles réelles corrigées — un référent
pouvait viser le compte de service du robot (donc prendre la main sur
l'application métier), et le détail d'une demande était lisible par tout
compte du tenant. 48 tentatives d'attaque rejouables, toutes bloquées.

### Qui a accès au portail (`ACCES_PORTAIL`)

La porte d'entrée reste le SSO Microsoft 365 : sans session valide, aucune API
métier ne répond. Ce que « être habilité » signifie ensuite se règle :

| Valeur | Qui entre | Portée |
|---|---|---|
| `liste` (défaut) | les référents déclarés dans le panneau | leurs établissements |
| `attribut` | les comptes dont le jeton porte l'attribut de `ACCES_ATTRIBUT` | tous les établissements |
| `tenant` | toute personne du tenant Microsoft 365 | tous les établissements |

Les attributs interrogeables sont ceux du jeton, plus — si
`M365_GRAPH_ATTRIBUTS=true` — ceux lus via Microsoft Graph juste après la
connexion : attributs personnalisés Exchange (`extensionAttribute1` à `15`),
`department`, `jobTitle`, `employeeId`, `officeLocation`, `companyName`. Cet
appel utilise les identifiants de l'application (permission **d'application**
`User.Read.All`, consentement administrateur) ; il ne lit que ces champs, ne
les écrit jamais, et une panne Graph n'empêche pas de se connecter. Les
revendications purement techniques (`sid`, `ipaddr`, `amr`…) sont refusées
comme critère : elles changent à chaque connexion.

Dans tous les modes : une **fiche référent l'emporte** (elle limite la personne
à ses établissements), une fiche **désactivée est un refus** que la politique ne
contourne pas, et la **remise d'un mot de passe** (lien à usage unique) reste
réservée au demandeur, au bénéficiaire, à un référent nommément déclaré sur
l'établissement, ou à un administrateur — la portée « tous les établissements »
accordée par la politique ne l'ouvre pas.

En mode `tenant`, un membre du tenant peut lire le détail des demandes du
groupe (nom du bénéficiaire, identifiant, établissement) : c'est la contrepartie
assumée d'un portail ouvert à toute l'organisation. Passer à `attribut` ou
`liste` referme ce périmètre.

Deux réglages d'exploitation en découlent :

- `<APP>_PROTECTED_LOGINS` : comptes techniques du client à sanctuariser, en
  plus du compte d'administration du robot (déjà protégé d'office) ;
- durée de conservation des captures d'écran des robots (`data/artifacts/`) :
  **1 jour**, purgé automatiquement (`RETENTION_CAPTURES_JOURS`).

---

## Audit du 29 juillet 2026

Passe complète sur l'hébergement SaaS (front door, orchestrateur, panel,
portails) après l'ajout de la supervision et des sauvegardes. Analyse statique
avec des règles écrites pour ce dépôt — le registre public de Semgrep est
inaccessible depuis cet environnement (refus de la politique de sortie) —, puis
revue manuelle et tentatives d'attaque rejouables
(`scratchpad/audit-2026.js`, section 11 de `scratchpad/saas-complet.js`).

### Cinq défauts réels, tous corrigés

**1. Cookies de session sans `Secure` en hébergement.** Le drapeau dépendait de
`COOKIE_SECURE` / `ADMIN_COOKIE_SECURE`, variables que l'orchestrateur ne posait
pas. Sur `https://<client>.smartfixx.fr`, la session Microsoft 365 d'un référent
et celle d'un administrateur partaient donc **sans `Secure`** : un seul lien
`http://` suivi depuis ce navigateur suffisait à les émettre en clair. Le
drapeau est désormais déduit de la requête (`req.secure` ou
`X-Forwarded-Proto: https`), comme le faisait déjà le panel.

**2. Redirection ouverte sur la porte SSO.** Le paramètre `?next=` était
accepté dès lors qu'il commençait par une barre oblique sans être suivi d'une
seconde. Or les navigateurs lisent l'antislash comme une barre oblique :
`/\evil.fr` passait le contrôle et valait `//evil.fr`, donc un autre site. Le
lien partait de notre domaine, la victime s'authentifiait réellement, et
atterrissait ailleurs — le montage type d'un hameçonnage. La cible est
maintenant réduite par `cibleLocale()`, qui n'accepte qu'un chemin sans schéma,
sans hôte, sans antislash et sans caractère de contrôle.

**3. `X-Forwarded-For` interprété à l'envers.** La porte d'entrée transmettait
aux portails la chaîne envoyée par le visiteur **suivie** de l'adresse réelle,
et les portails en lisaient la première valeur — c'est-à-dire celle écrite par
le visiteur. En la faisant varier à chaque requête, on échappait à toute
limitation de débit (force brute sur la connexion administrateur, sur les liens
d'identifiants) et l'on signait le journal d'activité de l'adresse de son
choix. Désormais : la porte d'entrée lit `X-Real-IP` — que nginx *remplace*, là
où il *ajoute* à `X-Forwarded-For` — et **réécrit** les deux en-têtes avant de
relayer ; les portails ne les croient que venant de la boucle locale, et
seulement si la valeur a la forme d'une adresse.

**4. Toutes les requêtes vues comme locales.** Corollaire du précédent :
`TRUST_PROXY` n'étant pas transmis aux portails, ils voyaient chaque visiteur
arriver de `127.0.0.1`. Tout le monde partageait donc un seul compteur de
limitation — une personne pouvait bloquer la connexion de tous les autres — et
le journal ne retenait plus aucune adresse exploitable. L'orchestrateur pose
maintenant `TRUST_PROXY=true`.

**5. Le mot de passe généré au démarrage, lisible depuis le panel.** Un portail
sans `ADMIN_PASSWORD` en crée un et l'annonce sur sa sortie standard. Le journal
d'instance ajouté ce jour-là le retenait tel quel : un mot de passe « affiché
une seule fois » redevenait consultable à volonté. Les lignes retenues sont
maintenant expurgées (jetons isolés, adresses e-mail, longs numéros, valeurs
suivant « mot de passe : »).

### Deux durcissements sans faille avérée

- **Références de demande** tirées de `Math.random()`, remplacées par
  `crypto.randomBytes` sur un alphabet sans caractères confondables (`I`, `O`,
  `0`, `1`). La référence n'est pas le seul verrou — l'habilitation est vérifiée
  derrière — mais une clé de recherche se doit d'être imprévisible.
- **Plus aucune requête vers un tiers.** Les polices venaient de Google Fonts et
  les logos des éditeurs de `app.bluekango.com` et `adef.netsoins.com` : chaque
  page ouverte signalait la visite d'un salarié à trois sociétés extérieures,
  sans base légale, et l'adresse NetSoins était celle d'un client pour tous les
  autres. Tout est servi par le portail, et la CSP n'autorise plus aucune
  origine externe.

### Vérifié sans rien trouver

Injections SQL (requêtes paramétrées partout ; les seules interpolations sont
des littéraux internes et des séries de `?`), traversée de répertoire
(sauvegardes, logos, `/img/:name`, archives), injection de commande
(`tar` lancé sans shell, arguments séparés), XSS (CSP stricte sans script en
ligne, `escapeHtml()` sur tout contenu dynamique), CSRF (contrôle d'origine),
hachage et comparaison des mots de passe (scrypt + `timingSafeEqual`),
téléversement de logo (format reconnu aux octets, SVG refusé, nom reconstruit),
cloisonnement entre sociétés (8 familles d'attaque), et fermeture par défaut du
portail (liste blanche).

### Reste ouvert

- Les sauvegardes doivent être **recopiées hors du serveur** : la copie
  quotidienne existe, son transfert vers un stockage distant reste à mettre en
  place côté système.

---

## Conservation et données personnelles

Voir `docs/RGPD.md` — fiche de registre, durées de conservation, mesures
techniques, droits des personnes, procédure de violation.

Les captures d'écran des robots, longtemps citées ici comme le premier risque du
projet, sont **purgées au bout d'un jour** : elles photographient des écrans
d'application de santé et ne servent qu'au diagnostic immédiat d'un échec. La
purge passe au démarrage puis toutes les six heures, efface le dossier entier
(une référence seule en dit déjà trop) et vide la liste des captures de la
demande pour ne pas laisser de liens morts.

Les autres durées — demandes, journal, registre des comptes, e-mails, liens —
sont déclarées dans `src/retention.js` et affichées telles quelles sur la page de
mentions légales et dans l'administration : **ce qui est annoncé est ce qui est
appliqué**, il n'y a pas deux sources.
