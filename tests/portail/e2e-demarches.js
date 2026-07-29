// Dépôt réel des 5 démarches + traitement par le worker (mode démo).
const { RACINE, CHROMIUM } = require('../lib/harnais');
const RACINE_SLASH = RACINE + '/';
const os = require('os'), fs = require('fs'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dem-'));
process.env.SSO_REQUIRED = 'true';
process.env.M365_TENANT_ID = 't'; process.env.M365_CLIENT_ID = 'c'; process.env.M365_CLIENT_SECRET = 's';
process.env.M365_REDIRECT_URI = 'http://localhost:3998/api/sso/callback';
process.env.PORT = '3998';

const db = require(RACINE_SLASH + 'src/db');
const demarches = require(RACINE_SLASH + 'src/demarches');
// Référent habilité sur 778 ET 736 (pour tester un transfert légitime)
db.createReferent('ref@adef.fr', 'Ref', 'Test',
  [{ appId: 'netsoins', value: '778' }, { appId: 'netsoins', value: '736' }], 'test');
const crypto = require('crypto');
const token = crypto.randomBytes(24).toString('hex');
const expires = new Date(Date.now() + 3600e3).toISOString().slice(0, 19).replace('T', ' ');
db.createSsoSession(token, 'ref@adef.fr', 'Ref Test', 'oid', expires, 'Ref', 'Test');

require(RACINE_SLASH + 'src/server');

const base = 'http://localhost:3998/api/apps/netsoins/requests';
const hdr = { 'Content-Type': 'application/json', Cookie: `portal_sso=${token}` };

const CAS = [
  ['création', '', {
    nom: 'MARTIN', prenom: 'Paul', sexe: 'masculin', email: 'p@adef.fr',
    etablissement: '778', categorie_personnel: 'Aide à domicile',
    profil_droit: '44410', type_contrat: 'cdi',
  }],
  ['reset mot de passe', '?type=reset', { identifiant: 'MARTIN PAUL', etablissement: '778' }],
  ['ajout établissement', '?type=extension', { identifiant: 'MARTIN PAUL', etablissement: '778', etablissement_cible: '736' }],
  ['correction identité', '?type=identite', {
    identifiant: 'MARTIN PAUL', etablissement: '778', nom: 'MARTIN', prenom: 'Paul-Henri',
  }],
  ['transfert établissement', '?type=transfert', {
    identifiant: 'MARTIN PAUL', etablissement: '778', etablissement_cible: '736',
  }],
];

setTimeout(async () => {
  const refs = [];
  for (const [label, qs, corps] of CAS) {
    const r = await fetch(base + qs, { method: 'POST', headers: hdr, body: JSON.stringify(corps) });
    const b = await r.json().catch(() => ({}));
    if (r.status === 201) {
      const row = db.getByReference(b.reference);
      refs.push(b.reference);
      console.log(`✓ ${label.padEnd(26)} ${b.reference.padEnd(18)} type=${row.request_type}`);
    } else {
      console.log(`✗ ${label.padEnd(26)} HTTP ${r.status} ${(b.error || JSON.stringify(b.fields || {})).slice(0, 60)}`);
    }
  }

  // Chaque type doit être routé vers une fonction de robot existante.
  console.log('\nRoutage des démarches vers le robot :');
  const reg = require(RACINE_SLASH + 'src/registry');
  for (const [type, d] of Object.entries(demarches.DEMARCHES)) {
    for (const app of ['netsoins', 'bluekango']) {
      const au = (reg.get(app) || {}).automation || {};
      const ok = typeof au[d.action] === 'function';
      console.log(`  ${app.padEnd(10)} ${type.padEnd(15)} -> ${d.action.padEnd(22)} ${ok ? '✓' : '— (non disponible)'}`);
    }
  }

  // Traitement effectif par le worker
  console.log('\nTraitement par le worker (mode démo)…');
  await new Promise((r) => setTimeout(r, 14000));
  for (const ref of refs) {
    const row = db.getByReference(ref);
    const d = demarches.get(row.request_type);
    const etat = row.status === 'terminee' ? '✓ terminée' : row.status === 'echec' ? '✗ échec' : `… ${row.status}`;
    console.log(`  ${ref.padEnd(18)} ${d.court.padEnd(12)} ${etat.padEnd(12)} ${(row.result_message || '').slice(0, 62)}`);
  }
  process.exit(0);
}, 1500);
