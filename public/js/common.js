'use strict';

/* Utilitaires partagés par toutes les pages. */

const ICONS = {
  shield:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  heart:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  folder:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  chart:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  users:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  arrow:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
  inbox:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  bot:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 8V4M8 4h8"/><circle cx="9" cy="13" r="1" fill="currentColor"/><circle cx="15" cy="13" r="1" fill="currentColor"/><path d="M9 17h6"/></svg>',
  flag:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/></svg>',
  x:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  zap:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
  lock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  eye:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  grid:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>',
  list:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  logout:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
  building:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M9 6h.01M15 6h.01M9 10h.01M15 10h.01M9 14h.01M15 14h.01"/></svg>',
  edit:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trend:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>',
  briefcase:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
};

const STATUS_LABELS = {
  en_attente: 'En attente',
  en_cours: 'En cours',
  terminee: 'Terminée',
  echec: 'Échec',
};

function icon(name) { return ICONS[name] || ICONS.folder; }

function statusBadge(status) {
  const label = STATUS_LABELS[status] || status;
  return `<span class="badge st-${status}">${label}</span>`;
}

/* Visuel d'une application : logo réel si disponible, sinon pastille (initiale + couleur). */
function appVisual(app, cls) {
  const color = escapeHtml(app.color || '#2f5fda');
  const letter = escapeHtml((app.name || '?').charAt(0));
  if (app.logo) {
    // Logo officiel de l'éditeur en priorité, repli sur le SVG local
    // (/img/<id>), puis sur une pastille lettrée. Fallback géré par écouteur
    // (attachLogoFallbacks) — aucun gestionnaire inline (CSP stricte).
    const fb = app.logoFallback || (app.id ? `/img/${escapeHtml(app.id)}` : '');
    return `<img class="logo ${cls || ''}" src="${escapeHtml(app.logo)}" alt="${escapeHtml(app.name)}" data-logo-fallback="${escapeHtml(fb)}" data-letter="${letter}" data-color="${color}" />`;
  }
  return `<span class="logo-fallback ${cls || ''}" style="background:${color}">${letter}</span>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

/* ---------------------------------------------------------------------------
 * Marque de l'instance — marque blanche.
 *
 * Chaque instance sert UNE société : c'est son nom qui s'affiche, l'éditeur
 * n'est qu'une mention. Le nom vient de la licence signée, côté serveur.
 * Chargé une seule fois par page ; en cas d'échec, un libellé neutre évite
 * qu'une panne réseau vide l'en-tête.
 * ------------------------------------------------------------------------- */
let MARQUE = { societe: 'Portail comptes', logo: false, editeur: 'Smartfixx',
               editeurUrl: 'https://smartfixx.fr', mention: 'propulsé par Smartfixx' };
const marqueCourante = () => MARQUE;

async function chargerMarque() {
  try {
    const r = await fetch('/api/marque', { credentials: 'same-origin' });
    if (r.ok) MARQUE = { ...MARQUE, ...(await r.json()) };
  } catch { /* on garde le libellé neutre */ }
}

/** Applique la marque aux éléments qui la portent (en-tête des pages). */
function appliquerMarque() {
  for (const e of document.querySelectorAll('[data-marque="societe"]')) e.textContent = MARQUE.societe;
  for (const e of document.querySelectorAll('[data-marque="mention"]')) e.textContent = `${MARQUE.societe} — ${MARQUE.mention}`;
  for (const img of document.querySelectorAll('img[data-marque="logo"]')) {
    // `dataset` est en lecture seule : on écrit la propriété, pas l'objet.
    img.dataset.fallback = MARQUE.societe;
    if (MARQUE.logo) { img.src = '/img/societe'; img.alt = MARQUE.societe; }
    else handleTextFallback(img);   // aucun logo déposé : le nom s'affiche
  }
  if (document.title.includes('%SOCIETE%')) document.title = document.title.replace('%SOCIETE%', MARQUE.societe);
}

/* Pied de page commun : logos éditeurs, plan du portail, mentions légales.
 * Injecté dans tout élément <footer id="site-footer"> présent sur la page.
 * Les logos officiels sont chargés depuis les sites des éditeurs ; en cas
 * d'indisponibilité, un repli texte s'affiche. */
function renderFooter() {
  const host = document.getElementById('site-footer');
  if (!host) return;
  const year = new Date().getFullYear();
  const M = marqueCourante();
  // Repli texte géré par écouteur (aucun gestionnaire inline : CSP stricte).
  const logoImg = (src, name, cls) =>
    `<img${cls ? ` class="${cls}"` : ''} src="${escapeHtml(src)}" alt="${escapeHtml(name)}" loading="lazy" data-fallback="${escapeHtml(name)}" data-fallback-cls="${cls === 'ft-logo' ? 'ft-logo-txt' : 'ed-txt'}" />`;
  host.className = 'site-footer';
  host.innerHTML = `
    <div class="ft-inner">
      <div class="ft-top">
        <div class="ft-brand">
          <span class="ft-secret" id="ft-secret" role="button" tabindex="0" title="${escapeHtml(M.societe)}" aria-label="${escapeHtml(M.societe)}">${
            M.logo ? logoImg('/img/societe', M.societe, 'ft-logo') : `<span class="ft-logo-txt">${escapeHtml(M.societe)}</span>`}</span>
          <p>Portail interne de ${escapeHtml(M.societe)} pour la création automatisée des comptes sur les applications métiers, avec suivi et remise sécurisée des identifiants.</p>
        </div>
        <div>
          <span class="ft-h">Le portail</span>
          <div class="ft-links">
            <a href="/">Applications</a>
            <a href="/demarches.html">Démarches</a>
            <a href="/espace">Mon espace</a>
            <a href="/suivi.html">Suivre une demande</a>
          </div>
        </div>
        <div>
          <span class="ft-h">Applications gérées</span>
          <div class="ft-logos">
            <!-- Logos servis PAR LE PORTAIL, jamais depuis les sites des éditeurs :
                 chaque page consultée les prévenait de la visite, et l'adresse
                 NetSoins était en dur sur un seul client — tous les autres
                 auraient sonné chez lui. -->
            <span class="ed">${logoImg('/img/bluekango', 'BlueKanGo')}</span>
            <span class="ed">${logoImg('/img/netsoins', 'NetSoins')}</span>
          </div>
        </div>
      </div>
      <div class="ft-bottom">
        <span>© ${year} ${escapeHtml(M.societe)} — Tous droits réservés. <a class="ft-editeur" href="${escapeHtml(M.editeurUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(M.mention)}</a></span>
        <span class="ft-legal">
          <a href="/mentions-legales.html">Mentions légales</a>
          <a href="/mentions-legales.html#confidentialite">Confidentialité</a>
          <a href="/mentions-legales.html#donnees">Protection des données</a>
        </span>
      </div>
    </div>`;

  // Accès discret à l'administration : 3 clics sur le logo Algonis du pied de
  // page mènent à l'espace d'administration (qui a sa propre authentification).
  const secret = host.querySelector('#ft-secret');
  if (secret) {
    let clicks = 0;
    let timer = null;
    const trigger = () => {
      clicks += 1;
      clearTimeout(timer);
      timer = setTimeout(() => { clicks = 0; }, 800);
      if (clicks >= 3) { clicks = 0; location.href = '/admin.html'; }
    };
    secret.style.cursor = 'pointer';
    secret.addEventListener('click', trigger);
    secret.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger(); } });
  }
}

/* Replis d'images sans gestionnaire inline (CSP stricte), par délégation en
 * phase de capture — l'évènement « error » ne bulle pas, mais est capturé au
 * niveau document, ce qui couvre AUSSI les images injectées dynamiquement
 * (cartes d'applications, panneaux de formulaire, pied de page). */
function handleTextFallback(img) {
  if (img._fbDone) return;
  img._fbDone = true;
  const span = document.createElement('span');
  span.className = img.dataset.fallbackCls || '';
  span.textContent = img.dataset.fallback;
  img.replaceWith(span);
}
function handleLogoError(img) {
  // 1) image éditeur → 2) SVG local (/img/<id>) → 3) pastille lettrée.
  const fb = img.dataset.logoFallback;
  if (fb && img.getAttribute('src') !== fb) {
    img.dataset.logoFallback = '';
    img.src = fb;
    return;
  }
  if (img._fbDone) return;
  img._fbDone = true;
  const span = document.createElement('span');
  span.className = img.className.replace(/\blogo\b/, 'logo-fallback');
  span.textContent = img.dataset.letter || '?';
  span.style.background = img.dataset.color || '#2f5fda';
  img.replaceWith(span);
}
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    if ('logoFallback' in img.dataset) handleLogoError(img);
    else if ('fallback' in img.dataset) handleTextFallback(img);
  },
  true
);
/* Images déjà en échec avant l'exécution du script (logo en-tête notamment). */
function sweepFailedImages() {
  for (const img of document.querySelectorAll('img[data-logo-fallback], img[data-fallback]')) {
    if (img.complete && img.naturalWidth === 0) {
      if ('logoFallback' in img.dataset) handleLogoError(img);
      else handleTextFallback(img);
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // La marque conditionne l'en-tête ET le pied de page : on l'attend avant de
  // dessiner, plutôt que d'afficher un nom puis de le remplacer sous les yeux
  // de l'utilisateur.
  await chargerMarque();
  appliquerMarque();
  renderFooter();
  sweepFailedImages();
});

/* Barre de navigation du site public :
 *  - masque les onglets désactivés depuis l'admin (config « nav ») ;
 *  - n'affiche « Mon espace » que pour les référents. */
document.addEventListener('DOMContentLoaded', async () => {
  const navLinks = document.querySelectorAll('.topnav [data-nav]');
  if (!navLinks.length) return;
  let me = {};
  try {
    me = await (await fetch('/api/sso/me')).json();
  } catch {
    /* sans SSO : configuration par défaut (tout visible) */
  }
  const nav = (me && me.nav) || {};
  for (const link of navLinks) {
    const key = link.dataset.nav;
    if (nav[key] === false) { link.remove(); continue; }
    // « Mon espace » : réservé aux référents (et non masqué).
    if (key === 'espace') link.hidden = !(me && me.referent);
  }
});

/* ---------------------------------------------------------------------------
   Fil de retour — présent sur toutes les pages qui ne sont pas l'accueil.

   Une page sans issue est une impasse : la remise des identifiants, par
   exemple, s'ouvrait sans le moindre lien pour revenir. On pose donc partout
   deux repères constants : revenir à l'écran précédent, et rentrer à l'accueil.

   Le retour n'utilise JAMAIS `document.referrer` comme destination : une page
   extérieure pourrait ainsi renvoyer l'utilisateur où elle veut depuis notre
   propre bouton. On revient dans l'historique du navigateur — qui reste sous
   son contrôle — et, à défaut, sur une adresse du portail écrite dans la page.
   --------------------------------------------------------------------------- */

const FLECHE_RETOUR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>';
const MAISON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>';

/** Vrai si l'écran précédent appartient bien à ce portail. */
function retourInterne() {
  if (history.length <= 1) return false;
  const ref = document.referrer;
  if (!ref) return false;              // ouverture directe : rien où revenir
  try { return new URL(ref).origin === location.origin; } catch { return false; }
}

function renderFilRetour() {
  for (const hote of document.querySelectorAll('[data-fil-retour]')) {
    const repli = hote.dataset.filRetour || '/';       // toujours une URL du portail
    const libelle = hote.dataset.filLibelle || 'Retour';
    // `add` et non une réécriture de `className` : la page peut avoir posé
    // « flottant » pour un écran centré sans en-tête.
    hote.classList.add('fil-retour');
    hote.innerHTML =
      `<button type="button" class="fil-btn" data-role="retour">${FLECHE_RETOUR}<span>${escapeHtml(libelle)}</span></button>`
      + `<a class="fil-btn" href="/">${MAISON}<span>Accueil</span></a>`;
    hote.querySelector('[data-role="retour"]').addEventListener('click', () => {
      if (retourInterne()) history.back();
      else location.href = repli;
    });
  }
}
document.addEventListener('DOMContentLoaded', renderFilRetour);

/* ---------------------------------------------------------------------------
   Information sur les cookies.

   Ce portail ne dépose que des cookies strictement nécessaires : pas de mesure
   d'audience, pas de publicité, aucun traceur tiers. Dans ce cas, le
   consentement n'est PAS requis — et un bandeau « Accepter / Refuser » serait
   trompeur, puisqu'il n'y a rien à refuser sans empêcher la connexion.
   L'information, elle, reste due : on l'affiche une fois, sobrement.

   L'accusé de lecture est gardé dans `localStorage`, pas dans un cookie : poser
   un cookie pour dire qu'on informe sur les cookies serait absurde.
   --------------------------------------------------------------------------- */

const CLE_COOKIES_VU = 'portail.cookies.info';

function renderInfoCookies() {
  // Ni sur la page qui explique les cookies, ni sur les écrans d'authentification :
  // le bandeau y masquerait le seul bouton utile.
  const p = location.pathname;
  if (p.startsWith('/mentions-legales') || p.startsWith('/connexion') || p === '/login.html'
      || p.startsWith('/identifiants/') || p.startsWith('/acces-refuse')) return;
  let vu = null;
  try { vu = localStorage.getItem(CLE_COOKIES_VU); } catch { vu = 'impossible'; }
  if (vu) return;

  const barre = document.createElement('div');
  barre.className = 'info-cookies';
  barre.setAttribute('role', 'note');
  barre.innerHTML = `
    <p>Ce portail dépose uniquement les cookies <strong>nécessaires à votre connexion</strong>.
      Aucune mesure d’audience, aucun traceur, aucune ressource chargée depuis un autre site.
      <a href="/mentions-legales.html#cookies">En savoir plus</a></p>
    <button type="button" class="btn btn-primary btn-sm" data-role="cookies-ok">J’ai compris</button>`;
  document.body.appendChild(barre);
  barre.querySelector('[data-role="cookies-ok"]').addEventListener('click', () => {
    try { localStorage.setItem(CLE_COOKIES_VU, new Date().toISOString()); } catch { /* mode privé */ }
    barre.remove();
  });
}
document.addEventListener('DOMContentLoaded', renderInfoCookies);

/* Appels API stricts : toute erreur serveur remonte telle quelle (jamais de faux succès). */
async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Session SSO Microsoft 365 absente ou expirée : retour à la connexion.
    if (res.status === 401 && body.sso) {
      location.href = '/connexion?next=' + encodeURIComponent(location.pathname + location.search);
      return new Promise(() => {}); // la navigation interrompt le script
    }
    const err = new Error(body.error || `Erreur ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/* ---------------------------------------------------------------------------
   Libellés des démarches et pagination — partagés par l'espace du référent,
   la page de suivi et le panel d'administration, pour que les mêmes demandes
   portent partout le même nom et la même mécanique de pages.
   --------------------------------------------------------------------------- */

const DEMARCHE_LABELS = {
  creation: 'Création',
  reset_mdp: 'Réinit. mot de passe',
  ajout_etab: 'Ajout établissement',
  maj_identite: 'Correction identité',
  transfert_etab: 'Transfert établissement',
};

function demarcheLabel(type) {
  return DEMARCHE_LABELS[type] || type || '—';
}

/** Numéros de page à afficher (1 … n-1 n n+1 … N). */
function pageNumbers(page, pages) {
  const wanted = [1, pages, page, page - 1, page + 1].filter((n) => n >= 1 && n <= pages);
  const uniq = [...new Set(wanted)].sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const n of uniq) { if (n - prev > 1) out.push('…'); out.push(n); prev = n; }
  return out;
}

/** Pied de liste : « 1–15 sur 42 comptes » + numéros de page. */
function pagerHtml(page, pages, from, to, total, noun) {
  const info = `<span class="pg-info">${from}–${to} sur ${total} ${escapeHtml(noun)}</span>`;
  if (pages <= 1) return `<div class="esp-pager">${info}</div>`;
  const btns = pageNumbers(page, pages)
    .map((n) => (n === '…'
      ? '<span class="pg-ell">…</span>'
      : `<button class="pg${n === page ? ' on' : ''}" data-page="${n}">${n}</button>`))
    .join('');
  return `<div class="esp-pager">${info}
    <div class="pg-btns">
      <button class="pg" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Précédent">‹</button>
      ${btns}
      <button class="pg" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Suivant">›</button>
    </div>
  </div>`;
}

/** Branche les boutons de pagination d'un conteneur. */
function bindPager(box, page, pages, onChange) {
  for (const b of box.querySelectorAll('.pg[data-page]')) {
    if (b.disabled) continue;
    b.addEventListener('click', () => {
      const p = Number(b.dataset.page);
      if (p >= 1 && p <= pages && p !== page) onChange(p);
    });
  }
}
