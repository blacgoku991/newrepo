'use strict';

const { ETABLISSEMENTS, PROFILS_DROIT, CATEGORIES_PERSONNEL } = require('./data');

module.exports = {
  id: 'netsoins',
  name: 'NetSoins',
  category: 'Dossier de soins',
  description:
    'Dossier de l’usager informatisé : transmissions, plans de soins, prescriptions et traçabilité.',
  icon: 'heart',
  color: '#0d9488',
  order: 2,
  // Logo servi par le portail. Il était chargé depuis l'instance NetSoins d'UN
  // client : tous les autres seraient venus sonner chez lui à chaque page, et
  // l'éditeur aurait su qui consulte quoi, et quand.
  logo: '/img/netsoins',
  logoFallback: '/img/netsoins',
  referencePrefix: 'NS',
  // Champs saisis par le robot : non supprimables/masquables via l'éditeur.
  robotFields: ['nom', 'prenom', 'sexe', 'email', 'etablissement', 'etablissements_autorises', 'categorie_personnel', 'profil_droit', 'date_debut', 'type_contrat', 'date_fin'],

  formSchema: {
    intro:
      'Demande de création d’un intervenant NetSoins. L’établissement, la catégorie de personnel et le profil de droit déterminent l’accès dans le dossier de soins.',
    sections: [
      {
        title: 'Identité de l’intervenant',
        fields: [
          { name: 'nom', label: 'Nom de naissance', type: 'text', required: true, placeholder: 'MARTIN' },
          { name: 'prenom', label: 'Premier prénom', type: 'text', required: true, placeholder: 'Paul' },
          {
            name: 'sexe',
            label: 'Sexe',
            type: 'radio',
            required: true,
            options: [
              { value: 'masculin', label: 'Masculin' },
              { value: 'feminin', label: 'Féminin' },
            ],
          },
          {
            name: 'email',
            label: 'E-mail professionnel',
            type: 'email',
            required: true,
            placeholder: 'paul.martin@adef-residences.com',
          },
        ],
      },
      {
        title: 'Affectation et droits',
        fields: [
          {
            name: 'etablissement',
            label: 'Établissement',
            type: 'select',
            required: true,
            options: ETABLISSEMENTS,
            help: 'Établissement de rattachement principal de l’intervenant.',
          },
          {
            name: 'etablissements_autorises',
            label: 'Autres établissements autorisés',
            type: 'checkboxes',
            required: false,
            options: ETABLISSEMENTS,
            help: 'À cocher si l’intervenant doit accéder à plusieurs établissements (l’établissement principal est déjà inclus).',
          },
          {
            name: 'categorie_personnel',
            label: 'Catégorie de personnel',
            type: 'select',
            required: true,
            options: CATEGORIES_PERSONNEL,
          },
          {
            name: 'profil_droit',
            label: 'Profil de droit (fonction)',
            type: 'select',
            required: true,
            options: PROFILS_DROIT,
            help: 'Détermine les droits d’accès dans NetSoins.',
          },
          {
            name: 'date_debut',
            label: 'Date de prise de poste',
            type: 'date',
            required: false,
            help: 'La demande n’est traitée qu’à partir de cette date (facultatif : immédiat sinon).',
          },
          {
            name: 'type_contrat',
            label: 'Type de contrat',
            type: 'radio',
            required: true,
            options: [
              { value: 'cdi', label: 'CDI — accès sans limite de durée' },
              { value: 'cdd', label: 'CDD / intérim / stage — accès limité dans le temps' },
            ],
            help: 'En CDD, une date limite d’accès est renseignée dans NetSoins : le compte est désactivé automatiquement après cette date.',
          },
          {
            // Affiché (et exigé) uniquement en CDD — voir `showIf`.
            name: 'date_fin',
            label: 'Date limite d’accès',
            type: 'date',
            required: true,
            showIf: { field: 'type_contrat', equals: 'cdd' },
            help: 'Dernier jour d’accès au compte.',
          },
        ],
      },
    ],
  },
};

// Champ « établissement » réutilisé par les démarches reset / extension.
const etabField = { name: 'etablissement', label: 'Établissement', type: 'select', required: true, options: ETABLISSEMENTS };

// Réinitialisation de mot de passe : on retrouve l'intervenant par son identifiant.
module.exports.resetSchema = {
  intro:
    'Le robot recherche l’intervenant par son identifiant exact dans l’établissement indiqué, vérifie qu’il existe, réinitialise son mot de passe et vous transmet le provisoire par lien sécurisé.',
  sections: [
    {
      title: 'Compte concerné',
      fields: [
        {
          name: 'identifiant',
          label: 'Identifiant NetSoins (NOM PRÉNOM)',
          type: 'text',
          required: true,
          placeholder: 'MARTIN PAUL',
          help: 'L’identifiant exact du compte, au format NOM PRÉNOM.',
        },
        { ...etabField, help: 'Établissement auquel le compte est rattaché.' },
        {
          name: 'email',
          label: 'E-mail du titulaire',
          type: 'email',
          required: false,
          placeholder: 'paul.martin@adef-residences.com',
          help: 'Pour recevoir le lien sécurisé de récupération du nouveau mot de passe.',
        },
      ],
    },
  ],
};

// Champ « identifiant du compte concerné », commun aux démarches portant sur un
// compte existant.
const identifiantField = {
  name: 'identifiant',
  label: 'Identifiant NetSoins (NOM PRÉNOM)',
  type: 'text',
  required: true,
  placeholder: 'MARTIN PAUL',
  help: 'L’identifiant exact du compte, tel qu’il figure dans NetSoins.',
};

// Correction de l'identité : nom et/ou prénom mal saisis à la création.
module.exports.identiteSchema = {
  intro:
    'Le robot retrouve l’intervenant, puis corrige son nom de naissance et son premier prénom. L’identifiant de connexion, lui, n’est pas modifié.',
  sections: [
    {
      title: 'Compte à corriger',
      fields: [
        identifiantField,
        { ...etabField, help: 'Établissement auquel le compte est rattaché.' },
      ],
    },
    {
      title: 'Identité corrigée',
      fields: [
        { name: 'nom', label: 'Nom de naissance', type: 'text', required: true, placeholder: 'MARTIN' },
        { name: 'prenom', label: 'Premier prénom', type: 'text', required: true, placeholder: 'Paul' },
      ],
    },
  ],
};

// Transfert : on RETIRE l'établissement d'origine et on rattache le nouveau.
// À distinguer de l'ajout d'établissement, qui cumule les rattachements.
module.exports.transfertSchema = {
  intro:
    'Le robot retire l’établissement d’origine et rattache le nouveau : l’intervenant n’aura plus accès à son établissement précédent. Pour conserver les deux, utilisez « Ajouter un établissement ».',
  sections: [
    {
      title: 'Compte à transférer',
      fields: [
        identifiantField,
        {
          ...etabField,
          name: 'etablissement',
          label: 'Établissement actuel (à retirer)',
          help: 'Établissement dont l’intervenant part.',
        },
        {
          ...etabField,
          name: 'etablissement_cible',
          label: 'Nouvel établissement',
          help: 'Établissement auquel l’intervenant est désormais rattaché.',
        },
      ],
    },
  ],
};

// Ajout d'établissement : on CUMULE les rattachements (l'établissement d'origine
// est conservé). À distinguer du transfert, qui retire l'ancien.
//
// `etablissement` sert à retrouver la fiche : la liste des intervenants NetSoins
// est filtrée par établissement, il faut donc partir de celui où le compte
// existe déjà. `etablissement_cible` est celui à ajouter.
module.exports.extensionSchema = {
  intro:
    'Le robot retrouve l’intervenant dans son établissement actuel, puis lui ajoute le nouvel établissement. Les rattachements existants sont conservés.',
  sections: [
    {
      title: 'Compte concerné',
      fields: [
        identifiantField,
        {
          ...etabField,
          name: 'etablissement',
          label: 'Établissement actuel',
          help: 'Établissement où l’intervenant est déjà rattaché — c’est là que le robot va chercher sa fiche.',
        },
        {
          ...etabField,
          name: 'etablissement_cible',
          label: 'Établissement à ajouter',
          help: 'Établissement supplémentaire à rattacher au compte.',
        },
      ],
    },
  ],
};
