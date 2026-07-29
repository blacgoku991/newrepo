'use strict';

/**
 * Informations légales et de conformité du portail.
 *
 * En hébergement mutualisé, ces mentions ne peuvent pas être écrites en dur :
 * l'éditeur du portail, c'est le CLIENT — c'est lui le responsable de
 * traitement, c'est son DPO qu'on doit joindre, c'est son siège social qui
 * s'affiche. Elles se saisissent donc depuis son administration, une fois, et
 * alimentent la page de mentions légales.
 *
 * Ce qui n'est PAS saisissable ici est aussi important : les durées de
 * conservation viennent de `retention.js`, c'est-à-dire de ce qui est
 * réellement appliqué par le code. Les recopier à la main, c'est prendre le
 * risque d'annoncer six mois là où la purge en garde trois ans.
 */

const db = require('./db');
const marque = require('./marque');
const retention = require('./retention');

const CLE = 'conformite';

/**
 * Champs saisissables. Liste FERMÉE : sans elle, une requête forgée écrirait
 * n'importe quelle clé dans les réglages.
 */
const CHAMPS = [
  { cle: 'raisonSociale', libelle: 'Raison sociale', aide: 'Nom juridique complet de l’organisation.' },
  { cle: 'formeJuridique', libelle: 'Forme juridique', exemple: 'Association loi 1901, SAS…' },
  { cle: 'siren', libelle: 'SIREN ou SIRET' },
  { cle: 'siege', libelle: 'Siège social', long: true },
  { cle: 'directeurPublication', libelle: 'Directeur de la publication' },
  { cle: 'contact', libelle: 'Contact', aide: 'Adresse e-mail ou téléphone du service qui répond aux questions sur le portail.' },
  { cle: 'dpoNom', libelle: 'Délégué à la protection des données (DPO)' },
  { cle: 'dpoContact', libelle: 'Contact du DPO', aide: 'C’est l’adresse par laquelle les salariés exercent leurs droits.' },
  { cle: 'hebergeur', libelle: 'Hébergeur', long: true, aide: 'Raison sociale et adresse de l’hébergeur du portail.' },
];

const PAR_CLE = new Map(CHAMPS.map((c) => [c.cle, c]));

/** Valeurs saisies. */
function valeurs() {
  const v = db.getSetting(CLE, {}) || {};
  const out = {};
  for (const c of CHAMPS) out[c.cle] = typeof v[c.cle] === 'string' ? v[c.cle] : '';
  return out;
}

/** Enregistre. Un champ absent n'est pas touché. */
function definir(entrees, par) {
  const actuel = valeurs();
  const modifies = [];
  for (const [cle, def] of PAR_CLE) {
    if (!(cle in entrees)) continue;
    const valeur = String(entrees[cle] ?? '').trim().slice(0, 400);
    if (valeur === actuel[cle]) continue;
    actuel[cle] = valeur;
    modifies.push(def.libelle);
  }
  if (modifies.length) db.setSetting(CLE, actuel, par || '');
  return { modifies };
}

/**
 * Les cookies réellement déposés.
 *
 * Tous sont strictement nécessaires : aucun consentement n'est requis, mais
 * l'information l'est. La liste est écrite ici plutôt que dans la page, pour
 * qu'elle suive le code et non l'inverse.
 */
const COOKIES = [
  {
    nom: 'portal_sso',
    role: 'Maintient votre connexion Microsoft 365 pendant votre visite.',
    duree: '12 heures',
    necessaire: true,
  },
  {
    nom: 'admin_session',
    role: 'Maintient la session d’un administrateur du portail.',
    duree: '12 heures',
    necessaire: true,
  },
];

/** Ce que la page de mentions légales affiche. */
function etat() {
  const v = valeurs();
  const m = marque.etat();
  return {
    societe: m.societe,
    editeurOutil: m.editeur,
    mentionEditeur: m.mention,
    champs: CHAMPS.map((c) => ({ ...c, valeur: v[c.cle] })),
    valeurs: v,
    // Complet ou non : l'administration doit pouvoir voir qu'il manque quelque
    // chose sans lire la page publique.
    complet: CHAMPS.every((c) => v[c.cle]),
    manquants: CHAMPS.filter((c) => !v[c.cle]).map((c) => c.libelle),
    cookies: COOKIES,
    conservation: retention.registre().map((r) => ({
      libelle: r.libelle, contenu: r.contenu, finalite: r.finalite, jours: r.jours,
    })),
  };
}

module.exports = { etat, definir, valeurs, CHAMPS, COOKIES };
