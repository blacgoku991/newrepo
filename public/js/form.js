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
  const appId = new URLSearchParams(location.search).get('app');

  if (!appId) {
    content.innerHTML = `<div class="alert alert-error">Aucune application sélectionnée. <a href="/">Retour à l'accueil</a></div>`;
    return;
  }

  let app;
  try {
    app = await fetchJson(`/api/apps/${encodeURIComponent(appId)}/schema`);
  } catch (err) {
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}. <a href="/">Retour à l'accueil</a></div>`;
    return;
  }

  // Le schéma vient de l'API (source unique de vérité : le backend inclut
  // déjà la section « demandeur »). Aucun schéma local dupliqué.
  document.title = `${app.name} — Demande de compte`;

  const sections = app.schema.sections;
  const stepCount = sections.length + 1; // + récapitulatif
  const values = {};
  for (const s of sections) {
    for (const f of s.fields) values[f.name] = f.type === 'checkboxes' ? [] : '';
  }

  let current = 0;

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const PHONE_RE = /^[0-9+().\s-]{6,20}$/;

  render();

  // -------------------------------------------------------------------------

  function stepperHtml() {
    const items = [
      ...sections.map((s, i) => ({ label: s.title, index: i })),
      { label: 'Récapitulatif', index: sections.length },
    ];
    return `<div class="stepper">
      ${items
        .map((item) => {
          const state = item.index < current ? 'done' : item.index === current ? 'active' : '';
          const dot = item.index < current ? icon('check') : String(item.index + 1);
          return `<div class="s ${state}"><span class="dot">${dot}</span><span class="lbl">${escapeHtml(item.label)}</span></div>`;
        })
        .join('')}
    </div>`;
  }

  function render() {
    const isRecap = current === sections.length;
    content.innerHTML = `
      <div class="panel form-card">
        <div class="form-head">
          ${appVisual(app)}
          <div>
            <h2>${escapeHtml(app.name)}</h2>
            <div class="cat">${escapeHtml(app.category)}</div>
          </div>
        </div>
        ${current === 0 && app.schema.intro ? `<div class="intro">${escapeHtml(app.schema.intro)}</div>` : ''}
        ${stepperHtml()}
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
                  ? `<button type="submit" class="btn btn-primary" id="submit-btn">Envoyer la demande</button>`
                  : `<button type="submit" class="btn btn-primary">Continuer ${icon('arrow')}</button>`
              }
            </div>
          </div>
        </form>
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
          <select name="${field.name}">
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
                <input type="radio" name="${field.name}" value="${escapeHtml(o.value)}" />
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
                <input type="checkbox" name="${field.name}" value="${escapeHtml(o.value)}" />
                <span>${escapeHtml(o.label)}</span>
              </label>`
              )
              .join('')}
          </div>`;
        break;
      case 'textarea':
        control = `<textarea name="${field.name}" placeholder="${escapeHtml(field.placeholder || '')}"></textarea>`;
        break;
      default: {
        // Champ texte, avec liste de suggestions (datalist) si `suggestions` fourni :
        // l'utilisateur choisit dans la liste OU saisit une valeur libre.
        const hasList = Array.isArray(field.suggestions) && field.suggestions.length > 0;
        const listId = `dl-${field.name}`;
        const datalist = hasList
          ? `<datalist id="${listId}">${field.suggestions
              .map((s) => `<option value="${escapeHtml(s)}"></option>`)
              .join('')}</datalist>`
          : '';
        control = `<input type="${field.type}" name="${field.name}" placeholder="${escapeHtml(field.placeholder || '')}"${hasList ? ` list="${listId}" autocomplete="off"` : ''} />${datalist}`;
      }
    }

    return `
      <div class="field ${isWide ? 'full' : ''}" data-field="${field.name}">
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
        values[field.name] = [...form.querySelectorAll(`input[name="${field.name}"]:checked`)].map((el) => el.value);
      } else if (field.type === 'radio') {
        const checked = form.querySelector(`input[name="${field.name}"]:checked`);
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
          const el = form.querySelector(`input[name="${field.name}"][value="${CSS.escape(v)}"]`);
          if (el) el.checked = true;
        }
      } else if (field.type === 'radio') {
        if (value) {
          const el = form.querySelector(`input[name="${field.name}"][value="${CSS.escape(value)}"]`);
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

  function recapHtml() {
    return `
      <h3 class="sh">Vérifiez votre demande</h3>
      <div class="recap-note">Relisez attentivement : ces informations seront saisies telles quelles par le robot dans ${escapeHtml(app.name)}.</div>
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

    try {
      const result = await fetchJson(`/api/apps/${encodeURIComponent(app.id)}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      showConfirmation(result.reference);
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = `${icon('zap')} Envoyer la demande`;
      if (err.status === 422 && err.body.fields) {
        // Le serveur a rejeté un champ : on renvoie l'utilisateur à la première
        // section fautive avec les messages d'erreur affichés.
        const fieldNames = Object.keys(err.body.fields);
        const idx = sections.findIndex((s) => s.fields.some((f) => fieldNames.includes(f.name)));
        current = idx >= 0 ? idx : 0;
        render();
        showErrors(err.body.fields);
      } else {
        alert(`Erreur : ${err.message}`);
      }
    }
  }

  function showConfirmation(reference) {
    document.title = 'Demande envoyée — Portail Comptes';
    content.innerHTML = `
      <div class="panel result">
        <div class="big">${icon('check')}</div>
        <h2>Demande enregistrée&nbsp;!</h2>
        <p>Votre demande de compte <strong>${escapeHtml(app.name)}</strong> est dans la file de traitement.<br/>
        Le robot va la prendre en charge dans quelques instants.</p>
        <div class="refbox">
          <span>${escapeHtml(reference)}</span>
          <button type="button" id="copy-ref">Copier</button>
        </div>
        <p>Conservez cette référence : elle permet de suivre l'avancement de votre demande.</p>
        <div class="form-nav" style="justify-content:center;border:none;padding-top:10px">
          <a class="btn btn-primary" href="/suivi.html?ref=${encodeURIComponent(reference)}">Suivre ma demande ${icon('arrow')}</a>
          <a class="btn btn-ghost" href="/">Retour à l'accueil</a>
        </div>
      </div>`;
    document.getElementById('copy-ref').addEventListener('click', async (event) => {
      try {
        await navigator.clipboard.writeText(reference);
        event.target.textContent = 'Copié ✓';
        setTimeout(() => (event.target.textContent = 'Copier'), 2000);
      } catch {
        /* presse-papier indisponible : sans gravité */
      }
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
})();
