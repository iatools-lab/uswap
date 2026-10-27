# uSwap â€” Fonctionnement du projet, sprint 1 Ã  sprint 5

Ce document dÃ©crit **ce que fait le produit**, **ce qui a Ã©tÃ© livrÃ© Ã  chaque
sprint**, et **le rÃ´le de chaque API** du backend. Il s'adresse Ã  toute personne
qui reprend le code : dÃ©veloppeur, relecteur ou nouvel arrivant.

- **Version documentÃ©e** : `uswap-v5.2.0` (sprint 5 intÃ©grÃ©)
- **Backend** : NestJS 11 + Prisma 6 + PostgreSQL
- **Frontend** : React 19 + Vite + TypeScript
- **RÃ´les applicatifs** : `ADMIN`, `SUPERVISOR`, `STATION_CHIEF`, `SWAPPER`

---

## 1. Le produit en une page

uSwap planifie et suit les Ã©quipes de *swapping* rÃ©parties sur plusieurs
stations. Le cycle de vie d'une journÃ©e de travail est le suivant :

```
Planning (brouillon)  ->  GÃ©nÃ©ration des crÃ©neaux  ->  Publication
      ->  Le swappeur pointe (QR)  ->  Le chef suit les prÃ©sences
      ->  Une absence ouvre une demande de remplacement
      ->  Le superviseur arbitre, les rapports agrÃ¨gent le tout
```

Autour de ce flux gravitent : les **congÃ©s** (avec synchronisation vers un
systÃ¨me RH externe), les **incidents**, les **notifications**, les **rÃ©glages
globaux** et l'**administration des comptes**.

### ModÃ¨le de donnÃ©es en un coup d'Å“il

| EntitÃ© | RÃ´le |
|---|---|
| `User` | Compte, rÃ´le, station de rattachement |
| `Station` | Site d'exploitation, paramÃ¨tres de pointage et de repos |
| `ShiftTemplate` / `ShiftTemplateVersion` | ModÃ¨les de crÃ©neaux horaires + historique |
| `Planning` / `PlanningStation` | FenÃªtre de planification et stations couvertes |
| `Shift` | CrÃ©neau affectÃ© Ã  un swapper sur une station |
| `Attendance` / `AttendanceQr` | Pointage et jetons QR de prise/fin de service |
| `LeaveRequest` / `LeaveBalance` / `LeaveSyncOperation` | CongÃ©s, soldes, synchronisation |
| `ReplacementRequest` / `ShiftChange` | Remplacements et journal des mouvements |
| `Incident` / `IncidentAction` | Incidents et leur traÃ§abilitÃ© |
| `Notification` / `NotificationPreference` | Notifications et prÃ©fÃ©rences |
| `GlobalSetting` / `GlobalSettingRevision` | RÃ©glages rÃ©seau et historique |
| `ScheduledReport` | Rapports rÃ©currents |
| `UserAuditLog` | Journal des modifications de comptes |

---

## 2. Sprint par sprint

### Sprint 1 â€” Socle : comptes, authentification, stations

**Objectif** : disposer d'une base fiable pour authentifier et structurer
l'organisation.

**LivrÃ©**
- Authentification JWT (access token court + refresh token rotatif).
- Cycle d'invitation : un compte est crÃ©Ã© **inactif**, l'utilisateur reÃ§oit un
  lien, choisit son mot de passe, le compte devient actif.
- RÃ©initialisation de mot de passe par jeton Ã  durÃ©e limitÃ©e.
- Gestion des rÃ´les et du pÃ©rimÃ¨tre par station.
- CRUD des stations avec leurs paramÃ¨tres (tolÃ©rance de retard, repos minimal,
  limite hebdomadaire, temps de vie des QR).
- ModÃ¨les de crÃ©neaux (`ShiftTemplate`) rattachÃ©s Ã  une station.

**APIs**

| MÃ©thode | Route | RÃ´le |
|---|---|---|
| POST | `/auth/login` | Authentifie, renvoie la session et pose le cookie de refresh |
| POST | `/auth/refresh` | Renouvelle la session Ã  partir du cookie HttpOnly |
| POST | `/auth/logout` | RÃ©voque les jetons et efface le cookie |
| GET | `/auth/me` | Profil de l'utilisateur connectÃ© (utilisÃ© par le chien de garde de session) |
| GET | `/auth/session` | Temps restant avant expiration du jeton d'accÃ¨s |
| POST | `/auth/register` | CrÃ©e un compte (administrateur) |
| POST | `/auth/activate-account` (alias `/auth/activate`) | Active un compte invitÃ© et dÃ©finit le mot de passe |
| POST | `/auth/forgot-password` | DÃ©clenche l'envoi d'un lien de rÃ©initialisation |
| POST | `/auth/reset-password` | Applique le nouveau mot de passe |
| POST | `/auth/invitations/:id/resend` | Renvoie une invitation |
| GET | `/users` | Liste paginÃ©e des comptes (ou tableau simple si `page`/`limit` sont omis) |
| GET | `/users/:id` | Fiche d'un compte |
| PATCH | `/users/:id` | Modifie un compte (traÃ§Ã© dans `UserAuditLog`) |
| PATCH | `/users/:id/status` | Active ou dÃ©sactive un compte |
| PATCH | `/users/:id/deactivate` / `/reactivate` | Variantes explicites |
| POST | `/users/:id/activate` | Renvoie l'invitation d'un compte en attente |
| GET | `/users/profiles` | Annuaire public des comptes actifs (Ã©cran de connexion) |
| GET | `/stations` | Liste des stations |
| GET | `/stations/:id` | DÃ©tail d'une station |
| POST | `/stations` | CrÃ©e une station |
| PATCH | `/stations/:id` | Modifie une station |
| PATCH | `/stations/:id/active` / `/status` / `/activate` / `/deactivate` | Cycle de vie |
| GET | `/stations/:id/shift-templates` | ModÃ¨les de crÃ©neaux d'une station |
| POST | `/stations/:id/shift-templates` | CrÃ©e un modÃ¨le |
| PATCH | `/stations/:id/shift-templates/:templateId` | Modifie un modÃ¨le |
| GET | `/stations/:id/shift-templates/:templateId/history` | Historique des versions |

---

### Sprint 2 â€” Planification et publication

**Objectif** : produire un planning de crÃ©neaux et le rendre visible aux Ã©quipes.

**LivrÃ©**
- CrÃ©ation d'un planning sur une fenÃªtre de dates.
- GÃ©nÃ©ration automatique des crÃ©neaux Ã  partir des modÃ¨les, jour par jour,
  en respectant les contraintes de la station.
- Publication du planning : les swappers reÃ§oivent une notification et
  retrouvent leurs crÃ©neaux dans leur espace.
- BoÃ®te de rÃ©ception des publications, avec suivi de lecture.

**APIs**

| MÃ©thode | Route | RÃ´le |
|---|---|---|
| POST | `/plannings` | CrÃ©e un planning (brouillon) |
| GET | `/plannings` | Liste des plannings |
| GET | `/plannings/:id` | DÃ©tail, avec les crÃ©neaux exposÃ©s sous `occurrences` + `revision` |
| POST | `/plannings/:id/generate` | GÃ©nÃ¨re les crÃ©neaux Ã  partir des modÃ¨les |
| PATCH | `/plannings/:id/publish` | Publie et notifie les Ã©quipes |
| GET | `/plannings/notices` | Publications non lues de l'utilisateur |
| PATCH | `/plannings/notices/:id/read` | Marque une publication comme lue |
| POST | `/shifts/validate` | ContrÃ´le de contraintes avant affectation |
| GET | `/workspace` | Espace personnel : crÃ©neaux Ã  venir de l'appelant |

---

### Sprint 3 â€” Pointage et suivi des prÃ©sences

**Objectif** : tracer l'arrivÃ©e et le dÃ©part, dÃ©tecter retards et absences.

**LivrÃ©**
- GÃ©nÃ©ration de QR par le chef de station (`CHECKIN` / `CHECKOUT`), avec
  fenÃªtre de validitÃ© et temps de vie paramÃ©trÃ©s par station.
- Pointage par le swapper, calcul automatique du retard selon la tolÃ©rance.
- DÃ©tection automatique des absences en fin de crÃ©neau, qui ouvre une demande
  de remplacement.
- Correction de pointage par un superviseur, avec motif et piÃ¨ce justificative.
- Historique personnel des pointages.

**APIs**

| MÃ©thode | Route | RÃ´le |
|---|---|---|
| POST | `/attendance/qr` | GÃ©nÃ¨re un QR de pointage pour un crÃ©neau |
| POST | `/attendance` | Enregistre le pointage Ã  partir du jeton QR |
| GET | `/attendance/history` | Historique de pointage du swapper connectÃ© |
| GET | `/attendance/monitor` | Tableau de suivi du jour (superviseur, chef de station) |
| GET | `/attendance/:id` | DÃ©tail d'un pointage |
| PATCH | `/attendance/:id/correct` | Correction par un superviseur |
| GET | `/corrections/shifts/:id` | Corrections d'un crÃ©neau |
| POST | `/corrections/attachments` | PiÃ¨ce justificative d'une correction |

---

### Sprint 4 â€” CongÃ©s, remplacements et incidents

**Objectif** : gÃ©rer les absences planifiÃ©es, couvrir les postes dÃ©couverts et
tracer les incidents d'exploitation.

**LivrÃ©**
- Espace congÃ©s du swapper : solde, demandes, Ã©dition, annulation.
- **Idempotence** : chaque Ã©criture porte une clÃ© de synchronisation ; rejouer
  une requÃªte hors ligne ne crÃ©e jamais de doublon.
- Synchronisation vers un systÃ¨me RH externe, avec statut visible
  (`SYNCED`, `QUEUED`, `FAILED`) et possibilitÃ© de relancer.
- Demandes de remplacement : ouverture, candidats, affectation, rÃ©solution.
- Journal des mouvements d'affectation (`ShiftChange`).
- **Incidents** : dÃ©claration par le chef de station, qualification et
  rÃ©solution par le superviseur, avec un Ã©tat strictement contrÃ´lÃ© cÃ´tÃ© serveur.

**APIs**

| MÃ©thode | Route | RÃ´le |
|---|---|---|
| GET | `/leaves/workspace` | Solde + demandes + Ã©tat d'intÃ©gration du swapper |
| POST | `/leaves` | CrÃ©e une demande (idempotente via `idempotencyKey`) |
| PATCH | `/leaves/:id` | Modifie une demande encore en attente |
| POST | `/leaves/:id/cancel` | Annule une demande en attente |
| POST | `/leaves/sync/:operationId/retry` | Relance une synchronisation Ã©chouÃ©e |
| GET | `/leave-requests/mine` | Alias historique de l'espace congÃ©s |
| GET | `/operations/changes` | Journal des mouvements d'affectation |
| GET | `/operations/replacements/pending` | Remplacements en attente |
| GET | `/operations/shifts/:id/candidates` | Candidats pour un crÃ©neau |
| POST | `/operations/absences` | DÃ©clare une absence |
| POST | `/operations/shifts/:id/replacement` | Affecte un remplaÃ§ant |
| GET | `/incidents` | Liste + indicateurs (incidents ouverts, critiques, dÃ©lai moyen) |
| POST | `/incidents` | DÃ©clare un incident (chef de station) |
| PATCH | `/incidents/:id` | Fait Ã©voluer un incident (superviseur) |

> **Machine Ã  Ã©tats des incidents** (imposÃ©e cÃ´tÃ© serveur) :
> `REPORTED â†’ TO_REVIEW â†’ ACKNOWLEDGED â†’ IN_PROGRESS â†’ RESOLVED â†’ CLOSED`.
> Toute transition non autorisÃ©e est rejetÃ©e en `409`.

---

### Sprint 5 â€” Pilotage, rapports et administration

**Objectif** : donner aux responsables une vision consolidÃ©e et les moyens
d'administrer la plateforme.

**LivrÃ©**
- **Ã‰cran de planification avancÃ©** : prÃ©visualisation d'une gÃ©nÃ©ration,
  affectation automatique Ã©quilibrÃ©e, Ã©dition d'un crÃ©neau, duplication,
  validation des contraintes, validation globale puis publication.
- **Tableau de bord opÃ©rationnel** : couverture, taux de prÃ©sence, retards,
  absences, heures par swapper, mouvements, postes vacants.
- **RÃ©glages globaux** du rÃ©seau, avec numÃ©ro de rÃ©vision et historique.
- **Rapports programmÃ©s** (quotidien, hebdomadaire, mensuel).
- **PrÃ©fÃ©rences de notification** par utilisateur (in-app, e-mail, push, digest,
  plage de silence, rÃ©tention).
- **Suivi d'intÃ©gration** de la synchronisation des congÃ©s.
- **Export Excel** des utilisateurs.
- **Import** d'utilisateurs en deux temps : aperÃ§u puis confirmation.

**APIs**

| MÃ©thode | Route | RÃ´le |
|---|---|---|
| POST | `/plannings/:id/preview` | Simulation : crÃ©neaux qui seraient crÃ©Ã©s, doublons, hors pÃ©riode |
| PATCH | `/plannings/:id/validate` | ContrÃ´le global avant publication (erreurs + avertissements) |
| POST | `/plannings/:id/auto-assign` | RÃ©Ã©quilibre les affectations entre swappers |
| POST | `/plannings/:id/occurrences/:occurrenceId/validate` | Contraintes pour un candidat donnÃ© |
| PATCH | `/plannings/:id/occurrences/:occurrenceId` | RÃ©affecte ou Ã©change un crÃ©neau |
| POST | `/plannings/:id/occurrences/:occurrenceId/duplicate` | Duplique un crÃ©neau |
| PATCH | `/plannings/:id/occurrences/:occurrenceId/remove` | Retire un crÃ©neau |
| GET | `/reports/dashboard` | Tableau de bord opÃ©rationnel sur une pÃ©riode |
| GET | `/dashboard/stats` | Indicateurs de la page d'accueil |
| GET | `/admin/settings` | RÃ©glages globaux + historique des rÃ©visions |
| PATCH | `/admin/settings` | Met Ã  jour les rÃ©glages (incrÃ©mente la rÃ©vision) |
| GET | `/admin/reports/schedules` | Rapports programmÃ©s |
| POST | `/admin/reports/schedules` | Programme un rapport |
| PATCH | `/admin/reports/schedules/:id` | Active ou suspend un rapport |
| GET | `/admin/integrations/leaves` | Ã‰tat de la synchronisation des congÃ©s |
| GET | `/users/export` | DonnÃ©es d'export Excel des comptes |
| GET | `/users/import/template` (alias `/users/imports/template`) | ModÃ¨le CSV d'import |
| POST | `/users/import/preview` (alias `/users/imports/preview`) | Analyse du fichier |
| POST | `/users/import/confirm` (alias `/users/imports/:id/confirm`) | Confirme l'import |
| GET | `/notifications` | Notifications de l'utilisateur |
| GET | `/notifications/unread-count` | Compteur de non-lues |
| PATCH | `/notifications/:id/read` | Marque une notification comme lue |
| PATCH | `/notifications/read-all` | Marque tout comme lu |
| GET | `/notifications/preferences` | PrÃ©fÃ©rences de notification |
| PATCH | `/notifications/preferences` | Met Ã  jour les prÃ©fÃ©rences |

---

## 3. SÃ©curitÃ© et permissions

Chaque route est protÃ©gÃ©e par `JwtAuthGuard` et, quand le rÃ´le compte, par
`RolesGuard`. Les contrÃ´les appliquÃ©s :

| ContrÃ´le | Mise en Å“uvre |
|---|---|
| IdentitÃ© | Jeton JWT signÃ©, durÃ©e de vie courte |
| Session | Refresh token Ã  usage unique, tournÃ© Ã  chaque renouvellement, conservÃ© dans un cookie **HttpOnly** |
| Cloisonnement | Un chef de station ne voit que sa station ; un swapper ne voit que ses donnÃ©es |
| Transitions mÃ©tier | Machine Ã  Ã©tats des incidents validÃ©e cÃ´tÃ© serveur, pas cÃ´tÃ© client |
| Validation d'entrÃ©e | `ValidationPipe` globale en `whitelist` + `forbidNonWhitelisted` |
| TraÃ§abilitÃ© | `UserAuditLog` pour les comptes, `IncidentAction` pour les incidents, `GlobalSettingRevision` pour les rÃ©glages |

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

# IntÃ©gration RH externe des congÃ©s (optionnel).
LEAVE_API_URL=""
```

### Frontend (`frontend/.env`)

```bash
# Frontend et API sur une origine unique : indispensable au cookie de session.
VITE_API_URL=/api
```

> Le proxy Vite (`frontend/vite.config.ts`) redirige `/api` vers
> `http://localhost:3000`. Sans ce proxy, le cookie `SameSite=Lax` n'est pas
> transmis sur une requÃªte cross-site et la session est perdue Ã  chaque
> renouvellement de jeton.

---

## 5. DÃ©marrage

```bash
# 1. Backend
npm install
npx prisma migrate deploy
npx prisma generate
npm run seed            # jeu de dÃ©monstration
npm run start:dev       # http://localhost:3000  (Swagger : /api-docs)

# 2. Frontend
cd frontend
npm install
npm run dev             # http://127.0.0.1:5173
```

### Comptes de dÃ©monstration

Le mot de passe est commun : la valeur de `DEMO_PASSWORD` (backend_new/.env) (surchargeable via
`DEMO_PASSWORD` avant le seed).

| RÃ´le | E-mail |
|---|---|
| Administrateur | `admin@upowa.org` |
| Superviseur | `superviseur@upowa.org` |
| Chef de station | `chef@upowa.org` |
| Swappeur | voir `npm run seed`, ou tout compte `SWAPPER` actif |

> Les comptes swappers du seed sont crÃ©Ã©s **inactifs** (invitation). Pour en
> activer un sans service e-mail :
> `node scripts/activate-user.cjs <email> [motDePasse]`

---

## 6. VÃ©rifications

| Commande | Ce qu'elle contrÃ´le |
|---|---|
| `npx tsc --noEmit -p tsconfig.build.json` | Typage du backend |
| `npm run build` | Compilation du backend |
| `cd frontend && npm run build` | Typage et build du frontend |
| `npx jest` | Tests unitaires du backend |
| `node scripts/audit-contract.cjs` | Chaque appel du frontend a bien une route serveur |
| `node scripts/test-e2e.mjs` | 70 vÃ©rifications fonctionnelles sur les 10 domaines du sprint 5 |

---

## 7. DÃ©pannage

**Un compte crÃ©Ã© ne reÃ§oit aucun e-mail.**
`RESEND_API_KEY` n'est pas configurÃ©e. Le compte existe en base, inactif. Depuis
la version 5.2, la rÃ©ponse de crÃ©ation contient `activationUrl` : transmettez ce
lien Ã  l'utilisateur. Vous pouvez aussi activer le compte directement :
`node scripts/activate-user.cjs <email> [motDePasse]`.

**Le mot de passe est refusÃ© alors que je viens de le dÃ©finir.**
Utilisez l'une des deux adresses complÃ¨tes (`localhost` **ou** `127.0.0.1`) de
faÃ§on constante : ce sont deux origines distinctes pour le navigateur, donc deux
stockages de session distincts.

**L'API rÃ©pond mais toutes les requÃªtes Ã©chouent en CORS.**
`CORS_ORIGIN` doit contenir l'origine exacte du frontend, schÃ©ma et port
compris, et le serveur doit Ãªtre redÃ©marrÃ© aprÃ¨s modification.

**La session se perd Ã  chaque changement de page.**
VÃ©rifiez que `VITE_API_URL` vaut bien `/api` et que le proxy Vite est actif.

**Un compte est introuvable dans `GET /users`.**
La route renvoie un tableau lorsqu'aucune pagination n'est demandÃ©e, et un
objet `{ data, total, page, ... }` lorsqu'elle l'est. Les sÃ©lecteurs du frontend
utilisent la premiÃ¨re forme.
