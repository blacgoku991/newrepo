'use strict';

/**
 * Boîte à outils commune aux scénarios d'automatisation.
 *
 * Deux modes de fonctionnement :
 *
 *  - MODE SIMULATION (par défaut) : aucun identifiant administrateur n'est
 *    configuré, le bot déroule le scénario "à blanc" et journalise chaque
 *    étape. Idéal pour la démonstration et le développement.
 *
 *  - MODE RÉEL : dès que les variables d'environnement de l'application sont
 *    renseignées (URL + identifiants admin, voir .env.example), le scénario
 *    Playwright pilote réellement le navigateur pour créer le compte.
 */

const SIMULATION = String(process.env.SIMULATION_MODE || 'true') !== 'false';

function isSimulation(requiredEnvVars = []) {
  if (SIMULATION) return true;
  return requiredEnvVars.some((name) => !process.env[name]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Déroule un scénario en mode simulation : journalise chaque étape avec un petit délai réaliste. */
async function simulateSteps(log, steps) {
  for (const step of steps) {
    await sleep(400 + Math.random() * 600);
    log(step);
  }
}

/** Lance un navigateur Chromium headless via Playwright (mode réel uniquement). */
async function launchBrowser() {
  const { chromium } = require('playwright');
  // CHROMIUM_PATH permet d'utiliser un Chromium déjà installé sur la machine
  // au lieu de celui téléchargé par `npx playwright install`.
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  return chromium.launch({ headless: true, executablePath });
}

module.exports = { isSimulation, simulateSteps, launchBrowser, sleep };
