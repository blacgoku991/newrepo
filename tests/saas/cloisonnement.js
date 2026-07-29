/* Deux sociétés voisines : peut-on passer de l'une à l'autre ? */
const os = require('os'), fs = require('fs'), path = require('path'), http = require('http');
const { RACINE } = require('../lib/harnais');
process.env.SMARTFIXX_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'clo-'));
process.env.SMARTFIXX_USER = 'achraf'; process.env.SMARTFIXX_PASSWORD = 'panel-secret';
process.env.SMARTFIXX_PORT = '4060'; process.env.SMARTFIXX_DOMAINE = 'smartfixx.fr';
process.env.AUTOMATION_MODE = 'demo'; process.env.WORKER_DEMARRAGE_MS = '0';
process.env.WORKER_POLL_MS = '600000';
let ok = true;
const dit = (b, t) => { if (!b) ok = false; console.log(`  ${b ? '✓' : '✗'} ${t}`); };
const titre = (t) => console.log(`\n— ${t} —`);
const dors = (ms) => new Promise((r) => setTimeout(r, ms));
require(path.join(RACINE, 'superadmin/index'));

let cookie = '';
const q = (m, u, corps, hote = 'saas.smartfixx.fr', cook) => new Promise((res, rej) => {
  const c = corps === undefined ? null : JSON.stringify(corps);
  const r = http.request({ host: '127.0.0.1', port: 4060, method: m, path: u, headers: {
    Host: hote, ...(c ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(c) } : {}),
    ...((cook !== undefined ? cook : cookie) ? { Cookie: cook !== undefined ? cook : cookie } : {}) } }, (rep) => {
    const set = (rep.headers['set-cookie'] || []).find((x) => x.startsWith('smartfixx_sid='));
    if (set && cook === undefined) cookie = set.split(';')[0];
    let d = ''; rep.on('data', (x) => { d += x; });
    rep.on('end', () => { let b = d; try { b = JSON.parse(d); } catch {}
      res({ status: rep.statusCode, body: b, brut: d, entetes: rep.headers }); });
  });
  r.on('error', rej); if (c) r.write(c); r.end();
});

(async () => {
  await dors(1200);
  await q('POST', '/api/login', { username: 'achraf', password: 'panel-secret' });
  const an = new Date(); an.setFullYear(an.getFullYear() + 1);
  const creer = async (nom, sd, mdpAdmin) => {
    const id = (await q('POST', '/api/societes', { nom, sousDomaine: sd })).body.id;
    await q('PUT', `/api/societes/${id}/reglages`, { adminUser: 'admin', adminPassword: mdpAdmin });
    await q('POST', `/api/societes/${id}/licences`, { debut: new Date().toISOString().slice(0, 10), fin: an.toISOString().slice(0, 10) });
    return id;
  };
  const idA = await creer('Société A', 'aaa', 'motdepasse-A-secret');
  const idB = await creer('Société B', 'bbb', 'motdepasse-B-secret');
  for (let i = 0; i < 60; i++) {
    const a = await q('GET', '/suivi.html', undefined, 'aaa.smartfixx.fr');
    const b = await q('GET', '/suivi.html', undefined, 'bbb.smartfixx.fr');
    if (a.status === 200 && b.status === 200) break;
    await dors(500);
  }

  titre('1. Chaque portail sert SA société');
  const mA = (await q('GET', '/api/marque', undefined, 'aaa.smartfixx.fr')).body;
  const mB = (await q('GET', '/api/marque', undefined, 'bbb.smartfixx.fr')).body;
  dit(mA.societe === 'Société A' && mB.societe === 'Société B', `${mA.societe} / ${mB.societe}`);

  titre('2. La session admin de A ne vaut rien chez B');
  const cnx = await q('POST', '/api/auth/login', { username: 'admin', password: 'motdepasse-A-secret' }, 'aaa.smartfixx.fr', '');
  const sessA = (cnx.entetes['set-cookie'] || []).find((x) => x.startsWith('portail_sid='));
  dit(cnx.status === 200 && !!sessA, `connexion admin chez A : HTTP ${cnx.status}`);
  const jetonA = sessA.split(';')[0];
  dit((await q('GET', '/api/admin/requests', undefined, 'aaa.smartfixx.fr', jetonA)).status === 200, 'elle ouvre l’admin de A');
  const chezB = await q('GET', '/api/admin/requests', undefined, 'bbb.smartfixx.fr', jetonA);
  dit(chezB.status === 401, `la MÊME session chez B : HTTP ${chezB.status}`);

  titre('3. Le mot de passe de A n’ouvre pas B');
  const croise = await q('POST', '/api/auth/login', { username: 'admin', password: 'motdepasse-A-secret' }, 'bbb.smartfixx.fr', '');
  dit(croise.status === 401, `HTTP ${croise.status}`);

  titre('4. La session du panel n’ouvre aucun portail');
  const panelChezA = await q('GET', '/api/admin/requests', undefined, 'aaa.smartfixx.fr', cookie);
  dit(panelChezA.status === 401, `session super-admin sur le portail de A : HTTP ${panelChezA.status}`);
  const portailVersPanel = await q('GET', '/api/societes', undefined, 'saas.smartfixx.fr', jetonA);
  dit(portailVersPanel.status === 401, `session portail sur le panel : HTTP ${portailVersPanel.status}`);

  titre('5. Aucune traversée par l’adresse');
  for (const u of ['/../bbb/portail.db', '/%2e%2e/%2e%2e/etc/passwd', '/img/..%2f..%2fetc%2fpasswd']) {
    const r = await q('GET', u, undefined, 'aaa.smartfixx.fr');
    dit(r.status >= 300 || !/root:/.test(r.brut), `${u} → HTTP ${r.status}`);
  }

  titre('6. Les bases sont bien séparées');
  const dosA = path.join(process.env.SMARTFIXX_DIR, 'instances', 'aaa', 'portail.db');
  const dosB = path.join(process.env.SMARTFIXX_DIR, 'instances', 'bbb', 'portail.db');
  dit(fs.existsSync(dosA) && fs.existsSync(dosB) && dosA !== dosB, 'une base par société');
  const Database = require(path.join(RACINE, 'node_modules/better-sqlite3'));
  const cA = new Database(dosA, { readonly: true });
  const n = cA.prepare("SELECT COUNT(*) n FROM admin_users").get().n;
  cA.close();
  dit(n === 1, `la base de A ne contient que SON administrateur (${n})`);

  titre('7. Les secrets ne fuient pas d’une société à l’autre');
  const reglages = require(path.join(RACINE, 'superadmin/lib/reglages'));
  dit(reglages.environnement(idA).ADMIN_PASSWORD === 'motdepasse-A-secret'
    && reglages.environnement(idB).ADMIN_PASSWORD === 'motdepasse-B-secret',
    'chaque instance reçoit les siens, et eux seuls');
  const vueA = await q('GET', `/api/societes/${idA}/reglages`);
  dit(!JSON.stringify(vueA.body).includes('motdepasse-A-secret'), 'le panel ne les rend jamais en clair');

  titre('8. Injection dans un champ du panel');
  const xss = '<img src=x onerror=alert(1)>';
  const rx = await q('POST', '/api/societes', { nom: xss, sousDomaine: 'inj' });
  const liste = await q('GET', '/api/societes');
  const fiche = liste.body.societes.find((s) => s.nom === xss);
  dit(rx.status === 200 && !!fiche, 'le nom est accepté et stocké tel quel (échappé à l’affichage)');
  dit(liste.entetes['content-type'].includes('json'), 'servi en JSON, jamais interprété comme du HTML');

  require(path.join(RACINE, 'superadmin/lib/orchestrateur')).arreterTout();
  await dors(1000);
  console.log(ok ? '\n>>> Cloisonnement vérifié ✓' : '\n>>> DES CAS ONT ÉCHOUÉ');
  process.exit(ok ? 0 : 1);
})();
