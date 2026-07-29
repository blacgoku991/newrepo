/*
 * Mise en veille des portails.
 *
 * Le gain est réel — 84 Mo par portail au repos — mais il ne vaudrait rien s'il
 * coûtait une demande perdue. Ce test vérifie surtout ce qu'on N'ÉTEINT PAS.
 */
const os = require('os'), fs = require('fs'), path = require('path'), http = require('http');
const { RACINE, verificateur, dors } = require('../lib/harnais');

process.env.SMARTFIXX_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'veille-'));
process.env.SMARTFIXX_PORT = '4071';
process.env.SMARTFIXX_PORT_BASE = '3141';
process.env.SMARTFIXX_DOMAINE = 'smartfixx.fr';
process.env.SMARTFIXX_USER = 'op';
process.env.SMARTFIXX_PASSWORD = 'MotDePasseDuPanel2026';
process.env.SMARTFIXX_DERRIERE_PROXY = 'false';
process.env.SMARTFIXX_VEILLE_MINUTES = '30';
process.env.AUTOMATION_MODE = 'demo';
process.env.WORKER_POLL_MS = '600000';
process.env.WORKER_DEMARRAGE_MS = '0';

const dbp = require(path.join(RACINE, 'superadmin/lib/db'));
const sig = require(path.join(RACINE, 'superadmin/lib/signature'));
const orch = require(path.join(RACINE, 'superadmin/lib/orchestrateur'));

const ok = verificateur();
const jour = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
/** Le futur, pour éprouver la veille sans attendre une demi-heure. */
const PLUS_TARD = Date.now() + 45 * 60 * 1000;

function societe(nom, sd) {
  const id = dbp.creerSociete({ nom, contactNom: 'C', contactEmail: 'c@c.fr', sousDomaine: sd,
    instanceUrl: `https://${sd}.smartfixx.fr` });
  dbp.ajouterLicence(id, { jeton: sig.signer({ client: nom, debut: jour(-1), fin: jour(300) }),
    client: nom, debut: jour(-1), fin: jour(300), motif: 'creation', par: 'op' });
  return id;
}
societe('Au Repos', 'repos');
societe('Occupée', 'occupee');

require(path.join(RACINE, 'superadmin/index'));

const appel = (chemin, hote) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: 4071, path: chemin, method: 'GET',
    headers: { Host: hote } }, (rep) => {
    const m = [];
    rep.on('data', (d) => m.push(d));
    rep.on('end', () => resolve({ code: rep.statusCode, corps: Buffer.concat(m).toString() }));
  });
  r.on('error', reject);
  r.end();
});

(async () => {
  await dors(1500);

  ok.titre('1. Rien ne tourne tant que personne ne vient');
  ok(Object.keys(orch.etat()).length === 0,
     `aucun portail éveillé au démarrage (${Object.keys(orch.etat()).length})`);

  ok.titre('2. La première visite réveille le portail');
  const debut = Date.now();
  const r = await appel('/connexion', 'repos.smartfixx.fr');
  const attente = Date.now() - debut;
  ok(r.code === 200 || r.code === 302, `page servie : HTTP ${r.code}`);
  ok(!!orch.etat().repos, 'le portail est en marche');
  ok(attente < 15000, `réveillé et servi en ${(attente / 1000).toFixed(1)} s`);

  ok.titre('3. Les visites suivantes ne coûtent rien');
  const t2 = Date.now();
  const r2 = await appel('/connexion', 'repos.smartfixx.fr');
  const rapide = Date.now() - t2;
  ok(r2.code === 200 || r2.code === 302, `HTTP ${r2.code}`);
  ok(rapide < 1500, `deuxième visite en ${rapide} ms`);

  ok.titre('4. Un portail sans travail finit par s’endormir');
  ok(orch.veiller(Date.now()).length === 0, 'pas d’extinction tant que la visite est récente');
  const endormis = orch.veiller(PLUS_TARD);
  ok(endormis.includes('repos'), `après 45 min sans visite : ${endormis.join(', ') || 'aucun'}`);
  await dors(1500);   // SIGTERM : le portail ferme proprement avant de partir
  ok(!orch.etat().repos, 'le processus est bien arrêté');
  ok(!orch.arreteExplicitement('repos'), 'une mise en veille n’est pas un arrêt demandé');

  ok.titre('5. Un portail qui a du travail ne s’endort PAS');
  await appel('/connexion', 'occupee.smartfixx.fr');
  await dors(1500);
  const Database = require(path.join(RACINE, 'node_modules/better-sqlite3'));
  const base = new Database(path.join(orch.INSTANCES, 'occupee', 'portail.db'));
  base.prepare(
    `INSERT INTO requests (reference, app_id, payload, demandeur, status)
     VALUES ('NS-TEST-0001', 'netsoins', '{}', 'test', 'en_attente')`
  ).run();
  base.close();
  ok(orch.aDuTravail('occupee'), 'une demande en attente est vue comme du travail');
  ok(!orch.aDuTravail('repos'), 'et l’autre portail n’en a pas');
  const endormis2 = orch.veiller(PLUS_TARD);
  ok(!endormis2.includes('occupee'),
     'la demande en attente empêche l’extinction — sinon le robot ne la traiterait jamais');
  ok(!!orch.etat().occupee, 'le portail reste en marche');

  ok.titre('6. Un portail rendormi se réveille encore');
  const r3 = await appel('/connexion', 'repos.smartfixx.fr');
  ok(r3.code === 200 || r3.code === 302, `nouvelle visite après extinction : HTTP ${r3.code}`);
  ok(!!orch.etat().repos, 'le portail est reparti');

  ok.titre('7. Un arrêt demandé par un opérateur, lui, tient');
  orch.arreter('repos');            // comme le bouton « Arrêter » du panel
  await dors(1500);
  ok(orch.arreteExplicitement('repos'), 'l’arrêt est mémorisé comme voulu');
  const r5 = await appel('/connexion', 'repos.smartfixx.fr');
  ok(r5.code === 503, `la visite ne le rallume pas : HTTP ${r5.code}`);
  ok(!orch.etat().repos, 'le portail reste éteint — sinon « Arrêter » ne voudrait rien dire');
  orch.demarrer(dbp.societeParSousDomaine('repos').id);
  await dors(2500);
  ok(!orch.arreteExplicitement('repos'), 'un démarrage explicite lève l’arrêt');

  ok.titre('8. Un sous-domaine inconnu ne démarre rien');
  const avant = Object.keys(orch.etat()).length;
  const r4 = await appel('/', 'inexistante.smartfixx.fr');
  ok(r4.code === 404, `HTTP ${r4.code}`);
  ok(Object.keys(orch.etat()).length === avant, 'aucun processus créé au passage');

  orch.arreterTout();
  await dors(1000);
  process.exit(ok.bilan('Mise en veille conforme') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
