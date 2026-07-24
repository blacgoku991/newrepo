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

/** Le contrôle des référents est-il actif ? (SSO requis + au moins un référent). */
function enforced() {
  return sso.required() && db.countReferents() > 0;
}

/** Référent actif correspondant à l'utilisateur SSO connecté, ou null. */
function resolve(req) {
  const user = sso.currentUser(req);
  if (!user || !user.email) return null;
  const ref = db.getReferentByEmail(user.email);
  return ref && ref.active ? ref : null;
}

module.exports = { establishmentsFor, labelFor, enforced, resolve };
