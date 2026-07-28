'use strict';

/**
 * Réinitialise (ou crée) le mot de passe d'un opérateur du panel.
 *
 *   node superadmin/reset-operateur.js --liste
 *   node superadmin/reset-operateur.js --user achraf --mdp "MonMotDePasse"
 *   node superadmin/reset-operateur.js --user achraf          (tire au hasard)
 *
 * Le mot de passe du premier opérateur n'est affiché QU'UNE FOIS, au démarrage
 * initial. Sans cet outil, l'oublier signifierait perdre l'accès au panel — et
 * donc à toutes les licences.
 *
 * À lancer sur la machine qui héberge le panel : il touche directement au
 * registre, sans passer par le réseau.
 */

const crypto = require('crypto');
const db = require('./lib/db');

function hacher(motDePasse) {
  const sel = crypto.randomBytes(16).toString('hex');
  return `scrypt$${sel}$${crypto.scryptSync(motDePasse, sel, 64).toString('hex')}`;
}

function argument(nom) {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 ? process.argv[i + 1] : null;
}

if (process.argv.includes('--liste')) {
  const operateurs = db.operateurs ? db.operateurs() : null;
  if (!operateurs) {
    console.log('Liste indisponible sur cette version du registre.');
    process.exit(0);
  }
  if (!operateurs.length) {
    console.log('Aucun opérateur. Créez-en un : --user <nom> --mdp <mot de passe>');
    process.exit(0);
  }
  console.log('\nOpérateurs du panel :\n');
  for (const o of operateurs) {
    console.log(`  ${o.username.padEnd(20)} dernière connexion : ${o.last_login || 'jamais'}`);
  }
  console.log('');
  process.exit(0);
}

const utilisateur = argument('user');
if (!utilisateur) {
  console.log(`
Réinitialiser l'accès au panel Smartfixx

  node superadmin/reset-operateur.js --liste
  node superadmin/reset-operateur.js --user <nom> [--mdp <mot de passe>]

Sans --mdp, un mot de passe est tiré au hasard et affiché une fois.
`);
  process.exit(1);
}

const genere = !argument('mdp');
const motDePasse = argument('mdp') || crypto.randomBytes(12).toString('base64url');

// Prévenir sans bloquer : c'est l'exploitant qui décide, mais il doit savoir.
if (!genere && motDePasse.length < 10) {
  console.warn('\n⚠ Ce mot de passe est court. Le panel donne accès à toutes les licences.\n');
}

const existant = db.operateur(utilisateur);
if (existant) {
  db.majMotDePasseOperateur(existant.id, hacher(motDePasse));
  console.log(`\n✓ Mot de passe de « ${utilisateur} » remplacé.`);
} else {
  db.creerOperateur(utilisateur, hacher(motDePasse));
  console.log(`\n✓ Opérateur « ${utilisateur} » créé.`);
}

if (genere) console.log(`\n  Mot de passe : ${motDePasse}\n\n  Notez-le : il n'est affiché qu'ici.\n`);
else console.log('');

// Les sessions ouvertes avec l'ancien mot de passe ne doivent pas survivre :
// changer un mot de passe sert souvent à reprendre la main.
if (existant && db.fermerSessionsOperateur) {
  const n = db.fermerSessionsOperateur(existant.id);
  if (n) console.log(`  ${n} session(s) en cours fermée(s).\n`);
}
