'use strict';

/* Page de connexion SSO Microsoft 365 (script externe : compatible CSP stricte). */

(function () {
  // Conserve la page demandée à l'origine pour y revenir après connexion.
  // Uniquement un chemin local (anti open-redirect).
  const next = new URLSearchParams(location.search).get('next');
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    const btn = document.getElementById('ms-btn');
    btn.href = '/auth/sso/login?next=' + encodeURIComponent(next);
  }
})();
