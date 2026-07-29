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
 * Où en est la mise en service d'une société.
 *
 * Ouvrir un client, ce n'est pas créer une ligne : il faut une licence, un accès
 * Microsoft 365, les identifiants du compte de service de chaque application,
 * des référents déclarés et des mentions légales. Trois de ces cinq étapes
 * dépendent du client. Sans cet écran, on découvre trois semaines plus tard que
 * personne n'a jamais pu se connecter — et c'est le portail qu'on accuse.
 *
 * Lecture seule, et rien que des booléens : on regarde si une clé est posée,
 * jamais sa valeur.
 */
function miseEnService(societe) {
  const reglages = require('./reglages');
  const v = reglages.valeurs(societe.id);
  const etapes = [];

  etapes.push({
    cle: 'licence', libelle: 'Licence émise',
    fait: !!(societe.licence && societe.licence.joursRestants >= 0),
    aQuiDeJouer: 'vous',
    aide: 'Sans licence valable, le portail refuse de démarrer.',
  });
  etapes.push({
    cle: 'sso', libelle: 'Accès Microsoft 365 configuré',
    fait: !!(v.tenantId && v.clientId && v.clientSecret),
    aQuiDeJouer: 'client',
    aide: 'Inscription à créer dans l’Entra ID de la société, puis les trois identifiants à saisir dans les réglages.',
  });

  // Les réglages propres à l'instance vivent dans SA base : identifiants
  // applicatifs, référents, mentions légales.
  let appsCompletes = false;
  let referents = 0;
  let mentions = false;
  const fichier = societe.sousDomaine
    ? path.join(orchestrateur.INSTANCES, societe.sousDomaine, 'portail.db') : null;
  if (fichier && fs.existsSync(fichier)) {
    let conn;
    try {
      conn = new Database(fichier, { readonly: true, fileMustExist: true });
      const reglage = (cle) => {
        const l = conn.prepare('SELECT value FROM app_settings WHERE key = ?').get(cle);
        if (!l) return null;
        try { return JSON.parse(l.value); } catch { return null; }
      };
      const apps = String(v.appsActives || 'bluekango,netsoins').split(',').map((a) => a.trim()).filter(Boolean);
      appsCompletes = apps.length > 0 && apps.every((a) => {
        const s = reglage(`secrets_${a}`);
        // On regarde la PRÉSENCE des clés, jamais leur contenu : elles sont
        // chiffrées avec la clé de l'instance, et n'ont rien à faire ici.
        return !!(s && s.url && s.user && s.password);
      });
      referents = conn.prepare('SELECT COUNT(*) n FROM referents WHERE active = 1').get().n;
      const c = reglage('conformite');
      mentions = !!(c && c.raisonSociale && c.dpoContact && c.hebergeur);
    } catch { /* base absente ou verrouillée : étapes non faites */ } finally {
      try { if (conn) conn.close(); } catch { /* déjà fermée */ }
    }
  }

  etapes.push({
    cle: 'applications', libelle: 'Identifiants des applications métiers saisis',
    fait: appsCompletes, aQuiDeJouer: 'client',
    aide: 'Le compte de service que le robot emploie pour se connecter à BlueKanGo ou NetSoins, à saisir dans les réglages du portail.',
  });
  etapes.push({
    cle: 'referents', libelle: 'Référents déclarés',
    fait: referents > 0, aQuiDeJouer: 'client',
    aide: 'L’accès est fermé par défaut : tant que personne n’est déclaré, toute connexion est refusée.',
  });
  etapes.push({
    cle: 'mentions', libelle: 'Mentions légales renseignées',
    fait: mentions, aQuiDeJouer: 'client',
    aide: 'Raison sociale, contact du DPO et hébergeur. Tant qu’elles manquent, la page publique affiche « à compléter ».',
  });

  const faites = etapes.filter((e) => e.fait).length;
  return { etapes, faites, total: etapes.length, prete: faites === etapes.length, referents };
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
    // Un portail éteint n'est une alerte que si la veille est DÉSACTIVÉE :
    // sinon c'est le fonctionnement normal, il se réveille à la première visite.
    // Sans cette distinction, le bandeau afficherait une alerte rouge par client
    // au repos, et plus personne ne le lirait.
    if (!vivante && !orchestrateur.VEILLE_MINUTES && s.licence && s.licence.joursRestants >= 0) {
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

    // Mise en service incomplète.
    //
    // Sans licence, l'alerte « Aucune licence » ci-dessus dit déjà tout : en
    // ajouter une seconde ne ferait que remplir le bandeau. Et une mise en
    // service en cours n'est pas une avarie — c'est le déroulement normal d'un
    // client qu'on installe. On ne passe au rouge que dans un seul cas : un
    // portail en marche où personne n'est habilité, donc un portail qui refuse
    // tout le monde sans que le client comprenne pourquoi.
    const mes = miseEnService(s);
    if (!mes.prete && s.licence) {
      const manque = mes.etapes.filter((e) => !e.fait).map((e) => e.libelle.toLowerCase());
      const personneNePeutEntrer = !!vivante && mes.referents === 0;
      out.push({
        gravite: personneNePeutEntrer ? 'danger' : 'attention',
        societe: s.nom,
        titre: personneNePeutEntrer
          ? 'Portail ouvert, mais aucun référent'
          : `Mise en service : ${mes.faites}/${mes.total}`,
        detail: personneNePeutEntrer
          ? 'Le portail tourne et refuse tout le monde : aucun compte n’est habilité.'
          : `Reste à faire : ${manque.join(', ')}.`,
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
        // Un portail éteint parce qu'il dort n'est pas un portail en panne :
        // l'interface ne doit pas afficher la même chose dans les deux cas.
        : { enMarche: false, enVeille: orchestrateur.VEILLE_MINUTES > 0 && !s.archivee },
      activite: s.sousDomaine ? activite(s.sousDomaine) : null,
      miseEnService: s.archivee ? null : miseEnService(s),
    };
  });
}

module.exports = { parc, alertes, activite, miseEnService, SEUIL_BOUCLE };
