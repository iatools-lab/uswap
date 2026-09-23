import { addDaysKey, stationDayKey } from "./seed";
import { durationHours, notifyStaff, stationOf, weekKeyOf } from "./shared";
import type {
  AttendanceStatus,
  MockAttendance,
  MockDb,
  MockOccurrence,
} from "./types";

export type ConstraintReport = {
  valid: boolean;
  stationName: string;
  timezone: string;
  durationHours: number;
  weeks: {
    startDate: string;
    existingHours: number;
    addedHours: number;
    projectedHours: number;
    limitHours: number;
  }[];
  errors: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
};

export function attendanceRecord(db: MockDb, shiftId: string): MockAttendance | null {
  return db.attendance.find((item) => item.shiftId === shiftId) ?? null;
}

/**
 * Statut affiché d'une affectation : enregistrement de pointage, absence
 * (déclarée ou automatique), sinon attente. Un poste vacant reste « attendu ».
 */
export function attendanceStatus(
  db: MockDb,
  occurrence: MockOccurrence,
): AttendanceStatus {
  const record = attendanceRecord(db, occurrence.id);
  if (record) return record.status;
  if (!occurrence.swapperId) return "EXPECTED";
  if (db.absences.some((item) => item.shiftId === occurrence.id)) return "ABSENT";
  return "EXPECTED";
}

/** Heures déjà planifiées d'un swappeur sur une semaine (lundi → dimanche). */
export function hoursInWeek(
  db: MockDb,
  swapperId: string,
  weekStart: string,
  ignoreOccurrenceId?: string,
): number {
  const weekEnd = addDaysKey(weekStart, 7);
  const total = db.occurrences
    .filter((item) => item.swapperId === swapperId && item.id !== ignoreOccurrenceId)
    .filter((item) => {
      const key = stationDayKey(Date.parse(item.startTime));
      return key >= weekStart && key < weekEnd;
    })
    .reduce((sum, item) => sum + durationHours(db, item), 0);
  return Math.round(total * 100) / 100;
}

/**
 * US 2038 — Un traitement automatique classe absent le swappeur qui n'a pas
 * pointé après la tolérance ou qui n'a pas enregistré sa fin de service. Il
 * ne traite chaque affectation qu'une fois et notifie les acteurs concernés.
 */
export function runAutomation(db: MockDb, now: number): void {
  // RM-15 — une opération de congé conservée localement est rejouée dès que
  // sa fenêtre de nouvelle tentative est atteinte. Le service fictif redevient
  // disponible au rejeu, ce qui rend le comportement déterministe en démo.
  for (const operation of db.leaveSyncOperations) {
    if (!["FAILED", "QUEUED"].includes(operation.status)) continue;
    if (operation.nextAttemptAt && Date.parse(operation.nextAttemptAt) > now) continue;
    operation.status = "SYNCED";
    operation.attempts += 1;
    operation.lastAttemptAt = new Date(now).toISOString();
    operation.completedAt = new Date(now).toISOString();
    operation.nextAttemptAt = null;
    operation.lastError = null;
    const leave = db.leaves.find((item) => item.id === operation.leaveId);
    if (leave?.status === "SYNC_FAILED") leave.status = "PENDING";
  }
  const published = new Set(
    db.plannings.filter((item) => item.status === "PUBLISHED").map((item) => item.id),
  );
  for (const occurrence of db.occurrences) {
    if (!published.has(occurrence.planningId)) continue;
    if (!occurrence.swapperId) continue;
    const station = db.stations.find((item) => item.id === occurrence.stationId);
    if (!station) continue;
    const start = Date.parse(occurrence.startTime);
    const end = Date.parse(occurrence.endTime);
    const tolerance = station.latenessToleranceMinutes * 60000;
    if (now < start + tolerance) continue;
    const record = attendanceRecord(db, occurrence.id);
    const missedCheckin = !record;
    const missedCheckout = now > end && Boolean(record?.checkedInAt) && !record?.checkedOutAt;
    if (!missedCheckin && !missedCheckout) continue;
    if (missedCheckout && record) {
      record.status = "ABSENT";
      record.justified = false;
    }
    if (db.automatedAbsences.includes(occurrence.id)) continue;
    db.automatedAbsences.push(occurrence.id);
    const reason = missedCheckout
      ? "Absence automatique : prise de service enregistrée sans pointage de fin."
      : "Absence automatique : aucun pointage après le délai de tolérance.";
    db.absences.push({
      id: `abs-auto-${occurrence.id}`,
      shiftId: occurrence.id,
      swapperId: occurrence.swapperId,
      reason,
      attachmentId: null,
      clientRef: null,
      reportedAt: new Date(missedCheckout ? end : start + tolerance).toISOString(),
      origin: "AUTOMATIC_ABSENCE",
      status: "OPEN",
      coveredBy: null,
    });
    const swapper = db.users.find((item) => item.id === occurrence.swapperId);
    notifyStaff(
      db,
      occurrence.stationId,
      "AUTOMATIC_ABSENCE",
      "Absence automatique",
      missedCheckout
        ? `${swapper?.fullName ?? "Un swappeur"} n'a pas enregistré sa fin de service à ${station.name} (${occurrence.label}).`
        : `${swapper?.fullName ?? "Un swappeur"} n'a pas pointé à ${station.name} (${occurrence.label}).`,
      [occurrence.swapperId],
    );
  }
}

/** Contrôles complets d'une affectation (US 2042, 2043 : contraintes recalculées). */
export function constraintReport(
  db: MockDb,
  options: {
    stationId: string;
    swapperId: string;
    startTime: string;
    endTime: string;
    hours: number;
    ignoreOccurrenceId?: string;
  },
): ConstraintReport {
  const station = stationOf(db, options.stationId);
  const swapper = db.users.find((item) => item.id === options.swapperId) ?? null;
  const start = Date.parse(options.startTime);
  const end = Date.parse(options.endTime);
  const errors: ConstraintReport["errors"] = [];
  const warnings: ConstraintReport["warnings"] = [];
  const hour = (from: number) =>
    new Date(from).toLocaleString("fr-FR", {
      timeZone: station.timezone,
      dateStyle: "short",
      timeStyle: "short",
    });

  if (!(end > start))
    errors.push({
      code: "INVALID_WINDOW",
      message: "La fin du service doit être postérieure à son début.",
    });
  if (!swapper) errors.push({ code: "SWAPPER_INVALID", message: "Swappeur inconnu." });
  else if (swapper.role !== "SWAPPER")
    errors.push({ code: "SWAPPER_ROLE", message: "Ce compte n'est pas un swappeur." });
  else if (!swapper.isActive)
    errors.push({ code: "SWAPPER_INACTIVE", message: "Ce swappeur est désactivé." });
  if (!station.isActive)
    errors.push({
      code: "STATION_CLOSED",
      message: "La station est désactivée : aucune affectation possible.",
    });

  const others = db.occurrences.filter(
    (item) =>
      item.swapperId === options.swapperId && item.id !== options.ignoreOccurrenceId,
  );

  const approvedLeave = db.leaves.find(
    (leave) =>
      leave.swapperId === options.swapperId &&
      leave.status === "APPROVED" &&
      Date.parse(leave.startTime) < end &&
      start < Date.parse(leave.endTime),
  );
  if (approvedLeave)
    errors.push({
      code: "APPROVED_LEAVE",
      message: `Congé approuvé du ${hour(Date.parse(approvedLeave.startTime))} au ${hour(Date.parse(approvedLeave.endTime))} : ${approvedLeave.reason}.`,
    });

  for (const other of others) {
    const otherStart = Date.parse(other.startTime);
    const otherEnd = Date.parse(other.endTime);
    if (otherStart < end && start < otherEnd)
      errors.push({
        code: "OVERLAP",
        message: `Chevauchement avec le service du ${hour(otherStart)} (${other.label}).`,
      });
  }

  const minRest = station.minRestHours * 3600000;
  for (const other of others) {
    const otherStart = Date.parse(other.startTime);
    const otherEnd = Date.parse(other.endTime);
    const gap = otherStart >= end ? otherStart - end : otherEnd <= start ? start - otherEnd : -1;
    if (gap >= 0 && gap < minRest)
      errors.push({
        code: "REST",
        message: `Repos insuffisant : ${Math.round((gap / 3600000) * 10) / 10} h entre deux services (minimum ${station.minRestHours} h).`,
      });
  }

  const weekStart = weekKeyOf(options.startTime);
  const existingHours = hoursInWeek(db, options.swapperId, weekStart, options.ignoreOccurrenceId);
  const projectedHours = Math.round((existingHours + options.hours) * 100) / 100;
  if (projectedHours > station.weeklyHoursLimit)
    errors.push({
      code: "WEEKLY_LIMIT",
      message: `Limite hebdomadaire dépassée : ${projectedHours} h projetées pour ${station.weeklyHoursLimit} h autorisées.`,
    });
  else if (projectedHours > station.weeklyHoursLimit * 0.9)
    warnings.push({
      code: "NEAR_LIMIT",
      message: `Charge proche de la limite hebdomadaire (${projectedHours} h sur ${station.weeklyHoursLimit} h).`,
    });

  const crossesMidnight = stationDayKey(start) !== stationDayKey(end);
  if (crossesMidnight)
    warnings.push({
      code: "NIGHT",
      message: "Le service franchit minuit : vérifiez le repos qui suit.",
    });

  const target = options.ignoreOccurrenceId
    ? db.occurrences.find((item) => item.id === options.ignoreOccurrenceId)
    : undefined;
  if (options.hours >= 6 && (target?.breakMinutes ?? 0) === 0)
    warnings.push({
      code: "NO_BREAK",
      message: "Service de 6 h ou plus sans pause : complétez le modèle de shift.",
    });

  const weeks: ConstraintReport["weeks"] = [
    {
      startDate: weekStart,
      existingHours,
      addedHours: options.hours,
      projectedHours,
      limitHours: station.weeklyHoursLimit,
    },
  ];
  if (crossesMidnight) {
    const nextWeek = weekKeyOf(options.endTime);
    if (nextWeek !== weekStart) {
      const nextExisting = hoursInWeek(
        db,
        options.swapperId,
        nextWeek,
        options.ignoreOccurrenceId,
      );
      weeks.push({
        startDate: nextWeek,
        existingHours: nextExisting,
        addedHours: 0,
        projectedHours: nextExisting,
        limitHours: station.weeklyHoursLimit,
      });
    }
  }

  return {
    valid: errors.length === 0,
    stationName: station.name,
    timezone: station.timezone,
    durationHours: options.hours,
    weeks,
    errors,
    warnings,
  };
}
