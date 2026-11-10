# uSwap — Guide de déploiement

Ce document ne contient que ce dont le superviseur a besoin : ce qu'il doit
préparer, où placer le fichier `.env`, la commande à lancer, comment vérifier,
consulter les journaux et revenir en arrière.

---

## 1. Ce que le superviseur doit préparer

| Élément | Détail |
| --- | --- |
| Serveur | Ubuntu avec Docker Engine ≥ 24 et Docker Compose v2 |
| Apache | déjà installé sur le serveur (il n'est ni remplacé ni désinstallé) |
| Domaine | un nom qui pointe vers le serveur, par exemple `uswap.upowa.org` |
| Certificat | HTTPS (certbot) — obligatoire pour la géolocalisation |
| Ports libres | `8080` (frontend) et `3000` (backend), liés à `127.0.0.1` uniquement |
| Identifiant Google | `GOOGLE_CLIENT_ID` complet, terminé par `.apps.googleusercontent.com` |
| Compte SMTP | adresse d'expédition + mot de passe d'application |

---

## 2. Récupérer le projet

```bash
sudo git clone <url-du-depot> /opt/uswap-github
cd /opt/uswap-github
sudo git switch develop
sudo git pull --ff-only
```

---

## 3. Où placer le fichier `.env`

Le fichier de production est **`deploy/.env`**. Il n'est jamais versionné.

```bash
cd /opt/uswap-github
sudo cp deploy/.env.example deploy/.env
sudo chmod 600 deploy/.env
sudo nano deploy/.env
```

Renseigner **uniquement** ces lignes :

```dotenv
PUBLIC_APP_URL=https://uswap.upowa.org
CORS_ORIGIN=https://uswap.upowa.org

SUPERADMIN_EMAIL=itadmin@upowa.org
SUPERADMIN_PASSWORD=<mot de passe fort>

GOOGLE_CLIENT_ID=449904699288-xxxxxxxx.apps.googleusercontent.com
GOOGLE_ALLOWED_DOMAINS=upowa.org

ADMIN_BOOTSTRAP_PASSWORD=<mot de passe fort>

MAIL_DRIVER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<adresse d'expédition>
SMTP_PASS=<mot de passe d'application>
MAIL_FROM=uSwap <même adresse que SMTP_USER>

SMS_DRIVER=console
```

Les secrets `POSTGRES_PASSWORD`, `JWT_SECRET` et `JWT_REFRESH_SECRET` sont
générés automatiquement au premier lancement. **Ne pas les inventer.**

> Le « client secret » Google n'est pas utilisé : uSwap vérifie un `id_token`
> côté backend. Ne le mettez nulle part.

---

## 4. La commande unique

```bash
cd /opt/uswap-github
sudo bash deploy/deploy.sh
```

Le script enchaîne : prérequis → Docker → `.env` → build → PostgreSQL →
migrations → bootstrap → démarrage → healthchecks → tests HTTP → Apache.

Options :

```bash
sudo bash deploy/deploy.sh --check       # contrôle seul, ne modifie rien
sudo bash deploy/deploy.sh --no-apache   # sans toucher à Apache
```

Il est **idempotent** : on peut le relancer. Il n'écrase jamais `deploy/.env`
et ne supprime jamais de volume.

---

## 5. Vérifier que uSwap fonctionne

```bash
# 1. Les trois conteneurs doivent être "healthy"
cd /opt/uswap-github
sudo docker compose -f deploy/compose.yaml --env-file deploy/.env ps

# 2. Le frontend répond
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/          # 200

# 3. L'API répond (session anonyme)
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/api/auth/session   # 401

# 4. Depuis l'extérieur, en HTTPS
curl -s -o /dev/null -w "%{http_code}\n" https://uswap.upowa.org/        # 200
```

Puis dans un navigateur : `https://uswap.upowa.org` → écran de connexion →
se connecter avec `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`.

---

## 6. Consulter les journaux

```bash
cd /opt/uswap-github
T="-f deploy/compose.yaml --env-file deploy/.env"

sudo docker compose $T logs --tail=100 backend     # API
sudo docker compose $T logs --tail=100 frontend    # Nginx du conteneur
sudo docker compose $T logs --tail=100 db          # PostgreSQL
sudo docker compose $T logs -f backend             # suivi en direct
```

Erreur fréquente : **502 sur la connexion** → le backend est arrêté ou plante.
Voir `logs --tail=40 backend` ; la cause exacte y figure (variable manquante,
base injoignable, migrations non appliquées).

---

## 7. Apache (reverse proxy)

Le script installe `deploy/apache/uswap.conf` dans
`/etc/apache2/sites-available/uswap.conf`, en remplaçant `uswap.example.org`
par votre domaine, **puis vérifie la configuration avant de recharger**.

Si vous préférez le faire à la main :

```bash
sudo cp deploy/apache/uswap.conf /etc/apache2/sites-available/uswap.conf
sudo nano /etc/apache2/sites-available/uswap.conf      # remplacer le domaine
sudo a2enmod proxy proxy_http headers ssl rewrite
sudo a2ensite uswap.conf
sudo apache2ctl configtest                             # doit afficher Syntax OK
sudo systemctl reload apache2
```

Aucun autre VirtualHost n'est modifié. En cas d'échec de `configtest`,
Apache **n'est pas rechargé** : les autres sites continuent de fonctionner.

---

## 8. Retour arrière

```bash
cd /opt/uswap-github

# Voir les versions disponibles
sudo bash deploy/rollback.sh --list

# Sauvegarder la base avant toute manipulation
sudo bash deploy/rollback.sh --backup-db

# Revenir à un commit précis (sauvegarde la base, reconstruit, redémarre)
sudo bash deploy/rollback.sh --tag <commit>

# Restaurer une sauvegarde de base
sudo bash deploy/rollback.sh --restore-db var/backups/uswap-20261107-120000.dump
```

Le retour arrière **ne supprime aucun volume** et **ne réécrit aucun
historique Git** (le code revient en `detached HEAD`).

Pour revenir à la version courante :

```bash
sudo git checkout develop
sudo bash deploy/deploy.sh
```

---

## 9. Sauvegardes

```bash
cd /opt/uswap-github
T="-f deploy/compose.yaml --env-file deploy/.env"

# Base de données
sudo docker compose $T exec -T db pg_dump -U uswap -d uswap -Fc \
  > /srv/backups/uswap-$(date +%F-%H%M).dump

# Pièces jointes (volume uswap-uploads)
sudo docker run --rm -v uswap-uploads:/data -v /srv/backups:/backup alpine \
  tar czf /backup/uswap-uploads-$(date +%F).tar.gz -C /data .
```

---

## 10. Ce qu'il ne faut jamais faire

```bash
docker compose down -v          # supprime les volumes, donc les données
prisma migrate reset            # efface la base
prisma db push                  # contourne les migrations
docker system prune             # peut supprimer des images utilisées ailleurs
```

Le script `deploy.sh` refuse ces commandes par construction.
