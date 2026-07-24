'use strict';

/**
 * Données de référence NetSoins (instance ADEF Résidences), extraites du
 * formulaire « Nouvel Intervenant » réel.
 *
 *  - ETABLISSEMENTS      : value = identifiant interne NetSoins (attribut value
 *                          de la ligne à cliquer), groupé par type d'établissement.
 *  - PROFILS_DROIT       : value = identifiant interne (attribut data de la case),
 *                          label = libellé exact affiché.
 *  - CATEGORIES_PERSONNEL: NetSoins recherche par texte -> value = label exact,
 *                          groupé par famille de métier.
 *
 * Généré depuis les listes fournies ; ne pas éditer à la main sans reprendre la
 * source (les identifiants doivent rester strictement identiques à NetSoins).
 */

const ETABLISSEMENTS = [
  {
    "value": "688",
    "label": "Base de formation EHPAD - 94200 IVRY SUR SEINE",
    "group": "EHPAD"
  },
  {
    "value": "778",
    "label": "EHPAD MON FOYER - 07100 ANNONAY",
    "group": "EHPAD"
  },
  {
    "value": "736",
    "label": "La Maison Chantereine - 94600 CHOISY LE ROI",
    "group": "EHPAD"
  },
  {
    "value": "692",
    "label": "La Maison de la Chataigneraie - 91310 LEUVILLE SUR ORGE",
    "group": "EHPAD"
  },
  {
    "value": "708",
    "label": "La Maison de l'Amandier - 71380 ST MARCEL",
    "group": "EHPAD"
  },
  {
    "value": "712",
    "label": "La Maison de la Vallée des Fleurs - 93240 STAINS",
    "group": "EHPAD"
  },
  {
    "value": "709",
    "label": "La Maison de l'Eglantier - 93140 BONDY",
    "group": "EHPAD"
  },
  {
    "value": "714",
    "label": "La Maison de l'Erable Argenté - 92140 CLAMART",
    "group": "EHPAD"
  },
  {
    "value": "706",
    "label": "La Maison de l'Orme Doré - 52100 ST DIZIER",
    "group": "EHPAD"
  },
  {
    "value": "728",
    "label": "La Maison de l’Osier Pourpre - 52000 CHAUMONT",
    "group": "EHPAD"
  },
  {
    "value": "731",
    "label": "La Maison des Acacias - 60130 ST JUST EN CHAUSSEE",
    "group": "EHPAD"
  },
  {
    "value": "725",
    "label": "La Maison des Arbousiers - 11200 BIZANET",
    "group": "EHPAD"
  },
  {
    "value": "737",
    "label": "La Maison des Cerisiers - 54590 HUSSIGNY GODBRANGE",
    "group": "EHPAD"
  },
  {
    "value": "738",
    "label": "La Maison des Champs Fleuris - 63038 CLERMONT FERRAND CEDEX 1",
    "group": "EHPAD"
  },
  {
    "value": "722",
    "label": "La Maison des Clématites - 91100 CORBEIL ESSONNES",
    "group": "EHPAD"
  },
  {
    "value": "720",
    "label": "La Maison des Cotonniers - 33980 AUDENGE",
    "group": "EHPAD"
  },
  {
    "value": "701",
    "label": "La Maison des Cytises - 92230 GENNEVILLIERS",
    "group": "EHPAD"
  },
  {
    "value": "716",
    "label": "La Maison des Glycines - 93350 LE BOURGET",
    "group": "EHPAD"
  },
  {
    "value": "723",
    "label": "La Maison des Merisiers - 91390 MORSANG SUR ORGE",
    "group": "EHPAD"
  },
  {
    "value": "707",
    "label": "La Maison des Micocouliers - 83520 ROQUEBRUNE SUR ARGENS",
    "group": "EHPAD"
  },
  {
    "value": "719",
    "label": "La Maison des Mirabelliers - 54720 LEXY",
    "group": "EHPAD"
  },
  {
    "value": "740",
    "label": "La Maison des Oliviers de Jeanne - 83200 TOULON",
    "group": "EHPAD"
  },
  {
    "value": "781",
    "label": "La Maison des Pensées de Jeanne - 17100 SAINTES",
    "group": "EHPAD"
  },
  {
    "value": "776",
    "label": "La Maison des Rosiers de Jeanne - 32000 AUCH",
    "group": "EHPAD"
  },
  {
    "value": "735",
    "label": "La Maison des Sorières - 94150 RUNGIS",
    "group": "EHPAD"
  },
  {
    "value": "733",
    "label": "La Maison des Tamaris - 56100 LORIENT",
    "group": "EHPAD"
  },
  {
    "value": "718",
    "label": "La Maison des Verdiaux - 58600 FOURCHAMBAULT",
    "group": "EHPAD"
  },
  {
    "value": "710",
    "label": "La Maison des Vignes - 54220 MALZEVILLE",
    "group": "EHPAD"
  },
  {
    "value": "697",
    "label": "La Maison du Cèdre Bleu - 91280 ST PIERRE DU PERRAY",
    "group": "EHPAD"
  },
  {
    "value": "691",
    "label": "La Maison du Clos des Marronniers - 02140 LA VALLEE AU BLE",
    "group": "EHPAD"
  },
  {
    "value": "729",
    "label": "La Maison du Coudrier - 14111 LOUVIGNY",
    "group": "EHPAD"
  },
  {
    "value": "711",
    "label": "La Maison du Grand Cèdre - 94110 ARCUEIL",
    "group": "EHPAD"
  },
  {
    "value": "696",
    "label": "La Maison du Grand Chêne - 77380 COMBS LA VILLE",
    "group": "EHPAD"
  },
  {
    "value": "713",
    "label": "La Maison du Jardin des Roses - 94440 VILLECRESNES",
    "group": "EHPAD"
  },
  {
    "value": "700",
    "label": "La Maison du Laurier Noble - 93200 ST DENIS",
    "group": "EHPAD"
  },
  {
    "value": "727",
    "label": "La Maison du Lendehof - 67370 TRUCHTERSHEIM",
    "group": "EHPAD"
  },
  {
    "value": "732",
    "label": "La Maison du Marronnier Blanc - 63360 GERZAT",
    "group": "EHPAD"
  },
  {
    "value": "726",
    "label": "La Maison du Parc - 75013 PARIS",
    "group": "EHPAD"
  },
  {
    "value": "703",
    "label": "La Maison du Saule Cendré - 94310 ORLY",
    "group": "EHPAD"
  },
  {
    "value": "698",
    "label": "La Maison du Tilleul Argenté - 77500 CHELLES",
    "group": "EHPAD"
  },
  {
    "value": "694",
    "label": "La Maison du Tulipier - 69200 VENISSIEUX",
    "group": "EHPAD"
  },
  {
    "value": "777",
    "label": "La Maison Marie Pocard - 52370 MARANVILLE",
    "group": "EHPAD"
  },
  {
    "value": "739",
    "label": "La Maison Source Nadon - 77250 MORET LOING ET ORVANNE",
    "group": "EHPAD"
  },
  {
    "value": "695",
    "label": "La Maison de la Forêt des Charmes - 86800 ST JULIEN L ARS",
    "group": "FAM/MAS"
  },
  {
    "value": "702",
    "label": "La Maison de l'Alisier - 93380 PIERREFITTE SUR SEINE",
    "group": "FAM/MAS"
  },
  {
    "value": "704",
    "label": "La Maison des Aulnes - 78580 MAULE",
    "group": "FAM/MAS"
  },
  {
    "value": "724",
    "label": "La Maison des Lys - 76770 MALAUNAY",
    "group": "FAM/MAS"
  },
  {
    "value": "730",
    "label": "La Maison des Séquoias - 51700 DORMANS",
    "group": "FAM/MAS"
  },
  {
    "value": "721",
    "label": "La Maison du Bois Joli - 39400 HAUTS DE BIENNE",
    "group": "FAM/MAS"
  },
  {
    "value": "715",
    "label": "La Maison du Douglas - 19430 MERCOEUR",
    "group": "FAM/MAS"
  },
  {
    "value": "717",
    "label": "La Maison du Pommier Pourpre - 93200 ST DENIS",
    "group": "FAM/MAS"
  },
  {
    "value": "693",
    "label": "La Maison du Sophora - 02430 GAUCHY",
    "group": "FAM/MAS"
  },
  {
    "value": "699",
    "label": "La Maison du Sorbier des Oiseleurs - 77320 LA FERTE GAUCHER",
    "group": "FAM/MAS"
  },
  {
    "value": "734",
    "label": "MAS Nord 92 - 92390 VILLENEUVE LA GARENNE",
    "group": "FAM/MAS"
  },
  {
    "value": "689",
    "label": "Base de formation HANDICAP",
    "group": "FV"
  },
  {
    "value": "741",
    "label": "La Maison des trois chenes - 19220 RILHAC XAINTRIE",
    "group": "FV"
  },
  {
    "value": "705",
    "label": "La Maison du Parc aux Cyprès - 84530 VILLELAURE",
    "group": "FV"
  },
  {
    "value": "779",
    "label": "La Résidence des Tamaris - 56100 LORIENT",
    "group": "Résidence Autonomie"
  },
  {
    "value": "775",
    "label": "Résidence Autonomie LES ROSES - 77250 MORET LOING ET ORVANNE",
    "group": "Résidence Autonomie"
  }
];

const PROFILS_DROIT = [
  {
    "value": "44915",
    "label": "AR - AGENT DE MAINTENANCE"
  },
  {
    "value": "44367",
    "label": "AR - AGENT DE SERVICE"
  },
  {
    "value": "44368",
    "label": "AR - AGENT HOTELIER"
  },
  {
    "value": "44394",
    "label": "AR - AGENT POLYVALENT"
  },
  {
    "value": "44395",
    "label": "AR - AGENT POLYVALENT DE NUIT"
  },
  {
    "value": "44387",
    "label": "AR - AIDE MEDICO-PSYCHOLOGIQUE"
  },
  {
    "value": "44549",
    "label": "AR - AIDE MEDICO-PSYCHOLOGIQUE NUIT"
  },
  {
    "value": "44358",
    "label": "AR - ANIMATEUR/ANIMATRICE"
  },
  {
    "value": "44353",
    "label": "AR - ANIMATEUR(RICE) COORDO VIE SOC"
  },
  {
    "value": "44407",
    "label": "AR - ART THERAPEUTE"
  },
  {
    "value": "44399",
    "label": "AR - ASSISTANTE DE DIRECTION"
  },
  {
    "value": "44356",
    "label": "AR - ASSISTANTE SOCIALE"
  },
  {
    "value": "44396",
    "label": "AR - ASSISTANT SOINS GERONTOLOGIE"
  },
  {
    "value": "44934",
    "label": "AR - AUDIOPROTHESISTE"
  },
  {
    "value": "44390",
    "label": "AR - AUXILIAIRE DE VIE"
  },
  {
    "value": "44391",
    "label": "AR - AUXILIAIRE DE VIE DE NUIT"
  },
  {
    "value": "45095",
    "label": "AR - CHIRURGIEN DENTISTE"
  },
  {
    "value": "44541",
    "label": "AR - CONSEILLERE EN ECO SOC ET FAM"
  },
  {
    "value": "44912",
    "label": "AR - DIETETICIEN"
  },
  {
    "value": "44413",
    "label": "AR - DIRECTEUR/DIRECTRICE"
  },
  {
    "value": "44540",
    "label": "AR - DIRECTRICE/DIRECTEUR ADJOINT(E)"
  },
  {
    "value": "44355",
    "label": "AR - EDUCATEUR/EDUCATRICE"
  },
  {
    "value": "44534",
    "label": "AR - EDUCATEUR SPORTIF"
  },
  {
    "value": "44361",
    "label": "AR - EDUCATEUR TECHNIQUE"
  },
  {
    "value": "44365",
    "label": "AR - EMPLOYE DE LINGERIE"
  },
  {
    "value": "44611",
    "label": "AR - ENSEIGNANT APA"
  },
  {
    "value": "44404",
    "label": "AR - ERGOTHERAPEUTE"
  },
  {
    "value": "44401",
    "label": "AR - HOTESSE/HOTE D ACCUEIL"
  },
  {
    "value": "44410",
    "label": "AR - INFIRMIER(E)"
  },
  {
    "value": "44411",
    "label": "AR - INFIRMIER(E) COORDO."
  },
  {
    "value": "44533",
    "label": "AR - INFIR. REFERENTE"
  },
  {
    "value": "44408",
    "label": "AR - KINESITHERAPEUTE"
  },
  {
    "value": "44369",
    "label": "AR - LINGERE"
  },
  {
    "value": "44471",
    "label": "AR - MEDECIN CONSEIL"
  },
  {
    "value": "44352",
    "label": "AR - MEDECIN COORDONNATEUR"
  },
  {
    "value": "44360",
    "label": "AR - MEDECIN GENERALISTE"
  },
  {
    "value": "44397",
    "label": "AR - MEDECIN/PSYCHIATRE"
  },
  {
    "value": "44749",
    "label": "AR - MED. READAPTATION FONCTIONNELLE"
  },
  {
    "value": "44405",
    "label": "AR - NEUROPSYCHOLOGUE"
  },
  {
    "value": "44901",
    "label": "AR - OPTICIEN LUNETIER"
  },
  {
    "value": "44406",
    "label": "AR - ORTHOPHONISTE"
  },
  {
    "value": "44796",
    "label": "AR - PHARMACIEN"
  },
  {
    "value": "44532",
    "label": "AR - PODOLOGUE"
  },
  {
    "value": "44817",
    "label": "AR - PREPARATEUR PHARMACIE"
  },
  {
    "value": "44403",
    "label": "AR - PSYCHOLOGUE"
  },
  {
    "value": "44402",
    "label": "AR - PSYCHOMOTRICIEN(NE)"
  },
  {
    "value": "44409",
    "label": "AR - PSYCHO/NEUROPSYCHOLOGUE"
  },
  {
    "value": "44373",
    "label": "AR - REFERENT ASSISTANCE DE VIE"
  },
  {
    "value": "44907",
    "label": "AR - REFERENT SANTE"
  },
  {
    "value": "44566",
    "label": "AR - REFERENT TENA"
  },
  {
    "value": "44750",
    "label": "AR - REFLEXOLOGUE"
  },
  {
    "value": "45098",
    "label": "AR - RESPONSABLE CADRE DE VIE"
  },
  {
    "value": "44349",
    "label": "AR - RESPONSABLE HOTELIER"
  },
  {
    "value": "44398",
    "label": "AR - SECRETAIRE ADMINISTRATIVE"
  },
  {
    "value": "44911",
    "label": "AR - SECRETAIRE MEDICALE"
  },
  {
    "value": "45092",
    "label": "AR - THERAPEUTE ALTERNATIVE/INTEGRATIVE"
  },
  {
    "value": "44476",
    "label": "AR - TOURNANT(E) DE CUISINE"
  },
  {
    "value": "5",
    "label": "==AUCUN=="
  },
  {
    "value": "44374",
    "label": "EHPAD - AIDE SOIGNANT (E)"
  },
  {
    "value": "44393",
    "label": "EHPAD - AIDE SOIGNANT(E) NUIT"
  },
  {
    "value": "44914",
    "label": "NETContact - Accès Complet"
  },
  {
    "value": "45167",
    "label": "NetContact - Administratif"
  }
];

const CATEGORIES_PERSONNEL = [
  {
    "value": "Aide à domicile",
    "label": "Aide à domicile",
    "group": "Auxiliaires médicaux - AS"
  },
  {
    "value": "Aide soignant/e (AS)",
    "label": "Aide soignant/e (AS)",
    "group": "Auxiliaires médicaux - AS"
  },
  {
    "value": "Aide soignant/e (AS) à domicile",
    "label": "Aide soignant/e (AS) à domicile",
    "group": "Auxiliaires médicaux - AS"
  },
  {
    "value": "Aide soignant/e (AS) Référent/e",
    "label": "Aide soignant/e (AS) Référent/e",
    "group": "Auxiliaires médicaux - AS"
  },
  {
    "value": "Assistant de soins en gérontologie (ASG)",
    "label": "Assistant de soins en gérontologie (ASG)",
    "group": "Auxiliaires médicaux - AS"
  },
  {
    "value": "Assistant de soins en gérontologie (ASG) Référent/e",
    "label": "Assistant de soins en gérontologie (ASG) Référent/e",
    "group": "Auxiliaires médicaux - AS"
  },
  {
    "value": "Auxiliaire de puériculture",
    "label": "Auxiliaire de puériculture",
    "group": "Auxiliaires médicaux - AS"
  },
  {
    "value": "Cadre de santé",
    "label": "Cadre de santé",
    "group": "Auxiliaires médicaux - IDE"
  },
  {
    "value": "Cadre supérieur de santé",
    "label": "Cadre supérieur de santé",
    "group": "Auxiliaires médicaux - IDE"
  },
  {
    "value": "IDEC",
    "label": "IDEC",
    "group": "Auxiliaires médicaux - IDE"
  },
  {
    "value": "Infirmier/ère",
    "label": "Infirmier/ère",
    "group": "Auxiliaires médicaux - IDE"
  },
  {
    "value": "Infirmier/ère de Secteur Psychiatrique (I.S.P.)",
    "label": "Infirmier/ère de Secteur Psychiatrique (I.S.P.)",
    "group": "Auxiliaires médicaux - IDE"
  },
  {
    "value": "Infirmier/ère en pratique avancée",
    "label": "Infirmier/ère en pratique avancée",
    "group": "Auxiliaires médicaux - IDE"
  },
  {
    "value": "Infirmier/ère H.A.D",
    "label": "Infirmier/ère H.A.D",
    "group": "Auxiliaires médicaux - IDE"
  },
  {
    "value": "Infirmier/ère hygiéniste",
    "label": "Infirmier/ère hygiéniste",
    "group": "Auxiliaires médicaux - IDE"
  },
  {
    "value": "Infirmier/ère libéral/le",
    "label": "Infirmier/ère libéral/le",
    "group": "Auxiliaires médicaux - IDE"
  },
  {
    "value": "Infirmier/ère puéricultrice",
    "label": "Infirmier/ère puéricultrice",
    "group": "Auxiliaires médicaux - IDE"
  },
  {
    "value": "Infirmier/ère référent/te",
    "label": "Infirmier/ère référent/te",
    "group": "Auxiliaires médicaux - IDE"
  },
  {
    "value": "Responsable des soins",
    "label": "Responsable des soins",
    "group": "Auxiliaires médicaux - IDE"
  },
  {
    "value": "Responsable des soins et de l'accompagnement",
    "label": "Responsable des soins et de l'accompagnement",
    "group": "Auxiliaires médicaux - IDE"
  },
  {
    "value": "Audioprothésiste",
    "label": "Audioprothésiste",
    "group": "Auxiliaires médicaux - Paramédical"
  },
  {
    "value": "Diététicien/enne",
    "label": "Diététicien/enne",
    "group": "Auxiliaires médicaux - Paramédical"
  },
  {
    "value": "Ergothérapeute",
    "label": "Ergothérapeute",
    "group": "Auxiliaires médicaux - Paramédical"
  },
  {
    "value": "Kinésithérapeute",
    "label": "Kinésithérapeute",
    "group": "Auxiliaires médicaux - Paramédical"
  },
  {
    "value": "Orthophoniste",
    "label": "Orthophoniste",
    "group": "Auxiliaires médicaux - Paramédical"
  },
  {
    "value": "Orthoptiste",
    "label": "Orthoptiste",
    "group": "Auxiliaires médicaux - Paramédical"
  },
  {
    "value": "Ostéopathe",
    "label": "Ostéopathe",
    "group": "Auxiliaires médicaux - Paramédical"
  },
  {
    "value": "Pédicure - podologue",
    "label": "Pédicure - podologue",
    "group": "Auxiliaires médicaux - Paramédical"
  },
  {
    "value": "Psychomotricien/ne",
    "label": "Psychomotricien/ne",
    "group": "Auxiliaires médicaux - Paramédical"
  },
  {
    "value": "Ambulance - Taxi - VSL",
    "label": "Ambulance - Taxi - VSL",
    "group": "Auxiliaires médicaux - Transport"
  },
  {
    "value": "Accompagnant éducatif et social (AES)",
    "label": "Accompagnant éducatif et social (AES)",
    "group": "Hors CSP - AS"
  },
  {
    "value": "Accompagnant éducatif et social (AES) Référent/e",
    "label": "Accompagnant éducatif et social (AES) Référent/e",
    "group": "Hors CSP - AS"
  },
  {
    "value": "Accompagnement, soins et services à la personne",
    "label": "Accompagnement, soins et services à la personne",
    "group": "Hors CSP - AS"
  },
  {
    "value": "Agent de service intérieur (ASI)",
    "label": "Agent de service intérieur (ASI)",
    "group": "Hors CSP - AS"
  },
  {
    "value": "Agent de soin",
    "label": "Agent de soin",
    "group": "Hors CSP - AS"
  },
  {
    "value": "Agent des services hospitaliers (ASH)",
    "label": "Agent des services hospitaliers (ASH)",
    "group": "Hors CSP - AS"
  },
  {
    "value": "Agent des services logistiques (ASL)",
    "label": "Agent des services logistiques (ASL)",
    "group": "Hors CSP - AS"
  },
  {
    "value": "Aide médico-psychologique (AMP)",
    "label": "Aide médico-psychologique (AMP)",
    "group": "Hors CSP - AS"
  },
  {
    "value": "Aide médico-psychologique (AMP) Référent/e",
    "label": "Aide médico-psychologique (AMP) Référent/e",
    "group": "Hors CSP - AS"
  },
  {
    "value": "Animateur/trice",
    "label": "Animateur/trice",
    "group": "Hors CSP - AS"
  },
  {
    "value": "Animateur/trice Référent/e",
    "label": "Animateur/trice Référent/e",
    "group": "Hors CSP - AS"
  },
  {
    "value": "Auxiliaire d'accompagnement",
    "label": "Auxiliaire d'accompagnement",
    "group": "Hors CSP - AS"
  },
  {
    "value": "Auxiliaire de vie",
    "label": "Auxiliaire de vie",
    "group": "Hors CSP - AS"
  },
  {
    "value": "Surveillant/te de nuit",
    "label": "Surveillant/te de nuit",
    "group": "Hors CSP - AS"
  },
  {
    "value": "Adjoint de direction",
    "label": "Adjoint de direction",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Adjoint/e de coordination",
    "label": "Adjoint/e de coordination",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Administratif",
    "label": "Administratif",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Agent de maintenance",
    "label": "Agent de maintenance",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Agent de service civique",
    "label": "Agent de service civique",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Agent de service technique",
    "label": "Agent de service technique",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Aide comptable",
    "label": "Aide comptable",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Assistant de direction",
    "label": "Assistant de direction",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Assistant/e Médico-Administrative (AMA)",
    "label": "Assistant/e Médico-Administrative (AMA)",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Assistant/e qualité",
    "label": "Assistant/e qualité",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Assistant/e Ressources Humaines",
    "label": "Assistant/e Ressources Humaines",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Avocat/e",
    "label": "Avocat/e",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Chargé d'accueil",
    "label": "Chargé d'accueil",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Comptable",
    "label": "Comptable",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Concierge",
    "label": "Concierge",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Coordinateur/trice de la plateforme de répit",
    "label": "Coordinateur/trice de la plateforme de répit",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Coordinateur/trice de parcours",
    "label": "Coordinateur/trice de parcours",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Coordinateur/trice de projets",
    "label": "Coordinateur/trice de projets",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Coordinateur/trice de service de soutien à domicile",
    "label": "Coordinateur/trice de service de soutien à domicile",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Coordinateur/trice de vie sociale",
    "label": "Coordinateur/trice de vie sociale",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Coordinateur/trice PASA",
    "label": "Coordinateur/trice PASA",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Direction",
    "label": "Direction",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Greffier",
    "label": "Greffier",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Informaticien/ne",
    "label": "Informaticien/ne",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Juge des enfants",
    "label": "Juge des enfants",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Juriste",
    "label": "Juriste",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Maître/tresse de maison",
    "label": "Maître/tresse de maison",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Mandataire judiciaire",
    "label": "Mandataire judiciaire",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Notaire",
    "label": "Notaire",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Qualiticien/ne",
    "label": "Qualiticien/ne",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Responsable accueil de jour",
    "label": "Responsable accueil de jour",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Responsable administratif",
    "label": "Responsable administratif",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Responsable Qualité",
    "label": "Responsable Qualité",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Responsable relations familles",
    "label": "Responsable relations familles",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Responsable Ressources Humaines",
    "label": "Responsable Ressources Humaines",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Secrétaire administrative",
    "label": "Secrétaire administrative",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Secrétaire de direction",
    "label": "Secrétaire de direction",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Surveillant pénitentiaire",
    "label": "Surveillant pénitentiaire",
    "group": "Hors CSP - Administratif"
  },
  {
    "value": "Agent de cuisine",
    "label": "Agent de cuisine",
    "group": "Hors CSP - Cuisine"
  },
  {
    "value": "Cuisinier/ère",
    "label": "Cuisinier/ère",
    "group": "Hors CSP - Cuisine"
  },
  {
    "value": "Responsable cuisine",
    "label": "Responsable cuisine",
    "group": "Hors CSP - Cuisine"
  },
  {
    "value": "Second de cuisine",
    "label": "Second de cuisine",
    "group": "Hors CSP - Cuisine"
  },
  {
    "value": "Serveur/euse",
    "label": "Serveur/euse",
    "group": "Hors CSP - Cuisine"
  },
  {
    "value": "Agent d'atelier",
    "label": "Agent d'atelier",
    "group": "Hors CSP - Entretien"
  },
  {
    "value": "Agent de buanderie",
    "label": "Agent de buanderie",
    "group": "Hors CSP - Entretien"
  },
  {
    "value": "Agent d'entretien qualifié/e (AEQ)",
    "label": "Agent d'entretien qualifié/e (AEQ)",
    "group": "Hors CSP - Entretien"
  },
  {
    "value": "Aide-ménagère",
    "label": "Aide-ménagère",
    "group": "Hors CSP - Entretien"
  },
  {
    "value": "Responsable atelier",
    "label": "Responsable atelier",
    "group": "Hors CSP - Entretien"
  },
  {
    "value": "Responsable buanderie",
    "label": "Responsable buanderie",
    "group": "Hors CSP - Entretien"
  },
  {
    "value": "Coiffeur/feuse",
    "label": "Coiffeur/feuse",
    "group": "Hors CSP - Établissement externe"
  },
  {
    "value": "Esthéticien/ne",
    "label": "Esthéticien/ne",
    "group": "Hors CSP - Établissement externe"
  },
  {
    "value": "Fournisseur",
    "label": "Fournisseur",
    "group": "Hors CSP - Établissement externe"
  },
  {
    "value": "Hôpital - Clinique",
    "label": "Hôpital - Clinique",
    "group": "Hors CSP - Établissement externe"
  },
  {
    "value": "Laboratoire d'analyses",
    "label": "Laboratoire d'analyses",
    "group": "Hors CSP - Établissement externe"
  },
  {
    "value": "Masseur/se",
    "label": "Masseur/se",
    "group": "Hors CSP - Établissement externe"
  },
  {
    "value": "Opticien/ne",
    "label": "Opticien/ne",
    "group": "Hors CSP - Établissement externe"
  },
  {
    "value": "Pompes funèbres",
    "label": "Pompes funèbres",
    "group": "Hors CSP - Établissement externe"
  },
  {
    "value": "Agence immobilière solidaire",
    "label": "Agence immobilière solidaire",
    "group": "Hors CSP - Hébergement"
  },
  {
    "value": "Bailleur",
    "label": "Bailleur",
    "group": "Hors CSP - Hébergement"
  },
  {
    "value": "Bailleur social",
    "label": "Bailleur social",
    "group": "Hors CSP - Hébergement"
  },
  {
    "value": "Gestionnaire",
    "label": "Gestionnaire",
    "group": "Hors CSP - Hébergement"
  },
  {
    "value": "Propriétaire solidaire",
    "label": "Propriétaire solidaire",
    "group": "Hors CSP - Hébergement"
  },
  {
    "value": "Agent hôtelier/ère",
    "label": "Agent hôtelier/ère",
    "group": "Hors CSP - Hôtellerie"
  },
  {
    "value": "Responsable d'hébergement",
    "label": "Responsable d'hébergement",
    "group": "Hors CSP - Hôtellerie"
  },
  {
    "value": "Secrétaire médical/e",
    "label": "Secrétaire médical/e",
    "group": "Hors CSP - Médical"
  },
  {
    "value": "Accompagnant en gérontologie",
    "label": "Accompagnant en gérontologie",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Art-thérapeute",
    "label": "Art-thérapeute",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Brancardier/ère",
    "label": "Brancardier/ère",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Éducateur/trice sportif",
    "label": "Éducateur/trice sportif",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Enseignant/e en activités physiques adaptées",
    "label": "Enseignant/e en activités physiques adaptées",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Fasciathérapeute",
    "label": "Fasciathérapeute",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Gérontopraticien",
    "label": "Gérontopraticien",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Hypnothérapeute",
    "label": "Hypnothérapeute",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Musicothérapeute",
    "label": "Musicothérapeute",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Naturopathe",
    "label": "Naturopathe",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Neuropsychologue",
    "label": "Neuropsychologue",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Podo-orthésiste",
    "label": "Podo-orthésiste",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Professeur d'activités physiques",
    "label": "Professeur d'activités physiques",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Prothésiste",
    "label": "Prothésiste",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Psychogérontologue",
    "label": "Psychogérontologue",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Psychologue",
    "label": "Psychologue",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Référent Rééducateur",
    "label": "Référent Rééducateur",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Réflexologue",
    "label": "Réflexologue",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Sophrologue",
    "label": "Sophrologue",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Stomathérapeute",
    "label": "Stomathérapeute",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Zoothérapeute",
    "label": "Zoothérapeute",
    "group": "Hors CSP - Paramédical"
  },
  {
    "value": "Abbé",
    "label": "Abbé",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Aumônier",
    "label": "Aumônier",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Curé",
    "label": "Curé",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Ecclésiastique",
    "label": "Ecclésiastique",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Evêque",
    "label": "Evêque",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Frère religieux",
    "label": "Frère religieux",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Imam",
    "label": "Imam",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Membre de l'armée du salut",
    "label": "Membre de l'armée du salut",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Ministre du culte",
    "label": "Ministre du culte",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Moine",
    "label": "Moine",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Moniale",
    "label": "Moniale",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Pasteur",
    "label": "Pasteur",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Pope",
    "label": "Pope",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Prêtre",
    "label": "Prêtre",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Rabbin",
    "label": "Rabbin",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Recteur (clergé)",
    "label": "Recteur (clergé)",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Religieuse enseignante",
    "label": "Religieuse enseignante",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Religieuse garde-malade",
    "label": "Religieuse garde-malade",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Religieuse hospitalière",
    "label": "Religieuse hospitalière",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Religieuse infirmière",
    "label": "Religieuse infirmière",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Séminariste",
    "label": "Séminariste",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Soeur religieuse",
    "label": "Soeur religieuse",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Supérieur d'un ordre religieux",
    "label": "Supérieur d'un ordre religieux",
    "group": "Hors CSP - Religieux"
  },
  {
    "value": "Véhicule de l'établissement",
    "label": "Véhicule de l'établissement",
    "group": "Hors CSP - Transport"
  },
  {
    "value": "Accompagnant d'élèves en situation de handicap",
    "label": "Accompagnant d'élèves en situation de handicap",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Agent social",
    "label": "Agent social",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Assistant/e de service social",
    "label": "Assistant/e de service social",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Assistant/e familial",
    "label": "Assistant/e familial",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Assistant/e social",
    "label": "Assistant/e social",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Assistant socio-éducatif (ASE)",
    "label": "Assistant socio-éducatif (ASE)",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Auxiliaire de vie sociale (AVS)",
    "label": "Auxiliaire de vie sociale (AVS)",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Bénévole",
    "label": "Bénévole",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Cadre socio-éducatif",
    "label": "Cadre socio-éducatif",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Cadre supérieur socio-éducatif",
    "label": "Cadre supérieur socio-éducatif",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Chargé d'insertion",
    "label": "Chargé d'insertion",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Chef de service",
    "label": "Chef de service",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Codeur LPC",
    "label": "Codeur LPC",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Conseiller/ère en économie sociale et familiale",
    "label": "Conseiller/ère en économie sociale et familiale",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Conseiller/ère en insertion sociale et professionnelle",
    "label": "Conseiller/ère en insertion sociale et professionnelle",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Conseiller pénitentiaire d'insertion et de probation (CPIP)",
    "label": "Conseiller pénitentiaire d'insertion et de probation (CPIP)",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Délégué/e à la tutelle",
    "label": "Délégué/e à la tutelle",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Éducateur/trice",
    "label": "Éducateur/trice",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Éducateur/trice de jeunes enfants",
    "label": "Éducateur/trice de jeunes enfants",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Éducateur/trice scolaire",
    "label": "Éducateur/trice scolaire",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Éducateur/trice spécialisé/e",
    "label": "Éducateur/trice spécialisé/e",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Éducateur/trice spécialisé/e coordinateur/trice",
    "label": "Éducateur/trice spécialisé/e coordinateur/trice",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Éducateur/trice spécialisé/e en protection de l'enfance",
    "label": "Éducateur/trice spécialisé/e en protection de l'enfance",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Éducateur/trice technique spécialisé/e",
    "label": "Éducateur/trice technique spécialisé/e",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Enseignant/e",
    "label": "Enseignant/e",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Enseignant/e spécialisé/e",
    "label": "Enseignant/e spécialisé/e",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Formateur/trice",
    "label": "Formateur/trice",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Instructeur/trice en locomotion",
    "label": "Instructeur/trice en locomotion",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Interface de communication",
    "label": "Interface de communication",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Interprète",
    "label": "Interprète",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Interprète en langue des signes français",
    "label": "Interprète en langue des signes français",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Intervenant/e social/e",
    "label": "Intervenant/e social/e",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Médiateur/trice familial",
    "label": "Médiateur/trice familial",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Médiateur/trice pair-aidant",
    "label": "Médiateur/trice pair-aidant",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Moniteur d'atelier",
    "label": "Moniteur d'atelier",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Moniteur éducateur",
    "label": "Moniteur éducateur",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Professeur/e CAPEJS",
    "label": "Professeur/e CAPEJS",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Professeur/e de français langue étrangère",
    "label": "Professeur/e de français langue étrangère",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Responsable de service territorial enfance et famille",
    "label": "Responsable de service territorial enfance et famille",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Responsable unité",
    "label": "Responsable unité",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Technicien/ne-coordinateur/trice de l'aide psychosociale aux aidants (TCAPSA)",
    "label": "Technicien/ne-coordinateur/trice de l'aide psychosociale aux aidants (TCAPSA)",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Technicien/ne de l'intervention sociale et familiale",
    "label": "Technicien/ne de l'intervention sociale et familiale",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Transcripteur/trice-adaptateur/trice",
    "label": "Transcripteur/trice-adaptateur/trice",
    "group": "Hors CSP - Travailleur social"
  },
  {
    "value": "Préparateur/trice en pharmacie",
    "label": "Préparateur/trice en pharmacie",
    "group": "Professions de la pharmacie - IDE"
  },
  {
    "value": "Pharmacien/ne",
    "label": "Pharmacien/ne",
    "group": "Professions de la pharmacie - Médical"
  },
  {
    "value": "Biologiste",
    "label": "Biologiste",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Chirurgien orthopédiste",
    "label": "Chirurgien orthopédiste",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Acupuncteur",
    "label": "Médecin - Acupuncteur",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Addictologue",
    "label": "Médecin - Addictologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Alcoologue",
    "label": "Médecin - Alcoologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Algologue",
    "label": "Médecin - Algologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Allergologue",
    "label": "Médecin - Allergologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Anesthésiste",
    "label": "Médecin - Anesthésiste",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Angiologue",
    "label": "Médecin - Angiologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Cardiologue",
    "label": "Médecin - Cardiologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Chirurgien",
    "label": "Médecin - Chirurgien",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Chirurgien maxillo-facial",
    "label": "Médecin - Chirurgien maxillo-facial",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Chirurgien vasculaire thoracique",
    "label": "Médecin - Chirurgien vasculaire thoracique",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Chirurgien viscéral",
    "label": "Médecin - Chirurgien viscéral",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Coordonnateur",
    "label": "Médecin - Coordonnateur",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Coordonnateur groupe",
    "label": "Médecin - Coordonnateur groupe",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Dentiste",
    "label": "Médecin - Dentiste",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Dermatologue",
    "label": "Médecin - Dermatologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Diabétologue",
    "label": "Médecin - Diabétologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Endocrinologue",
    "label": "Médecin - Endocrinologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin en soins palliatifs",
    "label": "Médecin en soins palliatifs",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Expert territorial",
    "label": "Médecin - Expert territorial",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Gastro-entérologue",
    "label": "Médecin - Gastro-entérologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Généraliste",
    "label": "Médecin - Généraliste",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Généticien",
    "label": "Médecin - Généticien",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Gériatre",
    "label": "Médecin - Gériatre",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Géronto-psychiatre",
    "label": "Médecin - Géronto-psychiatre",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Gynécologue",
    "label": "Médecin - Gynécologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Hématologue",
    "label": "Médecin - Hématologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Homéopathe",
    "label": "Médecin - Homéopathe",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Infectiologue",
    "label": "Médecin - Infectiologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Interniste",
    "label": "Médecin - Interniste",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Nephrologue",
    "label": "Médecin - Nephrologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Neurochirurgien",
    "label": "Médecin - Neurochirurgien",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Neurologue",
    "label": "Médecin - Neurologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Neuropédiatre",
    "label": "Médecin - Neuropédiatre",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Nucléaire",
    "label": "Médecin - Nucléaire",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Nutritionniste",
    "label": "Médecin - Nutritionniste",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Odontologue",
    "label": "Médecin - Odontologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Oncologue",
    "label": "Médecin - Oncologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Ophtalmologue",
    "label": "Médecin - Ophtalmologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Orthopédiste",
    "label": "Médecin - Orthopédiste",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Oto-Rhino-Laryngologue",
    "label": "Médecin - Oto-Rhino-Laryngologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Pédiatre",
    "label": "Médecin - Pédiatre",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Pédopsychiatre",
    "label": "Médecin - Pédopsychiatre",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Pharmacologue",
    "label": "Médecin - Pharmacologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Phlébologue",
    "label": "Médecin - Phlébologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Phoniatres",
    "label": "Médecin - Phoniatres",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Pneumologue",
    "label": "Médecin - Pneumologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Psychiatre",
    "label": "Médecin - Psychiatre",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Psychiatre addictologie",
    "label": "Médecin - Psychiatre addictologie",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Radiologue",
    "label": "Médecin - Radiologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Rééducation-réadaptation",
    "label": "Médecin - Rééducation-réadaptation",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Rhumatologue",
    "label": "Médecin - Rhumatologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Santé au travail",
    "label": "Médecin - Santé au travail",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Sexologue",
    "label": "Médecin - Sexologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Spécialiste en Médecine Physique et de Réadaptation (MPR)",
    "label": "Médecin - Spécialiste en Médecine Physique et de Réadaptation (MPR)",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Stomatologue",
    "label": "Médecin - Stomatologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Traumatologue",
    "label": "Médecin - Traumatologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Urgentiste",
    "label": "Médecin - Urgentiste",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Urologue",
    "label": "Médecin - Urologue",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Médecin - Vasculaire",
    "label": "Médecin - Vasculaire",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Radiothérapeute",
    "label": "Radiothérapeute",
    "group": "Professions médicales - Médical"
  },
  {
    "value": "Sage-femme",
    "label": "Sage-femme",
    "group": "Professions médicales - Médical"
  }
];

module.exports = { ETABLISSEMENTS, PROFILS_DROIT, CATEGORIES_PERSONNEL };
