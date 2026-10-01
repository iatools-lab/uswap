-- Sprint 5.2 : synchronisation des congés, soldes et références client.
-- Ajoute les types et tables nécessaires au contrat /leaves du frontend.

-- 1. Nouveau type de congé (FAMILY).
ALTER TYPE "LeaveType" ADD VALUE IF NOT EXISTS 'FAMILY';

-- 2. Nouveaux enums de synchronisation.
DO $$ BEGIN
    CREATE TYPE "LeaveSyncAction" AS ENUM ('CREATE', 'UPDATE', 'CANCEL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "LeaveSyncStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SYNCED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Référence client idempotente sur les demandes de congé.
ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "clientRef" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "LeaveRequest_clientRef_key" ON "LeaveRequest"("clientRef");

-- 4. Solde de congés par swappeur.
CREATE TABLE IF NOT EXISTS "LeaveBalance" (
    "id" TEXT NOT NULL,
    "swapperId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "entitledDays" INTEGER NOT NULL DEFAULT 30,
    "usedDays" INTEGER NOT NULL DEFAULT 0,
    "pendingDays" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeaveBalance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LeaveBalance_swapperId_key" ON "LeaveBalance"("swapperId");

DO $$ BEGIN
    ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_swapperId_fkey"
        FOREIGN KEY ("swapperId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 5. Journal des opérations de synchronisation.
CREATE TABLE IF NOT EXISTS "LeaveSyncOperation" (
    "id" TEXT NOT NULL,
    "leaveRequestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "LeaveSyncAction" NOT NULL,
    "status" "LeaveSyncStatus" NOT NULL DEFAULT 'SYNCED',
    "idempotencyKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastAttemptAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeaveSyncOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LeaveSyncOperation_idempotencyKey_key" ON "LeaveSyncOperation"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "LeaveSyncOperation_userId_idx" ON "LeaveSyncOperation"("userId");
CREATE INDEX IF NOT EXISTS "LeaveSyncOperation_leaveRequestId_idx" ON "LeaveSyncOperation"("leaveRequestId");

DO $$ BEGIN
    ALTER TABLE "LeaveSyncOperation" ADD CONSTRAINT "LeaveSyncOperation_leaveRequestId_fkey"
        FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "LeaveSyncOperation" ADD CONSTRAINT "LeaveSyncOperation_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
