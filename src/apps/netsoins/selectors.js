'use strict';

/**
 * Sélecteurs de l'interface d'administration NetSoins (mode production).
 *
 * ⚠️ À CALIBRER sur l'instance réelle avec
 * `npx playwright codegen https://votre-instance.netsoins.fr`
 * puis reportez ici les sélecteurs générés. Voir docs/AUTOMATISATION.md.
 * (Ces valeurs sont des placeholders : le mode démo n'en dépend pas.)
 */

  // ⚠️ Toute l'application NetSoins est rendue DANS UNE IFRAME : les sélecteurs
  // ci-dessous s'appliquent au contenu de cette iframe (voir `frame` dans
  // automation.js), pas à la page de premier niveau.
module.exports = {
  frame: 'iframe',
  login: {
    user: 'input[placeholder="Identifiant"]',
    password: 'input[placeholder="Mot de passe"]',
    submit: 'text="Connexion"',
    // Double authentification (code à usage unique reçu par e-mail).
    otpInput: 'input[placeholder="Code reçu par mail"]',
    otpSubmit: 'text="OK"',
    // Fenêtre d'accueil affichée après connexion (à fermer).
    closePopup: '.button_close > .fa-times',
    loggedInProof: '.button_close > .fa-times',
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
    // Fin de validité du compte (CDD) : case à cocher + date associée.
    finValiditeCheck: 'input[type="checkbox"][name="fin_validite"]',
    dateFin: 'input[name="date_fin"]',
    save: 'button:has-text("Enregistrer")',
    successProof: '.toast-success',
  },
};
