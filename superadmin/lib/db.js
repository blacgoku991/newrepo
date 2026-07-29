'use strict';

/**
 * Registre Smartfixx : sociétés clientes, licences émises, journal.
 *
 * Base SÉPARÉE de celles des instances clientes. Elle ne contient aucune donnée
 * métier (ni salarié, ni compte créé) : uniquement le commercial et le
 * contractuel. Une fuite ici serait fâcheuse, jamais une fuite de données de
 * santé.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const DOSSIER = process.env.SMARTFIXX_DIR || path.join(os.homedir(), '.smartfixx');
fs.mkdirSync(DOSSIER, { recursive: true, mode: 0o700 });

const FICHIER = path.join(DOSSIER, 'smartfixx.db');
const db = new Database(FICHIER);
db.pragma('journal_mode = WAL');
for (const f of [FICHIER, `${FICHIER}-wal`, `${FICHIER}-shm`, DOSSIER]) {
  try {
    if (fs.existsSync(f)) fs.chmodSync(f, fs.statSync(f).isDirectory() ? 0o700 : 0o600);
  } catch { /* permissions non gérées */ }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS societes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL UNIQUE,
    contact_nom TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    -- Instance dédiée à cette société (une par client : cloisonnement par
    -- construction). Renseignée à la mise en service.
    -- Sous-domaine servi : adef → https://adef.smartfixx.fr
    sous_domaine TEXT NOT NULL DEFAULT '',
    instance_url TEXT NOT NULL DEFAULT '',
    instance_port INTEGER,
    archivee INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Historique COMPLET des licences : on n'écrase jamais, on ajoute. Savoir ce
  -- qui a été émis, quand et par qui est la seule défense en cas de litige.
  CREATE TABLE IF NOT EXISTS licences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    societe_id INTEGER NOT NULL,
    jeton TEXT NOT NULL,
    client TEXT NOT NULL,
    debut TEXT NOT NULL,
    fin TEXT NOT NULL,
    grace INTEGER,
    motif TEXT NOT NULL DEFAULT '',      -- creation | renouvellement
    revoquee_le TEXT,
    revoquee_motif TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (societe_id) REFERENCES societes(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_licences_societe ON licences(societe_id);

  CREATE TABLE IF NOT EXISTS operateurs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES operateurs(id) ON DELETE CASCADE
  );

  -- Réglages d'une société, chiffrés. Le panel ne les rend jamais en clair.
  CREATE TABLE IF NOT EXISTS reglages (
    societe_id INTEGER NOT NULL,
    cle TEXT NOT NULL,
    valeur TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (societe_id, cle),
    FOREIGN KEY (societe_id) REFERENCES societes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    acteur TEXT NOT NULL,
    action TEXT NOT NULL,
    cible TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migration des registres créés avant le routage par sous-domaine.
const colonnes = db.prepare(`PRAGMA table_info(societes)`).all().map((c) => c.name);
if (!colonnes.includes('sous_domaine')) {
  db.exec(`ALTER TABLE societes ADD COLUMN sous_domaine TEXT NOT NULL DEFAULT ''`);
}
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_societes_sd
           ON societes(sous_domaine) WHERE sous_domaine <> ''`);

const jourISO = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * Sous-domaine à partir du nom : « ADEF Résidences » → « adef-residences ».
 * Seuls les caractères d'un nom d'hôte sont conservés.
 */
function slug(nom) {
  return String(nom || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

module.exports = {
  FICHIER,

  // --- Sociétés --------------------------------------------------------------

  slug,

  societeParSousDomaine(sd) {
    return db.prepare(`SELECT * FROM societes WHERE sous_domaine = ? AND sous_domaine <> ''`).get(sd);
  },

  creerSociete({ nom, contactNom, contactEmail, notes, instanceUrl, instancePort, sousDomaine }) {
    const info = db
      .prepare(`INSERT INTO societes (nom, contact_nom, contact_email, notes, instance_url, instance_port, sous_domaine)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(nom, contactNom || '', contactEmail || '', notes || '', instanceUrl || '', instancePort || null, sousDomaine || '');
    return info.lastInsertRowid;
  },

  majSociete(id, { nom, contactNom, contactEmail, notes, instanceUrl, instancePort, sousDomaine }) {
    const actuelle = db.prepare(`SELECT sous_domaine FROM societes WHERE id = ?`).get(id) || {};
    db.prepare(`UPDATE societes SET nom = ?, contact_nom = ?, contact_email = ?, notes = ?,
                       instance_url = ?, instance_port = ?, sous_domaine = ? WHERE id = ?`)
      .run(nom, contactNom || '', contactEmail || '', notes || '', instanceUrl || '', instancePort || null,
           sousDomaine === undefined ? actuelle.sous_domaine || '' : sousDomaine, id);
  },

  archiverSociete(id, archivee) {
    db.prepare(`UPDATE societes SET archivee = ? WHERE id = ?`).run(archivee ? 1 : 0, id);
  },

  societe(id) {
    return db.prepare(`SELECT * FROM societes WHERE id = ?`).get(id);
  },

  /**
   * Efface une société du registre, avec ses licences et ses réglages.
   *
   * Irréversible, et volontairement séparé de l'archivage : archiver ferme
   * l'accès, effacer supprime la trace. Le journal, lui, n'est pas touché —
   * c'est ce qui permet de dire plus tard qui a effacé quoi, et quand.
   * Les données du portail (sa base) sont retirées à part par l'appelant.
   */
  supprimerSociete(id) {
    const effacer = db.transaction((societeId) => {
      db.prepare(`DELETE FROM licences WHERE societe_id = ?`).run(societeId);
      db.prepare(`DELETE FROM reglages WHERE societe_id = ?`).run(societeId);
      db.prepare(`DELETE FROM societes WHERE id = ?`).run(societeId);
    });
    effacer(id);
  },

  societeParNom(nom) {
    return db.prepare(`SELECT * FROM societes WHERE nom = ?`).get(nom);
  },

  /**
   * Toutes les sociétés avec leur licence COURANTE.
   *
   * La licence courante est la dernière émise et non révoquée. Une licence
   * révoquée ne compte plus, même si sa date de fin est encore lointaine.
   */
  vue() {
    const societes = db.prepare(`SELECT * FROM societes ORDER BY archivee ASC, nom ASC`).all();
    const courantes = db.prepare(
      `SELECT * FROM licences WHERE societe_id = ? AND revoquee_le IS NULL ORDER BY fin DESC, id DESC LIMIT 1`
    );
    const compte = db.prepare(`SELECT COUNT(*) n FROM licences WHERE societe_id = ?`);
    const aujourdhui = jourISO(Date.now());
    return societes.map((s) => {
      const lic = courantes.get(s.id) || null;
      const joursRestants = lic ? Math.ceil((new Date(lic.fin + 'T00:00:00Z') - new Date(aujourdhui + 'T00:00:00Z')) / 86400000) : null;
      return {
        id: s.id,
        nom: s.nom,
        contactNom: s.contact_nom,
        contactEmail: s.contact_email,
        notes: s.notes,
        sousDomaine: s.sous_domaine,
        instanceUrl: s.instance_url,
        instancePort: s.instance_port,
        archivee: !!s.archivee,
        creeeLe: s.created_at,
        licence: lic
          ? { id: lic.id, debut: lic.debut, fin: lic.fin, grace: lic.grace, emiseLe: lic.created_at, joursRestants }
          : null,
        nbLicences: compte.get(s.id).n,
      };
    });
  },

  // --- Licences --------------------------------------------------------------

  ajouterLicence(societeId, { jeton, client, debut, fin, grace, motif, par }) {
    const info = db
      .prepare(`INSERT INTO licences (societe_id, jeton, client, debut, fin, grace, motif, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(societeId, jeton, client, debut, fin, Number.isFinite(grace) ? grace : null, motif || 'creation', par || '');
    return info.lastInsertRowid;
  },

  licences(societeId) {
    return db.prepare(`SELECT * FROM licences WHERE societe_id = ? ORDER BY id DESC`).all(societeId);
  },

  licence(id) {
    return db.prepare(`SELECT * FROM licences WHERE id = ?`).get(id);
  },

  revoquer(id, motif) {
    const info = db
      .prepare(`UPDATE licences SET revoquee_le = datetime('now'), revoquee_motif = ?
                 WHERE id = ? AND revoquee_le IS NULL`)
      .run(String(motif || '').slice(0, 300), id);
    return info.changes === 1;
  },

  /** Licences arrivant à échéance dans `jours` jours (et celles déjà expirées). */
  echeances(jours = 60) {
    const limite = jourISO(Date.now() + jours * 86400000);
    return db
      .prepare(`SELECT l.*, s.nom AS societe, s.contact_email
                  FROM licences l JOIN societes s ON s.id = l.societe_id
                 WHERE l.revoquee_le IS NULL AND s.archivee = 0 AND l.fin <= ?
                   AND l.id = (SELECT id FROM licences WHERE societe_id = l.societe_id
                                AND revoquee_le IS NULL ORDER BY fin DESC, id DESC LIMIT 1)
                 ORDER BY l.fin ASC`)
      .all(limite);
  },

  // --- Opérateurs, sessions, journal ----------------------------------------

  compterOperateurs() {
    return db.prepare(`SELECT COUNT(*) n FROM operateurs`).get().n;
  },

  operateurs() {
    return db.prepare(`SELECT id, username, created_at, last_login FROM operateurs ORDER BY id ASC`).all();
  },

  majMotDePasseOperateur(id, passwordHash) {
    db.prepare(`UPDATE operateurs SET password_hash = ? WHERE id = ?`).run(passwordHash, id);
  },

  /** Supprime un opérateur (ses sessions partent avec, par cascade). */
  supprimerOperateur(id) {
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(id);
    db.prepare(`DELETE FROM operateurs WHERE id = ?`).run(id);
  },

  /** Ferme les sessions d'un opérateur — un changement de mot de passe doit couper l'existant. */
  fermerSessionsOperateur(userId) {
    return db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId).changes;
  },

  creerOperateur(username, passwordHash) {
    return db.prepare(`INSERT INTO operateurs (username, password_hash) VALUES (?, ?)`)
      .run(username, passwordHash).lastInsertRowid;
  },

  operateur(username) {
    return db.prepare(`SELECT * FROM operateurs WHERE username = ?`).get(username);
  },

  toucherConnexion(id) {
    db.prepare(`UPDATE operateurs SET last_login = datetime('now') WHERE id = ?`).run(id);
  },

  creerSession(token, userId, expiresAt) {
    db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`).run(token, userId, expiresAt);
  },

  session(token) {
    return db
      .prepare(`SELECT s.token, s.expires_at, o.id AS user_id, o.username
                  FROM sessions s JOIN operateurs o ON o.id = s.user_id
                 WHERE s.token = ? AND s.expires_at > datetime('now')`)
      .get(token);
  },

  supprimerSession(token) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  },

  purgerSessions() {
    db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
  },

  /** Réglages chiffrés d'une société : { cle: valeurChiffree }. */
  reglages(societeId) {
    const out = {};
    for (const r of db.prepare(`SELECT cle, valeur FROM reglages WHERE societe_id = ?`).all(societeId)) {
      out[r.cle] = r.valeur;
    }
    return out;
  },

  enregistrerReglages(societeId, valeurs, par) {
    const tx = db.transaction(() => {
      const ins = db.prepare(`INSERT INTO reglages (societe_id, cle, valeur, updated_by)
                              VALUES (?, ?, ?, ?)
                              ON CONFLICT(societe_id, cle) DO UPDATE
                              SET valeur = excluded.valeur, updated_at = datetime('now'),
                                  updated_by = excluded.updated_by`);
      for (const [cle, valeur] of Object.entries(valeurs)) ins.run(societeId, cle, valeur || '', par || '');
    });
    tx();
  },

  tracer(acteur, action, cible, details, ip) {
    db.prepare(`INSERT INTO journal (acteur, action, cible, details, ip) VALUES (?, ?, ?, ?, ?)`)
      .run(acteur || '', action, cible || '', String(details || '').replace(/[\r\n\t]+/g, ' ').slice(0, 500), ip || '');
  },

  journal(limite = 300) {
    return db.prepare(`SELECT * FROM journal ORDER BY id DESC LIMIT ?`).all(Math.min(limite, 1000));
  },
};
