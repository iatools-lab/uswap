/**
 * Affichage des heures et des dates.
 *
 * Règle uSwap : toutes les heures d'exploitation sont exprimées dans le fuseau
 * de la station (Africa/Douala, UTC+1, sans heure d'été). Utiliser le fuseau
 * par défaut du navigateur — ce que faisait `toLocaleTimeString("fr-FR")` —
 * décale tous les écrans d'une heure dès que le poste n'est pas réglé sur ce
 * fuseau, d'où les incohérences entre plannings, dashboards et pointages.
 */

export const STATION_TIMEZONE = "Africa/Douala";

/** Fuseau à utiliser : celui de la station, sinon celui de la plateforme. */
export function zoneOf(timezone?: string | null): string {
  return timezone && timezone.trim() ? timezone : STATION_TIMEZONE;
}

/** « 14:05 » dans le fuseau de la station. */
export function formatTime(
  value: string | number | Date | null | undefined,
  timezone?: string | null,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("fr-FR", {
    timeZone: zoneOf(timezone),
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** « 14:05:32 » pour les traces techniques. */
export function formatTimeWithSeconds(
  value: string | number | Date | null | undefined,
  timezone?: string | null,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("fr-FR", {
    timeZone: zoneOf(timezone),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** « mer. 29 oct. 2026 » dans le fuseau de la station. */
export function formatDate(
  value: string | number | Date | null | undefined,
  timezone?: string | null,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    ...options,
    timeZone: zoneOf(timezone),
  }).format(date);
}

/** « mer. 29 oct. 2026, 14:05 » — date et heure locales de la station. */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  timezone?: string | null,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: zoneOf(timezone),
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/** Jour local (AAAA-MM-JJ) d'un instant, dans le fuseau de la station. */
export function dayKeyOf(
  value: string | number | Date,
  timezone?: string | null,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zoneOf(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const read = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

/** Minutes écoulées depuis minuit, dans le fuseau de la station. */
export function minutesOfDay(
  value: string | number | Date,
  timezone?: string | null,
): number {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  const text = date.toLocaleTimeString("en-GB", {
    timeZone: zoneOf(timezone),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [hours, minutes] = text.split(":").map(Number);
  return hours * 60 + minutes;
}
