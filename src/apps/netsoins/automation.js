'use strict';

/**
 * Scénario de création de compte NetSoins (Teranga Software).
 *
 * - Mode démo (défaut) : le robot pilote la console de démonstration intégrée.
 * - Mode production : AUTOMATION_MODE=production + NETSOINS_URL,
 *   NETSOINS_ADMIN_USER, NETSOINS_ADMIN_PASSWORD dans l'environnement.
 *
 * Deux stratégies de création, comme pour BlueKanGo :
 *   1. DUPLICATION — s'il existe déjà un compte du MÊME établissement et du MÊME
 *      profil de droit, on le duplique (droits identiques, plus rapide et plus
 *      sûr) puis on ne change que l'identité.
 *   2. FORMULAIRE — sinon, on remplit une fiche neuve (établissement, catégorie
 *      de personnel, profil de droit, dates).
 *
 * Identifiant attribué : « NOM PRÉNOM » en majuscules (voir ./login.js).
 *
 * Connexion : NetSoins envoie un code OTP par e-mail. Le robot le récupère via
 * ctx.awaitOtp (lecture auto si configurée, sinon saisie manuelle par l'admin).
 *
 * ⚠️ Les sélecteurs (./selectors.js) restent à calibrer sur l'instance réelle.
 */

const { getMode } = require('../../automation/helpers');
const { runScenario } = require('../../automation/engine');
const { applySelectorPatches, composeSteps } = require('../../automation/scenarioRuntime');
const demo = require('../../automation/demoDriver');
const db = require('../../db');
const config = require('./config');
const { pickUniqueLogin } = require('./login');
const BASE_SELECTORS = require('./selectors');

const ENV = ['NETSOINS_URL', 'NETSOINS_ADMIN_USER', 'NETSOINS_ADMIN_PASSWORD'];

const STEPS_META = [
  { id: 'ouverture', label: 'Ouverture de NetSoins', critical: true, selectorKeys: [] },
  { id: 'connexion', label: 'Connexion administrateur', critical: true, selectorKeys: ['login.user', 'login.password', 'login.submit'] },
  { id: 'otp', label: 'Double authentification (code par e-mail)', critical: true, selectorKeys: ['login.otpInput', 'login.otpSubmit'] },
  { id: 'etablissement', label: "Sélection de l'établissement", critical: true, selectorKeys: ['etablissementSelect'] },
  { id: 'creation', label: 'Création (duplication ou nouvelle fiche)', critical: true, selectorKeys: ['userList.duplicateButton', 'menu.ajouter'] },
  { id: 'fiche', label: 'Saisie de la fiche', critical: true, selectorKeys: ['form.login', 'form.nom', 'form.prenom', 'form.email'] },
  { id: 'enregistrement', label: 'Enregistrement et vérification', critical: true, selectorKeys: ['form.save', 'form.successProof'] },
];

/** Décide de la stratégie de création à partir des comptes déjà connus. */
function chooseStrategy(data) {
  const template = db.findAccountTemplate(config.id, data.etablissement, data.profil_droit);
  return template && template.login
    ? { mode: 'duplicate', templateLogin: template.login }
    : { mode: 'form' };
}

async function createAccount(data, ctx) {
  // Identifiant NetSoins : « NOM PRÉNOM » en majuscules, unique.
  const login = pickUniqueLogin(data.nom, data.prenom, (l) => db.loginExists(config.id, l));
  const account = { login, prenom: data.prenom, nom: data.nom };
  ctx.log(`Identifiant retenu : « ${login} »`);

  const strategy = chooseStrategy(data);
  ctx.log(
    strategy.mode === 'duplicate'
      ? `Duplication du compte modèle « ${strategy.templateLogin} » (même établissement et même profil).`
      : 'Aucun compte modèle : création par le formulaire.'
  );

  if (getMode(ENV) === 'demo') {
    ctx.log('Mode démonstration actif (AUTOMATION_MODE=production pour cibler la vraie application)');
    const result = await demo.createAccount(config, data, ctx);
    if (result.success) {
      result.account = account;
      result.message =
        `${result.message} — identifiant « ${login} » ` +
        (strategy.mode === 'duplicate' ? '(par duplication)' : '(par formulaire)');
    }
    return result;
  }

  const S = applySelectorPatches(BASE_SELECTORS, config.id);
  const base = process.env.NETSOINS_URL.replace(/\/$/, '');
  const fullName = `${data.prenom} ${data.nom}`;
  let otpSince = new Date();

  // Étape « fiche » commune : renseigne/écrase l'identité sur la fiche ouverte
  // (nouvelle fiche OU fiche dupliquée).
  const remplirIdentite = async (page) => {
    await page.fill(S.form.login, login);
    await page.fill(S.form.nom, data.nom);
    await page.fill(S.form.prenom, data.prenom);
    if (data.email) await page.fill(S.form.email, data.email);
  };

  const steps = [
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
        otpSince = new Date(); // le code OTP est envoyé au moment de la validation
        await page.click(S.login.submit);
      },
    },
    {
      id: 'otp',
      critical: true,
      label: 'Double authentification — récupération du code',
      run: async (page) => {
        await page.waitForSelector(S.login.otpInput);
        // Récupère le code (lecture auto par e-mail si configurée, sinon saisie
        // manuelle par l'admin dans les détails de la demande).
        const code = await ctx.awaitOtp({
          since: otpSince,
          label: 'Code de connexion NetSoins reçu par e-mail.',
        });
        await page.fill(S.login.otpInput, code);
        await page.click(S.login.otpSubmit);
        await page.waitForSelector(S.login.loggedInProof);
      },
    },
    {
      id: 'etablissement',
      critical: true,
      label: `Sélection de l'établissement`,
      run: (page) => page.selectOption(S.etablissementSelect, String(data.etablissement)),
    },
  ];

  if (strategy.mode === 'duplicate') {
    steps.push(
      {
        id: 'creation',
        critical: true,
        label: `Duplication du compte modèle « ${strategy.templateLogin} »`,
        run: async (page) => {
          await page.fill(S.userList.search, strategy.templateLogin);
          const row = page.locator(S.userList.row, { hasText: strategy.templateLogin }).first();
          await row.locator(S.userList.duplicateButton).first().click();
          await page.waitForSelector(S.form.login);
        },
      },
      {
        id: 'fiche',
        critical: true,
        label: `Mise à jour de l'identité (${fullName})`,
        run: remplirIdentite,
      }
    );
  } else {
    steps.push(
      {
        id: 'creation',
        critical: true,
        label: 'Ouverture d’une nouvelle fiche intervenant',
        run: async (page) => {
          await page.click(S.menu.parametrage);
          await page.click(S.menu.personnel);
          await page.click(S.menu.ajouter);
          await page.waitForSelector(S.form.login);
        },
      },
      {
        id: 'fiche',
        critical: true,
        label: `Saisie de la fiche (${fullName})`,
        run: async (page) => {
          await remplirIdentite(page);
          if (data.categorie_personnel) await page.selectOption(S.form.categorie, data.categorie_personnel);
          if (data.profil_droit) await page.check(S.form.profil(data.profil_droit));
          if (data.date_debut) await page.fill(S.form.dateDebut, data.date_debut);
        },
      }
    );
  }

  steps.push({
    id: 'enregistrement',
    critical: true,
    label: 'Enregistrement et vérification',
    run: async (page) => {
      await page.click(S.form.save);
      await page.waitForSelector(S.form.successProof);
    },
  });

  const result = await runScenario({
    reference: ctx.reference,
    log: ctx.log,
    onProgress: ctx.progress,
    successMessage: `Compte NetSoins créé pour ${fullName} — identifiant « ${login} »`,
    steps: composeSteps(config.id, steps, data, ctx.log),
  });
  if (result.success) result.account = account;
  return result;
}

module.exports = { createAccount, STEPS_META, chooseStrategy };
