'use strict';

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
  robotFields: ['nom', 'prenom', 'email', 'etablissement', 'metier', 'type_contrat', 'date_debut', 'acces_prescriptions'],

  formSchema: {
    intro:
      'Demande de création d’un compte soignant NetSoins. Le rôle et le n° professionnel conditionnent les droits dans le dossier de soins.',
    sections: [
      {
        title: 'Identité du professionnel',
        fields: [
          { name: 'nom', label: 'Nom', type: 'text', required: true, placeholder: 'MARTIN' },
          { name: 'prenom', label: 'Prénom', type: 'text', required: true, placeholder: 'Paul' },
          {
            name: 'email',
            label: 'E-mail professionnel',
            type: 'email',
            required: true,
            placeholder: 'paul.martin@etablissement.fr',
          },
          {
            name: 'date_naissance',
            label: 'Date de naissance',
            type: 'date',
            required: true,
            help: 'Utilisée pour distinguer les homonymes dans NetSoins.',
          },
        ],
      },
      {
        title: 'Situation professionnelle',
        fields: [
          {
            name: 'etablissement',
            label: 'Établissement',
            type: 'select',
            required: true,
            options: [
              { value: 'ehpad-les-tilleuls', label: 'EHPAD Les Tilleuls' },
              { value: 'ehpad-bellevue', label: 'EHPAD Bellevue' },
              { value: 'residence-du-parc', label: 'Résidence du Parc' },
            ],
          },
          {
            name: 'metier',
            label: 'Métier',
            type: 'select',
            required: true,
            options: [
              { value: 'ide', label: 'Infirmier(ère) — IDE' },
              { value: 'as', label: 'Aide-soignant(e)' },
              { value: 'medecin', label: 'Médecin' },
              { value: 'psychologue', label: 'Psychologue' },
              { value: 'kine', label: 'Kinésithérapeute' },
              { value: 'animation', label: 'Animation / Vie sociale' },
              { value: 'direction', label: 'Direction / Administration' },
            ],
          },
          {
            name: 'numero_pro',
            label: 'N° RPPS / ADELI',
            type: 'text',
            required: false,
            pattern: '^[0-9]{9,11}$',
            patternMessage: 'Le numéro doit comporter 9 à 11 chiffres',
            placeholder: '10001234567',
            help: 'Obligatoire pour les professions réglementées (IDE, médecin…).',
          },
          {
            name: 'type_contrat',
            label: 'Type de contrat',
            type: 'radio',
            required: true,
            options: [
              { value: 'cdi', label: 'CDI' },
              { value: 'cdd', label: 'CDD' },
              { value: 'interim', label: 'Intérim / Vacation' },
              { value: 'stage', label: 'Stage' },
            ],
          },
        ],
      },
      {
        title: 'Accès demandé',
        fields: [
          {
            name: 'date_debut',
            label: 'Date de prise de poste',
            type: 'date',
            required: true,
          },
          {
            name: 'date_fin',
            label: 'Date de fin (CDD, intérim, stage)',
            type: 'date',
            required: false,
            help: 'Le compte sera automatiquement désactivé à cette date.',
          },
          {
            name: 'acces_prescriptions',
            label: 'Accès au circuit du médicament',
            type: 'radio',
            required: true,
            options: [
              { value: 'aucun', label: 'Aucun' },
              { value: 'consultation', label: 'Consultation' },
              { value: 'administration', label: 'Administration des traitements' },
              { value: 'prescription', label: 'Prescription (médecins uniquement)' },
            ],
          },
          {
            name: 'commentaire',
            label: 'Commentaire (facultatif)',
            type: 'textarea',
            required: false,
          },
        ],
      },
    ],
  },
};
