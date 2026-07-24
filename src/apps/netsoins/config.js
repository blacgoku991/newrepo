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
  // Logo officiel de l'éditeur (repli sur le SVG local /img/netsoins si le
  // chargement échoue). Le domaine est autorisé dans la CSP (img-src).
  logo: 'https://adef.netsoins.com/images/orisha_socialcare_teranga.png',
  logoFallback: '/img/netsoins',
  referencePrefix: 'NS',
  // Champs saisis par le robot : non supprimables/masquables via l'éditeur.
  robotFields: ['nom', 'prenom', 'email', 'etablissement', 'categorie_personnel', 'profil_droit', 'date_debut', 'type_contrat', 'date_fin'],

  formSchema: {
    intro:
      'Demande de création d’un intervenant NetSoins. L’établissement, la catégorie de personnel et le profil de droit déterminent l’accès dans le dossier de soins.',
    sections: [
      {
        title: 'Identité de l’intervenant',
        fields: [
          { name: 'nom', label: 'Nom', type: 'text', required: true, placeholder: 'MARTIN' },
          { name: 'prenom', label: 'Prénom', type: 'text', required: true, placeholder: 'Paul' },
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
            help: 'Établissement de rattachement de l’intervenant.',
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
              { value: 'cdi', label: 'CDI (compte sans date de fin)' },
              { value: 'cdd', label: 'CDD / Intérim / Stage (compte à durée limitée)' },
            ],
            help: 'Un CDD impose une date de fin de validité : le compte est désactivé automatiquement à cette date.',
          },
          {
            name: 'date_fin',
            label: 'Date de fin de validité',
            type: 'date',
            required: true,
            // Affiché et exigé uniquement pour un contrat à durée déterminée.
            showIf: { field: 'type_contrat', equals: 'cdd' },
            help: 'Le robot coche « fin de validité » dans NetSoins et renseigne cette date.',
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

// Ajout d'établissement : on rattache un établissement à un compte existant.
module.exports.extensionSchema = {
  intro:
    'Le robot recherche l’intervenant par son identifiant, puis lui ajoute l’établissement demandé.',
  sections: [
    {
      title: 'Compte et établissement à ajouter',
      fields: [
        {
          name: 'identifiant',
          label: 'Identifiant NetSoins (NOM PRÉNOM)',
          type: 'text',
          required: true,
          placeholder: 'MARTIN PAUL',
        },
        { ...etabField, label: 'Établissement à ajouter', help: 'Établissement à rattacher au compte.' },
      ],
    },
  ],
};
