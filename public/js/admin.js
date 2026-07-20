'use strict';

/*
 * Tableau de bord : recherche + filtres (statut, application), détail de
 * chaque demande (données saisies, journal du robot, captures d'écran),
 * relance des demandes en échec. Rafraîchissement automatique toutes les 4 s.
 */

(function () {
  const statsEl = document.getElementById('stats');
  const rowsEl = document.getElementById('rows');
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal-content');
  const searchInput = document.getElementById('search-input');
  const appFilter = document.getElementById('app-filter');
  const chips = document.getElementById('status-chips');

  let requests = [];
  let openId = null;
  const filters = { text: '', app: '', status: '' };

  searchInput.addEventListener('input', () => {
    filters.text = searchInput.value.trim().toLowerCase();
    renderRows();
  });
  appFilter.addEventListener('change', () => {
    filters.app = appFilter.value;
    renderRows();
  });
  chips.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    for (const c of chips.querySelectorAll('.chip')) c.classList.remove('on');
    chip.classList.add('on');
    filters.status = chip.dataset.status;
    renderRows();
  });

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });

  async function refresh() {
    try {
      const data = await fetchJson('/api/admin/requests');
      requests = data.requests;
      renderStats(data.stats);
      updateAppFilter();
      renderRows();
      if (openId != null) {
        const current = requests.find((r) => r.id === openId);
        if (current) renderModal(current);
      }
    } catch (err) {
      rowsEl.innerHTML = `<tr><td colspan="6"><div class="alert alert-error" style="margin:0">${escapeHtml(err.message)}</div></td></tr>`;
    }
  }

  function renderStats(stats) {
    const tiles = [
      { label: 'Demandes au total', value: stats.total, color: 'var(--ink)' },
      { label: 'En attente', value: stats.en_attente, color: 'var(--warning)' },
      { label: 'En cours', value: stats.en_cours, color: 'var(--info)' },
      { label: 'Terminées', value: stats.terminee, color: 'var(--success)' },
      { label: 'Échecs', value: stats.echec, color: 'var(--danger)' },
    ];
    statsEl.innerHTML = tiles
      .map(
        (t) => `
        <div class="stat-tile">
          <span class="value" style="color:${t.color}">${t.value}</span>
          <span class="label">${t.label}</span>
        </div>`
      )
      .join('');
  }

  function updateAppFilter() {
    const apps = [...new Map(requests.map((r) => [r.appId, r.app])).entries()];
    const currentValue = appFilter.value;
    appFilter.innerHTML =
      '<option value="">Toutes les applications</option>' +
      apps.map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join('');
    appFilter.value = currentValue;
  }

  function requesterName(payload) {
    return `${payload.prenom || ''} ${payload.nom || ''}`.trim() || '—';
  }

  function matches(r) {
    if (filters.status && r.status !== filters.status) return false;
    if (filters.app && r.appId !== filters.app) return false;
    if (filters.text) {
      const haystack = `${r.reference} ${requesterName(r.payload)} ${r.payload.email || ''} ${r.app}`.toLowerCase();
      if (!haystack.includes(filters.text)) return false;
    }
    return true;
  }

  function renderRows() {
    const visible = requests.filter(matches);
    if (visible.length === 0) {
      rowsEl.innerHTML = `<tr><td colspan="6" class="loading-placeholder">${requests.length === 0 ? 'Aucune demande pour le moment.' : 'Aucune demande ne correspond aux filtres.'}</td></tr>`;
      return;
    }
    rowsEl.innerHTML = visible
      .map(
        (r) => `
        <tr>
          <td><span class="ref">${escapeHtml(r.reference)}</span></td>
          <td>${escapeHtml(r.app)}</td>
          <td><span class="who">${escapeHtml(requesterName(r.payload))}<small>${escapeHtml(r.payload.email || '')}</small></span></td>
          <td>${formatDate(r.createdAt)}</td>
          <td>${statusBadge(r.status)}</td>
          <td style="text-align:right;white-space:nowrap">
            ${r.status === 'echec' ? `<button class="btn btn-secondary btn-sm" data-retry="${r.id}">Relancer</button> ` : ''}
            <button class="btn btn-secondary btn-sm" data-detail="${r.id}">Détail</button>
          </td>
        </tr>`
      )
      .join('');

    for (const btn of rowsEl.querySelectorAll('[data-detail]')) {
      btn.addEventListener('click', () => openModal(Number(btn.dataset.detail)));
    }
    for (const btn of rowsEl.querySelectorAll('[data-retry]')) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await fetchJson(`/api/admin/requests/${btn.dataset.retry}/retry`, { method: 'POST' });
          refresh();
        } catch (err) {
          alert(err.message);
          btn.disabled = false;
        }
      });
    }
  }

  function openModal(id) {
    const req = requests.find((r) => r.id === id);
    if (!req) return;
    openId = id;
    renderModal(req);
    backdrop.classList.add('visible');
  }

  function closeModal() {
    openId = null;
    backdrop.classList.remove('visible');
  }

  function renderModal(req) {
    const payloadRows = Object.entries(req.payload)
      .map(([key, value]) => {
        const display = Array.isArray(value) ? value.join(', ') : value;
        return `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(display || '—')}</dd>`;
      })
      .join('');

    const logLines =
      req.logs.length > 0
        ? req.logs
            .map(
              (l) =>
                `<span class="t">${new Date(l.at).toLocaleTimeString('fr-FR')}</span>  ${escapeHtml(l.message)}`
            )
            .join('\n')
        : 'Aucune activité du robot pour le moment.';

    const shots =
      req.artifacts && req.artifacts.length > 0
        ? `<h4>Captures d'écran du robot</h4>
           <div class="shots">
             ${req.artifacts
               .map((file) => {
                 const url = `/artifacts/${encodeURIComponent(req.reference)}/${encodeURIComponent(file)}`;
                 return `<a href="${url}" target="_blank" rel="noopener">
                   <img src="${url}" alt="${escapeHtml(file)}" loading="lazy" />
                   <span class="cap">${escapeHtml(file)}</span>
                 </a>`;
               })
               .join('')}
           </div>`
        : '';

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <h3>Demande <span class="ref" style="font-family:var(--mono)">${escapeHtml(req.reference)}</span></h3>
        ${statusBadge(req.status)}
      </div>
      <p style="color:var(--muted);font-size:0.88rem;margin-top:4px">
        ${escapeHtml(req.app)} — déposée le ${formatDate(req.createdAt)}
        ${req.finishedAt ? ` — traitée le ${formatDate(req.finishedAt)}` : ''}
        — ${req.attempts} tentative(s)
      </p>
      ${req.message ? `<p style="margin-top:10px;font-size:0.92rem"><strong>Résultat :</strong> ${escapeHtml(req.message)}</p>` : ''}
      <h4>Informations saisies</h4>
      <dl class="kv">${payloadRows}</dl>
      <h4>Journal du robot</h4>
      <div class="log-box">${logLines}</div>
      ${shots}
      <div class="form-nav" style="justify-content:flex-end;border:none;padding-top:16px;margin-top:8px">
        ${req.status === 'echec' ? `<button class="btn btn-secondary" id="modal-retry">Relancer la demande</button>` : ''}
        <button class="btn btn-primary" id="modal-close">Fermer</button>
      </div>`;

    modal.querySelector('#modal-close').addEventListener('click', closeModal);
    const retryBtn = modal.querySelector('#modal-retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', async () => {
        retryBtn.disabled = true;
        try {
          await fetchJson(`/api/admin/requests/${req.id}/retry`, { method: 'POST' });
          refresh();
        } catch (err) {
          alert(err.message);
          retryBtn.disabled = false;
        }
      });
    }
  }

  refresh();
  setInterval(refresh, 4000);
})();
