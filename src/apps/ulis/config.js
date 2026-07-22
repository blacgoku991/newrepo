'use strict';

module.exports = {
  id: 'ulis',
  name: 'ULIS',
  category: 'Gestion administrative',
  description:
    'Gestion administrative des usagers : dossiers, facturation et suivi des séjours.',
  icon: 'folder',
  color: '#7c3aed',
  order: 3,
  referencePrefix: 'ULS',
  // Champs saisis par le robot : non supprimables/masquables via l'éditeur.
  robotFields: ['nom', 'prenom', 'matricule', 'email', 'direction', 'role', 'perimetre', 'date_debut'],

  formSchema: {
    intro:
      'Demande de création d’un compte utilisateur ULIS. Le matricule agent est indispensable pour rattacher le compte au dossier RH.',
    sections: [
      {
        title: 'Agent',
        fields: [
          { name: 'nom', label: 'Nom', type: 'text', required: true, placeholder: 'BERNARD' },
          { name: 'prenom', label: 'Prénom', type: 'text', required: true, placeholder: 'Sophie' },
          {
            name: 'matricule',
            label: 'Matricule agent',
            type: 'text',
            required: true,
            pattern: '^[A-Za-z0-9-]{4,12}$',
            patternMessage: 'Matricule attendu : 4 à 12 caractères (lettres, chiffres, tiret)',
            placeholder: 'A12345',
          },
          {
            name: 'email',
            label: 'E-mail professionnel',
            type: 'email',
            required: true,
            placeholder: 'sophie.bernard@etablissement.fr',
          },
        ],
      },
      {
        title: 'Affectation & rôle',
        fields: [
          {
            name: 'direction',
            label: 'Direction / Pôle',
            type: 'select',
            required: true,
            options: [
              { value: 'admissions', label: 'Bureau des admissions' },
              { value: 'facturation', label: 'Facturation' },
              { value: 'social', label: 'Service social' },
              { value: 'direction', label: 'Direction' },
              { value: 'informatique', label: 'Service informatique' },
            ],
          },
          {
            name: 'role',
            label: 'Rôle dans ULIS',
            type: 'radio',
            required: true,
            options: [
              { value: 'consultation', label: 'Consultation des dossiers' },
              { value: 'gestionnaire', label: 'Gestionnaire — création et modification' },
              { value: 'facturier', label: 'Facturier — gestion + facturation' },
              { value: 'superviseur', label: 'Superviseur — tous droits' },
            ],
          },
          {
            name: 'perimetre',
            label: 'Périmètre d’accès',
            type: 'checkboxes',
            required: true,
            options: [
              { value: 'hebergement', label: 'Hébergement permanent' },
              { value: 'temporaire', label: 'Hébergement temporaire' },
              { value: 'accueil-jour', label: 'Accueil de jour' },
              { value: 'domicile', label: 'Services à domicile' },
            ],
          },
        ],
      },
      {
        title: 'Validité du compte',
        fields: [
          { name: 'date_debut', label: 'Date de début', type: 'date', required: true },
          {
            name: 'motif',
            label: 'Motif de la demande',
            type: 'select',
            required: true,
            options: [
              { value: 'embauche', label: 'Nouvelle embauche' },
              { value: 'mobilite', label: 'Mobilité interne' },
              { value: 'remplacement', label: 'Remplacement' },
              { value: 'autre', label: 'Autre (préciser en commentaire)' },
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
