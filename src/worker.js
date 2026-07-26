'use strict';

/**
 * Worker de traitement des demandes — en service continu.
 *
 * Plusieurs demandes sont traitées EN PARALLÈLE, mais pas n'importe comment :
 * chaque scénario pilote un vrai navigateur connecté à l'application métier
 * avec LE MÊME compte administrateur. Deux robots simultanés sur la même
 * application partageraient cette session : selon l'application, la seconde
 * connexion invalide la première, et les deux demandes échouent.
 *
 * D'où une file PAR APPLICATION :
 *   - au sein d'une application : 1 robot à la fois par défaut
 *     (`WORKER_PARALLELE_BLUEKANGO=2` si l'instance tolère plusieurs sessions) ;
 *   - entre applications : en parallèle — BlueKanGo et NetSoins avancent
 *     ensemble ;
 *   - plafond global `WORKER_PARALLELE` (défaut 3) : chaque robot est un
 *     Chromium, la mémoire de la machine n'est pas extensible.
 *
 * Service continu : les demandes restées « en cours » après un redémarrage
 * sont reprises, une demande déposée réveille le worker immédiatement (pas
 * d'attente du prochain tour), et aucune erreur d'un robot ne peut arrêter
 * les autres ni le processus.
 */

const db = require('./db');
const registry = require('./registry');
const demarches = require('./demarches');
const otp = require('./otp');
const licence = require('./licence');

const POLL_INTERVAL = Number(process.env.WORKER_POLL_MS || 3000);
const TIMEOUT_MS = Number(process.env.WORKER_TIMEOUT_MS || 180000);

const entier = (valeur, defaut, min = 1) => {
  const n = Number(valeur);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : defaut;
};

const PARALLELE_TOTAL = entier(process.env.WORKER_PARALLELE, 3);
const parallelePourApp = (appId) =>
  entier(process.env[`WORKER_PARALLELE_${String(appId).toUpperCase()}`], 1);

// Demandes en cours d'exécution : total et détail par application.
const enCours = new Map(); // appId -> nombre de robots actifs
const enVol = new Set(); // promesses en cours, pour l'arrêt propre
let arret = false;
let tickEnCours = false;
let reveil = null;

const total = () => [...enCours.values()].reduce((a, b) => a + b, 0);

async function processOne(request) {
  const app = registry.getAvailable(request.app_id);
  const logs = [];
  const log = (message) => {
    logs.push({ at: new Date().toISOString(), message });
    console.log(`[worker] [${request.reference}] ${message}`);
  };

  // La demande est déjà passée « en cours » au moment de la prise (claimNext) :
  // c'est ce qui garantit qu'aucun autre robot ne la prendra en même temps.
  log(`Prise en charge de la demande (tentative n°${request.attempts})`);

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
        // Correction d'identité : l'identifiant a changé — on renomme la ligne
        // du registre au lieu d'en créer une seconde, sinon l'espace du
        // référent afficherait l'ancien ET le nouvel identifiant.
        if (result.account.previousLogin && result.account.previousLogin !== result.account.login) {
          db.renameAccount(
            request.app_id,
            result.account.previousLogin,
            result.account.login,
            result.account.nom,
            result.account.prenom
          );
          log(`Registre mis à jour : « ${result.account.previousLogin} » → « ${result.account.login} »`);
        }
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
      // `credentials: false` (correction d'identité) : le mot de passe n'a pas
      // bougé. Générer un lien reviendrait à annoncer au titulaire un mot de
      // passe qui n'est pas le sien — on s'en abstient.
      let credentialLink = null;
      if (result.account && result.account.login && result.account.credentials !== false) {
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
          log(outcome.sent ? 'E-mail au titulaire envoyé' : 'E-mail au titulaire mis en boîte d’envoi (SMTP non configuré)');
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

// Mode limité (licence échue) : les robots sont à l'arrêt. Les demandes restent
// EN ATTENTE — elles seront traitées telles quelles au renouvellement, rien
// n'est perdu ni mis en échec. On ne le répète en console qu'une fois par heure.
let dernierRappelLicence = 0;
function robotsSuspendus() {
  const l = licence.etat();
  if (l.robot) return false;
  const maintenant = Date.now();
  if (maintenant - dernierRappelLicence > 3600 * 1000) {
    dernierRappelLicence = maintenant;
    console.log(`[worker] Traitements suspendus — ${l.titre.toLowerCase()}. ${l.message}`);
  }
  return true;
}

/**
 * Un tour de file : on remplit les places libres, application par application.
 * Ne bloque pas — les robots partent en parallèle et se libèrent tout seuls.
 */
function tick() {
  if (arret || tickEnCours) return;
  if (robotsSuspendus()) return;
  tickEnCours = true;
  try {
    let places = PARALLELE_TOTAL - total();
    if (places <= 0) return;

    for (const { app_id: appId } of db.pendingAppIds()) {
      if (places <= 0) break;
      const limiteApp = parallelePourApp(appId);
      let libresApp = limiteApp - (enCours.get(appId) || 0);
      while (libresApp > 0 && places > 0) {
        const request = db.claimNext(appId);
        if (!request) break; // une autre place a pris la dernière demande
        libresApp--;
        places--;
        lancer(appId, request);
      }
    }
  } finally {
    tickEnCours = false;
  }
}

/** Exécute une demande sans jamais laisser une erreur remonter au processus. */
function lancer(appId, request) {
  enCours.set(appId, (enCours.get(appId) || 0) + 1);
  const promesse = processOne(request)
    .catch((err) => {
      // processOne gère déjà ses erreurs ; ce filet couvre l'imprévu (panne
      // d'écriture en base) pour qu'un robot ne puisse pas arrêter les autres.
      console.error(`[worker] [${request.reference}] Erreur non rattrapée : ${err && err.message}`);
      try {
        db.markFinished(request.id, false, `Erreur interne du worker : ${err && err.message}`, []);
      } catch { /* la base est indisponible : rien de plus à tenter ici */ }
    })
    .finally(() => {
      enCours.set(appId, Math.max(0, (enCours.get(appId) || 1) - 1));
      enVol.delete(promesse);
      // Une place s'est libérée : on enchaîne sans attendre le prochain tour.
      if (!arret) setImmediate(tick);
    });
  enVol.add(promesse);
}

/**
 * Réveil immédiat, appelé au dépôt d'une demande. Sans lui, une demande
 * déposée attend le prochain tour de file — jusqu'à 3 secondes pour rien.
 */
function reveiller() {
  if (arret) return;
  clearTimeout(reveil);
  reveil = setTimeout(tick, 50);
  if (reveil.unref) reveil.unref();
}

/** Arrêt propre : on cesse de prendre, on laisse finir ce qui tourne. */
async function stop(delaiMs = 30000) {
  arret = true;
  if (!enVol.size) return;
  console.log(`[worker] Arrêt demandé — ${enVol.size} demande(s) en cours, on les laisse finir…`);
  await Promise.race([
    Promise.allSettled([...enVol]),
    new Promise((r) => setTimeout(r, delaiMs)),
  ]);
}

function start() {
  // Reprise après redémarrage : plus aucun robot ne tourne, donc tout ce qui
  // est « en cours » est en réalité orphelin.
  try {
    const { reprises, abandons } = db.requeueStale(0);
    if (reprises.length) console.log(`[worker] Reprise de ${reprises.length} demande(s) interrompue(s) : ${reprises.join(', ')}`);
    if (abandons) console.log(`[worker] ${abandons} demande(s) abandonnée(s) après trop de tentatives`);
  } catch (err) {
    console.error(`[worker] Reprise impossible : ${err.message}`);
  }

  setInterval(tick, POLL_INTERVAL).unref();
  // Filet de sécurité pour un service 24/7 : une demande dont le robot a été
  // tué sans passer par le `finally` (OOM, kill -9) repart d'elle-même.
  setInterval(() => {
    if (arret) return;
    try {
      const { reprises } = db.requeueStale(Math.ceil((TIMEOUT_MS * 3) / 60000) + 5);
      if (reprises.length) console.log(`[worker] Demande(s) bloquée(s) remise(s) en file : ${reprises.join(', ')}`);
    } catch { /* la reprise réessaiera au tour suivant */ }
  }, 5 * 60 * 1000).unref();

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => { stop().finally(() => process.exit(0)); });
  }
  // Un rejet non géré ne doit pas emporter un service qui tourne en continu.
  process.on('unhandledRejection', (err) => {
    console.error('[worker] Promesse rejetée sans traitement :', err && err.message ? err.message : err);
  });

  console.log(
    `[worker] Démarré — ${PARALLELE_TOTAL} demande(s) en parallèle au maximum, `
    + `1 par application (intervalle ${POLL_INTERVAL} ms)`
  );
}

/** État pour le panneau d'administration. */
function etat() {
  return {
    parallele: PARALLELE_TOTAL,
    enCours: Object.fromEntries([...enCours.entries()].filter(([, n]) => n > 0)),
    total: total(),
    arret,
  };
}

module.exports = { start, stop, tick, reveiller, etat };
