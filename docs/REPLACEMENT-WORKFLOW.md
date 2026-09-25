# Workflow de remplacement — documentation

_Ce document couvre la chaîne **empêchement → supervision → remplacement**, livrée dans le commit
`603617f` (branche `danielle`)._

---

## 1. Vue d'ensemble

La chaîne relie quatre acteurs :

```
Swappeur                Supervisor / Chef de station          Système
   │                              │                              │
   │ 1. signale un empêchement    │                              │
   ├──── POST /operations/absences ──────────────────────────────┤
   │                              │                        ReplacementRequest
   │                              │                             OPEN
   │                              │                              │
   │                              │ 2. consulte la file          │
   │                              ├── GET /operations/replacements/pending
   │                              │                              │
   │                              │ 3. consulte les shifts       │
   │                              ├── GET /operations/changes    │
   │                              │                              │
   │                              │ 4. liste les remplaçants     │
   │                              ├── GET /operations/shifts/:id/candidates
   │                              │                              │
   │                              │ 5. valide l'affectation      │
   │                              ├── POST /operations/shifts/:id/replacement
   │                              │                        ShiftChange + shift
   │                              │                             RESOLVED
```

**Deux origines alimentent la même file :**

| Origine (`source`) | Déclencheur | Effet |
|---|---|---|
| `DECLARATION` | Le swappeur signale lui-même un empêchement | Ouvre une demande `OPEN` |
| `AUTOMATIC_ABSENCE` | Le cron (toutes les 5 min) détecte qu'un swapper n'a pas scanné | Ouvre une demande `OPEN` |

Un empêchement déclaré **n'est pas** une justification d'absence : les deux sont distinguables
par le champ `source`, et une déclaration n'écrit aucune ligne d'`Attendance`.

---

## 2. Modèles de données utilisés

Aucune migration n'a été nécessaire — les modèles existaient déjà dans `schema.prisma`.

### `ReplacementRequest`

Porte la demande. Cycle de vie :

```
OPEN ──(affectation)──> RESOLVED
```

- `source` : `DECLARATION` | `AUTOMATIC_ABSENCE`
- `originalSwapperId` : le titulaire qui ne peut plus assurer
- `assignedSwapperId` / `assignedById` / `assignedAt` : renseignés à l'affectation
- `reason` : motif fourni par le swappeur ou par le superviseur

### `ShiftChange`

Historique immuable de chaque changement d'affectation :

- `type` : `REPLACEMENT` (utilisé par cette chaîne)
- `previousSwapperId` → `newSwapperId`
- `oldStartTime` / `oldEndTime` / `newStartTime` / `newEndTime`
- `changedById` : l'auteur de l'action

---

## 3. Les 5 endpoints

Toutes les routes sont protégées par `JwtAuthGuard` + `RolesGuard` (`@ApiBearerAuth()`).

### 3.1 `POST /operations/absences` — déclarer un empêchement

**Rôle :** `SWAPPER` uniquement.

```jsonc
// Requête
{
  "shiftId": "uuid-du-shift",
  "reason": "Maladie",
  "clientRef": "uuid-genere-par-le-client"   // optionnel, idempotence hors-ligne
}
```

```jsonc
// Réponse 201
{
  "message": "Impediment declared. A replacement request is now open.",
  "requestId": "uuid",
  "status": "OPEN",
  "shiftId": "uuid",
  "stationId": "uuid",
  "startTime": "2026-09-26T08:00:00.000Z"
}
```

**Refusé si :**
- le shift n'appartient pas au swapper (`403`)
- le planning n'est pas `PUBLISHED` (`400`)
- le shift est déjà terminé (`400`)
- l'attendance est déjà `CHECKED_IN` ou `CHECKED_OUT` (`400`)

**Idempotence :** si une demande `OPEN` ou `ASSIGNED` existe déjà pour ce shift, la réponse
renvoie `"An open replacement request already exists for this shift."` sans en créer une seconde.

### 3.2 `GET /operations/replacements/pending` — file de couverture

**Rôles :** `ADMIN`, `SUPERVISOR`, `STATION_CHIEF`.

Filtre automatiquement les shifts dont la `endTime` est passée.

```jsonc
// Réponse 200
[
  {
    "requestId": "uuid",
    "shiftId": "uuid",
    "station": { "id": "uuid", "name": "Bonabéri", "timezone": "Africa/Douala" },
    "swapper": { "id": "uuid", "fullName": "Jean Dupont" },
    "assignedSwapper": null,
    "startTime": "2026-09-26T08:00:00.000Z",
    "endTime": "2026-09-26T16:00:00.000Z",
    "status": "OPEN",
    "urgency": "CRITICAL",
    "hoursUntilStart": 9.4,
    "origin": "DECLARATION",
    "reason": "Maladie",
    "reportedAt": "2026-09-25T22:36:00.000Z"
  }
]
```

**Urgence** (calculée à la lecture, jamais stockée) :

| Valeur | Condition |
|---|---|
| `CRITICAL` | début dans ≤ 12 h |
| `HIGH` | début dans ≤ 48 h |
| `NORMAL` | au-delà |

Trié par urgence, puis par heure de début.

### 3.3 `GET /operations/changes` — historique des changements

**Rôles :** `ADMIN`, `SUPERVISOR`, `STATION_CHIEF`.

| Paramètre | Format | Rôle |
|---|---|---|
| `from` | ISO 8601 | borne basse sur `createdAt` |
| `to` | ISO 8601 | borne haute sur `createdAt` |
| `type` | `REPLACEMENT` \| `SWAP` \| `REASSIGNMENT` \| `ASSIGNMENT` \| `MANUAL_EDIT` \| `TIME_CHANGE` | filtre |
| `swapperId` | uuid | apparaît comme sortant **ou** entrant |

Limité à 500 lignes, `createdAt` décroissant.

Réponse : `{ id, type, rawType, initiator, station, outSwapper, inSwapper, before, after, reason, createdAt }`

> `type` est normalisé pour l'affichage (`SWAP` est exposé tel quel, le frontend l'affiche
> « Permutation »). `rawType` conserve la valeur brute de l'enum Prisma.

### 3.4 `GET /operations/shifts/:shiftId/candidates` — remplaçants éligibles

**Rôles :** `ADMIN`, `SUPERVISOR`, `STATION_CHIEF`.

```jsonc
// Réponse 200
{
  "shiftId": "uuid",
  "stationId": "uuid",
  "startTime": "...",
  "endTime": "...",
  "durationHours": 8,
  "candidates": [
    {
      "id": "uuid",
      "fullName": "Awa Nkolo",
      "email": "awa@exemple.cm",
      "eligible": true,
      "issues": []
    },
    {
      "id": "uuid",
      "fullName": "Paul Biya",
      "email": "paul@exemple.cm",
      "eligible": false,
      "issues": [{ "code": "RULE_1", "message": "Repos insuffisant avant ce creneau : 6.0h de repos. Minimum 8h requis." }]
    }
  ]
}
```

Le titulaire actuel est **exclu** de la liste. Un candidat non éligible est renvoyé avec
`eligible: false` et ses motifs — l'interface les affiche et désactive la sélection.

**Point clé :** l'éligibilité est calculée par `SchedulingEngineService.validateShift`,
**le même moteur que la planification**. Un remplaçant respecte donc exactement les mêmes
règles qu'un shift planifié :

- durée exacte de 8 h
- aucun chevauchement
- un seul créneau par jour
- repos minimum (`Station.minRestHours`)
- limite hebdomadaire (`Station.weeklyHoursLimit`)
- pas de congé approuvé sur la période
- station active, swapper actif avec le rôle `SWAPPER`

Ces règles ne peuvent pas diverger entre le planning et le remplacement.

### 3.5 `POST /operations/shifts/:shiftId/replacement` — affecter

**Rôles :** `ADMIN`, `SUPERVISOR`, `STATION_CHIEF`.

```jsonc
// Requête
{ "swapperId": "uuid-du-remplacant", "reason": "Absence couverte" }
```

```jsonc
// Réponse 201
{
  "message": "Replacement assigned successfully.",
  "shiftId": "uuid",
  "previousSwapperId": "uuid-sortant",
  "newSwapper": { "id": "uuid-entrant", "fullName": "Awa Nkolo" },
  "shiftChangeId": "uuid",
  "requestId": "uuid",
  "requestStatus": "RESOLVED"
}
```

**Les règles sont revalidées au moment de l'affectation** — pas seulement à l'affichage.
Entre l'ouverture du dialogue et le clic sur « Confirmer », la disponibilité du remplaçant
peut avoir changé. Une violation renvoie `400` avec le détail des erreurs du moteur.

**Transaction unique** (tout ou rien) :

1. `shift.swapperId` ← remplaçant
2. création d'un `ShiftChange` de type `REPLACEMENT`
3. reprise de l'attendance :
   - ancienne ligne `EXPECTED` → supprimée
   - ancienne ligne déjà scannée (`CHECKED_IN` / `CHECKED_OUT`) → **préservée** (historique)
   - nouvelle ligne `EXPECTED` créée pour le remplaçant si absente
4. `ReplacementRequest` → `RESOLVED` avec `assignedSwapperId`, `assignedById`, `assignedAt`

---

## 4. Contrôle d'accès

`OperationsService.resolveAccessibleStationIds()` centralise la portée :

| Rôle | Portée |
|---|---|
| `ADMIN` | toutes les stations |
| `SUPERVISOR` | station principale (`stationId`) + `UserStationScope` |
| `STATION_CHIEF` | sa station uniquement |

Toute tentative d'accès hors périmètre renvoie `403`. Le contrôle est appliqué **à la lecture
et à l'écriture** — un superviseur ne peut pas affecter un remplaçant sur la station d'un autre.

Un compte inactif (`isActive: false`) est refusé (`403`).

---

## 5. Lancer le projet pour la démo

### 5.1 Prérequis

- **Node.js 20+** (testé sur v24.15.0)
- **PostgreSQL** accessible
- Node et Git doivent être dans le `PATH`. Si `node`/`npm`/`git` ne répondent pas dans
  PowerShell, ajoute-les pour la session :

```powershell
$env:Path += ";C:\Program Files\nodejs;C:\Program Files\Git\cmd"
```

### 5.2 Fichiers `.env`

**Racine `uswap-github/.env`** — doit contenir :

```dotenv
DATABASE_URL="postgresql://user:password@localhost:5432/uswap?schema=public"
JWT_SECRET="une-valeur-longue-et-aleatoire"
PORT=3000
NODE_ENV=development
CORS_ORIGIN="http://127.0.0.1:5173,http://localhost:5173"
FRONTEND_URL="http://127.0.0.1:5173"
ADMIN_SEED_EMAIL="admin@upowa.org"
ADMIN_SEED_PASSWORD="ChangeMoiRapidement123"
```

> `ADMIN_SEED_PASSWORD` doit faire **au moins 12 caractères**, sinon le seed échoue.

**`uswap-github/frontend/.env`** :

```dotenv
VITE_API_URL=http://127.0.0.1:3000
```

> ⚠️ **Piège critique.** Si `VITE_API_URL` est absent ou vide, le frontend bascule
> **silencieusement en mode maquette** (`usingMock = !configured`) et n'appelle jamais le
> backend. Les écrans de remplacement afficheraient alors des données fictives et tes
> nouveaux endpoints ne seraient pas sollicités. Vérifie que cette variable est bien définie
> avant la démo.

> ⚠️ `CORS_ORIGIN` doit correspondre **exactement** à l'origine du navigateur. Vite tourne
> sur `127.0.0.1:5173` (`vite --host 127.0.0.1`) : si tu ouvres le site via `localhost:5173`,
> l'origine diffère et CORS bloque. Les deux sont listés ci-dessus.

### 5.3 Installation (une seule fois)

```powershell
cd "chemin\vers\uswap-github"
npm install
cd frontend; npm install; cd ..
```

### 5.4 Base de données

```powershell
# Applique les 15 migrations
npx prisma migrate deploy

# Génère le client Prisma
npx prisma generate

# Crée le compte administrateur
npx prisma db seed
```

En développement, `npx prisma migrate dev` est équivalent et permet de créer des migrations.

### 5.5 Démarrer le backend

**Terminal 1 :**

```powershell
cd "chemin\vers\uswap-github"
npm run start:dev
```

Attendu :

```
[Nest] ... Application is running on: http://[::1]:3000
```

- API : `http://127.0.0.1:3000`
- **Swagger : `http://127.0.0.1:3000/api-docs`** ← à montrer en démo

Alternative production (build puis exécution) :

```powershell
npm run build
npm run start:prod
```

### 5.6 Démarrer le frontend

**Terminal 2 :**

```powershell
cd "chemin\vers\uswap-github\frontend"
npm run dev
```

Attendu : `VITE ... ready` puis `Local: http://127.0.0.1:5173/`

Ouvre **`http://127.0.0.1:5173`** (pas `localhost`, voir la note CORS).

### 5.7 Ordre de démarrage

1. PostgreSQL doit être lancé
2. backend (`npm run start:dev`) — attendre « Application is running »
3. frontend (`npm run dev`)

---

## 6. Scénario de démonstration

### Étape 0 — vérifier la config

Dans les outils de développement du navigateur (onglet Réseau), recharge la page : tu dois voir
des requêtes vers `127.0.0.1:3000`. Si tu vois des réponses instantanées sans requête réseau,
c'est que le mode maquette est actif → `VITE_API_URL` manque.

### Étape 1 — préparer un shift à couvrir

1. Connecte-toi en **ADMIN**
2. Crée une **station** si nécessaire
3. Crée des **swappers** actifs
4. Crée un **planning** et **publie-le** (statut `PUBLISHED` obligatoire — sans cela la
   déclaration d'empêchement est refusée)
5. Vérifie que le shift a bien une ligne d'`Attendance` en `EXPECTED`

### Étape 2 — le swappeur déclare un empêchement (Bloc A)

1. Connecte-toi en **SWAPPER** titulaire du shift
2. Écran d'opérations → **« Absence imprévue »** → **Signaler**
3. Choisis le shift, saisis un motif (≥ 3 caractères), envoie

> Le dialogue gère le **hors-ligne** : la déclaration est mise en file (`outbox`) et part
> automatiquement au retour du réseau.

Attendu : « Absence déclarée. »

### Étape 3 — le superviseur traite la demande (Blocs B et C)

1. Connecte-toi en **SUPERVISOR**
2. Onglet **Couverture** → la demande apparaît dans « Shifts à remplacer », avec l'urgence
3. Clique **« Affecter »**
4. Le dialogue évalue les contraintes : candidats **Disponible** / **Incompatible**
   (les incompatibles affichent le motif précis)
5. Sélectionne un candidat disponible → **Confirmer**

Attendu : « Remplacement confirmé. »

### Étape 4 — vérifier

| Vérification | Où |
|---|---|
| Le shift a changé de titulaire | Planning |
| `ShiftChange` de type `REPLACEMENT` créé | Onglet historique / `GET /operations/changes` |
| La demande a disparu de la file | Onglet Couverture |
| Le remplaçant peut pointer | QR START/END |

### Étape 5 — montrer l'absence automatique (optionnel)

Le cron tourne **toutes les 5 minutes** et marque `ABSENT` les shifts terminés sans scan. Il
ouvre alors une demande avec `source: AUTOMATIC_ABSENCE`, qui apparaît dans la file avec la
mention « Absence automatique ». C'est ce qui distingue une absence constatée d'un empêchement
déclaré.

---

## 7. Vérifier que tout est en place

### Compilation backend

```powershell
cd "chemin\vers\uswap-github"
npm run build
```

Doit se terminer **exit 0** sans erreur.

### Routes enregistrées

Démarre le backend puis ouvre `http://127.0.0.1:3000/api-docs`. Les 5 routes doivent
apparaître sous le tag **operations** :

| Méthode | Chemin |
|---|---|
| `POST` | `/operations/absences` |
| `GET` | `/operations/replacements/pending` |
| `GET` | `/operations/changes` |
| `GET` | `/operations/shifts/{shiftId}/candidates` |
| `POST` | `/operations/shifts/{shiftId}/replacement` |

### Test manuel rapide via Swagger

1. `POST /auth/login` → copie l'`accessToken`
2. Bouton **Authorize** → colle le token
3. Exécute `GET /operations/replacements/pending`

Une réponse `401` signifie que le token manque ou a expiré.
Une réponse `403` est normale pour un rôle sans droits.

---

## 8. Erreurs fréquentes

| Symptôme | Cause probable | Correction |
|---|---|---|
| Les écrans affichent des données fictives | `VITE_API_URL` absent → mode maquette | Définir `VITE_API_URL` dans `frontend/.env`, **redémarrer Vite** |
| Erreur CORS dans la console | Origine non listée dans `CORS_ORIGIN` | Utiliser `127.0.0.1:5173` ou ajouter l'origine |
| `401` sur toutes les routes | Token expiré | Se reconnecter |
| `403` sur la file de couverture | Superviseur sans station ni `UserStationScope` | Rattacher le compte à une station |
| `400` « only be declared on a published planning » | Planning en `DRAFT` | Publier le planning |
| Le seed échoue | `ADMIN_SEED_PASSWORD` < 12 caractères | Allonger le mot de passe |
| Le backend ne démarre pas | `JWT_SECRET` absent | Le définir dans `.env` |
| La file reste vide après une absence | Shift non encore terminé (cron à +5 min) | Attendre, ou tester la déclaration manuelle |

---

## 9. Points d'attention

### Ce qui n'est pas couvert par cette chaîne

- **Notifications** (étape E) : personne n'est prévenu automatiquement. Le superviseur doit
  consulter la file.
- **Dashboard** (étape F) : les statistiques ne sont pas encore exposées.
- **Nom des endpoints côté frontend** : `ReplacementQueue.tsx` ne lit pas `requestId`
  (il utilise `shiftId` comme clé React). Fonctionnel, mais deux demandes sur un même shift
  produiraient une clé dupliquée — impossible aujourd'hui grâce à l'idempotence.

### Dette technique constatée

- `AUDIT.md` **n'est pas à jour** : il liste comme « à corriger » trois points déjà corrigés
  dans le code (`req.user.userId`, CORS permissif, `RolesGuard` non défensif). Ne pas s'y fier
  comme source de vérité.
- Le commit `7286c29` contenait de la corruption de syntaxe (backticks arrachés dans
  `Planner.tsx`, ``` ``` ``` parasites dans `OperationsPage.tsx` et `supervision/types.ts`).
  Réparée dans `603617f`, mais le frontend ne compilait pas avant.
- **8 erreurs TypeScript pré-existantes** subsistent hors périmètre : `Planner.tsx` est en
  `export default` mais importé en named export par `AdminPlannerPage` / `RolePlannerPage`,
  et `auth-api.ts` utilise `Object.hasOwn` sans `lib: es2022`. Elles bloquent un `tsc`
  frontend complet (le backend, lui, compile proprement).
- Les fichiers `attendance.service.ts`, `attendance.controller.ts`,
  `scheduling-engine.service.ts` et `attendance.scheduler.ts` ont une indentation cassée.
  `npm run format` corrige, mais produit un diff volumineux.

### Sécurité — à traiter avant toute mise en ligne

- Les fichiers `.env` sont présents sur disque et ont pu être commités par le passé.
  **Faire tourner** le mot de passe PostgreSQL, `JWT_SECRET` et `ADMIN_SEED_PASSWORD`.
- Pas de rate limiting sur `login` / `forgot-password` (vulnérable au brute-force).
- La géolocalisation du pointage (`latitude`/`longitude`) n'est comparée à aucune coordonnée
  de station.