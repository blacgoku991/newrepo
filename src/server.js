'use strict';

// Charge le fichier .env AVANT tout module qui lit process.env.
require('./loadEnv').loadEnv();

const path = require('path');
const express = require('express');

const db = require('./db');
const registry = require('./registry');
const auth = require('./auth');
const sso = require('./sso');
const referents = require('./referents');
const habilitation = require('./habilitation');
const graph = require('./graph');
const stats = require('./stats');
const { validate } = require('./validate');
const { augmentSchema, effectiveSchema, effectiveSchemaFor, validateOverrides, requesterLabel } = require('./schema');
const demarches = require('./demarches');
const { validateScenarioOverrides } = require('./automation/scenarioRuntime');
const mailer = require('./mailer');
const worker = require('./worker');

const security = require('./security');
const licence = require('./licence');
const comptesProteges = require('./comptesProteges');

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Onglets du menu du site public que l'admin peut afficher/masquer.
// « admin » (lien Administration) est masqué par défaut : l'accès se fait par
// /admin.html directement. Les autres onglets sont visibles par défaut.
const NAV_KEYS = ['apps', 'demarches', 'espace', 'suivi', 'admin'];
// Par défaut : « Applications » et « Démarches » masqués (les démarches passent
// par l'espace référent), « Administration » masquée (accès par /admin.html).
const NAV_DEFAULT = { apps: false, demarches: false, espace: true, suivi: true, admin: false };

function siteNav() {
  const saved = db.getSetting('site_nav', {}) || {};
  const out = {};
  for (const k of NAV_KEYS) out[k] = saved[k] === undefined ? NAV_DEFAULT[k] : saved[k] !== false;
  return out;
}

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
// Purge périodique : un portail qui tourne des mois ne doit pas conserver des
// sessions expirées en base (surface inutile en cas de vol de la base).
setInterval(() => {
  try {
    db.purgeExpiredSessions();
    db.purgeExpiredSsoSessions();
  } catch { /* purge de confort : jamais bloquante */ }
}, 6 * 3600 * 1000).unref();

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
// `referent` indique si le compte connecté dispose d'un espace personnel.
app.get('/api/sso/me', (req, res) => {
  const ref = referents.resolve(req);
  res.json({
    enabled: sso.required(),
    user: sso.currentUser(req),
    referent: !!ref,
    referentEnforced: referents.enforced(),
    nav: siteNav(),
  });
});

/**
 * Un onglet décoché n'est pas seulement masqué du menu : la page n'est plus
 * servie. Sinon l'adresse reste accessible à qui la connaît, et « masquer »
 * ne veut rien dire.
 *
 * L'administration est le seul cas à part : elle est masquée du menu par
 * défaut, et la bloquer enfermerait l'administrateur dehors.
 */
const PAGES_NAV = {
  '/index.html': 'apps',
  '/demarches.html': 'demarches',
  '/espace.html': 'espace', '/espace': 'espace',
  '/suivi.html': 'suivi', '/suivi': 'suivi',
};
// `/demande.html` n'est JAMAIS dans cette table : c'est la page de formulaire
// vers laquelle mène « Faire une demande » depuis l'espace personnel. Les
// onglets règlent l'affichage du MENU, pas la possibilité de déposer une
// demande — la fermer coupait le portail en deux.

app.use((req, res, next) => {
  const cle = PAGES_NAV[req.path];
  if (!cle || req.method !== 'GET') return next();
  if (siteNav()[cle] !== false) return next();
  // On renvoie vers la première page encore ouverte plutôt qu'une erreur.
  const nav = siteNav();
  const repli = nav.espace ? '/espace' : nav.suivi ? '/suivi.html' : nav.apps ? '/index.html' : null;
  if (repli && repli !== req.path) return res.redirect(repli);
  return res.status(404).send('Page désactivée.');
});

// URL propre de la page de connexion (sert /connexion.html).
app.get('/connexion', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'connexion.html'));
});

// Espace personnel du référent (protégé par la porte SSO globale).
app.get('/espace', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'espace.html'));
});

// Page d'accueil désactivée : quand le SSO est actif, l'arrivée sur le site
// mène directement à l'espace personnel (dashboard référent, ou message
// « non habilité » pour les autres comptes). En mode démo/local (sans SSO),
// la page d'accueil classique reste servie pour le développement.
app.get('/', (req, res, next) => {
  if (sso.required()) return res.redirect('/espace');
  next();
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

app.get('/api/apps/:id/schema', security.rateLimit('schema', 300, 10 * 60 * 1000), sso.requireApi, (req, res) => {
  const entry = registry.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Application inconnue' });
  if (entry.config.comingSoon) {
    return res.status(409).json({ error: 'Application bientôt disponible' });
  }
  const { id, name, category, description, icon, color, logo } = entry.config;
  // ?type=… → démarche demandée (création par défaut). Le registre des démarches
  // dit quel schéma servir ; une démarche composée est assemblée à la volée.
  const type = demarches.fromQuery(req.query.type);
  const schema = effectiveSchemaFor(entry.config, type, entry.automation);
  if (!schema) return res.status(404).json({ error: 'Démarche indisponible pour cette application' });
  const def = demarches.get(type) || demarches.composee(type);
  res.json({
    id,
    name,
    category,
    description,
    icon,
    color,
    logo: logo || null,
    schema,
    type: demarches.alias(type) || type,
    demarche: {
      ...demarches.carte(type),
      aside: def.aside || '',
      // Textes de confirmation/suivi de la démarche (déjà personnalisés avec le
      // nom de l'application).
      suivi: demarches.suivi(type, name),
    },
  });
});

// 60 dépôts par IP et par 10 minutes : large pour les lots, bloque le spam.
app.post('/api/apps/:id/requests', security.rateLimit('depot', 60, 10 * 60 * 1000), sso.requireApi, (req, res) => {
  const entry = registry.getAvailable(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Application inconnue ou indisponible' });

  // Mode limité (licence échue) : plus de dépôt — les robots sont à l'arrêt et
  // une demande déposée resterait en attente sans que personne le sache. Les
  // données, elles, restent entièrement consultables.
  const droit = licence.etat();
  if (!droit.robot) {
    return res.status(403).json({ error: `${droit.titre} — ${droit.message}`, licence: droit.etat });
  }

  // Habilitation : selon la politique d'accès (ACCES_PORTAIL), tout le tenant
  // Microsoft 365, les seuls porteurs d'un attribut, ou les référents déclarés.
  const enforce = referents.enforced();
  const referent = enforce ? referents.resolve(req) : null;
  if (enforce && !referent) {
    const u = sso.currentUser(req);
    db.audit(u ? `${u.name} <${u.email}>` : 'inconnu', 'depot_refuse_non_referent',
      '', `${entry.config.id} — ${habilitation.mode()}`, sso.clientIp(req));
    return res.status(403).json({ error: referents.refus(req) });
  }

  const demande = demarches.fromQuery(req.query.type);
  const schema = effectiveSchemaFor(entry.config, demande, entry.automation);
  if (!schema) return res.status(404).json({ error: 'Démarche indisponible pour cette application' });

  // Connexion SSO : l'identité du demandeur (nom + e-mail) vient du compte
  // Microsoft et fait foi — on la renseigne d'office avant validation, la
  // personne n'a jamais à la retaper.
  const ssoUser = sso.currentUser(req);
  const body = { ...(req.body || {}) };
  if (ssoUser) {
    body._demandeur_nom = ssoUser.name || `${ssoUser.prenom} ${ssoUser.nom}`.trim() || ssoUser.email;
    body._demandeur_email = ssoUser.email;
  }
  const { data, errors } = validate(schema, body);
  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ error: 'Formulaire invalide', fields: errors });
  }

  // Démarche composée (« Mettre à jour un compte ») : le choix fait par le
  // référent désigne la démarche réellement déposée. C'est ce type-là — jamais
  // le type composé — qui est enregistré et exécuté par le robot.
  const type = demarches.resoudre(demande, data);
  if (!type) {
    const champ = (demarches.composee(demande) || {}).champ || 'type';
    return res.status(422).json({
      error: 'Formulaire invalide',
      fields: { [champ]: 'Choisissez ce que vous voulez mettre à jour' },
    });
  }
  // La démarche retenue doit exister sur cette application (robot présent) :
  // sans ce contrôle, une valeur forgée ferait déposer une demande inexécutable.
  if (!demarches.estDisponible(type, entry.config, entry.automation)) {
    return res.status(404).json({ error: 'Démarche indisponible pour cette application' });
  }

  // Comptes de service du robot : jamais visés par une démarche. Réinitialiser
  // le mot de passe du compte administrateur reviendrait à le remettre au
  // demandeur — donc à lui livrer l'application métier entière.
  const refusCompte = comptesProteges.refus(entry.config.id, data);
  if (refusCompte) {
    const u = sso.currentUser(req);
    db.audit(
      u ? `${u.name} <${u.email}>` : 'inconnu',
      'depot_refuse_compte_protege',
      '',
      `${entry.config.id} — ${String(data.identifiant || `${data.prenom || ''} ${data.nom || ''}`).trim()}`,
      sso.clientIp(req)
    );
    return res.status(403).json({ error: refusCompte });
  }

  // Cloisonnement par établissement : le référent ne peut agir QUE sur ses
  // établissements. Sans ce contrôle, il suffirait de modifier la valeur
  // envoyée pour créer un compte — ou réinitialiser un mot de passe, et donc
  // en récupérer le nouveau — dans n'importe quel établissement du groupe.
  //
  // Le transfert mérite une attention particulière : il faut être habilité sur
  // l'établissement de DÉPART comme sur celui d'ARRIVÉE. Ne contrôler que
  // l'arrivée permettrait de « transférer » chez soi le compte de n'importe quel
  // établissement, donc d'en prendre le contrôle — le cloisonnement tomberait
  // par cette porte.
  if (enforce) {
    const cibles = [data.etablissement, data.etablissement_cible, ...(data.etablissements_autorises || [])]
      .filter(Boolean)
      .map(String);
    const horsPerimetre = [...new Set(cibles)].filter((v) => !referents.allows(referent, entry.config.id, v));
    if (horsPerimetre.length > 0) {
      const u = sso.currentUser(req);
      db.audit(
        u ? `${u.name} <${u.email}>` : 'inconnu',
        'depot_refuse_hors_perimetre',
        '',
        `${entry.config.id} — ${horsPerimetre.join(', ')}`,
        sso.clientIp(req)
      );
      return res.status(403).json({
        error: "Vous n'êtes pas référent de l'établissement visé par cette demande.",
      });
    }
  }

  // Traçabilité : l'adresse IP d'origine et l'identité Microsoft 365 sont conservées.
  const ip = sso.clientIp(req);
  const demandeur = ssoUser ? `${ssoUser.name} <${ssoUser.email}>` : requesterLabel(data);
  const reference = db.createRequest(
    entry.config.id,
    demarches.prefixe(type, entry.config),
    data,
    demandeur,
    ssoUser ? ssoUser.email : '',
    ip,
    type
  );
  // Clé de journal alignée sur celle du robot (`demarche.audit`) : le dépôt et
  // le traitement d'une même démarche se lisent côte à côte dans le journal.
  db.audit(
    demandeur,
    `depot_${demarches.get(type).audit}`,
    reference,
    `${entry.config.name} — ${data.prenom || ''} ${data.nom || ''}`.trim() || `${entry.config.name} — ${data.identifiant || ''}`,
    ip
  );
  // Le worker prend la demande tout de suite au lieu d'attendre son prochain
  // tour de file : sur un dépôt en rafale, ça se voit.
  worker.reveiller();
  res.status(201).json({ reference });
});

/**
 * Qui a le droit de consulter le détail d'une demande ?
 *
 * Les références sont courtes (PREFIXE-AAMMJJ-XXXX) : sans ce contrôle, un
 * compte Microsoft quelconque du tenant pouvait, en essayant des références,
 * lire le nom du bénéficiaire, son identifiant de connexion et son
 * établissement. On limite donc la lecture aux personnes concernées :
 *  - celle qui a déposé la demande (compte Microsoft du dépôt) ;
 *  - le bénéficiaire (e-mail renseigné dans la demande) ;
 *  - un référent de l'établissement visé, sur la bonne application ;
 *  - un administrateur connecté au panel.
 * Sans SSO (démonstration), le comportement d'origine est conservé.
 */
function peutVoirDemande(req, row, { motDePasse = false } = {}) {
  if (!sso.required()) return true;
  if (auth.currentSession(req)) return true; // administrateur du portail

  const user = sso.currentUser(req);
  const email = String((user && user.email) || '').toLowerCase();
  if (!email) return false;

  let data = {};
  try { data = JSON.parse(row.payload || '{}'); } catch { /* charge illisible : on s'en tient aux e-mails de la demande */ }
  const concernes = [row.sso_email, data.email, data._demandeur_email]
    .map((e) => String(e || '').toLowerCase())
    .filter(Boolean);
  if (concernes.includes(email)) return true;

  // Référent de l'établissement visé (départ ou arrivée pour un transfert).
  const ref = referents.resolve(req);
  if (!ref) return false;
  // Remise d'un mot de passe : la portée « tous les établissements » accordée
  // par la politique d'accès ne suffit pas. Ce lien révèle le mot de passe d'un
  // tiers ; il reste réservé au demandeur, au bénéficiaire, à un référent
  // NOMMÉMENT déclaré sur l'établissement, ou à un administrateur.
  if (motDePasse && ref.tous === true) return false;
  const cibles = [data.etablissement, data.etablissement_cible, ...(data.etablissements_autorises || [])].filter(Boolean);
  return cibles.some((v) => referents.allows(ref, row.app_id, String(v)));
}

// Suivi public d'une demande par sa référence (informations limitées).
// Limité par IP pour empêcher l'énumération de références.
app.get('/api/requests/:reference', security.rateLimit('suivi', 120, 10 * 60 * 1000), sso.requireApi, (req, res) => {
  const row = db.getByReference(req.params.reference.toUpperCase());
  if (!row) return res.status(404).json({ error: 'Référence inconnue' });
  // Même réponse qu'une référence inconnue : on ne confirme pas l'existence
  // d'une demande à quelqu'un qui n'a rien à y voir.
  if (!peutVoirDemande(req, row)) {
    const u = sso.currentUser(req);
    db.audit(u ? `${u.name} <${u.email}>` : 'inconnu', 'suivi_refuse', row.reference, '', sso.clientIp(req));
    return res.status(404).json({ error: 'Référence inconnue' });
  }
  const appEntry = registry.get(row.app_id);
  const total = row.progress_total || 0;
  const done = row.progress_done || 0;
  const appName = appEntry ? appEntry.config.name : row.app_id;
  const type = demarches.normalise(row.request_type);
  // Il y a quelque chose à remettre dès qu'un lien actif existe : un mot de
  // passe (création, réinitialisation) ou le seul nouvel identifiant de
  // connexion (correction d'identité, qui laisse le mot de passe intact).
  const lienActif =
    row.status === 'terminee' && row.generated_login && db.credentialLinkForRequest(row.id)
    && peutVoirDemande(req, row, { motDePasse: true });
  res.json({
    reference: row.reference,
    app: appName,
    status: row.status,
    message: row.result_message,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    // La démarche pilote les intitulés du suivi : une réinitialisation ne
    // s'annonce pas comme une création de compte.
    demarche: { type, label: demarches.libelle(type), court: demarches.court(type), suivi: demarches.suivi(type, appName) },
    credentials: Boolean(lienActif),
    // Sans mot de passe : le suivi annonce « le nouvel identifiant » plutôt que
    // « les identifiants », pour ne rien promettre qui n'arrivera pas.
    credentialsSansMotDePasse: Boolean(lienActif && !credentials.passwordForRequest(row.id)),
    progress: {
      done,
      total,
      label: row.progress_label || '',
      percent: total ? Math.round((done / total) * 100) : (row.status === 'terminee' ? 100 : 0),
    },
  });
});

// Depuis la page de suivi : accès aux identifiants d'une demande terminée.
// Génère un lien frais (l'ancien est révoqué) et renvoie son chemin.
// Avec SSO actif, réservé au déposant ou au bénéficiaire de la demande.
app.post('/api/requests/:reference/credentials-access', security.rateLimit('credaccess', 15, 10 * 60 * 1000), sso.requireApi, (req, res) => {
  const row = db.getByReference(String(req.params.reference).toUpperCase());
  if (!row) return res.status(404).json({ error: 'Référence inconnue' });
  // L'habilitation se vérifie AVANT l'état de la demande : sinon les codes de
  // réponse renseignent un tiers sur l'existence de la demande et sur le fait
  // qu'un mot de passe y est disponible.
  if (!peutVoirDemande(req, row, { motDePasse: true })) {
    const u = sso.currentUser(req);
    db.audit(u ? `${u.name} <${u.email}>` : 'inconnu', 'acces_identifiants_refuse', row.reference, 'hors périmètre', sso.clientIp(req));
    return res.status(404).json({ error: 'Référence inconnue' });
  }
  if (row.status !== 'terminee' || !row.generated_login) {
    return res.status(409).json({ error: 'Le compte n\'est pas encore créé' });
  }
  // Un lien n'existe que si un mot de passe a réellement été posé par le robot
  // (création, réinitialisation). Sans ce contrôle, une correction d'identité
  // régénérerait un lien avec le mot de passe INITIAL de l'application — donc
  // un mot de passe qui n'est pas celui du compte.
  if (!db.credentialLinkForRequest(row.id)) {
    return res.status(409).json({
      error: 'Aucun identifiant à remettre pour cette demande.',
    });
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
  // Régénère avec le MÊME mot de passe que celui posé par le robot (réinit =
  // provisoire aléatoire), sinon le mot de passe initial de l'application.
  //
  // Correction d'identité : le lien d'origine a été créé SANS mot de passe (il
  // n'a pas changé), on régénère à l'identique. Retomber sur le mot de passe
  // initial de l'application annoncerait au titulaire un mot de passe qui n'est
  // pas le sien — c'est précisément ce qu'il ne faut pas faire.
  const lienOrigine = db.credentialLinkForRequest(row.id);
  const motDePasseInitial = credentials.passwordForRequest(row.id);
  const sansMotDePasse = !!lienOrigine && !motDePasseInitial;
  const pwd = sansMotDePasse ? '' : (motDePasseInitial || credentials.initialPasswordFor(row.app_id));
  const link = credentials.createLink(row.id, row.generated_login, pwd, req);
  const actor = ssoUser ? `${ssoUser.name} <${ssoUser.email}>` : row.demandeur || 'suivi';
  db.audit(actor, 'lien_identifiants_regenere', row.reference, row.generated_login, sso.clientIp(req));
  res.json({ path: link.path });
});

// ---------------------------------------------------------------------------
// Espace personnel du référent
// ---------------------------------------------------------------------------

// Comptes et activité des établissements dont l'utilisateur connecté est
// référent. Un compte non habilité reçoit { referent: null }.
app.get('/api/espace/me', security.rateLimit('espace', 300, 10 * 60 * 1000), sso.requireApi, (req, res) => {
  const user = sso.currentUser(req);
  const ref = referents.resolve(req);
  if (!ref) {
    return res.json({ user, referent: null, enforced: referents.enforced() });
  }

  // `?vue=demandes` : la page de suivi n'a besoin que des demandes. On évite de
  // parcourir le registre de comptes (plusieurs milliers de lignes) pour rien.
  const sansComptes = req.query.vue === 'demandes';

  // Établissements regroupés par application.
  const byApp = new Map();
  for (const e of ref.etablissements) {
    if (!byApp.has(e.appId)) byApp.set(e.appId, []);
    byApp.get(e.appId).push(e.value);
  }

  const accountsMap = new Map(); // comptes (uniques par identifiant)
  const activity = []; // toutes les demandes des établissements
  for (const [appId, values] of byApp) {
    const appEntry = registry.get(appId);
    const appName = appEntry ? appEntry.config.name : appId;

    // Comptes déjà existants importés (ex. export NetSoins) rattachés aux
    // établissements du référent : il les voit et peut demander un reset dessus.
    for (const acc of sansComptes ? [] : db.accountsForEtablissements(appId, values)) {
      const key = `${appId}:${(acc.login || '').toLowerCase()}`;
      if (!acc.login || accountsMap.has(key)) continue;
      accountsMap.set(key, {
        appId,
        app: appName,
        login: acc.login,
        nom: acc.nom || '',
        prenom: acc.prenom || '',
        etablissement: String(acc.etablissement || ''),
        etablissementLabel: referents.labelFor(appId, acc.etablissement),
        fonction: acc.profil || '',
        actif: !!acc.actif,
        source: acc.source || 'import',
        reference: '',
        createdAt: acc.updated_at || acc.created_at,
      });
    }

    for (const row of db.requestsForEtablissements(appId, values)) {
      const data = JSON.parse(row.payload);
      const type = row.request_type || 'creation';
      const login = row.generated_login || data.identifiant || '';
      activity.push({
        reference: row.reference,
        app: appName,
        appId,
        type,
        status: row.status,
        login: login || null,
        who: `${data.prenom || ''} ${data.nom || ''}`.trim(),
        // Code de l'application + libellé : le code distingue deux
        // établissements aux noms proches.
        etablissement: String(data.etablissement || ''),
        etablissementLabel: referents.labelFor(appId, data.etablissement),
        createdAt: row.created_at,
      });
      if (!sansComptes && login && type === 'creation' && row.status === 'terminee') {
        // Un compte créé via le portail fait autorité : il remplace l'éventuelle
        // entrée importée du même identifiant (référence + lien d'identifiants).
        const key = `${appId}:${login.toLowerCase()}`;
        accountsMap.set(key, {
          appId,
          app: appName,
          login,
          nom: data.nom || '',
          prenom: data.prenom || '',
          etablissement: String(data.etablissement || ''),
          etablissementLabel: referents.labelFor(appId, data.etablissement),
          fonction: data.fonction || '',
          actif: true,
          source: 'portail',
          reference: row.reference,
          createdAt: row.created_at,
        });
      }
    }
  }

  // Applications sur lesquelles le référent peut agir (celles où il a des
  // établissements), pour proposer « Faire une demande » sur chacune.
  const apps = [...byApp.keys()].map((appId) => {
    const entry = registry.get(appId) || {};
    const c = entry.config || {};
    // Démarches RÉELLEMENT disponibles : schéma de formulaire ET robot présents.
    // Sans ce filtre, l'interface proposerait des actions vouées à l'échec.
    const dispo = demarches.disponibles(c, entry.automation);
    return {
      appId,
      id: appId, // attendu par appVisual() côté client
      name: c.name || appId,
      logo: c.logo || null,
      logoFallback: c.logoFallback || null,
      color: c.color || null,
      demarches: dispo.map((type) => demarches.carte(type)),
      // Démarches simples exécutables : sert aux raccourcis des lignes de
      // comptes, qui pointent directement sur la bonne démarche.
      actions: demarches.actions(c, entry.automation),
    };
  });

  res.json({
    user,
    referent: {
      email: ref.email,
      nom: ref.nom,
      prenom: ref.prenom,
      // Portée « tous les établissements » : accès ouvert par la politique
      // (tenant ou attribut) plutôt que par une fiche nominative.
      tous: ref.tous === true,
      // Libellé de repli : un rattachement enregistré sans libellé afficherait
      // une pastille vide.
      etablissements: ref.etablissements.map((e) => ({
        ...e,
        label: e.label || referents.labelFor(e.appId, e.value),
      })),
    },
    apps,
    accounts: [...accountsMap.values()],
    activity: activity.slice(0, 200),
    enforced: referents.enforced(),
  });
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
      otp: { awaiting: !!row.awaiting_otp, prompt: row.otp_prompt || '' },
      progress: (() => {
        const total = row.progress_total || 0;
        const done = row.progress_done || 0;
        return {
          done,
          total,
          label: row.progress_label || '',
          percent: total ? Math.round((done / total) * 100) : (row.status === 'terminee' ? 100 : 0),
        };
      })(),
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
    credentials.passwordForRequest(row.id) || credentials.initialPasswordFor(row.app_id),
    req
  );
  db.audit(req.admin.username, 'lien_identifiants_regenere', row.reference, row.generated_login, sso.clientIp(req));
  res.json({ ok: true, url: link.url, expiresAt: link.expiresAt, ttlDays: link.ttlDays });
});

// Consultation directe par l'admin de l'identifiant + mot de passe d'une
// demande (dépannage : le bénéficiaire les a oubliés). Toujours audité.
app.get('/api/admin/requests/:id/credentials', auth.requireApi, (req, res) => {
  const row = db.getById(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Demande introuvable' });
  if (!row.generated_login) return res.status(409).json({ error: 'Aucun identifiant pour cette demande' });
  const password = credentials.passwordForRequest(row.id) || credentials.initialPasswordFor(row.app_id) || null;
  db.audit(req.admin.username, 'admin_consultation_identifiants', row.reference, row.generated_login, sso.clientIp(req));
  res.json({ login: row.generated_login, password });
});

app.post('/api/admin/requests/:id/retry', auth.requireApi, (req, res) => {
  const ok = db.requeue(Number(req.params.id));
  if (!ok) return res.status(409).json({ error: 'Seule une demande en échec peut être relancée' });
  db.audit(req.admin.username, 'relance_demande', String(req.params.id));
  res.json({ ok: true });
});

// Saisie manuelle du code OTP (double authentification, ex. NetSoins) : le robot
// est en pause « en attente de code ». L'admin lit le code reçu par mail et le
// transmet ici ; le robot reprend automatiquement.
app.post('/api/admin/requests/:id/otp', auth.requireApi, (req, res) => {
  const row = db.getById(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Demande introuvable' });
  if (!row.awaiting_otp) return res.status(409).json({ error: 'Cette demande n\'attend pas de code' });
  const code = String((req.body && req.body.code) || '').trim();
  if (!/^[A-Za-z0-9]{4,8}$/.test(code)) {
    return res.status(400).json({ error: 'Code invalide (4 à 8 caractères alphanumériques attendus)' });
  }
  const ok = db.submitOtp(row.id, code);
  if (!ok) return res.status(409).json({ error: 'Cette demande n\'attend plus de code' });
  // On ne journalise jamais le code lui-même.
  db.audit(req.admin.username, 'saisie_otp', row.reference, '', sso.clientIp(req));
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
    worker: worker.etat(),
    smtp: mailer.smtpConfigured(),
    sso: { configured: sso.configured(), required: sso.required(), tenant: process.env.M365_TENANT_ID || null },
    acces: habilitation.etat(),
    nav: siteNav(),
    security: {
      defaultAdminPassword,
      cookieSecure: process.env.ADMIN_COOKIE_SECURE === 'true',
      https: req.headers['x-forwarded-proto'] === 'https' || req.secure,
    },
    licence: licence.etat(),
    apps,
  });
});

/**
 * Attributs Microsoft 365 réellement reçus lors des connexions récentes.
 *
 * Impossible de deviner ce que le tenant d'un client émet : les rôles
 * d'application, les groupes et les attributs d'extension ne sortent que si
 * Entra ID est configuré pour les mettre dans le jeton. Cette vue montre ce
 * qui arrive vraiment, pour composer ACCES_ATTRIBUT sans tâtonner.
 */
app.get('/api/admin/sso/attributs', auth.requireApi, (req, res) => {
  const sessions = db.recentSsoClaims(200);
  const par = new Map();
  for (const s of sessions) {
    let claims = {};
    try { claims = JSON.parse(s.claims || '{}'); } catch { claims = {}; }
    for (const [nom, brut] of Object.entries(claims)) {
      if (!par.has(nom)) par.set(nom, { attribut: nom, valeurs: new Map(), comptes: new Set() });
      const item = par.get(nom);
      item.comptes.add(s.email);
      for (const v of habilitation.valeursDe(brut)) {
        item.valeurs.set(v, (item.valeurs.get(v) || 0) + 1);
      }
    }
  }
  res.json({
    acces: habilitation.etat(),
    graph: graph.etat(),
    connexions: sessions.length,
    // Les dernières connexions avec ce que leur jeton portait : c'est la vue
    // « je me connecte et je regarde ce que Microsoft envoie ».
    dernieres: sessions.slice(0, 15).map((s) => {
      let claims = {};
      try { claims = JSON.parse(s.claims || '{}'); } catch { claims = {}; }
      return {
        email: s.email,
        name: s.name,
        date: s.created_at,
        attributs: Object.entries(claims).map(([nom, brut]) => ({
          nom,
          valeurs: habilitation.valeursDe(brut),
          brut: typeof brut === 'object' ? JSON.stringify(brut) : String(brut),
          utilisable: habilitation.utilisable(nom),
        })),
        satisfait: habilitation.verifie(claims),
      };
    }),
    attributs: [...par.values()]
      .map((i) => ({
        attribut: i.attribut,
        comptes: i.comptes.size,
        utilisable: habilitation.utilisable(i.attribut),
        valeurs: [...i.valeurs.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 25)
          .map(([valeur, n]) => ({ valeur, n })),
      }))
      .sort((a, b) => b.comptes - a.comptes),
  });
});

// Installation d'une licence (collée depuis le panel). Le jeton est vérifié
// AVANT d'être enregistré : on ne conserve jamais une licence illisible.
app.post('/api/admin/licence', security.rateLimit('licence', 20, 10 * 60 * 1000), auth.requireApi, (req, res) => {
  const resultat = licence.installer((req.body || {}).jeton, req.admin.username);
  if (!resultat.ok) return res.status(422).json({ error: resultat.erreur });
  res.json({ ok: true, licence: resultat.etat });
});

// Affichage/masquage des onglets du menu du site public.
app.put('/api/admin/site-nav', auth.requireApi, (req, res) => {
  const body = req.body || {};
  const cfg = {};
  for (const k of NAV_KEYS) cfg[k] = body[k] !== false; // tout ce qui n'est pas explicitement false reste visible
  db.setSetting('site_nav', cfg, req.admin.username);
  db.audit(req.admin.username, 'maj_navigation', '', JSON.stringify(cfg));
  res.json({ ok: true, nav: cfg });
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

// --- Référents autorisés ---------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Valide et normalise les établissements reçus : chaque valeur doit exister
// dans les options du formulaire de l'application (le libellé vient du serveur,
// jamais du client).
function normalizeEtabs(list) {
  const seen = new Set();
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    const appId = String((e && e.appId) || 'bluekango');
    const value = String((e && e.value) || '').trim();
    if (!value) continue;
    const label = referents.labelFor(appId, value);
    if (!label || label === value) continue; // établissement inconnu → ignoré
    const key = `${appId}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ appId, value, label });
  }
  return out;
}

app.get('/api/admin/referents', auth.requireApi, (req, res) => {
  const apps = registry
    .publicList()
    .filter((a) => !a.comingSoon)
    .map((a) => ({ id: a.id, name: a.name, establishments: referents.establishmentsFor(a.id) }))
    .filter((a) => a.establishments.length);
  res.json({ referents: db.listReferents(), apps });
});

app.post('/api/admin/referents', auth.requireApi, (req, res) => {
  const { email, nom, prenom, etablissements } = req.body || {};
  const mail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(mail)) return res.status(422).json({ error: 'Adresse e-mail invalide' });
  if (db.getReferentByEmail(mail)) return res.status(409).json({ error: 'Un référent avec cet e-mail existe déjà' });
  const etabs = normalizeEtabs(etablissements);
  const id = db.createReferent(mail, String(nom || '').trim(), String(prenom || '').trim(), etabs, req.admin.username);
  db.audit(req.admin.username, 'creation_referent', mail, etabs.map((e) => e.label).join(', '));
  res.status(201).json({ ok: true, id });
});

app.put('/api/admin/referents/:id', auth.requireApi, (req, res) => {
  const ref = db.getReferentById(Number(req.params.id));
  if (!ref) return res.status(404).json({ error: 'Référent introuvable' });
  const { nom, prenom, active, etablissements } = req.body || {};
  const etabs = etablissements === undefined ? undefined : normalizeEtabs(etablissements);
  db.updateReferent(ref.id, {
    nom: String(nom ?? ref.nom).trim(),
    prenom: String(prenom ?? ref.prenom).trim(),
    active: active === undefined ? ref.active : !!active,
    etabs,
  });
  db.audit(req.admin.username, 'maj_referent', ref.email, (etabs || ref.etablissements).map((e) => e.label).join(', '));
  res.json({ ok: true });
});

app.delete('/api/admin/referents/:id', auth.requireApi, (req, res) => {
  const ref = db.getReferentById(Number(req.params.id));
  if (!ref) return res.status(404).json({ error: 'Référent introuvable' });
  db.deleteReferent(ref.id);
  db.audit(req.admin.username, 'suppression_referent', ref.email);
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
