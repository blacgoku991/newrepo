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
const demarches = require('./demarches');
const otp = require('./otp');

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

  // La démarche détermine la fonction du robot à appeler (voir demarches.js).
  const demarche = demarches.get(request.request_type);
  const action = demarche ? app.automation[demarche.action] : null;
  if (!action) {
    db.markFinished(
      request.id,
      false,
      `${app.config.name} ne prend pas en charge la démarche « ${demarche ? demarche.label : request.request_type} »`,
      logs
    );
    return;
  }

  // Progression en direct (étape courante / total) persistée pour l'affichage
  // côté suivi (client) et côté admin (détails de la demande).
  const progress = (done, total, label) => {
    try { db.setProgress(request.id, done, total, label); } catch { /* la progression est un bonus */ }
  };

  // Chien de garde ré-armable : on interrompt un robot réellement bloqué, mais
  // une attente LÉGITIME (saisie manuelle d'un OTP par l'admin) ré-arme le
  // minuteur via ctx.keepAlive() pour ne pas être tuée à tort.
  let watchdogTimer;
  let watchdogReject;
  const armWatchdog = () => {
    clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(
      () => watchdogReject && watchdogReject(new Error('Délai maximum dépassé (timeout)')),
      TIMEOUT_MS
    );
  };
  const watchdog = new Promise((_, reject) => { watchdogReject = reject; });

  // Contexte passé au scénario. `awaitOtp` récupère un code OTP (lecture auto par
  // mail si configurée, sinon saisie manuelle par l'admin).
  const ctx = {
    log,
    reference: request.reference,
    progress,
    keepAlive: armWatchdog,
    awaitOtp: (opts = {}) =>
      otp.awaitOtp({ requestId: request.id, log, keepAlive: armWatchdog, ...opts }),
  };

  try {
    armWatchdog();
    const result = await Promise.race([action(data, ctx), watchdog]);

    const artifacts = (result && result.artifacts) || [];
    if (result && result.success) {
      log(demarche.succes);
      db.markFinished(request.id, true, result.message || demarche.succes, logs, artifacts);
      db.audit('robot', demarche.audit, request.reference, result.message || '');
      // Mémorise l'identifiant généré (unicité future + affichage admin + e-mail).
      if (result.account && result.account.login) {
        db.setRequestLogin(request.id, result.account.login);
        db.recordAccount(
          request.app_id,
          result.account.login,
          result.account.nom,
          result.account.prenom,
          request.reference
        );
      }
      // Lien sécurisé de récupération des identifiants (usage unique) : le
      // mot de passe ne circule jamais en clair dans l'e-mail.
      let credentialLink = null;
      if (result.account && result.account.login) {
        try {
          const credentials = require('./credentials');
          // Le robot peut imposer un mot de passe précis (ex. réinitialisation :
          // provisoire aléatoire, car BlueKanGo refuse un mot de passe déjà
          // utilisé). Sinon, mot de passe initial par défaut de l'application.
          const password = result.account.password || credentials.initialPasswordFor(request.app_id);
          credentialLink = credentials.createLink(
            request.id,
            result.account.login,
            password
          );
          log(`Lien de récupération des identifiants généré (valide ${credentialLink.ttlDays} jours)`);
        } catch (linkErr) {
          log(`Génération du lien d'identifiants impossible : ${linkErr.message}`);
        }
      }
      // Envoi (ou mise en boîte d'envoi) de l'e-mail d'invitation.
      try {
        const mailer = require('./mailer');
        const outcome = await mailer.sendCredentials(db.getById(request.id), credentialLink);
        if (outcome) {
          log(outcome.sent ? 'E-mail d’identifiants envoyé' : 'E-mail d’identifiants mis en boîte d’envoi (SMTP non configuré)');
        } else {
          log('Aucun destinataire e-mail : pas d’envoi d’identifiants');
        }
      } catch (mailErr) {
        log(`Envoi e-mail impossible : ${mailErr.message}`);
      }
    } else {
      const msg = (result && result.message) || 'Le scénario a signalé un échec';
      log(`Échec : ${msg}`);
      db.markFinished(request.id, false, msg, logs, artifacts);
      db.audit('robot', 'echec_creation', request.reference, msg);
    }
  } catch (err) {
    log(`Erreur : ${err.message}`);
    db.markFinished(request.id, false, `Erreur pendant l'automatisation : ${err.message}`, logs);
    db.audit('robot', 'echec_creation', request.reference, String(err.message));
  } finally {
    clearTimeout(watchdogTimer);
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
