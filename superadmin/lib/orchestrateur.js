'use strict';

/**
 * Orchestrateur : un processus de portail par société cliente.
 *
 * Un seul programme à lancer (`npm start`). Il tient le panel ET démarre, pour
 * chaque société active munie d'une licence, une instance du portail avec sa
 * PROPRE base de données.
 *
 * Pourquoi des processus séparés plutôt qu'une base commune : le cloisonnement
 * est alors une propriété de l'architecture, pas une clause `WHERE` qu'on peut
 * oublier une fois. Avec des données de santé, cette garantie vaut le coût de
 * quelques processus Node.
 *
 * Chaque instance écoute en local sur un port qui lui est réservé ; personne ne
 * l'atteint directement, tout passe par le routage par sous-domaine.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { fork } = require('child_process');

const db = require('./db');
const signature = require('./signature');

const RACINE = path.join(__dirname, '..', '..');
const DOSSIER = process.env.SMARTFIXX_DIR || path.join(os.homedir(), '.smartfixx');
const INSTANCES = path.join(DOSSIER, 'instances');
const PORT_BASE = Number(process.env.SMARTFIXX_PORT_BASE || 3100);

fs.mkdirSync(INSTANCES, { recursive: true, mode: 0o700 });

/** État en mémoire : sous-domaine -> { processus, port, societeId, depuis, redemarrages } */
const enMarche = new Map();

const journal = (msg) => console.log(`[orchestrateur] ${msg}`);

/**
 * Port réservé à une société. Fixé une fois pour toutes et mémorisé en base :
 * un port qui change à chaque redémarrage compliquerait tout diagnostic.
 */
function portDe(societe) {
  if (societe.instance_port) return societe.instance_port;
  const pris = new Set(db.vue().map((s) => s.instancePort).filter(Boolean));
  let port = PORT_BASE;
  while (pris.has(port)) port += 1;
  db.majSociete(societe.id, {
    nom: societe.nom,
    contactNom: societe.contact_nom,
    contactEmail: societe.contact_email,
    notes: societe.notes,
    instanceUrl: societe.instance_url,
    instancePort: port,
  });
  return port;
}

/** Dossier de données d'une société — isolé, permissions restreintes. */
function dossierDe(sousDomaine) {
  const d = path.join(INSTANCES, sousDomaine);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

/**
 * Gabarit du fichier de réglages d'une société.
 *
 * Il est écrit une seule fois, à la création de l'instance, et jamais réécrit :
 * on n'écrase pas ce que l'exploitant a saisi.
 *
 * PORT, DATA_DIR, la licence et le nom de la société sont posés par
 * l'orchestrateur : les mettre ici n'aurait aucun effet.
 */
const GABARIT_ENV = `# ---------------------------------------------------------------------------
# Réglages de cette société.
#
# Ce fichier ne quitte jamais ce dossier : ces secrets ne transitent pas par le
# panel et ne figurent pas dans son registre.
#
# Après toute modification : « Redémarrer » depuis le panel.
# ---------------------------------------------------------------------------

# --- Administrateur du portail de cette société ----------------------------
# Compte local (https://<sous-domaine>/admin.html). Créé au premier démarrage.
# Sans mot de passe ici, un aléatoire est tiré et affiché une seule fois dans
# le journal du serveur.
ADMIN_USERNAME=admin
ADMIN_PASSWORD=
ADMIN_DISPLAY_NAME=Administrateur

# --- Connexion Microsoft 365 des référents ---------------------------------
# Inscription à faire dans l'Entra ID DE LA SOCIÉTÉ (Applications > Nouvelle
# inscription). L'URL de retour à y déclarer est exactement :
#   https://<sous-domaine>.smartfixx.fr/auth/sso/callback
M365_TENANT_ID=
M365_CLIENT_ID=
M365_CLIENT_SECRET=

# Tant que ces trois valeurs sont vides, le portail reste OUVERT : à ne laisser
# ainsi qu'en recette, jamais avec de vraies données.
SSO_REQUIRED=true

# Qui entre : tenant (toute l'organisation) | attribut | liste (référents déclarés)
ACCES_PORTAIL=tenant
# En mode « attribut », la règle à satisfaire. Ex. : extensionAttribute1=REFERENT
ACCES_ATTRIBUT=

# --- BlueKanGo -------------------------------------------------------------
# Compte de service du robot. Il n'a pas à être un compte nominatif.
BLUEKANGO_URL=
BLUEKANGO_ADMIN_USER=
BLUEKANGO_ADMIN_PASSWORD=
# Mot de passe posé sur les comptes créés, à changer à la première connexion.
BLUEKANGO_DEFAULT_PASSWORD=

# --- NetSoins --------------------------------------------------------------
NETSOINS_URL=
NETSOINS_ADMIN_USER=
NETSOINS_ADMIN_PASSWORD=
NETSOINS_DEFAULT_PASSWORD=

# Applications réellement proposées à cette société.
APPS_ACTIVES=bluekango,netsoins

# --- Envoi des e-mails d'identifiants --------------------------------------
# Sans SMTP, les e-mails sont préparés et visibles dans l'admin, mais pas
# envoyés : rien n'est perdu, tout est rattrapable.
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

# --- Robot -----------------------------------------------------------------
# production : agit sur les vraies applications. demo : console intégrée.
AUTOMATION_MODE=production
# Demandes traitées en même temps. Une seule par application : les robots
# partagent le même compte de service, deux sessions se gêneraient.
WORKER_PARALLELE=3

# --- Tableau de bord de valeur ---------------------------------------------
# Coût horaire chargé servant à convertir le temps gagné en euros.
TAUX_HORAIRE=28
`;

/**
 * Réglages propres à une société (identifiants BlueKanGo/NetSoins, SSO…).
 *
 * Ils vivent dans un fichier `.env` de son dossier, jamais dans le registre :
 * ces secrets n'ont pas à traverser le panel ni à figurer dans sa base.
 */
function environnementDe(dossier) {
  const fichier = path.join(dossier, '.env');
  if (!fs.existsSync(fichier)) {
    fs.writeFileSync(fichier, GABARIT_ENV, { mode: 0o600 });
    return {};
  }
  const out = {};
  for (const ligne of fs.readFileSync(fichier, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(ligne);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Licence courante d'une société (jeton signé), ou `null`. */
function licenceDe(societeId) {
  const courante = db.licences(societeId).find((l) => !l.revoquee_le);
  return courante ? courante.jeton : null;
}

/**
 * Démarre l'instance d'une société. Sans effet si elle tourne déjà.
 * @returns {{ok:boolean, raison?:string, port?:number}}
 */
function demarrer(societeId) {
  const s = db.societe(societeId);
  if (!s) return { ok: false, raison: 'Société introuvable' };
  if (s.archivee) return { ok: false, raison: 'Société archivée' };
  const sd = s.sous_domaine;
  if (!sd) return { ok: false, raison: 'Aucun sous-domaine défini' };
  if (enMarche.has(sd)) return { ok: true, port: enMarche.get(sd).port };

  const licence = licenceDe(s.id);
  if (!licence) return { ok: false, raison: 'Aucune licence valable : émettez-en une d’abord' };

  const port = portDe(s);
  const dossier = dossierDe(sd);
  const enfant = fork(path.join(RACINE, 'src', 'server.js'), [], {
    cwd: RACINE,
    env: {
      ...process.env,
      ...environnementDe(dossier),
      DATA_DIR: dossier,
      PORT: String(port),
      // L'instance n'écoute qu'en local : elle n'est joignable que par le
      // routage de ce processus, jamais depuis l'extérieur.
      HOST: '127.0.0.1',
      LICENCE_JETON: licence,
      // La clé qui vérifie la licence est celle de CE panel : plus besoin de
      // la recopier dans le code, et une instance ne peut pas accepter une
      // licence signée par quelqu'un d'autre.
      LICENCE_CLE_PUBLIQUE: signature.clePubliqueB64(),
      SOCIETE_NOM: s.nom,
      SOCIETE_LOGO_DIR: path.join(dossier, 'marque'),
      EDITEUR_NOM: process.env.EDITEUR_NOM || 'Smartfixx',
      PUBLIC_BASE_URL: s.instance_url || '',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  const fiche = { processus: enfant, port, societeId: s.id, depuis: Date.now(), redemarrages: 0, sousDomaine: sd };
  enMarche.set(sd, fiche);

  const prefixe = `[${sd}]`;
  enfant.stdout.on('data', (d) => process.stdout.write(`${prefixe} ${d}`));
  enfant.stderr.on('data', (d) => process.stderr.write(`${prefixe} ${d}`));
  enfant.on('exit', (code, signal) => {
    enMarche.delete(sd);
    journal(`${sd} arrêtée (code ${code}${signal ? `, signal ${signal}` : ''})`);
    // Redémarrage automatique en cas de plantage, mais pas d'un arrêt demandé.
    if (!fiche.arretDemande && code !== 0) {
      const attente = Math.min(30000, 2000 * (fiche.redemarrages + 1));
      journal(`${sd} redémarrera dans ${attente / 1000} s`);
      setTimeout(() => {
        const r = demarrer(societeId);
        if (r.ok && enMarche.get(sd)) enMarche.get(sd).redemarrages = fiche.redemarrages + 1;
      }, attente).unref();
    }
  });

  journal(`${sd} démarrée sur le port ${port}`);
  return { ok: true, port };
}

/** Arrête l'instance d'une société. */
function arreter(sousDomaine) {
  const fiche = enMarche.get(sousDomaine);
  if (!fiche) return { ok: false, raison: 'Instance déjà arrêtée' };
  fiche.arretDemande = true;
  fiche.processus.kill('SIGTERM');
  // Le portail ferme proprement ses demandes en cours ; au-delà, on insiste.
  setTimeout(() => { try { fiche.processus.kill('SIGKILL'); } catch { /* déjà partie */ } }, 15000).unref();
  return { ok: true };
}

/** Redémarre (après renouvellement de licence ou changement de réglages). */
function redemarrer(societeId) {
  const s = db.societe(societeId);
  if (!s || !s.sous_domaine) return { ok: false, raison: 'Société introuvable' };
  if (enMarche.has(s.sous_domaine)) {
    arreter(s.sous_domaine);
    // On laisse le port se libérer avant de relancer.
    return new Promise((resolve) => setTimeout(() => resolve(demarrer(societeId)), 1500));
  }
  return demarrer(societeId);
}

/** Port d'écoute d'un sous-domaine, ou `null` s'il ne tourne pas. */
function portPour(sousDomaine) {
  const f = enMarche.get(sousDomaine);
  return f ? f.port : null;
}

function etat() {
  const out = {};
  for (const [sd, f] of enMarche) {
    out[sd] = { port: f.port, depuis: f.depuis, redemarrages: f.redemarrages, societeId: f.societeId };
  }
  return out;
}

/** Démarre toutes les sociétés actives disposant d'une licence. */
function demarrerTout() {
  const resultats = [];
  for (const s of db.vue()) {
    if (s.archivee || !s.sousDomaine) continue;
    const r = demarrer(s.id);
    resultats.push({ societe: s.nom, sousDomaine: s.sousDomaine, ...r });
    if (!r.ok) journal(`${s.nom} non démarrée — ${r.raison}`);
  }
  return resultats;
}

/** Arrêt propre de tout le parc (extinction du serveur). */
function arreterTout() {
  for (const sd of [...enMarche.keys()]) arreter(sd);
}

module.exports = {
  demarrer, arreter, redemarrer, demarrerTout, arreterTout,
  portPour, etat, INSTANCES, dossierDe,
};
