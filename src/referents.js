'use strict';

/**
 * Référents autorisés — habilitation par établissement.
 *
 * Pour chaque établissement, un petit nombre de personnes (leur compte
 * Microsoft 365) sont habilitées à déposer des demandes. Ces personnes
 * disposent d'un espace personnel qui liste les comptes de leur(s)
 * établissement(s), avec des actions pré-remplies (réinitialisation de mot
 * de passe, ajout d'établissement) sur chacun.
 *
 * Garde-fou de déploiement : tant qu'AUCUN référent n'est enregistré, la
 * restriction n'est pas active (le site fonctionne comme avant). Dès qu'au
 * moins un référent existe et que le SSO est requis, seuls les référents
 * actifs peuvent déposer des demandes et ouvrir un espace personnel.
 */

const db = require('./db');
const registry = require('./registry');
const sso = require('./sso');
const habilitation = require('./habilitation');

/** Options « établissement » d'une application ({value,label}), pour le picker admin. */
function establishmentsFor(appId) {
  const entry = registry.get(appId);
  if (!entry || !entry.config || !entry.config.formSchema) return [];
  for (const section of entry.config.formSchema.sections || []) {
    const field = (section.fields || []).find((f) => f.name === 'etablissement');
    if (field && Array.isArray(field.options)) {
      return field.options.map((o) => ({ value: String(o.value), label: o.label }));
    }
  }
  return [];
}

/** Libellé d'un établissement à partir de sa valeur (ou la valeur brute). */
function labelFor(appId, value) {
  const found = establishmentsFor(appId).find((o) => o.value === String(value));
  return found ? found.label : String(value || '');
}

/** Le contrôle d'accès est-il actif ? (dès que le SSO est requis). */
function enforced() {
  // La porte reste fermée par défaut au sens où il faut être connecté ; ce que
  // « être habilité » veut dire dépend de la politique choisie (habilitation.js) :
  // tout le tenant, les porteurs d'un attribut, ou les référents déclarés.
  return sso.required();
}

/** Tous les établissements connus, application par application. */
function tousEtablissements() {
  const out = [];
  for (const app of registry.publicList()) {
    if (app.comingSoon) continue;
    for (const opt of establishmentsFor(app.id)) {
      out.push({ appId: app.id, value: opt.value, label: opt.label });
    }
  }
  return out;
}

/**
 * Référent effectif de l'utilisateur connecté, ou null s'il n'a pas accès.
 *
 * Une fiche référent l'emporte toujours : elle restreint la portée aux
 * établissements déclarés. Sans fiche, si la politique d'accès ouvre la porte
 * (tenant, ou attribut satisfait), on rend un référent « de plein exercice »
 * dont la portée couvre tous les établissements.
 */
function resolve(req) {
  const user = sso.currentUser(req);
  if (!user || !user.email) return null;

  const ref = db.getReferentByEmail(user.email);
  if (ref && ref.active) return ref;
  // Une fiche désactivée est un refus explicite : la politique ne la contourne pas.
  if (ref && !ref.active) return null;

  const porte = habilitation.ouvertePour(req);
  if (!porte.ok) return null;
  return {
    id: null,
    email: user.email,
    prenom: user.prenom || '',
    nom: user.nom || '',
    active: 1,
    tous: true,
    origine: porte.detail,
    etablissements: tousEtablissements(),
  };
}

/** Motif de refus, pour le message et le journal. */
function refus(req) {
  const user = sso.currentUser(req);
  if (!user) return 'Connectez-vous avec votre compte Microsoft 365 pour déposer une demande.';
  const ref = db.getReferentByEmail(user.email);
  if (ref && !ref.active) return 'Votre habilitation a été désactivée. Contactez votre administrateur.';
  if (habilitation.mode() === 'attribut') {
    return "Votre compte Microsoft 365 ne porte pas l'attribut requis pour utiliser ce portail. Contactez votre administrateur.";
  }
  return "Votre compte n'est pas habilité à déposer des demandes. Contactez votre administrateur pour être ajouté comme référent de votre établissement.";
}

/** Valeurs d'établissement rattachées à ce référent pour une application. */
function allowedEtablissements(ref, appId) {
  return ((ref && ref.etablissements) || [])
    .filter((e) => e.appId === appId)
    .map((e) => String(e.value));
}

/**
 * Le référent est-il habilité sur cet établissement ?
 *
 * Être référent ne suffit pas : chaque demande porte sur un établissement
 * précis, et agir dessus (créer un compte, réinitialiser un mot de passe,
 * rattacher un établissement) donne accès aux données de cet établissement.
 * Sans ce contrôle, un référent pourrait viser n'importe quel établissement du
 * groupe en modifiant simplement la valeur envoyée.
 */
function allows(ref, appId, value) {
  if (!ref) return false;
  // Portée « tous les établissements » : accordée par la politique d'accès à
  // qui n'a pas de fiche nominative. Une fiche, elle, reste limitative.
  if (ref.tous === true) return true;
  return allowedEtablissements(ref, appId).includes(String(value));
}

module.exports = {
  establishmentsFor, labelFor, enforced, resolve, refus,
  allowedEtablissements, allows, tousEtablissements,
};
