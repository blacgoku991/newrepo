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

function login(username, password) {
  const user = db.getAdminByUsername(username);
  const ok = verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || user.disabled || !ok) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString().replace('T', ' ').slice(0, 19);
  db.createSession(token, user.id, expiresAt);
  db.touchAdminLogin(user.id);
  return { token, user };
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

/**
 * `Secure` dès que la connexion est chiffrée — y compris lorsque le chiffrement
 * s'arrête au reverse proxy, ce qui est le cas de tout portail hébergé.
 *
 * Ce drapeau dépendait d'une variable d'environnement qu'il fallait penser à
 * poser : en hébergement SaaS personne ne la posait, et le cookie de session
 * d'un administrateur partait sans `Secure` sur un site pourtant en HTTPS —
 * donc récupérable au premier lien http:// suivi depuis ce navigateur.
 */
const enHttps = (req) => !!(req && (req.secure || req.headers['x-forwarded-proto'] === 'https'))
  || process.env.ADMIN_COOKIE_SECURE === 'true';

function setSessionCookie(res, token, req) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  // Pour un frontend cross-domaine, mettre ADMIN_COOKIE_SAMESITE=None
  // (nécessite HTTPS) — sinon le cookie n'est pas envoyé entre deux domaines.
  // Sinon, préférer le jeton Bearer.
  const sameSite = process.env.ADMIN_COOKIE_SAMESITE || 'Lax';
  const secure = enHttps(req) ? '; Secure' : '';
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
