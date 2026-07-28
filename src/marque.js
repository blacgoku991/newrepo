'use strict';

/**
 * Marque affichée par l'instance — marque blanche par société.
 *
 * Chaque instance sert UNE société cliente. C'est SON nom qui doit s'afficher
 * en grand : un salarié qui se connecte doit reconnaître sa maison, sinon il
 * hésite à saisir ses informations. L'éditeur (Smartfixx) reste mentionné, mais
 * discrètement — visible du décideur, invisible de l'utilisateur.
 *
 * Le nom vient de la LICENCE, pas d'un réglage libre : il est signé, donc ni
 * modifiable par le client, ni à ressaisir à l'installation. Sans licence
 * (démonstration, développement), on retombe sur `SOCIETE_NOM`, puis sur un
 * libellé neutre.
 */

const path = require('path');
const fs = require('fs');
const licence = require('./licence');

const EDITEUR = process.env.EDITEUR_NOM || 'Smartfixx';
const EDITEUR_URL = process.env.EDITEUR_URL || 'https://smartfixx.fr';

/** Dossier où déposer le logo de la société cliente (hors du dépôt). */
const DOSSIER_LOGO = process.env.SOCIETE_LOGO_DIR
  || path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'marque');

/** Nom de la société servie par cette instance. */
function societe() {
  const etat = licence.etat();
  return (etat && etat.client) || process.env.SOCIETE_NOM || 'Portail comptes';
}

/** Logo de la société, s'il a été déposé. Formats acceptés : PNG, JPEG, WebP. */
function logo() {
  for (const [ext, type] of [['png', 'image/png'], ['jpg', 'image/jpeg'], ['webp', 'image/webp']]) {
    const fichier = path.join(DOSSIER_LOGO, `logo.${ext}`);
    if (fs.existsSync(fichier)) return { fichier, type };
  }
  return null;
}

/**
 * Ce que le frontend a besoin de savoir pour s'habiller.
 * Aucune donnée sensible : cet objet est servi avant même la connexion, pour
 * que la page de connexion porte déjà les couleurs du client.
 */
function etat() {
  return {
    societe: societe(),
    logo: !!logo(),
    editeur: EDITEUR,
    editeurUrl: EDITEUR_URL,
    // Formule affichée en pied de page.
    mention: `propulsé par ${EDITEUR}`,
  };
}

module.exports = { etat, societe, logo, EDITEUR, EDITEUR_URL, DOSSIER_LOGO };
