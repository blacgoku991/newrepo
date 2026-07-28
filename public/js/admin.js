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

  // Types de demande : étiquette courte (tableaux) et titre complet (détail).
  // Les libellés suivent le registre des démarches côté serveur (src/demarches.js).
  const TYPE_BADGES = {
    creation: ['Création', 'st-terminee'],
    reset_mdp: ['Réinit. mdp', 'st-en_cours'],
    ajout_etab: ['Ajout étab.', 'st-en_attente'],
    maj_identite: ['Identité', 'st-en_cours'],
    transfert_etab: ['Transfert', 'st-en_attente'],
  };
  const TYPE_TITRES = {
    creation: 'Demande de création de compte',
    reset_mdp: 'Réinitialisation de mot de passe',
    ajout_etab: "Ajout d'établissement",
    maj_identite: "Correction de l'identité",
    transfert_etab: 'Transfert vers un autre établissement',
  };

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
    accounts: { ic: 'users', label: 'Comptes créés', h1: 'Comptes créés', sub: 'Identifiants attribués automatiquement' },
    emails: { ic: 'inbox', label: 'E-mails', h1: "E-mails d'identifiants", sub: "Boîte d'envoi des identifiants de connexion" },
    referents: { ic: 'building', label: 'Référents', h1: 'Référents autorisés', sub: 'Habilitations par établissement & espaces personnels' },
    users: { ic: 'users', label: 'Comptes admin', h1: 'Comptes administrateurs', sub: 'Accès à cet espace' },
    settings: { ic: 'lock', label: 'Réglages', h1: 'Réglages', sub: 'Mode d’exécution, e-mail, configuration' },
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
    el('export-requests').addEventListener('click', exporterDemandes);
    el('export-journal').addEventListener('click', exporterJournal);
    el('add-admin').addEventListener('click', addAdminModal);
    el('add-referent').addEventListener('click', () => referentModal(null));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    showView(location.hash.replace('#', '') || 'overview');
    majBandeauLicence();
  }

  /**
   * Bandeau de licence — réservé à l'administration. Les référents n'ont pas à
   * connaître l'état de la licence : ce n'est pas leur sujet, et le portail
   * reste consultable de toute façon. Muet quand tout va bien.
   */
  async function majBandeauLicence() {
    const host = el('licence-banner');
    if (!host) return;
    let l;
    try {
      l = (await fetchJson('/api/admin/settings')).licence;
    } catch {
      return; // sans état de licence, on n'affiche rien plutôt qu'une erreur
    }
    if (!l || l.niveau === 'ok') { host.innerHTML = ''; return; }
    const cls = l.niveau === 'danger' ? 'lb-danger' : l.niveau === 'warn' ? 'lb-warn' : 'lb-info';
    host.innerHTML = `<div class="licence-banner ${cls}" role="status"><div class="lb-inner">
      <span class="lb-ic">${icon(l.robot ? 'clock' : 'lock')}</span>
      <span><b>${escapeHtml(l.titre || '')}</b> ${escapeHtml(l.message || '')}
        ${l.niveau !== 'info' ? ` <a href="#settings">Réglages → Licence</a>` : ''}</span>
    </div></div>`;
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
    else if (view === 'referents') loadReferents();
    else if (view === 'users') loadUsers();
    else if (view === 'settings') loadSettings();
    else if (view === 'journal') loadJournal();
  }

  // ========================================================================
  // Export CSV
  //
  // L'export reprend EXACTEMENT les lignes affichées : mêmes filtres, même
  // ordre. Rien n'est redemandé au serveur, donc l'export ne peut pas révéler
  // plus que ce que l'écran montre déjà.
  // ========================================================================

  /**
   * Prépare une cellule pour un tableur.
   *
   * Les noms, e-mails et messages proviennent d'un formulaire ouvert : une
   * valeur commençant par « = », « + », « - » ou « @ » serait interprétée par
   * Excel ou LibreOffice comme une FORMULE à l'ouverture du fichier. On la
   * préfixe donc d'une apostrophe pour qu'elle reste du texte.
   */
  function csvCell(valeur) {
    const s = valeur === null || valeur === undefined ? '' : String(valeur);
    const formule = /^[=+\-@\t\r]/.test(s);
    return `"${(formule ? `'${s}` : s).replace(/"/g, '""')}"`;
  }

  function horodatageFichier() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  /**
   * Déclenche le téléchargement d'un CSV.
   *
   * Séparateur « ; » et BOM UTF-8 : c'est ce qu'attend Excel en configuration
   * française, sinon les accents sortent illisibles et tout atterrit dans une
   * seule colonne.
   */
  function telechargerCsv(nomFichier, entetes, lignes) {
    const contenu = [entetes, ...lignes].map((l) => l.map(csvCell).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + contenu], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomFichier;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Laisse au navigateur le temps d'amorcer le téléchargement.
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /** Trace l'export : qui a extrait quoi, et combien de lignes. */
  async function tracerExport(vue, lignes, filtres) {
    try {
      await fetchJson('/api/admin/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vue, lignes, filtres }),
      });
    } catch { /* la trace ne doit jamais empêcher l'export */ }
  }

  function exporterDemandes() {
    const vis = requests.filter(matches);
    if (!vis.length) return toast('Aucune ligne à exporter avec ces filtres.', true);
    const entetes = ['Référence', 'Application', 'Démarche', 'Statut', 'Bénéficiaire', 'E-mail',
      'Identifiant créé', 'Demandeur', 'Compte Microsoft', 'Établissement', 'Déposée le',
      'Prise en charge le', 'Terminée le', 'Durée du robot (s)', 'Tentatives', 'Résultat'];
    const lignes = vis.map((r) => [
      r.reference, r.app, demarcheLabel(r.type), STATUS_LABELS[r.status] || r.status, who(r.payload),
      r.payload?.email || '', r.login || '', r.demandeur || '', r.ssoEmail || '',
      r.payload?.etablissement || '', r.createdAt, r.startedAt || '', r.finishedAt || '',
      dureeRobot(r) ?? '', r.attempts ?? '', r.message || '',
    ]);
    telechargerCsv(`demandes-${horodatageFichier()}.csv`, entetes, lignes);
    toast(`${lignes.length} demande${lignes.length > 1 ? 's' : ''} exportée${lignes.length > 1 ? 's' : ''}.`);
    tracerExport('demandes', lignes.length, {
      recherche: filters.text || '', statut: filters.status || '', application: filters.app || '',
    });
  }

  function exporterJournal() {
    const lignesVues = journalFiltre();
    if (!lignesVues.length) return toast('Aucune ligne à exporter avec ces filtres.', true);
    const entetes = ['Date', 'Acteur', 'Action', 'Cible', 'Détails', 'IP'];
    const lignes = lignesVues.map((e) => [
      e.created_at, e.admin, AUDIT_LABELS[e.action] || e.action, e.target || '', e.details || '', e.ip || '',
    ]);
    telechargerCsv(`journal-${horodatageFichier()}.csv`, entetes, lignes);
    toast(`${lignes.length} ligne${lignes.length > 1 ? 's' : ''} exportée${lignes.length > 1 ? 's' : ''}.`);
    tracerExport('journal', lignes.length, { recherche: el('journal-search').value.trim() });
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
      <td data-label="Identifiant"><span class="ref">${escapeHtml(a.login)}</span></td>
      <td data-label="Bénéficiaire">${escapeHtml(`${a.prenom} ${a.nom}`.trim() || '—')}</td>
      <td data-label="Application">${escapeHtml(a.app)}</td>
      <td data-label="Référence">${escapeHtml(a.reference || '—')}</td>
      <td data-label="Créé le">${formatDate(a.createdAt)}</td>
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
    depot_demande: 'Demande déposée', creation_compte: 'Compte créé automatiquement',
    echec_creation: 'Échec de création', connexion_admin: 'Connexion admin',
    echec_connexion_admin: 'Échec de connexion admin', connexion_sso: 'Connexion Microsoft 365',
    echec_connexion_sso: 'Échec de connexion Microsoft 365',
    email_identifiants_envoye: 'E-mail d’identifiants envoyé',
    email_identifiants_en_attente: 'E-mail d’identifiants en boîte d’envoi',
    identifiants_consultes: 'Identifiants consultés',
    lien_identifiants_regenere: 'Lien d’identifiants régénéré',
    acces_identifiants_refuse: 'Accès aux identifiants refusé',
    depot_creation_compte: 'Création de compte déposée',
    depot_reinit_mdp: 'Réinitialisation de mdp déposée',
    // Clés antérieures au registre des démarches, conservées pour relire
    // l'historique déjà journalisé.
    depot_creation: 'Création de compte déposée',
    depot_reset_mdp: 'Réinitialisation de mdp déposée',
    reinit_mdp: 'Mot de passe réinitialisé',
    depot_ajout_etab: 'Ajout d’établissement déposé',
    ajout_etab: 'Établissement ajouté',
    depot_maj_identite: 'Correction d’identité déposée',
    maj_identite: 'Identité corrigée',
    depot_transfert_etab: 'Transfert d’établissement déposé',
    transfert_etab: 'Compte transféré',
    admin_consultation_identifiants: 'Identifiants consultés (admin)',
    export_csv: 'Export CSV',
  };
  let journalEntries = [];
  async function loadJournal() {
    let data;
    try { data = await fetchJson('/api/admin/audit?limit=500'); } catch (e) { el('journal-rows').innerHTML = `<tr><td colspan="6" class="loading">${escapeHtml(e.message)}</td></tr>`; return; }
    journalEntries = data.entries;
    el('journal-search').oninput = renderJournal;
    renderJournal();
  }
  /** Lignes du journal réellement affichées — partagé avec l'export CSV. */
  function journalFiltre() {
    const q = el('journal-search').value.trim().toLowerCase();
    return journalEntries.filter((e) =>
      !q || `${e.admin} ${AUDIT_LABELS[e.action] || e.action} ${e.target} ${e.details} ${e.ip}`.toLowerCase().includes(q)
    );
  }
  function renderJournal() {
    const rows = journalFiltre();
    el('journal-rows').innerHTML = rows.length ? rows.map((e) => `<tr>
      <td data-label="Date" style="white-space:nowrap">${formatDate(e.created_at)}</td>
      <td data-label="Acteur"><b>${escapeHtml(e.admin)}</b></td>
      <td data-label="Action">${escapeHtml(AUDIT_LABELS[e.action] || e.action)}</td>
      <td data-label="Cible">${escapeHtml(e.target || '—')}</td>
      <td data-label="Détails" class="cell-detail" title="${escapeHtml(e.details || '')}">${escapeHtml(e.details || '—')}</td>
      <td data-label="IP" style="color:var(--muted);font-size:.82rem">${escapeHtml(e.ip || '—')}</td>
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
      if (openId != null) {
        const c = requests.find((r) => r.id === openId);
        // Ne pas réécrire la fenêtre pendant que l'admin saisit le code OTP.
        const typing = document.activeElement && document.activeElement.id === 'm-otp';
        if (c && !typing) renderModal(c);
      }
    } catch (err) { if (err.status === 401) location.href = '/login.html'; }
  }

  function renderStats(s) {
    const k = s.kpis || {};
    const ref = s.referents || {};
    const tiles = [
      { cls: 'k-ok', ic: 'check', v: k.crees ?? 0, l: 'Comptes créés' },
      { cls: 'k-total', ic: 'inbox', v: k.total ?? 0, l: 'Demandes au total' },
      { cls: 'k-info', ic: 'trend', v: (k.tauxReussite ?? 0) + '%', l: 'Taux de réussite' },
      { cls: 'k-warn', ic: 'clock', v: (k.en_attente ?? 0) + (k.en_cours ?? 0), l: 'En cours · attente' },
      { cls: 'k-danger', ic: 'x', v: k.echec ?? 0, l: 'Échecs' },
      // Habilitations : sans référent, personne ne peut déposer de demande.
      { cls: ref.actifs ? 'k-info' : 'k-danger', ic: 'building', v: ref.actifs ?? 0, l: 'Référents habilités' },
    ];
    el('kpis').innerHTML = tiles.map((t) => `<div class="kpi ${t.cls}"><div class="ic">${icon(t.ic)}</div><div class="v">${t.v}</div><div class="l">${t.l}</div></div>`).join('');
    el('alerte-referents').innerHTML = alerteReferentsHtml(ref);
    el('valeur').innerHTML = valeurHtml(s.valeur || {});
    el('chart-serie').innerHTML = areaChart(s.serie || []);
    brancherInfobulles();
    el('chart-apps').innerHTML = appBars(s.parApplication || []);
    el('chart-demandeur').innerHTML = barChart(s.parDemandeur || [], { color: CHART.terra, empty: 'Aucun compte créé.' });
    el('chart-etab').innerHTML = barChart(s.parEtablissement || [], { color: CHART.pine, empty: 'Aucun établissement.' });
    el('chart-fonction').innerHTML = barChart(s.parFonction || [], { color: CHART.gold, empty: 'Aucune fonction.' });
    el('ms-accounts').innerHTML = msAccountsTable(s.parCompteMicrosoft || []);
  }

  /** « 3 h 20 », « 47 h », « 12 min » — jamais « 3.3333 heures ». */
  function dureeCourte(minutes) {
    const m = Math.round(minutes);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const reste = m % 60;
    if (h < 10 && reste) return `${h} h ${String(reste).padStart(2, '0')}`;
    return `${h} h`;
  }

  function delaiCourt(secondes) {
    if (!secondes && secondes !== 0) return '—';
    if (secondes < 90) return `${Math.round(secondes)} s`;
    const min = Math.floor(secondes / 60);
    if (min < 60) return `${min} min ${String(Math.round(secondes % 60)).padStart(2, '0')} s`;
    return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
  }

  /**
   * Temps passé par le robot sur UNE demande : début d'exécution → fin.
   * Distinct du délai déposée → traitée, qui contient l'attente en file.
   */
  function dureeRobot(r) {
    const debut = Date.parse(String(r.startedAt || '').replace(' ', 'T') + 'Z');
    const fin = Date.parse(String(r.finishedAt || '').replace(' ', 'T') + 'Z');
    if (!Number.isFinite(debut) || !Number.isFinite(fin) || fin < debut) return null;
    return Math.round((fin - debut) / 1000);
  }

  function dureeRobotTexte(r) {
    const s = dureeRobot(r);
    return s === null ? '' : ` — robot : ${delaiCourt(s)}`;
  }

  /**
   * Combien de temps le robot a réellement passé dans l'application, démarche
   * par démarche. C'est la question qu'on se pose devant un écran de suivi :
   * « c'est normal que ce soit si long ? » — la médiane et le maximum y
   * répondent mieux qu'une moyenne seule.
   */
  function robotHtml(r) {
    if (!r || !r.n) return '';
    const ligne = (o, nom) => `<tr>
      <td>${escapeHtml(nom)}</td>
      <td style="text-align:center">${o.n}</td>
      <td style="text-align:center">${delaiCourt(o.medianeSecondes)}</td>
      <td style="text-align:center">${delaiCourt(o.moyenneSecondes)}</td>
      <td style="text-align:center;color:var(--muted)">${delaiCourt(o.minSecondes)} → ${delaiCourt(o.maxSecondes)}</td>
    </tr>`;
    return `
      <details style="margin-top:16px">
        <summary style="cursor:pointer;font-size:.86rem;color:var(--muted)">
          Détail du temps passé par le robot (${r.n} exécution${r.n > 1 ? 's' : ''},
          ${delaiCourt(r.totalSecondes)} au total)
        </summary>
        <div style="overflow-x:auto;margin-top:10px"><table class="data" style="margin:0"><thead><tr>
          <th>Démarche</th><th style="text-align:center">Exéc.</th>
          <th style="text-align:center">Médiane</th><th style="text-align:center">Moyenne</th>
          <th style="text-align:center">Min → Max</th>
        </tr></thead><tbody>
          ${(r.parType || []).map((t) => ligne(t, t.label)).join('')}
          ${(r.parApplication || []).length > 1
    ? `<tr><td colspan="5" style="padding-top:12px;color:var(--muted);font-size:.78rem">Par application</td></tr>`
      + r.parApplication.map((a) => ligne(a, a.app)).join('')
    : ''}
        </tbody></table></div>
      </details>`;
  }

  /**
   * Valeur produite : temps de saisie évité. Le barème est affiché avec le
   * résultat — un chiffre dont on ne peut pas voir l'hypothèse ne convainc
   * personne, et se retourne contre vous dès qu'on le questionne.
   */
  function valeurHtml(v) {
    if (!v || !v.abouties) return '';
    const euros = (n) => (n === null || n === undefined ? '' :
      ` <span style="color:var(--muted);font-size:.82rem">≈ ${n.toLocaleString('fr-FR')} €</span>`);
    // Échappé une seule fois : ré-échapper la chaîne assemblée afficherait
    // « d&#39;établissement » à l'écran.
    const bareme = Object.entries(v.bareme || {})
      .map(([t, min]) => `${escapeHtml((TYPE_TITRES && TYPE_TITRES[t]) || t)} ${min} min`)
      .join(' · ');

    return `
      <div class="card" style="margin-bottom:18px"><div class="ch">
        <h3>Temps de saisie évité</h3>
        <span class="hint">${v.abouties} demande${v.abouties > 1 ? 's' : ''} réellement aboutie${v.abouties > 1 ? 's' : ''}</span>
      </div><div class="cb">
        <div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
          <div><div style="font-size:1.7rem;font-weight:650;color:var(--gold-bright);font-variant-numeric:tabular-nums">${dureeCourte(v.minutes.mois)}</div>
            <div style="font-size:.82rem;color:var(--muted)">sur 30 jours${euros(v.euros.mois)}</div></div>
          <div><div style="font-size:1.7rem;font-weight:650;font-variant-numeric:tabular-nums">${dureeCourte(v.minutes.trimestre)}</div>
            <div style="font-size:.82rem;color:var(--muted)">sur 90 jours${euros(v.euros.trimestre)}</div></div>
          <div><div style="font-size:1.7rem;font-weight:650;font-variant-numeric:tabular-nums">${dureeCourte(v.minutes.toujours)}</div>
            <div style="font-size:.82rem;color:var(--muted)">depuis le début${euros(v.euros.toujours)}</div></div>
          <div><div style="font-size:1.7rem;font-weight:650;font-variant-numeric:tabular-nums">${delaiCourt((v.robot || {}).medianeSecondes)}</div>
            <div style="font-size:.82rem;color:var(--muted)">durée médiane du robot${
  v.delaiMedianSecondes ? ` · ${delaiCourt(v.delaiMedianSecondes)} du dépôt à la fin` : ''}</div></div>
        </div>
        ${robotHtml(v.robot)}
        ${v.parType.length ? `<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
          ${v.parType.map((t) => `<span class="badge st-en_cours">${escapeHtml(t.label)} · ${dureeCourte(t.minutes)}</span>`).join('')}
        </div>` : ''}
        <p style="font-size:.78rem;color:var(--faint);margin-top:14px">
          Barème appliqué (temps d'une opération à la main) : ${bareme}.
          ${v.tauxHoraire ? `Coût horaire chargé : ${v.tauxHoraire} €.` : ''}
        </p>
      </div></div>`;
  }

  // « Qui a fait quoi » : par compte Microsoft, avec le détail par type de démarche.
  function msAccountsTable(rows) {
    if (!rows.length) return '<div class="empty">Aucune demande enregistrée.</div>';
    // Une colonne par démarche : la liste suit le registre côté serveur, donc
    // une nouvelle démarche apparaît ici sans retoucher ce tableau.
    const types = Object.keys(TYPE_BADGES);
    return `<div style="overflow-x:auto"><table class="data" style="margin:0"><thead><tr>
        <th>Compte Microsoft</th><th style="text-align:center">Total</th>
        ${types.map((t) => `<th style="text-align:center">${escapeHtml(TYPE_BADGES[t][0])}</th>`).join('')}
        <th style="text-align:center">Comptes créés</th>
      </tr></thead><tbody>
        ${rows.map((r) => `<tr>
          <td><b>${escapeHtml(r.account)}</b></td>
          <td style="text-align:center">${r.total}</td>
          ${types.map((t) => `<td style="text-align:center">${r[t] || 0}</td>`).join('')}
          <td style="text-align:center"><span class="badge st-terminee">${r.crees || 0}</span></td>
        </tr>`).join('')}
      </tbody></table></div>`;
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
    if (!vis.length) { el('rows').innerHTML = `<tr><td colspan="8" class="loading">${requests.length ? 'Aucune demande ne correspond aux filtres.' : 'Aucune demande.'}</td></tr>`; return; }
    el('rows').innerHTML = vis.map((r) => `<tr>
      <td data-label="Référence"><span class="ref">${escapeHtml(r.reference)}</span></td>
      <td data-label="Application">${escapeHtml(r.app)} ${typeBadge(r.type)}</td>
      <td data-label="Bénéficiaire"><span class="who">${escapeHtml(who(r.payload))}<small>${escapeHtml(r.payload?.email || '')}</small></span></td>
      <td data-label="Demandeur">${escapeHtml(r.demandeur || '—')}</td>
      <td data-label="Déposée le">${formatDate(r.createdAt)}</td>
      <td data-label="Robot" style="white-space:nowrap;font-variant-numeric:tabular-nums">${(() => {
    const s = dureeRobot(r);
    return s === null ? '<span style="color:var(--faint)">—</span>' : delaiCourt(s);
  })()}</td>
      <td data-label="Statut">${statusBadge(r.status)}</td>
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

  function adminProgressHtml(r) {
    if (r.status !== 'en_cours' && r.status !== 'en_attente') return '';
    const p = r.progress || {};
    const pct = r.status === 'en_attente' ? 0 : Math.min(100, Math.max(0, p.percent || 0));
    const info = r.status === 'en_attente'
      ? 'En file d’attente'
      : (p.total ? `Étape ${p.done}/${p.total}${p.label ? ' — ' + escapeHtml(p.label) : ''}` : 'Traitement en cours');
    return `<div class="adm-progress"><div class="pl"><span>${info}</span><span class="pct">${pct}%</span></div><div class="track"><div class="fill" style="width:${pct}%"></div></div></div>`;
  }

  // Zone de saisie du code OTP : visible uniquement quand le robot est en pause
  // et attend un code (double authentification, ex. NetSoins).
  function otpBoxHtml(r) {
    if (!(r.otp && r.otp.awaiting)) return '';
    const prompt = r.otp.prompt
      ? escapeHtml(r.otp.prompt)
      : 'Une application demande un code de sécurité à usage unique reçu par e-mail.';
    return `<div class="otp-box">
      <div class="otp-h">🔐 Code de sécurité requis</div>
      <p>${prompt} Le robot est en pause : saisissez le code pour qu'il reprenne automatiquement.</p>
      <div class="otp-row"><input type="text" id="m-otp" maxlength="8" autocomplete="off" spellcheck="false" placeholder="Code (ex. 1u8fq)" /><button class="btn btn-primary btn-sm" id="m-otp-send">Valider le code</button></div>
      <span id="m-otp-out" class="otp-out"></span>
    </div>`;
  }

  function renderModal(r) {
    const payloadRows = Object.entries(r.payload || {}).map(([k, v]) => {
      const label = k.startsWith('_demandeur_') ? k.replace('_demandeur_', 'demandeur ') : k;
      return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(Array.isArray(v) ? v.join(', ') : v || '—')}</dd>`;
    }).join('');
    const logs = (r.logs || []).length
      ? r.logs.map((l) => {
          const t = new Date(l.at).toLocaleTimeString('fr-FR');
          const isStep = /^Étape\s+\d+\/\d+/.test(l.message || '');
          const isErr = /^(Erreur|Échec)/i.test(l.message || '');
          return `<div class="logline${isStep ? ' step' : ''}${isErr ? ' err' : ''}"><span class="t">${t}</span> ${escapeHtml(l.message)}</div>`;
        }).join('')
      : '<div class="logline">Aucune activité.</div>';
    const shots = (r.artifacts || []).length ? `<h4>Captures d’écran</h4><div class="shots">${r.artifacts.map((f) => { const u = `/artifacts/${encodeURIComponent(r.reference)}/${encodeURIComponent(f)}`; return `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="${escapeHtml(f)}" loading="lazy"/><span class="cap">${escapeHtml(f)}</span></a>`; }).join('')}</div>` : '';
    const emails = (r.emails || []).length ? `<h4>E-mail d'identifiants</h4>${r.emails.map((e) => `<div style="font-size:.88rem;padding:6px 0">${escapeHtml(e.to)} — ${statusBadge2(e.status)}</div>`).join('')}` : '';
    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap"><h3>${TYPE_TITRES[r.type] || 'Demande'} <span class="ref">${escapeHtml(r.reference)}</span></h3>${statusBadge(r.status)}</div>
      <p style="color:var(--muted);font-size:.85rem;margin-top:4px">${escapeHtml(r.app)} — déposée le ${formatDate(r.createdAt)}${r.finishedAt ? ' — traitée le ' + formatDate(r.finishedAt) : ''}${dureeRobotTexte(r)} — ${r.attempts} tentative(s)${r.demandeur ? ' — demandeur : ' + escapeHtml(r.demandeur) : ''}</p>
      ${r.ssoEmail || r.ip ? `<p style="color:var(--muted);font-size:.82rem;margin-top:2px">Traçabilité : ${r.ssoEmail ? 'déposée via Microsoft 365 (' + escapeHtml(r.ssoEmail) + ')' : 'sans SSO'}${r.ip ? ' — IP ' + escapeHtml(r.ip) : ''}</p>` : ''}
      ${adminProgressHtml(r)}
      ${otpBoxHtml(r)}
      ${r.login ? `<p style="margin-top:8px;font-size:.9rem">Identifiant attribué : <span class="ref" style="font-size:.9rem">${escapeHtml(r.login)}</span></p>` : ''}
      ${r.credentialLink ? `<p style="margin-top:6px;font-size:.88rem">Lien d'identifiants : ${r.credentialLink.viewedAt
          ? `<span class="badge st-terminee">Consulté</span> le ${formatDate(r.credentialLink.viewedAt)}${r.credentialLink.viewedBy ? ' par ' + escapeHtml(r.credentialLink.viewedBy) : ''}`
          : `<span class="badge st-en_attente">Non consulté</span> — expire le ${formatDate(r.credentialLink.expiresAt)}`}</p>` : ''}
      ${r.status === 'terminee' && r.login ? `<p style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" id="m-showcreds">Voir identifiant + mot de passe</button><button class="btn btn-ghost btn-sm" id="m-newlink">Régénérer un lien d'identifiants</button></p><div id="m-creds-out" style="font-size:.88rem;margin-top:4px"></div><span id="m-newlink-out" style="font-size:.82rem;color:var(--muted)"></span>` : ''}
      ${r.message ? `<p style="margin-top:8px;font-size:.9rem"><strong>Résultat :</strong> ${escapeHtml(r.message)}</p>` : ''}
      <h4>Informations saisies</h4><dl class="kv">${payloadRows}</dl>
      ${emails}
      <h4>Journal d’exécution</h4><div class="logbox">${logs}</div>${shots}
      <div class="form-nav" style="justify-content:flex-end;border:none;padding-top:16px;margin-top:8px;display:flex;gap:10px">${r.status === 'echec' ? `<button class="btn btn-ghost" id="m-retry">Relancer</button>` : ''}<button class="btn btn-primary" id="m-close">Fermer</button></div>`;
    modal.querySelector('#m-close').addEventListener('click', closeModal);
    const rt = modal.querySelector('#m-retry'); if (rt) rt.addEventListener('click', () => retry(r.id, rt));
    const otpBtn = modal.querySelector('#m-otp-send');
    if (otpBtn) {
      const input = modal.querySelector('#m-otp');
      const out = modal.querySelector('#m-otp-out');
      const send = async () => {
        const code = (input.value || '').trim();
        if (!/^[A-Za-z0-9]{4,8}$/.test(code)) { out.textContent = 'Code invalide (4 à 8 caractères alphanumériques).'; return; }
        otpBtn.disabled = true;
        try {
          await fetchJson(`/api/admin/requests/${r.id}/otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
          toast('Code transmis au robot');
          refreshDashboard();
        } catch (e) { out.textContent = e.message; otpBtn.disabled = false; }
      };
      otpBtn.addEventListener('click', send);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    }
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

  function typeBadge(type) {
    const [label, cls] = TYPE_BADGES[type] || TYPE_BADGES.creation;
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
      : '⚠ Envoi automatique indisponible : les e-mails restent ici, à transmettre manuellement.';
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

    let html = `<p style="color:var(--muted);font-size:.88rem;margin-bottom:16px">Personnalisez le formulaire de <b>${escapeHtml(formsData.name)}</b>. Les champs <span class="lock">auto</span> sont renseignés automatiquement : non supprimables. Ajoutez vos propres champs en bas.</p>`;
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
    const badge = o.isRobot ? '<span class="lock">auto</span>' : o.added ? '<span class="lock" style="color:var(--accent);background:var(--accent-soft);border-color:var(--line-2)">ajouté</span>' : '';
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
      <p style="color:var(--muted);font-size:.84rem;margin:4px 0 16px">Champ <code>${escapeHtml(name)}</code> (${escapeHtml(base.type)})${isRobot ? ' — champ automatique : le nom et le type sont verrouillés.' : ''}</p>
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

    let html = `<p style="color:var(--muted);font-size:.88rem;margin-bottom:16px">Étapes d’automatisation pour <b>${escapeHtml(scenData.name)}</b>. Les étapes critiques ne peuvent pas être désactivées (elles créent réellement le compte) mais leurs <b>sélecteurs</b> restent modifiables. Vous pouvez insérer des étapes personnalisées.</p>`;
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
      <td data-label="Identifiant"><b>${escapeHtml(u.username)}</b>${u.username === data.me ? ' <span style="color:var(--muted);font-size:.8rem">(vous)</span>' : ''}</td>
      <td data-label="Nom">${escapeHtml(u.display_name || '—')}</td>
      <td data-label="Dernière connexion">${u.last_login ? formatDate(u.last_login) : '—'}</td>
      <td data-label="État">${u.disabled ? '<span class="badge st-echec">Désactivé</span>' : '<span class="badge st-terminee">Actif</span>'}</td>
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
  // Référents autorisés
  // ========================================================================
  let referentsData = [];
  let referentApps = [];

  async function loadReferents() {
    let data;
    try { data = await fetchJson('/api/admin/referents'); }
    catch (e) { el('referents-rows').innerHTML = `<tr><td colspan="5" class="loading">${escapeHtml(e.message)}</td></tr>`; return; }
    referentsData = data.referents || [];
    referentApps = data.apps || [];
    renderReferents();
  }

  /**
   * Alerte d'habilitation. Deux cas se voient mal autrement : aucun référent
   * déclaré (personne ne peut déposer, le portail semble « cassé »), et un
   * référent sans établissement (il se connecte mais ne voit rien).
   */
  function alerteReferentsHtml(ref) {
    if (!ref.enforced) return '';
    const acces = ref.acces || { mode: 'liste' };

    // Mode « attributs » mal configuré : plus personne n'entre, sans que rien
    // ne l'explique côté utilisateur.
    if (acces.mode === 'attribut' && acces.configure === false) {
      return `<div class="alert alert-err" style="margin-bottom:18px">
        <b>Accès par attributs actif, mais aucune règle définie.</b> Personne ne peut entrer.
        Contactez votre prestataire pour compléter la configuration.</div>`;
    }
    // Hors mode « liste », l'absence de référent n'est pas un problème : la
    // porte est tenue par le SSO ou par les attributs.
    if (!ref.actifs && acces.mode === 'liste') {
      return `<div class="alert alert-err" style="margin-bottom:18px">
        <b>Aucun référent habilité.</b> Personne ne peut déposer de demande pour l'instant :
        le dépôt est réservé aux référents déclarés. Ajoutez-les dans
        <a href="#referents">Configuration → Référents</a>.</div>`;
    }
    if (ref.sansEtablissement) {
      return `<div class="alert alert-warn" style="margin-bottom:18px">
        <b>${ref.sansEtablissement} référent${ref.sansEtablissement > 1 ? 's' : ''} sans établissement.</b>
        ${ref.sansEtablissement > 1 ? 'Ils se connectent' : 'Il se connecte'} au portail mais ne
        ${ref.sansEtablissement > 1 ? 'voient' : 'voit'} aucun compte et ne peut rien déposer.
        Complétez ${ref.sansEtablissement > 1 ? 'leurs rattachements' : 'son rattachement'} dans
        <a href="#referents">Configuration → Référents</a>.</div>`;
    }
    return '';
  }

  function renderReferents() {
    el('referents-rows').innerHTML = referentsData.length
      ? referentsData.map((r) => {
          const name = `${r.prenom || ''} ${r.nom || ''}`.trim() || '—';
          // Code de l'application + libellé : deux établissements peuvent avoir
          // des noms très proches, le code les distingue sans ambiguïté.
          const etabs = r.etablissements.length
            ? r.etablissements
                .map((e) => `<span class="etab-tag"><code>${escapeHtml(e.value)}</code>${escapeHtml(e.label)}</span>`)
                .join(' ')
            : '<span style="color:var(--faint)">Aucun</span>';
          return `<tr>
            <td data-label="Référent"><b>${escapeHtml(name)}</b></td>
            <td data-label="E-mail"><span class="ref">${escapeHtml(r.email)}</span></td>
            <td data-label="Établissements" style="max-width:360px">${etabs}</td>
            <td data-label="État">${r.active ? '<span class="badge st-terminee">Actif</span>' : '<span class="badge st-echec">Inactif</span>'}</td>
            <td style="text-align:right;white-space:nowrap"><button class="btn btn-ghost btn-sm" data-edit="${r.id}">Modifier</button> <button class="btn btn-ghost btn-sm" data-del="${r.id}">Supprimer</button></td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="5" class="loading">Aucun référent. Ajoutez la ou les personnes habilitées par établissement.</td></tr>';
    for (const b of el('referents-rows').querySelectorAll('[data-edit]'))
      b.addEventListener('click', () => referentModal(referentsData.find((r) => String(r.id) === b.dataset.edit)));
    for (const b of el('referents-rows').querySelectorAll('[data-del]'))
      b.addEventListener('click', () => deleteReferentModal(b.dataset.del));
  }

  function referentModal(ref) {
    const editing = !!ref;
    const selected = new Set((ref?.etablissements || []).map((e) => `${e.appId}:${e.value}`));
    modal.classList.add('wide');
    const etabHtml = referentApps.map((app) => `
      <div style="margin-bottom:10px">
        ${referentApps.length > 1 ? `<div style="font-weight:600;font-size:.85rem;margin-bottom:6px">${escapeHtml(app.name)}</div>` : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;max-height:300px;overflow:auto;padding:4px 2px">
          ${app.establishments.map((e) => {
            const key = `${app.id}:${e.value}`;
            return `<label class="etab-opt" style="display:flex;gap:8px;align-items:center;font-size:.85rem;padding:3px 0;cursor:pointer"><input type="checkbox" data-app="${escapeHtml(app.id)}" value="${escapeHtml(e.value)}" ${selected.has(key) ? 'checked' : ''} /> <span><code class="etab-code">${escapeHtml(e.value)}</code> ${escapeHtml(e.label)}</span></label>`;
          }).join('')}
        </div>
      </div>`).join('');
    modal.innerHTML = `
      <h3>${editing ? 'Modifier le référent' : 'Nouveau référent'}</h3>
      <div class="form-grid" style="margin-top:14px">
        <label class="full">E-mail Microsoft 365${editing ? '' : ' <span class="req">*</span>'}<input class="inp" id="rf-email" type="email" autocomplete="off" value="${editing ? escapeHtml(ref.email) : ''}" ${editing ? 'readonly' : ''} placeholder="prenom.nom@adefresidences.com" /></label>
        <label>Prénom<input class="inp" id="rf-prenom" value="${editing ? escapeHtml(ref.prenom) : ''}" /></label>
        <label>Nom<input class="inp" id="rf-nom" value="${editing ? escapeHtml(ref.nom) : ''}" /></label>
        ${editing ? `<label class="full">État<select class="inp" id="rf-active"><option value="1" ${ref.active ? 'selected' : ''}>Actif</option><option value="0" ${!ref.active ? 'selected' : ''}>Inactif</option></select></label>` : ''}
      </div>
      <div style="margin-top:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><b style="font-size:.9rem">Établissements rattachés</b><input class="inp" id="rf-filter" placeholder="Filtrer…" style="max-width:220px" /></div>
        <div id="rf-etabs" style="margin-top:10px">${etabHtml || '<p style="color:var(--muted);font-size:.85rem">Aucun établissement disponible.</p>'}</div>
      </div>
      <div class="form-nav" style="justify-content:flex-end;border:none;padding-top:16px;display:flex;gap:8px"><button class="btn btn-ghost" id="m-close">Annuler</button><button class="btn btn-primary" id="rf-save">${editing ? 'Enregistrer' : 'Créer'}</button></div>`;
    backdrop.classList.add('show');
    modal.querySelector('#m-close').addEventListener('click', closeModal);
    const filter = modal.querySelector('#rf-filter');
    if (filter) filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      for (const lab of modal.querySelectorAll('.etab-opt')) lab.style.display = lab.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
    modal.querySelector('#rf-save').addEventListener('click', async () => {
      const etablissements = [...modal.querySelectorAll('#rf-etabs input[type=checkbox]:checked')].map((c) => ({ appId: c.dataset.app, value: c.value }));
      const payload = { nom: el('rf-nom').value.trim(), prenom: el('rf-prenom').value.trim(), etablissements };
      try {
        if (editing) {
          payload.active = el('rf-active').value === '1';
          await fetchJson(`/api/admin/referents/${ref.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          toast('Référent mis à jour');
        } else {
          payload.email = el('rf-email').value.trim();
          await fetchJson('/api/admin/referents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          toast('Référent créé');
        }
        closeModal(); loadReferents();
      } catch (e) { toast(e.message, true); }
    });
  }

  function deleteReferentModal(id) {
    const ref = referentsData.find((r) => String(r.id) === String(id));
    if (!ref) return;
    modal.classList.remove('wide');
    modal.innerHTML = `
      <h3>Supprimer ce référent&nbsp;?</h3>
      <p style="color:var(--muted);font-size:.9rem;margin-top:10px">${escapeHtml(`${ref.prenom || ''} ${ref.nom || ''}`.trim())} &lt;${escapeHtml(ref.email)}&gt; ne pourra plus déposer de demandes ni accéder à son espace personnel.</p>
      <div class="form-nav" style="justify-content:flex-end;border:none;padding-top:16px;display:flex;gap:8px"><button class="btn btn-ghost" id="m-close">Annuler</button><button class="btn btn-primary" id="rf-del" style="background:var(--danger);border-color:var(--danger)">Supprimer</button></div>`;
    backdrop.classList.add('show');
    modal.querySelector('#m-close').addEventListener('click', closeModal);
    modal.querySelector('#rf-del').addEventListener('click', async () => {
      try { await fetchJson(`/api/admin/referents/${id}`, { method: 'DELETE' }); toast('Référent supprimé'); closeModal(); loadReferents(); }
      catch (e) { toast(e.message, true); }
    });
  }

  // ========================================================================
  // Réglages
  // ========================================================================

  /**
   * Carte « Licence » : état, échéance, identifiant d'installation à
   * communiquer à l'éditeur, et champ pour coller la licence reçue.
   */
  const ACCES_LIBELLES = {
    tenant: ['Ouvert à tout le tenant Microsoft 365', 'st-terminee',
      'Toute personne qui se connecte avec un compte du tenant peut déposer des demandes, sur tous les établissements. Un référent déclaré reste, lui, limité à ses établissements.'],
    attribut: ['Selon les attributs du compte Microsoft', 'st-terminee',
      'Seuls les comptes dont le jeton porte l’attribut attendu entrent. Les autres sont refusés à la porte.'],
    liste: ['Référents déclarés uniquement', 'st-en_cours',
      'Seules les personnes inscrites dans Configuration → Référents peuvent déposer, sur leurs établissements.'],
  };

  /**
   * Politique d'accès + inspection des attributs réellement reçus.
   * Sans cette vue, impossible de savoir ce que le tenant du client émet :
   * rôles, groupes et attributs d'extension ne sortent que si Entra ID est
   * configuré pour les mettre dans le jeton.
   */
  function accesCardHtml(acces) {
    const [titre, cls, aide] = ACCES_LIBELLES[acces.mode] || ACCES_LIBELLES.tenant;
    const regles = (acces.regles || []).map((r) =>
      `<code>${escapeHtml(r.attribut)}${r.valeurs.length ? ` = ${r.valeurs.join(', ')}` : ''}</code>`).join(' ou ');
    return `
      <div class="card" style="margin-bottom:18px"><div class="ch"><h3>Qui a accès au portail</h3></div><div class="cb">
        <p style="font-size:.92rem"><span class="badge ${cls}">${escapeHtml(titre)}</span></p>
        <p style="font-size:.84rem;color:var(--muted);margin-top:8px">${escapeHtml(aide)}</p>
        ${acces.mode === 'attribut' ? (regles
    ? `<p style="font-size:.84rem;margin-top:10px">Règle appliquée : ${regles}</p>`
    : `<div class="alert alert-err" style="margin-top:10px"><b>Aucune règle définie</b> : personne ne peut entrer en l'état. Contactez votre prestataire.</div>`) : ''}

        <button class="btn btn-sm" id="acces-voir" style="margin-top:14px">Voir les attributs reçus des connexions SSO</button>
        <div id="acces-attributs" style="margin-top:14px"></div>
      </div></div>`;
  }

  /**
   * Marche à suivre côté Entra ID. Affichée dès qu'aucun attribut exploitable
   * n'arrive : sans elle, on reste devant un tableau vide (ou plein de
   * revendications techniques) sans savoir quoi faire.
   */
  function marcheASuivre(g) {
    // Le chemin le plus court vers les attributs personnalisés Exchange
    // (CustomAttribute1..15) est Microsoft Graph : les faire sortir dans le
    // jeton demande une configuration nettement plus délicate.
    if (g && g.actif === false) {
      return `<div class="alert alert-warn" style="margin-top:10px">
        <b>Aucun attribut exploitable dans ce jeton.</b>
        Microsoft n'en met que le strict minimum : les attributs personnalisés Exchange
        (<code>CustomAttribute1</code> à <code>15</code>), le service, la fonction ou le matricule
        n'y sont pas.
        <p style="margin-top:8px"><b>Le plus simple — les lire via Microsoft Graph :</b></p>
        <ol style="margin:6px 0 0 18px;line-height:1.7">
          <li>Entra ID → votre application → <i>API autorisées</i> → <i>Ajouter</i> →
            Microsoft Graph → <b>Autorisations d'application</b> → <code>User.Read.All</code>,
            puis <i>Accorder un consentement administrateur</i>.</li>
          <li>Demandez à votre prestataire d'activer la lecture des attributs, puis redémarrez le portail.</li>
          <li>Se déconnecter, se reconnecter, revenir ici : <code>extensionAttribute1</code> à
            <code>15</code>, <code>department</code>, <code>jobTitle</code>, <code>employeeId</code>
            apparaîtront avec leur règle prête à copier.</li>
        </ol>
        <p style="margin-top:8px">Autre voie, sans Graph : attribuer un <b>rôle d'application</b>
        aux comptes autorisés (<i>Rôles d'application</i> puis <i>Applications d'entreprise →
        Utilisateurs et groupes</i>) — le jeton portera <code>roles</code>.</p>
      </div>`;
    }
    if (g && g.dernierEchec) {
      return `<div class="alert alert-err" style="margin-top:10px">
        <b>Lecture Microsoft Graph en échec.</b> ${escapeHtml(g.dernierEchec.message)}
        <p style="margin-top:6px">Vérifiez la permission <b>d'application</b> <code>User.Read.All</code>
        et son consentement administrateur, puis reconnectez-vous.</p></div>`;
    }
    return `<div class="alert alert-warn" style="margin-top:10px">
      <b>Aucun attribut exploitable pour ce compte.</b> La lecture Graph est active, mais ce compte
      n'a aucun des champs interrogés renseigné
      (<code>extensionAttribute1..15</code>, <code>department</code>, <code>jobTitle</code>,
      <code>employeeId</code>…). Vérifiez la fiche de la personne dans l'annuaire.</div>`;
  }

  function attributsHtml(d) {
    if (!d.connexions) {
      return `<div class="alert alert-warn">Aucune connexion SSO enregistrée pour l'instant.
        Connectez-vous une fois au site avec votre compte Microsoft, puis revenez ici.</div>`;
    }
    const derniere = (d.dernieres || [])[0];
    return `
      ${derniere ? `<div class="card" style="margin-bottom:14px"><div class="ch"><h3>Dernière connexion</h3>
        <span class="hint">${escapeHtml(derniere.date || '')}</span></div><div class="cb">
        <p style="font-size:.92rem"><b>${escapeHtml(derniere.name || '')}</b> &lt;${escapeHtml(derniere.email || '')}&gt;</p>
        ${derniere.attributs.length ? `<div style="overflow-x:auto;margin-top:10px"><table class="data" style="margin:0"><thead><tr>
            <th>Attribut</th><th>Valeur(s) reçue(s)</th><th>Utilisable pour filtrer l'accès</th></tr></thead><tbody>
          ${derniere.attributs.map((a) => `<tr>
            <td><code>${escapeHtml(a.nom)}</code></td>
            <td>${a.valeurs.length ? a.valeurs.map((v) => `<code>${escapeHtml(v)}</code>`).join(' ') : escapeHtml(a.brut)}</td>
            <td>${a.utilisable
    ? '<span class="badge st-terminee">oui</span>'
    : '<span style="color:var(--muted)">technique — change à chaque connexion, inutilisable</span>'}</td>
          </tr>`).join('')}
        </tbody></table></div>` : ''}
        ${derniere.attributs.some((a) => a.utilisable) ? '' : marcheASuivre(d.graph)}
      </div></div>` : ''}
      <div class="card"><div class="ch"><h3>Vu sur les ${d.connexions} dernières connexions</h3></div><div class="cb">
        ${d.attributs.length ? `<div style="overflow-x:auto"><table class="data" style="margin:0"><thead><tr>
            <th>Attribut</th><th>Comptes</th><th>Valeurs les plus fréquentes</th></tr></thead><tbody>
          ${d.attributs.map((a) => `<tr>
            <td><code>${escapeHtml(a.attribut)}</code>${a.utilisable ? '' : ' <span class="badge st-en_attente">technique</span>'}</td>
            <td>${a.comptes}</td>
            <td>${a.valeurs.map((v) => `<code>${escapeHtml(v.valeur)}</code> <span style="color:var(--muted)">×${v.n}</span>`).join(' · ')}</td>
          </tr>`).join('')}
        </tbody></table></div>` : '<p style="font-size:.88rem;color:var(--muted)">Aucun attribut personnalisé dans les jetons reçus.</p>'}
      </div></div>`;
  }

  function licenceCardHtml(l) {
    const classes = { ok: 'st-terminee', warn: 'st-en_cours', danger: 'st-echec', info: 'st-en_attente' };
    const etiquette = `<span class="badge ${classes[l.niveau] || 'st-en_attente'}">${escapeHtml(l.titre || '—')}</span>`;
    const lignes = [];
    if (l.client) lignes.push(`Client : <b>${escapeHtml(l.client)}</b>`);
    if (l.debut || l.fin) lignes.push(`Validité : ${escapeHtml(l.debut || '?')} → ${escapeHtml(l.fin || '?')}`);
    if (l.joursRestants !== null && l.joursRestants !== undefined) lignes.push(`Reste : <b>${l.joursRestants} jour${l.joursRestants > 1 ? 's' : ''}</b>`);
    lignes.push(`Traitements automatiques : ${l.robot ? '<span class="badge st-terminee">actifs</span>' : '<span class="badge st-echec">suspendus</span>'}`);
    // Sans clé publique embarquée, aucune licence ne PEUT être installée : on
    // n'affiche pas un champ dont le bouton refuserait forcément. On explique
    // l'étape qui manque, avec la marche à suivre.
    const saisie = l.configuree === false
      ? `<div class="alert alert-warn" style="margin-top:14px;font-size:.86rem">
           <b>Cette installation n'est pas encore rattachée à une licence.</b>
           <p style="margin-top:6px">Contactez votre prestataire : la mise en service est à faire de son côté.
           D'ici là, le portail fonctionne sans limitation.</p>
         </div>`
      : `<label style="display:block;margin-top:14px;font-size:.86rem">Licence fournie par l'éditeur
           <textarea class="inp" id="lic-jeton" rows="6" spellcheck="false" placeholder="ALG1.…"
             style="margin-top:6px;font-family:var(--mono);font-size:.82rem;line-height:1.6;width:100%;min-height:130px;resize:vertical;word-break:break-all"></textarea>
         </label>
         <button class="btn btn-primary btn-sm" id="lic-save" style="margin-top:10px">Installer la licence</button>
         <p id="lic-erreur" style="color:var(--danger);font-size:.86rem;margin-top:8px"></p>`;
    return `
      <div class="card" style="margin-bottom:18px"><div class="ch"><h3>Licence</h3>${etiquette}</div><div class="cb">
        <p style="font-size:.92rem">${escapeHtml(l.message || '')}</p>
        <div style="font-size:.86rem;color:var(--muted);margin-top:10px;line-height:1.9">${lignes.join('<br />')}</div>
        <p style="font-size:.86rem;margin-top:14px">Identifiant de cette installation, à communiquer à l'éditeur :
          <span class="ref">${escapeHtml(l.installId || '—')}</span></p>
        ${l.empreinteCle ? `<p style="font-size:.82rem;color:var(--muted);margin-top:4px">Clé de l'éditeur : <span class="ref" style="font-size:.8rem">${escapeHtml(l.empreinteCle)}</span> — doit correspondre à celle de votre poste.</p>` : ''}
        ${saisie}
      </div></div>`;
  }

  async function loadSettings() {
    let s;
    try { s = await fetchJson('/api/admin/settings'); } catch (e) { el('settings-body').innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`; return; }
    const badge = (ok) => ok ? '<span class="badge st-terminee">Configuré</span>' : '<span class="badge st-en_attente">Non configuré</span>';
    const sec = s.security || {};
    const secAlerts = [];
    if (sec.defaultAdminPassword) secAlerts.push('Le compte « admin » utilise encore le mot de passe par défaut : changez-le immédiatement (Comptes admin → Mot de passe).');
    if (!sec.https) secAlerts.push('Le portail n’est pas servi en HTTPS : à activer impérativement en production (certificat + reverse proxy).');
    if (sec.https && !sec.cookieSecure) secAlerts.push('HTTPS détecté mais ADMIN_COOKIE_SECURE n’est pas à true : les cookies devraient être marqués « Secure ».');
    const navMeta = [['apps', 'Applications'], ['demarches', 'Démarches'], ['espace', 'Mon espace'], ['suivi', 'Suivre une demande'], ['admin', 'Administration']];
    const nav = s.nav || {};
    el('settings-body').innerHTML = `
      ${secAlerts.length ? `<div class="alert alert-err" style="margin-bottom:18px"><b>Sécurité :</b><ul style="margin:6px 0 0 18px">${secAlerts.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul></div>` : ''}
      ${licenceCardHtml(s.licence || {})}
      <div class="card" style="margin-bottom:18px"><div class="ch"><h3>Connexion aux applications</h3><span class="hint">compte utilisé par le robot</span></div>
        <div class="cb" id="ident-apps"><div class="loading">Chargement…</div></div></div>
      <div class="card" style="margin-bottom:18px"><div class="ch"><h3>Navigation du site public</h3><span class="hint">onglets visibles dans le menu</span></div><div class="cb">
        <p style="font-size:.84rem;color:var(--muted);margin-bottom:12px">Décochez un onglet pour le masquer du menu du site public (l'accès direct par l'URL reste possible). « Administration » est masqué par défaut. « Mon espace » n'apparaît de toute façon que pour les référents.</p>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${navMeta.map(([k, label]) => `<label style="display:flex;align-items:center;gap:10px;font-size:.92rem;cursor:pointer"><input type="checkbox" class="nav-toggle" data-key="${k}" ${nav[k] !== false ? 'checked' : ''} /> <span>${label}</span></label>`).join('')}
        </div>
        <button class="btn btn-primary btn-sm" id="nav-save" style="margin-top:16px">Enregistrer la navigation</button>
      </div></div>
      <div class="card" style="margin-bottom:18px"><div class="ch"><h3>Automatisation</h3></div><div class="cb">
        <p style="font-size:.92rem">Mode d'automatisation : <b>${s.automationMode === 'production' ? 'Production (vraies applications)' : 'Démonstration (console factice)'}</b></p>

        ${(() => {
    const w = s.worker || {};
    if (!w.parallele) return '';
    const actifs = Object.entries(w.enCours || {});
    return `<p style="font-size:.92rem;margin-top:12px">Traitement en parallèle : <b>${w.parallele} demande${w.parallele > 1 ? 's' : ''} au maximum</b>,
        1 par application.</p>
      <p style="font-size:.84rem;color:var(--muted);margin-top:6px">${actifs.length
    ? `En cours : ${actifs.map(([a, n]) => `${escapeHtml(a)} (${n})`).join(' · ')}`
    : 'Aucun robot en cours d’exécution.'}</p>`;
  })()}
      </div></div>
      <div class="card" style="margin-bottom:18px"><div class="ch"><h3>Connexion SSO Microsoft 365</h3></div><div class="cb">
        <p style="font-size:.92rem">État : ${s.sso && s.sso.required ? '<span class="badge st-terminee">Actif — accès réservé aux comptes ADEF</span>' : s.sso && s.sso.configured ? '<span class="badge st-en_attente">Configuré mais désactivé (SSO_REQUIRED=false)</span>' : '<span class="badge st-en_attente">Non configuré — site en accès libre</span>'}</p>

      </div></div>
      ${accesCardHtml(s.acces || {})}
      <div class="card" style="margin-bottom:18px"><div class="ch"><h3>Envoi d'e-mails (SMTP)</h3></div><div class="cb">
        <p style="font-size:.92rem">État : ${badge(s.smtp)}</p>
        <p style="font-size:.84rem;color:var(--muted);margin-top:6px">Sans envoi automatique, les e-mails restent en boîte d'envoi, à transmettre manuellement.</p>
      </div></div>
      <div class="card"><div class="ch"><h3>Applications</h3><span class="hint">configuration du mode production</span></div><div class="cb">
        ${s.apps.map((a) => `<div class="settings-app"><div style="flex:1"><b>${escapeHtml(a.name)}</b>${a.comingSoon ? ' <span class="badge st-en_attente">Bientôt</span>' : ''}</div><div class="st">${a.comingSoon ? '' : badge(a.configured)}</div></div>`).join('')}
      </div></div>`;

    const voir = el('acces-voir');
    if (voir) voir.addEventListener('click', async () => {
      const zone = el('acces-attributs');
      voir.disabled = true;
      zone.innerHTML = '<p style="font-size:.88rem;color:var(--muted)">Lecture des connexions…</p>';
      try {
        zone.innerHTML = attributsHtml(await fetchJson('/api/admin/sso/attributs'));
      } catch (e) {
        zone.innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`;
      } finally {
        voir.disabled = false;
      }
    });

    const licSave = el('lic-save');
    if (licSave) licSave.addEventListener('click', async () => {
      const champ = el('lic-jeton');
      const erreur = el('lic-erreur');
      erreur.textContent = '';
      licSave.disabled = true;
      try {
        await fetchJson('/api/admin/licence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jeton: champ.value }),
        });
        toast('Licence installée');
        loadSettings();
        majBandeauLicence();
      } catch (e) {
        erreur.textContent = e.message;
        licSave.disabled = false;
      }
    });

    // Identifiants des applications métiers : chargés après le rendu des
    // réglages, chaque application étant interrogée séparément.
    dessinerIdentifiants(s.apps || []);

    const navSave = el('nav-save');
    if (navSave) navSave.addEventListener('click', async () => {
      const cfg = {};
      for (const c of document.querySelectorAll('.nav-toggle')) cfg[c.dataset.key] = c.checked;
      try { await fetchJson('/api/admin/site-nav', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) }); toast('Navigation mise à jour'); }
      catch (e) { toast(e.message, true); }
    });
  }

  // ========================================================================
  // Identifiants des applications métiers
  //
  // Le compte de service appartient au client : il doit pouvoir le saisir et
  // le changer sans nous appeler. Les mots de passe ne redescendent jamais du
  // serveur — un champ laissé vide signifie « inchangé », pas « effacé ».
  // ========================================================================
  async function dessinerIdentifiants(apps) {
    const hote = el('ident-apps');
    if (!hote) return;
    if (!apps.length) { hote.innerHTML = '<p class="hint">Aucune application active.</p>'; return; }
    const etats = [];
    for (const a of apps) {
      try { etats.push(await fetchJson(`/api/admin/apps/${encodeURIComponent(a.id)}/identifiants`)); }
      catch { /* application indisponible : on n'affiche pas de bloc vide */ }
    }
    if (!etats.length) { hote.innerHTML = '<p class="hint">Aucune application active.</p>'; return; }
    hote.innerHTML = etats.map((e) => `
      <div class="ident-app" data-app="${escapeHtml(e.appId)}">
        <div class="ident-tete">
          <b>${escapeHtml(e.app)}</b>
          ${e.complet ? '<span class="badge st-terminee">Configurée</span>' : '<span class="badge st-en_attente">À renseigner</span>'}
        </div>
        <div class="form-grid">
          ${Object.entries(e.champs).map(([cle, c]) => `
            <label class="full">${escapeHtml(c.libelle)}
              <input class="inp" data-champ="${escapeHtml(cle)}"
                     type="${c.secret ? 'password' : 'text'}"
                     autocomplete="${c.secret ? 'new-password' : 'off'}"
                     value="${escapeHtml(c.valeur)}"
                     placeholder="${c.secret ? (c.renseigne ? 'inchangé — retapez pour modifier' : 'non renseigné') : escapeHtml(c.exemple || '')}" />
            </label>`).join('')}
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:12px">
          <button class="btn btn-primary btn-sm" data-enregistrer="${escapeHtml(e.appId)}" type="button">Enregistrer</button>
        </div>
      </div>`).join('');

    for (const b of hote.querySelectorAll('[data-enregistrer]')) {
      b.addEventListener('click', async () => {
        const bloc = b.closest('.ident-app');
        const corps = {};
        for (const champ of bloc.querySelectorAll('[data-champ]')) {
          // Un mot de passe laissé vide n'est pas envoyé : il reste tel quel.
          if (champ.type === 'password' && !champ.value) continue;
          corps[champ.dataset.champ] = champ.value;
        }
        b.disabled = true;
        try {
          const out = await fetchJson(`/api/admin/apps/${encodeURIComponent(b.dataset.enregistrer)}/identifiants`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
          });
          toast(out.modifies.length ? `Enregistré : ${out.modifies.join(', ')}` : 'Aucun changement');
          loadSettings();
        } catch (e) { toast(e.message, true); }
        b.disabled = false;
      });
    }
  }
})();
