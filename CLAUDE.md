# Portail Comptes — ADEF Résidences

Portail interne de création automatisée de comptes sur les applications métiers
(BlueKanGo, NetSoins, ULIS…) : formulaire par application → robot Playwright →
compte créé + e-mail d'identifiants. Panel admin complet (stats, éditeurs de
formulaires et de scénarios, journal). Voir `SECURITY.md` pour la sécurité et
`docs/API.md` pour l'API.

## Règles de travail (à appliquer sur TOUTE demande)

### Design / frontend — utiliser les skills design
Pour toute création ou modification d'interface (page, composant, styles,
couleurs, typo, graphique), consulter d'abord le skill **ui-ux-pro-max**
(recherche de styles/palettes/typo adaptés) et, selon le besoin, **design**,
**design-system** ou **ui-styling**. Contraintes du projet : design d'entreprise
sobre et crédible (thème clair, accent `#2f5fda`, police Inter), pas de rendu
« généré par IA » (pas de néon, pas de dégradés criards).

### Sécurité — utiliser les skills Trail of Bits
Pour toute modification de code backend ou frontend, appliquer une relecture
sécurité avec les skills installés : **differential-review** (revue du diff
avant commit), **insecure-defaults** et **sharp-edges** (nouvelles configs/API),
**supply-chain-risk-auditor** (nouvelle dépendance npm), **semgrep** /
**variant-analysis** (audits ponctuels). Maintenir les acquis : CSP stricte
sans script inline, rate limiting, anti-CSRF, requêtes SQL paramétrées,
`escapeHtml()` sur tout contenu dynamique, secrets uniquement en `.env`,
mots de passe jamais stockés ni journalisés.

### Invariants du projet (ne pas casser)
- Porte SSO Microsoft 365 « fermé par défaut » (`src/server.js`) : toute
  nouvelle route est protégée automatiquement — ne pas ajouter d'exception
  sans raison forte.
- Scénario BlueKanGo calibré sur l'instance réelle (frames `<frame>`,
  duplication d'utilisateur, tri fonctions, étape validité avant Valider).
- Identifiants uniques : `pickUniqueLogin` (1re lettre prénom + nom, puis
  lettres supplémentaires du prénom en cas de collision).
- Statuts de demande : `en_attente | en_cours | terminee | echec`.
- Champs `robotFields` non masquables ; mode démo fonctionnel sans `.env`.
- Push : branche `claude/account-creation-platform-6xubq7` sur `origin`,
  et `main` sur `hub` + `hub2`.

## Commandes
- `npm start` — serveur + worker (http://localhost:3000, admin : /admin)
- Tests robot en local : `AUTOMATION_MODE=demo` (console `/demo/<app>`,
  admin/demo123) ; `CHROMIUM_PATH` si Chromium préinstallé.
