# Portail Comptes

Plateforme web de **demandes de création de comptes** sur les applications métiers
(BlueKanGo, NetSoins, ULIS…), avec **création automatisée** des comptes par un
robot Playwright.

Aucune inscription ni connexion n'est demandée à l'utilisateur : il choisit une
application, remplit le formulaire propre à cette application, reçoit une
**référence de suivi**, et le robot crée le compte automatiquement.

## Fonctionnement

```
Utilisateur ──► Formulaire ──► Demande enregistrée (SQLite, statut "en attente")
                                        │
                                        ▼
                              Worker (file d'attente)
                                        │
                                        ▼
                        Scénario Playwright de l'application
                    (connexion admin → saisie → création du compte)
                                        │
                          succès ◄──────┴──────► échec
                       statut "terminée"     statut "échec" (relançable)
```

- **Frontend** : pages statiques (HTML/CSS/JS), formulaires générés
  dynamiquement à partir du schéma de chaque application. Moderne, responsive,
  sans framework.
- **Backend** : Node.js + Express + SQLite (`better-sqlite3`). API REST simple.
- **Automatisation** : worker intégré au serveur qui traite les demandes une par
  une avec Playwright (Chromium headless).

## Démarrage

```bash
npm install
npm start
# → http://localhost:3000
```

Pages :

| URL | Rôle |
|---|---|
| `/` | Accueil — cartes des applications |
| `/demande.html?app=<id>` | Formulaire de demande d'une application |
| `/suivi.html` | Suivi d'une demande par référence (mise à jour auto) |
| `/admin.html` | Tableau de bord : statuts, détail, journal du robot, relance |

## Mode simulation / mode réel

Par défaut (`SIMULATION_MODE=true`), le robot **simule** la création des
comptes : il déroule et journalise chaque étape du scénario sans se connecter
aux vraies applications. La plateforme est ainsi 100 % fonctionnelle de bout en
bout sans identifiants.

Pour passer en réel sur une application :

1. Copier `.env.example` en `.env` et renseigner l'URL + les identifiants
   administrateur de l'application (ex. `BLUEKANGO_URL`, `BLUEKANGO_ADMIN_USER`,
   `BLUEKANGO_ADMIN_PASSWORD`).
2. Mettre `SIMULATION_MODE=false`.
3. Ajuster les sélecteurs Playwright dans `src/apps/<id>/automation.js` sur la
   véritable interface d'administration de votre instance (les scénarios
   fournis sont des squelettes complets à calibrer).

Le mode réel se désactive automatiquement pour toute application dont les
variables d'environnement sont incomplètes.

## Ajouter une nouvelle application

Chaque application est un **plugin autonome** dans `src/apps/<id>/` :

```
src/apps/
├── bluekango/
│   ├── config.js       # métadonnées + schéma du formulaire
│   └── automation.js   # scénario Playwright
├── netsoins/ …
└── ulis/ …
```

1. Créer `src/apps/monapp/config.js` :

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
    sections: [
      {
        title: 'Identité',
        fields: [
          { name: 'nom', label: 'Nom', type: 'text', required: true },
          { name: 'email', label: 'E-mail', type: 'email', required: true },
          // types disponibles : text, email, tel, date, textarea,
          //                     select, radio, checkboxes (avec options: [...])
        ],
      },
    ],
  },
};
```

2. Créer `src/apps/monapp/automation.js` :

```js
const { isSimulation, simulateSteps, launchBrowser } = require('../../automation/helpers');

async function createAccount(data, { log }) {
  if (isSimulation(['MONAPP_URL', 'MONAPP_ADMIN_USER', 'MONAPP_ADMIN_PASSWORD'])) {
    await simulateSteps(log, ['Connexion…', 'Création du compte…']);
    return { success: true, message: 'Compte créé (simulation)' };
  }
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    // … scénario Playwright réel …
    return { success: true, message: 'Compte créé' };
  } finally {
    await browser.close();
  }
}

module.exports = { createAccount };
```

3. Redémarrer le serveur. La carte, le formulaire (validation serveur incluse)
   et le traitement automatisé sont pris en charge sans autre modification.

## API

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/apps` | Liste des applications (cartes) |
| GET | `/api/apps/:id/schema` | Schéma du formulaire d'une application |
| POST | `/api/apps/:id/requests` | Dépôt d'une demande (validée côté serveur) → `{ reference }` |
| GET | `/api/requests/:reference` | Suivi public d'une demande |
| GET | `/api/admin/requests` | Liste complète + statistiques (tableau de bord) |
| POST | `/api/admin/requests/:id/retry` | Relance d'une demande en échec |

## Notes de production

- Les demandes sont stockées dans `data/portail.db` (SQLite, exclu du dépôt).
- Une demande interrompue par un redémarrage repart automatiquement en file.
- **À prévoir avant une mise en production** : protéger `/admin.html` et
  `/api/admin/*` (reverse proxy avec authentification, SSO…), servir en HTTPS,
  et stocker les identifiants admin dans un coffre de secrets.
