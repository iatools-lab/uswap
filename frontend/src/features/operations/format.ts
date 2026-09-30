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
  if (shift.attendance?.checkedOutAt) return "Terminé";
  if (shift.attendance)
    return shift.attendance.isLate ? "Présent · en retard" : "Présent";
  if (shift.publishedAt) return "Publié";
  return "Brouillon";
}

export function isOpenShift(shift: OperationShift) {
  return !shift.attendance?.checkedOutAt;
}

export function isInWindow(shift: OperationShift, now = Date.now()) {
  return Date.parse(shift.startTime) <= now && now <= Date.parse(shift.endTime);
}

export function pickNextShift(shifts: OperationShift[]) {
  const open = shifts.filter(isOpenShift);
  const live = open.find((shift) => isInWindow(shift));
  if (live) return live;
  return (
    [...open].sort(
      (a, b) => Date.parse(a.startTime) - Date.parse(b.startTime),
    )[0] || null
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
