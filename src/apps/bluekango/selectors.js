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
    userList: '#FRM_iframe_userList',          // liste des utilisateurs (dans main)
    fancybox: 'iframe[name^="fancybox-frame"]',// fiche utilisateur (nom dynamique, dans main)
  },

  login: {
    userLabel: 'Compte utilisateur',
    passwordLabel: 'Mot de passe',
    submitLabel: 'Connexion',
    // Après connexion, BlueKanGo affiche parfois une page de choix de profil
    // (lien « Prénom Nom ÉTABLISSEMENT », ex. « Achraf Maatoug COMBS LA VILLE »).
    // L'établissement du compte admin varie : on clique le premier profil
    // affiché (≥ 3 mots), peu importe lequel — l'établissement demandé par le
    // client est ensuite sélectionné à l'étape de bascule.
    profileLinkPattern: /\S+\s+\S+\s+\S+/,
  },

  nav: {
    administration: 'Administration',
    gestionRessources: 'Gestion des ressources',
    utilisateurs: 'Utilisateurs',
    // Le select d'établissement (« Etablissements : XXX ») est recherché dans
    // toutes les frames par findEtabSelect() : id #change_etab, ou libellé
    // « Établissements : ». BlueKanGo classique utilise des <frame> (frameset).
  },

  userList: {
    row: 'tr',                                  // lignes du tableau des utilisateurs
    duplicateButton: '[id^="duplicate-user-"]', // bouton Dupliquer d'une ligne
    // Affichage de 200 résultats/page (role listbox) + tri par la colonne
    // « Fonctions ADEF Résidences » pour retrouver la fonction à dupliquer.
    searchLabel: 'mots',                        // champ « Recherche par mots clés »
    searchTriggerTitle: 'Rechercher',           // bouton/loupe qui lance la recherche
    modifyButton: 'Modifier',                   // bouton « Modifier » d'une ligne sélectionnée
  },

  form: {
    nom: '#UTL_nom',
    prenom: '#UTL_prenom',
    civiliteCellPattern: /M\..*Mlle.*Mme.*Sans/, // cellule contenant les 4 radios
    civiliteIndex: { m: 0, mlle: 1, mme: 2, sans: 3 }, // position du radio dans la cellule
    ongletIdentite: 'Identité',                 // onglet nom/prénom de la fiche
    ongletAuthentification: 'Authentification',
    loginField: '#UTL_Login',
    password: '#UTL_pw',
    password2: '#UTL_pw2',
    reinitCheckbox: 'input[name="UTL_reinit"]', // réinitialisation du mdp au 1er login
    // Ligne « Date de fin de validité : (jj/mm/aaaa) » de la fiche : seul ce
    // champ est saisi par le robot (la date de début reste celle de BlueKanGo).
    dateFinRowLabel: 'Date de fin de validité',
    validerLabel: 'Valider',                    // bouton dans le cadre principal
  },
};
