# Outils éditeur Algonis — à garder sur VOTRE poste

Ce dossier ne doit **pas** rester sur le serveur d'un client. Extrayez-le sur
votre machine (par exemple `C:\Algonis\outils-editeur` ou `~/Algonis`), et
c'est de là que vous fabriquerez les licences.

Aucune installation : juste Node.js (version 20 ou plus récente —
`node --version` pour vérifier).

```
outils-editeur/
├── LISEZ-MOI.md              ← ce fichier
├── console-algonis.cmd       ← Windows : DOUBLE-CLIC → ouvre la console
├── console-algonis.sh        ← macOS / Linux : idem
├── console.js                ← le petit serveur local de la console
├── console/                  ← l'interface (HTML/CSS/JS)
├── lib/                      ← signature et registre des clients
├── generer-licence.cmd       ← secours : questions/réponses en ligne de commande
├── generer-licence.sh        ← idem, macOS / Linux
└── scripts/
    ├── licence-keygen.js     ← crée votre paire de clés (UNE SEULE FOIS)
    └── licence-signer.js     ← signe une licence client (ligne de commande)
```

## La console — le tableau de bord de vos clients

Double-cliquez sur **`console-algonis.cmd`** (Windows) ou lancez
`./console-algonis.sh` : votre navigateur s'ouvre sur un panneau qui rassemble
tout ce dont vous avez besoin.

- **la liste de toutes les sociétés** à qui vous avez livré le portail, avec
  leur identifiant d'installation, leur contact et vos notes internes ;
- **le statut de chacune** : active, expire dans X jours (orange dès 30 jours),
  expirée, sans licence — et quatre compteurs en haut de page ;
- **l'historique complet des licences** émises pour chaque société (dates,
  tolérance, référence de commande), avec un bouton pour revoir et recopier
  n'importe quelle licence déjà envoyée ;
- **la génération et le renouvellement** en deux clics : la console propose
  automatiquement la suite de la licence en cours (début = lendemain de
  l'échéance, fin = un an plus tard) et la signe avec votre clé privée ;
- **la reprise d'une licence déjà émise** (bouton « Enregistrer une licence
  déjà émise ») : collez un jeton généré autrefois en ligne de commande, sa
  signature est vérifiée puis il rejoint l'historique.

Tout est stocké dans un seul fichier sur votre poste :
`%USERPROFILE%\.algonis\clients.json` (ou `~/.algonis/clients.json`), en droits
`600`. Sauvegardez-le avec votre clé privée.

**Ce que la console n'est pas** : un service en ligne. Elle n'écoute que sur
`127.0.0.1`, n'appelle rien à l'extérieur, et exige un jeton de session tiré au
hasard à chaque démarrage — l'adresse affichée dans la fenêtre noire n'est
valable que pour cette session. Personne d'autre que vous, sur votre machine,
ne peut l'ouvrir.

> La ligne de commande (`generer-licence.cmd`, `scripts/licence-signer.js`)
> reste disponible et produit exactement les mêmes licences : les deux chemins
> partagent le même code de signature. Utilisez-la si la console ne démarre pas.

---

## Étape 1 — une seule fois dans votre vie : créer vos clés

```bash
node scripts/licence-keygen.js
```

Deux fichiers apparaissent dans `~/.algonis` (ou `%USERPROFILE%\.algonis`) :

| Fichier | Rôle | À protéger ? |
|---|---|---|
| `licence-private.pem` | **signe** les licences | **OUI. Jamais transmise, jamais dans un dépôt Git.** Sauvegardez-la (clé USB chiffrée, gestionnaire de mots de passe). Perdue = plus aucune nouvelle licence signable. |
| `licence-public.txt` | permet au portail de **vérifier** | Non, elle part chez tous les clients. |

La commande affiche une ligne à coller **une fois** dans le portail, fichier
`src/licence.js` :

```js
const CLE_PUBLIQUE = 'MCowBQYDK2VwAyEA…';
```

> **Tant que cette ligne n'est pas remplacée, le portail tourne sans aucune
> limitation** et le panneau d'administration l'affiche en clair
> (« Licence non configurée »). C'est pratique pour développer — mais ne livrez
> jamais un client sans avoir posé votre clé.

Cette ligne est la même pour tous vos clients : vous ne refaites cette étape
que si votre clé privée a fuité.

## Étape 2 — à chaque vente ou renouvellement : signer une licence

Le client vous donne son **identifiant d'installation** (il le lit dans
Administration → Réglages → Licence, ça ressemble à `A1B2-C3D4-E5F6-7890`).

**Le plus simple** : ouvrez la console (`console-algonis.cmd`), créez la
société si c'est une nouvelle, puis « Générer la licence » / « Renouveler la
licence ». Le jeton s'affiche avec un bouton « Copier ». La société et sa
licence sont enregistrées : vous saurez l'an prochain quand la relancer.

**En ligne de commande**, si vous préférez :

```bash
node scripts/licence-signer.js \
  --client "ADEF Résidences" \
  --fin 2027-07-31 \
  --install A1B2-C3D4-E5F6-7890
```

Vous obtenez un jeton d'une seule ligne :

```
ALG1.eyJ2IjoxLCJjbGllbnQiOiJBREVGIFLDqXNpZGVuY2VzIi…
```

Envoyez-le au client (mail, ticket : ce n'est pas un secret, il ne fonctionne
que sur SON installation). Il le colle dans Administration → Réglages →
Licence, clique « Installer la licence », c'est fini.

### Les options

| Option | À quoi ça sert |
|---|---|
| `--client "Nom"` | **obligatoire** — s'affiche dans le panneau du client |
| `--fin 2027-07-31` | **obligatoire** — dernier jour de validité |
| `--install A1B2-…` | **fortement conseillé** — la licence ne marche que sur cette installation. Sans elle, elle marche partout : à réserver aux dépannages. |
| `--debut 2026-09-01` | si la licence ne doit démarrer que plus tard (défaut : aujourd'hui) |
| `--grace 15` | tolérance après l'échéance. **Défaut : 0** — la licence s'arrête le jour dit. À n'utiliser que pour un geste commercial. |
| `--note "Devis 2026-118"` | commentaire conservé dans la licence (utile pour retrouver la commande) |

### Renouveler

Dans la console : ouvrez la société, « Renouveler la licence », les dates sont
déjà proposées, « Générer ». En ligne de commande : exactement la même commande
avec la nouvelle date de fin.

Le client colle la nouvelle licence par-dessus l'ancienne : aucune
interruption, rien à redémarrer, et les demandes en attente repartent seules.

---

## Ce que voit le client, et quand

| Situation | Ce qui se passe |
|---|---|
| Plus de 30 jours restants | rien, le portail fonctionne normalement |
| 30 jours ou moins | bandeau orange sur tout le site : « Licence : expiration dans 12 jours », avec la date |
| Le jour de l'échéance | **arrêt des traitements**, sans tolérance : plus de création ni de modification de compte, dépôt refusé |
| Après l'échéance | bandeau rouge. **Toutes les données restent consultables** : comptes, historique, suivi, journal. Rien n'est perdu ni supprimé. |
| Licence renouvelée | tout reprend immédiatement, y compris les demandes restées en attente |

---

## « Pourquoi la clé publique peut-elle rester visible dans le code ? »

C'est la question qu'on se pose toujours, et la réponse tient en une image :
**un cachet de cire.**

- Votre **clé privée** est le *tampon*. Il est chez vous, il **fabrique** le
  cachet. Personne d'autre ne l'a.
- La **clé publique** est l'*empreinte du tampon*. Elle est chez tous les
  clients, et elle sert uniquement à **vérifier** qu'un cachet est authentique.

Voir l'empreinte ne permet pas de graver le tampon. C'est le principe de la
signature asymétrique (ici Ed25519) : les deux clés vont **dans un seul sens**.
On ne remonte pas de la publique vers la privée — pas « c'est difficile » :
mathématiquement hors de portée, même avec tous les ordinateurs de la planète.

Un client qui ouvre `src/licence.js` et lit la clé publique peut :

- vérifier des licences. C'est tout. C'est exactement ce que fait le portail.

Il ne peut **pas** :

- se fabriquer une licence (il faudrait la clé privée) ;
- prolonger la sienne (la date est couverte par la signature) ;
- réutiliser celle d'un autre client (elle est liée à une installation).

**Oui, la clé doit être dans le code livré.** Le portail doit pouvoir vérifier
une licence sans appeler personne — vos clients ont des flux réseau fermés. La
clé de vérification doit donc voyager avec l'application : c'est le
fonctionnement normal de tout système de licence hors ligne.

### Le seul contournement, et comment vous le voyez

Un client déterminé peut **modifier votre code** : remplacer votre clé publique
par la sienne, et se signer des licences. Aucune vérification locale n'empêche
cela — seul un appel à votre serveur le ferait, ce que ses flux interdisent.

Pour que ce soit visible, le panneau affiche l'**empreinte de la clé
embarquée** (8 caractères, sous l'identifiant d'installation). Comparez-la à la
vôtre, **affichée en haut à droite de la console** (et dans la fenêtre noire au
démarrage). En ligne de commande :

```bash
node -e "const c=require('crypto'),f=require('fs'),o=require('os');console.log(c.createHash('sha256').update(f.readFileSync(o.homedir()+'/.algonis/licence-public.txt','utf8').trim()).digest('hex').slice(0,8).toUpperCase())"
```

Si l'empreinte affichée chez un client diffère de la vôtre, sa copie a été
modifiée. C'est alors un sujet contractuel, plus un sujet technique.

---

## Sécurité — ce que ça bloque, ce que ça ne bloque pas

**Bloqué** (chaque cas est couvert par un test automatisé) :

- modifier la date de fin dans le jeton → signature invalide ;
- fabriquer une licence avec sa propre clé → signature invalide ;
- recopier la licence d'un autre client → « émise pour une autre installation » ;
- reculer l'horloge pour faire « revivre » une licence échue → détecté,
  traitements suspendus (une simple correction d'horloge, elle, ne gêne pas) ;
- supprimer la licence de la base → « aucune licence installée » ;
- repartir d'une base vide → nouvel identifiant d'installation, licence invalide.

**Pas bloqué** : quelqu'un qui modifie le code source livré peut désactiver
n'importe quel contrôle local (remplacer la clé publique, retirer l'appel de
vérification). Aucune vérification hors ligne ne résiste à cela — seul un
contrôle sur votre serveur le ferait, ce que les flux réseau fermés de vos
clients interdisent.

Ce qui est garanti : **un client ne prolonge pas sa licence en modifiant un
fichier, une date, une clé ou l'horloge.** Il faudrait modifier votre
application — un acte délibéré, et contractuellement attaquable.

Deux garde-fous côté commercial :

- la licence porte le nom du client, affiché dans son panneau : une licence
  recopiée s'annonce comme appartenant à quelqu'un d'autre ;
- le journal d'activité du portail conserve chaque installation de licence
  (date, administrateur, client, échéance).

---

## En cas de problème chez un client

| Le client dit… | Ce que vous vérifiez |
|---|---|
| « Licence invalide » | le jeton a été coupé au copier-coller (il doit être sur **une seule ligne**, sans espace) |
| « émise pour une autre installation » | l'identifiant d'installation a changé (base recréée, nouveau serveur) → resignez avec le nouvel identifiant qu'il vous donne |
| « Date du serveur incohérente » | l'horloge a été reculée alors que la licence était déjà échue → remettre l'horloge à l'heure **et** installer une licence à jour |
| « Aucune licence installée » | la base a été réinitialisée → renvoyez une licence |
| Le panneau dit « Licence non configurée » | la clé publique n'a pas été posée dans `src/licence.js` avant la livraison (étape 1) |
