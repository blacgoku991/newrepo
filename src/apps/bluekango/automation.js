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
const { pickUniqueLogin } = require('../../automation/identifiants');
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
  { id: 'validite', label: 'Saisie des dates de validité du compte', critical: false, selectorKeys: ['form.dateCellHint'] },
  { id: 'enregistrement', label: 'Enregistrement de la fiche (Valider)', critical: true, selectorKeys: [] },
];

/** yyyy-mm-dd (formulaire) → jj/mm/aaaa (saisie BlueKanGo). */
function toFrDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
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
  // Identifiant unique : 1re lettre du prénom + nom, en ajoutant des lettres du
  // prénom si l'identifiant est déjà pris (voir identifiants.js).
  const login = pickUniqueLogin(data.prenom, data.nom, (l) => db.loginExists(config.id, l));
  ctx.log(`Identifiant retenu : « ${login} »`);
  const account = { login, prenom: data.prenom, nom: data.nom };

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
          // Page de choix de profil éventuelle ("Prénom Nom SIEGE").
          const profile = page.getByRole('link', { name: S.login.profileLinkPattern }).first();
          await profile.click({ timeout: 8000 }).catch(() => {});
          await page.getByText(S.nav.administration).first().waitFor();
        },
      },
      {
        id: 'menu-utilisateurs',
        critical: true,
        label: 'Ouverture de Administration > Gestion des ressources > Utilisateurs',
        run: async () => {
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
          const cell = fancy().getByRole('cell', { name: S.form.civiliteCellPattern }).first();
          await cell.getByRole('radio').nth(S.form.civiliteIndex[data.civilite]).check();
        },
      },
      {
        id: 'identifiants',
        critical: true,
        label: `Création des identifiants de connexion (identifiant « ${login} »)`,
        run: async () => {
          await fancy().getByRole('button', { name: S.form.ongletAuthentification }).click();
          await fancy().locator(S.form.loginField).fill(login);
          await fancy().locator(S.form.password).fill(process.env.BLUEKANGO_DEFAULT_PASSWORD);
          await fancy().locator(S.form.password2).fill(process.env.BLUEKANGO_DEFAULT_PASSWORD);
          // L'utilisateur devra choisir son propre mot de passe au premier login.
          await fancy().locator(S.form.reinitCheckbox).check();
        },
      },
      {
        id: 'validite',
        critical: false,
        label: 'Saisie des dates de validité du compte',
        run: async () => {
          const debut = toFrDate(data.date_debut);
          const fin = toFrDate(data.date_fin);
          if (!debut && !fin) {
            ctx.log('Aucune date de validité fournie : étape ignorée');
            return;
          }
          // Les cellules « date » de la fiche affichent l'indication (jj/mm/aaaa)
          // à côté d'un champ sans libellé : on les repère par ce texte.
          const hintRe = new RegExp(S.form.dateCellHint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
          const cells = fancy().getByRole('cell', { name: hintRe });
          try {
            await cells.first().waitFor({ timeout: 15000 });
          } catch {
            if (fin) {
              throw new Error(
                'Champ « date de fin de validité » introuvable sur la fiche : ' +
                  'le compte n’a pas été enregistré (aucune validation effectuée).'
              );
            }
            return;
          }
          const count = await cells.count();
          const inputFor = (i) => cells.nth(i).locator('input:not([type="hidden"])').first();
          if (count >= 2) {
            // Deux champs date : le premier = début de validité, le dernier = fin.
            if (debut) {
              await inputFor(0).fill(debut);
              ctx.log(`Début de validité saisi : ${debut}`);
            }
            if (fin) {
              await inputFor(count - 1).fill(fin);
              ctx.log(`Fin de validité saisie : ${fin}`);
            }
          } else if (fin) {
            // Un seul champ date : c'est la fin de validité (cas de l'enregistrement codegen).
            await inputFor(0).fill(fin);
            ctx.log(`Fin de validité saisie : ${fin}`);
          }
          // Referme un éventuel calendrier ouvert par la prise de focus.
          await page.keyboard.press('Escape').catch(() => {});
        },
      },
      {
        id: 'enregistrement',
        critical: true,
        label: 'Enregistrement de la fiche',
        run: async () => {
          await main().getByRole('button', { name: S.form.validerLabel }).click();
          // La fenêtre de la fiche se ferme quand l'enregistrement est accepté.
          await main()
            .locator(S.frames.fancybox)
            .waitFor({ state: 'detached', timeout: 20000 })
            .catch(() => {});
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
  if (result.success) result.account = account;
  return result;
}

module.exports = { createAccount, STEPS_META };
