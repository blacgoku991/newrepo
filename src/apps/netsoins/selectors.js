'use strict';

/**
 * Sélecteurs de l'interface NetSoins (instance ADEF), relevés au codegen.
 *
 * ⚠️ Deux contextes différents :
 *   - `login.*` → DANS l'iframe (page de connexion + code OTP) ;
 *   - tout le reste → sur la PAGE DE PREMIER NIVEAU : une fois connecté,
 *     NetSoins sort de l'iframe.
 *
 * Deux écritures possibles pour un sélecteur :
 *   - « role:libellé » → repérage par rôle + libellé accessible, comme le fait
 *     le codegen Playwright (correspondance partielle, insensible à la casse).
 *     C'est la forme à privilégier ici : les libellés NetSoins portent un
 *     astérisque (« Identifiant* ») que l'on n'a pas à reproduire.
 *   - toute autre chaîne → sélecteur CSS/texte Playwright classique.
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
    // Sous-entrée « Intervenants » : la LISTE (la création passe par
    // « Intervenant », au singulier).
    intervenantsListe: 'link:Intervenants',
  },

  // Onglet « Identification » : identifiants, accès, droits, établissements.
  compte: {
    login: 'textbox:Identifiant',
    password: 'textbox:Mot de passe',
    passwordConfirm: 'textbox:Confirmation',

    // Accès limité dans le temps (CDD) : bouton « Oui », puis la date limite.
    accesLimite:
      'div:nth-child(6) > span > .p > .page_widgets > span > span > span:nth-child(2) > label > .radio',
    dateLimite: "textbox:Date limite d'accès",

    // Profil de droits : un lien ouvre la liste, on coche l'option voulue —
    // repérée par son identifiant interne NetSoins (attribut `data`), jamais
    // par sa position dans la liste.
    profilZone: 'div:nth-child(9) > span > .p',
    profilOpen: 'link:Non renseigné',
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
    categorieOpen: 'link:Choisissez',
    categorieOption: (label) => `.selectsearchchoice:text-is("${label}")`,
    // ⚠️ Sélecteurs positionnels relevés au codegen : à confirmer sur l'instance
    // (l'un vaut « Masculin », l'autre « Féminin »).
    sexeMasculin: 'span:nth-child(3) > span > span:nth-child(2) > label > .radio',
    sexeFeminin: 'span > span:nth-child(2) > span > span:nth-child(2) > label > .radio',
    nomNaissance: 'input[placeholder="Nom de naissance"]',
    premierPrenom: 'input[placeholder="Premier prénom"]',
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
    // Le widget « Gestion du mot de passe » est un menu personnalisé rendu
    // comme un lien ; `modeSelect` couvre le cas d'une vraie liste déroulante.
    modeSelect: 'combobox:Gestion du mot de passe',
    modeOpen: 'link:Ne pas modifier',
    // Texte volontairement PARTIEL : l'option porte souvent des espaces
    // d'indentation qui feraient échouer une correspondance exacte.
    modeDefinir: 'text=Définir un mot de passe',
    password: 'textbox:Mot de passe',
    passwordConfirm: 'textbox:Confirmation',
  },

  // Bouton d'enregistrement. Sa forme varie d'un écran à l'autre (bouton,
  // champ de saisie, lien, conteneur « EnregistrerOnglet suivant »…) : on tente
  // les écritures dans l'ordre et on retient la première qui répond.
  save: [
    'button:Enregistrer',
    'input[value="Enregistrer" i]',
    'text=EnregistrerOnglet suivant',
    'text=Enregistrer',
    '[onclick*="enregistrer" i]',
  ],
};
