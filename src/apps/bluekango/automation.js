'use strict';

/**
 * Scénario de création de compte BlueKanGo.
 *
 * Mode réel : renseigner dans .env
 *   BLUEKANGO_URL, BLUEKANGO_ADMIN_USER, BLUEKANGO_ADMIN_PASSWORD
 * puis SIMULATION_MODE=false.
 *
 * Les sélecteurs ci-dessous sont à ajuster sur la véritable interface
 * d'administration BlueKanGo de votre instance.
 */

const { isSimulation, simulateSteps, launchBrowser } = require('../../automation/helpers');

const ENV = ['BLUEKANGO_URL', 'BLUEKANGO_ADMIN_USER', 'BLUEKANGO_ADMIN_PASSWORD'];

async function createAccount(data, { log }) {
  const fullName = `${data.prenom} ${data.nom}`;

  if (isSimulation(ENV)) {
    log('MODE SIMULATION — aucun identifiant administrateur configuré');
    await simulateSteps(log, [
      'Ouverture du navigateur (Chromium headless)',
      'Connexion à BlueKanGo avec le compte administrateur',
      'Navigation vers Administration > Utilisateurs > Nouvel utilisateur',
      `Saisie de l'identité : ${fullName} <${data.email}>`,
      `Affectation : ${data.etablissement} / ${data.service} — ${data.fonction}`,
      `Application du profil "${data.profil}" et activation des modules : ${data.modules.join(', ')}`,
      'Enregistrement de la fiche utilisateur',
      'Envoi de l’e-mail d’initialisation du mot de passe',
      'Vérification : l’utilisateur apparaît dans la liste',
    ]);
    return { success: true, message: `Compte BlueKanGo créé pour ${fullName} (simulation)` };
  }

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();

    log('Connexion à BlueKanGo…');
    await page.goto(process.env.BLUEKANGO_URL);
    await page.fill('input[name="login"]', process.env.BLUEKANGO_ADMIN_USER);
    await page.fill('input[name="password"]', process.env.BLUEKANGO_ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');

    log('Ouverture du module Administration > Utilisateurs…');
    await page.goto(`${process.env.BLUEKANGO_URL}/admin/users/new`);

    log(`Saisie de la fiche utilisateur : ${fullName}`);
    await page.selectOption('select[name="civility"]', data.civilite);
    await page.fill('input[name="lastname"]', data.nom);
    await page.fill('input[name="firstname"]', data.prenom);
    await page.fill('input[name="email"]', data.email);
    if (data.telephone) await page.fill('input[name="phone"]', data.telephone);
    await page.selectOption('select[name="site"]', data.etablissement);
    await page.fill('input[name="department"]', data.service);
    await page.fill('input[name="job_title"]', data.fonction);
    await page.check(`input[name="profile"][value="${data.profil}"]`);
    for (const mod of data.modules) {
      await page.check(`input[name="modules"][value="${mod}"]`);
    }
    await page.fill('input[name="start_date"]', data.date_debut);

    log('Enregistrement…');
    await page.click('button#save-user');
    await page.waitForSelector('.notification-success', { timeout: 15000 });

    return { success: true, message: `Compte BlueKanGo créé pour ${fullName}` };
  } finally {
    await browser.close();
  }
}

module.exports = { createAccount };
