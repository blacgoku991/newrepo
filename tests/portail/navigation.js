// Vérifie qu'aucune page n'est une impasse : partout un retour et un accueil,
// et qu'aucune ressource n'est demandée à un tiers.
const os = require('os'), fs = require('fs'), path = require('path');
const { RACINE, SORTIES: D, CHROMIUM } = require('../lib/harnais');
const RACINE_SLASH = RACINE + '/';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-'));
process.env.SSO_REQUIRED = 'true';
process.env.M365_TENANT_ID = 't'; process.env.M365_CLIENT_ID = 'c'; process.env.M365_CLIENT_SECRET = 's';
process.env.M365_REDIRECT_URI = 'http://localhost:3897/auth/sso/callback';
process.env.PORT = '3897';
process.env.AUTOMATION_MODE = 'demo';
process.env.WORKER_POLL_MS = '600000';
process.env.SOCIETE_NOM = 'ADEF Résidences';

const db = require(RACINE_SLASH + 'src/db');
db.createReferent('ref@adef.fr', 'Ref', 'Achraf', [{ appId: 'netsoins', value: '778' }], 'test');
const token = 'NAVSESSION1';
db.createSsoSession(token, 'ref@adef.fr', 'Achraf Ref', 'oid',
  new Date(Date.now() + 3600e3).toISOString().slice(0, 19).replace('T', ' '), 'Achraf', 'Ref');

// Une demande terminée avec identifiants : c'est le parcours qui menait à
// l'impasse signalée.
const ref = db.createRequest('netsoins', 'NS', { nom: 'ZORRO', prenom: 'Zoe', etablissement: '778' },
  'Ref', 'ref@adef.fr', '1.1.1.1', 'creation');
const ligne = db.getByReference(ref);
db.setRequestLogin(ligne.id, 'ZORRO ZOE');
db.markFinished(ligne.id, true, 'Compte créé', []);
// Un lien d'identifiants, comme en produit un robot : c'est ce parcours qui
// aboutissait sur une page sans issue.
require(RACINE_SLASH + 'src/credentials').createLink(ligne.id, 'ZORRO ZOE', 'MotDePasseInitial1!');

require(RACINE_SLASH + 'src/server');
const { chromium } = require(RACINE_SLASH + 'node_modules/playwright');

let ko = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) ko++; };

setTimeout(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM });
  const externes = new Set();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: 'portal_sso', value: token, url: 'http://localhost:3897' }]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('request', (r) => { if (!r.url().startsWith('http://localhost:3897') && !r.url().startsWith('data:')) externes.add(new URL(r.url()).host); });

  console.log('— 1. Un retour et un accueil sur chaque page —');
  const pages = ['/demarches.html', '/espace', '/suivi.html', '/demande.html?app=netsoins',
                 '/mentions-legales.html', '/login.html'];
  for (const u of pages) {
    await p.goto('http://localhost:3897' + u, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(350);
    const n = await p.$$eval('.fil-retour .fil-btn', (l) => l.map((e) => e.textContent.trim()));
    ok(n.length === 2 && n[1] === 'Accueil', `${u.padEnd(28)} → ${n.join(' / ') || 'AUCUN'}`);
  }

  console.log('\n— 2. La page des identifiants n’est plus une impasse —');
  await p.goto('http://localhost:3897/suivi.html?ref=' + ref, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#get-creds', { timeout: 15000 });
  await p.click('#get-creds');
  await p.waitForURL(/\/identifiants\//, { timeout: 5000 });
  await p.waitForTimeout(400);
  const btns = await p.$$eval('.fil-retour .fil-btn', (l) => l.map((e) => e.textContent.trim()));
  ok(btns.length === 2, `écran des identifiants : ${btns.join(' / ') || 'AUCUN'}`);
  await p.click('.fil-retour [data-role="retour"]');
  await p.waitForTimeout(600);
  ok(/\/suivi/.test(p.url()), `le retour ramène au suivi (${new URL(p.url()).pathname})`);

  console.log('\n— 3. La marque du client, pas celle de l’éditeur —');
  await p.goto('http://localhost:3897/login.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(400);
  const titre = await p.title();
  ok(!/Algonis/.test(titre), `titre de la connexion admin : « ${titre} »`);
  await p.goto('http://localhost:3897/espace', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(500);
  ok(/ADEF/.test(await p.title()), `titre de l’espace : « ${await p.title()} »`);

  console.log('\n— 4. Aucune ressource demandée à un tiers —');
  ok(externes.size === 0, externes.size ? `fuites vers : ${[...externes].join(', ')}` : 'aucune requête sortante');
  const police = await p.evaluate(() => getComputedStyle(document.body).fontFamily);
  ok(/Source Sans|Lexend/.test(police), `police appliquée : ${police.slice(0, 40)}`);

  console.log('\n— 5. L’écran de refus ne boucle plus —');
  await p.goto('http://localhost:3897/acces-refuse.html?motif=ferme&compte=x%40y.fr', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(400);
  const liens = await p.$$eval('.refus-actions a', (l) => l.map((e) => e.getAttribute('href')));
  ok(!liens.some((h) => /suivi|espace|^\/$/.test(h || '')), `aucune sortie vers une page fermée (${liens.join(', ') || 'aucun lien'})`);
  const pied = await p.$eval('#refus-pied', (e) => e.textContent.trim());
  ok(/ADEF/.test(pied), `pied de page à la marque : « ${pied} »`);

  ok(!errs.length, errs.length ? `erreurs JS : ${errs.join(' | ')}` : 'aucune erreur JS');
  await b.close();
  console.log(ko ? `\n>>> ${ko} anomalie(s)` : '\n>>> Navigation conforme ✓');
  process.exit(ko ? 1 : 0);
}, 1500);
