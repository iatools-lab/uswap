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

## Périmètre livré — sprints 1 à 4

- **Sprint 1 — Accès et profils** : connexion, session, espaces selon les rôles
  et gestion des comptes.
- **Sprint 2 — Stations et planification** : configuration des stations et des
  shifts, création, génération, affectation et publication des plannings.
- **Sprint 3 — Exécution terrain** : pointage par QR, suivi des présences,
  absences, remplacements et interfaces adaptées aux petits écrans.
- **Sprint 4 — Exceptions et pilotage** : demandes de congé, incidents liés aux
  swappeurs, notifications, tableaux de bord et premières fonctions hors
  connexion.

Les parcours sont utilisables avec les données fictives. La compilation vérifie
le frontend ; elle ne valide pas les services externes. Les limites de connexion
au backend sont détaillées dans le guide d’intégration.

## Versionnage

Une livraison frontend utilise un tag annoté `uswap-frontend-s4.1.0` : `s4`
identifie le sprint, `1` la version de livraison et le dernier chiffre les
correctifs (`uswap-frontend-s4.1.1`). Chaque version stable est accompagnée
d’une Release GitHub qui décrit les parcours livrés, les vérifications et les
intégrations encore nécessaires.

## Organisation

L’application et ses dépendances sont dans [`frontend/`](frontend/). Les notes
de compatibilité API sont dans [`docs/`](docs/). Les URL locales et secrets
restent dans `.env.local` et ne doivent pas être ajoutés au dépôt.
