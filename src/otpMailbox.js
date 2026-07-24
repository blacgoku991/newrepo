'use strict';

/**
 * Lecture de l'OTP (« code secret temporaire ») envoyé par NetSoins / Teranga
 * à la connexion, via l'API Microsoft Graph.
 *
 * La boîte qui reçoit l'OTP (ex. achraf.maatoug@algonis.net) est sur Microsoft
 * 365 : on lit son courrier avec un jeton « application » (client credentials),
 * on repère le dernier mail d'OTP postérieur au déclenchement de la connexion,
 * on en extrait le code, puis on marque le mail comme lu.
 *
 * Configuration (.env) — voir .env.example :
 *   OTP_MAILBOX            boîte qui reçoit l'OTP (adresse complète)
 *   OTP_MAIL_TENANT_ID     tenant Entra ID (défaut : M365_TENANT_ID)
 *   OTP_MAIL_CLIENT_ID     app autorisée à lire la boîte (défaut : M365_CLIENT_ID)
 *   OTP_MAIL_CLIENT_SECRET secret de cette app (défaut : M365_CLIENT_SECRET)
 *   OTP_SENDER             (optionnel) filtre sur l'expéditeur (sous-chaîne)
 *   OTP_CODE_REGEX         (optionnel) regex d'extraction personnalisée
 *   OTP_TIMEOUT_MS         (optionnel) délai d'attente max (défaut 90000)
 *
 * Côté Microsoft : l'app doit disposer de la permission d'APPLICATION
 * « Mail.Read » (consentement admin), idéalement restreinte à cette seule
 * boîte via une Application Access Policy.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

/** Convertit un corps HTML de mail en texte lisible (pour l'extraction). */
function htmlToText(raw) {
  return String(raw || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrait le code OTP d'un corps de mail (HTML ou texte).
 * Calibré sur le mail Teranga : « Votre code secret temporaire est : <code> »,
 * code alphanumérique de 4 à 8 caractères, sensible à la casse.
 * Renvoie null si aucun code fiable n'est trouvé (on ne devine jamais).
 */
function extractOtpCode(raw, { regex = env('OTP_CODE_REGEX') } = {}) {
  const text = htmlToText(raw);
  if (regex) {
    const m = new RegExp(regex).exec(text);
    return m ? (m[1] || m[0]) : null;
  }
  // Ancre principale : le libellé qui précède le code dans le mail NetSoins.
  const anchored = /code secret temporaire est\s*:?\s*([A-Za-z0-9]{4,8})/i.exec(text);
  if (anchored) return anchored[1];
  // Variante FR plus large (« votre code … est : XXXX ») sans capter un mot courant.
  const alt = /code[^:]{0,40}:\s*([A-Za-z0-9]{4,8})\b/i.exec(text);
  return alt ? alt[1] : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Jeton « application » Microsoft Graph (client credentials). */
async function graphToken() {
  const tenant = env('OTP_MAIL_TENANT_ID', env('M365_TENANT_ID'));
  const clientId = env('OTP_MAIL_CLIENT_ID', env('M365_CLIENT_ID'));
  const clientSecret = env('OTP_MAIL_CLIENT_SECRET', env('M365_CLIENT_SECRET'));
  if (!tenant || !clientId || !clientSecret) {
    throw new Error('Lecture OTP non configurée (OTP_MAIL_TENANT_ID / _CLIENT_ID / _CLIENT_SECRET manquants)');
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: 'https://graph.microsoft.com/.default',
  });
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(`Jeton Graph refusé : ${json.error_description || res.status}`);
  }
  return json.access_token;
}

async function markRead(mailbox, id, token) {
  await fetch(`${GRAPH}/users/${encodeURIComponent(mailbox)}/messages/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ isRead: true }),
  }).catch(() => {});
}

/**
 * Attend et renvoie le code OTP le plus récent.
 * @param {Date}   opts.since    ne considère que les mails reçus après cette date
 *                               (mettre l'instant JUSTE avant de déclencher l'OTP)
 * @param {number} opts.timeoutMs délai d'attente maximal
 * @param {function} opts.log
 */
async function fetchLatestOtp({ since = new Date(Date.now() - 3 * 60000), timeoutMs, log = () => {} } = {}) {
  const mailbox = env('OTP_MAILBOX');
  if (!mailbox) throw new Error('OTP_MAILBOX non configuré');
  const senderFilter = (env('OTP_SENDER') || '').toLowerCase();
  const deadline = Date.now() + Number(timeoutMs || env('OTP_TIMEOUT_MS', 90000));
  const sinceIso = since.toISOString();
  const seen = new Set();

  log(`Lecture de l'OTP sur ${mailbox} (attente du mail)…`);
  while (Date.now() < deadline) {
    const token = await graphToken();
    const url =
      `${GRAPH}/users/${encodeURIComponent(mailbox)}/messages` +
      `?$select=id,subject,from,receivedDateTime,body` +
      `&$orderby=receivedDateTime desc&$top=5` +
      `&$filter=${encodeURIComponent(`receivedDateTime ge ${sinceIso}`)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`Graph ${res.status} : ${(await res.text()).slice(0, 200)}`);
    }
    const data = await res.json();
    for (const msg of data.value || []) {
      if (seen.has(msg.id)) continue;
      seen.add(msg.id);
      const from = (msg.from && msg.from.emailAddress && msg.from.emailAddress.address) || '';
      if (senderFilter && !from.toLowerCase().includes(senderFilter)) continue;
      const code = extractOtpCode((msg.body && msg.body.content) || '');
      if (code) {
        await markRead(mailbox, msg.id, token);
        log(`OTP reçu de ${from} : code récupéré`);
        return code;
      }
    }
    await sleep(3000);
  }
  throw new Error("OTP non reçu dans le délai imparti (vérifier la boîte et l'accès Graph)");
}

module.exports = { extractOtpCode, htmlToText, fetchLatestOtp };
