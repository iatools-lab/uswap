export const DAILY_SHIFT_HOURS = 8;

export const MIN_REST_HOURS = 8;

export const DEFAULT_WEEKLY_HOURS_LIMIT = 72;

export function getDurationInHours(
  startTime: Date,
  endTime: Date,
): number {
  const milliseconds =
    endTime.getTime() - startTime.getTime();

  return milliseconds / (1000 * 60 * 60);
}

export function getBusinessDate(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Douala',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(date);
}

export function getWeekStart(date: Date): Date {
  const businessDate = getBusinessDate(date);

  const [year, month, day] = businessDate
    .split('-')
    .map(Number);

  const localDate = new Date(
    Date.UTC(year, month - 1, day),
  );

  const dayOfWeek = localDate.getUTCDay();

  const daysFromMonday =
    dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  localDate.setUTCDate(
    localDate.getUTCDate() - daysFromMonday,
  );

  return localDate;
}

export function getWeekKey(date: Date): string {
  const weekStart = getWeekStart(date);

  return weekStart.toISOString().slice(0, 10);
}

export function datesOverlap(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date,
): boolean {
  return startA < endB && endA > startB;
}

export function hoursBetween(
  firstEnd: Date,
  secondStart: Date,
): number {
  return (
    secondStart.getTime() -
    firstEnd.getTime()
  ) / (1000 * 60 * 60);
}