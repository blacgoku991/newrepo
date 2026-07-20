# Comment le robot crée les comptes sans API

Les applications métiers (BlueKanGo, NetSoins, ULIS…) n'exposent pas d'API de
création de comptes. La solution est l'**automatisation de navigateur** (aussi
appelée RPA) : le robot pilote un **vrai navigateur Chromium** et fait
exactement ce qu'un humain ferait — ouvrir la page de connexion, taper les
identifiants administrateur, naviguer dans les menus, remplir la fiche
utilisateur champ par champ, cliquer sur « Enregistrer », vérifier le message
de confirmation.

## Playwright ou Selenium ?

Les deux font ce travail. Ce projet utilise **Playwright** (Microsoft), le
successeur moderne de Selenium :

| | Playwright (choisi) | Selenium |
|---|---|---|
| Attentes automatiques | ✔ attend seul qu'un champ soit prêt | à coder à la main (waits explicites) |
| Fiabilité sur apps modernes (iframes, JS) | Excellente | Moyenne, plus fragile |
| Enregistreur de scénario | ✔ `playwright codegen` | Selenium IDE (limité) |
| Captures d'écran / traces intégrées | ✔ | Partiel |

Le principe reste identique : si un jour une application exige Selenium
(navigateur exotique par exemple), seul le fichier `automation.js` de cette
application changerait — le reste de la plateforme est indépendant de l'outil.

## Comment on « récupère les champs » de l'application cible

C'est le cœur de votre question. On ne récupère pas les champs par une API :
on repère, **une seule fois par application**, les **sélecteurs** de chaque
champ de son interface d'administration. Un sélecteur est l'adresse d'un
élément dans la page, par exemple `input[name="email"]` ou `#login-button`.

### Méthode 1 — l'enregistreur Playwright (recommandée)

1. Sur votre poste, lancez l'enregistreur en pointant votre instance :

   ```bash
   npx playwright codegen https://votre-instance.bluekango.com
   ```

2. Un navigateur s'ouvre. **Faites une création de compte à la main** :
   connectez-vous en admin, ouvrez « Nouvel utilisateur », remplissez chaque
   champ, enregistrez.

3. Pendant ce temps, Playwright **génère le code correspondant** dans une
   fenêtre à côté :

   ```js
   await page.goto('https://votre-instance.bluekango.com/login');
   await page.fill('input[name="login"]', 'admin');
   await page.fill('input[name="password"]', '•••');
   await page.click('button[type="submit"]');
   await page.click('text=Administration');
   await page.fill('input[name="lastname"]', 'DUPONT');
   // …
   ```

4. Reportez ces sélecteurs dans `src/apps/<application>/selectors.js`. Le
   scénario (`automation.js`) est déjà écrit : il consomme ces sélecteurs.

### Méthode 2 — l'inspecteur du navigateur

Clic droit sur un champ de l'application → « Inspecter ». Le HTML s'affiche,
par exemple `<input name="email" id="user-email">`. Le sélecteur est alors
`input[name="email"]` (ou `#user-email`).

### Bien choisir ses sélecteurs

- Préférez les attributs **stables** : `name=`, `id=`, `data-*`, ou le texte
  visible (`text=Enregistrer`) — évitez les classes CSS générées
  (`.css-1x2y3z`) qui changent à chaque mise à jour de l'application.
- Si l'application est mise à jour et qu'un sélecteur casse, la demande passe
  en **échec** avec une **capture d'écran de la page au moment de l'erreur**
  (visible dans le tableau de bord) : on voit immédiatement quel champ a bougé,
  on corrige `selectors.js`, puis on clique « Relancer ».

## Le déroulé exact d'une création (mode production)

```
1. Chromium headless démarre (invisible, sur le serveur)
2. page.goto(BLUEKANGO_URL)                      → page de connexion
3. page.fill(login), page.fill(password), click  → connexion ADMIN
4. attente d'un élément prouvant la connexion    → sécurité anti-faux-positif
5. navigation vers « Nouvel utilisateur »
6. saisie de chaque champ depuis la demande      → données du formulaire web
7. click « Enregistrer »
8. attente du message de confirmation            → preuve du succès
9. capture d'écran finale                        → archivée avec la demande
```

Chaque étape est journalisée et visible dans le tableau de bord
(« Journal du robot »). En cas d'échec à n'importe quelle étape : capture
d'écran de l'état exact de la page + message d'erreur précis + bouton
« Relancer ».

## Le mode démonstration intégré

Tant que vous n'avez pas branché les vraies applications, le portail tourne en
mode **démo** : il embarque une **console d'administration factice** par
application (`/demo/bluekango`, `/demo/netsoins`, `/demo/ulis` — identifiants
`admin` / `demo123`). Le robot y fait une **vraie** automatisation de bout en
bout : vrai navigateur, vraie connexion, vraie saisie, vraie création
enregistrée en base, vraies captures d'écran.

C'est le même moteur qu'en production — seule la cible change. Vous pouvez
vous connecter vous-même à la console démo pour voir les comptes que le robot
a créés.

## Passer une application en production — checklist

1. `cp .env.example .env`, puis renseigner pour l'application :
   `BLUEKANGO_URL`, `BLUEKANGO_ADMIN_USER`, `BLUEKANGO_ADMIN_PASSWORD`
   (idem NetSoins / ULIS).
2. Mettre `AUTOMATION_MODE=production`.
3. Calibrer `src/apps/<application>/selectors.js` avec `npx playwright codegen`
   (voir ci-dessus).
4. Tester avec une demande fictive et vérifier le compte créé + la capture.
5. Si une application manque de variables, elle **retombe automatiquement en
   mode démo** — jamais d'appel à moitié configuré vers la production.

## Questions fréquentes

**Et si l'application a une double authentification (2FA/SSO) ?**
Utilisez un compte de service dédié au robot, exempté de 2FA ou restreint par
adresse IP (celle du serveur du portail). Alternative : Playwright sait
réutiliser une session déjà ouverte (`storageState`) que vous initialisez
manuellement de temps en temps.

**Le mot de passe admin est-il exposé ?**
Il ne transite jamais par le navigateur de l'utilisateur ni par la base de
données : il vit uniquement dans les variables d'environnement du serveur
(`.env`, exclu du dépôt git). En production, utilisez un coffre de secrets.

**Que se passe-t-il si deux demandes arrivent en même temps ?**
Elles sont mises en file et traitées une par une, dans l'ordre d'arrivée —
pas de collision possible sur l'application cible.

**Combien de temps prend une création ?**
Quelques dizaines de secondes par compte, selon la lenteur de l'application
cible. Le délai maximal par demande est configurable (`WORKER_TIMEOUT_MS`).
