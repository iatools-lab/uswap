-- uSwap v5.2 bug-fix schema adjustments
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "disabledAt" TIMESTAMP(3);

ALTER TABLE "Shift" ALTER COLUMN "swapperId" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "CommunicationLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'EMAIL',
  "type" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "errorMessage" TEXT,
  "actionUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunicationLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CommunicationLog_userId_createdAt_idx" ON "CommunicationLog"("userId","createdAt");
CREATE INDEX IF NOT EXISTS "CommunicationLog_recipient_createdAt_idx" ON "CommunicationLog"("recipient","createdAt");
CREATE INDEX IF NOT EXISTS "CommunicationLog_status_idx" ON "CommunicationLog"("status");
DO $$ BEGIN
  ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx" ON "PushSubscription"("userId");
DO $$ BEGIN
  ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "ReplacementRequest" ADD COLUMN IF NOT EXISTS "clientRef" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ReplacementRequest_clientRef_key" ON "ReplacementRequest"("clientRef");
