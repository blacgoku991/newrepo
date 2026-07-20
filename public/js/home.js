'use strict';

(async function () {
  const container = document.getElementById('cards');
  try {
    const apps = await fetchJson('/api/apps');
    container.innerHTML = apps
      .map((app) => {
        const iconHtml = `<span class="icon" style="background:${escapeHtml(app.color)}">${icon(app.icon)}</span>`;
        if (app.comingSoon) {
          return `
            <div class="app-card disabled">
              <span class="badge-soon">Bientôt disponible</span>
              ${iconHtml}
              <h3>${escapeHtml(app.name)}</h3>
              <div class="category">${escapeHtml(app.category)}</div>
              <p>${escapeHtml(app.description)}</p>
              <span class="cta" style="color:var(--text-muted)">Ouverture prochaine</span>
            </div>`;
        }
        return `
          <a class="app-card" href="/demande.html?app=${encodeURIComponent(app.id)}">
            ${iconHtml}
            <h3>${escapeHtml(app.name)}</h3>
            <div class="category">${escapeHtml(app.category)}</div>
            <p>${escapeHtml(app.description)}</p>
            <span class="cta">Demander un compte →</span>
          </a>`;
      })
      .join('');
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">Impossible de charger les applications : ${escapeHtml(err.message)}</div>`;
  }
})();
