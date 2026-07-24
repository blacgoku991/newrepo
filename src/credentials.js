'use strict';

/**
 * Remise sécurisée des identifiants — lien à usage unique.
 *
 * Après création d'un compte par le robot, on ne met JAMAIS le mot de passe
 * dans l'e-mail : on génère un lien unique vers /identifiants/<jeton>.
 *  - le jeton (256 bits) n'est stocké que HACHÉ (SHA-256) en base ;
 *  - le mot de passe initial est chiffré au repos (AES-256-GCM) avec une clé
 *    locale générée automatiquement (data/secret.key, hors dépôt git) ;
 *  - la consultation est à usage unique : premier affichage = lien consommé,
 *    horodaté avec l'identité (SSO) et l'adresse IP du lecteur ;
 *  - le lien expire (CREDENTIALS_LINK_TTL_DAYS, défaut 7 jours) ;
 *  - l'admin peut régénérer un lien (l'ancien est révoqué) si perdu/expiré.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');

const TTL_DAYS = Number(process.env.CREDENTIALS_LINK_TTL_DAYS || 7);
const KEY_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'secret.key');

/** Clé de chiffrement locale : créée au premier usage, lisible par le seul serveur. */
function key() {
  if (!fs.existsSync(KEY_FILE)) {
    fs.writeFileSync(KEY_FILE, crypto.randomBytes(32), { mode: 0o600 });
  }
  return fs.readFileSync(KEY_FILE);
}

function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return [iv.toString('base64'), enc.toString('base64'), cipher.getAuthTag().toString('base64')].join('.');
}

function decrypt(blob) {
  if (!blob) return '';
  const [iv, enc, tag] = String(blob).split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  if (req) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    return `${proto}://${req.headers.host}`;
  }
  return `http://localhost:${process.env.PORT || 3000}`;
}

/**
 * Crée un lien de récupération pour une demande terminée.
 * Retourne { url, path, expiresAt } — le jeton en clair n'est jamais stocké.
 */
function createLink(requestId, login, initialPassword, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86400 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');
  db.createCredentialLink(requestId, hashToken(token), login, encrypt(initialPassword || ''), expiresAt);
  const p = `/identifiants/${token}`;
  return { url: `${baseUrl(req)}${p}`, path: p, expiresAt, ttlDays: TTL_DAYS };
}

/**
 * Consomme un lien (usage unique). Retourne :
 *  { ok:true, login, password, app, reference }  — premier affichage
 *  { ok:false, reason:'inconnu'|'expire'|'consulte'|'revoque', ... }
 */
function reveal(token, viewer, ip) {
  const row = db.getCredentialLinkByHash(hashToken(token));
  if (!row) return { ok: false, reason: 'inconnu' };
  if (row.revoked) return { ok: false, reason: 'revoque' };
  if (row.viewed_at) return { ok: false, reason: 'consulte', viewedAt: row.viewed_at, viewedBy: row.viewed_by };
  if (row.expires_at <= new Date().toISOString().slice(0, 19).replace('T', ' ')) {
    return { ok: false, reason: 'expire' };
  }
  db.markCredentialLinkViewed(row.id, viewer, ip);
  const request = db.getById(row.request_id);
  db.audit(viewer || 'inconnu', 'identifiants_consultes', request ? request.reference : String(row.request_id), row.login, ip);
  let password = '';
  try { password = decrypt(row.secret_enc); } catch { password = ''; }
  return {
    ok: true,
    login: row.login,
    password,
    reference: request ? request.reference : '',
    appId: request ? request.app_id : '',
  };
}

/** Mot de passe initial configuré pour une application (jamais stocké en base requests). */
function initialPasswordFor(appId) {
  return process.env[`${String(appId).toUpperCase()}_DEFAULT_PASSWORD`] || '';
}

/**
 * Mot de passe réellement posé par le robot pour une demande (déchiffré depuis
 * le dernier lien). Permet de RÉGÉNÉRER un lien avec le MÊME mot de passe —
 * indispensable pour la réinitialisation, dont le provisoire est aléatoire.
 */
function passwordForRequest(requestId) {
  try {
    const enc = db.lastCredentialSecret(requestId);
    return enc ? decrypt(enc) : '';
  } catch {
    return '';
  }
}

module.exports = { createLink, reveal, initialPasswordFor, passwordForRequest, TTL_DAYS };
