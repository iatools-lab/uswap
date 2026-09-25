/*
  Warnings:

  - You are about to drop the column `breakEndTime` on the `Shift` table. All the data in the column will be lost.
  - You are about to drop the column `breakStartTime` on the `Shift` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Shift" DROP COLUMN "breakEndTime",
DROP COLUMN "breakStartTime";

-- AlterTable
ALTER TABLE "Station" ALTER COLUMN "weeklyHoursLimit" SET DEFAULT 72;
