'use strict';

/**
 * Outils communs de l'automatisation.
 *
 * Deux modes, pilotés par AUTOMATION_MODE :
 *
 *  - "demo" (défaut) : le robot pilote RÉELLEMENT un navigateur Chromium,
 *    mais contre l'application d'administration de démonstration intégrée au
 *    portail (/demo/<app>). Toute la chaîne est identique à la production :
 *    connexion admin, remplissage des champs, création du compte, captures
 *    d'écran. Seule la cible change.
 *
 *  - "production" : le robot cible la vraie application métier. Nécessite les
 *    variables d'environnement de l'application (URL + identifiants admin,
 *    voir .env.example). Si elles sont incomplètes, retombe en mode démo.
 */

function getMode(requiredEnvVars = []) {
  const wanted = String(process.env.AUTOMATION_MODE || 'demo').toLowerCase();
  if (wanted !== 'production') return 'demo';
  const missing = requiredEnvVars.filter((name) => !process.env[name]);
  return missing.length === 0 ? 'production' : 'demo';
}

/** URL de base du portail lui-même (pour l'application de démonstration). */
function portalBaseUrl() {
  return `http://127.0.0.1:${process.env.PORT || 3000}`;
}

/**
 * Lance un navigateur Chromium via Playwright.
 *
 * Par défaut : headless (invisible), pour tourner sur un serveur.
 * Pour VOIR le robot travailler en temps réel sur votre PC, mettez dans le .env :
 *   SHOW_BROWSER=true        → ouvre une vraie fenêtre Chromium
 *   ROBOT_SLOWMO=500         → ralentit chaque action de 500 ms (optionnel)
 * (nécessite un écran : à utiliser en local, pas sur un serveur sans affichage.)
 */
async function launchBrowser() {
  const { chromium } = require('playwright');
  // CHROMIUM_PATH permet d'utiliser un Chromium déjà installé sur la machine
  // au lieu de celui téléchargé par `npx playwright install chromium`.
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  const headless = String(process.env.SHOW_BROWSER || '').toLowerCase() !== 'true';
  const slowMo = Number(process.env.ROBOT_SLOWMO || 0) || 0;
  return chromium.launch({ headless, slowMo, executablePath });
}

/** Le navigateur est-il en mode visible ? (pour l'affichage des logs) */
function browserVisible() {
  return String(process.env.SHOW_BROWSER || '').toLowerCase() === 'true';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { getMode, portalBaseUrl, launchBrowser, browserVisible, sleep };
