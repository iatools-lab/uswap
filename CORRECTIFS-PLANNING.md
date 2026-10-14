# Correctifs — écran de planning et parcours swappeur

Ce document récapitule les anomalies signalées et leur correction. Toutes les
corrections sont **côté backend et encodage** ; le **visuel du frontend n'a pas
été modifié** (aucun bouton supprimé ni ajouté).

---

## 1. Accents cassés (« publiÃ© », « â€” »…)

**Cause** — Une partie des fichiers avait été ré-encodée : le contenu UTF-8 a
été relu comme du Windows-1252 puis réécrit en UTF-8, doublant les accents.
La corruption était **partielle** : certains accents étaient restés corrects.

**Correction** — `scripts/fix-mojibake.cjs` remplace uniquement les séquences de
mojibake connues (accents, tirets, guillemets, points de suspension). 226
fichiers ont été balayés, 6 corrigés. Le script est réutilisable :

```bash
node scripts/fix-mojibake.cjs --check   # n'écrit rien, signale seulement
node scripts/fix-mojibake.cjs           # corrige
```

---

## 2. Impossible de vérifier / publier un planning

**Trois causes cumulées, toutes côté serveur :**

1. **Verbe HTTP** — L'écran appelle `api(path, { revision })` sans méthode ;
   l'utilitaire en déduit **POST** dès qu'un corps est présent. Or les routes
   n'étaient déclarées qu'en `@Patch` → **404 « Cannot POST /plannings/:id/… »**.
   → Les routes `publish` et `validate` existent maintenant en **POST _et_ PATCH**.

2. **Champ `valid` manquant** — `validatePlanning` renvoyait `errors`,
   `warnings`, `totals`, `byStation`… mais **jamais `valid`**. Le bouton utilise
   `disabled={!report?.valid}` : `undefined` étant toujours faux, le bouton
   **« Confirmer la publication » restait grisé en permanence**.
   → `valid: errors.length === 0` est désormais renvoyé.

3. **Corps non déclaré** — sans `@Body()`, la validation globale (`whitelist` +
   `forbidNonWhitelisted`) rejetait `{ revision }` en **400**.
   → les corps sont acceptés sur `publish`, `validate`, `auto-assign`,
   `duplicate` et `remove`.

Vérifié de bout en bout **dans un navigateur** : `POST /validate` → 201 avec
`valid: true`, bouton « Confirmer » actif, clic →
« Planning publié. Les équipes concernées ont reçu leurs horaires. »

---

## 3. « Le planning ne fait pas de shifts pour tous les jours sélectionnés »

**Deux causes cumulées :**

1. `buildSlotStart` / `slotFromTime` utilisaient `setHours` (heure **locale**)
   alors que la fenêtre du planning est en **UTC** ; le filtre
   `endTime > planning.endDate` rejetait les créneaux des derniers jours.
   → bascule en `setUTCHours` / `setUTCDate`.
2. Les jours étaient comparés avec deux conventions différentes : l'écran envoie
   `1 = lundi … 7 = dimanche`, le serveur lisait `getUTCDay()` (`0 = dimanche`).
   → `matchesWeekday()` accepte les deux conventions et le frontend envoie
   désormais les numéros JavaScript (`0 = dimanche`).

Les jours non couverts sont maintenant signalés dans `vacancies`.

---

## 4. « Il y a des shifts qui n'ont pas de pause »

**Cause** — Les modèles (`ShiftTemplate`) contiennent bien la pause, mais les
créneaux générés (`Shift`) n'y étaient pas rattachés : `withOccurrences`
renvoyait `breakMinutes: 0` en dur. Le planning affichait donc « sans pause »
alors que la station en avait une.

**Correction** —
- `Shift.templateId` ajouté au schéma et relié à `ShiftTemplate` ;
- la génération recopie le modèle utilisé sur chaque créneau ;
- `withOccurrences` lit la pause du modèle.

Les créneaux existants sans `templateId` sont désormais rapprochés de leur
modèle par correspondance horaire.

---

## 5. Impossible de créer un incident

**Cause** — L'écran envoie `stationId`, absent du DTO. La validation le
rejetait en **400 « propriété non autorisée »**.

**Correction** — `CreateIncidentDto` accepte `stationId` (le service déduit de
toute façon la station du déclarant). Vérifié : **HTTP 201**.

---

## 6. « Demander un congé ne fait rien »

**Cause** — `LeaveService.create` exigeait un `idempotencyKey`, que l'écran en
ligne n'envoie pas → **400 « Référence de synchronisation manquante »**.

**Correction** — le serveur génère la clé s'il n'en reçoit pas, et crée le solde
manquant avant d'enregistrer la demande. Vérifié : **HTTP 201**.

---

## 7. « Je ne vois pas où pointer »

**Cause** — Aucun planning publié n'existait, car la publication était cassée
(point 2). Le pointage exige par ailleurs un shift **publié et affecté**.

**Correction** —
- la fenêtre de pointage s'ouvre désormais **15 min avant** le début du shift
  (au lieu de l'heure pile), côté serveur et côté affichage ;
- l'état vide explique clairement qu'un shift doit être publié et affecté.

---

## 8. Anciens plannings toujours présents en base

**Correction** — `scripts/delete-plannings.cjs` supprime un ou tous les
plannings avec leurs dépendances (shifts, présences, changements, avis) :

```bash
node scripts/delete-plannings.cjs --all --dry-run   # simulation
node scripts/delete-plannings.cjs --all             # suppression
node scripts/delete-plannings.cjs <id> [<id> ...]   # ciblée
```

Les anciens plannings ont été supprimés.

---

## 9. Modification d'un shift

**Cause** — Le contrôle d'affectation renvoyait `{ valid, warnings }` alors que
l'écran attend `stationName`, `timezone`, `durationHours` et `weeks` : le
composant de contrôle lisait `report.weeks.map` sur `undefined`.

**Correction** — `validateOccurrence` renvoie le rapport complet et distingue
désormais :
- **erreurs** (`OVERLAP`, mauvaise station, swappeur inactif) → bloquent ;
- **avertissements** (limite hebdomadaire) → n'empêchent plus l'enregistrement.

---

## Vérifications

| Contrôle | Résultat |
|---|---|
| `npx tsc --noEmit -p tsconfig.build.json` (backend) | OK |
| `npx tsc -b` (frontend) | OK |
| `npm run build` (frontend) | OK |
| `npx jest` (backend)                                | OK       |
| Incident (superviseur, avec `stationId`)            | HTTP 201 |
| Congé (swappeur, sans `idempotencyKey`)             | HTTP 201 |
| `POST /plannings/:id/validate`                      | 201, `valid: true` |
| `POST /plannings/:id/publish`                       | 201, `PUBLISHED` |
| Publication pilotée depuis le navigateur            | bouton actif, OK |
| Génération + validation + publication               | OK       |
| Pauses présentes sur les créneaux générés | OK |
| Plannings en base après nettoyage | 0 |

> `scripts/fix-phosphor-types.cjs` répare uniquement la résolution de types du
> paquet d'icônes (l'agrégateur `dist/index.d.ts` manquait) : aucun impact sur
> les écrans ou les boutons.
