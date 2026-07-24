'use strict';

/**
 * Sélecteurs de l'interface d'administration NetSoins (mode production).
 *
 * ⚠️ À CALIBRER sur l'instance réelle avec
 * `npx playwright codegen https://votre-instance.netsoins.fr`
 * puis reportez ici les sélecteurs générés. Voir docs/AUTOMATISATION.md.
 * (Ces valeurs sont des placeholders : le mode démo n'en dépend pas.)
 */

module.exports = {
  login: {
    user: '#username',
    password: '#password',
    submit: '#login-button',
    // Double authentification (OTP par e-mail).
    otpInput: 'input[name="otp"]',
    otpSubmit: 'button:has-text("Valider")',
    loggedInProof: '#etablissement-select',
  },
  etablissementSelect: '#etablissement-select',
  // Liste du personnel (pour la duplication d'un compte modèle).
  userList: {
    search: 'input[type="search"]',
    row: 'table tr',
    duplicateButton: '[id^="duplicate-user-"]',
  },
  menu: {
    parametrage: 'nav >> text=Paramétrage',
    personnel: 'text=Personnel',
    ajouter: 'button:has-text("Ajouter")',
  },
  form: {
    login: 'input[name="identifiant"]',
    nom: 'input[name="nom"]',
    prenom: 'input[name="prenom"]',
    email: 'input[name="email"]',
    // Catégorie de personnel (liste déroulante recherchable).
    categorie: 'select[name="categorie_personnel"]',
    // Profil de droit : case cochée par identifiant interne (attribut data).
    profil: (id) => `input[data="${id}"]`,
    dateDebut: 'input[name="date_debut"]',
    save: 'button:has-text("Enregistrer")',
    successProof: '.toast-success',
  },
};
