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

function publicList() {
  return [...apps.values()]
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
  return apps.get(id) || null;
}

function getAvailable(id) {
  const app = apps.get(id);
  if (!app || app.config.comingSoon) return null;
  return app;
}

module.exports = { publicList, get, getAvailable };
