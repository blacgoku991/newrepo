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
  { id: 'validite', label: 'Saisie de la date de fin de validité', critical: false, selectorKeys: ['form.dateFinRowLabel'] },
  { id: 'enregistrement', label: 'Enregistrement de la fiche (Valider)', critical: true, selectorKeys: [] },
];

/** yyyy-mm-dd (formulaire) → jj/mm/aaaa (saisie BlueKanGo). */
function toFrDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/**
 * Mot de passe provisoire (réinitialisation). Simple et lisible, dans le même
 * esprit que le mot de passe par défaut (« Adefresidences2026 ») : un mot avec
 * une majuscule + des chiffres qui CHANGENT à chaque fois — car BlueKanGo
 * refuse de remettre un mot de passe déjà utilisé récemment.
 */
function randomProvisionalPassword() {
  const crypto = require('node:crypto');
  return `Adefresidences${crypto.randomInt(1000, 9999)}`;
}

/**
 * Motif du lien de choix de profil affiché après connexion. Le lien a la forme
 * « Prénom Nom ÉTABLISSEMENT » (ex. « Achraf Maatoug COMBS LA VILLE ») : on le
 * repère par le NOM DE L'ÉTABLISSEMENT (dérivé de la liste du config, partie
 * avant « - »). Ainsi on clique le bon profil et jamais un autre lien de la
 * page (bannières, etc.). L'établissement du compte admin varie sans impact.
 */
function profileLinkPattern() {
  const noms = config.formSchema.sections[1].fields
    .find((f) => f.name === 'etablissement').options
    .map((o) => o.label.split(' - ')[0].trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(${noms.join('|')})`, 'i');
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

/**
 * Attend que la grille d'utilisateurs se STABILISE (nombre de lignes constant),
 * plutôt qu'une temporisation fixe. Rend la main dès que c'est prêt — donc plus
 * vite quand la grille charge rapidement — sans jamais dépasser `max`. Si le
 * nombre de lignes ne peut pas être lu (frame en navigation), on retombe sur
 * l'attente maximale : jamais plus court que l'ancien comportement.
 */
async function waitGridSettle(list, page, { max = 6000, min = 900, quiet = 700 } = {}) {
  const start = Date.now();
  let last = -1;
  let stableSince = start;
  while (Date.now() - start < max) {
    let n = -1;
    try { n = await list.locator('tr').count(); } catch { /* frame en cours de navigation */ }
    if (n !== last) { last = n; stableSince = Date.now(); }
    if (Date.now() - start >= min && n > 1 && Date.now() - stableSince >= quiet) return;
    await page.waitForTimeout(180).catch(() => {});
  }
}

/**
 * Attend que le NOMBRE de lignes de la grille change (rechargement effectif),
 * puis qu'il se stabilise brièvement. Rend la main dès que c'est fait — donc
 * bien plus vite qu'une temporisation fixe — et au plus tard au bout de `max`.
 * Sert après un changement de pagination : c'est l'effet qu'on attend, pas
 * un délai arbitraire.
 */
async function waitRowsChange(list, page, avant, max = 8000) {
  const start = Date.now();
  let last = -1;
  let stableSince = start;
  while (Date.now() - start < max) {
    let n = -1;
    try { n = await list.locator('tr').count(); } catch { /* frame en navigation */ }
    if (n !== last) { last = n; stableSince = Date.now(); }
    // Grille rechargée : on la laisse se poser un instant et on repart.
    if (n > 0 && n !== avant) {
      await page.waitForTimeout(400).catch(() => {});
      return true;
    }
    // Rien ne bouge depuis 1,5 s : il n'y avait probablement rien à charger
    // (établissement de moins de 20 comptes). Inutile d'attendre davantage.
    if (Date.now() - stableSince >= 1500) return false;
    await page.waitForTimeout(200).catch(() => {});
  }
  return false;
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
          const profile = page.getByRole('link', { name: profileLinkPattern() }).first();
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
          //    Le sélecteur de pagination est la liste déroulante « 20 » du pied
          //    de tableau (role listbox), dans la frame de la liste.
          ctx.log('Affichage de 200 résultats par page');
          const lignesAvant = await list.locator('tr').count().catch(() => 0);
          const perPage = list.getByRole('listbox').first();
          try {
            await perPage.waitFor({ timeout: 15000 });
            await perPage.selectOption('200');
          } catch (err) {
            // Repli : la dernière liste déroulante du pied de tableau.
            ctx.log(`Sélecteur de pagination inhabituel (${err.message.split('\n')[0]}) — repli sur la dernière liste déroulante`);
            await list.locator('select').last().selectOption('200');
          }
          // Vérification : la sélection a-t-elle réellement pris ? Un échec
          // silencieux laissait 20 lignes affichées, donc une fonction
          // « introuvable » alors qu'elle est page 3.
          const parPage = await perPage.inputValue().catch(() => null);
          if (parPage !== '200') {
            ctx.log(`⚠ Pagination restée sur « ${parPage || '?'} » : la fonction cherchée peut être sur une autre page`);
          }
          // Attente de l'EFFET (les lignes arrivent), pas d'une durée fixe : on
          // repart dès que la grille a changé. Si l'établissement compte moins
          // de 20 utilisateurs, rien ne change et on n'attend pas pour rien.
          await waitRowsChange(list, page, lignesAvant, 8000);

          // 2. Trier par la colonne « Fonctions ADEF Résidences » (2 clics, avec
          //    attente entre les deux) pour regrouper les fonctions renseignées
          //    et les faire remonter en tête (le 1er tri met les vides en tête).
          ctx.log('Tri par la colonne « Fonctions ADEF Résidences » (2 clics)');
          let header = list.getByRole('columnheader', { name: /Fonctions ADEF/ }).first();
          if (!(await header.count().catch(() => 0))) {
            header = list.getByText(/Fonctions ADEF/).first();
          }
          // Le tri est un aller-retour serveur : la grille se recharge entre les
          // deux clics. Sans attente réelle, le second clic part sur l'ancienne
          // grille et le tri finit à l'envers — les fonctions vides restent en
          // tête et la fonction cherchée n'est sur aucune des 200 lignes
          // affichées. On attend donc au moins 2 s après chaque clic, davantage
          // si la grille bouge encore.
          const trier = async () => {
            // Attente légitime : on ré-arme le chien de garde du worker pour ne
            // pas être tué à tort pendant ces rechargements de grille.
            if (ctx.keepAlive) ctx.keepAlive();
            await header.click().catch(() => {});
            await waitGridSettle(list, page, { max: 8000, min: 2000, quiet: 800 });
          };
          await trier();
          await trier();
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
          // Si la fonction n'apparaît pas, c'est le plus souvent que le tri n'a
          // pas pris (clic avalé pendant un rechargement) : on re-trie et on
          // regarde à nouveau, plutôt que d'échouer sur un faux « fonction
          // inexistante ». Trois états de tri au maximum.
          let vue = await cell.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
          for (let essai = 2; !vue && essai <= 3; essai++) {
            ctx.log(`Fonction pas encore visible — nouveau tri (essai ${essai}/3)`);
            await trier();
            vue = await cell.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
          }
          if (!vue) {
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
    onProgress: ctx.progress,
    successMessage:
      `Compte BlueKanGo créé pour ${fullName} — identifiant « ${login} », ` +
      `établissement ${etabLabel} (droits hérités de la fonction « ${data.fonction} »)` +
      (data.date_fin ? ` — valide jusqu'au ${toFrDate(data.date_fin)}` : ''),
    steps: composeSteps(config.id, nativeSteps, data, ctx.log),
  });
  if (result.success) result.account = account;
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
/**
 * Étapes menant à la fiche d'un utilisateur EXISTANT : connexion, menu
 * Utilisateurs, bascule sur son établissement, recherche par identifiant exact,
 * ouverture de la fiche via « Modifier ».
 *
 * Partagé par la réinitialisation de mot de passe et la correction d'identité.
 * `holder` porte la page : les étapes suivantes en ont besoin, et elle n'existe
 * qu'au moment où le scénario démarre.
 */
function buildOuvrirFicheSteps({ S, ctx, data, identifiant, etabLabel, base, holder }) {
  const main = () => holder.page.frameLocator(S.frames.main);
  return [
    {
      id: 'ouverture',
      label: 'Ouverture de BlueKanGo',
      run: (p) => { holder.page = p; return holder.page.goto(`${base}/index.php?`); },
    },
    {
      id: 'connexion',
      label: 'Connexion avec le compte administrateur',
      run: async () => {
        await holder.page.getByRole('textbox', { name: S.login.userLabel }).fill(process.env.BLUEKANGO_ADMIN_USER);
        await holder.page.getByRole('textbox', { name: S.login.passwordLabel }).fill(process.env.BLUEKANGO_ADMIN_PASSWORD);
        await holder.page.getByRole('button', { name: S.login.submitLabel }).click();
        const profile = holder.page.getByRole('link', { name: profileLinkPattern() }).first();
        await profile.click({ timeout: 8000 }).catch(() => {});
        await holder.page.getByText(S.nav.administration).first().waitFor();
      },
    },
    {
      id: 'menu-utilisateurs',
      label: 'Ouverture de Administration > Gestion des ressources > Utilisateurs',
      run: async () => {
        await holder.page.getByText(S.nav.administration).first().click();
        await main().getByRole('button', { name: S.nav.gestionRessources }).click();
        await main().getByRole('link', { name: S.nav.utilisateurs }).click();
      },
    },
    {
      id: 'etablissement',
      label: `Bascule sur l'établissement « ${etabLabel} »`,
      run: async () => {
        // `holder.page` : la page n'existe qu'au lancement du navigateur, ces
        // étapes étant construites avant (voir le porteur passé en paramètre).
        const select = await findEtabSelect(holder.page);
        if (!select) throw new Error(`Sélecteur d'établissement introuvable dans les frames de la page.`);
        const current = await select.inputValue().catch(() => null);
        if (current !== data.etablissement) {
          ctx.log(`Bascule d'établissement vers « ${etabLabel} »…`);
          await select.selectOption(data.etablissement);
          await holder.page.waitForLoadState('networkidle');
          await main().getByRole('button', { name: S.nav.gestionRessources }).click();
          await main().getByRole('link', { name: S.nav.utilisateurs }).click();
        } else {
          ctx.log(`Déjà sur « ${etabLabel} »`);
        }
      },
    },
    {
      id: 'recherche',
      label: `Recherche du compte « ${identifiant} »`,
      run: async () => {
        const list = main().frameLocator(S.frames.userList);
        // 1. Saisir l'identifiant dans le champ « mots » et lancer la recherche.
        const search = list.getByRole('textbox', { name: S.userList.searchLabel }).first();
        await search.waitFor({ timeout: 20000 });
        await search.fill(identifiant);
        await list.getByTitle(S.userList.searchTriggerTitle).first().click().catch(() => {});
        await holder.page.waitForTimeout(2500).catch(() => {});
        // 2. Vérifier que le compte existe : cellule contenant l'identifiant exact.
        const cell = list.getByRole('gridcell', { name: new RegExp(`^\\s*${identifiant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') }).first();
        try {
          await cell.waitFor({ timeout: 15000 });
        } catch {
          throw new Error(
            `Aucun compte « ${identifiant} » trouvé dans « ${etabLabel} ». Vérifiez l'identifiant ` +
              `EXACT et l'établissement de rattachement — aucune modification effectuée.`
          );
        }
        await cell.click();
        // 3. Ouvrir la fiche via le bouton « Modifier ».
        await list.getByRole('button', { name: S.userList.modifyButton }).first().click();
      },
    }
  ];
}

async function resetPassword(data, ctx) {
  // Identifiant EXACT du compte à réinitialiser (saisi dans le formulaire).
  const identifiant = String(data.identifiant || '').trim();
  // Mot de passe provisoire ALÉATOIRE : BlueKanGo refuse de remettre un mot de
  // passe déjà utilisé (message « choisissez-en un nouveau »).
  const newPassword = randomProvisionalPassword();

  if (getMode(ENV) === 'demo') {
    ctx.log('Mode démonstration actif (AUTOMATION_MODE=production pour cibler la vraie application)');
    for (const step of ['Connexion au compte administrateur', `Bascule sur l'établissement`, `Recherche du compte « ${identifiant} »`, 'Compte trouvé — bouton Modifier', 'Nouveau mot de passe provisoire aléatoire saisi', 'Fiche validée']) {
      await new Promise((r) => setTimeout(r, 700));
      ctx.log(step);
    }
    return {
      success: true,
      message: `Mot de passe réinitialisé pour « ${identifiant} » (démonstration)`,
      account: { login: identifiant, password: newPassword, prenom: '', nom: '' },
    };
  }

  const base = process.env.BLUEKANGO_URL.replace(/\/$/, '');
  const etabLabel =
    config.formSchema.sections[1].fields[0].options.find((o) => o.value === data.etablissement)
      ?.label || data.etablissement;
  const S = applySelectorPatches(BASE_SELECTORS, config.id);

  // Porteur de la page : les étapes partagées la renseignent au démarrage.
  const holder = { page: null };
  const main = () => holder.page.frameLocator(S.frames.main);
  const fancy = () => main().frameLocator(S.frames.fancybox);

  const steps = [
    ...buildOuvrirFicheSteps({ S, ctx, data, identifiant, etabLabel, base, holder }),
    {
      id: 'nouveau-mdp',
      label: 'Vérification de l’identifiant puis saisie du nouveau mot de passe',
      run: async () => {
        await fancy().getByRole('button', { name: S.form.ongletAuthentification }).click();
        // Sécurité : la fiche ouverte doit bien porter l'identifiant demandé.
        const onFiche = await fancy().locator(S.form.loginField).inputValue().catch(() => null);
        if (onFiche && onFiche.trim().toLowerCase() !== identifiant.toLowerCase()) {
          throw new Error(
            `La fiche ouverte porte l'identifiant « ${onFiche} », différent de « ${identifiant} ». ` +
              `Aucune modification effectuée.`
          );
        }
        ctx.log(`Identifiant confirmé : « ${identifiant} »`);
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
        // BlueKanGo affiche une fenêtre « Information » (bouton OK) après la
        // modification : on la confirme si elle apparaît.
        await holder.page.waitForTimeout(1500).catch(() => {});
        for (const scope of [fancy(), main(), holder.page]) {
          const ok = scope.getByRole('button', { name: /^OK$/i }).first();
          if (await ok.isVisible().catch(() => false)) { await ok.click().catch(() => {}); break; }
        }
        await main().locator(S.frames.fancybox).waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
      },
    },
  ];

  const result = await runScenario({
    reference: ctx.reference,
    log: ctx.log,
    onProgress: ctx.progress,
    successMessage: `Mot de passe réinitialisé pour « ${identifiant} » — établissement ${etabLabel} (à changer à la première connexion)`,
    steps,
  });
  if (result.success) {
    result.account = { login: identifiant, password: newPassword, prenom: '', nom: '' };
  }
  return result;
}


/**
 * Correction de l'identité d'un compte existant : nom et prénom sur l'onglet
 * « Identité », puis identifiant de connexion sur l'onglet « Authentification ».
 *
 * L'identifiant suit le nom (1re lettre du prénom + nom) : le titulaire doit
 * donc être averti de son nouvel identifiant — il figure dans le message de la
 * demande. Le mot de passe, lui, n'est pas touché.
 */
async function updateIdentity(data, ctx) {
  const identifiant = String(data.identifiant || '').trim();
  const nouvelleIdentite = `${data.prenom || ''} ${data.nom || ''}`.trim();
  // Nouvel identifiant, unique : l'identifiant ACTUEL ne compte pas comme une
  // collision (sinon corriger un accent ferait passer « mzengis » à « mozengis »).
  const nouveauLogin = pickUniqueLogin(
    data.prenom,
    data.nom,
    (l) => l.toLowerCase() !== identifiant.toLowerCase() && db.loginExists(config.id, l)
  );
  const etabLabel =
    config.formSchema.sections[1].fields.find((f) => f.name === 'etablissement')
      ?.options.find((o) => o.value === data.etablissement)?.label || data.etablissement;
  const changeLogin = nouveauLogin !== identifiant;
  const suiteMessage = changeLogin
    ? ` — nouvel identifiant de connexion « ${nouveauLogin} » (à communiquer au titulaire)`
    : '';

  if (getMode(ENV) === 'demo') {
    ctx.log('Mode démonstration actif (AUTOMATION_MODE=production pour cibler la vraie application)');
    const etapes = [
      'Connexion au compte administrateur',
      "Bascule sur l'établissement",
      `Recherche du compte « ${identifiant} »`,
      `Correction de l'identité (${nouvelleIdentite})`,
      changeLogin ? `Identifiant de connexion → « ${nouveauLogin} »` : 'Identifiant de connexion inchangé',
      'Fiche validée',
    ];
    etapes.forEach((label, i) => {
      ctx.log(`Étape ${i + 1}/${etapes.length} — ${label}`);
      if (ctx.progress) ctx.progress(i + 1, etapes.length, label);
    });
    return {
      success: true,
      message: `Identité corrigée pour « ${identifiant} » → ${nouvelleIdentite}${suiteMessage} (environnement de démonstration)`,
      artifacts: [],
      account: changeLogin
        ? { login: nouveauLogin, previousLogin: identifiant, nom: data.nom, prenom: data.prenom, credentials: false }
        : undefined,
    };
  }

  const base = process.env.BLUEKANGO_URL.replace(/\/$/, '');
  const S = applySelectorPatches(BASE_SELECTORS, config.id);
  const holder = { page: null };
  const main = () => holder.page.frameLocator(S.frames.main);
  const fancy = () => main().frameLocator(S.frames.fancybox);

  const steps = [
    ...buildOuvrirFicheSteps({ S, ctx, data, identifiant, etabLabel, base, holder }),
    {
      id: 'identite',
      label: `Vérification de l'identifiant puis correction de l'identité`,
      run: async () => {
        // Garde-fou identique à la réinitialisation : la fiche ouverte doit bien
        // porter l'identifiant demandé, sinon on modifierait le compte d'un tiers.
        await fancy().getByRole('button', { name: S.form.ongletAuthentification }).click().catch(() => {});
        const onFiche = await fancy().locator(S.form.loginField).inputValue().catch(() => null);
        if (onFiche && onFiche.trim().toLowerCase() !== identifiant.toLowerCase()) {
          throw new Error(
            `La fiche ouverte porte l'identifiant « ${onFiche} », différent de « ${identifiant} ». ` +
              `Aucune modification effectuée.`
          );
        }
        ctx.log(`Identifiant confirmé : « ${identifiant} »`);

        // Le nom et le prénom sont sur l'onglet « Identité » : sans y revenir,
        // les champs de l'onglet Authentification masquent les leurs.
        await fancy().getByRole('button', { name: S.form.ongletIdentite }).click();
        const nom = fancy().locator(S.form.nom);
        await nom.click();
        await nom.fill(data.nom.toUpperCase());
        const prenom = fancy().locator(S.form.prenom);
        await prenom.click();
        await prenom.fill(data.prenom);
        ctx.log(`Nom et prénom corrigés : ${nouvelleIdentite}.`);

        // L'identifiant de connexion suit le nouveau nom (1re lettre du prénom
        // + nom), sur l'onglet Authentification. Il reste unique : en cas de
        // collision, on ajoute des lettres du prénom (voir identifiants.js).
        if (nouveauLogin === identifiant) {
          ctx.log(`Identifiant inchangé : « ${identifiant} » correspond déjà à la nouvelle identité.`);
          return;
        }
        await fancy().getByRole('button', { name: S.form.ongletAuthentification }).click();
        const champLogin = fancy().locator(S.form.loginField);
        await champLogin.click();
        await champLogin.fill(nouveauLogin);
        ctx.log(`Identifiant de connexion mis à jour : « ${identifiant} » → « ${nouveauLogin} ».`);
      },
    },
    {
      id: 'enregistrement',
      label: 'Enregistrement de la fiche',
      run: async () => {
        await main().getByRole('button', { name: S.form.validerLabel }).click();
        // BlueKanGo confirme par une fenêtre « Information » (bouton OK).
        await holder.page.waitForTimeout(1500).catch(() => {});
        for (const scope of [fancy(), main(), holder.page]) {
          const ok = scope.getByRole('button', { name: /^OK$/i }).first();
          if (await ok.isVisible().catch(() => false)) { await ok.click().catch(() => {}); break; }
        }
        await main().locator(S.frames.fancybox).waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
      },
    },
  ];

  const result = await runScenario({
    reference: ctx.reference,
    log: ctx.log,
    onProgress: ctx.progress,
    successMessage: `Identité corrigée pour « ${identifiant} » → ${nouvelleIdentite}${suiteMessage} (établissement ${etabLabel})`,
    steps,
  });
  // `credentials: false` : le mot de passe n'a pas changé, aucun lien
  // d'identifiants à générer — seul l'identifiant est à retenir (et à
  // communiquer au titulaire).
  if (result.success && changeLogin) {
    result.account = {
      login: nouveauLogin,
      previousLogin: identifiant,
      nom: data.nom,
      prenom: data.prenom,
      credentials: false,
    };
  }
  return result;
}

module.exports = { createAccount, resetPassword, updateIdentity, STEPS_META };
