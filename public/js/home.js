'use strict';

/* Accueil — grille premium avec effet tilt 3D au survol. */
(function () {
  const stack = document.getElementById('stack');
  const metaCount = document.getElementById('meta-count');

  init();

  async function init() {
    let apps = [];
    try {
      apps = await fetchJson('/api/apps');
    } catch (err) {
      stack.innerHTML = `<div class="alert alert-err" style="grid-column:1/-1">Impossible de charger les applications : ${escapeHtml(err.message)}</div>`;
      if (metaCount) metaCount.textContent = '—';
      return;
    }

    if (!apps.length) {
      stack.innerHTML = '<div class="alert alert-err" style="grid-column:1/-1">Aucune application disponible pour le moment.</div>';
      if (metaCount) metaCount.textContent = '0';
      return;
    }

    const available = apps.filter((a) => !a.comingSoon).length;
    if (metaCount) metaCount.textContent = String(available);

    stack.innerHTML = apps.map(tile).join('');
    bindTilt();
  }

  function tile(app, i) {
    const num = String(i + 1).padStart(2, '0');
    const soon = !!app.comingSoon;
    const cls = ['app-tile'];
    if (soon) cls.push('is-soon');
    const color = app.color || '#5a8bff';

    const inner = `
      <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
      <span class="sweep"></span>
      <div class="app-tile-head">
        <span class="app-tile-num">N° ${num}</span>
        ${soon
          ? '<span class="app-tile-badge">Bientôt</span>'
          : '<span class="app-tile-badge is-live">En ligne</span>'}
      </div>
      <div class="app-tile-cat">${escapeHtml(app.category || 'Application')}</div>
      <h3 class="app-tile-title">${escapeHtml(app.name)}</h3>
      <p class="app-tile-desc">${escapeHtml(app.description || '')}</p>
      ${soon
        ? `<span class="app-tile-cta is-lock">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
             Ouverture prochaine
           </span>`
        : `<span class="app-tile-cta">
             Demander l'accès
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
           </span>`}
    `;

    const style = `--tile-color:${color}`;
    if (soon) {
      return `<article class="${cls.join(' ')}" style="${style}" aria-disabled="true">${inner}</article>`;
    }
    return `<a class="${cls.join(' ')}" style="${style}" href="/demande.html?app=${encodeURIComponent(app.id)}">${inner}</a>`;
  }

  function bindTilt() {
    const tiles = document.querySelectorAll('.app-tile');
    tiles.forEach((tile) => {
      let raf = null;
      tile.addEventListener('mousemove', (e) => {
        const rect = tile.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          tile.style.setProperty('--tilt-y', `${x * 8}deg`);
          tile.style.setProperty('--tilt-x', `${-y * 8}deg`);
        });
      });
      tile.addEventListener('mouseleave', () => {
        tile.style.setProperty('--tilt-x', '0deg');
        tile.style.setProperty('--tilt-y', '0deg');
      });
    });
  }
})();
