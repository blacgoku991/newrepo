'use strict';

/**
 * Sélecteurs de l'interface d'administration NetSoins (mode production).
 *
 * ⚠️ À CALIBRER sur votre instance réelle avec
 * `npx playwright codegen https://votre-instance.netsoins.fr`
 * puis reportez ici les sélecteurs générés. Voir docs/AUTOMATISATION.md.
 */

module.exports = {
  login: {
    user: '#username',
    password: '#password',
    submit: '#login-button',
    loggedInProof: '#etablissement-select',
  },
  etablissementSelect: '#etablissement-select',
  menu: {
    parametrage: 'nav >> text=Paramétrage',
    personnel: 'text=Personnel',
    ajouter: 'button:has-text("Ajouter")',
  },
  form: {
    nom: 'input[name="nom"]',
    prenom: 'input[name="prenom"]',
    email: 'input[name="email"]',
    dateNaissance: 'input[name="date_naissance"]',
    metier: 'select[name="metier"]',
    numeroPro: 'input[name="rpps"]',
    contrat: (value) => `input[name="contrat"][value="${value}"]`,
    dateDebut: 'input[name="date_debut"]',
    dateFin: 'input[name="date_fin"]',
    droitsMedicament: 'select[name="droits_medicament"]',
    save: 'button:has-text("Enregistrer")',
    successProof: '.toast-success',
  },
};
