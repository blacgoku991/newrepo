'use strict';

/**
 * Qui a le droit d'utiliser le portail ?
 *
 * Trois politiques, choisies par `ACCES_PORTAIL` dans le `.env` :
 *
 *   tenant    (défaut) — toute personne du tenant Microsoft 365 configuré.
 *                        C'est le SSO qui fait la porte : si Microsoft laisse
 *                        entrer, le portail laisse entrer.
 *   attribut            — seules les personnes dont le jeton Microsoft porte
 *                        les attributs attendus (rôle d'application, groupe,
 *                        attribut d'annuaire personnalisé…). Voir ACCES_ATTRIBUT.
 *   liste               — seules les personnes déclarées comme référents dans
 *                        le panneau d'administration (habilitation nominative,
 *                        établissement par établissement).
 *
 * Dans les modes `tenant` et `attribut`, une personne peut malgré tout être
 * déclarée référente : sa fiche l'emporte alors et restreint sa portée à ses
 * établissements. Sans fiche, la portée est « tous les établissements ».
 */

const db = require('./db');
const sso = require('./sso');

const MODES = ['tenant', 'attribut', 'liste'];
const MODE_DEFAUT = 'tenant';

function mode() {
  const m = String(process.env.ACCES_PORTAIL || '').trim().toLowerCase();
  return MODES.includes(m) ? m : MODE_DEFAUT;
}

/**
 * Règles d'attributs, lues dans ACCES_ATTRIBUT.
 *
 *   ACCES_ATTRIBUT=roles=Algonis.Referent
 *   ACCES_ATTRIBUT=groups=8f3c…-…,b21a…-…
 *   ACCES_ATTRIBUT=extension_ab12_Fonction=Directeur,Cadre de santé
 *   ACCES_ATTRIBUT=roles=Algonis.Referent ; jobTitle=Directeur
 *
 * Plusieurs règles séparées par `;` : il suffit qu'UNE corresponde (OU).
 * Une règle sans `=` exige seulement la présence de l'attribut.
 */
function regles() {
  return String(process.env.ACCES_ATTRIBUT || '')
    .split(';')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const i = r.indexOf('=');
      if (i === -1) return { attribut: r.trim(), valeurs: [] };
      return {
        attribut: r.slice(0, i).trim(),
        valeurs: r.slice(i + 1).split(',').map((v) => v.trim()).filter(Boolean),
      };
    })
    .filter((r) => r.attribut);
}

const norm = (v) => String(v).trim().toLowerCase();

/**
 * Revendications techniques qui traversent le jeton sans rien dire de la
 * personne : identifiant de session, adresse IP, méthode d'authentification…
 * Elles changent d'une connexion à l'autre ou sont identiques pour tout le
 * monde : bâtir une autorisation dessus ne protégerait rien.
 */
const INUTILISABLES = new Set([
  'sid', 'ipaddr', 'acr', 'amr', 'azp', 'azpacr', 'appid', 'appidacr', 'idp',
  'auth_time', 'xms_st', 'xms_tcdt', 'xms_cc', 'login_hint', 'tenant_region_scope',
]);

const utilisable = (nom) => !INUTILISABLES.has(String(nom));

/**
 * Un attribut de jeton peut être une chaîne, une liste, ou une chaîne à
 * séparateurs. On ne découpe QUE sur la virgule et le point-virgule : découper
 * aussi sur l'espace ferait de « Cadre de santé » trois valeurs distinctes.
 */
function valeursDe(brut) {
  if (brut === null || brut === undefined) return [];
  if (Array.isArray(brut)) return brut.flatMap(valeursDe);
  if (typeof brut === 'object') return [];
  return String(brut).split(/[,;]+/).map((v) => v.trim()).filter(Boolean);
}

/** Attributs d'annuaire portés par le jeton de la session en cours. */
function attributs(req) {
  const session = sso.session(req);
  return session ? lire(session.claims) : {};
}

function lire(brut) {
  if (!brut) return {};
  if (typeof brut === 'object') return brut;
  try {
    const o = JSON.parse(brut);
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

/**
 * Les attributs de ce jeton satisfont-ils les règles ?
 * Renvoie { ok, detail } — `detail` sert au journal et au message d'erreur.
 */
function verifie(claims) {
  const liste = regles();
  if (!liste.length) {
    return { ok: false, detail: 'aucune règle ACCES_ATTRIBUT définie' };
  }
  for (const regle of liste) {
    if (!utilisable(regle.attribut)) continue; // garde-fou : jamais sur du technique
    const presentes = valeursDe(claims[regle.attribut]);
    if (!presentes.length) continue;
    if (!regle.valeurs.length) return { ok: true, detail: `${regle.attribut} présent` };
    const trouvee = regle.valeurs.find((attendue) => presentes.some((p) => norm(p) === norm(attendue)));
    if (trouvee) return { ok: true, detail: `${regle.attribut} = ${trouvee}` };
  }
  return {
    ok: false,
    detail: `aucun attribut attendu (${liste.map((r) => r.attribut).join(', ')})`,
  };
}

/**
 * Cette personne peut-elle entrer, indépendamment de toute fiche référent ?
 *   - tenant   : oui dès qu'elle est connectée ;
 *   - attribut : oui si ses attributs correspondent ;
 *   - liste    : non — seule la fiche référent ouvre la porte.
 */
function ouvertePour(req) {
  const m = mode();
  if (m === 'liste') return { ok: false, detail: 'habilitation nominative' };
  if (!sso.currentUser(req)) return { ok: false, detail: 'non connecté' };
  if (m === 'tenant') return { ok: true, detail: 'membre du tenant' };
  return verifie(attributs(req));
}

/** État lisible, pour le panneau d'administration. */
function etat() {
  const m = mode();
  const r = regles();
  return {
    mode: m,
    titre: {
      tenant: 'Ouvert à tout le tenant Microsoft 365',
      attribut: 'Selon les attributs du compte Microsoft',
      liste: 'Référents déclarés uniquement',
    }[m],
    regles: r.map((x) => ({ attribut: x.attribut, valeurs: x.valeurs })),
    configure: m !== 'attribut' || r.length > 0,
  };
}

module.exports = { mode, regles, attributs, valeursDe, verifie, ouvertePour, etat, utilisable, MODES };
