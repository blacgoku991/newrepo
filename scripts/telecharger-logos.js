'use strict';
/*
 * À lancer SUR VOTRE PC (réseau autorisé) : node scripts/telecharger-logos.js
 * Remplace les logos SVG de substitution par les vrais logos des éditeurs.
 */
const fs = require('fs');
const LOGOS = [
  ['https://app.bluekango.com/BMS_EARLY/images/bkg_logo.png', 'public/img/bluekango.png'],
  ['https://adef.netsoins.com/images/orisha_socialcare_teranga.png', 'public/img/netsoins.png'],
];
(async () => {
  for (const [url, out] of LOGOS) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
      console.log('✔', out);
    } catch (e) { console.log('✘', out, '—', e.message); }
  }
  console.log('Si les .png sont présents, ils remplacent automatiquement les .svg (voir config.js : logo).');
})();
