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
const reglages = require('./reglages');

const RACINE = path.join(__dirname, '..', '..');
const DOSSIER = process.env.SMARTFIXX_DIR || path.join(os.homedir(), '.smartfixx');
const INSTANCES = path.join(DOSSIER, 'instances');
const PORT_BASE = Number(process.env.SMARTFIXX_PORT_BASE || 3100);

fs.mkdirSync(INSTANCES, { recursive: true, mode: 0o700 });

/** État en mémoire : sous-domaine -> { processus, port, societeId, depuis, redemarrages } */
const enMarche = new Map();

const journal = (msg) => console.log(`[orchestrateur] ${msg}`);

/** Au-delà, un portail tombé repart d'un compteur neuf : ce n'est plus une boucle. */
const DUREE_STABLE_MS = 10 * 60 * 1000;

/* ---------------------------------------------------------------------------
   Dernières lignes de chaque portail — pour répondre, depuis le panel, à la
   seule question qu'on se pose vraiment quand un portail repart en boucle :
   qu'est-ce qu'il dit avant de tomber ?

   En mémoire uniquement : jamais écrit sur le disque, jamais sauvegardé. Et les
   adresses e-mail sont masquées avant d'être retenues — le panel n'a pas à
   connaître les salariés de ses clients, pas même par un message d'erreur.
   --------------------------------------------------------------------------- */
const LIGNES_GARDEES = 200;
const journaux = new Map();

/**
 * Une ligne qui n'est qu'un long jeton : c'est ainsi qu'un portail annonce le
 * mot de passe qu'il vient de générer pour son administrateur. Le retenir le
 * rendrait lisible depuis le panel — et un mot de passe affiché « une seule
 * fois » n'aurait plus rien d'une seule fois.
 */
const JETON_SEUL = /^\s*[A-Za-z0-9_\-+/=.]{12,}\s*$/;

/** Masque ce qui identifierait une personne, ou livrerait un secret. */
function anonymiser(ligne) {
  if (JETON_SEUL.test(ligne)) return '[secret masqué]';
  return ligne
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[adresse masquée]')
    // Suites de 9 chiffres ou plus : NIR, téléphones, identifiants internes.
    .replace(/\b\d{9,}\b/g, '[numéro masqué]')
    // « mot de passe : xxx », « password=xxx » — la valeur ne sert à personne ici.
    .replace(/((?:mot de passe|password|secret|token|jeton)\s*[:=]\s*)\S+/gi, '$1[masqué]');
}

function retenir(sousDomaine, donnees, erreur) {
  let tampon = journaux.get(sousDomaine);
  if (!tampon) { tampon = []; journaux.set(sousDomaine, tampon); }
  for (const ligne of String(donnees).split('\n')) {
    const t = ligne.trimEnd();
    if (!t) continue;
    tampon.push({ le: new Date().toISOString(), erreur: !!erreur, texte: anonymiser(t).slice(0, 500) });
  }
  if (tampon.length > LIGNES_GARDEES) tampon.splice(0, tampon.length - LIGNES_GARDEES);
}

/** Dernières lignes retenues pour un portail, de la plus ancienne à la plus récente. */
function journalDe(sousDomaine, limite = LIGNES_GARDEES) {
  const t = journaux.get(sousDomaine) || [];
  return t.slice(-Math.max(1, Math.min(LIGNES_GARDEES, limite)));
}

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
  // Redémarrer, c'est lever l'arrêt : le portail redevient éligible au réveil.
  arretsExplicites.delete(sd);
  if (enMarche.has(sd)) return { ok: true, port: enMarche.get(sd).port };

  const licence = licenceDe(s.id);
  if (!licence) return { ok: false, raison: 'Aucune licence valable : émettez-en une d’abord' };

  const port = portDe(s);
  const dossier = dossierDe(sd);
  const enfant = fork(path.join(RACINE, 'src', 'server.js'), [], {
    cwd: RACINE,
    env: {
      ...process.env,
      // Le fichier .env de la société reste pris en compte (installation
      // historique), mais les réglages saisis au panel l'emportent : c'est le
      // choix le plus récent, et le seul endroit où l'on veut avoir à revenir.
      ...environnementDe(dossier),
      ...reglages.environnement(s.id),
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
      // L'instance est TOUJOURS derrière ce processus : sans cela, elle voyait
      // toutes les requêtes venir de 127.0.0.1. Tous les visiteurs partageaient
      // alors le même compteur de limitation — une seule personne pouvait
      // bloquer la connexion de tout le monde — et le journal d'activité
      // n'enregistrait plus aucune adresse utile.
      TRUST_PROXY: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  const fiche = { processus: enfant, port, societeId: s.id, depuis: Date.now(), redemarrages: 0, sousDomaine: sd };
  enMarche.set(sd, fiche);

  const prefixe = `[${sd}]`;
  enfant.stdout.on('data', (d) => { process.stdout.write(`${prefixe} ${d}`); retenir(sd, d); });
  enfant.stderr.on('data', (d) => { process.stderr.write(`${prefixe} ${d}`); retenir(sd, d, true); });
  enfant.on('exit', (code, signal) => {
    enMarche.delete(sd);
    journal(`${sd} arrêtée (code ${code}${signal ? `, signal ${signal}` : ''})`);
    retenir(sd, `— arrêt (code ${code}${signal ? `, signal ${signal}` : ''})`, code !== 0);
    // Redémarrage automatique en cas de plantage, mais pas d'un arrêt demandé.
    if (!fiche.arretDemande && code !== 0) {
      const attente = Math.min(30000, 2000 * (fiche.redemarrages + 1));
      journal(`${sd} redémarrera dans ${attente / 1000} s`);
      setTimeout(() => {
        const r = demarrer(societeId);
        // Un portail qui a tenu debout un bon moment avant de tomber n'est pas
        // « en boucle » : sans cette remise à zéro, un incident isolé d'il y a
        // trois semaines le laissait signalé instable pour toujours.
        const stable = Date.now() - fiche.depuis > DUREE_STABLE_MS;
        if (r.ok && enMarche.get(sd)) enMarche.get(sd).redemarrages = stable ? 1 : fiche.redemarrages + 1;
      }, attente).unref();
    }
  });

  journal(`${sd} démarrée sur le port ${port}`);
  return { ok: true, port };
}

/**
 * Portails arrêtés SUR DEMANDE d'un opérateur.
 *
 * La distinction est essentielle depuis la mise en veille : un portail endormi
 * se réveille à la première visite, alors qu'un portail qu'on a explicitement
 * arrêté doit le rester. Sans cela, le bouton « Arrêter » du panel ne servait à
 * rien — le visiteur suivant relançait le portail, et il devenait impossible de
 * mettre un client hors ligne.
 */
const arretsExplicites = new Set();

/**
 * Arrête l'instance d'une société.
 * @param {object} [options]
 * @param {boolean} [options.explicite=true] Arrêt voulu par un opérateur (le
 *   portail ne se rallumera pas tout seul), par opposition à une mise en veille.
 */
function arreter(sousDomaine, { explicite = true } = {}) {
  if (explicite) arretsExplicites.add(sousDomaine);
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

/* ---------------------------------------------------------------------------
   Mise en veille.

   Un portail au repos consomme 84 Mo à ne rien faire. Or un référent y passe
   quelques minutes par semaine : sur vingt clients, ce sont 1,7 Go immobilisés
   pour des processus qui dorment. La même machine tient trente clients éveillés,
   ou plusieurs centaines si on ne réveille que ceux qu'on visite.

   Deux règles, et elles ne souffrent pas d'exception :

    1. On n'éteint JAMAIS un portail qui a du travail. Une demande en attente,
       même déposée il y a trois semaines pour une date future, veut dire qu'un
       robot doit tourner. L'éteindre reviendrait à perdre la demande en silence.

    2. Tout portail est réveillé une fois par jour pour sa maintenance. Les
       purges de conservation — dont l'effacement des captures d'écran au bout
       d'un jour — s'exécutent au démarrage de l'instance. Sans ce réveil, un
       portail peu visité garderait ses captures jusqu'à la prochaine visite, et
       la durée annoncée aux personnes concernées deviendrait fausse.
   --------------------------------------------------------------------------- */

/** Minutes d'inactivité avant extinction. `0` désactive la veille. */
const VEILLE_MINUTES = Math.max(0, Number(process.env.SMARTFIXX_VEILLE_MINUTES ?? 30));
/** Heure du réveil de maintenance (après la sauvegarde de 3 h). */
const MAINTENANCE_HEURE = Math.min(23, Math.max(0, Number(process.env.SMARTFIXX_MAINTENANCE_HEURE || 4)));
/** Au-delà, on renonce à attendre qu'un portail réponde. */
const DELAI_DEMARRAGE_MS = Number(process.env.SMARTFIXX_DELAI_DEMARRAGE_MS || 20000);

/** Dernière requête reçue par un portail. */
function toucher(sousDomaine) {
  const f = enMarche.get(sousDomaine);
  if (f) f.derniereRequete = Date.now();
}

/**
 * Le portail a-t-il des demandes à traiter ?
 * Lecture seule, et un échec vaut « oui » : dans le doute, on ne coupe pas.
 */
function aDuTravail(sousDomaine) {
  const fichier = path.join(INSTANCES, sousDomaine, 'portail.db');
  if (!fs.existsSync(fichier)) return false;
  let conn;
  try {
    // Chargé ici plutôt qu'en tête de module : `supervision` dépend déjà de
    // l'orchestrateur, et une dépendance croisée en tête de fichier rendrait
    // l'ordre de chargement dépendant de qui appelle qui.
    const Database = require('better-sqlite3');
    conn = new Database(fichier, { readonly: true, fileMustExist: true });
    return conn.prepare(
      `SELECT COUNT(*) n FROM requests WHERE status IN ('en_attente', 'en_cours')`
    ).get().n > 0;
  } catch {
    return true;
  } finally {
    try { if (conn) conn.close(); } catch { /* déjà fermée */ }
  }
}

/** Le port répond-il ? */
function repond(port) {
  return new Promise((resolve) => {
    const socket = require('net').connect({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
  });
}

/**
 * Garantit qu'un portail est en marche ET qu'il répond.
 *
 * Rendre la main dès que le processus est lancé ne suffirait pas : Node met un
 * instant à ouvrir son port, et la requête du visiteur arriverait sur un port
 * fermé — une page d'erreur pour un portail qui va parfaitement bien.
 */
async function assurerDemarrage(societeId) {
  const s = db.societe(societeId);
  if (!s || !s.sous_domaine) return { ok: false, raison: 'Société introuvable' };
  const existant = enMarche.get(s.sous_domaine);
  if (existant) {
    existant.derniereRequete = Date.now();
    return { ok: true, port: existant.port, deja: true };
  }
  // Un portail arrêté par un opérateur ne se rallume pas sur simple visite :
  // sinon « Arrêter » ne voudrait rien dire, et on ne pourrait plus mettre un
  // client hors ligne.
  if (arretsExplicites.has(s.sous_domaine)) {
    return { ok: false, raison: 'Portail arrêté par un opérateur' };
  }
  const r = demarrer(societeId);
  if (!r.ok) return r;
  const limite = Date.now() + DELAI_DEMARRAGE_MS;
  while (Date.now() < limite) {
    if (await repond(r.port)) {
      toucher(s.sous_domaine);
      return { ok: true, port: r.port, reveille: true };
    }
    await new Promise((res) => setTimeout(res, 120));
  }
  return { ok: false, raison: 'Le portail n’a pas répondu à temps' };
}

/**
 * Éteint les portails inactifs qui n'ont rien à traiter.
 *
 * `maintenant` est paramétrable pour que le comportement puisse être vérifié
 * sans attendre réellement le délai d'inactivité : un test qui dort trente
 * minutes n'est jamais joué.
 */
function veiller(maintenant = Date.now()) {
  if (!VEILLE_MINUTES) return [];
  const limite = maintenant - VEILLE_MINUTES * 60 * 1000;
  const endormis = [];
  for (const [sd, fiche] of [...enMarche]) {
    if ((fiche.derniereRequete || fiche.depuis) > limite) continue;
    if (fiche.maintenance) continue;          // réveil de maintenance en cours
    if (aDuTravail(sd)) continue;             // règle 1 : jamais de travail perdu
    arreter(sd, { explicite: false });
    endormis.push(sd);
  }
  if (endormis.length) journal(`Mise en veille : ${endormis.join(', ')}`);
  return endormis;
}

/**
 * Réveille chaque portail endormi le temps de ses purges, puis le rendort.
 * C'est ce qui fait que « les captures sont effacées au bout d'un jour » reste
 * vrai pour un portail que personne ne visite.
 */
/** Portails réveillés simultanément pour la maintenance. */
const LOT_MAINTENANCE = Math.max(1, Number(process.env.SMARTFIXX_LOT_MAINTENANCE || 5));

async function maintenance() {
  if (!VEILLE_MINUTES) return [];
  const aFaire = db.vue().filter((s) => !s.archivee && s.sousDomaine
    && !enMarche.has(s.sousDomaine) && !arretsExplicites.has(s.sousDomaine));
  if (!aFaire.length) return [];
  journal(`Maintenance : ${aFaire.length} portail(s) à réveiller, par lots de ${LOT_MAINTENANCE}`);

  const traites = [];
  // PAR LOTS, jamais tous ensemble : réveiller cent portails d'un coup, ce sont
  // huit gigaoctets réclamés au même instant — la machine tomberait en essayant
  // de faire le ménage.
  for (let i = 0; i < aFaire.length; i += LOT_MAINTENANCE) {
    const lot = aFaire.slice(i, i + LOT_MAINTENANCE);
    const eveilles = [];
    for (const s of lot) {
      const r = await assurerDemarrage(s.id);
      if (!r.ok) continue;
      const fiche = enMarche.get(s.sousDomaine);
      if (fiche) fiche.maintenance = true;
      eveilles.push(s.sousDomaine);
    }
    if (!eveilles.length) continue;
    // Le temps que chaque instance exécute sa purge de démarrage.
    await new Promise((r) => setTimeout(r, 30000));
    for (const sd of eveilles) {
      const fiche = enMarche.get(sd);
      if (fiche) fiche.maintenance = false;
      if (!aDuTravail(sd)) arreter(sd, { explicite: false });
    }
    traites.push(...eveilles);
  }
  journal(`Maintenance terminée : ${traites.length} portail(s) purgé(s)`);
  return traites;
}

/** Programme la surveillance de veille et le réveil de maintenance quotidien. */
function programmerVeille() {
  if (!VEILLE_MINUTES) {
    journal('Veille désactivée : tous les portails restent en marche.');
    return;
  }
  setInterval(() => { try { veiller(); } catch (e) { journal(`veille : ${e.message}`); } },
    60 * 1000).unref();
  const prochaine = () => {
    const d = new Date();
    d.setHours(MAINTENANCE_HEURE, 0, 0, 0);
    if (d <= new Date()) d.setDate(d.getDate() + 1);
    return d - new Date();
  };
  const poser = () => setTimeout(() => {
    maintenance().catch((e) => journal(`maintenance : ${e.message}`)).finally(poser);
  }, prochaine()).unref();
  poser();
  journal(`Veille après ${VEILLE_MINUTES} min sans visite ; maintenance à ${String(MAINTENANCE_HEURE).padStart(2, '0')} h.`);
}

/**
 * Démarre ce qui doit tourner au lancement du serveur.
 *
 * En veille, on ne réveille que les portails qui ont des demandes en attente :
 * après un redémarrage du serveur, une file ne doit pas rester en plan faute de
 * visiteur. Les autres attendront le leur.
 */
function demarrerTout() {
  const resultats = [];
  for (const s of db.vue()) {
    if (s.archivee || !s.sousDomaine) continue;
    if (VEILLE_MINUTES && !aDuTravail(s.sousDomaine)) {
      resultats.push({ societe: s.nom, sousDomaine: s.sousDomaine, ok: true, enVeille: true });
      continue;
    }
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
  portPour, etat, journalDe, INSTANCES, dossierDe,
  assurerDemarrage, toucher, veiller, maintenance, programmerVeille, aDuTravail,
  arreteExplicitement: (sd) => arretsExplicites.has(sd),
  VEILLE_MINUTES,
};
