'use strict';

/**
 * Ajoute automatiquement à chaque formulaire une section « Demandeur » :
 * qui fait la demande. Ces champs (préfixés « _ ») sont enregistrés avec la
 * demande pour les statistiques, mais ne sont jamais saisis par le robot dans
 * l'application cible (les scénarios n'utilisent que les champs métier).
 */

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

function augmentSchema(formSchema) {
  return {
    ...formSchema,
    sections: [...formSchema.sections, REQUESTER_SECTION],
  };
}

/** Extrait un libellé « demandeur » lisible depuis les données validées. */
function requesterLabel(data) {
  const nom = (data._demandeur_nom || '').trim();
  const email = (data._demandeur_email || '').trim();
  if (nom && email) return `${nom} <${email}>`;
  return nom || email || 'Anonyme';
}

module.exports = { augmentSchema, requesterLabel, REQUESTER_SECTION };
