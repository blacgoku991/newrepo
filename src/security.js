'use strict';

/**
 * Durcissement sécurité du portail — sans dépendance externe.
 *
 * 1. En-têtes de sécurité (CSP, X-Frame-Options, nosniff, HSTS…)
 * 2. Rate limiting en mémoire (anti brute-force et anti-spam)
 * 3. Contrôle d'origine des requêtes qui modifient l'état (anti-CSRF)
 *
 * Voir SECURITY.md pour l'audit complet et la checklist de mise en production.
 */

// --- 1. En-têtes de sécurité ------------------------------------------------

const CSP = [
  "default-src 'self'",
  // Aucun script inline dans le projet : script-src reste strict.
  "script-src 'self'",
  // Styles : fichiers locaux + attributs style inline. Aucune origine externe.
  "style-src 'self' 'unsafe-inline'",
  // Polices auto-hébergées : rien ne part vers Google. Une page ouverte ne
  // signale plus l'adresse IP d'un salarié du client à un tiers.
  "font-src 'self' data:",
  // Toutes les images viennent du portail — y compris les logos des éditeurs.
  // Les charger depuis leurs sites annonçait chaque consultation à BlueKanGo et
  // à Orisha, et pointait vers l'instance NetSoins d'UN client pour tous.
  "img-src 'self' data:",
  "connect-src 'self'",
  // Le portail ne doit jamais être affiché dans une iframe (clickjacking).
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://login.microsoftonline.com",
].join('; ');

function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // HSTS uniquement quand on sert réellement du HTTPS (sinon on bloquerait le dev local).
  const isHttps = req.headers['x-forwarded-proto'] === 'https' || req.secure;
  if (isHttps) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

// --- 2. Rate limiting en mémoire --------------------------------------------

const buckets = new Map(); // "nom:clé" -> { count, resetAt }

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of buckets) if (value.resetAt <= now) buckets.delete(key);
}, 60 * 1000).unref();

/**
 * Adresse IP du client.
 *
 * `X-Forwarded-For` n'est PAS digne de confiance par défaut : n'importe qui
 * peut l'envoyer, et le faire varier suffirait à réduire à néant le rate
 * limiting (force brute sur la connexion admin, sur les liens d'identifiants…)
 * comme à falsifier le journal d'activité. On ne s'y fie que si l'on a été
 * explicitement prévenu qu'un reverse proxy de confiance est en amont
 * (TRUST_PROXY=true), ce qui est le seul cas où l'en-tête est réécrit par
 * l'infrastructure.
 */
const TRUST_PROXY = /^(1|true|yes)$/i.test(String(process.env.TRUST_PROXY || ''));

/**
 * Adresses depuis lesquelles l'en-tête est cru, quand TRUST_PROXY est actif.
 *
 * Faire confiance à `X-Forwarded-For` sans regarder QUI l'envoie, c'est faire
 * confiance à tout le monde : il suffirait d'atteindre le port de l'instance
 * autrement que par le proxy pour se choisir une adresse à chaque requête, et
 * la limitation de débit ne limiterait plus rien. En hébergement, le proxy est
 * sur la même machine ; on ne croit donc l'en-tête que s'il vient de la boucle
 * locale — ou d'une adresse explicitement déclarée.
 */
const PROXIES = new Set(
  (process.env.TRUST_PROXY_FROM || '127.0.0.1,::1,::ffff:127.0.0.1')
    .split(',').map((v) => v.trim()).filter(Boolean)
);

function clientIp(req) {
  const pair = req.socket?.remoteAddress || 'inconnu';
  if (TRUST_PROXY && PROXIES.has(pair)) {
    // Le proxy qui nous précède REMPLACE cet en-tête par la seule adresse qu'il
    // a établie ; il ne complète pas ce que le visiteur a envoyé. La première
    // valeur est donc la bonne — et il n'y en a qu'une.
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    // Une valeur qui n'a pas la forme d'une adresse ne sert qu'à polluer les
    // compteurs et le journal : on la jette.
    if (/^[0-9a-fA-F:.]{3,45}$/.test(fwd)) return fwd;
  }
  return pair;
}

/**
 * Crée un middleware de limitation : au plus `max` requêtes par `windowMs`
 * et par adresse IP. Au-delà : 429 avec délai de réessai.
 */
/**
 * Purge des compteurs échus. Sans elle, la table grossit indéfiniment (une
 * entrée par IP et par quota) : un flot d'adresses différentes finirait par
 * saturer la mémoire du portail. On nettoie au plus une fois par minute, et
 * seulement quand il y a matière.
 */
let dernierNettoyage = 0;
function nettoyerCompteurs(now) {
  if (now - dernierNettoyage < 60 * 1000 || buckets.size < 500) return;
  dernierNettoyage = now;
  for (const [cle, seau] of buckets) {
    if (seau.resetAt <= now) buckets.delete(cle);
  }
}

function rateLimit(name, max, windowMs) {
  return (req, res, next) => {
    const key = `${name}:${clientIp(req)}`;
    const now = Date.now();
    nettoyerCompteurs(now);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retry = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res
        .status(429)
        .json({ error: `Trop de tentatives. Réessayez dans ${Math.ceil(retry / 60)} min.` });
    }
    next();
  };
}

/** Efface le compteur (ex. après une connexion réussie). */
function clearRateLimit(name, req) {
  buckets.delete(`${name}:${clientIp(req)}`);
}

// --- 3. Anti-CSRF : contrôle d'origine --------------------------------------

/**
 * Les navigateurs envoient l'en-tête Origin sur toute requête cross-site qui
 * modifie l'état : si Origin est présent et ne correspond ni à notre hôte ni
 * aux origines autorisées (CORS), la requête est rejetée. Les clients sans
 * navigateur (robot, curl) n'envoient pas d'Origin et ne sont pas concernés.
 */
function csrfOriginCheck(allowedOrigins) {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    let host = null;
    try {
      host = new URL(origin).host;
    } catch {
      return res.status(403).json({ error: 'Origine invalide' });
    }
    if (host === req.headers.host) return next();
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return next();
    return res.status(403).json({ error: 'Origine non autorisée' });
  };
}

module.exports = { securityHeaders, rateLimit, clearRateLimit, csrfOriginCheck, clientIp };
