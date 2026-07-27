'use strict';

/**
 * Registre des applications métiers.
 *
 * Chaque application vit dans src/apps/<id>/ avec :
 *   - config.js     : métadonnées + schéma du formulaire (obligatoire)
 *   - automation.js : scénario Playwright de création du compte
 *                     (obligatoire sauf si comingSoon: true)
 *
 * Pour ajouter une application : créer le dossier, écrire les deux fichiers,
 * redémarrer le serveur. Rien d'autre à modifier.
 */

const fs = require('fs');
const path = require('path');

const APPS_DIR = path.join(__dirname, 'apps');

const apps = new Map();

for (const entry of fs.readdirSync(APPS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = path.join(APPS_DIR, entry.name);
  const config = require(path.join(dir, 'config.js'));

  if (config.id !== entry.name) {
    throw new Error(`L'id "${config.id}" ne correspond pas au dossier "${entry.name}"`);
  }

  let automation = null;
  if (!config.comingSoon) {
    automation = require(path.join(dir, 'automation.js'));
    if (typeof automation.createAccount !== 'function') {
      throw new Error(`${entry.name}/automation.js doit exporter createAccount(data, ctx)`);
    }
  }

  apps.set(config.id, { config, automation });
}

/**
 * Applications mises en service, via `APPS_ACTIVES` dans le .env
 * (ex. `APPS_ACTIVES=bluekango,netsoins`). Vide ou absent = toutes.
 *
 * Le dossier `src/apps/` contient tout ce que le portail SAIT faire ; un client
 * n'achète pas forcément tout. Filtrer ici évite de lui montrer des
 * applications qu'il n'utilisera jamais — sur le site comme dans le panneau —
 * sans supprimer de code ni casser les autres déploiements.
 */
function activesConfigurees() {
  const brut = String(process.env.APPS_ACTIVES || '').trim();
  if (!brut) return null;
  const liste = brut.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  return liste.length ? new Set(liste) : null;
}

function estActive(id) {
  const actives = activesConfigurees();
  return !actives || actives.has(String(id).toLowerCase());
}

function publicList() {
  return [...apps.values()]
    .filter(({ config }) => estActive(config.id))
    .map(({ config }) => ({
      id: config.id,
      name: config.name,
      category: config.category,
      description: config.description,
      icon: config.icon,
      logo: config.logo || null,
      color: config.color,
      comingSoon: !!config.comingSoon,
      order: config.order ?? 99,
    }))
    .sort((a, b) => a.order - b.order);
}

function get(id) {
  // Une application désactivée n'existe plus, pour personne : sinon un dépôt
  // resterait possible en visant directement son identifiant dans l'URL.
  if (!estActive(id)) return null;
  return apps.get(id) || null;
}

function getAvailable(id) {
  const app = get(id);
  if (!app || app.config.comingSoon) return null;
  return app;
}

module.exports = { publicList, get, getAvailable, estActive };
