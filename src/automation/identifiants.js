'use strict';

/**
 * Génération des identifiants de connexion, avec gestion des collisions.
 *
 * Règle : 1re lettre du prénom + nom. En cas de collision (même identifiant
 * déjà attribué), on ajoute une lettre du prénom, puis une autre, etc. :
 *
 *   Amine BALA        → abala
 *   2e Amine BALA     → ambala      (2 lettres du prénom)
 *   3e Amine BALA     → amibala     (3 lettres)
 *   …                 → aminebala   (prénom complet + nom)
 *   au-delà           → aminebala2, aminebala3, …  (suffixe numérique)
 *
 * Tout est normalisé : sans accents, minuscules, uniquement des lettres a-z.
 */

function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** Identifiant de base (sans gestion de collision). */
function generateLogin(prenom, nom) {
  const p = normalize(prenom);
  const n = normalize(nom);
  return (p.charAt(0) || '') + n;
}

/** Suite ordonnée des identifiants candidats en cas de collision. */
function* candidateLogins(prenom, nom) {
  const p = normalize(prenom);
  const n = normalize(nom);
  const full = (p.charAt(0) || '') + n;
  if (!full) {
    yield 'utilisateur';
    return;
  }
  // 1re lettre + nom, puis 2 lettres + nom, … jusqu'au prénom complet + nom.
  const maxK = Math.max(1, p.length);
  for (let k = 1; k <= maxK; k++) yield p.slice(0, k) + n;
  // Filet : suffixe numérique sur la forme complète.
  for (let i = 2; i < 1000; i++) yield p + n + i;
}

/**
 * Premier identifiant candidat non pris.
 * @param {(login:string)=>boolean} isTaken — vrai si l'identifiant est déjà utilisé.
 */
function pickUniqueLogin(prenom, nom, isTaken) {
  for (const candidate of candidateLogins(prenom, nom)) {
    if (candidate && !isTaken(candidate)) return candidate;
  }
  // Cas extrême : on renvoie une forme datée pour rester unique.
  return generateLogin(prenom, nom) + '-' + Date.now().toString().slice(-5);
}


/* ---------------------------------------------------------------------------
   Mot de passe provisoire d'une réinitialisation.

   Il était construit sur un mot fixe suivi de quatre chiffres — le nom du
   client, écrit en clair dans ce fichier. Deux défauts, tous deux sérieux :

    - NEUF MILLE possibilités seulement, et le préfixe est public puisqu'il est
      dans le code. Un mot de passe qui ouvre une application de santé se
      devinait donc en quelques secondes.
    - Le nom d'un client se retrouvait dans les mots de passe de tous les
      autres, ce qui n'a aucun sens en hébergement mutualisé.

   La forme est conservée — une majuscule, des minuscules, des chiffres, et un
   symbole optionnel — parce que c'est elle qui satisfait les règles de
   complexité des applications métiers. Seul le contenu devient imprévisible.
   L'alphabet exclut les caractères qu'on confond en les recopiant ou en les
   dictant au téléphone : I, l, O, 0, 1.
   --------------------------------------------------------------------------- */

const CONSONNES = 'bcdfghjkmnpqrstvwxz';
const VOYELLES = 'aeuy';

/**
 * Mot de passe provisoire : lisible, dictable, et imprévisible.
 * @param {string} [suffixe] Symbole final exigé par certaines applications.
 */
function motDePasseProvisoire(suffixe = '') {
  const crypto = require('node:crypto');
  const tire = (alphabet) => alphabet[crypto.randomInt(alphabet.length)];
  // Syllabes alternées : se lit et se dicte, contrairement à une suite de
  // caractères tirés au hasard qu'il faut épeler lettre à lettre.
  let mot = '';
  for (let i = 0; i < 5; i += 1) mot += tire(CONSONNES) + tire(VOYELLES);
  return mot.charAt(0).toUpperCase() + mot.slice(1)
    + crypto.randomInt(1000, 10000)
    + suffixe;
}

module.exports = { normalize, generateLogin, candidateLogins, pickUniqueLogin, motDePasseProvisoire };
