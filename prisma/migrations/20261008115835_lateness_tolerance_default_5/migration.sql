-- DropForeignKey
ALTER TABLE "Shift" DROP CONSTRAINT "Shift_swapperId_fkey";

-- AlterTable
ALTER TABLE "Station" ALTER COLUMN "latenessToleranceMinutes" SET DEFAULT 5;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_swapperId_fkey" FOREIGN KEY ("swapperId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
