// Mentions légales, cookies, et l'écran d'administration qui les remplit.
const os = require('os'), fs = require('fs'), path = require('path');
const { SORTIES: D, CHROMIUM } = require('../lib/harnais');
const { RACINE: R } = require('../lib/harnais');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'conf-'));
process.env.PORT = '3891'; process.env.AUTOMATION_MODE = 'demo'; process.env.WORKER_POLL_MS = '600000';
process.env.ADMIN_USERNAME = 'admin'; process.env.ADMIN_PASSWORD = 'MotDePasseAdmin2026!';
process.env.SOCIETE_NOM = 'ADEF Résidences';
process.env.SSO_REQUIRED = 'true';
process.env.M365_TENANT_ID = 't'; process.env.M365_CLIENT_ID = 'c'; process.env.M365_CLIENT_SECRET = 's';
process.env.M365_REDIRECT_URI = 'http://localhost:3891/auth/sso/callback';

const db = require(path.join(R, 'src/db'));
db.createReferent('ref@adef.fr', 'Perrin', 'Ludovic', [{ appId: 'netsoins', value: '778' }], 'test');
const jeton = 'CONF1';
db.createSsoSession(jeton, 'ref@adef.fr', 'Ludovic Perrin', 'oid',
  new Date(Date.now() + 3600e3).toISOString().slice(0, 19).replace('T', ' '), 'Ludovic', 'Perrin');
require(path.join(R, 'src/server'));
const { chromium } = require(path.join(R, 'node_modules/playwright'));

let ko = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) ko++; };

setTimeout(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM });
  const errs = []; const externes = new Set();

  console.log('— 1. Les mentions légales sont lisibles SANS être connecté —');
  let ctx = await b.newContext({ viewport: { width: 1180, height: 900 } });
  let p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('request', (r) => { if (!r.url().startsWith('http://localhost:3891') && !r.url().startsWith('data:')) externes.add(new URL(r.url()).host); });
  await p.goto('http://localhost:3891/mentions-legales.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#cookies', { timeout: 8000 });
  ok(true, 'page servie sans redirection vers la connexion');
  const texte = await p.textContent('#legal');
  ok(/à compléter/.test(texte), 'les champs non renseignés se voient (« à compléter »)');
  ok(/1 jour/.test(texte), 'la durée des captures affichée vient du code');
  ok(/sous-traitant/.test(texte) && /responsable de traitement/.test(texte), 'les rôles RGPD sont énoncés');
  ok(/portal_sso/.test(texte), 'les cookies déposés sont listés nommément');
  ok(/CNIL/.test(texte), 'le recours auprès de la CNIL est mentionné');
  await p.screenshot({ path: `${D}conf-mentions.png`, fullPage: true });
  await ctx.close();

  console.log('\n— 2. Le bandeau cookies : informer, pas faire semblant de demander —');
  ctx = await b.newContext({ viewport: { width: 1180, height: 900 } });
  await ctx.addCookies([{ name: 'portal_sso', value: jeton, url: 'http://localhost:3891' }]);
  p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:3891/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(900);
  const bandeau = await p.$('.info-cookies');
  ok(!!bandeau, 'affiché au premier passage');
  const t = bandeau ? await bandeau.textContent() : '';
  ok(!/refuser|accepter les cookies/i.test(t), 'aucun faux choix : rien à refuser ici');
  await p.screenshot({ path: `${D}conf-bandeau.png`, fullPage: false });
  await p.click('.info-cookies [data-role="cookies-ok"]');
  await p.waitForTimeout(200);
  ok(!(await p.$('.info-cookies')), 'refermé au clic');
  await p.goto('http://localhost:3891/suivi.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(700);
  ok(!(await p.$('.info-cookies')), 'ne revient pas à chaque page');
  const cookiesPoses = (await ctx.cookies()).map((c) => c.name);
  ok(!cookiesPoses.some((n) => /consent|rgpd|cookie/i.test(n)),
     `aucun cookie posé pour dire qu’on informe sur les cookies (${cookiesPoses.join(', ')})`);
  await ctx.close();

  console.log('\n— 3. L’administration remplit les mentions —');
  ctx = await b.newContext({ viewport: { width: 1280, height: 950 } });
  p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:3891/login.html', { waitUntil: 'domcontentloaded' });
  await p.fill('#username', 'admin'); await p.fill('#password', 'MotDePasseAdmin2026!');
  await p.click('#login-btn'); await p.waitForTimeout(1800);
  await p.click('[data-view="rgpd"]'); await p.waitForTimeout(1000);
  ok(await p.isVisible('#conformite-champs'), 'onglet « Données personnelles » présent');
  const manque = await p.textContent('#conformite-manque');
  ok(/Il manque/.test(manque), 'l’administration voit ce qui manque');
  await p.fill('#cf-raisonSociale', 'ADEF Résidences');
  await p.fill('#cf-formeJuridique', 'Association loi 1901');
  await p.fill('#cf-siren', '775 672 894');
  await p.fill('#cf-siege', '1 rue de la Solidarité, 94000 Créteil');
  await p.fill('#cf-directeurPublication', 'La directrice générale');
  await p.fill('#cf-contact', 'portail@adef-residences.com');
  await p.fill('#cf-dpoNom', 'Le délégué à la protection des données');
  await p.fill('#cf-dpoContact', 'dpo@adef-residences.com');
  await p.fill('#cf-hebergeur', 'OVH SAS, 2 rue Kellermann, 59100 Roubaix');
  await p.click('#conformite-ok'); await p.waitForTimeout(900);
  ok(/Toutes les mentions sont renseignées/.test(await p.textContent('#conformite-manque')),
     'enregistré, et le manque disparaît');
  await p.screenshot({ path: `${D}conf-admin.png`, fullPage: true });

  console.log('\n— 4. La page publique reprend ce qui a été saisi —');
  const ctx2 = await b.newContext({ viewport: { width: 1180, height: 900 } });
  const p2 = await ctx2.newPage();
  await p2.goto('http://localhost:3891/mentions-legales.html', { waitUntil: 'domcontentloaded' });
  await p2.waitForSelector('#cookies', { timeout: 8000 });
  const t2 = await p2.textContent('#legal');
  ok(/Association loi 1901/.test(t2) && /OVH/.test(t2), 'les coordonnées saisies s’affichent');
  ok(!/à compléter/.test(t2), 'plus aucun « à compléter »');
  ok(/dpo@adef-residences.com/.test(t2), 'le contact du DPO est joignable');
  await p2.screenshot({ path: `${D}conf-mentions-remplies.png`, fullPage: true });
  await ctx2.close();

  console.log('\n— 5. Rien ne sort vers un tiers —');
  ok(externes.size === 0, externes.size ? `fuites : ${[...externes].join(', ')}` : 'aucune requête externe');
  ok(!errs.length, errs.length ? `erreurs JS : ${errs.join(' | ')}` : 'aucune erreur JS');

  await b.close();
  console.log(ko ? `\n>>> ${ko} anomalie(s)` : '\n>>> Conformité RGPD en place ✓');
  process.exit(ko ? 1 : 0);
}, 1800);
