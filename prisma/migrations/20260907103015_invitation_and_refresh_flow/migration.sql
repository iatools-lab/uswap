/*
  Warnings:

  - You are about to drop the column `phone` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "phone",
ADD COLUMN     "address" TEXT,
ADD COLUMN     "invitationTokenExpires" TIMESTAMP(3),
ADD COLUMN     "invitationTokenHash" TEXT,
ADD COLUMN     "phoneNumber" TEXT;
