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

const { getMode } = require('../../automation/helpers');
const { runScenario } = require('../../automation/engine');
const demo = require('../../automation/demoDriver');
const config = require('./config');
const S = require('./selectors');

const ENV = [
  'BLUEKANGO_URL',
  'BLUEKANGO_ADMIN_USER',
  'BLUEKANGO_ADMIN_PASSWORD',
  'BLUEKANGO_DEFAULT_PASSWORD',
];

/** "Marie" + "DUPONT-DURAND" → "mdupontdurand" (sans accents ni caractères spéciaux). */
function generateLogin(prenom, nom) {
  const clean = (s) =>
    String(s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
  return (clean(prenom).charAt(0) || '') + clean(nom);
}

/**
 * Le menu déroulant d'établissement (barre « Etablissements : » en haut à
 * droite) peut se trouver dans n'importe quelle frame de l'interface : on le
 * cherche dans toutes les frames, avec quelques essais le temps du chargement.
 */
async function findEtabSelect(page, selector, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (page.isClosed()) return null;
    for (const frame of page.frames()) {
      try {
        const loc = frame.locator(selector).first();
        if ((await loc.count()) > 0) return loc;
      } catch {
        /* frame en cours de navigation : on ignore */
      }
    }
    try {
      await page.waitForTimeout(400);
    } catch {
      return null; // page fermée pendant l'attente
    }
  }
  return null;
}

async function createAccount(data, ctx) {
  if (getMode(ENV) === 'demo') {
    ctx.log('Mode démonstration actif (AUTOMATION_MODE=production pour cibler la vraie application)');
    return demo.createAccount(config, data, ctx);
  }

  const base = process.env.BLUEKANGO_URL.replace(/\/$/, '');
  const fullName = `${data.prenom} ${data.nom}`;
  const login = generateLogin(data.prenom, data.nom);
  const etabLabel =
    config.formSchema.sections[1].fields[0].options.find((o) => o.value === data.etablissement)
      ?.label || data.etablissement;

  // Cadres BlueKanGo (résolus à la demande car les iframes se rechargent).
  let page;
  const main = () => page.frameLocator(S.frames.main);
  const fancy = () => main().frameLocator(S.frames.fancybox);

  return runScenario({
    reference: ctx.reference,
    log: ctx.log,
    successMessage:
      `Compte BlueKanGo créé pour ${fullName} — identifiant « ${login} », ` +
      `établissement ${etabLabel} (droits hérités de la fonction « ${data.fonction} »)`,
    steps: [
      {
        label: 'Ouverture de BlueKanGo',
        run: (p) => {
          page = p;
          return page.goto(`${base}/index.php?`);
        },
      },
      {
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
        label: `Sélection de l'établissement « ${etabLabel} »`,
        run: async () => {
          // Cas 1 — ancienne interface : menu déroulant <select> d'établissement.
          const select = await findEtabSelect(page, S.nav.etabSelect);
          if (select) {
            const current = await select.inputValue().catch(() => null);
            if (current === data.etablissement) {
              ctx.log(`Déjà positionné sur « ${etabLabel} » : aucun changement nécessaire`);
              return;
            }
            await select.selectOption(data.etablissement);
            await page.waitForLoadState('networkidle');
            await page.getByText(S.nav.administration).first().waitFor({ timeout: 15000 }).catch(() => {});
            return;
          }

          // Cas 2 — pas de <select> (nouvelle interface). On ne change pas
          // d'établissement à l'aveugle : on vérifie qu'on est DÉJÀ sur le bon
          // (son nom est affiché quelque part), sinon on échoue plutôt que de
          // risquer de créer le compte au mauvais endroit.
          const etabName = etabLabel.split(' - ')[0].trim(); // ex. "SIEGE", "GAUCHY"
          const shown = await page
            .getByText(etabName, { exact: false })
            .count()
            .catch(() => 0);
          if (shown > 0) {
            ctx.log(
              `Établissement « ${etabLabel} » déjà actif (menu de changement non requis) : on continue`
            );
            return;
          }
          throw new Error(
            `Impossible de confirmer l'établissement « ${etabLabel} ». Le changement d'établissement ` +
              `de la nouvelle interface n'est pas encore automatisé : fournir un enregistrement codegen ` +
              `du changement d'établissement sur cette interface.`
          );
        },
      },
      {
        label: 'Ouverture de Administration > Gestion des ressources > Utilisateurs',
        run: async () => {
          await page.getByText(S.nav.administration).first().click();
          await main().getByRole('button', { name: S.nav.gestionRessources }).click();
          await main().getByRole('link', { name: S.nav.utilisateurs }).click();
        },
      },
      {
        label: `Duplication d'un utilisateur ayant la fonction « ${data.fonction} »`,
        run: async () => {
          const list = main().frameLocator(S.frames.userList);
          // Lignes ayant la fonction demandée (correspondance insensible à la casse
          // et partielle : « responsable hotelier » trouve « RESPONSABLE HOTELIER (E) »).
          const byFunction = list.locator(S.userList.row).filter({ hasText: data.fonction });
          try {
            await byFunction.first().waitFor({ timeout: 20000 });
          } catch {
            throw new Error(
              `Aucun utilisateur avec la fonction « ${data.fonction} » : pas de modèle à ` +
                `dupliquer. Vérifiez l'orthographe de la fonction, ou créez le premier compte ` +
                `de cette fonction manuellement.`
            );
          }
          // Parmi elles, on privilégie celle du bon établissement.
          const byBoth = byFunction.filter({ hasText: etabLabel });
          const row = (await byBoth.count()) > 0 ? byBoth.first() : byFunction.first();
          await row.locator(S.userList.duplicateButton).first().click();
        },
      },
      {
        label: `Saisie de l'identité (${fullName})`,
        run: async () => {
          await fancy().locator(S.form.nom).fill(data.nom.toUpperCase());
          await fancy().locator(S.form.prenom).fill(data.prenom);
          const cell = fancy().getByRole('cell', { name: S.form.civiliteCellPattern }).first();
          await cell.getByRole('radio').nth(S.form.civiliteIndex[data.civilite]).check();
        },
      },
      {
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
    ],
  });
}

module.exports = { createAccount };
