# Réconciliation frontend ↔ backend — rapport final

_Ce document couvre le travail mené après `603617f` : alignement complet du contrat
d'API, notifications, tableau de bord, correction du build frontend, et contrôle
métier final._

---

## 1. Le problème de départ

Le frontend (celui de Dylane) et le backend avaient divergé. Le frontend était en
avance : ses écrans appelaient des routes que le backend n'exposait pas, et il
utilisait des noms légèrement différents de ceux du backend.

Symptôme le plus visible : **l'écran d'opérations ne se chargeait pour aucun rôle
autre que `SWAPPER`**, car `GET /workspace` n'existait pas — il renvoyait `404`.

La règle appliquée : **le backend s'aligne sur le frontend**, jamais l'inverse.
Aucun écran de Dylane n'a été réécrit pour « corriger » le backend.

---

## 2. Méthode

Chaque affirmation de ce rapport a été vérifiée en exécutant l'application, pas en
lisant le code :

1. **Audit de contrat** — extraction de *tous* les appels API du frontend, puis
   confrontation à la carte Swagger réelle du backend (route par route, méthode
   par méthode).
2. **Tests HTTP réels** — l'application NestJS est démarrée sur un port réel et
   pilotée avec `fetch`. Aucun mock.
3. **Contrôle métier** — les 11 règles du cahier des charges sont testées une par
   une contre l'API vivante, avec vérification en base.

Deux scripts permanents permettent de rejouer ces vérifications :

```powershell
node scripts/audit-contract.cjs        # contrat frontend <-> backend
node scripts/audit-business-rules.cjs  # les 11 regles metier
```

---

## 3. Audit de contrat : 3 routes absentes, 6 désalignements

### 3.1 Routes réellement absentes (créées)

| Route | Consommateur | Rôle |
|---|---|---|
| `GET /workspace` | `OperationsPage`, `AttendanceMonitor` | Charge l'écran d'opérations, tous rôles |
| `POST /corrections/attachments` | `CorrectionDialog` | Upload d'un justificatif (PDF/image, 5 Mo) |
| `PATCH /corrections/shifts/:id` | `CorrectionDialog` | Correction d'un pointage |
| `GET /corrections/shifts/:id` | `CorrectionHistory` | Historique des corrections |

### 3.2 Désalignements de nommage (alias ajoutés)

La fonctionnalité existait, le nom différait. Plutôt que de modifier le frontend,
des alias ont été ajoutés côté backend :

| Appel du frontend | Route backend existante | Traitement |
|---|---|---|
| `GET /auth/me` | `GET /auth/session` (sémantique différente) | **Nouvelle route** : renvoie `{ user }`, appelée par le veilleur de session |
| `POST /auth/activate-account` | `POST /auth/activate` | Alias |
| `POST /auth/invitations/:id/resend` | `POST /users/:id/resend-invitation` | Route équivalente ajoutée |
| `PATCH /users/:id/status` | `PATCH /users/:id/deactivate` + `/reactivate` | Alias unifié (`{ enabled }`) |
| `POST /users/:id/activate` | `POST /users/:id/resend-invitation` | Alias |
| `GET /users/imports/template` | `GET /users/import/template` | Alias (`s` final) |
| `PATCH /stations/:id/status` | `PATCH /stations/:id/active` | Alias (`{ isActive \| enabled }`) |
| `GET /attendance/mine` | existait déjà | — |

### 3.3 Résultat

```
backend routes total: 64
calls checked:        48
missing:              0
```

**48/48 appels du frontend sont désormais servis.**

---

## 4. Bug bloquant : `GET /auth/me` manquant

Le plus critique, et le plus discret.

`session.tsx` appelle `GET /auth/me` à **chaque changement de visibilité de
l'onglet** (lignes 195-204). La réponse est utilisée pour rafraîchir le rôle en
cache et **rediriger l'utilisateur** :

```ts
api<{ user: User }>("/auth/me")
  .then(({ user }) => {
    setSession((current) => (current ? { ...current, user } : null));
    navigate(qrHomePath(rolePaths[user.role], user.role), { replace: true });
  })
  .catch(() => clear());   // echec => session effacee
```

Sans cette route, l'appel échouait en `404`, donc `catch` → `clear()` →
**déconnexion silencieuse de l'utilisateur** dès qu'il revenait sur l'onglet.

La route renvoie maintenant `{ user }` et refuse un compte inactif.

---

## 5. Bug bloquant : création d'utilisateur impossible

`UserCreateModal` poste `accountStatus` à `/auth/register`. Or `RegisterDto` ne
déclarait pas ce champ, et `main.ts` active `forbidNonWhitelisted` :

```ts
new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
```

Conséquence : **toute création d'utilisateur depuis l'interface était rejetée en
`400`** avant même d'atteindre le service.

Correction : le champ `accountStatus` (`ACTIVE | PENDING`) est accepté et fait
autorité. `PENDING` conserve le flux d'invitation, `ACTIVE` crée un compte
immédiatement connectable. `sendInvite` reste supporté pour compatibilité.

---

## 6. Notifications (étape E)

### Modèle

Nouveau modèle `Notification` + migration `add_notifications` :

```
kind : REPLACEMENT_REQUESTED | REPLACEMENT_ASSIGNED | SHIFT_CHANGED
       ABSENCE_RECORDED | ACCOUNT_ACTIVATED
```

### Routes

| Route | Rôle |
|---|---|
| `GET /notifications` | 50 max, plus récentes d'abord |
| `GET /notifications/unread-count` | Badge de la cloche |
| `PATCH /notifications/:id/read` | Marquer une notification lue |
| `PATCH /notifications/read-all` | Tout marquer comme lu |

Toutes les routes sont filtrées sur `req.user.id` : **un utilisateur ne peut lire
ni marquer que ses propres notifications**.

### Branchement sur les événements réels

Les notifications ne sont pas décoratives : elles partent des vrais événements
métier, aux deux seuls points de passage existants.

**`openReplacementRequest()`** — goulet commun aux deux origines :

| `source` | Déclencheur | Destinataires |
|---|---|---|
| `DECLARATION` | Le swappeur signale un empêchement | Superviseurs + chef de station |
| `AUTOMATIC_ABSENCE` | Le cron détecte qu'un swapper n'a pas scanné | Superviseurs + chef de station |
| `AD_HOC` | Le superviseur couvre un shift à la main | — |

Comme c'est le **même** point de passage, supervision est prévenue exactement une
fois, quelle que soit l'origine.

**`assignReplacement()`** — trois notifications :

- le **remplaçant** reçoit `REPLACEMENT_ASSIGNED` (le message le plus important) ;
- l'**ancien titulaire** reçoit `SHIFT_CHANGED` (il est déchargé) ;
- la **supervision** reçoit la confirmation.

### Deux décisions d'ingénierie

**Les notifications partent après le commit de la transaction.** Une notification
émise depuis l'intérieur d'une transaction annoncerait un changement qui pourrait
être annulé. Elles sont donc émises une fois le `$transaction` résolu.

**`notify()` et `notifyRoles()` avalent leurs erreurs.** Une notification est un
effet de bord : elle ne doit jamais faire échouer l'action métier qui l'a
déclenchée. Une panne d'écriture de notification ne doit pas empêcher un
remplacement d'être affecté.

---

## 7. Tableau de bord (étape F)

### `GET /dashboard/stats`

Renvoie exactement les indicateurs demandés :

| Indicateur | Détail |
|---|---|
| Shifts du jour | total + répartition |
| Présents | pointage dans la tolérance |
| En retard | pointage au-delà de `latenessToleranceMinutes` |
| Absents | sans pointage valide |
| Terminés | pointage clôturé |
| Demandes ouvertes | `ReplacementRequest` OPEN/ASSIGNED |
| Heures hebdo | consommées vs `weeklyHoursLimit` de la station |
| Effectifs | swappeurs actifs / total (supervision seulement) |
| Timeline | liste chronologique des shifts |

### Périmètre

Le calcul réutilise `OperationsService.resolveAccessibleStationIds()`, donc **la
même règle de portée que partout ailleurs** :

| Rôle | Périmètre |
|---|---|
| `ADMIN` | Toutes les stations |
| `SUPERVISOR` | Station principale + `UserStationScope` |
| `STATION_CHIEF` | Sa station uniquement |
| `SWAPPER` | Ses propres shifts ; pas de bloc effectifs |

Le calcul du statut « aujourd'hui » se fait en **heure locale de Douala (UTC+1)**,
pas en UTC brut — sinon une journée opérationnelle serait décalée d'une heure à
cheval sur deux jours UTC.

### Écran

Nouvel écran `DashboardPage` accessible à `<espace>/tableau-de-bord` pour **tous
les rôles**, avec liens dans `RoleShell` et `AdminShell`, filtres par statut et
pourcentage de couverture.

---

## 8. Réparation du build frontend

Le frontend **ne compilait pas**, indépendamment de ce travail. Trois causes
distinctes, toutes pré-existantes.

### 8.1 Corruption des template literals

Le commit `7286c29` a été enregistré avec des **backticks arrachés** des template
literals. Exemple dans `Planner.tsx` :

```ts
// corrompu
return Le ${two(startDay)}/${two(startMonth)}/${startYear};
// attendu
return `Le ${two(startDay)}/${two(startMonth)}/${startYear}`;
```

Mesure objective : **52 backticks dans `HEAD`, 20 dans l'arbre de travail**.

`Planner.tsx` a donc été **restauré depuis `HEAD`** (source fiable), plutôt que
rapiécé ligne à ligne.

### 8.2 `Modal.tsx` corrompu

L'arbre de travail contenait une version de `Modal.tsx` ayant perdu son slot
`footer` et ses backticks. `HEAD` était correct : **restauré depuis `HEAD`**.

### 8.3 `day-roster.css` manquant

`Planner.tsx` importe `./day-roster.css`. Le fichier **a existé** (commits
`9fc77cc`, `28b4c46`, `fd7dc74`) puis a été supprimé sans que l'import le soit.
Vite échouait donc au bundling.

Récupéré depuis l'historique git :

```powershell
git show 9fc77cc:src/features/planner/day-roster.css > frontend/src/features/planner/day-roster.css
```

### 8.4 Corrections de typage (minimales)

| Fichier | Problème | Correction |
|---|---|---|
| `api/auth-api.ts` | `method` limité à `PATCH \| DELETE` | Élargi à `POST \| PUT \| PATCH \| DELETE` |
| `api/mock/types.ts` | `MockCtx.method` sans `PUT` | Aligné |
| `ui/Modal.tsx` | `size` limité à `md \| lg` | Élargi à `sm \| md \| lg \| xl` |
| `ui/modal.css` | `.modal-panel--sm` absent | Ajouté (420 px) |
| `AdminPlannerPage.tsx` | `import { Planner }` | `import Planner` (export par défaut) |
| `RolePlannerPage.tsx` | idem | idem |
| `Planner.tsx` | `exportToExcel` appelé en positionnel | Converti en objet `{ data, filename, columns }` |

### 8.5 Résultat

```
Backend  : nest build      -> exit 0
Frontend : tsc --noEmit    -> 0 erreur (première fois)
Frontend : npm run build   -> exit 0 (built in 21.57s)
```

---

## 9. Contrôle métier final (étape G)

Les 11 règles du cahier des charges, testées contre l'API vivante.

| # | Règle | Vérification | Résultat |
|---|---|---|---|
| 1 | Shift = exactement 8 h | 7 h refusé, 9 h refusé, 8 h accepté | ✅ |
| 2 | Pas de chevauchement | Shift qui chevauche refusé | ✅ |
| 3 | Un seul créneau par jour | 2ᵉ shift le même jour refusé | ✅ |
| 4 | Repos minimum = paramètre station | 6 h de repos refusé (`minRestHours=8`) | ✅ |
| 5 | Limite hebdo = paramètre station | Swapper à 48 h/48 h ne peut plus prendre 8 h | ✅ |
| 6 | Congé approuvé bloque le shift | Shift pendant congé refusé | ✅ |
| 7 | START + END obligatoires | QR END généré, check-out sans check-in refusé | ✅ |
| 8 | END sans START → ABSENT | Statut basculé en `ABSENT` en base | ✅ |
| 9 | Aucun scan → ABSENT | Le cron marque les `EXPECTED` dépassés | ✅ |
| 10 | Empêchement ≠ justification d'absence | `ReplacementRequest` créée, **aucune** écriture d'`Attendance` | ✅ |
| 11 | Historique dans `ShiftChange` | `type=REPLACEMENT`, les deux swappers + auteur | ✅ |

**Point d'architecture** : les règles ne peuvent pas diverger entre le planning et
le remplacement, car les deux passent par **le même moteur** —
`SchedulingEngineService.validateShift()`. La liste des candidats au remplacement
est calculée par ce moteur, et `assignReplacement()` **revalide au moment
d'affecter**, car la disponibilité peut avoir changé entre l'affichage et le clic.

### Améliorations apportées

**`AD_HOC`** — un superviseur peut remplacer sur un shift qui n'est jamais passé
par la file (couverture improvisée). Auparavant l'opération réussissait mais ne
laissait **aucune trace** dans la file. Désormais une `ReplacementRequest`
`source=AD_HOC` est créée, donc l'historique est complet.

**Seed conforme aux règles** — le seed créait 7 shifts de 8 h par semaine sur une
station limitée à 48 h, soit 56 h : **le seed violait ses propres règles**. Il
respecte maintenant la limite hebdomadaire (`48h/48h`, `40h/48h`, `40h/72h`).
C'est ce qui faisait échouer certains tests métier — le moteur, lui, avait raison.

**`/shifts/mine` aligné sur `/workspace`** — le premier renvoyait tous les shifts
(brouillons, orphelins), le second seulement ceux d'un planning publié. Un
swappeur voyait donc des shifts sur lesquels la déclaration d'empêchement
échouait en `400`. Les deux appliquent la même règle.

---

## 10. Ce qui n'est pas couvert

- **Notifications temps réel** : la cloche interroge l'API toutes les 30 secondes
  (`NotificationBell.tsx`). Pas de WebSocket ni de SSE. Suffisant pour une démo,
  à revoir si le volume augmente.
- **Envoi d'e-mail** : sans `RESEND_API_KEY`, les invitations ne partent pas. L'API
  ne échoue pas : elle renvoie `invitationSent: false`.
- **Géolocalisation du pointage** : `latitude`/`longitude` sont enregistrées mais
  **comparées à aucune coordonnée de station**. Le pointage QR peut être fait à
  distance.
- **Rate limiting** : absent sur `login` / `forgot-password`. Les tentatives sont
  journalisées (`LoginAttempt`) mais jamais exploitées.
- **Sécurité des secrets** : les `.env` sont sur disque et ont pu être commités
  par le passé. Faire tourner le mot de passe PostgreSQL, `JWT_SECRET` et les mots
  de passe de démo avant toute mise en ligne.
- **Tests automatisés** : les deux scripts d'audit couvrent le contrat et les
  règles métier, mais il n'y a pas de suite Jest sur l'auth ou le moteur.

---

## 11. Démarrage

```powershell
$env:Path += ";C:\Program Files\nodejs;C:\Program Files\Git\cmd"
cd "uswap-github"

npm install
npx prisma migrate deploy
npx prisma generate
npm run seed          # idempotent, relancable sans risque

npm run start:dev     # terminal 1
cd frontend; npm install; npm run dev   # terminal 2
```

Ouvrir **`http://127.0.0.1:5173`** (pas `localhost` : voir la note CORS).

### Comptes de démonstration

Mot de passe unique : `Uswap2026!Demo`

| Rôle | E-mail |
|---|---|
| `ADMIN` | `admin@upowa.org` |
| `SUPERVISOR` | `superviseur@upowa.org` |
| `STATION_CHIEF` | `chef@upowa.org` |
| `SWAPPER` | `awa.nkolo@upowa.org` |
| `SWAPPER` | `jean.dupont@upowa.org` |
| `SWAPPER` | `paul.mbarga@upowa.org` |
| `SWAPPER` | `sylvie.eyenga@upowa.org` |

Le seed place le planning sur la **semaine suivante**, afin que la démo dispose
toujours de shifts à venir quel que soit le jour où elle est lancée.

### Vérifications reproductibles

```powershell
npm run build                          # backend
cd frontend; npm run build             # frontend
node scripts/audit-contract.cjs        # 48/48 routes
node scripts/audit-business-rules.cjs  # les 11 regles
```