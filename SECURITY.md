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
  Le paramètre `next` n'accepte qu'un chemin local (anti open-redirect).

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
3. `ADMIN_COOKIE_SECURE=true` et `COOKIE_SECURE=true` (cookies réservés à HTTPS).
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
| `tenant` (défaut) | toute personne du tenant Microsoft 365 | tous les établissements |
| `attribut` | les comptes dont le jeton porte l'attribut de `ACCES_ATTRIBUT` | tous les établissements |
| `liste` | les référents déclarés dans le panneau | leurs établissements |

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
  à décider, aucune purge automatique aujourd'hui.
