'use strict';

/**
 * Authentification de l'espace d'administration.
 *
 * - Mots de passe hachés avec scrypt (module natif node:crypto, sans dépendance).
 * - Sessions par cookie httpOnly (jeton aléatoire stocké en base).
 * - Un compte administrateur initial est créé au démarrage à partir de
 *   ADMIN_USERNAME / ADMIN_PASSWORD (voir .env.example) s'il n'existe aucun
 *   administrateur.
 */

const crypto = require('crypto');
const db = require('./db');
const totp = require('./totp');

const SESSION_TTL_MS = Number(process.env.ADMIN_SESSION_TTL_MS || 12 * 60 * 60 * 1000); // 12 h
const COOKIE = 'portail_sid';

// --- Hachage de mot de passe (scrypt) ---------------------------------------

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expected] = parts;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Amorçage du premier administrateur -------------------------------------

function ensureSeedAdmin() {
  if (db.countAdmins() > 0) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const displayName = process.env.ADMIN_DISPLAY_NAME || 'Administrateur';

  // Sans ADMIN_PASSWORD, on NE crée PAS un couple devinable (« admin »/« admin ») :
  // une mise en ligne faite dans la précipitation ouvrirait le panneau
  // d'administration à quiconque connaît ce grand classique. On tire un mot de
  // passe aléatoire, affiché une seule fois au démarrage.
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');

  db.createAdmin(username, displayName, hashPassword(password), 'admin');

  if (generated) {
    console.warn(
      `\n[auth] ⚠ Aucun ADMIN_PASSWORD défini. Compte « ${username} » créé avec ce mot de passe :\n` +
        `\n        ${password}\n\n` +
        "        Notez-le maintenant : il n'est affiché qu'une fois.\n" +
        '        Définissez ADMIN_PASSWORD dans .env pour en choisir un (voir .env.example).\n'
    );
  } else {
    console.log(`[auth] Compte administrateur initial « ${username} » créé.`);
  }
}

// --- Sessions ---------------------------------------------------------------

// Haché une fois au démarrage : sert de comparaison « pour rien » quand
// l'identifiant n'existe pas, afin que la durée de la vérification soit la
// même que l'utilisateur existe ou non (anti-énumération par mesure du temps).
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function ouvrirSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString().replace('T', ' ').slice(0, 19);
  db.createSession(token, user.id, expiresAt);
  db.touchAdminLogin(user.id);
  return { token, user };
}

/**
 * Défis en attente du second facteur.
 *
 * Le mot de passe seul n'ouvre AUCUNE session : il donne un jeton de passage
 * éphémère, sans valeur tant que le code n'a pas été fourni. Conservé en
 * mémoire — un redémarrage oblige simplement à ressaisir le mot de passe.
 */
const defis = new Map(); // jeton -> { userId, expire, essais }
const DEFI_TTL_MS = 5 * 60 * 1000;
const DEFI_ESSAIS_MAX = 5;

function purgerDefis(maintenant = Date.now()) {
  for (const [jeton, d] of defis) if (d.expire <= maintenant) defis.delete(jeton);
}

/**
 * Première étape : identifiant + mot de passe.
 *
 * Renvoie `null` (échec), `{ token, user }` (pas de double authentification),
 * ou `{ besoin2fa: true, defi, user }`.
 */
function login(username, password) {
  const user = db.getAdminByUsername(username);
  const ok = verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || user.disabled || !ok) return null;
  if (!user.totp_active || !user.totp_secret) return ouvrirSession(user);

  purgerDefis();
  const defi = crypto.randomBytes(32).toString('hex');
  defis.set(defi, { userId: user.id, expire: Date.now() + DEFI_TTL_MS, essais: 0 });
  return { besoin2fa: true, defi, user };
}

/**
 * Seconde étape : code de l'application d'authentification, ou code de secours.
 *
 * Renvoie `{ token, user, via }` ou un objet d'erreur `{ erreur }` — le motif
 * sert au journal, jamais à distinguer « mauvais code » de « défi expiré » côté
 * client, ce qui aiderait à cibler une attaque.
 */
function completer2fa(defi, code) {
  purgerDefis();
  const attente = defis.get(defi);
  if (!attente) return { erreur: 'defi_inconnu' };
  attente.essais += 1;
  // Un code à six chiffres se devine en quelques milliers d'essais : on ferme
  // le défi bien avant, quitte à refaire saisir le mot de passe.
  if (attente.essais > DEFI_ESSAIS_MAX) {
    defis.delete(defi);
    return { erreur: 'trop_d_essais' };
  }
  const user = db.getAdminById(attente.userId);
  if (!user || user.disabled) {
    defis.delete(defi);
    return { erreur: 'compte_indisponible' };
  }

  let via = null;
  const pas = totp.verifie(user.totp_secret, code, { pasMinimum: user.totp_dernier_pas });
  if (pas) {
    db.marquerPasTotp(user.id, pas);
    via = 'application';
  } else if (db.consommerCodeSecours(user.id, totp.hacherCodeSecours(code))) {
    // Un code de secours ne sert qu'une fois : la consommation est faite par
    // l'UPDATE conditionnel, deux essais simultanés ne peuvent pas passer.
    via = 'code_de_secours';
  }
  if (!via) return { erreur: 'code_invalide' };

  defis.delete(defi);
  return { ...ouvrirSession(user), via, codesRestants: db.codesSecoursRestants(user.id) };
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function currentSession(req) {
  // Cookie (même origine) OU en-tête « Authorization: Bearer <token> »
  // (pratique pour un frontend hébergé sur un autre domaine, ex. Lovable).
  let token = parseCookies(req)[COOKIE];
  const authz = req.headers.authorization || '';
  if (!token && authz.startsWith('Bearer ')) token = authz.slice(7).trim();
  if (!token) return null;
  return db.getSession(token) || null;
}

function setSessionCookie(res, token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  // Pour un frontend cross-domaine, mettre ADMIN_COOKIE_SAMESITE=None et
  // ADMIN_COOKIE_SECURE=true (nécessite HTTPS) — sinon le cookie n'est pas
  // envoyé entre deux domaines. Sinon, préférer le jeton Bearer.
  const sameSite = process.env.ADMIN_COOKIE_SAMESITE || 'Lax';
  const secure = process.env.ADMIN_COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=${sameSite}${secure}; Max-Age=${maxAge}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Middleware : exige une session valide pour les API d'administration. */
function requireApi(req, res, next) {
  const session = currentSession(req);
  if (!session) return res.status(401).json({ error: 'Authentification requise' });
  req.admin = session;
  next();
}

/** Middleware : protège les pages/fichiers admin (redirige vers la connexion). */
function requirePage(req, res, next) {
  const session = currentSession(req);
  if (!session) return res.redirect('/login.html');
  req.admin = session;
  next();
}

module.exports = {
  completer2fa,
  COOKIE,
  hashPassword,
  verifyPassword,
  ensureSeedAdmin,
  login,
  logout: (token) => db.deleteSession(token),
  currentSession,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  requireApi,
  requirePage,
};
