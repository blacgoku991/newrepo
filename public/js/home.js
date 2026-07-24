'use strict';

/* Accueil : cartes des applications (données API) + tilt 3D subtil au survol. */
(async function () {
  const container = document.getElementById('cards');
  let apps;
  try {
    apps = await fetchJson('/api/apps');
  } catch (err) {
    container.innerHTML = `<div class="alert alert-err" style="grid-column:1/-1">Impossible de charger les applications : ${escapeHtml(err.message)}</div>`;
    return;
  }

  const available = apps.filter((a) => !a.comingSoon).length;
  const stat = document.getElementById('stat-apps');
  if (stat) stat.textContent = String(available);

  // Présentation « annuaire » : une application par ligne (logo, texte, action).
  container.innerHTML = apps
    .map((app) => {
      const body = `
        <div class="body">
          <div class="line"><h3>${escapeHtml(app.name)}</h3><span class="tag ${app.comingSoon ? 'tag-soon' : 'tag-live'}">${app.comingSoon ? 'Bientôt' : 'Disponible'}</span></div>
          <div class="cat">${escapeHtml(app.category)}</div>
          <p>${escapeHtml(app.description)}</p>
        </div>`;
      if (app.comingSoon) {
        return `<div class="app-card soon">
          <div class="ident">${appVisual(app)}</div>
          ${body}
          <span class="go">Ouverture prochaine</span>
        </div>`;
      }
      return `<a class="app-card" href="/demande.html?app=${encodeURIComponent(app.id)}">
        <div class="ident">${appVisual(app)}</div>
        ${body}
        <span class="go">Demander un compte ${icon('arrow')}</span>
      </a>`;
    })
    .join('');
})();
