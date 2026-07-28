'use strict';

/**
 * Activité et santé des portails clients, vues depuis le panel.
 *
 * Les bases des sociétés sont ouvertes en LECTURE SEULE, et uniquement pour en
 * tirer des compteurs : nombre de demandes, dernière activité, échecs. Aucune
 * donnée nominative ne remonte ici — le panel n'a pas à connaître les salariés
 * de ses clients, et une fuite du panel ne doit rien apprendre d'eux.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const db = require('./db');
const orchestrateur = require('./orchestrateur');

/** Au-delà, un portail qui repart sans cesse n'est pas un incident isolé. */
const SEUIL_BOUCLE = 3;

/** Compteurs d'une société, ou `null` si sa base n'existe pas encore. */
function activite(sousDomaine) {
  const fichier = path.join(orchestrateur.INSTANCES, sousDomaine, 'portail.db');
  if (!fs.existsSync(fichier)) return null;
  let conn;
  try {
    // Lecture seule : le panel ne doit jamais écrire dans la base d'un client,
    // et une instance en cours d'écriture ne doit pas être gênée.
    conn = new Database(fichier, { readonly: true, fileMustExist: true });
    const total = conn.prepare('SELECT COUNT(*) n FROM requests').get().n;
    const parStatut = {};
    for (const r of conn.prepare('SELECT status, COUNT(*) n FROM requests GROUP BY status').all()) {
      parStatut[r.status] = r.n;
    }
    const derniere = conn.prepare('SELECT MAX(created_at) d FROM requests').get().d;
    const semaine = conn.prepare(
      "SELECT COUNT(*) n FROM requests WHERE created_at >= datetime('now', '-7 days')"
    ).get().n;
    const comptes = conn.prepare('SELECT COUNT(*) n FROM created_accounts').get().n;
    const referents = conn.prepare('SELECT COUNT(*) n FROM referents WHERE active = 1').get().n;
    return {
      total,
      semaine,
      comptesCrees: comptes,
      referents,
      enAttente: parStatut.en_attente || 0,
      enCours: parStatut.en_cours || 0,
      terminees: parStatut.terminee || 0,
      echecs: parStatut.echec || 0,
      derniereDemande: derniere || null,
      // Un portail dont une demande sur cinq échoue mérite qu'on aille voir.
      tauxEchec: total ? Math.round(((parStatut.echec || 0) / total) * 100) : 0,
    };
  } catch {
    // Base verrouillée ou corrompue : on ne fait pas tomber le panel pour un
    // compteur. L'absence de chiffres est en soi une information.
    return null;
  } finally {
    try { if (conn) conn.close(); } catch { /* déjà fermée */ }
  }
}

/**
 * Points d'attention sur l'ensemble du parc.
 * Rendus par ordre de gravité : ce qu'il faut regarder d'abord vient en tête.
 */
function alertes() {
  const marche = orchestrateur.etat();
  const out = [];
  for (const s of db.vue()) {
    if (s.archivee || !s.sousDomaine) continue;
    const vivante = marche[s.sousDomaine];

    if (vivante && vivante.redemarrages >= SEUIL_BOUCLE) {
      out.push({
        gravite: 'danger',
        societe: s.nom,
        titre: 'Portail instable',
        detail: `${vivante.redemarrages} redémarrages — le portail repart en boucle, ses réglages sont probablement en cause.`,
      });
    }
    if (!vivante && s.licence && s.licence.joursRestants >= 0) {
      out.push({
        gravite: 'danger',
        societe: s.nom,
        titre: 'Portail arrêté',
        detail: 'La licence est valable mais le portail ne tourne pas : les référents ne peuvent rien déposer.',
      });
    }
    if (!s.licence) {
      out.push({
        gravite: 'attention', societe: s.nom, titre: 'Aucune licence',
        detail: 'Le portail ne peut pas démarrer tant qu’une licence n’a pas été émise.',
      });
    } else if (s.licence.joursRestants < 0) {
      out.push({
        gravite: 'danger', societe: s.nom, titre: 'Licence expirée',
        detail: `Échue depuis ${-s.licence.joursRestants} jours.`,
      });
    } else if (s.licence.joursRestants <= 30) {
      out.push({
        gravite: 'attention', societe: s.nom, titre: 'Licence à renouveler',
        detail: `${s.licence.joursRestants} jours restants.`,
      });
    }

    const a = vivante ? activite(s.sousDomaine) : null;
    if (a && a.total >= 10 && a.tauxEchec >= 20) {
      out.push({
        gravite: 'attention', societe: s.nom, titre: 'Beaucoup d’échecs',
        detail: `${a.tauxEchec} % des demandes échouent (${a.echecs} sur ${a.total}).`,
      });
    }
    if (a && a.enAttente >= 5) {
      out.push({
        gravite: 'attention', societe: s.nom, titre: 'File d’attente',
        detail: `${a.enAttente} demandes en attente de traitement.`,
      });
    }
  }
  const rang = { danger: 0, attention: 1 };
  return out.sort((x, y) => rang[x.gravite] - rang[y.gravite]);
}

/** Vue du parc enrichie de l'activité — ce que le panel affiche. */
function parc() {
  const marche = orchestrateur.etat();
  return db.vue().map((s) => {
    const vivante = s.sousDomaine ? marche[s.sousDomaine] : null;
    return {
      ...s,
      instance: vivante
        ? { enMarche: true, port: vivante.port, depuis: vivante.depuis, redemarrages: vivante.redemarrages,
            instable: vivante.redemarrages >= SEUIL_BOUCLE }
        : { enMarche: false },
      activite: s.sousDomaine ? activite(s.sousDomaine) : null,
    };
  });
}

module.exports = { parc, alertes, activite, SEUIL_BOUCLE };
