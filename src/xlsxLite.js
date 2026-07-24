'use strict';

/**
 * Lecteur .xlsx minimal, SANS dépendance externe (uniquement `zlib` natif).
 *
 * Un .xlsx est une archive ZIP contenant du XML. On lit l'archive via son
 * « central directory », on décompresse les entrées utiles (sharedStrings.xml
 * et la première feuille), puis on extrait les cellules par expressions
 * régulières — suffisant pour un export tabulaire simple (pas de formules
 * complexes). Objectif : importer un export sans ajouter de dépendance npm.
 */

const fs = require('fs');
const zlib = require('zlib');

/** Décompresse toutes les entrées d'un ZIP -> Map(nom -> Buffer). */
function unzip(buf) {
  const files = new Map();
  // End Of Central Directory : signature 0x06054b50, cherchée depuis la fin.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Archive .xlsx invalide (EOCD introuvable)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // offset du central directory

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break; // signature entrée CD
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const fnLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + fnLen);

    // En-tête local : on recalcule le début des données (tailles fnLen/extraLen
    // du local header peuvent différer de celles du central directory).
    const lFnLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lFnLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    let content;
    if (method === 0) content = Buffer.from(raw); // stored
    else if (method === 8) content = zlib.inflateRawSync(raw); // deflate
    else throw new Error(`Compression ZIP non gérée (méthode ${method})`);
    files.set(name, content);

    p += 46 + fnLen + extraLen + commentLen;
  }
  return files;
}

function xmlDecode(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Table des chaînes partagées (sharedStrings.xml). */
function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    xmlDecode(m[1].replace(/<[^>]+>/g, ''))
  );
}

const colLetters = (ref) => (ref.match(/^[A-Z]+/) || [''])[0];

/**
 * Lit la première feuille d'un .xlsx.
 * @returns {Array<Object>} une ligne = { A: 'val', B: 'val', … } (colonnes par lettre)
 */
function readRows(path) {
  const files = unzip(fs.readFileSync(path));
  const strings = parseSharedStrings(files.get('xl/sharedStrings.xml'));
  // Première feuille (nom standard) ; repli sur la 1re feuille trouvée.
  let sheetBuf = files.get('xl/worksheets/sheet1.xml');
  if (!sheetBuf) {
    const key = [...files.keys()].find((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
    sheetBuf = key ? files.get(key) : null;
  }
  if (!sheetBuf) throw new Error('Feuille de calcul introuvable dans le .xlsx');
  const sheet = sheetBuf.toString('utf8');

  const rows = [];
  for (const rowM of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    // Gère les deux formes de cellule : « <c …>…</c> » et la cellule vide
    // auto-fermante « <c …/> » (sinon le contenu de la cellule suivante serait
    // capté par erreur, décalant toutes les colonnes).
    for (const c of rowM[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const inner = c[2] || '';
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
      if (!ref) continue;
      const type = (attrs.match(/t="(\w+)"/) || [])[1];
      let value = '';
      if (type === 's') {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        value = v !== undefined ? strings[Number(v)] || '' : '';
      } else if (type === 'inlineStr') {
        value = xmlDecode((inner.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '');
      } else {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        value = v !== undefined ? xmlDecode(v) : '';
      }
      cells[colLetters(ref)] = value;
    }
    // Ignore les lignes vides (aucune cellule non vide).
    if (Object.values(cells).some((v) => v !== '')) rows.push(cells);
  }
  return rows;
}

module.exports = { readRows };
