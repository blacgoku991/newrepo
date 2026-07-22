'use strict';

/**
 * Règles de génération des identifiants de connexion.
 * Partagé entre les scénarios du robot et l'envoi des e-mails d'identifiants.
 */

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

module.exports = { generateLogin };
