'use strict';

/**
 * Durées de conservation.
 *
 * Le RGPD ne dit pas « gardez peu » : il dit de ne pas garder au-delà de ce que
 * la finalité exige, et de savoir dire combien de temps. C'est ce module qui
 * répond, et qui applique.
 *
 * Deux catégories très différentes cohabitent ici :
 *
 *  - Les CAPTURES D'ÉCRAN des robots. Elles servent à comprendre un échec le
 *    jour même, jamais après. Or elles photographient des écrans d'application
 *    de santé : on y voit des résidents, leurs chambres, parfois leur dossier.
 *    C'est, de tout ce que le portail détient, ce qui expose le plus — et ce
 *    qui sert le moins longtemps. 1 jour.
 *
 *  - Les DONNÉES DE GESTION (demandes, comptes créés, journal). Elles font la
 *    preuve de ce qui a été fait, et le journal d'un accès doit pouvoir être
 *    produit après coup. Des mois, donc, pas des jours.
 *
 * Tout est réglable par variable d'environnement, mais les valeurs par défaut
 * sont celles qu'on peut défendre devant un DPO sans rien changer.
 */

const fs = require('fs');
const path = require('path');

const db = require('./db');

/** Durée en jours, lue dans l'environnement, avec un plancher et un plafond. */
function jours(cle, defaut, min = 0, max = 3650) {
  const v = Number(process.env[cle]);
  if (!Number.isFinite(v)) return defaut;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/**
 * Le registre des durées, tel qu'il est affiché aux personnes concernées.
 * Toute entrée ajoutée ici apparaît dans la politique de confidentialité et
 * dans l'administration : on ne peut pas conserver quelque chose en silence.
 */
function registre() {
  return [
    {
      cle: 'captures',
      libelle: 'Captures d’écran des robots',
      contenu: 'Images des écrans des applications métiers pendant le traitement, susceptibles de contenir des données de santé.',
      finalite: 'Comprendre un échec de traitement.',
      jours: jours('RETENTION_CAPTURES_JOURS', 1, 0, 90),
    },
    {
      cle: 'demandes',
      libelle: 'Demandes traitées',
      contenu: 'Identité du salarié concerné, établissement, fonction, dates, identifiant créé. Jamais le mot de passe.',
      finalite: 'Suivi des comptes ouverts et preuve de l’opération.',
      jours: jours('RETENTION_DEMANDES_JOURS', 365, 30),
    },
    {
      cle: 'journal',
      libelle: 'Journal d’activité',
      contenu: 'Qui a fait quoi, quand, depuis quelle adresse IP.',
      finalite: 'Sécurité et traçabilité des accès.',
      jours: jours('RETENTION_JOURNAL_JOURS', 365, 30),
    },
    {
      cle: 'comptes',
      libelle: 'Registre des comptes créés',
      contenu: 'Identifiant, nom, prénom, établissement des comptes ouverts par le portail.',
      finalite: 'Éviter les doublons d’identifiants et retrouver un compte existant.',
      jours: jours('RETENTION_COMPTES_JOURS', 1095, 90),
    },
    {
      cle: 'emails',
      libelle: 'Boîte d’envoi',
      contenu: 'Corps des e-mails d’identifiants envoyés.',
      finalite: 'Vérifier qu’un envoi a bien eu lieu.',
      jours: jours('RETENTION_EMAILS_JOURS', 30, 1),
    },
    {
      cle: 'liens',
      libelle: 'Liens de remise d’identifiants',
      contenu: 'Jeton haché et mot de passe chiffré, à usage unique.',
      finalite: 'Remettre un mot de passe sans l’envoyer en clair.',
      jours: jours('RETENTION_LIENS_JOURS', 30, 1),
    },
  ];
}

const dureeDe = (cle) => registre().find((r) => r.cle === cle).jours;

/**
 * Supprime les captures d'écran plus vieilles que la durée retenue.
 *
 * On efface le DOSSIER de la demande, pas seulement les fichiers : un dossier
 * vide laissé derrière révèle encore qu'une demande a existé, avec sa
 * référence. Et la liste `artifacts` de la demande est vidée en même temps,
 * pour que l'administration ne propose pas des liens vers des images disparues.
 */
function purgerCaptures() {
  const duree = dureeDe('captures');
  const racine = db.ARTIFACTS_DIR;
  if (!fs.existsSync(racine)) return { dossiers: 0, fichiers: 0 };
  const limite = Date.now() - duree * 86400 * 1000;
  let dossiers = 0;
  let fichiers = 0;
  const references = [];

  for (const entree of fs.readdirSync(racine, { withFileTypes: true })) {
    const chemin = path.join(racine, entree.name);
    let stat;
    try { stat = fs.statSync(chemin); } catch { continue; }
    if (!entree.isDirectory()) {
      // Fichier isolé à la racine : il n'appartient à aucune demande.
      if (stat.mtimeMs < limite) { try { fs.unlinkSync(chemin); fichiers += 1; } catch { /* déjà parti */ } }
      continue;
    }
    // La date du dossier suit celle de la dernière capture écrite dedans.
    let recent = stat.mtimeMs;
    let compte = 0;
    for (const f of fs.readdirSync(chemin, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      compte += 1;
      try { recent = Math.max(recent, fs.statSync(path.join(chemin, f.name)).mtimeMs); } catch { /* ignoré */ }
    }
    if (recent >= limite) continue;
    try {
      fs.rmSync(chemin, { recursive: true, force: true });
      dossiers += 1;
      fichiers += compte;
      references.push(entree.name);
    } catch { /* verrouillé : au prochain passage */ }
  }

  if (references.length) db.forgetArtifacts(references);
  return { dossiers, fichiers };
}

/** Supprime les lignes échues de chaque table, selon le registre. */
function purgerBase() {
  return db.purgeRetention({
    demandes: dureeDe('demandes'),
    journal: dureeDe('journal'),
    comptes: dureeDe('comptes'),
    emails: dureeDe('emails'),
    liens: dureeDe('liens'),
  });
}

/**
 * Un passage complet. Tracé au journal : une suppression automatique doit
 * pouvoir être expliquée, y compris quand personne ne l'a demandée.
 */
function passer(par = 'automatique') {
  const captures = purgerCaptures();
  const base = purgerBase();
  const total = captures.fichiers + Object.values(base).reduce((a, b) => a + b, 0);
  if (total) {
    const detail = [
      captures.fichiers ? `${captures.fichiers} capture(s)` : '',
      base.demandes ? `${base.demandes} demande(s)` : '',
      base.journal ? `${base.journal} entrée(s) de journal` : '',
      base.comptes ? `${base.comptes} compte(s)` : '',
      base.emails ? `${base.emails} e-mail(s)` : '',
      base.liens ? `${base.liens} lien(s)` : '',
    ].filter(Boolean).join(', ');
    db.audit(par, 'purge_conservation', '', detail, '');
    console.log(`[conservation] Purge : ${detail}`);
  }
  return { captures, base };
}

/**
 * Programme la purge : une au démarrage, puis toutes les six heures.
 *
 * Au démarrage surtout : un portail arrêté trois jours ne doit pas garder ses
 * captures trois jours de plus au motif que personne ne tournait pour les
 * effacer.
 */
function programmer() {
  try { passer('démarrage'); } catch (e) { console.warn(`[conservation] ${e.message}`); }
  setInterval(() => {
    try { passer('automatique'); } catch (e) { console.warn(`[conservation] ${e.message}`); }
  }, 6 * 3600 * 1000).unref();
  const c = dureeDe('captures');
  console.log(`[conservation] Captures des robots : ${c === 0 ? 'effacées dès le traitement terminé' : `${c} jour(s)`}`
    + ` — demandes : ${dureeDe('demandes')} j, journal : ${dureeDe('journal')} j`);
}

module.exports = { registre, purgerCaptures, purgerBase, passer, programmer, dureeDe };
