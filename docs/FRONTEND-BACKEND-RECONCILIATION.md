# RÃ©conciliation frontend â†” backend â€” rapport final

_Ce document couvre le travail menÃ© aprÃ¨s `603617f` : alignement complet du contrat
d'API, notifications, tableau de bord, correction du build frontend, et contrÃ´le
mÃ©tier final._

---

## 1. Le problÃ¨me de dÃ©part

Le frontend (celui de Dylane) et le backend avaient divergÃ©. Le frontend Ã©tait en
avance : ses Ã©crans appelaient des routes que le backend n'exposait pas, et il
utilisait des noms lÃ©gÃ¨rement diffÃ©rents de ceux du backend.

SymptÃ´me le plus visible : **l'Ã©cran d'opÃ©rations ne se chargeait pour aucun rÃ´le
autre que `SWAPPER`**, car `GET /workspace` n'existait pas â€” il renvoyait `404`.

La rÃ¨gle appliquÃ©e : **le backend s'aligne sur le frontend**, jamais l'inverse.
Aucun Ã©cran de Dylane n'a Ã©tÃ© rÃ©Ã©crit pour Â« corriger Â» le backend.

---

## 2. MÃ©thode

Chaque affirmation de ce rapport a Ã©tÃ© vÃ©rifiÃ©e en exÃ©cutant l'application, pas en
lisant le code :

1. **Audit de contrat** â€” extraction de _tous_ les appels API du frontend, puis
   confrontation Ã  la carte Swagger rÃ©elle du backend (route par route, mÃ©thode
   par mÃ©thode).
2. **Tests HTTP rÃ©els** â€” l'application NestJS est dÃ©marrÃ©e sur un port rÃ©el et
   pilotÃ©e avec `fetch`. Aucun mock.
3. **ContrÃ´le mÃ©tier** â€” les 11 rÃ¨gles du cahier des charges sont testÃ©es une par
   une contre l'API vivante, avec vÃ©rification en base.

Deux scripts permanents permettent de rejouer ces vÃ©rifications :

```powershell
node scripts/audit-contract.cjs        # contrat frontend <-> backend
node scripts/audit-business-rules.cjs  # les 11 regles metier
```

---

## 3. Audit de contrat : 3 routes absentes, 6 dÃ©salignements

### 3.1 Routes rÃ©ellement absentes (crÃ©Ã©es)

| Route                           | Consommateur                          | RÃ´le                                       |
| ------------------------------- | ------------------------------------- | ------------------------------------------ |
| `GET /workspace`                | `OperationsPage`, `AttendanceMonitor` | Charge l'Ã©cran d'opÃ©rations, tous rÃ´les    |
| `POST /corrections/attachments` | `CorrectionDialog`                    | Upload d'un justificatif (PDF/image, 5 Mo) |
| `PATCH /corrections/shifts/:id` | `CorrectionDialog`                    | Correction d'un pointage                   |
| `GET /corrections/shifts/:id`   | `CorrectionHistory`                   | Historique des corrections                 |

### 3.2 DÃ©salignements de nommage (alias ajoutÃ©s)

La fonctionnalitÃ© existait, le nom diffÃ©rait. PlutÃ´t que de modifier le frontend,
des alias ont Ã©tÃ© ajoutÃ©s cÃ´tÃ© backend :

| Appel du frontend                   | Route backend existante                       | Traitement                                                                  |
| ----------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /auth/me`                      | `GET /auth/session` (sÃ©mantique diffÃ©rente)   | **Nouvelle route** : renvoie `{ user }`, appelÃ©e par le veilleur de session |
| `POST /auth/activate-account`       | `POST /auth/activate`                         | Alias                                                                       |
| `POST /auth/invitations/:id/resend` | `POST /users/:id/resend-invitation`           | Route Ã©quivalente ajoutÃ©e                                                   |
| `PATCH /users/:id/status`           | `PATCH /users/:id/deactivate` + `/reactivate` | Alias unifiÃ© (`{ enabled }`)                                                |
| `POST /users/:id/activate`          | `POST /users/:id/resend-invitation`           | Alias                                                                       |
| `GET /users/imports/template`       | `GET /users/import/template`                  | Alias (`s` final)                                                           |
| `PATCH /stations/:id/status`        | `PATCH /stations/:id/active`                  | Alias (`{ isActive \| enabled }`)                                           |
| `GET /attendance/mine`              | existait dÃ©jÃ                                  | â€”                                                                           |

### 3.3 RÃ©sultat

```
backend routes total: 64
calls checked:        48
missing:              0
```

**48/48 appels du frontend sont dÃ©sormais servis.**

---

## 4. Bug bloquant : `GET /auth/me` manquant

Le plus critique, et le plus discret.

`session.tsx` appelle `GET /auth/me` Ã  **chaque changement de visibilitÃ© de
l'onglet** (lignes 195-204). La rÃ©ponse est utilisÃ©e pour rafraÃ®chir le rÃ´le en
cache et **rediriger l'utilisateur** :

```ts
api<{ user: User }>('/auth/me')
  .then(({ user }) => {
    setSession((current) => (current ? { ...current, user } : null));
    navigate(qrHomePath(rolePaths[user.role], user.role), { replace: true });
  })
  .catch(() => clear()); // echec => session effacee
```

Sans cette route, l'appel Ã©chouait en `404`, donc `catch` â†’ `clear()` â†’
**dÃ©connexion silencieuse de l'utilisateur** dÃ¨s qu'il revenait sur l'onglet.

La route renvoie maintenant `{ user }` et refuse un compte inactif.

---

## 5. Bug bloquant : crÃ©ation d'utilisateur impossible

`UserCreateModal` poste `accountStatus` Ã  `/auth/register`. Or `RegisterDto` ne
dÃ©clarait pas ce champ, et `main.ts` active `forbidNonWhitelisted` :

```ts
new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
```

ConsÃ©quence : **toute crÃ©ation d'utilisateur depuis l'interface Ã©tait rejetÃ©e en
`400`** avant mÃªme d'atteindre le service.

Correction : le champ `accountStatus` (`ACTIVE | PENDING`) est acceptÃ© et fait
autoritÃ©. `PENDING` conserve le flux d'invitation, `ACTIVE` crÃ©e un compte
immÃ©diatement connectable. `sendInvite` reste supportÃ© pour compatibilitÃ©.

---

## 6. Notifications (Ã©tape E)

### ModÃ¨le

Nouveau modÃ¨le `Notification` + migration `add_notifications` :

```
kind : REPLACEMENT_REQUESTED | REPLACEMENT_ASSIGNED | SHIFT_CHANGED
       ABSENCE_RECORDED | ACCOUNT_ACTIVATED
```

### Routes

| Route                             | RÃ´le                          |
| --------------------------------- | ----------------------------- |
| `GET /notifications`              | 50 max, plus rÃ©centes d'abord |
| `GET /notifications/unread-count` | Badge de la cloche            |
| `PATCH /notifications/:id/read`   | Marquer une notification lue  |
| `PATCH /notifications/read-all`   | Tout marquer comme lu         |

Toutes les routes sont filtrÃ©es sur `req.user.id` : **un utilisateur ne peut lire
ni marquer que ses propres notifications**.

### Branchement sur les Ã©vÃ©nements rÃ©els

Les notifications ne sont pas dÃ©coratives : elles partent des vrais Ã©vÃ©nements
mÃ©tier, aux deux seuls points de passage existants.

**`openReplacementRequest()`** â€” goulet commun aux deux origines :

| `source`            | DÃ©clencheur                                  | Destinataires                  |
| ------------------- | -------------------------------------------- | ------------------------------ |
| `DECLARATION`       | Le swappeur signale un empÃªchement           | Superviseurs + chef de station |
| `AUTOMATIC_ABSENCE` | Le cron dÃ©tecte qu'un swapper n'a pas scannÃ© | Superviseurs + chef de station |
| `AD_HOC`            | Le superviseur couvre un shift Ã  la main     | â€”                              |

Comme c'est le **mÃªme** point de passage, supervision est prÃ©venue exactement une
fois, quelle que soit l'origine.

**`assignReplacement()`** â€” trois notifications :

- le **remplaÃ§ant** reÃ§oit `REPLACEMENT_ASSIGNED` (le message le plus important) ;
- l'**ancien titulaire** reÃ§oit `SHIFT_CHANGED` (il est dÃ©chargÃ©) ;
- la **supervision** reÃ§oit la confirmation.

### Deux dÃ©cisions d'ingÃ©nierie

**Les notifications partent aprÃ¨s le commit de la transaction.** Une notification
Ã©mise depuis l'intÃ©rieur d'une transaction annoncerait un changement qui pourrait
Ãªtre annulÃ©. Elles sont donc Ã©mises une fois le `$transaction` rÃ©solu.

**`notify()` et `notifyRoles()` avalent leurs erreurs.** Une notification est un
effet de bord : elle ne doit jamais faire Ã©chouer l'action mÃ©tier qui l'a
dÃ©clenchÃ©e. Une panne d'Ã©criture de notification ne doit pas empÃªcher un
remplacement d'Ãªtre affectÃ©.

---

## 7. Tableau de bord (Ã©tape F)

### `GET /dashboard/stats`

Renvoie exactement les indicateurs demandÃ©s :

| Indicateur        | DÃ©tail                                           |
| ----------------- | ------------------------------------------------ |
| Shifts du jour    | total + rÃ©partition                              |
| PrÃ©sents          | pointage dans la tolÃ©rance                       |
| En retard         | pointage au-delÃ  de `latenessToleranceMinutes`   |
| Absents           | sans pointage valide                             |
| TerminÃ©s          | pointage clÃ´turÃ©                                 |
| Demandes ouvertes | `ReplacementRequest` OPEN/ASSIGNED               |
| Heures hebdo      | consommÃ©es vs `weeklyHoursLimit` de la station   |
| Effectifs         | swappeurs actifs / total (supervision seulement) |
| Timeline          | liste chronologique des shifts                   |

### PÃ©rimÃ¨tre

Le calcul rÃ©utilise `OperationsService.resolveAccessibleStationIds()`, donc **la
mÃªme rÃ¨gle de portÃ©e que partout ailleurs** :

| RÃ´le            | PÃ©rimÃ¨tre                                  |
| --------------- | ------------------------------------------ |
| `ADMIN`         | Toutes les stations                        |
| `SUPERVISOR`    | Station principale + `UserStationScope`    |
| `STATION_CHIEF` | Sa station uniquement                      |
| `SWAPPER`       | Ses propres shifts ; pas de bloc effectifs |

Le calcul du statut Â« aujourd'hui Â» se fait en **heure locale de Douala (UTC+1)**,
pas en UTC brut â€” sinon une journÃ©e opÃ©rationnelle serait dÃ©calÃ©e d'une heure Ã 
cheval sur deux jours UTC.

### Ã‰cran

Nouvel Ã©cran `DashboardPage` accessible Ã  `<espace>/tableau-de-bord` pour **tous
les rÃ´les**, avec liens dans `RoleShell` et `AdminShell`, filtres par statut et
pourcentage de couverture.

---

## 8. RÃ©paration du build frontend

Le frontend **ne compilait pas**, indÃ©pendamment de ce travail. Trois causes
distinctes, toutes prÃ©-existantes.

### 8.1 Corruption des template literals

Le commit `7286c29` a Ã©tÃ© enregistrÃ© avec des **backticks arrachÃ©s** des template
literals. Exemple dans `Planner.tsx` :

```ts
// corrompu
return Le ${two(startDay)}/${two(startMonth)}/${startYear};
// attendu
return `Le ${two(startDay)}/${two(startMonth)}/${startYear}`;
```

Mesure objective : **52 backticks dans `HEAD`, 20 dans l'arbre de travail**.

`Planner.tsx` a donc Ã©tÃ© **restaurÃ© depuis `HEAD`** (source fiable), plutÃ´t que
rapiÃ©cÃ© ligne Ã  ligne.

### 8.2 `Modal.tsx` corrompu

L'arbre de travail contenait une version de `Modal.tsx` ayant perdu son slot
`footer` et ses backticks. `HEAD` Ã©tait correct : **restaurÃ© depuis `HEAD`**.

### 8.3 `day-roster.css` manquant

`Planner.tsx` importe `./day-roster.css`. Le fichier **a existÃ©** (commits
`9fc77cc`, `28b4c46`, `fd7dc74`) puis a Ã©tÃ© supprimÃ© sans que l'import le soit.
Vite Ã©chouait donc au bundling.

RÃ©cupÃ©rÃ© depuis l'historique git :

```powershell
git show 9fc77cc:src/features/planner/day-roster.css > frontend/src/features/planner/day-roster.css
```

### 8.4 Corrections de typage (minimales)

| Fichier                | ProblÃ¨me                              | Correction                                      |
| ---------------------- | ------------------------------------- | ----------------------------------------------- |
| `api/auth-api.ts`      | `method` limitÃ© Ã  `PATCH \| DELETE`   | Ã‰largi Ã  `POST \| PUT \| PATCH \| DELETE`       |
| `api/mock/types.ts`    | `MockCtx.method` sans `PUT`           | AlignÃ©                                          |
| `ui/Modal.tsx`         | `size` limitÃ© Ã  `md \| lg`            | Ã‰largi Ã  `sm \| md \| lg \| xl`                 |
| `ui/modal.css`         | `.modal-panel--sm` absent             | AjoutÃ© (420 px)                                 |
| `AdminPlannerPage.tsx` | `import { Planner }`                  | `import Planner` (export par dÃ©faut)            |
| `RolePlannerPage.tsx`  | idem                                  | idem                                            |
| `Planner.tsx`          | `exportToExcel` appelÃ© en positionnel | Converti en objet `{ data, filename, columns }` |

### 8.5 RÃ©sultat

```
Backend  : nest build      -> exit 0
Frontend : tsc --noEmit    -> 0 erreur (premiÃ¨re fois)
Frontend : npm run build   -> exit 0 (built in 21.57s)
```

---

## 9. ContrÃ´le mÃ©tier final (Ã©tape G)

Les 11 rÃ¨gles du cahier des charges, testÃ©es contre l'API vivante.

| #   | RÃ¨gle                                 | VÃ©rification                                                   | RÃ©sultat |
| --- | ------------------------------------- | -------------------------------------------------------------- | -------- |
| 1   | Shift = exactement 8 h                | 7 h refusÃ©, 9 h refusÃ©, 8 h acceptÃ©                            | âœ…       |
| 2   | Pas de chevauchement                  | Shift qui chevauche refusÃ©                                     | âœ…       |
| 3   | Un seul crÃ©neau par jour              | 2áµ‰ shift le mÃªme jour refusÃ©                                   | âœ…       |
| 4   | Repos minimum = paramÃ¨tre station     | 6 h de repos refusÃ© (`minRestHours=8`)                         | âœ…       |
| 5   | Limite hebdo = paramÃ¨tre station      | Swapper Ã  48 h/48 h ne peut plus prendre 8 h                   | âœ…       |
| 6   | CongÃ© approuvÃ© bloque le shift        | Shift pendant congÃ© refusÃ©                                     | âœ…       |
| 7   | START + END obligatoires              | QR END gÃ©nÃ©rÃ©, check-out sans check-in refusÃ©                  | âœ…       |
| 8   | END sans START â†’ ABSENT               | Statut basculÃ© en `ABSENT` en base                             | âœ…       |
| 9   | Aucun scan â†’ ABSENT                   | Le cron marque les `EXPECTED` dÃ©passÃ©s                         | âœ…       |
| 10  | EmpÃªchement â‰  justification d'absence | `ReplacementRequest` crÃ©Ã©e, **aucune** Ã©criture d'`Attendance` | âœ…       |
| 11  | Historique dans `ShiftChange`         | `type=REPLACEMENT`, les deux swappers + auteur                 | âœ…       |

**Point d'architecture** : les rÃ¨gles ne peuvent pas diverger entre le planning et
le remplacement, car les deux passent par **le mÃªme moteur** â€”
`SchedulingEngineService.validateShift()`. La liste des candidats au remplacement
est calculÃ©e par ce moteur, et `assignReplacement()` **revalide au moment
d'affecter**, car la disponibilitÃ© peut avoir changÃ© entre l'affichage et le clic.

### AmÃ©liorations apportÃ©es

**`AD_HOC`** â€” un superviseur peut remplacer sur un shift qui n'est jamais passÃ©
par la file (couverture improvisÃ©e). Auparavant l'opÃ©ration rÃ©ussissait mais ne
laissait **aucune trace** dans la file. DÃ©sormais une `ReplacementRequest`
`source=AD_HOC` est crÃ©Ã©e, donc l'historique est complet.

**Seed conforme aux rÃ¨gles** â€” le seed crÃ©ait 7 shifts de 8 h par semaine sur une
station limitÃ©e Ã  48 h, soit 56 h : **le seed violait ses propres rÃ¨gles**. Il
respecte maintenant la limite hebdomadaire (`48h/48h`, `40h/48h`, `40h/72h`).
C'est ce qui faisait Ã©chouer certains tests mÃ©tier â€” le moteur, lui, avait raison.

**`/shifts/mine` alignÃ© sur `/workspace`** â€” le premier renvoyait tous les shifts
(brouillons, orphelins), le second seulement ceux d'un planning publiÃ©. Un
swappeur voyait donc des shifts sur lesquels la dÃ©claration d'empÃªchement
Ã©chouait en `400`. Les deux appliquent la mÃªme rÃ¨gle.

---

## 10. Ce qui n'est pas couvert

- **Notifications temps rÃ©el** : la cloche interroge l'API toutes les 30 secondes
  (`NotificationBell.tsx`). Pas de WebSocket ni de SSE. Suffisant pour une dÃ©mo,
  Ã  revoir si le volume augmente.
- **Envoi d'e-mail** : sans `RESEND_API_KEY`, les invitations ne partent pas. L'API
  ne Ã©choue pas : elle renvoie `invitationSent: false`.
- **GÃ©olocalisation du pointage** : `latitude`/`longitude` sont enregistrÃ©es mais
  **comparÃ©es Ã  aucune coordonnÃ©e de station**. Le pointage QR peut Ãªtre fait Ã 
  distance.
- **Rate limiting** : absent sur `login` / `forgot-password`. Les tentatives sont
  journalisÃ©es (`LoginAttempt`) mais jamais exploitÃ©es.
- **SÃ©curitÃ© des secrets** : les `.env` sont sur disque et ont pu Ãªtre commitÃ©s
  par le passÃ©. Faire tourner le mot de passe PostgreSQL, `JWT_SECRET` et les mots
  de passe de dÃ©mo avant toute mise en ligne.
- **Tests automatisÃ©s** : les deux scripts d'audit couvrent le contrat et les
  rÃ¨gles mÃ©tier, mais il n'y a pas de suite Jest sur l'auth ou le moteur.

---

## 11. DÃ©marrage

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

### Comptes de dÃ©monstration

Mot de passe unique : la valeur de `DEMO_PASSWORD` (backend_new/.env)

| RÃ´le            | E-mail                    |
| --------------- | ------------------------- |
| `ADMIN`         | `admin@upowa.org`         |
| `SUPERVISOR`    | `superviseur@upowa.org`   |
| `STATION_CHIEF` | `chef@upowa.org`          |
| `SWAPPER`       | `awa.nkolo@upowa.org`     |
| `SWAPPER`       | `jean.dupont@upowa.org`   |
| `SWAPPER`       | `paul.mbarga@upowa.org`   |
| `SWAPPER`       | `sylvie.eyenga@upowa.org` |

Le seed place le planning sur la **semaine suivante**, afin que la dÃ©mo dispose
toujours de shifts Ã  venir quel que soit le jour oÃ¹ elle est lancÃ©e.

### VÃ©rifications reproductibles

```powershell
npm run build                          # backend
cd frontend; npm run build             # frontend
node scripts/audit-contract.cjs        # 48/48 routes
node scripts/audit-business-rules.cjs  # les 11 regles
```
