// Tout ce qui se faisait en ligne de commande — ou pas du tout — doit se faire
// depuis le panel, et refuser proprement ce qui doit être refusé.
const os = require('os'), fs = require('fs'), path = require('path'), http = require('http');
process.env.SMARTFIXX_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sfxg-'));
process.env.SMARTFIXX_SAUVEGARDES = path.join(process.env.SMARTFIXX_DIR, 'sauvegardes');
process.env.SMARTFIXX_USER = 'achraf';
process.env.SMARTFIXX_PASSWORD = 'MotDePasseDuPanel2026';
const { RACINE: R } = require('../lib/harnais');
const app = require(path.join(R, 'superadmin/server'));
const dbp = require(path.join(R, 'superadmin/lib/db'));
const sig = require(path.join(R, 'superadmin/lib/signature'));
const orch = require(path.join(R, 'superadmin/lib/orchestrateur'));

let ko = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) ko++; };

const jour = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const idA = dbp.creerSociete({ nom: 'Société A', contactNom: 'A', contactEmail: 'a@a.fr', sousDomaine: 'aaa', instanceUrl: 'https://aaa.smartfixx.fr' });
dbp.ajouterLicence(idA, { jeton: sig.signer({ client: 'Société A', debut: jour(-1), fin: jour(300) }), client: 'Société A', debut: jour(-1), fin: jour(300), motif: 'creation', par: 'achraf' });

const PORT = 4041;
let cookie = '';
function appel(methode, chemin, corps, brut) {
  return new Promise((res, rej) => {
    const data = corps === undefined ? null : JSON.stringify(corps);
    const r = http.request({ host: '127.0.0.1', port: PORT, path: chemin, method: methode,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (rep) => {
        const morceaux = [];
        rep.on('data', (d) => morceaux.push(d));
        rep.on('end', () => {
          const buf = Buffer.concat(morceaux);
          if (rep.headers['set-cookie']) cookie = rep.headers['set-cookie'][0].split(';')[0];
          res({ code: rep.statusCode, entetes: rep.headers, octets: buf.length,
                corps: brut ? buf : (() => { try { return JSON.parse(buf.toString()); } catch { return buf.toString().slice(0, 200); } })() });
        });
      });
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}

const serveur = app.listen(PORT, '127.0.0.1', async () => {
  await appel('POST', '/api/login', { username: 'achraf', password: 'MotDePasseDuPanel2026' });

  console.log('— 1. Opérateurs : créer, changer, supprimer —');
  let r = await appel('GET', '/api/operateurs');
  ok(r.corps.operateurs.length === 1 && r.corps.moi === 'achraf', `liste : ${r.corps.operateurs.map((o) => o.username).join(', ')}`);
  r = await appel('POST', '/api/operateurs', { username: 'ancien.compte', password: 'MotDePasseAssezLong1' });
  ok(r.code === 200, 'création d’un second opérateur');
  r = await appel('POST', '/api/operateurs', { username: 'faible', password: 'court' });
  ok(r.code === 400, `mot de passe trop court refusé : ${r.corps.error}`);
  r = await appel('POST', '/api/operateurs', { username: 'ancien.compte', password: 'MotDePasseAssezLong1' });
  ok(r.code === 409, 'identifiant déjà pris refusé');
  r = await appel('POST', '/api/operateurs', { username: '../root', password: 'MotDePasseAssezLong1' });
  ok(r.code === 400, 'identifiant hors format refusé');

  const moi = (await appel('GET', '/api/operateurs')).corps.operateurs.find((o) => o.username === 'achraf');
  r = await appel('DELETE', `/api/operateurs/${moi.id}`);
  ok(r.code === 409, `on ne supprime pas son propre compte : ${r.corps.error}`);
  const autre = (await appel('GET', '/api/operateurs')).corps.operateurs.find((o) => o.username === 'ancien.compte');
  r = await appel('DELETE', `/api/operateurs/${autre.id}`);
  ok(r.code === 200, 'suppression du départ tracée');
  r = await appel('DELETE', `/api/operateurs/${moi.id}`);
  ok(r.code === 409, 'le dernier opérateur reste : le panel ne se ferme pas sur lui-même');

  console.log('\n— 2. Journal d’un portail : anonymisé —');
  orch.demarrer(idA);
  await new Promise((s) => setTimeout(s, 3500));
  r = await appel('GET', `/api/societes/${idA}/journal`);
  ok(r.code === 200 && r.corps.lignes.length > 0, `${r.corps.lignes.length} ligne(s) retenue(s)`);
  const texte = r.corps.lignes.map((l) => l.texte).join('\n');
  ok(!/@[\w-]+\.[a-z]{2,}/i.test(texte), 'aucune adresse e-mail en clair');
  // Le portail annonce à son démarrage le mot de passe qu'il génère pour son
  // administrateur : il ne doit pas rester lisible depuis le panel.
  ok(/\[secret masqué\]/.test(texte), 'le mot de passe généré au démarrage est masqué');
  ok(!/[A-Za-z0-9]{16}/.test(texte.replace(/\[secret masqué\]/g, '')), 'plus aucun jeton brut dans le journal');

  console.log('\n— 3. Sauvegardes : télécharger, supprimer, et rien d’autre —');
  r = await appel('POST', '/api/sauvegardes');
  const nom = r.corps.nom;
  ok(r.code === 200, `sauvegarde ${nom}`);
  r = await appel('GET', `/api/sauvegardes/${nom}`, undefined, true);
  ok(r.code === 200 && r.octets > 500 && r.corps[0] === 0x1f && r.corps[1] === 0x8b,
     `archive gzip de ${Math.round(r.octets / 1024)} ko`);
  for (const mauvais of ['..', '../../etc', '%2e%2e%2f%2e%2e%2fetc', 'nimportequoi', '2026-01-01-00-00-00; rm -rf /']) {
    r = await appel('GET', `/api/sauvegardes/${encodeURIComponent(mauvais)}`);
    ok(r.code === 404, `« ${mauvais} » → HTTP ${r.code}`);
  }
  r = await appel('DELETE', '/api/sauvegardes/..%2f..%2f..%2fetc');
  ok(r.code === 404, `suppression hors dossier refusée : HTTP ${r.code}`);

  console.log('\n— 4. Suppression d’une société : trois verrous —');
  r = await appel('DELETE', `/api/societes/${idA}`, { confirmation: 'Société A' });
  ok(r.code === 409, `société active : ${r.corps.error}`);
  await appel('POST', `/api/societes/${idA}/archiver`, { archivee: true });
  r = await appel('DELETE', `/api/societes/${idA}`, { confirmation: 'societe a' });
  ok(r.code === 400, `nom approchant refusé : ${r.corps.error}`);
  const avant = (await appel('GET', '/api/sauvegardes')).corps.sauvegardes.length;
  r = await appel('DELETE', `/api/societes/${idA}`, { confirmation: 'Société A' });
  ok(r.code === 200, `supprimée, sauvegarde ${r.corps.sauvegarde} [HTTP ${r.code} ${JSON.stringify(r.corps).slice(0, 300)}]`);
  const apres = (await appel('GET', '/api/sauvegardes')).corps.sauvegardes.length;
  ok(apres === avant + 1, 'une sauvegarde a bien été prise avant la suppression');
  ok(!fs.existsSync(path.join(orch.INSTANCES, 'aaa')), 'le dossier du portail est parti');
  ok(!dbp.societe(idA), 'la société n’est plus au registre');
  const j = (await appel('GET', '/api/journal')).corps.entrees.map((e) => e.action);
  ok(j.includes('societe_supprimee') && j.includes('operateur_cree'), `journal : ${[...new Set(j)].slice(0, 6).join(', ')}`);

  console.log('\n— 5. Sans session, rien —');
  const memoire = cookie; cookie = '';
  for (const [m, c] of [['GET', '/api/operateurs'], ['POST', '/api/operateurs'], ['GET', '/api/sauvegardes'], ['DELETE', '/api/societes/1']]) {
    r = await appel(m, c, m === 'GET' ? undefined : {});
    ok(r.code === 401, `${m} ${c} → HTTP ${r.code}`);
  }
  cookie = memoire;

  orch.arreterTout();
  serveur.close();
  console.log(ko ? `\n>>> ${ko} anomalie(s)` : '\n>>> Gestion complète depuis le panel ✓');
  setTimeout(() => process.exit(ko ? 1 : 0), 500);
});
