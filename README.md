
# UpOwa / Uswap

Application web de planification et de supervision des équipes de *swapping*
réparties sur plusieurs stations.

- **Base backend** : `uswap-v5.3.0` — backend intégré du sprint 5
- **Frontend Dylane** : `uswap-frontend-s5.2.0` — interface et mocks livrés séparément
- **Backend** : NestJS 11 + Prisma 6 + PostgreSQL
- **Frontend** : React 19 + Vite + TypeScript

> Documentation détaillée : [`docs/FONCTIONNEMENT-SPRINTS-1-A-5.md`](docs/FONCTIONNEMENT-SPRINTS-1-A-5.md)
> (fonctionnement du projet et rôle de chaque API, sprint par sprint).
>
> Le tag `uswap-v5.3.0` décrit la base full-stack publiée avant l’overlay frontend
> Dylane. Le code backend n’a pas été modifié par la livraison `s5.2.0`.
>
> **Nouveautés et API de la version 5.3.0** :
> [`docs/V5.3.0-NOUVELLE-VERSION-ET-API.md`](docs/V5.3.0-NOUVELLE-VERSION-ET-API.md)
> (changements détaillés + documentation complète des routes).
>
> **Intégration du frontend sprint 5.2.0** :
> [`docs/V5.3.0-INTEGRATION-FRONTEND-S5.2.0.md`](docs/V5.3.0-INTEGRATION-FRONTEND-S5.2.0.md)
> (réalignement backend ↔ frontend, pointage GPS, inbox congés, vérifications).

---

## Nouveautés de la version 5.3.0

Cette version intègre le frontend et le backend et complète les User Stories
**2069 à 2078**. Voir `US-2069-2078-COMPLIANCE.md` pour la matrice de conformité.

- **Reporting opérationnel** : dashboard `/reports/dashboard` (période, station,
  swappeur) avec KPI de couverture, assiduité, absences, retards, mouvements et heures.
- **Calcul des heures** par swappeur, station, semaine et mois (shifts publiés et affectés uniquement).
- **Export CSV / XLSX** généré côté serveur, avec **audit** de chaque export (`ReportExportAudit`).
- **Rapports périodiques** : planification quotidienne/hebdo/mensuelle, aperçu avant
  création, historique d'exécution (`ScheduledReportRun`), envoi SMTP.
- **PWA / hors ligne** : cache du planning du swappeur, file d'absences annulable
  avant synchronisation, horodatage de synchronisation, notifications push.
- **Correctifs full-stack** (authentification, utilisateurs, planning/shifts,
  notifications, offline) : voir `FIXES.md`.

### Correctifs principaux

- Liens d'activation corrigés (`/auth/activate?token=...`), envoi SMTP Gmail/Nodemailer.
- Statut utilisateur réel `pending / active / inactive` + `disabledAt`.
- Poste de shift **vacant** possible (`Shift.swapperId` nullable).
- Anti-doublon hors ligne via `clientRef` (`ReplacementRequest`).
- Préférences de notification alignées avec le contrat backend.

### Intégration frontend sprint 5.2.0

Le tag `uswap-frontend-s5.2.0` remplace le pointage par QR code par un **pointage
par géolocalisation GPS** et ajoute l'**inbox de validation des congés** côté
administrateur. Le backend a été réaligné en conséquence :

- `POST /attendance` — pointage GPS vérifié dans le périmètre de la station
  (`Station.geofenceRadiusMeters`, formule de Haversine).
- `GET /admin/leaves/pending` et `PATCH /admin/leaves/:id/decision` — inbox admin.
- `PATCH /leaves/:id/cancel` — annulation (en plus du `POST`).
- `POST /operations/absences/attachments` — justificatif d'absence.
- `POST /plannings/:id/occurrences/:oid/remove` — suppression d'occurrence (en plus du `PATCH`).

Vérifications : audit de contrat **94/94**, e2e **70/70**, builds backend et
frontend OK, backend (3000) et frontend (5173) connectés.

---

## Présentation

L'application couvre le cycle complet d'une journée de travail :

1. **Planifier** — créer un planning, générer les créneaux depuis les modèles
   de la station, publier.
2. **Pointer** — l’interface Dylane prépare un pointage par proximité GPS en
   mode mock; l’API V5.3 conserve son parcours QR.
3. **Suivre** — retards, absences, corrections, journal des mouvements.
4. **Couvrir** — une absence ouvre une demande de remplacement, le superviseur
   arbitre.
5. **Piloter** — rapports consolidés, réglages réseau, administration des accès.

Modules fonctionnels : utilisateurs et rôles, stations, congés, plannings et
créneaux, pointage, remplacements, incidents, notifications, rapports,
réglages globaux.

---

## Architecture

```
Frontend React (Vite)  ──proxy /api──▶  Backend NestJS  ──Prisma──▶  PostgreSQL
```

Le frontend est servi sur `http://127.0.0.1:5173` et **proxifie** `/api` vers le
backend (`http://localhost:3000`). Ce point est important : frontend et API
partagent ainsi la **même origine**, condition nécessaire au bon fonctionnement
du cookie de session `HttpOnly`.

---

## Stack technique

### Frontend
- React 19.3.0 / React DOM 19.3.0
- Vite 8.0.14
- TypeScript ~5.8.3
- React Router 7.18.3

### Backend
- NestJS ^11.0.1
- TypeScript ^5.7.3
- Prisma Client ^6.19.3 (+ `@prisma/adapter-pg`, `pg`)
- Swagger ^11.4.7
- JWT ^12.0.1

### Environnement
- Node.js 24.x — npm 11.x
- PostgreSQL
- Git + GitHub (dépôt `uswap-github`)

---

## Démarrage

### 1. Backend

```bash
npm install
npx prisma migrate deploy
npx prisma generate
npm run seed          # jeu de données de démonstration
npm run start:dev     # http://localhost:3000
```

API documentée (Swagger) : `http://localhost:3000/api-docs`

### 2. Frontend

```bash
cd frontend
npm install
npm run dev           # http://127.0.0.1:5173
```

### Variables d'environnement

**Backend** — copier `.env.example` vers `.env` :

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/uswap"
JWT_SECRET="une-chaine-longue-et-secrete"
ACCESS_TOKEN_TTL_SECONDS=900
PORT=3000
CORS_ORIGIN="http://127.0.0.1:5173,http://localhost:5173"
FRONTEND_URL="http://127.0.0.1:5173"

# E-mails (optionnel) — voir la section « E-mails » plus bas.
RESEND_API_KEY=""
MAIL_FROM="Uswap <onboarding@resend.dev>"

# Intégration RH externe des congés (optionnel).
LEAVE_API_URL=""
```

**Frontend** — copier `frontend/.env.example` vers `frontend/.env` :

```bash
VITE_API_URL=http://127.0.0.1:3000
```

> Ne mettez pas `http://localhost:3000` ici : l'appel direct étant *cross-site*,
> le cookie de session n'est pas transmis et la session se perd à chaque
> changement de page.

---

## Comptes de démonstration

Mot de passe commun : **`Uswap2026!Demo`**
(surchargeable via `DEMO_PASSWORD` avant de lancer le seed).

| Rôle | E-mail |
|---|---|
| Administrateur | `admin@upowa.org` |
| Superviseur | `superviseur@upowa.org` |
| Chef de station | `chef@upowa.org` |
| Swappeur | tout compte `SWAPPER` actif (voir `npm run seed`) |

Les comptes swappers du seed sont créés **inactifs** (parcours d'invitation).
Pour en activer un sans service e-mail :

```bash
node scripts/activate-user.cjs <email> [motDePasse]
```

---

## E-mails

Les e-mails transactionnels (invitation, réinitialisation) passent par
[Resend](https://resend.com).

- **Sans `RESEND_API_KEY`**, aucun e-mail n'est envoyé : le compte est bien créé
  en base, mais reste inactif. Depuis la version 5.2, l'API renvoie alors un
  champ **`activationUrl`** afin que l'administrateur transmette le lien
  lui-même. Le lien est également écrit dans les logs du serveur.
- **Avec `RESEND_API_KEY`**, aucun lien n'est renvoyé dans la réponse : le jeton
  ne circule que par e-mail.

Points d'attention :

- `MAIL_FROM` doit utiliser un domaine **vérifié** dans Resend. En test,
  utilisez `Uswap <onboarding@resend.dev>`, sinon l'envoi est refusé.
- En mode test, Resend n'accepte comme destinataire que l'adresse du compte
  Resend lui-même.

---

## Tests et vérifications

```bash
# Backend
npx tsc --noEmit -p tsconfig.build.json   # typage
npm run build                             # compilation
npx jest                                  # tests unitaires

# Frontend
cd frontend && npm run build              # typage + build

# Contrats et bout en bout (backend et frontend démarrés)
node scripts/audit-contract.cjs           # chaque appel frontend a une route
node scripts/test-e2e.mjs                 # 70 vérifications fonctionnelles
```

---

## Rôles et permissions

| Rôle | Périmètre |
|---|---|
| `ADMIN` | Réglages réseau, comptes, stations, rapports programmés |
| `SUPERVISOR` | Plannings, incidents, points de contrôle, rapports réseau |
| `STATION_CHIEF` | Sa station : pointage, incidents, suivi du jour |
| `SWAPPER` | Son espace : créneaux, congés, historique de pointage |

Sécurité : JWT à durée courte, refresh token à usage unique dans un cookie
`HttpOnly`, cloisonnement par station, machine à états des incidents validée
côté serveur, validation d'entrée stricte, et journalisation des actions
sensibles (`UserAuditLog`, `IncidentAction`, `GlobalSettingRevision`).

---

## Git et organisation des branches

Dépôt : `uswap-github`.

| Branche | Rôle |
|---|---|
| `danielle` | Développement backend et intégration |
| `dylane` | Développement frontend |
| `develop` | Branche d'intégration : reçoit les versions testées |
| `main` | Version stable |

### Workflow

```
danielle ─┐
          ├─▶ develop ──(tests OK)──▶ tag de version
dylane   ─┘
```

Chaque intégration dans `develop` est précédée des vérifications listées plus
haut, puis marquée par un tag.

### Versions publiées

| Tag | Contenu |
|---|---|
| `uswap-frontend-s4.1.0` | Frontend sprint 4 |
| `uswap-frontend-s5.1.0` | Frontend sprint 5 |
| `uswap-frontend-s5.2.0` | Frontend Dylane sprint 5.2, mock et interface |
| `uswap-v5.3.0` | **Sprint 5 intégré : frontend + backend raccordés** |

---

## Sécurité — bonnes pratiques

Ne jamais commiter :

- `DATABASE_URL`, `JWT_SECRET`, `RESEND_API_KEY` et tout autre secret ;
- les mots de passe ;
- les fichiers `.env` réels.

Ces valeurs vivent uniquement dans les fichiers `.env` locaux, exclus par
`.gitignore`. Utilisez `.env.example` comme référence.

## uSwap 5.3 — User Stories 2069–2078

La version 5.3 complète le socle 5.2 avec le reporting exportable CSV/XLSX, l’audit des exports, les rapports périodiques avec aperçu et historique d’exécution, le calcul des heures par station/semaine/mois, la visibilité de la synchronisation externe des congés et l’amélioration du parcours offline/PWA (file d’absences annulable avant synchronisation et horodatage de synchronisation).

Voir `US-2069-2078-COMPLIANCE.md` pour la matrice de conformité détaillée.
## Livraison frontend Dylane - sprint 5.2.0

Le tag `uswap-frontend-s5.2.0` publie la version de l’interface développée côté Dylane, avec ses parcours mock et les écarts API documentés. La [note de livraison illustrée (PDF)](output/pdf/uswap-frontend-s5.2.0-livraison.pdf) contient les captures du frontend, les schémas métier et les vérifications effectuées. Le code backend existant n’est pas modifié par cette livraison.
