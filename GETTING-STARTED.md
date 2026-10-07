# Guide de démarrage — uSwap (dépôt public)

> Vous venez de cloner ce dépôt et vous voulez le faire tourner ?
> Ce guide vous emmène de zéro à une application fonctionnelle en local.
>
> Dernière version stable : tag **`Uswap-V5.3`** (branche `develop`).

---

## 1. C'est quoi, uSwap ?

**uSwap** (projet *UpOwa*) est une application web de **planification et de
supervision des équipes de swapping** réparties sur plusieurs stations.

Elle couvre le cycle complet d'une journée de travail :

1. **Planifier** — créer un planning, générer les créneaux depuis les modèles de
   la station, publier.
2. **Pointer** — le swappeur pointe sa prise et sa fin de service.
3. **Suivre** — retards, absences, corrections, journal des mouvements.
4. **Couvrir** — une absence ouvre une demande de remplacement, le superviseur
   arbitre.
5. **Piloter** — rapports consolidés, exports, réglages réseau, administration.

---

## 2. Architecture

```
┌──────────────────────┐        ┌──────────────────────┐        ┌────────────┐
│  Frontend (React)    │  /api  │   Backend (NestJS)   │ Prisma │ PostgreSQL │
│  Vite — 127.0.0.1:5173├───────▶│  localhost:3000      ├───────▶│            │
└──────────────────────┘ proxy  └──────────────────────┘        └────────────┘
```

Le frontend **proxifie** `/api` vers le backend : les deux partagent ainsi la
**même origine**, ce qui est indispensable au bon fonctionnement du cookie de
session `HttpOnly`. Ne configurez pas le frontend pour appeler directement
`http://localhost:3000` : l'appel serait *cross-site* et la session se perdrait à
chaque changement de page.

---

## 3. Prérequis

| Outil | Version conseillée |
|---|---|
| Node.js | **24.x** |
| npm | **11.x** |
| PostgreSQL | 14 ou plus |
| Git | récent |

Vérifiez rapidement :

```bash
node -v
npm -v
psql --version
```

---

## 4. Récupérer le code

```bash
git clone <url-du-depot> uswap-github
cd uswap-github
```

Pour travailler sur la version stable :

```bash
git checkout develop
# ou, pour figer une version précise :
git checkout Uswap-V5.3
```

---

## 5. Base de données

Créez une base vide :

```bash
createdb uswap        # ou via psql / pgAdmin
```

---

## 6. Configuration du backend

Copiez le modèle puis renseignez vos valeurs :

```bash
cp .env.example .env      # sur Windows PowerShell : Copy-Item .env.example .env
```

Variables principales :

```env
DATABASE_URL="postgresql://user:pass@localhost:5432/uswap"
JWT_SECRET="une-chaine-longue-et-secrete"
ACCESS_TOKEN_TTL_SECONDS=900
PORT=3000
CORS_ORIGIN="http://127.0.0.1:5173,http://localhost:5173"
FRONTEND_URL="http://127.0.0.1:5173"
```

> ⚠️ **Ne commitez jamais** `.env`, ni `DATABASE_URL`, `JWT_SECRET`, clés SMTP
> ou VAPID. Ces fichiers sont déjà exclus par `.gitignore`.

---

## 7. Installer et préparer le backend

```bash
npm install
npx prisma migrate deploy     # applique toutes les migrations
npx prisma generate           # génère le client Prisma
npm run seed                  # jeu de données de démonstration
```

---

## 8. Lancer le backend

```bash
npm run start:dev             # http://localhost:3000
```

Vérifications utiles :

- Racine : <http://localhost:3000/> → `Hello World!`
- Documentation Swagger : <http://localhost:3000/api-docs>

---

## 9. Configuration et lancement du frontend

Dans un **second terminal** :

```bash
cd frontend
cp .env.example .env          # PowerShell : Copy-Item .env.example .env
npm install
npm run dev                   # http://127.0.0.1:5173
```

Le fichier `frontend/.env` doit contenir :

```env
VITE_API_URL=/api
```

> **Important** : si `VITE_API_URL` est **vide**, le frontend bascule en **mode
> maquette** (données simulées, `usingMock`) et n'appelle jamais le backend.
> Pour tester le vrai back-end, cette variable est obligatoire.

---

## 10. Se connecter (comptes de démonstration)

Mot de passe commun : **`Uswap2026!Demo`**
(surchargeable via `DEMO_PASSWORD` avant de lancer le seed)

| Rôle | Adresse e-mail |
|---|---|
| Administrateur | `admin@upowa.org` |
| Superviseur | `superviseur@upowa.org` |
| Chef de station | `chef@upowa.org` |
| Swappeur | tout compte `SWAPPER` actif (voir `npm run seed`) |

Les swappers du seed sont créés **inactifs** (parcours d'invitation). Pour en
activer un sans service e-mail :

```bash
node scripts/activate-user.cjs <email> [motDePasse]
```

---

## 11. E-mails (optionnel)

Sans configuration SMTP, aucun e-mail n'est envoyé : le compte est bien créé en
base mais reste inactif, et l'API renvoie un champ **`activationUrl`** que
l'administrateur peut transmettre lui-même (le lien est aussi écrit dans les logs).

Avec un SMTP (Gmail + mot de passe d'application) :

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=adresse@gmail.com
SMTP_PASS=GOOGLE_APP_PASSWORD
MAIL_FROM=adresse@gmail.com
```

> `SMTP_PASS` doit être un **Google App Password**, jamais le mot de passe Gmail normal.

---

## 12. Vérifier que tout est bien connecté

```bash
# Backend
npx tsc --noEmit -p tsconfig.build.json   # typage
npm run build                             # compilation
npx jest                                  # tests unitaires

# Frontend
cd frontend && npm run build              # typage + build

# Contrats et bout en bout (backend et frontend démarrés)
node scripts/audit-contract.cjs           # chaque appel frontend a une route backend
node scripts/test-e2e.mjs                 # vérifications fonctionnelles (70)
```

Test rapide manuel de la connexion frontend ↔ backend :

```bash
# Doit renvoyer Hello World! si le proxy et le backend fonctionnent
curl http://127.0.0.1:5173/api/
```

---

## 13. Structure du dépôt

```
uswap-github/
├── src/                    # Backend NestJS (modules, contrôleurs, services)
├── prisma/
│   ├── schema.prisma       # Modèle de données
│   ├── migrations/         # Migrations SQL
│   └── seed.ts             # Jeu de données de démonstration
├── frontend/               # Application React + Vite
│   └── src/
│       ├── api/            # Client API + couche maquette (mode démo)
│       ├── features/       # Écrans fonctionnels
│       └── pages/          # Pages routées
├── scripts/                # Outils de vérification (contrat, e2e, activation)
├── docs/                   # Documentation détaillée
└── README.md               # Vue d'ensemble du projet
```

---

## 14. Rôles et permissions

| Rôle | Périmètre |
|---|---|
| `ADMIN` | Réglages réseau, comptes, stations, rapports programmés |
| `SUPERVISOR` | Plannings, incidents, points de contrôle, rapports réseau |
| `STATION_CHIEF` | Sa station : pointage, incidents, suivi du jour |
| `SWAPPER` | Son espace : créneaux, congés, historique de pointage |

Sécurité : JWT à durée courte, refresh token à usage unique dans un cookie
`HttpOnly`, cloisonnement par station, machine à états des incidents validée côté
serveur, validation d'entrée stricte, journalisation des actions sensibles.

---

## 15. Documentation détaillée

| Document | Contenu |
|---|---|
| [`docs/FONCTIONNEMENT-SPRINTS-1-A-5.md`](docs/FONCTIONNEMENT-SPRINTS-1-A-5.md) | Fonctionnement du projet et rôle de chaque API, sprint par sprint |
| [`docs/V5.3.0-NOUVELLE-VERSION-ET-API.md`](docs/V5.3.0-NOUVELLE-VERSION-ET-API.md) | Nouveautés de la 5.3 + documentation complète des routes |
| [`docs/V5.3.0-INTEGRATION-FRONTEND-S5.2.0.md`](docs/V5.3.0-INTEGRATION-FRONTEND-S5.2.0.md) | Intégration du frontend sprint 5.2.0 (pointage GPS, inbox congés) |
| [`US-2069-2078-COMPLIANCE.md`](US-2069-2078-COMPLIANCE.md) | Matrice de conformité des User Stories 2069–2078 |
| [`FIXES.md`](FIXES.md) | Correctifs full-stack de la version 5.3 |

---

## 16. Dépannage

| Symptôme | Cause probable / solution |
|---|---|
| Le frontend affiche des données fictives | `frontend/.env` absent ou `VITE_API_URL` vide → mode maquette. |
| La session se perd à chaque page | Le frontend n'utilise pas le proxy : `VITE_API_URL` doit valoir `/api`. |
| `Can't reach database server` | PostgreSQL non démarré ou `DATABASE_URL` incorrecte. |
| Erreur de client Prisma (`@prisma/client`) | Lancer `npx prisma generate`. |
| Tables manquantes | Lancer `npx prisma migrate deploy`. |
| Port déjà utilisé | Un autre processus occupe 3000 / 5173, ou relancez sans l'ancien serveur. |
| `EPERM` sur les binaires Prisma | Un serveur Node tourne encore : arrêtez-le puis relancez `npx prisma generate`. |

---

## 17. Contribuer

| Branche | Rôle |
|---|---|
| `danielle` | Développement backend et intégration |
| `dylane` | Développement frontend |
| `develop` | Branche d'intégration : reçoit les versions testées |
| `main` | Version stable |

Workflow : travailler sur sa branche, lancer les vérifications de la section 12,
puis intégrer dans `develop` et marquer par un tag de version.
