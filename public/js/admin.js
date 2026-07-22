'use strict';

/*
 * Tableau de bord d'administration (session requise).
 * Deux vues : « Vue d'ensemble » (KPIs + graphiques) et « Demandes » (table
 * filtrable + détail avec journal du robot, captures d'écran et relance).
 * Rafraîchissement automatique toutes les 5 secondes.
 */

(function () {
  const el = (id) => document.getElementById(id);
  const backdrop = el('backdrop');
  const modal = el('modal');

  let me = null;
  let requests = [];
  let openId = null;
  const filters = { text: '', app: '', status: '' };

  // --- Garde d'authentification --------------------------------------------
  boot();

  async function boot() {
    try {
      me = (await fetchJson('/api/auth/me')).user;
    } catch {
      location.href = '/login.html';
      return;
    }
    setup();
  }

  function setup() {
    el('who').textContent = me.displayName || me.username;

    el('logout-link').addEventListener('click', async (e) => {
      e.preventDefault();
      await fetchJson('/api/auth/logout', { method: 'POST' }).catch(() => null);
      location.href = '/login.html';
    });

    el('nav-overview').addEventListener('click', (e) => { e.preventDefault(); showView('overview'); });
    el('nav-requests').addEventListener('click', (e) => { e.preventDefault(); showView('requests'); });
    showView(location.hash === '#requests' ? 'requests' : 'overview');

    el('search').addEventListener('input', () => { filters.text = el('search').value.trim().toLowerCase(); renderRows(); });
    el('app-filter').addEventListener('change', () => { filters.app = el('app-filter').value; renderRows(); });
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

  const VIEWS = {
    overview: { h1: "Vue d'ensemble", sub: 'Statistiques de création de comptes — qui, combien, où.' },
    requests: { h1: 'Demandes', sub: 'Toutes les demandes et leur traitement par le robot.' },
  };

  function showView(view) {
    el('view-overview').style.display = view === 'overview' ? '' : 'none';
    el('view-requests').style.display = view === 'requests' ? '' : 'none';
    el('nav-overview').classList.toggle('active', view === 'overview');
    el('nav-requests').classList.toggle('active', view === 'requests');
    el('page-h1').textContent = VIEWS[view].h1;
    el('page-sub').textContent = VIEWS[view].sub;
    history.replaceState(null, '', '#' + view);
  }

  // --- Données --------------------------------------------------------------
  async function refresh() {
    try {
      const [stats, data] = await Promise.all([
        fetchJson('/api/admin/stats'),
        fetchJson('/api/admin/requests'),
      ]);
      renderStats(stats);
      requests = data.requests || [];
      updateAppFilter();
      renderRows();
      if (openId != null) {
        const cur = requests.find((r) => r.id === openId);
        if (cur) renderModal(cur);
      }
    } catch (err) {
      if (err.status === 401) location.href = '/login.html';
    }
  }

  // --- Vue d'ensemble -------------------------------------------------------
  function renderStats(s) {
    const k = s.kpis || {};
    const tiles = [
      { cls: 'k-ok', ic: 'check', v: k.crees ?? 0, l: 'Comptes créés' },
      { cls: 'k-total', ic: 'inbox', v: k.total ?? 0, l: 'Demandes au total' },
      { cls: 'k-info', ic: 'trend', v: (k.tauxReussite ?? 0) + '%', l: 'Taux de réussite' },
      { cls: 'k-warn', ic: 'clock', v: (k.en_attente ?? 0) + (k.en_cours ?? 0), l: 'En cours · attente' },
      { cls: 'k-danger', ic: 'x', v: k.echec ?? 0, l: 'Échecs' },
    ];
    el('kpis').innerHTML = tiles
      .map((t) => `<div class="kpi ${t.cls}"><div class="ic">${icon(t.ic)}</div><div class="v">${t.v}</div><div class="l">${t.l}</div></div>`)
      .join('');

    el('chart-serie').innerHTML = areaChart(s.serie || []);
    el('chart-apps').innerHTML = appBars(s.parApplication || []);
    el('chart-demandeur').innerHTML = barChart(s.parDemandeur || [], { color: CHART.terra, empty: 'Aucun compte créé pour le moment.' });
    el('chart-etab').innerHTML = barChart(s.parEtablissement || [], { color: CHART.pine, empty: 'Aucun établissement encore.' });
    el('chart-fonction').innerHTML = barChart(s.parFonction || [], { color: CHART.gold, empty: 'Aucune fonction encore.' });
  }

  function requesterName(payload = {}) {
    return `${payload.prenom || ''} ${payload.nom || ''}`.trim() || '—';
  }

  function renderRecent() {
    const recent = requests.slice(0, 6);
    el('recent').innerHTML = recent.length
      ? recent
          .map(
            (r) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)">
              <div style="min-width:0">
                <div style="color:#fff;font-weight:500;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(requesterName(r.payload))}</div>
                <div style="font-size:.76rem;color:var(--text-mute)">${escapeHtml(r.app)} · ${formatDate(r.createdAt)}</div>
              </div>
              ${statusBadge(r.status)}
            </div>`
          )
          .join('')
      : '<div class="empty">Aucune demande.</div>';
  }

  // --- Vue Demandes ---------------------------------------------------------
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
      const hay = `${r.reference} ${requesterName(r.payload)} ${r.payload?.email || ''} ${r.demandeur || ''} ${r.app}`.toLowerCase();
      if (!hay.includes(filters.text)) return false;
    }
    return true;
  }

  function renderRows() {
    renderRecent();
    const visible = requests.filter(matches);
    if (!visible.length) {
      el('rows').innerHTML = `<tr><td colspan="7" class="loading">${requests.length ? 'Aucune demande ne correspond aux filtres.' : 'Aucune demande pour le moment.'}</td></tr>`;
      return;
    }
    el('rows').innerHTML = visible
      .map(
        (r) => `<tr>
          <td><span class="ref">${escapeHtml(r.reference)}</span></td>
          <td>${escapeHtml(r.app)}</td>
          <td><span class="who">${escapeHtml(requesterName(r.payload))}<small>${escapeHtml(r.payload?.email || '')}</small></span></td>
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

  // --- Modale de détail -----------------------------------------------------
  function openModal(id) {
    const r = requests.find((x) => x.id === id);
    if (!r) return;
    openId = id;
    renderModal(r);
    backdrop.classList.add('show');
  }
  function closeModal() { openId = null; backdrop.classList.remove('show'); }

  function renderModal(r) {
    const payloadRows = Object.entries(r.payload || {})
      .map(([key, value]) => {
        const label = key.startsWith('_demandeur_') ? key.replace('_demandeur_', 'demandeur ') : key;
        const disp = Array.isArray(value) ? value.join(', ') : value;
        return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(disp || '—')}</dd>`;
      })
      .join('');

    const logs = (r.logs || []).length
      ? r.logs.map((l) => `<span class="t">${new Date(l.at).toLocaleTimeString('fr-FR')}</span>  ${escapeHtml(l.message)}`).join('\n')
      : 'Aucune activité du robot pour le moment.';

    const shots = (r.artifacts || []).length
      ? `<h4>Captures d'écran du robot</h4><div class="shots">${r.artifacts
          .map((f) => {
            const url = `/artifacts/${encodeURIComponent(r.reference)}/${encodeURIComponent(f)}`;
            return `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${escapeHtml(f)}" loading="lazy"/><span class="cap">${escapeHtml(f)}</span></a>`;
          })
          .join('')}</div>`
      : '';

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <h3>Demande <span class="ref" style="font-family:'JetBrains Mono',monospace;color:var(--cyan-2)">${escapeHtml(r.reference)}</span></h3>
        ${statusBadge(r.status)}
      </div>
      <p style="color:var(--text-mute);font-size:.85rem;margin-top:6px">
        ${escapeHtml(r.app)} — déposée le ${formatDate(r.createdAt)}${r.finishedAt ? ' — traitée le ' + formatDate(r.finishedAt) : ''} — ${r.attempts} tentative(s)
        ${r.demandeur ? ' — demandeur : ' + escapeHtml(r.demandeur) : ''}
      </p>
      ${r.message ? `<p style="margin-top:10px;font-size:.9rem;color:var(--text-dim)"><strong style="color:#fff">Résultat :</strong> ${escapeHtml(r.message)}</p>` : ''}
      <h4>Informations saisies</h4>
      <dl class="kv">${payloadRows}</dl>
      <h4>Journal du robot</h4>
      <div class="logbox">${logs}</div>
      ${shots}
      <div class="form-nav" style="justify-content:flex-end;border:none;padding-top:16px;margin-top:8px;display:flex;gap:10px">
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
})();
