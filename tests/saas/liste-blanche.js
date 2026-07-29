/* Liste blanche : seuls les référents déclarés entrent. */
const os = require('os'), fs = require('fs'), path = require('path');
const { RACINE } = require('../lib/harnais');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-'));
process.env.PORT = '3982'; process.env.AUTOMATION_MODE = 'demo';
process.env.WORKER_POLL_MS = '600000'; process.env.WORKER_DEMARRAGE_MS = '0';
process.env.ACCES_PORTAIL = 'liste';
const db = require(path.join(RACINE, 'src/db'));
const hab = require(path.join(RACINE, 'src/habilitation'));
let ok = true;
const dit = (b, t) => { if (!b) ok = false; console.log(`  ${b ? '✓' : '✗'} ${t}`); };
const titre = (t) => console.log(`\n— ${t} —`);

db.createReferent('claire.durand@adef.fr', 'DURAND', 'Claire', [], 'test');
const idAncien = db.createReferent('ancien@adef.fr', 'ANCIEN', 'Paul', [], 'test');
// Fiche désactivée : c'est le geste par lequel on retire un accès.
const Database = require(path.join(RACINE, 'node_modules/better-sqlite3'));
const conn = new Database(path.join(process.env.DATA_DIR, 'portail.db'));
conn.prepare('UPDATE referents SET active = 0 WHERE email = ?').run('ancien@adef.fr');
conn.close();

titre('1. Mode liste : la fiche référent fait la loi');
let d = hab.autoriseConnexion({}, 'claire.durand@adef.fr');
dit(d.ok, `référent déclaré : ${d.detail}`);
d = hab.autoriseConnexion({}, 'inconnu@adef.fr');
dit(!d.ok && d.motif === 'ferme', `compte du tenant NON inscrit : refusé (${d.detail})`);
d = hab.autoriseConnexion({}, 'ancien@adef.fr');
dit(!d.ok && d.motif === 'desactive', `fiche désactivée : refusée (${d.detail})`);

titre('2. La casse de l’adresse ne contourne rien');
d = hab.autoriseConnexion({}, 'Claire.Durand@ADEF.fr');
dit(d.ok, 'même adresse en majuscules : acceptée');
d = hab.autoriseConnexion({}, 'claire.durand@adef.fr.pirate.com');
dit(!d.ok, 'adresse ressemblante : refusée');

titre('3. Mode tenant : la désactivation prime malgré tout');
process.env.ACCES_PORTAIL = 'tenant';
d = hab.autoriseConnexion({}, 'ancien@adef.fr');
dit(!d.ok, 'un référent désactivé reste dehors, même en mode ouvert');
d = hab.autoriseConnexion({}, 'nimporte@adef.fr');
dit(d.ok, 'et les autres entrent, comme prévu dans ce mode');

titre('4. Mode attribut : la fiche l’emporte, sinon l’attribut décide');
process.env.ACCES_PORTAIL = 'attribut';
process.env.ACCES_ATTRIBUT = 'extensionAttribute1=REFERENT';
d = hab.autoriseConnexion({}, 'claire.durand@adef.fr');
dit(d.ok, 'référent déclaré : entre sans attribut');
d = hab.autoriseConnexion({ extensionAttribute1: 'REFERENT' }, 'autre@adef.fr');
dit(d.ok, 'bon attribut : entre');
d = hab.autoriseConnexion({ extensionAttribute1: 'AUTRE' }, 'autre@adef.fr');
dit(!d.ok, 'mauvais attribut : refusé');
d = hab.autoriseConnexion({}, 'autre@adef.fr');
dit(!d.ok, 'aucun attribut : refusé');

titre('5. Par défaut, le plus fermé');
const reglages = require(path.join(RACINE, 'superadmin/lib/reglages'));
const champ = reglages.GROUPES.find((g) => g.id === 'acces').champs.find((c) => c.cle === 'accesPortail');
dit(champ.defaut === 'liste', `réglage par défaut d'une nouvelle société : « ${champ.defaut} »`);
dit(champ.options[0][0] === 'liste', 'et proposé en premier dans le panel');

console.log(ok ? '\n>>> Liste blanche conforme ✓' : '\n>>> DES CAS ONT ÉCHOUÉ');
process.exit(ok ? 0 : 1);
