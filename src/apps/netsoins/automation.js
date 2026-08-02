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
const comptesProteges = require('../../comptesProteges');
const config = require('./config');
const { baseLogin } = require('./login');
const { motDePasseProvisoire } = require('../../automation/identifiants');
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
// « text-exact:… » → correspondance sur le texte EXACT, espaces normalisés.
// Indispensable pour les listes où un libellé est le préfixe d'un autre
// (« Infirmier/ère » et « Infirmier/ère H.A.D ») et dont les options portent
// des espaces d'indentation.
const TEXT_EXACT = /^text-exact:(.+)$/;
function L(scope, selector) {
  const t = TEXT_EXACT.exec(selector);
  if (t) return scope.getByText(t[1], { exact: true });
  const m = ROLE_SELECTOR.exec(selector);
  return m ? scope.getByRole(m[1], { name: m[2] }) : scope.locator(selector);
}

/**
 * Clique la première correspondance réellement visible d'un locator.
 * Renvoie `true` si un clic a abouti, `false` si aucune ne répond — au
 * lieu d'attendre 30 s sur une ligne masquée par la liste.
 */
async function cliquerPremierVisible(locator) {
  const n = await locator.count().catch(() => 0);
  for (let i = 0; i < Math.min(n, 5); i += 1) {
    const cible = locator.nth(i);
    if (!(await cible.isVisible().catch(() => false))) continue;
    try {
      await cible.click({ timeout: 5000 });
      return true;
    } catch { /* candidat suivant */ }
  }
  return false;
}

/** Étapes de la réinitialisation de mot de passe (éditeur de scénario). */
const RESET_STEPS_META = [
  { id: 'ouverture', label: 'Ouverture de NetSoins', critical: true, selectorKeys: [] },
  { id: 'connexion', label: 'Connexion administrateur', critical: true, selectorKeys: ['login.user', 'login.password', 'login.submit'] },
  { id: 'otp', label: 'Double authentification (code par e-mail)', critical: true, selectorKeys: ['login.otpInput', 'login.otpSubmit', 'closePopup'] },
  { id: 'liste', label: 'Ouverture de la liste des intervenants', critical: true, selectorKeys: ['menu.administratif', 'menu.intervenant', 'menu.intervenantsListe'] },
  { id: 'etablissement', label: "Bascule sur l'etablissement", critical: true, selectorKeys: ['liste.etablissementOpen'] },
  { id: 'recherche', label: "Recherche de l'intervenant", critical: true, selectorKeys: ['liste.panneau', 'liste.searchRole', 'liste.search', 'liste.ficheIntervenant'] },
  { id: 'motdepasse', label: 'Saisie du nouveau mot de passe', critical: true, selectorKeys: ['motDePasse.modeOpen', 'motDePasse.modeDefinir', 'motDePasse.password', 'motDePasse.passwordConfirm'] },
  { id: 'enregistrement', label: 'Enregistrement de la fiche', critical: true, selectorKeys: ['save'] },
];

/**
 * Mot de passe provisoire posé lors d'une réinitialisation : remis au
 * bénéficiaire par lien sécurisé, puis changé à la première connexion.
 * Le point final satisfait l'exigence de caractère spécial de NetSoins.
 */
function randomProvisionalPassword() {
  return motDePasseProvisoire('.');
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
 * Coche UN établissement dans la liste des établissements autorisés.
 *
 * NetSoins affiche les établissements sous leur libellé HIÉRARCHIQUE
 * (« ADEF RESIDENCES - EHPAD - La Maison Chantereine - 94600 CHOISY LE ROI »)
 * et replie l'arbre : on filtre donc par le champ de recherche du menu plutôt
 * que de déplier les groupes — déplier obligerait à approcher le nœud parent,
 * dont la case sélectionne tout le groupe d'un coup.
 *
 * La case est un interrupteur : son état est lu avant d'agir, faute de quoi un
 * établissement déjà rattaché serait retiré.
 */
async function cocherEtablissement(page, S, ctx, value) {
  const label = etabLabel(value);
  const nom = label.split(' - ')[0].trim();

  // Le libellé NetSoins vaut « ADEF RESIDENCES - <TYPE> - <notre libellé> » :
  // chercher le libellé COMPLET est donc plus sûr que le seul nom, et écarte
  // d'emblée les lignes « Tous les établissements du groupe ».
  const chercherLigne = () => {
    const lignes = L(page, S.compte.etabRow).filter({ hasNotText: S.compte.etabToutCocher });
    return lignes.filter({ hasText: label }).or(lignes.filter({ hasText: nom })).first();
  };
  const ligneVisible = async () =>
    (await chercherLigne().isVisible().catch(() => false));

  // 1. Filtrer par le champ de recherche du menu : c'est la voie la plus sûre,
  //    elle évite d'avoir à toucher à l'arborescence.
  const recherche = L(page, S.compte.etabSearch).first();
  try {
    await recherche.waitFor({ state: 'visible', timeout: 3000 });
    await recherche.click();
    await recherche.fill(nom);
    await page.waitForTimeout(700);
  } catch {
    ctx.log('Pas de champ de recherche dans la liste — dépliage de l’arborescence.');
  }

  // 2. Si l'établissement n'apparaît toujours pas, il est replié sous son
  //    groupe : on déplie en cliquant les INTITULÉS (jamais leur case, qui
  //    sélectionnerait tout le groupe), et on s'arrête dès qu'il est visible.
  if (!(await ligneVisible())) {
    const groupes = L(page, S.compte.etabGroupe);
    const n = await groupes.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      try {
        await groupes.nth(i).click({ timeout: 1500 });
        await page.waitForTimeout(500);
      } catch {
        continue;
      }
      if (await ligneVisible()) break;
    }
  }

  const ligne = chercherLigne();
  try {
    await ligne.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    let proposes = [];
    try {
      proposes = await L(page, S.compte.etabRow).evaluateAll((els) =>
        els
          .filter((e) => e.offsetParent !== null)
          .slice(0, 15)
          .map((e) => (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60))
          .filter(Boolean)
      );
    } catch {
      /* le diagnostic ne doit pas masquer l'erreur d'origine */
    }
    throw new Error(
      `Établissement « ${nom} » introuvable dans la liste.` +
        (proposes.length ? ` Options visibles : ${proposes.map((t) => `« ${t} »`).join(', ')}` : '')
    );
  }

  // Selon les écrans, c'est la pastille, la ligne entière ou la case elle-même
  // qui réagit au clic. On essaie dans cet ordre, en relisant l'état AVANT
  // chaque tentative — sans quoi un second clic retirerait ce que le premier
  // vient de cocher — puis on VÉRIFIE le résultat.
  const caseACocher = ligne.locator('input[type="checkbox"]').first();
  const estCochee = () => caseACocher.isChecked().catch(() => false);

  if (await estCochee()) {
    ctx.log(`Établissement déjà autorisé : ${label}.`);
  } else {
    for (const cible of [ligne.locator('.checkbox').first(), ligne, caseACocher]) {
      if (await estCochee()) break;
      try {
        await cible.click({ timeout: 3000 });
      } catch {
        continue; // cible non cliquable : on tente la suivante
      }
      await page.waitForTimeout(250);
    }
    if (!(await estCochee())) {
      throw new Error(`Établissement « ${nom} » trouvé, mais sa case n'a pas pu être cochée`);
    }
    ctx.log(`Établissement autorisé : ${label}.`);
  }

  // Remet la liste à zéro pour l'établissement suivant.
  try {
    await recherche.fill('');
    await page.waitForTimeout(400);
  } catch {
    /* pas de champ de recherche */
  }
}

/**
 * RETIRE un établissement de la liste des établissements autorisés.
 *
 * Pendant exact de `cocherEtablissement` : même repérage (recherche du menu puis
 * dépliage), mêmes exclusions (copies masquées, lignes « Tous les
 * établissements »), et surtout même prudence sur l'interrupteur — une case
 * déjà décochée ne doit pas être cliquée, sous peine de la cocher.
 */
async function decocherEtablissement(page, S, ctx, value) {
  const label = etabLabel(value);
  const nom = label.split(' - ')[0].trim();

  const chercherLigne = () => {
    const lignes = L(page, S.compte.etabRow).filter({ hasNotText: S.compte.etabToutCocher });
    return lignes.filter({ hasText: label }).or(lignes.filter({ hasText: nom })).first();
  };

  const recherche = L(page, S.compte.etabSearch).first();
  try {
    await recherche.waitFor({ state: 'visible', timeout: 3000 });
    await recherche.click();
    await recherche.fill(nom);
    await page.waitForTimeout(700);
  } catch {
    /* pas de champ de recherche : la liste est déjà déployée */
  }

  const ligne = chercherLigne();
  try {
    await ligne.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    // Introuvable : le compte n'y était peut-être plus rattaché. Ce n'est pas un
    // échec du transfert — on le signale et on continue.
    ctx.log(`Établissement « ${nom} » absent de la liste : rien à retirer.`);
    return;
  }

  const caseACocher = ligne.locator('input[type="checkbox"]').first();
  const estCochee = () => caseACocher.isChecked().catch(() => false);

  if (!(await estCochee())) {
    ctx.log(`Établissement « ${label} » déjà non rattaché : rien à retirer.`);
  } else {
    for (const cible of [ligne.locator('.checkbox').first(), ligne, caseACocher]) {
      if (!(await estCochee())) break;
      try {
        await cible.click({ timeout: 3000 });
      } catch {
        continue;
      }
      await page.waitForTimeout(250);
    }
    if (await estCochee()) {
      throw new Error(`Établissement « ${nom} » trouvé, mais sa case n'a pas pu être décochée`);
    }
    ctx.log(`Établissement retiré : ${label}.`);
  }

  try {
    await recherche.fill('');
    await page.waitForTimeout(400);
  } catch {
    /* pas de champ de recherche */
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
  // Annoncé d'emblée : on voit tout de suite ce qui sera coché, et donc si la
  // demande contient plus d'établissements que voulu.
  ctx.log(
    `Établissements à autoriser (${etabsAutorises.length}) : ${etabsAutorises.map(etabLabel).join(' | ')}`
  );

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

        // Établissements autorisés : STRICTEMENT ceux choisis dans le
        // formulaire. On n'agit jamais sur le nœud parent « ADEF RESIDENCES »,
        // qui sélectionnerait tout le groupe d'un coup.
        await L(page, S.compte.etabOpen).first().click();
        for (const value of etabsAutorises) {
          await cocherEtablissement(page, S, ctx, value);
        }
      },
    },
    {
      id: 'informations',
      critical: true,
      label: `Onglet Informations — état civil (${fullName})`,
      run: async (page) => {
        // Deux clics : le bandeau de l'onglet, puis son intitulé.
        await L(page, S.informations.tabZone).first().click().catch(() => {});
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
/**
 * Étapes menant à la fiche d'un intervenant EXISTANT : liste des intervenants,
 * bascule sur son établissement, recherche, ouverture de la fiche.
 * Partagé par la réinitialisation de mot de passe, la correction d'identité et
 * le transfert d'établissement.
 */
function buildOuvrirFicheSteps({ S, ctx, data, identifiant }) {
  return [
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
        // La recherche NetSoins ne se déclenche qu'à la validation : remplir le
        // champ sans valider laisse la liste entière, et la ligne cherchée
        // n'apparaît jamais. La validation passe par le bouton (loupe) accolé
        // au champ ; Entrée n'est qu'un repli si ce bouton reste introuvable.
        // Le champ visé est celui de la LISTE, pas celui du bandeau de
        // NETParamètres qui cherche dans toute l'application : remplir ce
        // dernier ne filtre rien. En dernier recours on prend le DERNIER champ
        // de la page, celui du bandeau venant toujours en premier.
        let search = null;
        let ouSaisi = '';
        for (const [voie, ou] of [
          // Le champ de la liste n'est pas de type `search` : il se repère par
          // son libellé accessible « Recherche », dans le panneau de la liste.
          ['le champ « Recherche » de la liste', () => L(page.locator(S.liste.panneau), S.liste.searchRole).first()],
          ['le champ de la liste', () => L(page, S.liste.search).first()],
          ['le dernier champ de la page', () => L(page, S.liste.searchAlt).last()],
        ]) {
          const champ = ou();
          try {
            await champ.waitFor({ state: 'visible', timeout: 3000 });
            search = champ;
            ouSaisi = voie;
            break;
          } catch { /* voie suivante */ }
        }
        let filtre = false;
        try {
          if (!search) throw new Error('aucun champ de recherche');
          await search.click();
          await search.fill(identifiant).catch(() => {});

          // `fill()` pose la valeur d'un coup ; certains champs ne réagissent
          // qu'à de VRAIES frappes clavier et restent vides. On relit donc ce
          // qui est réellement dans le champ, et on retape lettre par lettre si
          // besoin — sinon la recherche partirait à vide et listerait tout le
          // monde.
          let saisi = await search.inputValue().catch(() => '');
          if (saisi !== identifiant) {
            await search.fill('').catch(() => {});
            await search.pressSequentially(identifiant, { delay: 60 });
            saisi = await search.inputValue().catch(() => '');
            ctx.log(`Saisie reprise en frappes clavier (le champ n'avait pas retenu la valeur).`);
          }
          if (saisi !== identifiant) {
            throw new Error(`Le champ de recherche de la liste n'a pas accepté « ${identifiant} » (il contient « ${saisi} ») — impossible de filtrer sans risque de tomber sur le mauvais intervenant`);
          }

          let valide = '';
          for (const [voie, sel] of [['bouton de recherche', S.liste.searchSubmit], ['bouton de la barre d’outils', S.liste.searchSubmitAlt]]) {
            const bouton = L(page, sel).last();
            try {
              await bouton.waitFor({ state: 'visible', timeout: 2000 });
              await bouton.click();
              valide = voie;
              break;
            } catch { /* voie suivante */ }
          }
          if (!valide) {
            await search.press('Enter');
            valide = 'touche Entrée';
          }
          await page.waitForTimeout(1200);
          filtre = true;
          ctx.log(`Recherche lancée sur « ${identifiant} » dans ${ouSaisi} (validée par ${valide}).`);
        } catch {
          ctx.log('Pas de champ de recherche dans la liste — repérage direct.');
        }

        // La liste éclate « NOM PRÉNOM » en deux colonnes : aucun élément ne
        // porte la chaîne entière, le clic sur l'identifiant complet échoue
        // donc toujours. On vise d'abord la ligne complète (au cas où), puis la
        // ligne qui contient À LA FOIS le nom et le prénom, puis le prénom
        // seul — comme relevé sur l'instance réelle.
        const mots = identifiant.split(/\s+/).filter(Boolean);
        const nom = mots[0];
        const prenom = mots.length > 1 ? mots[mots.length - 1] : '';

        const pistes = [{ quoi: 'identifiant complet', ou: L(page, S.liste.resultat(identifiant)), unique: false }];
        // Les pistes partielles ne sont ouvertes QUE si la recherche a bien
        // filtré : sur une liste entière, cliquer un simple prénom ouvrirait la
        // fiche d'un homonyme — et réinitialiserait le mot de passe du mauvais
        // intervenant. Elles exigent en plus UNE SEULE correspondance.
        if (filtre && prenom) {
          for (const rangee of ['tr', '[role="row"]', 'li']) {
            pistes.push({
              quoi: `ligne « ${nom} » + « ${prenom} »`,
              ou: page.locator(rangee).filter({ hasText: nom }).filter({ hasText: prenom }),
              unique: true,
            });
          }
          pistes.push({ quoi: `prénom « ${prenom} »`, ou: L(page, S.liste.resultat(prenom)), unique: true });
        }

        let ouverte = null;
        let ambigu = 0;
        for (const piste of pistes) {
          try {
            await piste.ou.first().waitFor({ timeout: filtre ? 4000 : 8000 });
          } catch {
            continue; // rien sous cette piste
          }
          if (piste.unique) {
            const n = await piste.ou.count().catch(() => 0);
            // Plusieurs candidats : on ne devine pas lequel est le bon.
            if (n > 1) { ambigu = Math.max(ambigu, n); continue; }
          }
          // La liste garde des copies masquées de ses lignes : cliquer la
          // dernière correspondance à l'aveugle bloquait 30 s sur un élément
          // invisible. On prend la première réellement cliquable, et un échec
          // fait passer à la piste suivante au lieu de tuer la demande.
          const clic = await cliquerPremierVisible(piste.ou);
          if (!clic) continue;
          ouverte = piste.quoi;
          break;
        }
        if (!ouverte && ambigu > 1) {
          throw new Error(`Plusieurs intervenants (${ambigu}) correspondent à « ${identifiant} » dans ${etabLabel(data.etablissement)} — impossible de choisir sans risque, précisez l'identifiant`);
        }
        if (!ouverte) {
          throw new Error(`Intervenant « ${identifiant} » introuvable dans ${etabLabel(data.etablissement)} — vérifiez l'identifiant (format NOM PRÉNOM) et l'établissement`);
        }
        ctx.log(`Intervenant repéré par ${ouverte}.`);
        await L(page, S.liste.ficheIntervenant).first().click();
        ctx.log('Fiche intervenant ouverte.');
      },
    }
  ];
}

async function resetPassword(data, ctx) {
  // Défense en profondeur : le portail refuse déjà ces demandes au dépôt, mais
  // un robot ne doit jamais toucher au compte de service dont il se sert —
  // y compris pour une demande déposée avant la mise en place du contrôle.
  const refusProtege = comptesProteges.refus(config.id, data);
  if (refusProtege) return { success: false, message: refusProtege, artifacts: [] };
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
    ...buildOuvrirFicheSteps({ S, ctx, data, identifiant }),
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

/**
 * Correction de l'identité d'un intervenant existant : nom de naissance et
 * premier prénom, sur l'onglet Informations. L'identifiant de connexion n'est
 * PAS touché — il est déjà diffusé au titulaire.
 */
async function updateIdentity(data, ctx) {
  // Défense en profondeur : le portail refuse déjà ces demandes au dépôt, mais
  // un robot ne doit jamais toucher au compte de service dont il se sert —
  // y compris pour une demande déposée avant la mise en place du contrôle.
  const refusProtege = comptesProteges.refus(config.id, data);
  if (refusProtege) return { success: false, message: refusProtege, artifacts: [] };
  const identifiant = String(data.identifiant || '').trim();
  const nouvelleIdentite = `${data.prenom || ''} ${data.nom || ''}`.trim();

  if (getMode(ENV) === 'demo') {
    ctx.log('Mode démonstration actif (AUTOMATION_MODE=production pour cibler la vraie application)');
    const etapes = [
      'Connexion au compte administrateur',
      'Double authentification',
      "Bascule sur l'établissement",
      `Recherche de l'intervenant « ${identifiant} »`,
      `Correction de l'identité (${nouvelleIdentite})`,
      'Fiche enregistrée',
    ];
    etapes.forEach((label, i) => {
      ctx.log(`Étape ${i + 1}/${etapes.length} — ${label}`);
      if (ctx.progress) ctx.progress(i + 1, etapes.length, label);
    });
    return {
      success: true,
      message: `Identité corrigée pour « ${identifiant} » → ${nouvelleIdentite} (environnement de démonstration)`,
      artifacts: [],
    };
  }

  const S = applySelectorPatches(BASE_SELECTORS, config.id);
  const base = process.env.NETSOINS_URL.replace(/\/$/, '');
  const steps = buildLoginSteps({ S, ctx, base });

  steps.push(
    ...buildOuvrirFicheSteps({ S, ctx, data, identifiant }),
    {
      id: 'identite',
      critical: true,
      label: `Correction de l'identité (${nouvelleIdentite})`,
      run: async (page) => {
        // L'état civil se trouve sur l'onglet Informations.
        await L(page, S.informations.tabZone).first().click().catch(() => {});
        await L(page, S.informations.tab).first().click();
        ctx.log('Onglet « Informations » ouvert.');

        const nom = L(page, S.informations.nomNaissance).first();
        await nom.click();
        await nom.fill(data.nom);
        const prenom = L(page, S.informations.premierPrenom).first();
        await prenom.click();
        await prenom.fill(data.prenom);
        ctx.log(`Nom de naissance et premier prénom corrigés : ${nouvelleIdentite}.`);
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

  return runScenario({
    reference: ctx.reference,
    log: ctx.log,
    onProgress: ctx.progress,
    successMessage: `Identité corrigée pour « ${identifiant} » → ${nouvelleIdentite}`,
    steps: composeSteps(config.id, steps, data, ctx.log),
  });
}

/**
 * Ajout d'un établissement à un intervenant existant : on CUMULE les
 * rattachements (l'établissement d'origine est conservé). C'est la différence
 * avec le transfert, qui retire l'ancien.
 *
 * La liste des intervenants étant filtrée par établissement, on part de
 * l'établissement actuel (`etablissement`) pour retrouver la fiche, puis on
 * coche le nouveau (`etablissement_cible`).
 */
async function addEstablishment(data, ctx) {
  // Défense en profondeur : le portail refuse déjà ces demandes au dépôt, mais
  // un robot ne doit jamais toucher au compte de service dont il se sert —
  // y compris pour une demande déposée avant la mise en place du contrôle.
  const refusProtege = comptesProteges.refus(config.id, data);
  if (refusProtege) return { success: false, message: refusProtege, artifacts: [] };
  const identifiant = String(data.identifiant || '').trim();
  const actuel = String(data.etablissement || '');
  const cible = String(data.etablissement_cible || '');

  if (actuel === cible) {
    return {
      success: false,
      message: `L'intervenant est déjà rattaché à ${etabLabel(cible)} : il n'y a rien à ajouter.`,
      artifacts: [],
    };
  }

  if (getMode(ENV) === 'demo') {
    ctx.log('Mode démonstration actif (AUTOMATION_MODE=production pour cibler la vraie application)');
    const etapes = [
      'Connexion au compte administrateur',
      'Double authentification',
      `Bascule sur l'établissement ${etabLabel(actuel)}`,
      `Recherche de l'intervenant « ${identifiant} »`,
      `Rattachement à ${etabLabel(cible)}`,
      'Fiche enregistrée',
    ];
    etapes.forEach((label, i) => {
      ctx.log(`Étape ${i + 1}/${etapes.length} — ${label}`);
      if (ctx.progress) ctx.progress(i + 1, etapes.length, label);
    });
    return {
      success: true,
      message: `${etabLabel(cible)} ajouté à « ${identifiant} » (environnement de démonstration)`,
      artifacts: [],
    };
  }

  const S = applySelectorPatches(BASE_SELECTORS, config.id);
  const base = process.env.NETSOINS_URL.replace(/\/$/, '');
  const steps = buildLoginSteps({ S, ctx, base });

  steps.push(
    ...buildOuvrirFicheSteps({ S, ctx, data, identifiant }),
    {
      id: 'ajout',
      critical: true,
      label: `Rattachement à ${etabLabel(cible)}`,
      run: async (page) => {
        await L(page, S.compte.etabOpen).first().click();
        // Rien à décocher : les rattachements en place restent tels quels.
        await cocherEtablissement(page, S, ctx, cible);
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

  return runScenario({
    reference: ctx.reference,
    log: ctx.log,
    onProgress: ctx.progress,
    successMessage: `${etabLabel(cible)} ajouté à « ${identifiant} »`,
    steps: composeSteps(config.id, steps, data, ctx.log),
  });
}

/**
 * Transfert d'un intervenant vers un autre établissement : on RETIRE le
 * rattachement d'origine, puis on attribue le nouveau. À la différence de
 * l'ajout d'établissement, l'intervenant perd l'accès à son établissement
 * précédent — c'est bien l'intention de cette démarche.
 */
async function transferEstablishment(data, ctx) {
  // Défense en profondeur : le portail refuse déjà ces demandes au dépôt, mais
  // un robot ne doit jamais toucher au compte de service dont il se sert —
  // y compris pour une demande déposée avant la mise en place du contrôle.
  const refusProtege = comptesProteges.refus(config.id, data);
  if (refusProtege) return { success: false, message: refusProtege, artifacts: [] };
  const identifiant = String(data.identifiant || '').trim();
  const depart = String(data.etablissement || '');
  const cible = String(data.etablissement_cible || '');

  if (depart === cible) {
    return {
      success: false,
      message: "L'établissement d'arrivée est identique à l'établissement de départ : il n'y a rien à transférer.",
      artifacts: [],
    };
  }

  if (getMode(ENV) === 'demo') {
    ctx.log('Mode démonstration actif (AUTOMATION_MODE=production pour cibler la vraie application)');
    const etapes = [
      'Connexion au compte administrateur',
      'Double authentification',
      "Bascule sur l'établissement de départ",
      `Recherche de l'intervenant « ${identifiant} »`,
      `Retrait de ${etabLabel(depart)}`,
      `Rattachement à ${etabLabel(cible)}`,
      'Fiche enregistrée',
    ];
    etapes.forEach((label, i) => {
      ctx.log(`Étape ${i + 1}/${etapes.length} — ${label}`);
      if (ctx.progress) ctx.progress(i + 1, etapes.length, label);
    });
    return {
      success: true,
      message: `« ${identifiant} » transféré de ${etabLabel(depart)} vers ${etabLabel(cible)} (environnement de démonstration)`,
      artifacts: [],
    };
  }

  const S = applySelectorPatches(BASE_SELECTORS, config.id);
  const base = process.env.NETSOINS_URL.replace(/\/$/, '');
  const steps = buildLoginSteps({ S, ctx, base });

  steps.push(
    ...buildOuvrirFicheSteps({ S, ctx, data, identifiant }),
    {
      id: 'transfert',
      critical: true,
      label: `Transfert : ${etabLabel(depart)} → ${etabLabel(cible)}`,
      run: async (page) => {
        await L(page, S.compte.etabOpen).first().click();
        // L'ordre compte : on rattache le nouvel établissement AVANT de retirer
        // l'ancien. NetSoins exige au moins un établissement autorisé ; retirer
        // d'abord laisserait la fiche momentanément invalide.
        await cocherEtablissement(page, S, ctx, cible);
        await decocherEtablissement(page, S, ctx, depart);
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

  return runScenario({
    reference: ctx.reference,
    log: ctx.log,
    onProgress: ctx.progress,
    successMessage: `« ${identifiant} » transféré de ${etabLabel(depart)} vers ${etabLabel(cible)}`,
    steps: composeSteps(config.id, steps, data, ctx.log),
  });
}


module.exports = {
  createAccount,
  resetPassword,
  updateIdentity,
  addEstablishment,
  transferEstablishment,
  STEPS_META,
  RESET_STEPS_META,
  chooseStrategy,
  // Exposé pour les tests : permet de rejouer le repérage d'un intervenant
  // dans la liste sans dérouler tout le scénario.
  buildOuvrirFicheSteps,
};
