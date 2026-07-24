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

/* Pied de page commun : logos éditeurs, plan du portail, mentions légales.
 * Injecté dans tout élément <footer id="site-footer"> présent sur la page.
 * Les logos officiels sont chargés depuis les sites des éditeurs ; en cas
 * d'indisponibilité, un repli texte s'affiche. */
function renderFooter() {
  const host = document.getElementById('site-footer');
  if (!host) return;
  const year = new Date().getFullYear();
  // Repli texte géré par écouteur (aucun gestionnaire inline : CSP stricte).
  const logoImg = (src, name, cls) =>
    `<img${cls ? ` class="${cls}"` : ''} src="${escapeHtml(src)}" alt="${escapeHtml(name)}" loading="lazy" data-fallback="${escapeHtml(name)}" data-fallback-cls="${name === 'Algonis' ? 'ft-logo-txt' : 'ed-txt'}" />`;
  host.className = 'site-footer';
  host.innerHTML = `
    <div class="ft-inner">
      <div class="ft-top">
        <div class="ft-brand">
          <span class="ft-secret" id="ft-secret" role="button" tabindex="0" title="Algonis" aria-label="Algonis">${logoImg('/img/algonis', 'Algonis', 'ft-logo')}</span>
          <p>Portail interne d'ADEF Résidences pour la création automatisée des comptes sur les applications métiers, avec suivi et remise sécurisée des identifiants.</p>
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
            <span class="ed">${logoImg('https://app.bluekango.com/BMS_EARLY/images/bkg_logo.png', 'BlueKanGo')}</span>
            <span class="ed">${logoImg('https://adef.netsoins.com/images/orisha_socialcare_teranga.png', 'NetSoins')}</span>
          </div>
        </div>
      </div>
      <div class="ft-bottom">
        <span>© ${year} Algonis · ADEF Résidences — Tous droits réservés.</span>
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

document.addEventListener('DOMContentLoaded', () => {
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
