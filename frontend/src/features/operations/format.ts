import type { OperationShift } from "./types";

export const formatDate = (
  value: string,
  zone = "Africa/Douala",
  seconds = false,
) =>
  new Intl.DateTimeFormat("fr-CM", {
    dateStyle: "medium",
    timeStyle: seconds ? "medium" : "short",
    timeZone: zone,
  }).format(new Date(value));

export function shiftStatus(shift: OperationShift) {
  if (shift.attendance?.status === "ABSENT") return "Absent";
  if (shift.attendance?.status === "JUSTIFIED") return "Justifié";
  if (shift.attendance?.checkedOutAt) return "Terminé";
  if (shift.attendance)
    return shift.attendance.isLate ? "Présent · en retard" : "Présent";
  if (shift.publishedAt) return "Publié";
  return "Brouillon";
}

export function isOpenShift(shift: OperationShift, now = Date.now()) {
  return !shift.attendance?.checkedOutAt && Date.parse(shift.endTime) >= now;
}

export function isInWindow(shift: OperationShift, now = Date.now()) {
  return Date.parse(shift.startTime) <= now && now <= Date.parse(shift.endTime);
}

/**
 * Shift que l'agent doit voir en premier : celui en cours, sinon le suivant
 * par ordre chronologique (le plus proche dans le temps).
 *
 * Une prise de service enregistrée sans fin de service reste le shift
 * courant, et un shift déjà déclaré absent ne peut pas être « le prochain ».
 */
export function pickNextShift(shifts: OperationShift[]) {
  const now = Date.now();
  const sorted = [...shifts].sort(
    (a, b) => Date.parse(a.startTime) - Date.parse(b.startTime),
  );

  const live = sorted.find((shift) => isInWindow(shift, now));
  if (live) return live;

  // Prise de service faite mais fin non pointée : le service est en cours.
  const started = sorted.find(
    (shift) =>
      shift.attendance !== null &&
      !shift.attendance.checkedOutAt &&
      (shift.attendance.status === "PRESENT" ||
        shift.attendance.status === "LATE"),
  );
  if (started) return started;

  return (
    sorted.find(
      (shift) =>
        Date.parse(shift.startTime) > now &&
        !shift.attendance?.checkedOutAt &&
        shift.attendance?.status !== "ABSENT",
    ) ?? null
  );
}

export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds} s`;
  return `${minutes} min ${seconds.toString().padStart(2, "0")} s`;
}

export function dayKey(iso: string, zone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
