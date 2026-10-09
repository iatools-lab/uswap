# Correctifs — planning, pointage et congés (v6.2)

Cette version corrige une série d'anomalies bloquantes signalées sur l'écran de
planning et le parcours du swappeur. Toutes les corrections sont **côté serveur
et encodage** : le **visuel du frontend n'a pas été modifié** (aucun bouton
supprimé ni ajouté).

> Détail complet, cause par cause : [`CORRECTIFS-PLANNING.md`](CORRECTIFS-PLANNING.md).

---

## Les 8 corrections

### 1. Accents cassés (« publiÃ© », « â€” »…)
Une partie des fichiers avait été ré-encodée (UTF-8 relu en Windows-1252), ce qui
doublait les accents. `scripts/fix-mojibake.cjs` répare uniquement les séquences
corrompues — la corruption étant partielle, un ré-encodage global aurait cassé
les accents déjà corrects.

```bash
node scripts/fix-mojibake.cjs --check   # signale sans écrire
node scripts/fix-mojibake.cjs           # corrige
```

### 2. Impossible de vérifier / publier un planning
Trois causes cumulées :
- **Verbe HTTP** : l'écran envoie `POST`, les routes n'étaient qu'en `PATCH`
  → `404 Cannot POST`. Les routes existent maintenant en **POST _et_ PATCH**.
- **Champ `valid` manquant** : `validatePlanning` ne renvoyait pas `valid`, donc
  `disabled={!report?.valid}` laissait le bouton **grisé en permanence**.
- **Corps non déclaré** : sans `@Body()`, la whitelist rejetait `{ revision }`
  en `400`.

### 3. Le planning ne couvrait pas tous les jours
Les heures étaient calculées en heure **locale** alors que la fenêtre du
planning est en **UTC** ; les jours étaient aussi comparés avec deux conventions
(`1 = lundi` côté écran, `0 = dimanche` côté serveur). Corrigé dans les deux
sens.

### 4. Créneaux « sans pause »
Les modèles de shift contenaient bien les pauses, mais les créneaux générés
n'étaient pas reliés au modèle. `Shift.templateId` a été ajouté : le planning
affiche désormais la pause réelle.

### 5. Impossible de créer un incident
L'écran envoie `stationId`, que le DTO rejetait (`400`). Le champ est accepté.

### 6. « Demander un congé » ne faisait rien
Deux causes :
- le serveur exigeait un `idempotencyKey` absent du formulaire en ligne ;
- les swappeurs sans ligne de solde avaient `remainingDays = 0`, ce qui laissait
  le bouton **désactivé sans explication**.

`scripts/ensure-leave-balances.cjs` crée/remet à niveau les soldes, et le
formulaire indique maintenant pourquoi l'envoi est bloqué.

### 7. Pointage marqué « absent » avant l'heure
Un créneau à venir était affiché comme **absent** et parfois comme **déjà
pointé**. L'historique renvoie désormais le statut réel (`EXPECTED`) et
distingue « Non pointé » d'« Absent ». La fenêtre de pointage ouvre **15 min
avant** le début du service.

### 8. Anciens plannings en base
`scripts/delete-plannings.cjs` supprime un ou tous les plannings avec leurs
dépendances.

```bash
node scripts/delete-plannings.cjs --all --dry-run
node scripts/delete-plannings.cjs --all
```

---

## Vérifications

| Contrôle | Résultat |
|---|---|
| `npx tsc --noEmit -p tsconfig.build.json` (backend) | OK |
| `npx tsc -b` (frontend) | OK |
| `npm run build` (backend et frontend) | OK |
| `npx jest` (backend) | OK |
| `POST /plannings/:id/validate` | 201, `valid: true` |
| `POST /plannings/:id/publish` | 201, `PUBLISHED` |
| Publication pilotée depuis le navigateur | bouton actif, succès |
| `POST /incidents` (avec `stationId`) | 201 |
| `POST /leaves` (sans `idempotencyKey`) | 201 |
| Créneau à venir dans l'historique | `EXPECTED`, `isAbsent: false` |

---

## Installation

```bash
npm install
npx prisma generate
npx prisma db push
npm run build

cd frontend
npm install
npm run build
```

Après mise à jour, **rechargez le navigateur avec `Ctrl + Shift + R`** pour
écarter tout module en cache.

---

## Outils de maintenance

| Script | Rôle |
|---|---|
| `scripts/fix-mojibake.cjs` | Répare les accents double-encodés |
| `scripts/delete-plannings.cjs` | Supprime des plannings et leurs dépendances |
| `scripts/ensure-leave-balances.cjs` | Crée/met à niveau les soldes de congé |
| `scripts/fix-phosphor-types.cjs` | Répare la résolution de types des icônes |
| `scripts/_db-inventory.cjs` | Inventaire plannings / créneaux / modèles |
