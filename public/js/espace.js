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
        <h1>Accès référent non activé</h1>
        <p>${who ? `Bonjour ${who}. ` : ''}Votre compte n'est pas encore habilité comme référent d'un établissement.
        L'espace personnel est réservé aux référents désignés.</p>
        <p>Pour être ajouté, contactez votre administrateur Algonis.</p>
        <div class="hero-actions" style="justify-content:center;margin-top:22px">
          <a href="/" class="btn btn-ghost">Retour à l'accueil</a>
        </div>
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
        <p>Voici les comptes des établissements dont vous êtes référent. Vous pouvez réinitialiser un mot de passe ou ajouter un établissement à un compte existant en un clic.</p>
        ${chips}
      </div>

      <div class="esp-section-head">
        <h2>Comptes existants</h2>
        <span class="hint">${data.accounts.length} compte${data.accounts.length > 1 ? 's' : ''}</span>
      </div>
      <div id="accounts"></div>

      <div class="esp-section-head">
        <h2>Activité récente</h2>
        <a href="/demarches.html" class="btn btn-primary btn-sm">Nouvelle démarche ${icon('arrow')}</a>
      </div>
      <div id="activity"></div>`;

    renderAccounts(data.accounts);
    renderActivity(data.activity || []);
  }

  function renderAccounts(accounts) {
    const box = document.getElementById('accounts');
    if (!accounts.length) {
      box.innerHTML = `<div class="empty-box">Aucun compte créé pour vos établissements pour l'instant.
        <br />Les comptes apparaîtront ici dès qu'une création sera terminée.</div>`;
      return;
    }
    box.innerHTML =
      '<div class="acc-grid">' +
      accounts
        .map((a) => {
          const who = `${a.prenom} ${a.nom}`.trim() || a.login;
          const resetUrl = `/demande.html?app=${encodeURIComponent(a.appId)}&type=reset&identifiant=${encodeURIComponent(a.login)}&etablissement=${encodeURIComponent(a.etablissement)}`;
          const extUrl = `/demande.html?app=${encodeURIComponent(a.appId)}&type=extension&identifiant=${encodeURIComponent(a.login)}`;
          return `
          <div class="acc-card">
            <div class="top">
              <div>
                <div class="who">${escapeHtml(who)}</div>
                <div class="acc-login">${escapeHtml(a.login)}</div>
              </div>
              <span class="badge st-terminee">${escapeHtml(a.app)}</span>
            </div>
            <div class="meta">
              ${a.etablissementLabel ? `<div>${icon('building')} <b>${escapeHtml(a.etablissementLabel)}</b></div>` : ''}
              ${a.fonction ? `<div>Fonction : ${escapeHtml(a.fonction)}</div>` : ''}
            </div>
            <div class="actions">
              <a class="btn btn-ghost btn-sm" href="${resetUrl}">${icon('lock')} Réinitialiser</a>
              <a class="btn btn-ghost btn-sm" href="${extUrl}">${icon('building')} Ajouter un étab.</a>
            </div>
          </div>`;
        })
        .join('') +
      '</div>';
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
