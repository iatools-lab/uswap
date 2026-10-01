# uSwap — Frontend

Cette branche contient l’application web et PWA de uSwap. Elle conserve les
parcours fictifs pour les démonstrations et reste préparée au raccordement avec
le backend maintenu séparément par Danielle. Aucun code backend n’est inclus ni
modifié ici.

## Démarrer l’application

```powershell
cd frontend
npm ci
npm run dev
```

Sans `VITE_API_URL`, l’application utilise les jeux de données de démonstration.
Pour lancer les parcours pris en charge par une API locale, créez
`frontend/.env.local`, renseignez `VITE_API_URL`, puis redémarrez Vite. Le guide
[`docs/FRONTEND-DYLANE-INTEGRATION.md`](docs/FRONTEND-DYLANE-INTEGRATION.md)
présente les routes compatibles et les contrats encore attendus.

La vérification de production se lance depuis `frontend/` :

```powershell
npm run build
```

## Périmètre livré — sprints 1 à 5

- **Sprint 1 — Accès et profils** : connexion, session, espaces selon les rôles
  et gestion des comptes.
- **Sprint 2 — Stations et planification** : configuration des stations et des
  shifts, création, génération, affectation et publication des plannings.
- **Sprint 3 — Exécution terrain** : pointage par QR, suivi des présences,
  absences, remplacements et interfaces adaptées aux petits écrans.
- **Sprint 4 — Exceptions et pilotage** : demandes de congé, incidents liés aux
  swappeurs, notifications, tableaux de bord et premières fonctions hors
  connexion.
- **Sprint 5 — Finition du pilotage** : filtres et navigation des notifications,
  indicateurs ouvrant leurs détails, séparation des postes vacants passés et
  futurs, tableau de bord superviseur consolidé, réglages globaux de
  démonstration et notification de mise à jour de la PWA.

Les parcours d’interface du sprint 5 sont utilisables avec les données
fictives. Les réglages globaux et les rapports programmés n’ont pas encore de
contrat backend ; les notifications push à distance et certaines opérations
hors connexion demandent également des services serveur. La compilation valide
le frontend, pas ces intégrations. Le guide d’intégration distingue les routes
déjà prises en charge des contrats en attente.

## Versionnage

Une livraison frontend utilise un tag annoté par sprint, par exemple
`uswap-frontend-s4.1.0` ou `uswap-frontend-s5.1.0` : `s4` ou `s5` identifie le
sprint, `1` la version de livraison et le dernier chiffre les correctifs
(`uswap-frontend-s5.1.1`). Chaque version stable est accompagnée d’une Release
GitHub qui décrit les parcours livrés, les vérifications et les intégrations
encore nécessaires.

## Organisation

L’application et ses dépendances sont dans [`frontend/`](frontend/). Les notes
de compatibilité API sont dans [`docs/`](docs/). Les URL locales et secrets
restent dans `.env.local` et ne doivent pas être ajoutés au dépôt.
