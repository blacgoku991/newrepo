'use strict';

/*
 * Petits graphiques en SVG inline — aucune dépendance externe.
 * Palette claire cohérente avec le design du portail (bleu / ambre / violet).
 */

const CHART = {
  pine: '#6b8ff2',   /* série principale : bleu clair (fond sombre) */
  terra: '#e3b74f',  /* série secondaire : or */
  gold: '#e3b74f',   /* accent : or */
  info: '#6b8ff2',
  line: '#242e52',
  muted: '#8b96b5',
  ink: '#e8ecf7',
};

function chartEmpty(msg) {
  return `<div class="empty">${escapeHtml(msg || 'Aucune donnée pour le moment.')}</div>`;
}

/** Graphique en aire/ligne : 2 séries (demandes, comptes créés) sur des jours. */
function areaChart(serie) {
  const total = serie.reduce((s, d) => s + d.demandes + d.crees, 0);
  if (total === 0) return chartEmpty('Aucune activité sur la période.');

  const W = 640, H = 200, P = { t: 14, r: 12, b: 26, l: 26 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const max = Math.max(1, ...serie.map((d) => Math.max(d.demandes, d.crees)));
  const n = serie.length;
  const x = (i) => P.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => P.t + ih - (v / max) * ih;

  const linePath = (key) =>
    serie.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`).join(' ');
  const areaPath = (key) =>
    `${linePath(key)} L ${x(n - 1).toFixed(1)} ${(P.t + ih).toFixed(1)} L ${x(0).toFixed(1)} ${(P.t + ih).toFixed(1)} Z`;

  // Repères horizontaux
  const grid = [0, 0.5, 1]
    .map((f) => {
      const yy = (P.t + ih - f * ih).toFixed(1);
      return `<line x1="${P.l}" y1="${yy}" x2="${W - P.r}" y2="${yy}" stroke="${CHART.line}" stroke-width="1"/>
              <text x="4" y="${(+yy + 3).toFixed(1)}" font-size="10" fill="${CHART.muted}">${Math.round(f * max)}</text>`;
    })
    .join('');

  const labels = serie
    .map((d, i) => {
      if (n > 8 && i % 2 !== 0 && i !== n - 1) return '';
      const day = d.date.slice(8, 10) + '/' + d.date.slice(5, 7);
      return `<text x="${x(i).toFixed(1)}" y="${H - 8}" font-size="9.5" fill="${CHART.muted}" text-anchor="middle">${day}</text>`;
    })
    .join('');

  const dots = (key, color) =>
    serie
      .map((d) => (d[key] > 0 ? `<circle cx="${x(serie.indexOf(d)).toFixed(1)}" cy="${y(d[key]).toFixed(1)}" r="2.6" fill="${color}"/>` : ''))
      .join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img">
      <defs>
        <linearGradient id="gpine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${CHART.pine}" stop-opacity="0.20"/>
          <stop offset="100%" stop-color="${CHART.pine}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grid}
      <path d="${areaPath('crees')}" fill="url(#gpine)"/>
      <path d="${linePath('demandes')}" fill="none" stroke="${CHART.terra}" stroke-width="2" stroke-dasharray="4 4" stroke-linejoin="round"/>
      <path d="${linePath('crees')}" fill="none" stroke="${CHART.pine}" stroke-width="2.4" stroke-linejoin="round"/>
      ${dots('crees', CHART.pine)}
      ${labels}
    </svg>
    <div class="chart-legend">
      <span><i style="background:${CHART.pine}"></i> Comptes créés</span>
      <span><i style="background:${CHART.terra}"></i> Demandes déposées</span>
    </div>`;
}

/** Barres horizontales : liste de { label, count }. */
function barChart(items, opts = {}) {
  if (!items || items.length === 0) return chartEmpty(opts.empty);
  const color = opts.color || CHART.pine;
  const max = Math.max(1, ...items.map((i) => i.count));
  return `<div class="bars">
    ${items
      .map((it) => {
        const pct = Math.round((it.count / max) * 100);
        return `<div class="row">
          <span class="lb" title="${escapeHtml(it.label)}">${escapeHtml(it.label)}</span>
          <span class="vl">${it.count}</span>
          <span class="track"><span class="fill" style="width:${pct}%;background:${color}"></span></span>
        </div>`;
      })
      .join('')}
  </div>`;
}

/** Barres « application » avec créés / échecs. */
function appBars(items) {
  if (!items || items.length === 0) return chartEmpty();
  const max = Math.max(1, ...items.map((i) => i.total));
  return `<div class="bars">
    ${items
      .map((a) => {
        const pc = Math.round((a.crees / max) * 100);
        const pe = Math.round((a.echec / max) * 100);
        return `<div class="row">
          <span class="lb">${escapeHtml(a.app)}</span>
          <span class="vl">${a.crees}/${a.total}</span>
          <span class="track">
            <span class="fill" style="width:${pc}%;background:${CHART.pine}"></span>
            <span class="fill" style="width:${pe}%;background:${CHART.terra};margin-top:-9px;opacity:.85"></span>
          </span>
        </div>`;
      })
      .join('')}
  </div>
  <div class="chart-legend">
    <span><i style="background:${CHART.pine}"></i> Créés</span>
    <span><i style="background:${CHART.terra}"></i> Échecs</span>
  </div>`;
}
