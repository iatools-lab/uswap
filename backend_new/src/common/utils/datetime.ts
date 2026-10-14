/**
 * Utilitaires de dates alignes sur la maquette frontend.
 *
 * Toutes les stations de la maquette sont en Africa/Douala (UTC+1, sans heure
 * d'ete), ce qui rend les calculs deterministes. Les fonctions ci-dessous
 * reproduisent `stationDayKey`, `stationIso`, `weekStartKey` et `dayBounds`
 * afin que les horaires generes par l'API tombent exactement sur les memes
 * instants que ceux attendus par l'interface.
 */

const DAY_MS = 86_400_000;

export const pad2 = (value: number): string => String(value).padStart(2, '0');

/** Decalage (minutes) d'un fuseau IANA a un instant donne, heure d'ete incluse. */
export function timezoneOffsetMinutes(timeZone: string, at: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(at);
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return (asUtc - at.getTime()) / 60_000;
}

/** Clé de jour (AAAA-MM-JJ) telle que vue depuis une station. */
export function stationDayKey(
  ms: number,
  timeZone = 'Africa/Douala',
): string {
  const offset = timezoneOffsetMinutes(timeZone, new Date(ms));
  const local = new Date(ms + offset * 60_000);
  return `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(
    local.getUTCDate(),
  )}`;
}

/** Instant ISO correspondant a une heure locale de station. */
export function stationIso(
  dayKey: string,
  hhmm: string,
  timeZone = 'Africa/Douala',
): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const [hours, minutes] = hhmm.split(':').map(Number);
  const naive = Date.UTC(year, month - 1, day, hours, minutes);
  // Approximation a une passe : suffisant car aucune station n'observe l'heure
  // d'ete dans le perimetre uSwap (Africa/Douala = UTC+1 permanent).
  const offset = timezoneOffsetMinutes(timeZone, new Date(naive));
  return new Date(naive - offset * 60_000).toISOString();
}

export function addDaysKey(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(
    shifted.getUTCDate(),
  )}`;
}

/** Lundi de la semaine contenant un jour donne. */
export function weekStartKey(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDaysKey(dayKey, weekday === 0 ? -6 : 1 - weekday);
}

export function dayKeys(startKey: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    addDaysKey(startKey, index),
  );
}

/** 1 = lundi … 7 = dimanche, comme le formulaire de generation. */
export function isoWeekday(dayKey: string): number {
  const [year, month, day] = dayKey.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Duree brute d'un creneau « HH:MM » -> « HH:MM » en minutes (gere la nuit). */
export function slotMinutes(startTime: string, endTime: string): number {
  const minutes = (value: string): number =>
    Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  return (minutes(endTime) - minutes(startTime) + 1440) % 1440;
}

export const isoFromMs = (ms: number): string => new Date(ms).toISOString();

/** Minutes ecoulees depuis minuit, dans l'heure locale de la station. */
export function minutesOfDay(ms: number, timeZone = 'Africa/Douala'): number {
  const offset = timezoneOffsetMinutes(timeZone, new Date(ms));
  const local = new Date(ms + offset * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/** Bornes ISO d'une journee de station. */
export function dayBounds(
  dayKey: string,
  timeZone = 'Africa/Douala',
): { start: number; end: number } {
  const nextKey = addDaysKey(dayKey, 1);
  return {
    start: Date.parse(stationIso(dayKey, '00:00', timeZone)),
    end: Date.parse(stationIso(nextKey, '00:00', timeZone)),
  };
}

/** Lundi de la semaine d'un instant, exprime en jour de station. */
export function weekKeyOf(iso: string, timeZone = 'Africa/Douala'): string {
  return weekStartKey(stationDayKey(Date.parse(iso), timeZone));
}

/** Nombre de jours calendaires couverts par une periode inclusive. */
export function dayCount(startIso: string, endIso: string): number {
  const dayNumber = (value: string): number => {
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return (
    Math.floor((dayNumber(endIso) - dayNumber(startIso)) / DAY_MS) + 1
  );
}

export function isSameDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

/** Liste des jours (AAAA-MM-JJ) entre deux instants ISO inclus. */
export function dayList(startIso: string, endIso: string): string[] {
  const result: string[] = [];
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  for (let cursor = start; cursor <= end; cursor += DAY_MS) {
    const date = new Date(cursor);
    result.push(
      `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
        date.getUTCDate(),
      )}`,
    );
  }
  return result;
}

/**
 * Heures retenues d'un poste = duree prevue moins la pause (RM-13).
 * Le calcul vit ici car il est partage par les plannings, la couverture et
 * les rapports.
 */
export function durationHours(occurrence: {
  startTime: Date | string;
  endTime: Date | string;
  breakMinutes: number;
}): number {
  const start = Date.parse(String(occurrence.startTime));
  const end = Date.parse(String(occurrence.endTime));
  const gross = (end - start) / 3_600_000;
  const pause = occurrence.breakMinutes / 60;
  return Math.max(0, Math.round((gross - pause) * 100) / 100);
}

/** Deux intervalles se chevauchent-ils ? */
export function overlaps(
  aStart: string | number,
  aEnd: string | number,
  bStart: string | number,
  bEnd: string | number,
): boolean {
  return Date.parse(String(aStart)) < Date.parse(String(bEnd)) &&
    Date.parse(String(aEnd)) > Date.parse(String(bStart));
}

/**
 * Decompte des jours utilises d'un conge, borne a l'annee et a aujourd'hui —
 * reprend la regle de `ensureConsumedLeaveHistory` cote frontend.
 */
export function consumedDaysWithin(
  startTime: string,
  endTime: string,
  year: number,
  now: number,
): number {
  const start = Math.max(
    Date.parse(startTime),
    Date.UTC(year, 0, 1),
  );
  const end = Math.min(
    Date.parse(endTime),
    Date.UTC(year + 1, 0, 1) - DAY_MS,
    Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate(),
    ),
  );
  if (end < start) return 0;
  return Math.floor((end - start) / DAY_MS) + 1;
}
