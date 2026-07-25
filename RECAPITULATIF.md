# Algonis — où on en est, comment ça marche, ce qu'il reste à faire

Portail interne ADEF Résidences : un référent demande un compte, un robot le
crée dans l'application métier, l'agent reçoit ses identifiants.

---

## 1. Comment ça marche, en trois phrases

1. Un **référent** se connecte avec son compte Microsoft 365 et dépose une
   demande (créer un compte, réinitialiser un mot de passe…).
2. Un **robot** ouvre l'application métier (BlueKanGo, NetSoins), fait les
   clics et remplit les champs comme le ferait une personne, et enregistre.
3. Le **titulaire** reçoit un lien sécurisé, à usage unique, pour récupérer son
   identifiant et son mot de passe provisoire.

Le référent suit l'avancement en direct, et l'administrateur voit tout : qui a
demandé quoi, quand, avec quel résultat, captures d'écran du robot à l'appui.

---

## 2. Les trois espaces

| Espace | Adresse | Pour qui | Ce qu'on y fait |
|---|---|---|---|
| **Mon espace** | `/espace` | référents | déposer une demande, agir sur les comptes existants |
| **Suivre une demande** | `/suivi.html` | référents | voir ses demandes et leur statut, ou chercher une référence |
| **Administration** | `/admin.html` | vous | tout piloter (voir §4) |

### Mon espace — déposer une demande en deux clics

**Écran 1** : deux grandes cartes, BlueKanGo ou NetSoins.
**Écran 2** : les démarches disponibles sur l'application choisie.

| Démarche | Ce que fait le robot |
|---|---|
| **Créer un compte** | duplique un compte de même fonction (droits hérités), saisit l'identité, crée les identifiants, pose la date de fin si CDD |
| **Ajouter un établissement** | rattache un établissement de plus, sans rien retirer |
| **Mettre à jour un compte** | un seul formulaire, trois cas : mot de passe oublié · corriger le nom/prénom · transférer vers un autre établissement (l'ancien est retiré) |

Une démarche n'apparaît **que si un robot sait l'exécuter**. Aujourd'hui :
NetSoins a les 3 cartes, BlueKanGo en a 2 (l'ajout d'établissement lui manque,
voir §5).

En dessous, la liste des **comptes existants** : onglets par application,
recherche, pages de 15, les comptes créés ici et les plus récents en tête.
Chaque ligne a ses raccourcis (Réinit. · Étab. · Mettre à jour) qui
pré-remplissent le formulaire.

---

## 3. Ce que le portail protège tout seul

| Garde-fou | Ce qu'il empêche |
|---|---|
| **Porte Microsoft 365** | aucune page, aucune API sans compte du tenant ADEF |
| **Habilitation par établissement** | un référent n'agit que sur SES établissements — départ *et* arrivée pour un transfert |
| **Comptes de service** | personne ne peut viser le compte administrateur du robot (sinon : réinitialiser son mot de passe = prendre la main sur toute l'application métier) |
| **Lecture d'une demande** | réservée au déposant, au bénéficiaire, au référent concerné, à vous |
| **Identifiants** | lien à usage unique, expirant, mot de passe chiffré, jamais dans un e-mail |
| **Lecture de la fenêtre de confirmation** | une erreur affichée par BlueKanGo fait échouer la demande au lieu d'être annoncée comme un succès |

Audit complet et tentatives d'attaque : `docs/AUDIT-2026-07-25.md`.
Deux failles réelles ont été trouvées et corrigées, dont une prise de contrôle.

---

## 4. Le panneau d'administration

| Vue | Ce qu'on y voit |
|---|---|
| **Vue d'ensemble** | comptes créés, taux de réussite, échecs, **référents habilités**, graphiques, qui a fait quoi |
| **Demandes** | toutes les demandes, filtres, détail complet (étapes du robot, captures, e-mails, relance) |
| **Comptes créés** | identifiants attribués |
| **E-mails** | boîte d'envoi |
| **Référents** | qui est habilité, sur quels établissements (avec les codes) |
| **Comptes admin** | accès au panneau |
| **Réglages** | navigation du site, état SSO/SMTP, **licence**, applications |
| **Journal d'activité** | tout ce qui a été fait, par qui, quand |

> **Important — les référents.** Le dépôt est **réservé aux référents
> déclarés**. Tant qu'il n'y en a aucun, personne ne peut déposer : la vue
> d'ensemble l'affiche en rouge, avec le lien pour les ajouter. Un référent sans
> établissement se connecte mais ne voit rien : c'est signalé en orange.
> (Avant, une base sans référent laissait déposer **n'importe quel** salarié sur
> **n'importe quel** établissement, sans le dire. C'est corrigé.)

---

## 5. La licence annuelle

**Côté client** : il colle un jeton dans Réglages → Licence. Aucun appel
réseau, jamais — ses flux fermés ne posent donc aucun problème.

**Côté vous** : le dossier `outils-editeur/` (à extraire sur votre poste, hors
du serveur client) contient tout, avec son mode d'emploi.

```
Une fois pour toutes  : node outils-editeur/scripts/licence-keygen.js
                        → colle la clé publique affichée dans src/licence.js
Au quotidien          : double-clic sur console-algonis.cmd
                        → un panneau dans le navigateur : toutes vos sociétés,
                          leurs licences, ce qui expire, génération en 2 clics
```

**La console éditeur** (`console-algonis.cmd`) est votre tableau de bord
commercial : la liste des sociétés livrées avec leur identifiant
d'installation, le statut de chaque licence (active / expire dans X jours /
expirée), l'historique complet des jetons émis, et la génération ou le
renouvellement en deux clics avec les dates déjà proposées. Tout tient dans
`~/.algonis/clients.json`, sur votre poste. La console n'écoute que sur
`127.0.0.1` avec un jeton de session tiré au hasard à chaque démarrage : elle
n'est joignable que par vous. La ligne de commande reste disponible en secours
et produit exactement les mêmes licences.

**Ce que vit le client** :

| Quand | Ce qui se passe |
|---|---|
| plus de 30 jours restants | rien |
| **30 jours ou moins** | bandeau orange : « Licence : expiration dans 12 jours » |
| **le jour de l'échéance** | arrêt des créations et modifications, **sans aucune tolérance** |
| après | bandeau rouge — **toutes les données restent consultables** |
| licence renouvelée | tout reprend, y compris les demandes en attente |

Détails, limites et dépannage : `outils-editeur/LISEZ-MOI.md` et
`docs/LICENCE.md`.

---

## 6. Ce qu'il reste à faire

### À faire par vous, avant de livrer un client

| # | Quoi | Pourquoi |
|---|---|---|
| 1 | `outils-editeur/scripts/licence-keygen.js` puis coller la clé publique dans `src/licence.js` | sinon le portail tourne **sans limitation** (le panneau le dit) |
| 2 | Remplir le `.env` : URL et comptes admin BlueKanGo/NetSoins, SMTP, Microsoft 365 | le robot et les e-mails en dépendent |
| 3 | `<APP>_PROTECTED_LOGINS` : les autres comptes techniques du client | le compte admin du robot est déjà protégé, pas les comptes d'interface/export |
| 4 | Déclarer les référents dans le panneau | sans eux, personne ne peut déposer |
| 5 | HTTPS + `ADMIN_COOKIE_SECURE=true` et `COOKIE_SECURE=true` | cookies de session protégés (le panneau alerte si ce n'est pas fait) |
| 6 | Sauvegarder `data/` **y compris `secret.key`** | sans cette clé, les liens d'identifiants chiffrés sont perdus |

### Décisions à prendre (je fais dès que vous tranchez)

| # | Question | Pourquoi ça compte |
|---|---|---|
| 7 | Durée de conservation des **captures d'écran** des robots ? | elles montrent des fiches d'applications métiers → données personnelles, rien ne les purge aujourd'hui (RGPD) |
| 8 | Deuxième facteur sur le panneau d'administration ? | ce compte donne accès à tout |

### Fonctionnalités en attente

| # | Quoi | Ce qui bloque |
|---|---|---|
| 9 | **Ajout d'établissement sur BlueKanGo** | il me manque le parcours Playwright : où l'on voit et modifie les établissements d'un utilisateur. Envoyez-le et je l'ajoute (NetSoins l'a déjà). |
| 10 | **OTP NetSoins automatique** | en attente que Ludovic autorise la lecture de la boîte mail (`Mail.Read`). En attendant, vous saisissez le code à la main dans le panneau : le robot patiente. |
| 11 | Identifiant NetSoins après correction du nom | sur BlueKanGo l'identifiant suit le nouveau nom. Sur NetSoins il reste `NOM PRÉNOM` d'origine : à faire si vous voulez le même comportement (dites-le moi). |
| 12 | Rapatrier les tests dans `tests/` + `npm test` | j'ai 11 scénarios (48 tentatives d'attaque + non-régression) qui vivent hors du dépôt. Les intégrer donnerait un filet de sécurité rejouable à chaque modification. |

---

## 7. Commandes utiles

```bash
npm start                       # serveur + robot (http://localhost:3000, admin : /admin)
AUTOMATION_MODE=demo npm start  # robots sur la console de démonstration (sans toucher aux vraies applis)
node scripts/import-netsoins.js <export.xlsx>   # importer les comptes existants
# Licences : voir le dossier outils-editeur/ (à garder sur le poste de l'éditeur)
```

## 8. La documentation, si vous voulez creuser

| Fichier | Contenu |
|---|---|
| `outils-editeur/LISEZ-MOI.md` | licences : mode d'emploi complet, dépannage |
| `docs/LICENCE.md` | licences : détails techniques et limites |
| `docs/AUDIT-2026-07-25.md` | audit de sécurité, failles corrigées, recommandations |
| `SECURITY.md` | sécurité du portail dans son ensemble |
| `docs/AUTOMATISATION.md` | comment les robots sont écrits et calibrés |
| `docs/API.md` | l'API, route par route |
