'use strict';

/*
 * Tableau de bord d'administration (protégé par session).
 * Deux vues : « Vue d'ensemble » (stats + graphiques) et « Demandes » (table).
 * Rafraîchissement automatique toutes les 5 s.
 */

(function () {
  // --- Garde d'authentification --------------------------------------------
  let me = null;

  async function boot() {
    try {
      const r = await fetch('/api/auth/me');
      if (!r.ok) throw new Error('unauth');
      me = (await r.json()).user;
    } catch {
      location.href = '/login.html?next=' + encodeURIComponent('/admin.html');
      return;
    }
    setup();
  }

  // --- Éléments -------------------------------------------------------------
  const el = (id) => document.getElementById(id);
  const backdrop = el('backdrop');
  const modal = el('modal');

  let requests = [];
  let openId = null;
  const filters = { text: '', app: '', status: '' };

  function setup() {
    // Barre latérale
    el('nav-overview').innerHTML = `${icon('grid')} Vue d'ensemble`;
    el('nav-requests').innerHTML = `${icon('list')} Demandes`;
    document.querySelector('.side nav a[target="_blank"]').innerHTML = `${icon('eye')} Voir le site public`;
    el('logout').innerHTML = icon('logout');
    el('who-name').textContent = me.displayName || me.username;
    el('who-av').textContent = (me.displayName || me.username || '?').charAt(0).toUpperCase();

    el('logout').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      location.href = '/login.html';
    });

    // Navigation entre vues
    for (const a of document.querySelectorAll('.side nav a[data-view]')) {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        showView(a.dataset.view);
      });
    }
    showView(location.hash.replace('#', '') || 'overview');

    // Filtres table
    el('search').addEventListener('input', () => {
      filters.text = el('search').value.trim().toLowerCase();
      renderRows();
    });
    el('app-filter').addEventListener('change', () => {
      filters.app = el('app-filter').value;
      renderRows();
    });
    el('chips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      for (const c of el('chips').querySelectorAll('.chip')) c.classList.remove('on');
      chip.classList.add('on');
      filters.status = chip.dataset.status;
      renderRows();
    });

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    refresh();
    setInterval(refresh, 5000);
  }

  const VIEW_META = {
    overview: { h1: "Vue d'ensemble", sub: 'Statistiques de création de comptes' },
    requests: { h1: 'Demandes', sub: 'Toutes les demandes et leur traitement' },
  };

  function showView(view) {
    if (!VIEW_META[view]) view = 'overview';
    for (const s of document.querySelectorAll('.view')) s.classList.remove('on');
    el('view-' + view).classList.add('on');
    for (const a of document.querySelectorAll('.side nav a[data-view]')) {
      a.classList.toggle('active', a.dataset.view === view);
    }
    el('page-h1').textContent = VIEW_META[view].h1;
    el('page-sub').textContent = VIEW_META[view].sub;
    history.replaceState(null, '', '#' + view);
  }

  // --- Rafraîchissement -----------------------------------------------------
  async function refresh() {
    try {
      const [stats, data] = await Promise.all([
        fetchJson('/api/admin/stats'),
        fetchJson('/api/admin/requests'),
      ]);
      renderStats(stats);
      requests = data.requests;
      updateAppFilter();
      renderRows();
      if (openId != null) {
        const cur = requests.find((r) => r.id === openId);
        if (cur) renderModal(cur);
      }
    } catch (err) {
      if (err.status === 401) return (location.href = '/login.html');
    }
  }

  // --- Vue d'ensemble : KPIs + graphiques -----------------------------------
  function renderStats(s) {
    const k = s.kpis;
    const tiles = [
      { cls: 'k-ok', ic: 'check', v: k.crees, l: 'Comptes créés' },
      { cls: 'k-total', ic: 'inbox', v: k.total, l: 'Demandes au total' },
      { cls: 'k-info', ic: 'trend', v: k.tauxReussite + '%', l: 'Taux de réussite' },
      { cls: 'k-warn', ic: 'clock', v: k.en_attente + k.en_cours, l: 'En cours / en attente' },
      { cls: 'k-danger', ic: 'x', v: k.echec, l: 'Échecs' },
    ];
    el('kpis').innerHTML = tiles
      .map(
        (t) => `<div class="kpi ${t.cls}">
          <div class="ic">${icon(t.ic)}</div>
          <div class="v">${t.v}</div>
          <div class="l">${t.l}</div>
        </div>`
      )
      .join('');

    el('chart-serie').innerHTML = areaChart(s.serie);
    el('chart-apps').innerHTML = appBars(s.parApplication);
    el('chart-demandeur').innerHTML = barChart(s.parDemandeur, { color: CHART.terra, empty: 'Aucun compte créé pour le moment.' });
    el('chart-etab').innerHTML = barChart(s.parEtablissement, { color: CHART.pine, empty: 'Aucun établissement encore.' });
    el('chart-fonction').innerHTML = barChart(s.parFonction, { color: CHART.gold, empty: 'Aucune fonction encore.' });
  }

  function requesterName(payload) {
    return `${payload.prenom || ''} ${payload.nom || ''}`.trim() || '—';
  }

  function renderRecent() {
    const recent = requests.slice(0, 6);
    if (recent.length === 0) return (el('recent').innerHTML = '<div class="empty">Aucune demande.</div>');
    el('recent').innerHTML = recent
      .map(
        (r) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)">
          <div style="min-width:0">
            <div style="font-weight:600;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(requesterName(r.payload))}</div>
            <div style="font-size:0.78rem;color:var(--muted)">${escapeHtml(r.app)} · ${formatDate(r.createdAt)}</div>
          </div>
          ${statusBadge(r.status)}
        </div>`
      )
      .join('');
  }

  // --- Vue Demandes : table -------------------------------------------------
  function updateAppFilter() {
    const apps = [...new Map(requests.map((r) => [r.appId, r.app])).entries()];
    const cur = el('app-filter').value;
    el('app-filter').innerHTML =
      '<option value="">Toutes les applications</option>' +
      apps.map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join('');
    el('app-filter').value = cur;
  }

  function matches(r) {
    if (filters.status && r.status !== filters.status) return false;
    if (filters.app && r.appId !== filters.app) return false;
    if (filters.text) {
      const hay = `${r.reference} ${requesterName(r.payload)} ${r.payload.email || ''} ${r.demandeur || ''} ${r.app}`.toLowerCase();
      if (!hay.includes(filters.text)) return false;
    }
    return true;
  }

  function renderRows() {
    renderRecent();
    const visible = requests.filter(matches);
    if (visible.length === 0) {
      el('rows').innerHTML = `<tr><td colspan="7" class="loading">${requests.length === 0 ? 'Aucune demande pour le moment.' : 'Aucune demande ne correspond aux filtres.'}</td></tr>`;
      return;
    }
    el('rows').innerHTML = visible
      .map(
        (r) => `<tr>
          <td><span class="ref">${escapeHtml(r.reference)}</span></td>
          <td>${escapeHtml(r.app)}</td>
          <td><span class="who2">${escapeHtml(requesterName(r.payload))}<small>${escapeHtml(r.payload.email || '')}</small></span></td>
          <td>${escapeHtml(r.demandeur || '—')}</td>
          <td>${formatDate(r.createdAt)}</td>
          <td>${statusBadge(r.status)}</td>
          <td style="text-align:right;white-space:nowrap">
            ${r.status === 'echec' ? `<button class="btn btn-ghost btn-sm" data-retry="${r.id}">Relancer</button> ` : ''}
            <button class="btn btn-ghost btn-sm" data-detail="${r.id}">Détail</button>
          </td>
        </tr>`
      )
      .join('');

    for (const b of el('rows').querySelectorAll('[data-detail]')) {
      b.addEventListener('click', () => openModal(Number(b.dataset.detail)));
    }
    for (const b of el('rows').querySelectorAll('[data-retry]')) {
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { await fetchJson(`/api/admin/requests/${b.dataset.retry}/retry`, { method: 'POST' }); refresh(); }
        catch (e) { alert(e.message); b.disabled = false; }
      });
    }
  }

  function openModal(id) {
    const r = requests.find((x) => x.id === id);
    if (!r) return;
    openId = id;
    renderModal(r);
    backdrop.classList.add('show');
  }
  function closeModal() { openId = null; backdrop.classList.remove('show'); }

  function renderModal(r) {
    const payloadRows = Object.entries(r.payload)
      .map(([key, value]) => {
        const label = key.startsWith('_demandeur_') ? key.replace('_demandeur_', 'demandeur ') : key;
        const disp = Array.isArray(value) ? value.join(', ') : value;
        return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(disp || '—')}</dd>`;
      })
      .join('');

    const logs = r.logs.length
      ? r.logs.map((l) => `<span class="t">${new Date(l.at).toLocaleTimeString('fr-FR')}</span>  ${escapeHtml(l.message)}`).join('\n')
      : 'Aucune activité du robot pour le moment.';

    const shots = r.artifacts && r.artifacts.length
      ? `<h4>Captures d'écran du robot</h4><div class="shots">${r.artifacts
          .map((f) => {
            const url = `/artifacts/${encodeURIComponent(r.reference)}/${encodeURIComponent(f)}`;
            return `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${escapeHtml(f)}" loading="lazy"/><span class="cap">${escapeHtml(f)}</span></a>`;
          })
          .join('')}</div>`
      : '';

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <h3>Demande <span class="ref">${escapeHtml(r.reference)}</span></h3>
        ${statusBadge(r.status)}
      </div>
      <p style="color:var(--muted);font-size:0.87rem;margin-top:4px">
        ${escapeHtml(r.app)} — déposée le ${formatDate(r.createdAt)}${r.finishedAt ? ' — traitée le ' + formatDate(r.finishedAt) : ''} — ${r.attempts} tentative(s)
        ${r.demandeur ? ' — demandeur : ' + escapeHtml(r.demandeur) : ''}
      </p>
      ${r.message ? `<p style="margin-top:10px;font-size:0.92rem"><strong>Résultat :</strong> ${escapeHtml(r.message)}</p>` : ''}
      <h4>Informations saisies</h4>
      <dl class="kv">${payloadRows}</dl>
      <h4>Journal du robot</h4>
      <div class="logbox">${logs}</div>
      ${shots}
      <div class="form-nav" style="justify-content:flex-end;border:none;padding-top:16px;margin-top:8px">
        ${r.status === 'echec' ? `<button class="btn btn-ghost" id="m-retry">Relancer la demande</button>` : ''}
        <button class="btn btn-primary" id="m-close">Fermer</button>
      </div>`;

    modal.querySelector('#m-close').addEventListener('click', closeModal);
    const rt = modal.querySelector('#m-retry');
    if (rt) rt.addEventListener('click', async () => {
      rt.disabled = true;
      try { await fetchJson(`/api/admin/requests/${r.id}/retry`, { method: 'POST' }); refresh(); }
      catch (e) { alert(e.message); rt.disabled = false; }
    });
  }

  boot();
})();
