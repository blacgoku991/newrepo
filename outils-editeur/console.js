#!/usr/bin/env node
'use strict';

/**
 * CONSOLE ÉDITEUR ALGONIS — à exécuter sur VOTRE poste uniquement.
 *
 *   node console.js
 *
 * Ouvre un petit panneau dans le navigateur pour :
 *   - voir toutes les sociétés à qui vous avez livré le portail ;
 *   - voir leurs licences, la date d'échéance et ce qui arrive à expiration ;
 *   - générer / renouveler une licence en deux clics ;
 *   - récupérer une licence déjà émise (copier-coller du jeton).
 *
 * Aucune dépendance, aucun accès réseau sortant. Le serveur n'écoute que sur
 * 127.0.0.1, exige un jeton de session tiré au hasard à chaque démarrage, et
 * refuse toute requête dont l'en-tête Host n'est pas la boucle locale (parade
 * classique au « DNS rebinding »).
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const sig = require('./lib/signature');
const registre = require('./lib/registre');

const PORT = Number(process.env.PORT || 4321);
const JETON_SESSION = crypto.randomBytes(24).toString('hex');
const RACINE_WEB = path.join(__dirname, 'console');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const CSP = [
  "default-src 'none'",
  "style-src 'self'",
  "script-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

function envoyer(res, code, corps, type = 'application/json; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type,
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  res.end(corps);
}

const json = (res, code, obj) => envoyer(res, code, JSON.stringify(obj));

function corpsJson(req) {
  return new Promise((resolve, reject) => {
    let brut = '';
    req.on('data', (c) => {
      brut += c;
      if (brut.length > 200_000) { reject(new Error('Requête trop volumineuse.')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(brut ? JSON.parse(brut) : {}); } catch { reject(new Error('JSON invalide.')); }
    });
    req.on('error', reject);
  });
}

/** Seule la boucle locale est acceptée, jeton de session obligatoire sur /api. */
function hoteLocal(req) {
  const hote = String(req.headers.host || '');
  return hote === `127.0.0.1:${PORT}` || hote === `localhost:${PORT}` || hote === `[::1]:${PORT}`;
}

function etatCles() {
  const publique = sig.clePubliqueLocale();
  return {
    clePrivee: fs.existsSync(sig.cheminClePrivee()),
    clePublique: publique,
    empreinte: sig.empreinte(publique),
    dossier: sig.dossierAlgonis(),
    fichierRegistre: registre.FICHIER(),
  };
}

async function api(req, res, url) {
  const chemin = url.pathname.replace(/^\/api/, '');
  const methode = req.method;
  const segments = chemin.split('/').filter(Boolean);

  if (methode === 'GET' && chemin === '/etat') {
    return json(res, 200, { ...registre.vue(), cles: etatCles(), aujourdhui: sig.aujourdhui() });
  }

  if (methode === 'POST' && chemin === '/societes') {
    const body = await corpsJson(req);
    if (!body.nom || !String(body.nom).trim()) return json(res, 400, { erreur: 'Le nom de la société est obligatoire.' });
    return json(res, 201, { societe: registre.creer(body) });
  }

  // /societes/:id …
  if (segments[0] === 'societes' && segments[1]) {
    const idSociete = segments[1];

    if (methode === 'PATCH' && segments.length === 2) {
      const body = await corpsJson(req);
      const societe = registre.modifier(idSociete, body);
      return societe ? json(res, 200, { societe }) : json(res, 404, { erreur: 'Société inconnue.' });
    }

    if (methode === 'DELETE' && segments.length === 2) {
      return registre.supprimer(idSociete)
        ? json(res, 200, { ok: true })
        : json(res, 404, { erreur: 'Société inconnue.' });
    }

    if (methode === 'POST' && segments[2] === 'licences' && segments.length === 3) {
      const body = await corpsJson(req);
      const donnees = registre.charger();
      const societe = donnees.societes.find((s) => s.id === idSociete);
      if (!societe) return json(res, 404, { erreur: 'Société inconnue.' });

      const champs = {
        client: societe.nom,
        debut: body.debut || sig.aujourdhui(),
        fin: body.fin,
        grace: Number(body.grace || 0),
        install: (body.install ?? societe.installId) || '',
        note: body.note || '',
      };
      const erreurs = sig.verifierChamps(champs);
      if (erreurs.length) return json(res, 400, { erreur: erreurs.join(' ') });

      let signe;
      try {
        signe = sig.signer(champs);
      } catch (e) {
        return json(res, e.code === 'CLE_ABSENTE' ? 409 : 500, { erreur: e.message });
      }
      const ajout = registre.ajouterLicence(idSociete, {
        ...signe.charge, jeton: signe.jeton, emis: new Date().toISOString(),
      });
      return json(res, 201, { jeton: signe.jeton, charge: signe.charge, societe: ajout.societe });
    }

    if (methode === 'POST' && segments[2] === 'licences' && segments[3] === 'import') {
      const body = await corpsJson(req);
      // Sans clé publique locale, la signature ne peut pas être contrôlée :
      // on refuse plutôt que d'archiver n'importe quel texte comme licence.
      if (!sig.clePubliqueLocale()) {
        return json(res, 409, { erreur: 'Aucune clé publique sur ce poste : impossible de vérifier cette licence.' });
      }
      const lu = sig.lire(body.jeton);
      if (!lu.valide || !lu.signatureVerifiee) return json(res, 400, { erreur: lu.raison || 'Signature non vérifiable.' });
      const ajout = registre.ajouterLicence(idSociete, {
        ...lu.charge, jeton: String(body.jeton).trim(), emis: new Date().toISOString(), importee: true,
      });
      if (!ajout) return json(res, 404, { erreur: 'Société inconnue.' });
      return json(res, ajout.doublon ? 200 : 201, { doublon: ajout.doublon, charge: lu.charge });
    }
  }

  return json(res, 404, { erreur: 'Route inconnue.' });
}

function statique(res, url) {
  const nom = url.pathname === '/' ? '/index.html' : url.pathname;
  const fichier = path.join(RACINE_WEB, path.normalize(nom).replace(/^(\.\.[/\\])+/, ''));
  // Le séparateur évite qu'un dossier voisin (« console-autre ») passe le test.
  if (!fichier.startsWith(RACINE_WEB + path.sep) || !fs.existsSync(fichier) || !fs.statSync(fichier).isFile()) {
    return envoyer(res, 404, 'Introuvable', 'text/plain; charset=utf-8');
  }
  envoyer(res, 200, fs.readFileSync(fichier), TYPES[path.extname(fichier)] || 'application/octet-stream');
}

const serveur = http.createServer(async (req, res) => {
  if (!hoteLocal(req)) return envoyer(res, 403, 'Accès local uniquement', 'text/plain; charset=utf-8');
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname.startsWith('/api/')) {
    const fourni = req.headers['x-console-jeton'] || url.searchParams.get('jeton') || '';
    const attendu = Buffer.from(JETON_SESSION);
    const recu = Buffer.from(String(fourni));
    if (recu.length !== attendu.length || !crypto.timingSafeEqual(recu, attendu)) {
      return json(res, 401, { erreur: 'Session invalide : relancez la console.' });
    }
    try {
      return await api(req, res, url);
    } catch (e) {
      return json(res, 400, { erreur: e.message || 'Requête invalide.' });
    }
  }
  statique(res, url);
});

serveur.listen(PORT, '127.0.0.1', () => {
  const adresse = `http://127.0.0.1:${PORT}/#jeton=${JETON_SESSION}`;
  const cles = etatCles();
  console.log('');
  console.log('  Console éditeur Algonis');
  console.log(`  Registre     : ${cles.fichierRegistre}`);
  console.log(`  Clé privée   : ${cles.clePrivee ? 'présente' : 'ABSENTE — lancez scripts/licence-keygen.js'}`);
  console.log(`  Empreinte    : ${cles.empreinte || '—'}`);
  console.log('');
  console.log('  Ouvrez cette adresse (elle change à chaque démarrage) :');
  console.log(`  ${adresse}`);
  console.log('');
  console.log('  Ctrl+C pour arrêter.');
  console.log('');
  if (!process.env.ALGONIS_SANS_NAVIGATEUR) ouvrir(adresse);
});

serveur.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`✗ Le port ${PORT} est déjà utilisé. Relancez avec : PORT=4322 node console.js`);
    process.exit(1);
  }
  throw e;
});

function ouvrir(adresse) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', adresse]]
    : process.platform === 'darwin' ? ['open', [adresse]]
      : ['xdg-open', [adresse]];
  try {
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch { /* pas de navigateur : l'adresse est affichée ci-dessus */ }
}
