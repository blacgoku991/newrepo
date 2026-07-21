'use strict';

/*
 * Suivi d'une demande : timeline d'avancement, rafraîchie automatiquement
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
    box.classList.add('show');
    try {
      const req = await fetchJson(`/api/requests/${encodeURIComponent(reference)}`);
      render(req);
      if (req.status === 'en_attente' || req.status === 'en_cours') {
        pollTimer = setTimeout(() => lookup(reference), 3000);
      }
    } catch (err) {
      box.innerHTML =
        err.status === 404
          ? `<div class="alert alert-error" style="margin:0">Aucune demande trouvée pour la référence <strong>${escapeHtml(reference)}</strong>. Vérifiez la saisie.</div>`
          : `<div class="alert alert-error" style="margin:0">${escapeHtml(err.message)}</div>`;
    }
  }

  function timelineHtml(req) {
    const processing = req.status === 'en_cours';
    const waiting = req.status === 'en_attente';
    const done = req.status === 'terminee';
    const failed = req.status === 'echec';

    const items = [
      {
        state: 'done',
        icon: 'inbox',
        title: 'Demande enregistrée',
        text: `Déposée le ${formatDate(req.createdAt)} — référence ${req.reference}`,
      },
      {
        state: processing ? 'current' : waiting ? '' : done || failed ? 'done' : '',
        icon: 'bot',
        title: processing ? 'Le robot crée le compte…' : waiting ? 'En file d’attente' : 'Traitement par le robot',
        text: processing
          ? `Connexion à ${req.app} et saisie de la fiche en cours.`
          : waiting
            ? 'Votre demande sera prise en charge dans quelques instants.'
            : `Le robot s'est connecté à ${req.app} et a saisi la fiche.`,
      },
      {
        state: done ? 'done' : failed ? 'failed' : '',
        icon: done ? 'check' : failed ? 'x' : 'flag',
        title: done ? 'Compte créé' : failed ? 'Échec de la création' : 'Confirmation',
        text: done
          ? `${req.message || 'Le compte a été créé avec succès.'} (${formatDate(req.finishedAt)})`
          : failed
            ? `${req.message || 'Le robot n’a pas pu créer le compte.'} — l'équipe support peut relancer la demande.`
            : 'Vous verrez ici la confirmation de création du compte.',
      },
    ];

    return `<div class="timeline">
      ${items
        .map(
          (item) => `
        <div class="tl ${item.state}">
          <div class="m"><span class="dot">${icon(item.icon)}</span><span class="line"></span></div>
          <div class="body"><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.text)}</p></div>
        </div>`
        )
        .join('')}
    </div>`;
  }

  function render(req) {
    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <h3 style="font-family:var(--ui);font-size:1.12rem;font-weight:650">Demande <span style="font-family:var(--mono)">${escapeHtml(req.reference)}</span></h3>
          <p style="color:var(--muted);font-size:0.88rem;margin-top:2px">${escapeHtml(req.app)}</p>
        </div>
        ${statusBadge(req.status)}
      </div>
      ${timelineHtml(req)}
      ${
        req.status === 'en_attente' || req.status === 'en_cours'
          ? '<p style="color:var(--faint);font-size:0.83rem">Cette page se met à jour automatiquement toutes les 3 secondes.</p>'
          : ''
      }`;
  }
})();
