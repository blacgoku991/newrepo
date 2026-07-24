'use strict';

/**
 * Import des comptes NetSoins depuis un (ou plusieurs) export(s) « Intervenants ».
 *
 * Usage :
 *   node scripts/import-netsoins.js <export1.xlsx> [export2.xlsx ...]
 *   node scripts/import-netsoins.js <dossier>          (importe tous les .xlsx du dossier)
 *
 * On ne conserve que des champs MINIMAUX (RGPD) : identifiant (login), nom,
 * prénom, e-mail professionnel, établissement de rattachement, profil de droit,
 * état actif. Tout le reste de l'export (adresse postale, téléphones personnels,
 * nom de naissance, MSSanté, etc.) est IGNORÉ et jamais stocké.
 *
 * Les comptes sont insérés/actualisés dans le registre (clé app_id+login) : ré-
 * importer un export plus récent met simplement à jour les comptes existants.
 */

const fs = require('fs');
const path = require('path');
const { readRows } = require('../src/xlsxLite');
const db = require('../src/db');
const { ETABLISSEMENTS } = require('../src/apps/netsoins/data');

const APP_ID = 'netsoins';

// Normalisation pour rapprocher le libellé d'établissement de l'export de nos ID.
const norm = (s) =>
  String(s || '')
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

// Index : libellé normalisé -> value (ID interne NetSoins).
const ETAB_INDEX = ETABLISSEMENTS.map((e) => ({ value: e.value, key: norm(e.label) }));

/** Rapproche « ADEF RESIDENCES - EHPAD - La Maison … - 58600 … » d'un ID. */
function matchEtablissement(cell) {
  const u = norm(cell);
  if (!u) return null;
  // Le libellé de l'export se termine par notre libellé exact.
  const hit = ETAB_INDEX.find((e) => e.key && u.endsWith(e.key));
  return hit ? hit.value : null;
}

/** Construit un index en-tête -> lettre de colonne à partir de la 1re ligne. */
function headerIndex(headerRow) {
  const idx = {};
  for (const [col, val] of Object.entries(headerRow)) idx[norm(val)] = col;
  return idx;
}

function pick(row, idx, headerLabel) {
  const col = idx[norm(headerLabel)];
  return col ? (row[col] || '').trim() : '';
}

function collectFiles(args) {
  const files = [];
  for (const a of args) {
    const st = fs.existsSync(a) ? fs.statSync(a) : null;
    if (!st) { console.error(`Chemin introuvable : ${a}`); continue; }
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(a)) {
        if (/\.xlsx$/i.test(f)) files.push(path.join(a, f));
      }
    } else {
      files.push(a);
    }
  }
  return files;
}

function importFile(file, stats) {
  const rows = readRows(file);
  if (rows.length < 2) { console.log(`  (vide) ${path.basename(file)}`); return; }
  const idx = headerIndex(rows[0]);
  // Colonnes attendues (l'export peut réordonner : on mappe par nom d'en-tête).
  const need = ['Identifiant', 'Nom utilisé', 'Prénom utilisé', 'Mail', 'Établissements autorisés', 'Profil de droits', 'Actif'];
  const missing = need.filter((h) => !idx[norm(h)]);
  if (missing.length) {
    console.error(`  Colonnes manquantes dans ${path.basename(file)} : ${missing.join(', ')} — fichier ignoré`);
    return;
  }

  for (const row of rows.slice(1)) {
    const login = pick(row, idx, 'Identifiant');
    if (!login) { stats.skipped++; continue; }
    const etabValue = matchEtablissement(pick(row, idx, 'Établissements autorisés'));
    if (!etabValue) {
      const raw = pick(row, idx, 'Établissements autorisés') || '(vide)';
      stats.unmatched.set(raw, (stats.unmatched.get(raw) || 0) + 1);
    }
    const actifRaw = norm(pick(row, idx, 'Actif'));
    const outcome = db.upsertImportedAccount({
      appId: APP_ID,
      login,
      nom: pick(row, idx, 'Nom utilisé'),
      prenom: pick(row, idx, 'Prénom utilisé') || pick(row, idx, 'Premier prénom'),
      email: pick(row, idx, 'Mail'),
      etablissement: etabValue || '',
      profil: pick(row, idx, 'Profil de droits'),
      actif: actifRaw === 'oui' || actifRaw === '1' || actifRaw === 'actif' ? 1 : 0,
    });
    stats[outcome]++;
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage : node scripts/import-netsoins.js <export.xlsx | dossier> [...]');
    process.exit(1);
  }
  const files = collectFiles(args);
  if (files.length === 0) { console.error('Aucun fichier .xlsx à importer.'); process.exit(1); }

  const stats = { inserted: 0, updated: 0, skipped: 0, unmatched: new Map() };
  for (const file of files) {
    console.log(`Import : ${path.basename(file)}`);
    importFile(file, stats);
  }

  try {
    db.audit('script', 'import_comptes_netsoins', 'netsoins', `${stats.inserted} ajoutés, ${stats.updated} mis à jour`);
  } catch { /* l'audit ne doit pas faire échouer l'import */ }

  console.log('\n──────── Récapitulatif ────────');
  console.log(`Comptes ajoutés   : ${stats.inserted}`);
  console.log(`Comptes mis à jour: ${stats.updated}`);
  console.log(`Lignes ignorées   : ${stats.skipped} (sans identifiant)`);
  console.log(`Total en base (NetSoins importés) : ${db.countImportedAccounts(APP_ID)}`);
  if (stats.unmatched.size) {
    console.log(`\n⚠ Établissements non reconnus (compte importé sans rattachement) :`);
    for (const [k, v] of [...stats.unmatched.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`   ${v}×  ${k}`);
    }
    console.log('   → Ces comptes existent mais ne seront pas rattachés à un référent tant que');
    console.log('     l\'établissement n\'est pas reconnu (établissement ancien/hors liste).');
  }
}

main();
