'use strict';

(async function () {
  const container = document.getElementById('cards');
  try {
    const apps = await fetchJson('/api/apps');
    container.innerHTML = apps
      .map((app) => {
        const iconHtml = `<span class="icon">${icon(app.icon)}</span>`;
        if (app.comingSoon) {
          return `
            <div class="app-card disabled" style="--app-color:${escapeHtml(app.color)}">
              <span class="badge-soon">Bientôt disponible</span>
              ${iconHtml}
              <h3>${escapeHtml(app.name)}</h3>
              <div class="category" style="color:var(--muted)">${escapeHtml(app.category)}</div>
              <p>${escapeHtml(app.description)}</p>
              <span class="cta" style="color:var(--faint)">${icon('lock')} Ouverture prochaine</span>
            </div>`;
        }
        return `
          <a class="app-card" style="--app-color:${escapeHtml(app.color)}" href="/demande.html?app=${encodeURIComponent(app.id)}">
            ${iconHtml}
            <h3>${escapeHtml(app.name)}</h3>
            <div class="category">${escapeHtml(app.category)}</div>
            <p>${escapeHtml(app.description)}</p>
            <span class="cta">Demander un compte ${icon('arrow')}</span>
          </a>`;
      })
      .join('');
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">Impossible de charger les applications : ${escapeHtml(err.message)}</div>`;
  }
})();
