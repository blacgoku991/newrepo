'use strict';

/**
 * Scénario de création de compte NetSoins (Teranga Software).
 *
 * - Mode démo (défaut) : le robot pilote la console de démonstration intégrée.
 * - Mode production : AUTOMATION_MODE=production + NETSOINS_URL,
 *   NETSOINS_ADMIN_USER, NETSOINS_ADMIN_PASSWORD dans l'environnement.
 *
 * Parcours (relevé sur l'instance ADEF) :
 *   connexion (dans l'iframe) → code OTP → l'application sort de l'iframe →
 *   Administratif > Intervenant →
 *   onglet Compte : identifiant, mot de passe + confirmation, accès limité
 *     (CDD) + date limite, profil de droits, établissements autorisés →
 *   onglet Informations : catégorie professionnelle, sexe, nom de naissance,
 *     premier prénom →
 *   Enregistrer.
 *
 * Identifiant attribué : « NOM PRÉNOM » en majuscules (voir ./login.js).
 *
 * Connexion : NetSoins envoie un code OTP par e-mail. Le robot le récupère via
 * ctx.awaitOtp (lecture auto si configurée, sinon saisie manuelle par l'admin).
 *
 * La création par duplication d'un compte existant n'est pas encore relevée :
 * `chooseStrategy` la détecte et le signale, mais la création passe par le
 * formulaire (résultat identique).
 */

const { getMode } = require('../../automation/helpers');
const { runScenario } = require('../../automation/engine');
const { applySelectorPatches, composeSteps } = require('../../automation/scenarioRuntime');
const demo = require('../../automation/demoDriver');
const db = require('../../db');
const config = require('./config');
const { pickUniqueLogin } = require('./login');
const { PROFILS_DROIT, ETABLISSEMENTS } = require('./data');
const BASE_SELECTORS = require('./selectors');

const ENV = ['NETSOINS_URL', 'NETSOINS_ADMIN_USER', 'NETSOINS_ADMIN_PASSWORD'];

const STEPS_META = [
  { id: 'ouverture', label: 'Ouverture de NetSoins', critical: true, selectorKeys: [] },
  { id: 'connexion', label: 'Connexion administrateur', critical: true, selectorKeys: ['login.user', 'login.password', 'login.submit'] },
  { id: 'otp', label: 'Double authentification (code par e-mail)', critical: true, selectorKeys: ['login.otpInput', 'login.otpSubmit', 'closePopup'] },
  { id: 'creation', label: 'Ouverture de la fiche intervenant', critical: true, selectorKeys: ['menu.administratif', 'menu.intervenant'] },
  { id: 'compte', label: 'Onglet Compte (identifiants, droits, etablissements)', critical: true, selectorKeys: ['compte.login', 'compte.password', 'compte.passwordConfirm', 'compte.accesLimite', 'compte.dateLimite', 'compte.profilOpen', 'compte.etabOpen'] },
  { id: 'informations', label: 'Onglet Informations (etat civil, categorie)', critical: true, selectorKeys: ['informations.tab', 'informations.categorieOpen', 'informations.sexeMasculin', 'informations.nomNaissance', 'informations.premierPrenom'] },
  { id: 'enregistrement', label: 'Enregistrement de la fiche', critical: true, selectorKeys: ['save'] },
];

/** Décide de la stratégie de création à partir des comptes déjà connus. */
function chooseStrategy(data) {
  const template = db.findAccountTemplate(config.id, data.etablissement, data.profil_droit);
  return template && template.login
    ? { mode: 'duplicate', templateLogin: template.login }
    : { mode: 'form' };
}

/** Date ISO (2026-08-25) → format NetSoins (25/08/2026). */
function frDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}

/** Libellé lisible d'un profil de droits (pour le journal). */
function profilLabel(id) {
  const found = PROFILS_DROIT.find((p) => p.value === String(id));
  return found ? found.label : String(id);
}

/** Libellé d'un établissement — c'est par ce texte qu'on le coche dans NetSoins. */
function etabLabel(value) {
  const found = ETABLISSEMENTS.find((e) => e.value === String(value));
  return found ? found.label : String(value);
}

async function createAccount(data, ctx) {
  // Identifiant NetSoins : « NOM PRÉNOM » en majuscules, unique.
  const login = pickUniqueLogin(data.nom, data.prenom, (l) => db.loginExists(config.id, l));
  const account = { login, prenom: data.prenom, nom: data.nom };
  ctx.log(`Identifiant retenu : « ${login} »`);

  const strategy = chooseStrategy(data);
  if (strategy.mode === 'duplicate') {
    // La duplication reste à calibrer sur l'instance (parcours non relevé) :
    // on crée par le formulaire, qui produit le même résultat.
    ctx.log(`Un compte de même établissement et même profil existe (« ${strategy.templateLogin} ») — création par le formulaire.`);
  } else {
    ctx.log('Aucun compte modèle : création par le formulaire.');
  }

  if (getMode(ENV) === 'demo') {
    ctx.log('Mode démonstration actif (AUTOMATION_MODE=production pour cibler la vraie application)');
    const result = await demo.createAccount(config, data, ctx);
    if (result.success) {
      result.account = account;
      result.message = `${result.message} — identifiant « ${login} »`;
    }
    return result;
  }

  // Mot de passe initial des comptes créés : uniquement via l'environnement.
  const initialPassword = process.env.NETSOINS_DEFAULT_PASSWORD || '';
  if (!initialPassword) {
    throw new Error('NETSOINS_DEFAULT_PASSWORD absent de la configuration : impossible de créer le compte');
  }
  account.password = initialPassword;

  const S = applySelectorPatches(BASE_SELECTORS, config.id);
  const base = process.env.NETSOINS_URL.replace(/\/$/, '');
  const fullName = `${data.prenom} ${data.nom}`;
  let otpSince = new Date();

  // La page de CONNEXION de NetSoins est rendue dans une iframe ; une fois
  // connecté, l'application occupe la page de premier niveau.
  const F = (page) => page.frameLocator(S.frame);


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
        // n'accepte la frappe qu'une fois focalisé). `.first()` évite l'échec
        // « strict mode » si un libellé apparaît à plusieurs endroits.
        const user = f.locator(S.login.user).first();
        const pass = f.locator(S.login.password).first();
        await user.click();
        await user.fill(process.env.NETSOINS_ADMIN_USER);
        await pass.click();
        await pass.fill(process.env.NETSOINS_ADMIN_PASSWORD);
        otpSince = new Date(); // le code OTP part au moment de la validation
        await f.locator(S.login.submit).first().click();
      },
    },
    {
      id: 'otp',
      critical: true,
      label: 'Double authentification — récupération du code',
      run: async (page) => {
        const f = F(page);
        const field = f.locator(S.login.otpInput).first();
        await field.waitFor();
        // Récupère le code (lecture auto par e-mail si configurée, sinon saisie
        // manuelle par l'admin dans les détails de la demande).
        const code = await ctx.awaitOtp({
          since: otpSince,
          label: 'Code de connexion NetSoins reçu par e-mail — saisissez-le ici.',
        });

        ctx.log('Saisie du code dans NetSoins…');
        await field.click();
        await field.fill(code);
        ctx.log('Validation du code (bouton OK)…');
        await f.locator(S.login.otpSubmit).first().click();

        // Le code est-il accepté ? Si le champ OTP est toujours là, c'est qu'il
        // a été refusé (code erroné ou expiré) : on le dit clairement.
        await page.waitForTimeout(1500);
        if (await field.isVisible().catch(() => false)) {
          throw new Error('Code refusé par NetSoins (code erroné ou expiré) — relancez la demande pour recevoir un nouveau code');
        }
        ctx.log('Code accepté.');

        // ⚠️ Après connexion, NetSoins SORT de l'iframe : tout ce qui suit se
        // joue sur la page de premier niveau. La fenêtre d'accueil est
        // facultative (son absence n'est pas un échec).
        const close = page.locator(S.closePopup).first();
        try {
          await close.waitFor({ timeout: 10000 });
          await close.click();
          ctx.log('Fenêtre d’accueil fermée.');
        } catch {
          ctx.log('Pas de fenêtre d’accueil à fermer.');
        }
        ctx.log('Connexion NetSoins établie.');
      },
    },
  ];

  // Établissements à autoriser : le principal, plus les éventuels autres cochés
  // dans le formulaire (sans doublon).
  const etabsAutorises = [
    ...new Set([String(data.etablissement || ''), ...(data.etablissements_autorises || []).map(String)]),
  ].filter(Boolean);

  steps.push(
    {
      id: 'creation',
      critical: true,
      label: 'Ouverture d’une nouvelle fiche intervenant',
      run: async (page) => {
        // Menu de premier niveau : Administratif > Intervenant.
        await page.locator(S.menu.administratif).first().click();
        ctx.log('Menu « Administratif » ouvert.');
        await page.locator(S.menu.intervenant).first().click();
        await page.locator(S.compte.login).first().waitFor();
        ctx.log('Formulaire « Intervenant » ouvert.');
      },
    },
    {
      id: 'compte',
      critical: true,
      label: `Onglet Compte — identifiants et droits (${login})`,
      run: async (page) => {
        // Identifiant + mot de passe initial (le mot de passe vient de .env,
        // jamais du code ; il n'est jamais journalisé).
        const id = page.locator(S.compte.login).first();
        await id.click();
        await id.fill(login);
        ctx.log(`Identifiant saisi : « ${login} ».`);

        const pw = page.locator(S.compte.password).first();
        await pw.click();
        await pw.fill(initialPassword);
        const pwc = page.locator(S.compte.passwordConfirm).first();
        await pwc.click();
        await pwc.fill(initialPassword);
        ctx.log('Mot de passe initial et confirmation saisis.');

        // CDD : « accès limité dans le temps » puis la date limite.
        // Un CDI reste sans date limite.
        if (data.type_contrat === 'cdd' && data.date_fin) {
          await page.locator(S.compte.accesLimite).first().click();
          const dl = page.locator(S.compte.dateLimite).first();
          await dl.click();
          await dl.press('ControlOrMeta+a');
          await dl.fill(frDate(data.date_fin));
          await dl.press('Enter');
          ctx.log(`Contrat à durée déterminée : accès limité au ${frDate(data.date_fin)}.`);
        } else {
          ctx.log('Contrat à durée indéterminée : aucune date limite d’accès.');
        }

        // Profil de droits : un lien ouvre la liste, on coche l'option voulue —
        // repérée par son identifiant interne, jamais par sa position.
        await page.locator(S.compte.profilZone).first().click().catch(() => {});
        await page.locator(S.compte.profilOpen).first().click();
        await page.locator(S.compte.profilOption(data.profil_droit)).first().click();
        ctx.log(`Profil de droits appliqué : ${profilLabel(data.profil_droit)}.`);

        // Établissements autorisés (un ou plusieurs).
        await page.locator(S.compte.etabOpen).first().click();
        await page.locator(S.compte.etabRoot).nth(1).click().catch(() => {});
        for (const value of etabsAutorises) {
          const label = etabLabel(value);
          const option = page.locator(S.compte.etabOption(label)).first();
          try {
            await option.waitFor({ timeout: 5000 });
            await option.click();
            ctx.log(`Établissement autorisé : ${label}.`);
          } catch {
            throw new Error(`Établissement « ${label} » introuvable dans la liste — sélecteur « compte.etabOption » à calibrer`);
          }
        }
      },
    },
    {
      id: 'informations',
      critical: true,
      label: `Onglet Informations — état civil (${fullName})`,
      run: async (page) => {
        await page.locator(S.informations.tab).first().click();
        ctx.log('Onglet « Informations » ouvert.');

        // Catégorie professionnelle (liste recherchable).
        await page.locator(S.informations.categorieOpen).first().click();
        const cat = page.locator(S.informations.categorieOption(data.categorie_personnel)).first();
        try {
          await cat.waitFor({ timeout: 5000 });
          await cat.click();
          ctx.log(`Catégorie professionnelle : ${data.categorie_personnel}.`);
        } catch {
          throw new Error(`Catégorie « ${data.categorie_personnel} » introuvable dans la liste — sélecteur « informations.categorieOption » à calibrer`);
        }

        // Sexe.
        const sexeSel = data.sexe === 'feminin' ? S.informations.sexeFeminin : S.informations.sexeMasculin;
        await page.locator(sexeSel).first().click();
        ctx.log(`Sexe : ${data.sexe === 'feminin' ? 'féminin' : 'masculin'}.`);

        // État civil.
        const nom = page.locator(S.informations.nomNaissance).first();
        await nom.click();
        await nom.fill(data.nom);
        const prenom = page.locator(S.informations.premierPrenom).first();
        await prenom.click();
        await prenom.fill(data.prenom);
        ctx.log('Nom de naissance et premier prénom renseignés.');
      },
    },
    {
      id: 'enregistrement',
      critical: true,
      label: 'Enregistrement de la fiche',
      run: async (page) => {
        const save = page.locator(S.save).first();
        try {
          await save.waitFor({ timeout: 5000 });
        } catch {
          throw new Error('Bouton d’enregistrement introuvable — sélecteur « save » à calibrer sur l’instance');
        }
        await save.click();
        // Laisse NetSoins traiter l'enregistrement ; la capture de fin de
        // scénario sert de preuve visuelle.
        await page.waitForTimeout(2500);
        ctx.log('Fiche enregistrée.');
      },
    }
  );

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
