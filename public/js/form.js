'use strict';

/*
 * Génération dynamique du formulaire à partir du schéma renvoyé par l'API.
 * Une seule page sert tous les formulaires : /demande.html?app=<id>
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

  document.title = `${app.name} — Demande de compte`;
  document.getElementById('page-title').textContent = `Compte ${app.name}`;

  content.innerHTML = `
    <div class="form-card">
      <div class="form-header">
        <span class="icon" style="background:${escapeHtml(app.color)}">${icon(app.icon)}</span>
        <div>
          <h2>${escapeHtml(app.name)}</h2>
          <div class="category">${escapeHtml(app.category)}</div>
        </div>
      </div>
      ${app.schema.intro ? `<div class="form-intro">${escapeHtml(app.schema.intro)}</div>` : ''}
      <form id="request-form" novalidate>
        ${app.schema.sections.map(renderSection).join('')}
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" id="submit-btn">Envoyer la demande</button>
          <a href="/" class="btn btn-secondary">Annuler</a>
        </div>
      </form>
    </div>`;

  const form = document.getElementById('request-form');
  form.addEventListener('submit', onSubmit);

  function renderSection(section) {
    return `
      <fieldset>
        <legend>${escapeHtml(section.title)}</legend>
        <div class="fields-grid">
          ${section.fields.map(renderField).join('')}
        </div>
      </fieldset>`;
  }

  function renderField(field) {
    const req = field.required ? ' <span class="req">*</span>' : '';
    const isWide = ['textarea', 'radio', 'checkboxes'].includes(field.type);
    const help = field.help ? `<span class="help">${escapeHtml(field.help)}</span>` : '';
    let control = '';

    switch (field.type) {
      case 'select':
        control = `
          <select name="${field.name}" ${field.required ? 'required' : ''}>
            <option value="">— Sélectionner —</option>
            ${field.options.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('')}
          </select>`;
        break;
      case 'radio':
        control = `
          <div class="choice-group">
            ${field.options
              .map(
                (o) => `
              <label class="choice">
                <input type="radio" name="${field.name}" value="${escapeHtml(o.value)}" ${field.required ? 'required' : ''} />
                <span>${escapeHtml(o.label)}</span>
              </label>`
              )
              .join('')}
          </div>`;
        break;
      case 'checkboxes':
        control = `
          <div class="choice-group">
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
        control = `<textarea name="${field.name}" placeholder="${escapeHtml(field.placeholder || '')}" ${field.required ? 'required' : ''}></textarea>`;
        break;
      default:
        control = `<input type="${field.type}" name="${field.name}" placeholder="${escapeHtml(field.placeholder || '')}" ${field.required ? 'required' : ''} />`;
    }

    return `
      <div class="field ${isWide ? 'full' : ''}" data-field="${field.name}">
        <label>${escapeHtml(field.label)}${req}</label>
        ${control}
        ${help}
        <span class="error-msg"></span>
      </div>`;
  }

  function collectData() {
    const data = {};
    for (const section of app.schema.sections) {
      for (const field of section.fields) {
        if (field.type === 'checkboxes') {
          data[field.name] = [...form.querySelectorAll(`input[name="${field.name}"]:checked`)].map((el) => el.value);
        } else if (field.type === 'radio') {
          const checked = form.querySelector(`input[name="${field.name}"]:checked`);
          data[field.name] = checked ? checked.value : '';
        } else {
          data[field.name] = form.elements[field.name].value;
        }
      }
    }
    return data;
  }

  function clearErrors() {
    for (const el of content.querySelectorAll('.field.invalid')) el.classList.remove('invalid');
  }

  function showErrors(fields) {
    for (const [name, message] of Object.entries(fields)) {
      const wrapper = content.querySelector(`.field[data-field="${name}"]`);
      if (!wrapper) continue;
      wrapper.classList.add('invalid');
      wrapper.querySelector('.error-msg').textContent = message;
    }
    const first = content.querySelector('.field.invalid');
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function onSubmit(event) {
    event.preventDefault();
    clearErrors();

    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Envoi en cours…';

    try {
      const result = await fetchJson(`/api/apps/${encodeURIComponent(app.id)}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectData()),
      });
      showConfirmation(result.reference);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Envoyer la demande';
      if (err.status === 422 && err.body.fields) {
        showErrors(err.body.fields);
      } else {
        alert(`Erreur : ${err.message}`);
      }
    }
  }

  function showConfirmation(reference) {
    document.getElementById('page-title').textContent = 'Demande envoyée';
    content.innerHTML = `
      <div class="result-card">
        <div class="big-icon ok">${icon('check')}</div>
        <h2>Demande enregistrée&nbsp;!</h2>
        <p>Votre demande de compte <strong>${escapeHtml(app.name)}</strong> a bien été transmise.<br/>
        Le robot va la traiter automatiquement dans quelques instants.</p>
        <div class="reference-box">${escapeHtml(reference)}</div>
        <p>Conservez cette référence pour suivre l'avancement de votre demande.</p>
        <div class="form-actions" style="justify-content:center">
          <a class="btn btn-primary" href="/suivi.html?ref=${encodeURIComponent(reference)}">Suivre ma demande</a>
          <a class="btn btn-secondary" href="/">Retour à l'accueil</a>
        </div>
      </div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
})();
