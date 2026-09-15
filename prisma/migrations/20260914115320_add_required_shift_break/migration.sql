/*
  Warnings:

  - Added the required column `breakEndTime` to the `Shift` table without a default value. This is not possible if the table is not empty.
  - Added the required column `breakStartTime` to the `Shift` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Shift"
ADD COLUMN "breakStartTime" TIMESTAMP(3),
ADD COLUMN "breakEndTime" TIMESTAMP(3);

UPDATE "Shift"
SET
  "breakStartTime" = "startTime" + INTERVAL '3 hours',
  "breakEndTime" = "startTime" + INTERVAL '4 hours';

ALTER TABLE "Shift"
ALTER COLUMN "breakStartTime" SET NOT NULL,
ALTER COLUMN "breakEndTime" SET NOT NULL;