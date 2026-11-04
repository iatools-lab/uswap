# Guide correctif — uSwap : « le déploiement réussit mais rien ne change »

**Public** : la personne (ou l'IA) chargée de réparer le déploiement sur le serveur.
**Objectif** : obtenir une application en ligne qui affiche **réellement** le code du commit `1142797` (et les correctifs ci-dessous), puis être capable de le prouver.
**Durée** : 20 à 40 minutes la première fois, 3 minutes ensuite.

> **Deux documents, un seul à suivre :**
> - `GUIDE-DEPLOIEMENT-CORRECTIF.md` (ce fichier) : guide de référence, à lire avant d'agir.
> - `deploy/REPARER-DEPLOIEMENT.md` : **fichier unique** contenant les étapes *et* le contenu complet des scripts, à coller sur le serveur quand Git n'est pas disponible. C'est lui qu'on suit à l'écran pendant l'intervention.
>
> Les deux sont dans le même commit : après `git pull`, ils sont présents dans `/opt/uswap`.

---

## 0. TL;DR — la séquence qui répare

À exécuter **dans cet ordre**, sur le serveur (`root@Sirh-Server`, dépôt dans `/opt/uswap`).

```bash
cd /opt/uswap

# 1. Constat : que sert le serveur, et les sources sont-elles là ?
ls -la frontend_new/frontend/src
bash deploy/check-live.sh

# 2. Récupérer les correctifs (dépôt distant), ou coller les scripts (§3 si pas de Git)
git status --porcelain            # doit être vide ; sinon : git stash
git pull --ff-only origin develop
git log -1 --oneline              # le commit doit être NOUVEAU (pas 1142797)

# 3. Remettre les sources frontend si elles manquent
bash deploy/fix-missing-sources.sh            # constat
bash deploy/fix-missing-sources.sh --apply    # copie si une copie complète existe

# 4. Reconstruire SANS cache et SANS réseau de dépendances ("--pull")
DOCKER_BUILDKIT=1 docker compose -f deploy/compose.yaml --env-file deploy/.env \
  build --no-cache --pull --progress=plain frontend backend

# 5. Recréer les conteneurs
docker compose -f deploy/compose.yaml --env-file deploy/.env \
  up -d --force-recreate frontend backend

# 6. Vérifier
bash deploy/check-live.sh
```

Puis, dans **chaque navigateur** (une seule fois) : F12 → _Application_ → _Service workers_ → **Unregister**, puis **Ctrl+F5**. Contrôle final : **Compte → Profil → Version déployée**.

**Critère de réussite n°1** — dans la sortie du build (§4) :

```
=> [frontend internal] load build context
=> => transferring context: 1.72MB          <-- MÉGAOCTETS, pas 8.98kB
```

Si vous voyez encore `8.98kB` et des étapes `CACHED`, le build est trompeur : arrêtez-vous et allez en §3.

**Critère de réussite n°2** — `bash deploy/check-live.sh` se termine par :

```
  AUCUNE INCOHÉRENCE : le serveur sert le code courant.
```

---

## 1. Ce qui s'est réellement passé (ne pas se tromper de diagnostic)

| Symptôme observé                                     | Explication                                                                                                                                                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose ps` = `healthy`                      | Le conteneur tourne… avec une **ancienne image**. La santé ne dit rien de la version du code.                                                                                                       |
| `migrate` a réussi                                   | Les migrations sont un état **de la base** ; elles ne prouvent rien sur le frontend ni sur le code API.                                                                                             |
| `build --no-cache` a « réussi »                      | BuildKit a relancé ses étapes mais **le contexte de build ne contenait que 8,98 Ko** : `npm ci` et `npm run build` ont été rejoués sur des sources absentes/tronquées, puis servis depuis le cache. |
| Rien ne change dans le navigateur                    | En plus : le service worker servait `index.html` depuis un cache longue durée, donc même une nouvelle image restait invisible jusqu'à un _Unregister_ manuel.                                       |
| `deploy/check-live.sh` : _No such file or directory_ | Le script n'existait pas sur le serveur : il n'a jamais été poussé ni récupéré. `/opt/uswap` n'est pas un clone complet (`/opt/uswap-github` n'existe pas).                                         |

**Règle à retenir** : un déploiement n'est « réussi » que si l'on peut **montrer** le bundle servi. C'est ce que font `check-live.sh` et l'indicateur « Version déployée ».

---

## 2. Arborescence attendue sur le serveur

```
/opt/uswap/
├── deploy/
│   ├── .env                      (secrets, jamais versionné)
│   ├── compose.yaml
│   ├── check-server.sh
│   ├── check-live.sh             <- diagnostic (§4)
│   └── fix-missing-sources.sh    <- réparation des sources (§3)
├── backend_new/
│   ├── Dockerfile
│   ├── package.json  package-lock.json
│   ├── prisma/schema.prisma  prisma/migrations/
│   └── src/main.ts
└── frontend_new/frontend/
    ├── Dockerfile  .dockerignore
    ├── package.json  package-lock.json
    ├── index.html  vite.config.ts  tsconfig.json
    ├── deploy/nginx.conf
    ├── public/
    └── src/
        ├── main.tsx
        ├── app/router.tsx
        └── api/auth-api.ts
```

Contrôle rapide de la taille des sources (le chiffre qui démasque tout) :

```bash
du -sh frontend_new/frontend/src     # attendu : ~1,6 Mo ; si < 200 Ko => sources absentes
find frontend_new/frontend/src -name '*.ts*' | wc -l   # attendu : ~140 fichiers
```

---

## 3. Remettre les sources frontend en place

### 3.1 Diagnostic

```bash
cd /opt/uswap
bash deploy/fix-missing-sources.sh
```

Le script affiche ce qui manque, puis cherche une copie complète ailleurs sur le disque (`/opt`, `/srv`, `/home`, `/root`, `/var/www`, `/tmp`).

### 3.2 Si une copie complète est trouvée

```bash
bash deploy/fix-missing-sources.sh --apply
```

La copie ne touche ni `deploy/.env`, ni `node_modules`, ni `dist`.

### 3.3 Si aucune copie n'existe : transférer depuis le poste de développement

**Depuis Windows (PowerShell)**, dans le dossier du projet :

```powershell
# Aucune archive avec node_modules / dist / .env : uniquement les sources utiles
robocopy frontend_new\frontend \\path\a\adapter /E `
  /XD node_modules dist .git deploy\.env `
  /XF *.log .env .env.* *.tsbuildinfo
```

Ou, plus simple, en ZIP propre :

```powershell
Compress-Archive -Path frontend_new\frontend\* `
  -DestinationPath uswap-frontend.zip `
  -CompressionLevel Optimal
```

Puis sur le serveur :

```bash
mkdir -p /tmp/uswap-frontend
# copier uswap-frontend.zip dans /tmp
cd /tmp/uswap-frontend && unzip -q /tmp/uswap-frontend.zip
# vérifier AVANT de copier
ls src/main.tsx vite.config.ts index.html deploy/nginx.conf

cd /opt/uswap
cp -a /tmp/uswap-frontend/. frontend_new/frontend/
rm -rf frontend_new/frontend/node_modules frontend_new/frontend/dist

du -sh frontend_new/frontend/src     # ~1,6 Mo
```

> **Ne jamais copier** : `deploy/.env`, `node_modules/`, `dist/`, `.git/`.

### 3.4 Si le dépôt distant est disponible (recommandé)

```bash
cd /opt/uswap
git rev-parse --is-inside-work-tree      # doit afficher true
git fetch --tags origin
git status --porcelain                   # si non vide : git stash (ou commit)
git pull --ff-only origin develop
git log -1 --oneline                     # doit être le commit récent, pas 1142797
```

⚠️ Si le serveur est sur `1142797`, **il n'a pas les correctifs** : `check-live.sh`, `fix-missing-sources.sh`, le service worker corrigé et l'indicateur de version n'y sont pas. Il faut soit `git pull`, soit coller les fichiers à la main (§5).

---

## 4. Diagnostiquer : `deploy/check-live.sh`

### 4.1 Installation sur le serveur

```bash
cd /opt/uswap
# Option A (dépôt) : rien à faire après git pull
ls -l deploy/check-live.sh

# Option B (sans Git) : créer le fichier et coller son contenu (cat > ... <<'EOF')
cat > deploy/check-live.sh <<'SCRIPT'
... contenu du fichier deploy/check-live.sh ...
SCRIPT
chmod +x deploy/check-live.sh
bash -n deploy/check-live.sh && echo "syntaxe OK"
```

### 4.2 Lecture du rapport

| Section             | Ce qu'elle prouve                  | Ce qu'il faut voir                                                                                                                 |
| ------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1/6 Conteneurs      | version réellement démarrée        | dates de `Created` et d'image **postérieures** aux modifs                                                                          |
| 1/6 Sources         | le builder lira des fichiers réels | `src/main.tsx`, `src/app/router.tsx`, `src/api/auth-api.ts` présents ; `sources frontend présentes (~1,6 Mo)`                      |
| 2/6 Bundle          | ce que Nginx sert en local         | un `index-XXXX.js` cohérent, `chunk(s) dans le conteneur` ≥ 20                                                                     |
| 3/6 Fonctionnalités | le code **dans** le bundle         | `rôle super administrateur`, `fuseau de la station`, `écran de nettoyage`, `cartographie`, `indicateur de version` : tous présents |
| 4/6 Accès extérieur | ce que voit l'utilisateur          | même `index-XXXX.js` que le conteneur                                                                                              |
| 5/6 Routes API      | version de l'API                   | `/api/auth/session` 204/401, `/api/me`, `/api/super-admin/cleanup`, `/api/reports/dashboard` : 401/403 (jamais 404)                |
| 6/6 Migrations      | base à jour                        | `3 migration(s) appliquée(s) sur 3`                                                                                                |

Chaque écart apparaît en `[INCOHERENT]` avec la correction. Code de sortie : `0` = sain, `1` = incohérence.

### 4.3 Reconstruction assistée

```bash
bash deploy/check-live.sh --build
```

Équivalent aux commandes `build --no-cache` + `up -d --force-recreate` du §5, puis invite à relancer le contrôle.

---

## 5. Déploiement correct (procédure de référence)

```bash
cd /opt/uswap
export T="-f deploy/compose.yaml --env-file deploy/.env"

# 0. Sauvegarde de la base AVANT toute migration (le cas échéant)
docker compose $T exec -T db pg_dump -U uswap -d uswap -Fc > /srv/backups/uswap-$(date +%F-%H%M).dump

# 1. Contrôles préalables
bash deploy/check-server.sh                  # arborescence + .env + ports
docker compose $T config >/dev/null && echo "compose valide"

# 2. Build SANS cache, avec log détaillé (on veut voir la taille du contexte)
DOCKER_BUILDKIT=1 docker compose $T build --no-cache --pull --progress=plain frontend backend

# 3. Migrations (idempotent, jamais destructif)
docker compose $T --profile tools run --rm migrate
docker compose $T --profile tools run --rm migrate status

# 4. Recréation des conteneurs
docker compose $T up -d --force-recreate backend frontend

# 5. Contrôles
bash deploy/check-live.sh
docker compose $T ps
for u in / /app/admin /api/auth/session /api/me; do
  printf '%-22s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080$u)"
done
```

### Commandes interdites en production

`docker compose down -v`, `prisma migrate reset`, `prisma db push`, `docker system prune`, `rm -rf` sur un volume. Aucune n'est nécessaire ici.

---

## 6. Vérification côté navigateur

1. **Service worker** : F12 → _Application_ → _Service workers_ → **Unregister** (une seule fois), puis **Ctrl+F5**.
2. **Version exécutée** : **Compte → Profil → Version déployée**, ou dans la console :

   ```js
   sessionStorage.getItem('uswap:build'); // attendu : AAAAMMJJHHMM-<commit>
   ```

3. Comparer avec le serveur :

   ```bash
   curl -s http://127.0.0.1:8080/ | grep -o '/assets/index-[^"]*\.js'
   ```

   - Même numéro de bundle des deux côtés + version changée → déploiement effectif.
   - Navigateur = ancien bundle → cache (refaire l'étape 1).
   - Serveur = ancien bundle → build/pull (retour §3/§5).

---

## 7. Correctifs inclus dans ce lot

| Fichier                                                                               | Effet                                                                                              | Pourquoi c'est nécessaire                               |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `frontend_new/frontend/public/sw.js`                                                  | `index.html` et `/` ne sont plus servis depuis le cache ; cache versionné (`uswap-public-<BUILD>`) | Supprime la cause « nouvelle image invisible »          |
| `frontend_new/frontend/src/ui/PwaStatus.tsx`                                          | vérifie la mise à jour à chaque retour d'onglet et active le nouveau service worker immédiatement  | Plus de proposition « Actualiser » jamais cliquée       |
| `frontend_new/frontend/vite.config.ts` + `src/app/buildInfo.ts` + `src/vite-env.d.ts` | identifiant de build `AAAAMMJJHHMM-commit` (`__BUILD_ID__`)                                        | Preuve visible de la version exécutée                   |
| `frontend_new/frontend/src/features/account/AccountSettings.tsx`                      | affiche « Version déployée » dans le profil                                                        | Contrôle sans outil                                     |
| `deploy/check-live.sh`                                                                | diagnostic 6 points                                                                                | Désigne la cause au lieu de la deviner                  |
| `deploy/fix-missing-sources.sh`                                                       | constate/répare les sources absentes                                                               | Cœur de la panne actuelle                               |
| `deploy/check-server.sh`                                                              | détecte un `src/` vide ou tronqué                                                                  | Évite de relancer un build trompeur                     |
| `scripts/check-bash.mjs`                                                              | contrôle syntaxique des scripts sans bash                                                          | Empêche de mettre en ligne un script qui ne démarre pas |
| `deploy/README_DOCKER.md` §11 bis, `deploy/DEPLOYMENT_GUIDE.md` §8                    | documentation de cette procédure                                                                   | Transmission de la connaissance                         |

---

## 8. Dépannage (symptôme → cause → action)

| Symptôme                                                  | Cause                                        | Action                                                                        |
| --------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| `transferring context: 8.98kB`                            | sources absentes du contexte                 | §3, puis rebuild                                                              |
| Étapes `CACHED` malgré `--no-cache`                       | cache de couche `COPY`                       | `--no-cache --pull --progress=plain`, vérifier la taille du contexte          |
| `bash: deploy/check-live.sh: No such file`                | script non récupéré                          | `git pull` ou §4.1                                                            |
| `syntax error near unexpected token `(`/`psql_q`          | script écrit par étapes, mélange de versions | re-collationner le `check-live.sh` final, puis `bash -n deploy/check-live.sh` |
| `check-live.sh` signale « bundle différent du conteneur » | proxy/ autre conteneur sur le port           | `docker ps`, `nginx -T \| grep proxy_pass`, `apache2ctl -S`                   |
| `check-live.sh` signale `/api/me -> 404`                  | image backend ancienne                       | rebuild backend, `up -d --force-recreate backend`                             |
| Navigateur toujours ancien après tout ça                  | service worker persistant                    | _Unregister_ + Ctrl+F5 ; vérifier « Version déployée »                        |
| `denied: requested access / pull` au build                | réseau registre                              | relancer sans `--pull`                                                        |
| `port is already allocated`                               | ports 8080/3000 pris                         | `FRONTEND_HOST_PORT` / `BACKEND_HOST_PORT` dans `deploy/.env`                 |
| `P3005 database schema is not empty`                      | base restaurée sans `_prisma_migrations`     | **ne jamais** `migrate reset` ; restaurer un dump cohérent                    |

---

## 9. Retour arrière

```bash
cd /opt/uswap
export T="-f deploy/compose.yaml --env-file deploy/.env"
# Images : utiliser un tag précédent
USWAP_TAG=<tag-precedent> docker compose $T up -d backend frontend
# Base : restaurer le dump réalisé au §5 étape 0 (base vide ou --clean --if-exists)
# Navigateur : Service worker -> Unregister, Ctrl+F5
```

Une migration `prisma migrate deploy` ne se défait pas : le retour arrière sûr consiste à restaurer le dump **et** l'image de la même époque.

---

## 10. Empêcher la récidive

1. **Toujours** vérifier la taille du contexte de build (`transferring context:` ≥ 1 Mo pour le frontend).
2. **Toujours** terminer par `bash deploy/check-live.sh` — pas par `docker compose ps`.
3. Commiter et pousser avant de déployer : un fichier non commité côté poste n'arrive jamais par `git pull`.
4. Après déploiement, contrôler **Compte → Profil → Version déployée**.
5. Ne jamais éditer un script directement sur le serveur par petits morceaux : écrire le fichier complet, puis `bash -n`.

---

## 11. Annexe — vérifier un script bash avant de l'exécuter (Windows, sans bash)

Le fichier `scripts/check-bash.mjs` relit les scripts et signale les erreurs qui ont réellement cassé ceux de ce dépôt (affectation `X = y`, `f() = `, `if/fi` déséquilibrés, chaîne non refermée).

```powershell
node scripts/check-bash.mjs                       # tous les *.sh du dépôt
node scripts/check-bash.mjs deploy\check-live.sh  # un seul fichier
node scripts/check-bash.mjs --md                  # inclut les .md (blocs ```bash)
node scripts/check-bash.mjs --verbose             # liste aussi les lignes à quotes impaires
```

Le fichier livré **remplace une version antérieure défectueuse** : celle-ci
signalait à tort des guillemets « non appariés » sur les messages français
(`l'image`, `s'il`) et laissait donc passer le vrai défaut d'un script tronqué.
La règle actuelle est simple : on neutralise d'abord tout ce qui n'est pas du
code (commentaires, contenu des chaînes, heredocs, `/.../` de `${x:-…}`), puis
on compte les structures.

> Ce contrôle reste un **filet**, pas `bash -n`. Sur le serveur, la référence
demeure : `bash -n deploy/check-live.sh`.

### Régénérer le guide après une modification de script

`deploy/REPARER-DEPLOIEMENT.md` contient les scripts en clair. Pour éviter toute
version périmée :

```powershell
node scripts/embed-scripts-in-guide.mjs          # réinjecte les scripts
node scripts/embed-scripts-in-guide.mjs --check  # échoue si désynchronisé
```
