'use strict';

/**
 * Double authentification par code temporaire (TOTP, RFC 6238).
 *
 * Compatible avec Microsoft Authenticator, Google Authenticator, FreeOTP…
 * Implémenté avec `node:crypto` seul : ajouter une dépendance pour cent lignes
 * d'algorithme documenté serait un risque de chaîne d'approvisionnement mal
 * placé sur la brique qui protège l'administration.
 *
 * Choix imposés par les applications d'authentification courantes, qui ne
 * savent pas toutes lire les paramètres de l'URI : SHA-1, 6 chiffres, pas de
 * 30 secondes. SHA-1 est ici employé en HMAC — son affaiblissement face aux
 * collisions ne remet pas en cause cet usage.
 */

const crypto = require('crypto');

const PAS_SECONDES = 30;
const CHIFFRES = 6;
// Tolérance d'un pas de part et d'autre : l'horloge du téléphone dérive, et un
// code saisi à cheval sur deux fenêtres doit passer. Au-delà, on élargirait
// inutilement la fenêtre d'attaque.
const TOLERANCE = 1;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encode des octets en base32 (sans remplissage) — format attendu par les applications. */
function versBase32(buf) {
  let bits = 0;
  let valeur = 0;
  let sortie = '';
  for (const octet of buf) {
    valeur = (valeur << 8) | octet;
    bits += 8;
    while (bits >= 5) {
      sortie += ALPHABET[(valeur >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) sortie += ALPHABET[(valeur << (5 - bits)) & 31];
  return sortie;
}

/** Décode une base32 en octets. Tolère espaces, minuscules et remplissage. */
function depuisBase32(texte) {
  const propre = String(texte || '').toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  let bits = 0;
  let valeur = 0;
  const octets = [];
  for (const c of propre) {
    const i = ALPHABET.indexOf(c);
    if (i === -1) throw new Error('Secret invalide');
    valeur = (valeur << 5) | i;
    bits += 5;
    if (bits >= 8) {
      octets.push((valeur >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(octets);
}

/** Nouveau secret partagé (160 bits, la taille recommandée par la RFC 4226). */
function genererSecret() {
  return versBase32(crypto.randomBytes(20));
}

/** Code à `pas` donné (numéro de fenêtre de 30 s depuis l'époque Unix). */
function codePour(secret, pas) {
  const cle = depuisBase32(secret);
  const compteur = Buffer.alloc(8);
  // Écriture 64 bits en gros-boutiste ; `writeBigUInt64BE` évite la perte de
  // précision au-delà de 2^53.
  compteur.writeBigUInt64BE(BigInt(pas));
  const hmac = crypto.createHmac('sha1', cle).update(compteur).digest();
  // Troncature dynamique (RFC 4226 §5.3).
  const debut = hmac[hmac.length - 1] & 0x0f;
  const binaire =
    ((hmac[debut] & 0x7f) << 24) |
    ((hmac[debut + 1] & 0xff) << 16) |
    ((hmac[debut + 2] & 0xff) << 8) |
    (hmac[debut + 3] & 0xff);
  return String(binaire % 10 ** CHIFFRES).padStart(CHIFFRES, '0');
}

/** Pas courant. */
function pasActuel(maintenant = Date.now()) {
  return Math.floor(maintenant / 1000 / PAS_SECONDES);
}

/**
 * Vérifie un code.
 *
 * Renvoie le pas retenu (pour que l'appelant le mémorise et refuse un rejeu),
 * ou `null`. La comparaison est à temps constant : comparer six chiffres avec
 * `===` laisse fuiter, par le temps de réponse, combien de caractères sont
 * bons.
 */
function verifie(secret, code, { maintenant = Date.now(), pasMinimum = -1 } = {}) {
  const saisi = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(saisi)) return null;
  const courant = pasActuel(maintenant);
  for (let d = -TOLERANCE; d <= TOLERANCE; d++) {
    const pas = courant + d;
    // Rejeu : un code déjà employé ne vaut plus, même dans sa fenêtre.
    if (pas <= pasMinimum) continue;
    const attendu = codePour(secret, pas);
    const a = Buffer.from(attendu);
    const b = Buffer.from(saisi);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return pas;
  }
  return null;
}

/**
 * URI à enregistrer dans l'application d'authentification.
 * L'émetteur apparaît dans la liste des comptes du téléphone.
 */
function uriOtpauth(secret, compte, emetteur = 'Algonis') {
  const e = encodeURIComponent(emetteur);
  const c = encodeURIComponent(compte || 'administrateur');
  return `otpauth://totp/${e}:${c}?secret=${secret}&issuer=${e}&algorithm=SHA1&digits=${CHIFFRES}&period=${PAS_SECONDES}`;
}

/** Secret présenté par groupes de quatre : la saisie à la main est moins pénible. */
function secretLisible(secret) {
  return String(secret).replace(/(.{4})/g, '$1 ').trim();
}

// --- Codes de secours --------------------------------------------------------

/**
 * Codes à usage unique, remis une seule fois à la création.
 *
 * Ils sont stockés HACHÉS : une base volée ne doit pas donner de quoi passer la
 * double authentification. Un simple SHA-256 suffit ici, contrairement à un mot
 * de passe : ce sont 40 bits d'aléa, hors de portée d'une attaque par
 * dictionnaire.
 */
function genererCodesSecours(nombre = 8) {
  const codes = [];
  for (let i = 0; i < nombre; i++) {
    const brut = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 caractères
    codes.push(`${brut.slice(0, 5)}-${brut.slice(5)}`);
  }
  return codes;
}

function hacherCodeSecours(code) {
  const propre = String(code || '').toUpperCase().replace(/[\s-]/g, '');
  return crypto.createHash('sha256').update(propre).digest('hex');
}

module.exports = {
  genererSecret,
  codePour,
  pasActuel,
  verifie,
  uriOtpauth,
  secretLisible,
  genererCodesSecours,
  hacherCodeSecours,
  PAS_SECONDES,
  versBase32,
  depuisBase32,
};
