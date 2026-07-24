'use strict';

// Charge le fichier .env AVANT tout module qui lit process.env.
require('./loadEnv').loadEnv();

const path = require('path');
const express = require('express');

const db = require('./db');
const registry = require('./registry');
const auth = require('./auth');
const sso = require('./sso');
const stats = require('./stats');
const { validate } = require('./validate');
const { augmentSchema, effectiveSchema, effectiveResetSchema, validateOverrides, requesterLabel } = require('./schema');
const { validateScenarioOverrides } = require('./automation/scenarioRuntime');
const mailer = require('./mailer');
const worker = require('./worker');

const security = require('./security');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.use(security.securityHeaders);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));

// CORS — autorise un frontend hébergé ailleurs (ex. Lovable) à appeler l'API.
// Renseigner ALLOWED_ORIGINS dans .env (liste séparée par des virgules), ou '*'
// pour tout autoriser (déconseillé en production avec authentification).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Anti-CSRF : toute requête modifiante venant d'un navigateur doit provenir de
// notre propre origine (ou d'une origine explicitement autorisée via CORS).
app.use(security.csrfOriginCheck(ALLOWED_ORIGINS));

// ---------------------------------------------------------------------------
// Porte d'entrée SSO globale — site fermé par défaut.
// Quand le SSO Microsoft 365 est actif, AUCUNE page ni API n'est accessible
// sans session, à l'exception de :
//  - le parcours de connexion lui-même (/connexion, /auth/sso/*) ;
//  - l'espace admin, qui a sa propre authentification (login + sessions) ;
//  - les ressources statiques sans données (css, js, images, polices) ;
//  - la console démo, réservée au robot (même machine) ou à un utilisateur SSO.
// Toute route ajoutée plus tard est donc protégée automatiquement.
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  if (!sso.required()) return next();
  const p = req.path;
  if (p.startsWith('/auth/sso/') || p === '/connexion' || p === '/connexion.html') return next();
  if (p === '/login.html' || p === '/admin' || p === '/admin.html' || p.startsWith('/artifacts')) return next();
  if (p.startsWith('/api/auth/') || p.startsWith('/api/admin/') || p === '/api/sso/me') return next();
  if (p.startsWith('/css/') || p.startsWith('/js/') || p.startsWith('/img/') || p.startsWith('/vendor/') || p === '/favicon.ico') return next();
  if (p.startsWith('/demo')) {
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    if (local || sso.currentUser(req)) return next();
    return res.status(403).send('Accès réservé');
  }
  if (sso.currentUser(req)) return next();
  if (p.startsWith('/api/')) {
    return res.status(401).json({ error: 'Connexion Microsoft 365 requise', sso: true });
  }
  return res.redirect(`/connexion?next=${encodeURIComponent(req.originalUrl || '/')}`);
});

// Compte administrateur initial + purge des sessions expirées au démarrage.
auth.ensureSeedAdmin();
db.purgeExpiredSessions();
db.purgeExpiredSsoSessions();

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ---------------------------------------------------------------------------
// SSO Microsoft 365 — porte d'entrée du site public.
// Quand il est configuré (M365_*), l'accès aux pages et à l'API publiques est
// réservé aux comptes Microsoft 365 du tenant ADEF. L'admin garde sa propre
// authentification, et la console démo (/demo) reste accessible au robot.
// ---------------------------------------------------------------------------

app.get('/auth/sso/login', security.rateLimit('sso', 30, 10 * 60 * 1000), sso.loginRoute);
app.get('/auth/sso/callback', security.rateLimit('sso', 30, 10 * 60 * 1000), sso.callbackRoute);
app.post('/auth/sso/logout', sso.logoutRoute);

// Identité SSO du visiteur (préremplissage du formulaire + bandeau).
app.get('/api/sso/me', (req, res) => {
  res.json({ enabled: sso.required(), user: sso.currentUser(req) });
});

// URL propre de la page de connexion (sert /connexion.html).
app.get('/connexion', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'connexion.html'));
});

// ---------------------------------------------------------------------------
// Récupération sécurisée des identifiants (lien à usage unique).
// La page et l'API sont derrière la porte SSO globale comme tout le site.
// ---------------------------------------------------------------------------
const credentials = require('./credentials');

app.get('/identifiants/:token', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'identifiants.html'));
});

// La révélation est un POST explicite (bouton) : un préchargement de lien par
// un antivirus/messagerie ne peut pas consommer l'usage unique.
app.post('/api/identifiants/reveal', security.rateLimit('reveal', 20, 10 * 60 * 1000), (req, res) => {
  const token = String((req.body || {}).token || '');
  if (!token) return res.status(400).json({ error: 'Jeton manquant' });
  const ssoUser = sso.currentUser(req);
  const viewer = ssoUser ? `${ssoUser.name} <${ssoUser.email}>` : 'sans SSO';
  const result = credentials.reveal(token, viewer, sso.clientIp(req));
  if (!result.ok) {
    const messages = {
      inconnu: 'Ce lien est invalide.',
      expire: 'Ce lien a expiré. Contactez votre administrateur pour en recevoir un nouveau.',
      consulte: 'Ces identifiants ont déjà été consultés. Contactez votre administrateur si ce n\'était pas vous.',
      revoque: 'Ce lien a été remplacé par un lien plus récent.',
    };
    return res.status(410).json({ error: messages[result.reason] || 'Lien indisponible', reason: result.reason, viewedAt: result.viewedAt || null });
  }
  const appEntry = registry.get(result.appId);
  res.json({
    login: result.login,
    password: result.password || null,
    reference: result.reference,
    app: appEntry ? appEntry.config.name : result.appId,
  });
});

// Pages/fichiers d'administration protégés (avant le service statique global).
app.get(['/admin.html', '/admin'], auth.requirePage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});
app.use('/artifacts', auth.requirePage, express.static(db.ARTIFACTS_DIR));

app.use(express.static(PUBLIC_DIR));

// Polices servies localement (aucune dépendance à un CDN externe).
app.use(
  '/vendor/inter',
  express.static(path.join(__dirname, '..', 'node_modules', '@fontsource-variable', 'inter'))
);
app.use(
  '/vendor/fraunces',
  express.static(path.join(__dirname, '..', 'node_modules', '@fontsource', 'fraunces'))
);

// Logo d'une application : sert le .png réel s'il a été téléchargé
// (scripts/telecharger-logos.js), sinon le .svg de substitution.
app.get('/img/:name', (req, res, next) => {
  const name = String(req.params.name).replace(/[^a-z0-9_-]/gi, '');
  const fs = require('fs');
  for (const ext of ['png', 'svg']) {
    const file = path.join(PUBLIC_DIR, 'img', `${name}.${ext}`);
    if (fs.existsSync(file)) return res.sendFile(file);
  }
  next();
});

// Console d'administration de démonstration, pilotée par le robot en mode démo.
app.use('/demo', require('./demoApp'));

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

app.get('/api/apps', sso.requireApi, (req, res) => {
  res.json(registry.publicList());
});

app.get('/api/apps/:id/schema', sso.requireApi, (req, res) => {
  const entry = registry.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Application inconnue' });
  if (entry.config.comingSoon) {
    return res.status(409).json({ error: 'Application bientôt disponible' });
  }
  const { id, name, category, description, icon, color, logo } = entry.config;
  // ?type=reset → formulaire de réinitialisation de mot de passe (si proposé).
  if (req.query.type === 'reset') {
    const schema = effectiveResetSchema(entry.config);
    if (!schema) return res.status(404).json({ error: 'Réinitialisation indisponible pour cette application' });
    return res.json({ id, name, category, description, icon, color, logo: logo || null, schema, type: 'reset' });
  }
  res.json({ id, name, category, description, icon, color, logo: logo || null, schema: effectiveSchema(entry.config) });
});

// 60 dépôts par IP et par 10 minutes : large pour les lots, bloque le spam.
app.post('/api/apps/:id/requests', security.rateLimit('depot', 60, 10 * 60 * 1000), sso.requireApi, (req, res) => {
  const entry = registry.getAvailable(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Application inconnue ou indisponible' });

  const isReset = req.query.type === 'reset';
  const schema = isReset ? effectiveResetSchema(entry.config) : effectiveSchema(entry.config);
  if (!schema) return res.status(404).json({ error: 'Réinitialisation indisponible pour cette application' });
  const { data, errors } = validate(schema, req.body || {});
  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ error: 'Formulaire invalide', fields: errors });
  }

  // Traçabilité : l'identité Microsoft 365 (si SSO actif) fait foi sur le
  // demandeur déclaré, et l'adresse IP d'origine est conservée.
  const ip = sso.clientIp(req);
  const ssoUser = sso.currentUser(req);
  const demandeur = ssoUser ? `${ssoUser.name} <${ssoUser.email}>` : requesterLabel(data);
  const reference = db.createRequest(
    entry.config.id,
    isReset ? 'MDP' : entry.config.referencePrefix,
    data,
    demandeur,
    ssoUser ? ssoUser.email : '',
    ip,
    isReset ? 'reset_mdp' : 'creation'
  );
  db.audit(
    demandeur,
    isReset ? 'depot_reinit_mdp' : 'depot_demande',
    reference,
    `${entry.config.name} — ${data.prenom || ''} ${data.nom || ''}`.trim(),
    ip
  );
  res.status(201).json({ reference });
});

// Suivi public d'une demande par sa référence (informations limitées).
// Limité par IP pour empêcher l'énumération de références.
app.get('/api/requests/:reference', security.rateLimit('suivi', 120, 10 * 60 * 1000), sso.requireApi, (req, res) => {
  const row = db.getByReference(req.params.reference.toUpperCase());
  if (!row) return res.status(404).json({ error: 'Référence inconnue' });
  const appEntry = registry.get(row.app_id);
  res.json({
    reference: row.reference,
    app: appEntry ? appEntry.config.name : row.app_id,
    status: row.status,
    message: row.result_message,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  });
});

// Depuis la page de suivi : accès aux identifiants d'une demande terminée.
// Génère un lien frais (l'ancien est révoqué) et renvoie son chemin.
// Avec SSO actif, réservé au déposant ou au bénéficiaire de la demande.
app.post('/api/requests/:reference/credentials-access', security.rateLimit('credaccess', 15, 10 * 60 * 1000), sso.requireApi, (req, res) => {
  const row = db.getByReference(String(req.params.reference).toUpperCase());
  if (!row) return res.status(404).json({ error: 'Référence inconnue' });
  if (row.status !== 'terminee' || !row.generated_login) {
    return res.status(409).json({ error: 'Le compte n\'est pas encore créé' });
  }
  const ssoUser = sso.currentUser(req);
  if (sso.required()) {
    const email = (ssoUser?.email || '').toLowerCase();
    const data = JSON.parse(row.payload);
    const allowed = [row.sso_email, data.email, data._demandeur_email]
      .map((e) => String(e || '').toLowerCase())
      .filter(Boolean);
    if (!email || !allowed.includes(email)) {
      db.audit(ssoUser ? `${ssoUser.name} <${ssoUser.email}>` : 'inconnu', 'acces_identifiants_refuse', row.reference, '', sso.clientIp(req));
      return res.status(403).json({ error: 'Ces identifiants sont réservés au demandeur ou au bénéficiaire de la demande.' });
    }
  }
  const link = credentials.createLink(row.id, row.generated_login, credentials.initialPasswordFor(row.app_id), req);
  const actor = ssoUser ? `${ssoUser.name} <${ssoUser.email}>` : row.demandeur || 'suivi';
  db.audit(actor, 'lien_identifiants_regenere', row.reference, row.generated_login, sso.clientIp(req));
  res.json({ path: link.path });
});

// ---------------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------------

// 10 tentatives de connexion admin par IP et par quart d'heure.
app.post('/api/auth/login', security.rateLimit('login', 10, 15 * 60 * 1000), (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
  }
  const result = auth.login(String(username).trim(), String(password));
  if (!result) {
    db.audit(String(username).trim(), 'echec_connexion_admin', '', '', sso.clientIp(req));
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
  }
  db.audit(result.user.username, 'connexion_admin', '', '', sso.clientIp(req));
  security.clearRateLimit('login', req);
  auth.setSessionCookie(res, result.token);
  // Le jeton est aussi renvoyé pour un frontend cross-domaine, qui pourra le
  // stocker et l'envoyer via l'en-tête « Authorization: Bearer <token> ».
  res.json({
    token: result.token,
    user: {
      username: result.user.username,
      displayName: result.user.display_name || result.user.username,
      role: result.user.role,
    },
  });
});

app.post('/api/auth/logout', (req, res) => {
  const session = auth.currentSession(req);
  if (session) db.audit(session.username, 'deconnexion_admin', '', '', sso.clientIp(req));
  const token = auth.parseCookies(req)[auth.COOKIE];
  if (token) auth.logout(token);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const session = auth.currentSession(req);
  if (!session) return res.status(401).json({ error: 'Non authentifié' });
  res.json({
    user: {
      username: session.username,
      displayName: session.display_name || session.username,
      role: session.role,
    },
  });
});

// ---------------------------------------------------------------------------
// API d'administration (protégée)
// ---------------------------------------------------------------------------

app.get('/api/admin/stats', auth.requireApi, (req, res) => {
  res.json(stats.compute());
});

app.get('/api/admin/requests', auth.requireApi, (req, res) => {
  const rows = db.listAll().map((row) => {
    const appEntry = registry.get(row.app_id);
    return {
      id: row.id,
      reference: row.reference,
      app: appEntry ? appEntry.config.name : row.app_id,
      appId: row.app_id,
      type: row.request_type || 'creation',
      status: row.status,
      message: row.result_message,
      attempts: row.attempts,
      demandeur: row.demandeur,
      ssoEmail: row.sso_email || null,
      ip: row.client_ip || null,
      login: row.generated_login || null,
      payload: JSON.parse(row.payload),
      logs: JSON.parse(row.logs),
      artifacts: JSON.parse(row.artifacts || '[]'),
      emails: db.outboxForRequest(row.id).map((o) => ({ id: o.id, to: o.to_email, status: o.status, sentAt: o.sent_at })),
      credentialLink: (() => {
        const l = db.credentialLinkForRequest(row.id);
        if (!l) return null;
        return { viewedAt: l.viewed_at, viewedBy: l.viewed_by, expiresAt: l.expires_at, createdAt: l.created_at };
      })(),
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  });
  res.json({ stats: db.stats(), requests: rows });
});

// Régénère un lien d'identifiants (l'ancien est révoqué). Le nouveau lien est
// montré une seule fois à l'admin, pour transmission au bénéficiaire.
app.post('/api/admin/requests/:id/credential-link', auth.requireApi, (req, res) => {
  const row = db.getById(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Demande introuvable' });
  if (row.status !== 'terminee' || !row.generated_login) {
    return res.status(409).json({ error: 'Le compte de cette demande n\'a pas été créé' });
  }
  const link = credentials.createLink(
    row.id,
    row.generated_login,
    credentials.initialPasswordFor(row.app_id),
    req
  );
  db.audit(req.admin.username, 'lien_identifiants_regenere', row.reference, row.generated_login, sso.clientIp(req));
  res.json({ ok: true, url: link.url, expiresAt: link.expiresAt, ttlDays: link.ttlDays });
});

app.post('/api/admin/requests/:id/retry', auth.requireApi, (req, res) => {
  const ok = db.requeue(Number(req.params.id));
  if (!ok) return res.status(409).json({ error: 'Seule une demande en échec peut être relancée' });
  db.audit(req.admin.username, 'relance_demande', String(req.params.id));
  res.json({ ok: true });
});

// --- Éditeur de formulaires ------------------------------------------------

app.get('/api/admin/apps/:id/form', auth.requireApi, (req, res) => {
  const entry = registry.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Application inconnue' });
  res.json({
    appId: entry.config.id,
    name: entry.config.name,
    robotFields: entry.config.robotFields || [],
    baseSchema: entry.config.formSchema, // référence (non modifiable)
    overrides: db.getFormOverrides(entry.config.id),
    effective: effectiveSchema(entry.config), // rendu final (avec demandeur)
  });
});

app.put('/api/admin/apps/:id/form', auth.requireApi, (req, res) => {
  const entry = registry.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Application inconnue' });
  const overrides = req.body || {};
  const errors = validateOverrides(entry.config, overrides);
  if (errors.length) return res.status(422).json({ error: 'Surcharges invalides', details: errors });
  db.setFormOverrides(entry.config.id, overrides, req.admin.username);
  db.audit(req.admin.username, 'maj_formulaire', entry.config.id, overrides);
  res.json({ ok: true, effective: effectiveSchema(entry.config) });
});

// --- Éditeur de scénarios (étapes du robot) --------------------------------

app.get('/api/admin/apps/:id/scenario', auth.requireApi, (req, res) => {
  const entry = registry.getAvailable(req.params.id);
  if (!entry || !entry.automation) return res.status(404).json({ error: 'Scénario indisponible' });
  const stepsMeta = entry.automation.STEPS_META || [];
  res.json({
    appId: entry.config.id,
    name: entry.config.name,
    steps: stepsMeta,
    overrides: db.getScenarioOverrides(entry.config.id),
  });
});

app.put('/api/admin/apps/:id/scenario', auth.requireApi, (req, res) => {
  const entry = registry.getAvailable(req.params.id);
  if (!entry || !entry.automation) return res.status(404).json({ error: 'Scénario indisponible' });
  const stepsMeta = entry.automation.STEPS_META || [];
  const overrides = req.body || {};
  const errors = validateScenarioOverrides(stepsMeta, overrides);
  if (errors.length) return res.status(422).json({ error: 'Surcharges de scénario invalides', details: errors });
  db.setScenarioOverrides(entry.config.id, overrides, req.admin.username);
  db.audit(req.admin.username, 'maj_scenario', entry.config.id, overrides);
  res.json({ ok: true });
});

// --- Boîte d'envoi des e-mails ---------------------------------------------

app.get('/api/admin/emails', auth.requireApi, (req, res) => {
  res.json({
    smtp: mailer.smtpConfigured(),
    emails: db.listOutbox().map((o) => ({
      id: o.id,
      reference: o.reference,
      to: o.to_email,
      subject: o.subject,
      body: o.body_text,
      status: o.status,
      error: o.error,
      createdAt: o.created_at,
      sentAt: o.sent_at,
    })),
  });
});

app.post('/api/admin/emails/:id/resend', auth.requireApi, async (req, res) => {
  const mail = db.getOutbox(Number(req.params.id));
  if (!mail) return res.status(404).json({ error: 'E-mail introuvable' });
  await mailer.deliver(mail.id);
  db.audit(req.admin.username, 'renvoi_email', String(mail.id));
  res.json({ ok: true, smtp: mailer.smtpConfigured() });
});

app.post('/api/admin/emails/:id/mark-sent', auth.requireApi, (req, res) => {
  const mail = db.getOutbox(Number(req.params.id));
  if (!mail) return res.status(404).json({ error: 'E-mail introuvable' });
  db.setOutboxStatus(mail.id, 'envoye');
  db.audit(req.admin.username, 'email_marque_envoye', String(mail.id));
  res.json({ ok: true });
});

// --- Comptes admin ---------------------------------------------------------

app.get('/api/admin/users', auth.requireApi, (req, res) => {
  res.json({ me: req.admin.username, users: db.listAdmins().map((u) => ({ ...u, disabled: !!u.disabled })) });
});

app.post('/api/admin/users', auth.requireApi, (req, res) => {
  const { username, displayName, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) return res.status(422).json({ error: 'Identifiant invalide (3-40 car., lettres/chiffres/._-)' });
  if (String(password).length < 8) return res.status(422).json({ error: 'Mot de passe trop court (8 caractères minimum)' });
  if (db.getAdminByUsername(username)) return res.status(409).json({ error: 'Cet identifiant existe déjà' });
  const id = db.createAdmin(username, displayName || username, auth.hashPassword(String(password)), 'admin');
  db.audit(req.admin.username, 'creation_admin', username);
  res.status(201).json({ ok: true, id });
});

app.post('/api/admin/users/:id/password', auth.requireApi, (req, res) => {
  const user = db.getAdminById(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Compte introuvable' });
  const { password } = req.body || {};
  if (String(password || '').length < 8) return res.status(422).json({ error: 'Mot de passe trop court (8 caractères minimum)' });
  db.setAdminPassword(user.id, auth.hashPassword(String(password)));
  db.audit(req.admin.username, 'maj_mdp_admin', user.username);
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/disabled', auth.requireApi, (req, res) => {
  const user = db.getAdminById(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Compte introuvable' });
  const disabled = !!(req.body && req.body.disabled);
  if (disabled && db.countActiveAdmins() <= 1 && !user.disabled) {
    return res.status(409).json({ error: 'Impossible de désactiver le dernier administrateur actif' });
  }
  db.setAdminDisabled(user.id, disabled);
  db.audit(req.admin.username, disabled ? 'desactivation_admin' : 'reactivation_admin', user.username);
  res.json({ ok: true });
});

// --- Réglages & journal ----------------------------------------------------

app.get('/api/admin/settings', auth.requireApi, (req, res) => {
  const envSet = (name) => !!process.env[name];
  const apps = registry.publicList().map((a) => {
    const entry = registry.get(a.id);
    const prefix = a.id.toUpperCase();
    const vars = entry && !a.comingSoon ? [`${prefix}_URL`, `${prefix}_ADMIN_USER`, `${prefix}_ADMIN_PASSWORD`] : [];
    return {
      id: a.id,
      name: a.name,
      comingSoon: a.comingSoon,
      configured: vars.length > 0 && vars.every(envSet),
      vars: vars.map((v) => ({ name: v, set: envSet(v) })),
    };
  });
  // Détection du mot de passe par défaut « admin » (alerte de sécurité).
  const seedUser = db.getAdminByUsername('admin');
  const defaultAdminPassword = !!(seedUser && !seedUser.disabled && auth.verifyPassword('admin', seedUser.password_hash));
  res.json({
    automationMode: process.env.AUTOMATION_MODE === 'production' ? 'production' : 'demo',
    smtp: mailer.smtpConfigured(),
    sso: { configured: sso.configured(), required: sso.required(), tenant: process.env.M365_TENANT_ID || null },
    security: {
      defaultAdminPassword,
      cookieSecure: process.env.ADMIN_COOKIE_SECURE === 'true',
      https: req.headers['x-forwarded-proto'] === 'https' || req.secure,
    },
    apps,
  });
});

app.get('/api/admin/audit', auth.requireApi, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 300, 1000);
  res.json({ entries: db.listAudit(limit) });
});

app.get('/api/admin/accounts', auth.requireApi, (req, res) => {
  const accounts = db.listCreatedAccounts(300).map((a) => {
    const appEntry = registry.get(a.app_id);
    return {
      id: a.id,
      app: appEntry ? appEntry.config.name : a.app_id,
      login: a.login,
      nom: a.nom,
      prenom: a.prenom,
      reference: a.reference,
      createdAt: a.created_at,
    };
  });
  res.json({ accounts });
});

// ---------------------------------------------------------------------------

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

app.listen(PORT, () => {
  console.log(`Portail démarré : http://localhost:${PORT}`);
  worker.start();
});
