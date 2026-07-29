'use strict';

/* Page de connexion SSO Microsoft 365 (script externe : compatible CSP stricte). */

(function () {
  // Conserve la page demandée à l'origine pour y revenir après connexion.
  // Uniquement un chemin local. L'antislash est exclu : les navigateurs le
  // lisent comme une barre oblique, si bien que « /\evil.fr » passait pour un
  // chemin local avant d'être compris comme un autre site. Le serveur applique
  // la même règle — celle-ci évite seulement d'envoyer une cible inutile.
  const next = new URLSearchParams(location.search).get('next');
  if (next && /^\/(?!\/)[^\\]*$/.test(next)) {
    const btn = document.getElementById('ms-btn');
    btn.href = '/auth/sso/login?next=' + encodeURIComponent(next);
  }
})();
