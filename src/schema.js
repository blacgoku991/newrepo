'use strict';

/**
 * Schémas de formulaires : base (config.js de chaque application) + surcharges
 * éditées depuis le panel admin (table form_overrides), + section « demandeur »
 * ajoutée automatiquement.
 *
 * Format des surcharges :
 * {
 *   patches: { nomDuChamp: { label?, help?, placeholder?, required?, hidden?,
 *                            options?, suggestions?, pattern?, patternMessage? } },
 *   added:   [ { section: "Titre de section" | "__extra__", field: {...} } ],
 *   order:   { "Titre de section": ["champ1", "champ2", …] }
 * }
 *
 * Règles de protection : les champs listés dans config.robotFields (utilisés
 * par le robot pour créer le compte) ne peuvent être ni masqués ni changer de
 * name/type — seuls label, aide, placeholder et options restent modifiables.
 */

const db = require('./db');

const REQUESTER_SECTION = {
  title: 'Vos coordonnées (demandeur)',
  requester: true,
  fields: [
    {
      name: '_demandeur_nom',
      label: 'Votre nom',
      type: 'text',
      required: true,
      placeholder: 'Nom du demandeur',
      help: 'Pour le suivi : qui est à l’origine de cette demande.',
    },
    {
      name: '_demandeur_email',
      label: 'Votre e-mail',
      type: 'email',
      required: false,
      placeholder: 'vous@etablissement.fr',
    },
  ],
};

const EXTRA_SECTION_TITLE = 'Informations complémentaires';

/** Applique les surcharges admin à un schéma de base (retourne une copie). */
function mergeSchema(config, overrides = {}) {
  const robotFields = new Set(config.robotFields || []);
  const patches = overrides.patches || {};
  const added = overrides.added || [];
  const order = overrides.order || {};

  const sections = config.formSchema.sections.map((section) => {
    let fields = section.fields
      .map((field) => {
        const patch = patches[field.name];
        if (!patch) return { ...field };
        const merged = { ...field };
        // Champs protégés : name/type intouchables, jamais masqués.
        for (const key of ['label', 'help', 'placeholder', 'options', 'suggestions', 'pattern', 'patternMessage']) {
          if (patch[key] !== undefined) merged[key] = patch[key];
        }
        if (patch.required !== undefined && !robotFields.has(field.name)) merged.required = !!patch.required;
        if (patch.hidden && !robotFields.has(field.name)) merged._hidden = true;
        return merged;
      })
      .filter((f) => !f._hidden);

    // Champs ajoutés dans cette section.
    for (const add of added) {
      if (add.section === section.title && add.field?.name) fields.push({ ...add.field });
    }

    // Réordonnancement éventuel.
    const wanted = order[section.title];
    if (Array.isArray(wanted) && wanted.length) {
      fields = fields
        .slice()
        .sort((a, b) => {
          const ia = wanted.indexOf(a.name);
          const ib = wanted.indexOf(b.name);
          return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        });
    }

    return { ...section, fields };
  });

  // Champs ajoutés hors sections existantes → section dédiée.
  const extras = added.filter(
    (a) => a.field?.name && !config.formSchema.sections.some((s) => s.title === a.section)
  );
  if (extras.length) {
    sections.push({ title: EXTRA_SECTION_TITLE, fields: extras.map((a) => ({ ...a.field })) });
  }

  return { ...config.formSchema, sections };
}

/** Schéma final servi au frontend : base + surcharges + section demandeur. */
function effectiveSchema(config) {
  const overrides = db.getFormOverrides(config.id);
  const merged = mergeSchema(config, overrides);
  return { ...merged, sections: [...merged.sections, REQUESTER_SECTION] };
}

/** Compat : augmente un schéma brut (sans surcharges) — utilisé par la console démo. */
function augmentSchema(formSchema) {
  return { ...formSchema, sections: [...formSchema.sections, REQUESTER_SECTION] };
}

/** Extrait un libellé « demandeur » lisible depuis les données validées. */
function requesterLabel(data) {
  const nom = (data._demandeur_nom || '').trim();
  const email = (data._demandeur_email || '').trim();
  if (nom && email) return `${nom} <${email}>`;
  return nom || email || 'Anonyme';
}

/** Validation de la structure d'une surcharge envoyée par l'admin. */
function validateOverrides(config, overrides) {
  const errors = [];
  const robotFields = new Set(config.robotFields || []);
  const NAME_RE = /^[a-z0-9_]{1,40}$/;
  const TYPES = ['text', 'email', 'tel', 'date', 'textarea', 'select', 'radio', 'checkboxes'];
  const baseNames = new Set(
    config.formSchema.sections.flatMap((s) => s.fields.map((f) => f.name))
  );

  const patches = overrides.patches || {};
  for (const [name, patch] of Object.entries(patches)) {
    if (!baseNames.has(name)) errors.push(`Champ inconnu : ${name}`);
    if (patch.hidden && robotFields.has(name)) errors.push(`« ${name} » est requis par le robot : il ne peut pas être masqué`);
    if (patch.name || patch.type) errors.push(`Le nom et le type d'un champ existant ne sont pas modifiables (${name})`);
  }

  for (const add of overrides.added || []) {
    const f = add.field || {};
    if (!NAME_RE.test(f.name || '')) errors.push(`Nom de champ ajouté invalide : « ${f.name || ''} » (minuscules/chiffres/underscore)`);
    if (baseNames.has(f.name)) errors.push(`« ${f.name} » existe déjà dans le formulaire`);
    if (!TYPES.includes(f.type)) errors.push(`Type invalide pour « ${f.name} » : ${f.type}`);
    if (['select', 'radio', 'checkboxes'].includes(f.type) && !(Array.isArray(f.options) && f.options.length)) {
      errors.push(`« ${f.name} » (${f.type}) doit avoir des options`);
    }
    if (!f.label) errors.push(`« ${f.name} » doit avoir un libellé`);
  }

  return errors;
}

module.exports = {
  augmentSchema,
  effectiveSchema,
  mergeSchema,
  validateOverrides,
  requesterLabel,
  REQUESTER_SECTION,
  EXTRA_SECTION_TITLE,
};
