'use strict';

module.exports = {
  id: 'bluekango',
  name: 'BlueKanGo',
  category: 'Qualité & Gestion des risques',
  description:
    'Plateforme QHSE : gestion documentaire, événements indésirables, audits et plans d’action.',
  icon: 'shield',
  color: '#2563eb',
  order: 1,
  referencePrefix: 'BKG',

  formSchema: {
    intro:
      'Renseignez les informations du futur utilisateur BlueKanGo. Le compte sera créé automatiquement avec le profil demandé.',
    sections: [
      {
        title: 'Identité de l’utilisateur',
        fields: [
          {
            name: 'civilite',
            label: 'Civilité',
            type: 'select',
            required: true,
            options: [
              { value: 'mme', label: 'Madame' },
              { value: 'm', label: 'Monsieur' },
            ],
          },
          { name: 'nom', label: 'Nom', type: 'text', required: true, placeholder: 'DUPONT' },
          { name: 'prenom', label: 'Prénom', type: 'text', required: true, placeholder: 'Marie' },
          {
            name: 'email',
            label: 'E-mail professionnel',
            type: 'email',
            required: true,
            placeholder: 'marie.dupont@etablissement.fr',
            help: 'L’identifiant BlueKanGo et le mot de passe initial seront envoyés à cette adresse.',
          },
          {
            name: 'telephone',
            label: 'Téléphone',
            type: 'tel',
            required: false,
            placeholder: '06 12 34 56 78',
          },
        ],
      },
      {
        title: 'Affectation',
        fields: [
          {
            name: 'etablissement',
            label: 'Établissement / Site',
            type: 'select',
            required: true,
            options: [
              { value: 'siege', label: 'Siège' },
              { value: 'site-nord', label: 'Site Nord' },
              { value: 'site-sud', label: 'Site Sud' },
              { value: 'site-est', label: 'Site Est' },
            ],
          },
          {
            name: 'service',
            label: 'Service',
            type: 'text',
            required: true,
            placeholder: 'Qualité, RH, Soins…',
          },
          {
            name: 'fonction',
            label: 'Fonction',
            type: 'text',
            required: true,
            placeholder: 'Responsable qualité',
          },
        ],
      },
      {
        title: 'Droits d’accès',
        fields: [
          {
            name: 'profil',
            label: 'Profil BlueKanGo',
            type: 'radio',
            required: true,
            options: [
              { value: 'lecteur', label: 'Lecteur — consultation uniquement' },
              { value: 'contributeur', label: 'Contributeur — déclaration et traitement' },
              { value: 'administrateur', label: 'Administrateur — paramétrage complet' },
            ],
          },
          {
            name: 'modules',
            label: 'Modules à activer',
            type: 'checkboxes',
            required: true,
            options: [
              { value: 'ged', label: 'Gestion documentaire (GED)' },
              { value: 'ei', label: 'Événements indésirables' },
              { value: 'audits', label: 'Audits & évaluations' },
              { value: 'actions', label: 'Plans d’action' },
            ],
          },
          {
            name: 'date_debut',
            label: 'Date de début d’accès souhaitée',
            type: 'date',
            required: true,
          },
          {
            name: 'commentaire',
            label: 'Commentaire (facultatif)',
            type: 'textarea',
            required: false,
            placeholder: 'Précisions utiles pour la création du compte…',
          },
        ],
      },
    ],
  },
};
