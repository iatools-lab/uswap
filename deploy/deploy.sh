#!/usr/bin/env bash
# =============================================================================
# uSwap — guide de deploiement complet, executable et lisible.
#
#   bash deploy/deploy.sh              # deploiement complet
#   bash deploy/deploy.sh --check      # controle seul, ne modifie rien
#   bash deploy/deploy.sh --help       # affiche ce document
#
# Le script est IDEMPOTENT : on peut le relancer, il ne casse rien.
# Il ne supprime JAMAIS de volume Docker, de base ni de donnee.
#
# -----------------------------------------------------------------------------
# 1. ARCHITECTURE
# -----------------------------------------------------------------------------
#
#   Internet
#     │  HTTPS (443)
#     ▼
#   Nginx de l'hote  ──►  127.0.0.1:8080  ──►  conteneur frontend (Nginx :80)
#     (certbot)                                  ├── /            → index.html (SPA React)
#                                                └── /api/xxx     → backend:3000/xxx
#                                                                     │
#                                                                     ▼
#                                                              db:5432 (PostgreSQL 16)
#
#   Services Docker (projet Compose « uswap ») :
#     db        postgres:16-alpine   volume uswap-pgdata   (aucun port publie)
#     backend   node:22 (NestJS)     127.0.0.1:3000        volume uswap-uploads
#     frontend  nginx:1.27-alpine    127.0.0.1:8080
#     migrate   profil « tools »     prisma migrate deploy (manuel)
#     bootstrap profil « tools »     referentiel + super administrateur (manuel)
#
#   Reseau dedie : uswap-internal. Aucun nom partage avec les autres
#   applications du serveur.
#
#   Sources (depot) :
#     backend_new/                 API NestJS + prisma/ (schema + migrations)
#     frontend_new/frontend/       React 19 + Vite 6, servi par Nginx
#     deploy/compose.yaml          orchestration
#     deploy/.env                  secrets (JAMAIS versionne, chmod 600)
#     deploy/audit-uswap.md        audit complet du depot (a lire en premier)
#
# -----------------------------------------------------------------------------
# 2. LES 10 COMMANDES (a executer sur le serveur Ubuntu, en root)
# -----------------------------------------------------------------------------
#
#   # 1  Recuperer le code
#   git clone <url-du-depot> /opt/uswap-github && cd /opt/uswap-github
#
#   # 2  Se placer sur la branche livree
#   git switch develop && git pull --ff-only
#
#   # 3  Creer la configuration (permissions 600)
#   cp deploy/.env.example deploy/.env && chmod 600 deploy/.env
#
#   # 4  Renseigner les valeurs de la section 4 ci-dessous
#   nano deploy/.env
#
#   # 5  Verifier la configuration (ne modifie rien)
#   bash deploy/deploy.sh --check
#
#   # 6  Construire les images
#   docker compose -f deploy/compose.yaml --env-file deploy/.env build
#
#   # 7  Demarrer PostgreSQL
#   docker compose -f deploy/compose.yaml --env-file deploy/.env up -d db
#
#   # 8  Appliquer le schema Prisma
#   docker compose -f deploy/compose.yaml --env-file deploy/.env --profile tools run --rm migrate
#
#   # 9  Creer le referentiel et le super administrateur
#   docker compose -f deploy/compose.yaml --env-file deploy/.env --profile tools run --rm bootstrap
#
#   # 10 Demarrer l'application et verifier
#   docker compose -f deploy/compose.yaml --env-file deploy/.env up -d && bash deploy/deploy.sh --check
#
#   Les commandes 6 a 10 sont exactement ce que fait `bash deploy/deploy.sh`
#   sans argument : le script est la version automatisee de cette liste.
#
# -----------------------------------------------------------------------------
# 3. QUEL FICHIER .env ? (les trois sont DIFFERENTS)
# -----------------------------------------------------------------------------
#
#   deploy/.env                  PRODUCTION (Docker). LE SEUL FICHIER A
#                                REMPLIR POUR DEPLOYER. Cree a l'etape 3.
#
#   backend_new/.env             DEVELOPPEMENT LOCAL (npm run start:dev).
#                                N'entre JAMAIS dans l'image Docker.
#
#   frontend_new/frontend/.env   DEVELOPPEMENT LOCAL (npm run dev).
#                                N'entre JAMAIS dans l'image Docker.
#
#   Un identifiant Google mis dans backend_new/.env ou dans
#   frontend_new/frontend/.env marche sur le poste de developpement mais PAS
#   en production. En production, tout se regle dans deploy/.env.
#
#   ATTENTION : les valeurs deja presentes dans deploy/.env.example sont des
#   MODELES. C'est deploy/.env (cree a l'etape 3) qui est lu par Docker.
#
# -----------------------------------------------------------------------------
# 4. CE QU'IL FAUT REMPLIR DANS deploy/.env
# -----------------------------------------------------------------------------
#
#   --- 4.1 DEJA FOURNI : recopier tel quel --------------------------------
#
#     SUPERADMIN_EMAIL=itadmin@upowa.org
#     SUPERADMIN_PASSWORD=Uswap2026!Demo        (a changer avant production)
#     SUPERADMIN_FULLNAME=Super administrateur
#
#     MAIL_DRIVER=smtp
#     SMTP_HOST=smtp.gmail.com
#     SMTP_PORT=587
#     SMTP_SECURE=false
#     SMTP_REQUIRE_TLS=false
#     SMTP_USER=<adresse d'expedition de l'organisation>
#     SMTP_PASS=<mot de passe d'application de cette adresse>
#     MAIL_FROM=uSwap <la MEME adresse que SMTP_USER>
#
#     SMS_DRIVER=console                        (NE PAS CHANGER : aucun envoi)
#     SMS_ENDPOINT=                             (vide)
#     SMS_TOKEN=                                (vide)
#
#   --- 4.2 A FOURNIR PAR LE SUPERVISEUR -----------------------------------
#
#     PUBLIC_APP_URL=https://<domaine-reel>
#     CORS_ORIGIN=https://<domaine-reel>        (identique a PUBLIC_APP_URL)
#
#     GOOGLE_CLIENT_ID=449904699288-xxxxxxxx.apps.googleusercontent.com
#
#       La valeur COMPLETE est necessaire : elle se termine par
#       « .apps.googleusercontent.com ». Le seul nombre 449904699288 est le
#       numero de PROJET Google Cloud, pas l'identifiant client.
#       Ou la trouver : console Google Cloud -> APIs et services ->
#       Identifiants -> client OAuth « Application Web » -> « ID client ».
#
#       Le « client secret » n'est PAS utilise : uSwap verifie un id_token
#       Google cote backend (Google Identity Services), sans echange de code.
#       Le garder prive dans la console Google Cloud.
#
#       Origines a declarer dans la console Google Cloud (sinon
#       « origin_mismatch ») :
#         https://<domaine-reel>
#         http://localhost:5173
#
#     ADMIN_BOOTSTRAP_PASSWORD=<mot de passe fort>
#       Applique UNIQUEMENT a un compte ADMIN trouve desactive au demarrage.
#
#   --- 4.3 GENERE AUTOMATIQUEMENT PAR CE SCRIPT ---------------------------
#
#     POSTGRES_PASSWORD          openssl rand -hex 24
#     JWT_SECRET                 openssl rand -base64 48
#     JWT_REFRESH_SECRET         openssl rand -base64 48
#
#   --- 4.4 FACULTATIF : laisser vide --------------------------------------
#
#     VITE_GOOGLE_MAPS_API_KEY=   vide = carte sur OpenStreetMap (fonctionnel)
#     ADMIN_EMAIL= / ADMIN_PASSWORD=   aucun second administrateur cree
#
# -----------------------------------------------------------------------------
# 5. APRES LE DEPLOIEMENT
# -----------------------------------------------------------------------------
#
#   - Nginx de l'hote : proxy_pass http://127.0.0.1:8080 (voir README_DOCKER.md §7)
#   - Verifier https://<domaine>/            → ecran de connexion
#   - Verifier https://<domaine>/api/auth/session → 401 JSON
#   - Se connecter avec SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD
#   - Creer les stations : adresse, coordonnees GPS ou « Utiliser ma position »
#   - Sauvegardes : pg_dump + volume uswap-uploads (README_DOCKER.md §9)
#
#   INTERDITS en production :
#     prisma migrate dev | migrate reset | db push | docker compose down -v
#
# =============================================================================

