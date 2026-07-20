'use strict';

/*
 * Tableau de bord : liste des demandes, détail (payload + journal du robot),
 * relance des demandes en échec. Rafraîchissement automatique toutes les 4 s.
 */

(function () {
  const statsEl = document.getElementById('stats');
  const rowsEl = document.getElementById('rows');
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal-content');

  let requests = [];
  let openId = null;

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
      { label: 'Total', value: stats.total, color: 'var(--text)' },
      { label: 'En attente', value: stats.en_attente, color: 'var(--warning)' },
      { label: 'En cours', value: stats.en_cours, color: 'var(--primary)' },
      { label: 'Terminées', value: stats.terminee, color: 'var(--success)' },
      { label: 'Échecs', value: stats.echec, color: 'var(--danger)' },
    ];
    statsEl.innerHTML = tiles
      .map(
        (t) => `
        <div class="stat-tile">
          <div class="value" style="color:${t.color}">${t.value}</div>
          <div class="label">${t.label}</div>
        </div>`
      )
      .join('');
  }

  function requesterName(payload) {
    const nom = payload.nom || '';
    const prenom = payload.prenom || '';
    return `${prenom} ${nom}`.trim() || '—';
  }

  function renderRows() {
    if (requests.length === 0) {
      rowsEl.innerHTML = `<tr><td colspan="6" class="loading-placeholder">Aucune demande pour le moment.</td></tr>`;
      return;
    }
    rowsEl.innerHTML = requests
      .map(
        (r) => `
        <tr>
          <td><span class="ref">${escapeHtml(r.reference)}</span></td>
          <td>${escapeHtml(r.app)}</td>
          <td>${escapeHtml(requesterName(r.payload))}</td>
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

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <h3>Demande <span class="ref">${escapeHtml(req.reference)}</span></h3>
        ${statusBadge(req.status)}
      </div>
      <p style="color:var(--text-muted);font-size:0.9rem">
        ${escapeHtml(req.app)} — déposée le ${formatDate(req.createdAt)}
        ${req.finishedAt ? ` — traitée le ${formatDate(req.finishedAt)}` : ''}
        — ${req.attempts} tentative(s)
      </p>
      ${req.message ? `<p style="margin-top:8px"><strong>Résultat :</strong> ${escapeHtml(req.message)}</p>` : ''}
      <h4 style="margin-top:18px">Informations saisies</h4>
      <dl class="kv">${payloadRows}</dl>
      <h4 style="margin-bottom:8px">Journal du robot</h4>
      <div class="log-box">${logLines}</div>
      <div class="form-actions" style="justify-content:flex-end">
        <button class="btn btn-secondary" id="modal-close">Fermer</button>
      </div>`;

    modal.querySelector('#modal-close').addEventListener('click', closeModal);
  }

  refresh();
  setInterval(refresh, 4000);
})();
