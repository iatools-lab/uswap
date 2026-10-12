import type { AssignmentInput, CoverageMatrix } from './planning.types';

export type { AssignmentInput, CoverageMatrix };

export function buildMatrix(input: {
  periodStart: string;
  periodEnd: string;
  stations: string[];
  occurrences: {
    stationId: string;
    day: string;
    shiftLabel: string | null;
    startTime: string;
    endTime: string;
    requiredStaff: number;
    assignedUserIds: string[];
  }[];
}): CoverageMatrix {
  const days = enumerate(input.periodStart, input.periodEnd);
  const stations = [...new Set(input.stations)];
  const gaps: CoverageMatrix['gaps'] = [];

  const perStation = stations.map((stationId) => {
    const byDay: CoverageMatrix['perStation'][number]['days'] = {};
    let required = 0;
    let assigned = 0;
    let shifts = 0;
    for (const day of days) {
      byDay[day] = { required: 0, assigned: 0, shifts: 0 };
    }
    for (const occurrence of input.occurrences) {
      if (occurrence.stationId !== stationId) continue;
      const bucket = byDay[occurrence.day] ?? { required: 0, assigned: 0, shifts: 0 };
      bucket.required += occurrence.requiredStaff;
      bucket.assigned += occurrence.assignedUserIds.length;
      bucket.shifts += 1;
      byDay[occurrence.day] = bucket;
      required += occurrence.requiredStaff;
      assigned += occurrence.assignedUserIds.length;
      shifts += 1;
      const missing = occurrence.requiredStaff - occurrence.assignedUserIds.length;
      if (missing > 0) {
        gaps.push({
          stationId,
          day: occurrence.day,
          shiftLabel: occurrence.shiftLabel,
          startTime: occurrence.startTime,
          endTime: occurrence.endTime,
          missing,
        });
      }
    }
    const vacancies = required - assigned;
    return {
      stationId,
      days: byDay,
      required,
      assigned,
      vacancies,
      coverageRate: required ? round(assigned / required) : 1,
    };
  });

  const required = perStation.reduce((total, station) => total + station.required, 0);
  const assigned = perStation.reduce((total, station) => total + station.assigned, 0);
  const shifts = perStation.reduce(
    (total, station) =>
      total + Object.values(station.days).reduce((sum, day) => sum + day.shifts, 0),
    0,
  );

  return {
    days,
    stations,
    totals: {
      shifts,
      required,
      assigned,
      vacancies: required - assigned,
      coverageRate: required ? round(assigned / required) : 1,
    },
    perStation,
    gaps,
  };
}

function enumerate(start: string, end: string): string[] {
  const from = new Date(start);
  const to = new Date(end);
  const days: string[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  const last = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  while (cursor.getTime() <= last) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
