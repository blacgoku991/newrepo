# Licence annuelle — mode d'emploi

Le portail vérifie sa licence **hors ligne**. Aucun appel réseau, aucun serveur
de licences à joindre : les établissements clients ont des flux sortants
souvent fermés, et l'application doit démarrer sans rien demander à personne.

---

## Ce que voit le client

Une licence est un jeton signé, remis par vous :

```
ALG1.eyJ2IjoxLCJjbGllbnQiOiJBREVGIFLpc2lkZW5jZXMiLCJkZWJ1dCI6…. tS9k…
```

Il le colle dans **Administration → Réglages → Licence**, et c'est tout.
La carte affiche l'état, l'échéance, le nombre de jours restants et
l'identifiant de son installation.

### Ce qui se passe à l'échéance

| Situation | Traitements | Données | Ce que voit l'utilisateur |
|---|---|---|---|
| Plus de 30 jours restants | actifs | consultables | rien |
| **30 jours ou moins** | actifs | consultables | bandeau orange avec le DÉCOMPTE : « Licence : expiration dans 12 jours » |
| **Le jour de l'échéance** | **suspendus** | consultables | bandeau rouge, dépôt de demande refusé |

**Aucune tolérance** : la licence s'arrête le jour dit. Le décompte prévient un
mois à l'avance, il n'y a donc pas de surprise. (`--grace N` reste disponible
dans l'outil de signature pour un geste commercial explicite ; par défaut, rien
n'est accordé.)

**Mode limité = robots coupés, rien de perdu.** Les demandes déjà en file
restent `en_attente` : dès la licence renouvelée, elles repartent seules. Les
comptes, l'historique, le journal, les exports : tout reste consultable.

---

## Mise en place, une fois pour toutes

### 1. Créer votre paire de clés (sur VOTRE poste)

```bash
node scripts/licence-keygen.js
```

- écrit la clé **privée** dans `~/.algonis/licence-private.pem` (`chmod 600`) ;
- affiche la clé **publique** à coller dans `src/licence.js`.

> La clé privée ne doit jamais quitter votre poste ni entrer dans un dépôt :
> qui la possède peut fabriquer des licences. Sauvegardez-la (sans elle, plus
> aucune nouvelle licence ne peut être signée). Si elle fuite : nouvelle paire,
> nouvelle clé publique dans le code, réémission des licences en cours.

### 2. Poser la clé publique dans le code

Dans `src/licence.js`, remplacer :

```js
const CLE_PUBLIQUE = 'REMPLACER_PAR_VOTRE_CLE_PUBLIQUE';
```

par la ligne affichée par `licence-keygen.js`. La clé publique n'est pas un
secret : elle part chez tous les clients.

> **Tant que le gabarit est en place, le portail tourne sans limitation** et le
> panel affiche « Licence non configurée ». Pratique en développement,
> à ne jamais laisser chez un client.

### 3. Émettre une licence

Le client vous donne son **identifiant d'installation** (Réglages → Licence) :

```bash
node scripts/licence-signer.js \
  --client "ADEF Résidences" \
  --fin 2027-07-31 \
  --install A1B2-C3D4-E5F6-7890
```

Options utiles :

| Option | Effet |
|---|---|
| `--debut AAAA-MM-JJ` | entrée en vigueur (défaut : aujourd'hui) |
| `--grace N` | tolérance après l'échéance. **Défaut : 0** — arrêt le jour dit |
| `--install ID` | lie la licence à une installation — **recommandé** |
| `--note "texte"` | commentaire conservé dans la licence (n° de commande…) |
| `--cle chemin` | autre emplacement de clé privée |

Sans `--install`, la licence fonctionne sur n'importe quelle installation :
à réserver aux dépannages.

### 4. Renouveler

Signer une nouvelle licence avec la nouvelle date de fin, le client la colle
par-dessus l'ancienne. Rien d'autre à faire, aucune interruption.

---

## Ce que le système empêche

| Tentative | Résultat |
|---|---|
| Modifier la date de fin dans le jeton | signature invalide → mode limité |
| Fabriquer une licence avec sa propre clé | signature invalide → mode limité |
| Annoncer une tolérance de 99 999 jours | bornée à 365 jours |
| Recopier la licence d'un autre client | « émise pour une autre installation » |
| Reculer l'horloge du serveur | borne haute d'horloge → mode limité |
| Supprimer la licence en base | « aucune licence installée » → mode limité |
| Repartir d'une base vide | nouvel identifiant d'installation → licence invalide |

Chacun de ces cas est couvert par un test (voir la section suivante).

### Ce que le système n'empêche pas

C'est un verrou commercial, **pas un DRM**. Qui modifie le code source livré
peut désactiver n'importe quel contrôle local — remplacer la clé publique,
retirer l'appel à `licence.etat()`. Aucune vérification locale ne résiste à
cela ; seul un contrôle serveur le ferait, ce que les contraintes réseau du
client interdisent.

Ce qui est garanti : **un client ne prolonge pas sa licence en éditant un
fichier, une date, une clé ou l'horloge.** Il faut modifier le code de
l'application — un acte délibéré, contractuellement attaquable, et hors de
portée d'un utilisateur ou d'un informaticien pressé.

Deux garde-fous complémentaires, côté contrat plutôt que côté code :
- la licence porte le nom du client (affiché dans le panel) : une licence
  recopiée s'annonce elle-même comme appartenant à quelqu'un d'autre ;
- le journal d'activité conserve l'installation de chaque licence
  (`licence_installee`), avec la date et l'administrateur.

---

## Détails techniques

- **Signature** : Ed25519 (`node:crypto`), aucune dépendance ajoutée.
  Elle couvre `ALG1.<charge>` — la charge utile ne peut pas être rejouée
  ailleurs.
- **Charge utile** (JSON, base64url) : `v`, `client`, `debut`, `fin`, `grace`,
  `emis`, éventuellement `install` et `note`. Rien de personnel, rien de secret.
- **Identifiant d'installation** : tiré au sort au premier démarrage, conservé
  dans les réglages (`licence_install_id`). Pas d'empreinte matérielle : une
  machine virtuelle qui migre ne casse rien.
- **Borne haute d'horloge** (`licence_horloge`) : la date la plus avancée
  jamais observée. Un recul de plus de 48 h fait basculer en mode limité ; un
  bond de plus d'un an n'est pas mémorisé, pour qu'une horloge déréglée une
  fois ne condamne pas l'installation.
- **Points d'application** : le worker refuse de dépiler la file
  (`src/worker.js`) et l'API refuse les dépôts (`POST /api/apps/:id/requests`).
  Tout le reste — consultation, suivi, exports, journal — est intact.

## Tests

Deux scénarios couvrent le sujet et sont rejouables :

- vérification du jeton et des contournements : états normaux, date réécrite,
  autre clé, autre installation, horloge reculée, jeton tronqué, refus
  d'installation d'une licence illisible ;
- mode limité de bout en bout : dépôt refusé (403), worker à l'arrêt, demande
  en file laissée intacte, données consultables, puis reprise automatique après
  renouvellement.
