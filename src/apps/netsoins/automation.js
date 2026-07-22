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
const { applySelectorPatches, composeSteps } = require('../../automation/scenarioRuntime');
const demo = require('../../automation/demoDriver');
const config = require('./config');
const BASE_SELECTORS = require('./selectors');

const ENV = ['NETSOINS_URL', 'NETSOINS_ADMIN_USER', 'NETSOINS_ADMIN_PASSWORD'];

/** Métadonnées des étapes pour l'éditeur de scénario (toutes critiques : sélecteurs modifiables, étapes personnalisées insérables). */
const STEPS_META = [
  { id: 'ouverture', label: 'Ouverture de NetSoins', critical: true, selectorKeys: [] },
  { id: 'connexion', label: 'Connexion administrateur', critical: true, selectorKeys: ['login.user', 'login.password', 'login.submit'] },
  { id: 'etablissement', label: "Sélection de l'établissement", critical: true, selectorKeys: ['etablissementSelect'] },
  { id: 'menu', label: 'Paramétrage > Personnel > Ajouter', critical: true, selectorKeys: [] },
  { id: 'fiche', label: 'Saisie de la fiche', critical: true, selectorKeys: ['form.nom', 'form.prenom', 'form.email'] },
  { id: 'acces', label: "Période d'accès et droits", critical: true, selectorKeys: ['form.dateDebut', 'form.droitsMedicament'] },
  { id: 'enregistrement', label: 'Enregistrement et vérification', critical: true, selectorKeys: ['form.save', 'form.successProof'] },
];

async function createAccount(data, ctx) {
  if (getMode(ENV) === 'demo') {
    ctx.log('Mode démonstration actif (AUTOMATION_MODE=production pour cibler la vraie application)');
    return demo.createAccount(config, data, ctx);
  }

  const S = applySelectorPatches(BASE_SELECTORS, config.id);
  const base = process.env.NETSOINS_URL.replace(/\/$/, '');
  const fullName = `${data.prenom} ${data.nom}`;

  return runScenario({
    reference: ctx.reference,
    log: ctx.log,
    successMessage: `Compte NetSoins créé pour ${fullName}`,
    steps: composeSteps(config.id, [
      {
        id: 'ouverture',
        critical: true,
        label: 'Ouverture de NetSoins',
        run: (page) => page.goto(base),
      },
      {
        id: 'connexion',
        critical: true,
        label: 'Connexion avec le compte administrateur',
        run: async (page) => {
          await page.fill(S.login.user, process.env.NETSOINS_ADMIN_USER);
          await page.fill(S.login.password, process.env.NETSOINS_ADMIN_PASSWORD);
          await page.click(S.login.submit);
          await page.waitForSelector(S.login.loggedInProof);
        },
      },
      {
        id: 'etablissement',
        critical: true,
        label: `Sélection de l'établissement « ${data.etablissement} »`,
        run: (page) => page.selectOption(S.etablissementSelect, data.etablissement),
      },
      {
        id: 'menu',
        critical: true,
        label: 'Ouverture de Paramétrage > Personnel > Ajouter',
        run: async (page) => {
          await page.click(S.menu.parametrage);
          await page.click(S.menu.personnel);
          await page.click(S.menu.ajouter);
        },
      },
      {
        id: 'fiche',
        critical: true,
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
        id: 'acces',
        critical: true,
        label: "Saisie de la période d'accès et des droits",
        run: async (page) => {
          await page.fill(S.form.dateDebut, data.date_debut);
          if (data.date_fin) await page.fill(S.form.dateFin, data.date_fin);
          await page.selectOption(S.form.droitsMedicament, data.acces_prescriptions);
        },
      },
      {
        id: 'enregistrement',
        critical: true,
        label: 'Enregistrement et vérification',
        run: async (page) => {
          await page.click(S.form.save);
          await page.waitForSelector(S.form.successProof);
        },
      },
    ], data, ctx.log),
  });
}

module.exports = { createAccount, STEPS_META };
