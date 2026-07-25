'use strict';

/**
 * Lecture des attributs d'annuaire via Microsoft Graph.
 *
 * Pourquoi ne pas se contenter du jeton d'identité : Entra ID n'y met que le
 * strict nécessaire. Les attributs personnalisés Exchange
 * (CustomAttribute1..15 = `onPremisesExtensionAttributes.extensionAttribute*`),
 * le service, la fonction ou le matricule n'en font pas partie, et les faire
 * sortir dans le jeton demande une configuration délicate (revendications
 * facultatives d'extension d'annuaire, voire stratégie de mappage de
 * revendications avec clé de signature dédiée).
 *
 * Il est bien plus simple de les demander à Graph juste après la connexion,
 * avec les identifiants de l'application. Un jeton applicatif est mis en cache
 * jusqu'à son expiration ; l'appel est fait une fois par connexion.
 *
 * Prérequis côté Entra ID : sur l'inscription d'application, permission
 * D'APPLICATION `User.Read.All` (Microsoft Graph) avec consentement
 * administrateur. Le secret client est déjà celui du SSO.
 *
 * Activation : `M365_GRAPH_ATTRIBUTS=true` dans le .env. Sans cela, rien n'est
 * appelé — le portail fonctionne exactement comme avant.
 */

const CHAMPS = [
  'onPremisesExtensionAttributes',
  'department',
  'jobTitle',
  'officeLocation',
  'companyName',
  'employeeId',
  'employeeType',
  'city',
  'usageLocation',
];

const TIMEOUT_MS = 6000;
let cacheJeton = { valeur: null, expire: 0 };
let dernierEchec = null;

const actif = () => String(process.env.M365_GRAPH_ATTRIBUTS || '').toLowerCase() === 'true';

function configure() {
  return Boolean(
    actif() && process.env.M365_TENANT_ID && process.env.M365_CLIENT_ID && process.env.M365_CLIENT_SECRET,
  );
}

/** Jeton applicatif (client credentials), mis en cache jusqu'à 60 s de la fin. */
async function jetonApplication() {
  if (cacheJeton.valeur && Date.now() < cacheJeton.expire) return cacheJeton.valeur;

  const url = `https://login.microsoftonline.com/${encodeURIComponent(process.env.M365_TENANT_ID)}/oauth2/v2.0/token`;
  const corps = new URLSearchParams({
    client_id: process.env.M365_CLIENT_ID,
    client_secret: process.env.M365_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const rep = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corps,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await rep.json().catch(() => ({}));
  if (!rep.ok || !data.access_token) {
    throw new Error(data.error_description || `jeton applicatif refusé (HTTP ${rep.status})`);
  }
  cacheJeton = {
    valeur: data.access_token,
    expire: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000,
  };
  return cacheJeton.valeur;
}

/**
 * Attributs d'annuaire d'un utilisateur, aplatis comme des revendications :
 * `extensionAttribute2`, `department`, `jobTitle`… Les valeurs vides sont
 * écartées pour ne pas polluer l'écran d'inspection.
 *
 * Ne lève jamais : une panne Graph ne doit pas empêcher quelqu'un de se
 * connecter. L'échec est mémorisé et affiché dans le panneau d'administration.
 */
async function attributsDe(identifiant) {
  if (!configure() || !identifiant) return {};
  try {
    const jeton = await jetonApplication();
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(identifiant)}`
      + `?$select=${CHAMPS.join(',')}`;
    const rep = await fetch(url, {
      headers: { Authorization: `Bearer ${jeton}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await rep.json().catch(() => ({}));
    if (!rep.ok) {
      throw new Error((data.error && data.error.message) || `Graph a répondu HTTP ${rep.status}`);
    }
    dernierEchec = null;
    return aplatir(data);
  } catch (e) {
    dernierEchec = { quand: new Date().toISOString(), message: e.message };
    return {};
  }
}

function aplatir(data) {
  const out = {};
  const ext = data.onPremisesExtensionAttributes || {};
  for (const [cle, val] of Object.entries(ext)) {
    if (val !== null && val !== undefined && String(val).trim() !== '') out[cle] = String(val).trim();
  }
  for (const champ of CHAMPS) {
    if (champ === 'onPremisesExtensionAttributes') continue;
    const val = data[champ];
    if (val !== null && val !== undefined && String(val).trim() !== '') out[champ] = String(val).trim();
  }
  return out;
}

/** État lisible pour le panneau d'administration. */
function etat() {
  return {
    actif: actif(),
    configure: configure(),
    champs: CHAMPS,
    dernierEchec,
  };
}

module.exports = { attributsDe, configure, etat, CHAMPS };
