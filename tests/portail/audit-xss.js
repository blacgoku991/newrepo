// AUDIT — XSS : on injecte des charges actives partout où du texte saisi est
// réaffiché (suivi, espace référent, panel admin), et on vérifie au navigateur
// qu'aucune ne s'exécute et que le texte s'affiche littéralement.
const os = require('os'), fs = require('fs'), path = require('path');
const { RACINE, CHROMIUM } = require('../lib/harnais');
const { SORTIES: D } = require('../lib/harnais');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'xss-'));
process.env.SSO_REQUIRED = 'true';
process.env.M365_TENANT_ID = 't'; process.env.M365_CLIENT_ID = 'c'; process.env.M365_CLIENT_SECRET = 's';
process.env.M365_REDIRECT_URI = 'http://localhost:3986/api/sso/callback';
process.env.PORT = '3986';
process.env.ADMIN_PASSWORD = 'AuditAdmin123!';
process.env.AUTOMATION_MODE = 'demo';
process.env.WORKER_POLL_MS = '600000';

const db = require(path.join(RACINE, 'src/db'));
const crypto = require('crypto');

const CHARGES = [
  '<img src=x onerror="window.__xss=(window.__xss||0)+1">',
  '"><script>window.__xss=(window.__xss||0)+1</script>',
  "');window.__xss=(window.__xss||0)+1;//",
  '<svg onload="window.__xss=(window.__xss||0)+1">',
];

db.createReferent('ref@adef.fr', CHARGES[0], CHARGES[1], [{ appId: 'netsoins', value: '778' }], 'test');
const jeton = crypto.randomBytes(24).toString('hex');
const exp = new Date(Date.now() + 3600e3).toISOString().slice(0, 19).replace('T', ' ');
db.createSsoSession(jeton, 'ref@adef.fr', 'Ref Test', 'o1', exp, 'Ref', 'Test');

// Comptes et demandes porteurs de charges actives dans chaque champ réaffiché.
db.upsertImportedAccount({
  appId: 'netsoins', login: CHARGES[0], nom: CHARGES[1], prenom: CHARGES[2],
  etablissement: '778', profil: CHARGES[3],
});
const ref = db.createRequest('netsoins', 'NS',
  { nom: CHARGES[0], prenom: CHARGES[1], identifiant: CHARGES[2], etablissement: '778', email: 'x@adef.fr', _demandeur_nom: CHARGES[3] },
  `${CHARGES[0]} <ref@adef.fr>`, 'ref@adef.fr', '1.1.1.1', 'creation');
const ligne = db.getByReference(ref);
db.setRequestLogin(ligne.id, CHARGES[1]);
db.markFinished(ligne.id, true, `Compte créé ${CHARGES[0]}`, []);
db.audit(CHARGES[0], 'creation_compte', ref, CHARGES[1], '1.1.1.1');

require(path.join(RACINE, 'src/server'));
const { chromium } = require(path.join(RACINE, 'node_modules/playwright'));

setTimeout(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.route('**', (r) => (r.request().url().includes('localhost') ? r.continue() : r.abort()));
  await ctx.addCookies([{ name: 'portal_sso', value: jeton, url: 'http://localhost:3986' }]);
  const p = await ctx.newPage();
  const cspBloques = [];
  p.on('console', (m) => { if (/Content Security Policy|Refused to execute/i.test(m.text())) cspBloques.push(m.text().slice(0, 60)); });

  let ko = 0;
  async function verifie(titre, url, attente) {
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    if (attente) await p.waitForSelector(attente, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(700);
    const xss = await p.evaluate(() => window.__xss || 0);
    const litteral = await p.evaluate(() => document.body.innerText.includes('onerror=') || document.body.innerText.includes('<script>'));
    const balises = await p.evaluate(() => document.querySelectorAll('body img[src="x"], body svg[onload]').length);
    const bon = xss === 0 && balises === 0;
    if (!bon) ko++;
    console.log(`${bon ? '✓' : '✗ FAILLE'} ${titre.padEnd(34)} exécutions=${xss} balises injectées=${balises} texte affiché littéralement=${litteral}`);
  }

  await verifie('espace référent', 'http://localhost:3986/espace', '.acc-table');
  await verifie('suivi — liste des demandes', 'http://localhost:3986/suivi.html', '#dm-view table');
  await verifie('suivi — détail', `http://localhost:3986/suivi.html?ref=${ref}`, '.timeline');
  await verifie('formulaire de demande', 'http://localhost:3986/demande.html?app=netsoins', '.step-panel');

  // Panel d'administration (session admin séparée).
  await p.goto('http://localhost:3986/login.html', { waitUntil: 'domcontentloaded' });
  await p.fill('#username', 'admin');
  await p.fill('#password', 'AuditAdmin123!');
  await p.click('button[type="submit"]');
  await p.waitForTimeout(1800);
  await verifie('admin — vue d’ensemble', 'http://localhost:3986/admin.html', '#recent');
  // Détail d'une demande (modale) + journal + référents.
  await p.click('table.data tbody tr');
  await p.waitForTimeout(800);
  const xssModale = await p.evaluate(() => window.__xss || 0);
  const balisesModale = await p.evaluate(() => document.querySelectorAll('#modal img[src="x"], #modal svg[onload]').length);
  if (xssModale || balisesModale) ko++;
  console.log(`${!xssModale && !balisesModale ? '✓' : '✗ FAILLE'} ${'admin — détail d’une demande'.padEnd(34)} exécutions=${xssModale} balises injectées=${balisesModale}`);
  await p.screenshot({ path: D + 'audit-xss-admin.png', fullPage: false });

  console.log(`\nCSP : ${cspBloques.length} tentative(s) de script bloquée(s) par la politique du navigateur`);
  console.log(ko === 0 ? '>>> Aucune injection HTML/JS aboutie ✓' : `>>> ${ko} FAILLE(S) XSS`);
  await b.close();
  process.exit(ko ? 1 : 0);
}, 1500);
