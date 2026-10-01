# uSwap — Fonctionnement du projet, sprint 1 à sprint 5

Ce document décrit **ce que fait le produit**, **ce qui a été livré à chaque
sprint**, et **le rôle de chaque API** du backend. Il s'adresse à toute personne
qui reprend le code : développeur, relecteur ou nouvel arrivant.

- **Version documentée** : `uswap-v5.2.0` (sprint 5 intégré)
- **Backend** : NestJS 11 + Prisma 6 + PostgreSQL
- **Frontend** : React 19 + Vite + TypeScript
- **Rôles applicatifs** : `ADMIN`, `SUPERVISOR`, `STATION_CHIEF`, `SWAPPER`

---

## 1. Le produit en une page

uSwap planifie et suit les équipes de *swapping* réparties sur plusieurs
stations. Le cycle de vie d'une journée de travail est le suivant :

```
Planning (brouillon)  ->  Génération des créneaux  ->  Publication
      ->  Le swappeur pointe (QR)  ->  Le chef suit les présences
      ->  Une absence ouvre une demande de remplacement
      ->  Le superviseur arbitre, les rapports agrègent le tout
```

Autour de ce flux gravitent : les **congés** (avec synchronisation vers un
système RH externe), les **incidents**, les **notifications**, les **réglages
globaux** et l'**administration des comptes**.

### Modèle de données en un coup d'œil

| Entité | Rôle |
|---|---|
| `User` | Compte, rôle, station de rattachement |
| `Station` | Site d'exploitation, paramètres de pointage et de repos |
| `ShiftTemplate` / `ShiftTemplateVersion` | Modèles de créneaux horaires + historique |
| `Planning` / `PlanningStation` | Fenêtre de planification et stations couvertes |
| `Shift` | Créneau affecté à un swapper sur une station |
| `Attendance` / `AttendanceQr` | Pointage et jetons QR de prise/fin de service |
| `LeaveRequest` / `LeaveBalance` / `LeaveSyncOperation` | Congés, soldes, synchronisation |
| `ReplacementRequest` / `ShiftChange` | Remplacements et journal des mouvements |
| `Incident` / `IncidentAction` | Incidents et leur traçabilité |
| `Notification` / `NotificationPreference` | Notifications et préférences |
| `GlobalSetting` / `GlobalSettingRevision` | Réglages réseau et historique |
| `ScheduledReport` | Rapports récurrents |
| `UserAuditLog` | Journal des modifications de comptes |

---

## 2. Sprint par sprint

### Sprint 1 — Socle : comptes, authentification, stations

**Objectif** : disposer d'une base fiable pour authentifier et structurer
l'organisation.

**Livré**
- Authentification JWT (access token court + refresh token rotatif).
- Cycle d'invitation : un compte est créé **inactif**, l'utilisateur reçoit un
  lien, choisit son mot de passe, le compte devient actif.
- Réinitialisation de mot de passe par jeton à durée limitée.
- Gestion des rôles et du périmètre par station.
- CRUD des stations avec leurs paramètres (tolérance de retard, repos minimal,
  limite hebdomadaire, temps de vie des QR).
- Modèles de créneaux (`ShiftTemplate`) rattachés à une station.

**APIs**

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/auth/login` | Authentifie, renvoie la session et pose le cookie de refresh |
| POST | `/auth/refresh` | Renouvelle la session à partir du cookie HttpOnly |
| POST | `/auth/logout` | Révoque les jetons et efface le cookie |
| GET | `/auth/me` | Profil de l'utilisateur connecté (utilisé par le chien de garde de session) |
| GET | `/auth/session` | Temps restant avant expiration du jeton d'accès |
| POST | `/auth/register` | Crée un compte (administrateur) |
| POST | `/auth/activate-account` (alias `/auth/activate`) | Active un compte invité et définit le mot de passe |
| POST | `/auth/forgot-password` | Déclenche l'envoi d'un lien de réinitialisation |
| POST | `/auth/reset-password` | Applique le nouveau mot de passe |
| POST | `/auth/invitations/:id/resend` | Renvoie une invitation |
| GET | `/users` | Liste paginée des comptes (ou tableau simple si `page`/`limit` sont omis) |
| GET | `/users/:id` | Fiche d'un compte |
| PATCH | `/users/:id` | Modifie un compte (traçé dans `UserAuditLog`) |
| PATCH | `/users/:id/status` | Active ou désactive un compte |
| PATCH | `/users/:id/deactivate` / `/reactivate` | Variantes explicites |
| POST | `/users/:id/activate` | Renvoie l'invitation d'un compte en attente |
| GET | `/users/profiles` | Annuaire public des comptes actifs (écran de connexion) |
| GET | `/stations` | Liste des stations |
| GET | `/stations/:id` | Détail d'une station |
| POST | `/stations` | Crée une station |
| PATCH | `/stations/:id` | Modifie une station |
| PATCH | `/stations/:id/active` / `/status` / `/activate` / `/deactivate` | Cycle de vie |
| GET | `/stations/:id/shift-templates` | Modèles de créneaux d'une station |
| POST | `/stations/:id/shift-templates` | Crée un modèle |
| PATCH | `/stations/:id/shift-templates/:templateId` | Modifie un modèle |
| GET | `/stations/:id/shift-templates/:templateId/history` | Historique des versions |

---

### Sprint 2 — Planification et publication

**Objectif** : produire un planning de créneaux et le rendre visible aux équipes.

**Livré**
- Création d'un planning sur une fenêtre de dates.
- Génération automatique des créneaux à partir des modèles, jour par jour,
  en respectant les contraintes de la station.
- Publication du planning : les swappers reçoivent une notification et
  retrouvent leurs créneaux dans leur espace.
- Boîte de réception des publications, avec suivi de lecture.

**APIs**

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/plannings` | Crée un planning (brouillon) |
| GET | `/plannings` | Liste des plannings |
| GET | `/plannings/:id` | Détail, avec les créneaux exposés sous `occurrences` + `revision` |
| POST | `/plannings/:id/generate` | Génère les créneaux à partir des modèles |
| PATCH | `/plannings/:id/publish` | Publie et notifie les équipes |
| GET | `/plannings/notices` | Publications non lues de l'utilisateur |
| PATCH | `/plannings/notices/:id/read` | Marque une publication comme lue |
| POST | `/shifts/validate` | Contrôle de contraintes avant affectation |
| GET | `/workspace` | Espace personnel : créneaux à venir de l'appelant |

---

### Sprint 3 — Pointage et suivi des présences

**Objectif** : tracer l'arrivée et le départ, détecter retards et absences.

**Livré**
- Génération de QR par le chef de station (`CHECKIN` / `CHECKOUT`), avec
  fenêtre de validité et temps de vie paramétrés par station.
- Pointage par le swapper, calcul automatique du retard selon la tolérance.
- Détection automatique des absences en fin de créneau, qui ouvre une demande
  de remplacement.
- Correction de pointage par un superviseur, avec motif et pièce justificative.
- Historique personnel des pointages.

**APIs**

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/attendance/qr` | Génère un QR de pointage pour un créneau |
| POST | `/attendance` | Enregistre le pointage à partir du jeton QR |
| GET | `/attendance/history` | Historique de pointage du swapper connecté |
| GET | `/attendance/monitor` | Tableau de suivi du jour (superviseur, chef de station) |
| GET | `/attendance/:id` | Détail d'un pointage |
| PATCH | `/attendance/:id/correct` | Correction par un superviseur |
| GET | `/corrections/shifts/:id` | Corrections d'un créneau |
| POST | `/corrections/attachments` | Pièce justificative d'une correction |

---

### Sprint 4 — Congés, remplacements et incidents

**Objectif** : gérer les absences planifiées, couvrir les postes découverts et
tracer les incidents d'exploitation.

**Livré**
- Espace congés du swapper : solde, demandes, édition, annulation.
- **Idempotence** : chaque écriture porte une clé de synchronisation ; rejouer
  une requête hors ligne ne crée jamais de doublon.
- Synchronisation vers un système RH externe, avec statut visible
  (`SYNCED`, `QUEUED`, `FAILED`) et possibilité de relancer.
- Demandes de remplacement : ouverture, candidats, affectation, résolution.
- Journal des mouvements d'affectation (`ShiftChange`).
- **Incidents** : déclaration par le chef de station, qualification et
  résolution par le superviseur, avec un état strictement contrôlé côté serveur.

**APIs**

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/leaves/workspace` | Solde + demandes + état d'intégration du swapper |
| POST | `/leaves` | Crée une demande (idempotente via `idempotencyKey`) |
| PATCH | `/leaves/:id` | Modifie une demande encore en attente |
| POST | `/leaves/:id/cancel` | Annule une demande en attente |
| POST | `/leaves/sync/:operationId/retry` | Relance une synchronisation échouée |
| GET | `/leave-requests/mine` | Alias historique de l'espace congés |
| GET | `/operations/changes` | Journal des mouvements d'affectation |
| GET | `/operations/replacements/pending` | Remplacements en attente |
| GET | `/operations/shifts/:id/candidates` | Candidats pour un créneau |
| POST | `/operations/absences` | Déclare une absence |
| POST | `/operations/shifts/:id/replacement` | Affecte un remplaçant |
| GET | `/incidents` | Liste + indicateurs (incidents ouverts, critiques, délai moyen) |
| POST | `/incidents` | Déclare un incident (chef de station) |
| PATCH | `/incidents/:id` | Fait évoluer un incident (superviseur) |

> **Machine à états des incidents** (imposée côté serveur) :
> `REPORTED → TO_REVIEW → ACKNOWLEDGED → IN_PROGRESS → RESOLVED → CLOSED`.
> Toute transition non autorisée est rejetée en `409`.

---

### Sprint 5 — Pilotage, rapports et administration

**Objectif** : donner aux responsables une vision consolidée et les moyens
d'administrer la plateforme.

**Livré**
- **Écran de planification avancé** : prévisualisation d'une génération,
  affectation automatique équilibrée, édition d'un créneau, duplication,
  validation des contraintes, validation globale puis publication.
- **Tableau de bord opérationnel** : couverture, taux de présence, retards,
  absences, heures par swapper, mouvements, postes vacants.
- **Réglages globaux** du réseau, avec numéro de révision et historique.
- **Rapports programmés** (quotidien, hebdomadaire, mensuel).
- **Préférences de notification** par utilisateur (in-app, e-mail, push, digest,
  plage de silence, rétention).
- **Suivi d'intégration** de la synchronisation des congés.
- **Export Excel** des utilisateurs.
- **Import** d'utilisateurs en deux temps : aperçu puis confirmation.

**APIs**

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/plannings/:id/preview` | Simulation : créneaux qui seraient créés, doublons, hors période |
| PATCH | `/plannings/:id/validate` | Contrôle global avant publication (erreurs + avertissements) |
| POST | `/plannings/:id/auto-assign` | Rééquilibre les affectations entre swappers |
| POST | `/plannings/:id/occurrences/:occurrenceId/validate` | Contraintes pour un candidat donné |
| PATCH | `/plannings/:id/occurrences/:occurrenceId` | Réaffecte ou échange un créneau |
| POST | `/plannings/:id/occurrences/:occurrenceId/duplicate` | Duplique un créneau |
| PATCH | `/plannings/:id/occurrences/:occurrenceId/remove` | Retire un créneau |
| GET | `/reports/dashboard` | Tableau de bord opérationnel sur une période |
| GET | `/dashboard/stats` | Indicateurs de la page d'accueil |
| GET | `/admin/settings` | Réglages globaux + historique des révisions |
| PATCH | `/admin/settings` | Met à jour les réglages (incrémente la révision) |
| GET | `/admin/reports/schedules` | Rapports programmés |
| POST | `/admin/reports/schedules` | Programme un rapport |
| PATCH | `/admin/reports/schedules/:id` | Active ou suspend un rapport |
| GET | `/admin/integrations/leaves` | État de la synchronisation des congés |
| GET | `/users/export` | Données d'export Excel des comptes |
| GET | `/users/import/template` (alias `/users/imports/template`) | Modèle CSV d'import |
| POST | `/users/import/preview` (alias `/users/imports/preview`) | Analyse du fichier |
| POST | `/users/import/confirm` (alias `/users/imports/:id/confirm`) | Confirme l'import |
| GET | `/notifications` | Notifications de l'utilisateur |
| GET | `/notifications/unread-count` | Compteur de non-lues |
| PATCH | `/notifications/:id/read` | Marque une notification comme lue |
| PATCH | `/notifications/read-all` | Marque tout comme lu |
| GET | `/notifications/preferences` | Préférences de notification |
| PATCH | `/notifications/preferences` | Met à jour les préférences |

---

## 3. Sécurité et permissions

Chaque route est protégée par `JwtAuthGuard` et, quand le rôle compte, par
`RolesGuard`. Les contrôles appliqués :

| Contrôle | Mise en œuvre |
|---|---|
| Identité | Jeton JWT signé, durée de vie courte |
| Session | Refresh token à usage unique, tourné à chaque renouvellement, conservé dans un cookie **HttpOnly** |
| Cloisonnement | Un chef de station ne voit que sa station ; un swapper ne voit que ses données |
| Transitions métier | Machine à états des incidents validée côté serveur, pas côté client |
| Validation d'entrée | `ValidationPipe` globale en `whitelist` + `forbidNonWhitelisted` |
| Traçabilité | `UserAuditLog` pour les comptes, `IncidentAction` pour les incidents, `GlobalSettingRevision` pour les réglages |

---

## 4. Configuration requise

### Backend (`.env`)

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/uswap"
JWT_SECRET="une-chaine-longue-et-secrete"
ACCESS_TOKEN_TTL_SECONDS=900
PORT=3000
CORS_ORIGIN="http://127.0.0.1:5173,http://localhost:5173"
FRONTEND_URL="http://127.0.0.1:5173"

# E-mails (optionnel). Sans RESEND_API_KEY, aucun e-mail ne part : l'API
# renvoie alors `activationUrl` pour que l'administrateur transmette le lien.
RESEND_API_KEY=""
MAIL_FROM="Uswap <onboarding@resend.dev>"

# Intégration RH externe des congés (optionnel).
LEAVE_API_URL=""
```

### Frontend (`frontend/.env`)

```bash
# Frontend et API sur une origine unique : indispensable au cookie de session.
VITE_API_URL=/api
```

> Le proxy Vite (`frontend/vite.config.ts`) redirige `/api` vers
> `http://localhost:3000`. Sans ce proxy, le cookie `SameSite=Lax` n'est pas
> transmis sur une requête cross-site et la session est perdue à chaque
> renouvellement de jeton.

---

## 5. Démarrage

```bash
# 1. Backend
npm install
npx prisma migrate deploy
npx prisma generate
npm run seed            # jeu de démonstration
npm run start:dev       # http://localhost:3000  (Swagger : /api-docs)

# 2. Frontend
cd frontend
npm install
npm run dev             # http://127.0.0.1:5173
```

### Comptes de démonstration

Le mot de passe est commun : `Uswap2026!Demo` (surchargeable via
`DEMO_PASSWORD` avant le seed).

| Rôle | E-mail |
|---|---|
| Administrateur | `admin@upowa.org` |
| Superviseur | `superviseur@upowa.org` |
| Chef de station | `chef@upowa.org` |
| Swappeur | voir `npm run seed`, ou tout compte `SWAPPER` actif |

> Les comptes swappers du seed sont créés **inactifs** (invitation). Pour en
> activer un sans service e-mail :
> `node scripts/activate-user.cjs <email> [motDePasse]`

---

## 6. Vérifications

| Commande | Ce qu'elle contrôle |
|---|---|
| `npx tsc --noEmit -p tsconfig.build.json` | Typage du backend |
| `npm run build` | Compilation du backend |
| `cd frontend && npm run build` | Typage et build du frontend |
| `npx jest` | Tests unitaires du backend |
| `node scripts/audit-contract.cjs` | Chaque appel du frontend a bien une route serveur |
| `node scripts/test-e2e.mjs` | 70 vérifications fonctionnelles sur les 10 domaines du sprint 5 |

---

## 7. Dépannage

**Un compte créé ne reçoit aucun e-mail.**
`RESEND_API_KEY` n'est pas configurée. Le compte existe en base, inactif. Depuis
la version 5.2, la réponse de création contient `activationUrl` : transmettez ce
lien à l'utilisateur. Vous pouvez aussi activer le compte directement :
`node scripts/activate-user.cjs <email> [motDePasse]`.

**Le mot de passe est refusé alors que je viens de le définir.**
Utilisez l'une des deux adresses complètes (`localhost` **ou** `127.0.0.1`) de
façon constante : ce sont deux origines distinctes pour le navigateur, donc deux
stockages de session distincts.

**L'API répond mais toutes les requêtes échouent en CORS.**
`CORS_ORIGIN` doit contenir l'origine exacte du frontend, schéma et port
compris, et le serveur doit être redémarré après modification.

**La session se perd à chaque changement de page.**
Vérifiez que `VITE_API_URL` vaut bien `/api` et que le proxy Vite est actif.

**Un compte est introuvable dans `GET /users`.**
La route renvoie un tableau lorsqu'aucune pagination n'est demandée, et un
objet `{ data, total, page, ... }` lorsqu'elle l'est. Les sélecteurs du frontend
utilisent la première forme.
