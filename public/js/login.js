'use strict';

/* Connexion à l'espace d'administration (script externe : compatible CSP stricte). */

(function () {
  const form = document.getElementById('login-form');
  const err = document.getElementById('err');
  const btn = document.getElementById('login-btn');
  // Cible de retour : uniquement un chemin local (anti open-redirect).
  const raw = new URLSearchParams(location.search).get('next') || '/admin.html';
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/admin.html';
  const etapeMdp = document.getElementById('etape-mdp');
  const etapeCode = document.getElementById('etape-code');
  const champCode = document.getElementById('code');
  // Jeton de passage remis après le mot de passe. Il ne vaut rien seul : sans
  // le code, aucune session n'est ouverte.
  let defi = null;
  // Le serveur ferme le jeton au bout de cinq essais. On repasse au mot de
  // passe un peu avant : le client ne sait pas — et ne doit pas savoir — si
  // l'échec vient du code ou d'un jeton déjà fermé, mais laisser saisir des
  // codes dans le vide serait pénible.
  let essais = 0;
  const ESSAIS_AVANT_RETOUR = 3;

  fetchJson('/api/auth/me').then(() => { location.href = next; }).catch(() => {});

  const rendreLaMain = (message) => {
    err.textContent = message;
    err.style.display = 'block';
    btn.disabled = false;
    btn.textContent = defi ? 'Vérifier' : 'Se connecter';
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.style.display = 'none';
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> ' + (defi ? 'Vérification…' : 'Connexion…');
    try {
      if (defi) {
        await fetchJson('/api/auth/login/2fa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defi, code: champCode.value }),
        });
        location.href = next;
        return;
      }
      const out = await fetchJson('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('username').value,
          password: document.getElementById('password').value,
        }),
      });
      if (out && out.besoin2fa) {
        defi = out.defi;
        etapeMdp.hidden = true;
        etapeCode.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Vérifier';
        champCode.value = '';
        champCode.focus();
        return;
      }
      location.href = next;
    } catch (ex) {
      if (defi && ++essais >= ESSAIS_AVANT_RETOUR) {
        defi = null;
        essais = 0;
        etapeCode.hidden = true;
        etapeMdp.hidden = false;
        document.getElementById('password').value = '';
      }
      rendreLaMain(ex.message);
      if (defi) { champCode.value = ''; champCode.focus(); }
    }
  });
})();
