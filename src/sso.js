'use strict';

/**
 * SSO Microsoft 365 (Entra ID / Azure AD) — porte d'entrée du site public.
 *
 * Seules les personnes disposant d'un compte Microsoft 365 du tenant ADEF
 * peuvent accéder au portail (pages publiques + API de dépôt de demandes).
 * Flux OpenID Connect « authorization code » + PKCE, sans dépendance externe :
 * l'échange du code se fait en direct avec login.microsoftonline.com.
 *
 * Configuration (.env) :
 *   M365_TENANT_ID      — identifiant du tenant Entra ID d'ADEF (GUID ou domaine)
 *   M365_CLIENT_ID      — id de l'application enregistrée dans Entra ID
 *   M365_CLIENT_SECRET  — secret client de l'application
 *   M365_REDIRECT_URI   — URL de retour (ex. https://portail.adef.fr/auth/sso/callback)
 *   SSO_REQUIRED        — 'false' pour désactiver le SSO même configuré (défaut : actif si configuré)
 *
 * Enregistrement Entra ID : Applications > Nouvelle inscription, type « Web »,
 * URI de redirection = M365_REDIRECT_URI, puis créer un secret client.
 * Le tenant étant précisé dans l'URL d'autorisation, SEULS les comptes du
 * tenant ADEF peuvent se connecter (les comptes personnels sont refusés).
 */

const crypto = require('node:crypto');
const db = require('./db');

const COOKIE = 'portal_sso';
const SESSION_TTL_H = Number(process.env.SSO_SESSION_TTL_HOURS || 10);

// États OIDC en attente (state → { nonce, verifier, next, at }), durée de vie 10 min.
const pendingStates = new Map();

function configured() {
  return !!(process.env.M365_TENANT_ID && process.env.M365_CLIENT_ID && process.env.M365_CLIENT_SECRET);
}

function required() {
  return configured() && String(process.env.SSO_REQUIRED || 'true') !== 'false';
}

function authority() {
  return `https://login.microsoftonline.com/${process.env.M365_TENANT_ID}`;
}

function redirectUri(req) {
  if (process.env.M365_REDIRECT_URI) return process.env.M365_REDIRECT_URI;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  return `${proto}://${req.headers.host}/auth/sso/callback`;
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket?.remoteAddress || '';
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Session SSO du visiteur (ou null). */
function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const session = db.getSsoSession(token);
  return session ? { email: session.email, name: session.name, oid: session.oid } : null;
}

// --- Routes ---------------------------------------------------------------

/** GET /auth/sso/login — redirige vers la page de connexion Microsoft. */
function loginRoute(req, res) {
  if (!configured()) return res.status(503).send('SSO Microsoft 365 non configuré');
  // Nettoyage des états trop anciens.
  for (const [key, value] of pendingStates) {
    if (Date.now() - value.at > 10 * 60 * 1000) pendingStates.delete(key);
  }
  const state = b64url(crypto.randomBytes(24));
  const nonce = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  // Cible de retour : uniquement un chemin local (jamais une URL externe).
  const next = String(req.query.next || '/');
  pendingStates.set(state, { nonce, verifier, next: next.startsWith('/') && !next.startsWith('//') ? next : '/', at: Date.now() });

  const url = new URL(`${authority()}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', process.env.M365_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri(req));
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  res.redirect(url.toString());
}

/** GET /auth/sso/callback — échange le code, vérifie le jeton, crée la session. */
async function callbackRoute(req, res) {
  try {
    const { code, state, error, error_description } = req.query;
    if (error) throw new Error(`${error} : ${error_description || ''}`);
    const pending = pendingStates.get(String(state || ''));
    if (!code || !pending) throw new Error('État de connexion inconnu ou expiré — recommencez.');
    pendingStates.delete(String(state));

    const body = new URLSearchParams({
      client_id: process.env.M365_CLIENT_ID,
      client_secret: process.env.M365_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: redirectUri(req),
      code_verifier: pending.verifier,
    });
    const tokenRes = await fetch(`${authority()}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok || !tokens.id_token) {
      throw new Error(tokens.error_description || 'Échange du code refusé par Microsoft');
    }

    // Le jeton vient DIRECTEMENT de Microsoft via TLS (flux code côté serveur) :
    // on vérifie les revendications essentielles (émetteur, audience, expiration, nonce).
    const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8'));
    if (payload.aud !== process.env.M365_CLIENT_ID) throw new Error('Jeton reçu pour une autre application');
    if (!String(payload.iss || '').includes('login.microsoftonline.com')) throw new Error('Émetteur du jeton inattendu');
    if (payload.nonce !== pending.nonce) throw new Error('Nonce du jeton invalide');
    if (payload.exp && payload.exp * 1000 < Date.now()) throw new Error('Jeton expiré');

    const email = String(payload.preferred_username || payload.email || payload.upn || '').toLowerCase();
    const name = String(payload.name || email);
    if (!email) throw new Error('Adresse e-mail absente du jeton Microsoft');

    const token = b64url(crypto.randomBytes(32));
    const expires = new Date(Date.now() + SESSION_TTL_H * 3600 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');
    db.createSsoSession(token, email, name, String(payload.oid || ''), expires);
    db.audit(`${name} <${email}>`, 'connexion_sso', '', '', clientIp(req));

    const secure = String(process.env.COOKIE_SECURE || 'false') === 'true';
    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_H * 3600}${secure ? '; Secure' : ''}`
    );
    res.redirect(pending.next || '/');
  } catch (err) {
    db.audit('inconnu', 'echec_connexion_sso', '', String(err.message), clientIp(req));
    res
      .status(401)
      .send(
        `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px">` +
          `<h2>Connexion Microsoft 365 refusée</h2><p>${String(err.message).replace(/</g, '&lt;')}</p>` +
          `<p><a href="/connexion.html">Réessayer</a></p></body>`
      );
  }
}

/** POST /auth/sso/logout */
function logoutRoute(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) db.deleteSsoSession(token);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
  res.json({ ok: true });
}

// --- Middlewares ----------------------------------------------------------

/** Pages publiques : redirige vers /connexion.html si non connecté en SSO. */
function requirePage(req, res, next) {
  if (!required() || currentUser(req)) return next();
  const target = encodeURIComponent(req.originalUrl || '/');
  res.redirect(`/connexion.html?next=${target}`);
}

/** API publiques : 401 JSON (le frontend redirige vers /connexion.html). */
function requireApi(req, res, next) {
  if (!required()) return next();
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Connexion Microsoft 365 requise', sso: true });
  req.ssoUser = user;
  next();
}

module.exports = {
  COOKIE,
  configured,
  required,
  currentUser,
  clientIp,
  loginRoute,
  callbackRoute,
  logoutRoute,
  requirePage,
  requireApi,
};
