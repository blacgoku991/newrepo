'use strict';

/**
 * Récupération d'un code OTP (« code secret temporaire ») demandé par une
 * application cible au moment de la connexion — cas NetSoins.
 *
 * Deux modes, transparents pour le scénario robot :
 *   1. AUTOMATIQUE — si la lecture du mail est configurée (OTP_MAILBOX + clés
 *      Microsoft Graph), on lit le code tout seul dans la boîte (src/otpMailbox).
 *   2. MANUEL (défaut, aucune config Microsoft nécessaire) — la demande passe
 *      « en attente de code » : l'admin saisit le code reçu par mail depuis les
 *      détails de la demande, et le robot reprend automatiquement.
 *
 * On bascule de l'un à l'autre juste en renseignant (ou non) les clés dans .env :
 * aujourd'hui saisie manuelle, et le jour où l'accès Graph est accordé, tout
 * devient automatique sans changer une ligne du scénario.
 */

const db = require('./db');
const otpMailbox = require('./otpMailbox');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

/** La lecture automatique du mail d'OTP est-elle configurée ? */
function mailReadConfigured() {
  const mailbox = env('OTP_MAILBOX');
  const tenant = env('OTP_MAIL_TENANT_ID', env('M365_TENANT_ID'));
  const clientId = env('OTP_MAIL_CLIENT_ID', env('M365_CLIENT_ID'));
  const secret = env('OTP_MAIL_CLIENT_SECRET', env('M365_CLIENT_SECRET'));
  return Boolean(mailbox && tenant && clientId && secret);
}

/**
 * Attend le code OTP pour une demande. Résout avec le code (string) ou rejette
 * si aucun code n'arrive dans le délai.
 * @param {number}   opts.requestId  id de la demande (pour la saisie manuelle)
 * @param {Date}     opts.since      instant à partir duquel considérer les mails
 *                                   (mettre juste AVANT de déclencher l'OTP)
 * @param {string}   opts.label      message affiché à l'admin en mode manuel
 * @param {number}   opts.timeoutMs  délai d'attente maximal
 * @param {function} opts.log
 * @param {function} opts.keepAlive  (optionnel) à appeler pour signaler au worker
 *                                   que l'attente est normale (évite le timeout)
 */
async function awaitOtp({
  requestId,
  since = new Date(),
  label = 'Code de sécurité reçu par e-mail',
  timeoutMs,
  log = () => {},
  keepAlive,
} = {}) {
  if (mailReadConfigured()) {
    log('Lecture automatique du code OTP par e-mail (Microsoft Graph)…');
    try {
      return await otpMailbox.fetchLatestOtp({ since, timeoutMs, log });
    } catch (err) {
      // La lecture auto peut échouer (permission pas encore accordée, boîte
      // vide…) : on ne bloque pas, on bascule sur la saisie manuelle.
      log(`Lecture automatique impossible (${err.message}) — passage en saisie manuelle`);
    }
  }
  return awaitManualOtp({ requestId, label, timeoutMs, log, keepAlive });
}

async function awaitManualOtp({ requestId, label, timeoutMs, log, keepAlive }) {
  if (!requestId) throw new Error('Saisie manuelle de l\'OTP impossible : demande inconnue');
  // 15 minutes par défaut : le temps d'ouvrir sa boîte mail sans se presser.
  const total = Number(timeoutMs || env('OTP_MANUAL_TIMEOUT_MS', 900000));
  const deadline = Date.now() + total;
  db.requestOtp(requestId, label);
  log('En attente du code OTP — à saisir dans les détails de la demande (admin)…');
  let lastPing = Date.now();
  try {
    while (Date.now() < deadline) {
      if (typeof keepAlive === 'function') keepAlive(); // l'attente est légitime
      const state = db.otpState(requestId);
      if (state && !state.awaiting_otp && state.otp_code) {
        log('Code OTP reçu (saisie manuelle).');
        return state.otp_code;
      }
      // Rappel périodique : montre que le robot est toujours en attente.
      if (Date.now() - lastPing >= 30000) {
        lastPing = Date.now();
        log(`Toujours en attente du code OTP (${Math.ceil((deadline - Date.now()) / 60000)} min restantes)…`);
      }
      await sleep(2000);
    }
  } finally {
    db.clearOtp(requestId);
  }
  throw new Error('Code OTP non saisi dans le délai imparti (15 min) — relancez la demande');
}

module.exports = { awaitOtp, mailReadConfigured };
