'use strict';

/*
 * Suivi d'une demande par référence, avec rafraîchissement automatique
 * tant que la demande n'est pas dans un état final.
 */

(function () {
  const form = document.getElementById('track-form');
  const input = document.getElementById('ref-input');
  const box = document.getElementById('track-result');
  let pollTimer = null;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const ref = input.value.trim().toUpperCase();
    if (ref) lookup(ref);
  });

  const initialRef = new URLSearchParams(location.search).get('ref');
  if (initialRef) {
    input.value = initialRef.toUpperCase();
    lookup(initialRef.toUpperCase());
  }

  async function lookup(reference) {
    clearTimeout(pollTimer);
    box.classList.add('visible');
    try {
      const req = await fetchJson(`/api/requests/${encodeURIComponent(reference)}`);
      render(req);
      // Tant que le robot travaille, on rafraîchit toutes les 3 secondes.
      if (req.status === 'en_attente' || req.status === 'en_cours') {
        pollTimer = setTimeout(() => lookup(reference), 3000);
      }
    } catch (err) {
      box.innerHTML =
        err.status === 404
          ? `<div class="alert alert-error" style="margin:0">Aucune demande trouvée pour la référence <strong>${escapeHtml(reference)}</strong>.</div>`
          : `<div class="alert alert-error" style="margin:0">${escapeHtml(err.message)}</div>`;
    }
  }

  function render(req) {
    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <h3 style="font-size:1.1rem">Demande <span class="ref" style="font-family:ui-monospace,monospace">${escapeHtml(req.reference)}</span></h3>
        ${statusBadge(req.status)}
      </div>
      <dl>
        <dt>Application</dt><dd>${escapeHtml(req.app)}</dd>
        <dt>Déposée le</dt><dd>${formatDate(req.createdAt)}</dd>
        ${req.finishedAt ? `<dt>Traitée le</dt><dd>${formatDate(req.finishedAt)}</dd>` : ''}
        ${req.message ? `<dt>Résultat</dt><dd>${escapeHtml(req.message)}</dd>` : ''}
      </dl>
      ${
        req.status === 'en_attente' || req.status === 'en_cours'
          ? '<p style="margin-top:14px;color:var(--text-muted);font-size:0.85rem">Cette page se met à jour automatiquement…</p>'
          : ''
      }`;
  }
})();
