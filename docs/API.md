# Contrat d'API — Portail Comptes

Ce document est **le contrat entre le frontend (Lovable) et le backend (Node)**.
Tant que le frontend respecte ces routes et ces formats, rien ne casse — vous
pouvez refaire tout le design librement.

- Toutes les routes renvoient du **JSON**.
- Base URL = l'URL où tourne le backend (ex. `http://localhost:3000` en local,
  ou l'URL de votre serveur en ligne). Côté Lovable, mettez-la dans une variable
  d'environnement (ex. `VITE_API_BASE`).
- En cas d'erreur : code HTTP ≥ 400 + `{ "error": "message" }`.

---

## 1. Public (aucune authentification)

### `GET /api/apps`
Liste des applications (pour les cartes de l'accueil).
```json
[
  { "id": "bluekango", "name": "BlueKanGo", "category": "Qualité & Gestion des risques",
    "description": "…", "icon": "shield", "color": "#2563eb",
    "comingSoon": false, "order": 1 }
]
```
- `comingSoon: true` → application « Bientôt disponible » (pas de formulaire).
- `icon` : un identifiant d'icône (shield, heart, folder, clock, chart…). Libre
  au frontend de mapper vers ses propres icônes.

### `GET /api/apps/:id/schema`
Schéma du formulaire d'une application. **C'est ce qui permet de générer les
formulaires dynamiquement** — recommandé plutôt que de coder les champs en dur.
```json
{
  "id": "bluekango", "name": "BlueKanGo", "category": "…",
  "icon": "shield", "color": "#2563eb",
  "schema": {
    "intro": "Texte d'introduction.",
    "sections": [
      {
        "title": "Identité de l'utilisateur",
        "fields": [
          { "name": "civilite", "label": "Civilité", "type": "radio", "required": true,
            "options": [ { "value": "m", "label": "M." }, { "value": "mme", "label": "Mme" } ] },
          { "name": "nom", "label": "Nom", "type": "text", "required": true, "placeholder": "DUPONT" },
          { "name": "email", "label": "E-mail", "type": "email", "required": false,
            "help": "Texte d'aide.", "suggestions": ["…"] }
        ]
      },
      { "title": "Vos coordonnées (demandeur)", "requester": true, "fields": [ … ] }
    ]
  }
}
```
Types de champ possibles : `text`, `email`, `tel`, `date`, `textarea`,
`select`, `radio`, `checkboxes`. Les trois derniers + `select` ont un tableau
`options: [{ value, label }]`. Un champ `text` peut avoir `suggestions: [..]`
(liste de complétion). Contraintes éventuelles : `required`, `pattern`,
`patternMessage`, `maxLength`, `help`, `placeholder`.

⚠️ La **dernière section** a `requester: true` : ce sont les coordonnées du
demandeur (`_demandeur_nom`, `_demandeur_email`). À afficher comme les autres.

### `POST /api/apps/:id/requests`
Envoi d'une demande. Le corps est un objet **plat** `{ nom_du_champ: valeur }`
reprenant **exactement** les `name` du schéma (y compris `_demandeur_nom`).
Les `checkboxes` sont des **tableaux**.
```jsonc
// Requête
{ "civilite": "mme", "nom": "DUPONT", "prenom": "Marie",
  "etablissement": "46", "fonction": "RESPONSABLE HOTELIER (E)",
  "_demandeur_nom": "Achraf Maatoug", "_demandeur_email": "a@adef.fr" }
// Réponse 201
{ "reference": "BKG-260721-AB12" }
// Réponse 422 (validation) — à afficher champ par champ
{ "error": "Formulaire invalide", "fields": { "nom": "Ce champ est obligatoire" } }
```

### `GET /api/requests/:reference`
Suivi public d'une demande (pour la page de suivi + timeline).
```json
{ "reference": "BKG-260721-AB12", "app": "BlueKanGo",
  "status": "terminee", "message": "Compte créé…",
  "createdAt": "2026-07-21 10:05", "finishedAt": "2026-07-21 10:06" }
```
`status` ∈ **`en_attente` | `en_cours` | `terminee` | `echec`** (enum stable —
ne pas inventer d'autres valeurs). Rafraîchir toutes les ~3 s tant que le
statut est `en_attente` ou `en_cours`.

---

## 2. Authentification (espace admin)

### `POST /api/auth/login`  → `{ username, password }`
```json
// 200
{ "token": "…", "user": { "username": "admin", "displayName": "…", "role": "admin" } }
// 401
{ "error": "Identifiant ou mot de passe incorrect" }
```
Deux façons d'être authentifié ensuite (choisissez-en une côté Lovable) :
- **Cookie** (même domaine, ou HTTPS + `ADMIN_COOKIE_SAMESITE=None`) : le login
  pose un cookie httpOnly, envoyez `credentials: 'include'` sur vos `fetch`.
- **Jeton Bearer** (recommandé en cross-domaine) : stockez `token` et envoyez
  l'en-tête `Authorization: Bearer <token>` sur chaque appel admin.

### `GET /api/auth/me`  → 200 `{ user }` si connecté, 401 sinon.
### `POST /api/auth/logout`  → `{ ok: true }`.

---

## 3. Administration (authentification requise)

Toutes ces routes exigent la session (cookie **ou** `Authorization: Bearer`).
Un 401 signifie « renvoyer vers la page de connexion ».

### `GET /api/admin/stats` — pour le tableau de bord
```json
{
  "kpis": { "total": 15, "crees": 15, "en_attente": 0, "en_cours": 0, "echec": 0, "tauxReussite": 100 },
  "parApplication": [ { "appId": "bluekango", "app": "BlueKanGo", "total": 12, "crees": 12, "echec": 0 } ],
  "serie": [ { "date": "2026-07-21", "demandes": 4, "crees": 4 } ],   // 14 jours
  "parEtablissement": [ { "label": "SIEGE", "count": 9 } ],
  "parFonction":     [ { "label": "RESPONSABLE HOTELIER (E)", "count": 8 } ],
  "parDemandeur":    [ { "label": "Achraf Maatoug", "count": 3 } ]     // « qui a créé »
}
```

### `GET /api/admin/requests`
```json
{
  "stats": { "en_attente": 0, "en_cours": 0, "terminee": 15, "echec": 0, "total": 15 },
  "requests": [
    { "id": 12, "reference": "BKG-…", "app": "BlueKanGo", "appId": "bluekango",
      "status": "terminee", "message": "…", "attempts": 1,
      "demandeur": "Achraf Maatoug <a@adef.fr>",
      "payload": { "nom": "DUPONT", "prenom": "Marie", "…": "…" },
      "logs": [ { "at": "2026-07-21T10:05:00Z", "message": "Étape 1/8 — …" } ],
      "artifacts": [ "preuve-creation.png" ],
      "createdAt": "2026-07-21 10:05", "startedAt": "…", "finishedAt": "…" }
  ]
}
```
- `artifacts` = captures d'écran du robot. URL de l'image :
  `GET /artifacts/<reference>/<fichier>` (protégé par session — envoyez le
  cookie/Bearer, ou affichez-les uniquement dans l'admin).

### `POST /api/admin/requests/:id/retry`
Relance une demande en **échec**. `{ ok: true }` ou 409 si elle n'est pas en échec.

---

## Résumé des invariants à ne pas casser

| Invariant | Pourquoi |
|---|---|
| Les `name` des champs du schéma (dont `_demandeur_*`) | Le backend valide et le robot saisit d'après ces noms |
| L'enum de `status` (`en_attente/en_cours/terminee/echec`) | Utilisé partout (badges, timeline, filtres, stats) |
| Les routes et méthodes ci-dessus | Le frontend et le backend s'y accordent |
| `checkboxes` = tableau, autres = chaîne | Validation côté serveur |

Tout le **reste** (couleurs, typo, mise en page, composants, animations…) est
100 % libre côté Lovable.
