'use strict';

/**
 * Chargement du fichier `.env` (à la racine du projet) dans process.env.
 *
 * Léger, sans dépendance externe. Une variable déjà présente dans
 * l'environnement (ligne de commande, système) n'est PAS écrasée par le .env.
 * Si le fichier n'existe pas, on ne fait rien : l'application utilise
 * l'environnement tel quel (utile en conteneur / CI).
 */

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const file = process.env.ENV_FILE || path.join(__dirname, '..', '.env');
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return; // pas de .env : rien à charger
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key) continue;

    let value = line.slice(eq + 1).trim();
    // Retire une éventuelle paire de guillemets englobants.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  }
}

module.exports = { loadEnv };
