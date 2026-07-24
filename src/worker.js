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

  // Type de demande : création, réinitialisation de mdp ou ajout d'établissement.
  const isReset = request.request_type === 'reset_mdp';
  const isExtension = request.request_type === 'ajout_etab';
  const action = isReset
    ? app.automation.resetPassword
    : isExtension
      ? app.automation.addEstablishment
      : app.automation.createAccount;
  if (!action) {
    db.markFinished(request.id, false, `Cette application ne prend pas en charge : ${request.request_type}`, logs);
    return;
  }

  try {
    const result = await Promise.race([
      action(data, { log, reference: request.reference }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Délai maximum dépassé (timeout)')), TIMEOUT_MS)
      ),
    ]);

    const artifacts = (result && result.artifacts) || [];
    if (result && result.success) {
      log('Compte créé avec succès');
      db.markFinished(request.id, true, result.message || (isReset ? 'Mot de passe réinitialisé' : isExtension ? 'Établissement ajouté' : 'Compte créé avec succès'), logs, artifacts);
      db.audit('robot', isReset ? 'reinit_mdp' : isExtension ? 'ajout_etab' : 'creation_compte', request.reference, result.message || '');
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
          credentialLink = credentials.createLink(
            request.id,
            result.account.login,
            credentials.initialPasswordFor(request.app_id)
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
