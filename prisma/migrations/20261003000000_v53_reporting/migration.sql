-- uSwap v5.3 reporting: scheduled execution history and export audit.
CREATE TABLE IF NOT EXISTS "ScheduledReportRun" (
  "id" TEXT NOT NULL,
  "scheduledReportId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "format" "ScheduledReportFormat" NOT NULL,
  "recipients" TEXT[] NOT NULL,
  "from" TIMESTAMP(3),
  "to" TIMESTAMP(3),
  "scope" TEXT NOT NULL,
  "stationId" TEXT,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  CONSTRAINT "ScheduledReportRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ScheduledReportRun_scheduledReportId_generatedAt_idx" ON "ScheduledReportRun"("scheduledReportId","generatedAt");
CREATE INDEX IF NOT EXISTS "ScheduledReportRun_status_generatedAt_idx" ON "ScheduledReportRun"("status","generatedAt");
DO $$ BEGIN
  ALTER TABLE "ScheduledReportRun" ADD CONSTRAINT "ScheduledReportRun_scheduledReportId_fkey"
  FOREIGN KEY ("scheduledReportId") REFERENCES "ScheduledReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ReportExportAudit" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "from" TIMESTAMP(3) NOT NULL,
  "to" TIMESTAMP(3) NOT NULL,
  "stationId" TEXT,
  "swapperId" TEXT,
  "scope" TEXT NOT NULL,
  "sections" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportExportAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ReportExportAudit_actorId_createdAt_idx" ON "ReportExportAudit"("actorId","createdAt");
CREATE INDEX IF NOT EXISTS "ReportExportAudit_createdAt_idx" ON "ReportExportAudit"("createdAt");
