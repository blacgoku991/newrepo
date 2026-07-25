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
    maj_identite: 'Correction identité',
    transfert_etab: 'Transfert établissement',
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
      <div id="dmd-box"></div>

      <div class="esp-section-head">
        <h2>Comptes &amp; activité</h2>
        <span class="hint" id="esp-count"></span>
      </div>
      <div id="esp-tabs"></div>
      <label class="esp-search"><input type="text" id="esp-search-input" placeholder="Rechercher un identifiant, un nom, une référence…" autocomplete="off" /></label>
      <div id="esp-view"></div>`;

    setupDemande(data.apps || []);
    setupViews(data);
  }

  /**
   * Sélecteur d'application : le choix doit sauter aux yeux, et l'option
   * retenue être reconnaissable autrement que par la couleur seule (logo de
   * l'éditeur + coche). Cibles de 48 px minimum.
   * @param {{key:string,label:string,visual:string}[]} items
   */
  function appSwitchHtml(items, activeKey, hint) {
    const check = '<svg class="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    return `
      ${hint ? `<div class="app-switch-hint">${escapeHtml(hint)}</div>` : ''}
      <div class="app-switch" role="tablist">
        ${items.map((it) => {
          const on = it.key === activeKey;
          return `<button type="button" class="app-opt${on ? ' on' : ''}" role="tab" aria-selected="${on}" data-key="${escapeHtml(it.key)}">
            <span class="lg">${it.visual}</span>
            <span class="nm">${escapeHtml(it.label)}</span>
            ${on ? check : ''}
          </button>`;
        }).join('')}
      </div>`;
  }

  /** Pastille visuelle d'une application (logo de l'éditeur) ou icône générique. */
  function visualFor(app) {
    return app ? appVisual(app) : icon('clock');
  }

  // « Faire une demande » en deux temps : d'abord l'application, ensuite la
  // démarche. Deux écrans courts valent mieux qu'une grille où les démarches
  // BlueKanGo et NetSoins se mélangent — le référent voit d'abord OÙ il agit.
  const DMD = { apps: [], app: '' };

  // Habillage des cartes de démarche. Les démarches proposées, elles, viennent
  // du serveur (`app.demarches`) : rien n'est affiché qui n'ait un robot.
  const DMD_CARTES = {
    creation: {
      icon: 'users',
      desc: (n) => `Nouveau compte ${n} pour un agent qui arrive.`,
    },
    ajout_etab: {
      icon: 'building',
      desc: () => 'Rattacher un établissement de plus à un compte existant, sans rien retirer.',
    },
    maj_compte: {
      icon: 'edit',
      desc: () => 'Mot de passe oublié, nom ou prénom à corriger, transfert vers un autre établissement.',
    },
    reset_mdp: { icon: 'lock', desc: () => 'Réinitialiser le mot de passe d’un compte existant.' },
    maj_identite: { icon: 'edit', desc: () => 'Corriger le nom ou le prénom sur la fiche (l’identifiant suit le nouveau nom).' },
    transfert_etab: { icon: 'building', desc: () => 'Retirer l’établissement actuel et rattacher le nouveau.' },
  };

  function setupDemande(apps) {
    // Une application sans aucune démarche exécutable n'a rien à proposer.
    DMD.apps = (apps || []).filter((a) => (a.demarches || []).length);
    // Une seule application : le choix n'a pas lieu d'être, on va droit aux démarches.
    DMD.app = DMD.apps.length === 1 ? DMD.apps[0].appId : '';
    drawDemande();
  }

  function demandeUrl(appId, alias) {
    return `/demande.html?app=${encodeURIComponent(appId)}${alias ? `&type=${encodeURIComponent(alias)}` : ''}`;
  }

  /** Étape 1 — sur quelle application ? */
  function appStepHtml() {
    return `
      <div class="dmd-step">
        <div class="dmd-lead"><span class="n">1</span><span class="tt">Sur quelle application ?</span></div>
        <div class="dmd-apps">
          ${DMD.apps.map((a) => {
            const nb = a.demarches.length;
            return `<button type="button" class="dmd-app" data-app="${escapeHtml(a.appId)}">
              <span class="lg">${visualFor(a)}</span>
              <span class="tx"><b>${escapeHtml(a.name)}</b><span>${nb} démarche${nb > 1 ? 's' : ''} disponible${nb > 1 ? 's' : ''}</span></span>
              <span class="go" aria-hidden="true">${icon('arrow')}</span>
            </button>`;
          }).join('')}
        </div>
      </div>`;
  }

  /** Étape 2 — quelle démarche sur l'application choisie ? */
  function demarcheStepHtml(app) {
    const retour = DMD.apps.length > 1
      ? `<button type="button" class="dmd-back">← Changer d’application</button>`
      : '';
    return `
      <div class="dmd-step">
        <div class="dmd-lead">
          <span class="n">2</span><span class="tt">Quelle démarche sur <b>${escapeHtml(app.name)}</b> ?</span>${retour}
        </div>
        <div class="dmd-cards">
          ${app.demarches.map((d) => {
            const habillage = DMD_CARTES[d.type] || { icon: 'folder', desc: () => '' };
            return `<a class="dmd-card" href="${demandeUrl(app.appId, d.alias)}">
              <span class="ic">${icon(habillage.icon)}</span>
              <b>${escapeHtml(d.label)}</b>
              <span>${escapeHtml(habillage.desc(app.name))}</span>
            </a>`;
          }).join('')}
        </div>
      </div>`;
  }

  function drawDemande() {
    const box = document.getElementById('dmd-box');
    if (!DMD.apps.length) {
      box.innerHTML = '<div class="empty-box">Aucune démarche disponible sur vos établissements pour le moment.</div>';
      return;
    }
    const app = DMD.apps.find((a) => a.appId === DMD.app);
    box.innerHTML = app ? demarcheStepHtml(app) : appStepHtml();

    box.querySelectorAll('.dmd-app').forEach((b) => {
      b.addEventListener('click', () => { DMD.app = b.dataset.app; drawDemande(); });
    });
    const back = box.querySelector('.dmd-back');
    if (back) back.addEventListener('click', () => { DMD.app = ''; drawDemande(); });
  }

  // Un seul espace paginé, organisé en onglets : une application par onglet
  // (BlueKanGo, NetSoins…) plus « Activité ». Évite de scroller une longue page.
  const PAGE_SIZE = 15;
  const V = { accounts: [], activity: [], tabs: [], view: '', query: '', page: 1, apps: new Map() };

  function appsOf(accounts) {
    const seen = new Map();
    for (const a of accounts) if (!seen.has(a.appId)) seen.set(a.appId, a.app);
    return [...seen.entries()].map(([appId, app]) => ({ appId, app }));
  }

  function setupViews(data) {
    V.accounts = data.accounts || [];
    V.activity = data.activity || [];
    // Un onglet par application (avec le logo de l'éditeur) + l'activité.
    const byId = new Map((data.apps || []).map((a) => [a.appId, a]));
    V.apps = byId;
    V.tabs = appsOf(V.accounts).map((a) => ({
      key: a.appId,
      label: a.app,
      visual: visualFor(byId.get(a.appId)),
    }));
    V.tabs.push({ key: '__activity', label: 'Activité', visual: icon('clock') });
    V.view = V.tabs[0].key;
    V.query = '';
    V.page = 1;

    const search = document.getElementById('esp-search-input');
    search.addEventListener('input', () => { V.query = search.value.trim().toLowerCase(); V.page = 1; draw(); });

    draw();
  }

  function drawTabs() {
    const box = document.getElementById('esp-tabs');
    box.innerHTML = appSwitchHtml(V.tabs, V.view);
    box.querySelectorAll('.app-opt').forEach((b) => {
      b.addEventListener('click', () => { V.view = b.dataset.key; V.page = 1; draw(); });
    });
  }

  function currentList() {
    const q = V.query;
    if (V.view === '__activity') {
      return !q ? V.activity : V.activity.filter((r) =>
        [r.reference, r.who, r.login, r.etablissementLabel, TYPE_LABELS[r.type]]
          .some((v) => (v || '').toLowerCase().includes(q)));
    }
    return V.accounts.filter((a) => {
      if (a.appId !== V.view) return false;
      if (!q) return true;
      return [a.login, a.nom, a.prenom, a.fonction, a.etablissementLabel]
        .some((v) => (v || '').toLowerCase().includes(q));
    });
  }

  /**
   * Raccourcis d'une ligne de compte : identifiant et établissement actuel sont
   * déjà connus, on les passe au formulaire. Seules les démarches réellement
   * exécutables sur l'application sont proposées.
   */
  function accActions(a) {
    const app = V.apps.get(a.appId) || {};
    const dispo = new Set(app.actions || []);
    const cartes = new Set((app.demarches || []).map((d) => d.type));
    const lien = (alias) =>
      `/demande.html?app=${encodeURIComponent(a.appId)}&type=${alias}` +
      `&identifiant=${encodeURIComponent(a.login)}&etablissement=${encodeURIComponent(a.etablissement || '')}`;
    const boutons = [];
    if (dispo.has('reset_mdp')) boutons.push([lien('reset'), 'lock', 'Réinit.', 'Réinitialiser le mot de passe']);
    if (dispo.has('ajout_etab')) boutons.push([lien('extension'), 'building', 'Étab.', 'Ajouter un établissement']);
    if (cartes.has('maj_compte')) boutons.push([lien('maj'), 'edit', 'Mettre à jour', 'Mot de passe, identité ou établissement']);
    // `aria-label` : sous 760 px l'intitulé est masqué, le bouton ne garde que
    // son icône — il doit rester nommé pour les lecteurs d'écran.
    return boutons
      .map(([href, ic, label, titre]) =>
        `<a class="btn btn-ghost btn-sm" href="${href}" title="${escapeHtml(titre)}" aria-label="${escapeHtml(`${label} — ${a.login}`)}">${icon(ic)}<span>${escapeHtml(label)}</span></a>`)
      .join('');
  }

  function accRow(a) {
    const who = `${a.prenom} ${a.nom}`.trim() || '—';
    const src = a.source === 'portail'
      ? '<span class="badge st-terminee acc-src">Créé ici</span>'
      : '<span class="badge st-en_attente acc-src">Existant</span>';
    const inactif = a.actif === false ? ' <span class="badge st-echec acc-src">Inactif</span>' : '';
    // `data-label` : sous 640 px, chaque ligne devient une fiche et ces
    // intitulés remplacent l'en-tête du tableau.
    return `<tr>
      <td data-label="Bénéficiaire">${escapeHtml(who)}</td>
      <td data-label="Identifiant"><span class="ref">${escapeHtml(a.login)}</span></td>
      <td data-label="Établissement">${escapeHtml(a.etablissementLabel || '—')}</td>
      <td data-label="Fonction">${escapeHtml(a.fonction || '—')}</td>
      <td data-label="État">${src}${inactif}</td>
      <td class="acc-row-actions">${accActions(a)}</td>
    </tr>`;
  }

  function accountsTable(rows) {
    return `<div class="tablecard"><table class="data acc-table">
      <thead><tr><th>Bénéficiaire</th><th>Identifiant</th><th>Établissement</th><th>Fonction</th><th>État</th><th></th></tr></thead>
      <tbody>${rows.map(accRow).join('')}</tbody>
    </table></div>`;
  }

  function activityTable(rows) {
    return `<div class="tablecard"><table class="data">
      <thead><tr><th>Référence</th><th>Type</th><th>Bénéficiaire</th><th>Identifiant</th><th>Établissement</th><th>Déposée le</th><th>Statut</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td data-label="Référence"><a class="ref" href="/suivi.html?ref=${encodeURIComponent(r.reference)}">${escapeHtml(r.reference)}</a></td>
        <td data-label="Type">${escapeHtml(TYPE_LABELS[r.type] || r.type)}</td>
        <td data-label="Bénéficiaire">${escapeHtml(r.who || '—')}</td>
        <td data-label="Identifiant">${r.login ? `<span class="ref">${escapeHtml(r.login)}</span>` : '—'}</td>
        <td data-label="Établissement">${escapeHtml(r.etablissementLabel || '—')}</td>
        <td data-label="Déposée le">${formatDate(r.createdAt)}</td>
        <td data-label="Statut">${statusBadge(r.status)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  // Numéros de page à afficher (1 … n-1 n n+1 … N).
  function pageNumbers(page, pages) {
    const wanted = [1, pages, page, page - 1, page + 1].filter((n) => n >= 1 && n <= pages);
    const uniq = [...new Set(wanted)].sort((a, b) => a - b);
    const out = [];
    let prev = 0;
    for (const n of uniq) { if (n - prev > 1) out.push('…'); out.push(n); prev = n; }
    return out;
  }

  function pager(page, pages, from, to, total, noun) {
    const info = `<span class="pg-info">${from}–${to} sur ${total} ${noun}</span>`;
    if (pages <= 1) return `<div class="esp-pager">${info}</div>`;
    const btns = pageNumbers(page, pages)
      .map((n) => n === '…'
        ? '<span class="pg-ell">…</span>'
        : `<button class="pg${n === page ? ' on' : ''}" data-page="${n}">${n}</button>`)
      .join('');
    return `<div class="esp-pager">${info}
      <div class="pg-btns">
        <button class="pg" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Précédent">‹</button>
        ${btns}
        <button class="pg" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Suivant">›</button>
      </div>
    </div>`;
  }

  function draw() {
    drawTabs();
    const isActivity = V.view === '__activity';
    const noun = isActivity ? 'demandes' : 'comptes';
    const list = currentList();
    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (V.page > pages) V.page = pages;
    const start = (V.page - 1) * PAGE_SIZE;
    const slice = list.slice(start, start + PAGE_SIZE);

    document.getElementById('esp-count').textContent =
      `${total} ${total > 1 ? noun : noun.replace(/s$/, '')}`;

    const box = document.getElementById('esp-view');
    if (!total) {
      box.innerHTML = V.query
        ? `<div class="empty-box">Aucun résultat pour « ${escapeHtml(V.query)} ».</div>`
        : isActivity
          ? `<div class="empty-box">Aucune demande enregistrée pour vos établissements.</div>`
          : `<div class="empty-box">Aucun compte pour cette sélection.<br />Les comptes apparaissent après une création ou un import.</div>`;
      return;
    }
    box.innerHTML =
      (isActivity ? activityTable(slice) : accountsTable(slice)) +
      pager(V.page, pages, start + 1, start + slice.length, total, noun);

    box.querySelectorAll('.pg[data-page]').forEach((b) => {
      if (b.disabled) return;
      b.addEventListener('click', () => {
        const p = Number(b.dataset.page);
        if (p >= 1 && p <= pages && p !== V.page) { V.page = p; draw(); }
      });
    });
  }
})();
