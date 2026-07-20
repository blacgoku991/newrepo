'use strict';

/**
 * Pilote du mode démonstration.
 *
 * Le portail embarque une console d'administration factice (/demo/<app>) qui
 * imite une application métier : page de connexion, menu, formulaire « Nouvel
 * utilisateur ». Ce pilote fait faire au robot EXACTEMENT le même travail
 * qu'en production — ouvrir un vrai navigateur, se connecter avec le compte
 * administrateur, remplir chaque champ, enregistrer, vérifier — mais contre
 * cette cible locale. C'est la preuve de bout en bout du fonctionnement.
 *
 * Identifiants de la console de démonstration : admin / demo123
 */

const { runScenario } = require('./engine');
const { portalBaseUrl } = require('./helpers');

const DEMO_USER = 'admin';
const DEMO_PASSWORD = 'demo123';

function allFields(config) {
  return config.formSchema.sections.flatMap((s) => s.fields);
}

async function fillField(page, field, value) {
  const selector = `[name="${field.name}"]`;
  switch (field.type) {
    case 'select':
      if (value) await page.selectOption(selector, value);
      break;
    case 'radio':
      if (value) await page.check(`input[name="${field.name}"][value="${value}"]`);
      break;
    case 'checkboxes':
      for (const v of value || []) {
        await page.check(`input[name="${field.name}"][value="${v}"]`);
      }
      break;
    default:
      if (value) await page.fill(selector, String(value));
  }
}

async function createAccount(config, data, { reference, log }) {
  const base = portalBaseUrl();
  const fullName = `${data.prenom || ''} ${data.nom || ''}`.trim();
  let accountId = null;

  const steps = [
    {
      label: `Ouverture de la console d'administration ${config.name}`,
      run: (page) => page.goto(`${base}/demo/${config.id}/login`),
    },
    {
      label: 'Connexion avec le compte administrateur',
      run: async (page) => {
        await page.fill('input[name="login"]', DEMO_USER);
        await page.fill('input[name="password"]', DEMO_PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForSelector('[data-page="users-new"]');
      },
    },
    ...config.formSchema.sections.map((section) => ({
      label: `Saisie — ${section.title}`,
      run: async (page) => {
        for (const field of section.fields) {
          await fillField(page, field, data[field.name]);
        }
      },
    })),
    {
      label: 'Enregistrement de la fiche utilisateur',
      run: async (page) => {
        await page.click('button#demo-save');
        await page.waitForSelector('.demo-success');
      },
    },
    {
      label: 'Vérification de la création du compte',
      run: async (page) => {
        const banner = await page.textContent('.demo-success');
        if (!banner || !banner.includes('créé')) {
          throw new Error("La confirmation de création n'est pas apparue");
        }
        accountId = (await page.textContent('#demo-account-id'))?.trim() || null;
      },
    },
  ];

  const result = await runScenario({
    reference,
    log,
    steps,
    successMessage: '',
  });

  if (result.success) {
    result.message =
      `Compte ${config.name} créé pour ${fullName}` +
      (accountId ? ` — fiche n°${accountId}` : '') +
      ' (environnement de démonstration)';
  }
  return result;
}

module.exports = { createAccount, DEMO_USER, DEMO_PASSWORD };
