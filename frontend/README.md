# uSwap — Frontend (React + Vite)

Interface web du projet **uSwap** (UpOwa) : planification, pointage GPS, suivi
des présences, congés, incidents et rapports.

---

## Démarrage

```bash
npm install
npm run dev          # http://127.0.0.1:5173
```

Le fichier `frontend/.env` doit contenir :

```env
VITE_API_URL=/api
```

> **Important** — Le frontend appelle `/api`, **proxifié** par Vite vers le
> backend (`http://localhost:3000`). Ne le faites pas pointer directement sur
> `http://localhost:3000` : l'appel deviendrait *cross-site* et la session
> (cookie `HttpOnly`) serait perdue à chaque changement de page.

Sans backend démarré, les écrans ne se chargent pas : lancez d'abord
`npm run start:dev` à la racine du projet.

---

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement (HMR) |
| `npm run build` | Typage (`tsc -b`) puis build de production |
| `npm run preview` | Sert le build de production en local |
| `npm run format` | Formatage Prettier |

---

## Organisation

```
src/
├── api/            # Client HTTP + passerelles (gateways)
│   ├── auth-api.ts         # api(), login, refresh, download
│   └── gateways/           # Contrats typés par domaine (congés, etc.)
├── app/            # Session, routage, garde de rôles
├── domain/         # Types métier partagés
├── features/       # Écrans fonctionnels
│   ├── planner/            # Calendrier de planning, publication
│   ├── operations/         # Espace swappeur : pointage, historique
│   ├── leaves/             # Demande et suivi des congés
│   ├── incidents/          # Signalement d'incident
│   ├── stations/           # Modèles de shift, contraintes
│   └── supervision/        # Tableaux de bord superviseur
├── pages/          # Pages routées par rôle
└── ui/             # Composants réutilisables (Modal, Select, Toast…)
```

---

## Rôles et navigation

| Rôle | Espace |
|---|---|
| `ADMIN` | `/app/admin` — réseau, comptes, stations, rapports |
| `SUPERVISOR` | `/app/supervision` — plannings, incidents, suivi |
| `SWAPPER` | `/app/mon-espace` — créneaux, pointage, congés |

`rolePaths` (dans `api/auth-api.ts`) associe chaque rôle à son espace ; le
routage redirige automatiquement après connexion.

---

## Conventions

- **Langue** — Toute l'interface est en **français**. Les textes affichés
  doivent rester en français, y compris les messages d'erreur.
- **Encodage** — Les fichiers sources sont en **UTF-8**. Les accents ne doivent
  jamais être réécrits en séquences de type `Ã©` (voir
  `scripts/fix-mojibake.cjs` à la racine du projet).
- **Icônes** — Toutes les icônes viennent de `@phosphor-icons/react` via le pont
  `src/ui/icons.ts`, qui fournit aussi les alias de compatibilité.
- **API** — Toujours passer par `api()` de `api/auth-api.ts` : il gère le jeton,
  le renouvellement de session, les erreurs et le délai d'attente.

---

## Vérifier

```bash
npx tsc -b        # typage
npm run build     # typage + build
```

---

## Dépannage

| Symptôme | Cause / solution |
|---|---|
| Données fictives affichées | Ancien mode maquette : vérifier que `VITE_API_URL=/api` |
| Session perdue à chaque page | Le proxy n'est pas utilisé (`VITE_API_URL` doit valoir `/api`) |
| `Cannot GET /api/...` | Le backend n'est pas démarré sur le port 3000 |
| Modifications invisibles | Vider le cache du navigateur (`Ctrl + Shift + R`) |
| Erreurs de types sur les icônes | `node scripts/fix-phosphor-types.cjs` à la racine |
