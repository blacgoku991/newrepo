'use strict';

/**
 * Agrégations pour le tableau de bord d'administration.
 * Calculées en mémoire à partir des demandes : simple et suffisant au volume visé.
 */

const db = require('./db');
const registry = require('./registry');
const demarches = require('./demarches');

/** Compteurs à zéro pour chaque démarche du registre (creation, reset_mdp…). */
const zeroParType = () => Object.fromEntries(Object.keys(demarches.DEMARCHES).map((t) => [t, 0]));

function appName(appId) {
  const entry = registry.get(appId);
  return entry ? entry.config.name : appId;
}

/** Retrouve le libellé d'un établissement BlueKanGo à partir de sa valeur. */
function etablissementLabel(appId, value) {
  const entry = registry.get(appId);
  if (!entry) return value;
  for (const section of entry.config.formSchema.sections) {
    for (const field of section.fields) {
      if (field.name === 'etablissement' && field.options) {
        const opt = field.options.find((o) => o.value === value);
        if (opt) return opt.label;
      }
    }
  }
  return value;
}

function dayKey(iso) {
  if (!iso) return null;
  return (iso.includes('T') ? iso : iso.replace(' ', 'T')).slice(0, 10);
}

function topN(map, n, mapKey = (k) => k) {
  return [...map.entries()]
    .map(([key, count]) => ({ label: mapKey(key), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

function compute() {
  const rows = db.allForStats();

  const kpis = { total: 0, crees: 0, en_attente: 0, en_cours: 0, echec: 0 };
  const byApp = new Map(); // app_id -> { total, crees, echec }
  const byEtab = new Map(); // label -> count (comptes créés)
  const byFonction = new Map();
  const byDemandeur = new Map();
  const byMsAccount = new Map(); // compte -> { total, <une clé par démarche>, crees }
  const byType = zeroParType();
  const createdByDay = new Map(); // day -> count (comptes créés)
  const requestsByDay = new Map(); // day -> count (demandes déposées)

  for (const r of rows) {
    kpis.total++;
    kpis[r.status] = (kpis[r.status] || 0) + 1;

    const a = byApp.get(r.app_id) || { total: 0, crees: 0, echec: 0 };
    a.total++;
    if (r.status === 'terminee') a.crees++;
    if (r.status === 'echec') a.echec++;
    byApp.set(r.app_id, a);

    const dCreated = dayKey(r.created_at);
    if (dCreated) requestsByDay.set(dCreated, (requestsByDay.get(dCreated) || 0) + 1);

    // Qui a fait quoi : par compte Microsoft (identité SSO), toutes demandes
    // confondues, avec le détail par type de démarche.
    const type = r.request_type || 'creation';
    if (type in byType) byType[type]++;
    const account = (r.sso_email || '').trim() || (r.demandeur || '').trim() || 'Sans SSO';
    const acc = byMsAccount.get(account) || { total: 0, ...zeroParType(), crees: 0 };
    acc.total++;
    acc[type] = (acc[type] || 0) + 1;
    if (r.status === 'terminee') acc.crees++;
    byMsAccount.set(account, acc);

    if (r.status === 'terminee') {
      let payload = {};
      try {
        payload = JSON.parse(r.payload);
      } catch {
        /* ignore */
      }
      if (payload.etablissement) {
        const label = etablissementLabel(r.app_id, payload.etablissement);
        byEtab.set(label, (byEtab.get(label) || 0) + 1);
      }
      if (payload.fonction) {
        byFonction.set(payload.fonction, (byFonction.get(payload.fonction) || 0) + 1);
      }
      const dem = (r.demandeur || '').trim() || 'Anonyme';
      byDemandeur.set(dem, (byDemandeur.get(dem) || 0) + 1);

      const dFin = dayKey(r.finished_at) || dCreated;
      if (dFin) createdByDay.set(dFin, (createdByDay.get(dFin) || 0) + 1);
    }
  }

  kpis.crees = kpis.terminee || 0;
  const tauxReussite = kpis.total > 0 ? Math.round((kpis.crees / kpis.total) * 100) : 0;

  // Série des 14 derniers jours (demandes vs comptes créés).
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({
      date: key,
      demandes: requestsByDay.get(key) || 0,
      crees: createdByDay.get(key) || 0,
    });
  }

  return {
    kpis: {
      total: kpis.total,
      crees: kpis.crees,
      en_attente: kpis.en_attente || 0,
      en_cours: kpis.en_cours || 0,
      echec: kpis.echec || 0,
      tauxReussite,
    },
    parApplication: [...byApp.entries()]
      .map(([appId, v]) => ({ appId, app: appName(appId), ...v }))
      .sort((a, b) => b.total - a.total),
    serie: days,
    parEtablissement: topN(byEtab, 8),
    parFonction: topN(byFonction, 8),
    parDemandeur: topN(byDemandeur, 8),
    parType: byType,
    parCompteMicrosoft: [...byMsAccount.entries()]
      .map(([account, v]) => ({ account, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12),
    // Habilitations : sans référent déclaré, personne ne peut déposer. Le
    // compte remonte ici pour être visible dès la vue d'ensemble.
    referents: (() => {
      const liste = db.listReferents();
      return {
        total: liste.length,
        actifs: liste.filter((r) => r.active).length,
        sansEtablissement: liste.filter((r) => (r.etablissements || []).length === 0).length,
        enforced: require('./referents').enforced(),
        acces: require('./habilitation').etat(),
      };
    })(),
  };
}

module.exports = { compute };
