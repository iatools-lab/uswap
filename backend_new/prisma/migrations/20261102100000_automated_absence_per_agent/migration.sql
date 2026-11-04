-- Absence automatique : le marqueur devient unique PAR AGENT.
--
-- Avant : `shiftId` seul était la clé primaire. Sur un service à deux agents,
-- le premier absent créait le marqueur ; le second n'était PLUS JAMAIS examiné
-- (le constat était considéré comme déjà fait). Résultat : un agent pouvait ne
-- jamais être déclaré absent alors qu'il n'avait rien pointé.
--
-- Après : clé primaire (shiftId, swapperId). Chaque agent affecté est traité
-- séparément, avec son propre motif (ni prise ni fin de service / fin de
-- service non pointée).

-- Colonne ajoutée en deux temps pour rester valable sur une table non vide.
ALTER TABLE "automated_absences" ADD COLUMN IF NOT EXISTS "swapperId" TEXT;

-- Backfill : l'agent réellement affecté du créneau. Un marqueur existant
-- portait forcément sur l'affectation du service (une seule affectation par
-- créneau avant les remplacements).
UPDATE "automated_absences" a
SET "swapperId" = (
  SELECT oa."userId"
  FROM "occurrence_assignments" oa
  WHERE oa."occurrenceId" = a."shiftId"
  ORDER BY oa."createdAt"
  LIMIT 1
)
WHERE a."swapperId" IS NULL;

-- Ligne orpheline (créneau supprimé entre-temps) : rien à conserver.
DELETE FROM "automated_absences" WHERE "swapperId" IS NULL;

ALTER TABLE "automated_absences" ALTER COLUMN "swapperId" SET NOT NULL;

ALTER TABLE "automated_absences" DROP CONSTRAINT IF EXISTS "automated_absences_pkey";
ALTER TABLE "automated_absences" ADD CONSTRAINT "automated_absences_pkey" PRIMARY KEY ("shiftId", "swapperId");
