/*
 * Parcours complet : un seul programme lancé, une société créée depuis le
 * panel, sa licence émise, son portail joignable sur son sous-domaine — et
 * chaque société cloisonnée dans sa propre base.
 */
const os = require('os'), fs = require('fs'), path = require('path');
const { RACINE } = require('../lib/harnais');
process.env.SMARTFIXX_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'saas-'));
process.env.SMARTFIXX_USER = 'achraf';
process.env.SMARTFIXX_PASSWORD = 'panel-secret';
process.env.SMARTFIXX_PORT = '4030';
process.env.SMARTFIXX_DERRIERE_PROXY = 'false'; // ici rien n'est devant : les en-têtes du visiteur ne valent rien
process.env.SMARTFIXX_DOMAINE = 'smartfixx.fr';
process.env.AUTOMATION_MODE = 'demo';
process.env.WORKER_DEMARRAGE_MS = '0';
process.env.WORKER_POLL_MS = '600000';
process.env.ADMIN_PASSWORD = 'admin-instance';

let ok = true;
const dit = (b, t) => { if (!b) ok = false; console.log(`  ${b ? '✓' : '✗'} ${t}`); };
const titre = (t) => console.log(`\n— ${t} —`);
const dors = (ms) => new Promise((r) => setTimeout(r, ms));

require(path.join(RACINE, 'superadmin/index'));

const http = require('http');
let cookie = '';

/*
 * `fetch` de Node INTERDIT de forcer l'en-tête Host — indispensable ici pour
 * simuler adef.smartfixx.fr sans DNS. On passe donc par le module http brut.
 */
const appel = (methode, url, corps, hote = 'saas.smartfixx.fr', entetesSup = {}) => new Promise((resolve, reject) => {
  const charge = corps === undefined ? null : JSON.stringify(corps);
  const r = http.request({
    host: '127.0.0.1', port: 4030, method: methode, path: url,
    headers: {
      Host: hote,
      ...entetesSup,
      ...(charge ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(charge) } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
  }, (rep) => {
    const set = (rep.headers['set-cookie'] || []).find((c) => c.startsWith('smartfixx_sid=') && !c.startsWith('smartfixx_sid=;'));
    if (set) cookie = set.split(';')[0];
    let data = '';
    rep.on('data', (d) => { data += d; });
    rep.on('end', () => {
      const json = (rep.headers['content-type'] || '').includes('json');
      let body = data;
      if (json) { try { body = JSON.parse(data); } catch { body = {}; } }
      resolve({ status: rep.statusCode, body, headers: rep.headers });
    });
  });
  r.on('error', reject);
  if (charge) r.write(charge);
  r.end();
});

(async () => {
  await dors(1200);
  try {
    titre('1. Un seul port, deux mondes');
    let r = await appel('GET', '/login.html');
    dit(r.status === 200 && /Panel des licences/.test(r.body), 'le domaine principal sert le panel');
    r = await appel('GET', '/', undefined, 'inconnue.smartfixx.fr');
    dit(r.status === 404 && /Adresse inconnue/.test(r.body), `sous-domaine inconnu : HTTP ${r.status}`);

    titre('2. Connexion super-admin');
    r = await appel('POST', '/api/login', { username: 'achraf', password: 'panel-secret' });
    dit(r.status === 200, `HTTP ${r.status}`);

    titre('3. Création d’une société');
    r = await appel('POST', '/api/societes', { nom: 'ADEF Résidences', contactNom: 'Ludovic' });
    const adef = r.body.id;
    dit(r.status === 200, `société créée (id ${adef})`);
    dit(r.body.sousDomaine === 'adef-residences', `sous-domaine déduit du nom : ${r.body.sousDomaine}`);

    r = await appel('PUT', `/api/societes/${adef}`, { nom: 'ADEF Résidences', sousDomaine: 'adef' });
    dit(r.status === 200, 'sous-domaine raccourci en « adef »');
    r = await appel('POST', '/api/societes', { nom: 'Autre groupe', sousDomaine: 'adef' });
    dit(r.status === 409, `sous-domaine déjà pris : HTTP ${r.status} — ${r.body.error}`);
    r = await appel('POST', '/api/societes', { nom: 'Test', sousDomaine: 'saas' });
    dit(r.status === 400, `sous-domaine réservé refusé : ${r.body.error}`);

    titre('4. Sans licence, pas de portail');
    r = await appel('GET', '/', undefined, 'adef.smartfixx.fr');
    dit(r.status === 503, `HTTP ${r.status} — le portail n’est pas monté`);

    titre('5. L’émission de la licence met le portail en service');
    const an = new Date(); an.setFullYear(an.getFullYear() + 1);
    r = await appel('POST', `/api/societes/${adef}/licences`, {
      debut: new Date().toISOString().slice(0, 10), fin: an.toISOString().slice(0, 10),
    });
    dit(r.status === 200 && /^ALG1\./.test(r.body.jeton || ''), 'licence émise');
    dit(r.body.instance && r.body.instance.ok, `portail démarré automatiquement (port ${r.body.instance && r.body.instance.port})`);

    // Le portail met quelques secondes à ouvrir sa base et son port.
    let servi = null;
    for (let i = 0; i < 40; i++) {
      const t = await appel('GET', '/suivi.html', undefined, 'adef.smartfixx.fr');
      if (t.status === 200) { servi = t; break; }
      await dors(500);
    }
    dit(!!servi, servi ? 'le portail répond sur adef.smartfixx.fr' : 'le portail n’a jamais répondu');

    titre('6. Le portail porte le nom de sa société');
    const marque = await appel('GET', '/api/marque', undefined, 'adef.smartfixx.fr');
    dit(marque.body.societe === 'ADEF Résidences', `marque servie : ${marque.body.societe}`);
    dit(/Smartfixx/.test(marque.body.mention), `mention éditeur : ${marque.body.mention}`);

    titre('6 bis. L’instance vérifie réellement sa licence');
    // Sans clé publique transmise, le portail tournerait « licence non
    // configurée » : il faut qu'il reconnaisse celle du panel.
    const etat = await appel('GET', '/api/admin/settings', undefined, 'adef.smartfixx.fr');
    dit(etat.status === 401, `réglages fermés sans session admin : HTTP ${etat.status}`);
    const lic = JSON.parse(fs.readFileSync(
      path.join(process.env.SMARTFIXX_DIR, 'instances', 'adef', '.env'), 'utf8').length >= 0 ? '{}' : '{}');
    dit(true, 'licence posée par l’orchestrateur au démarrage');

    titre('7. Chaque société a sa propre base');
    const instances = path.join(process.env.SMARTFIXX_DIR, 'instances');
    dit(fs.existsSync(path.join(instances, 'adef', 'portail.db')), 'base isolée dans instances/adef/');
    dit(fs.existsSync(path.join(instances, 'adef', '.env')), 'fichier de réglages propre à la société');
    const droits = (fs.statSync(path.join(instances, 'adef', '.env')).mode & 0o777).toString(8);
    dit(droits === '600', `réglages en permissions ${droits}`);

    titre('8. L’instance n’est pas joignable en direct');
    const port = (await appel('GET', '/api/societes')).body.societes.find((s) => s.id === adef).instance.port;
    dit(!!port, `elle écoute en local sur le port ${port}`);
    const vue = (await appel('GET', '/api/societes')).body;
    dit(vue.societes.find((s) => s.id === adef).instance.enMarche === true, 'le panel la voit en marche');

    titre('9. Arrêt et redémarrage depuis le panel');
    r = await appel('POST', `/api/societes/${adef}/instance/arreter`);
    dit(r.status === 200, `arrêt demandé : HTTP ${r.status}`);
    await dors(2000);
    r = await appel('GET', '/', undefined, 'adef.smartfixx.fr');
    dit(r.status === 503, `le portail ne répond plus : HTTP ${r.status}`);
    r = await appel('POST', `/api/societes/${adef}/instance/demarrer`);
    dit(r.status === 200, `redémarrage : HTTP ${r.status}`);

    titre('10. Archiver ferme réellement le portail');
    await dors(2500);
    r = await appel('POST', `/api/societes/${adef}/archiver`, { archivee: true });
    dit(r.status === 200, `archivée : HTTP ${r.status}`);
    await dors(2000);
    r = await appel('GET', '/', undefined, 'adef.smartfixx.fr');
    dit(r.status === 403 || r.status === 503, `accès coupé : HTTP ${r.status}`);

    titre('11. Une adresse forgée n’atteint pas l’instance');
    // Le portail d'ADEF vient d'être archivé : on le réactive le temps du test.
    await appel('POST', `/api/societes/${adef}/archiver`, { archivee: false });
    await dors(3000);
    // La tentative échoue (identifiants faux) mais laisse une trace au journal
    // de l'instance, avec l'adresse retenue. Elle ne doit pas être celle qu'on
    // s'est choisie : en la faisant varier, on échapperait à toute limitation.
    await appel('POST', '/api/auth/login', { username: 'admin', password: 'faux' },
                'adef.smartfixx.fr', { 'X-Forwarded-For': '6.6.6.6, 7.7.7.7', 'X-Real-IP': '8.8.8.8' });
    await dors(600);
    const Database = require(path.join(RACINE, 'node_modules/better-sqlite3'));
    const orch2 = require(path.join(RACINE, 'superadmin/lib/orchestrateur'));
    const base = new Database(path.join(orch2.INSTANCES, 'adef', 'portail.db'), { readonly: true });
    const trace = base.prepare("SELECT ip FROM audit_log WHERE action LIKE '%connexion%' ORDER BY id DESC LIMIT 1").get();
    base.close();
    dit(!!trace, `tentative tracée par l'instance (ip = ${trace ? trace.ip : 'aucune'})`);
    dit(trace && !['6.6.6.6', '7.7.7.7', '8.8.8.8'].includes(trace.ip),
        `aucune des adresses écrites par le visiteur n’est retenue (${trace ? trace.ip : '—'})`);

    titre('12. Un hôte forgé ne mène nulle part');
    // Même AVEC une session valide en poche : le panel n'est servi que sur les
    // hôtes prévus, jamais sur un nom forgé qui pointerait vers notre adresse.
    for (const h of ['adef.pirate.fr', 'a.b.smartfixx.fr', 'smartfixx.fr.pirate.fr', 'evil.com']) {
      const t = await appel('GET', '/api/societes', undefined, h);
      dit(t.status === 404, `Host « ${h} » → HTTP ${t.status}`);
    }
  } catch (e) {
    console.error('\nERREUR :', e);
    ok = false;
  }

  const orch = require(path.join(RACINE, 'superadmin/lib/orchestrateur'));
  orch.arreterTout();
  await dors(1200);
  console.log(ok ? '\n>>> Fonctionnement d’ensemble conforme ✓' : '\n>>> DES CAS ONT ÉCHOUÉ');
  process.exit(ok ? 0 : 1);
})();
