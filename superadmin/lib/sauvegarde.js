'use strict';

/**
 * Sauvegarde du parc.
 *
 * Sans elle, la perte du serveur emporte tout : la clé qui signe les licences,
 * le registre des clients, et les bases de chaque société. Rien n'est
 * reconstituable.
 *
 * Deux choix qui comptent :
 *
 *  - `VACUUM INTO` plutôt qu'une copie de fichier. Copier un SQLite pendant
 *    qu'un portail écrit dedans produit une base tronquée, qui s'ouvre sans
 *    erreur mais qu'il manque les dernières transactions. `VACUUM INTO` prend
 *    une image cohérente sans interrompre le service.
 *
 *  - La clé privée est incluse. Une sauvegarde sans elle laisserait un parc
 *    restauré incapable d'émettre la moindre licence. Le dossier est donc en
 *    permissions 0700, et il DOIT être recopié hors de cette machine.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const db = require('./db');
const orchestrateur = require('./orchestrateur');

const DOSSIER = process.env.SMARTFIXX_DIR || path.join(os.homedir(), '.smartfixx');
const CIBLE = process.env.SMARTFIXX_SAUVEGARDES || path.join(DOSSIER, 'sauvegardes');
const GARDER = Math.max(1, Number(process.env.SMARTFIXX_SAUVEGARDES_GARDEES || 14));
const HEURE = Math.min(23, Math.max(0, Number(process.env.SMARTFIXX_SAUVEGARDE_HEURE || 3)));

const horodatage = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

/** Image cohérente d'une base, sans interrompre le portail qui l'utilise. */
function copierBase(source, destination) {
  // Connexion en LECTURE-ÉCRITURE : SQLite refuse `VACUUM INTO` sur une
  // connexion ouverte en lecture seule. L'opération ne modifie pas la source —
  // elle écrit une image dans le fichier de destination.
  const conn = new Database(source, { fileMustExist: true });
  try {
    // Chaîne SQL entre APOSTROPHES : des guillemets doubles seraient compris
    // comme un nom de colonne, et la sauvegarde échouerait sans rien copier.
    conn.exec(`VACUUM INTO '${String(destination).replace(/'/g, "''")}'`);
  } finally {
    conn.close();
  }
}

/**
 * Exécute une sauvegarde complète.
 * @returns {{dossier:string, elements:string[], erreurs:string[], octets:number}}
 */
function executer(par = 'automatique') {
  fs.mkdirSync(CIBLE, { recursive: true, mode: 0o700 });
  const dossier = path.join(CIBLE, horodatage());
  fs.mkdirSync(dossier, { mode: 0o700 });

  const elements = [];
  const erreurs = [];

  // 1. Registre du parc : sociétés, licences, réglages chiffrés, journal.
  try {
    copierBase(db.FICHIER, path.join(dossier, 'smartfixx.db'));
    elements.push('registre du parc');
  } catch (e) {
    erreurs.push(`registre : ${e.message}`);
  }

  // 2. Clé de signature et clé de chiffrement des réglages.
  for (const [fichier, nom] of [['cle-privee.pem', 'clé de signature'], ['secret.key', 'clé des réglages']]) {
    const src = path.join(DOSSIER, fichier);
    if (!fs.existsSync(src)) continue;
    try {
      fs.copyFileSync(src, path.join(dossier, fichier));
      fs.chmodSync(path.join(dossier, fichier), 0o600);
      elements.push(nom);
    } catch (e) {
      erreurs.push(`${nom} : ${e.message}`);
    }
  }

  // 3. Une base par société, plus ses logos et son fichier de réglages local.
  const instances = path.join(dossier, 'instances');
  for (const s of db.vue()) {
    if (!s.sousDomaine) continue;
    const source = path.join(orchestrateur.INSTANCES, s.sousDomaine);
    const base = path.join(source, 'portail.db');
    if (!fs.existsSync(base)) continue;
    const dest = path.join(instances, s.sousDomaine);
    fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
    try {
      copierBase(base, path.join(dest, 'portail.db'));
      elements.push(s.nom);
    } catch (e) {
      erreurs.push(`${s.nom} : ${e.message}`);
    }
    for (const annexe of ['.env', 'secret.key']) {
      const a = path.join(source, annexe);
      if (fs.existsSync(a)) {
        try { fs.copyFileSync(a, path.join(dest, annexe)); fs.chmodSync(path.join(dest, annexe), 0o600); }
        catch { /* annexe absente ou illisible : la base reste l'essentiel */ }
      }
    }
  }

  // Les captures d'écran des robots ne sont PAS sauvegardées : elles contiennent
  // des données de santé, elles sont volumineuses, et elles n'ont aucune valeur
  // au-delà du diagnostic immédiat d'un échec.

  const octets = taille(dossier);
  fs.writeFileSync(path.join(dossier, 'INVENTAIRE.txt'),
    `Sauvegarde Smartfixx du ${new Date().toLocaleString('fr-FR')}\n`
    + `Déclenchée par : ${par}\n\n`
    + `Contenu :\n${elements.map((e) => `  - ${e}`).join('\n')}\n`
    + (erreurs.length ? `\nErreurs :\n${erreurs.map((e) => `  ! ${e}`).join('\n')}\n` : '')
    + '\nCe dossier contient les clés du parc et les données de vos clients.\n'
    + 'Recopiez-le hors de cette machine, et gardez-le chiffré.\n',
    { mode: 0o600 });

  purger();
  db.tracer(par, 'sauvegarde', '', `${elements.length} élément(s), ${Math.round(octets / 1024)} ko`
    + (erreurs.length ? ` — ${erreurs.length} erreur(s)` : ''), '');
  return { dossier, elements, erreurs, octets };
}

function taille(dossier) {
  let total = 0;
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const p = path.join(dossier, e.name);
    total += e.isDirectory() ? taille(p) : fs.statSync(p).size;
  }
  return total;
}

/** Ne garde que les N dernières : un disque plein arrête tous les portails. */
function purger() {
  const anciennes = liste();
  for (const s of anciennes.slice(GARDER)) {
    try { fs.rmSync(path.join(CIBLE, s.nom), { recursive: true, force: true }); } catch { /* déjà partie */ }
  }
}

/** Sauvegardes présentes, de la plus récente à la plus ancienne. */
function liste() {
  if (!fs.existsSync(CIBLE)) return [];
  return fs.readdirSync(CIBLE, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const p = path.join(CIBLE, e.name);
      return { nom: e.name, date: fs.statSync(p).mtime.toISOString(), octets: taille(p) };
    })
    .sort((a, b) => b.nom.localeCompare(a.nom));
}

/**
 * Programme une sauvegarde quotidienne.
 * Une première est faite au démarrage s'il n'en existe aucune : un parc sans
 * la moindre sauvegarde ne doit pas attendre la nuit.
 */
function programmer() {
  if (!liste().length) {
    try { executer('démarrage'); } catch (e) { console.warn(`[sauvegarde] échec initial : ${e.message}`); }
  }
  const prochaine = () => {
    const d = new Date();
    d.setHours(HEURE, 0, 0, 0);
    if (d <= new Date()) d.setDate(d.getDate() + 1);
    return d - new Date();
  };
  const poser = () => setTimeout(() => {
    try {
      const r = executer('automatique');
      console.log(`[sauvegarde] ${r.elements.length} élément(s) — ${path.basename(r.dossier)}`);
    } catch (e) {
      console.warn(`[sauvegarde] échec : ${e.message}`);
    }
    poser();
  }, prochaine()).unref();
  poser();
  console.log(`[sauvegarde] quotidienne à ${String(HEURE).padStart(2, '0')} h, ${GARDER} conservées — ${CIBLE}`);
}

module.exports = { executer, liste, programmer, CIBLE, GARDER };
