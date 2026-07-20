'use strict';

/**
 * Scénario de création de compte ULIS.
 *
 * - Mode démo (défaut) : le robot pilote la console de démonstration intégrée.
 * - Mode production : AUTOMATION_MODE=production + ULIS_URL,
 *   ULIS_ADMIN_USER, ULIS_ADMIN_PASSWORD dans l'environnement.
 *   Les sélecteurs sont dans ./selectors.js (à calibrer, voir docs/AUTOMATISATION.md).
 */

const { getMode } = require('../../automation/helpers');
const { runScenario } = require('../../automation/engine');
const demo = require('../../automation/demoDriver');
const config = require('./config');
const S = require('./selectors');

const ENV = ['ULIS_URL', 'ULIS_ADMIN_USER', 'ULIS_ADMIN_PASSWORD'];

async function createAccount(data, ctx) {
  if (getMode(ENV) === 'demo') {
    ctx.log('Mode démonstration actif (AUTOMATION_MODE=production pour cibler la vraie application)');
    return demo.createAccount(config, data, ctx);
  }

  const base = process.env.ULIS_URL.replace(/\/$/, '');
  const fullName = `${data.prenom} ${data.nom}`;

  return runScenario({
    reference: ctx.reference,
    log: ctx.log,
    successMessage: `Compte ULIS créé pour ${fullName}`,
    steps: [
      {
        label: "Ouverture d'ULIS",
        run: (page) => page.goto(base),
      },
      {
        label: 'Connexion avec le compte administrateur',
        run: async (page) => {
          await page.fill(S.login.user, process.env.ULIS_ADMIN_USER);
          await page.fill(S.login.password, process.env.ULIS_ADMIN_PASSWORD);
          await page.click(S.login.submit);
          await page.waitForSelector(S.login.loggedInProof);
        },
      },
      {
        label: 'Ouverture de Administration > Comptes utilisateurs > Créer',
        run: async (page) => {
          await page.click(S.menu.administration);
          await page.click(S.menu.comptes);
          await page.click(S.menu.creer);
        },
      },
      {
        label: `Saisie du compte (${fullName}, matricule ${data.matricule})`,
        run: async (page) => {
          await page.fill(S.form.nom, data.nom);
          await page.fill(S.form.prenom, data.prenom);
          await page.fill(S.form.matricule, data.matricule);
          await page.fill(S.form.email, data.email);
          await page.selectOption(S.form.direction, data.direction);
        },
      },
      {
        label: `Application du rôle « ${data.role} » et du périmètre`,
        run: async (page) => {
          await page.check(S.form.role(data.role));
          for (const p of data.perimetre) await page.check(S.form.perimetre(p));
          await page.fill(S.form.dateDebut, data.date_debut);
        },
      },
      {
        label: 'Enregistrement et vérification',
        run: async (page) => {
          await page.click(S.form.save);
          await page.waitForSelector(S.form.successProof);
        },
      },
    ],
  });
}

module.exports = { createAccount };
