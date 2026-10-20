# Guide technique — Dockerisation d'uSwap

Ce document décrit la configuration Docker **réellement livrée** dans ce dépôt
pour l'application uSwap / UpOwa (`backend_new` + `frontend_new/frontend`).

**Version de référence : tag `Uswap-Final_V1.1`** (livraison du 2026-10-19,
commit `20d3684`, identique à la tête de `develop`). Les fichiers Docker de ce
guide sont ajoutés par-dessus ce tag, sur la branche `develop` :
aucun fichier métier de la version finale n'a été modifié.

> État vérifié au 2026-10-20 : **les images n'ont pas encore été construites**
> (Docker n'est pas installé sur la machine de préparation). Ce qui a été
> vérifié localement est listé en fin de document, section *Validation*.

---

## 1. Architecture retenue

| Composant    | Image / base            | Rôle                                                                 |
| ------------ | ----------------------- | -------------------------------------------------------------------- |
| `frontend`   | `nginx:1.27-alpine`     | Sert le bundle Vite (`dist/`), routage SPA, proxy `/api` → `backend` |
| `backend`    | `node:22-bookworm-slim` | API NestJS compilée, exécutée avec `node dist/main.js` (utilisateur non-root) |
| `db`         | `postgres:16-alpine`    | PostgreSQL **dédié** à uSwap (option par défaut, voir §8)            |
| `migrate`    | image `backend`         | Service **manuel** (profil `tools`) : `prisma migrate deploy`         |

Réseau : `uswap-internal` (bridge dédié). Volumes : `uswap-pgdata`,
`uswap-uploads`. Aucun nom de ressource n'est partagé avec les autres
applications du serveur.

Chaîne d'exposition :

```
Internet → Nginx de l'hôte (HTTPS) → 127.0.0.1:8080 → conteneur frontend (Nginx :80)
                                                        ├── /            → index.html (SPA)
                                                        └── /api/xxx     → backend:3000/xxx
                                                                              ↘ db:5432
```

`backend` publie aussi `127.0.0.1:3000` — uniquement pour diagnostic ou pour
un reverse proxy d'hôte qui préférerait attaquer directement l'API. Rien
n'est publié sur `0.0.0.0`, et PostgreSQL ne publie **aucun** port.

## 2. Fichiers ajoutés

| Fichier                                    | Rôle                                                        |
| ------------------------------------------ | ----------------------------------------------------------- |
| `backend_new/Dockerfile`                   | Image multistage de l'API (build → prune → runtime)         |
| `backend_new/.dockerignore`                | Exclut secrets, `node_modules`, `dist`, backups              |
| `frontend_new/frontend/Dockerfile`         | Build Vite puis image Nginx statique                        |
| `frontend_new/frontend/.dockerignore`      | Exclut secrets, `node_modules`, `dist`, `*.log`              |
| `frontend_new/frontend/deploy/nginx.conf`  | SPA fallback, cache, en-têtes, proxy `/api` → `backend:3000` |
| `deploy/compose.yaml`                      | Orchestration (3 services + 1 outil manuel)                 |
| `deploy/.env.example`                      | Modèle des variables (aucun secret réel)                     |
| `deploy/README_DOCKER.md`                  | Ce document                                                 |

Fichiers **non** livrés : `.env` réels, `node_modules/`, `dist/`, logs,
`backups/`, archives `.zip`/`.rar`.

## 3. Décisions techniques justifiées par le code

1. **`VITE_API_URL` obligatoire au build.** `src/api/auth-api.ts` calcule
   `usingMock = !configured` : sans variable, le site tourne sur la maquette
   locale (*localStorage*), pas sur l'API. Le Dockerfile écrit donc un
   `.env.production` contrôlé et ne construit pas si la valeur est vide.
2. **Proxy `/api` avec suppression du préfixe.** Le backend ne définit aucun
   préfixe global (`app.setGlobalPrefix('')` dans `src/main.ts`) : les routes
   sont `/auth/login`, `/plannings`, `/stations`… Le frontend appelle `/api/...`.
   Nginx fait donc `location /api/ → proxy_pass http://backend:3000/`, à
   l'identique du proxy Vite de développement (`rewrite: path.replace(/^\/api/, "")`).
3. **Même origine, cookie `SameSite=Lax`.** Le refresh token est un cookie
   HttpOnly `SameSite=Lax`, `Secure` si `COOKIE_SECURE=true`. Sans proxy,
   frontend et API seraient cross-site et la session serait perdue. Le proxy
   garantit une origine unique ; `CORS_ORIGIN` ne sert qu'à l'angle mort d'un
   accès direct.
4. **Prisma Client généré pendant le build, avant `npm prune --omit=dev`.**
   Le client et ses moteurs natifs vivent dans `node_modules` ; les retirer
   avant la génération casserait l'image.
5. **Migrations jamais automatiques.** Le conteneur backend démarre
   directement ; `migrate` est un profil manuel (`prisma migrate deploy`,
   strictement additif).
6. **Node 22 imposé par les dépendances.** `vitest 2`, `tsx`, `bcrypt` natif et
   `@prisma/client 6.19` exigent ≥ 20 ; Node 22 (LTS au moment du build) est
   retenu pour rester aligné avec le poste de développement (v24 en local,
   aucun comportement spécifique documenté).
7. **`ADMIN_BOOTSTRAP_PASSWORD` fourni explicitement.** Au démarrage,
   `AdminBootstrapService.onModuleInit()` réinitialise le mot de passe du
   compte ADMIN **uniquement s'il est désactivé**, avec
   `process.env.ADMIN_BOOTSTRAP_PASSWORD ?? 'AdminUswap'`. Le Compose rend la
   variable obligatoire : l'application ne dépend jamais d'un mot de passe
   littéral livré dans le code. Un compte ADMIN actif n'est pas modifié.

## 4. Prérequis serveur (à confirmer par le superviseur)

- Ubuntu avec Docker Engine ≥ 24 et Docker Compose v2 (`docker compose ...`).
- Domaine pointant vers le serveur, certificat HTTPS (ex. certbot).
- Nginx d'hôte déjà présent : un `server` block à ajouter (§7).
- Ports libres : `8080` (frontend) et, optionnellement, `3000` (backend).
- Espace disque pour les images base Node/Nginx/Postgres et le volume de données.
- Aucune modification des autres conteneurs, réseaux ou bases PostgreSQL.

## 5. Installation

Toutes les commandes s'exécutent depuis la racine du dépôt. Le fichier
`deploy/.env` est lu **automatiquement** par Compose (il est voisin de
`deploy/compose.yaml`) ; `--env-file` n'est donné ici que pour rester explicite.
Réutilisez l'alias `T` tout au long du guide :

```bash
cd /opt/uswap-github
export T="-f deploy/compose.yaml --env-file deploy/.env"
```

```bash
# 1. Récupérer la version finale et la branche de dockerisation
#    (réseau Git interne ou copie contrôlée)
cd /opt/uswap-github
git fetch --tags origin
git switch develop && git pull --ff-only        # doit être sur Uswap-Final_V1.1
git describe --tags                            # attendu : Uswap-Final_V1.1
```

> La branche `develop` porte cette configuration. Si elle n'est pas encore
poussée, la récupérer avec `git switch develop && git pull --ff-only`.
Le tag `Uswap-Final_V1.1` seul ne contient pas les fichiers Docker.

```bash
# 2. Créer le fichier d'environnement
cp deploy/.env.example deploy/.env
#    Renseigner : POSTGRES_PASSWORD, ADMIN_BOOTSTRAP_PASSWORD, JWT_SECRET,
#    JWT_REFRESH_SECRET, PUBLIC_APP_URL, CORS_ORIGIN, MAIL_*, VAPID_* puis
#    vérifier les ports.
chmod 600 deploy/.env

# 3. Générer les secrets (exemples)
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET
openssl rand -base64 32   # POSTGRES_PASSWORD

# 4. Vérifier la configuration. La sortie de `config` contient les valeurs
#    résolues (donc les secrets) : ne pas la journaliser.
docker compose $T config >/dev/null && echo "configuration valide"

# 5. Construire les images
docker compose $T build

# 6. Démarrer (attend que PostgreSQL soit `healthy`)
docker compose $T up -d

# 7. Appliquer les migrations sur la base neuve (voir §6). Le service
#    `migrate` est dans le profil `tools` : `--profile tools` est requis.
docker compose $T --profile tools run --rm migrate
```

## 6. Migrations Prisma (sans commande destructive)

Le dépôt contient `backend_new/prisma/migrations/` :

- `20261012120000_init`
- `20261014160000_occurrence_tolerance_override`

Procédure officielle : `prisma migrate deploy`, via le service `migrate`.

```bash
export T="-f deploy/compose.yaml --env-file deploy/.env"

# Sauvegarde AVANT toute migration (voir §9)
docker compose $T exec -T db pg_dump -U uswap -d uswap -Fc \
  > backup-$(date +%Y%m%d-%H%M%S).dump

# Application (le profil `tools` doit être activé pour créer le service)
docker compose $T --profile tools run --rm migrate

# Vérifier l'état : `migrate` est l'entrypoint, `status` la sous-commande
docker compose $T --profile tools run --rm migrate status
```

**Interdits en production** : `prisma migrate dev`, `prisma migrate reset`,
`prisma db push`, `docker compose down -v`, `docker system prune`.

### Jeu de démonstration (optionnel, environnement de recette uniquement)

Le seed crée des comptes de démonstration (`admin@upowa.org`, etc.) avec un
mot de passe défini par `DEMO_PASSWORD` (valeur par défaut dans
`prisma/seed.ts`). **Ne pas exécuter sur une base de production** sans
décision explicite du superviseur.

```bash
export T="-f deploy/compose.yaml --env-file deploy/.env"

docker compose $T --profile tools run --rm \
  --entrypoint npx migrate --yes tsx prisma/seed.ts
```

## 7. Nginx de l'hôte (HTTPS)

Exemple à adapter (certbot fournit les chemins TLS) :

```nginx
server {
    listen 443 ssl http2;
    server_name uswap.example.org;

    ssl_certificate     /etc/letsencrypt/live/uswap.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/uswap.example.org/privkey.pem;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name uswap.example.org;
    return 301 https://$host$request_uri;
}
```

Swagger reste accessible sur `https://<domaine>/api-docs/` (proxy interne du
conteneur frontend vers `/docs` du backend). Si l'API ne doit pas être
publiquement documentée en production, retirer ce `location` de
`frontend_new/frontend/deploy/nginx.conf`.

## 8. PostgreSQL : point à valider avant déploiement

Le `compose.yaml` livré suppose une **base dédiée conteneurisée** (volume
`uswap-pgdata`). C'est la seule option qui ne touche pas aux bases existantes
du serveur, mais elle implique **une base vide** : les données actuelles ne
sont pas automatiquement disponibles.

Deux scénarios :

| Scénario | Procédure |
| --- | --- |
| **A. Base dédiée neuve** (par défaut) | `up -d` puis `migrate`, puis création des comptes réels (invitations / import utilisateurs). Aucun seed de démo. |
| **B. Reprise de la base existante** | Restaurer le dump de production dans le conteneur `db` **avant** de démarrer le backend (§9), puis `up -d`. Le volume de l'ancienne base reste intact jusqu'à validation. |

Si le superviseur préfère réutiliser le **PostgreSQL déjà installé sur
l'hôte**, il faut :
1. modifier `backend` dans `compose.yaml` : `DATABASE_URL` pointant vers
   `host.docker.internal` (ou l'IP du bridge Docker de l'hôte) ;
2. retirer le service `db` et le `depends_on: db` ;
3. créer un utilisateur/base dédiés uSwap sur ce serveur PostgreSQL, sans
   toucher aux autres bases.
Cette variante n'est **pas** livrée clé en main : elle dépend de la
configuration réelle du serveur, connue seulement du superviseur.

Version : rester sur `postgres:16-alpine` pour un volume déjà créé avec cette
image. Changer de version majeure sur un volume existant impose une migration
`pg_upgrade` (hors périmètre).

## 9. Sauvegarde et restauration

```bash
export T="-f deploy/compose.yaml --env-file deploy/.env"

# Sauvegarde logique (format custom, compressé)
docker compose $T exec -T db pg_dump -U uswap -d uswap -Fc \
  > /srv/backups/uswap-$(date +%F-%H%M).dump

# Restauration dans une base VIDE (conteneur db démarré)
cat uswap-YYYY-MM-DD-HHMM.dump | \
  docker compose $T exec -T db pg_restore -U uswap -d uswap --clean --if-exists

# Pièces jointes (volume uswap-uploads)
docker run --rm -v uswap-uploads:/data -v /srv/backups:/backup alpine \
  tar czf /backup/uswap-uploads-$(date +%F).tar.gz -C /data .
```

Retour arrière possible :

- **Image applicative** : revenir à un tag précédent
  (`USWAP_TAG=... docker compose ... up -d`). Le code est rétrocompatible
  uniquement si aucune migration destructive n'a été appliquée.
- **Base** : restaurer le dump. **Limite** : `prisma migrate deploy` ne sait
  pas revenir en arrière ; restaurer une base n'est sûr que si le schéma
  attendu par l'image précédente est celui du dump.

## 10. Exploitation courante

```bash
cd /opt/uswap-github
export T="-f deploy/compose.yaml --env-file deploy/.env"

docker compose $T ps                              # état + healthchecks
docker compose $T logs --tail=200 backend         # journaux API
docker compose $T logs --tail=200 frontend        # journaux Nginx
docker compose $T down                            # arrêt (volumes conservés)
docker compose $T up -d --build                   # mise à jour après git pull
```

## 11. Contrôles après déploiement (superviseur)

- [ ] `docker compose ps` : `db`, `backend`, `frontend` en `healthy`.
- [ ] `https://<domaine>/` affiche l'écran de connexion uSwap (pas de bandeau
      « mode démo »).
- [ ] `https://<domaine>/app/admin` **après actualisation directe** affiche
      l'application (routage SPA) ou redirige vers la connexion, sans 404.
- [ ] `https://<domaine>/api/auth/session` répond `401` JSON (et non la page HTML).
- [ ] Connexion avec un compte réel : cookie `uswap_refresh` visible,
      `HttpOnly`, `Secure`, `SameSite=Lax` ; expiration correcte après
      rafraîchissement de page.
- [ ] Le compte administrateur actif n'a pas été réinitialisé au démarrage
      (chercher `Acces administrateur restaure` dans `logs backend` ; ce
      message ne doit apparaître que si le compte était réellement désactivé).
- [ ] Une page métier charge des données réelles (pas de données fictives).
- [ ] Upload d'un justificatif d'absence ≤ 5 Mo puis téléchargement.
- [ ] `docker compose $T --profile tools run --rm migrate status` indique
      « up to date » (optionnel si déjà vérifié).
- [ ] Sauvegarde planifiée de `uswap-pgdata` + `uswap-uploads` en place.
- [ ] `.env` : permissions `600`, propriétaire root, hors Git.
- [ ] Aucune erreur 5xx récurrente dans `logs backend` pendant 24 h.

## 12. Opérations manuelles restantes

1. Créer `deploy/.env` avec des secrets propres à l'environnement
   (`POSTGRES_PASSWORD`, `ADMIN_BOOTSTRAP_PASSWORD`, `JWT_SECRET`,
   `JWT_REFRESH_SECRET` sont obligatoires : Compose refuse de démarrer sinon).
2. Confirmer le choix PostgreSQL (§8) avant la mise en production.
3. Renseigner le domaine dans `PUBLIC_APP_URL` et `CORS_ORIGIN`.
4. Configurer le bloc Nginx d'hôte + certificat TLS.
5. Décider de l'exposition de Swagger en production.
6. Décider d'un SMTP réel (`MAIL_DRIVER=smtp`) ou rester en `console`.
7. Créer/activer les comptes utilisateurs réels (pas de seed démo).
8. Planifier les sauvegardes (cron) et tester une restauration.
9. Valider la surveillance (healthchecks Docker, journaux, alertes disque).

## 13. Validation réalisée localement

| Vérification | Résultat |
| --- | --- |
| `npm run build` (backend_new, `tsc -p tsconfig.build.json`) | ✅ succès, sortie `dist/main.js` |
| `npm run build` (frontend_new/frontend, `tsc -b && vite build`) | ✅ succès, bundle dans `dist/` |
| Bundle contient `VITE_API_URL=/api` (donc pas de mode mock) | ✅ `const Sn="/api"` dans `dist/assets/index-*.js` |
| `.env.production` bien lu par Vite | ✅ reconstruit avec ces valeurs |
| Variables requises par le code recensées (`configuration.ts`, `auth-api.ts`) | ✅ |
| `.env` exclus de Git et des contextes Docker | ✅ (`git check-ignore`) |
| Aucun secret en clair dans les fichiers Docker livrés | ✅ (seulement des `${VAR}`) |
| `npm test` backend (`vitest run`) | ⚠️ aucun fichier de test présent dans `src/` |
| `npm run lint` backend | ⚠️ échec préexistant (63 problèmes, fichiers métier non modifiés) |
| `deploy/compose.yaml` (syntaxe / ancrage relatif) | ⚠️ YAML validé (`yaml-lint`, parsing `js-yaml`) mais **pas** `docker compose config` |
| Construction des images / démarrage / healthchecks | ❌ **non exécuté** |
| Vérification syntaxique `nginx.conf` | ❌ **non exécuté** (`nginx -t` impossible sans image) |

**À faire en premier sur une machine avec Docker** :

```bash
export T="-f deploy/compose.yaml --env-file deploy/.env"
docker compose $T config
docker compose $T build
docker compose $T up -d
docker compose $T ps
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/                  # attendu : 200
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/api/auth/session   # attendu : 401
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/app/admin          # attendu : 200 (index.html)
```

## 14. Inventaire de livraison

**À versionner / remettre (dans le dépôt Git)**

| Chemin | Statut |
| --- | --- |
| `backend_new/` (source, `prisma/schema.prisma`, `prisma/migrations/`, `package-lock.json`) | issu du tag `Uswap-Final_V1.1`, inchangé |
| `frontend_new/frontend/` (source, `public/`, `package-lock.json`) | issu du tag `Uswap-Final_V1.1`, inchangé |
| `backend_new/Dockerfile`, `backend_new/.dockerignore` | ajoutés |
| `frontend_new/frontend/Dockerfile`, `.dockerignore`, `deploy/nginx.conf` | ajoutés |
| `deploy/compose.yaml`, `deploy/.env.example`, `deploy/README_DOCKER.md` | ajoutés |
| `.gitignore` (ajout `.env` / `.env.*` sous `deploy/`) | modifié |

**À garder privé (jamais transmis)**

| Chemin | Raison |
| --- | --- |
| `deploy/.env` (créé sur le serveur) | contient les secrets réels |
| `.env`, `backend_new/.env`, `frontend_new/frontend/.env` | secrets / configuration locale |
| `backend_new/backups/*.dump`, `backend_new/backups/*.sql` | données confidentielles |
| `node_modules/`, `dist/`, logs `*.log` | générés |
| archives `*.zip`, `*.rar`, `Uswap-V6.1/` | copies locales |

Ne jamais transmettre une archive contenant `deploy/.env` ou un dump de base
de production : la variable `POSTGRES_PASSWORD` y figure en clair.
