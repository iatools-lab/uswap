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
| Pointage QR | `POST /attendance/qr`, `POST /attendance` | Le chef génère un QR par shift. Le swappeur transmet uniquement le `shiftId` et le jeton ; le backend déduit le type de pointage et la station du jeton. `ON_TIME` est traduit en statut d'interface « à l'heure ». |
| Historique | `GET /attendance/history` avec `from`, `to` et `swapperId` facultatifs | Le même format de ligne est utilisé en mode mock et API ; les filtres sont transmis à l'API. |
| Suivi des présences | `GET /attendance/monitor` | Les filtres de station et de période suivent les paramètres backend. |
| Plannings | `GET/POST /plannings`, `GET /plannings/:id`, `POST /:id/preview`, `POST /:id/generate`, validation, publication et opérations sur les occurrences | La création transmet seulement les dates acceptées par le DTO backend. La génération automatique côté frontend équilibre les affectations et appelle la validation puis l'affectation serveur pour chaque poste. Le nom saisi n'est pas enregistré par le backend actuel, dont le modèle ne contient pas ce champ. |
| Modèles de shifts | `/stations/:stationId/shift-templates` | L'application d'un même modèle à plusieurs stations crée un modèle par station via la route existante. Si certaines créations échouent, seules les stations restantes sont proposées à une nouvelle tentative. |
| Notifications | `GET /notifications`, `PATCH /notifications/:id/read` | « Tout marquer comme lu » utilise les lectures individuelles, car le backend ne fournit pas de route groupée. |
| Stations | `GET/POST /stations`, `PATCH /stations/:id`, activation et désactivation | Les champs reconnus par le DTO sont envoyés au backend. Les réglages propres aux mocks, comme l'activation facultative du repos minimum ou le blocage de publication, ne sont pas transmis au serveur. |
| Absences et remplacements | Routes disponibles sous `/operations` | La déclaration d'absence transmet `shiftId`, `reason` et `clientRef`. Les parcours de remplacement utilisent les routes existantes ; les rôles autorisés restent ceux du serveur. |
| Corrections de pointage | `/corrections/attachments` et `/corrections/shifts/:shiftId` | Le format du justificatif et les champs de correction suivent les DTO backend. |
| Utilisateurs | Routes `/users`, `/users/page`, `/users/:id`, `/users/:id/status` et `/users/imports` ; création/invitation via `/auth/register` | Les écrans d'administration utilisent les routes serveur correspondantes. Vérifier les permissions avec un compte de chaque rôle. |

## Fonctions encore propres aux mocks

Le backend local consulté ne fournit pas de contrats pour les incidents, les
rapports programmés, les statistiques de tableau de bord, le centre de congés
complet (solde, modification, annulation et synchronisation) ni les préférences
de notification. Sans URL API, ces écrans utilisent les données de démonstration.
Avec une URL API, leurs appels non pris en charge ne sont pas persistés et peuvent
retourner une erreur : le frontend ne bascule pas silencieusement vers de fausses
données alors qu'un serveur est configuré. Le backend expose un dépôt et une
création de congé basiques sous `/leave-requests`, mais ceux-ci ne couvrent pas
encore l'interface de congés Dylane.

Le backend ne persiste pas non plus le nom libre d'un planning et ne dispose pas
d'une route d'affectation automatique dédiée. Le frontend compose cette dernière
fonction à partir des routes de validation et d'affectation déjà exposées ; cela
ne remplace pas un futur contrat métier serveur si Danielle décide de centraliser
cette règle.

## Vérifications avant une intégration complète

- Comparer les DTO et permissions avec la version backend réellement déployée ;
  ce document décrit le code backend local consulté, pas une validation de
  production.
- Tester au minimum connexion/renouvellement, génération QR, prise et fin de
  service, historique, création de planning, validation des contraintes et
  publication avec des comptes de test.
- Garder les changements d'interface dans `frontend/` et les contrats/adaptateurs
  frontend dans `frontend/src/api/` ou à la frontière du domaine concerné.
- Ne pas copier un dépôt complet par-dessus l'autre : cela écrase les évolutions
  concurrentes et ne rend pas les contrats compatibles par magie.

Le mode mock reste le moyen de développer sans serveur. Le mode API ne rend
réels que les parcours explicitement raccordés ci-dessus ; les autres domaines
nécessitent un contrat backend avant de pouvoir être intégrés proprement.
