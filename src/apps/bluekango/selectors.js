'use strict';

/**
 * Sélecteurs de l'interface d'administration BlueKanGo (instance ADEF Résidences).
 * Calibrés à partir d'un enregistrement `npx playwright codegen` réel.
 *
 * Particularités de BlueKanGo :
 *  - l'interface est découpée en iframes imbriquées (cadre principal "b",
 *    cadre de sélection d'établissement "o", liste des utilisateurs
 *    "#FRM_iframe_userList", et une fenêtre fancybox au nom dynamique
 *    pour la fiche utilisateur) ;
 *  - la création se fait par DUPLICATION d'un utilisateur existant
 *    (boutons "duplicate-user-<id>" dans la liste).
 */

module.exports = {
  frames: {
    main: '[id="b"]',                          // cadre principal de l'admin
    etab: 'iframe[name="o"]',                  // cadre du sélecteur d'établissement
    userList: '#FRM_iframe_userList',          // liste des utilisateurs (dans main)
    fancybox: 'iframe[name^="fancybox-frame"]',// fiche utilisateur (nom dynamique, dans main)
  },

  login: {
    userLabel: 'Compte utilisateur',
    passwordLabel: 'Mot de passe',
    submitLabel: 'Connexion',
    // Après connexion, BlueKanGo affiche parfois une page de choix de profil
    // (lien "Prénom Nom SIEGE") : on clique le premier lien correspondant.
    profileLinkPattern: /SIEGE/i,
  },

  nav: {
    administration: 'Administration',
    gestionRessources: 'Gestion des ressources',
    utilisateurs: 'Utilisateurs',
    modeBmPath: '/index.php?mode=BM',          // page où choisir l'établissement
    etabSelectLabel: 'Établissements :',       // libellé du select dans l'iframe "o"
  },

  userList: {
    row: 'tr',                                  // lignes du tableau des utilisateurs
    duplicateButton: '[id^="duplicate-user-"]', // bouton Dupliquer d'une ligne
  },

  form: {
    nom: '#UTL_nom',
    prenom: '#UTL_prenom',
    civiliteCellPattern: /M\..*Mlle.*Mme.*Sans/, // cellule contenant les 4 radios
    civiliteIndex: { m: 0, mlle: 1, mme: 2, sans: 3 }, // position du radio dans la cellule
    ongletAuthentification: 'Authentification',
    loginField: '#UTL_Login',
    password: '#UTL_pw',
    password2: '#UTL_pw2',
    reinitCheckbox: 'input[name="UTL_reinit"]', // réinitialisation du mdp au 1er login
    validerLabel: 'Valider',                    // bouton dans le cadre principal
  },
};
