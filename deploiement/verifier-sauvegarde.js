'use strict';

/**
 * Vérifie qu'une sauvegarde restaurée est réellement exploitable.
 *
 * Appelé par `restaurer.sh --essai`. On lit les bases avec le même moteur que
 * le portail — `better-sqlite3`, déjà installé — plutôt qu'avec l'outil
 * `sqlite3` en ligne de commande : un serveur qui fait tourner Smartfixx a
 * forcément le premier, pas forcément le second, et une vérification qui ne
 * s'exécute pas ne vérifie rien.
 *
 *   node verifier-sauvegarde.js <dossier>
 *
 * Sortie : une ligne par élément, code 0 si la sauvegarde suffit à repartir.
 */

const fs = require('fs');
const path = require('path');

const VERT = '\x1b[32m';
const ROUGE = '\x1b[31m';
const GRIS = '\x1b[90m';
const FIN = '\x1b[0m';

const dossier = process.argv[2];
if (!dossier || !fs.existsSync(dossier)) {
  console.error('Usage : node verifier-sauvegarde.js <dossier de sauvegarde>');
  process.exit(2);
}

let Database;
try {
  Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));
} catch {
  try { Database = require('better-sqlite3'); } catch {
    console.error(`${ROUGE}better-sqlite3 introuvable : lancez ce script depuis l'installation Smartfixx.${FIN}`);
    process.exit(2);
  }
}

let echecs = 0;
const ok = (m) => console.log(`  ${VERT}✓${FIN} ${m}`);
const ko = (m) => { console.log(`  ${ROUGE}✗${FIN} ${m}`); echecs += 1; };

/** Ouvre une base et compte ce qu'elle contient. Une base tronquée s'ouvre parfois sans erreur. */
function verifier(fichier, tables, etiquette) {
  let conn;
  try {
    conn = new Database(fichier, { readonly: true, fileMustExist: true });
    // `integrity_check` détecte une image tronquée là où un simple SELECT
    // réussirait : c'est le cas d'une copie faite pendant une écriture.
    const integrite = conn.pragma('integrity_check', { simple: true });
    if (integrite !== 'ok') return ko(`${etiquette} : base corrompue (${integrite})`);
    const comptes = tables.map((t) => {
      const n = conn.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
      return `${n} ${t}`;
    });
    ok(`${etiquette} — ${comptes.join(', ')}`);
  } catch (e) {
    ko(`${etiquette} : illisible (${e.message})`);
  } finally {
    try { if (conn) conn.close(); } catch { /* déjà fermée */ }
  }
}

console.log(`\n${GRIS}Contenu de ${dossier}${FIN}\n`);

const registre = path.join(dossier, 'smartfixx.db');
if (fs.existsSync(registre)) verifier(registre, ['societes', 'licences'], 'registre du parc');
else ko('registre du parc absent : impossible de savoir qui sont les clients');

const instances = path.join(dossier, 'instances');
let portails = 0;
if (fs.existsSync(instances)) {
  for (const sd of fs.readdirSync(instances)) {
    const base = path.join(instances, sd, 'portail.db');
    if (!fs.existsSync(base)) continue;
    portails += 1;
    verifier(base, ['requests', 'referents', 'created_accounts'], `portail « ${sd} »`);
  }
}
if (!portails) console.log(`  ${GRIS}aucun portail client dans cette sauvegarde${FIN}`);

if (fs.existsSync(path.join(dossier, 'cle-privee.pem'))) {
  ok('clé de signature présente');
} else {
  ko('clé de signature ABSENTE : aucune licence ne pourra être réémise, pour aucun client');
}
if (fs.existsSync(path.join(dossier, 'secret.key'))) {
  ok('clé des réglages présente');
} else {
  console.log(`  ${GRIS}○ clé des réglages absente : les réglages chiffrés seront à ressaisir${FIN}`);
}

console.log('');
if (echecs) {
  console.log(`${ROUGE}${echecs} problème(s) : cette sauvegarde ne suffirait PAS à repartir.${FIN}\n`);
  process.exit(1);
}
console.log(`${VERT}Cette sauvegarde est exploitable.${FIN}\n`);
