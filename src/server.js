'use strict';

// Charge le fichier .env AVANT tout module qui lit process.env.
require('./loadEnv').loadEnv();

const path = require('path');
const express = require('express');

const db = require('./db');
const registry = require('./registry');
const auth = require('./auth');
const stats = require('./stats');
const { validate } = require('./validate');
const { augmentSchema, effectiveSchema, validateOverrides, requesterLabel } = require('./schema');
const { validateScenarioOverrides } = require('./automation/scenarioRuntime');
const mailer = require('./mailer');
const worker = require('./worker');

const app = express();
const PORT = Number(process.env.PORT || 3000);

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

// Compte administrateur initial + purge des sessions expirées au démarrage.
auth.ensureSeedAdmin();
db.purgeExpiredSessions();

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

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

app.get('/api/apps', (req, res) => {
  res.json(registry.publicList());
});

app.get('/api/apps/:id/schema', (req, res) => {
  const entry = registry.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Application inconnue' });
  if (entry.config.comingSoon) {
    return res.status(409).json({ error: 'Application bientôt disponible' });
  }
  const { id, name, category, description, icon, color, logo } = entry.config;
  res.json({ id, name, category, description, icon, color, logo: logo || null, schema: effectiveSchema(entry.config) });
});

app.post('/api/apps/:id/requests', (req, res) => {
  const entry = registry.getAvailable(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Application inconnue ou indisponible' });

  const { data, errors } = validate(effectiveSchema(entry.config), req.body || {});
  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ error: 'Formulaire invalide', fields: errors });
  }

  const demandeur = requesterLabel(data);
  const reference = db.createRequest(entry.config.id, entry.config.referencePrefix, data, demandeur);
  res.status(201).json({ reference });
});

// Suivi public d'une demande par sa référence (informations limitées).
app.get('/api/requests/:reference', (req, res) => {
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

// ---------------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------------

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
  }
  const result = auth.login(String(username).trim(), String(password));
  if (!result) return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
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
      status: row.status,
      message: row.result_message,
      attempts: row.attempts,
      demandeur: row.demandeur,
      payload: JSON.parse(row.payload),
      logs: JSON.parse(row.logs),
      artifacts: JSON.parse(row.artifacts || '[]'),
      emails: db.outboxForRequest(row.id).map((o) => ({ id: o.id, to: o.to_email, status: o.status, sentAt: o.sent_at })),
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  });
  res.json({ stats: db.stats(), requests: rows });
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
  if (String(password).length < 6) return res.status(422).json({ error: 'Mot de passe trop court (6 caractères minimum)' });
  if (db.getAdminByUsername(username)) return res.status(409).json({ error: 'Cet identifiant existe déjà' });
  const id = db.createAdmin(username, displayName || username, auth.hashPassword(String(password)), 'admin');
  db.audit(req.admin.username, 'creation_admin', username);
  res.status(201).json({ ok: true, id });
});

app.post('/api/admin/users/:id/password', auth.requireApi, (req, res) => {
  const user = db.getAdminById(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Compte introuvable' });
  const { password } = req.body || {};
  if (String(password || '').length < 6) return res.status(422).json({ error: 'Mot de passe trop court (6 caractères minimum)' });
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
  res.json({
    automationMode: process.env.AUTOMATION_MODE === 'production' ? 'production' : 'demo',
    smtp: mailer.smtpConfigured(),
    apps,
  });
});

app.get('/api/admin/audit', auth.requireApi, (req, res) => {
  res.json({ entries: db.listAudit(80) });
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
