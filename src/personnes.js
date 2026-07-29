'use strict';

/**
 * Droits des personnes (RGPD, articles 15 à 20).
 *
 * Un salarié dont le portail a ouvert un compte peut demander ce qui est
 * conservé sur lui, en obtenir une copie, et en demander l'effacement. Sans
 * outil, cela veut dire fouiller une base à la main : en pratique, la demande
 * n'aboutit pas, ou trop tard. Ce module la rend traitable en quelques clics
 * par l'administrateur de la société — qui est le responsable de traitement.
 *
 * Deux partis pris.
 *
 * 1. ON EFFACE, MAIS PAS LA TRACE DE SÉCURITÉ. Les demandes, les comptes du
 *    registre, les e-mails partent. Le journal d'activité, lui, est
 *    ANONYMISÉ : savoir qu'un accès a eu lieu à telle heure depuis telle
 *    adresse reste nécessaire à la sécurité du système, et l'article 17.3(b)
 *    et (e) le permet. On remplace donc l'identité, on ne supprime pas la ligne.
 *
 * 2. LA DEMANDE ELLE-MÊME EST TRACÉE. Qui a demandé, qui a traité, quand, et
 *    ce qui a été effacé : c'est ce qui permet de démontrer qu'on a répondu.
 */

const db = require('./db');

/** Comparaison indifférente à la casse et aux accents. */
const normaliser = (v) => String(v == null ? '' : v)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .trim().toLowerCase();

/**
 * Clé d'identité d'un enregistrement.
 *
 * C'est le NOM et le PRÉNOM qui font la clé, jamais l'adresse — parce que
 * l'adresse manque là où elle compte le plus. Le registre des comptes créés ne
 * retient que nom, prénom et identifiant : en indexant sur l'adresse quand elle
 * existe, une même personne se retrouvait sous deux clés, sa demande d'un côté
 * et son compte de l'autre. L'effacement passait alors à côté du registre et y
 * laissait son identité — précisément ce qu'elle demandait de retirer.
 *
 * Les enregistrements qui ne portent qu'une adresse (référents, journal) sont
 * rattachés dans un second temps, par `rapprocher()`.
 */
function cleDe({ email, nom, prenom }) {
  const n = `${normaliser(nom)} ${normaliser(prenom)}`.trim();
  if (n) return `nom:${n}`;
  const e = normaliser(email);
  return e ? `mail:${e}` : '';
}

function payloadDe(ligne) {
  try { return JSON.parse(ligne.payload || '{}'); } catch { return {}; }
}

/**
 * Table adresse → clé d'identité, construite sur les enregistrements qui
 * portent les deux. Elle permet de rattacher à la bonne personne ce qui ne
 * porte qu'une adresse.
 */
function rapprocher() {
  const parAdresse = new Map();
  const noter = (email, nom, prenom) => {
    const e = normaliser(email);
    const cle = cleDe({ nom, prenom });
    if (e && cle.startsWith('nom:')) parAdresse.set(e, cle);
  };
  for (const r of db.listAll()) {
    const p = payloadDe(r);
    noter(p.email, p.nom, p.prenom);
  }
  for (const ref of db.listReferents()) noter(ref.email, ref.nom, ref.prenom);
  return parAdresse;
}

/** Clé d'identité d'un enregistrement, en tenant compte des rapprochements. */
function cleAvecRapprochement(identite, parAdresse) {
  const e = normaliser(identite.email);
  if (e && parAdresse.has(e)) return parAdresse.get(e);
  return cleDe(identite);
}

/**
 * Cherche des personnes par un fragment de nom, de prénom, d'adresse ou
 * d'identifiant. Rend une fiche par personne, avec le compte de ce qui la
 * concerne — pas encore le détail.
 */
function chercher(terme) {
  const t = normaliser(terme);
  if (t.length < 2) return [];
  const personnes = new Map();
  const parAdresse = rapprocher();

  const ajouter = (identite, categorie) => {
    const cle = cleAvecRapprochement(identite, parAdresse);
    if (!cle) return;
    let fiche = personnes.get(cle);
    if (!fiche) {
      fiche = { cle, email: identite.email || '', nom: identite.nom || '', prenom: identite.prenom || '', compte: {} };
      personnes.set(cle, fiche);
    }
    // La première identité rencontrée n'a pas toujours tous les champs.
    fiche.email = fiche.email || identite.email || '';
    fiche.nom = fiche.nom || identite.nom || '';
    fiche.prenom = fiche.prenom || identite.prenom || '';
    fiche.compte[categorie] = (fiche.compte[categorie] || 0) + 1;
  };

  const correspond = (...valeurs) => valeurs.some((v) => normaliser(v).includes(t));

  for (const r of db.listAll()) {
    const p = payloadDe(r);
    if (!correspond(p.nom, p.prenom, p.email, p.identifiant, r.generated_login, r.reference)) continue;
    ajouter({ email: p.email, nom: p.nom, prenom: p.prenom }, 'demandes');
  }
  for (const c of db.listCreatedAccounts(100000)) {
    if (!correspond(c.nom, c.prenom, c.login)) continue;
    ajouter({ nom: c.nom, prenom: c.prenom }, 'comptes');
  }
  for (const ref of db.listReferents()) {
    if (!correspond(ref.nom, ref.prenom, ref.email)) continue;
    ajouter({ email: ref.email, nom: ref.nom, prenom: ref.prenom }, 'referent');
  }
  return [...personnes.values()].sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom));
}

/**
 * Tout ce que le portail détient sur une personne.
 *
 * Le mot de passe n'y figure pas : il n'est jamais conservé. Le lien de remise
 * est mentionné par son existence et sa date, jamais par son contenu — le
 * produire ici reviendrait à rouvrir un secret à usage unique.
 */
function dossier(cle) {
  const c = String(cle || '');
  if (!c) return null;
  const parAdresse = rapprocher();
  const memePersonne = (identite) => cleAvecRapprochement(identite, parAdresse) === c;

  const demandes = [];
  for (const r of db.listAll()) {
    const p = payloadDe(r);
    if (!memePersonne({ email: p.email, nom: p.nom, prenom: p.prenom })) continue;
    demandes.push({
      reference: r.reference, application: r.app_id, demarche: r.type_demande || 'creation',
      statut: r.status, depose: r.created_at, termine: r.finished_at,
      identifiantCree: r.generated_login || '', deposePar: r.demandeur,
      donnees: p,
    });
  }
  const comptes = db.listCreatedAccounts(100000)
    .filter((a) => memePersonne({ nom: a.nom, prenom: a.prenom }))
    .map((a) => ({ application: a.app_id, identifiant: a.login, nom: a.nom, prenom: a.prenom, cree: a.created_at }));
  const referent = db.listReferents().find((r) => memePersonne({ email: r.email, nom: r.nom, prenom: r.prenom })) || null;

  const identite = demandes.length
    ? { email: demandes[0].donnees.email || '', nom: demandes[0].donnees.nom || '', prenom: demandes[0].donnees.prenom || '' }
    : referent ? { email: referent.email, nom: referent.nom, prenom: referent.prenom }
    : comptes.length ? { email: '', nom: comptes[0].nom, prenom: comptes[0].prenom }
    : null;
  if (!identite) return null;

  return {
    cle: c,
    identite,
    demandes,
    comptes,
    referent: referent
      ? { email: referent.email, actif: !!referent.active, declareLe: referent.created_at,
          etablissements: db.referentEtablissements(referent.id) }
      : null,
    journal: db.auditPour(identite).map((e) => ({
      date: e.created_at, action: e.action, cible: e.target, details: e.details, ip: e.ip || '',
    })),
    note: 'Aucun mot de passe ne figure ici : le portail n’en conserve aucun. '
      + 'Les liens de remise d’identifiants sont à usage unique et leur contenu n’est pas reproductible.',
  };
}

/**
 * Efface une personne.
 *
 * @param {string} cle       identité normalisée, telle que rendue par `chercher`
 * @param {string} par       administrateur qui traite la demande
 * @param {string} motif     ce que la personne a demandé, en une phrase
 */
function effacer(cle, par, motif) {
  const d = dossier(cle);
  if (!d) return null;

  const references = d.demandes.map((x) => x.reference);
  const supprime = db.effacerPersonne({
    references,
    comptes: d.comptes.map((c) => ({ appId: c.application, login: c.identifiant })),
    referentEmail: d.referent ? d.referent.email : null,
    identite: d.identite,
  });

  // Écrite APRÈS l'effacement, et avec l'identité en clair : c'est la preuve
  // qu'on a traité la demande, elle n'a de valeur que nominative. Elle suit sa
  // propre durée de conservation, comme le reste du journal.
  db.audit(par, 'rgpd_effacement', `${d.identite.nom} ${d.identite.prenom} ${d.identite.email}`.trim(),
    `${motif || 'droit à l’effacement'} — ${supprime.demandes} demande(s), ${supprime.comptes} compte(s), `
    + `${supprime.journal} entrée(s) de journal anonymisée(s)`, '');
  return supprime;
}

module.exports = { chercher, dossier, effacer, cleDe };
