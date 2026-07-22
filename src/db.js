'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ARTIFACTS_DIR = path.join(DATA_DIR, 'artifacts');
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'portail.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    app_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    demandeur TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'en_attente',
    result_message TEXT,
    logs TEXT NOT NULL DEFAULT '[]',
    artifacts TEXT NOT NULL DEFAULT '[]',
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    finished_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
  CREATE INDEX IF NOT EXISTS idx_requests_app ON requests(app_id);

  -- Comptes créés par le robot dans l'application de démonstration intégrée.
  CREATE TABLE IF NOT EXISTS demo_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Comptes d'administration du portail (accès au tableau de bord sécurisé).
  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login TEXT
  );

  -- Sessions d'administration (cookie -> utilisateur).
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
  );

  -- Surcharges des formulaires, éditées depuis le panel admin.
  -- data (JSON) : { patches:{champ:{...}}, hidden:[champ], added:[{section,field}], order:{section:[champs]} }
  CREATE TABLE IF NOT EXISTS form_overrides (
    app_id TEXT PRIMARY KEY,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT NOT NULL DEFAULT ''
  );

  -- Surcharges des scénarios du robot, éditées depuis le panel admin.
  -- data (JSON) : { disabled:[stepId], selectors:{chemin:valeur}, custom:[{id,after,label,action,selector,value,sourceField}] }
  CREATE TABLE IF NOT EXISTS scenario_overrides (
    app_id TEXT PRIMARY KEY,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT NOT NULL DEFAULT ''
  );

  -- Journal des modifications faites dans l'admin (qui, quand, quoi).
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Comptes réellement créés par le robot (pour l'unicité des identifiants
  -- et la visibilité côté admin). L'identifiant est unique par application.
  CREATE TABLE IF NOT EXISTS created_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id TEXT NOT NULL,
    login TEXT NOT NULL,
    nom TEXT NOT NULL DEFAULT '',
    prenom TEXT NOT NULL DEFAULT '',
    reference TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (app_id, login)
  );

  -- Boîte d'envoi des e-mails d'identifiants.
  CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'a_envoyer',  -- a_envoyer | envoye | erreur
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at TEXT
  );
`);

// Migration : ajoute les colonnes récentes aux bases créées avant leur introduction.
const columns = db.prepare(`PRAGMA table_info(requests)`).all().map((c) => c.name);
if (!columns.includes('artifacts')) {
  db.exec(`ALTER TABLE requests ADD COLUMN artifacts TEXT NOT NULL DEFAULT '[]'`);
}
if (!columns.includes('demandeur')) {
  db.exec(`ALTER TABLE requests ADD COLUMN demandeur TEXT NOT NULL DEFAULT ''`);
}
const adminCols = db.prepare(`PRAGMA table_info(admin_users)`).all().map((c) => c.name);
if (!adminCols.includes('disabled')) {
  db.exec(`ALTER TABLE admin_users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0`);
}
if (!columns.includes('generated_login')) {
  db.exec(`ALTER TABLE requests ADD COLUMN generated_login TEXT NOT NULL DEFAULT ''`);
}

// Une demande interrompue en plein traitement (crash / redémarrage) repart en file d'attente.
db.prepare(`UPDATE requests SET status = 'en_attente' WHERE status = 'en_cours'`).run();

function generateReference(prefix) {
  const now = new Date();
  const ymd = now.toISOString().slice(2, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${ymd}-${rand}`;
}

const api = {
  ARTIFACTS_DIR,

  createRequest(appId, prefix, payload, demandeur = '') {
    const stmt = db.prepare(
      `INSERT INTO requests (reference, app_id, payload, demandeur) VALUES (?, ?, ?, ?)`
    );
    // La référence est aléatoire : on réessaie en cas de collision (extrêmement rare).
    for (let i = 0; i < 5; i++) {
      const reference = generateReference(prefix);
      try {
        stmt.run(reference, appId, JSON.stringify(payload), demandeur);
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

  markFinished(id, success, message, logs, artifacts = []) {
    db.prepare(
      `UPDATE requests
         SET status = ?, result_message = ?, logs = ?, artifacts = ?, finished_at = datetime('now')
       WHERE id = ?`
    ).run(success ? 'terminee' : 'echec', message, JSON.stringify(logs), JSON.stringify(artifacts), id);
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

  // --- Comptes créés & identifiants uniques ---------------------------------

  loginExists(appId, login) {
    return !!db
      .prepare(`SELECT 1 FROM created_accounts WHERE app_id = ? AND login = ?`)
      .get(appId, login);
  },

  recordAccount(appId, login, nom, prenom, reference) {
    db.prepare(
      `INSERT OR IGNORE INTO created_accounts (app_id, login, nom, prenom, reference) VALUES (?, ?, ?, ?, ?)`
    ).run(appId, login, nom || '', prenom || '', reference || '');
  },

  setRequestLogin(id, login) {
    db.prepare(`UPDATE requests SET generated_login = ? WHERE id = ?`).run(login || '', id);
  },

  listCreatedAccounts(limit = 200) {
    return db.prepare(`SELECT * FROM created_accounts ORDER BY id DESC LIMIT ?`).all(limit);
  },

  // --- Statistiques détaillées (tableau de bord) ----------------------------

  /** Toutes les demandes, forme légère pour l'agrégation côté serveur. */
  allForStats() {
    return db
      .prepare(
        `SELECT app_id, demandeur, status, payload, created_at, finished_at FROM requests`
      )
      .all();
  },

  // --- Administration : utilisateurs & sessions -----------------------------

  countAdmins() {
    return db.prepare(`SELECT COUNT(*) AS n FROM admin_users`).get().n;
  },

  createAdmin(username, displayName, passwordHash, role = 'admin') {
    const info = db
      .prepare(
        `INSERT INTO admin_users (username, display_name, password_hash, role)
         VALUES (?, ?, ?, ?)`
      )
      .run(username, displayName, passwordHash, role);
    return info.lastInsertRowid;
  },

  getAdminByUsername(username) {
    return db.prepare(`SELECT * FROM admin_users WHERE username = ?`).get(username);
  },

  getAdminById(id) {
    return db.prepare(`SELECT * FROM admin_users WHERE id = ?`).get(id);
  },

  listAdmins() {
    return db
      .prepare(`SELECT id, username, display_name, role, created_at, last_login FROM admin_users ORDER BY id ASC`)
      .all();
  },

  touchAdminLogin(id) {
    db.prepare(`UPDATE admin_users SET last_login = datetime('now') WHERE id = ?`).run(id);
  },

  setAdminPassword(id, passwordHash) {
    db.prepare(`UPDATE admin_users SET password_hash = ? WHERE id = ?`).run(passwordHash, id);
  },

  createSession(token, userId, expiresAt) {
    db.prepare(
      `INSERT INTO admin_sessions (token, user_id, expires_at) VALUES (?, ?, ?)`
    ).run(token, userId, expiresAt);
  },

  getSession(token) {
    return db
      .prepare(
        `SELECT s.token, s.user_id, s.expires_at, u.username, u.display_name, u.role
           FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
          WHERE s.token = ? AND s.expires_at > datetime('now')`
      )
      .get(token);
  },

  deleteSession(token) {
    db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).run(token);
  },

  purgeExpiredSessions() {
    db.prepare(`DELETE FROM admin_sessions WHERE expires_at <= datetime('now')`).run();
  },

  // --- Surcharges (éditeurs du panel admin) ---------------------------------

  getFormOverrides(appId) {
    const row = db.prepare(`SELECT data FROM form_overrides WHERE app_id = ?`).get(appId);
    try { return row ? JSON.parse(row.data) : {}; } catch { return {}; }
  },

  setFormOverrides(appId, data, admin) {
    db.prepare(
      `INSERT INTO form_overrides (app_id, data, updated_at, updated_by)
       VALUES (?, ?, datetime('now'), ?)
       ON CONFLICT(app_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at, updated_by=excluded.updated_by`
    ).run(appId, JSON.stringify(data), admin);
  },

  getScenarioOverrides(appId) {
    const row = db.prepare(`SELECT data FROM scenario_overrides WHERE app_id = ?`).get(appId);
    try { return row ? JSON.parse(row.data) : {}; } catch { return {}; }
  },

  setScenarioOverrides(appId, data, admin) {
    db.prepare(
      `INSERT INTO scenario_overrides (app_id, data, updated_at, updated_by)
       VALUES (?, ?, datetime('now'), ?)
       ON CONFLICT(app_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at, updated_by=excluded.updated_by`
    ).run(appId, JSON.stringify(data), admin);
  },

  audit(admin, action, target = '', details = '') {
    db.prepare(`INSERT INTO audit_log (admin, action, target, details) VALUES (?, ?, ?, ?)`)
      .run(admin, action, target, typeof details === 'string' ? details : JSON.stringify(details));
  },

  listAudit(limit = 50) {
    return db.prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ?`).all(limit);
  },

  // --- Boîte d'envoi des e-mails --------------------------------------------

  createOutbox(requestId, toEmail, subject, bodyText) {
    const info = db
      .prepare(`INSERT INTO outbox (request_id, to_email, subject, body_text) VALUES (?, ?, ?, ?)`)
      .run(requestId, toEmail, subject, bodyText);
    return info.lastInsertRowid;
  },

  getOutbox(id) {
    return db.prepare(`SELECT * FROM outbox WHERE id = ?`).get(id);
  },

  listOutbox() {
    return db
      .prepare(
        `SELECT o.*, r.reference FROM outbox o LEFT JOIN requests r ON r.id = o.request_id ORDER BY o.id DESC LIMIT 200`
      )
      .all();
  },

  outboxForRequest(requestId) {
    return db.prepare(`SELECT * FROM outbox WHERE request_id = ? ORDER BY id DESC`).all(requestId);
  },

  setOutboxStatus(id, status, error = null) {
    db.prepare(
      `UPDATE outbox SET status = ?, error = ?, sent_at = CASE WHEN ? = 'envoye' THEN datetime('now') ELSE sent_at END WHERE id = ?`
    ).run(status, error, status, id);
  },

  // --- Comptes admin (gestion) ----------------------------------------------

  setAdminDisabled(id, disabled) {
    db.prepare(`UPDATE admin_users SET disabled = ? WHERE id = ?`).run(disabled ? 1 : 0, id);
  },

  countActiveAdmins() {
    return db.prepare(`SELECT COUNT(*) AS n FROM admin_users WHERE disabled = 0`).get().n;
  },

  // --- Application de démonstration -----------------------------------------

  createDemoAccount(appId, payload) {
    const info = db
      .prepare(`INSERT INTO demo_accounts (app_id, payload) VALUES (?, ?)`)
      .run(appId, JSON.stringify(payload));
    return info.lastInsertRowid;
  },

  listDemoAccounts(appId) {
    return db
      .prepare(`SELECT * FROM demo_accounts WHERE app_id = ? ORDER BY id DESC`)
      .all(appId);
  },
};

module.exports = api;
