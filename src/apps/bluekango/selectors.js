'use strict';

/**
 * Sélecteurs de l'interface d'administration BlueKanGo (mode production).
 *
 * ⚠️ À CALIBRER sur votre instance réelle : enregistrez une création de compte
 * manuelle avec `npx playwright codegen https://votre-instance.bluekango.com`
 * puis reportez ici les sélecteurs générés. Voir docs/AUTOMATISATION.md.
 */

module.exports = {
  login: {
    user: 'input[name="login"]',
    password: 'input[name="password"]',
    submit: 'button[type="submit"]',
    loggedInProof: 'nav.main-menu', // élément visible uniquement une fois connecté
  },
  newUserPath: '/admin/users/new',
  form: {
    civilite: 'select[name="civility"]',
    nom: 'input[name="lastname"]',
    prenom: 'input[name="firstname"]',
    email: 'input[name="email"]',
    telephone: 'input[name="phone"]',
    etablissement: 'select[name="site"]',
    service: 'input[name="department"]',
    fonction: 'input[name="job_title"]',
    profil: (value) => `input[name="profile"][value="${value}"]`,
    module: (value) => `input[name="modules"][value="${value}"]`,
    dateDebut: 'input[name="start_date"]',
    commentaire: 'textarea[name="comment"]',
    save: 'button#save-user',
    successProof: '.notification-success',
  },
};
