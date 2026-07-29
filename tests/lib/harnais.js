'use strict';

/**
 * Socle commun des tests.
 *
 * Ces suites étaient nées comme des scripts jetables, avec des chemins absolus
 * et des ports en dur. Ils ont attrapé assez de défauts réels — cloisonnement,
 * redirection ouverte, effacement incomplet — pour mériter de vivre dans le
 * dépôt et d'être rejoués à chaque changement.
 *
 * Ce module leur donne : la racine du projet sans la coder en dur, un dossier
 * de sortie pour les captures, et de quoi énoncer une vérification.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Racine du projet, déduite de l'emplacement de ce fichier. */
const RACINE = path.join(__dirname, '..', '..');

/** Où les tests déposent leurs captures d'écran. Ignoré par git. */
// Le séparateur final est VOULU : les suites écrivent `${SORTIES}capture.png`.
// Sans lui, les captures atterrissaient à côté du dossier, nommées
// « .sortiescapture.png » — et personne ne les retrouvait.
const DOSSIER_SORTIES = process.env.TESTS_SORTIES || path.join(RACINE, 'tests', '.sorties');
fs.mkdirSync(DOSSIER_SORTIES, { recursive: true });
const SORTIES = DOSSIER_SORTIES + path.sep;

/** Chromium préinstallé dans l'image, ou celui de Playwright. */
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

/** Dossier de données jetable, propre à un test. */
function dossierTemporaire(prefixe) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefixe}-`));
}

/**
 * Compteur de vérifications.
 *
 * Chaque test crée le sien, énonce ses attentes, et rend un code de sortie.
 * Pas de framework : ces suites démarrent de vrais serveurs et de vrais
 * navigateurs, et une couche de plus n'apporterait que des façons
 * supplémentaires d'échouer.
 */
function verificateur() {
  let echecs = 0;
  const ok = (condition, libelle) => {
    console.log(`  ${condition ? '✓' : '✗'} ${libelle}`);
    if (!condition) echecs += 1;
    return !!condition;
  };
  ok.titre = (t) => console.log(`\n— ${t} —`);
  ok.bilan = (nom) => {
    console.log(echecs ? `\n>>> ${nom} : ${echecs} anomalie(s)` : `\n>>> ${nom} ✓`);
    return echecs;
  };
  ok.echecs = () => echecs;
  return ok;
}

/** Attend `ms` millisecondes. */
const dors = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { RACINE, SORTIES, CHROMIUM, dossierTemporaire, verificateur, dors };
