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
  robotFields: ['nom', 'prenom', 'email', 'etablissement', 'categorie_personnel', 'profil_droit', 'date_debut'],

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
        ],
      },
    ],
  },
};
