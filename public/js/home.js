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

  container.innerHTML = apps
    .map((app) => {
      if (app.comingSoon) {
        return `<div class="app-card soon">
          <div class="top">${appVisual(app)}<span class="tag tag-soon">Bientôt</span></div>
          <h3>${escapeHtml(app.name)}</h3>
          <div class="cat">${escapeHtml(app.category)}</div>
          <p>${escapeHtml(app.description)}</p>
          <span class="go">Ouverture prochaine</span>
        </div>`;
      }
      return `<a class="app-card" href="/demande.html?app=${encodeURIComponent(app.id)}">
        <div class="top">${appVisual(app)}<span class="tag tag-live">Disponible</span></div>
        <h3>${escapeHtml(app.name)}</h3>
        <div class="cat">${escapeHtml(app.category)}</div>
        <p>${escapeHtml(app.description)}</p>
        <span class="go">Demander un compte ${icon('arrow')}</span>
      </a>`;
    })
    .join('');

  bindTilt();

  /* Effet 3D subtil : léger basculement de la carte suivant la souris. */
  function bindTilt() {
    if (window.matchMedia('(hover: none)').matches) return;
    for (const card of container.querySelectorAll('a.app-card')) {
      card.addEventListener('mousemove', (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = `translateY(-3px) rotateX(${(-py * 4).toFixed(2)}deg) rotateY(${(px * 4).toFixed(2)}deg)`;
      });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; });
    }
  }
})();
