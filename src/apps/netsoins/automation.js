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

  // NetSoins rend toute son interface dans une iframe : on travaille donc à
  // l'intérieur de ce cadre (résolu à chaque usage, l'iframe se recharge).
  const F = (page) => page.frameLocator(S.frame);

  // Étape « fiche » commune : renseigne/écrase l'identité sur la fiche ouverte
  // (nouvelle fiche OU fiche dupliquée).
  const remplirIdentite = async (page) => {
    const f = F(page);
    await f.locator(S.form.login).fill(login);
    await f.locator(S.form.nom).fill(data.nom);
    await f.locator(S.form.prenom).fill(data.prenom);
    if (data.email) await f.locator(S.form.email).fill(data.email);
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
        const f = F(page);
        // Le formulaire vit dans l'iframe : on clique avant de saisir (le champ
        // n'accepte la frappe qu'une fois focalisé).
        await f.locator(S.login.user).click();
        await f.locator(S.login.user).fill(process.env.NETSOINS_ADMIN_USER);
        await f.locator(S.login.password).click();
        await f.locator(S.login.password).fill(process.env.NETSOINS_ADMIN_PASSWORD);
        otpSince = new Date(); // le code OTP part au moment de la validation
        await f.locator(S.login.submit).click();
      },
    },
    {
      id: 'otp',
      critical: true,
      label: 'Double authentification — récupération du code',
      run: async (page) => {
        const f = F(page);
        const field = f.locator(S.login.otpInput);
        await field.waitFor();
        // Récupère le code (lecture auto par e-mail si configurée, sinon saisie
        // manuelle par l'admin dans les détails de la demande).
        const code = await ctx.awaitOtp({
          since: otpSince,
          label: 'Code de connexion NetSoins reçu par e-mail — saisissez-le ici.',
        });
        await field.click();
        await field.fill(code);
        await f.locator(S.login.otpSubmit).click();
        // Fenêtre d'accueil affichée après connexion : on la ferme.
        const close = f.locator(S.login.closePopup).first();
        await close.waitFor();
        await close.click();
        ctx.log('Connexion NetSoins établie.');
      },
    },
    {
      id: 'etablissement',
      critical: true,
      label: `Sélection de l'établissement`,
      run: (page) => F(page).locator(S.etablissementSelect).selectOption(String(data.etablissement)),
    },
  ];

  if (strategy.mode === 'duplicate') {
    steps.push(
      {
        id: 'creation',
        critical: true,
        label: `Duplication du compte modèle « ${strategy.templateLogin} »`,
        run: async (page) => {
          const f = F(page);
          await f.locator(S.userList.search).fill(strategy.templateLogin);
          const row = f.locator(S.userList.row, { hasText: strategy.templateLogin }).first();
          await row.locator(S.userList.duplicateButton).first().click();
          await f.locator(S.form.login).waitFor();
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
          const f = F(page);
          await f.locator(S.menu.parametrage).click();
          await f.locator(S.menu.personnel).click();
          await f.locator(S.menu.ajouter).click();
          await f.locator(S.form.login).waitFor();
        },
      },
      {
        id: 'fiche',
        critical: true,
        label: `Saisie de la fiche (${fullName})`,
        run: async (page) => {
          const f = F(page);
          await remplirIdentite(page);
          if (data.categorie_personnel) await f.locator(S.form.categorie).selectOption(data.categorie_personnel);
          if (data.profil_droit) await f.locator(S.form.profil(data.profil_droit)).check();
          if (data.date_debut) await f.locator(S.form.dateDebut).fill(data.date_debut);
          // CDD : on coche « fin de validité » et on renseigne la date ; un CDI
          // reste sans date de fin.
          if (data.type_contrat === 'cdd' && data.date_fin) {
            const box = f.locator(S.form.finValiditeCheck);
            if (!(await box.isChecked().catch(() => false))) await box.check();
            await f.locator(S.form.dateFin).fill(data.date_fin);
            ctx.log(`Contrat à durée déterminée : fin de validité au ${data.date_fin}.`);
          }
        },
      }
    );
  }

  steps.push({
    id: 'enregistrement',
    critical: true,
    label: 'Enregistrement et vérification',
    run: async (page) => {
      const f = F(page);
      await f.locator(S.form.save).click();
      await f.locator(S.form.successProof).waitFor();
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
