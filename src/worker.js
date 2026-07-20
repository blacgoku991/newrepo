'use strict';

/**
 * Worker de traitement des demandes.
 *
 * File d'attente simple : toutes les POLL_INTERVAL ms, le worker prend la plus
 * ancienne demande "en_attente", charge le scénario d'automatisation de
 * l'application concernée et l'exécute. Une seule demande à la fois — les
 * scénarios pilotent un navigateur, inutile de les paralléliser.
 */

const db = require('./db');
const registry = require('./registry');

const POLL_INTERVAL = Number(process.env.WORKER_POLL_MS || 3000);
const TIMEOUT_MS = Number(process.env.WORKER_TIMEOUT_MS || 180000);

let busy = false;

async function processOne(request) {
  const app = registry.getAvailable(request.app_id);
  const logs = [];
  const log = (message) => {
    logs.push({ at: new Date().toISOString(), message });
    console.log(`[worker] [${request.reference}] ${message}`);
  };

  db.markProcessing(request.id);
  log(`Prise en charge de la demande (tentative n°${request.attempts + 1})`);

  if (!app) {
    db.markFinished(request.id, false, `Application inconnue ou indisponible : ${request.app_id}`, logs);
    return;
  }

  const data = JSON.parse(request.payload);

  try {
    const result = await Promise.race([
      app.automation.createAccount(data, { log, reference: request.reference }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Délai maximum dépassé (timeout)')), TIMEOUT_MS)
      ),
    ]);

    if (result && result.success) {
      log('Compte créé avec succès');
      db.markFinished(request.id, true, result.message || 'Compte créé avec succès', logs);
    } else {
      const msg = (result && result.message) || 'Le scénario a signalé un échec';
      log(`Échec : ${msg}`);
      db.markFinished(request.id, false, msg, logs);
    }
  } catch (err) {
    log(`Erreur : ${err.message}`);
    db.markFinished(request.id, false, `Erreur pendant l'automatisation : ${err.message}`, logs);
  }
}

async function tick() {
  if (busy) return;
  const request = db.nextPending();
  if (!request) return;
  busy = true;
  try {
    await processOne(request);
  } finally {
    busy = false;
  }
}

function start() {
  setInterval(tick, POLL_INTERVAL).unref();
  console.log(`[worker] Démarré (intervalle ${POLL_INTERVAL} ms)`);
}

module.exports = { start };
