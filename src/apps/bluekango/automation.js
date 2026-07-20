'use strict';

/**
 * Scénario de création de compte BlueKanGo.
 *
 * - Mode démo (défaut) : le robot pilote la console de démonstration intégrée.
 * - Mode production : AUTOMATION_MODE=production + BLUEKANGO_URL,
 *   BLUEKANGO_ADMIN_USER, BLUEKANGO_ADMIN_PASSWORD dans l'environnement.
 *   Les sélecteurs sont dans ./selectors.js (à calibrer, voir docs/AUTOMATISATION.md).
 */

const { getMode } = require('../../automation/helpers');
const { runScenario } = require('../../automation/engine');
const demo = require('../../automation/demoDriver');
const config = require('./config');
const S = require('./selectors');

const ENV = ['BLUEKANGO_URL', 'BLUEKANGO_ADMIN_USER', 'BLUEKANGO_ADMIN_PASSWORD'];

async function createAccount(data, ctx) {
  if (getMode(ENV) === 'demo') {
    ctx.log('Mode démonstration actif (AUTOMATION_MODE=production pour cibler la vraie application)');
    return demo.createAccount(config, data, ctx);
  }

  const base = process.env.BLUEKANGO_URL.replace(/\/$/, '');
  const fullName = `${data.prenom} ${data.nom}`;

  return runScenario({
    reference: ctx.reference,
    log: ctx.log,
    successMessage: `Compte BlueKanGo créé pour ${fullName}`,
    steps: [
      {
        label: 'Ouverture de BlueKanGo',
        run: (page) => page.goto(base),
      },
      {
        label: 'Connexion avec le compte administrateur',
        run: async (page) => {
          await page.fill(S.login.user, process.env.BLUEKANGO_ADMIN_USER);
          await page.fill(S.login.password, process.env.BLUEKANGO_ADMIN_PASSWORD);
          await page.click(S.login.submit);
          await page.waitForSelector(S.login.loggedInProof);
        },
      },
      {
        label: 'Ouverture du formulaire « Nouvel utilisateur »',
        run: (page) => page.goto(base + S.newUserPath),
      },
      {
        label: `Saisie de l'identité (${fullName})`,
        run: async (page) => {
          await page.selectOption(S.form.civilite, data.civilite);
          await page.fill(S.form.nom, data.nom);
          await page.fill(S.form.prenom, data.prenom);
          await page.fill(S.form.email, data.email);
          if (data.telephone) await page.fill(S.form.telephone, data.telephone);
        },
      },
      {
        label: "Saisie de l'affectation",
        run: async (page) => {
          await page.selectOption(S.form.etablissement, data.etablissement);
          await page.fill(S.form.service, data.service);
          await page.fill(S.form.fonction, data.fonction);
        },
      },
      {
        label: `Application du profil « ${data.profil} » et des modules`,
        run: async (page) => {
          await page.check(S.form.profil(data.profil));
          for (const mod of data.modules) await page.check(S.form.module(mod));
          await page.fill(S.form.dateDebut, data.date_debut);
          if (data.commentaire) await page.fill(S.form.commentaire, data.commentaire);
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
