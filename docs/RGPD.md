# Conformité RGPD — portail de création de comptes

Ce document est celui qu'un délégué à la protection des données demandera avant
la mise en service. Il décrit ce que le portail traite, sous quelle
responsabilité, avec quelles garanties, et ce qui reste à la charge du client.

Il vaut **annexe technique au contrat de sous-traitance** (article 28 du RGPD)
et **fiche de registre** (article 30) à recopier dans le registre du client.

---

## 1. Qui est responsable de quoi

| | Rôle | Ce qu'il décide |
|---|---|---|
| **L'organisation cliente** | Responsable de traitement | Pourquoi les comptes sont créés, qui est habilité, combien de temps on conserve, comment on répond aux personnes |
| **Smartfixx** | Sous-traitant (art. 28) | Comment le service fonctionne techniquement. N'agit que sur instruction documentée du client |

Smartfixx n'utilise **aucune donnée du client à ses propres fins** : ni
statistiques commerciales, ni amélioration de produit, ni entraînement de
modèle. Chaque organisation dispose de son **propre processus et de sa propre
base** ; aucune requête ne peut traverser de l'une à l'autre.

### Sous-traitants ultérieurs

| Sous-traitant | Rôle | Localisation |
|---|---|---|
| OVH SAS | Hébergement du serveur | France (Union européenne) |
| Microsoft Ireland Operations Ltd | Authentification des comptes professionnels (Entra ID) | Union européenne |

Aucun transfert hors de l'Union européenne n'est réalisé. Le client est informé
de tout changement de sous-traitant ultérieur et peut s'y opposer.

---

## 2. Fiche de registre (article 30)

**Nom du traitement** — Création et administration automatisées des comptes
applicatifs des salariés.

**Finalités** — Ouvrir, modifier, transférer et réinitialiser les comptes des
salariés sur les applications métiers (BlueKanGo, NetSoins) ; leur remettre
leurs identifiants de façon sécurisée ; conserver la trace de ces opérations.

**Base légale** — Intérêt légitime du responsable de traitement (art. 6.1.f) :
administrer les accès de ses salariés aux outils nécessaires à leur travail et
en assurer la sécurité. Le traitement est prévisible pour la personne concernée,
limité à ce que suppose son emploi, et sans effet défavorable sur elle.

**Personnes concernées** — Salariés de l'organisation : ceux pour qui un compte
est ouvert, et ceux qui déposent les demandes (référents).

**Catégories de données**

| Catégorie | Contenu |
|---|---|
| Identification | Civilité, nom, prénom, adresse professionnelle |
| Vie professionnelle | Fonction, établissement, type et dates de contrat |
| Connexion | Identifiant créé, horodatage, adresse IP, actions réalisées |
| Diagnostic technique | Captures d'écran du robot pendant le traitement |

**Aucune donnée sensible n'est collectée** au sens de l'article 9. Les captures
d'écran constituent la seule exposition indirecte possible — elles photographient
des écrans d'application de santé — et c'est la raison de leur durée de vie très
courte (voir § 3).

**Mots de passe** — Jamais conservés. Un mot de passe provisoire est chiffré le
temps d'un lien à usage unique, puis détruit à la première consultation ou à
l'expiration du lien.

**Destinataires**

- les administrateurs du portail désignés par l'organisation ;
- les référents, **limités à leurs propres établissements** ;
- le personnel de Smartfixx, uniquement sur demande d'intervention du client, et
  chaque accès est tracé.

**Décision automatisée** — Aucune. Le robot exécute une demande déjà validée par
une personne ; il ne décide de rien.

---

## 3. Durées de conservation

Elles sont **appliquées par le code**, pas seulement annoncées : une purge passe
au démarrage du portail puis toutes les six heures (`src/retention.js`). La page
de mentions légales et l'écran d'administration affichent les valeurs
réellement en vigueur — elles ne peuvent pas diverger de la pratique.

| Catégorie | Durée | Pourquoi |
|---|---|---|
| Captures d'écran des robots | **1 jour** | Ne servent qu'à comprendre un échec le jour même |
| Boîte d'envoi des e-mails | 30 jours | Vérifier qu'un envoi a eu lieu |
| Liens de remise d'identifiants | 30 jours | Usage unique, expirent d'eux-mêmes |
| Demandes traitées | 1 an | Preuve de l'opération, suivi des comptes |
| Journal d'activité | 1 an | Sécurité et traçabilité des accès |
| Registre des comptes créés | 3 ans | Éviter les doublons d'identifiants |

Chaque durée est ajustable par l'organisation (variables `RETENTION_*`). Une
demande encore en file n'est jamais purgée, si ancienne soit-elle : l'effacer
supprimerait un travail que personne n'a décidé d'abandonner.

---

## 4. Droits des personnes

L'administration du portail dispose d'un écran dédié (**Données personnelles**)
qui permet, pour une personne donnée :

- de **réunir** tout ce que le portail détient sur elle — demandes, comptes
  créés, habilitation, journal ;
- de l'**exporter** dans un fichier lisible (droits d'accès et de portabilité) ;
- de l'**effacer**, après avoir retapé son nom.

L'effacement supprime les demandes, les comptes du registre, les e-mails et
l'habilitation. Le **journal de sécurité est anonymisé, non supprimé** : savoir
qu'un accès a eu lieu, quand et depuis quelle adresse reste nécessaire à la
sécurité du système — réserve prévue à l'article 17.3. L'identité disparaît,
l'événement reste.

Chaque consultation de dossier et chaque effacement sont eux-mêmes tracés :
c'est ce qui permet de démontrer qu'une demande a été traitée, et quand.

Le délai de réponse légal est d'un mois. La rectification passe par une démarche
ordinaire du portail (« Mettre à jour un compte »), qui corrige à la fois le
portail et l'application métier.

---

## 5. Mesures techniques et organisationnelles (article 32)

**Cloisonnement** — Une organisation = un processus système + une base de
données. Ce n'est pas une séparation logique dans une base commune : il n'existe
aucune requête capable de franchir la frontière. Les sous-domaines sont routés
par nom d'hôte, et un hôte forgé n'atteint rien.

**Contrôle d'accès** — Authentification Microsoft 365 de l'organisation
(OpenID Connect, code d'autorisation + PKCE). Le portail est **fermé par
défaut** : seuls les comptes inscrits comme référents entrent, les autres sont
refusés avec une explication. L'administration a sa propre authentification,
distincte.

**Chiffrement** — HTTPS obligatoire, cookies `Secure` et `HttpOnly` dès que la
connexion est chiffrée. Secrets au repos en AES-256-GCM (identifiants de service
des applications métiers, mots de passe provisoires). Mots de passe
d'administration hachés en scrypt, jamais réversibles.

**Journalisation** — Toute action sensible est tracée : qui, quoi, quand, depuis
quelle adresse. Le journal est consultable par l'administration et conservé un
an.

**Minimisation** — Le panneau d'exploitation de Smartfixx ne voit que des
compteurs (nombre de demandes, taux d'échec) : aucune donnée nominative d'un
client n'y remonte. Les journaux techniques d'un portail y sont expurgés des
adresses e-mail, des longs numéros et des secrets.

**Sauvegardes** — Quotidiennes, conservées 14 jours, contenant les bases des
clients. Elles doivent être recopiées hors du serveur et **gardées chiffrées**.

**Tests** — Les propriétés ci-dessus sont vérifiées par des tests d'attaque
rejouables (cloisonnement, liste blanche, injections, traversée de chemin,
usurpation d'adresse). Voir `SECURITY.md`.

---

## 6. Violation de données (article 33)

En cas d'incident affectant des données personnelles, Smartfixx **informe le
client sans délai injustifié**, et au plus tard **24 heures** après en avoir pris
connaissance, avec : la nature de la violation, les catégories et le volume
approximatif de données concernées, les conséquences probables et les mesures
prises. Le client, responsable de traitement, décide de la notification à la
CNIL (72 heures) et, le cas échéant, de l'information des personnes.

Le journal d'activité et les sauvegardes permettent de reconstituer ce qui s'est
passé et de mesurer l'étendue de l'incident.

---

## 7. Ce qui reste à la charge du client

1. Renseigner les **mentions légales** depuis l'administration (raison sociale,
   siège, directeur de publication, contact du DPO, hébergeur). Tant que ce
   n'est pas fait, la page publique affiche « à compléter ».
2. Inscrire ce traitement à **son registre** (§ 2 est prêt à être recopié).
3. **Informer ses salariés**, par la note d'information interne ou le règlement
   intérieur : le portail affiche la politique de confidentialité, mais
   l'information initiale relève de l'employeur.
4. Tenir à jour la liste des **référents** : une habilitation qui traîne après un
   départ est le risque le plus courant.
5. Décider s'il conserve les durées par défaut ou les raccourcit.

---

## 8. Fin de contrat

À la fin du contrat, et au choix du client :

- **restitution** : une archive complète de sa base et de ses réglages lui est
  remise ;
- **effacement** : sa base, ses réglages, son dossier d'instance et ses
  sauvegardes sont supprimés du serveur.

Sans instruction dans les 30 jours suivant la fin du contrat, l'effacement est
appliqué par défaut.
