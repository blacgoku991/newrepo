'use strict';

/**
 * Sélecteurs de l'interface NetSoins (instance ADEF), relevés au codegen.
 *
 * ⚠️ Deux contextes différents :
 *   - `login.*` → DANS l'iframe (page de connexion + code OTP) ;
 *   - tout le reste → sur la PAGE DE PREMIER NIVEAU : une fois connecté,
 *     NetSoins sort de l'iframe.
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
    administratif: '#menu-links >> text=Administratif',
    intervenant: 'text="Intervenant"',
    // Sous-entrée « Intervenants » : la LISTE (la création se fait via
    // « Intervenant », au singulier).
    intervenantsListe: 'role=link[name="Intervenants"]',
  },

  // Liste des intervenants (parcours de réinitialisation de mot de passe).
  liste: {
    // Filtre d'établissement : chaque ligne porte l'identifiant interne en
    // attribut `value` — on cible par cet identifiant, jamais par le libellé.
    etablissementOpen: '#change_id_etablissement',
    etablissementOption: (value) => `.filter_choose_line[value="${value}"]`,
    search: 'input[type="search"]',
    resultat: (texte) => `text=${JSON.stringify(texte)}`,
    ficheIntervenant: 'text="Fiche intervenant"',
  },

  // Fiche d'un intervenant existant : changement de mot de passe.
  motDePasse: {
    // Par défaut la fiche est sur « Ne pas modifier » : il faut basculer sur
    // « Définir un mot de passe » pour que les champs deviennent saisissables.
    modeOpen: 'role=link[name="Ne pas modifier"]',
    modeDefinir: 'text="Définir un mot de passe"',
    password: 'role=textbox[name="Mot de passe"]',
    passwordConfirm: 'role=textbox[name="Confirmation"]',
  },

  // Onglet « Compte » : identifiants, accès, droits, établissements.
  compte: {
    login: 'role=textbox[name="Identifiant"]',
    password: 'role=textbox[name="Mot de passe"]',
    passwordConfirm: 'role=textbox[name="Confirmation"]',

    // Accès limité dans le temps (CDD) : bouton « Oui », puis la date limite.
    accesLimite:
      'div:nth-child(6) > span > .p > .page_widgets > span > span > span:nth-child(2) > label > .radio',
    dateLimite: "role=textbox[name=\"Date limite d'accès\"]",

    // Profil de droits : un lien ouvre la liste, on coche l'option voulue —
    // repérée par son identifiant interne NetSoins (attribut `data`), jamais
    // par sa position dans la liste.
    profilZone: 'div:nth-child(9) > span > .p',
    profilOpen: 'role=link[name="Non renseigné"]',
    profilOption: (id) => `label.bloc_option:has(input[data="${id}"]) > .checkbox`,

    // Établissements autorisés (multi-sélection). L'identifiant du widget se
    // termine par un suffixe aléatoire : on cible par son préfixe.
    etabOpen: '[id^="multi_champ_id_visibilite_etablissements_autorises"]',
    etabRoot: 'text="ADEF RESIDENCES"',
    etabOption: (label) => `label:has-text("${label}") > .checkbox`,
  },

  // Onglet « Informations » : état civil et catégorie professionnelle.
  informations: {
    tab: '#onglet_informations >> text=Informations',
    categorieOpen: 'role=link[name="Choisissez..."]',
    categorieOption: (label) => `.selectsearchchoice:text-is("${label}")`,
    // ⚠️ Sélecteurs positionnels relevés au codegen : à confirmer sur l'instance
    // (l'un vaut « Masculin », l'autre « Féminin »).
    sexeMasculin: 'span:nth-child(3) > span > span:nth-child(2) > label > .radio',
    sexeFeminin: 'span > span:nth-child(2) > span > span:nth-child(2) > label > .radio',
    nomNaissance: 'input[placeholder="Nom de naissance"]',
    premierPrenom: 'input[placeholder="Premier prénom"]',
  },

  save: 'text="EnregistrerOnglet suivant"',
};
