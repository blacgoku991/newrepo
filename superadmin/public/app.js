'use strict';

/* Panel Smartfixx — script externe unique (CSP stricte, aucun inline). */

(function () {
  const el = (id) => document.getElementById(id);
  const echapper = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  async function api(url, options) {
    const r = await fetch(url, { credentials: 'same-origin', ...options });
    const corps = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401 && !location.pathname.includes('login')) location.href = '/login.html';
      const e = new Error(corps.error || `Erreur ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return corps;
  }
  const poster = (url, corps) => api(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps || {}),
  });

  // ==========================================================================
  // Connexion
  // ==========================================================================
  const form = el('form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = el('err');
      const btn = el('btn');
      err.hidden = true;
      btn.disabled = true;
      try {
        await poster('/api/login', { username: el('u').value, password: el('p').value });
        location.href = '/';
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        btn.disabled = false;
      }
    });
    return;
  }

  // ==========================================================================
  // Panel
  // ==========================================================================
  let parc = [];
  let echeances = [];
  let domaine = 'smartfixx.fr';

  const toast = (msg, erreur) => {
    const t = el('toast');
    t.textContent = msg;
    t.className = 'toast' + (erreur ? ' err' : '');
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.hidden = true; }, 3200);
  };

  const fermer = () => { el('fond').hidden = true; };
  function ouvrir(html, large) {
    el('modale').className = 'modale' + (large ? ' large' : '');
    el('modale').innerHTML = html;
    el('fond').hidden = false;
  }
  el('fond').addEventListener('click', (e) => { if (e.target === el('fond')) fermer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermer(); });

  const dateFr = (iso) => {
    const s = String(iso || '');
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
  };
  const dateHeure = (iso) => {
    const d = new Date(String(iso || '').replace(' ', 'T') + 'Z');
    return Number.isNaN(d.getTime()) ? '—'
      : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  /** État d'une licence, en une étiquette. */
  function etatLicence(lic) {
    if (!lic) return { cls: 'neutre', texte: 'Aucune licence' };
    const j = lic.joursRestants;
    if (j === null || j === undefined) return { cls: 'neutre', texte: 'Inconnu' };
    if (j < 0) return { cls: 'danger', texte: `Expirée depuis ${-j} j` };
    if (j === 0) return { cls: 'danger', texte: 'Expire aujourd’hui' };
    if (j <= 30) return { cls: 'attention', texte: `${j} j restants` };
    return { cls: 'ok', texte: `${j} j restants` };
  }

  // --- Onglets --------------------------------------------------------------
  for (const b of document.querySelectorAll('.onglet')) {
    b.addEventListener('click', () => {
      for (const x of document.querySelectorAll('.onglet')) x.classList.remove('actif');
      for (const v of document.querySelectorAll('.vue')) v.classList.remove('active');
      b.classList.add('actif');
      el('vue-' + b.dataset.vue).classList.add('active');
      if (b.dataset.vue === 'journal') chargerJournal();
      if (b.dataset.vue === 'cle') chargerCle();
    });
  }

  el('deconnexion').addEventListener('click', async () => {
    await poster('/api/logout').catch(() => {});
    location.href = '/login.html';
  });

  // --- Parc clients ---------------------------------------------------------
  async function charger() {
    let d;
    try { d = await api('/api/societes'); }
    catch (e) { el('liste').innerHTML = `<div class="alerte err">${echapper(e.message)}</div>`; return; }
    parc = d.societes;
    echeances = d.echeances;
    domaine = d.domaine || domaine;
    dessinerKpis();
    dessinerListe();
  }

  function dessinerKpis() {
    const actives = parc.filter((s) => !s.archivee);
    const avec = actives.filter((s) => s.licence);
    const bientot = avec.filter((s) => s.licence.joursRestants >= 0 && s.licence.joursRestants <= 30);
    const expirees = avec.filter((s) => s.licence.joursRestants < 0);
    const sans = actives.filter((s) => !s.licence);
    el('kpis').innerHTML = `
      <div class="kpi"><div class="v">${actives.length}</div><div class="l">Société${actives.length > 1 ? 's' : ''} active${actives.length > 1 ? 's' : ''}</div></div>
      <div class="kpi ok"><div class="v">${avec.length - bientot.length - expirees.length}</div><div class="l">Licence${avec.length - bientot.length - expirees.length > 1 ? 's' : ''} en cours</div></div>
      <div class="kpi attention"><div class="v">${bientot.length}</div><div class="l">À renouveler sous 30 j</div></div>
      <div class="kpi danger"><div class="v">${expirees.length + sans.length}</div><div class="l">Expirées ou sans licence</div></div>`;

    const urgentes = echeances.filter((e) => {
      const j = Math.ceil((new Date(e.fin + 'T00:00:00Z') - new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')) / 86400000);
      return j <= 30;
    });
    const box = el('alerte-echeances');
    if (!urgentes.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<b>À traiter :</b> ${urgentes.map((e) =>
      `${echapper(e.societe)} (${dateFr(e.fin)})`).join(' · ')}`;
  }

  function dessinerListe() {
    const q = el('recherche').value.trim().toLowerCase();
    const archivees = el('voir-archivees').checked;
    const vues = parc.filter((s) => {
      if (!archivees && s.archivee) return false;
      if (!q) return true;
      return `${s.nom} ${s.contactNom} ${s.contactEmail} ${s.notes}`.toLowerCase().includes(q);
    });
    if (!vues.length) {
      el('liste').innerHTML = `<div class="carte"><p class="aide">${parc.length ? 'Aucune société ne correspond.' : 'Aucune société enregistrée pour le moment.'}</p></div>`;
      return;
    }
    el('liste').innerHTML = `<div class="societes">${vues.map((s) => {
      const e = etatLicence(s.licence);
      return `<div class="carte societe${s.archivee ? ' archivee' : ''}">
        <div class="tete">
          <div class="identite">
            ${s.logo
              ? `<img class="logo" src="/api/societes/${s.id}/logo" alt="" />`
              : `<span class="logo pastille">${echapper((s.nom || '?').charAt(0).toUpperCase())}</span>`}
            <div style="min-width:0">
            <div class="nom">${echapper(s.nom)}</div>
            <div class="contact">${echapper(s.contactNom || '—')}${s.contactEmail ? ' · ' + echapper(s.contactEmail) : ''}</div>
            </div>
          </div>
          <span class="etiq ${e.cls}">${echapper(e.texte)}</span>
        </div>
        <dl class="infos">
          <dt>Licence</dt><dd>${s.licence ? `du ${dateFr(s.licence.debut)} au <b>${dateFr(s.licence.fin)}</b>` : '<span class="aide">aucune émise</span>'}</dd>
          <dt>Adresse</dt><dd>${s.sousDomaine
            ? `<a href="https://${echapper(s.sousDomaine)}.${echapper(domaine)}" target="_blank" rel="noreferrer noopener">${echapper(s.sousDomaine)}.${echapper(domaine)}</a>`
            : '<span class="aide">aucun sous-domaine</span>'}</dd>
          <dt>Portail</dt><dd>${s.instance && s.instance.enMarche
            ? `<span class="etiq ok">En marche</span>`
            : `<span class="etiq neutre">Arrêté</span>`}</dd>
          <dt>Historique</dt><dd>${s.nbLicences} licence(s)</dd>
        </dl>
        <div class="actions">
          <button class="btn primaire" data-emettre="${s.id}" type="button">${s.licence ? 'Renouveler' : 'Émettre une licence'}</button>
          <button class="btn" data-historique="${s.id}" type="button">Historique</button>
          <button class="btn discret" data-modifier="${s.id}" type="button">Modifier</button>
          ${s.instance && s.instance.enMarche
            ? `<button class="btn discret" data-instance="arreter" data-sid="${s.id}" type="button">Arrêter</button>
               <button class="btn discret" data-instance="redemarrer" data-sid="${s.id}" type="button">Redémarrer</button>`
            : `<button class="btn discret" data-instance="demarrer" data-sid="${s.id}" type="button">Démarrer</button>`}
          <button class="btn discret" data-archiver="${s.id}" type="button">${s.archivee ? 'Réactiver' : 'Archiver'}</button>
        </div>
      </div>`;
    }).join('')}</div>`;

    for (const b of el('liste').querySelectorAll('[data-emettre]')) b.addEventListener('click', () => emettre(Number(b.dataset.emettre)));
    for (const b of el('liste').querySelectorAll('[data-historique]')) b.addEventListener('click', () => historique(Number(b.dataset.historique)));
    for (const b of el('liste').querySelectorAll('[data-modifier]')) b.addEventListener('click', () => fiche(Number(b.dataset.modifier)));
    for (const b of el('liste').querySelectorAll('[data-archiver]')) b.addEventListener('click', () => archiver(Number(b.dataset.archiver)));
    for (const b of el('liste').querySelectorAll('[data-instance]')) {
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await poster(`/api/societes/${b.dataset.sid}/instance/${b.dataset.instance}`);
          toast({ demarrer: 'Portail démarré', arreter: 'Portail arrêté', redemarrer: 'Portail redémarré' }[b.dataset.instance]);
        } catch (e) { toast(e.message, true); }
        // Le démarrage prend un instant : on laisse l'instance s'installer
        // avant de relire l'état, sinon la carte annonce « arrêté » à tort.
        setTimeout(charger, 1200);
      });
    }
  }

  el('recherche').addEventListener('input', dessinerListe);
  el('voir-archivees').addEventListener('change', dessinerListe);
  el('nouvelle').addEventListener('click', () => fiche(null));

  // --- Fiche société --------------------------------------------------------
  function fiche(id) {
    const s = id ? parc.find((x) => x.id === id) : null;
    ouvrir(`
      <h2>${s ? 'Modifier la société' : 'Nouvelle société'}</h2>
      <p class="aide">Le nom apparaîtra dans la licence et sur le portail du client. Le sous-domaine donne son adresse ; laissé vide, il est déduit du nom.</p>
      <div class="grille" style="margin-top:16px">
        <label class="pleine">Nom de la société<input type="text" id="f-nom" value="${echapper(s ? s.nom : '')}" /></label>
        <label>Contact<input type="text" id="f-contact" value="${echapper(s ? s.contactNom : '')}" /></label>
        <label>E-mail<input type="email" id="f-email" value="${echapper(s ? s.contactEmail : '')}" /></label>
        <label class="pleine">Sous-domaine
          <span class="champ-suffixe">
            <input type="text" id="f-sd" placeholder="adef" value="${echapper(s ? s.sousDomaine : '')}" />
            <span class="suffixe">.${echapper(domaine)}</span>
          </span>
        </label>
        <label class="pleine">Notes<textarea id="f-notes">${echapper(s ? s.notes : '')}</textarea></label>
      </div>
      ${s ? `<div class="bloc-logo">
        <div class="apercu" id="f-apercu">${s.logo
          ? `<img src="/api/societes/${s.id}/logo?t=${Date.now()}" alt="" />`
          : `<span class="pastille">${echapper((s.nom || '?').charAt(0).toUpperCase())}</span>`}</div>
        <div style="min-width:0">
          <div style="font-size:.86rem;font-weight:600;margin-bottom:4px">Logo</div>
          <p class="aide">PNG, JPEG ou WebP, 512 ko maximum. Le SVG est refusé : il peut contenir du script.</p>
          <div style="display:flex;gap:8px;margin-top:9px;flex-wrap:wrap">
            <button class="btn" id="f-logo-choisir" type="button">Choisir une image</button>
            ${s.logo ? '<button class="btn discret danger" id="f-logo-suppr" type="button">Retirer</button>' : ''}
          </div>
          <input type="file" id="f-logo" accept="image/png,image/jpeg,image/webp" hidden />
        </div>
      </div>` : '<p class="aide" style="margin-top:14px">Le logo pourra être ajouté après la création.</p>'}
      <div class="alerte err" id="f-err" hidden></div>
      <div class="pied">
        <button class="btn discret" id="f-annuler" type="button">Annuler</button>
        <button class="btn primaire" id="f-ok" type="button">${s ? 'Enregistrer' : 'Créer'}</button>
      </div>`);
    el('f-annuler').addEventListener('click', fermer);
    if (s) brancherLogo(s);
    el('f-ok').addEventListener('click', async () => {
      const corps = {
        nom: el('f-nom').value.trim(),
        contactNom: el('f-contact').value.trim(),
        contactEmail: el('f-email').value.trim(),
        sousDomaine: el('f-sd').value.trim(),
        notes: el('f-notes').value.trim(),
      };
      try {
        if (s) await api(`/api/societes/${s.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
        else await poster('/api/societes', corps);
        fermer();
        toast(s ? 'Société modifiée' : 'Société créée');
        charger();
      } catch (ex) {
        el('f-err').textContent = ex.message;
        el('f-err').hidden = false;
      }
    });
  }

  /**
   * Envoi du logo : lu par le navigateur en data URI, puis validé côté serveur
   * sur ses octets réels — l'extension et le type déclaré ne prouvent rien.
   */
  function brancherLogo(s) {
    const champ = el('f-logo');
    const choisir = el('f-logo-choisir');
    const suppr = el('f-logo-suppr');
    if (!champ || !choisir) return;
    choisir.addEventListener('click', () => champ.click());
    champ.addEventListener('change', () => {
      const fichier = champ.files && champ.files[0];
      if (!fichier) return;
      if (fichier.size > 512 * 1024) {
        return toast(`Image trop lourde (${Math.round(fichier.size / 1024)} ko). Maximum 512 ko.`, true);
      }
      const lecteur = new FileReader();
      lecteur.onload = async () => {
        try {
          await api(`/api/societes/${s.id}/logo`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: lecteur.result }),
          });
          el('f-apercu').innerHTML = `<img src="/api/societes/${s.id}/logo?t=${Date.now()}" alt="" />`;
          toast('Logo enregistré');
          charger();
        } catch (ex) { toast(ex.message, true); }
      };
      lecteur.readAsDataURL(fichier);
    });
    if (suppr) suppr.addEventListener('click', async () => {
      try {
        await api(`/api/societes/${s.id}/logo`, { method: 'DELETE' });
        el('f-apercu').innerHTML = `<span class="pastille">${echapper((s.nom || '?').charAt(0).toUpperCase())}</span>`;
        suppr.remove();
        toast('Logo retiré');
        charger();
      } catch (ex) { toast(ex.message, true); }
    });
  }

  async function archiver(id) {
    const s = parc.find((x) => x.id === id);
    if (!s) return;
    try {
      await poster(`/api/societes/${id}/archiver`, { archivee: !s.archivee });
      toast(s.archivee ? 'Société réactivée' : 'Société archivée');
      charger();
    } catch (e) { toast(e.message, true); }
  }

  // --- Émission d'une licence -----------------------------------------------
  function emettre(id) {
    const s = parc.find((x) => x.id === id);
    if (!s) return;
    // Un renouvellement part du lendemain de l'échéance en cours : le client ne
    // doit pas se retrouver avec un trou entre deux licences.
    const debut = s.licence && s.licence.joursRestants >= 0
      ? new Date(new Date(s.licence.fin + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const fin = new Date(new Date(debut + 'T00:00:00Z').setFullYear(new Date(debut + 'T00:00:00Z').getFullYear() + 1))
      .toISOString().slice(0, 10);
    ouvrir(`
      <h2>${s.licence ? 'Renouveler' : 'Émettre'} — ${echapper(s.nom)}</h2>
      ${s.licence ? `<p class="aide">Licence en cours jusqu'au <b>${dateFr(s.licence.fin)}</b>. Elle reste valable jusqu'à son terme : la nouvelle prend le relais.</p>` : ''}
      <div class="grille" style="margin-top:16px">
        <label>Début<input type="date" id="l-debut" value="${debut}" /></label>
        <label>Fin<input type="date" id="l-fin" value="${fin}" /></label>
        <label class="pleine">Tolérance après échéance (jours)<input type="number" id="l-grace" min="0" max="365" placeholder="valeur par défaut du produit" /></label>
      </div>
      <div class="alerte err" id="l-err" hidden></div>
      <div class="pied">
        <button class="btn discret" id="l-annuler" type="button">Annuler</button>
        <button class="btn primaire" id="l-ok" type="button">Émettre</button>
      </div>`);
    el('l-annuler').addEventListener('click', fermer);
    el('l-ok').addEventListener('click', async () => {
      const grace = el('l-grace').value;
      try {
        const out = await poster(`/api/societes/${s.id}/licences`, {
          debut: el('l-debut').value,
          fin: el('l-fin').value,
          ...(grace === '' ? {} : { grace: Number(grace) }),
        });
        montrerJeton(s.nom, out);
        if (out.instance && !out.instance.ok) toast(`Portail non démarré : ${out.instance.raison}`, true);
        setTimeout(charger, 1200);
      } catch (ex) {
        el('l-err').textContent = ex.message;
        el('l-err').hidden = false;
      }
    });
  }

  function montrerJeton(nom, lic) {
    ouvrir(`
      <h2>Licence émise — ${echapper(nom)}</h2>
      <p class="aide">Valable du <b>${dateFr(lic.debut)}</b> au <b>${dateFr(lic.fin)}</b>. À coller dans les Réglages du portail du client. Elle reste consultable dans l'historique.</p>
      <div class="champ-copie">
        <textarea id="j-jeton" readonly>${echapper(lic.jeton)}</textarea>
        <button class="btn" id="j-copier" type="button">Copier</button>
      </div>
      <div class="pied"><button class="btn primaire" id="j-fermer" type="button">Fermer</button></div>`, true);
    el('j-copier').addEventListener('click', () => {
      navigator.clipboard.writeText(lic.jeton).then(() => toast('Licence copiée'), () => {
        el('j-jeton').select();
        toast('Sélectionnée : copiez avec Ctrl+C', true);
      });
    });
    el('j-fermer').addEventListener('click', fermer);
  }

  // --- Historique -----------------------------------------------------------
  async function historique(id) {
    let d;
    try { d = await api(`/api/societes/${id}/licences`); }
    catch (e) { return toast(e.message, true); }
    ouvrir(`
      <h2>Historique — ${echapper(d.societe.nom)}</h2>
      <div class="tableau" style="margin-top:14px">
        <table class="donnees">
          <thead><tr><th>Période</th><th>Émise le</th><th>Par</th><th>Motif</th><th>État</th><th></th></tr></thead>
          <tbody>${d.licences.length ? d.licences.map((l) => `<tr>
            <td data-intitule="Période">${dateFr(l.debut)} → <b>${dateFr(l.fin)}</b></td>
            <td data-intitule="Émise le">${dateHeure(l.emiseLe)}</td>
            <td data-intitule="Par">${echapper(l.emisePar || '—')}</td>
            <td data-intitule="Motif">${l.motif === 'renouvellement' ? 'Renouvellement' : 'Création'}</td>
            <td data-intitule="État">${l.revoqueeLe
              ? `<span class="etiq danger">Révoquée</span>`
              : `<span class="etiq ok">Valide</span>`}</td>
            <td><button class="btn discret" data-voir="${l.id}" type="button">Voir</button>${
              l.revoqueeLe ? '' : ` <button class="btn discret danger" data-revoquer="${l.id}" type="button">Révoquer</button>`}</td>
          </tr>`).join('') : '<tr><td colspan="6" class="vide">Aucune licence émise.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="pied"><button class="btn discret" id="h-fermer" type="button">Fermer</button></div>`, true);
    el('h-fermer').addEventListener('click', fermer);
    for (const b of el('modale').querySelectorAll('[data-voir]')) {
      b.addEventListener('click', () => {
        const l = d.licences.find((x) => x.id === Number(b.dataset.voir));
        montrerJeton(d.societe.nom, l);
      });
    }
    for (const b of el('modale').querySelectorAll('[data-revoquer]')) {
      b.addEventListener('click', () => revoquer(Number(b.dataset.revoquer), d.societe));
    }
  }

  function revoquer(id, societe) {
    ouvrir(`
      <h2>Révoquer la licence</h2>
      <p class="alerte attention">La licence déjà installée chez le client <b>reste valable jusqu'à sa date de fin</b> : la vérification se fait hors ligne, sans nous appeler. La révocation marque la fin du contrat côté registre — pour couper l'accès immédiatement, il faut arrêter son instance.</p>
      <label style="display:flex;flex-direction:column;gap:6px;margin-top:14px;font-size:.85rem">Motif
        <input type="text" id="r-motif" placeholder="Résiliation, non-paiement, erreur d'émission…" /></label>
      <div class="alerte err" id="r-err" hidden></div>
      <div class="pied">
        <button class="btn discret" id="r-annuler" type="button">Annuler</button>
        <button class="btn danger" id="r-ok" type="button">Révoquer</button>
      </div>`);
    el('r-annuler').addEventListener('click', () => historique(societe.id));
    el('r-ok').addEventListener('click', async () => {
      try {
        await poster(`/api/licences/${id}/revoquer`, { motif: el('r-motif').value.trim() });
        toast('Licence révoquée');
        charger();
        historique(societe.id);
      } catch (ex) {
        el('r-err').textContent = ex.message;
        el('r-err').hidden = false;
      }
    });
  }

  // --- Journal --------------------------------------------------------------
  let entrees = [];
  const LIBELLES = {
    connexion: 'Connexion', echec_connexion: 'Échec de connexion',
    societe_creee: 'Société créée', societe_modifiee: 'Société modifiée',
    societe_archivee: 'Société archivée', societe_reactivee: 'Société réactivée',
    licence_emise: 'Licence émise', licence_revoquee: 'Licence révoquée',
  };
  async function chargerJournal() {
    try { entrees = (await api('/api/journal')).entrees; }
    catch (e) { el('journal-lignes').innerHTML = `<tr><td colspan="6" class="vide">${echapper(e.message)}</td></tr>`; return; }
    dessinerJournal();
  }
  function dessinerJournal() {
    const q = el('recherche-journal').value.trim().toLowerCase();
    const lignes = entrees.filter((e) => !q ||
      `${e.acteur} ${LIBELLES[e.action] || e.action} ${e.cible} ${e.details} ${e.ip}`.toLowerCase().includes(q));
    el('journal-lignes').innerHTML = lignes.length ? lignes.map((e) => `<tr>
      <td data-intitule="Date">${dateHeure(e.created_at)}</td>
      <td data-intitule="Opérateur"><b>${echapper(e.acteur || '—')}</b></td>
      <td data-intitule="Action">${echapper(LIBELLES[e.action] || e.action)}</td>
      <td data-intitule="Société">${echapper(e.cible || '—')}</td>
      <td data-intitule="Détails">${echapper(e.details || '—')}</td>
      <td data-intitule="IP">${echapper(e.ip || '—')}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="vide">Aucune entrée.</td></tr>';
  }
  el('recherche-journal').addEventListener('input', dessinerJournal);

  // --- Clé ------------------------------------------------------------------
  async function chargerCle() {
    try {
      const d = await api('/api/cle');
      el('cle-publique').textContent = d.publique;
      el('cle-empreinte').textContent = d.empreinte;
    } catch (e) { toast(e.message, true); }
  }
  el('copier-cle').addEventListener('click', () => {
    navigator.clipboard.writeText(el('cle-publique').textContent).then(
      () => toast('Clé publique copiée'), () => toast('Copie impossible', true));
  });

  // --- Démarrage ------------------------------------------------------------
  api('/api/moi').then((m) => { el('qui').textContent = m.username; }).catch(() => {});
  charger();
})();
