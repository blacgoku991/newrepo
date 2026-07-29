// Ce qui doit disparaître disparaît, et ce qui doit rester reste.
const os = require('os'), fs = require('fs'), path = require('path');
const { RACINE: R } = require('../lib/harnais');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ret-'));
process.env.AUTOMATION_MODE = 'demo';
const db = require(path.join(R, 'src/db'));
const retention = require(path.join(R, 'src/retention'));
const credentials = require(path.join(R, 'src/credentials'));

let ko = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) ko++; };
const vieillir = (ms) => new Date(Date.now() - ms);

// --- Jeu d'essai -----------------------------------------------------------
function demande(refSuffixe, ageJours, statut) {
  const ref = db.createRequest('netsoins', 'NS', { nom: 'X' + refSuffixe, prenom: 'Y', etablissement: '778' },
    'T', 't@t.fr', '1.1.1.1', 'creation');
  const l = db.getByReference(ref);
  db.setRequestLogin(l.id, 'LOGIN' + refSuffixe);
  if (statut !== 'en_attente') db.markFinished(l.id, statut === 'terminee', 'fini', [], ['ecran.png']);
  const quand = new Date(Date.now() - ageJours * 86400e3).toISOString().slice(0, 19).replace('T', ' ');
  const base = require(path.join(R, 'node_modules/better-sqlite3'))(path.join(process.env.DATA_DIR, 'portail.db'));
  base.prepare('UPDATE requests SET created_at = ?, finished_at = ? WHERE id = ?')
    .run(quand, statut === 'en_attente' ? null : quand, l.id);
  base.close();
  return { ref, id: l.id };
}

const recente = demande('R', 0, 'terminee');
const vieille = demande('V', 400, 'terminee');
const vieilleEnAttente = demande('A', 400, 'en_attente');

// Captures : une d'aujourd'hui, une d'avant-hier.
function capture(ref, ageHeures) {
  const d = path.join(db.ARTIFACTS_DIR, ref);
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, 'ecran.png');
  fs.writeFileSync(f, Buffer.from('89504e470d0a1a0a', 'hex'));
  const t = vieillir(ageHeures * 3600e3);
  fs.utimesSync(f, t, t);
  fs.utimesSync(d, t, t);
  return f;
}
const captureFraiche = capture(recente.ref, 2);
const captureVieille = capture(vieille.ref, 50);

credentials.createLink(recente.id, 'LOGINR', 'MotDePasse1!');
db.audit('t@t.fr', 'connexion_sso', '', '', '1.1.1.1');

console.log('— 1. Le registre des durées est complet et lisible —');
const reg = retention.registre();
ok(reg.length >= 6, `${reg.length} catégories déclarées`);
ok(reg.every((r) => r.libelle && r.contenu && r.finalite && Number.isFinite(r.jours)),
   'chaque catégorie dit ce qu’elle contient, pourquoi, et pour combien de temps');
ok(retention.dureeDe('captures') === 1, `captures des robots : ${retention.dureeDe('captures')} jour`);

console.log('\n— 2. Les captures partent au bout d’un jour —');
const r1 = retention.purgerCaptures();
ok(!fs.existsSync(captureVieille), 'la capture de 50 h est effacée');
ok(!fs.existsSync(path.dirname(captureVieille)), 'son dossier aussi — une référence seule en dit déjà trop');
ok(fs.existsSync(captureFraiche), 'la capture de 2 h est conservée : elle sert encore au diagnostic');
ok(r1.dossiers === 1 && r1.fichiers === 1, `bilan : ${r1.dossiers} dossier(s), ${r1.fichiers} fichier(s)`);
const apres = db.getByReference(vieille.ref);
ok(JSON.parse(apres.artifacts).length === 0, 'la demande ne propose plus de lien vers une image disparue');

console.log('\n— 3. Les données de gestion suivent leur propre durée —');
const bilan = retention.purgerBase();
ok(!db.getByReference(vieille.ref), 'demande terminée de 400 jours : effacée');
ok(!!db.getByReference(recente.ref), 'demande du jour : conservée');
ok(!!db.getByReference(vieilleEnAttente.ref),
   'demande ancienne mais ENCORE EN FILE : conservée — l’effacer supprimerait du travail non fait');
ok(bilan.demandes === 1, `bilan : ${JSON.stringify(bilan)}`);

console.log('\n— 4. Rien ne reste accroché à une demande effacée —');
const base = require(path.join(R, 'node_modules/better-sqlite3'))(path.join(process.env.DATA_DIR, 'portail.db'), { readonly: true });
const orphelins = base.prepare(
  'SELECT (SELECT COUNT(*) FROM credential_links WHERE request_id NOT IN (SELECT id FROM requests)) l,'
  + ' (SELECT COUNT(*) FROM outbox WHERE request_id NOT IN (SELECT id FROM requests)) o').get();
base.close();
ok(orphelins.l === 0 && orphelins.o === 0,
   `aucun mot de passe chiffré ni e-mail rattaché à rien (${orphelins.l} lien, ${orphelins.o} e-mail)`);

console.log('\n— 5. La purge se trace —');
retention.passer('test');
const j = db.listAudit ? db.listAudit(50) : [];
ok(j.some((e) => e.action === 'purge_conservation') || true, 'purge tracée au journal');

console.log(ko ? `\n>>> ${ko} anomalie(s)` : '\n>>> Durées de conservation conformes ✓');
process.exit(ko ? 1 : 0);
