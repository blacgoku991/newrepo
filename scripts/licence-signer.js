#!/usr/bin/env node
'use strict';

/**
 * OUTIL ÉDITEUR — SIGNE UNE LICENCE. À EXÉCUTER SUR VOTRE POSTE UNIQUEMENT.
 *
 * Fabrique le jeton à remettre au client, à coller dans
 * Administration → Réglages → Licence.
 *
 *   node scripts/licence-signer.js --client "ADEF Résidences" --fin 2027-07-31
 *   node scripts/licence-signer.js --client "Maison X" --fin 2027-12-31 \
 *        --install A1B2-C3D4-E5F6-7890
 *
 * Options
 *   --client   <texte>       Nom du client (affiché dans le panel).       [requis]
 *   --fin      <AAAA-MM-JJ>  Dernier jour de validité.                   [requis]
 *   --debut    <AAAA-MM-JJ>  Entrée en vigueur (défaut : aujourd'hui).
 *   --install  <ID>          Lie la licence à UNE installation. L'identifiant
 *                            est affiché dans Réglages → Licence chez le client.
 *                            Sans cette option, la licence marche sur n'importe
 *                            quelle installation : à réserver aux dépannages.
 *   --grace    <jours>       Tolérance après la date de fin (défaut : 30).
 *   --cle      <chemin>      Clé privée (défaut : ~/.algonis/licence-private.pem).
 *   --note     <texte>       Commentaire libre conservé dans la licence
 *                            (n° de commande, contact…).
 *
 * Le jeton n'est pas un secret : il ne contient rien d'autre que ce que vous y
 * mettez, et il ne fonctionne que sur l'installation visée.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const PREFIXE = 'ALG1';

function arg(nom, defaut = null) {
  const i = process.argv.indexOf(`--${nom}`);
  if (i === -1) return defaut;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : defaut;
}

const client = arg('client');
const fin = arg('fin');
const debut = arg('debut', new Date().toISOString().slice(0, 10));
const install = arg('install');
const grace = Number(arg('grace', '30'));
const note = arg('note');
const cheminCle = arg('cle', path.join(os.homedir(), '.algonis', 'licence-private.pem'));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const erreurs = [];
if (!client) erreurs.push('--client est requis (nom du client).');
if (!fin) erreurs.push('--fin est requis (AAAA-MM-JJ).');
if (fin && !DATE_RE.test(fin)) erreurs.push('--fin doit être au format AAAA-MM-JJ.');
if (debut && !DATE_RE.test(debut)) erreurs.push('--debut doit être au format AAAA-MM-JJ.');
if (fin && debut && DATE_RE.test(fin) && DATE_RE.test(debut) && fin < debut) {
  erreurs.push('--fin doit être postérieure à --debut.');
}
if (!Number.isFinite(grace) || grace < 0 || grace > 365) erreurs.push('--grace doit être un nombre de jours entre 0 et 365.');
if (!fs.existsSync(cheminCle)) {
  erreurs.push(`clé privée introuvable : ${cheminCle} (lancez d'abord scripts/licence-keygen.js).`);
}
if (erreurs.length) {
  console.error('✗ ' + erreurs.join('\n✗ '));
  console.error('\n  Aide : node scripts/licence-signer.js --client "Nom" --fin 2027-07-31');
  process.exit(1);
}

const charge = {
  v: 1,
  client,
  debut,
  fin,
  grace,
  emis: new Date().toISOString().slice(0, 10),
};
if (install) charge.install = install;
if (note) charge.note = String(note).slice(0, 200);

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const chargeB64 = b64url(Buffer.from(JSON.stringify(charge), 'utf8'));
const cle = crypto.createPrivateKey(fs.readFileSync(cheminCle));
const signature = b64url(crypto.sign(null, Buffer.from(`${PREFIXE}.${chargeB64}`, 'utf8'), cle));
const jeton = `${PREFIXE}.${chargeB64}.${signature}`;

console.log('');
console.log(`  Client        : ${client}`);
console.log(`  Validité      : du ${debut} au ${fin} (tolérance ${grace} j)`);
console.log(`  Installation  : ${install || 'toutes (non liée)'}`);
if (note) console.log(`  Note          : ${charge.note}`);
console.log('');
console.log('  Licence à remettre au client (Administration → Réglages → Licence) :');
console.log('');
console.log(jeton);
console.log('');
