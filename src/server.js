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
const { augmentSchema, requesterLabel } = require('./schema');
const worker = require('./worker');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));

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
  const { id, name, category, description, icon, color, formSchema } = entry.config;
  res.json({ id, name, category, description, icon, color, schema: augmentSchema(formSchema) });
});

app.post('/api/apps/:id/requests', (req, res) => {
  const entry = registry.getAvailable(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Application inconnue ou indisponible' });

  const { data, errors } = validate(augmentSchema(entry.config.formSchema), req.body || {});
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
  res.json({
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
  res.json({ ok: true });
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
