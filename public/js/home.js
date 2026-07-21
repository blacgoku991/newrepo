'use strict';

(async function () {
  const container = document.getElementById('cards');
  try {
    const apps = await fetchJson('/api/apps');
    const available = apps.filter((a) => !a.comingSoon).length;
    const el = document.getElementById('stat-apps');
    if (el) el.textContent = String(available);

    let n = 0;
    container.innerHTML = apps
      .map((app) => {
        n++;
        const num = String(n).padStart(2, '0');
        const tile = `<span class="tile" style="background:${escapeHtml(app.color)}">${icon(app.icon)}</span>`;
        if (app.comingSoon) {
          return `
            <div class="app-card soon" style="--c:${escapeHtml(app.color)}">
              <div class="top">${tile}<span class="tag-soon">Bientôt</span></div>
              <h3>${escapeHtml(app.name)}</h3>
              <div class="cat">${escapeHtml(app.category)}</div>
              <p>${escapeHtml(app.description)}</p>
              <span class="go" style="color:var(--faint)">${icon('lock')} Ouverture prochaine</span>
            </div>`;
        }
        return `
          <a class="app-card" style="--c:${escapeHtml(app.color)}" href="/demande.html?app=${encodeURIComponent(app.id)}">
            <div class="top">${tile}<span class="num">${num}</span></div>
            <h3>${escapeHtml(app.name)}</h3>
            <div class="cat">${escapeHtml(app.category)}</div>
            <p>${escapeHtml(app.description)}</p>
            <span class="go">Demander un compte ${icon('arrow')}</span>
          </a>`;
      })
      .join('');
  } catch (err) {
    container.innerHTML = `<div class="alert alert-err">Impossible de charger les applications : ${escapeHtml(err.message)}</div>`;
  }
})();
