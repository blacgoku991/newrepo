#!/usr/bin/env node
'use strict';

/*
 * Redéfinit le mot de passe d'un administrateur du portail.
 *
 *   node scripts/reset-admin.js                 → utilise ADMIN_USERNAME / ADMIN_PASSWORD du .env
 *   node scripts/reset-admin.js --liste         → liste les comptes existants
 *   node scripts/reset-admin.js --user admin --mdp "MonMotDePasse!"
 *
 * À savoir : le compte administrateur n'est créé qu'au TOUT PREMIER démarrage,
 * à partir du .env. Ensuite il vit dans la base (data/portal.db) et modifier
 * ADMIN_PASSWORD dans le .env n'a plus aucun effet — d'où ce script.
 */

require('../src/loadEnv');
const db = require('../src/db');
const auth = require('../src/auth');

const arg = (nom) => {
  const i = process.argv.indexOf(`--${nom}`);
  const v = i === -1 ? null : process.argv[i + 1];
  return v && !v.startsWith('--') ? v : null;
};

const comptes = db.listAdmins();

if (process.argv.includes('--liste') || !comptes.length) {
  console.log(comptes.length ? '\n  Comptes administrateurs :' : '\n  Aucun compte administrateur dans la base.');
  for (const c of comptes) console.log(`   - ${c.username}  (${c.display_name || ''}${c.role ? `, ${c.role}` : ''})`);
  console.log('');
  if (!comptes.length) console.log('  Démarrez le portail une fois : il crée le premier compte à partir du .env.\n');
  process.exit(0);
}

const username = arg('user') || process.env.ADMIN_USERNAME || 'admin';
const motDePasse = arg('mdp') || process.env.ADMIN_PASSWORD;

if (!motDePasse) {
  console.error('✗ Aucun mot de passe fourni : renseignez ADMIN_PASSWORD dans .env ou passez --mdp "…".');
  process.exit(1);
}
// On avertit sans bloquer : c'est parfois volontaire en recette.
if (String(motDePasse).length < 8) {
  console.warn('⚠ Mot de passe très court — à ne pas laisser sur une installation en production.');
}

const compte = comptes.find((c) => c.username === username);
if (!compte) {
  console.error(`✗ Aucun compte « ${username} ». Comptes existants : ${comptes.map((c) => c.username).join(', ')}`);
  console.error('  (node scripts/reset-admin.js --liste)');
  process.exit(1);
}

db.setAdminPassword(compte.id, auth.hashPassword(motDePasse));
db.audit('script', 'admin_mdp_reinitialise', username, 'scripts/reset-admin.js');

console.log(`\n  Mot de passe redéfini pour « ${username} ».`);
console.log('  Connectez-vous sur /admin avec ce mot de passe.\n');
process.exit(0);
