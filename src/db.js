'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'portail.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    app_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'en_attente',
    result_message TEXT,
    logs TEXT NOT NULL DEFAULT '[]',
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    finished_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
  CREATE INDEX IF NOT EXISTS idx_requests_app ON requests(app_id);
`);

// Une demande interrompue en plein traitement (crash / redémarrage) repart en file d'attente.
db.prepare(`UPDATE requests SET status = 'en_attente' WHERE status = 'en_cours'`).run();

function generateReference(prefix) {
  const now = new Date();
  const ymd = now.toISOString().slice(2, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${ymd}-${rand}`;
}

const api = {
  createRequest(appId, prefix, payload) {
    const stmt = db.prepare(
      `INSERT INTO requests (reference, app_id, payload) VALUES (?, ?, ?)`
    );
    // La référence est aléatoire : on réessaie en cas de collision (extrêmement rare).
    for (let i = 0; i < 5; i++) {
      const reference = generateReference(prefix);
      try {
        stmt.run(reference, appId, JSON.stringify(payload));
        return reference;
      } catch (err) {
        if (!String(err.message).includes('UNIQUE')) throw err;
      }
    }
    throw new Error('Impossible de générer une référence unique');
  },

  getByReference(reference) {
    return db.prepare(`SELECT * FROM requests WHERE reference = ?`).get(reference);
  },

  getById(id) {
    return db.prepare(`SELECT * FROM requests WHERE id = ?`).get(id);
  },

  listAll() {
    return db.prepare(`SELECT * FROM requests ORDER BY id DESC`).all();
  },

  nextPending() {
    return db
      .prepare(`SELECT * FROM requests WHERE status = 'en_attente' ORDER BY id ASC LIMIT 1`)
      .get();
  },

  markProcessing(id) {
    db.prepare(
      `UPDATE requests
         SET status = 'en_cours', attempts = attempts + 1, started_at = datetime('now')
       WHERE id = ?`
    ).run(id);
  },

  markFinished(id, success, message, logs) {
    db.prepare(
      `UPDATE requests
         SET status = ?, result_message = ?, logs = ?, finished_at = datetime('now')
       WHERE id = ?`
    ).run(success ? 'terminee' : 'echec', message, JSON.stringify(logs), id);
  },

  requeue(id) {
    const row = api.getById(id);
    if (!row || row.status !== 'echec') return false;
    db.prepare(
      `UPDATE requests
         SET status = 'en_attente', result_message = NULL, started_at = NULL, finished_at = NULL
       WHERE id = ?`
    ).run(id);
    return true;
  },

  stats() {
    const rows = db
      .prepare(`SELECT status, COUNT(*) AS n FROM requests GROUP BY status`)
      .all();
    const out = { en_attente: 0, en_cours: 0, terminee: 0, echec: 0, total: 0 };
    for (const r of rows) {
      out[r.status] = r.n;
      out.total += r.n;
    }
    return out;
  },
};

module.exports = api;
