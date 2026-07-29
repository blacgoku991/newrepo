'use strict';

/**
 * Panel Smartfixx — administration des sociétés clientes et de leurs licences.
 *
 * ⚠️ Ce panel n'a RIEN à voir avec l'administration d'un client. Il pilote
 * l'ensemble du parc : qui est client, jusqu'à quand, et sous quelle licence.
 *
 * Ce module n'ouvre aucun port : il est monté par `superadmin/index.js`, le
 * point d'entrée unique, qui écoute et aiguille selon le nom d'hôte —
 * saas.smartfixx.fr mène ici, adef.smartfixx.fr mène à l'instance d'ADEF.
 *
 * Modèle d'hébergement : UNE INSTANCE PAR SOCIÉTÉ. Chaque cliente a son
 * processus et sa base ; aucune requête ne peut traverser d'une société à
 * l'autre, ce qui est décisif avec des données de santé.
 */

const fsp = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');

const db = require('./lib/db');
const signature = require('./lib/signature');
const logos = require('./lib/logos');
const orchestrateur = require('./lib/orchestrateur');
const reglages = require('./lib/reglages');
const supervision = require('./lib/supervision');
const sauvegarde = require('./lib/sauvegarde');

const app = express();
const COOKIE = 'smartfixx_sid';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

// --- Sécurité de base --------------------------------------------------------

const CSP = [
  "default-src 'self'",
  "script-src 'self'",          // aucun script inline
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

app.disable('x-powered-by');
// Derrière le reverse proxy OVH (nginx) : sans cela, toutes les requêtes
// paraîtraient venir de 127.0.0.1 et la limitation de débit ne protégerait rien.
app.set('trust proxy', Number(process.env.SMARTFIXX_PROXIES || 1));

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (enHttps(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
// Les logos arrivent en base64 dans le corps JSON : 512 ko d'image en pèsent
// environ 700 ko une fois encodés.
app.use(express.json({ limit: '1mb' }));

// Anti-CSRF : toute requête modifiante doit venir de notre propre origine.
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return next();
  const origine = req.headers.origin;
  if (!origine) return next(); // client hors navigateur (curl, script)
  let hote;
  try { hote = new URL(origine).host; } catch { return res.status(403).json({ error: 'Origine invalide' }); }
  if (hote !== req.headers.host) return res.status(403).json({ error: 'Origine refusée' });
  next();
});

/** HTTPS réel ou terminé par le proxy — décide du drapeau Secure et de HSTS. */
const enHttps = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https';

// `trust proxy` étant réglé, Express résout déjà l'adresse d'origine.
const ip = (req) => req.ip || req.socket.remoteAddress || '';

// --- Limitation des tentatives ----------------------------------------------

const seaux = new Map();
function limiter(nom, max, fenetreMs) {
  return (req, res, next) => {
    const cle = `${nom}:${ip(req)}`;
    const maintenant = Date.now();
    const seau = seaux.get(cle);
    if (!seau || seau.fin <= maintenant) {
      seaux.set(cle, { n: 1, fin: maintenant + fenetreMs });
      return next();
    }
    if (++seau.n > max) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessayez plus tard.' });
    }
    next();
  };
}

// --- Mots de passe et sessions ----------------------------------------------

function hacher(motDePasse) {
  const sel = crypto.randomBytes(16).toString('hex');
  return `scrypt$${sel}$${crypto.scryptSync(motDePasse, sel, 64).toString('hex')}`;
}
function verifier(motDePasse, stocke) {
  const p = String(stocke).split('$');
  if (p.length !== 3 || p[0] !== 'scrypt') return false;
  const a = Buffer.from(crypto.scryptSync(motDePasse, p[1], 64).toString('hex'), 'hex');
  const b = Buffer.from(p[2], 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Comparaison « pour rien » quand l'opérateur n'existe pas : même durée de
// réponse, donc pas d'énumération des comptes par le temps.
const HACHE_FACTICE = hacher(crypto.randomBytes(16).toString('hex'));

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
const sessionCourante = (req) => db.session(cookies(req)[COOKIE] || '') || null;

function exigeSession(req, res, next) {
  const s = sessionCourante(req);
  if (!s) return res.status(401).json({ error: 'Session expirée' });
  req.operateur = s;
  next();
}

/** Premier opérateur : créé au démarrage, mot de passe affiché une seule fois. */
function amorcerOperateur() {
  if (db.compterOperateurs() > 0) return;
  const nom = process.env.SMARTFIXX_USER || 'smartfixx';
  const genere = !process.env.SMARTFIXX_PASSWORD;
  const mdp = process.env.SMARTFIXX_PASSWORD || crypto.randomBytes(12).toString('base64url');
  db.creerOperateur(nom, hacher(mdp));
  if (genere) {
    console.warn(
      `\n[panel] Compte « ${nom} » créé avec ce mot de passe :\n\n        ${mdp}\n\n` +
      "        Il n'est affiché qu'une fois. Définissez SMARTFIXX_PASSWORD pour en choisir un.\n"
    );
  } else {
    console.log(`[panel] Compte opérateur « ${nom} » créé.`);
  }
}

// --- Connexion ---------------------------------------------------------------

app.post('/api/login', limiter('login', 10, 15 * 60 * 1000), (req, res) => {
  const { username, password } = req.body || {};
  const op = db.operateur(String(username || '').trim());
  const ok = verifier(String(password || ''), op ? op.password_hash : HACHE_FACTICE);
  if (!op || !ok) {
    db.tracer(String(username || '').trim(), 'echec_connexion', '', '', ip(req));
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  db.creerSession(token, op.id, new Date(Date.now() + SESSION_TTL_MS).toISOString().replace('T', ' ').slice(0, 19));
  db.toucherConnexion(op.id);
  db.tracer(op.username, 'connexion', '', '', ip(req));
  // `Secure` dès que la connexion est chiffrée : sur saas.smartfixx.fr le
  // cookie ne partira jamais en clair, sans réglage à ne pas oublier.
  const secure = enHttps(req) || process.env.SMARTFIXX_COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${SESSION_TTL_MS / 1000}`);
  res.json({ ok: true, username: op.username });
});

app.post('/api/logout', (req, res) => {
  const token = cookies(req)[COOKIE];
  if (token) db.supprimerSession(token);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/moi', exigeSession, (req, res) => {
  res.json({ username: req.operateur.username, empreinteCle: signature.empreinte() });
});

// --- Sociétés ----------------------------------------------------------------

const texte = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DOMAINE = (process.env.SMARTFIXX_DOMAINE || 'smartfixx.fr').toLowerCase();
// Sous-domaines qui mèneraient au panel ou à un service : jamais attribuables.
const SOUS_DOMAINES_RESERVES = new Set(['saas', 'panel', 'www', 'admin', 'api', 'mail', 'smtp', 'ftp', 'ns', 'localhost']);

/** Valide un sous-domaine, ou le déduit du nom de la société. */
function sousDomaineValide(saisi, nom) {
  const valeur = db.slug(texte(saisi, 40) || nom);
  if (!valeur) return { ok: false, erreur: 'Sous-domaine vide.' };
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(valeur)) {
    return { ok: false, erreur: 'Sous-domaine invalide : lettres, chiffres et tirets uniquement.' };
  }
  if (SOUS_DOMAINES_RESERVES.has(valeur)) {
    return { ok: false, erreur: `« ${valeur} » est réservé.` };
  }
  return { ok: true, valeur };
}

app.get('/api/societes', exigeSession, (req, res) => {
  const societes = supervision.parc().map((s) => ({ ...s, logo: !!logos.trouver(s.id) }));
  res.json({
    societes,
    alertes: supervision.alertes(),
    echeances: db.echeances(60),
    empreinteCle: signature.empreinte(),
    domaine: DOMAINE,
  });
});

// --- Sauvegardes -------------------------------------------------------------

app.get('/api/sauvegardes', exigeSession, (req, res) => {
  res.json({ sauvegardes: sauvegarde.liste(), dossier: sauvegarde.CIBLE, gardees: sauvegarde.GARDER });
});

app.post('/api/sauvegardes', exigeSession, limiter('sauvegarde', 6, 60 * 60 * 1000), (req, res) => {
  try {
    const r = sauvegarde.executer(req.operateur.username);
    res.json({ ok: true, nom: path.basename(r.dossier), elements: r.elements, erreurs: r.erreurs, octets: r.octets });
  } catch (e) {
    res.status(500).json({ error: `Sauvegarde impossible : ${e.message}` });
  }
});

/**
 * Récupère une sauvegarde, en archive.
 *
 * C'est le geste qui donne son sens à la sauvegarde : une copie qui reste sur
 * le serveur ne protège de rien le jour où le serveur disparaît. L'archive
 * contient la clé de signature et les bases des clients — le téléchargement est
 * donc limité, tracé, et l'interface prévient de la chiffrer.
 */
app.get('/api/sauvegardes/:nom', exigeSession, limiter('sauvegarde_dl', 20, 60 * 60 * 1000), (req, res) => {
  const dossier = sauvegarde.dossierDe(req.params.nom);
  if (!dossier) return res.status(404).json({ error: 'Sauvegarde introuvable' });
  const nom = path.basename(dossier);
  db.tracer(req.operateur.username, 'sauvegarde_telechargee', '', nom, ip(req));
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="smartfixx-${nom}.tar.gz"`);
  // `spawn` avec des arguments séparés, jamais un shell : le nom a beau être
  // validé, aucune chaîne venue de la requête ne doit pouvoir être interprétée
  // comme une commande.
  const tar = spawn('tar', ['-czf', '-', '-C', sauvegarde.CIBLE, nom], { stdio: ['ignore', 'pipe', 'ignore'] });
  tar.stdout.pipe(res);
  tar.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.end(); });
  // Le client ferme l'onglet : on ne laisse pas `tar` tourner dans le vide.
  res.on('close', () => { try { tar.kill(); } catch { /* déjà terminé */ } });
});

app.delete('/api/sauvegardes/:nom', exigeSession, (req, res) => {
  if (!sauvegarde.supprimer(req.params.nom, req.operateur.username)) {
    return res.status(404).json({ error: 'Sauvegarde introuvable' });
  }
  res.json({ ok: true });
});

// --- Opérateurs du panel -----------------------------------------------------

/**
 * Les comptes qui ouvrent ce panel ouvrent tout le parc. Ils se géraient
 * jusqu'ici en ligne de commande sur le serveur — donc, en pratique, pas du
 * tout : un mot de passe partagé qu'on ne change jamais.
 *
 * Deux garde-fous : on ne supprime jamais le dernier opérateur (personne ne
 * pourrait plus entrer), et on ne se supprime pas soi-même par mégarde.
 */
const MDP_MINI = 12;

app.get('/api/operateurs', exigeSession, (req, res) => {
  res.json({
    moi: req.operateur.username,
    operateurs: db.operateurs().map((o) => ({
      id: o.id, username: o.username, creeLe: o.created_at, derniereConnexion: o.last_login || null,
    })),
  });
});

app.post('/api/operateurs', exigeSession, (req, res) => {
  const nom = texte(req.body?.username, 40).toLowerCase();
  const mdp = String(req.body?.password || '');
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(nom)) {
    return res.status(400).json({ error: 'Identifiant : 3 à 40 caractères, lettres, chiffres, point, tiret ou souligné.' });
  }
  if (mdp.length < MDP_MINI) return res.status(400).json({ error: `Mot de passe : ${MDP_MINI} caractères au minimum.` });
  if (db.operateur(nom)) return res.status(409).json({ error: 'Cet identifiant est déjà pris.' });
  const id = db.creerOperateur(nom, hacher(mdp));
  db.tracer(req.operateur.username, 'operateur_cree', '', nom, ip(req));
  res.json({ ok: true, id });
});

app.put('/api/operateurs/:id/motdepasse', exigeSession, (req, res) => {
  const cible = db.operateurs().find((o) => o.id === Number(req.params.id));
  if (!cible) return res.status(404).json({ error: 'Opérateur introuvable' });
  const mdp = String(req.body?.password || '');
  if (mdp.length < MDP_MINI) return res.status(400).json({ error: `Mot de passe : ${MDP_MINI} caractères au minimum.` });
  db.majMotDePasseOperateur(cible.id, hacher(mdp));
  // Les sessions ouvertes tombent : un mot de passe changé parce qu'il a fuité
  // ne servirait à rien si le voleur restait connecté.
  db.fermerSessionsOperateur(cible.id);
  db.tracer(req.operateur.username, 'operateur_mot_de_passe', '', cible.username, ip(req));
  res.json({ ok: true, seDeconnecte: cible.username === req.operateur.username });
});

app.delete('/api/operateurs/:id', exigeSession, (req, res) => {
  const cible = db.operateurs().find((o) => o.id === Number(req.params.id));
  if (!cible) return res.status(404).json({ error: 'Opérateur introuvable' });
  if (cible.username === req.operateur.username) {
    return res.status(409).json({ error: 'Vous ne pouvez pas supprimer le compte avec lequel vous êtes connecté.' });
  }
  if (db.compterOperateurs() <= 1) {
    return res.status(409).json({ error: 'C’est le dernier opérateur : le supprimer fermerait le panel à tout le monde.' });
  }
  db.fermerSessionsOperateur(cible.id);
  db.supprimerOperateur(cible.id);
  db.tracer(req.operateur.username, 'operateur_supprime', '', cible.username, ip(req));
  res.json({ ok: true });
});

// --- Pilotage des instances --------------------------------------------------

app.post('/api/societes/:id/instance/:action', exigeSession, async (req, res) => {
  const s = db.societe(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Société introuvable' });
  const action = String(req.params.action);
  let r;
  if (action === 'demarrer') r = orchestrateur.demarrer(s.id);
  else if (action === 'arreter') r = orchestrateur.arreter(s.sous_domaine);
  else if (action === 'redemarrer') r = await orchestrateur.redemarrer(s.id);
  else return res.status(400).json({ error: 'Action inconnue' });

  if (!r.ok) return res.status(409).json({ error: r.raison });
  db.tracer(req.operateur.username, `instance_${action}`, s.nom, s.sous_domaine, ip(req));
  res.json({ ok: true, ...r });
});

/**
 * Dernières lignes du portail d'une société.
 *
 * Quand un portail repart en boucle, la seule question utile est « qu'est-ce
 * qu'il dit avant de tomber ? ». Ces lignes vivent en mémoire, jamais sur le
 * disque, et les adresses e-mail y sont masquées : le panel n'a pas à connaître
 * les salariés de ses clients, pas même par un message d'erreur.
 */
app.get('/api/societes/:id/journal', exigeSession, (req, res) => {
  const s = db.societe(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Société introuvable' });
  res.json({
    societe: { id: s.id, nom: s.nom, sousDomaine: s.sous_domaine },
    lignes: s.sous_domaine ? orchestrateur.journalDe(s.sous_domaine, Number(req.query.limite) || 200) : [],
    enMarche: !!(s.sous_domaine && orchestrateur.etat()[s.sous_domaine]),
  });
});

app.post('/api/societes', exigeSession, (req, res) => {
  const nom = texte(req.body?.nom, 120);
  if (!nom) return res.status(400).json({ error: 'Le nom de la société est obligatoire.' });
  if (db.societeParNom(nom)) return res.status(409).json({ error: 'Une société porte déjà ce nom.' });
  const sd = sousDomaineValide(req.body?.sousDomaine, nom);
  if (!sd.ok) return res.status(400).json({ error: sd.erreur });
  if (db.societeParSousDomaine(sd.valeur)) {
    return res.status(409).json({ error: `Le sous-domaine « ${sd.valeur} » est déjà pris.` });
  }
  const id = db.creerSociete({
    nom,
    contactNom: texte(req.body?.contactNom, 120),
    contactEmail: texte(req.body?.contactEmail, 160),
    notes: texte(req.body?.notes, 1000),
    sousDomaine: sd.valeur,
    // L'adresse publique découle du sous-domaine : rien à saisir deux fois.
    instanceUrl: `https://${sd.valeur}.${DOMAINE}`,
    instancePort: null,
  });
  db.tracer(req.operateur.username, 'societe_creee', nom, `${sd.valeur}.${DOMAINE}`, ip(req));
  res.json({ ok: true, id, sousDomaine: sd.valeur });
});

app.put('/api/societes/:id', exigeSession, (req, res) => {
  const s = db.societe(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Société introuvable' });
  const nom = texte(req.body?.nom, 120) || s.nom;
  const autre = db.societeParNom(nom);
  if (autre && autre.id !== s.id) return res.status(409).json({ error: 'Une société porte déjà ce nom.' });
  const sd = sousDomaineValide(req.body?.sousDomaine, nom);
  if (!sd.ok) return res.status(400).json({ error: sd.erreur });
  const occupant = db.societeParSousDomaine(sd.valeur);
  if (occupant && occupant.id !== s.id) {
    return res.status(409).json({ error: `Le sous-domaine « ${sd.valeur} » est déjà pris.` });
  }
  db.majSociete(s.id, {
    nom,
    contactNom: texte(req.body?.contactNom, 120),
    contactEmail: texte(req.body?.contactEmail, 160),
    notes: texte(req.body?.notes, 1000),
    sousDomaine: sd.valeur,
    instanceUrl: `https://${sd.valeur}.${DOMAINE}`,
    instancePort: s.instance_port,
  });
  db.tracer(req.operateur.username, 'societe_modifiee', nom, `${sd.valeur}.${DOMAINE}`, ip(req));
  res.json({ ok: true });
});

app.post('/api/societes/:id/archiver', exigeSession, (req, res) => {
  const s = db.societe(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Société introuvable' });
  const archivee = !!req.body?.archivee;
  db.archiverSociete(s.id, archivee);
  // Archiver doit COUPER l'accès, pas seulement griser une carte : c'est le
  // seul geste qui ferme réellement le portail d'un client.
  if (archivee) orchestrateur.arreter(s.sous_domaine);
  else orchestrateur.demarrer(s.id);
  db.tracer(req.operateur.username, archivee ? 'societe_archivee' : 'societe_reactivee', s.nom, '', ip(req));
  res.json({ ok: true });
});

/**
 * Efface définitivement une société : registre, licences, réglages, et le
 * dossier du portail avec sa base.
 *
 * Trois verrous, parce que c'est le seul geste du panel qui détruit les données
 * d'un client :
 *   1. la société doit être archivée — donc déjà coupée, décision prise ;
 *   2. il faut retaper son nom exactement, à la manière de GitHub ;
 *   3. une sauvegarde est prise juste avant, quoi qu'il arrive.
 */
app.delete('/api/societes/:id', exigeSession, limiter('suppression', 5, 60 * 60 * 1000), (req, res) => {
  const s = db.societe(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Société introuvable' });
  if (!s.archivee) {
    return res.status(409).json({ error: 'Archivez d’abord la société : la suppression n’efface qu’un accès déjà fermé.' });
  }
  if (texte(req.body?.confirmation, 120) !== s.nom) {
    return res.status(400).json({ error: 'Le nom saisi ne correspond pas à celui de la société.' });
  }

  // Une sauvegarde d'abord : effacer sur un geste malheureux ne doit pas être
  // la fin de l'histoire.
  let sauvee = null;
  try { sauvee = path.basename(sauvegarde.executer(`${req.operateur.username} (avant suppression)`).dossier); }
  catch (e) { return res.status(500).json({ error: `Sauvegarde préalable impossible, suppression annulée : ${e.message}` }); }

  if (s.sous_domaine) orchestrateur.arreter(s.sous_domaine);
  logos.supprimer(s.id);
  let dossierEfface = false;
  if (s.sous_domaine) {
    const dossier = path.join(orchestrateur.INSTANCES, s.sous_domaine);
    // On ne suit pas un lien symbolique et on ne sort pas du dossier des
    // instances : le sous-domaine est validé à l'écriture, on le revérifie ici.
    if (path.dirname(path.resolve(dossier)) === path.resolve(orchestrateur.INSTANCES)) {
      try { fsp.rmSync(dossier, { recursive: true, force: true }); dossierEfface = true; }
      catch { /* dossier déjà absent ou verrouillé */ }
    }
  }
  db.supprimerSociete(s.id);
  db.tracer(req.operateur.username, 'societe_supprimee', s.nom,
    `${s.sous_domaine || 'sans sous-domaine'} — sauvegarde ${sauvee}`, ip(req));
  res.json({ ok: true, sauvegarde: sauvee, dossierEfface });
});

// --- Réglages d'une société --------------------------------------------------

app.get('/api/societes/:id/reglages', exigeSession, (req, res) => {
  const s = db.societe(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Société introuvable' });
  res.json({ societe: { id: s.id, nom: s.nom, sousDomaine: s.sous_domaine }, ...reglages.etat(s.id) });
});

app.put('/api/societes/:id/reglages', exigeSession, async (req, res) => {
  const s = db.societe(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Société introuvable' });
  const corps = req.body && typeof req.body === 'object' ? req.body : {};
  const { modifies } = reglages.definir(s.id, corps, req.operateur.username);
  if (modifies.length) {
    // Le journal retient CE QUI a changé, jamais la valeur.
    db.tracer(req.operateur.username, 'reglages_modifies', s.nom, modifies.join(', '), ip(req));
  }
  // Les réglages sont injectés au démarrage : sans redémarrage, ils ne
  // prendraient effet qu'au prochain incident.
  let instance = null;
  if (modifies.length && orchestrateur.etat()[s.sous_domaine]) {
    try { instance = await orchestrateur.redemarrer(s.id); } catch (e) { instance = { ok: false, raison: e.message }; }
  }
  res.json({ ok: true, modifies, instance, ...reglages.etat(s.id) });
});

// --- Logos -------------------------------------------------------------------

/**
 * Le logo est servi SOUS SESSION : le parc clients n'a pas à être devinable
 * depuis l'extérieur en tâtonnant sur les identifiants.
 */
app.get('/api/societes/:id/logo', exigeSession, (req, res) => {
  const trouve = logos.trouver(Number(req.params.id));
  if (!trouve) return res.status(404).end();
  res.setHeader('Content-Type', trouve.type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.sendFile(trouve.fichier);
});

app.put('/api/societes/:id/logo', exigeSession, (req, res) => {
  const s = db.societe(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Société introuvable' });
  try {
    const info = logos.enregistrer(s.id, req.body?.image);
    db.tracer(req.operateur.username, 'logo_modifie', s.nom, `${info.ext}, ${Math.round(info.taille / 1024)} ko`, ip(req));
    res.json({ ok: true, ...info });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/societes/:id/logo', exigeSession, (req, res) => {
  const s = db.societe(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Société introuvable' });
  logos.supprimer(s.id);
  db.tracer(req.operateur.username, 'logo_supprime', s.nom, '', ip(req));
  res.json({ ok: true });
});

// --- Licences ----------------------------------------------------------------

app.get('/api/societes/:id/licences', exigeSession, (req, res) => {
  const s = db.societe(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Société introuvable' });
  res.json({
    societe: { id: s.id, nom: s.nom },
    licences: db.licences(s.id).map((l) => ({
      id: l.id, debut: l.debut, fin: l.fin, grace: l.grace, motif: l.motif,
      emiseLe: l.created_at, emisePar: l.created_by,
      revoqueeLe: l.revoquee_le, revoqueeMotif: l.revoquee_motif,
      jeton: l.jeton,
    })),
  });
});

/**
 * Émet une licence.
 *
 * La licence précédente n'est PAS révoquée automatiquement : un renouvellement
 * anticipé doit laisser l'ancienne valable jusqu'à son terme, sinon on coupe le
 * client entre les deux. La révocation est un geste explicite.
 */
app.post('/api/societes/:id/licences', exigeSession, async (req, res) => {
  const s = db.societe(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Société introuvable' });

  const debut = texte(req.body?.debut, 10) || new Date().toISOString().slice(0, 10);
  const fin = texte(req.body?.fin, 10);
  if (!DATE.test(debut) || !DATE.test(fin)) {
    return res.status(400).json({ error: 'Dates attendues au format AAAA-MM-JJ.' });
  }
  if (fin <= debut) return res.status(400).json({ error: 'La date de fin doit suivre la date de début.' });

  const grace = Number(req.body?.grace);
  const charge = {
    // Le nom porté par la licence est celui affiché chez le client : il doit
    // rester celui de la société, jamais un identifiant interne.
    client: s.nom,
    debut,
    fin,
    ...(Number.isFinite(grace) ? { grace } : {}),
    ...(texte(req.body?.install, 64) ? { install: texte(req.body?.install, 64) } : {}),
  };
  const jeton = signature.signer(charge);
  const motif = db.licences(s.id).length ? 'renouvellement' : 'creation';
  const id = db.ajouterLicence(s.id, { jeton, client: s.nom, debut, fin, grace, motif, par: req.operateur.username });
  db.tracer(req.operateur.username, 'licence_emise', s.nom, `${motif} — du ${debut} au ${fin}`, ip(req));
  // La licence est posée dans l'instance au démarrage : on la (re)lance pour
  // qu'elle en tienne compte tout de suite, sans intervention sur le serveur.
  let instance = null;
  try {
    instance = await orchestrateur.redemarrer(s.id);
  } catch (e) {
    instance = { ok: false, raison: e.message };
  }
  res.json({ ok: true, id, jeton, debut, fin, motif, instance });
});

app.post('/api/licences/:id/revoquer', exigeSession, (req, res) => {
  const l = db.licence(Number(req.params.id));
  if (!l) return res.status(404).json({ error: 'Licence introuvable' });
  const motif = texte(req.body?.motif, 300);
  if (!motif) return res.status(400).json({ error: 'Indiquez le motif de la révocation.' });
  if (!db.revoquer(l.id, motif)) return res.status(409).json({ error: 'Licence déjà révoquée.' });
  const s = db.societe(l.societe_id);
  db.tracer(req.operateur.username, 'licence_revoquee', s ? s.nom : '', motif, ip(req));
  // Une licence révoquée ici ne s'efface pas toute seule chez le client : le
  // jeton déjà installé reste valable jusqu'à sa date de fin. C'est le prix de
  // la vérification hors ligne, et l'interface le dit clairement.
  res.json({ ok: true, avertissement: 'Le jeton déjà installé chez le client reste valable jusqu’à sa date de fin.' });
});

// --- Journal et clé ----------------------------------------------------------

app.get('/api/journal', exigeSession, (req, res) => {
  res.json({ entrees: db.journal(Number(req.query.limite) || 300) });
});

/** Clé publique à embarquer dans le produit livré. */
app.get('/api/cle', exigeSession, (req, res) => {
  res.json({ publique: signature.clePubliqueB64(), empreinte: signature.empreinte() });
});

// --- Pages -------------------------------------------------------------------

const PUBLIC = path.join(__dirname, 'public');
app.get(['/', '/index.html'], (req, res) => {
  if (!sessionCourante(req)) return res.redirect('/login.html');
  res.sendFile(path.join(PUBLIC, 'index.html'));
});
app.use(express.static(PUBLIC, { index: false }));

// --- Démarrage ---------------------------------------------------------------

amorcerOperateur();
db.purgerSessions();
setInterval(() => { try { db.purgerSessions(); } catch { /* confort */ } }, 3600 * 1000).unref();

console.log(`[panel] Registre : ${db.FICHIER}`);
console.log(`[panel] Empreinte de la clé de signature : ${signature.empreinte()}`);

// Le panel n'ouvre PAS de port : c'est `superadmin/index.js` qui écoute et
// aiguille, pour qu'il n'y ait qu'un seul programme à lancer.
module.exports = app;
