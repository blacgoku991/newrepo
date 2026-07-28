'use strict';

/**
 * Logos des sociétés clientes.
 *
 * Un fichier envoyé par un opérateur et RESERVI par le panel est une porte
 * d'entrée classique : on ne se fie donc ni à l'extension, ni au type déclaré,
 * mais aux octets eux-mêmes.
 *
 * - SVG REFUSÉ : c'est du XML qui peut porter du script, exécuté dans notre
 *   origine si le navigateur l'affiche. Aucun bénéfice qui vaille ce risque.
 * - Le nom de fichier n'est jamais celui de l'expéditeur : il est reconstruit à
 *   partir de l'identifiant numérique de la société (aucune traversée possible).
 * - Servi avec `nosniff` et un type explicite, pour qu'un navigateur ne
 *   réinterprète pas le contenu.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DOSSIER = path.join(process.env.SMARTFIXX_DIR || path.join(os.homedir(), '.smartfixx'), 'logos');
fs.mkdirSync(DOSSIER, { recursive: true, mode: 0o700 });

const TAILLE_MAX = 512 * 1024; // 512 ko : un logo n'a aucune raison d'être plus lourd

/** Reconnaît le format par ses octets d'en-tête, pas par ce qu'on nous annonce. */
function formatReel(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.subarray(1, 4).toString('ascii') === 'PNG') {
    return { ext: 'png', type: 'image/png' };
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', type: 'image/jpeg' };
  }
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF'
      && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { ext: 'webp', type: 'image/webp' };
  }
  return null;
}

/**
 * Enregistre un logo transmis en data URI.
 * @returns {{ext:string, type:string, taille:number}}
 * @throws {Error} message destiné à l'opérateur
 */
function enregistrer(societeId, dataUri) {
  const m = /^data:([\w/+.-]+);base64,([\s\S]+)$/.exec(String(dataUri || '').trim());
  if (!m) throw new Error('Image illisible.');
  const brut = Buffer.from(m[2], 'base64');
  if (!brut.length) throw new Error('Image vide.');
  if (brut.length > TAILLE_MAX) {
    throw new Error(`Image trop lourde (${Math.round(brut.length / 1024)} ko). Maximum 512 ko.`);
  }
  const format = formatReel(brut);
  if (!format) {
    throw new Error('Format non accepté. Utilisez un PNG, un JPEG ou un WebP (le SVG est refusé pour des raisons de sécurité).');
  }
  supprimer(societeId); // une seule image par société, quel que soit l'ancien format
  const fichier = path.join(DOSSIER, `${Number(societeId)}.${format.ext}`);
  fs.writeFileSync(fichier, brut, { mode: 0o600 });
  return { ...format, taille: brut.length };
}

/** Chemin et type du logo d'une société, ou `null`. */
function trouver(societeId) {
  for (const ext of ['png', 'jpg', 'webp']) {
    const fichier = path.join(DOSSIER, `${Number(societeId)}.${ext}`);
    if (fs.existsSync(fichier)) {
      return { fichier, type: ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp' };
    }
  }
  return null;
}

function supprimer(societeId) {
  for (const ext of ['png', 'jpg', 'webp']) {
    const fichier = path.join(DOSSIER, `${Number(societeId)}.${ext}`);
    try { fs.unlinkSync(fichier); } catch { /* absent */ }
  }
}

module.exports = { enregistrer, trouver, supprimer, DOSSIER, TAILLE_MAX };
