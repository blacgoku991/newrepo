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
const { baseLogin } = require('./login');
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

/**
 * Résout un sélecteur du fichier ./selectors.js.
 *
 * « role:libellé » → repérage par rôle + libellé accessible (getByRole), tel
 * que le produit le codegen Playwright : la correspondance est PARTIELLE et
 * insensible à la casse, ce qui absorbe l'astérisque des champs obligatoires
 * de NetSoins (« Identifiant* », « Mot de passe* »…).
 * Toute autre chaîne est un sélecteur CSS/texte Playwright classique.
 *
 * `scope` est une page ou une frame : les deux exposent locator() et getByRole().
 */
const ROLE_SELECTOR = /^(textbox|link|button|combobox|checkbox|radio|option|tab|cell|row):(.+)$/;
function L(scope, selector) {
  const m = ROLE_SELECTOR.exec(selector);
  return m ? scope.getByRole(m[1], { name: m[2] }) : scope.locator(selector);
}

/** Étapes de la réinitialisation de mot de passe (éditeur de scénario). */
const RESET_STEPS_META = [
  { id: 'ouverture', label: 'Ouverture de NetSoins', critical: true, selectorKeys: [] },
  { id: 'connexion', label: 'Connexion administrateur', critical: true, selectorKeys: ['login.user', 'login.password', 'login.submit'] },
  { id: 'otp', label: 'Double authentification (code par e-mail)', critical: true, selectorKeys: ['login.otpInput', 'login.otpSubmit', 'closePopup'] },
  { id: 'liste', label: 'Ouverture de la liste des intervenants', critical: true, selectorKeys: ['menu.administratif', 'menu.intervenant', 'menu.intervenantsListe'] },
  { id: 'etablissement', label: "Bascule sur l'etablissement", critical: true, selectorKeys: ['liste.etablissementOpen'] },
  { id: 'recherche', label: "Recherche de l'intervenant", critical: true, selectorKeys: ['liste.search', 'liste.ficheIntervenant'] },
  { id: 'motdepasse', label: 'Saisie du nouveau mot de passe', critical: true, selectorKeys: ['motDePasse.modeOpen', 'motDePasse.modeDefinir', 'motDePasse.password', 'motDePasse.passwordConfirm'] },
  { id: 'enregistrement', label: 'Enregistrement de la fiche', critical: true, selectorKeys: ['save'] },
];

/**
 * Mot de passe provisoire aléatoire posé lors d'une réinitialisation : il est
 * remis au bénéficiaire par lien sécurisé, puis changé à la première connexion.
 */
function randomProvisionalPassword() {
  const crypto = require('node:crypto');
  return `Adefhabitat${crypto.randomInt(1000, 9999)}.`;
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

/**
 * NetSoins valide toute la fiche d'un coup et ouvre une fenêtre « Il y a des
 * erreurs » si un champ obligatoire manque. Rencontrer cette fenêtre en cours
 * de saisie signifie que le formulaire a été soumis trop tôt : on s'arrête avec
 * un message clair plutôt que de poursuivre sur une fiche déjà en erreur.
 */
async function assertPasDErreur(page, S, etape) {
  let visible = false;
  try {
    visible = await L(page, S.errorDialog).first().isVisible({ timeout: 800 });
  } catch {
    visible = false; // absence de la fenêtre : cas nominal
  }
  if (visible) {
    throw new Error(`NetSoins signale « Il y a des erreurs » après l'étape « ${etape} » : la fiche a été soumise avant d'être complète`);
  }
}

/**
 * Retrouve le bouton d'enregistrement en essayant les écritures déclarées dans
 * `selectors.save`, du plus précis au plus large. En cas d'échec total, liste
 * les boutons réellement présents sur la page : le journal devient alors un
 * outil de diagnostic plutôt qu'un simple « introuvable ».
 */
async function findSave(page, S, ctx) {
  const candidats = Array.isArray(S.save) ? S.save : [S.save];
  for (const selector of candidats) {
    const loc = L(page, selector).first();
    try {
      await loc.waitFor({ state: 'visible', timeout: 3000 });
      ctx.log(`Bouton d'enregistrement trouvé (${selector}).`);
      return loc;
    } catch {
      /* on essaie l'écriture suivante */
    }
  }
  // Diagnostic : que contient réellement la page ?
  let vus = [];
  try {
    vus = await page
      .locator('button, input[type="button"], input[type="submit"], [role="button"], a.btn')
      .evaluateAll((els) =>
        els
          .filter((e) => e.offsetParent !== null)
          .slice(0, 12)
          .map((e) => (e.value || e.textContent || '').trim().slice(0, 40))
          .filter(Boolean)
      );
  } catch {
    /* le diagnostic ne doit pas masquer l'erreur d'origine */
  }
  throw new Error(
    "Bouton d'enregistrement introuvable — sélecteur « save » à calibrer." +
      (vus.length ? ` Boutons visibles sur la page : ${vus.map((t) => `« ${t} »`).join(', ')}` : '')
  );
}

/**
 * Étapes de connexion, communes à toutes les démarches NetSoins :
 * ouverture, identification dans l'iframe, code OTP, sortie de l'iframe.
 */
function buildLoginSteps({ S, ctx, base }) {
  // La page de CONNEXION est rendue dans une iframe ; une fois connecté,
  // l'application occupe la page de premier niveau.
  const F = (page) => page.frameLocator(S.frame);
  let otpSince = new Date();

  return [
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
        const user = L(f, S.login.user).first();
        const pass = L(f, S.login.password).first();
        await user.click();
        await user.fill(process.env.NETSOINS_ADMIN_USER);
        await pass.click();
        await pass.fill(process.env.NETSOINS_ADMIN_PASSWORD);
        otpSince = new Date(); // le code OTP part au moment de la validation
        await L(f, S.login.submit).first().click();
      },
    },
    {
      id: 'otp',
      critical: true,
      label: 'Double authentification — récupération du code',
      run: async (page) => {
        const f = F(page);
        const field = L(f, S.login.otpInput).first();
        await field.waitFor();

        // Le code peut arriver par DEUX voies, et la première qui aboutit
        // l'emporte :
        //   1. saisie dans le portail (ou lecture automatique du mail) — le
        //      robot tape alors le code lui-même ;
        //   2. saisie directement dans la fenêtre du robot, quand elle est
        //      visible : c'est le geste naturel quand on voit l'écran, et il
        //      serait absurde de rester bloqué alors que la connexion est faite.
        const abort = { aborted: false };
        const parLePortail = ctx
          .awaitOtp({
            since: otpSince,
            label: 'Code de connexion NetSoins reçu par e-mail — saisissez-le ici (ou directement dans la fenêtre du robot).',
            abort,
          })
          .then((code) => ({ voie: 'portail', code }));

        const dansLaFenetre = (async () => {
          while (!abort.aborted) {
            // Le champ disparaît dès que NetSoins accepte le code.
            if (!(await field.isVisible().catch(() => false))) return { voie: 'fenetre' };
            await page.waitForTimeout(1000);
          }
          return { voie: 'abandon' };
        })();

        let issue;
        try {
          issue = await Promise.race([parLePortail, dansLaFenetre]);
        } finally {
          abort.aborted = true; // libère l'attente restante, quelle qu'elle soit
        }

        if (issue.voie === 'fenetre') {
          ctx.log('Code saisi directement dans la fenêtre du robot — connexion validée.');
        } else {
          if (!issue.code) throw new Error('Code OTP non fourni');
          ctx.log('Saisie du code dans NetSoins…');
          await field.click();
          await field.fill(issue.code);
          ctx.log('Validation du code (bouton OK)…');
          await L(f, S.login.otpSubmit).first().click();

          // Le code est-il accepté ? Si le champ OTP est toujours là, c'est
          // qu'il a été refusé (code erroné ou expiré) : on le dit clairement.
          await page.waitForTimeout(1500);
          if (await field.isVisible().catch(() => false)) {
            throw new Error('Code refusé par NetSoins (code erroné ou expiré) — relancez la demande pour recevoir un nouveau code');
          }
          ctx.log('Code accepté.');
        }

        // ⚠️ Après connexion, NetSoins SORT de l'iframe : tout ce qui suit se
        // joue sur la page de premier niveau. La fenêtre d'accueil est
        // facultative (son absence n'est pas un échec).
        const close = L(page, S.closePopup).first();
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
}

async function createAccount(data, ctx) {
  // Identifiant NetSoins : « NOM PRÉNOM » en majuscules, tel quel.
  // On n'ajoute PAS de suffixe : NetSoins fait autorité sur l'unicité de ses
  // identifiants et refusera un doublon réel. Le registre local, lui, peut
  // contenir des entrées de test ou périmées — il ne doit pas modifier
  // l'identifiant dans le dos du demandeur.
  const login = baseLogin(data.nom, data.prenom);
  const account = { login, prenom: data.prenom, nom: data.nom };
  ctx.log(`Identifiant retenu : « ${login} »`);
  if (db.loginExists(config.id, login)) {
    ctx.log(`Attention : un compte « ${login} » figure déjà au registre — si l'identifiant existe réellement, NetSoins refusera l'enregistrement.`);
  }

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

  const steps = buildLoginSteps({ S, ctx, base });

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
        await L(page, S.menu.administratif).first().click();
        ctx.log('Menu « Administratif » ouvert.');
        await L(page, S.menu.intervenant).first().click();
        await L(page, S.compte.login).first().waitFor();
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
        const id = L(page, S.compte.login).first();
        await id.click();
        await id.fill(login);
        ctx.log(`Identifiant saisi : « ${login} ».`);

        const pw = L(page, S.compte.password).first();
        await pw.click();
        await pw.fill(initialPassword);
        const pwc = L(page, S.compte.passwordConfirm).first();
        await pwc.click();
        await pwc.fill(initialPassword);
        ctx.log('Mot de passe initial et confirmation saisis.');

        // CDD : « accès limité dans le temps » puis la date limite.
        // Un CDI reste sans date limite.
        if (data.type_contrat === 'cdd' && data.date_fin) {
          await L(page, S.compte.accesLimite).first().click();
          const dl = L(page, S.compte.dateLimite).first();
          await dl.click();
          await dl.press('ControlOrMeta+a');
          await dl.fill(frDate(data.date_fin));
          // Surtout PAS de validation par « Entrée » : dans ce formulaire, cela
          // envoie la fiche avant que l'onglet Informations soit rempli, et
          // NetSoins répond « Il y a des erreurs ». Tab referme le sélecteur de
          // date et valide la saisie sans rien soumettre.
          await dl.press('Tab');
          ctx.log(`Contrat à durée déterminée : accès limité au ${frDate(data.date_fin)}.`);
        } else {
          ctx.log('Contrat à durée indéterminée : aucune date limite d’accès.');
        }

        // Profil de droits : un lien ouvre la liste, on coche l'option voulue —
        // repérée par son identifiant interne, jamais par sa position.
        await L(page, S.compte.profilZone).first().click().catch(() => {});
        await L(page, S.compte.profilOpen).first().click();
        await L(page, S.compte.profilOption(data.profil_droit)).first().click();
        ctx.log(`Profil de droits appliqué : ${profilLabel(data.profil_droit)}.`);

        // La fiche n'a pas dû partir pendant la saisie (touche Entrée, etc.).
        await assertPasDErreur(page, S, 'accès limité / date');

        // Établissements autorisés (un ou plusieurs).
        await L(page, S.compte.etabOpen).first().click();
        await L(page, S.compte.etabRoot).nth(1).click().catch(() => {});
        for (const value of etabsAutorises) {
          const label = etabLabel(value);
          const option = L(page, S.compte.etabOption(label)).first();
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
        await L(page, S.informations.tab).first().click();
        ctx.log('Onglet « Informations » ouvert.');

        // Catégorie professionnelle (liste recherchable).
        await L(page, S.informations.categorieOpen).first().click();
        const cat = L(page, S.informations.categorieOption(data.categorie_personnel)).first();
        try {
          await cat.waitFor({ timeout: 5000 });
          await cat.click();
          ctx.log(`Catégorie professionnelle : ${data.categorie_personnel}.`);
        } catch {
          throw new Error(`Catégorie « ${data.categorie_personnel} » introuvable dans la liste — sélecteur « informations.categorieOption » à calibrer`);
        }

        // Sexe.
        const sexeSel = data.sexe === 'feminin' ? S.informations.sexeFeminin : S.informations.sexeMasculin;
        await L(page, sexeSel).first().click();
        ctx.log(`Sexe : ${data.sexe === 'feminin' ? 'féminin' : 'masculin'}.`);

        // État civil.
        const nom = L(page, S.informations.nomNaissance).first();
        await nom.click();
        await nom.fill(data.nom);
        const prenom = L(page, S.informations.premierPrenom).first();
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
        const save = await findSave(page, S, ctx);
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

/**
 * Réinitialisation du mot de passe d'un intervenant existant.
 *
 * Parcours : Administratif > Intervenant > Intervenants (la liste) → filtre sur
 * l'établissement → recherche de l'intervenant → Fiche intervenant →
 * « Ne pas modifier » bascule sur « Définir un mot de passe » → nouveau mot de
 * passe provisoire → Enregistrer.
 *
 * Le mot de passe posé est ALÉATOIRE et remis au bénéficiaire par lien
 * sécurisé : il n'est ni choisi par le demandeur, ni journalisé.
 */
async function resetPassword(data, ctx) {
  const identifiant = String(data.identifiant || '').trim();
  const newPassword = randomProvisionalPassword();

  if (getMode(ENV) === 'demo') {
    ctx.log('Mode démonstration actif (AUTOMATION_MODE=production pour cibler la vraie application)');
    const total = 6;
    let done = 0;
    for (const label of [
      'Connexion au compte administrateur',
      'Double authentification',
      `Bascule sur l'établissement`,
      `Recherche de l'intervenant « ${identifiant} »`,
      'Nouveau mot de passe provisoire saisi',
      'Fiche enregistrée',
    ]) {
      ctx.log(`Étape ${++done}/${total} — ${label}`);
      if (ctx.progress) ctx.progress(done, total, label);
    }
    return {
      success: true,
      message: `Mot de passe réinitialisé pour « ${identifiant} » (environnement de démonstration)`,
      account: { login: identifiant, password: newPassword, prenom: '', nom: '' },
      artifacts: [],
    };
  }

  const S = applySelectorPatches(BASE_SELECTORS, config.id);
  const base = process.env.NETSOINS_URL.replace(/\/$/, '');
  const steps = buildLoginSteps({ S, ctx, base });

  steps.push(
    {
      id: 'liste',
      critical: true,
      label: 'Ouverture de la liste des intervenants',
      run: async (page) => {
        await L(page, S.menu.administratif).first().click();
        await L(page, S.menu.intervenant).first().click();
        await L(page, S.menu.intervenantsListe).first().click();
        ctx.log('Liste des intervenants ouverte.');
      },
    },
    {
      id: 'etablissement',
      critical: true,
      label: `Bascule sur l'établissement ${etabLabel(data.etablissement)}`,
      run: async (page) => {
        await L(page, S.liste.etablissementOpen).first().click();
        const option = L(page, S.liste.etablissementOption(data.etablissement)).first();
        try {
          await option.waitFor({ timeout: 5000 });
        } catch {
          throw new Error(`Établissement « ${etabLabel(data.etablissement)} » absent de la liste — le compte administrateur y a-t-il accès ?`);
        }
        await option.click();
        ctx.log(`Établissement sélectionné : ${etabLabel(data.etablissement)}.`);
      },
    },
    {
      id: 'recherche',
      critical: true,
      label: `Recherche de l'intervenant « ${identifiant} »`,
      run: async (page) => {
        // Champ de recherche s'il existe : réduit la liste avant de cliquer.
        const search = L(page, S.liste.search).first();
        try {
          await search.waitFor({ timeout: 3000 });
          await search.fill(identifiant);
          await page.waitForTimeout(1200);
          ctx.log('Recherche filtrée sur l’identifiant.');
        } catch {
          ctx.log('Pas de champ de recherche — repérage direct dans la liste.');
        }

        // On clique la ligne portant l'identifiant, puis sa fiche.
        const ligne = L(page, S.liste.resultat(identifiant)).last();
        try {
          await ligne.waitFor({ timeout: 8000 });
        } catch {
          throw new Error(`Intervenant « ${identifiant} » introuvable dans ${etabLabel(data.etablissement)} — vérifiez l'identifiant et l'établissement`);
        }
        await ligne.click();
        await L(page, S.liste.ficheIntervenant).first().click();
        ctx.log('Fiche intervenant ouverte.');
      },
    },
    {
      id: 'motdepasse',
      critical: true,
      label: 'Saisie du nouveau mot de passe provisoire',
      run: async (page) => {
        // La fiche est sur « Ne pas modifier » : tant qu'on n'a pas basculé sur
        // « Définir un mot de passe », les champs restent inaccessibles.
        // Selon l'écran, c'est une vraie liste déroulante ou un menu
        // personnalisé rendu comme un lien : on gère les deux.
        const combo = L(page, S.motDePasse.modeSelect);
        if (await combo.count().catch(() => 0)) {
          await combo.first().selectOption({ label: 'Définir un mot de passe' });
          ctx.log('Mode « Définir un mot de passe » choisi dans la liste déroulante.');
        } else {
          ctx.log('Ouverture du menu « Gestion du mot de passe »…');
          await L(page, S.motDePasse.modeOpen).first().click();
          const option = L(page, S.motDePasse.modeDefinir).first();
          try {
            await option.waitFor({ timeout: 8000 });
          } catch {
            throw new Error('Option « Définir un mot de passe » introuvable après ouverture du menu — sélecteur « motDePasse.modeDefinir » à calibrer');
          }
          await option.click();
          ctx.log('Mode « Définir un mot de passe » activé.');
        }

        // Les champs n'apparaissent qu'une fois le mode basculé.
        try {
          await L(page, S.motDePasse.password).first().waitFor({ timeout: 8000 });
        } catch {
          throw new Error('Les champs de mot de passe ne sont pas apparus — la bascule « Définir un mot de passe » n’a pas pris effet');
        }

        const pw = L(page, S.motDePasse.password).first();
        await pw.click();
        await pw.fill(newPassword);
        const pwc = L(page, S.motDePasse.passwordConfirm).first();
        await pwc.click();
        await pwc.fill(newPassword);
        ctx.log('Nouveau mot de passe provisoire saisi (non journalisé).');
      },
    },
    {
      id: 'enregistrement',
      critical: true,
      label: 'Enregistrement de la fiche',
      run: async (page) => {
        const save = await findSave(page, S, ctx);
        await save.click();
        await page.waitForTimeout(2500);
        ctx.log('Fiche enregistrée.');
      },
    }
  );

  const result = await runScenario({
    reference: ctx.reference,
    log: ctx.log,
    onProgress: ctx.progress,
    successMessage: `Mot de passe réinitialisé pour « ${identifiant} »`,
    steps: composeSteps(config.id, steps, data, ctx.log),
  });
  // Le mot de passe provisoire est remis par lien sécurisé (jamais par e-mail).
  if (result.success) {
    result.account = { login: identifiant, password: newPassword, prenom: '', nom: '' };
  }
  return result;
}

module.exports = { createAccount, resetPassword, STEPS_META, RESET_STEPS_META, chooseStrategy };
