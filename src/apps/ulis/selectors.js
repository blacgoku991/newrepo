'use strict';

/**
 * Sélecteurs de l'interface d'administration ULIS (mode production).
 *
 * ⚠️ À CALIBRER sur votre instance réelle avec
 * `npx playwright codegen https://votre-instance-ulis`
 * puis reportez ici les sélecteurs générés. Voir docs/AUTOMATISATION.md.
 */

module.exports = {
  login: {
    user: 'input[name="username"]',
    password: 'input[name="password"]',
    submit: 'input[type="submit"]',
    loggedInProof: 'text=Administration',
  },
  menu: {
    administration: 'text=Administration',
    comptes: 'text=Comptes utilisateurs',
    creer: 'text=Créer un compte',
  },
  form: {
    nom: 'input[name="nom"]',
    prenom: 'input[name="prenom"]',
    matricule: 'input[name="matricule"]',
    email: 'input[name="email"]',
    direction: 'select[name="direction"]',
    role: (value) => `input[name="role"][value="${value}"]`,
    perimetre: (value) => `input[name="perimetre"][value="${value}"]`,
    dateDebut: 'input[name="date_debut"]',
    save: 'button:has-text("Valider")',
    successProof: '.message-confirmation',
  },
};
