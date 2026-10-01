-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('EXPECTED', 'CHECKED_IN', 'CHECKED_OUT', 'ABSENT', 'JUSTIFIED');

-- CreateEnum
CREATE TYPE "AttendanceQrType" AS ENUM ('START', 'END');

-- CreateEnum
CREATE TYPE "ReplacementStatus" AS ENUM ('OPEN', 'ASSIGNED', 'CANCELLED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ShiftChangeType" AS ENUM ('ASSIGNMENT', 'REASSIGNMENT', 'REPLACEMENT', 'SWAP', 'MANUAL_EDIT', 'TIME_CHANGE');

-- DropForeignKey
ALTER TABLE "RefreshToken" DROP CONSTRAINT "RefreshToken_userId_fkey";

-- CreateTable
CREATE TABLE "UserStationScope" (
    "userId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserStationScope_pkey" PRIMARY KEY ("userId","stationId")
);

-- CreateTable
CREATE TABLE "PlanningStation" (
    "planningId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,

    CONSTRAINT "PlanningStation_pkey" PRIMARY KEY ("planningId","stationId")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "swapperId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'EXPECTED',
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "checkInLatitude" DOUBLE PRECISION,
    "checkInLongitude" DOUBLE PRECISION,
    "checkOutLatitude" DOUBLE PRECISION,
    "checkOutLongitude" DOUBLE PRECISION,
    "absenceReason" TEXT,
    "correctedAt" TIMESTAMP(3),
    "correctedById" TEXT,
    "correctionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceQr" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "type" "AttendanceQrType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceQr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceCorrection" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "correctedById" TEXT NOT NULL,
    "oldStatus" "AttendanceStatus" NOT NULL,
    "newStatus" "AttendanceStatus" NOT NULL,
    "oldCheckInAt" TIMESTAMP(3),
    "newCheckInAt" TIMESTAMP(3),
    "oldCheckOutAt" TIMESTAMP(3),
    "newCheckOutAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "evidenceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplacementRequest" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "originalSwapperId" TEXT NOT NULL,
    "assignedSwapperId" TEXT,
    "requestedById" TEXT NOT NULL,
    "assignedById" TEXT,
    "reason" TEXT,
    "source" TEXT,
    "status" "ReplacementStatus" NOT NULL DEFAULT 'OPEN',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplacementRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftChange" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "previousSwapperId" TEXT,
    "newSwapperId" TEXT,
    "changedById" TEXT NOT NULL,
    "type" "ShiftChangeType" NOT NULL,
    "reason" TEXT,
    "oldStartTime" TIMESTAMP(3),
    "oldEndTime" TIMESTAMP(3),
    "newStartTime" TIMESTAMP(3),
    "newEndTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserStationScope_stationId_idx" ON "UserStationScope"("stationId");

-- CreateIndex
CREATE INDEX "PlanningStation_stationId_idx" ON "PlanningStation"("stationId");

-- CreateIndex
CREATE INDEX "Attendance_swapperId_status_idx" ON "Attendance"("swapperId", "status");

-- CreateIndex
CREATE INDEX "Attendance_stationId_status_idx" ON "Attendance"("stationId", "status");

-- CreateIndex
CREATE INDEX "Attendance_shiftId_idx" ON "Attendance"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_shiftId_swapperId_key" ON "Attendance"("shiftId", "swapperId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceQr_tokenHash_key" ON "AttendanceQr"("tokenHash");

-- CreateIndex
CREATE INDEX "AttendanceQr_shiftId_type_idx" ON "AttendanceQr"("shiftId", "type");

-- CreateIndex
CREATE INDEX "AttendanceQr_stationId_expiresAt_idx" ON "AttendanceQr"("stationId", "expiresAt");

-- CreateIndex
CREATE INDEX "AttendanceQr_expiresAt_idx" ON "AttendanceQr"("expiresAt");

-- CreateIndex
CREATE INDEX "AttendanceCorrection_attendanceId_idx" ON "AttendanceCorrection"("attendanceId");

-- CreateIndex
CREATE INDEX "AttendanceCorrection_correctedById_idx" ON "AttendanceCorrection"("correctedById");

-- CreateIndex
CREATE INDEX "ReplacementRequest_shiftId_idx" ON "ReplacementRequest"("shiftId");

-- CreateIndex
CREATE INDEX "ReplacementRequest_originalSwapperId_idx" ON "ReplacementRequest"("originalSwapperId");

-- CreateIndex
CREATE INDEX "ReplacementRequest_assignedSwapperId_idx" ON "ReplacementRequest"("assignedSwapperId");

-- CreateIndex
CREATE INDEX "ReplacementRequest_status_idx" ON "ReplacementRequest"("status");

-- CreateIndex
CREATE INDEX "ReplacementRequest_requestedAt_idx" ON "ReplacementRequest"("requestedAt");

-- CreateIndex
CREATE INDEX "ShiftChange_shiftId_idx" ON "ShiftChange"("shiftId");

-- CreateIndex
CREATE INDEX "ShiftChange_previousSwapperId_idx" ON "ShiftChange"("previousSwapperId");

-- CreateIndex
CREATE INDEX "ShiftChange_newSwapperId_idx" ON "ShiftChange"("newSwapperId");

-- CreateIndex
CREATE INDEX "ShiftChange_changedById_idx" ON "ShiftChange"("changedById");

-- CreateIndex
CREATE INDEX "ShiftChange_createdAt_idx" ON "ShiftChange"("createdAt");

-- CreateIndex
CREATE INDEX "LeaveRequest_userId_idx" ON "LeaveRequest"("userId");

-- CreateIndex
CREATE INDEX "LeaveRequest_startDate_endDate_idx" ON "LeaveRequest"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_idx" ON "LeaveRequest"("status");

-- CreateIndex
CREATE INDEX "LoginAttempt_email_idx" ON "LoginAttempt"("email");

-- CreateIndex
CREATE INDEX "LoginAttempt_createdAt_idx" ON "LoginAttempt"("createdAt");

-- CreateIndex
CREATE INDEX "Planning_startDate_endDate_idx" ON "Planning"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "Planning_status_idx" ON "Planning"("status");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "Shift_stationId_startTime_idx" ON "Shift"("stationId", "startTime");

-- CreateIndex
CREATE INDEX "Shift_swapperId_startTime_idx" ON "Shift"("swapperId", "startTime");

-- CreateIndex
CREATE INDEX "Shift_planningId_idx" ON "Shift"("planningId");

-- CreateIndex
CREATE INDEX "Shift_startTime_endTime_idx" ON "Shift"("startTime", "endTime");

-- CreateIndex
CREATE INDEX "Station_isActive_idx" ON "Station"("isActive");

-- CreateIndex
CREATE INDEX "User_stationId_idx" ON "User"("stationId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE INDEX "UserAuditLog_userId_idx" ON "UserAuditLog"("userId");

-- CreateIndex
CREATE INDEX "UserAuditLog_createdAt_idx" ON "UserAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStationScope" ADD CONSTRAINT "UserStationScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStationScope" ADD CONSTRAINT "UserStationScope_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningStation" ADD CONSTRAINT "PlanningStation_planningId_fkey" FOREIGN KEY ("planningId") REFERENCES "Planning"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningStation" ADD CONSTRAINT "PlanningStation_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_swapperId_fkey" FOREIGN KEY ("swapperId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceQr" ADD CONSTRAINT "AttendanceQr_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceQr" ADD CONSTRAINT "AttendanceQr_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceQr" ADD CONSTRAINT "AttendanceQr_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementRequest" ADD CONSTRAINT "ReplacementRequest_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementRequest" ADD CONSTRAINT "ReplacementRequest_originalSwapperId_fkey" FOREIGN KEY ("originalSwapperId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementRequest" ADD CONSTRAINT "ReplacementRequest_assignedSwapperId_fkey" FOREIGN KEY ("assignedSwapperId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementRequest" ADD CONSTRAINT "ReplacementRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementRequest" ADD CONSTRAINT "ReplacementRequest_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftChange" ADD CONSTRAINT "ShiftChange_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftChange" ADD CONSTRAINT "ShiftChange_previousSwapperId_fkey" FOREIGN KEY ("previousSwapperId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftChange" ADD CONSTRAINT "ShiftChange_newSwapperId_fkey" FOREIGN KEY ("newSwapperId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftChange" ADD CONSTRAINT "ShiftChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
