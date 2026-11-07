# Audit uSwap — état du dépôt au 2026-11-07

Document destiné au **superviseur** : ce qui a été vérifié, ce qui a été corrigé,
ce qui reste à faire avant la mise en production, et **exactement** ce qu'il
doit renseigner.

- Dépôt : `uswap-github`
- Branche livrée : `develop`
- Tête au moment de l'audit : `2e6d6af`
- Vérifications exécutées sur le poste de développement (Windows, Node 22)

---

## 1. Résumé exécutif

| Point                                              | État                                                      |
| -------------------------------------------------- | --------------------------------------------------------- |
| Compilation backend (`tsc -p tsconfig.build.json`) | ✅ 0 erreur                                               |
| Compilation frontend (`tsc -b`)                    | ✅ 0 erreur                                               |
| Lint backend (`eslint src/**/*.ts`)                | ✅ 0 erreur                                               |
| Tests backend (`vitest run`)                       | ✅ 2 fichiers, 22 tests verts                             |
| Tests frontend (`vitest run`)                      | ✅ 19 tests verts (8 ignorés, préexistants)               |
| Build frontend (`vite build`)                      | ✅ succès                                                 |
| Secrets versionnés                                 | ✅ aucun (`.env` ignorés, vérifié par `git check-ignore`) |
| Configuration de production                        | ⚠️ **à compléter par le superviseur** (§6)                |
| Construction des images Docker                     | ❌ non exécutée (Docker absent du poste)                  |
| Test sur téléphone réel (géolocalisation)          | ❌ non exécuté                                            |

**Conclusion** : le code est compilable, testé et sans secret versionné. Le
déploiement est prêt à être tenté ; les points bloquants restants sont
**de configuration** (domaine, identifiant Google, SMTP), pas de code.

---

## 2. Architecture

```
Internet
  │  HTTPS (443)
  ▼
Nginx de l'hôte (certbot)  ──►  127.0.0.1:8080  ──►  conteneur frontend (Nginx :80)
                                                       ├── /            → index.html (SPA React)
                                                       └── /api/xxx     → backend:3000/xxx
                                                                            │
                                                                            ▼
                                                                     db:5432 (PostgreSQL 16)
```

| Service Compose | Image                            | Port publié      | Volume          |
| --------------- | -------------------------------- | ---------------- | --------------- |
| `db`            | `postgres:16-alpine`             | aucun            | `uswap-pgdata`  |
| `backend`       | `node:22-bookworm-slim` (NestJS) | `127.0.0.1:3000` | `uswap-uploads` |
| `frontend`      | `nginx:1.27-alpine`              | `127.0.0.1:8080` | —               |
| `migrate`       | image backend, profil `tools`    | —                | —               |
| `bootstrap`     | image backend, profil `tools`    | —                | —               |

Réseau dédié : `uswap-internal`. Aucun nom de ressource partagé avec les autres
applications du serveur.

### Modules backend (`backend_new/src`)

`admin`, `attendance`, `audit`, `auth`, `automation`, `common`, `config`,
`dashboard`, `incidents`, `leaves`, `maintenance`, `notifications`,
`operations`, `planning`, `prisma`, `reports`, `stations`, `users`.

### Écrans frontend (`frontend_new/frontend/src/features`)

`account`, `auth`, `inbox`, `incidents`, `leaves`, `notifications`, `offline`,
`operations`, `planner`, `reports`, `stations`, `supervision`, `users`.

### Migrations Prisma (6, toutes versionnées)

```
20261012120000_init
20261014160000_occurrence_tolerance_override
20261026100000_super_admin
20261101090000_add_sms_channel
20261101120000_absence_approval
20261102100000_automated_absence_per_agent
```

---

## 3. Sécurité

| Contrôle                       | Résultat                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `.env` réels versionnés        | ✅ aucun (`deploy/.env`, `backend_new/.env`, `frontend_new/frontend/.env` ignorés)     |
| Secrets dans les images Docker | ✅ exclus par `.dockerignore`                                                          |
| Mots de passe en base          | ✅ hachés (bcrypt, `passwords.service.ts`)                                             |
| Session                        | ✅ cookie `HttpOnly` `uswap_refresh`, `SameSite=Lax`, `Secure` si `COOKIE_SECURE=true` |
| Autorisation                   | ✅ `roles.guard.ts` + `role-route.guard.ts` (matrice de routes testée)                 |
| Connexion Google               | ✅ `id_token` vérifié auprès de Google, audience contrôlée, e-mail vérifié requis      |
| PostgreSQL exposé              | ✅ non (aucun port publié)                                                             |
| Migrations destructives        | ✅ interdites en production (voir §7)                                                  |

### Points de vigilance

1. **`ADMIN_BOOTSTRAP_PASSWORD`** : au démarrage, le backend réinitialise le mot
   de passe du compte ADMIN **uniquement s'il est désactivé**. La variable est
   rendue obligatoire par Compose pour ne jamais dépendre d'une valeur littérale
   du code.
2. **`GOOGLE_ALLOWED_DOMAINS`** : seuls les comptes du domaine indiqué peuvent
   se connecter via Google. Un Gmail personnel est refusé même s'il existe dans
   uSwap.
3. **Clé Google Maps** (si utilisée) : clé **publique**, donc à restreindre par
   référent HTTP dans la console Google Cloud, sinon elle est exploitable par
   n'importe qui.

---

## 4. Corrections apportées lors de cet audit

### 4.1 Carte de création de station

| Problème constaté                                                                                 | Correction                                                                                                            |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Le repère apparaissait au centre de Douala (4.051056, 9.708533) alors que la station est ailleurs | Le repère reste **invisible** tant qu'aucune position réelle n'existe (adresse résolue, GPS saisi, clic sur la carte) |
| Une station sans coordonnées recevait le point par défaut à l'enregistrement                      | Les coordonnées absentes restent vides ; l'enregistrement exige un emplacement réel                                   |
| « Ndobo » renvoyait un homonyme d'une autre ville                                                 | Recherche restreinte au Cameroun et **triée par distance** au point de référence                                      |
| La carte se recentrait à chaque changement de coordonnées                                         | Recentrage uniquement si le point sort du cadre visible                                                               |
| Carte trop petite (240 px)                                                                        | 340 px, avec rues, points d'intérêt et périmètre de pointage visibles                                                 |

### 4.2 Saisie des coordonnées

- Champs **LATITUDE / LONGITUDE** : le repère se place dès que les deux valeurs
  sont valides.
- Formats acceptés : décimal (`4.051056`), virgule (`4,051056`), DMS
  (`4°03'03.8"N`), hémisphère (`4.05 S`).
- Collage d'une paire `4.051056, 9.708533` (format Google Maps) dans l'un des
  champs **ou dans le champ adresse**.
- Bornes contrôlées (−90/90, −180/180) côté formulaire **et** côté API.
- Liens de vérification : **Google Maps** et **OpenStreetMap**, avec exactement
  les coordonnées enregistrées.

### 4.3 Relevé GPS sur téléphone

- Bouton **« Utiliser ma position actuelle »** : un appui pose le repère sur la
  position de l'appareil et remplit latitude/longitude.
- L'état de l'autorisation est lu **avant** le relevé : si la localisation est
  désactivée, un message explique comment l'activer au lieu d'échouer
  silencieusement.
- Messages distincts pour refus, position indisponible (GPS coupé) et délai
  dépassé ; avertissement si la précision dépasse 100 m.
- Contrôle du contexte sécurisé : la géolocalisation exige **HTTPS** (ou
  localhost). Le déploiement étant en HTTPS, le bouton fonctionnera.

### 4.4 Configuration de déploiement

- **Web Push retiré** : aucune clé VAPID transmise, `DISABLE_WEB_PUSH` forcé à
  `true`.
- **Intégration RH externe retirée** : aucune variable `LEAVE_SYNC_*` transmise.
- **SMS** : laissé en mode `console` (aucun envoi, aucun coût).
- **Google Maps** : clé transmise au build du frontend (`VITE_GOOGLE_MAPS_API_KEY`).

---

## 5. Tests et vérifications exécutés

| Commande                                                  | Résultat                  |
| --------------------------------------------------------- | ------------------------- |
| `backend_new` : `npx tsc -p tsconfig.build.json --noEmit` | 0 erreur                  |
| `backend_new` : `npx eslint "src/**/*.ts"`                | 0 erreur                  |
| `backend_new` : `npx vitest run`                          | 2 fichiers, 22 tests verts |
| `frontend_new/frontend` : `npx tsc -b`                    | 0 erreur                  |
| `frontend_new/frontend` : `npx vitest run`                | 19 tests verts, 8 ignorés |
| `frontend_new/frontend` : `npx vite build`                | succès                    |
| `git check-ignore` sur les trois `.env`                   | ignorés                   |

### Non exécuté (à faire sur le serveur)

- `docker compose build` / `up` / healthchecks
- `prisma migrate deploy` sur une base réelle
- Parcours de géolocalisation sur un téléphone réel
- Vérification du bloc Nginx d'hôte et du certificat TLS

---

## 6. CE QUE LE SUPERVISEUR DOIT REMPLIR

> **Important** : les valeurs déjà saisies dans `deploy/.env.example` sont des
> **modèles**. Le fichier réellement lu par Docker est **`deploy/.env`**, créé
> sur le serveur par `cp deploy/.env.example deploy/.env`. C'est **ce fichier-là**
> qu'il faut compléter. `deploy/.env` n'est jamais versionné.

### 6.1 Déjà fourni (à recopier dans `deploy/.env`)

| Variable              | Valeur à mettre                             | Remarque                                     |
| --------------------- | ------------------------------------------- | -------------------------------------------- |
| `SUPERADMIN_EMAIL`    | `itadmin@upowa.org`                         | compte super administrateur                  |
| `SUPERADMIN_PASSWORD` | `Uswap2026!Demo`                            | **à changer** avant la production            |
| `MAIL_DRIVER`         | `smtp`                                      | envoi réel des e-mails                       |
| `SMTP_HOST`           | `smtp.gmail.com`                            |                                              |
| `SMTP_PORT`           | `587`                                       |                                              |
| `SMTP_SECURE`         | `false`                                     | STARTTLS sur le port 587                     |
| `SMTP_USER`           | adresse d'expédition de l'organisation      |                                              |
| `SMTP_PASS`           | mot de passe d'application de cette adresse | jamais le mot de passe du compte             |
| `MAIL_FROM`           | `uSwap <même adresse que SMTP_USER>`        | doit correspondre au compte authentifié      |
| `SMS_DRIVER`          | `console`                                   | **ne pas changer** : aucun envoi, aucun coût |

### 6.2 À fournir par le superviseur

| Variable           | Valeur attendue                                    | Où la trouver                                                                                             |
| ------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `PUBLIC_APP_URL`   | `https://<domaine-réel>`                           | domaine du serveur                                                                                        |
| `CORS_ORIGIN`      | `https://<domaine-réel>`                           | identique à `PUBLIC_APP_URL`                                                                              |
| `GOOGLE_CLIENT_ID` | `449904699288-xxxxxxxx.apps.googleusercontent.com` | console Google Cloud → APIs et services → Identifiants → client OAuth « Application Web » → **ID client** |

**Attention au format de `GOOGLE_CLIENT_ID`** : la valeur complète se termine par
`.apps.googleusercontent.com`. Le seul nombre `449904699288` est le **numéro de
projet**, pas l'identifiant client : la connexion échouera avec cette valeur
seule.

**Le « client secret » n'est pas utilisé.** uSwap emploie Google Identity
Services : le navigateur reçoit un `id_token` signé par Google, que le backend
vérifie auprès de Google en contrôlant l'audience. Aucun échange de code côté
serveur, donc aucun secret client. Le garder privé dans la console Google Cloud.

**Origines à déclarer dans la console Google Cloud** (sinon erreur
`origin_mismatch`) :

```
https://<domaine-réel>
http://localhost:5173
```

### 6.3 Généré automatiquement par `deploy/deploy.sh`

| Variable             | Génération                |
| -------------------- | ------------------------- |
| `POSTGRES_PASSWORD`  | `openssl rand -hex 24`    |
| `JWT_SECRET`         | `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | `openssl rand -base64 48` |

`ADMIN_BOOTSTRAP_PASSWORD` reste à renseigner (valeur de modèle `CHANGER-…` par
défaut) : il n'est appliqué qu'à un compte ADMIN trouvé désactivé.

### 6.4 Facultatif

| Variable                         | Si vide                                                    |
| -------------------------------- | ---------------------------------------------------------- |
| `VITE_GOOGLE_MAPS_API_KEY`       | la carte de création utilise OpenStreetMap (fonctionnelle) |
| `SMS_ENDPOINT` / `SMS_TOKEN`     | canal SMS inactif (mode `console`)                         |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | aucun second administrateur créé                           |

---

## 7. Interdits en production

```
prisma migrate dev
prisma migrate reset
prisma db push
docker compose down -v
docker system prune
```

`prisma migrate deploy` est **strictement additif** : il applique les migrations
manquantes déjà versionnées, sans jamais réinitialiser la base.

---

## 8. Historique des livraisons (branche `develop`)

| Commit    | Objet                                                        |
| --------- | ------------------------------------------------------------ |
| `e3c0f5c` | carte de création fiable, saisie GPS, fond de plan explicite |
| `83278b3` | adresse résolue au bon endroit, repère jamais inventé        |
| `d6ff947` | Google Maps en fond de carte (repli OpenStreetMap)           |
| `0ea4fe5` | relevé GPS direct depuis le téléphone                        |
| `7b62e53` | demande d'activation de la localisation avant le relevé      |
| `6a28895` | fusion dans `develop`                                        |
| `df07048` | clé Google Maps transmise au build du frontend               |
| `9a89381` | guide `deploy.sh` en 10 commandes, vérification Google/OSM   |
| `d35d3ee` | où mettre l'identifiant Google                               |
| `ef0965c` | différence entre les trois fichiers `.env`                   |
| `ae6599e` | retrait des notifications Web Push                           |
| `57c33cb` | retrait de l'intégration RH externe                          |
| `3b69647` | qui fournit `SMS_ENDPOINT` / `SMS_TOKEN`                     |
| `2e6d6af` | client secret Google et format de `GOOGLE_CLIENT_ID`         |

---

## 9. Points ouverts (non bloquants)

1. **Tests backend** : 2 fichiers de tests (22 tests), sur les gardes de rôles
   et la matrice de routes. Les services métier (planning, pointage, congés) ne
   sont pas couverts.
2. **Tests frontend** : 19 tests, concentrés sur l'API et les analyseurs de
   coordonnées. Les écrans ne sont pas testés.
3. **Lint frontend** : aucun script `lint` dans `package.json` (seul `format`
   existe).
4. **Fichiers non suivis** dans le dépôt local : `.tmp-split/`,
   `SOLUTION_SUMMARY.md` et un fichier au nom corrompu. Ils ne sont pas
   versionnés et n'affectent pas le déploiement.
5. **`deploy/quick-deploy.sh`** (mode démonstration) reste présent : il n'est pas
   utilisé par la procédure de production décrite dans `deploy/deploy.sh`.
