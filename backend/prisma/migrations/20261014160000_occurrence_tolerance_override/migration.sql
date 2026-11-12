-- Tolerance de retard propre a un creneau : prioritaire sur celle de la station.
ALTER TABLE "occurrences" ADD COLUMN "latenessToleranceOverrideMinutes" INTEGER;
