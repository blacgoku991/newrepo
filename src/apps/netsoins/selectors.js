'use strict';

/**
 * Sélecteurs de l'interface NetSoins (instance ADEF), relevés au codegen.
 *
 * ⚠️ Deux contextes différents :
 *   - `login.*`  → DANS l'iframe (page de connexion + code OTP) ;
 *   - `menu.*` / `form.*` → sur la PAGE DE PREMIER NIVEAU (après connexion,
 *     NetSoins sort de l'iframe).
 *
 * Ces sélecteurs sont modifiables depuis le panel admin (éditeur de scénario)
 * sans toucher au code.
 */

module.exports = {
  frame: 'iframe',

  login: {
    user: 'input[placeholder="Identifiant"]',
    password: 'input[placeholder="Mot de passe"]',
    submit: 'text="Connexion"',
    // Double authentification (code à usage unique reçu par e-mail).
    otpInput: 'input[placeholder="Code reçu par mail"]',
    otpSubmit: 'text="OK"',
  },

  // --- Page de premier niveau (après connexion) ------------------------------

  // Fenêtre d'accueil affichée après connexion (à fermer).
  closePopup: '.button_close > .fa-times',

  menu: {
    administratif: '#menu-links span:has-text("Administratif")',
    intervenant: 'text="Intervenant"',
  },

  form: {
    login: 'role=textbox[name="Identifiant"]',
    password: 'role=textbox[name="Mot de passe"]',
    passwordConfirm: 'role=textbox[name="Confirmation"]',
    nom: 'role=textbox[name="Nom"]',
    prenom: 'role=textbox[name="Prénom"]',
    email: 'role=textbox[name="Mail"]',

    // Accès limité dans le temps (CDD) : bouton radio « oui », puis date limite.
    accesLimite:
      'div:nth-child(6) > span > .p > .page_widgets > span > span > span:nth-child(2) > label > .radio',
    dateLimite: 'role=textbox[name="Date limite d\'accès"]',

    // Profil de droits : un lien ouvre la liste, puis on coche l'option voulue
    // (repérée par l'identifiant interne NetSoins, attribut `data`).
    profilOpen: 'role=link[name="Non renseigné"]',
    profilOption: (id) => `label.bloc_option:has(input[data="${id}"]) > .checkbox`,

    // Catégorie de personnel (liste déroulante recherchable).
    categorieOpen: '.selectsearchhandle .selectsearchinput',
    categorieOption: (label) => `.selectsearchchoice:text-is("${label}")`,

    save: 'text="Enregistrer"',
  },
};
