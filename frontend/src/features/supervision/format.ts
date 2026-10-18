import { currentLocale } from "../../app/i18n";
export const zone = "Africa/Douala";

export const formatDateTime = (value: string, tz = zone, locale = currentLocale()) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: tz,
  }).format(new Date(value));

export const formatDay = (value: string, tz = zone, locale = currentLocale()) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: tz,
  }).format(new Date(value));

export const toDateInput = (date: Date) => date.toISOString().slice(0, 10);
