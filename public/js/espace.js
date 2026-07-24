'use strict';

/*
 * Espace personnel du référent : comptes de son/ses établissement(s) et
 * activité récente. Chaque compte propose des actions pré-remplies
 * (réinitialisation de mot de passe, ajout d'établissement) qui reprennent
 * l'identifiant sans avoir à le ressaisir.
 */

(function () {
  const root = document.getElementById('esp');

  const TYPE_LABELS = {
    creation: 'Création',
    reset_mdp: 'Réinit. mot de passe',
    ajout_etab: 'Ajout établissement',
  };

  boot();

  async function boot() {
    let data;
    try {
      data = await fetchJson('/api/espace/me');
    } catch (err) {
      root.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      return;
    }
    if (!data.referent) return renderNotAuthorized(data);
    render(data);
  }

  function renderNotAuthorized(data) {
    const who = data.user ? escapeHtml(data.user.name || data.user.email) : '';
    root.innerHTML = `
      <div class="notauth">
        <div class="ic">${icon('lock')}</div>
        <h1>Accès non autorisé</h1>
        <p>${who ? `Bonjour ${who}. ` : ''}Votre compte n'est pas habilité à déposer des demandes sur ce portail.
        Seuls les <strong>référents désignés</strong> de chaque établissement peuvent créer un compte, réinitialiser un mot de passe ou ajouter un établissement.</p>
        <p>Pour toute demande, <strong>rapprochez-vous du référent de votre établissement</strong>. Si vous pensez devoir être référent, contactez votre administrateur.</p>
      </div>`;
  }

  function render(data) {
    const ref = data.referent;
    const prenom = ref.prenom || (data.user && data.user.name) || '';
    const chips = ref.etablissements.length
      ? `<div class="etab-chips">${ref.etablissements
          .map((e) => `<span class="etab-chip">${icon('building')} ${escapeHtml(e.label)}</span>`)
          .join('')}</div>`
      : '<p style="color:var(--faint);margin-top:10px">Aucun établissement rattaché à votre profil pour le moment.</p>';

    root.innerHTML = `
      <div class="esp-head">
        <h1>Bonjour${prenom ? ' ' + escapeHtml(prenom) : ''}</h1>
        <p>Voici les comptes des établissements dont vous êtes référent. Lancez une nouvelle démarche ou agissez sur un compte existant en un clic.</p>
        ${chips}
      </div>

      <div class="esp-section-head"><h2>Faire une demande</h2></div>
      <div class="esp-actions">
        <a class="esp-act" href="/demande.html?app=bluekango">
          <span class="ic">${icon('users')}</span>
          <span><b>Créer un compte</b><span>Nouveau compte BlueKanGo pour un agent</span></span>
        </a>
        <a class="esp-act" href="/demande.html?app=bluekango&type=extension">
          <span class="ic">${icon('building')}</span>
          <span><b>Ajouter un établissement</b><span>Rattacher un établissement à un compte existant</span></span>
        </a>
        <a class="esp-act" href="/demande.html?app=bluekango&type=reset">
          <span class="ic">${icon('lock')}</span>
          <span><b>Mot de passe oublié</b><span>Réinitialiser le mot de passe d'un compte</span></span>
        </a>
      </div>

      <div class="esp-section-head">
        <h2>Comptes existants</h2>
        <span class="hint" id="acc-count"></span>
      </div>
      <div class="acc-toolbar">
        <div class="acc-tabs" id="acc-tabs"></div>
        <label class="esp-search"><input type="text" id="acc-search" placeholder="Rechercher un identifiant, un nom, une fonction…" autocomplete="off" /></label>
      </div>
      <div id="accounts"></div>

      <div class="esp-section-head"><h2>Activité récente</h2></div>
      <div id="activity"></div>`;

    setupAccounts(data.accounts);
    renderActivity(data.activity || []);
  }

  const ACC_CAP = 100; // nombre max de lignes affichées (le reste via la recherche)
  const accState = { all: [], app: '', query: '' };

  // Applications présentes dans les comptes, pour les onglets de filtre.
  function appsOf(accounts) {
    const seen = new Map();
    for (const a of accounts) if (!seen.has(a.appId)) seen.set(a.appId, a.app);
    return [...seen.entries()].map(([appId, app]) => ({ appId, app }));
  }

  function setupAccounts(accounts) {
    accState.all = accounts;
    const apps = appsOf(accounts);
    // Onglet par défaut : « Toutes » s'il y a plusieurs applications, sinon l'unique.
    accState.app = apps.length > 1 ? '' : (apps[0] ? apps[0].appId : '');
    accState.query = '';

    const tabsBox = document.getElementById('acc-tabs');
    const tabs = (apps.length > 1 ? [{ appId: '', app: 'Toutes' }] : []).concat(apps);
    tabsBox.innerHTML = tabs
      .map((t) => `<button class="acc-tab" data-app="${escapeHtml(t.appId)}">${escapeHtml(t.app)}</button>`)
      .join('');
    tabsBox.querySelectorAll('.acc-tab').forEach((btn) => {
      btn.addEventListener('click', () => { accState.app = btn.dataset.app; drawAccounts(); });
    });

    const search = document.getElementById('acc-search');
    search.addEventListener('input', () => { accState.query = search.value.trim().toLowerCase(); drawAccounts(); });

    drawAccounts();
  }

  function filteredAccounts() {
    const q = accState.query;
    return accState.all.filter((a) => {
      if (accState.app && a.appId !== accState.app) return false;
      if (!q) return true;
      return [a.login, a.nom, a.prenom, a.fonction, a.etablissementLabel]
        .some((v) => (v || '').toLowerCase().includes(q));
    });
  }

  function accRow(a) {
    const who = `${a.prenom} ${a.nom}`.trim() || '—';
    const resetUrl = `/demande.html?app=${encodeURIComponent(a.appId)}&type=reset&identifiant=${encodeURIComponent(a.login)}&etablissement=${encodeURIComponent(a.etablissement)}`;
    const extUrl = `/demande.html?app=${encodeURIComponent(a.appId)}&type=extension&identifiant=${encodeURIComponent(a.login)}`;
    const src = a.source === 'portail'
      ? '<span class="badge st-terminee acc-src">Créé ici</span>'
      : '<span class="badge st-en_attente acc-src">Existant</span>';
    const inactif = a.actif === false ? ' <span class="badge st-echec acc-src">Inactif</span>' : '';
    return `<tr>
      <td>${escapeHtml(who)}</td>
      <td><span class="ref">${escapeHtml(a.login)}</span></td>
      <td>${escapeHtml(a.app)}</td>
      <td>${escapeHtml(a.etablissementLabel || '—')}</td>
      <td>${escapeHtml(a.fonction || '—')}</td>
      <td>${src}${inactif}</td>
      <td class="acc-row-actions">
        <a class="btn btn-ghost btn-sm" href="${resetUrl}" title="Réinitialiser le mot de passe">${icon('lock')}<span>Réinit.</span></a>
        <a class="btn btn-ghost btn-sm" href="${extUrl}" title="Ajouter un établissement">${icon('building')}<span>Étab.</span></a>
      </td>
    </tr>`;
  }

  function drawAccounts() {
    const box = document.getElementById('accounts');
    const countEl = document.getElementById('acc-count');
    const list = filteredAccounts();

    // Onglet actif.
    document.querySelectorAll('#acc-tabs .acc-tab').forEach((b) => {
      b.classList.toggle('on', b.dataset.app === accState.app);
    });
    countEl.textContent = `${list.length} compte${list.length > 1 ? 's' : ''}`;

    if (!list.length) {
      box.innerHTML = accState.query
        ? `<div class="empty-box">Aucun compte ne correspond à « ${escapeHtml(accState.query)} ».</div>`
        : `<div class="empty-box">Aucun compte pour cette sélection.
           <br />Les comptes apparaissent après une création ou un import.</div>`;
      return;
    }
    const shown = list.slice(0, ACC_CAP);
    const more = list.length - shown.length;
    box.innerHTML =
      `<div class="tablecard"><table class="data acc-table">
        <thead><tr><th>Bénéficiaire</th><th>Identifiant</th><th>Application</th><th>Établissement</th><th>Fonction</th><th>État</th><th></th></tr></thead>
        <tbody>${shown.map(accRow).join('')}</tbody>
      </table></div>` +
      (more > 0
        ? `<div class="empty-box" style="margin-top:12px">${more} autre${more > 1 ? 's' : ''} compte${more > 1 ? 's' : ''} — affinez la recherche pour les voir.</div>`
        : '');
  }

  function renderActivity(activity) {
    const box = document.getElementById('activity');
    if (!activity.length) {
      box.innerHTML = `<div class="empty-box">Aucune demande enregistrée pour vos établissements.</div>`;
      return;
    }
    box.innerHTML = `
      <div class="tablecard"><table class="data">
        <thead><tr><th>Référence</th><th>Type</th><th>Bénéficiaire</th><th>Identifiant</th><th>Établissement</th><th>Déposée le</th><th>Statut</th></tr></thead>
        <tbody>
          ${activity
            .map(
              (r) => `<tr>
            <td><a class="ref" href="/suivi.html?ref=${encodeURIComponent(r.reference)}">${escapeHtml(r.reference)}</a></td>
            <td>${escapeHtml(TYPE_LABELS[r.type] || r.type)}</td>
            <td>${escapeHtml(r.who || '—')}</td>
            <td>${r.login ? `<span class="ref">${escapeHtml(r.login)}</span>` : '—'}</td>
            <td>${escapeHtml(r.etablissementLabel || '—')}</td>
            <td>${formatDate(r.createdAt)}</td>
            <td>${statusBadge(r.status)}</td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table></div>`;
  }
})();
