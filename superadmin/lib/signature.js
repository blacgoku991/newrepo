'use strict';

/**
 * Signature des licences Algonis (Ed25519).
 *
 * Produit exactement le format que les instances savent vérifier
 * (`src/licence.js`) :
 *
 *     ALG1.<charge utile base64url>.<signature base64url>
 *
 * ⚠️ LA CLÉ PRIVÉE NE DOIT JAMAIS ENTRER DANS LE DÉPÔT. Elle est lue depuis un
 * fichier hors du projet (par défaut `~/.smartfixx/cle-privee.pem`, permissions
 * 0600). Qui la détient peut fabriquer une licence pour n'importe quelle
 * société : c'est le secret qui tient tout le modèle commercial.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIXE = 'ALG1';
const DOSSIER = process.env.SMARTFIXX_DIR || path.join(os.homedir(), '.smartfixx');
const FICHIER_CLE = process.env.SMARTFIXX_CLE_PRIVEE || path.join(DOSSIER, 'cle-privee.pem');

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/**
 * Charge la clé privée, en la créant au premier démarrage.
 *
 * La création affiche la clé PUBLIQUE à recopier dans `src/licence.js` : sans
 * cette étape, les instances refuseront toutes les licences émises ici.
 */
function clePrivee() {
  if (!fs.existsSync(FICHIER_CLE)) {
    fs.mkdirSync(path.dirname(FICHIER_CLE), { recursive: true, mode: 0o700 });
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(
      FICHIER_CLE,
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { mode: 0o600 }
    );
    const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    console.warn(
      `\n[licences] Nouvelle paire de clés créée : ${FICHIER_CLE}\n` +
      '\n  SAUVEGARDEZ CE FICHIER HORS DE CETTE MACHINE.\n' +
      "  Sans lui, plus aucune licence ne peut être émise ni renouvelée,\n" +
      '  pour aucun client.\n' +
      '\n  Clé publique correspondante (transmise automatiquement aux portails,\n' +
      "  à n'embarquer dans le code que pour un client qui héberge lui-même) :\n" +
      `\n  ${pub}\n`
    );
  }
  try {
    fs.chmodSync(FICHIER_CLE, 0o600);
  } catch {
    /* système de fichiers sans permissions POSIX */
  }
  return crypto.createPrivateKey(fs.readFileSync(FICHIER_CLE));
}

/** Clé publique correspondante, en base64 DER — à embarquer dans le produit livré. */
function clePubliqueB64() {
  return crypto
    .createPublicKey(clePrivee())
    .export({ type: 'spki', format: 'der' })
    .toString('base64');
}

/** Empreinte courte (8 caractères), affichée côté client : elle prouve l'origine. */
function empreinte() {
  return crypto.createHash('sha256').update(clePubliqueB64()).digest('hex').slice(0, 8).toUpperCase();
}

/**
 * Signe une licence.
 *
 * @param {{client:string, debut:string, fin:string, grace?:number, install?:string}} charge
 * @returns {string} le jeton complet
 */
function signer(charge) {
  const propre = {
    client: String(charge.client || '').slice(0, 120),
    debut: String(charge.debut || '').slice(0, 10),
    fin: String(charge.fin || '').slice(0, 10),
  };
  if (Number.isFinite(charge.grace)) propre.grace = Math.max(0, Math.min(365, Number(charge.grace)));
  // Liaison à une installation : facultative. En hébergement chez nous, chaque
  // société a son instance, et c'est nous qui posons la licence — la liaison
  // n'apporte rien de plus et compliquerait un déplacement de machine.
  if (charge.install) propre.install = String(charge.install).slice(0, 64);

  const chargeB64 = b64url(JSON.stringify(propre));
  const signature = crypto.sign(null, Buffer.from(`${PREFIXE}.${chargeB64}`, 'utf8'), clePrivee());
  return `${PREFIXE}.${chargeB64}.${b64url(signature)}`;
}

/** Relit un jeton (sans vérifier la signature) — pour réafficher une licence existante. */
function lire(jeton) {
  const parts = String(jeton || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== PREFIXE) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

module.exports = { signer, lire, clePubliqueB64, empreinte, PREFIXE, FICHIER_CLE };
