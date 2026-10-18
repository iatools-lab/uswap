import { currentLocale } from "../app/i18n";

export function plural(
  count: number,
  singular: string,
  pluralForm = `${singular}s`,
) {
  return count === 1 ? singular : pluralForm;
}

export function countLabel(
  count: number,
  singular: string,
  pluralForm = `${singular}s`,
) {
  return `${count} ${plural(count, singular, pluralForm)}`;
}

/** Période lisible avec le mois en toutes lettres et l’année écrite une fois. */
export function formatDateRange(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameDay = start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10);
  const sameMonth = start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth();
  const locale = currentLocale();
  const day = (date: Date) => new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" }).format(date);
  const monthYear = (date: Date) => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  const full = (date: Date) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  if (sameDay) return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(start);
  if (sameMonth) return `${day(start)}–${day(end)} ${monthYear(end)}`;
  if (start.getUTCFullYear() === end.getUTCFullYear()) {
    const startMonth = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(start);
    return `${startMonth}–${full(end)}`;
  }
  return `${full(start)}–${full(end)}`;
}
