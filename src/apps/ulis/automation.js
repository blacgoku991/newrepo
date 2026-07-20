'use strict';

/**
 * Scénario de création de compte ULIS.
 *
 * Mode réel : renseigner dans .env
 *   ULIS_URL, ULIS_ADMIN_USER, ULIS_ADMIN_PASSWORD
 * puis SIMULATION_MODE=false. Ajuster les sélecteurs sur votre instance.
 */

const { isSimulation, simulateSteps, launchBrowser } = require('../../automation/helpers');

const ENV = ['ULIS_URL', 'ULIS_ADMIN_USER', 'ULIS_ADMIN_PASSWORD'];

async function createAccount(data, { log }) {
  const fullName = `${data.prenom} ${data.nom}`;

  if (isSimulation(ENV)) {
    log('MODE SIMULATION — aucun identifiant administrateur configuré');
    await simulateSteps(log, [
      'Ouverture du navigateur (Chromium headless)',
      'Connexion à ULIS avec le compte administrateur',
      'Navigation vers Administration > Comptes utilisateurs > Créer',
      `Saisie de l'agent : ${fullName} (matricule ${data.matricule})`,
      `Affectation : ${data.direction} — rôle "${data.role}"`,
      `Périmètre d'accès : ${data.perimetre.join(', ')}`,
      `Activation du compte au ${data.date_debut} (motif : ${data.motif})`,
      'Enregistrement du compte',
      'Envoi des identifiants à l’agent',
      'Vérification : connexion test réussie',
    ]);
    return { success: true, message: `Compte ULIS créé pour ${fullName} (simulation)` };
  }

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();

    log('Connexion à ULIS…');
    await page.goto(process.env.ULIS_URL);
    await page.fill('input[name="username"]', process.env.ULIS_ADMIN_USER);
    await page.fill('input[name="password"]', process.env.ULIS_ADMIN_PASSWORD);
    await page.click('input[type="submit"]');
    await page.waitForLoadState('networkidle');

    log('Ouverture de Administration > Comptes utilisateurs…');
    await page.click('text=Administration');
    await page.click('text=Comptes utilisateurs');
    await page.click('text=Créer un compte');

    log(`Saisie du compte : ${fullName} (${data.matricule})`);
    await page.fill('input[name="nom"]', data.nom);
    await page.fill('input[name="prenom"]', data.prenom);
    await page.fill('input[name="matricule"]', data.matricule);
    await page.fill('input[name="email"]', data.email);
    await page.selectOption('select[name="direction"]', data.direction);
    await page.check(`input[name="role"][value="${data.role}"]`);
    for (const p of data.perimetre) {
      await page.check(`input[name="perimetre"][value="${p}"]`);
    }
    await page.fill('input[name="date_debut"]', data.date_debut);

    log('Enregistrement…');
    await page.click('button:has-text("Valider")');
    await page.waitForSelector('.message-confirmation', { timeout: 15000 });

    return { success: true, message: `Compte ULIS créé pour ${fullName}` };
  } finally {
    await browser.close();
  }
}

module.exports = { createAccount };
