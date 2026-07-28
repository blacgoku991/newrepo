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
 * - La clé PRIVÉE ne quitte jamais le poste de l'éditeur (elle vit dans ses
 *   outils de l’éditeur, conservés hors du dépôt et hors du serveur client).
 * - La licence peut être liée à une INSTALLATION précise (`install`) : la
 *   recopier sur un autre serveur ne sert à rien.
 * - Une borne haute d'horloge (« high-water mark ») est mémorisée : reculer la
 *   date du serveur ne prolonge pas la licence.
 *
 * Un mois avant l'échéance, un bandeau affiche le DÉCOMPTE des jours restants.
 * À la date de fin, sans aucune tolérance, le portail passe en MODE LIMITÉ :
 * les robots sont coupés et aucune demande n'est déposée, mais toutes les
 * données restent consultables. On ne perd rien, on ne détruit rien.
 *
 * Ce n'est pas un DRM : quelqu'un qui modifie le code source peut contourner
 * n'importe quel contrôle local. L'objectif est qu'un client ne puisse pas
 * prolonger sa licence en éditant un fichier, une date ou une clé.
 */

const crypto = require('node:crypto');
const db = require('./db');

const GABARIT = 'REMPLACER_PAR_VOTRE_CLE_PUBLIQUE';

/**
 * Clé publique de l'éditeur (DER SPKI, base64), qui vérifie les licences.
 *
 * Elle vient de `LICENCE_CLE_PUBLIQUE` (variable d'environnement, posée par
 * l'orchestrateur ou le `.env`), et à défaut de la constante ci-dessous.
 *
 * Passer par l'environnement évite d'avoir à modifier ce fichier versionné :
 * une clé écrite en dur ici entre en conflit à chaque mise à jour du code.
 * La constante reste utile pour une version compilée livrée à un client qui
 * héberge lui-même.
 *
 * Tant qu'aucune clé n'est posée, le portail fonctionne sans limitation
 * (« licence non configurée ») — pratique en développement, à ne jamais
 * laisser chez un client.
 */
const CLE_PUBLIQUE = process.env.LICENCE_CLE_PUBLIQUE || GABARIT;

const PREFIXE = 'ALG1';
// AUCUNE tolérance : à la date de fin, le portail passe en mode limité le jour
// même. Le décompte prévient un mois à l'avance, il n'y a donc pas de surprise.
// (`grace` reste lisible dans une licence pour un geste commercial explicite,
// mais rien n'en met par défaut.)
const GRACE_DEFAUT = 0;
const ALERTE_JOURS = 30; // décompte affiché à partir de 30 jours restants
const TOLERANCE_HORLOGE_MS = 48 * 3600 * 1000;
const SAUT_HORLOGE_MAX_MS = 366 * 24 * 3600 * 1000;

// États possibles. `robot` = les scénarios peuvent tourner et les demandes être
// déposées ; les autres états laissent le portail consultable.
const ETATS = {
  ouvert: { robot: true, niveau: 'info', titre: 'Licence non configurée' },
  valide: { robot: true, niveau: 'ok', titre: 'Licence active' },
  grace: { robot: true, niveau: 'warn', titre: 'Licence échue — tolérance accordée' },
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
  return CLE_PUBLIQUE !== GABARIT && CLE_PUBLIQUE.length > 20;
}

function clePublique() {
  return crypto.createPublicKey({
    key: Buffer.from(CLE_PUBLIQUE, 'base64'),
    format: 'der',
    type: 'spki',
  });
}

/**
 * Empreinte courte de la clé publique embarquée (8 caractères).
 *
 * Sert au support : si vous voyez l'empreinte affichée dans le panel d'un
 * client, vous savez que c'est bien VOTRE clé qui vérifie ses licences. Une
 * empreinte différente de la vôtre signifie que la clé a été remplacée dans le
 * code livré — le seul contournement possible, et il devient ainsi visible.
 */
function empreinteCle() {
  if (!configuree()) return null;
  return crypto.createHash('sha256').update(CLE_PUBLIQUE).digest('hex').slice(0, 8).toUpperCase();
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
 * Borne haute d'horloge : la date la plus avancée jamais observée.
 *
 * Elle sert à UNE chose : empêcher de rallonger une licence en reculant
 * l'horloge du serveur. Un recul n'est donc considéré comme suspect que s'il
 * CHANGE LE VERDICT — c'est-à-dire si l'on avait déjà dépassé l'échéance et
 * qu'on prétend soudain être revenu avant.
 *
 * Sans cette nuance, toute correction d'horloge légitime bloquait
 * l'installation : une date avancée par erreur (test, machine virtuelle
 * restaurée, NTP capricieux) était mémorisée, et le retour à la bonne date
 * passait pour une fraude — y compris quand la licence était de toute façon
 * expirée, donc que le recul n'apportait rien à personne.
 *
 * Un bond de plus d'un an n'est jamais mémorisé, pour qu'une horloge partie à
 * 2040 ne condamne pas définitivement le portail.
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
  return { recul: false, borne, recule: borne - maintenant > TOLERANCE_HORLOGE_MS };
}

/**
 * Le recul de l'horloge profite-t-il à la licence ? Vrai seulement si la borne
 * haute était DÉJÀ au-delà de l'échéance et que la date courante repasse avant :
 * c'est le seul cas où reculer l'horloge prolonge le service.
 */
function reculSuspect(borne, maintenant, fin) {
  if (!fin) return false;
  return borne > fin && maintenant <= fin;
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
  const base = {
    installId: installe,
    configuree: configuree(),
    empreinteCle: empreinteCle(),
    client: '', fin: null, debut: null, joursRestants: null,
  };

  if (!configuree()) {
    return {
      ...base,
      ...ETATS.ouvert,
      etat: 'ouvert',
      message:
        'Cette installation n’est rattachée à aucune licence : le portail fonctionne sans limitation. ' +
        'La mise en service est à faire par votre prestataire.',
    };
  }

  // En hébergement mutualisé, la licence est posée par l'orchestrateur au
  // démarrage de l'instance : pas de copier-coller manuel dans les réglages.
  // Le réglage en base reste prioritaire (client qui héberge lui-même).
  const jeton = db.getSetting('licence_jeton', null) || process.env.LICENCE_JETON || null;
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

  // Horloge : on ne bloque que si le recul ferait repasser une licence échue
  // pour valide. Une correction d'horloge sans effet sur l'échéance est ignorée.
  const { borne, recule } = bornerHorloge(maintenant);
  if (recule && reculSuspect(borne, maintenant, fin)) {
    return {
      ...infos,
      ...ETATS.horloge,
      etat: 'horloge',
      message:
        `La date du serveur (${maintenant.toISOString().slice(0, 10)}) est antérieure à la dernière date observée ` +
        `(${borne.toISOString().slice(0, 10)}), et cette licence est échue depuis le ${charge.fin}. ` +
        'Remettez l’horloge du serveur à l’heure, ou installez une licence à jour.',
    };
  }

  if (debut && maintenant < debut) {
    return { ...infos, ...ETATS.future, etat: 'future', message: `Cette licence prend effet le ${charge.debut}.` };
  }

  const restants = joursEntre(maintenant, fin);
  if (restants >= 0) {
    // Dernier mois : bandeau d'alerte avec le décompte, pour que le
    // renouvellement soit anticipé et jamais découvert le jour de l'arrêt.
    const proche = restants <= ALERTE_JOURS;
    const jours = `${restants} jour${restants > 1 ? 's' : ''}`;
    return {
      ...infos,
      ...ETATS.valide,
      etat: 'valide',
      niveau: proche ? 'warn' : 'ok',
      titre: proche ? `Licence : expiration dans ${jours}` : ETATS.valide.titre,
      joursRestants: restants,
      message: proche
        ? `Votre licence expire le ${charge.fin}, dans ${jours}. À cette date, les créations et modifications de comptes s’arrêteront ; vos données resteront consultables. Contactez votre éditeur pour renouveler.`
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
    message:
      `Licence expirée depuis le ${charge.fin}${grace ? ` (tolérance de ${grace} jours dépassée)` : ''}. ` +
      'Les créations et modifications de comptes sont suspendues ; vos données restent consultables. ' +
      'Installez une licence à jour pour reprendre les traitements.',
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
  if (!configuree()) return { ok: false, erreur: 'Cette installation n’est pas prête à recevoir une licence. Contactez votre prestataire.' };

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

module.exports = { etat, autorise, installer, installId, configuree, empreinteCle, ETATS, PREFIXE };
