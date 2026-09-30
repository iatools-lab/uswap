/*
  Warnings:

  - You are about to drop the column `qrCodeTtl` on the `Station` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name]` on the table `Station` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Station" DROP COLUMN "qrCodeTtl",
ADD COLUMN     "checkinQrTtl" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN     "checkoutQrTtl" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "latenessToleranceMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "minRestHours" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Africa/Douala',
ADD COLUMN     "weeklyHoursLimit" INTEGER NOT NULL DEFAULT 48;

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Station_name_key" ON "Station"("name");
