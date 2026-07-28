'use strict';

/**
 * Point d'entrée UNIQUE de Smartfixx.
 *
 *     npm start
 *
 * Un seul programme à lancer. Il :
 *   1. sert le panel super-admin sur le domaine principal (saas.smartfixx.fr) ;
 *   2. démarre une instance du portail par société cliente, chacune avec sa
 *      propre base de données ;
 *   3. route chaque requête vers la bonne instance d'après le sous-domaine
 *      (adef.smartfixx.fr → l'instance d'ADEF).
 *
 * Devant, un seul enregistrement DNS générique (`*.smartfixx.fr`) et une seule
 * configuration nginx suffisent : ajouter une société ne demande plus aucune
 * intervention sur le serveur.
 */

const http = require('http');
const path = require('path');

const panel = require('./server');
const db = require('./lib/db');
const orchestrateur = require('./lib/orchestrateur');

const PORT = Number(process.env.SMARTFIXX_PORT || 4000);
const HOST = process.env.SMARTFIXX_HOST || '127.0.0.1';
// Domaine racine : tout ce qui est <quelque chose>.smartfixx.fr est une société,
// le reste est le panel.
const DOMAINE = (process.env.SMARTFIXX_DOMAINE || 'smartfixx.fr').toLowerCase();
// Hôtes qui mènent au panel plutôt qu'à une société.
const HOTES_PANEL = new Set(
  (process.env.SMARTFIXX_HOTES_PANEL || `saas.${DOMAINE},panel.${DOMAINE},localhost,127.0.0.1`)
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
);

/** Nom d'hôte demandé, sans le port ni la casse. */
function hote(req) {
  return String(req.headers.host || '').toLowerCase().split(':')[0];
}

/**
 * Sous-domaine d'une société, ou `null` si la requête vise le panel.
 *
 * On n'accepte que le premier niveau sous le domaine racine : « adef », jamais
 * « a.b ». Sans cette règle, un hôte forgé pourrait viser un nom inattendu.
 */
function sousDomaine(h) {
  if (!h.endsWith(`.${DOMAINE}`)) return null;
  const reste = h.slice(0, -(DOMAINE.length + 1));
  return /^[a-z0-9-]{1,40}$/.test(reste) ? reste : null;
}

/** Page servie quand un sous-domaine ne mène nulle part. */
function pageSimple(res, code, titre, message) {
  const echapper = (v) => String(v).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${echapper(titre)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1220;color:#e8ecf6;
font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px}
.b{max-width:440px;text-align:center}h1{font-size:1.25rem;margin:0 0 10px}p{color:#8b96b0;margin:0}</style>
</head><body><div class="b"><h1>${echapper(titre)}</h1><p>${echapper(message)}</p></div></body></html>`);
}

/**
 * Relaie la requête vers l'instance d'une société.
 *
 * Les en-têtes d'origine sont transmis pour que l'instance sache sur quel hôte
 * elle est servie et si la connexion est chiffrée — sans quoi ses liens et ses
 * cookies seraient faux.
 */
function relayer(req, res, port, h) {
  const options = {
    host: '127.0.0.1',
    port,
    method: req.method,
    path: req.url,
    headers: {
      ...req.headers,
      host: h,
      'x-forwarded-host': h,
      'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'http',
      'x-forwarded-for': (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'] + ', ' : '')
        + (req.socket.remoteAddress || ''),
    },
  };
  const relais = http.request(options, (reponse) => {
    res.writeHead(reponse.statusCode, reponse.headers);
    reponse.pipe(res);
  });
  relais.on('error', () => {
    if (!res.headersSent) {
      pageSimple(res, 502, 'Portail momentanément indisponible',
        "L'instance de cette société ne répond pas. Elle redémarre peut-être ; réessayez dans un instant.");
    } else {
      res.destroy();
    }
  });
  req.pipe(relais);
}

const serveur = http.createServer((req, res) => {
  const h = hote(req);

  // Le panel n'est servi que sur les hôtes explicitement prévus. Tout autre
  // nom — y compris un `Host` forgé pointant vers notre adresse — est refusé
  // avant même d'atteindre l'application.
  if (HOTES_PANEL.has(h)) return panel(req, res);

  const sd = sousDomaine(h);
  if (!sd) {
    return pageSimple(res, 404, 'Adresse inconnue',
      "Aucun service n'est associé à cette adresse.");
  }

  const societe = db.societeParSousDomaine(sd);
  if (!societe) {
    return pageSimple(res, 404, 'Adresse inconnue',
      "Aucun portail n'est associé à cette adresse.");
  }
  if (societe.archivee) {
    return pageSimple(res, 403, 'Portail fermé',
      'Ce portail a été fermé. Rapprochez-vous de votre prestataire.');
  }
  const port = orchestrateur.portPour(sd);
  if (!port) {
    return pageSimple(res, 503, 'Portail en cours de démarrage',
      'Le portail de cette société démarre ou est arrêté. Réessayez dans quelques instants.');
  }
  relayer(req, res, port, h);
});

// Arrêt propre : on prévient les instances avant de partir, pour qu'elles
// terminent les demandes en cours plutôt que de les abandonner en plein robot.
let extinction = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (extinction) return;
    extinction = true;
    console.log('\n[smartfixx] Extinction : arrêt des instances…');
    orchestrateur.arreterTout();
    serveur.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 20000).unref();
  });
}

serveur.listen(PORT, HOST, () => {
  console.log(`\n  Smartfixx — ${HOST}:${PORT}`);
  console.log(`  Panel      : ${[...HOTES_PANEL].slice(0, 2).join(', ')}`);
  console.log(`  Sociétés   : <sous-domaine>.${DOMAINE}\n`);
  const resultats = orchestrateur.demarrerTout();
  if (!resultats.length) {
    console.log('  Aucune société enregistrée. Créez-en une depuis le panel.\n');
  } else {
    for (const r of resultats) {
      console.log(`  ${r.ok ? '●' : '○'} ${r.societe} → ${r.sousDomaine}.${DOMAINE}${r.ok ? ` (port ${r.port})` : ` — ${r.raison}`}`);
    }
    console.log('');
  }
});

module.exports = serveur;
