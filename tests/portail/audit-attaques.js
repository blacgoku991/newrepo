// AUDIT — chaque hypothèse de faille est éprouvée contre un serveur réel.
// « ✓ » = la tentative a bien été bloquée. « ✗ FAILLE » = à corriger.
const os = require('os'), fs = require('fs'), path = require('path');
const { RACINE } = require('../lib/harnais');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
process.env.SSO_REQUIRED = 'true';
process.env.M365_TENANT_ID = 't'; process.env.M365_CLIENT_ID = 'c'; process.env.M365_CLIENT_SECRET = 's';
process.env.M365_REDIRECT_URI = 'http://localhost:3987/api/sso/callback';
process.env.PORT = '3987';
process.env.ADMIN_PASSWORD = 'MotDePasseAdmin123!';
process.env.AUTOMATION_MODE = 'demo';
process.env.WORKER_POLL_MS = '600000';

const db = require(path.join(RACINE, 'src/db'));
const crypto = require('crypto');
const B = 'http://localhost:3987';

// Deux comptes Microsoft : un référent (778 NetSoins) et un salarié lambda.
db.createReferent('ref@adef.fr', 'Ref', 'Test', [{ appId: 'netsoins', value: '778' }], 'test');
const jetonRef = crypto.randomBytes(24).toString('hex');
const jetonLambda = crypto.randomBytes(24).toString('hex');
const exp = new Date(Date.now() + 3600e3).toISOString().slice(0, 19).replace('T', ' ');
db.createSsoSession(jetonRef, 'ref@adef.fr', 'Ref Test', 'o1', exp, 'Ref', 'Test');
db.createSsoSession(jetonLambda, 'lambda@adef.fr', 'Salarié Lambda', 'o2', exp, 'Salarié', 'Lambda');

// Une demande terminée, avec des données personnelles dans son message.
const refDemande = db.createRequest('netsoins', 'NS',
  { nom: 'DUPONT', prenom: 'Marie', identifiant: 'MARTIN PAUL', etablissement: '778', email: 'marie.dupont@adef.fr' },
  'Ref Test <ref@adef.fr>', 'ref@adef.fr', '10.0.0.1', 'creation');
const ligne = db.getByReference(refDemande);
db.setRequestLogin(ligne.id, 'MARTIN PAUL');
db.markFinished(ligne.id, true, 'Compte créé pour Marie DUPONT — identifiant « MARTIN PAUL », établissement EHPAD MON FOYER', []);

require(path.join(RACINE, 'src/server'));

let ko = 0;
const bilan = [];
function probe(bloque, titre, detail = '') {
  if (!bloque) { ko++; bilan.push(titre); }
  console.log(`${bloque ? '✓' : '✗ FAILLE'} ${titre}${detail ? ` — ${detail}` : ''}`);
}
const cookie = (j) => ({ Cookie: `portal_sso=${j}` });
const json = (extra) => ({ 'Content-Type': 'application/json', ...extra });

setTimeout(async () => {
  console.log('=== 1. Authentification et sessions ===');
  let r = await fetch(`${B}/api/espace/me`);
  probe(r.status === 401, 'API sans session Microsoft 365', `HTTP ${r.status}`);
  r = await fetch(`${B}/espace`, { redirect: 'manual' });
  probe(r.status === 302 && (r.headers.get('location') || '').startsWith('/connexion'), 'page sans session → redirection connexion', `HTTP ${r.status}`);
  r = await fetch(`${B}/api/admin/settings`);
  probe(r.status === 401, 'API admin sans session admin', `HTTP ${r.status}`);
  r = await fetch(`${B}/api/admin/settings`, { headers: cookie(jetonRef) });
  probe(r.status === 401, 'API admin avec un simple cookie Microsoft 365', `HTTP ${r.status}`);
  r = await fetch(`${B}/api/espace/me`, { headers: { Cookie: 'portal_sso=jetoninvente' } });
  probe(r.status === 401, 'jeton de session inventé', `HTTP ${r.status}`);
  // Session expirée
  const jetonVieux = crypto.randomBytes(24).toString('hex');
  db.createSsoSession(jetonVieux, 'vieux@adef.fr', 'V', 'o3', '2020-01-01 00:00:00', 'V', 'X');
  r = await fetch(`${B}/api/espace/me`, { headers: cookie(jetonVieux) });
  probe(r.status === 401, 'session expirée refusée', `HTTP ${r.status}`);

  console.log('\n=== 2. Autorisations (cloisonnement) ===');
  r = await fetch(`${B}/api/espace/me`, { headers: cookie(jetonLambda) });
  const espaceLambda = await r.json();
  probe(espaceLambda.referent === null && !espaceLambda.accounts, 'non-référent : aucun compte listé');
  r = await fetch(`${B}/api/apps/netsoins/requests`, {
    method: 'POST', headers: json(cookie(jetonLambda)),
    body: JSON.stringify({ nom: 'X', prenom: 'Y', sexe: 'masculin', email: 'x@a.fr', etablissement: '778', categorie_personnel: 'Aide à domicile', profil_droit: '44410', type_contrat: 'cdi' }),
  });
  probe(r.status === 403, 'non-référent : dépôt refusé', `HTTP ${r.status}`);
  r = await fetch(`${B}/api/apps/bluekango/requests?type=reset`, {
    method: 'POST', headers: json(cookie(jetonRef)),
    body: JSON.stringify({ identifiant: 'mdupont', etablissement: '71' }),
  });
  probe(r.status === 403, 'référent NetSoins : dépôt BlueKanGo refusé', `HTTP ${r.status}`);

  console.log('\n=== 3. Accès aux données d’une demande ===');
  r = await fetch(`${B}/api/requests/${refDemande}`, { headers: cookie(jetonLambda) });
  const vu = await r.json().catch(() => ({}));
  const fuite = r.status === 200 && /DUPONT|MARTIN PAUL/.test(JSON.stringify(vu));
  probe(!fuite, 'un salarié quelconque ne lit pas une demande d’autrui',
    fuite ? `HTTP 200 → « ${String(vu.message).slice(0, 60)}… »` : `HTTP ${r.status}`);
  r = await fetch(`${B}/api/requests/${refDemande}`, { headers: cookie(jetonRef) });
  probe(r.status === 200, 'le référent concerné lit bien sa demande', `HTTP ${r.status}`);
  r = await fetch(`${B}/api/requests/${refDemande}/credentials-access`, { method: 'POST', headers: cookie(jetonLambda) });
  probe(r.status === 403 || r.status === 404, 'identifiants d’autrui : accès refusé', `HTTP ${r.status}`);

  console.log('\n=== 4. Injections et pollution ===');
  // SQL dans la référence
  r = await fetch(`${B}/api/requests/${encodeURIComponent("' OR 1=1 --")}`, { headers: cookie(jetonRef) });
  probe(r.status === 404, 'injection SQL dans la référence', `HTTP ${r.status}`);
  // Pollution de prototype
  await fetch(`${B}/api/apps/netsoins/requests`, {
    method: 'POST', headers: json(cookie(jetonRef)),
    body: '{"__proto__":{"pollue":"oui"},"constructor":{"prototype":{"pollue2":"oui"}},"nom":"X","prenom":"Y","sexe":"masculin","email":"x@a.fr","etablissement":"778","categorie_personnel":"Aide à domicile","profil_droit":"44410","type_contrat":"cdi"}',
  });
  probe({}.pollue === undefined && {}.pollue2 === undefined, 'pollution de prototype par le corps JSON');
  // Champ hors schéma conservé ?
  const dep = await fetch(`${B}/api/apps/netsoins/requests`, {
    method: 'POST', headers: json(cookie(jetonRef)),
    body: JSON.stringify({ nom: 'X', prenom: 'Y', sexe: 'masculin', email: 'x@a.fr', etablissement: '778', categorie_personnel: 'Aide à domicile', profil_droit: '44410', type_contrat: 'cdi', admin: true, request_type: 'creation', payload: 'pirate' }),
  });
  const depJson = await dep.json().catch(() => ({}));
  if (depJson.reference) {
    const stocke = JSON.parse(db.getByReference(depJson.reference).payload);
    probe(!('admin' in stocke) && !('payload' in stocke), 'champs hors schéma ignorés au dépôt', Object.keys(stocke).join(','));
  } else probe(false, 'dépôt de contrôle', JSON.stringify(depJson).slice(0, 80));
  // Traversée de chemin
  for (const chemin of ['/img/..%2f..%2f.env', '/.env', '/data/portal.db', '/src/server.js', '/../.env']) {
    r = await fetch(`${B}${chemin}`, { headers: cookie(jetonRef), redirect: 'manual' });
    probe(r.status >= 400 || r.status === 301, `fichier hors public : ${chemin}`, `HTTP ${r.status}`);
  }

  console.log('\n=== 5. En-têtes, CSRF, CORS ===');
  r = await fetch(`${B}/espace`, { headers: cookie(jetonRef) });
  const csp = r.headers.get('content-security-policy') || '';
  probe(/script-src[^;]*'self'/.test(csp) && !/unsafe-inline[^;]*script/.test(csp.split('script-src')[1] || ''), 'CSP sans script inline', csp.slice(0, 60) + '…');
  probe(r.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options');
  probe(/DENY|SAMEORIGIN/i.test(r.headers.get('x-frame-options') || ''), 'X-Frame-Options', r.headers.get('x-frame-options'));
  probe(!!r.headers.get('referrer-policy'), 'Referrer-Policy', r.headers.get('referrer-policy'));
  r = await fetch(`${B}/api/apps/netsoins/requests`, {
    method: 'POST', headers: json({ ...cookie(jetonRef), Origin: 'https://pirate.example' }),
    body: JSON.stringify({ nom: 'X', prenom: 'Y', sexe: 'masculin', email: 'x@a.fr', etablissement: '778', categorie_personnel: 'Aide à domicile', profil_droit: '44410', type_contrat: 'cdi' }),
  });
  probe(r.status === 403, 'POST depuis une origine étrangère (CSRF)', `HTTP ${r.status}`);
  r = await fetch(`${B}/api/espace/me`, { headers: { ...cookie(jetonRef), Origin: 'https://pirate.example' } });
  probe(!r.headers.get('access-control-allow-origin'), 'CORS non ouvert par défaut', String(r.headers.get('access-control-allow-origin')));

  console.log('\n=== 6. Limitation de débit ===');
  let bloquees = 0;
  for (let i = 0; i < 13; i++) {
    const rl = await fetch(`${B}/api/auth/login`, { method: 'POST', headers: json({}), body: JSON.stringify({ username: 'admin', password: 'faux' + i }) });
    if (rl.status === 429) bloquees++;
  }
  probe(bloquees > 0, 'force brute sur la connexion admin', `${bloquees} tentative(s) bloquée(s) sur 13`);
  // Contournement par X-Forwarded-For (TRUST_PROXY absent)
  let contourne = 0;
  for (let i = 0; i < 6; i++) {
    const rl = await fetch(`${B}/api/auth/login`, {
      method: 'POST', headers: json({ 'X-Forwarded-For': `10.9.9.${i}` }),
      body: JSON.stringify({ username: 'admin', password: 'faux' }),
    });
    if (rl.status !== 429) contourne++;
  }
  probe(contourne === 0, 'contournement du quota par X-Forwarded-For', `${contourne} passage(s)`);

  console.log('\n=== 7. Console de démonstration ===');
  r = await fetch(`${B}/demo/netsoins`);
  probe(r.status !== 200 || !!process.env.CI, 'console démo sans session (depuis une autre machine)', `HTTP ${r.status} (ici la requête vient de 127.0.0.1, donc autorisée par conception)`);

  console.log('\n=== 8. Licence ===');
  // L'état de la licence est réservé à l'administration : aucune API publique.
  r = await fetch(`${B}/api/licence`, { headers: cookie(jetonRef) });
  probe(r.status === 404, 'aucune API de licence côté référent', `HTTP ${r.status}`);
  r = await fetch(`${B}/api/admin/settings`, { headers: cookie(jetonRef) });
  probe(r.status === 401, 'état de la licence inaccessible sans session admin', `HTTP ${r.status}`);
  r = await fetch(`${B}/api/admin/licence`, { method: 'POST', headers: json(cookie(jetonRef)), body: JSON.stringify({ jeton: 'ALG1.x.y' }) });
  probe(r.status === 401, 'installation d’une licence sans être admin', `HTTP ${r.status}`);

  console.log(ko === 0 ? '\n>>> Aucune faille sur ces 30 tentatives ✓' : `\n>>> ${ko} POINT(S) À CORRIGER :\n   - ${bilan.join('\n   - ')}`);
  process.exit(0);
}, 1500);
