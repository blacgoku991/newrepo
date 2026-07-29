/* Réglages d'une société depuis le panel : chiffrés, jamais renvoyés. */
const os = require('os'), fs = require('fs'), path = require('path');
const { RACINE } = require('../lib/harnais');
process.env.SMARTFIXX_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-'));
process.env.SMARTFIXX_USER = 'achraf'; process.env.SMARTFIXX_PASSWORD = 'panel-secret';
const app = require(path.join(RACINE, 'superadmin/server'));
const reglages = require(path.join(RACINE, 'superadmin/lib/reglages'));
let ok = true;
const dit = (b, t) => { if (!b) ok = false; console.log(`  ${b ? '✓' : '✗'} ${t}`); };
const titre = (t) => console.log(`\n— ${t} —`);
const SECRET = 'SecretClientMicrosoft~TresConfidentiel';

const s = app.listen(4040, '127.0.0.1', async () => {
  let cookie = '';
  const q = async (m, u, corps) => {
    const r = await fetch('http://127.0.0.1:4040' + u, {
      method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: corps === undefined ? undefined : JSON.stringify(corps) });
    const set = r.headers.get('set-cookie');
    if (set && set.includes('smartfixx_sid=')) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  titre('1. Fermé sans session');
  dit((await q('GET', '/api/societes/1/reglages')).status === 401, 'lecture refusée');
  dit((await q('PUT', '/api/societes/1/reglages', { clientSecret: 'x' })).status === 401, 'écriture refusée');
  await q('POST', '/api/login', { username: 'achraf', password: 'panel-secret' });
  const id = (await q('POST', '/api/societes', { nom: 'ADEF Résidences', sousDomaine: 'adef' })).body.id;

  titre('2. Enregistrement');
  let r = await q('PUT', `/api/societes/${id}/reglages`, {
    tenantId: 'tenant-adef', clientId: 'client-adef', clientSecret: SECRET,
    smtpHost: 'smtp.adef.fr', adminPassword: 'MotDePasseAdminPortail',
  });
  dit(r.status === 200 && r.body.modifies.length === 5, `${r.body.modifies.length} réglages posés`);
  dit(r.body.ssoActif === true, 'la connexion Microsoft est signalée active');

  titre('3. Les secrets ne redescendent jamais');
  r = await q('GET', `/api/societes/${id}/reglages`);
  const plat = JSON.stringify(r.body);
  dit(!plat.includes(SECRET), 'le secret client n’apparaît nulle part');
  dit(!plat.includes('MotDePasseAdminPortail'), 'le mot de passe administrateur non plus');
  const acces = r.body.groupes.find((g) => g.id === 'acces');
  const cs = acces.champs.find((c) => c.cle === 'clientSecret');
  dit(cs.renseigne === true && cs.valeur === '', 'il est signalé renseigné, sans sa valeur');
  dit(acces.champs.find((c) => c.cle === 'tenantId').valeur === 'tenant-adef', 'les valeurs non secrètes restent visibles');

  titre('4. Chiffré au repos');
  const Database = require(path.join(RACINE, 'node_modules/better-sqlite3'));
  const conn = new Database(path.join(process.env.SMARTFIXX_DIR, 'smartfixx.db'), { readonly: true });
  const lignes = conn.prepare('SELECT cle, valeur FROM reglages').all();
  conn.close();
  dit(!lignes.some((l) => l.valeur.includes(SECRET)), 'introuvable en clair dans le registre');
  const chiffre = lignes.find((l) => l.cle === 'clientSecret').valeur;
  dit(/^[\w+/=]+\.[\w+/=]+\.[\w+/=]+$/.test(chiffre), 'stocké chiffré (AES-GCM)');
  const droits = (fs.statSync(path.join(process.env.SMARTFIXX_DIR, 'secret.key')).mode & 0o777).toString(8);
  dit(droits === '600', `clé de chiffrement en permissions ${droits}`);

  titre('5. L’instance les reçoit');
  const env = reglages.environnement(id);
  dit(env.M365_CLIENT_SECRET === SECRET, 'le secret est injecté dans son environnement');
  dit(env.SSO_REQUIRED === 'true', 'le SSO devient obligatoire une fois configuré');
  dit(env.APPS_ACTIVES === 'bluekango,netsoins' && env.TAUX_HORAIRE === '28', 'les valeurs par défaut suivent');

  titre('6. Sans clés Microsoft, le SSO n’est pas imposé');
  const id2 = (await q('POST', '/api/societes', { nom: 'Sans SSO', sousDomaine: 'sansso' })).body.id;
  dit(reglages.environnement(id2).SSO_REQUIRED === 'false',
    'sinon le portail se fermerait à tout le monde, client compris');

  titre('7. Rien d’autre n’est écrivable');
  r = await q('PUT', `/api/societes/${id}/reglages`, { NODE_OPTIONS: '--require /tmp/x', PATH: '/tmp' });
  dit(r.body.modifies.length === 0, 'les clés hors liste sont ignorées');
  dit(!reglages.environnement(id).NODE_OPTIONS, 'l’environnement de l’instance n’est pas détournable');
  r = await q('PUT', `/api/societes/${id}/reglages`, { accesPortail: 'nimporte-quoi' });
  dit(r.body.modifies.length === 0, 'une valeur hors des options proposées est refusée');

  titre('8. Un secret vide n’efface pas');
  r = await q('PUT', `/api/societes/${id}/reglages`, { tenantId: 'nouveau-tenant' });
  dit(r.body.modifies.length === 1, 'seul le champ envoyé change');
  dit(reglages.environnement(id).M365_CLIENT_SECRET === SECRET, 'le secret reste intact');

  titre('9. Le journal dit quoi, jamais la valeur');
  const j = (await q('GET', '/api/journal')).body.entrees;
  const e = j.find((x) => x.action === 'reglages_modifies');
  dit(!!e, `tracé : ${e && e.details}`);
  dit(!j.some((x) => (x.details || '').includes(SECRET)), 'aucun secret au journal');

  s.close();
  console.log(ok ? '\n>>> Réglages du panel conformes ✓' : '\n>>> DES CAS ONT ÉCHOUÉ');
  process.exit(ok ? 0 : 1);
});
