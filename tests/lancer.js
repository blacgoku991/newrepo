'use strict';

/**
 * Lanceur des suites de tests.
 *
 * Chaque suite démarre un vrai serveur, parfois un vrai navigateur, et rend un
 * verdict sur sa dernière ligne. On les joue donc SÉQUENTIELLEMENT, dans des
 * processus séparés : deux suites en parallèle se disputeraient les ports, et
 * un `require` partagé leur ferait hériter des variables d'environnement de la
 * précédente — c'est exactement le genre de faux positif qui fait perdre
 * confiance dans une suite de tests.
 *
 * Usage :
 *   npm test                 toutes les suites
 *   npm test -- rgpd cloi    seulement celles dont le nom contient ces motifs
 *   npm test -- --rapide     saute les suites qui ouvrent un navigateur
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const DELAI_MS = Number(process.env.TESTS_DELAI_MS || 300000);

/** Suites qui pilotent un navigateur : plus lentes, et inutiles sans Chromium. */
const AVEC_NAVIGATEUR = new Set(['conformite', 'navigation', 'panel-smartfixx', 'reglages-panel']);

function suites() {
  const out = [];
  for (const groupe of ['portail', 'saas']) {
    const dossier = path.join(__dirname, groupe);
    if (!fs.existsSync(dossier)) continue;
    for (const f of fs.readdirSync(dossier).filter((n) => n.endsWith('.js')).sort()) {
      out.push({ groupe, nom: path.basename(f, '.js'), fichier: path.join(dossier, f) });
    }
  }
  return out;
}

/**
 * Un serveur oublié d'une exécution précédente garde un port, et la suite
 * suivante échoue sur un `EADDRINUSE` qui n'a rien à voir avec le code — le
 * genre de faux échec qui fait perdre confiance dans une suite de tests.
 *
 * On visait d'abord `src/server.js` et `superadmin/index.js` par leur nom.
 * Insuffisant : une suite qui `require` le serveur porte le nom du TEST dans sa
 * ligne de commande, et survivait au ménage. On tue donc tout processus Node
 * dont la ligne de commande mentionne ce dépôt — sauf nous-mêmes.
 */
function menage() {
  let lignes = [];
  try {
    lignes = execSync('ps -eo pid,args', { encoding: 'utf8' }).split('\n');
  } catch { return; }
  for (const ligne of lignes) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(ligne);
    if (!m) continue;
    const pid = Number(m[1]);
    const args = m[2];
    if (pid === process.pid) continue;
    if (!args.includes('node') || !args.includes(RACINE)) continue;
    if (args.includes('tests/lancer.js')) continue;   // le lanceur lui-même
    try { process.kill(pid, 'SIGKILL'); } catch { /* déjà parti */ }
  }
}

function jouer(suite) {
  return new Promise((resolve) => {
    const debut = Date.now();
    const enfant = spawn(process.execPath, [suite.fichier], {
      cwd: RACINE,
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let sortie = '';
    let verdict = '';
    let acheve = null;

    /**
     * Le verdict fait foi, pas le code de sortie.
     *
     * Toutes les suites ne se terminent pas d'elles-mêmes : certaines laissent
     * un serveur ou un navigateur tenir la boucle d'événements après avoir tout
     * vérifié. Attendre leur fin, c'est attendre le délai maximal pour un test
     * qui a déjà rendu son avis. Dès que le verdict apparaît, on l'enregistre
     * et on laisse une seconde au processus pour partir de lui-même.
     */
    // Un `data` n'est pas une ligne : il peut couper au milieu. On garde donc
    // le fragment incomplet pour le chunk suivant — sans quoi le verdict
    // « Aucune faille … ✓ » pouvait arriver amputé de sa coche, et une suite au
    // vert passait pour un échec.
    let reste = '';
    const examiner = (texte) => {
      sortie += texte;
      if (verdict) return;
      const morceaux = (reste + texte).split('\n');
      reste = morceaux.pop();
      for (const l of morceaux) {
        if (l.startsWith('>>>') || /conforme sur tous les cas/.test(l)) {
          verdict = l.replace(/^>>>\s*/, '').trim();
          acheve = setTimeout(() => enfant.kill('SIGKILL'), 1200);
          return;
        }
      }
    };
    enfant.stdout.on('data', (d) => examiner(String(d)));
    enfant.stderr.on('data', (d) => examiner(String(d)));

    const minuteur = setTimeout(() => {
      sortie += `\n[lanceur] Dépassement du délai de ${DELAI_MS / 1000} s.\n`;
      enfant.kill('SIGKILL');
    }, DELAI_MS);

    enfant.on('close', (code) => {
      clearTimeout(minuteur);
      if (acheve) clearTimeout(acheve);
      const secondes = ((Date.now() - debut) / 1000).toFixed(1);
      // Le succès se reconnaît à la coche, JAMAIS à des mots-clés : chercher
      // « faille » ou « échec » dans le verdict faisait passer pour un échec
      // une suite qui annonçait « Aucune faille sur ces 30 tentatives ✓ ».
      // Sans verdict du tout, c'est le code de sortie qui tranche.
      const rate = verdict ? !verdict.includes('✓') : code !== 0;
      resolve({ ...suite, code: rate ? (code || 1) : 0, secondes, sortie, verdict });
    });
  });
}

(async () => {
  const args = process.argv.slice(2);
  const rapide = args.includes('--rapide');
  const motifs = args.filter((a) => !a.startsWith('--'));

  let liste = suites();
  if (motifs.length) liste = liste.filter((s) => motifs.some((m) => s.nom.includes(m)));
  if (rapide) liste = liste.filter((s) => !AVEC_NAVIGATEUR.has(s.nom));
  if (!liste.length) {
    console.error('Aucune suite ne correspond.');
    process.exit(1);
  }

  console.log(`\n  ${liste.length} suite(s) — ${rapide ? 'mode rapide, sans navigateur' : 'toutes'}\n`);
  const resultats = [];
  for (const suite of liste) {
    menage();
    process.stdout.write(`  ${(suite.groupe + '/' + suite.nom).padEnd(30)} `);
    const r = await jouer(suite);
    resultats.push(r);
    const etat = r.code === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`${etat} ${String(r.secondes).padStart(5)}s  ${r.verdict.slice(0, 60)}`);
  }
  menage();

  const rates = resultats.filter((r) => r.code !== 0);
  if (rates.length) {
    console.log('\n────────────────────────────────────────────────────────────\n');
    for (const r of rates) {
      console.log(`\x1b[31m✗ ${r.groupe}/${r.nom}\x1b[0m (code ${r.code})`);
      // Seulement les lignes qui disent ce qui ne va pas : une suite bavarde
      // noierait le motif de l'échec dans ses journaux de démarrage.
      const utiles = r.sortie.split('\n').filter((l) => /✗|ERREUR|Error:|dépassement/i.test(l));
      for (const l of utiles.slice(0, 12)) console.log(`    ${l.trim()}`);
      if (!utiles.length) console.log(`    ${r.sortie.split('\n').slice(-12).join('\n    ')}`);
      console.log('');
    }
  }

  const duree = resultats.reduce((a, r) => a + Number(r.secondes), 0).toFixed(0);
  console.log(`\n  ${resultats.length - rates.length}/${resultats.length} suite(s) au vert en ${duree} s\n`);
  process.exit(rates.length ? 1 : 0);
})();
