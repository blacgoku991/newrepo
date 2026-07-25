'use strict';

/**
 * Registre des démarches proposées par le portail.
 *
 * Une démarche relie quatre choses : le préfixe de sa référence de suivi, le
 * schéma de formulaire à servir, la fonction du robot qui l'exécute, et son
 * libellé pour l'humain.
 *
 * Tout passe par cette table : ajouter une démarche ne demande plus de toucher
 * au routage du serveur ni au worker. Les identifiants (`creation`,
 * `reset_mdp`…) sont ceux stockés dans la colonne `request_type` — ne pas les
 * renommer sans migration.
 */

const DEMARCHES = {
  creation: {
    label: 'Création de compte',
    court: 'Création',
    // Préfixe repris de l'application (BKG, NS…), la création étant sa démarche
    // principale.
    prefixe: null,
    schema: 'formSchema',
    action: 'createAccount',
    succes: 'Compte créé avec succès',
    audit: 'creation_compte',
  },
  reset_mdp: {
    label: 'Réinitialisation de mot de passe',
    court: 'Réinit. mdp',
    prefixe: 'MDP',
    schema: 'resetSchema',
    action: 'resetPassword',
    succes: 'Mot de passe réinitialisé',
    audit: 'reinit_mdp',
  },
  ajout_etab: {
    label: "Ajout d'établissement",
    court: 'Ajout étab.',
    prefixe: 'ETB',
    schema: 'extensionSchema',
    action: 'addEstablishment',
    succes: 'Établissement ajouté',
    audit: 'ajout_etab',
  },
  maj_identite: {
    label: "Correction de l'identité",
    court: 'Identité',
    prefixe: 'IDT',
    schema: 'identiteSchema',
    action: 'updateIdentity',
    succes: 'Identité corrigée',
    audit: 'maj_identite',
  },
  transfert_etab: {
    label: "Transfert vers un autre établissement",
    court: 'Transfert',
    prefixe: 'TRF',
    schema: 'transfertSchema',
    action: 'transferEstablishment',
    succes: 'Compte transféré',
    audit: 'transfert_etab',
  },
};

/** Démarche par défaut quand aucun type n'est précisé. */
const DEFAUT = 'creation';

/** Définition d'une démarche, ou null si le type est inconnu. */
function get(type) {
  const cle = String(type || DEFAUT);
  return Object.prototype.hasOwnProperty.call(DEMARCHES, cle) ? { type: cle, ...DEMARCHES[cle] } : null;
}

/** Type valide extrait d'une entrée quelconque (query, corps…), sinon défaut. */
function normalise(type) {
  return get(type) ? String(type || DEFAUT) : DEFAUT;
}

/** Préfixe de référence de suivi pour cette démarche sur cette application. */
function prefixe(type, config) {
  const d = get(type);
  return (d && d.prefixe) || (config && config.referencePrefix) || 'REQ';
}

/** Libellé court, pour les tableaux et les étiquettes. */
function court(type) {
  const d = get(type);
  return d ? d.court : String(type || '');
}

/** Démarches réellement disponibles pour une application (schéma + robot présents). */
function disponibles(config, automation) {
  return Object.keys(DEMARCHES).filter((type) => {
    const d = DEMARCHES[type];
    return Boolean(config && config[d.schema]) && typeof (automation || {})[d.action] === 'function';
  });
}

module.exports = { DEMARCHES, DEFAUT, get, normalise, prefixe, court, disponibles };
