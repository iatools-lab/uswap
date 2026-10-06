# Branchement du frontend Dylane V0

## Principe

Cette branche contient le frontend uSwap et ses données fictives. Le backend de
Danielle reste séparé et constitue la référence des routes, règles d'accès et
formats de données dès que le mode API est activé. Aucun changement backend
n'est requis pour lancer l'interface en mode mock.

Sans `VITE_API_URL`, les écrans utilisent le moteur mock local. Pour lancer le
frontend :

```powershell
cd frontend
npm ci
npm run dev
```

Pour utiliser une API locale, définir par exemple `VITE_API_URL=http://127.0.0.1:3000`
dans `frontend/.env.local`, puis redémarrer Vite. Le client envoie les cookies,
le jeton d'accès et l'en-tête `X-USwap-Client: web` attendus par le backend.

## Parcours déjà alignés sur les routes du backend

| Domaine | Contrat backend utilisé | Adaptation frontend |
|---|---|---|
| Connexion | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` | Le refresh token reste dans le cookie HttpOnly ; le navigateur ne le lit ni ne le transmet dans le corps. L'adresse e-mail est saisie directement, car le backend ne propose pas de liste publique de profils. |
| Espaces par rôle | `GET /workspace` | Une adaptation à la frontière traduit les pointages Prisma (`checkedInAt`, `checkedOutAt`, `isLate`, `isAbsent`) vers les statuts employés par les composants Dylane. |
| Pointage par position (prototype mock) | `POST /attendance` avec `shiftId`, `kind`, `latitude`, `longitude` et `accuracyMeters` | Le mock vérifie l'affectation publiée, la fenêtre du shift, la précision GPS et la distance au rayon configuré de la station. Les coordonnées brutes ne sont pas conservées. En mode API, le bouton indique clairement que l'API n'a pas encore ce contrat et n'envoie pas de position au serveur. |
| Historique | `GET /attendance/history` avec `from`, `to` et `swapperId` facultatifs | Le même format de ligne est utilisé en mode mock et API ; les filtres sont transmis à l'API. |
| Suivi des présences | `GET /attendance/monitor` | Les filtres de station et de période suivent les paramètres backend. |
| Plannings | `GET/POST /plannings`, `GET /plannings/:id`, `POST /:id/preview`, `POST /:id/generate`, validation, publication et opérations sur les occurrences | L'administrateur et le superviseur peuvent créer, modifier, valider et publier un planning, y compris après publication. La génération crée un poste initial par créneau. En mode mock, « Assigner automatiquement » conserve la personne sur un même modèle de shift, vérifie les contraintes et rapproche les heures de l'équipe; le résultat indique les personnes ou postes impossibles à affecter. L'API V5.3.0 expose déjà `POST /plannings/:id/auto-assign`, mais son service rééquilibre les shifts existants par nombre de postes et par station. Il ne garantit pas la stabilité du modèle de shift, l'affectation de toute l'équipe, l'équité en heures ou les mêmes contraintes. Sa réponse (`assigned`, `vacant`, `planning`) diffère aussi du résumé détaillé du mock. Pour ne pas annoncer une équité non garantie, le bouton d'affectation automatique reste réservé au mode mock; l'affectation manuelle reste disponible en mode API. |
| Modèles de shifts | `/stations/:stationId/shift-templates` | L'application d'un même modèle à plusieurs stations crée un modèle par station via la route existante. Si certaines créations échouent, seules les stations restantes sont proposées à une nouvelle tentative. |
| Notifications | `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`, `/notifications/preferences`, `/notifications/push-subscription` | Lecture individuelle et groupée, préférences et cycle d'abonnement push disposent de routes backend. La navigation exacte vers la ressource dépend des données de cible renvoyées par l'API ; les notifications de démonstration incluent des cibles explicites. |
| Stations | `GET/POST /stations`, `PATCH /stations/:id`, activation et désactivation | Les contraintes de repos, d'heures et de couverture sont relues sur la station lors de chaque validation, y compris pour un planning déjà créé. Le rayon `geofenceRadiusMeters` (150 m par défaut) et les coordonnées courantes servent au pointage mock. Les horaires et pauses des postes déjà générés restent ceux du poste. Le contrat backend doit encore exposer et enregistrer le rayon pour activer le pointage géolocalisé hors mode mock. |
| Incidents | `GET/POST /incidents`, `PATCH /incidents/:id` | La V5.3 permet la déclaration par `STATION_CHIEF`, la consultation par chef/superviseur/admin et le traitement par superviseur. L'interface Dylane regroupe les fonctions opérationnelles sous le rôle superviseur ; le rôle et les permissions serveur restent ceux de l'API. |
| Absences et remplacements | Routes disponibles sous `/operations` | La déclaration d'absence transmet `shiftId`, `reason` et `clientRef`. En mode mock, un superviseur peut affecter ponctuellement un swappeur d'une autre station à un poste ou à un remplacement, sans changer son rattachement. Ses congés, chevauchements, repos et heures sont vérifiés ; le shift publié apparaît dans son espace personnel. En mode API, cette opération dépend encore des permissions et des règles du serveur. |
| Corrections de pointage | `/corrections/attachments` et `/corrections/shifts/:shiftId` | Le format du justificatif et les champs de correction suivent les DTO backend. |
| Utilisateurs | Routes `/users`, `/users/page`, `/users/:id`, `/users/:id/status` et `/users/imports` ; création/invitation via `/auth/register` | Les écrans d'administration utilisent les routes serveur correspondantes. Vérifier les permissions avec un compte de chaque rôle. |

## Fonctions encore propres aux mocks

Le backend V5.3.0 consulté ne fournit pas de contrat de pointage sans QR par
géolocalisation. Il conserve `POST /attendance/check-in` et
`POST /attendance/check-out` avec un jeton QR; latitude/longitude sont
facultatives, et la station n'expose pas de rayon de pointage. Les incidents,
le tableau de bord opérationnel, les exports, réglages globaux, rapports
périodiques et préférences/abonnements push ont des routes backend. Le centre
de congés Dylane reste partiellement mocké : l'API a un parcours de demandes
basique sous `/leave-requests`, mais pas toute l'expérience locale (notamment
solde et historique synchronisé). Sans URL API, ces écrans utilisent les
données de démonstration. Avec une URL API, le frontend ne bascule pas
silencieusement vers des fausses données lorsqu'un endpoint manque.

Les fonctions de finition du sprint 5 suivent la même règle : les filtres et
les cibles détaillées de notification, les détails de certains indicateurs et
la séparation des postes vacants passés et futurs sont enrichis par les mocks.
Les endpoints V5.3 couvrent désormais les réglages globaux, la synthèse,
l'export, la programmation des rapports et les préférences push. La disponibilité
effective d'une notification push dépend aussi de la configuration serveur et
des permissions de notification du navigateur.

Le backend V5.3.0 ne persiste pas le nom libre d'un planning. Il expose une
route d'affectation automatique, mais son algorithme ne correspond pas encore
aux règles détaillées du mock. Pour l'activer en mode API, le
service devra traiter le planning de manière cohérente, conserver chaque
swappeur sur un modèle de shift, répartir les heures en tenant compte des
contraintes, et retourner les compteurs attendus par l'interface.

## Vérifications avant une intégration complète

- Comparer les DTO et permissions avec la version backend réellement déployée ;
  ce document décrit le code du tag backend V5.3.0 présent sur `origin/develop`,
  pas une validation de production.
- Pour activer le nouveau pointage en production, Danielle devra ajouter au
  contrat d'affectation la position et le rayon de la station, puis valider
  côté serveur `shiftId`, type d'action et coordonnées (distance et précision)
  avant d'enregistrer le pointage. La validation côté navigateur seule ne
  constitue pas un contrôle de sécurité.
- Le backend V5.3.0 conserve `STATION_CHIEF`. Le frontend normalise ce rôle
  historique vers `SUPERVISOR` dans l'interface; les permissions du jeton et les
  contrôles serveur restent inchangés. Vérifier les droits effectifs avec un
  compte superviseur et un compte chef avant de connecter cette version.
- Le seuil `latenessToleranceMinutes` reste le délai après lequel le mock
  déclare automatiquement une absence en l'absence de prise de service.
- Vérifier côté backend qu'un swappeur affecté ponctuellement ailleurs peut
  consulter son shift publié et ses pointages indépendamment de sa station de
  rattachement, puis que la validation accepte cette affectation après contrôle
  des contraintes.
- Tester au minimum connexion/renouvellement, prise et fin de
  service, historique, création de planning, validation des contraintes et
  publication avec des comptes de test.
- Garder les changements d'interface dans `frontend/` et les contrats/adaptateurs
  frontend dans `frontend/src/api/` ou à la frontière du domaine concerné.
- Ne pas copier un dépôt complet par-dessus l'autre : cela écrase les évolutions
  concurrentes et ne rend pas les contrats compatibles par magie.

Le mode mock reste le moyen de développer sans serveur. Le mode API ne rend
réels que les parcours explicitement raccordés ci-dessus ; les autres domaines
nécessitent un contrat backend avant de pouvoir être intégrés proprement.
