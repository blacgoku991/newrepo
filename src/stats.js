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

/**
 * Valeur produite par le portail : temps de saisie évité, délai de traitement,
 * et — si un taux horaire est renseigné — l'équivalent en euros.
 *
 * Ne comptent que les demandes RÉELLEMENT abouties : une demande en échec n'a
 * fait gagner de temps à personne. Le chiffre annoncé doit tenir devant un
 * directeur qui le vérifie.
 */
function valeur(rows) {
  const maintenant = Date.now();
  const jours = (n) => maintenant - n * 86400000;
  const seuils = { mois: jours(30), trimestre: jours(90), toujours: 0 };
  const cumul = { mois: 0, trimestre: 0, toujours: 0 };
  const parType = new Map();
  let delais = [];
  let abouties = 0;
  // Durée RÉELLE du robot (début → fin d'exécution), à ne pas confondre avec
  // le délai de traitement (dépôt → fin), qui inclut l'attente en file.
  const dureesParType = new Map();
  const dureesParApp = new Map();
  const toutesDurees = [];

  for (const r of rows) {
    if (r.status !== 'terminee') continue;
    abouties++;
    // `normalise` ramène les alias (identite → maj_identite) sur la clé du
    // registre : sans cela, la même démarche compterait deux fois sous deux
    // libellés, dont l'un serait affiché en brut.
    const type = demarches.normalise(r.request_type || 'creation');
    const minutes = demarches.minutesManuelles(type);
    parType.set(type, (parType.get(type) || 0) + minutes);

    const fin = Date.parse((r.finished_at || r.created_at || '').replace(' ', 'T') + 'Z');
    for (const [cle, seuil] of Object.entries(seuils)) {
      if (!Number.isFinite(fin) || fin >= seuil) cumul[cle] += minutes;
    }

    const debut = Date.parse((r.created_at || '').replace(' ', 'T') + 'Z');
    if (Number.isFinite(fin) && Number.isFinite(debut) && fin >= debut) delais.push(fin - debut);

    const lance = Date.parse((r.started_at || '').replace(' ', 'T') + 'Z');
    if (Number.isFinite(fin) && Number.isFinite(lance) && fin >= lance) {
      const duree = fin - lance;
      toutesDurees.push(duree);
      if (!dureesParType.has(type)) dureesParType.set(type, []);
      dureesParType.get(type).push(duree);
      if (!dureesParApp.has(r.app_id)) dureesParApp.set(r.app_id, []);
      dureesParApp.get(r.app_id).push(duree);
    }
  }

  /** Médiane, moyenne et extrêmes d'une série de durées (en secondes). */
  const resume = (ms) => {
    if (!ms.length) return null;
    const tri = ms.slice().sort((a, b) => a - b);
    const s = (v) => Math.round(v / 1000);
    return {
      n: tri.length,
      medianeSecondes: s(tri[Math.floor(tri.length / 2)]),
      moyenneSecondes: s(tri.reduce((a, b) => a + b, 0) / tri.length),
      minSecondes: s(tri[0]),
      maxSecondes: s(tri[tri.length - 1]),
      totalSecondes: s(tri.reduce((a, b) => a + b, 0)),
    };
  };

  delais = delais.sort((a, b) => a - b);
  // Médiane plutôt que moyenne : une demande restée en file une nuit ne doit
  // pas laisser croire que le robot met huit heures.
  const medianeMs = delais.length ? delais[Math.floor(delais.length / 2)] : 0;

  const taux = Number(process.env.TAUX_HORAIRE);
  const enEuros = (minutes) => (Number.isFinite(taux) && taux > 0
    ? Math.round((minutes / 60) * taux) : null);

  return {
    abouties,
    minutes: cumul,
    heures: Object.fromEntries(Object.entries(cumul).map(([k, v]) => [k, Math.round(v / 6) / 10])),
    euros: Object.fromEntries(Object.entries(cumul).map(([k, v]) => [k, enEuros(v)])),
    tauxHoraire: Number.isFinite(taux) && taux > 0 ? taux : null,
    parType: [...parType.entries()]
      .map(([type, minutes]) => ({
        type,
        label: demarches.court(type),
        minutes,
        heures: Math.round(minutes / 6) / 10,
      }))
      .sort((a, b) => b.minutes - a.minutes),
    delaiMedianSecondes: Math.round(medianeMs / 1000),
    // Temps de travail du robot lui-même : ce qu'il a réellement passé dans
    // l'application, attente en file exclue.
    robot: {
      ...(resume(toutesDurees) || { n: 0 }),
      parType: [...dureesParType.entries()]
        .map(([type, liste]) => ({ type, label: demarches.court(type), ...resume(liste) }))
        .sort((a, b) => b.n - a.n),
      parApplication: [...dureesParApp.entries()]
        .map(([appId, liste]) => ({ appId, app: appName(appId), ...resume(liste) }))
        .sort((a, b) => b.n - a.n),
    },
    // Barème appliqué, affiché tel quel : un chiffre dont on ne peut pas voir
    // l'hypothèse n'est pas un argument, c'est une affirmation.
    bareme: Object.fromEntries(
      Object.keys(demarches.DEMARCHES).map((t) => [t, demarches.minutesManuelles(t)]),
    ),
  };
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
    valeur: valeur(rows),
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
