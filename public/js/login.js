'use strict';

/* Connexion à l'espace d'administration (script externe : compatible CSP stricte). */

(function () {
  const form = document.getElementById('login-form');
  const err = document.getElementById('err');
  const btn = document.getElementById('login-btn');
  // Cible de retour : uniquement un chemin local (anti open-redirect).
  const raw = new URLSearchParams(location.search).get('next') || '/admin.html';
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/admin.html';
  fetchJson('/api/auth/me').then(() => { location.href = next; }).catch(() => {});
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.style.display = 'none';
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Connexion…';
    try {
      await fetchJson('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('username').value,
          password: document.getElementById('password').value,
        }),
      });
      location.href = next;
    } catch (ex) {
      err.textContent = ex.message;
      err.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Se connecter';
    }
  });
})();
