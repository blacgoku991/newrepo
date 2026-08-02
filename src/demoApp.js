'use strict';

/**
 * Console d'administration de DÉMONSTRATION.
 *
 * Imite l'interface d'administration d'une application métier (connexion,
 * formulaire « Nouvel utilisateur », confirmation) afin que le robot puisse
 * faire une vraie création de compte, navigateur ouvert, de bout en bout.
 *
 * Un humain peut aussi s'y connecter pour observer : /demo/<app>/login
 * (identifiants : admin / demo123). Les comptes créés sont stockés dans la
 * table demo_accounts et listés sur la page « Utilisateurs ».
 */

const express = require('express');
const db = require('./db');
const registry = require('./registry');
const { DEMO_USER, DEMO_PASSWORD } = require('./automation/demoDriver');

const router = express.Router();
router.use(express.urlencoded({ extended: true }));

function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function hasSession(req, appId) {
  const cookies = req.headers.cookie || '';
  return cookies.split(';').some((c) => c.trim() === `demo_${appId}=ok`);
}

function layout(app, title, body, { activeNav = '' } = {}) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} — ${esc(app.name)} Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Segoe UI", system-ui, sans-serif; background: #eef1f6; color: #24292f; font-size: 14px; }
    .topbar { background: ${esc(app.color)}; color: #fff; padding: 0 20px; display: flex; align-items: center; gap: 24px; height: 52px; }
    .topbar .app { font-weight: 700; font-size: 15px; }
    .topbar .env { background: rgba(255,255,255,.22); font-size: 11px; padding: 3px 8px; border-radius: 4px; letter-spacing: .5px; }
    .topbar nav { display: flex; gap: 4px; margin-left: auto; }
    .topbar nav a { color: rgba(255,255,255,.85); text-decoration: none; padding: 6px 12px; border-radius: 5px; }
    .topbar nav a.on, .topbar nav a:hover { background: rgba(255,255,255,.18); color: #fff; }
    .wrap { max-width: 860px; margin: 28px auto; padding: 0 20px; }
    .panel { background: #fff; border: 1px solid #d7dde6; border-radius: 8px; padding: 24px; }
    h1 { font-size: 19px; margin-bottom: 4px; }
    .sub { color: #6a737d; margin-bottom: 18px; }
    label { display: block; font-weight: 600; margin: 14px 0 4px; }
    input[type=text], input[type=email], input[type=tel], input[type=date], input[type=password], select, textarea {
      width: 100%; padding: 8px 10px; border: 1px solid #b8c2cf; border-radius: 5px; font: inherit; background: #fff;
    }
    .opt { display: flex; align-items: center; gap: 8px; font-weight: 400; margin: 6px 0; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 22px; }
    button { margin-top: 20px; background: ${esc(app.color)}; color: #fff; border: 0; padding: 10px 22px; border-radius: 6px; font: inherit; font-weight: 600; cursor: pointer; }
    .demo-success { background: #e6f6ec; border: 1px solid #9fd8b4; color: #14683a; padding: 14px 16px; border-radius: 6px; margin-bottom: 18px; font-weight: 600; }
    .error { background: #fdeaea; border: 1px solid #f3b4b4; color: #9d1c1c; padding: 12px 14px; border-radius: 6px; margin-bottom: 14px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid #e4e9f0; }
    th { background: #f6f8fb; font-size: 12px; text-transform: uppercase; color: #6a737d; letter-spacing: .4px; }
    .hint { margin-top: 16px; font-size: 12px; color: #8b949e; }
    fieldset { border: 0; border-top: 1px solid #e4e9f0; margin-top: 22px; padding-top: 14px; }
    legend { font-weight: 700; padding-right: 10px; font-size: 15px; }
  </style>
</head>
<body>
  <div class="topbar">
    <span class="app">${esc(app.name)}</span>
    <span class="env">ENVIRONNEMENT DE DÉMONSTRATION</span>
    <nav>
      <a href="/demo/${app.id}/users" class="${activeNav === 'users' ? 'on' : ''}">Utilisateurs</a>
      <a href="/demo/${app.id}/users/new" class="${activeNav === 'new' ? 'on' : ''}">Nouvel utilisateur</a>
      <a href="/demo/${app.id}/logout">Déconnexion</a>
    </nav>
  </div>
  <div class="wrap">${body}</div>
</body>
</html>`;
}

function renderField(field) {
  // Un champ conditionnel (`showIf`) n'est obligatoire que lorsque sa condition
  // est remplie — « date limite d'accès » ne l'est qu'en CDD. La console de
  // démonstration, elle, affiche tous les champs : les marquer obligatoires
  // faisait bloquer l'envoi par le navigateur sur une demande en CDI, et le
  // robot attendait une confirmation qui ne venait jamais.
  const required = field.required && !field.showIf ? 'required' : '';
  let control;
  switch (field.type) {
    case 'select':
      control = `<select name="${field.name}" ${required}>
        <option value=""></option>
        ${field.options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}
      </select>`;
      break;
    case 'radio':
      control = field.options
        .map(
          (o) =>
            `<label class="opt"><input type="radio" name="${field.name}" value="${esc(o.value)}" /> ${esc(o.label)}</label>`
        )
        .join('');
      break;
    case 'checkboxes':
      control = field.options
        .map(
          (o) =>
            `<label class="opt"><input type="checkbox" name="${field.name}" value="${esc(o.value)}" /> ${esc(o.label)}</label>`
        )
        .join('');
      break;
    case 'textarea':
      control = `<textarea name="${field.name}" rows="3"></textarea>`;
      break;
    default:
      control = `<input type="${field.type}" name="${field.name}" ${required} />`;
  }
  return `<div><label>${esc(field.label)}${field.required ? ' *' : ''}</label>${control}</div>`;
}

router.param('appId', (req, res, next, appId) => {
  const entry = registry.getAvailable(appId);
  if (!entry) return res.status(404).send('Application de démonstration inconnue');
  req.demoApp = entry.config;
  next();
});

router.get('/:appId/login', (req, res) => {
  const app = req.demoApp;
  res.send(
    layout(
      app,
      'Connexion',
      `<div class="panel" style="max-width:420px;margin:40px auto" data-page="login">
        <h1>Connexion administrateur</h1>
        <p class="sub">Accès réservé au personnel autorisé.</p>
        ${req.query.err ? '<div class="error">Identifiants incorrects.</div>' : ''}
        <form method="post" action="/demo/${app.id}/login">
          <label>Identifiant</label>
          <input type="text" name="login" required />
          <label>Mot de passe</label>
          <input type="password" name="password" required />
          <button type="submit">Se connecter</button>
        </form>
        <p class="hint">Console factice pour la démonstration du robot — identifiants : admin / demo123</p>
      </div>`
    )
  );
});

router.post('/:appId/login', (req, res) => {
  const app = req.demoApp;
  const { login, password } = req.body;
  if (login !== DEMO_USER || password !== DEMO_PASSWORD) {
    return res.redirect(`/demo/${app.id}/login?err=1`);
  }
  res.setHeader('Set-Cookie', `demo_${app.id}=ok; Path=/demo/${app.id}; HttpOnly`);
  res.redirect(`/demo/${app.id}/users/new`);
});

router.get('/:appId/logout', (req, res) => {
  const app = req.demoApp;
  res.setHeader('Set-Cookie', `demo_${app.id}=; Path=/demo/${app.id}; Max-Age=0`);
  res.redirect(`/demo/${app.id}/login`);
});

router.use('/:appId/users', (req, res, next) => {
  if (!hasSession(req, req.demoApp.id)) return res.redirect(`/demo/${req.demoApp.id}/login`);
  next();
});

router.get('/:appId/users/new', (req, res) => {
  const app = req.demoApp;
  const sections = app.formSchema.sections
    .map(
      (section) => `
      <fieldset>
        <legend>${esc(section.title)}</legend>
        <div class="grid2">
          ${section.fields.map(renderField).join('')}
        </div>
      </fieldset>`
    )
    .join('');
  res.send(
    layout(
      app,
      'Nouvel utilisateur',
      `<div class="panel" data-page="users-new">
        <h1>Créer un utilisateur</h1>
        <p class="sub">Renseignez la fiche du nouvel utilisateur ${esc(app.name)}.</p>
        <form method="post" action="/demo/${app.id}/users">
          ${sections}
          <button type="submit" id="demo-save">Enregistrer l'utilisateur</button>
        </form>
      </div>`,
      { activeNav: 'new' }
    )
  );
});

router.post('/:appId/users', (req, res) => {
  const app = req.demoApp;
  const payload = {};
  for (const section of app.formSchema.sections) {
    for (const field of section.fields) {
      const value = req.body[field.name];
      payload[field.name] =
        field.type === 'checkboxes'
          ? Array.isArray(value) ? value : value ? [value] : []
          : value || '';
    }
  }
  const accountId = db.createDemoAccount(app.id, payload);
  const name = esc(`${payload.prenom || ''} ${payload.nom || ''}`.trim() || 'Utilisateur');
  res.send(
    layout(
      app,
      'Utilisateur créé',
      `<div class="panel" data-page="user-created">
        <div class="demo-success">✔ Le compte utilisateur « ${name} » a été créé avec succès — fiche n°<span id="demo-account-id">${accountId}</span></div>
        <h1>Récapitulatif de la fiche</h1>
        <table>
          <tbody>
            ${Object.entries(payload)
              .map(
                ([k, v]) =>
                  `<tr><th>${esc(k)}</th><td>${esc(Array.isArray(v) ? v.join(', ') : v || '—')}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>
        <p class="hint"><a href="/demo/${app.id}/users">Voir tous les utilisateurs</a> · <a href="/demo/${app.id}/users/new">Créer un autre utilisateur</a></p>
      </div>`
    )
  );
});

router.get('/:appId/users', (req, res) => {
  const app = req.demoApp;
  const accounts = db.listDemoAccounts(app.id);
  const rows = accounts
    .map((a) => {
      const p = JSON.parse(a.payload);
      return `<tr>
        <td>${a.id}</td>
        <td>${esc(`${p.prenom || ''} ${p.nom || ''}`.trim())}</td>
        <td>${esc(p.email || '—')}</td>
        <td>${esc(a.created_at)}</td>
      </tr>`;
    })
    .join('');
  res.send(
    layout(
      app,
      'Utilisateurs',
      `<div class="panel" data-page="users-list">
        <h1>Utilisateurs</h1>
        <p class="sub">${accounts.length} compte(s) créé(s) dans cet environnement de démonstration.</p>
        <table>
          <thead><tr><th>#</th><th>Nom</th><th>E-mail</th><th>Créé le</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4">Aucun utilisateur pour le moment.</td></tr>'}</tbody>
        </table>
      </div>`,
      { activeNav: 'users' }
    )
  );
});

module.exports = router;
