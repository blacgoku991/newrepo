'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ARTIFACTS_DIR = path.join(DATA_DIR, 'artifacts');
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true, mode: 0o700 });

const DB_FILE = path.join(DATA_DIR, 'portail.db');
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

/**
 * La base contient des données personnelles (noms, identifiants, établissements)
 * et les secrets chiffrés des liens d'identifiants : elle ne doit être lisible
 * que par le compte qui fait tourner le portail. En mode WAL, les fichiers
 * annexes (-wal, -shm) portent les mêmes données : on les restreint aussi.
 * Best effort : sur un système de fichiers qui ne gère pas les permissions
 * POSIX (montage Windows), on n'échoue pas au démarrage pour autant.
 */
for (const fichier of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`, DATA_DIR, ARTIFACTS_DIR]) {
  try {
    if (fs.existsSync(fichier)) {
      fs.chmodSync(fichier, fs.statSync(fichier).isDirectory() ? 0o700 : 0o600);
    }
  } catch {
    /* permissions non gérées par ce système de fichiers */
  }
}

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

  -- Sessions SSO Microsoft 365 (accès au site public).
  CREATE TABLE IF NOT EXISTS sso_sessions (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    given_name TEXT NOT NULL DEFAULT '',
    family_name TEXT NOT NULL DEFAULT '',
    oid TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  -- Liens sécurisés de récupération d'identifiants (usage unique).
  -- Le jeton n'est stocké que haché ; le secret est chiffré (AES-256-GCM).
  CREATE TABLE IF NOT EXISTS credential_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    login TEXT NOT NULL,
    secret_enc TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    viewed_at TEXT,
    viewed_by TEXT NOT NULL DEFAULT '',
    viewed_ip TEXT NOT NULL DEFAULT '',
    revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_credlinks_request ON credential_links(request_id);

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

  -- Référents autorisés : personnes (compte Microsoft 365) habilitées à
  -- déposer des demandes pour un ou plusieurs établissements. Chaque référent
  -- dispose d'un espace personnel listant les comptes de ses établissements.
  CREATE TABLE IF NOT EXISTS referents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    nom TEXT NOT NULL DEFAULT '',
    prenom TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT NOT NULL DEFAULT ''
  );

  -- Établissements rattachés à un référent (relation n-n).
  -- etab_value = valeur de l'option « établissement » du formulaire (ex. « 24 »).
  CREATE TABLE IF NOT EXISTS referent_etablissements (
    referent_id INTEGER NOT NULL,
    app_id TEXT NOT NULL DEFAULT 'bluekango',
    etab_value TEXT NOT NULL,
    etab_label TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (referent_id, app_id, etab_value),
    FOREIGN KEY (referent_id) REFERENCES referents(id) ON DELETE CASCADE
  );

  -- Réglages divers du portail (clé -> valeur JSON), éditables depuis l'admin.
  -- Ex. « site_nav » : onglets visibles dans le menu du site public.
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT NOT NULL DEFAULT ''
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
// Traçabilité : identité SSO du déposant et adresse IP d'origine.
if (!columns.includes('sso_email')) {
  db.exec(`ALTER TABLE requests ADD COLUMN sso_email TEXT NOT NULL DEFAULT ''`);
}
if (!columns.includes('client_ip')) {
  db.exec(`ALTER TABLE requests ADD COLUMN client_ip TEXT NOT NULL DEFAULT ''`);
}
// Type de demande : creation (défaut) | reset_mdp (réinitialisation de mot de passe).
if (!columns.includes('request_type')) {
  db.exec(`ALTER TABLE requests ADD COLUMN request_type TEXT NOT NULL DEFAULT 'creation'`);
}
// Progression du traitement (étapes du robot) : done / total + libellé de l'étape.
if (!columns.includes('progress_done')) {
  db.exec(`ALTER TABLE requests ADD COLUMN progress_done INTEGER NOT NULL DEFAULT 0`);
}
if (!columns.includes('progress_total')) {
  db.exec(`ALTER TABLE requests ADD COLUMN progress_total INTEGER NOT NULL DEFAULT 0`);
}
if (!columns.includes('progress_label')) {
  db.exec(`ALTER TABLE requests ADD COLUMN progress_label TEXT NOT NULL DEFAULT ''`);
}
// Saisie d'un code OTP (double authentification, ex. NetSoins) : le robot se met
// en pause en attendant le code reçu par e-mail. awaiting_otp = 1 pendant
// l'attente ; otp_code = code fourni (par l'admin ou par la lecture auto).
if (!columns.includes('awaiting_otp')) {
  db.exec(`ALTER TABLE requests ADD COLUMN awaiting_otp INTEGER NOT NULL DEFAULT 0`);
}
if (!columns.includes('otp_code')) {
  db.exec(`ALTER TABLE requests ADD COLUMN otp_code TEXT NOT NULL DEFAULT ''`);
}
if (!columns.includes('otp_prompt')) {
  db.exec(`ALTER TABLE requests ADD COLUMN otp_prompt TEXT NOT NULL DEFAULT ''`);
}
// Registre des comptes : champs supplémentaires pour les comptes importés depuis
// une application (ex. export NetSoins). Champs MINIMAUX (RGPD) : e-mail pro,
// établissement de rattachement, profil, état actif — jamais d'adresse/téléphone
// personnels. `source` distingue les comptes créés par le robot des imports.
const accCols = db.prepare(`PRAGMA table_info(created_accounts)`).all().map((c) => c.name);
for (const [col, ddl] of [
  ['email', `ALTER TABLE created_accounts ADD COLUMN email TEXT NOT NULL DEFAULT ''`],
  ['etablissement', `ALTER TABLE created_accounts ADD COLUMN etablissement TEXT NOT NULL DEFAULT ''`],
  ['profil', `ALTER TABLE created_accounts ADD COLUMN profil TEXT NOT NULL DEFAULT ''`],
  ['actif', `ALTER TABLE created_accounts ADD COLUMN actif INTEGER NOT NULL DEFAULT 1`],
  ['source', `ALTER TABLE created_accounts ADD COLUMN source TEXT NOT NULL DEFAULT 'robot'`],
  ['updated_at', `ALTER TABLE created_accounts ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''`],
]) {
  if (!accCols.includes(col)) db.exec(ddl);
}
// Recherche des comptes par établissement (espace référent) sur un gros volume.
db.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_etab ON created_accounts (app_id, etablissement)`);

const auditCols = db.prepare(`PRAGMA table_info(audit_log)`).all().map((c) => c.name);
if (!auditCols.includes('ip')) {
  db.exec(`ALTER TABLE audit_log ADD COLUMN ip TEXT NOT NULL DEFAULT ''`);
}
const ssoCols = db.prepare(`PRAGMA table_info(sso_sessions)`).all().map((c) => c.name);
if (!ssoCols.includes('given_name')) {
  db.exec(`ALTER TABLE sso_sessions ADD COLUMN given_name TEXT NOT NULL DEFAULT ''`);
}
if (!ssoCols.includes('family_name')) {
  db.exec(`ALTER TABLE sso_sessions ADD COLUMN family_name TEXT NOT NULL DEFAULT ''`);
}
// Attributs d'annuaire portés par le jeton Microsoft (claims non standard :
// rôle, établissement…). Conservés tels quels pour l'attribution automatique
// des habilitations et pour le mode observation.
if (!ssoCols.includes('claims')) {
  db.exec(`ALTER TABLE sso_sessions ADD COLUMN claims TEXT NOT NULL DEFAULT '{}'`);
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

  createRequest(appId, prefix, payload, demandeur = '', ssoEmail = '', clientIp = '', type = 'creation') {
    const stmt = db.prepare(
      `INSERT INTO requests (reference, app_id, payload, demandeur, sso_email, client_ip, request_type) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    // La référence est aléatoire : on réessaie en cas de collision (extrêmement rare).
    for (let i = 0; i < 5; i++) {
      const reference = generateReference(prefix);
      try {
        stmt.run(reference, appId, JSON.stringify(payload), demandeur, ssoEmail, clientIp, type);
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
    // Une demande dont la « date de début du compte » est dans le futur reste en
    // file d'attente : le robot ne la traite qu'à partir de cette date.
    return db
      .prepare(
        `SELECT * FROM requests
          WHERE status = 'en_attente'
            AND (json_extract(payload, '$.date_debut') IS NULL
                 OR json_extract(payload, '$.date_debut') = ''
                 OR json_extract(payload, '$.date_debut') <= date('now'))
          ORDER BY id ASC LIMIT 1`
      )
      .get();
  },

  /**
   * Prend UNE demande en attente et la marque « en cours » dans la même
   * instruction. Indispensable dès que plusieurs robots tournent : entre un
   * SELECT et un UPDATE séparés, deux d'entre eux prendraient la même demande
   * et créeraient le compte en double.
   *
   * `appId` limite la prise à une application (une file par application).
   */
  claimNext(appId = null) {
    return db
      .prepare(
        `UPDATE requests
            SET status = 'en_cours', attempts = attempts + 1, started_at = datetime('now'),
                progress_done = 0, progress_total = 0, progress_label = '',
                awaiting_otp = 0, otp_code = '', otp_prompt = ''
          WHERE id = (
            SELECT id FROM requests
             WHERE status = 'en_attente'
               AND (@appId IS NULL OR app_id = @appId)
               AND (json_extract(payload, '$.date_debut') IS NULL
                    OR json_extract(payload, '$.date_debut') = ''
                    OR json_extract(payload, '$.date_debut') <= date('now'))
             ORDER BY id ASC LIMIT 1)
          RETURNING *`
      )
      .get({ appId });
  },

  /**
   * État de la file au démarrage : de quoi annoncer ce qui va être traité
   * avant de lancer quoi que ce soit. `programmees` = demandes dont la date de
   * début était dans le passé (déposées avant-hier pour aujourd'hui, par
   * exemple) : elles étaient en attente de leur date, elles sont dues.
   */
  backlog() {
    const base = `status = 'en_attente'`;
    const due = `(json_extract(payload, '$.date_debut') IS NULL
                  OR json_extract(payload, '$.date_debut') = ''
                  OR json_extract(payload, '$.date_debut') <= date('now'))`;
    const un = (sql, params = {}) => db.prepare(sql).get(params) || {};
    return {
      aTraiter: un(`SELECT COUNT(*) AS n FROM requests WHERE ${base} AND ${due}`).n || 0,
      programmees: un(
        `SELECT COUNT(*) AS n FROM requests WHERE ${base}
          AND json_extract(payload, '$.date_debut') IS NOT NULL
          AND json_extract(payload, '$.date_debut') <> ''
          AND json_extract(payload, '$.date_debut') <= date('now')`,
      ).n || 0,
      aVenir: un(
        `SELECT COUNT(*) AS n FROM requests WHERE ${base}
          AND json_extract(payload, '$.date_debut') > date('now')`,
      ).n || 0,
      plusAncienne: un(`SELECT MIN(created_at) AS d FROM requests WHERE ${base} AND ${due}`).d || null,
      parApp: db
        .prepare(`SELECT app_id, COUNT(*) AS n FROM requests WHERE ${base} AND ${due} GROUP BY app_id`)
        .all(),
    };
  },

  /** Applications ayant au moins une demande à traiter, les plus anciennes d'abord. */
  pendingAppIds() {
    return db
      .prepare(
        `SELECT app_id, COUNT(*) AS n, MIN(id) AS premier
           FROM requests
          WHERE status = 'en_attente'
            AND (json_extract(payload, '$.date_debut') IS NULL
                 OR json_extract(payload, '$.date_debut') = ''
                 OR json_extract(payload, '$.date_debut') <= date('now'))
          GROUP BY app_id
          ORDER BY premier ASC`
      )
      .all();
  },

  /**
   * Remet en file les demandes restées « en cours » sans robot pour les
   * traiter : le serveur a redémarré, ou le processus a été tué en plein vol.
   * Sans cela, elles resteraient bloquées indéfiniment dans un état trompeur.
   * `minutes = 0` reprend tout (au démarrage, aucun robot ne tourne encore).
   */
  requeueStale(minutes = 0, maxAttempts = 3) {
    const rows = db
      .prepare(
        `SELECT id, reference, attempts FROM requests
          WHERE status = 'en_cours'
            AND (@minutes = 0 OR started_at <= datetime('now', @fenetre))`
      )
      .all({ minutes, fenetre: `-${Number(minutes) || 0} minutes` });

    const relance = db.prepare(`UPDATE requests SET status = 'en_attente', started_at = NULL WHERE id = ?`);
    const abandon = db.prepare(
      `UPDATE requests SET status = 'echec', finished_at = datetime('now'),
              result_message = 'Interrompu à répétition (redémarrage ou blocage du robot)'
        WHERE id = ?`
    );
    const reprises = [];
    for (const r of rows) {
      // Une demande qui a déjà épuisé ses tentatives ne repart pas en boucle :
      // elle finirait par être reprise à chaque redémarrage, indéfiniment.
      if (r.attempts >= maxAttempts) { abandon.run(r.id); continue; }
      relance.run(r.id);
      reprises.push(r.reference);
    }
    return { reprises, abandons: rows.length - reprises.length };
  },

  markProcessing(id) {
    db.prepare(
      `UPDATE requests
         SET status = 'en_cours', attempts = attempts + 1, started_at = datetime('now'),
             progress_done = 0, progress_total = 0, progress_label = '',
             awaiting_otp = 0, otp_code = '', otp_prompt = ''
       WHERE id = ?`
    ).run(id);
  },

  /** Progression du robot (étape courante / total) pour l'affichage en direct. */
  setProgress(id, done, total, label = '') {
    db.prepare(
      `UPDATE requests SET progress_done = ?, progress_total = ?, progress_label = ? WHERE id = ?`
    ).run(Math.max(0, done | 0), Math.max(0, total | 0), String(label || ''), id);
  },

  /**
   * Le robot demande un code OTP : la demande passe « en attente de code ».
   * `prompt` = message affiché à l'admin (ex. « Code reçu sur la boîte X »).
   */
  requestOtp(id, prompt = '') {
    db.prepare(
      `UPDATE requests SET awaiting_otp = 1, otp_code = '', otp_prompt = ? WHERE id = ?`
    ).run(String(prompt || ''), id);
  },

  /**
   * Fournit le code OTP saisi (admin) ou lu automatiquement. Ne fait rien si la
   * demande n'attend pas de code. Renvoie true si le code a bien été enregistré.
   */
  submitOtp(id, code) {
    const info = db
      .prepare(`UPDATE requests SET otp_code = ?, awaiting_otp = 0 WHERE id = ? AND awaiting_otp = 1`)
      .run(String(code || ''), id);
    return info.changes > 0;
  },

  /** État de la saisie OTP (polling du robot + affichage admin). */
  otpState(id) {
    return db
      .prepare(`SELECT awaiting_otp, otp_code, otp_prompt FROM requests WHERE id = ?`)
      .get(id) || null;
  },

  /** Annule toute attente d'OTP (fin du scénario, timeout…). */
  clearOtp(id) {
    db.prepare(
      `UPDATE requests SET awaiting_otp = 0, otp_code = '', otp_prompt = '' WHERE id = ?`
    ).run(id);
  },

  markFinished(id, success, message, logs, artifacts = []) {
    db.prepare(
      `UPDATE requests
         SET status = ?, result_message = ?, logs = ?, artifacts = ?, finished_at = datetime('now'),
             awaiting_otp = 0, otp_code = ''
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

  /**
   * Renomme un compte du registre après correction d'identité : l'identifiant
   * de connexion suit le nouveau nom (1re lettre du prénom + nom). Sans ça,
   * l'ancien identifiant resterait affiché dans l'espace du référent et les
   * raccourcis pointeraient sur un compte qui n'existe plus.
   * Si le nouvel identifiant est déjà présent (ré-import), on garde une seule
   * ligne : l'ancienne est supprimée.
   */
  renameAccount(appId, ancienLogin, nouveauLogin, nom, prenom) {
    if (!ancienLogin || !nouveauLogin || ancienLogin === nouveauLogin) return;
    const tx = db.transaction(() => {
      if (api.loginExists(appId, nouveauLogin)) {
        db.prepare(`DELETE FROM created_accounts WHERE app_id = ? AND login = ?`).run(appId, ancienLogin);
        db.prepare(
          `UPDATE created_accounts SET nom = ?, prenom = ?, updated_at = datetime('now')
            WHERE app_id = ? AND login = ?`
        ).run(nom || '', prenom || '', appId, nouveauLogin);
        return;
      }
      db.prepare(
        `UPDATE created_accounts SET login = ?, nom = ?, prenom = ?, updated_at = datetime('now')
          WHERE app_id = ? AND login = ?`
      ).run(nouveauLogin, nom || '', prenom || '', appId, ancienLogin);
    });
    tx();
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

  /**
   * Enregistre/actualise un compte importé (ex. export NetSoins). Clé (app_id,
   * login) : un ré-import met à jour l'existant. Champs MINIMAUX uniquement.
   * @returns {'inserted'|'updated'}
   */
  upsertImportedAccount({ appId, login, nom = '', prenom = '', email = '', etablissement = '', profil = '', actif = 1 }) {
    const existed = api.loginExists(appId, login);
    db.prepare(
      `INSERT INTO created_accounts (app_id, login, nom, prenom, email, etablissement, profil, actif, source, updated_at)
         VALUES (@appId, @login, @nom, @prenom, @email, @etablissement, @profil, @actif, 'import', datetime('now'))
       ON CONFLICT(app_id, login) DO UPDATE SET
         nom = excluded.nom, prenom = excluded.prenom, email = excluded.email,
         etablissement = excluded.etablissement, profil = excluded.profil,
         actif = excluded.actif, source = 'import', updated_at = datetime('now')`
    ).run({ appId, login, nom, prenom, email, etablissement, profil, actif: actif ? 1 : 0 });
    return existed ? 'updated' : 'inserted';
  },

  /** Comptes du registre rattachés à un ensemble d'établissements (espace référent). */
  accountsForEtablissements(appId, etabValues) {
    const values = (etabValues || []).map(String).filter(Boolean);
    if (values.length === 0) return [];
    const placeholders = values.map(() => '?').join(',');
    return db
      .prepare(
        `SELECT * FROM created_accounts
          WHERE app_id = ? AND etablissement IN (${placeholders})
          ORDER BY nom, prenom`
      )
      .all(appId, ...values);
  },

  /**
   * Cherche un compte existant à DUPLIQUER : même établissement ET même profil
   * de droit (droits identiques). Sert à créer un nouveau compte par duplication
   * plutôt qu'en resaisissant tout le formulaire. Renvoie un compte actif ou null.
   */
  findAccountTemplate(appId, etablissement, profil) {
    if (!etablissement || !profil) return null;
    return db
      .prepare(
        `SELECT * FROM created_accounts
          WHERE app_id = ? AND etablissement = ? AND profil = ? AND actif = 1
          ORDER BY (source = 'import') DESC, id DESC
          LIMIT 1`
      )
      .get(appId, String(etablissement), String(profil)) || null;
  },

  /** Comptes importés par application (pour le récap admin). */
  countImportedAccounts(appId) {
    return db
      .prepare(`SELECT COUNT(*) AS n FROM created_accounts WHERE app_id = ? AND source = 'import'`)
      .get(appId).n;
  },

  // --- Statistiques détaillées (tableau de bord) ----------------------------

  /** Toutes les demandes, forme légère pour l'agrégation côté serveur. */
  allForStats() {
    return db
      .prepare(
        `SELECT app_id, demandeur, sso_email, request_type, status, payload,
                created_at, started_at, finished_at FROM requests`
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

  audit(admin, action, target = '', details = '', ip = '') {
    db.prepare(`INSERT INTO audit_log (admin, action, target, details, ip) VALUES (?, ?, ?, ?, ?)`)
      .run(admin, action, target, typeof details === 'string' ? details : JSON.stringify(details), ip || '');
  },

  listAudit(limit = 50) {
    return db.prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ?`).all(limit);
  },

  // --- Sessions SSO Microsoft 365 -------------------------------------------

  createSsoSession(token, email, name, oid, expiresAt, givenName = '', familyName = '', claims = {}) {
    db.prepare(
      `INSERT INTO sso_sessions (token, email, name, given_name, family_name, oid, expires_at, claims)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      token, email, name || '', givenName || '', familyName || '', oid || '', expiresAt,
      JSON.stringify(claims || {})
    );
  },

  getSsoSession(token) {
    return db
      .prepare(`SELECT * FROM sso_sessions WHERE token = ? AND expires_at > datetime('now')`)
      .get(token);
  },

  /**
   * Attributs d'annuaire observés dans les jetons récents. Sert au panneau
   * d'administration pour choisir sur quel attribut ouvrir l'accès : on ne
   * peut pas deviner ce que le tenant du client émet, il faut le regarder.
   */
  recentSsoClaims(limit = 200) {
    return db
      .prepare(`SELECT email, name, claims, created_at FROM sso_sessions ORDER BY created_at DESC LIMIT ?`)
      .all(limit);
  },

  deleteSsoSession(token) {
    db.prepare(`DELETE FROM sso_sessions WHERE token = ?`).run(token);
  },

  purgeExpiredSsoSessions() {
    db.prepare(`DELETE FROM sso_sessions WHERE expires_at <= datetime('now')`).run();
  },

  // --- Liens de récupération d'identifiants ---------------------------------

  createCredentialLink(requestId, tokenHash, login, secretEnc, expiresAt) {
    // Un seul lien actif par demande : les précédents sont révoqués.
    db.prepare(`UPDATE credential_links SET revoked = 1 WHERE request_id = ?`).run(requestId);
    const info = db
      .prepare(
        `INSERT INTO credential_links (request_id, token_hash, login, secret_enc, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(requestId, tokenHash, login, secretEnc, expiresAt);
    return info.lastInsertRowid;
  },

  getCredentialLinkByHash(tokenHash) {
    return db.prepare(`SELECT * FROM credential_links WHERE token_hash = ?`).get(tokenHash);
  },

  markCredentialLinkViewed(id, viewer, ip) {
    db.prepare(
      `UPDATE credential_links SET viewed_at = datetime('now'), viewed_by = ?, viewed_ip = ? WHERE id = ?`
    ).run(viewer || '', ip || '', id);
  },

  credentialLinkForRequest(requestId) {
    return db
      .prepare(
        `SELECT id, created_at, expires_at, viewed_at, viewed_by, revoked
           FROM credential_links WHERE request_id = ? AND revoked = 0 ORDER BY id DESC LIMIT 1`
      )
      .get(requestId);
  },

  /** Secret chiffré du dernier lien d'une demande (pour régénérer avec le MÊME mot de passe). */
  lastCredentialSecret(requestId) {
    const row = db
      .prepare(`SELECT secret_enc FROM credential_links WHERE request_id = ? ORDER BY id DESC LIMIT 1`)
      .get(requestId);
    return row ? row.secret_enc : null;
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

  // --- Référents autorisés & espace personnel -------------------------------

  countReferents() {
    return db.prepare(`SELECT COUNT(*) AS n FROM referents WHERE active = 1`).get().n;
  },

  /** Établissements d'un référent, forme légère. */
  referentEtablissements(referentId) {
    return db
      .prepare(`SELECT app_id, etab_value, etab_label FROM referent_etablissements WHERE referent_id = ?`)
      .all(referentId)
      .map((r) => ({ appId: r.app_id, value: r.etab_value, label: r.etab_label }));
  },

  /** Référent (avec ses établissements) par adresse e-mail, insensible à la casse. */
  getReferentByEmail(email) {
    const row = db
      .prepare(`SELECT * FROM referents WHERE email = ? COLLATE NOCASE`)
      .get(String(email || '').toLowerCase());
    if (!row) return null;
    return { ...row, active: !!row.active, etablissements: api.referentEtablissements(row.id) };
  },

  getReferentById(id) {
    const row = db.prepare(`SELECT * FROM referents WHERE id = ?`).get(id);
    if (!row) return null;
    return { ...row, active: !!row.active, etablissements: api.referentEtablissements(row.id) };
  },

  listReferents() {
    return db
      .prepare(`SELECT * FROM referents ORDER BY nom, prenom, email`)
      .all()
      .map((r) => ({ ...r, active: !!r.active, etablissements: api.referentEtablissements(r.id) }));
  },

  /** Crée un référent et rattache ses établissements. `etabs` = [{appId,value,label}]. */
  createReferent(email, nom, prenom, etabs, createdBy) {
    const insert = db.transaction(() => {
      const info = db
        .prepare(`INSERT INTO referents (email, nom, prenom, created_by) VALUES (?, ?, ?, ?)`)
        .run(String(email).toLowerCase(), nom || '', prenom || '', createdBy || '');
      api._replaceReferentEtabs(info.lastInsertRowid, etabs);
      return info.lastInsertRowid;
    });
    return insert();
  },

  updateReferent(id, { nom, prenom, active, etabs }) {
    const tx = db.transaction(() => {
      db.prepare(`UPDATE referents SET nom = ?, prenom = ?, active = ? WHERE id = ?`)
        .run(nom || '', prenom || '', active ? 1 : 0, id);
      if (Array.isArray(etabs)) api._replaceReferentEtabs(id, etabs);
    });
    tx();
  },

  _replaceReferentEtabs(referentId, etabs) {
    db.prepare(`DELETE FROM referent_etablissements WHERE referent_id = ?`).run(referentId);
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO referent_etablissements (referent_id, app_id, etab_value, etab_label) VALUES (?, ?, ?, ?)`
    );
    for (const e of etabs || []) {
      if (!e || !e.value) continue;
      stmt.run(referentId, e.appId || 'bluekango', String(e.value), e.label || '');
    }
  },

  deleteReferent(id) {
    db.prepare(`DELETE FROM referents WHERE id = ?`).run(id);
  },

  /**
   * Demandes rattachées à un ensemble d'établissements (par la valeur du champ
   * « etablissement » du payload), pour l'espace d'un référent. Les valeurs
   * sont bornées à `appId`.
   */
  requestsForEtablissements(appId, etabValues) {
    const values = (etabValues || []).map(String).filter(Boolean);
    if (values.length === 0) return [];
    const placeholders = values.map(() => '?').join(',');
    return db
      .prepare(
        `SELECT * FROM requests
          WHERE app_id = ?
            AND json_extract(payload, '$.etablissement') IN (${placeholders})
          ORDER BY id DESC`
      )
      .all(appId, ...values);
  },

  // --- Réglages du portail (clé/valeur JSON) --------------------------------

  getSetting(key, fallback = null) {
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return fallback; }
  },

  setSetting(key, value, by = '') {
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')`
    ).run(key, JSON.stringify(value), by);
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
