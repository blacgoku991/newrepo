/*
 * Tentatives d'attaque sur les points trouvés lors de l'audit.
 * Chacune doit échouer.
 */
const os = require('os'), fs = require('fs'), path = require('path'), http = require('http');
const { RACINE: R } = require('../lib/harnais');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aud-'));
process.env.PORT = '3893';
process.env.HOST = '127.0.0.1';
process.env.AUTOMATION_MODE = 'demo';
process.env.WORKER_POLL_MS = '600000';
process.env.SSO_REQUIRED = 'true';
process.env.M365_TENANT_ID = 't'; process.env.M365_CLIENT_ID = 'c'; process.env.M365_CLIENT_SECRET = 's';
process.env.M365_REDIRECT_URI = 'http://localhost:3893/auth/sso/callback';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'MotDePasseAdmin2026!';
process.env.TRUST_PROXY = 'true';       // comme une instance lancée par l'orchestrateur

let ko = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) ko++; };

const db = require(path.join(R, 'src/db'));
require(path.join(R, 'src/server'));

function req(methode, chemin, { entetes = {}, corps, https } = {}) {
  return new Promise((res, rej) => {
    const data = corps === undefined ? null : JSON.stringify(corps);
    const r = http.request({ host: '127.0.0.1', port: 3893, path: chemin, method: methode,
      headers: { ...(https ? { 'x-forwarded-proto': 'https' } : {}), ...entetes,
                 ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (rep) => { const m = []; rep.on('data', (d) => m.push(d));
        rep.on('end', () => res({ code: rep.statusCode, entetes: rep.headers, texte: Buffer.concat(m).toString() })); });
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}

setTimeout(async () => {
  console.log('— 1. Redirection ouverte sur la porte SSO —');
  // L'antislash est lu comme une barre oblique par les navigateurs : « /\x » a
  // la même valeur que « //x », donc un autre site.
  const pieges = ['//evil.fr/', '/\\evil.fr/', '/\\\\evil.fr', 'https://evil.fr',
                  '\\/evil.fr', '/\tevil.fr', '/\nLocation: x', '//evil.fr\\@x', 'javascript:alert(1)'];
  const sso = require(path.join(R, 'src/sso'));
  for (const p of pieges) {
    const retenu = sso.cibleLocale(p);
    ok(retenu === '/', `« ${p} » ramené à « ${retenu} »`);
    // Et la route accepte tout de même la demande : on ne casse pas la connexion.
    const rep = await req('GET', `/auth/sso/login?next=${encodeURIComponent(p)}`);
    ok(rep.code === 302, `   la connexion reste possible (HTTP ${rep.code})`);
  }
  for (const bon of ['/espace', '/suivi.html?ref=NS-260101-ABCD', '/']) {
    ok(sso.cibleLocale(bon) === bon, `chemin local conservé : ${bon}`);
  }

  console.log('\n— 2. Cookies : Secure dès que la connexion est chiffrée —');
  let r = await req('POST', '/api/auth/login', { corps: { username: 'admin', password: 'MotDePasseAdmin2026!' }, https: true });
  const c1 = String(r.entetes['set-cookie'] || '');
  ok(/Secure/.test(c1) && /HttpOnly/.test(c1), `derrière HTTPS : ${c1.split(';').slice(1).join(';').trim()}`);
  r = await req('POST', '/api/auth/login', { corps: { username: 'admin', password: 'MotDePasseAdmin2026!' } });
  ok(!/Secure/.test(String(r.entetes['set-cookie'] || '')), 'en clair (développement local) : pas de Secure, le cookie reste utilisable');

  console.log('\n— 3. Limitation de débit : une adresse forgée ne l’échappe pas —');
  // L'instance croit `X-Forwarded-For` — mais seulement venant de la boucle
  // locale, c'est-à-dire de notre propre proxy. Une valeur qui n'a pas la forme
  // d'une adresse est jetée, et l'en-tête est de toute façon réécrit à l'entrée.
  const securite = require(path.join(R, 'src/security'));
  const faux = { socket: { remoteAddress: '203.0.113.9' }, headers: { 'x-forwarded-for': '1.2.3.4' } };
  ok(securite.clientIp(faux) === '203.0.113.9', 'en-tête ignoré s’il ne vient pas du proxy local');
  const local = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '1.2.3.4' } };
  ok(securite.clientIp(local) === '1.2.3.4', 'en-tête retenu quand il vient du proxy local');
  const sale = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': 'a; DROP TABLE' } };
  ok(securite.clientIp(sale) === '127.0.0.1', 'valeur qui n’est pas une adresse : jetée');

  // Et sans en-tête crédible, les tentatives sont bien comptées ensemble.
  let refus = 0;
  for (let i = 0; i < 14; i += 1) {
    const rep = await req('POST', '/api/auth/login', { corps: { username: 'admin', password: 'faux' } });
    if (rep.code === 429) refus += 1;
  }
  ok(refus > 0, `${refus} tentative(s) sur 14 bloquées`);

  console.log('\n— 4. Références de demande imprévisibles —');
  const refs = [];
  for (let i = 0; i < 200; i += 1) {
    refs.push(db.createRequest('netsoins', 'NS', { nom: 'X', prenom: 'Y', etablissement: '1' }, 'T', 't@t.fr', '1.1.1.1', 'creation'));
  }
  const suffixes = refs.map((x) => x.split('-')[2]);
  ok(new Set(suffixes).size === 200, `${new Set(suffixes).size}/200 suffixes distincts`);
  ok(!/[IO01]/.test(suffixes.join('')), 'alphabet sans caractères confondables');
  const bits = new Set(suffixes.map((s) => s[0]));
  ok(bits.size >= 12, `premier caractère bien réparti (${bits.size} valeurs distinctes)`);

  console.log('\n— 5. Ce qui doit rester fermé le reste —');
  for (const [m, c] of [['GET', '/api/requests'], ['GET', '/espace'], ['GET', '/api/admin/referents'], ['GET', '/artifacts/']]) {
    const rep = await req(m, c);
    ok(rep.code === 401 || rep.code === 302 || rep.code === 403 || rep.code === 404,
       `${m} ${c} sans session → HTTP ${rep.code}`);
  }

  console.log(ko ? `\n>>> ${ko} anomalie(s)` : '\n>>> Aucune de ces attaques n’aboutit ✓');
  process.exit(ko ? 1 : 0);
}, 1500);
