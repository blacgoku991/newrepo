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
  const password = process.env.ADMIN_PASSWORD || 'admin';
  const displayName = process.env.ADMIN_DISPLAY_NAME || 'Administrateur';
  db.createAdmin(username, displayName, hashPassword(password), 'admin');
  if (!process.env.ADMIN_PASSWORD) {
    console.warn(
      '[auth] ⚠ Aucun ADMIN_PASSWORD défini : compte « admin » / « admin » créé. ' +
        'Changez-le dès que possible (voir .env.example).'
    );
  } else {
    console.log(`[auth] Compte administrateur initial « ${username} » créé.`);
  }
}

// --- Sessions ---------------------------------------------------------------

function login(username, password) {
  const user = db.getAdminByUsername(username);
  if (!user || user.disabled || !verifyPassword(password, user.password_hash)) return null;
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
