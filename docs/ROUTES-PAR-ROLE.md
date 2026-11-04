# Routes API par espace de travail

_Ce document décrit le comportement **réel** du code après la refonte des routes.
Toute évolution doit soit le respecter, soit mettre ce document à jour._

---

## 1. Convention

| Rôle (`Role`) | Espace | Préfixe d'URL |
|---|---|---|
| `SUPER_ADMIN` | super administrateur | `/superadmin/...` |
| `ADMIN` | pilotage | `/pilot/...` |
| `SUPERVISOR` | supervision | `/supervision/...` |
| `SWAPPER` | agent | `/agent/...` |

- Le segment `superadmin` s'écrit **sans tiret** (côté backend comme côté frontend).
  L'ancien `/super-admin` reste accepté en lecture par le garde, et le contrôleur
  de nettoyage conserve son chemin historique `/super-admin/cleanup`.
- Les routes d'authentification (`/auth/...`) et personnelles
  (`/notifications`, `/workspace`) sont **communes** : elles ne sont pas préfixées.
- Un espace autorise plusieurs rôles (voir §3) : `/pilot/...` est ouvert au
  super administrateur ; `/supervision/...` au super administrateur et à
  l'administrateur ; `/agent/...` à tous les rôles.

### Anciens chemins

Les chemins historiques (`/users`, `/plannings`, `/attendance`, `/stations`,
`/incidents`, `/leaves`, `/operations`, `/reports`, `/admin/settings`,
`/super-admin/cleanup`) restent **enregistrés** pendant la transition, avec les
**mêmes contrôles** : `RoleRouteAccessGuard` applique la règle d'espace à
l'ancien préfixe comme au nouveau (un agent sur `/pilot/users` reçoit 403, un
agent sur `/admin/users` aussi, via `@Roles`). Ils pourront être retirés lorsque
plus aucun client ne les appelle : supprimer le second argument des décorateurs
`*Route(base, legacyBase)`.

---

## 2. Contrôles appliqués (ordre d'exécution)

1. `ThrottlerGuard` — limitation de débit.
2. `RoleRouteAccessGuard` (`src/common/guards/role-route.guard.ts`)** :
   - route `@Public()` → laissée à sa logique propre ;
   - pas de session → `401` ;
   - rôle non autorisé dans l'espace → `403` ;
   - contrôleur non déclaré dans l'espace → `404` (message neutre). Exemple :
     `/agent/admin/settings`.
3. `RolesGuard` (`@Roles(...)`, existant) — précision par méthode, toujours
   appliquée : un agent sur `/agent/attendance` (vue superviseur) reçoit `403`.
4. `ActivityLogInterceptor`, validation (`class-validator`), logique métier.

Le rôle vient **toujours** de la session serveur (`SessionMiddleware`), jamais
d'un en-tête ou d'un champ envoyé par le client.

### Table des contrôleurs par espace

`CONTROLLER_SPACES` (`src/common/routing/role-route.ts`) déclare quels
contrôleurs existent dans quel espace. Un nouveau contrôleur doit y être ajouté,
sinon il n'est simplement pas accessible (échec fermé, jamais une faille).
Les contrôleurs déjà rattachés aux rôles de l'espace sont inclus
automatiquement (un super administrateur trouve aussi les contrôleurs du
pilotage).

---

## 3. Inventaire des routes métier

Légende : *ancien* = chemin historique conservé pour compatibilité.

| Domaine | Contrôleur | Méthodes | Ancien | Pilotage | Supervision | Agent | Rôles par méthode (`@Roles`) |
|---|---|---|---|---|---|---|---|
| Utilisateurs | `UsersController` | GET/POST/PATCH/DELETE | `/users` | `/pilot/users` | `/supervision/users` | `/agent/users` | `@Roles` existants (ADMIN, SUPERVISOR pour la gestion ; lecture selon périmètre) |
| Stations (+ carte) | `StationsController` | GET/POST/PATCH | `/stations` | `/pilot/stations` | `/supervision/stations` | — | écriture ADMIN, lecture ADMIN/SUPERVISOR |
| Modèles de shift | `ShiftTemplatesController` | POST | `/shift-templates` | `/pilot/shift-templates` | `/supervision/shift-templates` | — | ADMIN, SUPERVISOR |
| Planning | `PlanningsController` | GET/PATCH/POST | `/plannings` | `/pilot/plannings` | `/supervision/plannings` | `/agent/plannings` | lecture tous, écriture ADMIN/SUPERVISOR |
| Pointages | `AttendanceController` | GET/POST/PATCH | `/attendance`, `/shifts`, `/corrections`, `/workspace` | — | `/supervision/attendance`… | `/agent/attendance`… | pointage : SWAPPER ; vues supervision : ADMIN/SUPERVISOR ; historique : tous |
| Absences / remplacements | `OperationsController` | GET/POST/PATCH | `/operations` | — | `/supervision/operations` | `/agent/operations` | selon `@Roles` |
| Congés | `LeavesController` | GET/POST/PATCH | `/leaves` | `/pilot/leaves` | `/supervision/leaves` | `/agent/leaves` | agent : ses demandes ; décision : ADMIN/SUPERVISOR |
| Incidents | `IncidentsController` | GET/POST/PATCH | `/incidents` | — | `/supervision/incidents` | `/agent/incidents` | suivi : ADMIN/SUPERVISOR ; déclaration : SWAPPER |
| Rapports | `ReportsController` | GET/POST/PATCH | `/reports` | `/pilot/reports` | `/supervision/reports` | — | tableaux de bord : ADMIN/SUPERVISOR ; rapports programmés : ADMIN |
| Tableau de bord | `DashboardController` | GET | `/dashboard` | `/pilot/dashboard` | `/supervision/dashboard` | `/agent/dashboard` | tous (filtré par périmètre) |
| Réglages globaux, audit, restauration d'accès | `AdminController` | GET/PATCH/POST | `/admin/...` | `/pilot/admin/...` | — | — | ADMIN (`@Roles`) |
| Nettoyage des données | `DataCleanupController` | GET/POST | `/super-admin/cleanup` | — | — | SUPER_ADMIN |

Routes personnelles hors espace : `/auth/*`, `/notifications/*`, `/workspace`.

---

## 4. Connexion par rôle

| Route | Rôle accepté |
|---|---|
| `POST /auth/login/superadmin` | `SUPER_ADMIN` |
| `POST /auth/login/admin` | `ADMIN` |
| `POST /auth/login/supervisor` | `SUPERVISOR` |
| `POST /auth/login/swapper` | `SWAPPER` |
| `POST /auth/login` | tous (repli, clients antérieurs) |

Un compte dont le rôle ne correspond pas à la route reçoit `403` avec un message
neutre (« Ce compte ne peut pas se connecter depuis cette page. »), même si le
mot de passe est correct. Un segment inconnu (`/auth/login/inconnu`) répond
`404`. Les règles existantes sont conservées : verrouillage après échecs
(`429`), compte désactivé (`403`), compte non activé (`403`), renouvellement par
cookie `HttpOnly` (`POST /auth/refresh`), déconnexion (`POST /auth/logout`).

Côté interface, la page de connexion propose un sélecteur « Espace de connexion »
(détection automatique par défaut) : `/auth/login/admin`, `/auth/login/swapper`…
Le choix d'un profil dans le mode démonstration aligne l'espace sur le rôle.

## 5. Création des comptes Superadministrateur

Il n'existe **aucune** page ni route d'inscription publique (l'ancien
`POST /auth/register/superadmin` a été retiré ; il répond `404`).

Le premier super administrateur est créé **au déploiement** par
`npm run bootstrap` (`backend_new/prisma/bootstrap.ts`), qui exige
`SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` (12 caractères minimum) et
éventuellement `SUPERADMIN_FULLNAME`. Le script est idempotent : rejoué, il ne
réécrit pas le mot de passe existant. Voir `deploy/README_DOCKER.md` §bootstrap.

Les super administrateurs suivants sont créés par un super administrateur
authentifié via la gestion des utilisateurs (rôle attribuable uniquement par un
`SUPER_ADMIN`).

---

## 6. Vérifications

```powershell
cd backend_new
npm run build                                        # compilation
npx vitest run --config vitest.config.ts             # tests unitaires
node src/common/routing/routes-replica.mjs http://127.0.0.1:3000   # routage sur serveur démarré

cd frontend_new/frontend
npx tsc --noEmit -p tsconfig.json
npx vitest run
npx vite build
```

Tests dédiés :

| Fichier | Objet |
|---|---|
| `backend_new/src/common/routing/role-route.spec.ts` | table des espaces, fusion des préfixes, garde |
| `backend_new/src/common/routing/route-registration.spec.ts` | contrôleurs réels : ancien chemin + espaces, routes conservées |
| `frontend_new/frontend/src/api/role-routes.spec.ts` | préfixage des appels selon le rôle connecté |
| `frontend_new/frontend/src/api/auth-api.spec.ts` | connexion par espace (maquette locale) |

`node scripts/audit-http-calls.mjs` liste tous les chemins d'API appelés par le
frontend (contrôle de complétude avant une nouvelle évolution).
