/*
 * Panel Smartfixx : sociétés, licences, logos, journal — et tout ce qui doit
 * être refusé.
 */
const os = require('os'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const { RACINE } = require('../lib/harnais');
const { SORTIES: D } = require('../lib/harnais');
process.env.SMARTFIXX_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sfx-'));
process.env.SMARTFIXX_USER = 'achraf';
process.env.SMARTFIXX_PASSWORD = 'motdepasse-panel';

const app = require(path.join(RACINE, 'superadmin/server'));
const signature = require(path.join(RACINE, 'superadmin/lib/signature'));
let ok = true;
const dit = (b, t) => { if (!b) ok = false; console.log(`  ${b ? '✓' : '✗'} ${t}`); };
const titre = (t) => console.log(`\n— ${t} —`);

const serveur = app.listen(4021, '127.0.0.1', async () => {
  const B = 'http://127.0.0.1:4021';
  let cookie = '';
  const req = async (methode, url, corps) => {
    const r = await fetch(B + url, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
    const set = r.headers.get('set-cookie');
    if (set && set.includes('smartfixx_sid=') && !set.includes('smartfixx_sid=;')) cookie = set.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json().catch(() => ({})) : null, r };
  };

  try {
    titre('1. Rien n’est accessible sans session');
    for (const [m, u] of [['GET', '/api/societes'], ['GET', '/api/journal'], ['GET', '/api/cle'], ['POST', '/api/societes']]) {
      const r = await req(m, u, m === 'POST' ? { nom: 'Pirate' } : undefined);
      dit(r.status === 401, `${m} ${u} → HTTP ${r.status}`);
    }
    const page = await fetch(B + '/', { redirect: 'manual' });
    dit(page.status === 302, `la page du panel redirige vers la connexion : HTTP ${page.status}`);

    titre('2. Connexion');
    let r = await req('POST', '/api/login', { username: 'achraf', password: 'mauvais' });
    dit(r.status === 401, `mauvais mot de passe : HTTP ${r.status}`);
    r = await req('POST', '/api/login', { username: 'achraf', password: 'motdepasse-panel' });
    dit(r.status === 200 && !!cookie, `connexion : HTTP ${r.status}`);
    dit(/HttpOnly/i.test(r.headers.get('set-cookie') || ''), 'le cookie est HttpOnly');
    dit((await req('GET', '/api/moi')).body.username === 'achraf', 'session reconnue');

    titre('3. Création de sociétés');
    r = await req('POST', '/api/societes', {
      nom: 'ADEF Résidences', contactNom: 'Ludovic', contactEmail: 'ludovic@adef-residences.com',
      instanceUrl: 'https://adef.smartfixx.fr', instancePort: 3001, notes: 'Groupe pilote',
    });
    const adef = r.body.id;
    dit(r.status === 200 && adef > 0, `société créée (id ${adef})`);
    r = await req('POST', '/api/societes', { nom: 'ADEF Résidences' });
    dit(r.status === 409, `doublon refusé : HTTP ${r.status} — ${r.body.error}`);
    r = await req('POST', '/api/societes', { nom: '' });
    dit(r.status === 400, `nom vide refusé : HTTP ${r.status}`);
    await req('POST', '/api/societes', { nom: 'Résidences du Parc', contactNom: 'Marie' });

    titre('4. Émission d’une licence');
    r = await req('POST', `/api/societes/${adef}/licences`, { debut: '2026-01-01', fin: '2027-01-01' });
    const jeton = r.body.jeton;
    dit(r.status === 200 && /^ALG1\./.test(jeton || ''), `licence émise : ${String(jeton).slice(0, 34)}…`);
    dit(r.body.motif === 'creation', `motif : ${r.body.motif}`);
    const charge = signature.lire(jeton);
    dit(charge.client === 'ADEF Résidences', `la licence porte le nom de la société : « ${charge.client} »`);
    dit(charge.debut === '2026-01-01' && charge.fin === '2027-01-01', `période : ${charge.debut} → ${charge.fin}`);

    titre('5. La licence est vérifiable par le produit livré');
    // On rejoue exactement la vérification de src/licence.js avec la clé publique
    // du panel : si ça passe, le client acceptera le jeton.
    const crypto = require('crypto');
    const [prefixe, chargeB64, sigB64] = jeton.split('.');
    const clePub = crypto.createPublicKey({
      key: Buffer.from(signature.clePubliqueB64(), 'base64'), format: 'der', type: 'spki',
    });
    const valide = crypto.verify(null, Buffer.from(`${prefixe}.${chargeB64}`, 'utf8'), clePub,
      Buffer.from(sigB64, 'base64url'));
    dit(valide, 'signature Ed25519 vérifiée avec la clé publique du panel');
    const altere = `${prefixe}.${Buffer.from(JSON.stringify({ ...charge, fin: '2099-01-01' })).toString('base64url')}.${sigB64}`;
    const [p2, c2, s2] = altere.split('.');
    dit(!crypto.verify(null, Buffer.from(`${p2}.${c2}`, 'utf8'), clePub, Buffer.from(s2, 'base64url')),
      'une date de fin repoussée à la main invalide la signature');

    titre('6. Dates refusées');
    for (const [d, f, quoi] of [['2026-01-01', '2025-01-01', 'fin avant début'], ['pas-une-date', '2027-01-01', 'format invalide']]) {
      r = await req('POST', `/api/societes/${adef}/licences`, { debut: d, fin: f });
      dit(r.status === 400, `${quoi} → HTTP ${r.status}`);
    }

    titre('7. Renouvellement : l’ancienne reste valable');
    r = await req('POST', `/api/societes/${adef}/licences`, { debut: '2027-01-02', fin: '2028-01-02' });
    dit(r.body.motif === 'renouvellement', `motif : ${r.body.motif}`);
    const hist = (await req('GET', `/api/societes/${adef}/licences`)).body.licences;
    dit(hist.length === 2, `${hist.length} licences dans l’historique`);
    dit(hist.every((l) => !l.revoqueeLe), 'aucune n’a été révoquée automatiquement');

    titre('8. Révocation — la licence courante retombe sur la précédente');
    // `hist` est trié du plus récent au plus ancien : hist[0] est le
    // renouvellement. On le révoque pour vérifier que la vue repart bien sur la
    // licence encore valable, et non sur la dernière émise.
    dit(hist[0].fin === '2028-01-02', `renouvellement en tête d'historique : ${hist[0].fin}`);
    r = await req('POST', `/api/licences/${hist[0].id}/revoquer`, { motif: '' });
    dit(r.status === 400, `motif obligatoire : HTTP ${r.status}`);
    r = await req('POST', `/api/licences/${hist[0].id}/revoquer`, { motif: 'Erreur d’émission' });
    dit(r.status === 200, `révoquée : HTTP ${r.status}`);
    dit(/reste valable/.test(r.body.avertissement || ''), `l’effet réel est annoncé : « ${r.body.avertissement} »`);
    r = await req('POST', `/api/licences/${hist[0].id}/revoquer`, { motif: 'encore' });
    dit(r.status === 409, `deux fois : HTTP ${r.status}`);

    titre('9. Logos — seules de vraies images passent');
    const png = zlib.gzipSync(Buffer.alloc(1)) && Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7),
    ]);
    r = await req('PUT', `/api/societes/${adef}/logo`, { image: `data:image/png;base64,${png.toString('base64')}` });
    dit(r.status === 200 && r.body.ext === 'png', `PNG accepté : ${r.body.ext}, ${r.body.taille} octets`);

    // Un SVG porteur de script, déguisé en PNG par son type déclaré.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    r = await req('PUT', `/api/societes/${adef}/logo`, { image: `data:image/png;base64,${svg.toString('base64')}` });
    dit(r.status === 400, `SVG déguisé en PNG refusé : HTTP ${r.status} — ${r.body.error}`);

    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x90)]);
    r = await req('PUT', `/api/societes/${adef}/logo`, { image: `data:image/png;base64,${exe.toString('base64')}` });
    dit(r.status === 400, `exécutable refusé : HTTP ${r.status}`);

    const gros = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(600 * 1024, 1)]);
    r = await req('PUT', `/api/societes/${adef}/logo`, { image: `data:image/png;base64,${gros.toString('base64')}` });
    dit(r.status === 400 && /trop lourde/.test(r.body.error || ''), `image trop lourde refusée : ${r.body.error}`);

    // Le logo précédent (valide) doit être intact après ces refus.
    const img = await fetch(B + `/api/societes/${adef}/logo`, { headers: { Cookie: cookie } });
    dit(img.status === 200 && img.headers.get('content-type') === 'image/png',
      `logo servi : HTTP ${img.status}, ${img.headers.get('content-type')}`);
    dit(img.headers.get('x-content-type-options') === 'nosniff', 'servi avec nosniff');
    const sansSession = await fetch(B + `/api/societes/${adef}/logo`);
    dit(sansSession.status === 401, `logo inaccessible sans session : HTTP ${sansSession.status}`);

    titre('10. Vue d’ensemble');
    const vue = (await req('GET', '/api/societes')).body;
    const fiche = vue.societes.find((s) => s.id === adef);
    dit(vue.societes.length === 2, `${vue.societes.length} sociétés`);
    dit(fiche.logo === true, 'la présence du logo est signalée');
    dit(fiche.licence && fiche.licence.fin === '2027-01-01',
      `après révocation du renouvellement, la courante repart sur la précédente : fin ${fiche.licence.fin}`);
    dit(typeof fiche.licence.joursRestants === 'number', `jours restants calculés : ${fiche.licence.joursRestants}`);
    dit(vue.societes.find((s) => s.nom === 'Résidences du Parc').licence === null,
      'une société sans licence est bien signalée');

    titre('11. Archivage');
    r = await req('POST', `/api/societes/${adef}/archiver`, { archivee: true });
    dit(r.status === 200, `archivée : HTTP ${r.status}`);
    dit((await req('GET', '/api/societes')).body.societes.find((s) => s.id === adef).archivee === true, 'état reflété');
    await req('POST', `/api/societes/${adef}/archiver`, { archivee: false });

    titre('12. Journal');
    const j = (await req('GET', '/api/journal')).body.entrees;
    for (const a of ['connexion', 'echec_connexion', 'societe_creee', 'licence_emise', 'licence_revoquee', 'logo_modifie'])
      dit(j.some((e) => e.action === a), `« ${a} » tracé`);
    dit(!j.some((e) => (e.details || '').includes('ALG1.')), 'aucun jeton de licence recopié dans le journal');

    titre('13. Anti-CSRF');
    const csrf = await fetch(B + '/api/societes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://pirate.example' },
      body: JSON.stringify({ nom: 'Injectée' }),
    });
    dit(csrf.status === 403, `requête d’une autre origine refusée : HTTP ${csrf.status}`);

    titre('14. En-têtes de sécurité');
    const t = await fetch(B + '/login.html');
    const csp = t.headers.get('content-security-policy') || '';
    dit(/script-src 'self'/.test(csp) && !/unsafe-eval/.test(csp), `CSP stricte : ${csp.slice(0, 58)}…`);
    dit(t.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options: DENY');
    dit(t.headers.get('referrer-policy') === 'no-referrer', 'Referrer-Policy: no-referrer');
    dit(!t.headers.get('x-powered-by'), 'la technologie du serveur n’est pas annoncée');

    titre('15. La clé privée reste hors du dépôt');
    const { execSync } = require('child_process');
    const suivis = execSync('git -C /home/user/newrepo ls-files superadmin/', { encoding: 'utf8' });
    dit(!/cle-privee|\.pem/.test(suivis), 'aucun fichier de clé dans les fichiers versionnés');
    dit(fs.existsSync(signature.FICHIER_CLE) && !signature.FICHIER_CLE.startsWith(RACINE),
      `la clé vit hors du projet : ${signature.FICHIER_CLE.replace(os.tmpdir(), '<tmp>')}`);
    const droits = (fs.statSync(signature.FICHIER_CLE).mode & 0o777).toString(8);
    dit(droits === '600', `permissions du fichier de clé : ${droits}`);
  } catch (e) {
    console.error('\nERREUR :', e);
    ok = false;
  }

  serveur.close();
  console.log(ok ? '\n>>> Panel Smartfixx conforme ✓' : '\n>>> DES CAS ONT ÉCHOUÉ');
  process.exit(ok ? 0 : 1);
});
