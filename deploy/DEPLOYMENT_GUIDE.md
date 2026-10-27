# Déploiement d'uSwap sur un serveur virtuel (VPS)

## Introduction

L'application uSwap est **déjà entièrement containerisée** avec Docker Compose. Vous pouvez déployer sur n'importe quel serveur virtuel (VPS) exécécutant Ubuntu.

## 1. Choix du serveur virtuel (VPS)

### Options recommandées :
- **Oracle Cloud** : Gratuit (Always Free - 1 OCPU, 1GB RAM)
- **Hetzner** : À partir de ~3,50€/mois
- **OVHcloud** : À partir de ~3,99€/mois
- **DigitalOcean** : À partir de ~5$/mois

### Spécifications minimales :
- RAM : 2 GB minimum (4 GB recommandé)
- Stockage : 20 GB minimum
- OS : Ubuntu 22.04 LTS ou 24.04 LTS
## 2. Prérequis sur le serveur

Une fois votre VPS créé, accédez-le via SSH (utilisateur root ou avec sudo).

### Mise à jour du système :
```bash
apt update && apt upgrade -y
```

### Installation de Docker et Docker Compose :
```bash
apt install -y apt-transport-https ca-certificates curl gnupg2 software-properties-common

curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

echo "deb [arch=$(dpkg -p printarch) signed-by /usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

docker --version
docker compose version
```

### Ajout de votre utilisateur au groupe docker (évite sudo) :
```bash
usermod -aG docker $USER
# Déconnectez-vous et reconnectez-vous
```
## 3. Préparation des fichiers de déploiement

### Clonage du dépôt :
```bash
mkdir -p /opt
cd /opt
git clone https://github.com/iatools-lab/uswap.git uswap-github
cd uswap-github/deploy
```

### Copie et configuration du fichier .env :
```bash
cp .env.example .env
nano deploy/.env
```
### Variables critique à configurer dans `deploy/.env` :

## 5. Déploiement avec Docker Compose

## 6. Migrations de base de données

## 8. Dépannage courant

## 9. Maintenance et sauvegardes

### Sauvegarder la base de données :
```bash
pg_dump -h 127.0.0.1 -U uswap -d uswap > uswap_backup_$(date +%Y%m%d).sql
```

### Voir les journaux :
```bash
docker compose -f deploy/compose.yaml --env-file deploy/.env logs -f
```

### Mises à jour :
```bash
docker compose -f deploy/compose.yaml --env-file deploy/.env pull
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build
```

## 10. Sécurité en production

1. ✅ Toujours utiliser HTTPS avec un certificat SSL valide
2. ✅ Changer tous les mots de passe par défaut dans `.env`
3. ✅ Configurer `MAIL_DRIVER=smtp` avec de vraies credentials
4. ✅ Activer les sauvegardes automatiques de la base de données
5. ✅ Ne jamais exposer PostgreSQL sur un port public (déjà configuré par défaut)
6. ✅ Mettre à jour régulièrement les dépendances et Docker

---

## Résumé des étapes clés

1. ✅ Acheter/un VPS Ubuntu
2. ✅ Installer Docker et Docker Compose
3. ✅ Cloner le dépôt sur `/opt/uswap-github`
4. ✅ Configurer `deploy/.env` avec vos valeurs secrètes
5. ✅ Configurer Apache/Nginx en reverse proxy (optionnel mais recommandé)
6. ✅ Obtenir un certificat SSL gratuit
7. ✅ Lancer `docker compose up -d --build`
8. ✅ Appliquer les migrations : `docker compose --profile tools run --rm migrate`
9. ✅ Initialiser le serveur : `docker compose --profile tools run --rm bootstrap` (référentiel + super administrateur)
10. ✅ Tester l'application

**Bon déploiement !** 🚀
### Problème : "port already allocated"
- Ports 8080 ou 3000 déjà utilisés par un autre service sur l'hôte
- **Solution** : Modifier `FRONTEND_HOST_PORT` et `BACKEND_HOST_PORT` dans `.env`

### Problème : "Cannot connect to the Docker daemon"
- Le service Docker ne tourne pas
- **Solution** : `systemctl start docker` et vérifiez que vous êtes dans le groupe docker

### Problème : Application en mode "démo" sans API
- `VITE_API_URL` non défini au build
- **Solution** : Vérifiez que `.env.production` est correctement lu par Vite

### Problème : Base de données inaccessible
- PostgreSQL n'expose pas de port (sécuritaire)
- Se connecter via le service Docker `db:5432` sur le réseau interne
Les migrations Prisma ne sont **pas** appliquées automatiquement. Lancez-les manuellement :

```bash
# Avec le profil outils
docker compose -f deploy/compose.yaml --env-file deploy/.env --profile tools run --rm migrate

# Ou en ligne de commande directe
docker exec -it uswap-backend-1 npx prisma migrate deploy
```

**Important** : ne jamais utiliser `prisma db push` en production. Pour créer le schéma,
utilisez les migrations versionnées (`migrate deploy`), puis le service `bootstrap`.

## 7. Super administrateur et données initiales

Sur une base vierge, après les migrations, lancez **une fois** le service `bootstrap` :

```bash
docker compose -f deploy/compose.yaml --env-file deploy/.env --profile tools run --rm bootstrap
```

Il crée, sans aucune donnée de démonstration :

- les réglages globaux, les deux stations et leurs modèles de shift ;
- le **super administrateur** défini par `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` ;
- un compte administrateur supplémentaire si `ADMIN_EMAIL` / `ADMIN_PASSWORD` sont renseignés ;
- les préférences de notification de chaque compte.

Le script est rejouable : il ne supprime rien et ne réécrit pas le mot de passe
d'un compte existant. Les agents et superviseurs se créent ensuite depuis
l'interface (invitation par e-mail) ou par import.

Aucun mot de passe n'est écrit dans le dépôt : les valeurs viennent uniquement de
`deploy/.env` (permissions 600).
Depuis le répertoire de déploiement :

```bash
# Vérifier la configuration Docker Compose
docker compose -f deploy/compose.yaml --env-file deploy/.env config

# Construire et démarrer tous les services
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build
```

### Vérifier que tout fonctionne :

```bash
# Vérifier les conteneurs en cours d'exécution
docker compose -f deploy/compose.yaml --env-file deploy/.env ps

# Tester l'application
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/
# Attendu: 200 (page d'accueil servie par React Router)

curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/api/auth/session
# Attendu: 401 (non authentifié)

curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/app/admin
# Attendu: 200 (index.html servi)
```

### Vérifier la base de données :

```bash
# Vérifier que PostgreSQL est en santé
docker compose -f deploy/compose.yaml --env-file deploy/.env ps db

# Se connecter à la base de données (depuis le serveur)
psql -h 127.0.0.1 -U uswap -d uswap
```
| Variable | Description | Valeur recommandée |
|----------|-------------|-------------------|
| `POSTGRES_PASSWORD` | Mot de passe PostgreSQL | `Changer-mot-de-passe-fort` |
| `JWT_SECRET` | Secret JWT pour l'Accès | `Changer-secret-acces-aleatoire-64-caracteres-minimum` |
| `JWT_REFRESH_SECRET` | Secret JWT pour le Refresh | `Changer-secret-refresh-aleatoire-64-caracteres-minimum` |
| `PUBLIC_APP_URL` | Domaine public de l'application | `https://votre-domaine.org` |
| `CORS_ORIGIN` | Origine CORS | `https://votre-domaine.org` |
| `ADMIN_BOOTSTRAP_PASSWORD` | Mot de passe administrateur initial | `Changer-mot-de-passe-admin-initial` |
| `MAIL_DRIVER` | Pilote d'envoi de mail | `console` pour les tests, `smtp` pour la prod |
| `VITE_API_URL` | URL de l'API (définie au build) | `/api` |

**Important** : Le fichier `deploy/.env` ne doit **jamais** être versionné ni transmis. Il contient des secrets.

## 4. Configuration du reverse proxy (Apache/Nginx sur l'hôte)

La configuration Docker expose les services sur `127.0.0.1` uniquement. Vous aurez besoin d'un reverse proxy sur l'hôte pour accéder à l'application depuis Internet.

**Si vous avez déjà Apache sur votre serveur** :

1. Désactivez le module mpm_event ou modifiez-le pour qu'il n'écoute que sur un port spécifique
2. Configurez Apache en reverse proxy vers le conteneur Docker

Configuration Apache en reverse proxy (ajoutez dans `/etc/apache2/sites-available/uswap.conf`) :

```apache
<VirtualHost *:80>
    ServerName votre-domaine.org
    
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:8080/
    ProxyPassReverse / http://127.0.0.1:8080/
    
    <Location /api>
        ProxyPass http://127.0.0.1:3000
        ProxyPassReverse /api http://127.0.0.1:3000
    </Location>
</VirtualHost>

a2enmod proxy proxy_http rewrite headers
systemctl restart apache2
```

**Obtenez un certificat SSL gratuit avec Let's Encrypt** :

```bash
apt install -y certbot
certbot apache -d votre-domaine.org
```