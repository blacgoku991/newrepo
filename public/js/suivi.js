'use strict';

/*
 * Suivi d'une demande : timeline d'avancement, rafraîchie automatiquement
 * tant que la demande n'est pas dans un état final.
 */

(function () {
  const form = document.getElementById('track-form');
  const input = document.getElementById('ref-input');
  const box = document.getElementById('track-result');
  const detail = document.getElementById('track-detail');
  const listeBox = document.getElementById('mes-demandes');
  let pollTimer = null;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const ref = input.value.trim().toUpperCase();
    if (ref) location.href = `/suivi.html?ref=${encodeURIComponent(ref)}`;
  });

  // Avec une référence : le détail de CETTE demande. Sans : la liste de mes
  // demandes (une page = un rôle ; « Mon espace » sert, lui, à agir).
  const initialRef = new URLSearchParams(location.search).get('ref');
  if (initialRef) {
    detail.hidden = false;
    listeBox.hidden = true;
    input.value = initialRef.toUpperCase();
    lookup(initialRef.toUpperCase());
  } else {
    chargerMesDemandes();
  }

  // -------------------------------------------------------------------------
  // « Mes demandes » : toutes les demandes déposées sur les établissements dont
  // je suis référent (pas seulement les miennes) — si un collègue référent du
  // même établissement a déjà demandé la réinitialisation, je le vois au lieu
  // de la refaire. Onglets par application, recherche et pagination, comme les
  // comptes de « Mon espace ».
  // -------------------------------------------------------------------------
  const PAGE_SIZE = 15;
  const L = { demandes: [], apps: new Map(), tabs: [], view: '', query: '', page: 1 };

  async function chargerMesDemandes() {
    const vue = document.getElementById('dm-view');
    let data;
    try {
      // `?vue=demandes` : le registre des comptes n'est pas nécessaire ici.
      data = await fetchJson('/api/espace/me?vue=demandes');
    } catch (err) {
      vue.innerHTML = `<div class="alert alert-error" style="margin:0">${escapeHtml(err.message)}</div>`;
      return;
    }
    if (!data.referent) {
      vue.innerHTML = `<div class="empty-box">Votre compte n'est pas référent : seule la recherche par référence est disponible.</div>`;
      document.getElementById('dm-tabs').innerHTML = '';
      document.getElementById('dm-search').closest('.esp-search').hidden = true;
      return;
    }
    L.demandes = data.activity || [];
    L.apps = new Map((data.apps || []).map((a) => [a.appId, a]));
    // Un onglet par application concernée + « Toutes ».
    const presentes = [...new Set(L.demandes.map((d) => d.appId))];
    L.tabs = [{ key: '', label: 'Toutes', visual: icon('list') }].concat(
      presentes.map((appId) => {
        const app = L.apps.get(appId);
        return { key: appId, label: app ? app.name : appId, visual: app ? appVisual(app) : icon('grid') };
      })
    );
    L.view = '';
    const recherche = document.getElementById('dm-search');
    recherche.addEventListener('input', () => {
      L.query = recherche.value.trim().toLowerCase();
      L.page = 1;
      dessinerListe();
    });
    dessinerListe();
  }

  function listeCourante() {
    const q = L.query;
    return L.demandes.filter((d) => {
      if (L.view && d.appId !== L.view) return false;
      if (!q) return true;
      return [d.reference, d.who, d.login, d.etablissementLabel, d.etablissement, demarcheLabel(d.type)]
        .some((v) => (v || '').toLowerCase().includes(q));
    });
  }

  function demandesTable(rows) {
    return `<div class="tablecard"><table class="data">
      <thead><tr><th>Référence</th><th>Application</th><th>Démarche</th><th>Bénéficiaire</th><th>Identifiant</th><th>Établissement</th><th>Déposée le</th><th>Statut</th></tr></thead>
      <tbody>${rows.map((d) => `<tr>
        <td data-label="Référence"><a class="ref" href="/suivi.html?ref=${encodeURIComponent(d.reference)}">${escapeHtml(d.reference)}</a></td>
        <td data-label="Application">${escapeHtml(d.app || '—')}</td>
        <td data-label="Démarche">${escapeHtml(demarcheLabel(d.type))}</td>
        <td data-label="Bénéficiaire">${escapeHtml(d.who || '—')}</td>
        <td data-label="Identifiant">${d.login ? `<span class="ref">${escapeHtml(d.login)}</span>` : '—'}</td>
        <td data-label="Établissement">${d.etablissement ? `<code class="etab-code">${escapeHtml(d.etablissement)}</code> ` : ''}${escapeHtml(d.etablissementLabel || '—')}</td>
        <td data-label="Déposée le">${formatDate(d.createdAt)}</td>
        <td data-label="Statut">${statusBadge(d.status)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  function dessinerListe() {
    const check = '<svg class="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    const onglets = document.getElementById('dm-tabs');
    onglets.innerHTML = `<div class="app-switch" role="tablist">
      ${L.tabs.map((t) => {
        const on = t.key === L.view;
        return `<button type="button" class="app-opt${on ? ' on' : ''}" role="tab" aria-selected="${on}" data-key="${escapeHtml(t.key)}">
          <span class="lg">${t.visual}</span><span class="nm">${escapeHtml(t.label)}</span>${on ? check : ''}
        </button>`;
      }).join('')}
    </div>`;
    for (const b of onglets.querySelectorAll('.app-opt')) {
      b.addEventListener('click', () => { L.view = b.dataset.key; L.page = 1; dessinerListe(); });
    }

    const liste = listeCourante();
    const total = liste.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (L.page > pages) L.page = pages;
    const debut = (L.page - 1) * PAGE_SIZE;
    const tranche = liste.slice(debut, debut + PAGE_SIZE);

    const vue = document.getElementById('dm-view');
    if (!total) {
      vue.innerHTML = L.query
        ? `<div class="empty-box">Aucun résultat pour « ${escapeHtml(L.query)} ».</div>`
        : `<div class="empty-box">Aucune demande sur vos établissements pour le moment.<br /><a href="/espace">Faire une demande →</a></div>`;
      return;
    }
    vue.innerHTML =
      demandesTable(tranche) +
      pagerHtml(L.page, pages, debut + 1, debut + tranche.length, total, total > 1 ? 'demandes' : 'demande');
    bindPager(vue, L.page, pages, (p) => { L.page = p; dessinerListe(); });
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
    // Intitulés propres à la démarche (création, réinitialisation, transfert…),
    // fournis par le serveur : le suivi d'une mise à jour ne doit pas annoncer
    // la création d'un compte.
    const T = (req.demarche && req.demarche.suivi) || {};

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
        title: processing ? T.encours || 'Traitement en cours…' : waiting ? 'En file d’attente' : 'Traitement en cours',
        text: processing
          ? T.encoursDetail || `Connexion à ${req.app} en cours.`
          : waiting
            ? 'Votre demande sera prise en charge dans quelques instants.'
            : T.traite || `La fiche a été mise à jour dans ${req.app}.`,
      },
      {
        state: done ? 'done' : failed ? 'failed' : '',
        icon: done ? 'check' : failed ? 'x' : 'flag',
        title: done ? T.termine || 'Demande traitée' : failed ? T.echoue || 'Échec du traitement' : 'Confirmation',
        text: done
          ? `${req.message || T.reussi || ''} (${formatDate(req.finishedAt)})`.trim()
          : failed
            ? `${req.message || T.echecDetail || ''} — l'équipe support peut relancer la demande.`.trim()
            : T.attente || 'Vous verrez ici la confirmation du traitement.',
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
        // Le bouton n'a de sens que si un mot de passe a été remis (création,
        // réinitialisation). Une correction d'identité ou un transfert ne
        // produit aucun identifiant à récupérer.
        req.status === 'terminee' && req.credentials
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
