'use strict';

/**
 * Validation côté serveur d'une soumission de formulaire
 * par rapport au schéma déclaré dans config.js de l'application.
 *
 * Retourne { data, errors } :
 *   - data   : objet nettoyé ne contenant QUE les champs du schéma
 *   - errors : { champ: "message" } — vide si tout est valide
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[0-9+().\s-]{6,20}$/;

function validate(schema, body) {
  const data = {};
  const errors = {};

  for (const section of schema.sections) {
    for (const field of section.fields) {
      let value = body[field.name];

      if (field.type === 'checkboxes') {
        // Cases à cocher multiples : tableau de valeurs autorisées.
        const arr = Array.isArray(value) ? value : value != null ? [value] : [];
        const allowed = new Set(field.options.map((o) => o.value));
        const clean = arr.filter((v) => allowed.has(v));
        if (field.required && clean.length === 0) {
          errors[field.name] = 'Sélectionnez au moins une option';
        }
        data[field.name] = clean;
        continue;
      }

      value = typeof value === 'string' ? value.trim() : '';

      if (!value) {
        if (field.required) errors[field.name] = 'Ce champ est obligatoire';
        data[field.name] = '';
        continue;
      }

      if (value.length > (field.maxLength || 500)) {
        errors[field.name] = 'Valeur trop longue';
        continue;
      }

      switch (field.type) {
        case 'email':
          if (!EMAIL_RE.test(value)) errors[field.name] = 'Adresse e-mail invalide';
          break;
        case 'tel':
          if (!PHONE_RE.test(value)) errors[field.name] = 'Numéro de téléphone invalide';
          break;
        case 'date':
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) errors[field.name] = 'Date invalide';
          break;
        case 'select':
        case 'radio':
          if (!field.options.some((o) => o.value === value)) {
            errors[field.name] = 'Valeur non autorisée';
          }
          break;
        default:
          break;
      }

      if (field.pattern && !errors[field.name]) {
        if (!new RegExp(field.pattern).test(value)) {
          errors[field.name] = field.patternMessage || 'Format invalide';
        }
      }

      data[field.name] = value;
    }
  }

  return { data, errors };
}

module.exports = { validate };
