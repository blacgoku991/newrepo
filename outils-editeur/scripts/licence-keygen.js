#!/usr/bin/env node
'use strict';

/**
 * OUTIL ÉDITEUR — À EXÉCUTER UNE SEULE FOIS, SUR VOTRE POSTE.
 *
 * Crée la paire de clés qui sert à signer les licences :
 *   - la clé PRIVÉE est écrite hors du dépôt et ne doit JAMAIS en sortir ;
 *     qui la possède peut fabriquer des licences ;
 *   - la clé PUBLIQUE est à coller dans `src/licence.js` (constante
 *     CLE_PUBLIQUE). Elle n'est pas secrète : elle part chez tous les clients.
 *
 *   node scripts/licence-keygen.js
 *   node scripts/licence-keygen.js --sortie ~/algonis-licences
 *
 * Si vous perdez la clé privée, vous ne pourrez plus signer de nouvelle licence
 * (les licences déjà émises continueront de fonctionner) : sauvegardez-la.
 * Si elle fuite, générez une nouvelle paire, changez la clé publique dans le
 * code et réémettez les licences en cours.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const args = process.argv.slice(2);
const optSortie = args.indexOf('--sortie');
const dossier = optSortie !== -1 && args[optSortie + 1]
  ? path.resolve(args[optSortie + 1])
  : path.join(os.homedir(), '.algonis');

const cheminPrive = path.join(dossier, 'licence-private.pem');
if (fs.existsSync(cheminPrive) && !args.includes('--forcer')) {
  console.error(`✗ Une clé privée existe déjà : ${cheminPrive}`);
  console.error("  L'écraser invaliderait toutes les licences déjà émises.");
  console.error('  Ajoutez --forcer si c’est réellement ce que vous voulez.');
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const privePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publiqueB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
fs.writeFileSync(cheminPrive, privePem, { mode: 0o600 });
fs.writeFileSync(path.join(dossier, 'licence-public.txt'), publiqueB64 + '\n', { mode: 0o644 });

console.log('');
console.log('  Paire de clés de licence créée (Ed25519).');
console.log('');
console.log(`  Clé PRIVÉE  : ${cheminPrive}`);
console.log('                À GARDER SUR CE POSTE. Ne jamais committer, ne jamais envoyer.');
console.log(`  Clé PUBLIQUE : ${path.join(dossier, 'licence-public.txt')}`);
console.log('');
console.log('  Collez cette ligne dans src/licence.js (remplace la valeur du gabarit) :');
console.log('');
console.log(`const CLE_PUBLIQUE = '${publiqueB64}';`);
console.log('');
console.log('  Puis livrez le portail. Sans cette étape, le portail tourne sans limitation.');
console.log('');
