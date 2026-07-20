'use strict';

const path = require('path');
const express = require('express');

const db = require('./db');
const registry = require('./registry');
const { validate } = require('./validate');
const worker = require('./worker');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

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
  res.json({ id, name, category, description, icon, color, schema: formSchema });
});

app.post('/api/apps/:id/requests', (req, res) => {
  const entry = registry.getAvailable(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Application inconnue ou indisponible' });

  const { data, errors } = validate(entry.config.formSchema, req.body || {});
  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ error: 'Formulaire invalide', fields: errors });
  }

  const reference = db.createRequest(entry.config.id, entry.config.referencePrefix, data);
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
// API d'administration (tableau de bord)
// ---------------------------------------------------------------------------

app.get('/api/admin/requests', (req, res) => {
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
      payload: JSON.parse(row.payload),
      logs: JSON.parse(row.logs),
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  });
  res.json({ stats: db.stats(), requests: rows });
});

app.post('/api/admin/requests/:id/retry', (req, res) => {
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
