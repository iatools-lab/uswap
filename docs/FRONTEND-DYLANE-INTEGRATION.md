# Préparer le branchement du frontend Dylane V0

## Périmètre de la branche

Cette branche est dédiée au frontend : l'application réside dans `frontend/` et
le backend de Danielle n'y est pas embarqué. Le frontend Dylane d'avant le sprint
5 fournit l'interface et les mocks. Les fichiers d'authentification et de
session issus de V0 ont été conservés afin de respecter les conventions déjà
connues côté Danielle.

L'objectif est de pouvoir poursuivre l'interface avec les données fictives, puis
de raccorder le frontend au backend de Danielle sans refaire les pages. Aucune
modification backend n'est prévue ici.

## Mode de développement

Par défaut, ne pas définir `VITE_API_URL` : le client sélectionne les mocks.
L'application se lance ainsi :

```powershell
cd frontend
npm ci
npm run dev
```

Le build de contrôle s'exécute avec `npm run build`. Pour tester contre un backend
local, `VITE_API_URL` peut être défini dans `frontend/.env.local`, mais plusieurs
routes doivent d'abord être vérifiées ou adaptées.

## Contrats connus à valider

Cette liste compare les appels du frontend avec le backend Danielle présent au
moment de la reprise. C'est un repère d'intégration, pas une validation HTTP de
tous les parcours.

| Domaine | Frontend attendu | Backend existant à cette date | Travail côté frontend |
|---|---|---|---|
| Planning | Prévisualisation, validation, affectation automatique, avis, mise à jour et suppression des occurrences | Création, liste, détail, génération et publication | Adapter les écrans aux opérations réellement exposées ou garder ces actions en mock |
| Congés | Espace de travail, solde, création, modification, annulation, reprise de synchronisation | Liste personnelle et création de demande via `/leave-requests` | Ajouter un adaptateur vers les routes existantes et laisser en mock les actions non disponibles |
| Incidents | Déclaration et suivi via `/incidents` | Aucune route incidents repérée | Conserver les parcours fictifs tant qu'un contrat serveur n'existe pas |
| Rapports programmés | Gestion via `/admin/reports/schedules` | Statistiques via `/dashboard/stats`, pas de gestionnaire de rapports planifiés repéré | Garder cette gestion en mock |
| Pointages et remplacements | QR, présence, déclaration d'absence et remplacement | Routes disponibles sous `/attendance` et `/operations` | Vérifier DTO, réponses et permissions avant d'activer les écrans concernés |

Les autres écrans doivent suivre la même règle : isoler l'accès aux données dans
le client ou un service, garder les composants React indépendants du transport,
et documenter les différences de format avant de changer un contrat.

## Règles pour les contributions

- Continuer le travail d'interface dans `frontend/`.
- Garder le mode mock opérationnel et ne pas imposer `VITE_API_URL` aux autres
  développeurs.
- Ne pas ajouter de code backend à cette branche.
- Avant le raccord, comparer les méthodes, routes, données envoyées, réponses et
  permissions avec la branche backend de Danielle.
- Privilégier les commits frontend ciblés ; éviter les copies complètes de dépôt
  qui écrasent ses fichiers ou son historique.

La séparation réduit les conflits de fichiers, sans pouvoir garantir l'absence
totale de conflits si les deux branches font évoluer simultanément le même
contrat d'API.
