
Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
# UpOwa / Uswap

## Présentation

**UpOwa / Uswap** est une application web de gestion et de supervision des swappers au niveau des stations.

L'application permet notamment de gérer :

* les utilisateurs et leurs rôles ;
* les stations ;
* les swappers ;
* les plannings et shifts ;
* les présences et absences ;
* le pointage par QR Code START / END ;
* les remplacements et changements de shifts ;
* la supervision des opérations.

**Sprint actuel : Sprint 4**

---

## Architecture

Le projet est organisé en trois parties principales :

Frontend React
↓
API REST
↓
Backend NestJS
↓
Prisma
↓
PostgreSQL

Le frontend fournit l'interface utilisateur tandis que le backend centralise l'API, l'authentification et la logique métier.

---

## Stack technique

### Frontend

* React **19.3.0**
* React DOM **19.3.0**
* Vite **8.0.14**
* TypeScript **~5.8.3**
* React Router **7.18.3**

### Backend

* NestJS **^11.0.1**
* TypeScript **^5.7.3**
* Prisma Client **^6.19.3**
* `@prisma/adapter-pg` **^7.10.0**
* `pg` **^8.23.0**
* Swagger **^11.4.7**
* JWT **^12.0.1**

### Environnement

* Node.js **24.15.0**
* npm **11.12.1**
* Git + GitHub
* PostgreSQL

---

## Fonctionnalités principales

### Authentification

Le système utilise JWT et gère quatre rôles :

* `ADMIN`
* `SUPERVISOR`
* `STATION_CHIEF`Versions déjà identifiées :

  Node.js 24.15.0

  npm 11.12.1

  React 19.3.0

  React DOM 19.3.0

  Vite 8.0.14

  TypeScript frontend ~5.8.3

  React Router 7.18.3

  NestJS ^11.0.1

  TypeScript backend ^5.7.3

  Prisma Client ^6.19.3

  @prisma/adapter-pg ^7.10.0

  pg ^8.23.0

  Swagger ^11.4.7

  JWT ^12.0.1

  Git + GitHub, dépôt uswap-github, branche danielle
* `SWAPPER`

### Stations

Gestion des stations avec leurs informations et coordonnées géographiques.

### Planning et shifts

Gestion des périodes de planning et des shifts :

* MORNING : 06:00–14:00
* AFTERNOON : 14:00–22:00
* NIGHT : 22:00–06:00

Les règles de planification prennent notamment en compte le repos minimal et la limite hebdomadaire.

### Attendance / QR Code

Le pointage utilise deux QR Codes :

* `START`
* `END`

La règle actuelle exige les deux scans pour une présence complète.

`START + END` → présence normale

`START` seulement ou `END` seulement → `ABSENT`

---

## API

Le backend expose une API REST documentée avec Swagger.

En développement local :

`http://localhost:3000/api-docs`

---

## Installation

### Backend

npm install

npx prisma generate

npx prisma migrate dev

npm run start

### Frontend

npm install

npm run dev

Le frontend utilise la variable :

`VITE_API_URL=http://localhost:3000`

---

## Git et organisation des branches

Le dépôt GitHub est :

`uswap-github`

### Branches

`danielle`
→ branche de développement personnelle.

`dylane_v0`
→ branche intermédiaire commune pour intégrer les travaux de l'équipe.

`main`
→ branche destinée à la version stable et finale.

### Workflow

`danielle`

↓

Pull Request

↓

`dylane_v0`

↓

Intégration et tests

↓

`main`

↓

Tag de version

---

## Versionnement

Les versions importantes sont identifiées avec des tags Git.

Exemple :

`v1.0.0`

Le tag permet d'identifier précisément le commit correspondant à une version donnée du projet.

---

## Sécurité

Les informations sensibles telles que :

* `DATABASE_URL`
* `JWT_SECRET`
* mots de passe
* autres secrets

ne doivent pas être commités dans Git.

Les variables sensibles doivent être conservées dans les fichiers `.env` locaux.

---

## État actuel

**Sprint : 4**

Le frontend et le backend sont actuellement fonctionnels et continuent d'être intégrés et testés avant la version finale.

**Branche de développement :** `danielle`

**Branche intermédiaire :** `dylane_v0`

**Branche finale :** `main`

**Version finale prévue :** `v1.0.0`
