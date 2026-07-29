/* Identifiants des applications métiers saisis dans les réglages. */
const os = require('os'), fs = require('fs'), path = require('path');
const { RACINE, CHROMIUM } = require('../lib/harnais');
const { SORTIES: D } = require('../lib/harnais');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ident-'));
process.env.PORT = '3972';
process.env.ADMIN_PASSWORD = 'demo123';
process.env.AUTOMATION_MODE = 'demo';
process.env.WORKER_POLL_MS = '600000';
process.env.WORKER_DEMARRAGE_MS = '0';
process.env.APPS_ACTIVES = 'bluekango,netsoins';
delete process.env.BLUEKANGO_ADMIN_USER;
delete process.env.BLUEKANGO_ADMIN_PASSWORD;

let ok = true;
const dit = (b, t) => { if (!b) ok = false; console.log(`  ${b ? '✓' : '✗'} ${t}`); };
const titre = (t) => console.log(`\n— ${t} —`);
require(path.join(RACINE, 'src/server'));
const { chromium } = require(path.join(RACINE, 'node_modules/playwright'));

const B = 'http://localhost:3972';
let cookie = '';
const appel = async (m, u, corps) => {
  const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: corps === undefined ? undefined : JSON.stringify(corps) });
  const set = r.headers.get('set-cookie');
  if (set && set.includes('portail_sid=')) cookie = set.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

setTimeout(async () => {
  titre('1. Fermé sans session');
  dit((await appel('GET', '/api/admin/apps/bluekango/identifiants')).status === 401, 'lecture refusée');
  dit((await appel('PUT', '/api/admin/apps/bluekango/identifiants', { user: 'pirate' })).status === 401, 'écriture refusée');
  await appel('POST', '/api/auth/login', { username: 'admin', password: 'demo123' });

  titre('2. Enregistrement');
  let r = await appel('PUT', '/api/admin/apps/bluekango/identifiants', {
    url: 'https://app.bluekango.com', user: 'compte-service', password: 'MotDePasseTresSecret',
  });
  dit(r.status === 200 && r.body.modifies.length === 3, `champs enregistrés : ${r.body.modifies.join(', ')}`);
  dit(r.body.complet === true, 'l’application est signalée configurée');

  titre('3. Le mot de passe ne redescend jamais');
  r = await appel('GET', '/api/admin/apps/bluekango/identifiants');
  dit(r.body.champs.password.renseigne === true, 'il est signalé renseigné');
  dit(r.body.champs.password.valeur === '', 'mais sa valeur n’est pas renvoyée');
  dit(r.body.champs.user.valeur === 'compte-service', 'l’identifiant, lui, est réaffiché (non secret)');
  dit(!JSON.stringify(r.body).includes('MotDePasseTresSecret'), 'le mot de passe n’apparaît nulle part dans la réponse');

  titre('4. Chiffré au repos');
  const Database = require(path.join(RACINE, 'node_modules/better-sqlite3'));
  const conn = new Database(path.join(process.env.DATA_DIR, 'portail.db'), { readonly: true });
  const brut = conn.prepare("SELECT value FROM app_settings WHERE key = 'secrets_bluekango'").get().value;
  conn.close();
  dit(!brut.includes('MotDePasseTresSecret'), 'introuvable en clair dans la base');
  dit(/[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+/.test(brut), 'stocké sous forme chiffrée (AES-GCM)');

  titre('5. Le robot le reçoit');
  dit(process.env.BLUEKANGO_ADMIN_PASSWORD === 'MotDePasseTresSecret', 'posé dans l’environnement du processus');
  dit(process.env.BLUEKANGO_ADMIN_USER === 'compte-service', 'identifiant posé aussi');

  titre('6. Un champ vide ne l’efface pas');
  r = await appel('PUT', '/api/admin/apps/bluekango/identifiants', { user: 'autre-compte' });
  dit(r.status === 200 && r.body.modifies.length === 1, `seul l’identifiant change : ${r.body.modifies.join(', ')}`);
  dit(process.env.BLUEKANGO_ADMIN_PASSWORD === 'MotDePasseTresSecret', 'le mot de passe est intact');

  titre('7. Aucun autre réglage n’est écrasable');
  r = await appel('PUT', '/api/admin/apps/bluekango/identifiants', { PATH: '/tmp/pirate', NODE_OPTIONS: '--require /tmp/x' });
  dit(r.body.modifies.length === 0, 'les champs hors liste sont ignorés');
  dit(process.env.PATH !== '/tmp/pirate', 'l’environnement du processus n’est pas détourné');

  titre('8. Le journal dit quoi, jamais la valeur');
  const db = require(path.join(RACINE, 'src/db'));
  const e = db.listAudit(30).find((x) => x.action === 'identifiants_application');
  dit(!!e, `tracé : ${e && e.details}`);
  dit(!db.listAudit(30).some((x) => (x.details || '').includes('MotDePasseTresSecret')), 'aucun mot de passe au journal');

  titre('9. Écran de réglages');
  const b = await chromium.launch({ executablePath: CHROMIUM });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.route('**', (q) => (q.request().url().includes('localhost') ? q.continue() : q.abort()));
  const p = await ctx.newPage();
  const err = [];
  p.on('pageerror', (x) => err.push(x.message));
  await p.goto(B + '/login.html', { waitUntil: 'domcontentloaded' });
  await p.fill('#username', 'admin'); await p.fill('#password', 'demo123');
  await p.click('button[type="submit"]'); await p.waitForTimeout(1600);
  await p.click('#nav-settings'); await p.waitForTimeout(1800);
  const bloc = await p.$eval('#ident-apps', (x) => x.innerText.replace(/\n+/g, ' | '));
  dit(/BlueKanGo/.test(bloc) && /NetSoins/.test(bloc), 'les deux applications sont proposées');
  dit(!/MotDePasseTresSecret/.test(await p.content()), 'aucun mot de passe dans la page');
  const type = await p.$eval('#ident-apps [data-champ="password"]', (x) => x.type);
  dit(type === 'password', 'le champ mot de passe est masqué');
  await p.screenshot({ path: `${D}identifiants-apps.png`, fullPage: true });
  console.log('\nerreurs console :', err.length ? err : 'aucune');
  if (err.length) ok = false;
  await b.close();
  console.log(ok ? '\n>>> Identifiants en réglages conformes ✓' : '\n>>> DES CAS ONT ÉCHOUÉ');
  process.exit(ok ? 0 : 1);
}, 1500);
