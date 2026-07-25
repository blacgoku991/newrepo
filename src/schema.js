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
const demarches = require('./demarches');

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
  return avecCodes({ ...merged, sections: [...merged.sections, REQUESTER_SECTION] });
}

/**
 * Champs communs à toutes les démarches portant sur un compte existant : ils
 * sont demandés une seule fois dans le formulaire composé, pas une fois par
 * branche.
 */
const CHAMPS_COMMUNS = ['identifiant', 'etablissement'];

/** Libellés du champ commun « établissement » dans un formulaire composé. */
const ETAB_COMMUN = {
  label: 'Établissement du compte',
  help: 'Établissement auquel le compte est rattaché aujourd’hui — c’est là que le robot va chercher la fiche.',
};

const tousLesChamps = (schema) => schema.sections.flatMap((s) => s.fields);

/**
 * Code établissement affiché dans les formulaires. La valeur d'option EST le
 * code interne de l'application (BlueKanGo « 71 », NetSoins « 778 ») : on
 * l'expose à part plutôt que de le coller dans le libellé, car les scénarios
 * analysent ces libellés (repérage du profil, messages de suivi).
 */
const CHAMPS_ETABLISSEMENT = /^etablissement/;

function avecCodes(schema) {
  return {
    ...schema,
    sections: schema.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        if (!CHAMPS_ETABLISSEMENT.test(field.name) || !Array.isArray(field.options)) return field;
        return {
          ...field,
          options: field.options.map((o) => (o.code ? o : { ...o, code: String(o.value) })),
        };
      }),
    })),
  };
}

/**
 * Schéma d'une démarche composée (ex. « Mettre à jour un compte ») : construit
 * à partir des schémas des branches réellement disponibles, sans les dupliquer.
 *
 *   1. le choix de l'opération (radio) ;
 *   2. le compte concerné (identifiant + établissement, demandés une fois) ;
 *   3. les champs propres à chaque branche, conditionnés par `showIf`.
 *
 * Deux branches déclarant le même champ le partagent (la condition devient un
 * `in` sur les deux valeurs) : dans une même application, un même nom de champ
 * désigne la même chose.
 */
function buildComposedSchema(config, type, automation) {
  const c = demarches.composee(type);
  const branches = demarches.branches(type, config, automation);
  if (!c || branches.length === 0) return null;

  const schemaDe = (branche) => config[demarches.get(branche.type).schema];

  // Champs communs : pris sur la première branche disponible qui les déclare.
  const communs = [];
  for (const name of CHAMPS_COMMUNS) {
    for (const branche of branches) {
      const champ = tousLesChamps(schemaDe(branche)).find((f) => f.name === name);
      if (champ) {
        communs.push(name === 'etablissement' ? { ...champ, ...ETAB_COMMUN } : { ...champ });
        break;
      }
    }
  }

  // Champs propres aux branches, masqués tant que l'opération n'est pas choisie.
  const specifiques = [];
  for (const branche of branches) {
    for (const champ of tousLesChamps(schemaDe(branche))) {
      if (CHAMPS_COMMUNS.includes(champ.name)) continue;
      const deja = specifiques.find((f) => f.name === champ.name);
      if (deja) {
        deja.showIf.in.push(branche.value);
        continue;
      }
      specifiques.push({ ...champ, showIf: { field: c.champ, in: [branche.value] } });
    }
  }

  const sections = [
    {
      title: c.section || c.titre,
      fields: [
        {
          name: c.champ,
          label: c.titre,
          type: 'radio',
          required: true,
          options: branches.map((b) => ({ value: b.value, label: b.label, help: b.help })),
        },
      ],
    },
    { title: 'Compte concerné', fields: communs },
  ];
  if (specifiques.length) sections.push({ title: 'Détail de la mise à jour', fields: specifiques });

  return { intro: c.intro, sections };
}

/**
 * Schéma servi pour une démarche donnée, section demandeur incluse.
 * La création passe par les surcharges de l'éditeur d'admin ; les autres
 * démarches s'appuient sur le schéma déclaré dans la configuration, et les
 * démarches composées sont assemblées à partir de leurs branches.
 * Renvoie null si l'application ne propose pas cette démarche.
 */
function effectiveSchemaFor(config, type, automation) {
  if (demarches.estComposee(type)) {
    const compose = buildComposedSchema(config, type, automation);
    return compose ? avecCodes({ ...compose, sections: [...compose.sections, REQUESTER_SECTION] }) : null;
  }
  const d = demarches.get(type);
  if (!d) return null;
  if (d.schema === 'formSchema') return effectiveSchema(config);
  const brut = config[d.schema];
  if (!brut) return null;
  return avecCodes({ ...brut, sections: [...brut.sections, REQUESTER_SECTION] });
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
  effectiveSchemaFor,
  buildComposedSchema,
  avecCodes,
  mergeSchema,
  validateOverrides,
  requesterLabel,
  REQUESTER_SECTION,
  EXTRA_SECTION_TITLE,
};
