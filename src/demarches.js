'use strict';

/**
 * Registre des démarches proposées par le portail.
 *
 * Une démarche relie quatre choses : le préfixe de sa référence de suivi, le
 * schéma de formulaire à servir, la fonction du robot qui l'exécute, et son
 * libellé pour l'humain.
 *
 * Tout passe par cette table : ajouter une démarche ne demande plus de toucher
 * au routage du serveur ni au worker. Les identifiants (`creation`,
 * `reset_mdp`…) sont ceux stockés dans la colonne `request_type` — ne pas les
 * renommer sans migration.
 */

const DEMARCHES = {
  creation: {
    label: 'Création de compte',
    court: 'Création',
    // Préfixe repris de l'application (BKG, NS…), la création étant sa démarche
    // principale.
    prefixe: null,
    schema: 'formSchema',
    action: 'createAccount',
    succes: 'Compte créé avec succès',
    audit: 'creation_compte',
    aside: 'Algonis saisit ces informations dans {app}. Une référence de suivi vous est remise à l’envoi.',
  },
  reset_mdp: {
    label: 'Réinitialisation de mot de passe',
    court: 'Réinit. mdp',
    prefixe: 'MDP',
    schema: 'resetSchema',
    action: 'resetPassword',
    succes: 'Mot de passe réinitialisé',
    audit: 'reinit_mdp',
    aside: "Algonis vérifie l'identifiant sur la fiche puis remplace le mot de passe par un provisoire, remis par lien sécurisé.",
  },
  ajout_etab: {
    label: "Ajout d'établissement",
    court: 'Ajout étab.',
    prefixe: 'ETB',
    schema: 'extensionSchema',
    action: 'addEstablishment',
    succes: 'Établissement ajouté',
    audit: 'ajout_etab',
    aside: "Algonis rattache l'établissement supplémentaire au compte existant : les rattachements actuels sont conservés.",
  },
  maj_identite: {
    label: "Correction de l'identité",
    court: 'Identité',
    prefixe: 'IDT',
    schema: 'identiteSchema',
    action: 'updateIdentity',
    succes: 'Identité corrigée',
    audit: 'maj_identite',
    aside: "Algonis corrige le nom et le prénom sur la fiche. L'identifiant de connexion, déjà diffusé au titulaire, n'est pas touché.",
  },
  transfert_etab: {
    label: "Transfert vers un autre établissement",
    court: 'Transfert',
    prefixe: 'TRF',
    schema: 'transfertSchema',
    action: 'transferEstablishment',
    succes: 'Compte transféré',
    audit: 'transfert_etab',
    aside: "Algonis rattache le nouvel établissement puis retire l'ancien : l'accès à l'établissement précédent est perdu.",
  },
};

/** Démarche par défaut quand aucun type n'est précisé. */
const DEFAUT = 'creation';

/**
 * Démarches composées : UNE carte pour le référent, plusieurs démarches réelles
 * derrière. Le formulaire commence par le choix `champ` ; la valeur retenue
 * détermine la démarche effectivement déposée (`options[].type`), qui est seule
 * enregistrée en base. Aucun nouveau `request_type` n'est créé.
 *
 * Objectif métier : « Mettre à jour un compte » regroupe tout ce qui touche un
 * compte existant (mot de passe, identité, établissement) au lieu d'aligner
 * autant de cartes que de cas.
 */
const COMPOSEES = {
  maj_compte: {
    label: 'Mettre à jour un compte',
    court: 'Mise à jour',
    champ: 'operation',
    // `titre` = la question posée (libellé du champ) ; `section` = l'intitulé
    // de l'étape, repris dans le fil des étapes, donc court.
    titre: 'Que voulez-vous mettre à jour ?',
    section: 'Type de mise à jour',
    intro:
      'Une seule démarche pour tout ce qui concerne un compte déjà existant : mot de passe oublié, nom ou prénom à corriger, changement d’établissement.',
    aside:
      'Algonis retrouve le compte sur {app} à partir de son identifiant, puis applique la mise à jour demandée.',
    options: [
      {
        value: 'mot_de_passe',
        type: 'reset_mdp',
        label: 'Mot de passe oublié',
        help: 'Un mot de passe provisoire est généré et remis par lien sécurisé.',
      },
      {
        value: 'identite',
        type: 'maj_identite',
        label: 'Corriger le nom ou le prénom',
        help: 'L’identifiant de connexion, lui, reste inchangé.',
      },
      {
        value: 'transfert',
        type: 'transfert_etab',
        label: 'Transférer vers un autre établissement',
        help: 'L’établissement actuel est retiré, le nouveau est attribué.',
      },
    ],
  },
};

/**
 * Correspondance entre le paramètre `?type=` des URL et le type stocké en base.
 * Les alias courts existent depuis l'origine dans les liens du portail : on les
 * conserve pour ne casser aucun lien déjà diffusé ou mis en favori.
 */
const ALIAS = {
  reset: 'reset_mdp',
  extension: 'ajout_etab',
  identite: 'maj_identite',
  transfert: 'transfert_etab',
  maj: 'maj_compte',
};

/** Vrai si `type` est une démarche composée (plusieurs démarches derrière). */
function estComposee(type) {
  return Object.prototype.hasOwnProperty.call(COMPOSEES, String(type || ''));
}

/** Définition d'une démarche composée, ou null. */
function composee(type) {
  const cle = String(type || '');
  return estComposee(cle) ? { type: cle, ...COMPOSEES[cle] } : null;
}

/** Vrai si ce type existe, composée ou non. */
function existe(type) {
  const cle = String(type || '');
  return Object.prototype.hasOwnProperty.call(DEMARCHES, cle) || estComposee(cle);
}

/** Type de démarche correspondant à un `?type=` d'URL (défaut : création). */
function fromQuery(valeur) {
  const v = String(valeur || '');
  if (!v) return DEFAUT;
  if (Object.prototype.hasOwnProperty.call(ALIAS, v)) return ALIAS[v];
  return existe(v) ? v : DEFAUT;
}

/** Alias d'URL (`?type=…`) d'un type de démarche, '' si le type est le défaut. */
function alias(type) {
  const trouve = Object.entries(ALIAS).find(([, cible]) => cible === type);
  return trouve ? trouve[0] : '';
}

/** Définition d'une démarche, ou null si le type est inconnu. */
function get(type) {
  const cle = String(type || DEFAUT);
  return Object.prototype.hasOwnProperty.call(DEMARCHES, cle) ? { type: cle, ...DEMARCHES[cle] } : null;
}

/** Type valide extrait d'une entrée quelconque (query, corps…), sinon défaut. */
function normalise(type) {
  return get(type) ? String(type || DEFAUT) : DEFAUT;
}

/** Préfixe de référence de suivi pour cette démarche sur cette application. */
function prefixe(type, config) {
  const d = get(type);
  return (d && d.prefixe) || (config && config.referencePrefix) || 'REQ';
}

/** Libellé court, pour les tableaux et les étiquettes. */
function court(type) {
  const d = get(type) || composee(type);
  return d ? d.court : String(type || '');
}

/** Libellé complet, composées incluses. */
function libelle(type) {
  const d = get(type) || composee(type);
  return d ? d.label : String(type || '');
}

/** Carte affichable (libellés + lien) d'un type, composée ou non. */
function carte(type) {
  const d = get(type) || composee(type);
  if (!d) return null;
  return { type: d.type, alias: alias(d.type), label: d.label, court: d.court, composee: estComposee(d.type) };
}

/** Une démarche simple est disponible si son schéma ET son robot existent. */
function estDisponible(type, config, automation) {
  const d = DEMARCHES[String(type || '')];
  if (!d) return false;
  return Boolean(config && config[d.schema]) && typeof (automation || {})[d.action] === 'function';
}

/** Démarches simples réellement exécutables sur une application. */
function actions(config, automation) {
  return Object.keys(DEMARCHES).filter((type) => estDisponible(type, config, automation));
}

/** Branches réellement disponibles d'une démarche composée. */
function branches(type, config, automation) {
  const c = composee(type);
  if (!c) return [];
  return c.options.filter((o) => estDisponible(o.type, config, automation));
}

/**
 * Cartes de démarches à proposer pour une application : les démarches simples
 * non absorbées par une composée, puis les composées ayant au moins une branche
 * disponible. Une démarche sans robot n'est jamais proposée — mieux vaut ne pas
 * l'afficher que promettre un traitement qui échouera.
 */
function disponibles(config, automation) {
  const absorbees = new Set(
    Object.values(COMPOSEES).flatMap((c) => c.options.map((o) => o.type))
  );
  const cartes = Object.keys(DEMARCHES).filter(
    (type) => !absorbees.has(type) && estDisponible(type, config, automation)
  );
  for (const type of Object.keys(COMPOSEES)) {
    if (branches(type, config, automation).length) cartes.push(type);
  }
  return cartes;
}

/**
 * Démarche réellement déposée pour un type et un jeu de données validées.
 * Pour une composée, c'est la branche désignée par le champ de choix ; pour une
 * démarche simple, elle-même. Renvoie null si le choix est absent ou inconnu —
 * l'appelant doit alors refuser le dépôt.
 */
function resoudre(type, data) {
  const c = composee(type);
  if (!c) return get(type) ? normalise(type) : null;
  const choix = String((data || {})[c.champ] || '');
  const option = c.options.find((o) => o.value === choix);
  return option ? option.type : null;
}

module.exports = {
  DEMARCHES,
  COMPOSEES,
  DEFAUT,
  ALIAS,
  get,
  composee,
  estComposee,
  existe,
  normalise,
  fromQuery,
  alias,
  prefixe,
  court,
  libelle,
  carte,
  estDisponible,
  actions,
  branches,
  disponibles,
  resoudre,
};
