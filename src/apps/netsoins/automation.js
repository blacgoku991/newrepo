'use strict';

/**
 * Scénario de création de compte NetSoins (Teranga Software).
 *
 * - Mode démo (défaut) : le robot pilote la console de démonstration intégrée.
 * - Mode production : AUTOMATION_MODE=production + NETSOINS_URL,
 *   NETSOINS_ADMIN_USER, NETSOINS_ADMIN_PASSWORD dans l'environnement.
 *   Les sélecteurs sont dans ./selectors.js (à calibrer, voir docs/AUTOMATISATION.md).
 */

const { getMode } = require('../../automation/helpers');
const { runScenario } = require('../../automation/engine');
const demo = require('../../automation/demoDriver');
const config = require('./config');
const S = require('./selectors');

const ENV = ['NETSOINS_URL', 'NETSOINS_ADMIN_USER', 'NETSOINS_ADMIN_PASSWORD'];

async function createAccount(data, ctx) {
  if (getMode(ENV) === 'demo') {
    ctx.log('Mode démonstration actif (AUTOMATION_MODE=production pour cibler la vraie application)');
    return demo.createAccount(config, data, ctx);
  }

  const base = process.env.NETSOINS_URL.replace(/\/$/, '');
  const fullName = `${data.prenom} ${data.nom}`;

  return runScenario({
    reference: ctx.reference,
    log: ctx.log,
    successMessage: `Compte NetSoins créé pour ${fullName}`,
    steps: [
      {
        label: 'Ouverture de NetSoins',
        run: (page) => page.goto(base),
      },
      {
        label: 'Connexion avec le compte administrateur',
        run: async (page) => {
          await page.fill(S.login.user, process.env.NETSOINS_ADMIN_USER);
          await page.fill(S.login.password, process.env.NETSOINS_ADMIN_PASSWORD);
          await page.click(S.login.submit);
          await page.waitForSelector(S.login.loggedInProof);
        },
      },
      {
        label: `Sélection de l'établissement « ${data.etablissement} »`,
        run: (page) => page.selectOption(S.etablissementSelect, data.etablissement),
      },
      {
        label: 'Ouverture de Paramétrage > Personnel > Ajouter',
        run: async (page) => {
          await page.click(S.menu.parametrage);
          await page.click(S.menu.personnel);
          await page.click(S.menu.ajouter);
        },
      },
      {
        label: `Saisie de la fiche (${fullName})`,
        run: async (page) => {
          await page.fill(S.form.nom, data.nom);
          await page.fill(S.form.prenom, data.prenom);
          await page.fill(S.form.email, data.email);
          await page.fill(S.form.dateNaissance, data.date_naissance);
          await page.selectOption(S.form.metier, data.metier);
          if (data.numero_pro) await page.fill(S.form.numeroPro, data.numero_pro);
          await page.check(S.form.contrat(data.type_contrat));
        },
      },
      {
        label: "Saisie de la période d'accès et des droits",
        run: async (page) => {
          await page.fill(S.form.dateDebut, data.date_debut);
          if (data.date_fin) await page.fill(S.form.dateFin, data.date_fin);
          await page.selectOption(S.form.droitsMedicament, data.acces_prescriptions);
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
