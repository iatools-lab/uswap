# Technical Audit — `uswap-github` (English)

> For the French version, see [AUDIT.md](./AUDIT.md).

_Audit performed from the current state of the repository._

## 1. Overview

`uswap-github` is a **swapping team planning and tracking** application with:

- **Backend**: NestJS 11 + Prisma 6 + PostgreSQL + JWT (Passport), Swagger.
- **Frontend**: React 19 + Vite 6 + React Router 7, with a built-in **mock mode** that answers without a backend when `VITE_API_URL` is not set.

Notable structure:

```
uswap-github/
  src/            NestJS backend (auth, users, stations, shifts, planning,
                  scheduling, attendance, leave, prisma)
  prisma/         schema.prisma + 15 migrations + seed.ts
  frontend/       React/Vite application
  dylane-temp/    copy/backup of an earlier frontend version (to be removed)
  test/           Jest e2e (default template)
```

---

## 2. Critical issues

### 2.1 🔴 Blocking bug: `req.user.userId` does not exist (leave requests)

`src/leave/leave.controller.ts` reads `req.user.userId`:

```ts
@Roles(Role.SWAPPER)
@Post()
create(@Request() req, @Body() dto: CreateLeaveRequestDto) {
  return this.leaveService.create(req.user.userId, dto);   // ❌
}

@Get('mine')
findMine(@Request() req) {
  return this.leaveService.findMine(req.user.userId);      // ❌
}
```

But `JwtStrategy.validate()` returns `{ id, email, role, exp }` (the field is **`id`**, not `userId`).

**Consequences:**
- Every leave request creation passes `userId = undefined` → Prisma failure (FK) or invalid record.
- `GET /leave-requests/mine` always returns an empty list.

**Fix:** replace `req.user.userId` with `req.user.id` in both places.

### 2.2 🔴 Secrets committed to the repository

The real `.env` file **is present at the project root** (plus `frontend/.env` and `frontend.env`). It contains:

- `DATABASE_URL` with the **Postgres password in clear text** (`postgres:danielle1234@@@@`).
- `JWT_SECRET` with a real value (therefore forgeable if the repo is public).
- `ADMIN_SEED_PASSWORD="ChangeMoiRapidement123"`.

`.gitignore` does list `.env` / `.env.*`, but these files **still exist** in the delivered tree — a sign they may have been committed before `.gitignore` was added (once tracked, `.gitignore` does not "untrack" a file).

**Actions:**
1. Remove `.env`, `frontend/.env`, `frontend.env` from git tracking (`git rm --cached ...`).
2. **Rotate** the Postgres password, `JWT_SECRET`, and the admin password.
3. Purge the git history if the repository was shared.

### 2.3 🔴 Stray files committed at the root

The root folder contains files that should not be there:

| File | Nature |
|---|---|
| `cdshcdsmcsv` | output of `less`/a man page ("SUMMARY OF LESS COMMANDS") |
| `git status` | redirected text output of `git status` |
| `ntent tsconfig.build.json` | **a pasted git diff** in a file with a corrupted name ("ntent" = fragment of "content") |
| `pi.py` | empty file, misleading name |
| `frontend.env` | duplicate of `frontend/.env`, malformed name |

These artifacts reveal accidental copy/paste (terminal redirected to a file, diff saved by mistake). To be removed.

### 2.4 🔴 `dylane-temp/` folder: an old frontend version

`dylane-temp/` contains a **complete and obsolete copy** of the frontend (mock API, features, CSS…). It is a major source of confusion: two front-end codebases, only one of which is real. It is excluded from `tsconfig`, but it remains a maintenance and leak risk (it may contain demo data, gateways, etc.). To be removed from the repo.

---

## 3. Security

### 3.1 Solid points ✅

The authentication module is generally well designed:

- Passwords hashed with **bcrypt (12 rounds)**.
- **Opaque refresh tokens** (40 bytes) stored **hashed with SHA-256**, with rotation and reuse detection (deletion + `count !== 1`).
- **`tokenVersion`** incremented → invalidates all sessions on password reset, logout, role change, and (de)activation.
- **Reset / invitation tokens** hashed, with limited lifetime (15 min / 48 h).
- `forgotPassword` returns a **generic message** (protection against account enumeration).
- Global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, `transform`.
- **Guards** `JwtAuthGuard` + `RolesGuard` applied at controller level, `@Roles()` per route.

### 3.2 Points to fix ⚠️

1. **No rate limiting on `login` / `forgot-password`.** Attempts are logged (`LoginAttempt`) but **never used**: no rate limiting, no lockout after N failures. Vulnerable to brute force. → Add `@nestjs/throttler` and/or lock out after X failures in a given window.
2. **Permissive CORS by default.** `origin: corsOrigin ? [...] : true`: if `CORS_ORIGIN` is missing, **all origins** are accepted with `credentials: true`. → Deny by default or fail at startup if not configured.
3. **`RolesGuard` is not defensive.** If no role is required, it returns `true` without checking that a user is present. Today the controllers always combine both guards, but a route with `RolesGuard` alone would become public. → Return `false` when `!user`.
4. **Attendance geolocation is not verified.** `check-in`/`check-out` receive `latitude`/`longitude` but never compare them to **any** station coordinates (`Station.latitude/longitude` exist). QR check-in can therefore be done remotely with no control.
5. **No `helmet`** and no explicit payload size limit; CSV upload accepted with no server-side type/size check.
6. **`@typescript-eslint/no-explicit-any` is disabled** and several controller "DTOs" (`attendance`) are typed inline with `any` (`@Req() req: any`) — no validation of those request bodies (no class-validator DTO for `attendance`), unlike the rest of the code.

---

## 4. Architecture & code quality

### 4.1 What is good ✅

- Clean and consistent **module/controller/service/DTO** split across the whole backend.
- **Well-modeled Prisma schema** (relevant indexes, `onDelete`, enums, `@@unique` constraints).
- `SchedulingEngineService`: clear rules engine (exact duration, overlap, one shift/day, minimum rest, weekly limit, leave conflict) — a good business core.
- Frontend: a real **CSS design system**, fine-grained session expiration handling (idle timeout, refresh, multi-tab BroadcastChannel), PWA (manifest + service worker + offline page).

### 4.2 Problems ⚠️

1. **Inconsistent formatting on recently modified files.** `attendance.service.ts`, `attendance.controller.ts`, `scheduling-engine.service.ts`, `attendance.scheduler.ts` have **broken indentation** (zero nested indent) compared to the rest (Prettier 2 spaces). The `prettier/prettier` lint rule set to `error` will fail on them. → Run `npm run format`.
2. **Tests almost non-existent.** Only `app.controller.spec.ts` ("Hello World") and `app.e2e-spec.ts` (default Nest template) exist. **No tests** on auth, the scheduling engine, QR attendance, or permissions. This is the biggest debt for such a sensitive domain.
3. **`README.md` = default NestJS template**: no project documentation (install, env vars, roles, endpoints, how the frontend mock works).
4. **Fragile `SANITIZE`**: `sanitizeUser(user: any)` strips sensitive fields manually (`void password`…). Prefer an explicit Prisma `select` (like `SAFE_SELECT` in `users.service.ts`, which is correct).
5. **`LeaveApiClient`**: `fetch` with no timeout or auth; silent degradation (`return null`). Acceptable for a stub, but should be framed if the leave API becomes real.
6. **`attendances` return swappers' `email`/`phoneNumber`** in several endpoints (supervisor/admin only — fine on permissions, but watch it for GDPR).

---

## 5. Dependencies & hygiene

- **Production-ready** and consistent versions (Nest 11, React 19, Vite 6, TS 5.x).
- ⚠️ `xlsx@^0.18.5` (frontend): the public npm version is known for **CVEs** (prototype pollution / ReDoS) and is no longer published on the official npm registry by SheetJS. If Excel import is sensitive, migrate to a maintained alternative or the official SheetJS distribution.
- `frontend/package.json` is **minified onto a single line** (hard to read / diff).
- No `.nvmrc`/`engines`: the Node version is not pinned.

---

## 6. Prioritized summary

| Priority | Action | File(s) |
|---|---|---|
| 🔴 P0 | Fix `req.user.userId` → `req.user.id` | `src/leave/leave.controller.ts` |
| 🔴 P0 | Remove the `.env` files from the repo + **rotate** secrets | `.env`, `frontend/.env`, `frontend.env` |
| 🔴 P0 | Delete the stray files | `cdshcdsmcsv`, `git status`, `ntent tsconfig.build.json`, `pi.py`, `frontend.env` |
| 🟠 P1 | Delete `dylane-temp/` (old frontend) | `dylane-temp/` |
| 🟠 P1 | Add rate limiting on auth | `auth` + `throttler` |
| 🟠 P1 | Harden CORS by default (deny if not configured) | `src/main.ts` |
| 🟡 P2 | Prettier-reformat the unindented files | `attendance/**`, `scheduling/**` |
| 🟡 P2 | Verify attendance geolocation vs `Station.lat/lng` | `attendance.service.ts` |
| 🟡 P2 | Add tests (auth, scheduling, permissions) | `*.spec.ts` |
| 🟢 P3 | Rewrite the `README` | `README.md` |
| 🟢 P3 | Make `RolesGuard` defensive (`false` if `!user`) | `src/auth/roles.guard.ts` |
| 🟢 P3 | Evaluate/update `xlsx` | `frontend/package.json` |

---

## 7. Conclusion

The **business core is solid** — a careful data model, a complete scheduling engine, and a well-thought-out authentication module (refresh token rotation, `tokenVersion`, hashed tokens). The problems are mostly about **repository hygiene** (committed secrets and stray files, `dylane-temp/`), **one blocking bug** on leave requests, and a few **security hardenings** (rate limiting, CORS, geolocation). Once P0/P1 are handled, the project moves up a level.

---
---

# Audit technique — projet `uswap-github` (Français)

> Pour la version anglaise, voir [AUDIT.en.md](./AUDIT.en.md).

_Audit réalisé à partir de l'état courant du dépôt._

## 1. Vue d'ensemble

`uswap-github` est une application de **planification et suivi d'équipes de swapping** avec :

- **Backend** : NestJS 11 + Prisma 6 + PostgreSQL + JWT (Passport), Swagger.
- **Frontend** : React 19 + Vite 6 + React Router 7, avec un **mode maquette (mock)** intégré qui répond sans backend quand `VITE_API_URL` n'est pas défini.

Structure notable :

```
uswap-github/
  src/            backend NestJS (auth, users, stations, shifts, planning,
                  scheduling, attendance, leave, prisma)
  prisma/         schema.prisma + 15 migrations + seed.ts
  frontend/       application React/Vite
  dylane-temp/    copie/backup d'une version antérieure du frontend (à supprimer)
  test/           e2e Jest (template par défaut)
```

---

## 2. Problèmes critiques

### 2.1 🔴 Bug bloquant : `req.user.userId` n'existe pas (congés)

`src/leave/leave.controller.ts` lit `req.user.userId` :

```ts
@Roles(Role.SWAPPER)
@Post()
create(@Request() req, @Body() dto: CreateLeaveRequestDto) {
  return this.leaveService.create(req.user.userId, dto);   // ❌
}

@Get('mine')
findMine(@Request() req) {
  return this.leaveService.findMine(req.user.userId);      // ❌
}
```

Or `JwtStrategy.validate()` retourne `{ id, email, role, exp }` (le champ s'appelle **`id`**, pas `userId`).

**Conséquences :**
- Toute création de demande de congé passe `userId = undefined` → échec Prisma (FK) ou enregistrement invalide.
- `GET /leave-requests/mine` renvoie toujours une liste vide.

**Correction :** remplacer `req.user.userId` par `req.user.id` aux deux endroits.

### 2.2 🔴 Secrets versionnés dans le dépôt

Le fichier `.env` réel **est présent à la racine du projet** (et `frontend/.env`, `frontend.env` aussi). Il contient :

- `DATABASE_URL` avec **le mot de passe Postgres en clair** (`postgres:danielle1234@@@@`).
- `JWT_SECRET` avec une valeur réelle (donc forgeable si le dépôt est public).
- `ADMIN_SEED_PASSWORD="ChangeMoiRapidement123"`.

Le `.gitignore` liste bien `.env` / `.env.*`, mais ces fichiers **existent quand même** dans l'arborescence livrée — signe qu'ils ont pu être commités avant l'ajout du `.gitignore` (le `.gitignore` ne « dé-track » pas un fichier déjà suivi).

**Actions :**
1. Retirer `.env`, `frontend/.env`, `frontend.env` du suivi git (`git rm --cached ...`).
2. **Faire tourner** le mot de passe Postgres, le `JWT_SECRET` et le mot de passe admin.
3. Purger l'historique git si le dépôt a été partagé.

### 2.3 🔴 Fichiers parasites commités à la racine

Le dossier racine contient des fichiers qui ne devraient pas être là :

| Fichier | Nature |
|---|---|
| `cdshcdsmcsv` | sortie d'un `less`/man-page (« SUMMARY OF LESS COMMANDS ») |
| `git status` | sortie texte d'un `git status` redirigée |
| `ntent tsconfig.build.json` | **un diff git collé** dans un fichier, dont le nom est corrompu (« ntent » = fragment de « content ») |
| `pi.py` | fichier vide, nom trompeur |
| `frontend.env` | doublon de `frontend/.env`, nom malformé |

Ces artefacts révèlent des copier-coller accidentels (terminal redirigé vers un fichier, diff sauvegardé par erreur). À supprimer.

### 2.4 🔴 Dossier `dylane-temp/` : ancienne version du frontend

`dylane-temp/` contient une **copie complète et obsolète** du frontend (mock API, features, CSS…). C'est une source de confusion majeure : deux bases de code front, dont une seule est la vraie. Elle est certes exclue de `tsconfig`, mais reste un risque de maintenance et de fuite (elle peut contenir des données de démo, gateways, etc.). À supprimer du dépôt.

---

## 3. Sécurité

### 3.1 Points solides ✅

Le module d'authentification est globalement bien conçu :

- Mots de passe hachés avec **bcrypt (12 rounds)**.
- **Refresh tokens opaques** (40 octets) stockés **hachés en SHA-256**, avec rotation et détection de réutilisation (suppression + `count !== 1`).
- **`tokenVersion`** incrémenté → invalidation de toutes les sessions au reset de mot de passe, à la déconnexion, au changement de rôle et à la (dés)activation.
- **Jetons de reset / invitation** hachés, à durée de vie limitée (15 min / 48 h).
- `forgotPassword` renvoie un **message générique** (protection contre l'énumération de comptes).
- `ValidationPipe` global avec `whitelist`, `forbidNonWhitelisted`, `transform`.
- **Guards** `JwtAuthGuard` + `RolesGuard` appliqués au niveau contrôleur, `@Roles()` par route.

### 3.2 Points à corriger ⚠️

1. **Rate limiting absent sur `login` / `forgot-password`.** Les tentatives sont journalisées (`LoginAttempt`) mais **jamais exploitées** : aucune limitation de débit, aucun verrouillage après N échecs. Vulnérable au brute-force. → Ajouter `@nestjs/throttler` et/ou bloquer après X échecs sur une fenêtre donnée.
2. **CORS permissif par défaut.** `origin: corsOrigin ? [...] : true` : si `CORS_ORIGIN` est absent, **toutes les origines** sont acceptées avec `credentials: true`. → Refuser par défaut ou échouer au démarrage si non configuré.
3. **`RolesGuard` non défensif.** Si aucun rôle n'est requis, il retourne `true` sans vérifier qu'un utilisateur est présent. Aujourd'hui les contrôleurs combinent toujours les deux guards, mais une route avec `RolesGuard` seul deviendrait publique. → Retourner `false` si `!user`.
4. **Géolocalisation du pointage non vérifiée.** `check-in`/`check-out` reçoivent `latitude`/`longitude` mais ne les comparent à **aucune** coordonnée de station (`Station.latitude/longitude` existent pourtant). Le pointage QR peut donc être fait à distance sans contrôle.
5. **Pas de `helmet`** ni de limitation de taille de payload explicite ; upload CSV accepté sans contrôle de type/taille côté serveur.
6. **`@typescript-eslint/no-explicit-any` est désactivé** et plusieurs DTO de contrôleur (`attendance`) sont typés inline avec `any` (`@Req() req: any`) — pas de validation sur ces corps de requête (pas de DTO class-validator sur `attendance`), contrairement au reste du code.

---

## 4. Architecture & qualité du code

### 4.1 Ce qui va bien ✅

- Découpage **module/controller/service/DTO** propre et cohérent sur tout le backend.
- **Prisma schema bien modélisé** (index pertinents, `onDelete`, enums, contraintes `@@unique`).
- `SchedulingEngineService` : moteur de règles clair (durée exacte, chevauchement, 1 créneau/jour, repos min, limite hebdo, conflit congé) — bon cœur métier.
- Frontend : vrai **design-system CSS**, gestion fine de l'expiration de session (idle timeout, refresh, BroadcastChannel multi-onglets), PWA (manifest + service worker + page offline).

### 4.2 Problèmes ⚠️

1. **Formatage incohérent sur les fichiers récemment modifiés.** `attendance.service.ts`, `attendance.controller.ts`, `scheduling-engine.service.ts`, `attendance.scheduler.ts` ont une **indentation cassée** (zéro indentation imbriquée) par rapport au reste (Prettier 2 espaces). Le lint `prettier/prettier` en `error` va échouer dessus. → Lancer `npm run format`.
2. **Tests quasi inexistants.** Seuls `app.controller.spec.ts` (« Hello World ») et `app.e2e-spec.ts` (template Nest par défaut) existent. **Aucun test** sur l'auth, le moteur de planification, le pointage QR ou les permissions. C'est la plus grosse dette pour un domaine aussi sensible.
3. **`README.md` = template NestJS par défaut** : aucune documentation du projet (installation, variables d'env, rôles, endpoints, fonctionnement du mock frontend).
4. **`SANITIZE` fragile** : `sanitizeUser(user: any)` retire les champs sensibles manuellement (`void password`…). Préférer un `select` Prisma explicite (comme `SAFE_SELECT` dans `users.service.ts`, qui lui est bon).
5. **`LeaveApiClient`** : `fetch` sans timeout ni auth ; dégradation silencieuse (`return null`). Acceptable pour un stub, mais à cadrer si l'API congés devient réelle.
6. **`attendances` retournent `email`/`phoneNumber` des swappeurs** dans plusieurs endpoints (superviseur/admin uniquement — OK côté droits, mais à surveiller en RGPD).

---

## 5. Dépendances & hygiène

- Versions **prêtes pour la prod** et cohérentes (Nest 11, React 19, Vite 6, TS 5.x).
- ⚠️ `xlsx@^0.18.5` (frontend) : la version npm publique est connue pour des **CVE** (prototype pollution / ReDoS) et n'est plus publiée sur le registre npm officiel par SheetJS. Si l'import Excel est sensible, migrer vers une alternative maintenue ou la distribution officielle SheetJS.
- Le `frontend/package.json` est **minifié sur une seule ligne** (peu lisible / diff difficile).
- Aucun `.nvmrc`/`engines` : la version de Node n'est pas figée.

---

## 6. Récapitulatif priorisé

| Priorité | Action | Fichier(s) |
|---|---|---|
| 🔴 P0 | Corriger `req.user.userId` → `req.user.id` | `src/leave/leave.controller.ts` |
| 🔴 P0 | Retirer les `.env` du dépôt + **roter** les secrets | `.env`, `frontend/.env`, `frontend.env` |
| 🔴 P0 | Supprimer les fichiers parasites | `cdshcdsmcsv`, `git status`, `ntent tsconfig.build.json`, `pi.py`, `frontend.env` |
| 🟠 P1 | Supprimer `dylane-temp/` (ancien frontend) | `dylane-temp/` |
| 🟠 P1 | Ajouter rate-limiting sur auth | `auth` + `throttler` |
| 🟠 P1 | Sécuriser CORS par défaut (refuser si non configuré) | `src/main.ts` |
| 🟡 P2 | Reformatage Prettier des fichiers désindentés | `attendance/**`, `scheduling/**` |
| 🟡 P2 | Vérifier la géoloc du pointage vs `Station.lat/lng` | `attendance.service.ts` |
| 🟡 P2 | Ajouter tests (auth, scheduling, permissions) | `*.spec.ts` |
| 🟢 P3 | Réécrire le `README` | `README.md` |
| 🟢 P3 | Rendre `RolesGuard` défensif (`false` si `!user`) | `src/auth/roles.guard.ts` |
| 🟢 P3 | Évaluer/mettre à jour `xlsx` | `frontend/package.json` |

---

## 7. Conclusion

Le **cœur métier est solide** — modèle de données soigné, moteur de planification complet et module d'authentification bien pensé (rotation de refresh tokens, `tokenVersion`, tokens hachés). Les problèmes relèvent surtout de l'**hygiène du dépôt** (secrets et fichiers parasites versionnés, dossier `dylane-temp/`), d'**un bug bloquant** sur les congés, et de quelques **durcissements sécurité** (rate limiting, CORS, géoloc). Une fois les P0/P1 traités, le projet change de niveau.