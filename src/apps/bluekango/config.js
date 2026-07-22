'use strict';

/**
 * BlueKanGo — instance ADEF Résidences.
 *
 * Le compte est créé par DUPLICATION : le robot sélectionne l'établissement,
 * cherche dans la liste des utilisateurs une personne ayant la même fonction,
 * clique « Dupliquer » (le nouveau compte hérite ainsi des mêmes droits),
 * puis saisit l'identité et les identifiants de connexion.
 *
 * Les valeurs des établissements sont les vraies valeurs du select
 * #change_etab de BlueKanGo : aucune table de conversion nécessaire.
 */

module.exports = {
  id: 'bluekango',
  name: 'BlueKanGo',
  category: 'Qualité & Gestion des risques',
  description:
    'Plateforme QHSE : gestion documentaire, événements indésirables, audits et plans d’action.',
  icon: 'shield',
  color: '#2563eb',
  order: 1,
  logo: '/img/bluekango',
  referencePrefix: 'BKG',
  // Champs saisis par le robot : non supprimables/masquables via l'éditeur.
  robotFields: ['civilite', 'nom', 'prenom', 'etablissement', 'fonction'],

  formSchema: {
    intro:
      'Le compte BlueKanGo sera créé en dupliquant un utilisateur de votre établissement ayant la même fonction : le nouveau compte hérite automatiquement des mêmes droits d’accès.',
    sections: [
      {
        title: 'Identité de l’utilisateur',
        fields: [
          {
            name: 'civilite',
            label: 'Civilité',
            type: 'radio',
            required: true,
            options: [
              { value: 'm', label: 'M.' },
              { value: 'mlle', label: 'Mlle' },
              { value: 'mme', label: 'Mme' },
              { value: 'sans', label: 'Sans civilité' },
            ],
          },
          { name: 'nom', label: 'Nom', type: 'text', required: true, placeholder: 'DUPONT' },
          { name: 'prenom', label: 'Prénom', type: 'text', required: true, placeholder: 'Marie' },
          {
            name: 'email',
            label: 'E-mail professionnel',
            type: 'email',
            required: false,
            placeholder: 'marie.dupont@adef-residences.com',
            help: 'Pour le suivi de la demande. L’identifiant BlueKanGo est généré automatiquement (1re lettre du prénom + nom).',
          },
        ],
      },
      {
        title: 'Affectation',
        fields: [
          {
            name: 'etablissement',
            label: 'Établissement',
            type: 'select',
            required: true,
            options: [
              { value: '71', label: 'ANNONAY - Mon Foyer' },
              { value: '23', label: 'ARCUEIL - La Maison du Grand Cèdre' },
              { value: '81', label: 'ARGENTAT - La Maison des Iris' },
              { value: '73', label: 'AUCH - La Maison des Rosiers de Jeanne' },
              { value: '12', label: 'AUDENGE - La Maison des Cotonniers' },
              { value: '10', label: 'BIZANET - La Maison des Arbousiers' },
              { value: '6', label: 'BONDY - La Maison de l’Eglantier' },
              { value: '84', label: 'CHAMPAGNOLE - La Maison de la Roselière' },
              { value: '2', label: 'CHAUMONT - La Maison de l’Osier Pourpre' },
              { value: '31', label: 'CHELLES - La Maison du Tilleul Argenté' },
              { value: '51', label: 'CHOISY LE ROI - Ehpad Chantereine' },
              { value: '7', label: 'CLAMART - La Maison de L’Erable Argenté' },
              { value: '56', label: 'CLERMONT FERRAND - La Maison des Champs Fleuris' },
              { value: '24', label: 'COMBS LA VILLE - La Maison du Grand Chène' },
              { value: '11', label: 'CORBEIL ESSONNES - La Maison des Clématites' },
              { value: '37', label: 'DORMANS - La Maison des Séquoias' },
              { value: '18', label: 'FOURCHAMBAULT - La Maison des Verdiaux' },
              { value: '41', label: 'GAUCHY - La Maison du Sophora' },
              { value: '13', label: 'GENNEVILLIERS - La Maison des Cytises' },
              { value: '28', label: 'GERZAT - La Maison du Marronnier Blanc' },
              { value: '74', label: 'GLANES - La Maison des coteaux de Glanes' },
              { value: '53', label: 'HUSSIGNY - La Maison des Cerisiers' },
              { value: '42', label: 'LA FERTE GAUCHER - La Maison du Sorbier des Oiseleurs' },
              { value: '59', label: 'LA FLECHE - Le Manoir' },
              { value: '21', label: 'LA VALLEE AU BLE - La Maison du Clos des Marronniers' },
              { value: '14', label: 'LE BOURGET - La Maison des Glycines' },
              { value: '83', label: 'LE VIGNON EN QUERCY - Résidence la Cerisaie' },
              { value: '3', label: 'LEUVILLE SUR ORGE - La Maison de la Châtaigneraie' },
              { value: '17', label: 'LEXY - La Maison des Mirabelliers' },
              { value: '48', label: 'LORIENT - La Maison des Tamaris' },
              { value: '22', label: 'LOUVIGNY - La Maison du Coudrier' },
              { value: '36', label: 'MALAUNAY - La Maison des Lys' },
              { value: '19', label: 'MALZEVILLE - La Maison des Vignes' },
              { value: '72', label: 'MARANVILLE - La Maison Marie Pocard' },
              { value: '35', label: 'MAULE - La Maison des Aulnes' },
              { value: '39', label: 'MERCOEUR - La Maison du Douglas' },
              { value: '60', label: 'MORET LOING ORVANNE - La Maison Source Nadon' },
              { value: '68', label: 'MOREZ - Habitats partagés' },
              { value: '38', label: 'MOREZ - La Maison du Bois Joli' },
              { value: '15', label: 'MORSANG SUR ORGE - La Maison des Merisiers' },
              { value: '30', label: 'ORLY - La Maison du Saule Cendré' },
              { value: '29', label: 'PARIS - La Maison du Parc' },
              { value: '34', label: 'PIERREFITTE SUR SEINE - La Maison de l’Alisier' },
              { value: '66', label: 'RA CHAUMONT - Résidence Eugénie de Baudel' },
              { value: '70', label: 'RA LORIENT - La Résidence des Tamaris' },
              { value: '69', label: 'RA MORET-LOING - Les Roses' },
              { value: '65', label: 'RILHAC - La Maison des trois chênes' },
              { value: '75', label: 'ROQUEBRUNE SUR ARGENS - Habitat inclusif' },
              { value: '16', label: 'ROQUEBRUNE SUR ARGENS - La Maison des Micocouliers' },
              { value: '82', label: 'ROQUEBRUNE SUR ARGENS - Micro Crèche' },
              { value: '52', label: 'RUNGIS - Ehpad Les Sorières' },
              { value: '67', label: 'SAINT DENIS - Habitats partagés' },
              { value: '26', label: 'SAINT DENIS - La Maison du Laurier Noble' },
              { value: '40', label: 'SAINT DENIS MAS - La Maison du Pommier Pourpre' },
              { value: '8', label: 'SAINT DIZIER - La Maison de l’Orme Doré' },
              { value: '33', label: 'SAINT JULIEN DE L’ARS - La Maison de la Forêt des Charmes' },
              { value: '9', label: 'SAINT JUST EN CHAUSSEE - La Maison des Acacias' },
              { value: '5', label: 'SAINT MARCEL - La Maison de l’Amandier' },
              { value: '20', label: 'SAINT PIERRE DU PERRAY - La Maison du Cèdre Bleu' },
              { value: '80', label: 'SAINTES - La Maison des Pensées de Jeanne' },
              { value: '47', label: 'SARRAN - L’odyssée des sens' },
              { value: '58', label: 'SAUMAN' },
              { value: '57', label: 'SAUMAN VIGNOBLE' },
              { value: '46', label: 'SIEGE' },
              { value: '50', label: 'SSIAD CHELLES' },
              { value: '4', label: 'STAINS - La Maison de la Vallée des Fleurs' },
              { value: '64', label: 'TOULON - La Maison des Oliviers de Jeanne' },
              { value: '27', label: 'TRUCHTERSHEIM - La Maison du Lendehof' },
              { value: '32', label: 'VENISSIEUX - La Maison du Tulipier' },
              { value: '25', label: 'VILLECRESNES - La Maison du Jardin des Roses' },
              { value: '43', label: 'VILLELAURE - La maison du parc aux cyprès' },
              { value: '49', label: 'VILLENEUVE LA GARENNE - Hôpital 92' },
            ],
          },
          {
            name: 'fonction',
            label: 'Fonction',
            type: 'text',
            required: true,
            placeholder: 'Choisissez ou saisissez la fonction',
            // Liste commune à tous les établissements (à COMPLÉTER avec l'export
            // Excel des fonctions ADEF). L'utilisateur peut choisir dans la liste
            // ou saisir une fonction absente. La correspondance avec BlueKanGo est
            // partielle et insensible à la casse lors de la duplication.
            suggestions: [
              'RESPONSABLE HOTELIER (E)',
              'AGENT D\'ADMISSION FACTURATION',
              'REFERENT COMPTABLE ADEF R',
              'MEDECIN COORDONNATEUR(RICE)',
              'PSYCHOLOGUE',
            ],
            help: 'Telle qu’elle apparaît dans BlueKanGo. Le robot duplique un utilisateur de l’établissement ayant cette fonction : le nouveau compte hérite des mêmes droits.',
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
