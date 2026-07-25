'use strict';

/**
 * Comptes de service à ne JAMAIS toucher depuis le portail.
 *
 * Le robot se connecte aux applications métiers avec un compte administrateur
 * (`BLUEKANGO_ADMIN_USER`, `NETSOINS_ADMIN_USER`…). Sans garde-fou, un référent
 * pouvait déposer une demande VISANT ce compte :
 *
 *  - « mot de passe oublié » sur le compte administrateur → le robot, connecté
 *    avec ce compte, lui attribue un mot de passe provisoire… qui est ensuite
 *    remis au demandeur par lien sécurisé. Le référent devient administrateur
 *    de l'application métier tout entière.
 *  - « corriger l'identité » → le compte de service est renommé, plus aucun
 *    robot ne peut se connecter.
 *  - « transfert d'établissement » → le compte de service change de périmètre.
 *
 * On refuse donc, au dépôt comme dans le robot, toute démarche qui viserait un
 * de ces comptes, ou qui aboutirait à un identifiant identique au leur.
 *
 * Comptes protégés = le compte d'administration de l'application + la liste
 * facultative `<APP>_PROTECTED_LOGINS` (séparée par des virgules), pour les
 * comptes techniques propres au client (interfaces, exports…).
 */

const { generateLogin } = require('./automation/identifiants');

/** Comparaison tolérante : casse, accents et espaces multiples ignorés. */
function normalise(valeur) {
  return String(valeur || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Identifiants protégés pour une application (jeu de valeurs normalisées). */
function pour(appId) {
  const prefixe = String(appId || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const brut = [
    process.env[`${prefixe}_ADMIN_USER`],
    ...String(process.env[`${prefixe}_PROTECTED_LOGINS`] || '').split(','),
  ];
  return new Set(brut.map(normalise).filter(Boolean));
}

/** Ce compte est-il un compte de service de l'application ? */
function estProtege(appId, identifiant) {
  const cible = normalise(identifiant);
  return Boolean(cible) && pour(appId).has(cible);
}

/**
 * Une identité (nom + prénom) aboutirait-elle à l'identifiant d'un compte de
 * service ? On teste les deux formes utilisées par les applications gérées :
 * « 1re lettre du prénom + nom » (BlueKanGo) et « NOM PRÉNOM » (NetSoins).
 */
function identiteProtegee(appId, prenom, nom) {
  const proteges = pour(appId);
  if (proteges.size === 0) return false;
  const candidats = [generateLogin(prenom, nom), `${nom} ${prenom}`, `${prenom} ${nom}`];
  return candidats.map(normalise).some((c) => c && proteges.has(c));
}

/**
 * Vérifie une demande complète. Renvoie la raison du refus, ou null si la
 * demande ne touche à aucun compte de service.
 */
function refus(appId, data) {
  const d = data || {};
  if (estProtege(appId, d.identifiant)) {
    return `« ${String(d.identifiant).trim()} » est le compte de service utilisé par le robot : aucune démarche ne peut le viser.`;
  }
  if ((d.nom || d.prenom) && identiteProtegee(appId, d.prenom, d.nom)) {
    return "Cette identité aboutirait à l'identifiant d'un compte de service : choisissez une autre orthographe ou contactez votre administrateur.";
  }
  return null;
}

module.exports = { estProtege, identiteProtegee, refus, normalise };
