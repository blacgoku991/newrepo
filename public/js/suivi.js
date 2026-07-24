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
        title: processing ? 'Création du compte en cours…' : waiting ? 'En file d’attente' : 'Traitement en cours',
        text: processing
          ? `Connexion à ${req.app} et saisie de la fiche en cours.`
          : waiting
            ? 'Votre demande sera prise en charge dans quelques instants.'
            : `Le compte a été renseigné dans ${req.app}.`,
      },
      {
        state: done ? 'done' : failed ? 'failed' : '',
        icon: done ? 'check' : failed ? 'x' : 'flag',
        title: done ? 'Compte créé' : failed ? 'Échec de la création' : 'Confirmation',
        text: done
          ? `${req.message || 'Le compte a été créé avec succès.'} (${formatDate(req.finishedAt)})`
          : failed
            ? `${req.message || 'Le compte n’a pas pu être créé.'} — l'équipe support peut relancer la demande.`
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

  function progressBarHtml(req) {
    const p = req.progress || {};
    if (req.status !== 'en_cours' && req.status !== 'en_attente') return '';
    const pct = req.status === 'en_attente' ? 0 : Math.min(100, Math.max(0, p.percent || 0));
    const stepInfo =
      req.status === 'en_attente'
        ? 'En file d’attente…'
        : p.total
          ? `Étape ${p.done} sur ${p.total}${p.label ? ' — ' + escapeHtml(p.label) : ''}`
          : 'Traitement en cours…';
    return `
      <div style="margin:18px 0 4px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="color:var(--muted);font-size:.86rem">${stepInfo}</span>
          <span style="font-family:var(--mono);font-weight:650;color:var(--gold-bright)">${pct}%</span>
        </div>
        <div style="height:9px;border-radius:99px;background:var(--surface-3);overflow:hidden;border:1px solid var(--line)">
          <div style="height:100%;width:${pct}%;border-radius:99px;background:linear-gradient(90deg,var(--gold-dark),var(--gold-bright));transition:width .5s ease"></div>
        </div>
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
      ${progressBarHtml(req)}
      ${timelineHtml(req)}
      ${
        req.status === 'terminee'
          ? `<div style="margin-top:6px;padding-top:18px;border-top:1px solid var(--line)">
               <button class="btn btn-primary" id="get-creds">${icon('check')} Récupérer les identifiants</button>
               <p style="color:var(--muted);font-size:0.83rem;margin-top:10px">Affichage sécurisé, une seule fois — réservé au demandeur ou au bénéficiaire.</p>
               <p id="creds-err" style="color:var(--danger);font-size:0.86rem;margin-top:8px"></p>
             </div>`
          : ''
      }
      ${
        req.status === 'en_attente' || req.status === 'en_cours'
          ? '<p style="color:var(--faint);font-size:0.83rem">Cette page se met à jour automatiquement toutes les 3 secondes.</p>'
          : ''
      }`;

    const credsBtn = document.getElementById('get-creds');
    if (credsBtn) {
      credsBtn.addEventListener('click', async () => {
        credsBtn.disabled = true;
        credsBtn.innerHTML = '<span class="spinner"></span> Préparation…';
        try {
          const out = await fetchJson(`/api/requests/${encodeURIComponent(req.reference)}/credentials-access`, { method: 'POST' });
          location.href = out.path;
        } catch (err) {
          document.getElementById('creds-err').textContent = err.message;
          credsBtn.disabled = false;
          credsBtn.textContent = 'Récupérer les identifiants';
        }
      });
    }
  }
})();
