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
    // Le menu propose un champ de recherche (rôle « searchbox ») : on filtre
    // avec, plutôt que de déplier l'arbre.
    etabSearch: 'role=searchbox',
    // Repli : cliquer l'intitulé du groupe DÉPLIE l'arbre et fait apparaître
    // tous les établissements. Attention, c'est bien le LIBELLÉ qu'on clique —
    // la case à cocher du groupe, elle, sélectionnerait tout d'un coup.
    etabGroupe: 'text="ADEF RESIDENCES"',
    // Ligne d'un établissement dans la liste. Le libellé affiché est préfixé
    // par la hiérarchie : « ADEF RESIDENCES - EHPAD - <nom> - <code postal ville> ».
    // `:visible` est indispensable : le widget conserve des copies masquées de
    // la liste (conteneur de résultats de recherche), sur lesquelles un clic
    // n'aurait aucun effet.
    etabRow:
      'label.bloc_option:visible, label:has(> .checkbox):visible, .bloc_option:visible, .filter_choose_line:visible',
    // Lignes « Tous les établissements du groupe / du sous-groupe » : à ne
    // JAMAIS cocher, elles rattacheraient l'intervenant à tout le groupe.
    etabToutCocher: /tous les établissements/i,
  },

  // Onglet « Informations » : état civil et catégorie professionnelle.
  informations: {
    // L'onglet demande deux clics : le bandeau, puis son intitulé.
    tabZone: '#onglet_informations',
    tab: '#onglet_informations >> text=Informations',
    categorieOpen: 'link:Choisissez',
    // Correspondance sur le texte EXACT : les options sont indentées par des
    // espaces insécables, et surtout certains libellés sont le préfixe d'un
    // autre (« Infirmier/ère » vs « Infirmier/ère H.A.D ») — une recherche
    // partielle cocherait la mauvaise catégorie.
    categorieOption: (label) => `text-exact:${label}`,
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
    // ATTENTION : la page porte DEUX champs de recherche. Celui du bandeau
    // NETParamètres, tout en haut, cherche dans toute l'application ; celui de
    // la liste des intervenants, sous les onglets, est le seul qui filtre la
    // liste.
    //
    // Le sélecteur `input[type="search"]` ne matchait pas toujours (le champ
    // n'est pas nécessairement typé « search » selon l'écran), et le robot
    // retombait alors sur un repérage à l'aveugle dans la liste NON filtrée —
    // qui pouvait ouvrir la fiche d'un autre intervenant. Un relevé Playwright
    // sur l'instance réelle montre que ce champ porte un nom accessible unique
    // sur toute la page, « Recherche » (son `placeholder`) : `role=textbox`
    // avec ce nom identifie donc SANS AMBIGUÏTÉ le bon champ, quelle que soit
    // sa balise exacte — le champ du bandeau ne porte pas ce nom.
    search: 'textbox:Recherche',
    // Replis si le nom accessible venait à changer : on retombe sur le type
    // « search ». `searchAlt` est appliqué DÉJÀ CADRÉ sur `#content_ajax` par
    // l'appelant (ne pas répéter le cadrage ici, sous peine de chercher
    // `#content_ajax` imbriqué dans lui-même — aucun résultat). `searchAlt2`
    // est le seul appliqué sans cadrage, sur toute la page.
    searchAlt: 'input[type="search"]',
    searchAlt2: 'input[type="search"]',
    // Le champ se valide par le bouton (loupe) placé juste après lui. Ce bouton
    // n'a AUCUN libellé accessible : on le repère par sa position relative au
    // champ, puis, s'il n'en est pas frère, dans la barre d'outils de la liste.
    searchSubmit: '#content_ajax input[type="search"] ~ button',
    searchSubmitAlt: '#content_ajax button',
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
  // Fenêtre d'erreur de validation de NetSoins. Sa présence signifie que la
  // fiche a été soumise trop tôt : mieux vaut le dire que continuer à l'aveugle.
  errorDialog: 'text=Il y a des erreurs',

  save: [
    'button:Enregistrer',
    'input[value="Enregistrer" i]',
    'text=EnregistrerOnglet suivant',
    'text=Enregistrer',
    '[onclick*="enregistrer" i]',
  ],
};
