'use strict';

/**
 * Scénario de création de compte BlueKanGo (instance ADEF Résidences),
 * calibré sur un enregistrement codegen réel.
 *
 * Principe : DUPLICATION d'un utilisateur existant de l'établissement ayant
 * la même fonction (le nouveau compte hérite des mêmes droits), puis saisie
 * de l'identité et des identifiants :
 *   - identifiant généré : 1re lettre du prénom + nom (ex. Marie Dupont → mdupont)
 *   - mot de passe initial : BLUEKANGO_DEFAULT_PASSWORD, avec réinitialisation
 *     obligatoire au premier login.
 *
 * Mode production : AUTOMATION_MODE=production + BLUEKANGO_URL,
 * BLUEKANGO_ADMIN_USER, BLUEKANGO_ADMIN_PASSWORD, BLUEKANGO_DEFAULT_PASSWORD.
 * Sinon : mode démo sur la console intégrée.
 *
 * Cas non couvert pour l'instant : aucun utilisateur de l'établissement n'a
 * la fonction demandée (pas de modèle à dupliquer). La demande passe alors en
 * échec avec un message explicite — enregistrer ce parcours "création sans
 * modèle" au codegen permettra d'ajouter la seconde variante du scénario.
 */

const db = require('../../db');
const { getMode } = require('../../automation/helpers');
const { runScenario } = require('../../automation/engine');
const { applySelectorPatches, composeSteps } = require('../../automation/scenarioRuntime');
const { pickUniqueLogin, candidateLogins } = require('../../automation/identifiants');
const demo = require('../../automation/demoDriver');
const config = require('./config');
const BASE_SELECTORS = require('./selectors');

const ENV = [
  'BLUEKANGO_URL',
  'BLUEKANGO_ADMIN_USER',
  'BLUEKANGO_ADMIN_PASSWORD',
  'BLUEKANGO_DEFAULT_PASSWORD',
];

/**
 * Métadonnées des étapes natives, affichées dans l'éditeur de scénario du
 * panel admin. `critical: true` = jamais désactivable. `selectorKeys` = chemins
 * de sélecteurs (dans selectors.js) modifiables depuis l'admin.
 */
const STEPS_META = [
  { id: 'ouverture', label: 'Ouverture de BlueKanGo', critical: true, selectorKeys: [] },
  { id: 'connexion', label: 'Connexion avec le compte administrateur', critical: true, selectorKeys: [] },
  { id: 'menu-utilisateurs', label: 'Administration > Gestion des ressources > Utilisateurs', critical: true, selectorKeys: [] },
  { id: 'etablissement', label: "Vérification / bascule de l'établissement", critical: true, selectorKeys: [] },
  { id: 'duplication', label: 'Duplication d’un utilisateur ayant la fonction demandée', critical: true, selectorKeys: ['userList.duplicateButton'] },
  { id: 'identite', label: 'Saisie de l’identité (nom, prénom, civilité)', critical: true, selectorKeys: ['form.nom', 'form.prenom'] },
  { id: 'identifiants', label: 'Création des identifiants de connexion', critical: true, selectorKeys: ['form.loginField', 'form.password', 'form.password2', 'form.reinitCheckbox'] },
  { id: 'validite', label: 'Saisie de la date de fin de validité', critical: false, selectorKeys: ['form.dateFinRowLabel'] },
  { id: 'enregistrement', label: 'Enregistrement de la fiche (Valider)', critical: true, selectorKeys: [] },
];

/** yyyy-mm-dd (formulaire) → jj/mm/aaaa (saisie BlueKanGo). */
function toFrDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/**
 * Clique le profil sur la page de choix (si elle apparaît). Peu importe lequel :
 * l'établissement demandé par le client est sélectionné juste après (étape
 * « etablissement » via le menu #change_etab). Non bloquant.
 */
async function selectProfile(page, log) {
  const link = page.getByRole('link', { name: /\S+\s+\S+\s+\S+/ }).first();
  if (await link.isVisible().catch(() => false)) {
    const label = await link.textContent().catch(() => '');
    await link.click({ timeout: 8000 }).catch(() => {});
    if (log && label) log(`Profil sélectionné : « ${label.trim()} »`);
  }
}

/**
 * Recherche le select d'établissement (« Etablissements : XXX » en haut à
 * droite) dans TOUTES les frames de la page. BlueKanGo classique utilise
 * d'anciens <frame> (frameset), pas des <iframe> : on itère donc sur
 * page.frames() plutôt que sur un frameLocator ciblant "iframe".
 * On tente d'abord l'id/name (#change_etab), puis le libellé.
 */
async function findEtabSelect(page, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (page.isClosed()) return null;
    for (const frame of page.frames()) {
      try {
        let loc = frame.locator('#change_etab, select[name="change_etab"]').first();
        if (await loc.count()) return loc;
        loc = frame.getByLabel(/Établissements/).first();
        if (await loc.count()) return loc;
      } catch {
        /* frame en cours de navigation : on ignore */
      }
    }
    await page.waitForTimeout(500).catch(() => {});
  }
  return null;
}

async function createAccount(data, ctx) {
  // Identifiant : imposé (ajout d'établissement à un compte existant) ou
  // généré unique (1re lettre du prénom + nom, lettres supplémentaires si pris).
  const fixedLogin = (data.identifiant || '').trim().toLowerCase();
  const login = fixedLogin || pickUniqueLogin(data.prenom, data.nom, (l) => db.loginExists(config.id, l));
  ctx.log(fixedLogin ? `Identifiant existant fourni : « ${login} »` : `Identifiant retenu : « ${login} »`);
  const account = { login, prenom: data.prenom, nom: data.nom };

  // BlueKanGo peut refuser l'identifiant (« déjà défini sur un autre
  // établissement ») pour des comptes que le portail ne connaît pas :
  // currentLogin évolue alors vers le candidat suivant pendant le scénario.
  let currentLogin = login;
  const tried = new Set([login]);
  const nextLogin = () => {
    for (const c of candidateLogins(data.prenom, data.nom)) {
      if (!tried.has(c) && !db.loginExists(config.id, c)) { tried.add(c); return c; }
    }
    const fallback = `${login}${Date.now().toString().slice(-4)}`;
    tried.add(fallback);
    return fallback;
  };

  if (getMode(ENV) === 'demo') {
    ctx.log('Mode démonstration actif (AUTOMATION_MODE=production pour cibler la vraie application)');
    const result = await demo.createAccount(config, data, ctx);
    if (result.success) {
      result.account = account;
      result.message = `${result.message} — identifiant « ${login} »`;
    }
    return result;
  }

  const base = process.env.BLUEKANGO_URL.replace(/\/$/, '');
  const fullName = `${data.prenom} ${data.nom}`;
  const etabLabel =
    config.formSchema.sections[1].fields[0].options.find((o) => o.value === data.etablissement)
      ?.label || data.etablissement;

  // Sélecteurs : base du code + remplacements édités dans le panel admin.
  const S = applySelectorPatches(BASE_SELECTORS, config.id);

  // Cadres BlueKanGo (résolus à la demande car les iframes se rechargent).
  let page;
  const main = () => page.frameLocator(S.frames.main);
  const fancy = () => main().frameLocator(S.frames.fancybox);

  const nativeSteps = [
      {
        id: 'ouverture',
        critical: true,
        label: 'Ouverture de BlueKanGo',
        run: (p) => {
          page = p;
          return page.goto(`${base}/index.php?`);
        },
      },
      {
        id: 'connexion',
        critical: true,
        label: 'Connexion avec le compte administrateur',
        run: async () => {
          await page.getByRole('textbox', { name: S.login.userLabel }).fill(process.env.BLUEKANGO_ADMIN_USER);
          await page.getByRole('textbox', { name: S.login.passwordLabel }).fill(process.env.BLUEKANGO_ADMIN_PASSWORD);
          await page.getByRole('button', { name: S.login.submitLabel }).click();
          // Page de choix de profil éventuelle (« Prénom Nom ÉTABLISSEMENT »).
          await selectProfile(page, ctx.log);
        },
      },
      {
        id: 'menu-utilisateurs',
        critical: true,
        label: 'Ouverture de Administration > Gestion des ressources > Utilisateurs',
        run: async () => {
          // Comme le codegen : le clic attend tout seul que « Administration » soit prêt.
          await page.getByText(S.nav.administration).first().click();
          await main().getByRole('button', { name: S.nav.gestionRessources }).click();
          await main().getByRole('link', { name: S.nav.utilisateurs }).click();
        },
      },
      {
        id: 'etablissement',
        critical: true,
        label: `Vérification de l'établissement (« ${etabLabel} »)`,
        run: async () => {
          // Le select d'établissement (« Etablissements : XXX ») vit dans une
          // frame de l'interface classique : on le cherche dans toutes les frames.
          const select = await findEtabSelect(page);
          if (!select) {
            throw new Error(
              `Sélecteur d'établissement introuvable dans les frames de la page. Voir la capture.`
            );
          }
          const current = await select.inputValue().catch(() => null);
          if (current === data.etablissement) {
            ctx.log(`Déjà sur « ${etabLabel} » : aucun changement nécessaire`);
            return;
          }
          // On bascule sur le bon établissement, puis on rouvre la liste des
          // utilisateurs (elle se recharge pour le nouvel établissement).
          ctx.log(`Bascule d'établissement vers « ${etabLabel} »…`);
          await select.selectOption(data.etablissement);
          await page.waitForLoadState('networkidle');
          await main().getByRole('button', { name: S.nav.gestionRessources }).click();
          await main().getByRole('link', { name: S.nav.utilisateurs }).click();
        },
      },
      {
        id: 'duplication',
        critical: true,
        label: `Duplication d'un utilisateur ayant la fonction « ${data.fonction} »`,
        run: async () => {
          const list = main().frameLocator(S.frames.userList);

          // 1. Afficher 200 résultats par page : la fonction cherchée a plus de
          //    chances d'être présente (sinon elle peut être sur une autre page).
          //    La grille met quelques secondes à recharger les 200 lignes.
          ctx.log('Affichage de 200 résultats par page');
          const perPage = list.getByRole('listbox').first();
          if (await perPage.count().catch(() => 0)) {
            await perPage.selectOption('200').catch(() => {});
          } else {
            await list.locator('select').last().selectOption('200').catch(() => {});
          }
          await page.waitForTimeout(4000).catch(() => {});

          // 2. Trier par la colonne « Fonctions ADEF Résidences » (2 clics, avec
          //    attente entre les deux) pour regrouper les fonctions renseignées
          //    et les faire remonter en tête (le 1er tri met les vides en tête).
          ctx.log('Tri par la colonne « Fonctions ADEF Résidences » (2 clics)');
          let header = list.getByRole('columnheader', { name: /Fonctions ADEF/ }).first();
          if (!(await header.count().catch(() => 0))) {
            header = list.getByText(/Fonctions ADEF/).first();
          }
          await header.click().catch(() => {});
          await page.waitForTimeout(2500).catch(() => {});
          await header.click().catch(() => {});
          await page.waitForTimeout(2500).catch(() => {});
          ctx.log(`Recherche de la cellule « ${data.fonction} » et de son bouton dupliquer`);

          // 3. Repérer la CELLULE (gridcell) contenant la fonction demandée.
          //    Correspondance partielle et insensible à la casse :
          //    « responsable hotelier » trouve « RESPONSABLE HOTELIER (E) ».
          const fonctionRe = new RegExp(
            data.fonction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            'i'
          );
          // Deux stratégies combinées (.or) : par rôle gridcell (comme votre
          // codegen) OU n'importe quelle cellule <td> contenant le texte de la
          // fonction. On attend qu'au moins l'une apparaisse.
          const cell = list
            .getByRole('gridcell', { name: fonctionRe })
            .or(list.locator('td').filter({ hasText: data.fonction }))
            .first();
          try {
            await cell.waitFor({ timeout: 30000 });
          } catch {
            throw new Error(
              `Aucun utilisateur avec la fonction « ${data.fonction} » : pas de modèle à ` +
                `dupliquer. Vérifiez l'orthographe de la fonction, ou créez le premier compte ` +
                `de cette fonction manuellement.`
            );
          }
          // 4. Remonter à la ligne de cette cellule et cliquer SON bouton dupliquer.
          const row = cell.locator('xpath=ancestor::tr[1]');
          await row.locator(S.userList.duplicateButton).first().click();
        },
      },
      {
        id: 'identite',
        critical: true,
        label: `Saisie de l'identité (${fullName})`,
        run: async () => {
          await fancy().locator(S.form.nom).fill(data.nom.toUpperCase());
          await fancy().locator(S.form.prenom).fill(data.prenom);
          // Civilité absente (ex. ajout d'établissement) : on laisse celle de la fiche.
          if (data.civilite && S.form.civiliteIndex[data.civilite] !== undefined) {
            const cell = fancy().getByRole('cell', { name: S.form.civiliteCellPattern }).first();
            await cell.getByRole('radio').nth(S.form.civiliteIndex[data.civilite]).check();
          }
        },
      },
      {
        id: 'identifiants',
        critical: true,
        label: `Création des identifiants de connexion (identifiant « ${login} »)`,
        run: async () => {
          await fancy().getByRole('button', { name: S.form.ongletAuthentification }).click();
          await fancy().locator(S.form.loginField).fill(currentLogin);
          await fancy().locator(S.form.password).fill(process.env.BLUEKANGO_DEFAULT_PASSWORD);
          await fancy().locator(S.form.password2).fill(process.env.BLUEKANGO_DEFAULT_PASSWORD);
          // L'utilisateur devra choisir son propre mot de passe au premier login.
          await fancy().locator(S.form.reinitCheckbox).check();
        },
      },
      {
        id: 'validite',
        critical: false,
        label: 'Saisie de la date de fin de validité',
        run: async () => {
          // Seule la date de FIN de validité est saisie (la date de début de la
          // fiche reste celle proposée par BlueKanGo). Cible : la ligne
          // « Date de fin de validité : (jj/mm/aaaa) », comme au codegen.
          const fin = toFrDate(data.date_fin);
          if (!fin) {
            ctx.log('Aucune date de fin de validité fournie : étape ignorée');
            return;
          }
          const rowRe = new RegExp(S.form.dateFinRowLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          const row = fancy().getByRole('row', { name: rowRe }).first();
          try {
            await row.waitFor({ timeout: 15000 });
          } catch {
            throw new Error(
              'Ligne « Date de fin de validité » introuvable sur la fiche : ' +
                'le compte n’a pas été enregistré (aucune validation effectuée).'
            );
          }
          const input = row.locator('input:not([type="hidden"])').first();
          await input.click();
          await input.fill(fin);
          ctx.log(`Fin de validité saisie : ${fin}`);
          // Referme un éventuel calendrier ouvert par la prise de focus.
          await page.keyboard.press('Escape').catch(() => {});
        },
      },
      {
        id: 'enregistrement',
        critical: true,
        label: 'Enregistrement de la fiche',
        run: async () => {
          const takenRe = new RegExp(S.form.loginTakenText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          // L'avertissement « déjà défini sur un autre établissement » se gère
          // selon la réponse du formulaire (compte_existant) :
          //  - ajout     : MÊME personne → on garde l'identifiant, OK puis
          //                revalidation (rattachement au nouvel établissement) ;
          //  - homonyme  : AUTRE personne → identifiant suivant puis revalidation ;
          //  - premier   : situation inattendue → échec explicite, un humain tranche.
          // Mode : 'ajout' (démarche dédiée, identifiant imposé) ou, en création,
          // 'homonyme' par défaut — l'avertissement « déjà défini » signifie alors
          // qu'un homonyme existe : on prend l'identifiant suivant automatiquement.
          const mode = data.compte_existant || (fixedLogin ? 'ajout' : 'homonyme');
          for (let attempt = 1; attempt <= 6; attempt++) {
            await main().getByRole('button', { name: S.form.validerLabel }).click();
            await page.waitForTimeout(2500).catch(() => {});
            const warnFancy = await fancy().getByText(takenRe).first().isVisible().catch(() => false);
            const warnMain = !warnFancy && (await main().getByText(takenRe).first().isVisible().catch(() => false));
            if (!warnFancy && !warnMain) {
              // Pas d'avertissement : la fiche se ferme, l'enregistrement est accepté.
              await main().locator(S.frames.fancybox).waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
              return;
            }
            const scope = warnFancy ? fancy() : main();

            if (mode === 'ajout') {
              // Même personne : l'avertissement est attendu — on confirme avec
              // le MÊME identifiant pour rattacher ce nouvel établissement.
              ctx.log(`Avertissement attendu (compte existant) : rattachement de l'établissement avec l'identifiant « ${currentLogin} »`);
              await scope.getByRole('button', { name: S.form.warningOkLabel }).first().click().catch(() => {});
              await page.waitForTimeout(1200).catch(() => {});
              continue; // revalide tel quel
            }

            if (mode === 'homonyme') {
              // Autre personne du même nom : identifiant suivant.
              db.recordAccount(config.id, currentLogin, data.nom, data.prenom, 'existant');
              await scope.getByRole('button', { name: S.form.warningOkLabel }).first().click().catch(() => {});
              const next = nextLogin();
              ctx.log(`Identifiant « ${currentLogin} » déjà utilisé (homonyme) — nouvel essai avec « ${next} »`);
              currentLogin = next;
              await fancy().getByRole('button', { name: S.form.ongletAuthentification }).click().catch(() => {});
              await fancy().locator(S.form.loginField).fill(currentLogin);
              await fancy().locator(S.form.password).fill(process.env.BLUEKANGO_DEFAULT_PASSWORD);
              await fancy().locator(S.form.password2).fill(process.env.BLUEKANGO_DEFAULT_PASSWORD);
              continue;
            }

            // mode 'premier' : la personne est censée ne pas avoir de compte,
            // or l'identifiant existe déjà → on n'invente rien, un humain tranche.
            throw new Error(
              `BlueKanGo signale que « ${currentLogin} » est déjà défini sur un autre établissement, ` +
                `alors que la demande indique « premier compte ». Aucune fiche n'a été enregistrée. ` +
                `Selon le cas réel : refaites la demande en choisissant « déjà un compte (ajout d'établissement) » ` +
                `ou « homonyme » — ou passez par « Mot de passe oublié » si la personne a simplement perdu ses accès.`
            );
          }
          throw new Error(
            mode === 'ajout'
              ? 'L\'avertissement persiste après confirmation : le rattachement d\'établissement n\'a pas été accepté par BlueKanGo.'
              : 'Impossible de trouver un identifiant libre après 6 tentatives.'
          );
        },
      },
  ];

  const result = await runScenario({
    reference: ctx.reference,
    log: ctx.log,
    successMessage:
      `Compte BlueKanGo créé pour ${fullName} — identifiant « ${login} », ` +
      `établissement ${etabLabel} (droits hérités de la fonction « ${data.fonction} »)` +
      (data.date_fin ? ` — valide jusqu'au ${toFrDate(data.date_fin)}` : ''),
    steps: composeSteps(config.id, nativeSteps, data, ctx.log),
  });
  if (result.success) {
    // L'identifiant final peut différer de celui prévu (refus BlueKanGo).
    account.login = currentLogin;
    if (currentLogin !== login) {
      result.message = String(result.message || '').replace(`« ${login} »`, `« ${currentLogin} »`);
      ctx.log(`Identifiant définitif : « ${currentLogin} »`);
    }
    if (data.compte_existant === 'ajout') {
      result.message = `Compte BlueKanGo existant « ${currentLogin} » rattaché à l'établissement ${etabLabel} pour ${fullName}` +
        (data.date_fin ? ` — valide jusqu'au ${toFrDate(data.date_fin)}` : '');
    }
    result.account = account;
  }
  return result;
}

/**
 * Réinitialisation du mot de passe d'un compte existant (mot de passe oublié).
 * Calibré sur enregistrement codegen : connexion admin → bascule
 * d'établissement → Utilisateurs → recherche par mots clés (autocomplete)
 * « PRENOM NOM » → fiche → onglet Authentification → nouveau mot de passe
 * provisoire (BLUEKANGO_DEFAULT_PASSWORD) + réinitialisation au 1er login →
 * Valider.
 */
async function resetPassword(data, ctx) {
  const fullName = `${data.prenom} ${data.nom}`.trim();
  const newPassword = process.env.BLUEKANGO_DEFAULT_PASSWORD;

  if (getMode(ENV) === 'demo') {
    ctx.log('Mode démonstration actif (AUTOMATION_MODE=production pour cibler la vraie application)');
    for (const step of ['Connexion au compte administrateur', `Bascule sur l'établissement`, `Recherche du compte « ${fullName} »`, 'Nouveau mot de passe provisoire saisi', 'Fiche validée']) {
      await new Promise((r) => setTimeout(r, 700));
      ctx.log(step);
    }
    return {
      success: true,
      message: `Mot de passe réinitialisé pour ${fullName} (démonstration)`,
      account: { login: require('../../automation/identifiants').generateLogin(data.prenom, data.nom), prenom: data.prenom, nom: data.nom },
    };
  }

  if (!newPassword) {
    return { success: false, message: 'BLUEKANGO_DEFAULT_PASSWORD manquant dans le .env : impossible de définir le mot de passe provisoire.' };
  }

  const base = process.env.BLUEKANGO_URL.replace(/\/$/, '');
  const etabLabel =
    config.formSchema.sections[1].fields[0].options.find((o) => o.value === data.etablissement)
      ?.label || data.etablissement;
  const S = applySelectorPatches(BASE_SELECTORS, config.id);

  let page;
  let login = null;
  const main = () => page.frameLocator(S.frames.main);
  const fancy = () => main().frameLocator(S.frames.fancybox);
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const steps = [
    {
      id: 'ouverture',
      label: 'Ouverture de BlueKanGo',
      run: (p) => { page = p; return page.goto(`${base}/index.php?`); },
    },
    {
      id: 'connexion',
      label: 'Connexion avec le compte administrateur',
      run: async () => {
        await page.getByRole('textbox', { name: S.login.userLabel }).fill(process.env.BLUEKANGO_ADMIN_USER);
        await page.getByRole('textbox', { name: S.login.passwordLabel }).fill(process.env.BLUEKANGO_ADMIN_PASSWORD);
        await page.getByRole('button', { name: S.login.submitLabel }).click();
        await selectProfile(page, ctx.log);
      },
    },
    {
      id: 'menu-utilisateurs',
      label: 'Ouverture de Administration > Gestion des ressources > Utilisateurs',
      run: async () => {
        await page.getByText(S.nav.administration).first().click();
        await main().getByRole('button', { name: S.nav.gestionRessources }).click();
        await main().getByRole('link', { name: S.nav.utilisateurs }).click();
      },
    },
    {
      id: 'etablissement',
      label: `Bascule sur l'établissement « ${etabLabel} »`,
      run: async () => {
        const select = await findEtabSelect(page);
        if (!select) throw new Error(`Sélecteur d'établissement introuvable dans les frames de la page.`);
        const current = await select.inputValue().catch(() => null);
        if (current !== data.etablissement) {
          await select.selectOption(data.etablissement);
          await page.waitForLoadState('networkidle');
          await main().getByRole('button', { name: S.nav.gestionRessources }).click();
          await main().getByRole('link', { name: S.nav.utilisateurs }).click();
        } else {
          ctx.log(`Déjà sur « ${etabLabel} »`);
        }
      },
    },
    {
      id: 'recherche',
      label: `Recherche du compte « ${fullName} »`,
      run: async () => {
        const list = main().frameLocator(S.frames.userList);
        const search = list.getByRole('textbox', { name: S.userList.searchLabel }).first();
        await search.waitFor({ timeout: 20000 });
        await search.fill(fullName);
        await page.waitForTimeout(2000).catch(() => {});
        // Suggestion « PRENOM NOM » de l'autocomplete (insensible casse/accents partiels).
        let option = list.getByRole('option', { name: new RegExp(`${esc(data.prenom)}.*${esc(data.nom)}`, 'i') }).first();
        if (!(await option.count().catch(() => 0))) {
          option = list.getByRole('option', { name: new RegExp(esc(data.nom), 'i') }).first();
        }
        try {
          await option.waitFor({ timeout: 12000 });
        } catch {
          throw new Error(
            `Aucun compte « ${fullName} » trouvé dans « ${etabLabel} ». Vérifiez l'orthographe ` +
              `EXACTE du nom et du prénom, et l'établissement de rattachement.`
          );
        }
        await option.click();
      },
    },
    {
      id: 'nouveau-mdp',
      label: 'Vérification de l’identifiant puis saisie du nouveau mot de passe',
      run: async () => {
        await fancy().getByRole('button', { name: S.form.ongletAuthentification }).click();
        // Sécurité : la fiche trouvée doit porter EXACTEMENT l'identifiant
        // fourni dans la demande — sinon on ne touche à rien.
        login = await fancy().locator(S.form.loginField).inputValue().catch(() => null);
        const expected = (data.identifiant || '').trim().toLowerCase();
        if (expected && String(login || '').trim().toLowerCase() !== expected) {
          throw new Error(
            `La fiche trouvée pour « ${fullName} » porte l'identifiant « ${login || '?'} », ` +
              `différent de celui fourni (« ${data.identifiant} »). Aucune modification effectuée — ` +
              `vérifiez l'identifiant, le nom exact et l'établissement.`
          );
        }
        if (login) ctx.log(`Identifiant vérifié : « ${login} »`);
        await fancy().locator(S.form.password).fill(newPassword);
        await fancy().locator(S.form.password2).fill(newPassword);
        // L'utilisateur devra choisir son propre mot de passe au premier login.
        await fancy().locator(S.form.reinitCheckbox).check().catch(() => {});
      },
    },
    {
      id: 'enregistrement',
      label: 'Enregistrement de la fiche',
      run: async () => {
        await main().getByRole('button', { name: S.form.validerLabel }).click();
        await main().locator(S.frames.fancybox).waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
      },
    },
  ];

  const result = await runScenario({
    reference: ctx.reference,
    log: ctx.log,
    successMessage: `Mot de passe réinitialisé pour ${fullName} — établissement ${etabLabel}`,
    steps,
  });
  if (result.success) {
    result.account = { login: login || '', prenom: data.prenom, nom: data.nom };
  }
  return result;
}

/**
 * Ajout d'un établissement à un compte EXISTANT : même parcours que la
 * création (duplication pour hériter des droits de la fonction sur le nouvel
 * établissement) mais avec l'identifiant existant imposé — l'avertissement
 * « déjà défini sur un autre établissement » est attendu et confirmé.
 */
async function addEstablishment(data, ctx) {
  if (getMode(ENV) === 'demo') {
    ctx.log('Mode démonstration actif (AUTOMATION_MODE=production pour cibler la vraie application)');
    const etabLabel =
      config.formSchema.sections[1].fields[0].options.find((o) => o.value === data.etablissement)
        ?.label || data.etablissement;
    for (const step of ['Connexion au compte administrateur', `Bascule sur « ${etabLabel} »`, `Duplication d'un utilisateur « ${data.fonction} »`, `Avertissement « compte déjà défini » confirmé avec « ${data.identifiant} »`, 'Fiche validée']) {
      await new Promise((r) => setTimeout(r, 700));
      ctx.log(step);
    }
    return {
      success: true,
      message: `Compte existant « ${data.identifiant} » rattaché à l'établissement ${etabLabel} (démonstration)`,
      account: { login: String(data.identifiant || '').toLowerCase(), prenom: data.prenom, nom: data.nom },
    };
  }
  return createAccount({ ...data, compte_existant: 'ajout' }, ctx);
}

module.exports = { createAccount, resetPassword, addEstablishment, STEPS_META };
