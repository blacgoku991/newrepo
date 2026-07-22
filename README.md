# Portail Comptes

Plateforme web de **demandes de création de comptes** sur les applications
métiers (BlueKanGo, NetSoins, ULIS…), avec **création automatisée** des comptes
par un robot Playwright qui pilote un vrai navigateur.

Aucune inscription ni connexion n'est demandée à l'utilisateur : il choisit une
application, remplit le formulaire dédié (multi-étapes, avec récapitulatif),
reçoit une **référence de suivi**, et le robot crée le compte automatiquement —
captures d'écran de l'exécution à l'appui.

## Fonctionnement

```
Utilisateur ──► Formulaire multi-étapes ──► Demande enregistrée (SQLite, "en attente")
                                                    │
                                                    ▼
                                          Worker (file d'attente)
                                                    │
                                                    ▼
                                 Scénario Playwright de l'application
                        navigateur réel : connexion admin → saisie → création
                        journal pas-à-pas + captures d'écran de preuve/diagnostic
                                                    │
                                      succès ◄──────┴──────► échec
                                   statut "terminée"     statut "échec"
                                                         (capture d'erreur + relance)
```

- **Frontend** : pages statiques (HTML/CSS/JS, police Inter servie localement),
  formulaires multi-étapes générés depuis le schéma de chaque application.
- **Backend** : Node.js + Express + SQLite (`better-sqlite3`). API REST.
- **Automatisation** : moteur de scénarios Playwright (Chromium headless),
  une demande à la fois, captures d'écran archivées par demande.
- **Console démo intégrée** : une fausse interface d'administration par
  application (`/demo/<app>`, identifiants `admin` / `demo123`) sur laquelle le
  robot fait de **vraies** automatisations de bout en bout tant que les vraies
  applications ne sont pas branchées.

## Démarrage

```bash
npm install        # installe aussi Chromium via Playwright (postinstall)
npm start
# → http://localhost:3000
```

Pages :

| URL | Rôle |
|---|---|
| `/` | Accueil — cartes des applications |
| `/demande.html?app=<id>` | Formulaire multi-étapes d'une application |
| `/suivi.html` | Suivi d'une demande par référence (timeline, mise à jour auto) |
| `/login.html` | Connexion à l'espace d'administration (session sécurisée) |
| `/admin.html` | Tableau de bord **protégé** : statistiques, graphiques, demandes, journal du robot, captures, relance |
| `/demo/<app>/login` | Console d'administration de démonstration (cible du robot) |

### Espace d'administration sécurisé

`/admin.html` et les API `/api/admin/*` sont protégés par une **connexion**
(session par cookie httpOnly, mots de passe hachés en scrypt). Le compte
administrateur initial est créé au premier démarrage à partir de
`ADMIN_USERNAME` / `ADMIN_PASSWORD` (voir `.env.example`). Sans mot de passe
défini, un compte `admin` / `admin` est créé — **à changer immédiatement**.

Le tableau de bord affiche : comptes créés, taux de réussite, activité sur
14 jours, répartition par application / établissement / fonction, et
**qui a demandé chaque compte** (le formulaire capture le demandeur).

Le panel d'administration permet aussi, sans toucher au code :

- **Éditeur de formulaires** : modifier libellés/aide/placeholder, rendre un
  champ obligatoire ou non, masquer un champ, **ajouter ses propres champs**
  (surcharges en base, table `form_overrides`). Les champs saisis par le robot
  (`config.robotFields`) sont verrouillés (non supprimables/masquables).
- **Éditeur de scénarios** : voir les étapes du robot par application,
  **modifier un sélecteur** si l'interface cible a changé, **désactiver** une
  étape non critique, **insérer une étape personnalisée** (`scenario_overrides`).
  Les étapes critiques (connexion, enregistrement…) ne sont jamais désactivables.
- **Comptes admin** : créer, changer le mot de passe, activer/désactiver.
- **E-mails d'identifiants** : après création réussie, un e-mail
  (application, identifiant généré, mot de passe initial, référence) est envoyé
  au bénéficiaire/demandeur via SMTP (variables `SMTP_*`), ou déposé dans une
  **boîte d'envoi** consultable dans l'admin si SMTP n'est pas configuré.
  Le mot de passe initial n'est jamais stocké en base — uniquement dans l'e-mail.
- **Réglages** : mode du robot (démo/production), état SMTP, et pour chaque
  application l'état « configuré / non configuré » de ses variables d'environnement.

Toutes les modifications de l'admin sont journalisées (`audit_log`).

## Modes du robot

| Mode | Cible | Activation |
|---|---|---|
| `demo` (défaut) | Console d'administration factice intégrée — vraie automatisation navigateur, comptes réellement créés en base de démo, captures d'écran réelles | rien à faire |
| `production` | Vraies applications métiers | `.env` : `AUTOMATION_MODE=production` + URL et identifiants admin de chaque application |

Une application dont les variables sont incomplètes retombe automatiquement en
mode démo : aucun risque d'appel à moitié configuré vers la production.

**➡ Comment le robot remplit les champs sans API, comment récupérer les
sélecteurs avec `npx playwright codegen`, 2FA, sécurité des identifiants :
voir [docs/AUTOMATISATION.md](docs/AUTOMATISATION.md).**

## Ajouter une nouvelle application

Chaque application est un **plugin autonome** dans `src/apps/<id>/` :

```
src/apps/bluekango/
├── config.js       # métadonnées + schéma du formulaire
├── selectors.js    # sélecteurs de l'interface d'admin (mode production)
└── automation.js   # scénario Playwright (production + bascule démo)
```

1. **`config.js`** — la carte, le formulaire et sa validation :

```js
module.exports = {
  id: 'monapp',            // = nom du dossier
  name: 'Mon Application',
  category: 'Catégorie affichée',
  description: 'Description affichée sur la carte.',
  icon: 'folder',          // shield | heart | folder | clock | chart | users
  color: '#0ea5e9',
  order: 6,
  referencePrefix: 'MAP',
  // comingSoon: true,     // pour n'afficher que la carte "Bientôt disponible"
  formSchema: {
    intro: 'Texte d’introduction du formulaire.',
    sections: [            // 1 section = 1 étape du formulaire
      {
        title: 'Identité',
        fields: [
          { name: 'nom', label: 'Nom', type: 'text', required: true },
          { name: 'email', label: 'E-mail', type: 'email', required: true },
          // types : text, email, tel, date, textarea,
          //         select, radio, checkboxes (avec options: [...])
        ],
      },
    ],
  },
};
```

2. **`automation.js`** — le scénario. Le plus simple est de copier celui de
   `bluekango` : la bascule démo/production et le moteur (journal, captures,
   gestion d'erreur) sont fournis ; il ne reste qu'à décrire les étapes.

3. **`selectors.js`** — les sélecteurs de la vraie application, capturés avec
   `npx playwright codegen` (voir docs/AUTOMATISATION.md).

4. Redémarrer le serveur. Carte, formulaire multi-étapes, validation, console
   démo et traitement automatisé sont pris en charge sans autre modification.

## API

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/apps` | Liste des applications (cartes) |
| GET | `/api/apps/:id/schema` | Schéma du formulaire d'une application |
| POST | `/api/apps/:id/requests` | Dépôt d'une demande (validée serveur) → `{ reference }` |
| GET | `/api/requests/:reference` | Suivi public d'une demande |
| GET | `/api/admin/requests` | Liste complète + statistiques + journaux + captures |
| POST | `/api/admin/requests/:id/retry` | Relance d'une demande en échec |

## Notes de production

- Données dans `data/` (SQLite + captures d'écran), exclu du dépôt.
- Une demande interrompue par un redémarrage repart automatiquement en file.
- **À prévoir avant une mise en production** : protéger `/admin.html`,
  `/api/admin/*` et `/artifacts/*` (reverse proxy avec authentification, SSO…),
  servir en HTTPS, stocker les identifiants admin dans un coffre de secrets,
  et désactiver la console démo (`/demo`) si elle n'est plus utile.
