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

async function createAccount(config, data, { reference, log, progress, awaitOtp }) {
  const base = portalBaseUrl();
  const fullName = `${data.prenom || ''} ${data.nom || ''}`.trim();
  let accountId = null;

  // Démonstration de la double authentification (OTP) : avec DEMO_OTP=1, le robot
  // se met en pause après la connexion et attend un code — exactement comme la
  // connexion NetSoins. Vous saisissez le code dans les détails de la demande
  // (admin) et le robot reprend. Sert à tester le mécanisme sans cible réelle.
  const otpStep = (process.env.DEMO_OTP === '1' && typeof awaitOtp === 'function')
    ? [{
        label: 'Double authentification — attente du code (OTP)',
        run: async () => {
          const code = await awaitOtp({
            since: new Date(),
            label: 'Démonstration : saisissez n\'importe quel code de 4 à 8 caractères (ex. 1u8fq).',
          });
          log(`Code OTP reçu (${code}) — reprise de la création.`);
        },
      }]
    : [];

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
    ...otpStep,
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
    onProgress: progress,
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
