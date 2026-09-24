# Audit technique — projet `uswap-github`

_Date : audit réalisé à partir de l'état courant du dépôt._

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