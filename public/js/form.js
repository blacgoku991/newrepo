'use strict';

/*
 * Formulaire multi-étapes généré dynamiquement depuis le schéma de l'application.
 * Une seule page sert tous les formulaires : /demande.html?app=<id>
 *
 * Déroulé : une étape par section du schéma, puis une étape « Récapitulatif »
 * avant l'envoi. Les valeurs sont conservées quand on navigue entre les étapes.
 */

(async function () {
  const content = document.getElementById('content');
  const params = new URLSearchParams(location.search);
  const appId = params.get('app');
  // Modes : création (défaut), réinitialisation de mot de passe, ajout d'établissement.
  const resetMode = params.get('type') === 'reset';
  const extensionMode = params.get('type') === 'extension';
  const typeQS = resetMode ? '?type=reset' : extensionMode ? '?type=extension' : '';

  if (!appId) {
    content.innerHTML = `<div class="alert alert-error">Aucune application sélectionnée. <a href="/">Retour à l'accueil</a></div>`;
    return;
  }

  let app;
  try {
    app = await fetchJson(`/api/apps/${encodeURIComponent(appId)}/schema${typeQS}`);
  } catch (err) {
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}. <a href="/">Retour à l'accueil</a></div>`;
    return;
  }

  // Le schéma vient de l'API (source unique de vérité : le backend inclut
  // déjà la section « demandeur »). Aucun schéma local dupliqué.
  document.title = `${app.name} — ${resetMode ? 'Réinitialisation de mot de passe' : extensionMode ? 'Ajout d’établissement' : 'Demande de compte'}`;

  const sections = app.schema.sections;
  const stepCount = sections.length + 1; // + récapitulatif
  const values = {};
  for (const s of sections) {
    for (const f of s.fields) values[f.name] = f.type === 'checkboxes' ? [] : '';
  }

  // Connexion SSO Microsoft 365 : l'identité du demandeur est préremplie et
  // verrouillée (c'est elle qui fait foi côté serveur).
  const lockedFields = new Set();
  try {
    const me = await fetchJson('/api/sso/me');
    if (me.user) {
      values._demandeur_nom = me.user.name || '';
      values._demandeur_email = me.user.email || '';
      lockedFields.add('_demandeur_nom');
      lockedFields.add('_demandeur_email');
    }
  } catch {
    /* SSO non configuré : champs demandeur libres */
  }

  // Mode « plusieurs comptes » : chaque entrée est un jeu de valeurs complet
  // déjà validé. Le compte en cours de saisie est dans `values`.
  const batch = [];
  // Champs propres à la personne, remis à zéro quand on ajoute un autre compte.
  const PERSON_FIELDS = ['civilite', 'nom', 'prenom', 'email'];

  let current = 0;

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const PHONE_RE = /^[0-9+().\s-]{6,20}$/;

  render();

  // -------------------------------------------------------------------------

  // Étapes verticales, affichées dans le panneau latéral sombre.
  function stepperHtml() {
    const items = [
      ...sections.map((s, i) => ({ label: s.title, index: i })),
      { label: 'Récapitulatif', index: sections.length },
    ];
    return `<div class="vstepper">
      ${items
        .map((item) => {
          const state = item.index < current ? 'done' : item.index === current ? 'active' : '';
          const dot = item.index < current ? icon('check') : String(item.index + 1);
          return `<div class="s ${state}"><span class="m"><span class="dot">${dot}</span><span class="lnk"></span></span><span class="lbl">${escapeHtml(item.label)}</span></div>`;
        })
        .join('')}
    </div>`;
  }

  function render() {
    const isRecap = current === sections.length;
    content.innerHTML = `
      <div class="form-layout">
        <aside class="form-side">
          <div class="form-head">
            ${appVisual(app)}
            <div>
              <h2>${escapeHtml(app.name)}</h2>
              <div class="cat">${resetMode ? 'Réinitialisation de mot de passe' : extensionMode ? 'Ajout d’établissement' : escapeHtml(app.category)}</div>
            </div>
          </div>
          ${stepperHtml()}
          <div class="aside-note">${resetMode
            ? `Algonis vérifie l'identifiant sur la fiche ${escapeHtml(app.name)} puis remplace le mot de passe par un provisoire, remis par lien sécurisé.`
            : extensionMode
              ? `Algonis rattache l'établissement supplémentaire au compte existant (identifiant vérifié), avec les droits de la fonction indiquée.`
              : `Algonis saisit ces informations dans ${escapeHtml(app.name)}. Une référence de suivi vous est remise à l'envoi.`}</div>
        </aside>
        <div class="panel form-main">
        ${current === 0 && app.schema.intro ? `<div class="intro">${escapeHtml(app.schema.intro)}</div>` : ''}
        <form id="step-form" novalidate>
          <div class="step-panel">
            ${isRecap ? recapHtml() : sectionHtml(sections[current])}
          </div>
          <div class="form-nav">
            <div>
              ${current > 0 ? `<button type="button" class="btn btn-ghost" id="prev-btn">← Précédent</button>` : `<a href="/" class="btn btn-ghost">Annuler</a>`}
            </div>
            <div>
              ${
                isRecap
                  ? `<button type="button" class="btn btn-ghost" id="add-account-btn">+ Ajouter un compte à créer</button>
                     <button type="submit" class="btn btn-primary" id="submit-btn">Envoyer la demande${batch.length ? ` (${batch.length + 1} comptes)` : ''}</button>`
                  : `<button type="submit" class="btn btn-primary">Continuer ${icon('arrow')}</button>`
              }
            </div>
          </div>
        </form>
        </div>
      </div>`;

    const form = document.getElementById('step-form');
    if (!isRecap) restoreSectionValues(sections[current], form);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (isRecap) return submit();
      saveSectionValues(sections[current], form);
      const errors = validateSection(sections[current]);
      if (Object.keys(errors).length > 0) return showErrors(errors);
      current++;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    const prev = document.getElementById('prev-btn');
    if (prev)
      prev.addEventListener('click', () => {
        if (!isRecap) saveSectionValues(sections[current], form);
        current--;
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

    if (isRecap) {
      for (const btn of content.querySelectorAll('[data-goto]')) {
        btn.addEventListener('click', () => {
          current = Number(btn.dataset.goto);
          render();
        });
      }
      // « + Ajouter un compte à créer » : le compte courant (déjà validé étape
      // par étape) est mis de côté, et on ressaisit l'identité du suivant.
      // Établissement, fonction, dates et demandeur sont conservés.
      document.getElementById('add-account-btn').addEventListener('click', () => {
        batch.push(JSON.parse(JSON.stringify(values)));
        for (const name of PERSON_FIELDS) {
          if (name in values) values[name] = Array.isArray(values[name]) ? [] : '';
        }
        current = 0;
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      for (const btn of content.querySelectorAll('[data-remove-batch]')) {
        btn.addEventListener('click', () => {
          batch.splice(Number(btn.dataset.removeBatch), 1);
          render();
        });
      }
    }
  }

  // --- Rendu d'une section --------------------------------------------------

  function sectionHtml(section) {
    return `
      <h3 class="sh">${escapeHtml(section.title)}</h3>
      <div class="grid2">${section.fields.map(fieldHtml).join('')}</div>`;
  }

  function fieldHtml(field) {
    const req = field.required ? ' <span class="req">*</span>' : '';
    const isWide = ['textarea', 'radio', 'checkboxes'].includes(field.type);
    const help = field.help ? `<span class="help">${escapeHtml(field.help)}</span>` : '';
    let control = '';

    switch (field.type) {
      case 'select':
        control = `
          <select name="${escapeHtml(field.name)}">
            <option value="">— Sélectionner —</option>
            ${field.options.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('')}
          </select>`;
        break;
      case 'radio':
        control = `
          <div class="choices">
            ${field.options
              .map(
                (o) => `
              <label class="choice">
                <input type="radio" name="${escapeHtml(field.name)}" value="${escapeHtml(o.value)}" />
                <span>${escapeHtml(o.label)}</span>
              </label>`
              )
              .join('')}
          </div>`;
        break;
      case 'checkboxes':
        control = `
          <div class="choices">
            ${field.options
              .map(
                (o) => `
              <label class="choice">
                <input type="checkbox" name="${escapeHtml(field.name)}" value="${escapeHtml(o.value)}" />
                <span>${escapeHtml(o.label)}</span>
              </label>`
              )
              .join('')}
          </div>`;
        break;
      case 'textarea':
        control = `<textarea name="${escapeHtml(field.name)}" placeholder="${escapeHtml(field.placeholder || '')}"></textarea>`;
        break;
      default: {
        // Champ texte, avec liste de suggestions (datalist) si `suggestions` fourni :
        // l'utilisateur choisit dans la liste OU saisit une valeur libre.
        const hasList = Array.isArray(field.suggestions) && field.suggestions.length > 0;
        const listId = `dl-${field.name}`;
        const datalist = hasList
          ? `<datalist id="${escapeHtml(listId)}">${field.suggestions
              .map((s) => `<option value="${escapeHtml(s)}"></option>`)
              .join('')}</datalist>`
          : '';
        const locked = lockedFields.has(field.name) ? ' readonly title="Rempli automatiquement depuis votre connexion Microsoft 365"' : '';
        control = `<input type="${escapeHtml(field.type)}" name="${escapeHtml(field.name)}" placeholder="${escapeHtml(field.placeholder || '')}"${hasList ? ` list="${escapeHtml(listId)}" autocomplete="off"` : ''}${locked} />${datalist}`;
      }
    }

    return `
      <div class="field ${isWide ? 'full' : ''}" data-field="${escapeHtml(field.name)}">
        <label>${escapeHtml(field.label)}${req}</label>
        ${control}
        ${help}
        <span class="err"></span>
      </div>`;
  }

  // --- Valeurs & validation -------------------------------------------------

  function saveSectionValues(section, form) {
    for (const field of section.fields) {
      if (field.type === 'checkboxes') {
        values[field.name] = [...form.querySelectorAll(`input[name="${escapeHtml(field.name)}"]:checked`)].map((el) => el.value);
      } else if (field.type === 'radio') {
        const checked = form.querySelector(`input[name="${escapeHtml(field.name)}"]:checked`);
        values[field.name] = checked ? checked.value : '';
      } else {
        values[field.name] = form.elements[field.name].value.trim();
      }
    }
  }

  function restoreSectionValues(section, form) {
    for (const field of section.fields) {
      const value = values[field.name];
      if (field.type === 'checkboxes') {
        for (const v of value) {
          const el = form.querySelector(`input[name="${escapeHtml(field.name)}"][value="${CSS.escape(v)}"]`);
          if (el) el.checked = true;
        }
      } else if (field.type === 'radio') {
        if (value) {
          const el = form.querySelector(`input[name="${escapeHtml(field.name)}"][value="${CSS.escape(value)}"]`);
          if (el) el.checked = true;
        }
      } else if (form.elements[field.name]) {
        form.elements[field.name].value = value;
      }
    }
  }

  function validateSection(section) {
    const errors = {};
    for (const field of section.fields) {
      const value = values[field.name];
      if (field.type === 'checkboxes') {
        if (field.required && value.length === 0) errors[field.name] = 'Sélectionnez au moins une option';
        continue;
      }
      if (!value) {
        if (field.required) errors[field.name] = 'Ce champ est obligatoire';
        continue;
      }
      if (field.type === 'email' && !EMAIL_RE.test(value)) errors[field.name] = 'Adresse e-mail invalide';
      if (field.type === 'tel' && !PHONE_RE.test(value)) errors[field.name] = 'Numéro de téléphone invalide';
      if (field.pattern && !new RegExp(field.pattern).test(value)) {
        errors[field.name] = field.patternMessage || 'Format invalide';
      }
    }
    return errors;
  }

  function showErrors(fields) {
    for (const el of content.querySelectorAll('.field.invalid')) el.classList.remove('invalid');
    for (const [name, message] of Object.entries(fields)) {
      const wrapper = content.querySelector(`.field[data-field="${name}"]`);
      if (!wrapper) continue;
      wrapper.classList.add('invalid');
      wrapper.querySelector('.err').textContent = message;
    }
    const first = content.querySelector('.field.invalid');
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // --- Récapitulatif --------------------------------------------------------

  function displayValue(field) {
    const value = values[field.name];
    if (field.type === 'checkboxes') {
      if (value.length === 0) return '—';
      return value
        .map((v) => field.options.find((o) => o.value === v)?.label || v)
        .join(', ');
    }
    if (field.type === 'select' || field.type === 'radio') {
      return field.options.find((o) => o.value === value)?.label || value || '—';
    }
    if (field.type === 'date' && value) {
      return new Date(value + 'T00:00:00').toLocaleDateString('fr-FR');
    }
    return value || '—';
  }

  function batchListHtml() {
    if (batch.length === 0) return '';
    return `
      <div class="recap-block">
        <div class="rh"><span>Comptes déjà ajoutés à cette demande (${batch.length})</span></div>
        <dl>
          ${batch
            .map((v, i) => {
              const who = `${v.prenom || ''} ${v.nom || ''}`.trim() || `Compte ${i + 1}`;
              return `<dt>${escapeHtml(who)}</dt><dd style="display:flex;justify-content:space-between;gap:10px"><span>${escapeHtml(v.fonction || '')}</span><button type="button" class="btn btn-ghost btn-sm" data-remove-batch="${i}">Retirer</button></dd>`;
            })
            .join('')}
        </dl>
      </div>`;
  }

  function recapHtml() {
    return `
      <h3 class="sh">Vérifiez votre demande</h3>
      <div class="recap-note">Relisez attentivement : ces informations seront saisies telles quelles dans ${escapeHtml(app.name)}.${batch.length ? ` <strong>${batch.length + 1} comptes</strong> seront créés (une référence de suivi par compte).` : ''}</div>
      ${batchListHtml()}
      ${sections
        .map(
          (section, i) => `
        <div class="recap-block">
          <div class="rh">
            <span>${escapeHtml(section.title)}</span>
            <button type="button" data-goto="${i}">Modifier</button>
          </div>
          <dl>
            ${section.fields
              .map((f) => `<dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(displayValue(f))}</dd>`)
              .join('')}
          </dl>
        </div>`
        )
        .join('')}`;
  }

  // --- Envoi ----------------------------------------------------------------

  async function submit() {
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Envoi en cours…';

    // Tous les comptes de la demande : ceux mis de côté + celui en cours.
    const comptes = [...batch, JSON.parse(JSON.stringify(values))];
    const references = [];

    for (let i = 0; i < comptes.length; i++) {
      const compte = comptes[i];
      const who = `${compte.prenom || ''} ${compte.nom || ''}`.trim() || `compte ${i + 1}`;
      try {
        const result = await fetchJson(`/api/apps/${encodeURIComponent(app.id)}/requests${typeQS}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(compte),
        });
        references.push({ reference: result.reference, who });
      } catch (err) {
        btn.disabled = false;
        btn.innerHTML = `Envoyer la demande${batch.length ? ` (${batch.length + 1} comptes)` : ''}`;
        // Les comptes déjà envoyés le restent : on prévient précisément.
        const sent = references.length
          ? ` Les ${references.length} premiers comptes ont bien été enregistrés (${references.map((r) => r.reference).join(', ')}).`
          : '';
        if (err.status === 422 && err.body.fields && i === comptes.length - 1) {
          const fieldNames = Object.keys(err.body.fields);
          const idx = sections.findIndex((s) => s.fields.some((f) => fieldNames.includes(f.name)));
          current = idx >= 0 ? idx : 0;
          render();
          showErrors(err.body.fields);
          if (sent) alert(sent.trim());
        } else {
          alert(`Erreur sur ${who} : ${err.message}.${sent}`);
        }
        return;
      }
    }
    showConfirmation(references);
  }

  function showConfirmation(references) {
    document.title = 'Demande envoyée — Algonis';
    const many = references.length > 1;
    content.innerHTML = `
      <div class="panel result">
        <div class="big">${icon('check')}</div>
        <h2>${many ? `${references.length} demandes enregistrées` : 'Demande enregistrée'}&nbsp;!</h2>
        <p>${many ? 'Vos demandes de comptes' : 'Votre demande de compte'} <strong>${escapeHtml(app.name)}</strong> ${many ? 'sont' : 'est'} dans la file de traitement.<br/>
        Elles vont être prises en charge dans quelques instants.</p>
        ${references
          .map(
            (r) => `
        <div class="refbox">
          <span>${escapeHtml(r.reference)}</span>
          ${many ? `<span style="color:var(--muted);font-size:.85rem">${escapeHtml(r.who)}</span>` : ''}
          <button type="button" class="copy-ref" data-ref="${escapeHtml(r.reference)}">Copier</button>
        </div>`
          )
          .join('')}
        <p>${many ? 'Conservez ces références : chacune permet de suivre l’avancement du compte correspondant.' : 'Conservez cette référence : elle permet de suivre l’avancement de votre demande.'}</p>
        <div class="form-nav" style="justify-content:center;border:none;padding-top:10px">
          <a class="btn btn-primary" href="/suivi.html?ref=${encodeURIComponent(references[0].reference)}">Suivre ${many ? 'la première demande' : 'ma demande'} ${icon('arrow')}</a>
          <a class="btn btn-ghost" href="/">Retour à l'accueil</a>
        </div>
      </div>`;
    for (const btn of content.querySelectorAll('.copy-ref')) {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.ref);
          btn.textContent = 'Copié ✓';
          setTimeout(() => (btn.textContent = 'Copier'), 2000);
        } catch {
          /* presse-papier indisponible : sans gravité */
        }
      });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
})();
