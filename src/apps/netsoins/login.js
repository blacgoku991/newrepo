'use strict';

/**
 * Identifiant NetSoins : « NOM PRÉNOM » en MAJUSCULES (format constaté sur
 * l'instance ADEF, ex. « PAPON BENJAMIN »). En cas de collision, on ajoute un
 * suffixe numérique (« NOM PRÉNOM 2 », « 3 », …).
 */

function normalizeName(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

/** Identifiant de base (sans gestion de collision). */
function baseLogin(nom, prenom) {
  return `${normalizeName(nom)} ${normalizeName(prenom)}`.trim().toUpperCase();
}

/** Suite ordonnée des identifiants candidats. */
function* candidateLogins(nom, prenom) {
  const base = baseLogin(nom, prenom);
  if (!base) { yield 'INTERVENANT'; return; }
  yield base;
  for (let i = 2; i < 1000; i++) yield `${base} ${i}`;
}

/**
 * Premier identifiant candidat non pris.
 * @param {(login:string)=>boolean} isTaken
 */
function pickUniqueLogin(nom, prenom, isTaken) {
  for (const candidate of candidateLogins(nom, prenom)) {
    if (candidate && !isTaken(candidate)) return candidate;
  }
  return `${baseLogin(nom, prenom)} ${Date.now().toString().slice(-5)}`;
}

module.exports = { baseLogin, candidateLogins, pickUniqueLogin };
