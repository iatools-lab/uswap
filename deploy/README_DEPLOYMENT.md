# uSwap — Guide de déploiement

Ce document ne contient que ce dont le superviseur a besoin : ce qu'il doit
préparer, où placer le fichier `.env`, la commande à lancer, comment vérifier,
consulter les journaux et revenir en arrière.

---

## 1. Ce que le superviseur doit préparer

| Élément            | Détail                                                                |
| ------------------ | --------------------------------------------------------------------- |
| Serveur            | Ubuntu avec Docker Engine ≥ 24 et Docker Compose v2                   |
| Apache             | déjà installé sur le serveur (il n'est ni remplacé ni désinstallé)    |
| Domaine            | un nom qui pointe vers le serveur, par exemple `uswap.upowa.org`      |
| Certificat         | HTTPS (certbot) — obligatoire pour la géolocalisation                 |
| Ports libres       | `8080` (frontend) et `3000` (backend), liés à `127.0.0.1` uniquement  |
| Identifiant Google | `GOOGLE_CLIENT_ID` complet, terminé par `.apps.googleusercontent.com` |
| Compte SMTP        | adresse d'expédition + mot de passe d'application                     |

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
sudo bash deploy/deploy.sh --deploy
```

Le script enchaîne : prérequis → `deploy/.env` → Compose → ports → services →
diagnostic → réparations sûres → build → PostgreSQL → migrations → bootstrap →
démarrage → tests HTTP → Apache → **vérification des deux connexions** →
rapport final.

Les quatre modes :

```bash
bash deploy/deploy.sh --check        # contrôle seul, ne modifie rien
bash deploy/deploy.sh --diagnose     # contrôle + diagnostic détaillé, lecture seule
sudo bash deploy/deploy.sh --repair  # réparations ciblées et sûres, sans rebuild
sudo bash deploy/deploy.sh --deploy  # tout : contrôles, réparations, build, tests
```

Options complémentaires : `--rebuild` (force la reconstruction des images),
`--help`.

Il est **idempotent** : on peut le relancer. Il n'écrase jamais `deploy/.env`,
ne supprime jamais de volume et ne réinitialise jamais la base.

### Codes de sortie

| Code | Signification                                                      |
| ---- | ------------------------------------------------------------------ |
| `0`  | tout est bon                                                        |
| `1`  | anomalies bloquantes ou opération échouée                          |
| `2`  | mauvaise utilisation (option inconnue)                             |
| `3`  | prérequis serveur insuffisant (root, Docker, outils)                |
| `4`  | `deploy/.env` absent, invalide ou incomplet                        |
| `5`  | port occupé / chaîne HTTP (Nginx, Apache) en échec                  |
| `6`  | connexion e-mail + mot de passe en échec (502 ou refus applicatif)  |
| `7`  | non-régression Google en échec                                     |

---

## 4 bis. Ce que vérifie le script sur les connexions

**E-mail + mot de passe** — `POST /api/auth/login/superadmin` est rejoué avec
le compte `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`, d'abord à travers le
Nginx du conteneur, puis à travers Apache. Le script vérifie ensuite que le
cookie `uswap_refresh` revient en `HttpOnly`, que `/auth/refresh` répond 200 et
que `/auth/logout` ferme la session de test.

- Un **502** n'est jamais laissé sans explication : le script rappelle les
  causes mesurées dans le même passage (backend non healthy, migrations
  manquantes, base injoignable, nom `backend` non résolu) et renvoie le code 6.
- Si `SUPERADMIN_PASSWORD` ressemble encore à un modèle ou contient « Demo »,
  **aucune connexion n'est tentée** : le script ne verrouille pas un compte
  réel avec de faux essais. Un avertissement l'indique.
- Un **429** interrompt les essais : le script n'insiste pas et laisse le
  verrou expirer.

**Google** — vérification de **non-régression uniquement** : aucun appel à
Google, aucune configuration modifiée. Le script contrôle que
`GOOGLE_CLIENT_ID` est présent et au bon format, que le domaine du compte
super administrateur est couvert par `GOOGLE_ALLOWED_DOMAINS`, que le bundle du
frontend contient le même identifiant (sinon le bouton disparaît), et que
`POST /api/auth/google` refuse un jeton invalide en 401 (et non en 400 « non
configuré »).

---

## 5. Vérifier que uSwap fonctionne

```bash
# 1. Les trois conteneurs doivent être "healthy"
cd /opt/uswap-github
sudo docker compose -f deploy/compose.yaml --env-file deploy/.env ps

# 2. Le frontend répond
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/          # 200

# 3. L'API répond (session anonyme)
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/api/auth/session   # 204

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

```bash
sudo bash deploy/deploy.sh --diagnose   # cause mesurée, en lecture seule
sudo bash deploy/deploy.sh --repair     # réparations sûres (base, migrations,
                                        # bootstrap, Apache)
sudo bash deploy/deploy.sh --deploy     # redéploiement complet
```

Le diagnostic lit `logs backend` et nomme la cause (P1001 base injoignable,
`P2021` migrations non appliquées, nom `backend` non résolu, backend non
healthy).

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
sudo bash deploy/deploy.sh --deploy
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
