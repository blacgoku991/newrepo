// Droits des personnes : retrouver, exporter, effacer — et ce qui doit rester.
const os = require('os'), fs = require('fs'), path = require('path'), http = require('http');
const { RACINE: R } = require('../lib/harnais');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rgpd-'));
process.env.PORT = '3892'; process.env.AUTOMATION_MODE = 'demo';
process.env.WORKER_POLL_MS = '600000';
process.env.ADMIN_USERNAME = 'admin'; process.env.ADMIN_PASSWORD = 'MotDePasseAdmin2026!';

const db = require(path.join(R, 'src/db'));
const personnes = require(path.join(R, 'src/personnes'));

let ko = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) ko++; };

// Deux personnes, dont une homonyme partielle, pour vérifier qu'on n'efface
// pas le voisin.
function poser(nom, prenom, email, login) {
  const ref = db.createRequest('netsoins', 'NS', { nom, prenom, email, etablissement: '778', fonction: 'Aide-soignant' },
    `Ref <ref@adef.fr>`, 'ref@adef.fr', '1.1.1.1', 'creation');
  const l = db.getByReference(ref);
  db.setRequestLogin(l.id, login);
  db.markFinished(l.id, true, 'Compte créé', []);
  db.recordAccount('netsoins', login, nom, prenom, ref);
  require(path.join(R, 'src/credentials')).createLink(l.id, login, 'Provisoire1!');
  db.audit(`${prenom} ${nom} <${email}>`, 'connexion_sso', '', '', '10.0.0.5');
  return ref;
}
const refA = poser('DUPONT', 'Marie', 'marie.dupont@adef.fr', 'MDUPONT');
const refB = poser('DUPONT', 'Paul', 'paul.dupont@adef.fr', 'PDUPONT');
db.createReferent('marie.dupont@adef.fr', 'DUPONT', 'Marie', [{ appId: 'netsoins', value: '778' }], 'test');

require(path.join(R, 'src/server'));

let cookie = '';
function appel(methode, chemin, corps) {
  return new Promise((res, rej) => {
    const data = corps === undefined ? null : JSON.stringify(corps);
    const r = http.request({ host: '127.0.0.1', port: 3892, path: chemin, method: methode,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (rep) => { const m = []; rep.on('data', (d) => m.push(d)); rep.on('end', () => {
        const sc = rep.headers['set-cookie'];
        if (sc) cookie = sc[0].split(';')[0];
        let b = Buffer.concat(m).toString();
        try { b = JSON.parse(b); } catch { /* html */ }
        res({ code: rep.statusCode, corps: b }); }); });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
}

setTimeout(async () => {
  await appel('POST', '/api/auth/login', { username: 'admin', password: 'MotDePasseAdmin2026!' });

  console.log('— 1. Retrouver une personne —');
  let r = await appel('GET', '/api/admin/personnes?q=dupont');
  ok(r.corps.personnes.length === 2, `« dupont » → ${r.corps.personnes.length} personnes distinctes`);
  r = await appel('GET', '/api/admin/personnes?q=marie');
  ok(r.corps.personnes.length === 1 && r.corps.personnes[0].nom === 'DUPONT', 'recherche par prénom');
  r = await appel('GET', '/api/admin/personnes?q=MDUPONT');
  ok(r.corps.personnes.length === 1, 'recherche par identifiant créé');
  r = await appel('GET', '/api/admin/personnes?q=d');
  ok(r.corps.personnes.length === 0, 'un seul caractère : rien (pas de vidage de la base par curiosité)');

  console.log('\n— 2. Le dossier complet, sans secret —');
  const cleMarie = (await appel('GET', '/api/admin/personnes?q=marie.dupont@adef.fr')).corps.personnes[0].cle;
  r = await appel('GET', `/api/admin/personnes/dossier?cle=${encodeURIComponent(cleMarie)}`);
  const d = r.corps;
  ok(d.demandes.length === 1 && d.comptes.length === 1, `${d.demandes.length} demande(s), ${d.comptes.length} compte(s)`);
  ok(!!d.referent, 'son habilitation de référente figure au dossier');
  ok(d.journal.length >= 1, `${d.journal.length} entrée(s) de journal la concernant`);
  const brut = JSON.stringify(d);
  ok(!/Provisoire1!/.test(brut), 'aucun mot de passe dans le dossier');
  ok(!/token_hash|secret_enc/.test(brut), 'aucun jeton ni secret chiffré');
  ok(!/PDUPONT|paul/i.test(brut), 'rien de l’homonyme');

  console.log('\n— 3. L’effacement demande le nom exact —');
  r = await appel('DELETE', '/api/admin/personnes', { cle: cleMarie, confirmation: 'DUPONT' });
  ok(r.code === 400, `nom incomplet refusé : ${r.corps.error}`);
  r = await appel('DELETE', '/api/admin/personnes', { cle: cleMarie, confirmation: 'dupont marie', motif: 'demande du 29/07' });
  ok(r.code === 200, `effacé : ${JSON.stringify(r.corps.bilan)}`);

  console.log('\n— 4. Ce qui part, et ce qui reste —');
  ok(!db.getByReference(refA), 'la demande de Marie est supprimée');
  ok(!!db.getByReference(refB), 'celle de Paul est intacte');
  ok(!db.listReferents().some((x) => x.email === 'marie.dupont@adef.fr'), 'son habilitation est retirée');
  const comptes = db.listCreatedAccounts(100).map((c) => c.login);
  ok(!comptes.includes('MDUPONT') && comptes.includes('PDUPONT'), `registre des comptes : ${comptes.join(', ')}`);
  const journal = db.listAudit(200);
  // La trace de l'effacement lui-même est nominative À DESSEIN : c'est la
  // preuve qu'on a répondu à la demande. Elle suit sa propre durée de vie.
  const restant = journal.filter((e) => e.action !== 'rgpd_effacement' && /marie/i.test(`${e.admin} ${e.target}`));
  ok(restant.length === 0, 'plus aucune mention nominative dans le journal');
  ok(journal.some((e) => e.admin === '[personne effacée]'), 'les événements de sécurité restent, anonymisés');
  ok(journal.some((e) => e.action === 'rgpd_effacement'), 'la demande d’effacement est elle-même tracée');
  const paulReste = journal.some((e) => /paul/i.test(`${e.admin} ${e.target}`));
  ok(paulReste, 'le journal de l’homonyme n’a pas été touché');

  console.log('\n— 5. Rien de tout cela sans être administrateur —');
  cookie = '';
  for (const [m, c] of [['GET', '/api/admin/personnes?q=dupont'], ['GET', '/api/admin/personnes/dossier?cle=x'], ['DELETE', '/api/admin/personnes']]) {
    const rep = await appel(m, c, m === 'DELETE' ? {} : undefined);
    ok(rep.code === 401, `${m} ${c.split('?')[0]} → HTTP ${rep.code}`);
  }

  console.log(ko ? `\n>>> ${ko} anomalie(s)` : '\n>>> Droits des personnes conformes ✓');
  process.exit(ko ? 1 : 0);
}, 1500);
