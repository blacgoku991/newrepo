'use strict';

/*
 * Petits graphiques en SVG inline — aucune dépendance externe.
 * Palette claire cohérente avec le design du portail (bleu / ambre / violet).
 */

const CHART = {
  // Couple vérifié sur le fond sombre du panneau (#121936) : écart perceptif
  // suffisant en vision normale comme en vision déficiente, contraste ≥ 3:1,
  // et clarté comparable pour que ni l'une ni l'autre série ne domine.
  pine: '#6b8ff2',   /* série principale : bleu */
  terra: '#b8862a',  /* série secondaire : or profond */
  gold: '#b8862a',   /* accent : or profond */
  info: '#6b8ff2',
  line: '#242e52',
  muted: '#8b96b5',
  ink: '#e8ecf7',
};

function chartEmpty(msg) {
  return `<div class="empty">${escapeHtml(msg || 'Aucune donnée pour le moment.')}</div>`;
}

/**
 * Activité par jour : deux séries (demandes déposées, comptes créés).
 *
 * Barres groupées plutôt qu'une courbe : les valeurs sont de petits entiers,
 * souvent nuls. Une ligne qui relie 0 à 4 puis retombe à 0 dessine des pics
 * qui suggèrent une progression continue là où il n'y a que trois évènements ;
 * une barre par jour ne raconte rien de plus que ce qui s'est passé.
 *
 * Au survol : la journée entière s'éclaire et une infobulle donne les deux
 * chiffres. Sans elle, il faut deviner la valeur à l'œil sur la grille.
 *
 * Couleurs vérifiées sur le fond sombre du panneau (écart perceptif suffisant
 * y compris en vision des couleurs déficiente), et la forme des barres +
 * la légende portent l'identité : jamais la couleur seule.
 */
function areaChart(serie) {
  const total = serie.reduce((s, d) => s + d.demandes + d.crees, 0);
  if (total === 0) return chartEmpty('Aucune activité sur la période.');

  const n = serie.length;
  const W = 640, H = 210, P = { t: 16, r: 14, b: 34, l: 30 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const brut = Math.max(1, ...serie.map((d) => Math.max(d.demandes, d.crees)));
  // Échelle sur un entier « rond » : un axe gradué 0-1-2-3 se lit mieux qu'une
  // graduation à 2,33 pour des comptages.
  const pas = brut <= 4 ? 1 : brut <= 10 ? 2 : Math.ceil(brut / 5);
  const max = Math.ceil(brut / pas) * pas;
  const basse = P.t + ih;

  const bandeW = iw / n;
  const barW = Math.min(11, Math.max(4, bandeW * 0.30));
  const ecart = 2; // séparation entre les deux barres d'un même jour
  const xBande = (i) => P.l + i * bandeW;
  const y = (v) => basse - (v / max) * ih;
  const hauteur = (v) => (v <= 0 ? 0 : Math.max(2.5, (v / max) * ih));

  const grille = [];
  for (let v = 0; v <= max; v += pas) {
    const yy = y(v);
    grille.push(`<line x1="${P.l}" y1="${yy.toFixed(1)}" x2="${W - P.r}" y2="${yy.toFixed(1)}"
      stroke="${CHART.line}" stroke-width="1" ${v === 0 ? '' : 'stroke-dasharray="2 4"'}/>
      <text x="${P.l - 8}" y="${(yy + 3.5).toFixed(1)}" font-size="10" fill="${CHART.muted}" text-anchor="end">${v}</text>`);
  }

  const barre = (i, d) => {
    const cx = xBande(i) + bandeW / 2;
    const gauche = cx - barW - ecart / 2;
    const droite = cx + ecart / 2;
    const rect = (x, val, couleur) => {
      const h = hauteur(val);
      if (!h) return '';
      const r = Math.min(3, h / 2, barW / 2);
      return `<rect x="${x.toFixed(1)}" y="${(basse - h).toFixed(1)}" width="${barW.toFixed(1)}"
        height="${h.toFixed(1)}" rx="${r.toFixed(1)}" fill="${couleur}"/>`;
    };
    return rect(gauche, d.demandes, CHART.terra) + rect(droite, d.crees, CHART.pine);
  };

  const jourFr = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const etiquettes = serie.map((d, i) => {
    if (n > 8 && i % 2 !== 0 && i !== n - 1) return '';
    return `<text x="${(xBande(i) + bandeW / 2).toFixed(1)}" y="${H - 12}" font-size="9.5"
      fill="${CHART.muted}" text-anchor="middle">${jourFr(d.date)}</text>`;
  }).join('');

  // Zones de survol : toute la colonne du jour, bien plus large que les barres.
  const survol = serie.map((d, i) => `
    <g class="jour" data-jour="${escapeHtml(d.date)}">
      <rect class="zone" x="${xBande(i).toFixed(1)}" y="${P.t}" width="${bandeW.toFixed(1)}" height="${ih.toFixed(1)}"
        fill="transparent"><title>${jourFr(d.date)} — ${d.demandes} demande(s) déposée(s), ${d.crees} compte(s) créé(s)</title></rect>
    </g>`).join('');

  return `
    <div class="chart-hover" data-chart="activite">
      <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet"
           role="img" aria-label="Activité des 14 derniers jours : demandes déposées et comptes créés par jour">
        ${grille.join('')}
        ${serie.map((d, i) => barre(i, d)).join('')}
        ${etiquettes}
        ${survol}
      </svg>
      <div class="chart-tip" hidden></div>
    </div>
    <div class="chart-legend">
      <span><i style="background:${CHART.terra}"></i> Demandes déposées</span>
      <span><i style="background:${CHART.pine}"></i> Comptes créés</span>
    </div>`;
}

/**
 * Infobulle du graphique d'activité. Branchée une fois pour toutes sur le
 * document : le graphique est redessiné à chaque rafraîchissement, un écouteur
 * posé sur ses éléments disparaîtrait avec eux.
 */
function brancherInfobulles() {
  if (brancherInfobulles.fait) return;
  brancherInfobulles.fait = true;

  document.addEventListener('mousemove', (ev) => {
    const zone = ev.target.closest ? ev.target.closest('.chart-hover .zone') : null;
    const boite = zone && zone.closest('.chart-hover');
    document.querySelectorAll('.chart-hover').forEach((c) => {
      if (c !== boite) { c.querySelector('.chart-tip').hidden = true; c.classList.remove('actif'); }
    });
    if (!zone || !boite) return;

    const titre = zone.querySelector('title');
    const texte = titre ? titre.textContent : '';
    const [jour, reste] = texte.split(' — ');
    const tip = boite.querySelector('.chart-tip');
    const [dep, cre] = (reste || '').split(', ');
    tip.innerHTML = `<b>${escapeHtml(jour || '')}</b>
      <span><i style="background:${CHART.terra}"></i>${escapeHtml(dep || '')}</span>
      <span><i style="background:${CHART.pine}"></i>${escapeHtml(cre || '')}</span>`;
    tip.hidden = false;
    boite.classList.add('actif');

    const cadre = boite.getBoundingClientRect();
    const largeur = tip.offsetWidth || 160;
    let gauche = ev.clientX - cadre.left + 14;
    if (gauche + largeur > cadre.width) gauche = ev.clientX - cadre.left - largeur - 14;
    tip.style.left = `${Math.max(4, gauche)}px`;
    tip.style.top = `${Math.max(4, ev.clientY - cadre.top - 10)}px`;
  });

  document.addEventListener('mouseleave', () => {
    document.querySelectorAll('.chart-hover').forEach((c) => {
      c.querySelector('.chart-tip').hidden = true; c.classList.remove('actif');
    });
  }, true);
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
