/* Activité, alertes et sauvegardes du parc. */
const os = require('os'), fs = require('fs'), path = require('path'), http = require('http');
const { RACINE } = require('../lib/harnais');
process.env.SMARTFIXX_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sup-'));
process.env.SMARTFIXX_USER = 'achraf'; process.env.SMARTFIXX_PASSWORD = 'panel-secret';
process.env.SMARTFIXX_PORT = '4070'; process.env.SMARTFIXX_DOMAINE = 'smartfixx.fr';
process.env.AUTOMATION_MODE = 'demo'; process.env.WORKER_DEMARRAGE_MS = '0';
process.env.WORKER_POLL_MS = '600000'; process.env.SMARTFIXX_SAUVEGARDES_GARDEES = '3';
let ok = true;
const dit = (b, t) => { if (!b) ok = false; console.log(`  ${b ? '✓' : '✗'} ${t}`); };
const titre = (t) => console.log(`\n— ${t} —`);
const dors = (ms) => new Promise((r) => setTimeout(r, ms));
require(path.join(RACINE, 'superadmin/index'));
let cookie = '';
const q = (m, u, corps) => new Promise((res, rej) => {
  const c = corps === undefined ? null : JSON.stringify(corps);
  const r = http.request({ host: '127.0.0.1', port: 4070, method: m, path: u, headers: {
    Host: 'saas.smartfixx.fr', ...(c ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(c) } : {}),
    ...(cookie ? { Cookie: cookie } : {}) } }, (rep) => {
    const set = (rep.headers['set-cookie'] || []).find((x) => x.startsWith('smartfixx_sid='));
    if (set) cookie = set.split(';')[0];
    let d = ''; rep.on('data', (x) => { d += x; });
    rep.on('end', () => { let b = d; try { b = JSON.parse(d); } catch {} res({ status: rep.statusCode, body: b }); });
  });
  r.on('error', rej); if (c) r.write(c); r.end();
});

(async () => {
  await dors(1200);
  titre('1. Fermé sans session');
  dit((await q('GET', '/api/sauvegardes')).status === 401, 'sauvegardes : lecture refusée');
  dit((await q('POST', '/api/sauvegardes')).status === 401, 'sauvegardes : déclenchement refusé');
  await q('POST', '/api/login', { username: 'achraf', password: 'panel-secret' });

  const an = new Date(); an.setFullYear(an.getFullYear() + 1);
  const idA = (await q('POST', '/api/societes', { nom: 'Société A', sousDomaine: 'aaa' })).body.id;
  await q('POST', `/api/societes/${idA}/licences`, { debut: new Date().toISOString().slice(0, 10), fin: an.toISOString().slice(0, 10) });
  // Société sans licence : doit remonter en alerte.
  await q('POST', '/api/societes', { nom: 'Société B', sousDomaine: 'bbb' });
  for (let i = 0; i < 50; i++) {
    if ((await q('GET', '/api/societes')).body.societes.find((s) => s.id === idA).instance.enMarche) break;
    await dors(400);
  }
  // Quelques demandes dans la base de A.
  const base = path.join(process.env.SMARTFIXX_DIR, 'instances', 'aaa', 'portail.db');
  const Database = require(path.join(RACINE, 'node_modules/better-sqlite3'));
  // Le portail crée sa base au démarrage : on attend qu'elle porte ses tables,
  // sinon on écrirait dans un fichier vide et le test ne prouverait rien.
  for (let i = 0; i < 60; i++) {
    try {
      const t = new Database(base, { readonly: true, fileMustExist: true });
      const pret = t.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='requests'").get();
      t.close();
      if (pret) break;
    } catch { /* pas encore là */ }
    await dors(500);
  }
  const c = new Database(base);
  const ins = c.prepare("INSERT INTO requests (reference, app_id, payload, status) VALUES (?, 'bluekango', '{}', ?)");
  ['terminee','terminee','terminee','echec','en_attente'].forEach((st, i) => ins.run(`R-${i}`, st));
  c.close();

  titre('2. Le panel voit l’activité de chaque portail');
  const v = (await q('GET', '/api/societes')).body;
  const a = v.societes.find((s) => s.id === idA);
  dit(a.activite && a.activite.total === 5, `${a.activite && a.activite.total} demandes remontées`);
  dit(a.activite.echecs === 1 && a.activite.enAttente === 1, `1 échec, 1 en attente`);
  dit(a.activite.derniereDemande !== null, 'dernière activité connue');
  dit(a.instance.enMarche === true, 'portail vu en marche');

  titre('3. Aucune donnée nominative ne remonte au panel');
  dit(!JSON.stringify(v).includes('payload'), 'pas de charge des demandes');
  dit(!/nom|prenom|email/i.test(JSON.stringify(a.activite)), 'seulement des compteurs');

  titre('4. Alertes');
  const noms = v.alertes.map((x) => `${x.societe}/${x.titre}`);
  dit(v.alertes.some((x) => x.societe === 'Société B' && /licence/i.test(x.titre)), `société sans licence signalée`);
  console.log('   ' + noms.join(' · '));

  titre('5. Sauvegarde');
  let r = await q('POST', '/api/sauvegardes');
  dit(r.status === 200 && r.body.elements.length >= 2, `${r.body.elements.length} éléments : ${r.body.elements.join(', ')}`);
  dit(r.body.erreurs.length === 0, 'aucune erreur');
  const dossier = path.join(process.env.SMARTFIXX_DIR, 'sauvegardes', r.body.nom);
  dit(fs.existsSync(path.join(dossier, 'smartfixx.db')), 'registre du parc sauvegardé');
  dit(fs.existsSync(path.join(dossier, 'cle-privee.pem')), 'clé de signature incluse');
  dit(fs.existsSync(path.join(dossier, 'instances', 'aaa', 'portail.db')), 'base de la société sauvegardée');
  dit(fs.existsSync(path.join(dossier, 'INVENTAIRE.txt')), 'inventaire écrit');

  titre('6. La copie est exploitable, pas tronquée');
  const copie = new Database(path.join(dossier, 'instances', 'aaa', 'portail.db'), { readonly: true });
  const n = copie.prepare('SELECT COUNT(*) n FROM requests').get().n;
  copie.close();
  dit(n === 5, `les 5 demandes sont dans la copie (${n}) — image cohérente malgré le portail actif`);
  const droits = (fs.statSync(path.join(dossier, 'cle-privee.pem')).mode & 0o777).toString(8);
  dit(droits === '600', `clé sauvegardée en permissions ${droits}`);

  titre('7. Rétention');
  for (let i = 0; i < 3; i++) { await dors(1100); await q('POST', '/api/sauvegardes'); }
  const liste = (await q('GET', '/api/sauvegardes')).body.sauvegardes;
  dit(liste.length === 3, `${liste.length} sauvegardes conservées sur 4 faites (limite 3)`);
  dit(liste[0].nom > liste[2].nom, 'les plus récentes sont gardées');

  require(path.join(RACINE, 'superadmin/lib/orchestrateur')).arreterTout();
  await dors(800);
  console.log(ok ? '\n>>> Supervision et sauvegarde conformes ✓' : '\n>>> DES CAS ONT ÉCHOUÉ');
  process.exit(ok ? 0 : 1);
})();
