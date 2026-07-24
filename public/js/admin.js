'use strict';

/*
 * Panel d'administration (session requise).
 * Vues : Vue d'ensemble, Demandes, E-mails, Formulaires (éditeur),
 * Scénarios (éditeur), Comptes, Réglages.
 */

(function () {
  const el = (id) => document.getElementById(id);
  const backdrop = el('backdrop');
  const modal = el('modal');
  const toastEl = el('toast');

  let me = null;
  let requests = [];
  let openId = null;
  const filters = { text: '', app: '', status: '' };
  let refreshTimer = null;

  // --- Démarrage / auth -----------------------------------------------------
  boot();
  async function boot() {
    try { me = (await fetchJson('/api/auth/me')).user; }
    catch { location.href = '/login.html'; return; }
    setup();
  }

  function toast(msg, isErr) {
    toastEl.textContent = msg;
    toastEl.className = 'toast show' + (isErr ? ' err' : '');
    setTimeout(() => (toastEl.className = 'toast'), 2600);
  }

  const NAV = {
    overview: { ic: 'grid', label: "Vue d'ensemble", h1: "Vue d'ensemble", sub: 'Statistiques de création de comptes' },
    requests: { ic: 'list', label: 'Demandes', h1: 'Demandes', sub: 'Toutes les demandes et leur traitement' },
    accounts: { ic: 'users', label: 'Comptes créés', h1: 'Comptes créés', sub: 'Identifiants attribués par le robot' },
    emails: { ic: 'inbox', label: 'E-mails', h1: "E-mails d'identifiants", sub: "Boîte d'envoi des identifiants de connexion" },
    forms: { ic: 'briefcase', label: 'Formulaires', h1: 'Éditeur de formulaires', sub: 'Champs demandés pour chaque application' },
    scenarios: { ic: 'bot', label: 'Scénarios robot', h1: 'Éditeur de scénarios', sub: 'Étapes du robot pour chaque application' },
    users: { ic: 'users', label: 'Comptes admin', h1: 'Comptes administrateurs', sub: 'Accès à cet espace' },
    settings: { ic: 'lock', label: 'Réglages', h1: 'Réglages', sub: 'Mode du robot, e-mail, configuration' },
    journal: { ic: 'list', label: "Journal d'activité", h1: "Journal d'activité", sub: 'Toutes les modifications faites dans l\'admin' },
  };

  function setup() {
    for (const [key, meta] of Object.entries(NAV)) {
      el('nav-' + key).innerHTML = `${icon(meta.ic)} ${meta.label}`;
    }
    el('nav-site').innerHTML = `${icon('eye')} Voir le site public`;
    el('logout').innerHTML = icon('logout');
    el('who-name').textContent = me.displayName || me.username;
    el('who-av').textContent = (me.displayName || me.username || '?').charAt(0).toUpperCase();
    el('logout').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/login.html'; });

    for (const a of document.querySelectorAll('.side nav a[data-view]')) {
      a.addEventListener('click', (e) => { e.preventDefault(); showView(a.dataset.view); });
    }

    el('search').addEventListener('input', () => { filters.text = el('search').value.trim().toLowerCase(); renderRows(); });
    el('app-filter').addEventListener('change', () => { filters.app = el('app-filter').value; renderRows(); });
    el('chips').addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); if (!c) return;
      for (const x of el('chips').querySelectorAll('.chip')) x.classList.remove('on');
      c.classList.add('on'); filters.status = c.dataset.status; renderRows();
    });
    el('add-admin').addEventListener('click', addAdminModal);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    showView(location.hash.replace('#', '') || 'overview');
  }

  function showView(view) {
    if (!NAV[view]) view = 'overview';
    for (const s of document.querySelectorAll('.view')) s.classList.remove('on');
    el('view-' + view).classList.add('on');
    for (const a of document.querySelectorAll('.side nav a[data-view]')) a.classList.toggle('active', a.dataset.view === view);
    el('page-h1').textContent = NAV[view].h1;
    el('page-sub').textContent = NAV[view].sub;
    history.replaceState(null, '', '#' + view);

    clearInterval(refreshTimer);
    if (view === 'overview' || view === 'requests') { refreshDashboard(); refreshTimer = setInterval(refreshDashboard, 5000); }
    else if (view === 'accounts') loadAccounts();
    else if (view === 'emails') loadEmails();
    else if (view === 'forms') loadFormsEditor();
    else if (view === 'scenarios') loadScenariosEditor();
    else if (view === 'users') loadUsers();
    else if (view === 'settings') loadSettings();
    else if (view === 'journal') loadJournal();
  }

  // ========================================================================
  // Comptes créés
  // ========================================================================
  let accountsData = [];
  async function loadAccounts() {
    try { accountsData = (await fetchJson('/api/admin/accounts')).accounts; } catch (e) { el('accounts-rows').innerHTML = `<tr><td colspan="5" class="loading">${escapeHtml(e.message)}</td></tr>`; return; }
    el('acc-search').oninput = renderAccounts;
    renderAccounts();
  }
  function renderAccounts() {
    const q = el('acc-search').value.trim().toLowerCase();
    const rows = accountsData.filter((a) => !q || `${a.login} ${a.prenom} ${a.nom} ${a.reference}`.toLowerCase().includes(q));
    el('accounts-rows').innerHTML = rows.length ? rows.map((a) => `<tr>
      <td><span class="ref">${escapeHtml(a.login)}</span></td>
      <td>${escapeHtml(`${a.prenom} ${a.nom}`.trim() || '—')}</td>
      <td>${escapeHtml(a.app)}</td>
      <td>${escapeHtml(a.reference || '—')}</td>
      <td>${formatDate(a.createdAt)}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="loading">Aucun compte créé pour le moment.</td></tr>';
  }

  // ========================================================================
  // Journal d'activité
  // ========================================================================
  const AUDIT_LABELS = {
    maj_formulaire: 'Formulaire modifié', maj_scenario: 'Scénario modifié',
    relance_demande: 'Demande relancée', creation_admin: 'Compte admin créé',
    maj_mdp_admin: 'Mot de passe modifié', desactivation_admin: 'Compte désactivé',
    reactivation_admin: 'Compte réactivé', renvoi_email: 'E-mail renvoyé', email_marque_envoye: 'E-mail marqué envoyé',
    depot_demande: 'Demande déposée', creation_compte: 'Compte créé par le robot',
    echec_creation: 'Échec de création (robot)', connexion_admin: 'Connexion admin',
    echec_connexion_admin: 'Échec de connexion admin', connexion_sso: 'Connexion Microsoft 365',
    echec_connexion_sso: 'Échec de connexion Microsoft 365',
    email_identifiants_envoye: 'E-mail d’identifiants envoyé',
    email_identifiants_en_attente: 'E-mail d’identifiants en boîte d’envoi',
    identifiants_consultes: 'Identifiants consultés',
    lien_identifiants_regenere: 'Lien d’identifiants régénéré',
    acces_identifiants_refuse: 'Accès aux identifiants refusé',
    depot_reinit_mdp: 'Réinitialisation de mdp déposée',
    reinit_mdp: 'Mot de passe réinitialisé (robot)',
    depot_ajout_etab: 'Ajout d’établissement déposé',
    ajout_etab: 'Établissement ajouté (robot)',
    admin_consultation_identifiants: 'Identifiants consultés (admin)',
  };
  let journalEntries = [];
  async function loadJournal() {
    let data;
    try { data = await fetchJson('/api/admin/audit?limit=500'); } catch (e) { el('journal-rows').innerHTML = `<tr><td colspan="6" class="loading">${escapeHtml(e.message)}</td></tr>`; return; }
    journalEntries = data.entries;
    el('journal-search').oninput = renderJournal;
    renderJournal();
  }
  function renderJournal() {
    const q = el('journal-search').value.trim().toLowerCase();
    const rows = journalEntries.filter((e) =>
      !q || `${e.admin} ${AUDIT_LABELS[e.action] || e.action} ${e.target} ${e.details} ${e.ip}`.toLowerCase().includes(q)
    );
    el('journal-rows').innerHTML = rows.length ? rows.map((e) => `<tr>
      <td style="white-space:nowrap">${formatDate(e.created_at)}</td>
      <td><b>${escapeHtml(e.admin)}</b></td>
      <td>${escapeHtml(AUDIT_LABELS[e.action] || e.action)}</td>
      <td>${escapeHtml(e.target || '—')}</td>
      <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(e.details || '')}">${escapeHtml(e.details || '—')}</td>
      <td style="color:var(--muted);font-size:.82rem">${escapeHtml(e.ip || '—')}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="loading">Aucune activité correspondante.</td></tr>';
  }

  // ========================================================================
  // Vue d'ensemble + Demandes
  // ========================================================================
  async function refreshDashboard() {
    try {
      const [stats, data] = await Promise.all([fetchJson('/api/admin/stats'), fetchJson('/api/admin/requests')]);
      renderStats(stats);
      requests = data.requests || [];
      updateAppFilter();
      renderRows();
      if (openId != null) { const c = requests.find((r) => r.id === openId); if (c) renderModal(c); }
    } catch (err) { if (err.status === 401) location.href = '/login.html'; }
  }

  function renderStats(s) {
    const k = s.kpis || {};
    const tiles = [
      { cls: 'k-ok', ic: 'check', v: k.crees ?? 0, l: 'Comptes créés' },
      { cls: 'k-total', ic: 'inbox', v: k.total ?? 0, l: 'Demandes au total' },
      { cls: 'k-info', ic: 'trend', v: (k.tauxReussite ?? 0) + '%', l: 'Taux de réussite' },
      { cls: 'k-warn', ic: 'clock', v: (k.en_attente ?? 0) + (k.en_cours ?? 0), l: 'En cours · attente' },
      { cls: 'k-danger', ic: 'x', v: k.echec ?? 0, l: 'Échecs' },
    ];
    el('kpis').innerHTML = tiles.map((t) => `<div class="kpi ${t.cls}"><div class="ic">${icon(t.ic)}</div><div class="v">${t.v}</div><div class="l">${t.l}</div></div>`).join('');
    el('chart-serie').innerHTML = areaChart(s.serie || []);
    el('chart-apps').innerHTML = appBars(s.parApplication || []);
    el('chart-demandeur').innerHTML = barChart(s.parDemandeur || [], { color: CHART.terra, empty: 'Aucun compte créé.' });
    el('chart-etab').innerHTML = barChart(s.parEtablissement || [], { color: CHART.pine, empty: 'Aucun établissement.' });
    el('chart-fonction').innerHTML = barChart(s.parFonction || [], { color: CHART.gold, empty: 'Aucune fonction.' });
  }

  const who = (p = {}) => `${p.prenom || ''} ${p.nom || ''}`.trim() || '—';

  function renderRecent() {
    const recent = requests.slice(0, 6);
    el('recent').innerHTML = recent.length ? recent.map((r) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)"><div style="min-width:0"><div style="font-weight:600;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(who(r.payload))}</div><div style="font-size:.78rem;color:var(--muted)">${escapeHtml(r.app)} · ${formatDate(r.createdAt)}</div></div>${statusBadge(r.status)}</div>`).join('') : '<div class="empty">Aucune demande.</div>';
  }

  function updateAppFilter() {
    const apps = [...new Map(requests.map((r) => [r.appId, r.app])).entries()];
    const cur = el('app-filter').value;
    el('app-filter').innerHTML = '<option value="">Toutes les applications</option>' + apps.map(([id, n]) => `<option value="${escapeHtml(id)}">${escapeHtml(n)}</option>`).join('');
    el('app-filter').value = cur;
  }

  function matches(r) {
    if (filters.status && r.status !== filters.status) return false;
    if (filters.app && r.appId !== filters.app) return false;
    if (filters.text) {
      const h = `${r.reference} ${who(r.payload)} ${r.payload?.email || ''} ${r.demandeur || ''} ${r.app}`.toLowerCase();
      if (!h.includes(filters.text)) return false;
    }
    return true;
  }

  function renderRows() {
    renderRecent();
    const vis = requests.filter(matches);
    if (!vis.length) { el('rows').innerHTML = `<tr><td colspan="7" class="loading">${requests.length ? 'Aucune demande ne correspond aux filtres.' : 'Aucune demande.'}</td></tr>`; return; }
    el('rows').innerHTML = vis.map((r) => `<tr>
      <td><span class="ref">${escapeHtml(r.reference)}</span></td>
      <td>${escapeHtml(r.app)} ${typeBadge(r.type)}</td>
      <td><span class="who">${escapeHtml(who(r.payload))}<small>${escapeHtml(r.payload?.email || '')}</small></span></td>
      <td>${escapeHtml(r.demandeur || '—')}</td>
      <td>${formatDate(r.createdAt)}</td>
      <td>${statusBadge(r.status)}</td>
      <td style="text-align:right;white-space:nowrap">${r.status === 'echec' ? `<button class="btn btn-ghost btn-sm" data-retry="${r.id}">Relancer</button> ` : ''}<button class="btn btn-ghost btn-sm" data-detail="${r.id}">Détail</button></td>
    </tr>`).join('');
    for (const b of el('rows').querySelectorAll('[data-detail]')) b.addEventListener('click', () => openModal(Number(b.dataset.detail)));
    for (const b of el('rows').querySelectorAll('[data-retry]')) b.addEventListener('click', () => retry(b.dataset.retry, b));
  }

  async function retry(id, btn) {
    if (btn) btn.disabled = true;
    try { await fetchJson(`/api/admin/requests/${id}/retry`, { method: 'POST' }); toast('Demande relancée'); refreshDashboard(); }
    catch (e) { toast(e.message, true); if (btn) btn.disabled = false; }
  }

  function openModal(id) { const r = requests.find((x) => x.id === id); if (!r) return; openId = id; renderModal(r); backdrop.classList.add('show'); modal.classList.remove('wide'); }
  function closeModal() { openId = null; backdrop.classList.remove('show'); }

  function renderModal(r) {
    const payloadRows = Object.entries(r.payload || {}).map(([k, v]) => {
      const label = k.startsWith('_demandeur_') ? k.replace('_demandeur_', 'demandeur ') : k;
      return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(Array.isArray(v) ? v.join(', ') : v || '—')}</dd>`;
    }).join('');
    const logs = (r.logs || []).length ? r.logs.map((l) => `<span class="t">${new Date(l.at).toLocaleTimeString('fr-FR')}</span>  ${escapeHtml(l.message)}`).join('\n') : 'Aucune activité du robot.';
    const shots = (r.artifacts || []).length ? `<h4>Captures d'écran du robot</h4><div class="shots">${r.artifacts.map((f) => { const u = `/artifacts/${encodeURIComponent(r.reference)}/${encodeURIComponent(f)}`; return `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="${escapeHtml(f)}" loading="lazy"/><span class="cap">${escapeHtml(f)}</span></a>`; }).join('')}</div>` : '';
    const emails = (r.emails || []).length ? `<h4>E-mail d'identifiants</h4>${r.emails.map((e) => `<div style="font-size:.88rem;padding:6px 0">${escapeHtml(e.to)} — ${statusBadge2(e.status)}</div>`).join('')}` : '';
    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap"><h3>${r.type === 'reset_mdp' ? 'Réinitialisation de mot de passe' : r.type === 'ajout_etab' ? "Ajout d'établissement" : 'Demande'} <span class="ref">${escapeHtml(r.reference)}</span></h3>${statusBadge(r.status)}</div>
      <p style="color:var(--muted);font-size:.85rem;margin-top:4px">${escapeHtml(r.app)} — déposée le ${formatDate(r.createdAt)}${r.finishedAt ? ' — traitée le ' + formatDate(r.finishedAt) : ''} — ${r.attempts} tentative(s)${r.demandeur ? ' — demandeur : ' + escapeHtml(r.demandeur) : ''}</p>
      ${r.ssoEmail || r.ip ? `<p style="color:var(--muted);font-size:.82rem;margin-top:2px">Traçabilité : ${r.ssoEmail ? 'déposée via Microsoft 365 (' + escapeHtml(r.ssoEmail) + ')' : 'sans SSO'}${r.ip ? ' — IP ' + escapeHtml(r.ip) : ''}</p>` : ''}
      ${r.login ? `<p style="margin-top:8px;font-size:.9rem">Identifiant attribué : <span class="ref" style="font-size:.9rem">${escapeHtml(r.login)}</span></p>` : ''}
      ${r.credentialLink ? `<p style="margin-top:6px;font-size:.88rem">Lien d'identifiants : ${r.credentialLink.viewedAt
          ? `<span class="badge st-terminee">Consulté</span> le ${formatDate(r.credentialLink.viewedAt)}${r.credentialLink.viewedBy ? ' par ' + escapeHtml(r.credentialLink.viewedBy) : ''}`
          : `<span class="badge st-en_attente">Non consulté</span> — expire le ${formatDate(r.credentialLink.expiresAt)}`}</p>` : ''}
      ${r.status === 'terminee' && r.login ? `<p style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" id="m-showcreds">Voir identifiant + mot de passe</button><button class="btn btn-ghost btn-sm" id="m-newlink">Régénérer un lien d'identifiants</button></p><div id="m-creds-out" style="font-size:.88rem;margin-top:4px"></div><span id="m-newlink-out" style="font-size:.82rem;color:var(--muted)"></span>` : ''}
      ${r.message ? `<p style="margin-top:8px;font-size:.9rem"><strong>Résultat :</strong> ${escapeHtml(r.message)}</p>` : ''}
      <h4>Informations saisies</h4><dl class="kv">${payloadRows}</dl>
      ${emails}
      <h4>Journal du robot</h4><div class="logbox">${logs}</div>${shots}
      <div class="form-nav" style="justify-content:flex-end;border:none;padding-top:16px;margin-top:8px;display:flex;gap:10px">${r.status === 'echec' ? `<button class="btn btn-ghost" id="m-retry">Relancer</button>` : ''}<button class="btn btn-primary" id="m-close">Fermer</button></div>`;
    modal.querySelector('#m-close').addEventListener('click', closeModal);
    const rt = modal.querySelector('#m-retry'); if (rt) rt.addEventListener('click', () => retry(r.id, rt));
    const sc = modal.querySelector('#m-showcreds');
    if (sc) sc.addEventListener('click', async () => {
      sc.disabled = true;
      try {
        const c = await fetchJson(`/api/admin/requests/${r.id}/credentials`);
        modal.querySelector('#m-creds-out').innerHTML =
          `<div class="kv" style="margin-top:4px"><dt>Identifiant</dt><dd><span class="ref" style="user-select:all">${escapeHtml(c.login)}</span></dd>` +
          `<dt>Mot de passe</dt><dd><span class="ref" style="user-select:all">${escapeHtml(c.password || '—')}</span></dd></div>` +
          `<p style="font-size:.78rem;color:var(--muted);margin-top:4px">Consultation enregistrée au journal. À communiquer uniquement au bénéficiaire concerné.</p>`;
      } catch (e) { toast(e.message, true); sc.disabled = false; }
    });
    const nl = modal.querySelector('#m-newlink');
    if (nl) nl.addEventListener('click', async () => {
      nl.disabled = true;
      try {
        const out = await fetchJson(`/api/admin/requests/${r.id}/credential-link`, { method: 'POST' });
        const target = modal.querySelector('#m-newlink-out');
        target.innerHTML = `Nouveau lien (valide ${out.ttlDays} j) copié dans le presse-papier — l'ancien est révoqué.`;
        try { await navigator.clipboard.writeText(out.url); } catch { target.innerHTML = `Nouveau lien : <span style="user-select:all">${escapeHtml(out.url)}</span>`; }
        refreshDashboard();
      } catch (e) { toast(e.message, true); }
      nl.disabled = false;
    });
  }

  const EMAIL_LABELS = { a_envoyer: 'À envoyer', envoye: 'Envoyé', erreur: 'Erreur' };
  function statusBadge2(st) { const cls = st === 'envoye' ? 'st-terminee' : st === 'erreur' ? 'st-echec' : 'st-en_attente'; return `<span class="badge ${cls}">${EMAIL_LABELS[st] || st}</span>`; }

  // Étiquette du type de demande (création / réinit. mdp / ajout établissement).
  function typeBadge(type) {
    const map = {
      reset_mdp: ['Réinit. mdp', 'st-en_cours'],
      ajout_etab: ['Ajout étab.', 'st-en_attente'],
      creation: ['Création', 'st-terminee'],
    };
    const [label, cls] = map[type] || map.creation;
    return `<span class="badge ${cls}" style="font-size:.68rem">${label}</span>`;
  }

  // ========================================================================
  // E-mails (boîte d'envoi)
  // ========================================================================
  async function loadEmails() {
    let data;
    try { data = await fetchJson('/api/admin/emails'); } catch (e) { el('emails-rows').innerHTML = `<tr><td colspan="5" class="loading">${escapeHtml(e.message)}</td></tr>`; return; }
    el('emails-info').innerHTML = data.smtp
      ? '✔ SMTP configuré : les e-mails sont envoyés automatiquement à la création du compte.'
      : '⚠ SMTP non configuré : les e-mails restent ici (à transmettre manuellement). Renseignez SMTP_* dans .env pour l\'envoi automatique.';
    if (!data.emails.length) { el('emails-rows').innerHTML = '<tr><td colspan="5" class="loading">Aucun e-mail pour le moment.</td></tr>'; return; }
    el('emails-rows').innerHTML = data.emails.map((e) => `<tr>
      <td><span class="ref">${escapeHtml(e.reference || '—')}</span></td>
      <td>${escapeHtml(e.to)}</td>
      <td>${escapeHtml(e.subject)}</td>
      <td>${statusBadge2(e.status)}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn btn-ghost btn-sm" data-email='${encodeURIComponent(JSON.stringify(e))}'>Voir</button></td>
    </tr>`).join('');
    for (const b of el('emails-rows').querySelectorAll('[data-email]')) b.addEventListener('click', () => emailModal(JSON.parse(decodeURIComponent(b.dataset.email))));
  }

  function emailModal(e) {
    modal.classList.remove('wide');
    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px"><h3>E-mail — ${escapeHtml(e.reference || '')}</h3>${statusBadge2(e.status)}</div>
      <dl class="kv" style="margin-top:14px"><dt>Destinataire</dt><dd>${escapeHtml(e.to)}</dd><dt>Sujet</dt><dd>${escapeHtml(e.subject)}</dd>${e.error ? `<dt>Erreur</dt><dd>${escapeHtml(e.error)}</dd>` : ''}</dl>
      <h4>Message</h4><div class="mono-block" id="mail-body">${escapeHtml(e.body)}</div>
      <div class="form-nav" style="justify-content:flex-end;border:none;padding-top:16px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" id="copy-mail">Copier le message</button>
        ${e.status !== 'envoye' ? `<button class="btn btn-ghost" id="mark-sent">Marquer envoyé</button>` : ''}
        <button class="btn btn-primary" id="resend">Renvoyer</button>
        <button class="btn btn-ghost" id="m-close">Fermer</button>
      </div>`;
    backdrop.classList.add('show');
    modal.querySelector('#m-close').addEventListener('click', closeModal);
    modal.querySelector('#copy-mail').addEventListener('click', async () => { try { await navigator.clipboard.writeText(`À : ${e.to}\nSujet : ${e.subject}\n\n${e.body}`); toast('Message copié'); } catch { toast('Copie impossible', true); } });
    modal.querySelector('#resend').addEventListener('click', async () => { try { const r = await fetchJson(`/api/admin/emails/${e.id}/resend`, { method: 'POST' }); toast(r.smtp ? 'E-mail renvoyé' : 'SMTP non configuré : e-mail toujours en attente'); closeModal(); loadEmails(); } catch (x) { toast(x.message, true); } });
    const ms = modal.querySelector('#mark-sent'); if (ms) ms.addEventListener('click', async () => { try { await fetchJson(`/api/admin/emails/${e.id}/mark-sent`, { method: 'POST' }); toast('Marqué comme envoyé'); closeModal(); loadEmails(); } catch (x) { toast(x.message, true); } });
  }

  // ========================================================================
  // Éditeur de FORMULAIRES
  // ========================================================================
  let formsApps = [];
  let formsCurrent = null;
  let formsData = null;

  async function loadFormsEditor() {
    if (!formsApps.length) {
      const apps = await fetchJson('/api/apps');
      formsApps = apps.filter((a) => !a.comingSoon);
      el('forms-tabs').innerHTML = formsApps.map((a, i) => `<button data-app="${a.id}" class="${i === 0 ? 'on' : ''}">${escapeHtml(a.name)}</button>`).join('');
      for (const b of el('forms-tabs').querySelectorAll('button')) b.addEventListener('click', () => { for (const x of el('forms-tabs').querySelectorAll('button')) x.classList.remove('on'); b.classList.add('on'); selectFormApp(b.dataset.app); });
    }
    selectFormApp(formsApps[0]?.id);
  }

  async function selectFormApp(appId) {
    if (!appId) return;
    formsCurrent = appId;
    el('forms-body').innerHTML = '<div class="loading">Chargement…</div>';
    formsData = await fetchJson(`/api/admin/apps/${appId}/form`);
    renderFormsEditor();
  }

  function renderFormsEditor() {
    const robot = new Set(formsData.robotFields || []);
    const ov = formsData.overrides || {};
    const patches = ov.patches || {};
    const added = ov.added || [];
    const base = formsData.baseSchema;

    let html = `<p style="color:var(--muted);font-size:.88rem;margin-bottom:16px">Personnalisez le formulaire de <b>${escapeHtml(formsData.name)}</b>. Les champs <span class="lock">robot</span> sont saisis par l'automate : non supprimables. Ajoutez vos propres champs en bas.</p>`;
    for (const section of base.sections) {
      html += `<h3 style="font-size:1rem;margin:18px 0 10px">${escapeHtml(section.title)}</h3>`;
      for (const f of section.fields) {
        const p = patches[f.name] || {};
        const isRobot = robot.has(f.name);
        const hidden = p.hidden && !isRobot;
        html += fieldRow(f, { isRobot, hidden, label: p.label ?? f.label, required: p.required ?? f.required, section: section.title });
      }
    }
    const addedInExtra = added.filter((a) => !base.sections.some((s) => s.title === a.section));
    if (addedInExtra.length) {
      html += `<h3 style="font-size:1rem;margin:18px 0 10px">Champs ajoutés</h3>`;
      for (const a of addedInExtra) html += fieldRow(a.field, { added: true, label: a.field.label, required: a.field.required, section: a.section });
    }
    html += `<div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" id="add-field">+ Ajouter un champ</button><button class="btn btn-primary btn-sm" id="save-form">Enregistrer</button></div>`;
    el('forms-body').innerHTML = html;

    for (const b of el('forms-body').querySelectorAll('[data-edit]')) b.addEventListener('click', () => editFieldModal(b.dataset.edit));
    for (const b of el('forms-body').querySelectorAll('[data-toggle]')) b.addEventListener('click', () => toggleHide(b.dataset.toggle));
    for (const b of el('forms-body').querySelectorAll('[data-remove]')) b.addEventListener('click', () => removeAddedField(b.dataset.remove));
    el('add-field').addEventListener('click', addFieldModal);
    el('save-form').addEventListener('click', saveForm);
  }

  function fieldRow(f, o) {
    const badge = o.isRobot ? '<span class="lock">robot</span>' : o.added ? '<span class="lock" style="color:var(--accent);background:var(--accent-soft);border-color:var(--line-2)">ajouté</span>' : '';
    const meta = `${f.type}${o.required ? ' · obligatoire' : ''}${o.hidden ? ' · masqué' : ''}`;
    return `<div class="fld-row ${o.isRobot ? 'locked' : ''} ${o.hidden ? 'disabled' : ''}">
      <span class="grip">${icon('list')}</span>
      <div class="fld-main"><b>${escapeHtml(o.label)}</b> ${badge}<div class="meta">${escapeHtml(f.name)} — ${escapeHtml(meta)}</div></div>
      <div class="acts">
        ${!o.added ? `<button class="iconbtn" data-edit="${escapeHtml(f.name)}" title="Modifier">${icon('briefcase')}</button>` : ''}
        ${o.added ? `<button class="iconbtn" data-remove="${escapeHtml(f.name)}" title="Supprimer">${icon('x')}</button>`
          : !o.isRobot ? `<button class="iconbtn" data-toggle="${escapeHtml(f.name)}" title="${o.hidden ? 'Afficher' : 'Masquer'}">${icon('eye')}</button>` : ''}
      </div>
    </div>`;
  }

  function ensure(obj, key, def) { if (!obj[key]) obj[key] = def; return obj[key]; }

  function toggleHide(name) {
    const ov = ensure(formsData, 'overrides', {});
    const patches = ensure(ov, 'patches', {});
    const p = ensure(patches, name, {});
    p.hidden = !p.hidden;
    renderFormsEditor();
  }

  function editFieldModal(name) {
    const base = formsData.baseSchema.sections.flatMap((s) => s.fields).find((f) => f.name === name);
    const ov = ensure(formsData, 'overrides', {});
    const p = (ov.patches || {})[name] || {};
    const isRobot = (formsData.robotFields || []).includes(name);
    modal.classList.remove('wide');
    modal.innerHTML = `
      <h3>Modifier « ${escapeHtml(base.label)} »</h3>
      <p style="color:var(--muted);font-size:.84rem;margin:4px 0 16px">Champ <code>${escapeHtml(name)}</code> (${escapeHtml(base.type)})${isRobot ? ' — champ robot : le nom et le type sont verrouillés.' : ''}</p>
      <div class="form-grid">
        <label class="full">Libellé<input class="inp" id="ef-label" value="${escapeHtml(p.label ?? base.label)}" /></label>
        <label class="full">Aide (facultatif)<input class="inp" id="ef-help" value="${escapeHtml(p.help ?? base.help ?? '')}" /></label>
        <label class="full">Texte indicatif (placeholder)<input class="inp" id="ef-ph" value="${escapeHtml(p.placeholder ?? base.placeholder ?? '')}" /></label>
        ${!isRobot ? `<label>Obligatoire<select class="inp" id="ef-req"><option value="">Non</option><option value="1" ${(p.required ?? base.required) ? 'selected' : ''}>Oui</option></select></label>` : ''}
      </div>
      <div class="form-nav" style="justify-content:flex-end;border:none;padding-top:16px;display:flex;gap:8px"><button class="btn btn-ghost" id="m-close">Annuler</button><button class="btn btn-primary" id="ef-save">Appliquer</button></div>`;
    backdrop.classList.add('show');
    modal.querySelector('#m-close').addEventListener('click', closeModal);
    modal.querySelector('#ef-save').addEventListener('click', () => {
      const patches = ensure(ov, 'patches', {});
      const np = ensure(patches, name, {});
      np.label = el('ef-label').value.trim();
      np.help = el('ef-help').value.trim();
      np.placeholder = el('ef-ph').value.trim();
      if (!isRobot) np.required = el('ef-req').value === '1';
      closeModal(); renderFormsEditor();
    });
  }

  function addFieldModal() {
    modal.classList.remove('wide');
    const sections = formsData.baseSchema.sections.map((s) => s.title);
    modal.innerHTML = `
      <h3>Ajouter un champ</h3>
      <div class="form-grid" style="margin-top:14px">
        <label>Nom technique<input class="inp" id="nf-name" placeholder="ex: service" /></label>
        <label>Libellé<input class="inp" id="nf-label" placeholder="ex: Service" /></label>
        <label>Type<select class="inp" id="nf-type"><option value="text">Texte</option><option value="email">E-mail</option><option value="tel">Téléphone</option><option value="date">Date</option><option value="textarea">Texte long</option><option value="select">Liste déroulante</option><option value="radio">Choix unique</option><option value="checkboxes">Choix multiples</option></select></label>
        <label>Section<select class="inp" id="nf-section">${sections.map((s) => `<option>${escapeHtml(s)}</option>`).join('')}</select></label>
        <label>Obligatoire<select class="inp" id="nf-req"><option value="">Non</option><option value="1">Oui</option></select></label>
        <label class="full" id="nf-opts-wrap" style="display:none">Options (une par ligne, « valeur | libellé »)<textarea class="inp" id="nf-opts" rows="4" placeholder="cdi | CDI&#10;cdd | CDD"></textarea></label>
      </div>
      <div class="form-nav" style="justify-content:flex-end;border:none;padding-top:16px;display:flex;gap:8px"><button class="btn btn-ghost" id="m-close">Annuler</button><button class="btn btn-primary" id="nf-add">Ajouter</button></div>`;
    backdrop.classList.add('show');
    modal.querySelector('#m-close').addEventListener('click', closeModal);
    const typeSel = el('nf-type');
    typeSel.addEventListener('change', () => { el('nf-opts-wrap').style.display = ['select', 'radio', 'checkboxes'].includes(typeSel.value) ? '' : 'none'; });
    modal.querySelector('#nf-add').addEventListener('click', () => {
      const name = el('nf-name').value.trim().toLowerCase();
      const type = el('nf-type').value;
      const field = { name, label: el('nf-label').value.trim(), type, required: el('nf-req').value === '1' };
      if (!/^[a-z0-9_]{1,40}$/.test(name)) return toast('Nom technique invalide (minuscules, chiffres, _)', true);
      if (['select', 'radio', 'checkboxes'].includes(type)) {
        const opts = el('nf-opts').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [v, lab] = l.split('|').map((x) => x.trim()); return { value: v, label: lab || v }; });
        if (!opts.length) return toast('Ce type nécessite des options', true);
        field.options = opts;
      }
      const ov = ensure(formsData, 'overrides', {});
      ensure(ov, 'added', []).push({ section: el('nf-section').value, field });
      closeModal(); renderFormsEditor();
    });
  }

  function removeAddedField(name) {
    const ov = ensure(formsData, 'overrides', {});
    ov.added = (ov.added || []).filter((a) => a.field.name !== name);
    renderFormsEditor();
  }

  async function saveForm() {
    try {
      await fetchJson(`/api/admin/apps/${formsCurrent}/form`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formsData.overrides || {}) });
      toast('Formulaire enregistré');
    } catch (e) { toast((e.body?.details || [e.message]).join(' · '), true); }
  }

  // ========================================================================
  // Éditeur de SCÉNARIOS
  // ========================================================================
  let scenApps = [];
  let scenCurrent = null;
  let scenData = null;

  async function loadScenariosEditor() {
    if (!scenApps.length) {
      const apps = await fetchJson('/api/apps');
      scenApps = apps.filter((a) => !a.comingSoon);
      el('scen-tabs').innerHTML = scenApps.map((a, i) => `<button data-app="${a.id}" class="${i === 0 ? 'on' : ''}">${escapeHtml(a.name)}</button>`).join('');
      for (const b of el('scen-tabs').querySelectorAll('button')) b.addEventListener('click', () => { for (const x of el('scen-tabs').querySelectorAll('button')) x.classList.remove('on'); b.classList.add('on'); selectScenApp(b.dataset.app); });
    }
    selectScenApp(scenApps[0]?.id);
  }

  async function selectScenApp(appId) {
    if (!appId) return;
    scenCurrent = appId;
    el('scen-body').innerHTML = '<div class="loading">Chargement…</div>';
    scenData = await fetchJson(`/api/admin/apps/${appId}/scenario`);
    renderScenEditor();
  }

  function renderScenEditor() {
    const ov = scenData.overrides || {};
    const disabled = new Set(ov.disabled || []);
    const selectors = ov.selectors || {};
    const custom = ov.custom || [];

    let html = `<p style="color:var(--muted);font-size:.88rem;margin-bottom:16px">Étapes du robot pour <b>${escapeHtml(scenData.name)}</b>. Les étapes critiques ne peuvent pas être désactivées (elles créent réellement le compte) mais leurs <b>sélecteurs</b> restent modifiables. Vous pouvez insérer des étapes personnalisées.</p>`;
    scenData.steps.forEach((s, i) => {
      const off = disabled.has(s.id);
      html += `<div class="step-row ${off ? 'disabled' : ''}">
        <span class="num">${String(i + 1).padStart(2, '0')}</span>
        <div class="step-main"><b>${escapeHtml(s.label)}</b><div class="meta">${escapeHtml(s.id)}${s.critical ? ' · critique' : ''}${(s.selectorKeys || []).length ? ' · ' + s.selectorKeys.length + ' sélecteur(s)' : ''}</div></div>
        ${(s.selectorKeys || []).length ? `<button class="btn btn-ghost btn-sm" data-sel="${escapeHtml(s.id)}">Sélecteurs</button>` : ''}
        <label class="switch" title="${s.critical ? 'Étape critique : toujours active' : 'Activer / désactiver'}"><input type="checkbox" data-step="${escapeHtml(s.id)}" ${off ? '' : 'checked'} ${s.critical ? 'disabled' : ''}/><span class="sl"></span></label>
      </div>`;
    });
    if (custom.length) {
      html += `<h4 style="margin:18px 0 8px;font-size:.82rem;text-transform:uppercase;color:var(--muted)">Étapes personnalisées</h4>`;
      custom.forEach((c) => {
        html += `<div class="step-row custom"><span class="num">+</span><div class="step-main"><b>${escapeHtml(c.label || c.action)}</b><div class="meta">${escapeHtml(c.action)}${c.selector ? ' · ' + escapeHtml(c.selector) : ''}${c.after ? ' · après ' + escapeHtml(c.after) : ' · au début'}</div></div><button class="iconbtn" data-delc="${escapeHtml(c.id)}" title="Supprimer">${icon('x')}</button></div>`;
      });
    }
    html += `<div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" id="add-step">+ Étape personnalisée</button><button class="btn btn-primary btn-sm" id="save-scen">Enregistrer</button></div>`;
    el('scen-body').innerHTML = html;

    for (const c of el('scen-body').querySelectorAll('[data-step]')) c.addEventListener('change', () => {
      const ov2 = ensure(scenData, 'overrides', {}); const dis = ensure(ov2, 'disabled', []);
      const id = c.dataset.step;
      if (c.checked) ov2.disabled = dis.filter((x) => x !== id); else if (!dis.includes(id)) dis.push(id);
    });
    for (const b of el('scen-body').querySelectorAll('[data-sel]')) b.addEventListener('click', () => selectorsModal(b.dataset.sel));
    for (const b of el('scen-body').querySelectorAll('[data-delc]')) b.addEventListener('click', () => { const ov2 = ensure(scenData, 'overrides', {}); ov2.custom = (ov2.custom || []).filter((x) => x.id !== b.dataset.delc); renderScenEditor(); });
    el('add-step').addEventListener('click', addStepModal);
    el('save-scen').addEventListener('click', saveScenario);
  }

  function selectorsModal(stepId) {
    const step = scenData.steps.find((s) => s.id === stepId);
    const ov = scenData.overrides || {};
    const sel = ov.selectors || {};
    modal.classList.remove('wide');
    modal.innerHTML = `
      <h3>Sélecteurs — ${escapeHtml(step.label)}</h3>
      <p style="color:var(--muted);font-size:.84rem;margin:4px 0 16px">Laissez vide pour garder le sélecteur du code. Modifiez uniquement si l'interface de l'application a changé.</p>
      <div class="form-grid">${step.selectorKeys.map((k) => `<label class="full"><code>${escapeHtml(k)}</code><input class="inp" data-selkey="${escapeHtml(k)}" value="${escapeHtml(sel[k] || '')}" placeholder="(sélecteur par défaut)" /></label>`).join('')}</div>
      <div class="form-nav" style="justify-content:flex-end;border:none;padding-top:16px;display:flex;gap:8px"><button class="btn btn-ghost" id="m-close">Annuler</button><button class="btn btn-primary" id="sel-save">Appliquer</button></div>`;
    backdrop.classList.add('show');
    modal.querySelector('#m-close').addEventListener('click', closeModal);
    modal.querySelector('#sel-save').addEventListener('click', () => {
      const ov2 = ensure(scenData, 'overrides', {}); const s = ensure(ov2, 'selectors', {});
      for (const inp of modal.querySelectorAll('[data-selkey]')) { const v = inp.value.trim(); if (v) s[inp.dataset.selkey] = v; else delete s[inp.dataset.selkey]; }
      closeModal(); renderScenEditor(); toast('Sélecteurs mis à jour (pensez à Enregistrer)');
    });
  }

  function addStepModal() {
    modal.classList.remove('wide');
    const anchors = scenData.steps.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.label)}</option>`).join('');
    modal.innerHTML = `
      <h3>Étape personnalisée</h3>
      <div class="form-grid" style="margin-top:14px">
        <label>Identifiant<input class="inp" id="cs-id" placeholder="ex: cocher_option" /></label>
        <label>Libellé<input class="inp" id="cs-label" placeholder="ex: Cocher la case X" /></label>
        <label>Action<select class="inp" id="cs-action"><option value="click">Cliquer</option><option value="fill">Remplir</option><option value="selectOption">Choisir dans une liste</option><option value="check">Cocher</option><option value="waitForSelector">Attendre un élément</option><option value="wait">Attendre (ms)</option><option value="goto">Aller à une URL</option></select></label>
        <label>Insérer après<select class="inp" id="cs-after"><option value="">— Au tout début —</option>${anchors}</select></label>
        <label class="full">Sélecteur (CSS) / URL<input class="inp" id="cs-selector" placeholder="ex: input[name=&quot;x&quot;]" /></label>
        <label class="full">Valeur fixe (ou laisser vide)<input class="inp" id="cs-value" /></label>
        <label class="full">…ou champ du formulaire comme valeur<input class="inp" id="cs-source" placeholder="ex: nom" /></label>
      </div>
      <div class="form-nav" style="justify-content:flex-end;border:none;padding-top:16px;display:flex;gap:8px"><button class="btn btn-ghost" id="m-close">Annuler</button><button class="btn btn-primary" id="cs-add">Ajouter</button></div>`;
    backdrop.classList.add('show');
    modal.querySelector('#m-close').addEventListener('click', closeModal);
    modal.querySelector('#cs-add').addEventListener('click', () => {
      const id = el('cs-id').value.trim();
      if (!/^[a-z0-9_-]{1,40}$/.test(id)) return toast('Identifiant invalide', true);
      const step = { id, label: el('cs-label').value.trim(), action: el('cs-action').value, selector: el('cs-selector').value.trim(), value: el('cs-value').value, sourceField: el('cs-source').value.trim() || undefined, after: el('cs-after').value || null };
      const ov = ensure(scenData, 'overrides', {}); ensure(ov, 'custom', []).push(step);
      closeModal(); renderScenEditor();
    });
  }

  async function saveScenario() {
    try {
      await fetchJson(`/api/admin/apps/${scenCurrent}/scenario`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scenData.overrides || {}) });
      toast('Scénario enregistré');
    } catch (e) { toast((e.body?.details || [e.message]).join(' · '), true); }
  }

  // ========================================================================
  // Comptes admin
  // ========================================================================
  async function loadUsers() {
    let data;
    try { data = await fetchJson('/api/admin/users'); } catch (e) { el('users-rows').innerHTML = `<tr><td colspan="5" class="loading">${escapeHtml(e.message)}</td></tr>`; return; }
    el('users-rows').innerHTML = data.users.map((u) => `<tr>
      <td><b>${escapeHtml(u.username)}</b>${u.username === data.me ? ' <span style="color:var(--muted);font-size:.8rem">(vous)</span>' : ''}</td>
      <td>${escapeHtml(u.display_name || '—')}</td>
      <td>${u.last_login ? formatDate(u.last_login) : '—'}</td>
      <td>${u.disabled ? '<span class="badge st-echec">Désactivé</span>' : '<span class="badge st-terminee">Actif</span>'}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn btn-ghost btn-sm" data-pw="${u.id}">Mot de passe</button> <button class="btn btn-ghost btn-sm" data-dis="${u.id}" data-cur="${u.disabled ? 1 : 0}">${u.disabled ? 'Réactiver' : 'Désactiver'}</button></td>
    </tr>`).join('');
    for (const b of el('users-rows').querySelectorAll('[data-pw]')) b.addEventListener('click', () => changePwModal(b.dataset.pw));
    for (const b of el('users-rows').querySelectorAll('[data-dis]')) b.addEventListener('click', async () => {
      try { await fetchJson(`/api/admin/users/${b.dataset.dis}/disabled`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: b.dataset.cur !== '1' }) }); toast('Compte mis à jour'); loadUsers(); }
      catch (e) { toast(e.message, true); }
    });
  }

  function addAdminModal() {
    modal.classList.remove('wide');
    modal.innerHTML = `
      <h3>Nouveau compte administrateur</h3>
      <div class="form-grid" style="margin-top:14px">
        <label>Identifiant<input class="inp" id="na-user" autocomplete="off" /></label>
        <label>Nom affiché<input class="inp" id="na-name" /></label>
        <label class="full">Mot de passe (6 caractères min.)<input class="inp" id="na-pw" type="password" autocomplete="new-password" /></label>
      </div>
      <div class="form-nav" style="justify-content:flex-end;border:none;padding-top:16px;display:flex;gap:8px"><button class="btn btn-ghost" id="m-close">Annuler</button><button class="btn btn-primary" id="na-add">Créer</button></div>`;
    backdrop.classList.add('show');
    modal.querySelector('#m-close').addEventListener('click', closeModal);
    modal.querySelector('#na-add').addEventListener('click', async () => {
      try { await fetchJson('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: el('na-user').value.trim(), displayName: el('na-name').value.trim(), password: el('na-pw').value }) }); toast('Compte créé'); closeModal(); loadUsers(); }
      catch (e) { toast(e.message, true); }
    });
  }

  function changePwModal(id) {
    modal.classList.remove('wide');
    modal.innerHTML = `
      <h3>Changer le mot de passe</h3>
      <div class="form-grid" style="margin-top:14px"><label class="full">Nouveau mot de passe (6 car. min.)<input class="inp" id="cp-pw" type="password" autocomplete="new-password" /></label></div>
      <div class="form-nav" style="justify-content:flex-end;border:none;padding-top:16px;display:flex;gap:8px"><button class="btn btn-ghost" id="m-close">Annuler</button><button class="btn btn-primary" id="cp-save">Enregistrer</button></div>`;
    backdrop.classList.add('show');
    modal.querySelector('#m-close').addEventListener('click', closeModal);
    modal.querySelector('#cp-save').addEventListener('click', async () => {
      try { await fetchJson(`/api/admin/users/${id}/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: el('cp-pw').value }) }); toast('Mot de passe changé'); closeModal(); }
      catch (e) { toast(e.message, true); }
    });
  }

  // ========================================================================
  // Réglages
  // ========================================================================
  async function loadSettings() {
    let s;
    try { s = await fetchJson('/api/admin/settings'); } catch (e) { el('settings-body').innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`; return; }
    const badge = (ok) => ok ? '<span class="badge st-terminee">Configuré</span>' : '<span class="badge st-en_attente">Non configuré</span>';
    const sec = s.security || {};
    const secAlerts = [];
    if (sec.defaultAdminPassword) secAlerts.push('Le compte « admin » utilise encore le mot de passe par défaut : changez-le immédiatement (Comptes admin → Mot de passe).');
    if (!sec.https) secAlerts.push('Le portail n’est pas servi en HTTPS : à activer impérativement en production (certificat + reverse proxy).');
    if (sec.https && !sec.cookieSecure) secAlerts.push('HTTPS détecté mais ADMIN_COOKIE_SECURE n’est pas à true : les cookies devraient être marqués « Secure ».');
    el('settings-body').innerHTML = `
      ${secAlerts.length ? `<div class="alert alert-err" style="margin-bottom:18px"><b>Sécurité :</b><ul style="margin:6px 0 0 18px">${secAlerts.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul></div>` : ''}
      <div class="card" style="margin-bottom:18px"><div class="ch"><h3>Robot</h3></div><div class="cb">
        <p style="font-size:.92rem">Mode d'automatisation : <b>${s.automationMode === 'production' ? 'Production (vraies applications)' : 'Démonstration (console factice)'}</b></p>
        <p style="font-size:.84rem;color:var(--muted);margin-top:6px">Se règle via la variable d'environnement <code>AUTOMATION_MODE</code> côté serveur.</p>
      </div></div>
      <div class="card" style="margin-bottom:18px"><div class="ch"><h3>Connexion SSO Microsoft 365</h3></div><div class="cb">
        <p style="font-size:.92rem">État : ${s.sso && s.sso.required ? '<span class="badge st-terminee">Actif — accès réservé aux comptes ADEF</span>' : s.sso && s.sso.configured ? '<span class="badge st-en_attente">Configuré mais désactivé (SSO_REQUIRED=false)</span>' : '<span class="badge st-en_attente">Non configuré — site en accès libre</span>'}</p>
        <p style="font-size:.84rem;color:var(--muted);margin-top:6px">Renseignez <code>M365_TENANT_ID</code>, <code>M365_CLIENT_ID</code>, <code>M365_CLIENT_SECRET</code> et <code>M365_REDIRECT_URI</code> dans le <code>.env</code> (application « Web » enregistrée dans Entra ID). Seuls les comptes Microsoft 365 du tenant ADEF pourront alors accéder au portail.</p>
      </div></div>
      <div class="card" style="margin-bottom:18px"><div class="ch"><h3>Envoi d'e-mails (SMTP)</h3></div><div class="cb">
        <p style="font-size:.92rem">État : ${badge(s.smtp)}</p>
        <p style="font-size:.84rem;color:var(--muted);margin-top:6px">Renseignez <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code> (et <code>MAIL_FROM</code>) dans le <code>.env</code> pour l'envoi automatique. Sinon les e-mails restent en boîte d'envoi.</p>
      </div></div>
      <div class="card"><div class="ch"><h3>Applications</h3><span class="hint">configuration du mode production</span></div><div class="cb">
        ${s.apps.map((a) => `<div class="settings-app"><div style="flex:1"><b>${escapeHtml(a.name)}</b>${a.comingSoon ? ' <span class="badge st-en_attente">Bientôt</span>' : ''}<div style="font-size:.8rem;color:var(--muted);margin-top:3px">${a.vars.map((v) => `${v.name}: ${v.set ? '✔' : '—'}`).join(' · ') || 'aucune variable'}</div></div><div class="st">${a.comingSoon ? '' : badge(a.configured)}</div></div>`).join('')}
      </div></div>`;
  }
})();
