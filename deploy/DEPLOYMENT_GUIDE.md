# Déploiement uSwap

L'application active est composée de `backend` (NestJS/Prisma),
`frontend` (React/Vite) et PostgreSQL 16. Le package racine
relaie les commandes vers ces deux applications.

## Serveur Linux

Prérequis : Docker Engine et Compose v2, Bash, curl, openssl, git et les outils
système vérifiés par `deploy/deploy.sh`. Apache est pris en charge s'il est
installé ; le domaine et son certificat TLS doivent être préparés sur le serveur.

Depuis la racine du dépôt :

```bash
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
```

Remplacer les valeurs `CHANGER-*` et `example.org` : mot de passe PostgreSQL,
secrets JWT distincts, mot de passe de secours administrateur, adresse et mot
de passe du super administrateur, URL publique et origine CORS. Générer chaque
secret séparément avec `openssl rand -hex 32`. Utiliser un mot de passe PostgreSQL
hexadécimal pour que son insertion dans DATABASE_URL ne nécessite pas d'encodage.
Configurer le SMTP pour les invitations et notifications. L'identifiant Google
facultatif est transmis au backend et au build frontend depuis ce même fichier.

```bash
sudo bash deploy/deploy.sh --deploy
```

Le script valide la configuration, construit les images, démarre PostgreSQL,
applique les migrations versionnées puis le bootstrap, démarre l'API et le
frontend, vérifie HTTP et les connexions. Il configure le VirtualHost uSwap si
Apache est présent. Les migrations ne réinitialisent pas la base ; le bootstrap
conserve les comptes et mots de passe existants. Les données persistantes sont
dans les volumes `uswap-pgdata` et `uswap-uploads`.

Une base existante issue de l'ancienne API à la racine possède un autre historique
de migrations : ne pas la brancher directement sur ce backend. Sauvegarder et
préparer une migration de données distincte. Ne pas supprimer les volumes.

Les ports 8080 (frontend) et 3000 (API) sont liés à 127.0.0.1. Le domaine HTTPS
passe par Apache vers le frontend, qui relaie `/api/` vers l'API. Le certificat
doit exister dans `/etc/letsencrypt/live/<domaine>/` avant l'activation HTTPS.
Avec un autre reverse proxy, configurer ce routage et transmettre
`X-Forwarded-Proto: https`. La géolocalisation nécessite HTTPS.

## Vérification et diagnostic

```bash
bash deploy/deploy.sh --check
sudo bash deploy/deploy.sh --diagnose
sudo bash deploy/deploy.sh --repair
docker compose -f deploy/compose.yaml --env-file deploy/.env ps
docker compose -f deploy/compose.yaml --env-file deploy/.env logs --tail=100 backend
curl -i http://127.0.0.1:8080/api/auth/session
```

Une session anonyme répond 204. Les trois services doivent être healthy.
`deploy/quick-deploy.sh` relaie désormais la commande de production et ne charge
aucun jeu de démonstration. Les outils de migration et bootstrap sont déjà dans
l'image : aucune installation npm au démarrage.

## Sauvegarde

```bash
sudo bash deploy/rollback.sh --backup-db
```

Sauvegarder aussi le volume `uswap-uploads`. Conserver les sauvegardes hors du
serveur et tester leur restauration. Le retour à un ancien code ne rétrograde
pas le schéma ; vérifier sa compatibilité avant `rollback.sh --tag`.

## Développement et validation

```bash
npm ci --prefix backend
npm ci --prefix frontend
```

Copier `backend/.env.example` vers `backend/.env`, renseigner une base
locale vide et les secrets, puis générer le client et appliquer les migrations :

```bash
npm run db:generate
npm run db:migrate
npm run build
npm test
npm run check:deploy
bash scripts/test-deploy.sh
```

Pour le frontend local, copier son `.env.example` vers `.env` et choisir
`VITE_API_URL=/api`. Démarrer l'API avec `npm run start:dev` et le frontend dans
un second terminal avec `npm run dev:frontend`. Le seed de démonstration reste
une commande locale explicite dans `backend`.
