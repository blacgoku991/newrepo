'use strict';

/**
 * Réglages d'une société, saisis depuis le panel.
 *
 * Ce sont les valeurs qu'on ne pose qu'une fois à la mise en service : accès
 * Microsoft 365, envoi des e-mails, compte administrateur du portail. Elles
 * devaient jusqu'ici être écrites à la main dans un fichier sur le serveur.
 *
 * Quatre règles :
 *
 *  1. CHIFFRÉ AU REPOS (AES-256-GCM, clé dans `~/.smartfixx/secret.key`). Le
 *     secret client Microsoft ouvre l'annuaire d'une organisation entière.
 *
 *  2. JAMAIS RENVOYÉ. Aucune route ne rend un secret, même à l'opérateur
 *     connecté. On dit renseigné ou non, et depuis quand.
 *
 *  3. LISTE FERMÉE. Seules les clés déclarées ici peuvent être écrites : sans
 *     cela, une requête forgée poserait n'importe quelle variable dans
 *     l'environnement du processus de la société — jusqu'à `NODE_OPTIONS`.
 *
 *  4. INJECTÉ AU DÉMARRAGE. L'orchestrateur les passe à l'instance ; elles ne
 *     touchent jamais le disque en clair.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const db = require('./db');

const DOSSIER = process.env.SMARTFIXX_DIR || path.join(os.homedir(), '.smartfixx');
const FICHIER_CLE = path.join(DOSSIER, 'secret.key');

/**
 * Réglages proposés, par groupe.
 *
 * `secret: true` → la valeur ne ressort jamais du serveur.
 * `env`          → la variable posée dans l'environnement de l'instance.
 */
const GROUPES = [
  {
    id: 'acces',
    titre: 'Accès des référents (Microsoft 365)',
    aide: 'Inscription à créer dans l’Entra ID de la société. URL de retour à y déclarer : https://<sous-domaine>/auth/sso/callback',
    champs: [
      { cle: 'tenantId', env: 'M365_TENANT_ID', libelle: 'Identifiant de l’annuaire (tenant)' },
      { cle: 'clientId', env: 'M365_CLIENT_ID', libelle: 'Identifiant de l’application' },
      { cle: 'clientSecret', env: 'M365_CLIENT_SECRET', libelle: 'Secret client', secret: true },
      {
        cle: 'accesPortail', env: 'ACCES_PORTAIL', libelle: 'Qui peut entrer', defaut: 'tenant',
        options: [
          ['tenant', 'Toute personne de l’organisation'],
          ['attribut', 'Selon un attribut du compte'],
          ['liste', 'Uniquement les référents déclarés'],
        ],
      },
      { cle: 'accesAttribut', env: 'ACCES_ATTRIBUT', libelle: 'Attribut exigé (mode « attribut »)', exemple: 'extensionAttribute1=REFERENT' },
    ],
  },
  {
    id: 'applications',
    titre: 'Applications proposées',
    aide: 'Les identifiants du compte de service se saisissent ensuite dans les réglages du portail de la société.',
    champs: [
      { cle: 'appsActives', env: 'APPS_ACTIVES', libelle: 'Applications', defaut: 'bluekango,netsoins', exemple: 'bluekango,netsoins' },
      {
        cle: 'mode', env: 'AUTOMATION_MODE', libelle: 'Mode du robot', defaut: 'production',
        options: [['production', 'Production — agit sur les vraies applications'], ['demo', 'Démonstration — console intégrée']],
      },
    ],
  },
  {
    id: 'emails',
    titre: 'Envoi des e-mails',
    aide: 'Sans SMTP, les e-mails sont préparés et visibles dans l’administration, mais pas envoyés — rien n’est perdu.',
    champs: [
      { cle: 'smtpHost', env: 'SMTP_HOST', libelle: 'Serveur SMTP' },
      { cle: 'smtpPort', env: 'SMTP_PORT', libelle: 'Port', defaut: '587' },
      { cle: 'smtpUser', env: 'SMTP_USER', libelle: 'Identifiant' },
      { cle: 'smtpPassword', env: 'SMTP_PASSWORD', libelle: 'Mot de passe', secret: true },
      { cle: 'smtpFrom', env: 'SMTP_FROM', libelle: 'Adresse d’expédition' },
    ],
  },
  {
    id: 'admin',
    titre: 'Administrateur du portail',
    aide: 'Compte local de la société, distinct de vos accès. Créé au premier démarrage de son portail.',
    champs: [
      { cle: 'adminUser', env: 'ADMIN_USERNAME', libelle: 'Identifiant', defaut: 'admin' },
      { cle: 'adminPassword', env: 'ADMIN_PASSWORD', libelle: 'Mot de passe', secret: true },
    ],
  },
  {
    id: 'valeur',
    titre: 'Tableau de bord de valeur',
    champs: [
      { cle: 'tauxHoraire', env: 'TAUX_HORAIRE', libelle: 'Coût horaire chargé (€)', defaut: '28' },
    ],
  },
];

/** Index plat : clé → définition. Sert de liste blanche à l'écriture. */
const PAR_CLE = new Map();
for (const g of GROUPES) for (const c of g.champs) PAR_CLE.set(c.cle, c);

function cle() {
  if (!fs.existsSync(FICHIER_CLE)) {
    fs.mkdirSync(DOSSIER, { recursive: true, mode: 0o700 });
    fs.writeFileSync(FICHIER_CLE, crypto.randomBytes(32), { mode: 0o600 });
  }
  return fs.readFileSync(FICHIER_CLE);
}

function chiffrer(texte) {
  if (!texte) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cle(), iv);
  const enc = Buffer.concat([c.update(String(texte), 'utf8'), c.final()]);
  return [iv.toString('base64'), enc.toString('base64'), c.getAuthTag().toString('base64')].join('.');
}

function dechiffrer(blob) {
  if (!blob) return '';
  try {
    const [iv, enc, tag] = String(blob).split('.').map((p) => Buffer.from(p, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', cle(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch {
    return ''; // clé remplacée ou donnée altérée : on n'écroule pas le panel
  }
}

/** Valeurs en clair. Usage interne : jamais servi tel quel par une route. */
function valeurs(societeId) {
  const stocke = db.reglages(societeId);
  const out = {};
  for (const [k, v] of Object.entries(stocke)) {
    if (!PAR_CLE.has(k)) continue; // clé retirée du produit depuis
    const clair = dechiffrer(v);
    if (clair) out[k] = clair;
  }
  return out;
}

/** Variables d'environnement à passer à l'instance de cette société. */
function environnement(societeId) {
  const v = valeurs(societeId);
  const env = {};
  for (const [k, def] of PAR_CLE) {
    const valeur = v[k] ?? def.defaut;
    if (valeur !== undefined && valeur !== '') env[def.env] = String(valeur);
  }
  // Le SSO n'est exigé que s'il est réellement configurable : sans les trois
  // clés, l'imposer fermerait le portail à tout le monde, y compris au client.
  env.SSO_REQUIRED = env.M365_TENANT_ID && env.M365_CLIENT_ID && env.M365_CLIENT_SECRET ? 'true' : 'false';
  return env;
}

/**
 * Enregistre des réglages.
 * Un champ absent n'est pas touché ; un champ secret vide n'efface pas —
 * l'interface ne l'envoie que s'il a été retapé.
 */
function definir(societeId, entrees, par) {
  const stocke = db.reglages(societeId);
  const modifies = [];
  for (const [k, def] of PAR_CLE) {
    if (!(k in entrees)) continue;
    const valeur = String(entrees[k] ?? '').trim().slice(0, 500);
    if (def.options && valeur && !def.options.some(([v]) => v === valeur)) continue; // valeur hors liste
    if (valeur === dechiffrer(stocke[k] || '')) continue;
    stocke[k] = valeur ? chiffrer(valeur) : '';
    modifies.push(def.libelle);
  }
  if (modifies.length) db.enregistrerReglages(societeId, stocke, par);
  return { modifies };
}

/** État pour l'interface : jamais un secret, seulement s'il est posé. */
function etat(societeId) {
  const v = valeurs(societeId);
  return {
    groupes: GROUPES.map((g) => ({
      id: g.id,
      titre: g.titre,
      aide: g.aide || '',
      champs: g.champs.map((c) => ({
        cle: c.cle,
        libelle: c.libelle,
        secret: !!c.secret,
        options: c.options || null,
        exemple: c.exemple || '',
        renseigne: !!v[c.cle],
        valeur: c.secret ? '' : (v[c.cle] ?? c.defaut ?? ''),
      })),
    })),
    ssoActif: !!(v.tenantId && v.clientId && v.clientSecret),
  };
}

module.exports = { etat, definir, environnement, valeurs, GROUPES };
