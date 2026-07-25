'use strict';

/**
 * Fabrication et lecture des jetons de licence Algonis.
 *
 * Format : ALG1.<charge base64url>.<signature base64url>
 * La signature Ed25519 couvre la chaîne « ALG1.<charge> », exactement comme
 * le vérifie `src/licence.js` côté portail. Ce module est partagé par la
 * console (console.js) et la commande scripts/licence-signer.js pour qu'il
 * n'existe qu'une seule implémentation de la signature.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const PREFIXE = 'ALG1';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const dossierAlgonis = () => path.join(os.homedir(), '.algonis');
const cheminClePrivee = () => path.join(dossierAlgonis(), 'licence-private.pem');
const cheminClePublique = () => path.join(dossierAlgonis(), 'licence-public.txt');

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64url = (txt) => Buffer.from(String(txt).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function aujourdhui() {
  return new Date().toISOString().slice(0, 10);
}

/** Contrôles communs à la console et à la ligne de commande. */
function verifierChamps({ client, debut, fin, grace }) {
  const erreurs = [];
  if (!client || !String(client).trim()) erreurs.push('Le nom du client est obligatoire.');
  if (String(client || '').length > 120) erreurs.push('Le nom du client est trop long (120 caractères maximum).');
  if (!fin) erreurs.push('La date de fin est obligatoire.');
  if (fin && !DATE_RE.test(fin)) erreurs.push('La date de fin doit être au format AAAA-MM-JJ.');
  if (debut && !DATE_RE.test(debut)) erreurs.push('La date de début doit être au format AAAA-MM-JJ.');
  if (fin && debut && DATE_RE.test(fin) && DATE_RE.test(debut) && fin < debut) {
    erreurs.push('La date de fin doit être postérieure à la date de début.');
  }
  const g = Number(grace ?? 0);
  if (!Number.isFinite(g) || g < 0 || g > 365) erreurs.push('La tolérance doit être un nombre de jours entre 0 et 365.');
  return erreurs;
}

/**
 * Signe une licence et renvoie { jeton, charge }.
 * `cheminCle` par défaut : ~/.algonis/licence-private.pem
 */
function signer({ client, debut, fin, grace = 0, install, note, cheminCle }) {
  const chemin = cheminCle || cheminClePrivee();
  if (!fs.existsSync(chemin)) {
    const e = new Error(`Clé privée introuvable : ${chemin}. Lancez d'abord la création des clés.`);
    e.code = 'CLE_ABSENTE';
    throw e;
  }
  const charge = {
    v: 1,
    client: String(client).trim(),
    debut: debut || aujourdhui(),
    fin,
    grace: Number(grace ?? 0),
    emis: aujourdhui(),
  };
  if (install) charge.install = String(install).trim();
  if (note) charge.note = String(note).slice(0, 200);

  const chargeB64 = b64url(Buffer.from(JSON.stringify(charge), 'utf8'));
  const cle = crypto.createPrivateKey(fs.readFileSync(chemin));
  const signature = b64url(crypto.sign(null, Buffer.from(`${PREFIXE}.${chargeB64}`, 'utf8'), cle));
  return { jeton: `${PREFIXE}.${chargeB64}.${signature}`, charge };
}

/** Lit un jeton et vérifie sa signature avec la clé publique locale. */
function lire(jeton, clePubliqueB64) {
  const parts = String(jeton || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== PREFIXE) return { valide: false, raison: 'Format de licence non reconnu.' };
  let charge;
  try {
    charge = JSON.parse(deB64url(parts[1]).toString('utf8'));
  } catch {
    return { valide: false, raison: 'Contenu de licence illisible.' };
  }
  const publique = clePubliqueB64 || clePubliqueLocale();
  if (!publique) return { valide: true, signatureVerifiee: false, charge };
  let ok = false;
  try {
    const cle = crypto.createPublicKey({
      key: Buffer.from(publique, 'base64'), format: 'der', type: 'spki',
    });
    ok = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'), cle, deB64url(parts[2]));
  } catch {
    ok = false;
  }
  if (!ok) return { valide: false, raison: "Signature invalide : cette licence n'a pas été signée par votre clé." };
  return { valide: true, signatureVerifiee: true, charge };
}

/** Clé publique enregistrée sur ce poste (ou null). */
function clePubliqueLocale() {
  try {
    return fs.readFileSync(cheminClePublique(), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Empreinte affichée dans le panneau du client, pour comparaison. */
function empreinte(clePubliqueB64) {
  if (!clePubliqueB64) return null;
  return crypto.createHash('sha256').update(clePubliqueB64).digest('hex').slice(0, 8).toUpperCase();
}

module.exports = {
  PREFIXE, DATE_RE,
  aujourdhui, verifierChamps, signer, lire,
  clePubliqueLocale, empreinte,
  dossierAlgonis, cheminClePrivee, cheminClePublique,
};
