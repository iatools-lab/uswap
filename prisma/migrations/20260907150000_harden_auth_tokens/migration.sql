-- Existing refresh tokens were stored in plaintext. Invalidate them before
-- changing the column semantics to a SHA-256 hash.
DELETE FROM "RefreshToken";

-- AlterTable
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- DropIndex
DROP INDEX "RefreshToken_token_key";

-- RenameColumn
ALTER TABLE "RefreshToken" RENAME COLUMN "token" TO "tokenHash";

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
