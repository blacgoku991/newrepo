'use strict';

/* ============================================================================
   Console éditeur Algonis — interface locale.
   Pas de framework, pas de script en ligne (CSP stricte) : tout passe par
   la délégation d'événements et des gabarits construits en JS.
   ========================================================================== */

(() => {
  /* ---------------------------------------------------------- Session --- */
  // Le jeton arrive dans le fragment (#jeton=…) : il ne part jamais dans une
  // requête HTTP ni dans les journaux. On le range puis on nettoie l'URL.
  let JETON = sessionStorage.getItem('algonisJeton') || '';
  const dansHash = /jeton=([a-f0-9]+)/.exec(location.hash || '');
  if (dansHash) {
    JETON = dansHash[1];
    sessionStorage.setItem('algonisJeton', JETON);
    history.replaceState(null, '', location.pathname);
  }

  /* ---------------------------------------------------------- Outillage - */
  const $ = (sel) => document.querySelector(sel);
  const el = { kpis: $('#kpis'), liste: $('#liste'), etatCles: $('#etatCles'), q: $('#q'),
    filtres: $('#filtres'), modale: $('#modale'), modaleTitre: $('#modaleTitre'),
    modaleCorps: $('#modaleCorps'), toast: $('#toast') };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ICONES = {
    chevron: '<path d="M7 4l6 6-6 6"/>',
    alerte: '<path d="M10 3 2 17h16L10 3zM10 8v4M10 14.5v.5"/>',
    info: '<circle cx="10" cy="10" r="7.5"/><path d="M10 9v5M10 6.5v.5"/>',
    cle: '<circle cx="7" cy="13" r="3.5"/><path d="m9.5 10.5 7-7M14 6l2 2"/>',
    copie: '<rect x="7" y="7" width="9" height="9" rx="2"/><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>',
    plus: '<path d="M10 4v12M4 10h12"/>',
    crayon: '<path d="m13.5 3.5 3 3L7 16H4v-3z"/>',
    corbeille: '<path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L14 6"/>',
    import: '<path d="M10 3v9M6.5 8.5 10 12l3.5-3.5M4 15v2h12v-2"/>',
    renouv: '<path d="M16 10a6 6 0 1 1-1.8-4.3M16 3v3h-3"/>',
  };
  const icone = (nom, cls = '') => `<svg class="${cls}" viewBox="0 0 20 20" aria-hidden="true">${ICONES[nom]}</svg>`;

  const dateFr = (iso) => {
    if (!iso) return '—';
    const d = new Date(String(iso).length <= 10 ? `${iso}T12:00:00` : iso);
    return Number.isNaN(d.getTime()) ? esc(iso)
      : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  let minuteurToast;
  function toast(message, type = 'ok') {
    el.toast.textContent = message;
    el.toast.className = `toast ${type}`;
    el.toast.hidden = false;
    clearTimeout(minuteurToast);
    minuteurToast = setTimeout(() => { el.toast.hidden = true; }, 4200);
  }

  async function api(chemin, options = {}) {
    const rep = await fetch(`/api${chemin}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-Console-Jeton': JETON, ...(options.headers || {}) },
    });
    const corps = await rep.json().catch(() => ({}));
    if (!rep.ok) throw new Error(corps.erreur || `Erreur ${rep.status}`);
    return corps;
  }

  async function copier(texte, bouton) {
    try {
      await navigator.clipboard.writeText(texte);
    } catch {
      const zone = document.createElement('textarea');
      zone.value = texte;
      zone.style.position = 'fixed';
      zone.style.opacity = '0';
      document.body.appendChild(zone);
      zone.select();
      document.execCommand('copy');
      zone.remove();
    }
    toast('Licence copiée dans le presse-papiers.');
    if (bouton) {
      const avant = bouton.innerHTML;
      bouton.innerHTML = 'Copié';
      setTimeout(() => { bouton.innerHTML = avant; }, 1600);
    }
  }

  /* ------------------------------------------------------------- État --- */
  let DONNEES = { societes: [], resume: {}, cles: {} };
  let filtre = 'tous';
  let recherche = '';
  const ouvertes = new Set();

  /* ---------------------------------------------------------- Rendu ----- */
  function rendreCles() {
    const c = DONNEES.cles || {};
    const morceaux = [];
    if (!c.clePrivee) {
      morceaux.push('<span class="badge expiree">Clé privée absente</span>');
    } else {
      morceaux.push(`<span class="badge info">${icone('cle')}Empreinte ${esc(c.empreinte || '—')}</span>`);
    }
    el.etatCles.innerHTML = morceaux.join('');
  }

  function rendreKpis() {
    const r = DONNEES.resume || {};
    const cartes = [
      { titre: 'Sociétés livrées', valeur: r.total || 0, cls: '' },
      { titre: 'Licences actives', valeur: r.actives || 0, cls: 'ok' },
      { titre: 'À renouveler sous 30 j', valeur: r.bientot || 0, cls: 'warn' },
      { titre: 'Expirées ou sans licence', valeur: (r.expirees || 0) + (r.sansLicence || 0), cls: 'danger' },
    ];
    el.kpis.innerHTML = cartes.map((c) => `
      <div class="kpi ${c.cls}">
        <div class="valeur">${c.valeur}</div>
        <div class="titre">${esc(c.titre)}</div>
      </div>`).join('');
  }

  function filtrer() {
    const q = recherche.trim().toLowerCase();
    return DONNEES.societes.filter((s) => {
      if (filtre !== 'tous' && s.statut.code !== filtre) return false;
      if (!q) return true;
      return [s.nom, s.contact, s.installId, s.note].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }

  function rendreListe() {
    const societes = filtrer();
    if (!DONNEES.societes.length) {
      el.liste.innerHTML = `
        <div class="vide">
          <strong>Aucune société enregistrée</strong>
          Ajoutez la première société à qui vous avez livré le portail :
          la console gardera l'historique de ses licences et vous préviendra avant l'échéance.
        </div>`;
      return;
    }
    if (!societes.length) {
      el.liste.innerHTML = '<div class="vide"><strong>Aucun résultat</strong>Modifiez la recherche ou le filtre.</div>';
      return;
    }
    el.liste.innerHTML = societes.map(carte).join('');
  }

  function carte(s) {
    const ouverte = ouvertes.has(s.id);
    const st = s.statut;
    return `
      <article class="carte ${ouverte ? 'ouverte' : ''}" data-societe="${esc(s.id)}">
        <button type="button" class="ligne" data-basculer="${esc(s.id)}" aria-expanded="${ouverte}">
          <span>
            <span class="nom">${esc(s.nom)}</span>
            <span class="sous">
              ${s.installId ? `<span>Installation ${esc(s.installId)}</span>` : '<span>Installation non renseignée</span>'}
              ${s.contact ? `<span>· ${esc(s.contact)}</span>` : ''}
            </span>
          </span>
          <span class="echeance">${st.fin ? `Échéance ${dateFr(st.fin)}` : ''}</span>
          <span class="badge ${st.code}">${esc(st.libelle)}</span>
          ${icone('chevron', 'chevron')}
        </button>
        ${ouverte ? detail(s) : ''}
      </article>`;
  }

  function detail(s) {
    const c = s.courante;
    return `
      <div class="detail">
        <div class="detail-tete">
          <button type="button" class="btn primaire petit" data-action="licence" data-id="${esc(s.id)}">
            ${icone('renouv')}${c ? 'Renouveler la licence' : 'Générer une licence'}
          </button>
          <button type="button" class="btn discret petit" data-action="importer" data-id="${esc(s.id)}">
            ${icone('import')}Enregistrer une licence déjà émise
          </button>
          <button type="button" class="btn discret petit" data-action="editer" data-id="${esc(s.id)}">
            ${icone('crayon')}Modifier la fiche
          </button>
          <button type="button" class="btn danger petit" data-action="supprimer" data-id="${esc(s.id)}">
            ${icone('corbeille')}Supprimer
          </button>
        </div>

        <dl class="meta">
          <div><dt>Identifiant d'installation</dt><dd class="code">${esc(s.installId || 'non renseigné')}</dd></div>
          <div><dt>Contact</dt><dd>${esc(s.contact || '—')}</dd></div>
          <div><dt>Licence en cours</dt><dd>${c ? `du ${dateFr(c.debut)} au ${dateFr(c.fin)}` : 'aucune'}</dd></div>
          <div><dt>Licences émises</dt><dd class="num">${(s.licences || []).length}</dd></div>
        </dl>

        ${s.note ? `<p class="alerte info">${icone('info')}<span>${esc(s.note)}</span></p>` : ''}

        ${(s.licences || []).length ? `
          <div class="tableau-enveloppe">
            <table>
              <thead><tr>
                <th scope="col">Émise le</th><th scope="col">Début</th><th scope="col">Fin</th>
                <th scope="col">Tolérance</th><th scope="col">Installation</th>
                <th scope="col">Note</th><th scope="col">Licence</th>
              </tr></thead>
              <tbody>${s.licences.map(ligneLicence).join('')}</tbody>
            </table>
          </div>` : '<div class="vide">Aucune licence émise pour cette société.</div>'}
      </div>`;
  }

  function ligneLicence(l) {
    return `
      <tr>
        <td class="num">${dateFr(l.emis)}</td>
        <td class="num">${dateFr(l.debut)}</td>
        <td class="num">${dateFr(l.fin)}</td>
        <td class="num">${l.grace ? `${l.grace} j` : 'aucune'}</td>
        <td class="code">${esc(l.install || 'non liée')}</td>
        <td class="note">${esc(l.note || '—')}</td>
        <td><button type="button" class="btn discret petit" data-action="voir-jeton" data-jeton="${esc(l.jeton)}">
          ${icone('copie')}Voir / copier</button></td>
      </tr>`;
  }

  function rendre() {
    rendreCles();
    rendreKpis();
    rendreListe();
  }

  async function recharger() {
    try {
      DONNEES = await api('/etat');
      rendre();
    } catch (e) {
      el.liste.innerHTML = `<div class="vide"><strong>Console injoignable</strong>${esc(e.message)}</div>`;
    }
  }

  /* --------------------------------------------------------- Modales ---- */
  let fermetureFocus = null;

  function ouvrirModale(titre, html) {
    fermetureFocus = document.activeElement;
    el.modaleTitre.textContent = titre;
    el.modaleCorps.innerHTML = html;
    el.modale.hidden = false;
    const premier = el.modaleCorps.querySelector('input, textarea, select, button');
    if (premier) premier.focus();
  }

  function fermerModale() {
    el.modale.hidden = true;
    el.modaleCorps.innerHTML = '';
    if (fermetureFocus && document.contains(fermetureFocus)) fermetureFocus.focus();
  }

  const champ = (id, libelle, attrs = '', aide = '', requis = false) => `
    <label class="champ" for="${id}">
      <span>${esc(libelle)}${requis ? ' <b class="requis">*</b>' : ''}</span>
      <input id="${id}" ${attrs}>
      ${aide ? `<span class="aide">${aide}</span>` : ''}
    </label>`;

  function formSociete(s) {
    const v = s || {};
    return `
      <form id="formSociete" data-id="${esc(v.id || '')}" novalidate>
        ${champ('fNom', 'Nom de la société', `value="${esc(v.nom || '')}" maxlength="120" required autocomplete="off"`,
    "Tel qu'il apparaîtra dans le panneau du client.", true)}
        ${champ('fInstall', "Identifiant d'installation", `value="${esc(v.installId || '')}" maxlength="64" autocomplete="off" placeholder="A1B2-C3D4-E5F6-7890"`,
    'Le client le lit dans Administration → Réglages → Licence. Il lie la licence à cette installation.')}
        ${champ('fContact', 'Contact', `value="${esc(v.contact || '')}" maxlength="160" autocomplete="off" placeholder="prenom.nom@societe.fr"`)}
        <label class="champ" for="fNote"><span>Note interne</span>
          <textarea id="fNote" maxlength="500" placeholder="N° de commande, conditions, interlocuteur…">${esc(v.note || '')}</textarea>
        </label>
        <p class="erreur-champ" id="erreurSociete" hidden></p>
        <div class="actions">
          <button type="button" class="btn discret" data-fermer>Annuler</button>
          <button type="submit" class="btn primaire">${v.id ? 'Enregistrer' : 'Créer la société'}</button>
        </div>
      </form>`;
  }

  function formLicence(s) {
    const c = s.courante;
    const dansUnAn = new Date();
    dansUnAn.setFullYear(dansUnAn.getFullYear() + 1);
    const finProposee = c && c.fin >= DONNEES.aujourdhui
      ? (() => { const d = new Date(`${c.fin}T12:00:00`); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); })()
      : dansUnAn.toISOString().slice(0, 10);
    const debutPropose = c && c.fin >= DONNEES.aujourdhui
      ? new Date(Date.parse(`${c.fin}T12:00:00`) + 86400000).toISOString().slice(0, 10)
      : DONNEES.aujourdhui;

    return `
      ${!DONNEES.cles.clePrivee ? `<p class="alerte danger">${icone('alerte')}<span>
        Aucune clé privée sur ce poste (<code>${esc(DONNEES.cles.dossier)}</code>).
        Lancez d'abord <code>node scripts/licence-keygen.js</code>.</span></p>` : ''}
      ${!s.installId ? `<p class="alerte">${icone('alerte')}<span>
        Aucun identifiant d'installation : la licence fonctionnera sur <strong>n'importe quelle</strong>
        installation. À réserver aux dépannages.</span></p>` : ''}
      <form id="formLicence" data-id="${esc(s.id)}" novalidate>
        <div class="duo">
          ${champ('lDebut', 'Début de validité', `type="date" value="${esc(debutPropose)}"`)}
          ${champ('lFin', 'Fin de validité', `type="date" value="${esc(finProposee)}" required`, '', true)}
        </div>
        ${champ('lInstall', "Identifiant d'installation", `value="${esc(s.installId || '')}" maxlength="64" autocomplete="off" placeholder="laisser vide = licence non liée"`)}
        <div class="duo">
          ${champ('lGrace', 'Tolérance après échéance (jours)', 'type="number" min="0" max="365" step="1" value="0"',
    'Par défaut 0 : la licence s’arrête le jour dit.')}
          ${champ('lNote', 'Référence interne', 'maxlength="200" autocomplete="off" placeholder="Devis 2026-118"')}
        </div>
        <p class="erreur-champ" id="erreurLicence" hidden></p>
        <div class="actions">
          <button type="button" class="btn discret" data-fermer>Annuler</button>
          <button type="submit" class="btn primaire" ${DONNEES.cles.clePrivee ? '' : 'disabled'}>Générer la licence</button>
        </div>
      </form>`;
  }

  function vueJeton(jeton, charge) {
    return `
      ${charge ? `<p class="alerte info">${icone('info')}<span><strong>${esc(charge.client)}</strong> — valable du ${dateFr(charge.debut)} au ${dateFr(charge.fin)}${charge.install ? `, liée à l'installation <code>${esc(charge.install)}</code>` : ', non liée à une installation'}.</span></p>` : ''}
      <p style="color:var(--muted);font-size:.86rem;margin-bottom:12px">
        À transmettre au client : il la colle dans Administration → Réglages → Licence.
        Ce n'est pas un secret — elle ne fonctionne que sur son installation.
      </p>
      <div class="jeton" id="jetonTexte">${esc(jeton)}</div>
      <div class="actions">
        <button type="button" class="btn discret" data-fermer>Fermer</button>
        <button type="button" class="btn primaire" data-action="copier" data-jeton="${esc(jeton)}">
          ${icone('copie')}Copier la licence
        </button>
      </div>`;
  }

  function formImport(s) {
    return `
      <p style="color:var(--muted);font-size:.88rem;margin-bottom:12px">
        Collez une licence déjà envoyée à <strong>${esc(s.nom)}</strong> pour la faire figurer dans l'historique.
        Sa signature est vérifiée avec votre clé publique.
      </p>
      <form id="formImport" data-id="${esc(s.id)}" novalidate>
        <label class="champ" for="iJeton"><span>Licence (une seule ligne) <b class="requis">*</b></span>
          <textarea id="iJeton" required placeholder="ALG1.eyJ2IjoxLCJjbGllbnQiOi…" style="min-height:120px;font-family:var(--mono);font-size:.8rem"></textarea>
        </label>
        <p class="erreur-champ" id="erreurImport" hidden></p>
        <div class="actions">
          <button type="button" class="btn discret" data-fermer>Annuler</button>
          <button type="submit" class="btn primaire">Enregistrer dans l'historique</button>
        </div>
      </form>`;
  }

  function confirmationSuppression(s) {
    return `
      <p class="alerte danger">${icone('alerte')}<span>
        La fiche de <strong>${esc(s.nom)}</strong> et l'historique de ses ${(s.licences || []).length} licence(s)
        seront retirés de la console. <strong>Les licences déjà installées chez le client continuent de fonctionner</strong> :
        cette suppression ne concerne que votre suivi.</span></p>
      <div class="actions">
        <button type="button" class="btn discret" data-fermer>Annuler</button>
        <button type="button" class="btn danger" data-action="supprimer-confirme" data-id="${esc(s.id)}">Supprimer la fiche</button>
      </div>`;
  }

  const societeParId = (id) => DONNEES.societes.find((s) => s.id === id);

  /* ------------------------------------------------------ Événements ---- */
  document.addEventListener('click', async (ev) => {
    const cible = ev.target.closest('[data-basculer], [data-action], [data-fermer], [data-filtre]');
    if (!cible) return;

    if (cible.hasAttribute('data-fermer')) return fermerModale();

    if (cible.hasAttribute('data-filtre')) {
      filtre = cible.getAttribute('data-filtre');
      el.filtres.querySelectorAll('.puce').forEach((p) => p.classList.toggle('actif', p === cible));
      return rendreListe();
    }

    if (cible.hasAttribute('data-basculer')) {
      const id = cible.getAttribute('data-basculer');
      if (ouvertes.has(id)) ouvertes.delete(id); else ouvertes.add(id);
      return rendreListe();
    }

    const action = cible.getAttribute('data-action');
    const s = societeParId(cible.getAttribute('data-id'));

    if (action === 'copier' || action === 'voir-jeton') {
      const jeton = cible.getAttribute('data-jeton');
      if (action === 'copier') return copier(jeton, cible);
      return ouvrirModale('Licence', vueJeton(jeton, null));
    }
    if (action === 'editer' && s) return ouvrirModale('Modifier la fiche', formSociete(s));
    if (action === 'licence' && s) return ouvrirModale(`Licence — ${s.nom}`, formLicence(s));
    if (action === 'importer' && s) return ouvrirModale('Enregistrer une licence existante', formImport(s));
    if (action === 'supprimer' && s) return ouvrirModale('Supprimer la fiche', confirmationSuppression(s));
    if (action === 'supprimer-confirme' && s) {
      try {
        await api(`/societes/${s.id}`, { method: 'DELETE' });
        ouvertes.delete(s.id);
        fermerModale();
        toast('Fiche supprimée.');
        await recharger();
      } catch (e) { toast(e.message, 'ko'); }
    }
  });

  document.getElementById('btnNouvelle').addEventListener('click', () => {
    ouvrirModale('Nouvelle société', formSociete(null));
  });

  el.q.addEventListener('input', () => { recherche = el.q.value; rendreListe(); });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !el.modale.hidden) fermerModale();
  });

  function erreurForm(id, message) {
    const zone = document.getElementById(id);
    if (!zone) return;
    zone.textContent = message;
    zone.hidden = !message;
  }

  document.addEventListener('submit', async (ev) => {
    const form = ev.target;
    ev.preventDefault();
    const bouton = form.querySelector('button[type="submit"]');
    if (bouton) bouton.disabled = true;

    try {
      if (form.id === 'formSociete') {
        const corps = {
          nom: form.querySelector('#fNom').value.trim(),
          installId: form.querySelector('#fInstall').value.trim(),
          contact: form.querySelector('#fContact').value.trim(),
          note: form.querySelector('#fNote').value,
        };
        if (!corps.nom) throw new Error('Le nom de la société est obligatoire.');
        const id = form.getAttribute('data-id');
        if (id) {
          await api(`/societes/${id}`, { method: 'PATCH', body: JSON.stringify(corps) });
          toast('Fiche mise à jour.');
        } else {
          const cree = await api('/societes', { method: 'POST', body: JSON.stringify(corps) });
          ouvertes.add(cree.societe.id);
          toast('Société créée.');
        }
        fermerModale();
        await recharger();
      }

      if (form.id === 'formLicence') {
        const id = form.getAttribute('data-id');
        const corps = {
          debut: form.querySelector('#lDebut').value,
          fin: form.querySelector('#lFin').value,
          install: form.querySelector('#lInstall').value.trim(),
          grace: Number(form.querySelector('#lGrace').value || 0),
          note: form.querySelector('#lNote').value.trim(),
        };
        if (!corps.fin) throw new Error('La date de fin est obligatoire.');
        const res = await api(`/societes/${id}/licences`, { method: 'POST', body: JSON.stringify(corps) });
        await recharger();
        ouvrirModale('Licence générée', vueJeton(res.jeton, res.charge));
      }

      if (form.id === 'formImport') {
        const id = form.getAttribute('data-id');
        const jeton = form.querySelector('#iJeton').value.trim();
        const res = await api(`/societes/${id}/licences/import`, { method: 'POST', body: JSON.stringify({ jeton }) });
        fermerModale();
        toast(res.doublon ? 'Cette licence était déjà enregistrée.' : 'Licence ajoutée à l’historique.');
        await recharger();
      }
    } catch (e) {
      const zones = { formSociete: 'erreurSociete', formLicence: 'erreurLicence', formImport: 'erreurImport' };
      erreurForm(zones[form.id], e.message);
      toast(e.message, 'ko');
    } finally {
      if (bouton && document.contains(bouton)) bouton.disabled = false;
    }
  });

  /* ------------------------------------------------------------ Départ -- */
  recharger();
})();
