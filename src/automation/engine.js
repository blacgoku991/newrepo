'use strict';

/**
 * Moteur d'exécution des scénarios d'automatisation.
 *
 * Un scénario est une liste d'étapes { label, run(page) }. Le moteur :
 *   - lance un Chromium headless (Playwright) ;
 *   - exécute les étapes une à une en les journalisant ;
 *   - capture une preuve d'écran à la fin du scénario, et une capture de
 *     l'état exact de la page en cas d'échec (précieuse pour diagnostiquer
 *     un sélecteur qui a changé sur l'application cible) ;
 *   - range les captures dans data/artifacts/<référence>/ — elles sont
 *     ensuite visibles dans le tableau de bord d'administration.
 */

const fs = require('fs');
const path = require('path');
const dbApi = require('../db');
const { launchBrowser, browserVisible } = require('./helpers');

const STEP_TIMEOUT_MS = Number(process.env.STEP_TIMEOUT_MS || 30000);

async function runScenario({ reference, log, steps, successMessage, onProgress }) {
  const report = (done, label) => {
    if (typeof onProgress === 'function') {
      try { onProgress(done, steps.length, label); } catch { /* la progression est un bonus */ }
    }
  };
  const dir = path.join(dbApi.ARTIFACTS_DIR, reference);
  fs.mkdirSync(dir, { recursive: true });
  const artifacts = [];

  async function capture(page, name) {
    try {
      await page.screenshot({ path: path.join(dir, name), fullPage: true });
      artifacts.push(name);
    } catch {
      // La capture est un bonus : son échec ne doit pas masquer l'erreur réelle.
    }
  }

  log(browserVisible()
    ? 'Lancement du navigateur (Chromium VISIBLE — vous suivez le robot en direct)'
    : 'Lancement du navigateur (Chromium headless)');
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  context.setDefaultTimeout(STEP_TIMEOUT_MS);
  const page = await context.newPage();

  let stepIndex = 0;
  try {
    report(0, 'Démarrage');
    for (const step of steps) {
      stepIndex++;
      log(`Étape ${stepIndex}/${steps.length} — ${step.label}`);
      report(stepIndex - 1, step.label); // étape en cours (pas encore terminée)
      await step.run(page);
      report(stepIndex, step.label); // étape terminée
    }
    await capture(page, 'preuve-creation.png');
    log('Capture de preuve enregistrée');
    return { success: true, message: successMessage, artifacts };
  } catch (err) {
    await capture(page, `echec-etape-${stepIndex}.png`);
    const label = steps[stepIndex - 1] ? steps[stepIndex - 1].label : '?';
    return {
      success: false,
      message: `Échec à l'étape ${stepIndex} (« ${label} ») : ${err.message.split('\n')[0]}`,
      artifacts,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { runScenario, STEP_TIMEOUT_MS };
