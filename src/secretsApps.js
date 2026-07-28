'use strict';

/**
 * Identifiants des applications métiers, saisis depuis les réglages.
 *
 * Le compte de service que le robot emploie pour se connecter à BlueKanGo ou
 * NetSoins appartient au client, pas à nous. Il doit pouvoir le saisir et le
 * changer lui-même, sans nous appeler ni ouvrir un fichier sur le serveur.
 *
 * Trois règles tiennent cette brique :
 *
 *  1. CHIFFRÉ AU REPOS. Ces identifiants ouvrent l'administration complète
 *     d'une application de santé : une base volée ne doit pas les livrer.
 *     AES-256-GCM, clé locale au dossier de données, jamais dans le dépôt.
 *
 *  2. JAMAIS RENVOYÉ. Aucune route ne rend un mot de passe, même à un
 *     administrateur connecté. On dit s'il est renseigné et quand il l'a été,
 *     rien de plus — un écran d'administration reste ouvert sur un poste.
 *
 *  3. APPLIQUÉ À L'ENVIRONNEMENT. Les robots lisent `process.env.<APP>_ADMIN_USER`
 *     à une vingtaine d'endroits. Plutôt que de tous les modifier — et d'en
 *     oublier un —, les valeurs enregistrées sont posées dans l'environnement
 *     du processus au démarrage et après chaque changement.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const db = require('./db');

const KEY_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'secret.key');

/**
 * Champs qu'un client peut renseigner, par application.
 *
 * Liste FERMÉE : sans cela, une requête forgée pourrait écrire n'importe quelle
 * variable d'environnement du processus — jusqu'à détourner l'exécution.
 */
const CHAMPS = {
  url: { suffixe: 'URL', libelle: 'Adresse de l’application', secret: false, exemple: 'https://app.bluekango.com' },
  user: { suffixe: 'ADMIN_USER', libelle: 'Identifiant du compte de service', secret: false },
  password: { suffixe: 'ADMIN_PASSWORD', libelle: 'Mot de passe', secret: true },
  motDePasseInitial: { suffixe: 'DEFAULT_PASSWORD', libelle: 'Mot de passe des comptes créés', secret: true },
};

function key() {
  if (!fs.existsSync(KEY_FILE)) {
    fs.writeFileSync(KEY_FILE, crypto.randomBytes(32), { mode: 0o600 });
  }
  return fs.readFileSync(KEY_FILE);
}

function chiffrer(texte) {
  if (!texte) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(texte), 'utf8'), c.final()]);
  return [iv.toString('base64'), enc.toString('base64'), c.getAuthTag().toString('base64')].join('.');
}

function dechiffrer(blob) {
  if (!blob) return '';
  try {
    const [iv, enc, tag] = String(blob).split('.').map((p) => Buffer.from(p, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch {
    // Clé remplacée ou donnée altérée : on ne fait pas tomber le portail pour
    // autant, on se comporte comme si rien n'était enregistré.
    return '';
  }
}

const variable = (appId, champ) => `${String(appId).toUpperCase()}_${CHAMPS[champ].suffixe}`;

/** Valeurs enregistrées pour une application, en clair. Usage interne seulement. */
function valeurs(appId) {
  const stocke = db.getSetting(`secrets_${appId}`, null);
  if (!stocke || typeof stocke !== 'object') return {};
  const out = {};
  for (const champ of Object.keys(CHAMPS)) {
    const v = dechiffrer(stocke[champ]);
    if (v) out[champ] = v;
  }
  return out;
}

/**
 * Pose les valeurs enregistrées dans l'environnement du processus.
 *
 * Ce qui est saisi dans les réglages l'emporte sur le fichier de configuration :
 * c'est le choix le plus récent, fait sciemment par le client.
 */
function appliquer(appIds) {
  const ids = appIds || db.getSetting('secrets_apps', []) || [];
  let posees = 0;
  for (const appId of ids) {
    for (const [champ, v] of Object.entries(valeurs(appId))) {
      process.env[variable(appId, champ)] = v;
      posees += 1;
    }
  }
  return posees;
}

/**
 * Enregistre les identifiants d'une application.
 *
 * Un champ absent de la requête n'est PAS effacé : l'interface n'envoie un mot
 * de passe que s'il a été retapé, et une modification de l'identifiant seul ne
 * doit pas faire disparaître le mot de passe.
 * Pour effacer, il faut envoyer une chaîne vide explicite.
 */
function definir(appId, entrees, par) {
  const stocke = db.getSetting(`secrets_${appId}`, {}) || {};
  const modifies = [];
  for (const [champ, def] of Object.entries(CHAMPS)) {
    if (!(champ in entrees)) continue;
    const valeur = String(entrees[champ] ?? '').trim();
    if (valeur === dechiffrer(stocke[champ])) continue; // inchangé
    stocke[champ] = valeur ? chiffrer(valeur) : '';
    modifies.push(def.libelle);
  }
  if (!modifies.length) return { modifies: [] };

  db.setSetting(`secrets_${appId}`, stocke, par || '');
  // On tient la liste des applications configurées, pour savoir quoi appliquer
  // au démarrage sans parcourir tous les réglages.
  const connues = new Set(db.getSetting('secrets_apps', []) || []);
  connues.add(appId);
  db.setSetting('secrets_apps', [...connues], par || '');
  appliquer([appId]);
  return { modifies };
}

/**
 * État, pour l'écran de réglages.
 * Les valeurs secrètes ne sortent JAMAIS : on dit renseigné ou non.
 */
function etat(appId) {
  const v = valeurs(appId);
  const champs = {};
  for (const [champ, def] of Object.entries(CHAMPS)) {
    const enregistre = !!v[champ];
    const parEnv = !enregistre && !!process.env[variable(appId, champ)];
    champs[champ] = {
      libelle: def.libelle,
      secret: def.secret,
      exemple: def.exemple || '',
      renseigne: enregistre || parEnv,
      // Un champ non secret peut être réaffiché : le client doit pouvoir
      // vérifier l'adresse ou l'identifiant qu'il a saisi.
      valeur: def.secret ? '' : (v[champ] || process.env[variable(appId, champ)] || ''),
      source: enregistre ? 'reglages' : parEnv ? 'configuration' : 'absent',
    };
  }
  return { appId, champs, complet: !!(champs.url.renseigne && champs.user.renseigne && champs.password.renseigne) };
}

module.exports = { appliquer, definir, etat, valeurs, CHAMPS };
