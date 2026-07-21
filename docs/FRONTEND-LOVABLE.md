# Refaire le frontend dans Lovable sans rien casser

Vous refaites **tout le design** dans Lovable. Moi je garde le **backend**
(API, base de données, robot d'automatisation Playwright). Ce guide explique
comment les deux se parlent et ce qu'il ne faut **pas** changer.

## Le principe

```
┌─────────────────────────┐         HTTP (JSON)          ┌──────────────────────────┐
│  FRONTEND (Lovable)      │  ───────────────────────►    │  BACKEND (Node/Express)  │
│  votre nouveau design    │   GET/POST /api/...          │  API + SQLite + Playwright│
│  React / Vite            │  ◄───────────────────────    │  crée les comptes         │
└─────────────────────────┘                              └──────────────────────────┘
```

- Le frontend Lovable **n'a pas** de base de données ni de robot : il **appelle
  l'API** du backend pour tout (liste des apps, formulaires, envoi, suivi, admin).
- Le backend ne s'occupe plus de l'affichage : il expose seulement l'API
  (documentée dans **`docs/API.md`**) et exécute le robot.

## Ce que VOUS faites dans Lovable

1. Construisez l'UI que vous voulez : accueil, page de demande, page de suivi,
   connexion admin, tableau de bord. Design 100 % libre.
2. Pour chaque donnée, appelez l'API. **Ne codez pas les données en dur** :
   - Cartes d'accueil → `GET /api/apps`
   - Formulaire d'une app → `GET /api/apps/:id/schema` puis **générez les champs
     à partir du schéma** (fortement recommandé : ajouter une app ou un champ
     ne demandera aucune retouche du frontend).
   - Envoi → `POST /api/apps/:id/requests`
   - Suivi → `GET /api/requests/:reference`
   - Admin → `POST /api/auth/login`, `GET /api/admin/stats`,
     `GET /api/admin/requests`, etc.
3. Mettez l'URL du backend dans une **variable d'environnement** Lovable
   (ex. `VITE_API_BASE = https://mon-backend…`). Ne l'écrivez jamais en dur.

## Ce que JE gère (backend)

- Les applications et leurs formulaires (`src/apps/<app>/config.js`).
- La validation, l'enregistrement des demandes, les statistiques.
- Le robot Playwright qui crée réellement les comptes (BlueKanGo calibré, etc.).
- L'authentification de l'admin, les captures d'écran, les relances.

## Les règles pour ne rien casser

À respecter côté Lovable (voir `docs/API.md` pour le détail) :

1. **Les noms de champs** renvoyés par le schéma (`nom`, `email`,
   `etablissement`, `fonction`, `_demandeur_nom`…) doivent être renvoyés
   **tels quels** dans le POST. Ne les renommez pas.
2. **Les valeurs de statut** sont figées : `en_attente`, `en_cours`,
   `terminee`, `echec`. Basez badges/timeline/filtres là-dessus.
3. **Les `checkboxes` sont des tableaux** ; les autres champs des chaînes.
4. **N'inventez pas de routes** : utilisez celles de `docs/API.md`. Si vous
   avez besoin d'une donnée qui n'existe pas, demandez-moi, je l'ajoute côté API.
5. Pour l'admin cross-domaine, utilisez le **jeton Bearer** renvoyé au login
   (en-tête `Authorization: Bearer <token>`) — plus simple que les cookies
   entre deux domaines.

## Connecter les deux (une seule fois)

Côté backend, dans `.env` :
```
ALLOWED_ORIGINS=https://votre-app.lovable.app,https://votre-domaine.fr
```
(liste des domaines Lovable/production autorisés à appeler l'API). C'est tout :
le CORS est déjà géré, l'API renvoie les bons en-têtes.

## Où héberger le backend

Le backend a besoin de Node + Chromium (Playwright), donc **pas** sur Lovable.
Options : votre PC / un serveur interne ADEF / un hébergeur Node (Railway,
Render, Fly.io, un VPS). Une fois en ligne, mettez son URL dans
`VITE_API_BASE` côté Lovable et dans `ALLOWED_ORIGINS` côté backend.

## Pendant le développement (frontend et backend séparés en local)

- Backend : `npm start` → `http://localhost:3000`
- Dans `.env` : `ALLOWED_ORIGINS=http://localhost:5173` (le port de Lovable/Vite
  en local, à adapter).
- Frontend Lovable : `VITE_API_BASE=http://localhost:3000`.

Vous pouvez tester chaque endpoint sans frontend, par exemple :
```bash
curl http://localhost:3000/api/apps
curl http://localhost:3000/api/apps/bluekango/schema
```

---

En résumé : **tout ce qui est visuel = vous (Lovable)** ; **tout ce qui est
données, logique, robot = moi (backend)**. Le point de rencontre est
`docs/API.md`. Respectez-le et rien ne casse.
