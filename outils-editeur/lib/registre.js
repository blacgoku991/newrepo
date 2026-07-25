'use strict';

/**
 * Registre local des sociétés clientes et de leurs licences.
 *
 * Fichier : ~/.algonis/clients.json (droits 0600, écriture atomique).
 * Il ne contient aucun secret — uniquement ce que vous avez déjà envoyé aux
 * clients — mais il reste sur votre poste : c'est votre mémoire commerciale.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sig = require('./signature');

const FICHIER = () => path.join(sig.dossierAlgonis(), 'clients.json');
const VIDE = { v: 1, societes: [] };

function charger() {
  try {
    const brut = JSON.parse(fs.readFileSync(FICHIER(), 'utf8'));
    if (!brut || !Array.isArray(brut.societes)) return { ...VIDE };
    return { v: 1, societes: brut.societes };
  } catch {
    return { ...VIDE };
  }
}

function enregistrer(donnees) {
  const dossier = sig.dossierAlgonis();
  fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
  const tmp = path.join(dossier, `.clients-${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(donnees, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, FICHIER());
}

const id = () => crypto.randomBytes(8).toString('hex');
const maintenant = () => new Date().toISOString();

/** Licence en cours = celle dont la date de fin est la plus lointaine. */
function licenceCourante(societe) {
  const l = (societe.licences || []).slice().sort((a, b) => String(a.fin).localeCompare(String(b.fin)));
  return l.length ? l[l.length - 1] : null;
}

function joursRestants(fin, aujourdhui = sig.aujourdhui()) {
  if (!fin) return null;
  const ms = Date.parse(`${fin}T23:59:59Z`) - Date.parse(`${aujourdhui}T00:00:00Z`);
  return Math.floor(ms / 86400000);
}

/**
 * Statut commercial d'une société :
 *   aucune | active | bientot (≤ 30 j) | expiree
 */
function statut(societe, aujourdhui = sig.aujourdhui()) {
  const courante = licenceCourante(societe);
  if (!courante) return { code: 'aucune', libelle: 'Aucune licence', jours: null, fin: null };
  const jours = joursRestants(courante.fin, aujourdhui);
  const limite = courante.grace ? jours + Number(courante.grace) : jours;
  if (limite < 0) return { code: 'expiree', libelle: 'Expirée', jours, fin: courante.fin };
  if (jours <= 30) return { code: 'bientot', libelle: `Expire dans ${jours} j`, jours, fin: courante.fin };
  return { code: 'active', libelle: 'Active', jours, fin: courante.fin };
}

/** Vue enrichie envoyée à l'interface. */
function vue(aujourdhui = sig.aujourdhui()) {
  const { societes } = charger();
  const enrichies = societes.map((s) => ({
    ...s,
    licences: (s.licences || []).slice().sort((a, b) => String(b.emis || b.debut).localeCompare(String(a.emis || a.debut))),
    courante: licenceCourante(s),
    statut: statut(s, aujourdhui),
  }));
  const compte = (code) => enrichies.filter((s) => s.statut.code === code).length;
  return {
    societes: enrichies,
    resume: {
      total: enrichies.length,
      actives: compte('active'),
      bientot: compte('bientot'),
      expirees: compte('expiree'),
      sansLicence: compte('aucune'),
    },
  };
}

function trouver(donnees, idSociete) {
  return donnees.societes.find((s) => s.id === idSociete) || null;
}

function creer({ nom, contact, installId, note }) {
  const donnees = charger();
  const societe = {
    id: id(),
    nom: String(nom).trim(),
    contact: contact ? String(contact).trim().slice(0, 160) : '',
    installId: installId ? String(installId).trim().slice(0, 64) : '',
    note: note ? String(note).slice(0, 500) : '',
    cree: maintenant(),
    licences: [],
  };
  donnees.societes.push(societe);
  enregistrer(donnees);
  return societe;
}

function modifier(idSociete, champs) {
  const donnees = charger();
  const societe = trouver(donnees, idSociete);
  if (!societe) return null;
  if (champs.nom !== undefined) societe.nom = String(champs.nom).trim();
  if (champs.contact !== undefined) societe.contact = String(champs.contact).trim().slice(0, 160);
  if (champs.installId !== undefined) societe.installId = String(champs.installId).trim().slice(0, 64);
  if (champs.note !== undefined) societe.note = String(champs.note).slice(0, 500);
  enregistrer(donnees);
  return societe;
}

function supprimer(idSociete) {
  const donnees = charger();
  const avant = donnees.societes.length;
  donnees.societes = donnees.societes.filter((s) => s.id !== idSociete);
  if (donnees.societes.length === avant) return false;
  enregistrer(donnees);
  return true;
}

// Seuls ces champs sont conservés : une licence importée vient d'un texte
// extérieur, on ne recopie pas ce qu'elle contiendrait en plus.
const CHAMPS_LICENCE = ['client', 'debut', 'fin', 'grace', 'emis', 'install', 'note', 'jeton', 'importee'];

function ajouterLicence(idSociete, licence) {
  const donnees = charger();
  const societe = trouver(donnees, idSociete);
  if (!societe) return null;
  societe.licences = societe.licences || [];
  // Une licence déjà présente (même jeton) n'est pas dupliquée à l'import.
  if (societe.licences.some((l) => l.jeton === licence.jeton)) return { societe, doublon: true };
  const propre = { id: id() };
  for (const champ of CHAMPS_LICENCE) if (licence[champ] !== undefined) propre[champ] = licence[champ];
  societe.licences.push(propre);
  if (licence.install && !societe.installId) societe.installId = licence.install;
  enregistrer(donnees);
  return { societe, doublon: false };
}

module.exports = {
  FICHIER, charger, enregistrer, vue, creer, modifier, supprimer,
  ajouterLicence, licenceCourante, statut, joursRestants,
};
