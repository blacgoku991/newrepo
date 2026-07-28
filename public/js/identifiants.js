'use strict';

/*
 * Récupération sécurisée des identifiants (lien à usage unique).
 * L'affichage est déclenché par un clic explicite : un simple chargement de la
 * page (aperçu de messagerie, antivirus) ne consomme pas le lien.
 */

(function () {
  const token = decodeURIComponent(location.pathname.split('/').pop() || '');
  const zone = document.getElementById('zone');
  const sub = document.getElementById('sub');
  const btn = document.getElementById('reveal-btn');

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Déchiffrement…';
    try {
      const data = await fetchJson('/api/identifiants/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      sub.innerHTML = `Compte <strong>${escapeHtml(data.app)}</strong> — référence <strong>${escapeHtml(data.reference)}</strong>. `
        + `Conservez ${data.password ? 'ces informations' : 'cet identifiant'} en lieu sûr&nbsp;: cette page ne pourra pas être rouverte.`;
      const row = (label, value) => `
        <div class="cred-row">
          <span class="k">${label}</span>
          <span class="v">${escapeHtml(value)}</span>
          <button type="button" data-copy="${escapeHtml(value)}">Copier</button>
        </div>`;
      // Une correction d'identité change l'identifiant de connexion sans
      // toucher au mot de passe : on remet le nouvel identifiant et on le dit,
      // plutôt que d'afficher un mot de passe qui ne serait pas le sien.
      zone.innerHTML =
        row('Identifiant', data.login) +
        (data.password ? row('Mot de passe', data.password) : '') +
        (data.password
          ? `<div class="cred-warning">⚠ Ce mot de passe est <strong>provisoire</strong> : il vous sera demandé de le changer lors de votre première connexion à l'application.</div>`
          : `<div class="cred-warning">Votre <strong>mot de passe n'a pas changé</strong> : continuez à utiliser celui que vous connaissez déjà. Seul l'identifiant de connexion ci-dessus a été modifié.</div>`);
      for (const b of zone.querySelectorAll('[data-copy]')) {
        b.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(b.dataset.copy);
            b.textContent = 'Copié ✓';
            setTimeout(() => (b.textContent = 'Copier'), 2000);
          } catch { /* presse-papier indisponible */ }
        });
      }
    } catch (err) {
      zone.innerHTML = `<div class="alert alert-err" style="text-align:left">${escapeHtml(err.message)}</div>`;
    }
  });
})();
