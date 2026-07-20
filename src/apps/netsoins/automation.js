'use strict';

/**
 * Scénario de création de compte NetSoins (Teranga Software).
 *
 * Mode réel : renseigner dans .env
 *   NETSOINS_URL, NETSOINS_ADMIN_USER, NETSOINS_ADMIN_PASSWORD
 * puis SIMULATION_MODE=false. Ajuster les sélecteurs sur votre instance.
 */

const { isSimulation, simulateSteps, launchBrowser } = require('../../automation/helpers');

const ENV = ['NETSOINS_URL', 'NETSOINS_ADMIN_USER', 'NETSOINS_ADMIN_PASSWORD'];

async function createAccount(data, { log }) {
  const fullName = `${data.prenom} ${data.nom}`;

  if (isSimulation(ENV)) {
    log('MODE SIMULATION — aucun identifiant administrateur configuré');
    await simulateSteps(log, [
      'Ouverture du navigateur (Chromium headless)',
      'Connexion à NetSoins avec le compte administrateur',
      `Sélection de l'établissement "${data.etablissement}"`,
      'Navigation vers Paramétrage > Personnel > Ajouter un membre du personnel',
      `Saisie de l'identité : ${fullName}, né(e) le ${data.date_naissance}`,
      `Métier : ${data.metier}${data.numero_pro ? ` (n° pro ${data.numero_pro})` : ''} — contrat ${data.type_contrat}`,
      `Droits circuit du médicament : ${data.acces_prescriptions}`,
      `Période d'accès : du ${data.date_debut}${data.date_fin ? ` au ${data.date_fin}` : ''}`,
      'Enregistrement de la fiche personnel',
      'Génération des identifiants de connexion',
      'Vérification : le professionnel apparaît dans le planning',
    ]);
    return { success: true, message: `Compte NetSoins créé pour ${fullName} (simulation)` };
  }

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();

    log('Connexion à NetSoins…');
    await page.goto(process.env.NETSOINS_URL);
    await page.fill('#username', process.env.NETSOINS_ADMIN_USER);
    await page.fill('#password', process.env.NETSOINS_ADMIN_PASSWORD);
    await page.click('#login-button');
    await page.waitForLoadState('networkidle');

    log(`Sélection de l'établissement ${data.etablissement}…`);
    await page.selectOption('#etablissement-select', data.etablissement);

    log('Ouverture de Paramétrage > Personnel…');
    await page.click('nav >> text=Paramétrage');
    await page.click('text=Personnel');
    await page.click('button:has-text("Ajouter")');

    log(`Saisie de la fiche : ${fullName}`);
    await page.fill('input[name="nom"]', data.nom);
    await page.fill('input[name="prenom"]', data.prenom);
    await page.fill('input[name="email"]', data.email);
    await page.fill('input[name="date_naissance"]', data.date_naissance);
    await page.selectOption('select[name="metier"]', data.metier);
    if (data.numero_pro) await page.fill('input[name="rpps"]', data.numero_pro);
    await page.check(`input[name="contrat"][value="${data.type_contrat}"]`);
    await page.fill('input[name="date_debut"]', data.date_debut);
    if (data.date_fin) await page.fill('input[name="date_fin"]', data.date_fin);
    await page.selectOption('select[name="droits_medicament"]', data.acces_prescriptions);

    log('Enregistrement…');
    await page.click('button:has-text("Enregistrer")');
    await page.waitForSelector('.toast-success', { timeout: 15000 });

    return { success: true, message: `Compte NetSoins créé pour ${fullName}` };
  } finally {
    await browser.close();
  }
}

module.exports = { createAccount };
