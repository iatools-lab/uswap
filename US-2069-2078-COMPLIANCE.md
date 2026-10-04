# uSwap 5.3 — conformité User Stories 2069–2078

## 2069 — Reporting opérationnel
- Dashboard backend `/reports/dashboard` avec période, station et swappeur.
- Compteurs couverture, assiduité, absences, retards, mouvements et heures.
- Mouvements issus de `ShiftChange` (permutation/réaffectation/remplacement).
- Vacances distinguées des postes couverts.
- Congés approuvés et état de synchronisation externe exposés.
- Frontend `OperationsDashboard` affiche KPI, détails et filtres.

## 2070 — Heures
- Calcul basé sur `startTime/endTime` des shifts publiés et affectés.
- Détail par swappeur, station, semaine et mois.
- Les shifts non publiés ne sont pas inclus.
- Un poste vacant n'est jamais compté dans les heures d'un swappeur.

## 2071 — Supervision
- Les périmètres de station sont calculés côté backend par rôle/scopes.
- Le superviseur ne reçoit que les stations autorisées par `stationId`/`stationScopes`.
- Le dashboard journalier et opérationnel respecte ce périmètre.
- Les actions de correction et de planification sont protégées par rôles côté backend et frontend.

## 2072 — Export
- `/reports/export` accepte exactement les filtres période/station/swappeur et le format CSV/XLSX.
- L'export est généré côté serveur avec uniquement les données opérationnelles nécessaires.
- Aucun email/téléphone de swappeur n'est exporté.
- Chaque export est enregistré dans `ReportExportAudit` avec auteur, date, période, scope, filtres et sections.

## 2073 — Rapports périodiques
- Programmation admin : quotidien/hebdomadaire/mensuel.
- Périmètre réseau ou station.
- Destinataires validés et sections configurables.
- Aperçu avant création.
- Historique des exécutions (`ScheduledReportRun`) : processing/sent/failed.
- Scheduler NestJS toutes les 5 minutes.
- Génération CSV ou XLSX et envoi SMTP.
- Historique visible depuis le frontend admin.

## 2074 — PWA
- Manifest/service worker existants.
- Installation proposée lorsque le navigateur expose `beforeinstallprompt`.
- Mise à jour du service worker contrôlée depuis `PwaStatus`.

## 2075 — Planning offline
- Cache local du planning du swappeur courant uniquement.
- Cache du détail du planning courant.
- Affichage de la dernière synchronisation.
- Repli automatique sur le cache si le backend est indisponible.
- Nettoyage du cache et de la file locale à la déconnexion.

## 2076 — Absence offline
- Déclaration hors connexion stockée dans IndexedDB.
- `clientRef` unique pour éviter les doublons lors de la reconnexion.
- Justificatif conservé dans la mutation locale jusqu'à synchronisation.
- File d'attente visible et annulation possible avant synchronisation.
- Aucune opération QR n'est effectuée hors connexion.

## 2077 — Auto-sync
- Synchronisation au retour du réseau et périodiquement.
- Retry exponentiel pour les erreurs réseau/serveur.
- Suppression de la mutation après confirmation serveur.
- Les erreurs métier 4xx définitives sont retirées de la file.
- Réponse serveur avec timestamp `syncedAt` pour les absences et conservation locale du dernier couple de timestamps.

## 2078 — Push
- Demande explicite de permission navigateur uniquement lors de l'activation.
- Refus du navigateur n'empêche pas l'utilisation de la PWA.
- Subscription liée au compte authentifié et révocable depuis l'appareil.
- Les subscriptions mortes (404/410) sont supprimées côté serveur.
- Le clic d'une notification ouvre uniquement le lien fourni par le backend.
- Les préférences push sont respectées côté serveur.

## Validation technique de la livraison
- Les fichiers TypeScript/TSX modifiés ont été parsés/transpilés sans erreur de syntaxe.
- Le build complet n'a pas pu être exécuté dans l'environnement de préparation car les binaires npm du projet ne sont pas disponibles et l'accès au registre n'est pas garanti.
- Après extraction, exécuter `npm install`, `npm run db:generate`, `npm run db:migrate` puis `npm run build`, et `cd frontend && npm install && npm run build`.
