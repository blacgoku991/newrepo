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
const sauvegarde = require('./lib/sauvegarde');

const PORT = Number(process.env.SMARTFIXX_PORT || 4000);
const HOST = process.env.SMARTFIXX_HOST || '127.0.0.1';
// Domaine racine : tout ce qui est <quelque chose>.smartfixx.fr est une société,
// le reste est le panel.
const DOMAINE = (process.env.SMARTFIXX_DOMAINE || 'smartfixx.fr').toLowerCase();
// En production, nginx est devant, sur la même machine : c'est lui qui établit
// l'adresse du visiteur. En le mettant à `false` (accès direct), on ne croit
// plus un mot des en-têtes `X-Forwarded-*` ni de `X-Real-IP`, que n'importe qui
// peut écrire.
const DERRIERE_PROXY = !/^(0|false|no)$/i.test(String(process.env.SMARTFIXX_DERRIERE_PROXY || 'true'));
// Et même alors, on ne les croit que venant du proxy lui-même. Ce processus
// n'écoute qu'en local, donc seul nginx peut l'atteindre — mais une écoute
// ouverte par erreur ne doit pas suffire à se choisir une adresse.
const PROXIES = new Set(
  (process.env.SMARTFIXX_PROXY_ADRESSES || '127.0.0.1,::1,::ffff:127.0.0.1')
    .split(',').map((v) => v.trim()).filter(Boolean)
);
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

const ADRESSE = /^[0-9a-fA-F:.]{3,45}$/;

/**
 * Adresse réelle du visiteur.
 *
 * On lit `X-Real-IP`, et JAMAIS `X-Forwarded-For`. La différence est décisive :
 * nginx REMPLACE `X-Real-IP` par l'adresse du pair, tandis qu'il AJOUTE à la
 * suite de `X-Forwarded-For` ce que le visiteur avait déjà écrit. Interpréter
 * cette chaîne revient à choisir entre des valeurs dont certaines viennent de
 * l'attaquant — et se tromper de position, c'est lui laisser une adresse
 * différente à chaque requête, donc plus aucune limitation de débit et un
 * journal d'activité signé par ses soins.
 *
 * Voir `deploiement/nginx-smartfixx.conf` : `proxy_set_header X-Real-IP
 * $remote_addr`.
 */
function ipClient(req) {
  const pair = req.socket.remoteAddress || '';
  if (DERRIERE_PROXY && PROXIES.has(pair)) {
    const reelle = String(req.headers['x-real-ip'] || '').trim();
    if (ADRESSE.test(reelle)) return reelle;
  }
  return pair;
}

/**
 * Relaie la requête vers l'instance d'une société.
 *
 * Les en-têtes d'origine sont transmis pour que l'instance sache sur quel hôte
 * elle est servie et si la connexion est chiffrée — sans quoi ses liens et ses
 * cookies seraient faux.
 *
 * `X-Forwarded-For` est REMPLACÉ, pas complété : l'instance ne doit recevoir
 * qu'une seule adresse, celle que nous avons établie. En y accolant la chaîne
 * envoyée par le visiteur, la première valeur — celle que lisent les
 * limitateurs de débit — restait la sienne : il lui suffisait de la faire
 * varier pour rendre toute limitation inopérante, et pour signer le journal
 * d'activité d'une adresse choisie.
 */
function relayer(req, res, port, h) {
  const ip = ipClient(req);
  const options = {
    host: '127.0.0.1',
    port,
    method: req.method,
    path: req.url,
    headers: {
      ...req.headers,
      host: h,
      'x-forwarded-host': h,
      // Idem pour le protocole : il vient de notre nginx, pas du visiteur.
      'x-forwarded-proto': (DERRIERE_PROXY && req.headers['x-forwarded-proto'] === 'https')
        || req.socket.encrypted ? 'https' : 'http',
      'x-forwarded-for': ip,
      'x-real-ip': ip,
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
  // Programmée après le démarrage des portails : une sauvegarde n'a d'intérêt
  // que si les bases sont là.
  sauvegarde.programmer();
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
