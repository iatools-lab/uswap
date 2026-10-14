-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('ADMIN', 'SUPERVISOR', 'SWAPPER');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "AttendanceQr" DROP CONSTRAINT "AttendanceQr_createdById_fkey";

-- DropForeignKey
ALTER TABLE "AttendanceQr" DROP CONSTRAINT "AttendanceQr_shiftId_fkey";

-- DropForeignKey
ALTER TABLE "AttendanceQr" DROP CONSTRAINT "AttendanceQr_stationId_fkey";

-- AlterTable
ALTER TABLE "Station" DROP COLUMN "checkinQrTtl",
DROP COLUMN "checkoutQrTtl";

-- DropTable
DROP TABLE "AttendanceQr";

-- DropEnum
DROP TYPE "AttendanceQrType";
