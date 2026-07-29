// Vérifie le cloisonnement par établissement (escalade horizontale entre référents)
const { RACINE, CHROMIUM } = require('../lib/harnais');
const RACINE_SLASH = RACINE + '/';
const referents = require(RACINE_SLASH + 'src/referents');

// Référent de « ANNONAY - Mon Foyer » (778) uniquement, sur netsoins
const ref = { email:'a@x.fr', active:1, etablissements:[{appId:'netsoins', value:'778', label:'EHPAD MON FOYER'}] };

const cas = [
  ['son propre établissement (778)',            '778', true],
  ['établissement d\'un AUTRE référent (736)',  '736', false],
  ['établissement inexistant (99999)',          '99999', false],
  ['valeur vide',                               '', false],
  ['injection type "778 OR 1=1"',               '778 OR 1=1', false],
  ['type numérique 778 (et non chaîne)',        778, true],
];
let ko = 0;
for (const [nom, valeur, attendu] of cas) {
  const got = referents.allows(ref, 'netsoins', valeur);
  const ok = got === attendu;
  if (!ok) ko++;
  console.log((ok?'✓':'✗ ÉCHEC') , nom.padEnd(42), '->', got ? 'autorisé' : 'refusé');
}
// cloisonnement inter-application : même valeur, autre appli
console.log((referents.allows(ref,'bluekango','778')===false?'✓':'✗ ÉCHEC'),
            'même valeur mais AUTRE application'.padEnd(42), '-> refusé');
console.log(ko ? `\n${ko} cas en échec` : '\nCloisonnement conforme sur tous les cas ✓');
