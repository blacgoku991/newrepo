'use strict';

/**
 * Licence annuelle, vérifiable HORS LIGNE.
 *
 * Contrainte de départ : les établissements clients ont des flux réseau très
 * contrôlés. L'application ne peut donc PAS appeler un serveur de licences au
 * démarrage. La licence est un jeton signé, remis au client, que le portail
 * vérifie tout seul avec une clé publique embarquée.
 *
 *   ALG1.<charge utile base64url>.<signature base64url>
 *
 * - Signature Ed25519 (`node:crypto`, aucune dépendance ajoutée) : modifier la
 *   date de fin dans la charge utile invalide la signature.
 * - La clé PRIVÉE ne quitte jamais le poste de l'éditeur (voir
 *   `scripts/licence-keygen.js` et `scripts/licence-signer.js`).
 * - La licence peut être liée à une INSTALLATION précise (`install`) : la
 *   recopier sur un autre serveur ne sert à rien.
 * - Une borne haute d'horloge (« high-water mark ») est mémorisée : reculer la
 *   date du serveur ne prolonge pas la licence.
 *
 * Quand la licence est échue (au-delà du délai de grâce), le portail passe en
 * MODE LIMITÉ : les robots sont coupés et aucune demande n'est déposée, mais
 * toutes les données restent consultables. On ne perd rien, on ne détruit rien.
 *
 * Ce n'est pas un DRM : quelqu'un qui modifie le code source peut contourner
 * n'importe quel contrôle local. L'objectif est qu'un client ne puisse pas
 * prolonger sa licence en éditant un fichier, une date ou une clé.
 */

const crypto = require('node:crypto');
const db = require('./db');

/**
 * Clé publique de l'éditeur (DER SPKI, base64). À REMPLACER par la vôtre avant
 * toute distribution : `node scripts/licence-keygen.js` l'affiche prête à
 * coller. Tant que la valeur ci-dessous est le gabarit, le portail fonctionne
 * sans limitation (« licence non configurée ») — pratique en développement,
 * mais à ne jamais laisser chez un client.
 */
const CLE_PUBLIQUE = 'REMPLACER_PAR_VOTRE_CLE_PUBLIQUE';

const PREFIXE = 'ALG1';
const GRACE_DEFAUT = 30; // jours de tolérance après la date de fin
const ALERTE_JOURS = 60; // à partir de combien de jours restants on prévient
const TOLERANCE_HORLOGE_MS = 48 * 3600 * 1000;
const SAUT_HORLOGE_MAX_MS = 366 * 24 * 3600 * 1000;

// États possibles. `robot` = les scénarios peuvent tourner et les demandes être
// déposées ; les autres états laissent le portail consultable.
const ETATS = {
  ouvert: { robot: true, niveau: 'info', titre: 'Licence non configurée' },
  valide: { robot: true, niveau: 'ok', titre: 'Licence active' },
  grace: { robot: true, niveau: 'warn', titre: 'Licence échue — période de tolérance' },
  absente: { robot: false, niveau: 'danger', titre: 'Aucune licence installée' },
  invalide: { robot: false, niveau: 'danger', titre: 'Licence illisible ou falsifiée' },
  installation: { robot: false, niveau: 'danger', titre: 'Licence émise pour une autre installation' },
  future: { robot: false, niveau: 'danger', titre: 'Licence pas encore entrée en vigueur' },
  expiree: { robot: false, niveau: 'danger', titre: 'Licence expirée' },
  horloge: { robot: false, niveau: 'danger', titre: 'Date du serveur incohérente' },
};

const b64urlDecode = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Vrai si aucune clé publique n'a été posée (mode développement). */
function configuree() {
  return CLE_PUBLIQUE !== 'REMPLACER_PAR_VOTRE_CLE_PUBLIQUE' && CLE_PUBLIQUE.length > 20;
}

function clePublique() {
  return crypto.createPublicKey({
    key: Buffer.from(CLE_PUBLIQUE, 'base64'),
    format: 'der',
    type: 'spki',
  });
}

/**
 * Identifiant de CETTE installation : tiré au sort au premier démarrage et
 * conservé en base. Il est communiqué à l'éditeur pour émettre une licence liée
 * à ce serveur. Recréer la base change l'identifiant — donc invalide la licence
 * (c'est voulu : une base neuve est une nouvelle installation).
 */
function installId() {
  let id = db.getSetting('licence_install_id', null);
  if (!id) {
    id = crypto.randomBytes(8).toString('hex').toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
    db.setSetting('licence_install_id', id, 'systeme');
  }
  return id;
}

/**
 * Borne haute d'horloge : la date la plus avancée jamais observée. Reculer
 * l'horloge du serveur ne rallonge donc pas une licence. Un saut de plus d'un
 * an n'est PAS mémorisé, sinon une horloge déréglée une seule fois condamnerait
 * l'installation.
 */
function bornerHorloge(maintenant) {
  const stockee = db.getSetting('licence_horloge', null);
  const borne = stockee ? new Date(stockee) : null;
  if (!borne || Number.isNaN(borne.getTime())) {
    db.setSetting('licence_horloge', maintenant.toISOString(), 'systeme');
    return { recul: false, borne: maintenant };
  }
  if (maintenant > borne) {
    if (maintenant - borne < SAUT_HORLOGE_MAX_MS) {
      // On n'écrit qu'une fois par heure : l'état est consulté à chaque requête
      // et à chaque tour du worker, inutile d'écrire en base à chaque fois.
      if (maintenant - borne > 3600 * 1000) {
        db.setSetting('licence_horloge', maintenant.toISOString(), 'systeme');
      }
      return { recul: false, borne: maintenant };
    }
    // Saut invraisemblable : on ne l'enregistre pas, on garde l'ancienne borne.
    return { recul: false, borne };
  }
  return { recul: borne - maintenant > TOLERANCE_HORLOGE_MS, borne };
}

/** Découpe et vérifie la signature du jeton. Renvoie la charge utile ou null. */
function lireJeton(jeton) {
  const parts = String(jeton || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== PREFIXE) return null;
  const [, chargeB64, signatureB64] = parts;
  let charge;
  try {
    charge = JSON.parse(b64urlDecode(chargeB64).toString('utf8'));
  } catch {
    return null;
  }
  let signatureOk = false;
  try {
    // La signature couvre le préfixe ET la charge utile : on ne peut pas
    // rejouer la signature d'une licence dans un autre contexte.
    signatureOk = crypto.verify(
      null,
      Buffer.from(`${PREFIXE}.${chargeB64}`, 'utf8'),
      clePublique(),
      b64urlDecode(signatureB64)
    );
  } catch {
    return null;
  }
  return signatureOk ? charge : null;
}

const jour = (iso) => {
  const d = new Date(`${String(iso || '').slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const joursEntre = (a, b) => Math.ceil((b - a) / 86400000);

/**
 * État courant de la licence. Fonction pure vis-à-vis du stockage : elle lit la
 * licence et la borne d'horloge, ne modifie que cette borne.
 * @returns {{etat:string, robot:boolean, niveau:string, titre:string,
 *            message:string, client:string, fin:string|null,
 *            joursRestants:number|null, installId:string, configuree:boolean}}
 */
function etat() {
  const maintenant = new Date();
  const installe = installId();
  const base = { installId: installe, configuree: configuree(), client: '', fin: null, debut: null, joursRestants: null };

  if (!configuree()) {
    return {
      ...base,
      ...ETATS.ouvert,
      etat: 'ouvert',
      message:
        'Aucune clé publique de licence n’est embarquée : le portail fonctionne sans limitation. ' +
        'Posez votre clé publique dans src/licence.js avant toute mise en service chez un client.',
    };
  }

  const jeton = db.getSetting('licence_jeton', null);
  if (!jeton) {
    return {
      ...base,
      ...ETATS.absente,
      etat: 'absente',
      message: `Installez la licence fournie par l’éditeur. Identifiant de cette installation : ${installe}.`,
    };
  }

  const charge = lireJeton(jeton);
  if (!charge) {
    return {
      ...base,
      ...ETATS.invalide,
      etat: 'invalide',
      message: 'La licence installée n’a pas pu être vérifiée : elle est incomplète, modifiée, ou destinée à une autre version du portail.',
    };
  }

  const client = String(charge.client || '').slice(0, 120);
  const debut = jour(charge.debut);
  const fin = jour(charge.fin);
  const grace = Number.isFinite(charge.grace) ? Math.max(0, Math.min(365, charge.grace)) : GRACE_DEFAUT;
  const infos = {
    ...base,
    client,
    debut: charge.debut || null,
    fin: charge.fin || null,
  };

  if (!fin) {
    return { ...infos, ...ETATS.invalide, etat: 'invalide', message: 'La licence installée ne porte pas de date de fin exploitable.' };
  }

  // Licence liée à une installation : la recopier ailleurs ne donne rien.
  if (charge.install && String(charge.install) !== installe) {
    return {
      ...infos,
      ...ETATS.installation,
      etat: 'installation',
      message: `Cette licence a été émise pour l’installation ${String(charge.install).slice(0, 40)}, or celle-ci est ${installe}.`,
    };
  }

  const { recul } = bornerHorloge(maintenant);
  if (recul) {
    return {
      ...infos,
      ...ETATS.horloge,
      etat: 'horloge',
      message: 'La date du serveur est antérieure à la dernière date observée. Remettez l’horloge à l’heure pour réactiver les traitements.',
    };
  }

  if (debut && maintenant < debut) {
    return { ...infos, ...ETATS.future, etat: 'future', message: `Cette licence prend effet le ${charge.debut}.` };
  }

  const restants = joursEntre(maintenant, fin);
  if (restants >= 0) {
    return {
      ...infos,
      ...ETATS.valide,
      etat: 'valide',
      joursRestants: restants,
      message:
        restants <= ALERTE_JOURS
          ? `Licence valable encore ${restants} jour${restants > 1 ? 's' : ''} (jusqu’au ${charge.fin}). Pensez au renouvellement.`
          : `Licence valable jusqu’au ${charge.fin}.`,
    };
  }

  const depuis = -restants;
  if (depuis <= grace) {
    return {
      ...infos,
      ...ETATS.grace,
      etat: 'grace',
      joursRestants: grace - depuis,
      message: `Licence échue depuis le ${charge.fin}. Les traitements continuent encore ${grace - depuis} jour${grace - depuis > 1 ? 's' : ''}, puis seront suspendus.`,
    };
  }

  return {
    ...infos,
    ...ETATS.expiree,
    etat: 'expiree',
    joursRestants: 0,
    message: `Licence expirée depuis le ${charge.fin} (tolérance de ${grace} jours dépassée). Les créations et modifications de comptes sont suspendues ; vos données restent consultables.`,
  };
}

/** Les robots peuvent-ils tourner et les demandes être déposées ? */
function autorise() {
  return etat().robot;
}

/**
 * Installe une licence (depuis le panel d'administration). Refuse tout jeton
 * qui ne passe pas la vérification : on ne stocke jamais une licence qu'on
 * serait incapable de relire.
 * @returns {{ok:boolean, etat?:object, erreur?:string}}
 */
function installer(jeton, par = '') {
  const propre = String(jeton || '').trim().replace(/\s+/g, '');
  if (!propre) return { ok: false, erreur: 'Collez la licence fournie par l’éditeur.' };
  if (!configuree()) return { ok: false, erreur: 'Aucune clé publique de licence n’est embarquée dans cette version du portail.' };

  const charge = lireJeton(propre);
  if (!charge) return { ok: false, erreur: 'Licence invalide : signature incorrecte, format inattendu, ou texte incomplet lors du copier-coller.' };
  if (charge.install && String(charge.install) !== installId()) {
    return { ok: false, erreur: `Cette licence a été émise pour l’installation ${String(charge.install).slice(0, 40)}, or celle-ci est ${installId()}.` };
  }
  if (!jour(charge.fin)) return { ok: false, erreur: 'Licence invalide : date de fin illisible.' };

  db.setSetting('licence_jeton', propre, par);
  db.audit(par || 'admin', 'licence_installee', '', `${charge.client || ''} — jusqu'au ${charge.fin}`);
  return { ok: true, etat: etat() };
}

module.exports = { etat, autorise, installer, installId, configuree, ETATS, PREFIXE };
